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
  const systemPrompt = applyConsistencyLock(presetBase.systemPrompt, ws);
  const temperature  = presetBase.temperature;
  const useModel = model || ws.settings?.translateModel || document.getElementById('translateModel')?.value || 'google/gemini-2.5-flash';

  const smartGloss  = getSmartGlossary(ch.sourceText, S.glossaryData);
  const glossObj    = smartGloss.reduce(function(a, g) { a[g.korean] = { thai: g.thai, type: g.type, note: g.note, gender: g.gender }; return a; }, {});
  const glossaryStr = buildGlossaryStr(glossObj);
  const mtlDraft    = presetIsMtlFix(presetBase) ? (ch.translation || '') : '';

  const prompt = systemPrompt
    .replace('{style_note}', '')
    .replace('{glossary}',   glossaryStr || '(ไม่มี)')
    .replace('{context}',    ctxGetPromptText(ws) || '')
    .replace('{text}',       prepareSourceForTranslation(ch.sourceText))
    .replace('{mtl_draft}',  mtlDraft || '(ไม่มี MTL draft)');

  // timeout ภายใน + เคารพ signal จาก caller (เดิม path Marathon ไม่มี timeout เลย — slot ค้างได้)
  const _ctrl = new AbortController();
  const _onAbort = () => _ctrl.abort();
  if (signal) {
    if (signal.aborted) _ctrl.abort();
    else signal.addEventListener('abort', _onAbort, { once: true });
  }
  const _timer = setTimeout(() => _ctrl.abort(), getTimeoutMs('full'));

  let inTok = 0, outTok = 0;
  let fullText = '';
  try {
    fullText = await aiStream(
      { model: useModel, temperature: temperature, max_tokens: Math.max(16000, Math.ceil(ch.sourceText.length * 4)), messages: [{ role: 'user', content: prompt }] },
      onDelta || function() {},
      function(i, o) { inTok = i; outTok = o; },
      _ctrl.signal
    );
  } finally {
    clearTimeout(_timer);
    if (signal) signal.removeEventListener('abort', _onAbort);
    if (inTok || outTok) addCosts(inTok, outTok, useModel);
  }

  if (!fullText || !fullText.trim()) throw new Error('AI ส่งผลลัพธ์ว่าง');

  if (presetBase.polish) {
    try {
      const pr = await callOpenRouter({
        model: useModel,
        messages: [{ role: 'user', content: POLISH_PROMPT.replace('{glossary}', glossaryStr).replace('{text}', fullText) }],
        temperature: 0.5,
        max_tokens: Math.max(3000, Math.ceil(fullText.length * 1.2)),
      });
      fullText = pr.choices?.[0]?.message?.content?.trim() || fullText;
    } catch (e) { /* polish failed, use unpolished */ }
  }

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
  if (ch && ws) { ws.readerPosition = { ...(ws.readerPosition || {}), chapterId: ch.id }; lsSaveWorkspace(ws).catch(() => {}); }

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
      const paras = ch.translation.split(/\n/).map(p => p.trim() ? `<p>${esc(p)}</p>` : '<br>').join('');
      content.innerHTML = `<h2 class="re-title">${esc(ch.title || '')}</h2>${paras}`;
    } else {
      content.innerHTML = `<h2 class="re-title">${esc(ch.title || '')}</h2><div class="re-empty">ตอนนี้ยังไม่ได้แปล — กด <strong>⚡ แปลตอนนี้</strong> ด้านบน</div>`;
    }
  }
  reUpdateCharStats();
  reHighlightCount();
}

function reNav(dir) {
  const chs = _getSortedChapters();
  const idx = chs.findIndex(c => c.id === reState.chapterId);
  const ni = idx + dir;
  if (ni < 0 || ni >= chs.length) return;
  reLoadChapter(chs[ni].id);
}

