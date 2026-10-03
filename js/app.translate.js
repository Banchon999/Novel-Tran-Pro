// ─── Translation Core (v10 — True Stream, Sequential) ───

// ความยาว context จากตอน/chunk ก่อนหน้า (ตัวอักษร) — ตั้งได้ต่อ workspace, default 400
function getPrevCtxChars() {
  const v = parseInt(S.currentWs?.settings?.prevCtxChars);
  return Math.max(100, Math.min(4000, v || 400));
}

function getOptions() {
  const styleId = document.getElementById('activeStyleSelect')?.value || S.activeStyleId;
  const customStylePrompt = getStyleById(styleId)?.prompt || null;
  const wsGlossary = {};
  (S.currentWs?.glossary || []).forEach(g => { wsGlossary[g.korean] = { thai: g.thai, type: g.type, note: g.note, gender: g.gender }; });

  // Prev chapter context
  let prevChapterContext = '';
  const usePrev = document.getElementById('usePrevChapter')?.checked;
  if (usePrev && S.currentWs?.chapters?.length) {
    const srcType = document.getElementById('prevChapterType')?.value || 'translation';
    const chapters = S.currentWs.chapters;
    const curId = S.editingChapterId;
    const curIdx = curId ? chapters.findIndex(c => c.id === curId) : -1;
    let prevCh = null;
    if (curIdx > 0) {
      prevCh = chapters[curIdx - 1];
    } else if (!curId) {
      for (let i = chapters.length - 1; i >= 0; i--) {
        if (chapters[i].translation) { prevCh = chapters[i]; break; }
      }
    }
    if (prevCh) {
      const ctxText = srcType === 'source' ? prevCh.sourceText : prevCh.translation;
      if (ctxText?.trim()) {
        const label = srcType === 'source' ? 'PREVIOUS CHAPTER (Original)' : 'PREVIOUS CHAPTER (Thai Translation)';
        const snippet = ctxText.trim().slice(-(getPrevCtxChars() * 2)); // ระดับตอนให้ context ยาวกว่า chunk 2 เท่า
        prevChapterContext = `${label} — last part:\n${snippet}\n`;
      }
    }
  }

  return {
    model: document.getElementById('translateModel').value,
    usePolish: document.getElementById('usePolish').checked,
    useMemory: document.getElementById('useMemory').checked,
    temperature: S.currentWs?.settings?.temperature ?? 0.7,
    chunkSize: parseInt(document.getElementById('chunkSize')?.value || '0') || 0,
    customStylePrompt,
    wsGlossary,
    prevChapterContext,
  };
}

function splitText(text) {
  const paragraphs = text.split(/\n\n+/).map(p => p.trim()).filter(Boolean);
  if (paragraphs.length === 0) return [{ index: 0, text }];
  return paragraphs.map((p, i) => ({ index: i, text: p }));
}

function buildGlossaryStr(wsGlossary) {
  const GENDER_MAP   = { male: 'male/ชาย', female: 'female/หญิง', neutral: 'neutral/กลาง' };
  const PRONOUN_3RD  = { male: '3rd→เขา/ของเขา', female: '3rd→เธอ/นาง/ของเธอ' };
  const PRONOUN_1ST  = { male: '1st→ผม/กู/ข้า', female: '1st→ฉัน/หนู/อิฉัน' };
  const PARTICLE     = { male: 'particle→ครับ/ขอรับ', female: 'particle→ค่ะ/คะ' };
  const entries = Object.entries(wsGlossary || {});
  if (!entries.length) return '(ไม่มี)';
  return entries.map(([k, v]) => {
    const parts = [v.thai];
    if (v.type === 'character' && v.gender && v.gender !== 'neutral') {
      parts.push(`gender:${GENDER_MAP[v.gender] || v.gender}`);
      parts.push(PRONOUN_3RD[v.gender]);
      parts.push(PRONOUN_1ST[v.gender]);
      if (PARTICLE[v.gender]) parts.push(PARTICLE[v.gender]);
    } else if (v.type === 'character' && v.gender === 'neutral') {
      parts.push('gender:neutral/กลาง');
    }
    if (v.note) parts.push(v.note);
    return `${k} = ${parts.join(' | ')}`;
  }).join('\n');
}

function buildContextStr(segments, currentIndex) {
  if (currentIndex <= 0) return '';
  const prev = segments.slice(Math.max(0, currentIndex - 2), currentIndex);
  const translated = prev.filter(s => s.translation);
  if (!translated.length) return '';
  return `CONTEXT (previous paragraphs):\n${translated.map(s => s.translation).join('\n\n')}\n`;
}

// In-memory cache — LRU, จำกัด 200 entries (~50MB กัน leak)
const _MC_MAX = 200;
const _memoryCache = {};          // key → value
const _memoryCacheOrder = [];     // insertion order สำหรับ LRU eviction

function _mcSet(key, value) {
  if (_memoryCache[key] !== undefined) {
    // refresh position
    const pos = _memoryCacheOrder.indexOf(key);
    if (pos !== -1) _memoryCacheOrder.splice(pos, 1);
  } else if (_memoryCacheOrder.length >= _MC_MAX) {
    // evict oldest
    const oldest = _memoryCacheOrder.shift();
    delete _memoryCache[oldest];
  }
  _memoryCache[key] = value;
  _memoryCacheOrder.push(key);
}

function _mcGet(key) {
  return _memoryCache[key];
}

// key ของ Memory = โมเดล + preset + ข้อความเต็ม (เดิมใช้แค่ 120 ตัวแรก → chunk ที่ขึ้นต้นเหมือนกันได้คำแปลผิดอัน)
function _mcKey(model, text) {
  return `${model || ''}|${S.currentWs?.presetId || ''}|${text}`;
}

// ── True SSE streaming per segment — ใช้ aiStream (provider-aware) ──
async function streamSegment(text, contextSegs, options, onChunk, onDone) {
  const { model, temperature = 0.7, customStylePrompt, wsGlossary = {}, useMemory = true } = options;
  const cacheKey = _mcKey(model, text);

  if (useMemory && _mcGet(cacheKey)) {
    onChunk(_mcGet(cacheKey));
    onDone(_mcGet(cacheKey), true);
    return;
  }

  const key = getApiKey();
  if (!key) throw new Error('ยังไม่ได้ตั้ง API Key — ไปที่ ⚙ ตั้งค่า');

  const glossaryStr = buildGlossaryStr(wsGlossary);
  const contextStr = buildContextStr(contextSegs, contextSegs.length);
  const prompt = buildTranslatePrompt({
    sourceText: text,
    glossaryStr,
    contextStr,
    styleNote: customStylePrompt || '',
    ws: S.currentWs, // ใช้ preset ที่ผู้ใช้เลือกใน workspace ปัจจุบัน
  });

  // AbortController with 120s timeout
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), getTimeoutMs('chunk'));

  let inTok = 0, outTok = 0;
  let fullText = '';
  try {
    fullText = await aiStream(
      { model, temperature, max_tokens: Math.max(2000, Math.ceil(text.length * 2)), messages: [{ role: 'user', content: prompt }] },
      onChunk,
      (i, o) => { inTok = i; outTok = o; },
      ctrl.signal
    );
  } finally {
    clearTimeout(timer);
  }

  if (inTok || outTok) addCosts(inTok, outTok, model);
  if (useMemory && fullText) _mcSet(cacheKey, fullText);
  onDone(fullText, false);
}

// Fallback non-streaming (for preview/polish)
async function translateSegmentDirect(text, allSegments = [], options = {}) {
  const { model = 'google/gemini-2.5-flash', temperature = 0.7, customStylePrompt, wsGlossary = {}, useMemory = true, usePolish = false } = options;
  const cacheKey = _mcKey(model, text);
  if (useMemory && _mcGet(cacheKey)) return { translation: _mcGet(cacheKey), fromMemory: true };

  const glossaryStr = buildGlossaryStr(wsGlossary);
  const contextStr = buildContextStr(allSegments, allSegments.findIndex(s => s.text === text));
  const prompt = buildTranslatePrompt({
    sourceText: text,
    glossaryStr,
    contextStr,
    styleNote: customStylePrompt || '',
    ws: S.currentWs, // ใช้ preset ที่ผู้ใช้เลือก เพื่อให้สำนวนสอดคล้องกัน
  });

  const res = await callOpenRouter({ model, messages: [{ role: 'user', content: prompt }], temperature, max_tokens: Math.max(2000, Math.ceil(text.length * 2)) });
  let translation = res.choices?.[0]?.message?.content?.trim() || '';

  if (usePolish && translation) {
    const polishPrompt = POLISH_PROMPT.replace('{glossary}', glossaryStr).replace('{text}', translation);
    try {
      const pr = await callOpenRouter({ model, messages: [{ role: 'user', content: polishPrompt }], temperature: 0.5, max_tokens: Math.max(2000, translation.length * 2) });
      translation = pr.choices?.[0]?.message?.content?.trim() || translation;
    } catch {}
  }
  if (useMemory) _mcSet(cacheKey, translation);
  return { translation, fromMemory: false };
}

async function startTranslation() {
  const rawText = document.getElementById('sourceText').value.trim();
  if (!rawText) { showToast('ใส่ข้อความก่อน', 'error'); return; }
  if (S.translating) return;
  if (typeof rState !== 'undefined') readerCancelPrefetch(); // งาน manual มาก่อน prefetch
  // normalize Korean slang/jamo ก่อนส่ง AI (ไม่แก้ textarea)
  const text = prepareSourceForTranslation(rawText);
  const opts = getOptions();
  if (opts.chunkSize > 0) {
    await translateChunked(text, opts);
  } else {
    await translateAllStream(text);
  }
}

