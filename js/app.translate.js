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
  (S.currentWs?.glossary || []).forEach(g => { wsGlossary[g.korean] = { thai: g.thai, type: g.type, note: g.note }; });

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
  const entries = Object.entries(wsGlossary || {});
  if (!entries.length) return '(ไม่มี)';
  return entries.map(([k, v]) => {
    const parts = [v.thai];
    if (v.type === 'character' && v.gender && v.gender !== 'neutral') {
      parts.push(`gender:${GENDER_MAP[v.gender] || v.gender}`);
      parts.push(PRONOUN_3RD[v.gender]);
      parts.push(PRONOUN_1ST[v.gender]);
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

// ── True SSE streaming per segment — ใช้ aiStream (provider-aware) ──
async function streamSegment(text, contextSegs, options, onChunk, onDone) {
  const { model, temperature = 0.7, customStylePrompt, wsGlossary = {}, useMemory = true } = options;
  const cacheKey = text.slice(0, 120);

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
  const cacheKey = text.slice(0, 120);
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

// ─── Auto Extract Glossary หลังแปลเสร็จ ───
// chapterInfo = { id, title, chapterNum } หรือ null ถ้าไม่รู้ตอน
async function autoExtractGlossaryAfterTranslation(sourceText, model, chapterInfo = null, translationText = '') {
  if (!S.currentWsId || !S.currentWs) return;
  if (!sourceText?.trim()) return;
  if (S.currentWs.settings?.autoGlossary === false) return;

  if (!Array.isArray(S.currentWs.glossary)) S.currentWs.glossary = [];

  const existing = S.currentWs.glossary.map(g => g.korean).join(', ') || '(none)';

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
      max_tokens: 1500,
    });

    const raw = (res.choices?.[0]?.message?.content || '').trim().replace(/```json|```/g, '').trim();
    let terms;
    try { terms = JSON.parse(raw); }
    catch { terms = tryRepairJson(raw) || []; }

    if (!Array.isArray(terms) || !terms.length) {
      showToast('📖 Auto Glossary: ไม่พบคำศัพท์ใหม่', '');
      return;
    }

    let added = 0;
    terms.forEach(term => {
      if (!term.korean || !term.thai) return;
      const exactExists = S.currentWs.glossary.some(g => g.korean === term.korean);
      if (exactExists) return;
      // แนบ source chapter info ถ้ามี
      const entry = { ...term };
      // sanitize gender — only valid for character type, and must be a known value
      if (entry.type !== 'character' || !['male','female','neutral'].includes(entry.gender)) {
        delete entry.gender;
      }
      if (chapterInfo?.title) {
        entry.sourceChapterId    = chapterInfo.id    || null;
        entry.sourceChapterTitle = chapterInfo.title;
        entry.sourceChapterNum   = chapterInfo.chapterNum || null;
      }
      S.currentWs.glossary.push(entry);
      added++;
    });

    if (added > 0) {
      S.glossaryData = S.currentWs.glossary;
      await lsSaveWorkspace(S.currentWs);
      if (S.currentTab === 'glossary') renderGlossaryTable();
      const chLabel = chapterInfo?.title ? ` (ตอน #${chapterInfo.chapterNum||'?'} ${chapterInfo.title.slice(0,20)})` : '';
      showToast(`📖 Auto Glossary: เพิ่ม ${added} คำใหม่${chLabel} ✓`, 'success');
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
  const cacheKey = text.slice(0, 120);

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

  try {
    let charCount = 0;
    S.abortCtrl = new AbortController();
    const timer = setTimeout(() => S.abortCtrl.abort(), getTimeoutMs('full'));

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
      clearTimeout(timer);
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

    setStage('translate', 'done');
    setStage('done', 'done');
    updateProgress(100, 'แปลเสร็จสิ้น ✓');
    document.getElementById('translationStats').textContent = `${fullText.length.toLocaleString()} ตัวอักษร`;
    showToast('แปลเสร็จสิ้น ✓', 'success');
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
    if (e.name === 'AbortError') {
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
      const cacheKey = chunk.slice(0, 120);
      if (options.useMemory && _mcGet(cacheKey)) {
        cursor.remove();
        txtEl.textContent = _mcGet(cacheKey);
        completedTranslations.push(txtEl.textContent);
        badge.className = 'seg-status cached';
        badge.innerHTML = '📦 Memory';
        updateProgress(Math.round((i+1)/n*100), `chunk ${i+1}/${n} เสร็จ`);
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
      const prompt = buildTranslatePrompt({
        sourceText: chunk,
        glossaryStr,
        contextStr: ctxStr,
        styleNote: options.customStylePrompt || '',
        ws: S.currentWs,
      });

      let chunkFull = '';
      let inTok = 0, outTok = 0;

      try {
        // ใช้ global abort + timeout 120s
        S.abortCtrl = new AbortController();
        const timer = setTimeout(() => S.abortCtrl.abort(), getTimeoutMs('chunk'));
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
        } finally { clearTimeout(timer); }

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

        badge.className = 'seg-status done';
        badge.textContent = `✓ ${chunkFull.length} ตัวอักษร`;
        updateProgress(Math.round((i+1)/n*100), `chunk ${i+1}/${n} เสร็จ`);

        // Partial save: บันทึก chunk ที่เสร็จแล้วเข้า chapter ทันที (กัน data loss ถ้าหยุดกลางคัน)
        // + chunkProgress สำหรับ resume — ลบทิ้งเมื่อแปลครบ
        if (S.editingChapterId && S.currentWs) {
          const _pCh = S.currentWs.chapters?.find(ch => ch.id === S.editingChapterId);
          if (_pCh) {
            _pCh.translation = completedTranslations.join('\n\n');
            _pCh.status = i + 1 < n ? 'partial' : 'translated';
            if (i + 1 < n) {
              _pCh.chunkProgress = { chunkSize: options.chunkSize, srcHash: _srcHash, chunks: [...completedTranslations], updatedAt: Date.now() };
            } else {
              delete _pCh.chunkProgress;
            }
            _pCh.updatedAt = Date.now();
            lsSaveWorkspace(S.currentWs).catch(() => {});
          }
        }

      } catch (err) {
        cursor.remove();
        // ถ้า user กดหยุด → ออกจาก loop ทันที
        if (err.name === 'AbortError') {
          badge.className = 'seg-status error';
          badge.textContent = '⬛ หยุดแล้ว';
          txtEl.textContent = '⬛ ถูกหยุดโดยผู้ใช้';
          updateProgress(Math.round((i+1)/n*100), `หยุดที่ chunk ${i+1}/${n}`);
          break;
        }
        badge.className = 'seg-status error';
        badge.textContent = '✗ Error';
        txtEl.textContent = `❌ ${err.message}`;
        completedTranslations.push('');
        updateProgress(Math.round((i+1)/n*100), `chunk ${i+1}/${n} Error`);
      }
    }

    setStage('translate', 'done');
    if (options.usePolish) setStage('polish', 'done');
    setStage('done', 'done');
    updateProgress(100, 'แปลเสร็จสิ้น ✓');
    const totalChars = completedTranslations.join('').length;
    document.getElementById('translationStats').textContent = `แปลเสร็จ ${n} chunks · ${totalChars.toLocaleString()} ตัวอักษร`;
    showToast(`แปลเสร็จ ${n} chunks ✓`, 'success');

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

