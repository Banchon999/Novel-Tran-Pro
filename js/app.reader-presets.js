// ท้ายคำแปลของตอนก่อนหน้าที่แปลแล้ว (ใกล้สุด ย้อนไม่เกิน 3 ตอน) — ใช้เป็นตัวอย่างสำนวนให้แปลต่อเนื่อง
function prevChapterTail(ch, ws = S.currentWs) {
  const sorted = _getSortedChapters();
  const i = sorted.findIndex(c => c.id === ch.id);
  for (let j = i - 1; j >= Math.max(0, i - 3); j--) {
    const t = sorted[j]?.translation?.trim();
    if (t) return `### ท้ายคำแปลตอนก่อน (#${sorted[j].chapterNum || '?'}) — ตัวอย่างสำนวนที่ใช้มาแล้ว: ใช้ชื่อ คำเรียก และสำนวนให้ต่อเนื่องกับข้อความนี้ ห้ามแปลหรือคัดลอกซ้ำ\n${t.slice(-getPrevCtxChars())}`;
  }
  return '';
}

// ─── Shared Translation Core ───
// แปล 1 ตอนแบบ headless (glossary → prompt → stream → polish → save → auto-glossary → ctx summary)
// ใช้ร่วมกันระหว่าง Marathon และ Reader prefetch
// awaitGlossary: true → รอ auto-glossary + context summary เสร็จก่อน resolve
//   (จำเป็นสำหรับ prefetch แบบเรียงตอน — ตอน N+1 ต้องเห็นศัพท์/บริบทจากตอน N)
async function translateChapterCore(ch, {
  presetId = S.currentWs?.presetId ?? 'literary',
  model = null,
  signal = null,
  onDelta = null,
  awaitGlossary = false,
} = {}) {
  const ws = S.currentWs;
  const presetBase = (ws.presets || []).find(p => p.id === presetId) || getActivePreset(ws);
  const srcPrepared  = prepareSourceForTranslation(ch.sourceText);
  // ลงคลังศัพท์ใหม่ก่อนแปล → คำที่โผล่ครั้งแรกก็แปลตามคลัง และ Speaker Map ได้เพศตัวละครใหม่ด้วย
  await preExtractTerms(srcPrepared, model || ws.settings?.translateModel || document.getElementById('translateModel')?.value, { id: ch.id, title: ch.title, chapterNum: ch.chapterNum });
  const spMap        = await buildSpeakerMap(srcPrepared, model || ws.settings?.translateModel || document.getElementById('translateModel')?.value || 'google/gemini-2.5-flash', ws);
  // บริบท = สรุปเรื่อง (Context Memory) + ท้ายคำแปลตอนก่อน (ตัวอย่างสำนวน ให้คำเรียก/สำนวนต่อเนื่อง)
  const contextStr   = [ctxGetPromptText(ws), prevChapterTail(ch, ws)].filter(Boolean).join('\n\n');
  const systemPrompt = applyContext(applySpeakerMap(applyParticleRules(applyStyleSheet(applyConsistencyLock(presetBase.systemPrompt, ws), ws)), spMap), contextStr);
  const temperature  = translateTemp(presetBase.temperature, ws);
  const useModel = model || ws.settings?.translateModel || document.getElementById('translateModel')?.value || 'google/gemini-2.5-flash';

  const smartGloss  = getSmartGlossary(ch.sourceText, S.glossaryData);
  const glossObj    = smartGloss.reduce(function(a, g) { a[g.korean] = { thai: g.thai, type: g.type, note: g.note, gender: g.gender }; return a; }, {});
  const glossaryStr = buildGlossaryStr(glossObj);
  const mtlDraft    = presetIsMtlFix(presetBase) ? (ch.translation || '') : '';

  const prompt = systemPrompt
    .replace('{style_note}', '')
    .replace('{glossary}',   glossaryStr || '(ไม่มี)')
    .replace('{context}',    contextStr)
    .replace('{text}',       srcPrepared)
    .replace('{mtl_draft}',  mtlDraft || '(ไม่มี MTL draft)');

  // timeout ภายใน + เคารพ signal จาก caller (เดิม path Marathon ไม่มี timeout เลย — slot ค้างได้)
  const _ctrl = new AbortController();
  const _onAbort = () => _ctrl.abort();
  if (signal) {
    if (signal.aborted) _ctrl.abort();
    else signal.addEventListener('abort', _onAbort, { once: true });
  }
  const _timer = startAbortTimer(_ctrl, getTimeoutMs('full'));

  let inTok = 0, outTok = 0;
  let fullText = '', echoGap = false;
  try {
    // AI ส่งต้นฉบับกลับมาโดยไม่แปล → ลองใหม่ 1 ครั้ง
    for (let attempt = 0; attempt < 2; attempt++) {
      fullText = await aiStream(
        { model: useModel, temperature: temperature, max_tokens: Math.max(16000, Math.ceil(ch.sourceText.length * 4)), messages: [{ role: 'user', content: prompt }] },
        onDelta || function() {},
        function(i, o) { inTok = i; outTok = o; },
        _ctrl.signal
      );
      if (inTok || outTok) { addCosts(inTok, outTok, useModel); inTok = outTok = 0; }
      const se = stripSourceEcho(srcPrepared, fullText);
      fullText = se.text; echoGap = se.missing > 0 || (se.removed > 0 && !fullText.trim());
      if (!echoGap && !looksUntranslated(fullText) && !looksIncomplete(srcPrepared, fullText)) break;
    }
  } catch (e) {
    // หมดเวลา → error ปกติ (ให้ prefetch ลองใหม่ / แจ้งผู้ใช้) — ไม่ปนกับการกดยกเลิก
    if (e.name === 'AbortError' && _timer.timedOut) throw new Error(timeoutMessage(_timer.ms));
    throw e;
  } finally {
    clearTimeout(_timer.id);
    if (signal) signal.removeEventListener('abort', _onAbort);
    if (inTok || outTok) addCosts(inTok, outTok, useModel);
  }

  if ((!fullText || !fullText.trim()) && !echoGap) throw new Error('AI ส่งผลลัพธ์ว่าง');
  if (echoGap || looksUntranslated(fullText)) throw new Error('AI ส่งต้นฉบับกลับมาโดยไม่แปล (ลองแล้ว 2 ครั้ง) — ลองเปลี่ยนโมเดลหรือแปลใหม่');
  if (looksIncomplete(srcPrepared, fullText)) throw new Error('คำแปลสั้นผิดปกติ — น่าจะถูกตัดกลางคันหรือตกหล่น (ลองแล้ว 2 ครั้ง) — ลองแปลใหม่หรือเปลี่ยนโมเดล');

  if (presetBase.polish) {
    try {
      const pr = await callOpenRouter({
        model: useModel,
        messages: [{ role: 'user', content: POLISH_PROMPT.replace('{glossary}', glossaryStr).replace('{text}', fullText) }],
        temperature: translateTemp(0.5, ws),
        max_tokens: Math.max(3000, Math.ceil(fullText.length * 1.2)),
      });
      fullText = pr.choices?.[0]?.message?.content?.trim() || fullText;
    } catch (e) { /* polish failed, use unpolished */ }
  }

  // แก้คำลงท้าย/คำแทนตัวที่ผิดเพศผู้พูด (ตามแผนที่ผู้พูด)
  const spFix = applySpeakerFixes(fullText, spMap);
  if (spFix.fixes.length) fullText = spFix.text;
  const gp = spMap ? await genderProofread(srcPrepared, fullText, useModel, ws) : { text: fullText, fixes: [] };
  fullText = gp.text;
  ch.speakerFixes = spFix.fixes.length + gp.fixes.length;

  ch.translation = fullText;
  ch.status      = 'translated';
  ch.wordCount   = fullText.length;
  ch.updatedAt   = Date.now();
  await lsSaveWorkspace(ws);

  // auto-glossary จับ error ภายในตัวเองอยู่แล้ว / ctx summary อาจ throw → catch เสมอ
  const glossP = autoExtractGlossaryAfterTranslation(ch.sourceText, useModel, { id: ch.id, title: ch.title, chapterNum: ch.chapterNum }, fullText);
  const ctxP   = ctxAddSummary(ws, ch.id, ch.chapterNum, ch.title, fullText);
  if (awaitGlossary) {
    await glossP;
    await ctxP.catch(e => console.warn('[CTX]', e));
  } else {
    ctxP.catch(e => console.warn('[CTX]', e));
  }
  return fullText;
}

