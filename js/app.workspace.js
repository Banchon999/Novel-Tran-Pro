// ─── Keyboard Shortcuts ───
document.addEventListener('keydown', (e) => {
  const tag = document.activeElement?.tagName;
  const isInput = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';

  // Esc — ปิด modal ที่เปิดอยู่
  if (e.key === 'Escape') {
    const open = document.querySelector('.modal-backdrop.open, .modal-backdrop[style*="flex"]');
    if (open) { closeModal(open.id); e.preventDefault(); return; }
  }

  // Ctrl/Cmd + Enter — เริ่มแปล (เฉพาะใน translate tab)
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
    if (S.currentTab === 'translate' && !S.translating) {
      e.preventDefault();
      const translateBtn = document.getElementById('translateBtn') || document.querySelector('[onclick*="startTranslation"]');
      if (translateBtn && !translateBtn.disabled) translateBtn.click();
    }
    return;
  }

  // Ctrl/Cmd + S — บันทึก chapter (เมื่อ modal-view-chapter เปิด)
  if ((e.ctrlKey || e.metaKey) && e.key === 's') {
    const chModal = document.getElementById('modal-view-chapter');
    if (chModal && (chModal.classList.contains('open') || chModal.style.display !== 'none')) {
      e.preventDefault();
      saveChapter();
    }
    return;
  }

  // Ctrl/Cmd + F — focus search (ใน chapters/glossary tab)
  if ((e.ctrlKey || e.metaKey) && e.key === 'f' && !isInput) {
    const searchBox = S.currentTab === 'glossary'
      ? document.getElementById('glossarySearch')
      : document.getElementById('chapterSearch');
    if (searchBox) { e.preventDefault(); searchBox.focus(); searchBox.select(); }
  }
});

// ─── Init ───
document.addEventListener('DOMContentLoaded', async () => {
  // Load costs (still in localStorage — tiny)
  try { S.costs = JSON.parse(localStorage.getItem(LS_KEY_COSTS)) || S.costs; } catch {}
  loadFetchedModelsCache();   // รายการโมเดลที่เคย fetch ไว้
  updateCostUI();
  checkHealth();
  document.getElementById('sourceText').addEventListener('input', updateSourceStats);

  // Migrate old localStorage data → IndexedDB (runs once)
  await migrateFromLocalStorage();

  await loadWorkspaceList();

  const lastWs = await getLastWs();
  if (lastWs) await selectWorkspace(lastWs);
  else renderProviderUI(); // ไม่มี workspace ก็ยังต้องมีรายการ provider/model ใน quick bar

  checkBackupReminderOnLoad();
});

// ─── Health ───
function checkHealth() {
  const dot = document.getElementById('statusDot');
  const txt = document.getElementById('statusText');
  const provName = getProvider();
  const label = PROVIDERS[provName].label;
  if (getApiKey(provName)) {
    dot.className = 'status-dot ok';
    txt.textContent = `${label}: Key พร้อมใช้`;
  } else {
    dot.className = 'status-dot error';
    txt.textContent = `${label}: ยังไม่ได้ตั้ง Key`;
  }
}

// ─── Sidebar ───
function openSidebar() {
  document.getElementById('sidebar').classList.add('open');
  document.getElementById('sidebarOverlay').classList.add('active');
}
function closeSidebar() {
  document.getElementById('sidebar').classList.remove('open');
  document.getElementById('sidebarOverlay').classList.remove('active');
}

// ─── Workspace List ───
async function loadWorkspaceList() {
  const list = await lsGetWorkspaceList();
  S.wsList = list; // track for backup reminder
  const el = document.getElementById('wsList');
  if (!list.length) {
    el.innerHTML = '<div style="font-size:0.75rem;color:var(--text-muted);padding:6px 0">ยังไม่มี Workspace</div>';
    return;
  }
  el.innerHTML = list.map(w => `
    <div class="ws-item ${S.currentWsId === w.id ? 'active' : ''}" onclick="selectWorkspace('${w.id}')">
      ${coverTileHtml(w.name, w.coverThumb, 'cover-sm')}
      <div class="ws-info">
        <div class="ws-name">${esc(w.name)}</div>
        <div class="ws-meta">${w.chapterCount || 0} ตอน</div>
      </div>
    </div>
  `).join('');
}

async function selectWorkspace(id) {
  // ปิด reader + ยกเลิก prefetch ก่อนสลับ workspace (กันแปลข้ามเรื่อง)
  if (typeof rState !== 'undefined' && rState.active) closeReader();
  const ws = await lsGetWorkspace(id);
  if (!ws) { showToast('ไม่พบ Workspace', 'error'); return; }
  ensureWsStylesPresets(ws);
  S._undoStack = null; // undo เก็บ snapshot ของ workspace เดิม — ห้ามนำไปใช้กับ workspace อื่น
  S.currentWsId = id;
  S.currentWs = ws;
  S.glossaryData = ws.glossary || [];
  await setLastWs(id);
  populateGlossaryTypeSelects(); // custom types ของ workspace นี้ (รวม filter)

  document.getElementById('noWsMsg').style.display = 'none';
  document.getElementById('wsContent').className = 'ws-content-visible';
  setWsHeader(ws);
  updateLangUI(ws);

  renderProviderUI();
  checkHealth();

  // Restore active style (ของผู้ใช้เท่านั้น) — ถ้าไม่พบ ใช้ style แรกที่มี
  const savedStyle = ws.settings?.activeStyleId;
  const styleList = ws.customStyles || [];
  if (savedStyle && styleList.some(s => s.id === savedStyle)) {
    S.activeStyleId = savedStyle;
  } else {
    S.activeStyleId = styleList[0]?.id || '';
  }

  await loadWorkspaceList();
  // reset bulk mode เมื่อเปลี่ยน workspace
  _bulkMode = false;
  const bdb = document.getElementById('bulkDeleteBar');
  const bme = document.getElementById('bulkModeEntryBar');
  if (bdb) bdb.style.display = 'none';
  if (bme) bme.style.display = 'flex';
  renderCurrentTab();
  updateChapterSaveSelect();
  renderStyleSelect();
  closeSidebar();
}