// ═══════════════════════════════════════════════
// ─── Speaker Map (ระบุผู้พูดก่อนแปล — กัน ครับ/ค่ะ / ผม-ฉัน ผิดคน) ───
// ═══════════════════════════════════════════════
// 1) ก่อนแปล: ให้ AI ระบุผู้พูด + เพศ ของบทพูดทุกบรรทัดในต้นฉบับ (เพศจาก glossary มีสิทธิ์เหนือกว่า)
// 2) ตอนแปล: แนบแผนที่ผู้พูดเข้า prompt
// 3) หลังแปล: ถ้าจำนวนบทพูดไทยตรงกับต้นฉบับ → แก้คำลงท้าย/คำแทนตัวที่ผิดเพศให้อัตโนมัติ (local ไม่เสียเงิน)
// บทพูด “…” (dq) + ความคิด/คำพูดที่นึกย้อน/ชื่อเฉพาะใน ‘…’ (sq) — เรียงตามลำดับในต้นฉบับ
const _SRC_LINE_RE  = /[“"]([^“”"\n]{1,600})[”"]|‘([^‘’\n]{1,600})’/g;
const _TH_DQ_RE     = /([“"「])([^“”"「」\n]{1,600})([”"」])/g;
const _TH_ANY_RE    = /([“"「‘])([^“”"「」‘’\n]{1,600})([”"」’])/g;

function extractSourceLines(text) {
  const t = String(text || ''), len = Math.max(1, t.length);
  return [...t.matchAll(_SRC_LINE_RE)].map(m => ({
    q: m[1] !== undefined ? m[1] : m[2],
    kind: m[1] !== undefined ? 'dq' : 'sq',
    pos: m.index / len,              // ตำแหน่งสัมพัทธ์ในตอน (0–1) — ใช้จับคู่กับบทพูดไทย
  }));
}
// มีบทพูด “…” อย่างน้อย 1 บรรทัดไหม (ไม่มี → ไม่ต้องเรียก AI ระบุผู้พูด)
function extractSourceQuotes(text) {
  return extractSourceLines(text).filter(l => l.kind === 'dq').map(l => l.q);
}

function speakerMapEnabled(ws = S.currentWs) {
  return ws?.settings?.speakerMap !== false;   // ค่าเริ่มต้น = เปิด
}

const SPEAKER_MAP_PROMPT = `You identify who speaks each quoted line of dialogue in a Korean web-novel passage.

KNOWN CHARACTERS (glossary — the gender here is authoritative):
{characters}

For EACH numbered line decide the speaker from context:
• dialogue tags BEFORE or AFTER the line (e.g. "…" 엘레나가 물었다 → 엘레나), turn-taking, who is being addressed, speech level and honorifics.
• Unnamed speakers: describe them (노파, 시녀, 기사, 수행원…) and infer gender from the description
  (노파/할멈/할머니/여인/여자/소녀/하녀/시녀/부인/어머니 = female · 노인/사내/남자/소년/청년/아버지 = male).
• gender: "male" | "female" | "unknown" — use "unknown" only when it is truly impossible to tell.

Return ONLY a JSON array with exactly {n} items, no markdown:
[{"q":1,"speaker":"name or description","gender":"male|female|unknown"}]

PASSAGE:
{text}

NUMBERED LINES:
{lines}`;

// คืน [{q, speaker, gender}] ตามลำดับบทพูด หรือ null ถ้าไม่มีบทพูด/ปิดใช้/เรียกไม่สำเร็จ (การแปลยังเดินต่อได้)
async function buildSpeakerMap(text, model, ws = S.currentWs) {
  if (!speakerMapEnabled(ws)) return null;
  if (!extractSourceQuotes(text).length) return null;
  const lines = extractSourceLines(text);
  const glossChars = (ws?.glossary || []).filter(g => g.type === 'character' && g.korean);
  const chars = glossChars.filter(g => text.includes(g.korean))
    .map(g => `- ${g.korean} = ${g.thai}${g.gender === 'male' || g.gender === 'female' ? ` (${g.gender})` : ''}`).join('\n') || '(none)';
  const prompt = SPEAKER_MAP_PROMPT
    .replace('{characters}', chars)
    .replace('{n}', String(lines.length))
    .replace('{text}', text)
    .replace('{lines}', lines.map((l, i) => l.kind === 'dq' ? `Q${i + 1}: “${l.q}”` : `Q${i + 1}: ‘${l.q}’ (single quotes: thought / recalled speech / a named term — for a term use speaker "-")`).join('\n'));
  try {
    const res = await callOpenRouter({
      model, temperature: 0,
      max_tokens: Math.max(6000, lines.length * 80 + 3000),   // เผื่อโมเดลที่คิดก่อนตอบ (reasoning)
      messages: [{ role: 'user', content: prompt }],
    });
    const raw = (res.choices?.[0]?.message?.content || '').replace(/```json|```/g, '').trim();
    const arr = JSON.parse(raw.slice(raw.indexOf('['), raw.lastIndexOf(']') + 1));
    if (!Array.isArray(arr)) return null;
    return lines.map(({ q, kind, pos }, i) => {
      const e = arr.find(x => +x.q === i + 1) || {};
      const sp = String(e.speaker || '').trim();
      // ผู้พูดตรงกับตัวละครใน glossary ที่ระบุเพศ → ใช้เพศจาก glossary เสมอ
      const g = sp && glossChars.find(c => (c.gender === 'male' || c.gender === 'female') && (sp.includes(c.korean) || c.korean.includes(sp) || (c.thai && sp.includes(c.thai))));
      const gender = g ? g.gender : (e.gender === 'male' || e.gender === 'female' ? e.gender : 'unknown');
      return { q, kind, pos, speaker: sp || '?', gender };
    });
  } catch (e) {
    console.warn('[speakerMap]', e);
    return null;
  }
}

function speakerMapPromptBlock(map, ws = S.currentWs) {
  if (!map?.length) return '';
  // ตารางสรรพนามบุรุษที่ 3 ของตัวละครที่พูดในตอนนี้ (จาก glossary + แผนที่ผู้พูด) — กันบรรยาย "เขา" กับตัวละครหญิง
  const sheet = new Map();
  for (const g of (ws?.glossary || [])) if (g.type === 'character' && (g.gender === 'male' || g.gender === 'female') && map.some(m => m.speaker && (m.speaker.includes(g.korean) || g.korean.includes(m.speaker)))) sheet.set(g.thai || g.korean, g.gender);
  for (const m of map) if ((m.gender === 'male' || m.gender === 'female') && m.speaker && m.speaker !== '-' && m.speaker !== '?' && ![...sheet.keys()].some(k => k.includes(m.speaker))) {
    const g = (ws?.glossary || []).find(c => c.korean && (m.speaker.includes(c.korean) || c.korean.includes(m.speaker)));
    sheet.set(g?.thai || m.speaker, m.gender);
  }
  const sheetTxt = [...sheet].map(([n, g]) => `${n} = ${g === 'male' ? 'ชาย → เขา' : 'หญิง → เธอ/นาง'}`).join(' · ');
  const end = g => g === 'male' ? 'ครับ/ขอรับ, self: ผม' : g === 'female' ? 'ค่ะ/คะ, self: ฉัน/ดิฉัน' : 'no gendered particle';
  const lines = map.filter(m => m.speaker && m.speaker !== '-' && m.speaker !== '?').map(m => {
    const q = m.q.length > 40 ? m.q.slice(0, 40) + '…' : m.q;
    return `${m.kind === 'sq' ? `‘${q}’ (thought/recalled)` : `“${q}”`} → ${m.speaker} (${m.gender}) → ${end(m.gender)}`;
  });
  if (!lines.length) return '';
  return `━━━━━━━━━━━━━━━━━━━━
DIALOGUE SPEAKER MAP (pre-identified from the Korean source — one entry per quoted line, in order)
━━━━━━━━━━━━━━━━━━━━
Use it for each line's speaker, self-pronoun and polite particle. Keep every quoted line as its own quote, in the same order, with the same quote marks (“…” stays “…”, ‘…’ stays ‘…’).
${lines.join('\n')}${sheetTxt ? `

3RD-PERSON PRONOUNS IN NARRATION (must match gender): ${sheetTxt}` : ''}`;
}

// แทรกแผนที่ผู้พูดก่อน {text} (ถ้า prompt ไม่มี {text} → ต่อท้าย)
function applySpeakerMap(systemPrompt, map) {
  const block = speakerMapPromptBlock(map);
  if (!block || typeof systemPrompt !== 'string') return systemPrompt;
  return systemPrompt.includes('{text}')
    ? systemPrompt.replace('{text}', block + '\n\n{text}')
    : systemPrompt + '\n\n' + block;
}

// แปลงคำลงท้าย/คำแทนตัวในบทพูด 1 บรรทัดให้ตรงเพศผู้พูด — คืนข้อความใหม่ (ไม่เปลี่ยนถ้าตรงอยู่แล้ว)
const _PEND = '(?=$|[\\s!?.…,~ๆ\\-—)”"」’])';
const _HAIR_MASK_RE = /(เส้นผม|ทรงผม|สระผม|หวีผม|ผมเผ้า|ผมยาว|ผมสั้น|ผมสี|ปอยผม|มัดผม|ผมหงอก|ผมดำ|ผมทอง|ผมขาว|ผมแดง|ผมเงิน|ไรผม|โคนผม|ปลายผม|เกล้าผม|ถักผม)/g;
function fixQuoteGender(q, gender) {
  if (gender !== 'male' && gender !== 'female') return q;
  const ROYAL_M = '\u0001RM\u0001';
  let t = q.replace(/พ่ะย่ะค่ะ|พะยะค่ะ/g, ROYAL_M);
  if (gender === 'female') {
    // ไทยมักไม่เว้นวรรคหลังคำลงท้าย ("ครับท่านดยุก") → "ครับ" แปลงได้ทุกตำแหน่ง (ไม่ใช่ส่วนของคำอื่น)
    t = t.replace(/ครับผม/g, 'ค่ะ')
         .replace(new RegExp('ขอรับ' + _PEND, 'g'), 'เจ้าค่ะ')      // "ขอรับ" ที่ตามด้วยคำอื่นอาจเป็นกริยา (ขอรับเงิน) → แก้เฉพาะท้ายวลี
         .replace(/นะครับ/g, 'นะคะ')
         .replace(/ครับ(?=\s*[?？])/g, 'คะ')
         .replace(/ครับ/g, 'ค่ะ')
         .split(ROYAL_M).join('เพคะ');
    // คำแทนตัว: ผม/กระผม → ฉัน/ดิฉัน (ไม่แตะ "ผม" ที่แปลว่าเส้นผม)
    const hair = [];
    t = t.replace(_HAIR_MASK_RE, m => { hair.push(m); return `\u0002${hair.length - 1}\u0002`; });
    t = t.replace(/กระผม/g, 'ดิฉัน').replace(/(^|[\s“"「…,])ผม/g, '$1ฉัน');
    t = t.replace(/\u0002(\d+)\u0002/g, (_, i) => hair[+i]);
  } else {
    t = t.replace(new RegExp('เจ้าค่ะ' + _PEND, 'g'), 'ขอรับ')
         .replace(new RegExp('เพคะ' + _PEND, 'g'), ROYAL_M)
         .replace(/นะคะ/g, 'นะครับ')
         .replace(/ค่ะ/g, 'ครับ')                                  // "ค่ะ" ไม่เป็นส่วนของคำอื่น
         .replace(new RegExp('คะ' + _PEND, 'g'), 'ครับ')          // "คะ" อยู่ในคำอื่นได้ (คะแนน) → ดูขอบคำ
         .split(ROYAL_M).join('พ่ะย่ะค่ะ')
         .replace(/ดิฉัน|อิฉัน/g, 'ผม');
  }
  return t;
}

// ใช้แผนที่ผู้พูดแก้คำแปลไทย — แก้เฉพาะเมื่อจับคู่บทพูดไทยกับต้นฉบับตามลำดับได้แน่นอน:
//   • จำนวน “…” ตรงกัน → แก้ “…” · จำนวน ‘…’ ตรงกัน → แก้ ‘…’ (แยกกัน)
//   • ถ้า “…” ไม่ตรง (เช่น AI เปลี่ยน ‘…’ เป็น “…”) → ลองนับทุกเครื่องหมายรวมกัน
const _TH_SQ_RE = /(‘)([^‘’\n]{1,600})(’)/g;
function _fixByRegex(text, re, map, fixes) {
  let i = 0;
  return text.replace(re, (all, open, body, close) => {
    const m = map[i++];
    const fixed = fixQuoteGender(body, m.gender);
    if (fixed !== body) fixes.push({ speaker: m.speaker, gender: m.gender, from: body, to: fixed });
    return open + fixed + close;
  });
}
// จับคู่บทพูดไทยกับต้นฉบับตามตำแหน่งในเนื้อเรื่อง (DP แบบเรียงลำดับ ข้ามได้) — ใช้เมื่อจำนวนไม่ตรง
// (AI รวม/แยกบทพูด หรือเปลี่ยน ‘…’ เป็น “…”) · รับเฉพาะคู่ที่ตำแหน่งใกล้กันและความยาวสมเหตุสมผล
function _endClass(t) {
  const x = String(t).trim();
  return /[?？]$/.test(x) ? '?' : /[!！]$/.test(x) ? '!' : /(…|\.\.\.|⋯)$/.test(x) ? '…' : '.';
}
function _alignByPosition(src, th, names = []) {
  const n = src.length, m = th.length, GAP = 0.035;
  const cost = (i, j) => {
    const s = src[i], t = th[j];
    const r = t.len / Math.max(1, s.q.length);
    let c = Math.abs(s.pos - t.pos);
    if (r < 0.5 || r > 6) c += 0.05;                               // ความยาวไม่สมเหตุสมผล
    if (_endClass(s.q) !== _endClass(t.b)) c += 0.012;             // ? ! … ท้ายประโยคไม่ตรง
    for (const nm of names) {                                       // ชื่อตัวละครในบทพูด
      const inS = s.q.includes(nm.korean), inT = nm.thai && t.b.includes(nm.thai);
      if (inS && inT) c -= 0.008; else if (inS !== !!inT) c += 0.008;
    }
    return Math.max(0, c);
  };
  const D = Array.from({ length: n + 1 }, () => new Float64Array(m + 1));
  const B = Array.from({ length: n + 1 }, () => new Uint8Array(m + 1));
  for (let i = 1; i <= n; i++) { D[i][0] = i * GAP; B[i][0] = 1; }
  for (let j = 1; j <= m; j++) { D[0][j] = j * GAP; B[0][j] = 2; }
  for (let i = 1; i <= n; i++) for (let j = 1; j <= m; j++) {
    const a = D[i - 1][j - 1] + cost(i - 1, j - 1), b = D[i - 1][j] + GAP, c = D[i][j - 1] + GAP;
    if (a <= b && a <= c) { D[i][j] = a; B[i][j] = 0; } else if (b <= c) { D[i][j] = b; B[i][j] = 1; } else { D[i][j] = c; B[i][j] = 2; }
  }
  const raw = [];
  for (let i = n, j = m; i > 0 || j > 0;) {
    const k = B[i][j];
    if (i > 0 && j > 0 && k === 0) { raw.push([j - 1, i - 1, cost(i - 1, j - 1)]); i--; j--; }
    else if (i > 0 && (k === 1 || j === 0)) i--; else j--;
  }
  raw.reverse();
  // รับเฉพาะคู่ที่มั่นใจ: ต้นทุนต่ำ และคู่ข้างเคียงก็จับคู่ติดกันแบบ 1:1 (ไม่มีการข้ามรอบตัว)
  const pairs = new Map();
  raw.forEach(([j, i, c], k) => {
    const prev = raw[k - 1], next = raw[k + 1];
    const tight = (!prev || (prev[0] === j - 1 && prev[1] === i - 1)) && (!next || (next[0] === j + 1 && next[1] === i + 1));
    if (c < 0.02 && tight) pairs.set(j, i);
  });
  return pairs;
}
function _fixMatched(text, re, pairOf, map, fixes) {
  let j = 0;
  return text.replace(re, (all, open, body, close) => {
    const si = pairOf(j++);
    if (si === undefined) return all;
    const m = map[si];
    const fixed = fixQuoteGender(body, m.gender);
    if (fixed !== body) fixes.push({ speaker: m.speaker, gender: m.gender, from: body, to: fixed });
    return open + fixed + close;
  });
}
function applySpeakerFixes(thaiText, map) {
  const out = { text: thaiText, fixes: [], aligned: false };
  if (!map?.length || !thaiText) return out;
  const dqMap = map.filter(m => m.kind !== 'sq'), sqMap = map.filter(m => m.kind === 'sq');
  const count = re => [...out.text.matchAll(re)].length;
  if (count(_TH_DQ_RE) === dqMap.length) {
    // จำนวนตรง → จับคู่ตามลำดับแบบแน่นอน
    out.aligned = true;
    out.text = _fixMatched(out.text, _TH_DQ_RE, j => j, dqMap, out.fixes);
    if (sqMap.length && count(_TH_SQ_RE) === sqMap.length) out.text = _fixMatched(out.text, _TH_SQ_RE, j => j, sqMap, out.fixes);
    return out;
  }
  if (map.every(m => typeof m.pos === 'number')) {
    const len = Math.max(1, out.text.length);
    const th = [...out.text.matchAll(_TH_ANY_RE)].map(x => ({ pos: x.index / len, len: x[2].length, b: x[2] }));
    const names = (S.currentWs?.glossary || []).filter(g => g.type === 'character' && g.korean && g.thai);
    const pairs = _alignByPosition(map, th, names);
    if (pairs.size) {
      out.aligned = 'partial';
      out.text = _fixMatched(out.text, _TH_ANY_RE, j => pairs.get(j), map, out.fixes);
    }
  }
  return out;
}

// gender ใช้ได้เฉพาะ type=character และต้องเป็นค่าที่รู้จัก — ใช้ร่วมกันทั้ง auto-glossary หลังแปลและแบบกดเอง
// คืน null ถ้าคำแปลไทยมีอักษรเกาหลี/จีน/ญี่ปุ่นปน (เช่น "เซ피อา") — ห้ามเข้าคลัง ไม่งั้นจะลามไปทุกตอน
function sanitizeGlossaryEntry(entry) {
  if (!entry || /[\u3131-\u318e\uac00-\ud7a3\u4e00-\u9fff\u3040-\u30ff]/.test(String(entry.thai || ''))) return null;
  if (entry.type !== 'character' || !['male', 'female', 'neutral'].includes(entry.gender)) delete entry.gender;
  return entry;
}

// ─── Auto Extract Glossary หลังแปลเสร็จ ───
// chapterInfo = { id, title, chapterNum } หรือ null ถ้าไม่รู้ตอน
async function autoExtractGlossaryAfterTranslation(sourceText, model, chapterInfo = null, translationText = '') {
  if (!S.currentWsId || !S.currentWs) return;
  if (!sourceText?.trim()) return;
  if (S.currentWs.settings?.autoGlossary === false) return;

  if (!Array.isArray(S.currentWs.glossary)) S.currentWs.glossary = [];

  // ตัวละครที่ยังไม่มีเพศ ไม่ใส่ในรายการ "ข้าม" → ให้ AI ดึงซ้ำเพื่อเติมเพศ (ด้านล่างจะเติมเฉพาะเพศ ไม่แก้คำแปลเดิม)
  const existing = S.currentWs.glossary
    .filter(g => !(g.type === 'character' && !['male', 'female', 'neutral'].includes(g.gender)))
    .map(g => g.korean).join(', ') || '(none)';

  // เพิ่ม snippet ของ Thai translation เพื่อช่วย AI detect gender จากสรรพนามไทย
  const thaiSnippet = translationText?.trim()
    ? `THAI TRANSLATION (use Thai pronouns เขา/เธอ/ผม/ฉัน etc. to help infer character gender):\n${translationText.slice(0, 3000)}`
    : '';

  const basePrompt = (() => { try { return agGetPrompt(); } catch { return AUTOGLOSSARY_PROMPT; } })();
  const prompt = basePrompt
    .replace('{existing}', existing)
    .replace('{text}', sourceText.slice(0, 8000))
    .replace('{thai_snippet}', thaiSnippet);

  try {
    const res = await callOpenRouter({
      model: model || document.getElementById('translateModel')?.value || 'google/gemini-2.5-flash',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.2,
      max_tokens: 6000,   // เดิม 1500 — โมเดลที่คิดก่อนตอบ (reasoning) ใช้หมดก่อนตอบ ได้ผลว่าง
    });

    const raw = (res.choices?.[0]?.message?.content || '').trim().replace(/```json|```/g, '').trim();
    let terms;
    try { terms = JSON.parse(raw); }
    catch { terms = tryRepairJson(raw) || []; }

    if (!Array.isArray(terms) || !terms.length) {
      showToast('📖 Auto Glossary: ไม่พบคำศัพท์ใหม่', '');
      return;
    }

    let added = 0, genderFilled = 0;
    terms.forEach(term => {
      if (!term.korean || !term.thai) return;
      const existingEntry = S.currentWs.glossary.find(g => g.korean === term.korean);
      if (existingEntry) {
        // เติมเพศให้ตัวละครเดิมที่ยังไม่มีเพศ
        if (existingEntry.type === 'character' && !['male', 'female', 'neutral'].includes(existingEntry.gender)
            && term.type === 'character' && ['male', 'female'].includes(term.gender)) {
          existingEntry.gender = term.gender; genderFilled++;
        }
        return;
      }
      // แนบ source chapter info ถ้ามี
      const entry = sanitizeGlossaryEntry({ ...term });
      if (!entry) return;
      if (chapterInfo?.title) {
        entry.sourceChapterId    = chapterInfo.id    || null;
        entry.sourceChapterTitle = chapterInfo.title;
        entry.sourceChapterNum   = chapterInfo.chapterNum || null;
      }
      S.currentWs.glossary.push(entry);
      added++;
    });

    if (added > 0 || genderFilled > 0) {
      S.glossaryData = S.currentWs.glossary;
      await lsSaveWorkspace(S.currentWs);
      if (S.currentTab === 'glossary') renderGlossaryTable();
      const chLabel = chapterInfo?.title ? ` (ตอน #${chapterInfo.chapterNum||'?'} ${chapterInfo.title.slice(0,20)})` : '';
      showToast(`📖 Auto Glossary: เพิ่ม ${added} คำใหม่${genderFilled ? ` · เติมเพศ ${genderFilled} ตัวละคร` : ''}${chLabel} ✓`, 'success');
    } else {
      showToast('📖 Auto Glossary: คำทั้งหมดมีในคลังแล้ว', '');
    }
  } catch (e) {
    showToast(`📖 Auto Glossary ล้มเหลว: ${e.message}`, 'error');
  }
}

async function translateAllStream(text) {
  setTranslating(true);
  clearTranslation();
  showProgress(true);
  setStage('split', 'done');
  setStage('glossary', 'active');
  await new Promise(r => setTimeout(r, 60));
  setStage('glossary', 'done');
  setStage('translate', 'active');

  const output = document.getElementById('translationOutput');
  output.innerHTML = '';

  const options = getOptions();
  const cacheKey = _mcKey(options.model, text);

  // ระบุผู้พูดก่อนแปล (ข้ามถ้าจะใช้ผลจาก Memory)
  let spMap = null;
  if (!(options.useMemory && _mcGet(cacheKey)) && speakerMapEnabled() && extractSourceQuotes(text).length && getApiKey()) {
    updateProgress(3, 'ระบุผู้พูดในบทสนทนา...');
    spMap = await buildSpeakerMap(text, options.model);
  }

  // Build prompt — whole text as one
  const glossaryStr = buildGlossaryStr(options.wsGlossary);
  const styleNote = options.customStylePrompt ? options.customStylePrompt : '';
  const storyCtx = ctxGetPromptText(S.currentWs);
  const prevCtx  = (storyCtx ? storyCtx + '\n\n' : '') + (options.prevChapterContext ? `${options.prevChapterContext}\n` : '');
  const preset = getActivePreset(S.currentWs);
  const mtlDraft = presetIsMtlFix(preset)
    ? (() => { const c = S.currentWs?.chapters?.find(ch => ch.id === S.editingChapterId); return c?.translation || ''; })()
    : '';
  const prompt = buildTranslatePrompt({
    sourceText: text,
    glossaryStr,
    contextStr: prevCtx,
    styleNote,
    ws: S.currentWs,
    mtlDraft,
    speakerMap: spMap,
  });

  const key = getApiKey();
  if (!key) { showToast('ยังไม่ได้ตั้ง API Key', 'error'); setTranslating(false); showProgress(false); return; }

  const doTranslate = async () => {
  output.innerHTML = '';
  const txtEl = document.createElement('div');
  txtEl.className = 'segment-text';
  txtEl.style.whiteSpace = 'pre-wrap';
  const cursor = document.createElement('span');
  cursor.className = 'stream-cursor';
  txtEl.appendChild(cursor);
  output.appendChild(txtEl);

  // Check memory
  if (options.useMemory && _mcGet(cacheKey)) {
    cursor.remove();
    txtEl.textContent = _mcGet(cacheKey);
    setStage('translate', 'done'); setStage('done', 'done');
    updateProgress(100, 'แปลเสร็จสิ้น ✓');
    document.getElementById('translationStats').textContent = 'โหลดจาก Memory ✓';
    showToast('แปลเสร็จสิ้น ✓ (Memory)', 'success');
    return;
  }

  let timer = null;
  try {
    let charCount = 0;
    S.abortCtrl = new AbortController();
    timer = startAbortTimer(S.abortCtrl, getTimeoutMs('full'));

    let inTok = 0, outTok = 0;
    let fullText = '';

    try {
      fullText = await aiStream(
        { model: options.model, temperature: preset.temperature ?? options.temperature, max_tokens: Math.max(4000, Math.ceil(text.length * 2)), messages: [{ role: 'user', content: prompt }] },
        (delta) => {
          charCount += delta.length;
          fullText += delta;
          if (cursor.parentNode === txtEl) txtEl.insertBefore(document.createTextNode(delta), cursor);
          else txtEl.appendChild(document.createTextNode(delta));
          const est = Math.min(95, Math.round(charCount / Math.max(text.length, 1) * 80));
          updateProgress(est, `กำลังแปล... ${charCount.toLocaleString()} ตัวอักษร`);
          if (output.scrollHeight - output.scrollTop - output.clientHeight < 160) output.scrollTop = output.scrollHeight;
        },
        (i, o) => { inTok = i; outTok = o; },
        S.abortCtrl.signal
      );
    } finally {
      clearTimeout(timer.id);
    }

    cursor.remove();
    if (inTok || outTok) addCosts(inTok, outTok, options.model);

    if (options.useMemory && fullText) _mcSet(cacheKey, fullText);

    // Optional polish
    if (options.usePolish && fullText) {
      setStage('polish', 'active');
      updateProgress(97, 'Polish...');
      const pp = POLISH_PROMPT.replace('{glossary}', glossaryStr).replace('{text}', fullText);
      try {
        const pr = await callOpenRouter({ model: options.model, messages: [{ role: 'user', content: pp }], temperature: 0.5, max_tokens: Math.max(4000, fullText.length * 2) });
        const polished = pr.choices?.[0]?.message?.content?.trim();
        if (polished) { fullText = polished; txtEl.textContent = polished; }
      } catch {}
      setStage('polish', 'done');
    }

    // แก้คำลงท้าย/คำแทนตัวที่ผิดเพศผู้พูด (ตามแผนที่ผู้พูด)
    const spFix = applySpeakerFixes(fullText, spMap);
    if (spFix.fixes.length) { fullText = spFix.text; txtEl.textContent = fullText; }

    setStage('translate', 'done');
    setStage('done', 'done');
    updateProgress(100, 'แปลเสร็จสิ้น ✓');
    document.getElementById('translationStats').textContent = `${fullText.length.toLocaleString()} ตัวอักษร`
      + (spFix.fixes.length ? ` · แก้ ครับ/ค่ะ ตามผู้พูด ${spFix.fixes.length} จุด` : '');
    showToast('แปลเสร็จสิ้น ✓', 'success');
    particleQuickCheck(fullText);
    // ดึง chapter info จาก chapter ที่กำลัง edit อยู่ (ถ้ามี)
    const _streamChInfo = S.editingChapterId
      ? (() => { const c = S.currentWs?.chapters?.find(ch => ch.id === S.editingChapterId); return c ? { id: c.id, title: c.title, chapterNum: c.chapterNum } : null; })()
      : null;
    autoExtractGlossaryAfterTranslation(text, options.model, _streamChInfo);
    // Context Memory: generate summary (non-blocking)
    if (_streamChInfo && fullText) {
      ctxAddSummary(S.currentWs, _streamChInfo.id, _streamChInfo.chapterNum, _streamChInfo.title, fullText)
        .catch(e => console.warn('[CTX]', e));
    }

  } catch (e) {
    cursor.remove();
    if (e.name === 'AbortError' && timer?.timedOut) {
      txtEl.textContent = `⏱ ${timeoutMessage(timer.ms)}`;
      updateProgress(0, 'หมดเวลา');
      showToast('⏱ ' + timeoutMessage(timer.ms), 'error');
    } else if (e.name === 'AbortError') {
      txtEl.textContent = '⬛ ถูกหยุดโดยผู้ใช้';
      updateProgress(0, 'หยุดแล้ว');
      showToast('⬛ หยุดการแปลแล้ว', '');
    } else {
      txtEl.textContent = `❌ ${e.message}`;
      showToast('Error: ' + e.message, 'error');
    }
  }
  }; // end doTranslate

  try {
    await doTranslate();
  } finally {
    setTranslating(false);
    setTimeout(() => showProgress(false), 4000);
  }
}

// ─── Chunk-based translation ───
function splitByChunkSize(text, size) {
  if (!size || size <= 0) return [text];
  const chunks = [];
  // Try to split at natural boundaries (newline) near the chunk boundary
  let pos = 0;
  while (pos < text.length) {
    let end = pos + size;
    if (end >= text.length) {
      chunks.push(text.slice(pos));
      break;
    }
    // Look for nearest newline within ±20% of chunk size to split cleanly
    const lookBack = Math.floor(size * 0.2);
    const nlPos = text.lastIndexOf('\n', end);
    if (nlPos > pos + size - lookBack) {
      end = nlPos + 1; // split after newline
    } else {
      // No good newline — try space
      const spPos = text.lastIndexOf(' ', end);
      if (spPos > pos + size - lookBack) end = spPos + 1;
    }
    chunks.push(text.slice(pos, end));
    pos = end;
  }
  return chunks.filter(c => c.trim());
}

// hash เบาๆ ไว้เช็คว่า source เดิมไหม (length + หัว/ท้าย 64 ตัวอักษร)
function _chunkSrcHash(text) {
  return text.length + ':' + text.slice(0, 64) + ':' + text.slice(-64);
}

// แบ่งแบบ smart: ตอนสั้น (≤ size) ไม่แบ่งเลย · ตอนยาวแบ่งที่ "ขอบย่อหน้า" ให้แต่ละก้อน ~size
// (ย่อหน้าเดี่ยวที่ยาวเกิน size จะ fallback ไปแบ่งด้วย splitByChunkSize)
function smartChunk(text, size) {
  if (!size || size <= 0 || !text || text.length <= size) return [text];
  const paras = text.split(/\n{2,}/);
  const chunks = [];
  let cur = '';
  const flush = () => { if (cur.trim()) chunks.push(cur); cur = ''; };
  for (const para of paras) {
    if (para.length > size) {                 // ย่อหน้ายักษ์ → ซอยย่อย
      flush();
      splitByChunkSize(para, size).forEach(c => chunks.push(c));
      continue;
    }
    if (cur && cur.length + 2 + para.length > size) flush();
    cur = cur ? cur + '\n\n' + para : para;
  }
  flush();
  return chunks.length ? chunks : [text];
}

// เลือกวิธีแบ่ง chunk ตามโหมด — ใช้กับ batch (off=ทั้งตอน, smart=แบ่งเฉพาะตอนยาว, fixed=แบ่งทุกตอน)
function getBatchChunks(text, mode, size) {
  if (!text) return [text];
  if (mode === 'fixed') return splitByChunkSize(text, size);
  if (mode === 'smart') return smartChunk(text, size);
  return [text];
}

async function translateChunked(text, options) {
  setTranslating(true);
  clearTranslation();
  showProgress(true);
  setStage('glossary', 'active');
  await new Promise(r => setTimeout(r, 60));
  setStage('glossary', 'done');
  setStage('translate', 'active');

  const output = document.getElementById('translationOutput');
  output.innerHTML = '';

  const chunks = splitByChunkSize(text, options.chunkSize);
  const n = chunks.length;

  const styleNote = options.customStylePrompt ? `STYLE GUIDE:\n${options.customStylePrompt}\n` : '';
  const key = getApiKey();
  if (!key) { showToast('ยังไม่ได้ตั้ง API Key', 'error'); setTranslating(false); showProgress(false); return; }

  let completedTranslations = [];
  let startIdx = 0;

  // ── Resume งานแปลค้าง: chapter เดิม + source/chunkSize ตรงกัน → แปลต่อจาก chunk ล่าสุด ──
  const _srcHash = _chunkSrcHash(text);
  if (S.editingChapterId && S.currentWs) {
    const _rCh = S.currentWs.chapters?.find(ch => ch.id === S.editingChapterId);
    const cp = _rCh?.chunkProgress;
    if (cp && cp.srcHash === _srcHash && cp.chunkSize === options.chunkSize
        && Array.isArray(cp.chunks) && cp.chunks.length > 0 && cp.chunks.length < n) {
      if (confirm(`พบงานแปลค้างไว้ ${cp.chunks.length}/${n} chunk — แปลต่อจากเดิมเลยไหม?\n(ยกเลิก = เริ่มแปลใหม่ทั้งหมด)`)) {
        completedTranslations = [...cp.chunks];
        startIdx = cp.chunks.length;
      }
    }
  }

  showToast(startIdx > 0
    ? `แปลต่อจาก chunk ${startIdx + 1}/${n} (${options.chunkSize} ตัวอักษร/chunk)`
    : `แบ่งเป็น ${n} chunk (${options.chunkSize} ตัวอักษร/chunk)`, '');

  // แสดง chunk ที่เสร็จค้างไว้แล้ว
  for (let i = 0; i < startIdx; i++) {
    const wrapEl = document.createElement('div');
    wrapEl.className = 'translation-segment';
    wrapEl.innerHTML = `<div class="segment-index"><span>chunk ${i + 1}/${n}</span><span class="seg-status cached">📦 ค้างไว้</span></div>`;
    const txtEl = document.createElement('div');
    txtEl.className = 'segment-text';
    txtEl.style.whiteSpace = 'pre-wrap';
    txtEl.textContent = completedTranslations[i];
    wrapEl.appendChild(txtEl);
    output.appendChild(wrapEl);
  }

  // บันทึกความคืบหน้าเข้า chapter ทันที (กัน data loss) + chunkProgress สำหรับ resume — ลบทิ้งเมื่อแปลครบ
  const savePartial = () => {
    if (!S.editingChapterId || !S.currentWs) return;
    const _pCh = S.currentWs.chapters?.find(ch => ch.id === S.editingChapterId);
    if (!_pCh || !completedTranslations.length) return; // ยังไม่มี chunk ไหนเสร็จ → ไม่ทับคำแปลเดิมของตอน
    const doneAll = completedTranslations.length >= n;
    _pCh.translation = completedTranslations.join('\n\n');
    _pCh.status = doneAll ? 'translated' : 'partial';
    if (doneAll) delete _pCh.chunkProgress;
    else _pCh.chunkProgress = { chunkSize: options.chunkSize, srcHash: _srcHash, chunks: [...completedTranslations], updatedAt: Date.now() };
    _pCh.updatedAt = Date.now();
    lsSaveWorkspace(S.currentWs).catch(() => {});
  };

  let stopped = false;     // ผู้ใช้กดหยุด
  let failedAt = -1;       // chunk ที่ error/timeout (หยุดไว้ให้ resume ต่อจากจุดนี้)
  let failMsg = '';

  try {
    for (let i = startIdx; i < n; i++) {
      const chunk = chunks[i];
      updateProgress(Math.round(i / n * 100), `chunk ${i+1}/${n} (${chunk.length} ตัวอักษร)`);

      // Smart Glossary: กรองเฉพาะคำที่ปรากฏใน chunk นี้ (ลด token)
      const smartGloss = getSmartGlossary(chunk, S.glossaryData);
      const smartGlossObj = smartGloss.reduce((acc, g) => { acc[g.korean] = { thai: g.thai, type: g.type, note: g.note, gender: g.gender }; return acc; }, {});
      const glossaryStr = buildGlossaryStr(smartGlossObj);

      // Build DOM for this chunk
      const wrapEl = document.createElement('div');
      wrapEl.className = 'translation-segment';

      const idxEl = document.createElement('div');
      idxEl.className = 'segment-index';
      idxEl.innerHTML = `<span>chunk ${i+1}/${n}</span><span class="seg-status active">⚡ กำลังแปล</span>`;

      const txtEl = document.createElement('div');
      txtEl.className = 'segment-text';
      txtEl.style.whiteSpace = 'pre-wrap';

      const cursor = document.createElement('span');
      cursor.className = 'stream-cursor';
      txtEl.appendChild(cursor);

      wrapEl.appendChild(idxEl);
      wrapEl.appendChild(txtEl);
      output.appendChild(wrapEl);
      wrapEl.scrollIntoView({ block: 'nearest', behavior: 'smooth' });

      const badge = idxEl.querySelector('.seg-status');

      // Check memory cache
      const cacheKey = _mcKey(options.model, chunk);
      if (options.useMemory && _mcGet(cacheKey)) {
        cursor.remove();
        txtEl.textContent = _mcGet(cacheKey);
        completedTranslations.push(txtEl.textContent);
        badge.className = 'seg-status cached';
        badge.innerHTML = '📦 Memory';
        updateProgress(Math.round((i+1)/n*100), `chunk ${i+1}/${n} เสร็จ`);
        savePartial();
        continue;
      }

      // Build context from tail of previous translation only (ลด token)
      const prevTail = completedTranslations.length
        ? completedTranslations[completedTranslations.length - 1].slice(-getPrevCtxChars())
        : '';
      const chunkCtx = prevTail ? `CONTEXT (ท้ายของ chunk ก่อนหน้า):\n${prevTail}\n` : '';
      const _baseCtx = (options.prevChapterContext && !completedTranslations.length)
        ? options.prevChapterContext + '\n' + chunkCtx
        : chunkCtx;
      // Inject story context on first chunk only (ประหยัด token)
      const _storyCtx = !completedTranslations.length ? ctxGetPromptText(S.currentWs) : '';
      const ctxStr = (_storyCtx ? _storyCtx + '\n\n' : '') + _baseCtx;

      const chunkPreset = getActivePreset(S.currentWs);
      let spMap = null;
      if (speakerMapEnabled() && extractSourceQuotes(chunk).length) {
        badge.textContent = '🗣 ระบุผู้พูด';
        spMap = await buildSpeakerMap(chunk, options.model);
        badge.textContent = '⚡ กำลังแปล';
      }
      const prompt = buildTranslatePrompt({
        sourceText: chunk,
        glossaryStr,
        contextStr: ctxStr,
        styleNote: options.customStylePrompt || '',
        ws: S.currentWs,
        speakerMap: spMap,
      });

      let chunkFull = '';
      let inTok = 0, outTok = 0;
      let timer = null;

      try {
        // ใช้ global abort + timeout (แยกได้ว่าหมดเวลาหรือผู้ใช้กดหยุด)
        S.abortCtrl = new AbortController();
        timer = startAbortTimer(S.abortCtrl, getTimeoutMs('chunk'));
        try {
          chunkFull = await aiStream(
            { model: options.model, temperature: chunkPreset.temperature ?? options.temperature, max_tokens: Math.max(2000, Math.ceil(chunk.length * 2)), messages: [{ role: 'user', content: prompt }] },
            (delta) => {
              chunkFull += delta;
              if (cursor.parentNode === txtEl) txtEl.insertBefore(document.createTextNode(delta), cursor);
              else txtEl.appendChild(document.createTextNode(delta));
              if (output.scrollHeight - output.scrollTop - output.clientHeight < 160) output.scrollTop = output.scrollHeight;
            },
            (i, o) => { inTok = i; outTok = o; },
            S.abortCtrl.signal
          );
        } finally { clearTimeout(timer.id); }

        cursor.remove();
        if (inTok || outTok) addCosts(inTok, outTok, options.model);

        if (options.useMemory && chunkFull) _mcSet(cacheKey, chunkFull);
        completedTranslations.push(chunkFull);

        // Polish pass
        if (options.usePolish && chunkFull) {
          badge.className = 'seg-status active';
          badge.textContent = '✨ Polish';
          const pp = POLISH_PROMPT.replace('{glossary}', glossaryStr).replace('{text}', chunkFull);
          try {
            const pr = await callOpenRouter({ model: options.model, messages: [{ role: 'user', content: pp }], temperature: 0.5, max_tokens: Math.max(2000, Math.ceil(chunkFull.length * 1.2)) });
            const polished = pr.choices?.[0]?.message?.content?.trim();
            if (polished) { chunkFull = polished; txtEl.textContent = polished; completedTranslations[completedTranslations.length-1] = polished; }
          } catch {}
        }

        // แก้คำลงท้าย/คำแทนตัวที่ผิดเพศผู้พูด (ตามแผนที่ผู้พูดของ chunk นี้)
        const spFix = applySpeakerFixes(chunkFull, spMap);
        if (spFix.fixes.length) { chunkFull = spFix.text; txtEl.textContent = chunkFull; completedTranslations[completedTranslations.length-1] = chunkFull; }

        badge.className = 'seg-status done';
        badge.textContent = `✓ ${chunkFull.length} ตัวอักษร`;
        updateProgress(Math.round((i+1)/n*100), `chunk ${i+1}/${n} เสร็จ`);

        savePartial();

      } catch (err) {
        cursor.remove();
        badge.className = 'seg-status error';
        // ผู้ใช้กดหยุด → ออกจาก loop ทันที
        if (err.name === 'AbortError' && !timer?.timedOut) {
          badge.textContent = '⬛ หยุดแล้ว';
          txtEl.textContent = '⬛ ถูกหยุดโดยผู้ใช้';
          updateProgress(Math.round(i / n * 100), `หยุดที่ chunk ${i+1}/${n}`);
          stopped = true;
          break;
        }
        // error / หมดเวลา → หยุดที่ chunk นี้ (ไม่ข้าม — กันคำแปลขาดหายแต่ขึ้นว่าแปลเสร็จ)
        failMsg = (err.name === 'AbortError') ? timeoutMessage(timer.ms) : err.message;
        badge.textContent = err.name === 'AbortError' ? '⏱ หมดเวลา' : '✗ Error';
        txtEl.textContent = `❌ ${failMsg}`;
        updateProgress(Math.round(i / n * 100), `chunk ${i+1}/${n} ล้มเหลว`);
        failedAt = i;
        break;
      }
    }

    if (stopped || failedAt >= 0) {
      savePartial();
      setStage('translate', 'error');
      const doneCnt = completedTranslations.length;
      document.getElementById('translationStats').textContent = `แปลแล้ว ${doneCnt}/${n} chunks`;
      if (stopped) showToast(`⬛ หยุดแล้ว — แปลแล้ว ${doneCnt}/${n} chunk (กดแปลอีกครั้งเพื่อแปลต่อ)`, '');
      else showToast(`chunk ${failedAt + 1}/${n} ล้มเหลว: ${failMsg} — กดแปลอีกครั้งเพื่อแปลต่อ`, 'error');
      return;
    }

    setStage('translate', 'done');
    if (options.usePolish) setStage('polish', 'done');
    setStage('done', 'done');
    updateProgress(100, 'แปลเสร็จสิ้น ✓');
    const totalChars = completedTranslations.join('').length;
    document.getElementById('translationStats').textContent = `แปลเสร็จ ${n} chunks · ${totalChars.toLocaleString()} ตัวอักษร`;
    showToast(`แปลเสร็จ ${n} chunks ✓`, 'success');
    particleQuickCheck(completedTranslations.join('\n\n'));

    // ── Auto Extract Glossary ──
    const _chunkChInfo = S.editingChapterId
      ? (() => { const c = S.currentWs?.chapters?.find(ch => ch.id === S.editingChapterId); return c ? { id: c.id, title: c.title, chapterNum: c.chapterNum } : null; })()
      : null;
    const _fullTranslation = completedTranslations.join('\n\n');
    autoExtractGlossaryAfterTranslation(text, options.model, _chunkChInfo, _fullTranslation);
    // Context Memory: generate summary (non-blocking)
    if (_chunkChInfo && _fullTranslation) {
      ctxAddSummary(S.currentWs, _chunkChInfo.id, _chunkChInfo.chapterNum, _chunkChInfo.title, _fullTranslation)
        .catch(e => console.warn('[CTX]', e));
    }

  } catch (e) {
    showToast('Error: ' + e.message, 'error');
  } finally {
    setTranslating(false);
    setTimeout(() => showProgress(false), 4000);
  }
}


// ─── QA Check ───
async function runQACheck() {
  const source = document.getElementById('sourceText').value.trim();
  const translation = document.getElementById('translationOutput').innerText.trim();
  if (!source || !translation || translation === 'คำแปลจะปรากฏที่นี่...') {
    showToast('ต้องมีทั้งต้นฉบับและคำแปลก่อน', 'error'); return;
  }
  showToast('กำลังตรวจ QA...', '');
  try {
    const glossaryStr = buildGlossaryStr(getOptions().wsGlossary);
    const prompt = QA_PROMPT
      .replace('{glossary}', glossaryStr)
      .replace('{source}', source)
      .replace('{translation}', translation);
    const res = await callOpenRouter({ model: document.getElementById('translateModel').value, messages: [{ role: 'user', content: prompt }], temperature: 0.1, max_tokens: 1000 });
    const txt = res.choices?.[0]?.message?.content?.trim() || '{}';
    const r = JSON.parse(txt.replace(/```json|```/g, '').trim());
    const msg = r.pass ? `✓ PASS (${r.score}/100): ${r.summary}` : `✗ FAIL (${r.score}/100): ${r.summary}`;
    showToast(msg, r.pass ? 'success' : 'error');
  } catch (e) { showToast('QA ล้มเหลว: ' + e.message, 'error'); }
}

// ─── Glossary Detection ───
function detectGlossary() {
  const text = document.getElementById('sourceText').value.trim();
  if (!text) { showToast('ใส่ข้อความก่อน', 'error'); return; }
  const glossary = S.currentWs?.glossary || [];
  if (!glossary.length) { showToast('ยังไม่มีคลังศัพท์', ''); return; }

  let highlighted = esc(text);
  let matchCount = 0;
  glossary.forEach(g => {
    const escaped = g.korean.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(escaped, 'g');
    if (regex.test(highlighted)) {
      matchCount++;
      highlighted = highlighted.replace(new RegExp(escaped, 'g'), `<mark class="glossary-term" title="${esc(g.thai)}">${esc(g.korean)}</mark>`);
    }
  });

  if (!matchCount) { showToast('ไม่พบคำศัพท์ในคลัง', ''); return; }
  const hl = document.getElementById('sourceHighlight');
  hl.innerHTML = highlighted;
  hl.style.display = 'block';
  document.getElementById('sourceText').style.display = 'none';
  showToast(`พบ ${matchCount} คำศัพท์ (แตะเพื่อซ่อน)`, 'success');
}

function hideHighlight() {
  document.getElementById('sourceHighlight').style.display = 'none';
  document.getElementById('sourceText').style.display = 'block';
}

// ─── API Key Settings (ต่อ provider) ───
function openApiSettings() {
  const c = document.getElementById('apiKeysContainer');
  const active = getProvider();
  c.innerHTML = Object.entries(PROVIDERS).map(([id, p]) => `
    <div class="sf-group" style="border-bottom:1px solid var(--border);padding-bottom:10px;margin-bottom:10px">
      <div class="sf-label">${p.label}${id === active ? ' <span style="color:var(--gold);font-size:0.68rem">← ใช้อยู่</span>' : ''}</div>
      <input id="apiKey-${id}" type="password" class="text-input" placeholder="${p.keyPlaceholder}"/>
      <div style="display:flex;align-items:center;gap:10px;margin-top:4px;flex-wrap:wrap">
        <button class="btn-xs" onclick="testApiKey('${id}')">▶ ทดสอบ</button>
        <span id="apiTestResult-${id}" style="font-size:0.72rem;color:var(--text-muted)">${p.keyHint}</span>
      </div>
    </div>`).join('');
  c.innerHTML += `
    <div class="sf-group" style="margin-top:4px">
      <div class="sf-label">⏱ Timeout การเรียก AI (วินาที)</div>
      <div style="display:flex;align-items:center;gap:8px">
        <input id="apiTimeoutSec" type="number" class="text-input" style="width:90px" min="20" max="900" step="10"/>
        <span style="font-size:0.72rem;color:var(--text-muted)">default 120 — โมเดลช้า/ตอนยาวให้เพิ่ม (ทั้งตอนได้เวลา 1.5 เท่า)</span>
      </div>
    </div>`;
  // เติมค่า key เดิมผ่าน .value (เลี่ยงปัญหา escape ใน attribute)
  for (const [id, p] of Object.entries(PROVIDERS)) {
    const el = document.getElementById('apiKey-' + id);
    if (el) el.value = localStorage.getItem(p.lsKey) || '';
  }
  document.getElementById('apiTimeoutSec').value = parseInt(localStorage.getItem('nt8_timeout_s')) || 120;
  openModal('modal-settings');
}

function saveApiKey() {
  let saved = 0;
  for (const [id, p] of Object.entries(PROVIDERS)) {
    const el = document.getElementById('apiKey-' + id);
    if (!el) continue;
    const v = el.value.trim();
    if (v) { localStorage.setItem(p.lsKey, v); saved++; }
    else localStorage.removeItem(p.lsKey);
  }
  const tSec = Math.max(20, Math.min(900, parseInt(document.getElementById('apiTimeoutSec')?.value) || 120));
  localStorage.setItem('nt8_timeout_s', String(tSec));
  closeModal('modal-settings');
  checkHealth();
  renderProviderUI();
  showToast(`บันทึก API Key แล้ว ✓ (${saved} provider)`, 'success');
}

async function testApiKey(provId) {
  const p = PROVIDERS[provId];
  if (!p) return;
  const key = document.getElementById('apiKey-' + provId)?.value.trim();
  const result = document.getElementById('apiTestResult-' + provId);
  if (!key) { result.textContent = '⚠ ใส่ key ก่อน'; result.style.color = 'var(--gold)'; return; }
  result.textContent = 'กำลังทดสอบ...'; result.style.color = 'var(--text-muted)';
  try {
    const t = p.testEndpoint(key);
    const res = await fetch(t.url, { headers: t.headers });
    if (res.ok) { result.textContent = '✓ Key ใช้งานได้'; result.style.color = '#4caf50'; }
    else { result.textContent = `✗ Key ไม่ถูกต้อง (HTTP ${res.status})`; result.style.color = 'var(--crimson-light)'; }
  } catch { result.textContent = '✗ ทดสอบไม่สำเร็จ (เครือข่าย/CORS)'; result.style.color = 'var(--crimson-light)'; }
}

// ─── Cost Tracker ───
function resetCosts() {
  S.costs = { tokens: { total:0, input:0, output:0 }, costUSD:0, costTHB:0 };
  localStorage.setItem(LS_KEY_COSTS, JSON.stringify(S.costs));
  updateCostUI();
  showToast('รีเซ็ตต้นทุนแล้ว', '');
}

// ─── Progress UI ───
function showProgress(show) {
  document.getElementById('progressContainer').style.display = show ? 'block' : 'none';
  if (show) { ['glossary','translate','polish','done'].forEach(s => setStage(s,'')); updateProgress(0,'กำลังเริ่ม...'); }
}
function updateProgress(pct, label) {
  document.getElementById('progressFill').style.width = pct + '%';
  document.getElementById('progressPct').textContent = pct + '%';
  if (label) document.getElementById('progressLabel').textContent = label;
}
function setStage(stage, status) {
  const el = document.getElementById(`stage-${stage}`);
  if (el) el.className = 'stage' + (status ? ' ' + status : '');
}

// ─── Auto Glossary ───
let _agTerms = [];
let _agTab = 'manual';

function agSwitchTab(tab) {
  _agTab = tab;
  document.getElementById('agPanelManual').style.display = tab === 'manual' ? 'block' : 'none';
  document.getElementById('agPanelChapters').style.display = tab === 'chapters' ? 'block' : 'none';
  const btnManual = document.getElementById('agTabManual');
  const btnChapters = document.getElementById('agTabChapters');
  btnManual.style.borderBottom = tab === 'manual' ? '2px solid var(--gold)' : 'none';
  btnManual.style.color = tab === 'manual' ? 'var(--gold)' : '';
  btnManual.className = tab === 'manual' ? 'btn btn-secondary btn-sm' : 'btn btn-ghost btn-sm';
  btnChapters.style.borderBottom = tab === 'chapters' ? '2px solid var(--gold)' : 'none';
  btnChapters.style.color = tab === 'chapters' ? 'var(--gold)' : '';
  btnChapters.className = tab === 'chapters' ? 'btn btn-secondary btn-sm' : 'btn btn-ghost btn-sm';
}

function agRenderChapterList() {
  const list = document.getElementById('agChapterList');
  const chapters = [...(S.currentWs?.chapters || [])].sort((a,b) => (a.chapterNum||0)-(b.chapterNum||0));
  if (!chapters.length) { list.innerHTML = '<div style="font-size:0.78rem;color:var(--text-muted);padding:6px">ยังไม่มีตอน</div>'; return; }
  list.innerHTML = chapters.map(ch => `
    <label class="ag-ch-row" style="display:flex;align-items:center;gap:8px;padding:5px 6px;border-radius:4px;cursor:pointer">
      <input type="checkbox" class="ag-ch-chk" data-id="${ch.id}" style="accent-color:var(--gold)" onchange="agUpdateChaptersInfo()"/>
      <span style="font-size:0.78rem;color:var(--text-muted);min-width:28px">#${ch.chapterNum||'?'}</span>
      <span style="font-size:0.82rem;color:var(--text-primary);flex:1">${esc(ch.title)}</span>
      <span style="font-size:0.68rem;color:var(--text-muted)">${ch.sourceText ? ch.sourceText.length.toLocaleString()+' ตัวอักษร' : 'ไม่มีต้นฉบับ'}</span>
    </label>
  `).join('');
}

function agUpdateChaptersInfo() {
  const checked = document.querySelectorAll('.ag-ch-chk:checked');
  const total = [...checked].reduce((s, el) => {
    const ch = S.currentWs?.chapters.find(c => c.id === el.dataset.id);
    return s + (ch?.sourceText?.length || 0);
  }, 0);
  document.getElementById('agChaptersInfo').textContent = checked.length ? `เลือก ${checked.length} ตอน · ${total.toLocaleString()} ตัวอักษรรวม` : '';
}

function agSelectAllChapters() {
  document.querySelectorAll('.ag-ch-chk').forEach(el => el.checked = true);
  agUpdateChaptersInfo();
}
function agDeselectAllChapters() {
  document.querySelectorAll('.ag-ch-chk').forEach(el => el.checked = false);
  agUpdateChaptersInfo();
}

function openAutoGlossary() {
  const src = document.getElementById('sourceText')?.value?.trim() || '';
  document.getElementById('agSourceText').value = src;
  document.getElementById('agResults').style.display = 'none';
  document.getElementById('agStatus').textContent = '';
  _agTerms = [];
  _agTab = 'manual';
  agSwitchTab('manual');
  agRenderChapterList();
  renderModelSelect(document.getElementById('agModel'), getProvider(), document.getElementById('translateModel')?.value, false);
  openModal('modal-autoglossary');
}



function renderAgResults(terms) {
  const list = document.getElementById('agResultList');
  list.innerHTML = terms.map((t, i) => `
    <div class="ag-item selected" id="ag-item-${i}" onclick="toggleAgItem(${i})">
      <input class="ag-check" type="checkbox" id="ag-chk-${i}" checked onclick="event.stopPropagation();syncAgItem(${i})"/>
      <span class="ag-korean">${esc(t.korean)}</span>
      <span class="ag-arrow">→</span>
      <input class="ag-thai-input" id="ag-thai-${i}" value="${esc(t.thai)}" onclick="event.stopPropagation()" title="แก้ไขคำแปล"/>
      <span class="ag-type-badge"><span class="tag tag-${t.type || 'term'}">${t.type || 'term'}</span></span>
      ${t.type === 'character' ? `<select class="select-input" id="ag-gender-${i}" onclick="event.stopPropagation()" title="เพศ (ใช้คุมสรรพนาม/ครับ-ค่ะ)" style="width:auto;font-size:0.72rem;padding:2px 4px">
        <option value=""${!['male','female','neutral'].includes(t.gender) ? ' selected' : ''}>เพศ?</option>
        <option value="male"${t.gender === 'male' ? ' selected' : ''}>ชาย</option>
        <option value="female"${t.gender === 'female' ? ' selected' : ''}>หญิง</option>
        <option value="neutral"${t.gender === 'neutral' ? ' selected' : ''}>กลาง</option>
      </select>` : ''}
      <span class="ag-note">${esc(t.note || '')}</span>
    </div>
  `).join('');
}

function toggleAgItem(i) {
  const chk = document.getElementById(`ag-chk-${i}`);
  const item = document.getElementById(`ag-item-${i}`);
  chk.checked = !chk.checked;
  item.classList.toggle('selected', chk.checked);
}
function syncAgItem(i) {
  const chk = document.getElementById(`ag-chk-${i}`);
  document.getElementById(`ag-item-${i}`).classList.toggle('selected', chk.checked);
}
function selectAllAg() { _agTerms.forEach((_, i) => { document.getElementById(`ag-chk-${i}`).checked = true; document.getElementById(`ag-item-${i}`).classList.add('selected'); }); }
function deselectAllAg() { _agTerms.forEach((_, i) => { document.getElementById(`ag-chk-${i}`).checked = false; document.getElementById(`ag-item-${i}`).classList.remove('selected'); }); }



// ─── Find & Replace (v2) ───
let _frMatches = [];
let _frMatchIdx = -1;
let _frHighlightNodes = [];
let _frHistory = (() => { try { return JSON.parse(sessionStorage.getItem('fr_history') || '[]'); } catch { return []; } })();

// ─── Translation Context Memory ───
const CTX_SUMMARY_PROMPT = `วิเคราะห์และสรุปบทนี้สำหรับใช้เป็น context ในการแปลตอนถัดไป โดยระบุ:
1. ตัวละครที่ปรากฏ: ชื่อ, เพศ, สรรพนามที่ใช้แทนตัว (ผม/ฉัน/เรา/กู ฯลฯ)
2. เหตุการณ์สำคัญ (2-3 ประโยค)
3. อารมณ์/บรรยากาศท้ายตอน

ตอบเป็นภาษาไทย กระชับ ไม่เกิน 120 คำ`;

const CTX_COMPRESS_PROMPT = `รวม context summaries เหล่านี้ให้เป็น summary เดียว ไม่เกิน 180 คำ คงไว้ซึ่งชื่อตัวละคร เพศ สรรพนาม และเหตุการณ์สำคัญที่ยังส่งผลต่อเรื่อง:`;

function wsGetContext(ws) {
  if (!ws) return null;
  if (!ws.translationContext) {
    ws.translationContext = { enabled: false, maxTokens: 1500, summaries: [] };
  }
  return ws.translationContext;
}

function ctxEstimateTokens(text) {
  return Math.ceil((text || '').length / 3); // Thai ~3 chars/token
}

function ctxGetTotalTokens(ws) {
  const ctx = wsGetContext(ws);
  return ctx ? ctx.summaries.reduce((s, x) => s + (x.tokens || 0), 0) : 0;
}

function ctxGetPromptText(ws) {
  const ctx = wsGetContext(ws);
  if (!ctx || !ctx.enabled || !ctx.summaries.length) return '';
  const parts = ctx.summaries.map(s => {
    const label = s.compressed ? `📚 ${s.title}` : `ตอน ${s.chapterNum}${s.title ? ': ' + s.title : ''}`;
    return `[${label}]\n${s.text}`;
  });
  return `### บริบทเรื่องที่ผ่านมา (ใช้เพื่อความสอดคล้องในการแปล — ห้ามแปลส่วนนี้)\n${parts.join('\n\n')}`;
}

async function ctxAddSummary(ws, chId, chapterNum, title, translatedText) {
  const ctx = wsGetContext(ws);
  if (!ctx || !ctx.enabled || !translatedText?.trim()) return;

  const summary = await ctxGenerateSummary(translatedText, ws);
  if (!summary) return;
  await ctxAddSummaryText(ws, chId, chapterNum, title, summary);
}

// เพิ่ม summary ที่สรุปมาแล้ว (ไม่เรียก AI ซ้ำ) — ใช้โดย batch ซึ่งสรุปตอนไว้เพื่อ prev-context อยู่แล้ว
async function ctxAddSummaryText(ws, chId, chapterNum, title, summary) {
  const ctx = wsGetContext(ws);
  if (!ctx || !ctx.enabled || !summary?.trim()) return;

  // Remove old entry for same chapter
  ctx.summaries = ctx.summaries.filter(s => s.chId !== chId);
  ctx.summaries.push({
    chId, chapterNum: chapterNum || 0, title: title || '',
    text: summary, tokens: ctxEstimateTokens(summary),
    compressed: false, createdAt: Date.now()
  });
  ctx.summaries.sort((a, b) => (a.chapterNum || 0) - (b.chapterNum || 0));

  await ctxMaybeCompress(ws);
  await lsSaveWorkspace(ws);
  ctxUpdateStatusBadge(ws);

  // Refresh modal if open
  if (document.getElementById('modal-ctx-manager')?.style.display !== 'none') ctxRenderSummaries();
}

async function ctxGenerateSummary(translatedText, ws) {
  const ctx = wsGetContext(ws);
  try {
    const res = await callOpenRouter({
      model: 'google/gemini-2.5-flash-lite',
      messages: [{ role: 'user', content: `${CTX_SUMMARY_PROMPT}\n\n---\n${translatedText.slice(0, 4000)}` }],
      temperature: 0.3, max_tokens: 350,
    });
    return res.choices?.[0]?.message?.content?.trim() || null;
  } catch(e) {
    console.warn('[CTX] summary failed:', e);
    return null;
  }
}

async function ctxMaybeCompress(ws) {
  const ctx = wsGetContext(ws);
  if (!ctx) return;
  const total = ctxGetTotalTokens(ws);
  if (total <= ctx.maxTokens) return;
  if (ctx.summaries.length <= 2) { ctx.summaries.shift(); return; }

  const toCompress = ctx.summaries.slice(0, -2);
  const toKeep     = ctx.summaries.slice(-2);
  const combined   = toCompress.map(s => `[${s.compressed ? s.title : 'ตอน ' + s.chapterNum}]:\n${s.text}`).join('\n\n');

  try {
    const res = await callOpenRouter({
      model: 'google/gemini-2.5-flash-lite',
      messages: [{ role: 'user', content: `${CTX_COMPRESS_PROMPT}\n\n${combined}` }],
      temperature: 0.3, max_tokens: 500,
    });
    const compressed = res.choices?.[0]?.message?.content?.trim();
    if (compressed) {
      const first = toCompress[0], last = toCompress[toCompress.length - 1];
      ctx.summaries = [{
        chId: `compressed_${Date.now()}`,
        chapterNum: first.chapterNum,
        title: `สรุปรวม ตอน ${first.chapterNum}–${last.chapterNum}`,
        text: compressed, tokens: ctxEstimateTokens(compressed),
        compressed: true, createdAt: Date.now()
      }, ...toKeep];
      showToast('🧠 Context compressed อัตโนมัติ', 'info', 2500);
    }
  } catch(e) {
    console.warn('[CTX] compress failed:', e);
    ctx.summaries.shift(); // fallback: drop oldest
  }
}

// ── Context Manager UI ──
function openContextManager() {
  const ws = S.currentWs;
  if (!ws) { showToast('เปิด Workspace ก่อน', 'error'); return; }
  ctxRenderSummaries();
  openModal('modal-ctx-manager');
}

function ctxRenderSummaries() {
  const ws  = S.currentWs;
  const ctx = wsGetContext(ws);
  const list    = document.getElementById('ctxSummaryList');
  const totalEl = document.getElementById('ctxTokenTotal');
  const barEl   = document.getElementById('ctxTokenBar');
  if (!ctx || !list) return;

  const total = ctxGetTotalTokens(ws);
  const pct   = Math.min(100, Math.round((total / (ctx.maxTokens || 1500)) * 100));
  if (totalEl) totalEl.textContent = `${total} / ${ctx.maxTokens} tokens (${pct}%)`;
  if (barEl) {
    barEl.style.width = pct + '%';
    barEl.style.background = pct > 85 ? 'var(--crimson)' : pct > 60 ? 'var(--gold)' : 'var(--accent)';
  }

  if (!ctx.summaries.length) {
    list.innerHTML = `<div style="text-align:center;color:var(--text-muted);padding:28px;font-size:0.83rem">
      ยังไม่มี context summary<br>
      <span style="font-size:0.75rem">จะถูกสร้างอัตโนมัติหลังแปลแต่ละตอน (เมื่อเปิดใช้งาน)</span>
    </div>`;
    return;
  }

  list.innerHTML = ctx.summaries.map((s, idx) => `
    <div style="background:var(--surface-1);border:1px solid var(--border);border-radius:var(--radius);padding:10px 12px;margin-bottom:8px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
        <div style="font-size:0.78rem;font-weight:600;color:var(--text-primary)">
          ${s.compressed ? '📚 ' + s.title : '📄 ตอน ' + s.chapterNum + (s.title ? ': ' + s.title : '')}
        </div>
        <div style="display:flex;align-items:center;gap:6px">
          <span style="font-size:0.68rem;color:var(--text-muted)">${s.tokens || 0} tokens</span>
          <button class="btn-xs" onclick="ctxDeleteSummary(${idx})" style="color:var(--crimson-light)" title="ลบ">🗑</button>
        </div>
      </div>
      <textarea
        style="width:100%;box-sizing:border-box;background:var(--bg-deep);border:1px solid var(--border);
               border-radius:4px;padding:6px 8px;font-size:0.78rem;line-height:1.7;color:var(--text-secondary);
               resize:vertical;min-height:70px;font-family:inherit"
        onchange="ctxUpdateSummary(${idx}, this.value)">${escHtml(s.text)}</textarea>
    </div>
  `).join('');
}

function ctxUpdateSummary(idx, newText) {
  const ctx = wsGetContext(S.currentWs);
  if (!ctx?.summaries[idx]) return;
  ctx.summaries[idx].text   = newText;
  ctx.summaries[idx].tokens = ctxEstimateTokens(newText);
  // Refresh token bar only
  const total = ctxGetTotalTokens(S.currentWs);
  const pct   = Math.min(100, Math.round((total / (ctx.maxTokens || 1500)) * 100));
  const totalEl = document.getElementById('ctxTokenTotal');
  const barEl   = document.getElementById('ctxTokenBar');
  if (totalEl) totalEl.textContent = `${total} / ${ctx.maxTokens} tokens (${pct}%)`;
  if (barEl) barEl.style.width = pct + '%';
}

function ctxDeleteSummary(idx) {
  const ctx = wsGetContext(S.currentWs);
  if (!ctx) return;
  ctx.summaries.splice(idx, 1);
  ctxRenderSummaries();
}

async function ctxSaveAndClose() {
  await lsSaveWorkspace(S.currentWs);
  ctxUpdateStatusBadge(S.currentWs);
  showToast('บันทึก context แล้ว ✓', 'success');
  closeModal('modal-ctx-manager');
}

async function ctxResetAll() {
  if (!confirm('ล้าง context ทั้งหมดใช่ไหม?')) return;
  const ctx = wsGetContext(S.currentWs);
  if (ctx) ctx.summaries = [];
  await lsSaveWorkspace(S.currentWs);
  ctxUpdateStatusBadge(S.currentWs);
  ctxRenderSummaries();
  showToast('ล้าง context แล้ว', 'info');
}

function ctxToggleEnabled(enabled) {
  const ctx = wsGetContext(S.currentWs);
  if (!ctx) return;
  ctx.enabled = enabled;
  document.getElementById('wsCtxOptions').style.display = enabled ? 'block' : 'none';
  ctxUpdateStatusBadge(S.currentWs);
  lsSaveWorkspace(S.currentWs);
}

function ctxSetMaxTokens(val) {
  const ctx = wsGetContext(S.currentWs);
  if (!ctx) return;
  ctx.maxTokens = parseInt(val) || 1500;
  ctxUpdateStatusBadge(S.currentWs);
  lsSaveWorkspace(S.currentWs);
}

function ctxUpdateStatusBadge(ws) {
  const ctx = wsGetContext(ws);
  const el  = document.getElementById('wsCtxStatus');
  if (!el || !ctx) return;
  const n     = ctx.summaries.length;
  const total = ctxGetTotalTokens(ws);
  const pct   = Math.min(100, Math.round((total / (ctx.maxTokens || 1500)) * 100));
  el.textContent = n ? `${n} summary · ${total} tokens (${pct}%)` : 'ยังไม่มี summary';
  el.style.color = pct > 85 ? 'var(--crimson-light)' : pct > 60 ? 'var(--gold)' : 'var(--text-muted)';
}