// ─── Translation Presets (ของผู้ใช้ทั้งหมด — CRUD) ───
const PRESET_PROMPT_TEMPLATE = `You are a professional Korean → Thai webnovel translator.

RULES:
• Translate completely and accurately — no additions, no omissions
• Write natural, fluent Thai
• Follow all glossary terms exactly
• Maintain paragraph structure
• Thai pronouns: Male→เขา/ผม | Female→เธอ/ฉัน
{style_note}
GLOSSARY:
{glossary}

{context}
Translate this Korean text into Thai. Output ONLY the Thai translation:

{text}`;

// เติม dropdown เลือก preset ที่ใช้งาน (ในหน้า Settings)
function renderPresetSelect() {
  const sel = document.getElementById('wsPresetSelect');
  if (!sel) return;
  const presets = S.currentWs?.presets || [];
  sel.innerHTML = presets.map(p => `<option value="${p.id}">${p.emoji || '📖'} ${esc(p.name)}</option>`).join('')
    || '<option value="">— ยังไม่มี Preset —</option>';
  sel.value = S.currentWs?.presetId || presets[0]?.id || '';
}

// เติม dropdown ในตัวแก้ไข preset
function pePopulateSelect(selectId) {
  const sel = document.getElementById('pe-preset-select');
  if (!sel) return;
  const presets = S.currentWs?.presets || [];
  sel.innerHTML = presets.map(p => `<option value="${p.id}">${p.emoji || '📖'} ${esc(p.name)}</option>`).join('')
    + '<option value="__new__">＋ สร้าง Preset ใหม่…</option>';
  sel.value = selectId || presets[0]?.id || '__new__';
}

function openPresetEditor() {
  if (!S.currentWs) return;
  pePopulateSelect(S.currentWs.presetId);
  loadPresetForEdit();
  openModal('modal-preset-editor');
}

function loadPresetForEdit() {
  const id = document.getElementById('pe-preset-select')?.value;
  const nameEl   = document.getElementById('pe-name');
  const emojiEl  = document.getElementById('pe-emoji');
  const promptEl = document.getElementById('pe-prompt-text');
  const tempEl   = document.getElementById('pe-temperature');
  const tempVal  = document.getElementById('pe-temp-val');
  const polishEl = document.getElementById('pe-polish');
  const delBtn   = document.getElementById('pe-delete-btn');
  const isNew = (id === '__new__' || !id);
  const preset = isNew ? null : (S.currentWs?.presets || []).find(p => p.id === id);
  if (nameEl)   nameEl.value   = preset?.name || '';
  if (emojiEl)  emojiEl.value  = preset?.emoji || '📖';
  if (promptEl) promptEl.value = preset?.systemPrompt || PRESET_PROMPT_TEMPLATE;
  const temp = (preset?.temperature !== undefined) ? preset.temperature : 0.6;
  if (tempEl)  tempEl.value = temp;
  if (tempVal) tempVal.textContent = temp;
  if (polishEl) polishEl.checked = !!preset?.polish;
  if (delBtn)  delBtn.style.display = isNew ? 'none' : 'inline-flex';
}

async function savePreset() {
  if (!S.currentWs) return;
  const id          = document.getElementById('pe-preset-select')?.value;
  const name        = document.getElementById('pe-name')?.value?.trim();
  const emoji       = document.getElementById('pe-emoji')?.value?.trim() || '📖';
  const promptText  = document.getElementById('pe-prompt-text')?.value?.trim();
  const temperature = parseFloat(document.getElementById('pe-temperature')?.value || '0.6');
  const polish      = !!document.getElementById('pe-polish')?.checked;
  if (!name)       { showToast('ใส่ชื่อ Preset ก่อน', 'error'); return; }
  if (!promptText) { showToast('ใส่ System Prompt ก่อน', 'error'); return; }
  if (!promptText.includes('{text}')) { showToast('Prompt ต้องมี {text} (จุดแทรกต้นฉบับ)', 'error'); return; }

  if (!Array.isArray(S.currentWs.presets)) S.currentWs.presets = [];
  const isNew = (id === '__new__' || !id);
  if (isNew) {
    const newId = genId();
    S.currentWs.presets.push({ id: newId, name, emoji, systemPrompt: promptText, temperature, polish });
    S.currentWs.presetId = newId;
  } else {
    const idx = S.currentWs.presets.findIndex(p => p.id === id);
    const obj = { id, name, emoji, systemPrompt: promptText, temperature, polish };
    if (idx >= 0) S.currentWs.presets[idx] = obj; else S.currentWs.presets.push(obj);
  }
  await lsSaveWorkspace(S.currentWs);
  pePopulateSelect(isNew ? S.currentWs.presetId : id);
  loadPresetForEdit();
  renderPresetSelect();
  showToast('บันทึก Preset แล้ว ✓', 'success');
}

async function deletePreset() {
  if (!S.currentWs) return;
  const id = document.getElementById('pe-preset-select')?.value;
  if (!id || id === '__new__') return;
  const presets = S.currentWs.presets || [];
  if (presets.length <= 1) { showToast('ต้องมี Preset อย่างน้อย 1 อัน', 'error'); return; }
  if (!confirm('ลบ Preset นี้?')) return;
  S.currentWs.presets = presets.filter(p => p.id !== id);
  if (S.currentWs.presetId === id) S.currentWs.presetId = S.currentWs.presets[0]?.id || '';
  await lsSaveWorkspace(S.currentWs);
  pePopulateSelect(S.currentWs.presetId);
  loadPresetForEdit();
  renderPresetSelect();
  showToast('ลบ Preset แล้ว', '');
}

// เพิ่มชุด Preset ตัวอย่าง 6 แบบ (เฉพาะที่ยังไม่มี) — สำหรับ workspace เดิม
async function addMissingSeedPresets() {
  if (!S.currentWs) return;
  if (!Array.isArray(S.currentWs.presets)) S.currentWs.presets = [];
  const existing = new Set(S.currentWs.presets.map(p => p.id));
  let added = 0;
  SEED_PRESETS.forEach(p => { if (!existing.has(p.id)) { S.currentWs.presets.push({ ...p }); added++; } });
  if (!added) { showToast('มี Preset ตัวอย่างครบแล้ว', ''); return; }
  await lsSaveWorkspace(S.currentWs);
  pePopulateSelect(document.getElementById('pe-preset-select')?.value);
  loadPresetForEdit();
  renderPresetSelect();
  showToast(`เพิ่ม Preset ตัวอย่าง ${added} แบบแล้ว ✓`, 'success');
}

// ═══════════════════════════════════════════════
// ─── Read / Edit Tab (แท็บอ่าน+แก้ไขในตัว) ───────
// ═══════════════════════════════════════════════
// แท็บอ่านพร้อมเครื่องมือแก้ไข: แก้ข้อความ inline + ค้นหา/แทนที่ในตอน
const reState = { chapterId: null, mode: 'read' };

function renderReadTab() {
  const ws = S.currentWs;
  const sel = document.getElementById('reChapterSelect');
  if (!ws || !sel) return;
  const chs = _getSortedChapters();
  if (!chs.length) {
    sel.innerHTML = '<option value="">— ยังไม่มีตอน —</option>';
    document.getElementById('reContent').innerHTML = '<div class="re-empty">ยังไม่มีตอนใน Workspace นี้ — เพิ่มตอนในแท็บ 📚 ตอน</div>';
    document.getElementById('reEditArea').style.display = 'none';
    document.getElementById('reContent').style.display = 'block';
    document.getElementById('reStatus').textContent = '';
    document.getElementById('reCharStats').textContent = '';
    return;
  }
  sel.innerHTML = chs.map(c => `<option value="${c.id}">#${c.chapterNum || '?'} ${esc(c.title || '(ไม่มีชื่อ)')}${c.translation ? '' : ' · ยังไม่แปล'}</option>`).join('');
  // ใช้ตอนที่ค้างไว้ หรือ ตอนที่จำจากตำแหน่งอ่านล่าสุด หรือตอนแรก
  if (!reState.chapterId || !chs.some(c => c.id === reState.chapterId)) {
    const savedId = ws.readerPosition?.chapterId;
    reState.chapterId = (savedId && chs.some(c => c.id === savedId)) ? savedId : chs[0].id;
  }
  reLoadChapter(reState.chapterId);
}