// ─── Tab Switching ───
function switchTab(tab) {
  S.currentTab = tab;
  document.querySelectorAll('.sub-tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.tab-content').forEach(c => c.style.display = 'none');
  document.querySelector(`[data-tab="${tab}"]`).classList.add('active');
  document.getElementById(`tab-${tab}`).style.display = 'flex';
  renderCurrentTab();
}

function renderCurrentTab() {
  switch (S.currentTab) {
    case 'chapters': renderChapters(); break;
    case 'read': renderReadTab(); break;
    case 'glossary': renderGlossaryTable(); break;
    case 'styles': renderStyles(); break;
    case 'settings-ws': renderWsSettings(); break;
  }
}

// ─── Create Workspace ───
async function createWorkspace() {
  const name = document.getElementById('newWsName').value.trim();
  if (!name) { showToast('กรุณาใส่ชื่อนิยาย', 'error'); return; }
  const ws = {
    id: genId(),
    name,
    ...(S._newWsCover ? { cover: S._newWsCover.cover, coverThumb: S._newWsCover.thumb } : {}),
    description: document.getElementById('newWsDesc').value.trim(),
    chapters: [],
    glossary: [],
    customStyles: [],
    presets: [],
    settings: { translateModel: 'deepseek/deepseek-chat', temperature: 0.7, ...(SOURCE_LANGS[document.getElementById('newWsLang')?.value] ? { sourceLang: document.getElementById('newWsLang').value } : {}) },
    createdAt: Date.now(),
  };
  ensureWsStylesPresets(ws);
  await lsSaveWorkspace(ws);
  closeModal('modal-new-ws');
  document.getElementById('newWsName').value = '';
  S._newWsCover = null;
  renderCoverPicker('newWsCover', '', null);
  document.getElementById('newWsDesc').value = '';
  await selectWorkspace(ws.id);
  showToast(`สร้าง "${name}" สำเร็จ`, 'success');
}

async function deleteCurrentWorkspace() {
  if (!S.currentWsId) return;
  if (!confirm(`ลบ "${S.currentWs?.name}" ทั้งหมด? ไม่สามารถกู้คืนได้`)) return;
  await lsDeleteWorkspace(S.currentWsId);
  S.currentWsId = null; S.currentWs = null;
  await clearLastWs();
  document.getElementById('noWsMsg').style.display = 'flex';
  document.getElementById('wsContent').className = 'ws-content-hidden';
  document.getElementById('wsNameHeader').textContent = '—';
  await loadWorkspaceList();
  showToast('ลบ Workspace แล้ว', '');
}

// ─── Workspace Settings ───
function renderWsSettings() {
  if (!S.currentWs) return;
  const w = S.currentWs;
  document.getElementById('wsEditName').value = w.name || '';
  document.getElementById('wsEditDesc').value = w.description || '';
  const sl = document.getElementById('wsSourceLang');
  if (sl) sl.value = SOURCE_LANGS[w.settings?.sourceLang] ? w.settings.sourceLang : '';
  const det = document.getElementById('wsLangDetected');
  if (det) det.textContent = `— ตอนนี้ใช้: ${getSourceLang(w).th}`;
  const gp = document.getElementById('wsGenrePreset');
  if (gp && typeof GENRE_PRESETS !== 'undefined') {
    gp.innerHTML = '<option value="">ไม่ระบุ</option>' + GENRE_PRESETS.map(g => `<option value="${g.id}">${esc(g.name)}</option>`).join('');
    gp.value = w.settings?.genrePreset || '';
  }
  S._coverDraft = undefined;   // undefined = ไม่เปลี่ยน · null = ลบปก · {cover,thumb} = ปกใหม่
  renderCoverPicker('wsCover', w.name, w.cover);
  renderProviderUI();
  const temp = w.settings?.temperature ?? 0.7;
  document.getElementById('wsTemp').value = temp;
  document.getElementById('wsTempVal').textContent = temp;
  const autoGlossary = w.settings?.autoGlossary !== false;
  document.getElementById('wsAutoGlossary').checked = autoGlossary;
  const pcc = document.getElementById('wsPrevCtxChars');
  if (pcc) pcc.value = w.settings?.prevCtxChars || 400;
  // Batch chunking
  const bcMode = document.getElementById('wsBatchChunkMode');
  const bcSize = document.getElementById('wsBatchChunkSize');
  const bcWrap = document.getElementById('wsBatchChunkSizeWrap');
  const bcm = w.settings?.batchChunkMode || 'off';
  if (bcMode) bcMode.value = bcm;
  if (bcSize) bcSize.value = w.settings?.batchChunkSize || 3000;
  if (bcWrap) bcWrap.style.display = bcm === 'off' ? 'none' : 'inline-flex';
  // Consistency Lock
  const clEl  = document.getElementById('wsConsistencyLock');
  const clOpt = document.getElementById('wsConsistencyOptions');
  const clRef = document.getElementById('wsConsistencySelfRef');
  const clOn  = !!w.settings?.consistencyLock;
  if (clEl)  clEl.checked = clOn;
  if (clOpt) clOpt.style.display = clOn ? 'block' : 'none';
  if (clRef) clRef.value = w.settings?.consistencySelfRef || 'auto';
  const smEl = document.getElementById('wsSpeakerMap');
  if (smEl) smEl.checked = w.settings?.speakerMap !== false;
  const stEl = document.getElementById('wsStableTemp');
  if (stEl) stEl.checked = w.settings?.stableTemp !== false;
  wsTempHint();
  renderStyleSheetFields(w);
  const pmEl = document.getElementById('wsProofreadModel');
  if (pmEl) pmEl.value = w.settings?.proofreadModel || ((w.settings?.aiProvider || 'openrouter') === 'openrouter' ? 'google/gemini-3-flash-preview' : 'same');
  renderPresetSelect();
  // Context Memory settings
  const ctx = wsGetContext(w);
  const ctxEnabledEl  = document.getElementById('wsCtxEnabled');
  const ctxOptionsEl  = document.getElementById('wsCtxOptions');
  const ctxMaxTokEl   = document.getElementById('wsCtxMaxTokens');
  if (ctxEnabledEl)  ctxEnabledEl.checked = ctx.enabled;
  if (ctxOptionsEl)  ctxOptionsEl.style.display = ctx.enabled ? 'block' : 'none';
  if (ctxMaxTokEl)   ctxMaxTokEl.value = String(ctx.maxTokens || 1500);
  ctxUpdateStatusBadge(w);
}