function reSetMode(mode) {
  // ถ้ากำลังแก้ไขแล้วมีข้อความค้าง ให้เตือนบันทึกก่อนสลับไปอ่าน
  if (reState.mode === 'edit' && mode === 'read') {
    const ch = S.currentWs?.chapters?.find(c => c.id === reState.chapterId);
    const cur = document.getElementById('reEditArea')?.value ?? '';
    if (ch && cur !== (ch.translation || '') && !confirm('มีการแก้ไขที่ยังไม่บันทึก — ทิ้งการแก้ไข?')) return;
  }
  reState.mode = mode;
  reLoadChapter(reState.chapterId);
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

function openReaderResume() {
  const ws = S.currentWs;
  if (!ws) { showToast('เลือก Workspace ก่อน', 'error'); return; }
  const pos = ws.readerPosition;
  let ch = pos ? ws.chapters?.find(c => c.id === pos.chapterId) : null;
  if (!ch) ch = _getSortedChapters()[0];
  if (!ch) { showToast('ยังไม่มีตอนใน Workspace นี้', 'error'); return; }
  openReader(ch.id);
}

function openReaderFromModal() {
  const id = S.editingChapterId;
  closeModal('modal-view-chapter');
  if (id) openReader(id);
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
// ─── Pronoun / Gender Consistency Check ─────────
// ═══════════════════════════════════════════════
// สแกน local ล้วนๆ (ไม่เรียก AI ไม่มีค่าใช้จ่าย): นับสรรพนามบุรุษที่ 3
// ในหน้าต่าง ±120 ตัวอักษรรอบชื่อตัวละคร แล้วเทียบกับเพศใน Glossary

const _PRONOUN_MALE   = ['เขา'];
const _PRONOUN_FEMALE = ['เธอ', 'นาง', 'หล่อน'];

function pronounScanChapter(ch, characters) {
  const text = ch.translation || '';
  if (!text.trim()) return [];
  const issues = [];
  for (const g of characters) {
    const name = g.thai;
    // หาตำแหน่งชื่อทั้งหมด (จำกัด 200 จุดกันตอนยาวผิดปกติ)
    const pos = [];
    let idx = text.indexOf(name);
    while (idx !== -1 && pos.length < 200) { pos.push(idx); idx = text.indexOf(name, idx + name.length); }
    if (!pos.length) continue;

    let male = 0, female = 0;
    for (const p of pos) {
      const win = text.slice(Math.max(0, p - 120), p + name.length + 120);
      for (const w of _PRONOUN_MALE)   male   += win.split(w).length - 1;
      for (const w of _PRONOUN_FEMALE) female += win.split(w).length - 1;
    }
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
        const win = text.slice(Math.max(0, p - 120), p + name.length + 120);
        if (wrongWords.some(w => win.includes(w))) samples.push('…' + win.trim().slice(0, 160) + '…');
      }
      issues.push({ name, gender: g.gender, wrong, right, samples });
    }
  }
  return issues;
}

function openPronounCheck() {
  if (!S.currentWs) { showToast('เลือก Workspace ก่อน', 'error'); return; }
  const characters = (S.currentWs.glossary || []).filter(g =>
    g.type === 'character' && (g.gender === 'male' || g.gender === 'female') && g.thai);
  const box = document.getElementById('pronounCheckResults');

  if (!characters.length) {
    box.innerHTML = '<div style="color:var(--text-muted);font-size:0.8rem;padding:14px;text-align:center">ไม่มีตัวละครที่ระบุเพศใน Glossary — เพิ่มคำศัพท์ประเภท "ตัวละคร" พร้อมเพศก่อน</div>';
    openModal('modal-pronoun-check');
    return;
  }

  const rows = [];
  for (const ch of _getSortedChapters()) {
    for (const it of pronounScanChapter(ch, characters)) rows.push({ ch, ...it });
  }

  const GENDER_TH = { male: 'ชาย', female: 'หญิง' };
  box.innerHTML = rows.length ? rows.map(r => `
    <div style="border:1px solid var(--border);border-radius:var(--radius);padding:10px;background:var(--bg-deep)">
      <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
        <b>${esc(r.name)}</b>
        <span class="tag tag-term" style="font-size:0.66rem">เพศ${GENDER_TH[r.gender]}</span>
        <span style="font-size:0.76rem;color:var(--crimson-light)">สรรพนามเพศตรงข้าม ${r.wrong} ครั้งใกล้ชื่อ (ตรงเพศ ${r.right})</span>
        <span style="font-size:0.74rem;color:var(--text-muted)">ตอน #${r.ch.chapterNum || '?'} ${esc((r.ch.title || '').slice(0, 24))}</span>
        <button class="btn-xs" style="margin-left:auto" data-name="${esc(r.name)}"
          onclick="closeModal('modal-pronoun-check');openReviewSearch(this.dataset.name)">🔎 ตรวจใน Review</button>
      </div>
      ${r.samples.map(s => `<div style="font-size:0.74rem;color:var(--text-secondary);margin-top:6px;padding:6px;background:var(--surface-2);border-radius:4px;line-height:1.6">${esc(s)}</div>`).join('')}
    </div>`).join('')
    : '<div style="color:#4caf50;font-size:0.84rem;padding:14px;text-align:center">✓ ไม่พบสรรพนามขัดแย้งกับเพศของตัวละคร</div>';
  openModal('modal-pronoun-check');
}