function reLoadChapter(id) {
  if (id) reState.chapterId = id;
  const ws = S.currentWs;
  const ch = ws?.chapters?.find(c => c.id === reState.chapterId);
  const sel = document.getElementById('reChapterSelect');
  if (sel && reState.chapterId) sel.value = reState.chapterId;
  // จำตำแหน่งตอนล่าสุด (ใช้ร่วมกับ "อ่านต่อ")
  if (ch && ws) {   // เปลี่ยนตอน → ล้างตำแหน่ง scroll เดิม (ไม่งั้นเปิดเต็มจอแล้วกระโดดไปตำแหน่งของตอนก่อน)
    const prev = ws.readerPosition || {};
    ws.readerPosition = prev.chapterId === ch.id ? prev : { chapterId: ch.id, scrollPct: 0 };
    lsSaveWorkspace(ws).catch(() => {});
  }

  // ปุ่ม prev/next
  const chs = _getSortedChapters();
  const idx = chs.findIndex(c => c.id === reState.chapterId);
  const prevBtn = document.getElementById('rePrevBtn');
  const nextBtn = document.getElementById('reNextBtn');
  if (prevBtn) prevBtn.disabled = idx <= 0;
  if (nextBtn) nextBtn.disabled = idx < 0 || idx >= chs.length - 1;

  // โหมดปุ่ม
  const readBtn = document.getElementById('reModeReadBtn');
  const editBtn = document.getElementById('reModeEditBtn');
  if (readBtn) readBtn.classList.toggle('active', reState.mode === 'read');
  if (editBtn) editBtn.classList.toggle('active', reState.mode === 'edit');
  const glBtn = document.getElementById('reGlossHlBtn');
  if (glBtn) glBtn.classList.toggle('active', reGlossHlEnabled());

  const content  = document.getElementById('reContent');
  const editArea = document.getElementById('reEditArea');
  const saveBtn  = document.getElementById('reSaveBtn');
  const transBtn = document.getElementById('reTranslateBtn');
  const status   = document.getElementById('reStatus');
  if (!ch) { if (content) content.innerHTML = ''; return; }

  if (status) status.textContent = ch.translation ? '✓ แปลแล้ว' : '◌ ยังไม่แปล';
  if (transBtn) transBtn.style.display = '';

  if (reState.mode === 'edit') {
    content.style.display = 'none';
    editArea.style.display = 'block';
    editArea.value = ch.translation || '';
    if (saveBtn) saveBtn.style.display = '';
  } else {
    editArea.style.display = 'none';
    content.style.display = 'block';
    if (saveBtn) saveBtn.style.display = 'none';
    if (ch.translation && ch.translation.trim()) {
      content.innerHTML = reRenderReadContent(ch, reGlossHlEnabled() ? reBuildGlossRegex() : null);
    } else {
      content.innerHTML = `<h2 class="re-title">${esc(ch.title || '')}</h2><div class="re-empty">ตอนนี้ยังไม่ได้แปล — กด <strong>⚡ แปลตอนนี้</strong> ด้านบน</div>`;
    }
  }

  // ปรับ scroll ของโหมดใหม่ให้ตรงกับตำแหน่งที่อ่านค้างไว้ (สลับ อ่าน↔แก้ไข ให้ chunk ตรงกัน)
  if (reState._pendingAnchor != null) {
    const off = reState._pendingAnchor;
    reState._pendingAnchor = null;
    requestAnimationFrame(() => {
      if (reState.mode === 'edit') reApplyAnchorEdit(off); else reApplyAnchorRead(off);
    });
  }

  reUpdateCharStats();
  reHighlightCount();
}

// ─── สร้าง HTML โหมดอ่าน (เก็บ offset ตัวอักษรไว้ที่ data-coff เพื่อ sync ตำแหน่งกับโหมดแก้ไข) ───
function reRenderReadContent(ch, gloss) {
  const lines = (ch.translation || '').split('\n');
  let off = 0;
  const body = lines.map(line => {
    const start = off;
    off += line.length + 1; // +1 = ตัวขึ้นบรรทัด \n
    if (!line.trim()) return '<br>';
    let inner = esc(line);
    if (gloss) inner = reApplyGlossHighlight(inner, gloss);
    return `<p data-coff="${start}">${inner}</p>`;
  }).join('');
  return `<h2 class="re-title">${esc(ch.title || '')}</h2>${body}`;
}

// ─── Glossary highlight (ไฮไลต์คำแปลที่ตรงกับคลังศัพท์) ───
function reGlossHlEnabled() { return !!(S.currentWs?.readerSettings?.glossaryHl); }

function reToggleGlossHl() {
  if (!S.currentWs) return;
  S.currentWs.readerSettings = { ...(S.currentWs.readerSettings || {}), glossaryHl: !reGlossHlEnabled() };
  lsSaveWorkspace(S.currentWs).catch(() => {});
  reLoadChapter(reState.chapterId);
  showToast(reGlossHlEnabled() ? 'เปิดไฮไลต์คำศัพท์ ✓' : 'ปิดไฮไลต์คำศัพท์', '');
}

// เตรียม regex + map (คำแปลไทย → entry) สำหรับไฮไลต์ — เรียงยาวไปสั้นกัน match ซ้อน
function reBuildGlossRegex() {
  const data = S.glossaryData || [];
  const map = new Map();      // key = คำไทยที่ esc แล้ว → entry (ใช้หา type/ต้นฉบับตอนแทนที่)
  const terms = [];
  for (const g of data) {
    const t = (g.thai || '').trim();
    if (!t) continue;
    const e = esc(t);
    if (!map.has(e)) { map.set(e, g); terms.push(e); }
  }
  if (!terms.length) return null;
  terms.sort((a, b) => b.length - a.length);
  const pattern = terms.map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  return { re: new RegExp(pattern, 'g'), map };
}