// ── คู่มือการแปล (Style Sheet) — ช่องกรอกตาม STYLE_SHEET_FIELDS ──
function renderStyleSheetFields(w = S.currentWs) {
  const box = document.getElementById('wsStyleSheetFields');
  if (!box) return;
  const ss = w?.styleSheet || {};
  box.innerHTML = STYLE_SHEET_FIELDS.map(([k, label, , ph]) => `
    <div>
      <div style="font-size:0.74rem;color:var(--text-secondary);margin-bottom:3px">${esc(label)}</div>
      <textarea id="ss-${k}" class="editor-ta" rows="3" style="min-height:58px;font-size:0.8rem" placeholder="${esc(ph)}">${esc(ss[k] || '')}</textarea>
    </div>`).join('');
}
function readStyleSheetFields() {
  const out = {};
  for (const [k] of STYLE_SHEET_FIELDS) { const v = document.getElementById('ss-' + k)?.value.trim(); if (v) out[k] = v; }
  return out;
}
// คำเตือน temperature สูง (เมื่อไม่ได้เปิดแปลแบบคงที่)
function wsTempHint() {
  const t = parseFloat(document.getElementById('wsTemp')?.value);
  const stable = document.getElementById('wsStableTemp')?.checked;
  const el = document.getElementById('wsTempWarn');
  if (el) el.style.display = (!stable && t > 0.5) ? 'block' : 'none';
}

async function saveWsSettings() {
  if (!S.currentWsId) return;
  S.currentWs.name = document.getElementById('wsEditName').value.trim();
  S.currentWs.description = document.getElementById('wsEditDesc').value.trim();
  if (S._coverDraft === null) { delete S.currentWs.cover; delete S.currentWs.coverThumb; }
  else if (S._coverDraft) { S.currentWs.cover = S._coverDraft.cover; S.currentWs.coverThumb = S._coverDraft.thumb; }
  S._coverDraft = undefined;
  const wsModelVal = document.getElementById('wsTranslateModel').value;
  S.currentWs.settings = {
    ...(S.currentWs.settings || {}),
    aiProvider: document.getElementById('wsProviderSelect')?.value || 'openrouter',
    // '__custom__' ถูก resolve แล้วใน onModelChange — กันค่าหลุดมาที่นี่
    ...(wsModelVal && wsModelVal !== '__custom__' ? { translateModel: wsModelVal } : {}),
    temperature: parseFloat(document.getElementById('wsTemp').value),
    autoGlossary: document.getElementById('wsAutoGlossary').checked,
    prevCtxChars: Math.max(100, Math.min(4000, parseInt(document.getElementById('wsPrevCtxChars')?.value) || 400)),
    consistencyLock: !!document.getElementById('wsConsistencyLock')?.checked,
    consistencySelfRef: document.getElementById('wsConsistencySelfRef')?.value || 'auto',
    speakerMap: document.getElementById('wsSpeakerMap') ? document.getElementById('wsSpeakerMap').checked : true,
    stableTemp: document.getElementById('wsStableTemp') ? document.getElementById('wsStableTemp').checked : true,
    proofreadModel: document.getElementById('wsProofreadModel')?.value || S.currentWs.settings?.proofreadModel,
    batchChunkMode: document.getElementById('wsBatchChunkMode')?.value || 'off',
    batchChunkSize: Math.max(1000, Math.min(20000, parseInt(document.getElementById('wsBatchChunkSize')?.value) || 3000)),
    sourceLang: document.getElementById('wsSourceLang')?.value || '',
    ...(document.getElementById('wsGenrePreset')?.value ? { genrePreset: document.getElementById('wsGenrePreset').value } : {}),
  };
  if (document.getElementById('wsGenrePreset') && !document.getElementById('wsGenrePreset').value) delete S.currentWs.settings.genrePreset;
  if (document.getElementById('wsStyleSheetFields')) S.currentWs.styleSheet = readStyleSheetFields();
  const presetSel = document.getElementById('wsPresetSelect');
  if (presetSel) S.currentWs.presetId = presetSel.value || (S.currentWs.presets?.[0]?.id || '');
  await lsSaveWorkspace(S.currentWs);
  setWsHeader(S.currentWs);
  updateLangUI(S.currentWs);
  const det = document.getElementById('wsLangDetected');
  if (det) det.textContent = `— ตอนนี้ใช้: ${getSourceLang(S.currentWs).th}`;
  await loadWorkspaceList();
  showToast('บันทึกแล้ว ✓', 'success');
}

// ─── Export / Import ───
async function exportWorkspaceJSON() {
  if (!S.currentWs) return;
  const blob = new Blob([JSON.stringify(S.currentWs, null, 2)], { type: 'application/json' });
  downloadBlob(blob, `${S.currentWs.name}_noveltrans.json`);
  _markBackupDone();
  showToast('Export JSON สำเร็จ', 'success');
}

// Export ALL workspaces in one file
async function exportAllWorkspacesJSON() {
  const list = await lsGetWorkspaceList();
  if (!list.length) { showToast('ไม่มี Workspace', 'error'); return; }
  const all = [];
  for (const meta of list) {
    const ws = await lsGetWorkspace(meta.id);
    if (ws) all.push(ws);
  }
  const ts   = new Date().toISOString().slice(0, 16).replace('T', '_').replace(':', '');
  const blob = new Blob([JSON.stringify({ exportedAt: Date.now(), workspaces: all }, null, 2)], { type: 'application/json' });
  downloadBlob(blob, `NovelTrans_ALL_${ts}.json`);
  _markBackupDone();
  showToast(`Export สำเร็จ ${all.length} Workspace ✓`, 'success');
}

// ── Backup reminder system ──
const LS_LAST_BACKUP = 'nt8_last_backup_ts';
const BACKUP_WARN_HOURS = 12; // warn after 12h without backup

function _markBackupDone() {
  localStorage.setItem(LS_LAST_BACKUP, String(Date.now()));
  _updateBackupWarning();
}

function _getLastBackupTs() {
  return parseInt(localStorage.getItem(LS_LAST_BACKUP) || '0', 10);
}

function _updateBackupWarning() {
  const el = document.getElementById('backupWarnBar');
  if (!el) return;
  const ts   = _getLastBackupTs();
  const age  = (Date.now() - ts) / 3600000; // hours
  const list = S.wsList || [];
  if (!list.length) { el.style.display = 'none'; return; }

  if (ts === 0) {
    el.style.display = 'flex';
    el.innerHTML = `<span class="bw-text">ยังไม่เคยสำรองข้อมูล — ข้อมูลอาจหายถ้าเบราว์เซอร์ล้างข้อมูล</span><button class="bw-btn" onclick="exportAllWorkspacesJSON()">สำรองเลย</button>`;
  } else if (age > BACKUP_WARN_HOURS) {
    const h = Math.floor(age);
    el.style.display = 'flex';
    el.innerHTML = `<span class="bw-text">สำรองข้อมูลล่าสุด ${h} ชั่วโมงที่แล้ว</span><button class="bw-btn" onclick="exportAllWorkspacesJSON()">สำรองเลย</button><button class="bw-x" aria-label="ปิด" onclick="document.getElementById('backupWarnBar').style.display='none'">✕</button>`;
  } else {
    el.style.display = 'none';
  }
}

async function checkBackupReminderOnLoad() {
  // Give it a moment for workspace list to load
  await new Promise(r => setTimeout(r, 1000));
  _updateBackupWarning();
}

// Warn before closing tab if backup overdue > 24h
window.addEventListener('beforeunload', (e) => {
  const ts  = _getLastBackupTs();
  const age = (Date.now() - ts) / 3600000;
  if ((ts === 0 || age > 24) && (S.wsList?.length > 0)) {
    e.preventDefault();
    e.returnValue = 'ยังไม่ได้ Backup Workspace — ต้องการออกใช่ไหม?';
  }
});

// ─── Glossary Inheritance (import from another WS) ───
async function openGlossaryInherit() {
  if (!S.currentWs) { showToast('เลือก Workspace ก่อน', 'error'); return; }
  const list = await lsGetWorkspaceList();
  const sel = document.getElementById('inheritWsSelect');
  sel.innerHTML = '<option value="">— เลือก Workspace —</option>' +
    list.filter(w => w.id !== S.currentWsId)
        .map(w => `<option value="${w.id}">${esc(w.emoji || '📖')} ${esc(w.name)} (${w.chapterCount || 0} ตอน)</option>`)
        .join('');
  document.getElementById('inheritPreviewInfo').textContent = '';
  openModal('modal-glossary-inherit');
}