// แทรก <mark> ลงในข้อความที่ esc แล้ว (haystack ปลอดภัยจาก HTML แล้ว)
function reApplyGlossHighlight(escapedText, gloss) {
  if (!gloss) return escapedText;
  return escapedText.replace(gloss.re, m => {
    const g = gloss.map.get(m);
    const cls = getTagClass(g?.type || 'term');
    const typeLabel = g?.type ? (PRESET_TYPES[g.type] || g.type) : '';
    const title = esc(`${g?.korean || ''}${typeLabel ? ' · ' + typeLabel : ''}`).replace(/"/g, '&quot;');
    return `<mark class="re-gloss ${cls}" title="${title}">${m}</mark>`;
  });
}

function reNav(dir) {
  const chs = _getSortedChapters();
  const idx = chs.findIndex(c => c.id === reState.chapterId);
  const ni = idx + dir;
  if (ni < 0 || ni >= chs.length) return;
  reLoadChapter(chs[ni].id);
}

function reSetMode(mode) {
  if (mode === reState.mode) return;
  // ถ้ากำลังแก้ไขแล้วมีข้อความค้าง ให้เตือนบันทึกก่อนสลับไปอ่าน
  if (reState.mode === 'edit' && mode === 'read') {
    const ch = S.currentWs?.chapters?.find(c => c.id === reState.chapterId);
    const cur = document.getElementById('reEditArea')?.value ?? '';
    if (ch && cur !== (ch.translation || '') && !confirm('มีการแก้ไขที่ยังไม่บันทึก — ทิ้งการแก้ไข?')) return;
  }
  // จดตำแหน่งที่อ่านค้าง (offset ตัวอักษรบนสุดของจอ) จากโหมดเดิม แล้วนำไปใช้กับโหมดใหม่
  reState._pendingAnchor = (reState.mode === 'edit') ? reCaptureAnchorEdit() : reCaptureAnchorRead();
  reState.mode = mode;
  reLoadChapter(reState.chapterId);
}

// ─── Sync ตำแหน่ง scroll ระหว่างโหมดอ่าน ↔ แก้ไข (อิง offset ตัวอักษร) ───
function _reLineStarts(text) {
  const starts = [0];
  for (let i = 0; i < text.length; i++) if (text[i] === '\n') starts.push(i + 1);
  return starts;
}
function _reOffsetToLine(starts, off) {
  let lo = 0, hi = starts.length - 1, ans = 0;
  while (lo <= hi) { const mid = (lo + hi) >> 1; if (starts[mid] <= off) { ans = mid; lo = mid + 1; } else hi = mid - 1; }
  return ans;
}

// วัดตำแหน่งพิกเซลของจุดเริ่มแต่ละบรรทัดใน textarea ด้วย mirror div (รองรับ word-wrap)
function _reTextareaLineTops(ta) {
  const lines = (ta.value || '').split('\n');
  const cs = getComputedStyle(ta);
  const mirror = document.createElement('div');
  ['fontFamily','fontSize','fontWeight','fontStyle','fontVariant','lineHeight','letterSpacing',
   'textTransform','textIndent','wordSpacing','paddingTop','paddingRight','paddingBottom','paddingLeft','tabSize']
    .forEach(p => { mirror.style[p] = cs[p]; });
  // คุม box ให้เท่ากับพื้นที่เนื้อหาของ textarea เป๊ะ (clientWidth = ขอบเขตเนื้อหา+padding ไม่รวม border/scrollbar)
  mirror.style.boxSizing = 'border-box';
  mirror.style.borderWidth = '0';
  mirror.style.position = 'absolute';
  mirror.style.visibility = 'hidden';
  mirror.style.left = '-9999px';
  mirror.style.top = '0';
  mirror.style.height = 'auto';
  mirror.style.width = ta.clientWidth + 'px';
  mirror.style.whiteSpace = 'pre-wrap';
  mirror.style.overflowWrap = 'break-word';
  mirror.style.wordWrap = 'break-word';
  const markers = [];
  lines.forEach((line, i) => {
    const m = document.createElement('span');
    m.textContent = '\u200B';
    mirror.appendChild(m);
    markers.push(m);
    mirror.appendChild(document.createTextNode(line + (i < lines.length - 1 ? '\n' : '')));
  });
  document.body.appendChild(mirror);
  const base = markers.length ? markers[0].offsetTop : 0;
  const tops = markers.map(m => m.offsetTop - base);
  document.body.removeChild(mirror);
  return tops;
}

function reCaptureAnchorRead() {
  const sc = document.getElementById('reContent');
  if (!sc) return 0;
  const scTop = sc.getBoundingClientRect().top;
  let best = 0;
  for (const p of sc.querySelectorAll('p[data-coff]')) {
    if (p.getBoundingClientRect().top - scTop <= 8) best = +p.dataset.coff || 0;
    else break;
  }
  return best;
}

function reApplyAnchorRead(off) {
  const sc = document.getElementById('reContent');
  if (!sc) return;
  const scTop = sc.getBoundingClientRect().top;
  let target = null;
  for (const p of sc.querySelectorAll('p[data-coff]')) {
    if ((+p.dataset.coff || 0) <= off) target = p; else break;
  }
  if (target) sc.scrollTop += target.getBoundingClientRect().top - scTop;
}

function reCaptureAnchorEdit() {
  const ta = document.getElementById('reEditArea');
  if (!ta) return 0;
  const tops = _reTextareaLineTops(ta);
  const top = ta.scrollTop;
  let line = 0;
  for (let i = 0; i < tops.length; i++) { if (tops[i] <= top + 2) line = i; else break; }
  const starts = _reLineStarts(ta.value || '');
  return starts[Math.min(line, starts.length - 1)] || 0;
}

function reApplyAnchorEdit(off) {
  const ta = document.getElementById('reEditArea');
  if (!ta) return;
  const starts = _reLineStarts(ta.value || '');
  const line = _reOffsetToLine(starts, off);
  const tops = _reTextareaLineTops(ta);
  ta.scrollTop = tops[Math.min(line, tops.length - 1)] || 0;
}

function reUpdateCharStats() {
  const el = document.getElementById('reCharStats');
  const ch = S.currentWs?.chapters?.find(c => c.id === reState.chapterId);
  if (!el || !ch) return;
  const len = (reState.mode === 'edit' ? (document.getElementById('reEditArea')?.value || '') : (ch.translation || '')).length;
  el.textContent = `${len.toLocaleString()} ตัวอักษร`;
}

async function reSaveEdit() {
  const ch = S.currentWs?.chapters?.find(c => c.id === reState.chapterId);
  if (!ch) return;
  const val = document.getElementById('reEditArea').value;
  ch.translation = val;
  ch.status = val.trim() ? 'translated' : (ch.status === 'translated' ? 'pending' : ch.status);
  ch.wordCount = val.length;
  ch.updatedAt = Date.now();
  await lsSaveWorkspace(S.currentWs);
  showToast('บันทึกการแก้ไขแล้ว ✓', 'success');
  if (S.currentTab === 'chapters') renderChapters();
  reUpdateCharStats();
}

// ค้นหา/แทนที่ภายในตอนปัจจุบัน
function reHighlightCount() {
  const info = document.getElementById('reFindInfo');
  const find = document.getElementById('reFind')?.value || '';
  if (!info) return;
  if (!find) { info.textContent = ''; return; }
  const ch = S.currentWs?.chapters?.find(c => c.id === reState.chapterId);
  const text = (reState.mode === 'edit' ? (document.getElementById('reEditArea')?.value || '') : (ch?.translation || ''));
  const cs = document.getElementById('reCaseSensitive')?.checked;
  let count = 0, i = 0;
  const hay = cs ? text : text.toLowerCase();
  const needle = cs ? find : find.toLowerCase();
  if (needle) { while ((i = hay.indexOf(needle, i)) !== -1) { count++; i += needle.length; } }
  info.textContent = `พบ ${count} จุด`;
}

async function reReplaceAll() {
  const ch = S.currentWs?.chapters?.find(c => c.id === reState.chapterId);
  if (!ch) return;
  const find = document.getElementById('reFind')?.value || '';
  if (!find) { showToast('ใส่คำที่ต้องการค้นหาก่อน', 'error'); return; }
  const repl = document.getElementById('reReplace')?.value || '';
  const cs = document.getElementById('reCaseSensitive')?.checked;
  const src = reState.mode === 'edit' ? (document.getElementById('reEditArea')?.value || '') : (ch.translation || '');
  const flags = cs ? 'g' : 'gi';
  const re = new RegExp(find.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), flags);
  const count = (src.match(re) || []).length;
  if (!count) { showToast('ไม่พบคำที่ค้นหา', ''); return; }
  const out = src.replace(re, repl);
  if (reState.mode === 'edit') {
    document.getElementById('reEditArea').value = out;
    reUpdateCharStats();
  } else {
    ch.translation = out;
    ch.wordCount = out.length;
    ch.updatedAt = Date.now();
    await lsSaveWorkspace(S.currentWs);
    reLoadChapter(reState.chapterId);
    if (S.currentTab === 'chapters') renderChapters();
  }
  reHighlightCount();
  showToast(`แทนที่ ${count} จุดแล้ว ✓`, 'success');
}

// แปลตอนปัจจุบันจากแท็บนี้
async function reTranslateChapter() {
  const ch = S.currentWs?.chapters?.find(c => c.id === reState.chapterId);
  if (!ch) return;
  if (!ch.sourceText?.trim()) { showToast('ตอนนี้ไม่มีต้นฉบับให้แปล', 'error'); return; }
  if (!getApiKey()) { showToast('ยังไม่ได้ตั้ง API Key — ไปที่ ⚙ ตั้งค่า', 'error'); return; }
  if (S.translating) { showToast('มีงานแปลอื่นทำงานอยู่ — รอสักครู่', 'error'); return; }
  const btn = document.getElementById('reTranslateBtn');
  const content = document.getElementById('reContent');
  S.translating = true;
  if (btn) { btn.disabled = true; btn.textContent = '⏳ กำลังแปล...'; }
  reState.mode = 'read';
  if (content) { content.style.display = 'block'; document.getElementById('reEditArea').style.display = 'none'; content.innerHTML = `<h2 class="re-title">${esc(ch.title || '')}</h2><div id="reLiveText"></div>`; }
  const live = document.getElementById('reLiveText');
  try {
    await translateChapterCore(ch, {
      awaitGlossary: false,
      onDelta: d => { if (live) { live.textContent += d; } },
    });
    showToast('แปลตอนนี้เสร็จ ✓', 'success');
    qualityQuickCheck(ch.sourceText, ch.translation);
    if (S.currentTab === 'chapters') renderChapters();
  } catch (e) {
    showToast('แปลไม่สำเร็จ: ' + (e.message || e), 'error');
  } finally {
    S.translating = false;
    if (btn) { btn.disabled = false; btn.textContent = '⚡ แปลตอนนี้'; }
    reLoadChapter(reState.chapterId);
  }
}