async function previewInheritGlossary() {
  const id = document.getElementById('inheritWsSelect').value;
  if (!id) { document.getElementById('inheritPreviewInfo').textContent = ''; return; }
  const ws = await lsGetWorkspace(id);
  if (!ws) return;
  const total = ws.glossary?.length || 0;
  const newTerms = (ws.glossary || []).filter(g => !S.currentWs.glossary.some(x => x.korean === g.korean)).length;
  document.getElementById('inheritPreviewInfo').textContent =
    `${total} คำใน WS นั้น — ใหม่ที่จะ import: ${newTerms} คำ`;
}

async function confirmInheritGlossary() {
  const id = document.getElementById('inheritWsSelect').value;
  if (!id) { showToast('เลือก Workspace ก่อน', 'error'); return; }
  const ws = await lsGetWorkspace(id);
  if (!ws?.glossary?.length) { showToast('Workspace นั้นไม่มีคลังศัพท์', 'error'); return; }
  const skipDup   = document.getElementById('inheritSkipDup').checked;
  const charsOnly = document.getElementById('inheritCharsOnly').checked;
  let added = 0;
  for (const g of ws.glossary) {
    if (charsOnly && g.type !== 'character') continue;
    if (skipDup && S.currentWs.glossary.some(x => x.korean === g.korean)) continue;
    S.currentWs.glossary.push({ ...g });
    added++;
  }
  if (!added) { showToast('ไม่มีคำใหม่ที่จะ import', ''); return; }
  S.glossaryData = S.currentWs.glossary;
  await lsSaveWorkspace(S.currentWs);
  renderGlossaryTable();
  closeModal('modal-glossary-inherit');
  showToast(`Import ${added} คำจาก "${ws.name}" สำเร็จ ✓`, 'success');
}

// ─── Glossary CSV Import ───
const VALID_TYPES = new Set(['character','title','rank','term','honorific','place','skill','item','clan','monster']);
const VALID_GENDERS = new Set(['male','female','neutral']);
let _csvPendingRows = [];

function openGlossaryCSVImport() {
  if (!S.currentWs) { showToast('เลือก Workspace ก่อน', 'error'); return; }
  document.getElementById('glossaryCsvFile').click();
}

function handleGlossaryCSVImport(e) {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (ev) => {
    const text = ev.target.result;
    _csvPendingRows = parseGlossaryCSV(text);
    renderCSVPreview(_csvPendingRows);
    openModal('modal-glossary-csv-import');
  };
  reader.readAsText(file, 'UTF-8');
  e.target.value = '';
}

function parseGlossaryCSV(text) {
  // รองรับ CSV, TSV, และตัวคั่นอื่นๆ
  const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n').filter(l => l.trim());
  if (!lines.length) return [];
  // Auto-detect delimiter
  const delim = lines[0].includes('\t') ? '\t' : ',';
  const rows = [];
  // ข้ามบรรทัดแรก (header) ถ้ามี Korean/korean/เกาหลี
  const firstLow = lines[0].replace(/^\uFEFF/, '').toLowerCase();
  const startIdx = (firstLow.includes('korean') || firstLow.includes('เกาหลี') || firstLow.includes('kr')) ? 1 : 0;
  // มี header → อ่านคอลัมน์ตามชื่อ (ไฟล์ที่ Export ออกไปแล้วเลือกคอลัมน์ไม่ครบ ก็ import กลับได้ถูกช่อง)
  // ไม่มี header → ลำดับเดิม Korean,Thai,Type,Gender,Note
  const idx = { korean: 0, thai: 1, type: 2, gender: 3, note: 4 };
  if (startIdx) {
    const hd = splitCSVLine(lines[0].replace(/^\uFEFF/, ''), delim).map(h => h.trim().toLowerCase());
    const find = (...names) => hd.findIndex(h => names.some(n => h === n || h.startsWith(n)));
    const m = { korean: find('korean', 'เกาหลี', 'kr'), thai: find('thai', 'ไทย', 'th'), type: find('type', 'ประเภท'), gender: find('gender', 'เพศ'), note: find('note', 'หมายเหตุ') };
    if (m.korean >= 0 && m.thai >= 0) for (const k in m) idx[k] = m[k];
  }
  const at = (cols, k) => (idx[k] >= 0 ? (cols[idx[k]] || '') : '').trim();
  for (let i = startIdx; i < lines.length; i++) {
    const cols = splitCSVLine(lines[i], delim);
    const korean = at(cols, 'korean');
    const thai   = at(cols, 'thai');
    if (!korean || !thai) continue;
    const rawType   = at(cols, 'type').toLowerCase();
    const rawGender = at(cols, 'gender').toLowerCase();
    const note      = at(cols, 'note');
    const type   = VALID_TYPES.has(rawType)   ? rawType   : 'term';
    const gender = VALID_GENDERS.has(rawGender) ? rawGender : '';
    const exists = S.currentWs.glossary.some(g => g.korean === korean);
    rows.push({ korean, thai, type, gender, note, exists, selected: !exists });
  }
  return rows;
}

function splitCSVLine(line, delim) {
  const cols = [];
  let cur = '', inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') { inQ = !inQ; continue; }
    if (c === delim && !inQ) { cols.push(cur); cur = ''; continue; }
    cur += c;
  }
  cols.push(cur);
  return cols;
}

function renderCSVPreview(rows) {
  const tbody = document.getElementById('csvPreviewBody');
  const newRows  = rows.filter(r => !r.exists).length;
  const dupRows  = rows.filter(r => r.exists).length;
  document.getElementById('csvImportStats').textContent =
    `พบ ${rows.length} รายการ — ใหม่: ${newRows} | ซ้ำ (ข้ามอัตโนมัติ): ${dupRows}`;
  tbody.innerHTML = rows.map((r, idx) => `
    <tr style="opacity:${r.exists ? 0.45 : 1}">
      <td style="padding:4px 8px">${esc(r.korean)}</td>
      <td style="padding:4px 8px">${esc(r.thai)}</td>
      <td style="padding:4px 8px">${esc(r.type)}</td>
      <td style="padding:4px 8px">${esc(r.gender)}</td>
      <td style="padding:4px 8px;max-width:120px;overflow:hidden;text-overflow:ellipsis">${esc(r.note)}</td>
      <td style="padding:4px 8px">
        ${r.exists
          ? '<span style="color:var(--text-muted)">ซ้ำ</span>'
          : `<input type="checkbox" data-idx="${idx}" ${r.selected ? 'checked' : ''} onchange="_csvToggle(${idx},this.checked)">`}
      </td>
    </tr>
  `).join('');
}

function _csvToggle(idx, val) { _csvPendingRows[idx].selected = val; }

async function confirmGlossaryCSVImport() {
  const toAdd = _csvPendingRows.filter(r => r.selected && !r.exists);
  if (!toAdd.length) { showToast('ไม่มีรายการที่จะ import', 'error'); return; }
  toAdd.forEach(r => {
    const entry = { korean: r.korean, thai: r.thai, type: r.type, note: r.note };
    if (r.type === 'character' && r.gender) entry.gender = r.gender;
    S.currentWs.glossary.push(entry);
  });
  S.glossaryData = S.currentWs.glossary;
  await lsSaveWorkspace(S.currentWs);
  renderGlossaryTable();
  closeModal('modal-glossary-csv-import');
  showToast(`Import สำเร็จ: เพิ่ม ${toAdd.length} คำ ✓`, 'success');
}

// ─── Multi-Workspace Export ───
async function openMultiExport() {
  const list = await lsGetWorkspaceList();
  if (!list.length) { showToast('ไม่มี Workspace', 'error'); return; }
  const container = document.getElementById('multiExportList');
  container.innerHTML = list.map(w => `
    <label style="display:flex;align-items:center;gap:8px;padding:6px 8px;border-radius:6px;cursor:pointer;background:var(--bg-card);border:1px solid var(--border)">
      <input type="checkbox" class="multi-exp-chk" data-id="${w.id}" checked style="width:16px;height:16px;cursor:pointer">
      ${coverTileHtml(w.name, w.coverThumb, 'cover-sm')}
      <span style="flex:1;font-size:0.88rem">${esc(w.name)}</span>
      <span style="font-size:0.75rem;color:var(--text-muted)">${w.chapterCount || 0} ตอน</span>
    </label>
  `).join('');
  container.querySelectorAll('.multi-exp-chk').forEach(cb => cb.addEventListener('change', multiExportUpdateCount));
  multiExportUpdateCount();
  openModal('modal-multi-export');
}

function multiExportSelectAll(val) {
  document.querySelectorAll('.multi-exp-chk').forEach(cb => { cb.checked = val; });
  multiExportUpdateCount();
}

function multiExportUpdateCount() {
  const n = document.querySelectorAll('.multi-exp-chk:checked').length;
  document.getElementById('multiExportCount').textContent = `${n} Workspace ที่เลือก`;
}

async function doMultiExport() {
  const checked = [...document.querySelectorAll('.multi-exp-chk:checked')];
  if (!checked.length) { showToast('เลือก Workspace ก่อน', 'error'); return; }

  showToast(`กำลังโหลด ${checked.length} Workspace...`, '');
  const workspaces = [];
  for (const cb of checked) {
    const ws = await lsGetWorkspace(cb.dataset.id);
    if (ws) workspaces.push(ws);
  }

  const bundle = {
    _format: 'noveltrans-multi-export',
    _version: 1,
    _exportedAt: new Date().toISOString(),
    _count: workspaces.length,
    workspaces,
  };

  const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' });
  const date = new Date().toISOString().slice(0, 10);
  downloadBlob(blob, `noveltrans_backup_${date}_${workspaces.length}ws.json`);
  _markBackupDone();
  closeModal('modal-multi-export');
  showToast(`Export ${workspaces.length} Workspace สำเร็จ ✓`, 'success');
}

function openImportWs() { document.getElementById('importWsFile').click(); }