// ═══════════════════════════════════════════════
// ─── Reader Mode (overlay เดิม — คงไว้สำหรับ prefetch/อ้างอิง) ──
// ═══════════════════════════════════════════════
// อ่านเต็มจอ + จำตำแหน่ง/ตั้งค่าต่อ workspace — ธีม reader แยกจากธีมแอพ

const READER_DEFAULTS = { fontSize: 19, lineHeight: 1.9, theme: 'sepia', prefetchCount: 1 };

const rState = {
  active: false,
  chapterId: null,
  _scrollTimer: null,
  _pushedHistory: false,
  _navIdx: 0,
  _navTotal: 0,
  prefetch: { state: 'IDLE', ctrl: null, chapterId: null, retries: 0 },
};

function readerGetSettings() {
  return { ...READER_DEFAULTS, ...(S.currentWs?.readerSettings || {}) };
}

// เปิดอ่าน/แก้ไขตอน → ไปที่แท็บ "อ่าน/แก้ไข" (เดิมเป็น overlay เต็มจอ)
function openReader(chId) {
  const ch = S.currentWs?.chapters?.find(c => c.id === chId);
  if (!ch) { showToast('ไม่พบตอน', 'error'); return; }
  reState.chapterId = chId;
  switchTab('read');
}

// อ่านเต็มจอ (overlay) + Prefetch แปลตอนถัดไปล่วงหน้า — เคยถูกปิดทางเข้าตอนเพิ่มแท็บ อ่าน/แก้ไข (8a08fb9) ตอนนี้เปิดกลับ
function openReaderFull(chId) {
  const ch = S.currentWs?.chapters?.find(c => c.id === chId);
  if (!ch) { showToast('ไม่พบตอน', 'error'); return; }
  rState.active = true;
  rState.chapterId = chId;
  document.getElementById('readerOverlay').style.display = 'flex';
  readerApplySettings();
  readerRenderChapter(ch);
  // คืนตำแหน่ง scroll เฉพาะตอนที่บันทึกไว้ล่าสุด
  const pos = S.currentWs.readerPosition;
  const scroller = document.getElementById('readerScroll');
  requestAnimationFrame(() => {
    const denom = scroller.scrollHeight - scroller.clientHeight;
    scroller.scrollTop = (pos && pos.chapterId === chId && pos.scrollPct && denom > 0)
      ? pos.scrollPct * denom : 0;
    readerUpdateProgress();
  });
  if (!rState._pushedHistory) {
    try { history.pushState({ ntReader: true }, ''); rState._pushedHistory = true; } catch {}
  }
  readerSavePosition(true);
  readerKickPrefetch();
}

// ปุ่ม ⛶ เต็มจอ ในแท็บ อ่าน/แก้ไข
function reOpenFull() {
  const id = reState.chapterId || document.getElementById('reChapterSelect')?.value;
  if (!id) { showToast('เลือกตอนก่อน', 'error'); return; }
  openReaderFull(id);
}

function openReaderResume() {
  const ws = S.currentWs;
  if (!ws) { showToast('เลือก Workspace ก่อน', 'error'); return; }
  const pos = ws.readerPosition;
  let ch = pos ? ws.chapters?.find(c => c.id === pos.chapterId) : null;
  if (!ch) ch = _getSortedChapters()[0];
  if (!ch) { showToast('ยังไม่มีตอนใน Workspace นี้', 'error'); return; }
  openReaderFull(ch.id);
}

function openReaderFromModal() {
  const id = S.editingChapterId;
  closeModal('modal-view-chapter');
  if (id) openReaderFull(id);
}

function closeReader(fromPopstate = false) {
  if (!rState.active) return;
  readerSavePosition(true);
  readerCancelPrefetch();
  rState.active = false;
  document.getElementById('readerOverlay').style.display = 'none';
  if (rState._pushedHistory && !fromPopstate) { try { history.back(); } catch {} }
  rState._pushedHistory = false;
  if (S.currentTab === 'chapters') renderChapters();
  // อยู่แท็บ อ่าน/แก้ไข → เปิดตอนที่อ่านค้างในเต็มจอ (และคำแปลที่ prefetch มาแล้ว)
  if (S.currentTab === 'read' && rState.chapterId) { reState.chapterId = rState.chapterId; renderReadTab(); }   // renderReadTab = รีเฟรชป้าย "ยังไม่แปล" ด้วย
}

function readerRenderChapter(ch) {
  rState.chapterId = ch.id;
  document.getElementById('readerChTitle').textContent = `#${ch.chapterNum || '?'} ${ch.title || ''}`;
  const el = document.getElementById('readerContent');
  if (ch.translation?.trim()) {
    el.innerHTML = `<h2 class="reader-h2">${esc(ch.title || '')}</h2>` +
      ch.translation.split(/\n+/).map(p => p.trim()).filter(Boolean)
        .map(p => `<p>${esc(p)}</p>`).join('');
  } else {
    el.innerHTML = `<div class="reader-empty">
      <div style="font-size:2rem">📖</div>
      <div>ตอนนี้ยังไม่ได้แปล</div>
      ${ch.sourceText?.trim()
        ? `<button class="reader-nav-btn" style="font-size:0.9rem" onclick="readerTranslateCurrent()">⚡ แปลตอนนี้</button>`
        : `<div style="font-size:0.8rem">ไม่มีต้นฉบับ — เพิ่มต้นฉบับในแท็บ "ตอน" ก่อน</div>`}
    </div>`;
  }
  readerUpdateNav();
}

function readerUpdateNav() {
  const sorted = _getSortedChapters();
  const idx = sorted.findIndex(c => c.id === rState.chapterId);
  rState._navIdx = idx;
  rState._navTotal = sorted.length;
  const prev = document.getElementById('readerPrevBtn');
  const next = document.getElementById('readerNextBtn');
  if (prev) prev.disabled = idx <= 0;
  if (next) next.disabled = idx >= sorted.length - 1;
  readerUpdateProgress();
}

function readerUpdateProgress() {
  const scroller = document.getElementById('readerScroll');
  const label = document.getElementById('readerProgressLabel');
  if (!scroller || !label) return;
  const denom = scroller.scrollHeight - scroller.clientHeight;
  const pct = denom > 0 ? Math.min(100, Math.round(scroller.scrollTop / denom * 100)) : 100;
  label.textContent = rState._navTotal
    ? `ตอน ${rState._navIdx + 1}/${rState._navTotal} · ${pct}%` : '';
}

function readerNav(dir) {
  const sorted = _getSortedChapters();
  const idx = sorted.findIndex(c => c.id === rState.chapterId);
  const next = sorted[idx + dir];
  if (!next) return;
  readerRenderChapter(next);
  document.getElementById('readerScroll').scrollTop = 0;
  readerSavePosition(true);
  readerKickPrefetch();
}

// debounce 2s ระหว่าง scroll / ทันทีเมื่อ immediate (ปิด reader, เปลี่ยนตอน)
function readerSavePosition(immediate = false) {
  if (!S.currentWs || !rState.chapterId) return;
  const scroller = document.getElementById('readerScroll');
  const denom = scroller.scrollHeight - scroller.clientHeight;
  S.currentWs.readerPosition = {
    chapterId: rState.chapterId,
    scrollPct: denom > 0 ? Math.min(1, scroller.scrollTop / denom) : 0,
    updatedAt: Date.now(),
  };
  clearTimeout(rState._scrollTimer);
  if (immediate) lsSaveWorkspace(S.currentWs).catch(() => {});
  else rState._scrollTimer = setTimeout(() => lsSaveWorkspace(S.currentWs).catch(() => {}), 2000);
}

// ── Reader settings ──
function readerToggleSettings() {
  const bar = document.getElementById('readerSettingsBar');
  bar.style.display = bar.style.display === 'none' ? 'flex' : 'none';
}

function readerSaveSettings(patch) {
  if (!S.currentWs) return;
  S.currentWs.readerSettings = { ...readerGetSettings(), ...patch };
  readerApplySettings();
  lsSaveWorkspace(S.currentWs).catch(() => {});
}