async function importWorkspace(e) {
  const file = e.target.files[0];
  if (!file) return;
  try {
    const text = await file.text();
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch (parseErr) {
      parsed = tryRepairJson(text);
      if (!parsed) throw new Error(`JSON เสียหาย (${parseErr.message})`);
      showToast('⚠ JSON ถูกซ่อมแซมบางส่วน ข้อมูลอาจไม่ครบ', 'error');
    }

    // ─ Multi-export bundle / Backup ทั้งหมด (1-click) ─
    // Backup ทั้งหมดเขียนเป็น { exportedAt, workspaces: [...] } ไม่มี _format → เดิม import ไม่ได้
    if (Array.isArray(parsed)) parsed = { workspaces: parsed };
    if (Array.isArray(parsed?.workspaces)) {
      let imported = 0;
      for (const ws of parsed.workspaces) {
        if (!ws.id || !ws.name) continue;
        if (!ws.chapters) ws.chapters = [];
        if (!ws.glossary) ws.glossary = [];
        if (!ws.customStyles) ws.customStyles = [];
        if (!ws.settings) ws.settings = {};
        await lsSaveWorkspace(ws);
        imported++;
      }
      await loadWorkspaceList();
      showToast(`Import Bundle สำเร็จ: ${imported} Workspace ✓`, 'success');
      e.target.value = '';
      return;
    }

    // ─ Single workspace ─
    const ws = parsed;
    if (!ws.id || !ws.name) throw new Error('ไฟล์ไม่ถูกต้อง — ไม่พบ id หรือ name');
    if (!ws.chapters) ws.chapters = [];
    if (!ws.glossary) ws.glossary = [];
    if (!ws.customStyles) ws.customStyles = [];
    if (!ws.settings) ws.settings = {};
    await lsSaveWorkspace(ws);
    await selectWorkspace(ws.id);
    showToast(`Import "${ws.name}" สำเร็จ (${ws.chapters.length} ตอน)`, 'success');
  } catch (err) {
    showToast('Import ล้มเหลว: ' + err.message, 'error');
  }
  e.target.value = '';
}

// ── Attempt to repair truncated JSON by closing unclosed brackets/braces ──
function tryRepairJson(text) {
  let t = text.trimEnd().replace(/,\s*$/, ''); // strip trailing comma
  const stack = [];
  let inStr = false, escape = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (escape) { escape = false; continue; }
    if (c === '\\' && inStr) { escape = true; continue; }
    if (c === '"' && !escape) { inStr = !inStr; continue; }
    if (!inStr) {
      if (c === '{' || c === '[') stack.push(c);
      else if (c === '}' || c === ']') stack.pop();
    }
  }
  if (!stack.length) return null;
  const close = st => st.slice().reverse().map(c => c === '{' ? '}' : ']').join('');
  try { return JSON.parse(t + close(stack)); } catch {}
  // ถูกตัดกลาง string / กลาง key-value → ตัดกลับไปที่ comma สุดท้าย (นอก string) แล้วปิดวงเล็บตามระดับตรงนั้น
  const st2 = []; let s2 = false, e2 = false; const cuts = [];
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (e2) { e2 = false; continue; }
    if (c === '\\' && s2) { e2 = true; continue; }
    if (c === '"') { s2 = !s2; continue; }
    if (s2) continue;
    if (c === '{' || c === '[') st2.push(c);
    else if (c === '}' || c === ']') st2.pop();
    else if (c === ',') cuts.push([i, st2.slice()]);
  }
  for (let k = cuts.length - 1; k >= 0 && k >= cuts.length - 50; k--) {
    const [i, st] = cuts[k];
    try { return JSON.parse(t.slice(0, i) + close(st)); } catch {}
  }
  return null;
}



// ═══════════════════════════════════════════════
// ─── ภาพปกนิยาย (แทนอีโมจิ) ───
// ws.cover = JPEG ย่อ (≤600×900) · ws.coverThumb = 96×144 สำหรับรายการ (เก็บใน ws_list meta ด้วย)
// ไม่มีปก → กระเบื้องตัวอักษรแรกของชื่อเรื่อง สีจาก hash ชื่อ
// ═══════════════════════════════════════════════
const COVER_W = 600, COVER_H = 900, THUMB_W = 96, THUMB_H = 144;

function _coverHue(name) {
  let h = 0;
  for (const ch of String(name || '')) h = (h * 31 + ch.codePointAt(0)) >>> 0;
  return h % 360;
}
function _coverInitial(name) {
  const chars = Array.from(String(name || '').trim()).filter(c => !/\p{M}/u.test(c) && !/\s/.test(c));
  return chars[0] ? chars[0].toUpperCase() : '?';
}
function coverTileHtml(name, thumb, cls = 'cover-sm') {
  if (thumb) return `<img class="cover-img ${cls}" src="${esc(thumb)}" alt="" loading="lazy"/>`;
  return `<span class="cover-tile ${cls}" style="--cover-h:${_coverHue(name)}" aria-hidden="true">${esc(_coverInitial(name))}</span>`;
}
function setWsHeader(ws) {
  const el = document.getElementById('wsNameHeader');
  if (!el) return;
  el.innerHTML = ws ? `${coverTileHtml(ws.name, ws.coverThumb, 'cover-xs')}<span class="ws-name-text">${esc(ws.name)}</span>` : '—';
}

function _loadImage(src) {
  return new Promise((res, rej) => { const img = new Image(); img.onload = () => res(img); img.onerror = () => rej(new Error('อ่านรูปไม่ได้')); img.src = src; });
}
// ตัดภาพให้เป็นสัดส่วน 2:3 (กึ่งกลาง) แล้วย่อ
function _drawCover(img, w, h, quality) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d');
  const r = Math.max(w / img.width, h / img.height);
  const dw = img.width * r, dh = img.height * r;
  g.fillStyle = '#111214'; g.fillRect(0, 0, w, h);
  g.drawImage(img, (w - dw) / 2, (h - dh) / 2, dw, dh);
  return c.toDataURL('image/jpeg', quality);
}
async function readCoverFile(file) {
  if (!file) return null;
  if (!/^image\//.test(file.type || '')) throw new Error('ไฟล์นี้ไม่ใช่รูปภาพ');
  if (file.size > 25 * 1024 * 1024) throw new Error('รูปใหญ่เกิน 25MB');
  const url = URL.createObjectURL(file);
  try {
    const img = await _loadImage(url);
    return { cover: _drawCover(img, COVER_W, COVER_H, 0.85), thumb: _drawCover(img, THUMB_W, THUMB_H, 0.8) };
  } finally { URL.revokeObjectURL(url); }
}

// ปกอัตโนมัติจากชื่อเรื่อง (ใช้ใน EPUB เมื่อยังไม่ได้ตั้งปก)
function _wrapTitle(g, text, maxW) {
  const seg = (typeof Intl !== 'undefined' && Intl.Segmenter) ? [...new Intl.Segmenter('th', { granularity: 'word' }).segment(text)].map(x => x.segment) : Array.from(text);
  const lines = []; let line = '';
  for (const part of seg) {
    if (g.measureText(line + part).width > maxW && line.trim()) { lines.push(line.trim()); line = part.trimStart(); }
    else line += part;
  }
  if (line.trim()) lines.push(line.trim());
  return lines;
}
async function generateCoverDataUrl(name) {
  const c = document.createElement('canvas'); c.width = COVER_W; c.height = COVER_H;
  const g = c.getContext('2d');
  const hue = _coverHue(name);
  const grad = g.createLinearGradient(0, 0, 0, COVER_H);
  grad.addColorStop(0, `hsl(${hue},45%,22%)`); grad.addColorStop(1, `hsl(${(hue + 30) % 360},50%,10%)`);
  g.fillStyle = grad; g.fillRect(0, 0, COVER_W, COVER_H);
  g.strokeStyle = 'rgba(255,255,255,0.18)'; g.lineWidth = 2; g.strokeRect(36, 36, COVER_W - 72, COVER_H - 72);
  try { await document.fonts?.load?.("600 64px 'IBM Plex Sans Thai'"); } catch {}
  g.fillStyle = '#F2F2F4'; g.textAlign = 'center'; g.textBaseline = 'middle';
  let size = 72, lines;
  do { g.font = `600 ${size}px 'IBM Plex Sans Thai','Noto Sans Thai',sans-serif`; lines = _wrapTitle(g, String(name || 'NovelTrans'), COVER_W - 140); size -= 6; } while (lines.length > 4 && size > 30);
  const lh = size * 1.5, top = COVER_H * 0.42 - (lines.length - 1) * lh / 2;
  lines.forEach((l, i) => g.fillText(l, COVER_W / 2, top + i * lh));
  g.font = `500 22px 'IBM Plex Sans Thai',sans-serif`; g.fillStyle = 'rgba(242,242,244,0.6)';
  g.fillText('NovelTrans', COVER_W / 2, COVER_H - 90);
  return c.toDataURL('image/jpeg', 0.9);
}

// กล่องเลือกปก: prefix = 'wsCover' (ตั้งค่า) หรือ 'newWsCover' (สร้างเรื่องใหม่)
function renderCoverPicker(prefix, name, cover) {
  const box = document.getElementById(prefix + 'Preview');
  if (!box) return;
  box.innerHTML = cover ? `<img class="cover-img cover-lg" src="${esc(cover)}" alt="ภาพปก"/>` : coverTileHtml(name, null, 'cover-lg');
  const rm = document.getElementById(prefix + 'Remove');
  if (rm) rm.style.display = cover ? '' : 'none';
}
async function onCoverFileChange(prefix, input) {
  const file = input.files?.[0];
  input.value = '';
  if (!file) return;
  try {
    const r = await readCoverFile(file);
    if (prefix === 'newWsCover') S._newWsCover = r; else S._coverDraft = r;
    const name = document.getElementById(prefix === 'newWsCover' ? 'newWsName' : 'wsEditName')?.value || '';
    renderCoverPicker(prefix, name, r.cover);
    if (prefix === 'wsCover') showToast('เลือกปกแล้ว — กด 💾 บันทึก เพื่อใช้', '');
  } catch (e) { showToast('❌ ' + e.message, 'error'); }
}
function removeCover(prefix) {
  const name = document.getElementById(prefix === 'newWsCover' ? 'newWsName' : 'wsEditName')?.value || '';
  if (prefix === 'newWsCover') S._newWsCover = null; else S._coverDraft = null;
  renderCoverPicker(prefix, name, null);
}

// ยังไม่มีปก → กระเบื้องตัวอักษรเปลี่ยนตามชื่อที่พิมพ์
function coverNameInput(prefix, name) {
  const draft = prefix === 'newWsCover' ? S._newWsCover : S._coverDraft;
  const current = draft === null ? null : (draft?.cover || (prefix === 'wsCover' ? S.currentWs?.cover : null));
  if (!current) renderCoverPicker(prefix, name, null);
}

// ป้าย/placeholder ตามภาษาต้นฉบับของเรื่อง
function updateLangUI(ws = S.currentWs) {
  const L = getSourceLang(ws);
  const ta = document.getElementById('sourceText');
  if (ta) ta.placeholder = L.placeholder;
  const pt = document.querySelector('#tab-translate .t-pane .pane-title');
  if (pt) pt.textContent = `ต้นฉบับ · ${L.short}`;
}