function readerSetFontSize(delta) {
  const cur = readerGetSettings().fontSize;
  readerSaveSettings({ fontSize: Math.min(28, Math.max(16, cur + delta)) });
}
function readerSetLineHeight(v) { readerSaveSettings({ lineHeight: parseFloat(v) || READER_DEFAULTS.lineHeight }); }
function readerSetTheme(t) { readerSaveSettings({ theme: ['light','sepia','dark'].includes(t) ? t : 'sepia' }); }
function readerSetPrefetchCount(v) {
  readerSaveSettings({ prefetchCount: Math.min(2, Math.max(0, parseInt(v) || 0)) });
  readerKickPrefetch();
}

function readerApplySettings() {
  const s = readerGetSettings();
  const ov = document.getElementById('readerOverlay');
  ov.classList.remove('reader-theme-light', 'reader-theme-sepia', 'reader-theme-dark');
  ov.classList.add('reader-theme-' + s.theme);
  const content = document.getElementById('readerContent');
  content.style.fontSize = s.fontSize + 'px';
  content.style.lineHeight = s.lineHeight;
  document.getElementById('readerFontSizeVal').textContent = s.fontSize;
  document.getElementById('readerLineHeight').value = String(s.lineHeight);
  document.getElementById('readerPrefetchCount').value = String(s.prefetchCount);
  document.querySelectorAll('.reader-theme-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.theme === s.theme));
}

// ── Reader Prefetch ──
// แปลตอนถัดไปล่วงหน้า "ทีละตอนเรียงลำดับ" เสมอ — auto-glossary + context summary
// ของตอน N ต้องเสร็จก่อนเริ่มตอน N+1 (awaitGlossary:true) ไม่งั้นความต่อเนื่องพัง
// กติการ่วม: ระบบแปลทำงานพร้อมกันได้ทีละราย (manual/batch/marathon/prefetch) — prefetch ยอมถอยเสมอ

function readerSetChip(text) {
  const chip = document.getElementById('readerPrefetchChip');
  if (!chip) return;
  chip.textContent = text;
  chip.style.display = text ? '' : 'none';
}

function readerPickPrefetchTarget() {
  const count = readerGetSettings().prefetchCount;
  if (!count) return null;
  const sorted = _getSortedChapters();
  const idx = sorted.findIndex(c => c.id === rState.chapterId);
  if (idx < 0) return null;
  for (let i = idx + 1; i <= idx + count && i < sorted.length; i++) {
    const ch = sorted[i];
    if (ch.status === 'translated') continue;
    if (!ch.sourceText?.trim()) continue;
    return ch;
  }
  return null;
}

function readerKickPrefetch() {
  if (!rState.active) return;
  if (rState.prefetch.state !== 'IDLE') return; // worker เดียวเสมอ
  readerPrefetchWorker();
}

async function readerPrefetchWorker() {
  const pf = rState.prefetch;
  pf.state = 'SCANNING';
  pf.retries = 0;
  try {
    while (rState.active) {
      if (S.translating) break;       // งานแปลอื่นมาก่อน — prefetch ถอย
      if (!getApiKey()) break;
      const ch = readerPickPrefetchTarget();
      if (!ch) break;
      pf.chapterId = ch.id;
      pf.ctrl = new AbortController();
      pf.state = 'TRANSLATING';
      let chars = 0;
      readerSetChip(`⚡ กำลังแปลตอนถัดไป #${ch.chapterNum || '?'}…`);
      try {
        await translateChapterCore(ch, {
          signal: pf.ctrl.signal,
          awaitGlossary: true,
          onDelta: d => {
            chars += d.length;
            readerSetChip(`⚡ กำลังแปลตอนถัดไป #${ch.chapterNum || '?'}… ${chars.toLocaleString()} ตัว`);
          },
        });
        pf.retries = 0;
        readerSetChip(`✓ #${ch.chapterNum || '?'} พร้อมอ่าน · รวม ${fmtUSD(S.costs.costUSD)}`);
        readerUpdateNav();
        if (S.currentTab === 'chapters') renderChapters();
      } catch (err) {
        if (err.name === 'AbortError' || !rState.active) { readerSetChip(''); break; }
        pf.retries++;
        if (pf.retries > 2) {
          readerSetChip(`✗ แปลล่วงหน้าไม่สำเร็จ: ${err.message}`);
          break;
        }
        readerSetChip(`↻ แปล #${ch.chapterNum || '?'} ไม่สำเร็จ — ลองใหม่ (${pf.retries}/2)…`);
        await new Promise(r => setTimeout(r, 2500 * pf.retries));
      } finally {
        pf.ctrl = null;
        pf.chapterId = null;
      }
      pf.state = 'SCANNING';
    }
  } finally {
    pf.state = 'IDLE';
    pf.ctrl = null;
    pf.chapterId = null;
  }
}

// ยกเลิก: แค่ abort — worker จะจัดการ state ของตัวเองใน finally (กัน worker ซ้อน)
function readerCancelPrefetch() {
  if (rState.prefetch.ctrl) { try { rState.prefetch.ctrl.abort(); } catch {} }
  readerSetChip('');
}

// แปลตอนที่กำลังเปิดอ่าน — stream สดให้อ่านไประหว่างแปล
async function readerTranslateCurrent() {
  const ch = S.currentWs?.chapters?.find(c => c.id === rState.chapterId);
  if (!ch || !ch.sourceText?.trim()) return;
  if (!getApiKey()) { showToast('ยังไม่ได้ตั้ง API Key — ไปที่ ⚙ ตั้งค่า', 'error'); return; }
  if (S.translating) { showToast('มีงานแปลอื่นทำงานอยู่ — รอสักครู่แล้วลองใหม่', 'error'); return; }
  if (rState.prefetch.state === 'TRANSLATING') readerCancelPrefetch();

  const el = document.getElementById('readerContent');
  el.innerHTML = `<h2 class="reader-h2">${esc(ch.title || '')}</h2>
    <div style="text-align:center;margin-bottom:1.2em">
      <button class="reader-nav-btn" onclick="readerCancelCurrentTranslate()">⬛ หยุดแปล</button>
    </div>
    <div id="readerLiveText" style="white-space:pre-wrap"></div>`;
  const live = document.getElementById('readerLiveText');
  const scroller = document.getElementById('readerScroll');

  rState.prefetch.state = 'TRANSLATING';
  rState.prefetch.chapterId = ch.id;
  rState.prefetch.ctrl = new AbortController();
  try {
    await translateChapterCore(ch, {
      signal: rState.prefetch.ctrl.signal,
      awaitGlossary: true,
      onDelta: d => {
        if (!live.isConnected) return;
        // ตามท้ายข้อความเฉพาะตอนผู้อ่านอยู่ใกล้ก้นจอ (ไม่แย่ง scroll)
        const nearBottom = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 160;
        live.textContent += d;
        if (nearBottom) scroller.scrollTop = scroller.scrollHeight;
      },
    });
    readerRenderChapter(ch);
    if (S.currentTab === 'chapters') renderChapters();
    qualityQuickCheck(ch.sourceText, ch.translation);
  } catch (err) {
    if (err.name !== 'AbortError') showToast(`แปลไม่สำเร็จ: ${err.message}`, 'error');
    readerRenderChapter(ch);
  } finally {
    rState.prefetch.state = 'IDLE';
    rState.prefetch.ctrl = null;
    rState.prefetch.chapterId = null;
  }
  readerKickPrefetch();
}

function readerCancelCurrentTranslate() {
  if (rState.prefetch.ctrl) { try { rState.prefetch.ctrl.abort(); } catch {} }
}

// ── init listeners ──
(function readerInit() {
  const scroller = document.getElementById('readerScroll');
  if (scroller) scroller.addEventListener('scroll', () => {
    if (rState.active) { readerSavePosition(); readerUpdateProgress(); }
  });
  document.addEventListener('keydown', e => {
    if (!rState.active) return;
    const tag = e.target?.tagName;
    if (e.key === 'Escape') closeReader();
    else if (tag !== 'SELECT' && tag !== 'INPUT' && tag !== 'TEXTAREA') {
      if (e.key === 'ArrowRight') readerNav(1);
      else if (e.key === 'ArrowLeft') readerNav(-1);
    }
  });
  window.addEventListener('popstate', () => { if (rState.active) closeReader(true); });
})();

// ═══════════════════════════════════════════════
// ─── Pronoun / Gender + ครับ/ค่ะ Consistency Check ───
// ═══════════════════════════════════════════════
// สแกน local ล้วนๆ (ไม่เรียก AI ไม่มีค่าใช้จ่าย) — เป็นการเดาเบื้องต้น ควรเปิดดูบริบทจริงก่อนแก้

const _PRONOUN_MALE   = ['เขา'];
const _PRONOUN_FEMALE = ['เธอ', 'นาง', 'หล่อน'];
// คำประสมที่มีตัวอักษรของสรรพนามอยู่ข้างใน แต่ไม่ใช่สรรพนาม (ภูเขา, นางฟ้า ฯลฯ) — ปิดทับก่อนนับ
const _PRONOUN_COMPOUNDS = [
  'ภูเขา', 'หุบเขา', 'เขาวงกต', 'ยอดเขา', 'เทือกเขา', 'เชิงเขา', 'ไหล่เขา', 'ตีนเขา', 'แนวเขา', 'ซอกเขา', 'เขาสัตว์', 'ภูผาเขา',
  'นางฟ้า', 'นางสาว', 'นางกำนัล', 'นางเอก', 'นางร้าย', 'นางพญา', 'นางสนม', 'นางใน', 'นางงาม', 'นางพยาบาล', 'นางแบบ', 'นางเงือก', 'นางนวล', 'นางรำ', 'นางแมว', 'นางสิงห์', 'นางมาร', 'นางไม้',
];

// แทนที่คำที่กำหนดด้วยช่องว่างความยาวเท่าเดิม (ตำแหน่งตัวอักษรไม่เลื่อน)
function _maskWords(text, words) {
  let out = text;
  for (const w of words) if (w && out.includes(w)) out = out.split(w).join(' '.repeat(w.length));
  return out;
}

function _allIndexes(text, word, limit = 5000) {
  const pos = [];
  let idx = text.indexOf(word);
  while (idx !== -1 && pos.length < limit) { pos.push(idx); idx = text.indexOf(word, idx + word.length); }
  return pos;
}

function pronounScanChapter(ch, characters) {
  const text = ch.translation || '';
  if (!text.trim()) return [];
  const base = _maskWords(text, _PRONOUN_COMPOUNDS);
  const issues = [];
  for (const g of characters) {
    const name = g.thai;
    // หาตำแหน่งชื่อทั้งหมด (จำกัด 200 จุดกันตอนยาวผิดปกติ)
    const pos = _allIndexes(text, name, 200);
    if (!pos.length) continue;
    // ปิดชื่อตัวเองด้วย กันสรรพนามที่อยู่ "ในชื่อ" ถูกนับ
    const masked = _maskWords(base, [name]);
    const malePos   = _PRONOUN_MALE.flatMap(w => _allIndexes(masked, w));
    const femalePos = _PRONOUN_FEMALE.flatMap(w => _allIndexes(masked, w));

    // นับแต่ละตำแหน่งครั้งเดียว แม้หน้าต่างรอบชื่อจะซ้อนกัน
    const inAnyWindow = (q) => pos.some(p => q >= p - 120 && q < p + name.length + 120);
    const male   = malePos.filter(inAnyWindow).length;
    const female = femalePos.filter(inAnyWindow).length;

    const expectMale = g.gender === 'male';
    const wrong = expectMale ? female : male;
    const right = expectMale ? male : female;
    const total = wrong + right;
    // threshold: มีสรรพนามรวม ≥3 และฝั่งผิดเกิน 40% — กัน false positive จากบทสนทนา
    if (total >= 3 && wrong / total > 0.4) {
      const samples = [];
      const wrongWords = expectMale ? _PRONOUN_FEMALE : _PRONOUN_MALE;
      for (const p of pos) {
        if (samples.length >= 2) break;
        const s0 = Math.max(0, p - 120), s1 = p + name.length + 120;
        if (wrongWords.some(w => masked.slice(s0, s1).includes(w))) samples.push('…' + text.slice(s0, s1).trim().slice(0, 160) + '…');
      }
      issues.push({ name, gender: g.gender, wrong, right, samples });
    }
  }
  return issues;
}

// ── ครับ/ค่ะ ──
const _QUOTE_RE = /[“"「『‘]([^“”"「」『』‘’\n]{1,600})[”"」』’]/g;
const _PARTICLE_END = '(?=$|[\\s!?.…,~ๆ\\-—)])';
const _MALE_PARTICLE_RE   = new RegExp('(ครับ(?:ผม)?|ขอรับ|\\u0000M\\u0000)' + _PARTICLE_END, 'g');
const _FEMALE_PARTICLE_RE = new RegExp('(เจ้าค่ะ|ค่ะ|คะ|เพคะ)' + _PARTICLE_END, 'g');
// ผม = "เส้นผม" ได้ด้วย — ปิดคำที่เกี่ยวกับผม (hair) ก่อนเช็คสรรพนามตัวเอง
const _HAIR_WORDS = ['เส้นผม', 'ทรงผม', 'สระผม', 'หวีผม', 'ผมเผ้า', 'ผมยาว', 'ผมสั้น', 'ผมสี', 'ปอยผม', 'มัดผม', 'ผมหงอก', 'ผมดำ', 'ผมทอง', 'ผมขาว', 'ผมแดง', 'ผมเงิน', 'ไรผม', 'โคนผม', 'ปลายผม', 'เกล้าผม', 'ถักผม'];
const _SPEECH_VERBS = ['กล่าว', 'พูด', 'ตอบ', 'ถาม', 'เอ่ย', 'ตะโกน', 'กระซิบ', 'บอก', 'ร้อง', 'พึมพำ', 'ตะคอก', 'ว่า', 'แย้ง', 'สั่ง', 'อธิบาย'];
const _GENDER_TH = { male: 'ชาย', female: 'หญิง' };

// นับคำลงท้ายแต่ละเพศในบทพูด 1 ประโยค (พ่ะย่ะค่ะ = ราชาศัพท์ของผู้ชาย ต้องแปลงก่อนนับ ค่ะ)
function _particleCounts(quote) {
  const t = quote.replace(/พ่ะย่ะค่ะ|พะยะค่ะ/g, '\u0000M\u0000');
  return {
    male:   (t.match(_MALE_PARTICLE_RE)   || []).length,
    female: (t.match(_FEMALE_PARTICLE_RE) || []).length,
  };
}

// หาผู้พูดจากแท็กบทพูดที่ติดกับเครื่องหมายคำพูด เช่น  ลีน่ากล่าว “…”  หรือ  “…” ลีน่าตอบ
function _findSpeaker(text, qStart, qEnd, characters) {
  const before = text.slice(Math.max(0, qStart - 80), qStart);
  const after  = text.slice(qEnd, qEnd + 80);
  const lineBefore = before.slice(before.lastIndexOf('\n') + 1);
  const lineAfter  = after.split('\n')[0];
  let best = null;
  for (const g of characters) {
    // ชื่อก่อนเครื่องหมายคำพูด: ระหว่างชื่อกับ quote ต้องมีคำกริยาพูด และไม่มี quote อื่นคั่น
    const bi = lineBefore.lastIndexOf(g.thai);
    if (bi !== -1) {
      const gap = lineBefore.slice(bi + g.thai.length);
      const dist = gap.length;
      if (dist <= 40 && !/[“”"「」『』]/.test(gap) && _SPEECH_VERBS.some(v => gap.includes(v))
          && (!best || dist < best.dist || (dist === best.dist && g.thai.length > best.g.thai.length))) best = { g, dist };
    }
    // ชื่อหลังเครื่องหมายคำพูด: อยู่ใกล้ (≤30) และตามด้วยคำกริยาพูด
    const ai = lineAfter.indexOf(g.thai);
    if (ai !== -1 && ai <= 30 && !/[“”"「」『』]/.test(lineAfter.slice(0, ai))) {
      const tail = lineAfter.slice(ai + g.thai.length, ai + g.thai.length + 20);
      if (_SPEECH_VERBS.some(v => tail.includes(v))
          && (!best || ai < best.dist || (ai === best.dist && g.thai.length > best.g.thai.length))) best = { g, dist: ai };
    }
  }
  return best ? best.g : null;
}

// คืนรายการจุดน่าสงสัย: level 'high' = ขัดกันเองในบทพูดเดียว (แม่นมาก) · 'mid' = ขัดกับเพศผู้พูดใน glossary
function particleScanText(text, characters = []) {
  if (!text || !text.trim()) return [];
  const issues = [];
  _QUOTE_RE.lastIndex = 0;
  let m;
  while ((m = _QUOTE_RE.exec(text)) && issues.length < 500) {
    const quote = m[1];
    const pc = _particleCounts(quote);
    if (!pc.male && !pc.female) continue;
    const base = { quote, index: m.index };

    if (pc.male && pc.female) {
      issues.push({ ...base, level: 'high', reason: 'ใช้ทั้ง "ครับ" และ "ค่ะ/คะ" ในบทพูดเดียว' });
      continue;
    }
    const q = _maskWords(quote, _HAIR_WORDS);
    const maleSelf   = /(^|[\s“"「『‘])(กระผม|ผม)/.test(q);
    const femaleSelf = /(ดิฉัน|อิฉัน)/.test(q);
    if (pc.female && maleSelf && !femaleSelf && !/(ฉัน|หนู)/.test(q)) {
      issues.push({ ...base, level: 'high', reason: 'แทนตัวว่า "ผม" แต่ลงท้าย "ค่ะ/คะ"' });
      continue;
    }
    if (pc.male && femaleSelf && !maleSelf) {
      issues.push({ ...base, level: 'high', reason: 'แทนตัวว่า "ดิฉัน" แต่ลงท้าย "ครับ"' });
      continue;
    }
    if (characters.length) {
      const sp = _findSpeaker(text, m.index, m.index + m[0].length, characters);
      const pg = pc.male ? 'male' : 'female';
      if (sp && (sp.gender === 'male' || sp.gender === 'female') && sp.gender !== pg) {
        issues.push({ ...base, level: 'mid', speaker: sp.thai,
          reason: `ผู้พูด "${sp.thai}" เป็น${_GENDER_TH[sp.gender]} แต่ลงท้าย "${pc.male ? 'ครับ' : 'ค่ะ/คะ'}"` });
      }
    }
  }
  return issues;
}

function _genderedCharacters() {
  return (S.currentWs?.glossary || []).filter(g =>
    g.type === 'character' && (g.gender === 'male' || g.gender === 'female') && g.thai);
}

function particleHighCount(text) {
  try { return particleScanText(text, _genderedCharacters()).length; } catch { return 0; }
}

// เรียกหลังแปลเสร็จ — เตือนถ้ามี ครับ/ค่ะ น่าสงสัย (หน่วงไว้ไม่ให้ทับ toast "แปลเสร็จ")
// ตรวจหลังแปล (local): ครับ/ค่ะ น่าสงสัย + คำไม่ตรงคลังศัพท์ → toast เดียว (กัน toast ทับกัน)
function qualityQuickCheck(srcText, text) {
  const n = particleHighCount(text);
  const miss = glossaryMisses(srcText, text);
  const parts = [];
  if (n) parts.push(`ครับ/ค่ะ น่าสงสัย ${n} จุด (ดู 🚻 แท็บคลังศัพท์)`);
  if (miss.length) parts.push(`ไม่ตรงคลังศัพท์ ${miss.length} คำ: ${miss.slice(0, 4).map(m => `${m.korean}→${m.thai}`).join(', ')}${miss.length > 4 ? ' …' : ''}`);
  if (parts.length) setTimeout(() => showToast('⚠ ' + parts.join(' · '), 'error'), 1800);
  return { particles: n, misses: miss };
}

function particleQuickCheck(text) {
  const n = particleHighCount(text);
  if (n) setTimeout(() => showToast(`⚠ ครับ/ค่ะ น่าสงสัย ${n} จุด — ตรวจที่ 🚻 สรรพนาม/ครับ-ค่ะ (แท็บคลังศัพท์)`, 'error'), 1800);
  return n;
}

function openPronounCheck() {
  if (!S.currentWs) { showToast('เลือก Workspace ก่อน', 'error'); return; }
  const characters = _genderedCharacters();
  const box = document.getElementById('pronounCheckResults');
  const chapters = _getSortedChapters();

  // ── สรรพนาม ──
  const pRows = [];
  if (characters.length) {
    for (const ch of chapters) for (const it of pronounScanChapter(ch, characters)) pRows.push({ ch, ...it });
  }
  // ── ครับ/ค่ะ ──
  const kRows = [];
  for (const ch of chapters) {
    for (const it of particleScanText(ch.translation || '', characters)) {
      kRows.push({ ch, ...it });
      if (kRows.length >= 300) break;
    }
    if (kRows.length >= 300) break;
  }
  kRows.sort((a, b) => (a.level === b.level ? 0 : a.level === 'high' ? -1 : 1));

  const sec = (title) => `<div style="font-weight:600;font-size:0.84rem;margin:6px 0 2px">${title}</div>`;
  const okMsg = (msg) => `<div style="color:#4caf50;font-size:0.82rem;padding:8px 14px">✓ ${msg}</div>`;
  const chLabel = (ch) => `ตอน #${ch.chapterNum || '?'} ${esc((ch.title || '').slice(0, 24))}`;

  let html = sec(`🚻 สรรพนามขัดกับเพศ (${pRows.length})`);
  if (!characters.length) {
    html += '<div style="color:var(--text-muted);font-size:0.8rem;padding:8px 14px">ไม่มีตัวละครที่ระบุเพศใน Glossary — เพิ่มคำศัพท์ประเภท "ตัวละคร" พร้อมเพศก่อน (ใช้ทั้งตรวจสรรพนาม และหาผู้พูดของ ครับ/ค่ะ)</div>';
  } else if (!pRows.length) {
    html += okMsg('ไม่พบสรรพนามขัดแย้งกับเพศของตัวละคร');
  } else {
    html += pRows.map(r => `
    <div style="border:1px solid var(--border);border-radius:var(--radius);padding:10px;background:var(--bg-deep)">
      <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
        <b>${esc(r.name)}</b>
        <span class="tag tag-term" style="font-size:0.66rem">เพศ${_GENDER_TH[r.gender]}</span>
        <span style="font-size:0.76rem;color:var(--crimson-light)">สรรพนามเพศตรงข้าม ${r.wrong} ครั้งใกล้ชื่อ (ตรงเพศ ${r.right})</span>
        <span style="font-size:0.74rem;color:var(--text-muted)">${chLabel(r.ch)}</span>
        <button class="btn-xs" style="margin-left:auto" data-name="${esc(r.name)}"
          onclick="closeModal('modal-pronoun-check');openReviewSearch(this.dataset.name)">🔎 ตรวจใน Review</button>
      </div>
      ${r.samples.map(s => `<div style="font-size:0.74rem;color:var(--text-secondary);margin-top:6px;padding:6px;background:var(--surface-2);border-radius:4px;line-height:1.6">${esc(s)}</div>`).join('')}
    </div>`).join('');
  }

  html += sec(`💬 ครับ/ค่ะ ไม่ตรงผู้พูด (${kRows.length}${kRows.length >= 300 ? '+' : ''})`);
  if (!kRows.length) {
    html += okMsg('ไม่พบ ครับ/ค่ะ ที่น่าสงสัย');
  } else {
    html += kRows.map(r => {
      // ใช้ส่วนต้นของบทพูดเป็นคำค้น (ตรงกับข้อความจริงแน่นอน)
      const needle = r.quote.trim().slice(0, 40);
      return `
    <div style="border:1px solid var(--border);border-radius:var(--radius);padding:10px;background:var(--bg-deep)">
      <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
        <span class="tag ${r.level === 'high' ? 'tag-monster' : 'tag-term'}" style="font-size:0.66rem">${r.level === 'high' ? 'ชัดเจน' : 'น่าสงสัย'}</span>
        <span style="font-size:0.76rem;color:var(--crimson-light)">${esc(r.reason)}</span>
        <span style="font-size:0.74rem;color:var(--text-muted)">${chLabel(r.ch)}</span>
        <button class="btn-xs" style="margin-left:auto" data-q="${esc(needle)}"
          onclick="closeModal('modal-pronoun-check');openReviewSearch(this.dataset.q)">🔎 แก้ใน Review</button>
      </div>
      <div style="font-size:0.74rem;color:var(--text-secondary);margin-top:6px;padding:6px;background:var(--surface-2);border-radius:4px;line-height:1.6">“${esc(r.quote.slice(0, 200))}${r.quote.length > 200 ? '…' : ''}”</div>
    </div>`;
    }).join('');
  }

  box.innerHTML = html;
  openModal('modal-pronoun-check');
}
