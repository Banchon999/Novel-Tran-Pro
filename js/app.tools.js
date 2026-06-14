// ─── Re-number All Chapters ───
async function renumberAllChapters() {
  if (!S.currentWs?.chapters.length) { showToast('ไม่มีตอน', 'error'); return; }
  if (!confirm('เรียงเลขตอนใหม่ตามลำดับปัจจุบัน (1, 2, 3...)?\nไม่กระทบต้นฉบับหรือคำแปล')) return;
  const sorted = [...S.currentWs.chapters].sort((a, b) => (a.chapterNum || 0) - (b.chapterNum || 0));
  sorted.forEach((ch, i) => {
    const real = S.currentWs.chapters.find(c => c.id === ch.id);
    if (real) real.chapterNum = i + 1;
  });
  await lsSaveWorkspace(S.currentWs);
  renderChapters();
  updateChapterSaveSelect();
  showToast('เรียงเลขตอนใหม่แล้ว ✓', 'success');
}

// ─── Bulk Rename / แปลชื่อตอนอัตโนมัติ ───
const DEFAULT_TITLE_PROMPT = `You are a professional chapter-title translator. Translate each chapter title into natural, fluent Thai.
Keep proper names consistent. Return ONLY a valid JSON array of strings — no markdown, no extra text — with EXACTLY {count} elements, in the same order.
Example: ["ชื่อตอนที่ 1","ชื่อตอนที่ 2"]

Chapter titles:
{titles}`;

function brGetPromptTemplate() {
  return S.currentWs?.settings?.titlePromptTemplate || DEFAULT_TITLE_PROMPT;
}
function brLoadPrompt() {
  const ta = document.getElementById('brPromptText');
  if (ta) ta.value = brGetPromptTemplate();
}
async function brSavePrompt() {
  if (!S.currentWs) return;
  const v = (document.getElementById('brPromptText')?.value || '').trim();
  S.currentWs.settings = { ...(S.currentWs.settings || {}), titlePromptTemplate: v || DEFAULT_TITLE_PROMPT };
  await lsSaveWorkspace(S.currentWs);
  showToast('บันทึก prompt แปลชื่อแล้ว ✓', 'success');
}
function brResetPrompt() {
  const ta = document.getElementById('brPromptText');
  if (ta) ta.value = DEFAULT_TITLE_PROMPT;
}
function brTogglePromptBox() {
  const box = document.getElementById('brPromptBox');
  if (box) box.style.display = box.style.display === 'none' ? 'block' : 'none';
}

// ── โมเดลแปลชื่อตอน — เลือกได้หลายโมเดลตาม provider ปัจจุบัน (รวมที่ fetch มา/custom) ──
// จำค่าแยกต่อ workspace (settings.titleModel) · default = โมเดลแปลหลักของ workspace
function brGetTitleModel() {
  return S.currentWs?.settings?.titleModel
      || S.currentWs?.settings?.translateModel
      || (typeof defaultModelFor === 'function' ? defaultModelFor(getProvider()) : 'deepseek/deepseek-chat');
}
function brSyncModelSelect() {
  const sel = document.getElementById('bulkRenameModel');
  if (!sel) return;
  renderModelSelect(sel, getProvider(), brGetTitleModel());
}
async function brSaveModel(v) {
  if (!S.currentWs || !v) return;
  S.currentWs.settings = { ...(S.currentWs.settings || {}), titleModel: v };
  await lsSaveWorkspace(S.currentWs);
}
async function brFetchModels(btn) {
  await onFetchModels(btn);   // ดึงรายชื่อโมเดลล่าสุดจาก provider แล้ว cache
  brSyncModelSelect();        // อัปเดต dropdown ของหน้าแก้ชื่อตอนให้เห็นรายการใหม่
}

// ── Multi-select: target = แถวที่ติ๊ก ถ้าไม่ติ๊กเลย = ทุกแถว ──
function brTargetInputs() {
  const all = [...document.querySelectorAll('.bulk-rename-input')];
  const ids = new Set([...document.querySelectorAll('.bulk-rename-chk:checked')].map(c => c.dataset.id));
  return ids.size ? all.filter(inp => ids.has(inp.dataset.id)) : all;
}
function brUpdateSelCount() {
  const n = document.querySelectorAll('.bulk-rename-chk:checked').length;
  const el = document.getElementById('brSelCount');
  if (el) el.textContent = n ? `เลือก ${n} ตอน (จะทำเฉพาะที่เลือก)` : 'ยังไม่ได้เลือก — จะทำกับทุกตอน';
}
function brToggleSelectAll(checked) {
  document.querySelectorAll('.bulk-rename-chk').forEach(c => { c.checked = checked; });
  brUpdateSelCount();
}

function openBulkRename() {
  if (!S.currentWs?.chapters.length) { showToast('ยังไม่มีตอน', 'error'); return; }
  const sorted = [...S.currentWs.chapters].sort((a, b) => (a.chapterNum || 0) - (b.chapterNum || 0));
  const list = document.getElementById('bulkRenameList');
  list.innerHTML = sorted.map(ch => `
    <div style="display:flex;align-items:center;gap:8px;padding:5px 6px;background:var(--bg-deep);border:1px solid var(--border);border-radius:var(--radius)">
      <input type="checkbox" class="bulk-rename-chk" data-id="${ch.id}" style="accent-color:var(--gold);flex-shrink:0" onchange="brUpdateSelCount()" title="เลือกตอนนี้"/>
      <span style="font-size:0.7rem;font-family:var(--font-mono);color:var(--text-muted);min-width:28px;flex-shrink:0">#${ch.chapterNum||'?'}</span>
      <input class="bulk-rename-input" data-id="${ch.id}" type="text" value="${esc(ch.title)}"
        style="flex:1;background:transparent;border:none;border-bottom:1px dashed var(--border);color:var(--text-primary);font-size:0.85rem;font-family:var(--font-body);outline:none;padding:2px 4px;"
        onfocus="this.style.borderBottomColor='var(--gold)'" onblur="this.style.borderBottomColor='var(--border)'"/>
    </div>
  `).join('');
  document.getElementById('bulkRenameStatus').textContent = '';
  const selAll = document.getElementById('brSelectAll');
  if (selAll) selAll.checked = false;
  brSyncModelSelect();
  brLoadPrompt();
  brUpdateSelCount();
  openModal('modal-bulk-rename');
}

async function bulkRenameWithAI() {
  const inputs = brTargetInputs();
  if (!inputs.length) return;
  const btn = document.getElementById('bulkRenameAiBtn');
  const status = document.getElementById('bulkRenameStatus');
  btn.disabled = true;

  const titles = inputs.map(inp => inp.value.trim());
  const model = document.getElementById('bulkRenameModel').value || brGetTitleModel();
  const tmpl = brGetPromptTemplate();

  // แบ่ง batch ละ 30 ตอน เพื่อป้องกัน JSON truncation
  const BATCH = 30;
  const batches = [];
  for (let i = 0; i < titles.length; i += BATCH) batches.push(titles.slice(i, i + BATCH));

  let translated = [];
  try {
    for (let b = 0; b < batches.length; b++) {
      const batch = batches[b];
      status.textContent = `🤖 กำลังแปล batch ${b+1}/${batches.length} (${batch.length} ตอน)...`;

      const listStr = batch.map((t, i) => `${i+1}. ${t}`).join('\n');
      const prompt = tmpl.includes('{titles}')
        ? tmpl.replace(/{count}/g, String(batch.length)).replace('{titles}', listStr)
        : `${tmpl}\n\nReturn ONLY a JSON array of exactly ${batch.length} Thai strings, same order.\n${listStr}`;

      const res = await callOpenRouter({
        model,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.2,
        max_tokens: Math.max(1000, batch.length * 40),
      });

      let raw = (res.choices?.[0]?.message?.content || '').trim();
      // Strip markdown fences if any
      raw = raw.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/,'').trim();

      let batchResult = null;
      try {
        batchResult = JSON.parse(raw);
      } catch {
        batchResult = tryRepairJson(raw);
      }

      if (!Array.isArray(batchResult)) {
        // Fallback: try to extract strings from the response line by line
        batchResult = raw.split('\n')
          .map(l => l.replace(/^\d+\.\s*/, '').replace(/^["']|["']$/g, '').trim())
          .filter(Boolean);
      }

      translated = translated.concat(batchResult);
    }

    // Apply results back to the target inputs
    let applied = 0;
    inputs.forEach((inp, i) => {
      if (translated[i] && typeof translated[i] === 'string' && translated[i].trim()) {
        inp.value = translated[i].trim();
        inp.style.background = 'rgba(76,175,80,0.1)';
        applied++;
      }
    });
    status.textContent = `✓ แปลชื่อ ${applied}/${titles.length} ตอนแล้ว (ยังไม่บันทึก — กด 💾)`;
  } catch (e) {
    status.textContent = '❌ ' + e.message;
  } finally {
    btn.disabled = false;
  }
}

async function saveBulkRename() {
  const inputs = [...document.querySelectorAll('.bulk-rename-input')];
  let changed = 0;
  inputs.forEach(inp => {
    const id = inp.dataset.id;
    const newTitle = inp.value.trim();
    if (!newTitle) return;
    const ch = S.currentWs.chapters.find(c => c.id === id);
    if (ch && ch.title !== newTitle) { ch.title = newTitle; changed++; }
  });
  if (changed) {
    await lsSaveWorkspace(S.currentWs);
    renderChapters();
    updateChapterSaveSelect();
    showToast(`บันทึกชื่อ ${changed} ตอนแล้ว ✓`, 'success');
  } else {
    showToast('ไม่มีการเปลี่ยนแปลง', '');
  }
  closeModal('modal-bulk-rename');
}

// ─── Export Chapter Selector ───
let _exportSelFormat = 'txt';

function openExportSelect(format) {
  if (!S.currentWs) return;
  _exportSelFormat = format;
  const fmtLabel = { txt: 'TXT', docx: 'DOCX', zip: 'ZIP' }[format] || format.toUpperCase();
  document.getElementById('exportSelectTitle').textContent = `📤 เลือกตอน — Export ${fmtLabel}`;
  document.getElementById('exportSelConfirmBtn').textContent = `📤 Export ${fmtLabel}`;
  const chapters = [...S.currentWs.chapters].sort((a, b) => (a.chapterNum || 0) - (b.chapterNum || 0));
  const list = document.getElementById('exportSelList');
  list.innerHTML = chapters.map(ch => `
    <label style="display:flex;align-items:center;gap:8px;padding:5px 6px;border-radius:4px;cursor:pointer" onmouseover="this.style.background='var(--bg-hover)'" onmouseout="this.style.background=''">
      <input type="checkbox" class="export-sel-chk" data-id="${ch.id}" checked style="accent-color:var(--gold)"
        onclick="rangeCheckboxClick(event,'export-sel','.export-sel-chk',exportSelUpdateCount)"
        onchange="exportSelUpdateCount()" title="Shift+คลิก เพื่อเลือกช่วง"/>
      <span style="font-size:0.72rem;font-family:var(--font-mono);color:var(--text-muted);min-width:28px">#${ch.chapterNum||'?'}</span>
      <span style="flex:1;font-size:0.82rem;color:var(--text-primary)">${esc(ch.title)}</span>
      <span class="status-badge ${ch.status==='translated'?'translated':'pending'}" style="font-size:0.6rem">${ch.status==='translated'?'✓ แปลแล้ว':'○ รอ'}</span>
    </label>
  `).join('');
  exportSelUpdateCount();
  closeModal('modal-export');
  openModal('modal-export-select');
}

function exportSelUpdateCount() {
  const n = document.querySelectorAll('.export-sel-chk:checked').length;
  document.getElementById('exportSelCount').textContent = `${n} ตอนที่เลือก`;
}
function exportSelSelectAll() { document.querySelectorAll('.export-sel-chk').forEach(el => el.checked = true); exportSelUpdateCount(); }
function exportSelDeselectAll() { document.querySelectorAll('.export-sel-chk').forEach(el => el.checked = false); exportSelUpdateCount(); }
function exportSelSelectTranslated() {
  document.querySelectorAll('.export-sel-chk').forEach(el => {
    const ch = S.currentWs.chapters.find(c => c.id === el.dataset.id);
    el.checked = ch?.status === 'translated';
  });
  exportSelUpdateCount();
}

function confirmExportSelected() {
  const checked = [...document.querySelectorAll('.export-sel-chk:checked')];
  if (!checked.length) { showToast('เลือกตอนก่อน', 'error'); return; }
  const selectedIds = new Set(checked.map(el => el.dataset.id));
  const chapters = [...S.currentWs.chapters]
    .filter(ch => selectedIds.has(ch.id))
    .sort((a, b) => (a.chapterNum || 0) - (b.chapterNum || 0));
  const name = S.currentWs.name || 'export';
  closeModal('modal-export-select');
  if (_exportSelFormat === 'txt') {
    const text = chapters.map(ch => `=== ${ch.title} ===\n\n${ch.translation || '(ยังไม่มีคำแปล)'}`).join('\n\n\n');
    downloadBlob(new Blob([text], { type: 'text/plain;charset=utf-8' }), `${name}_selected.txt`);
    showToast('Export TXT สำเร็จ ✓', 'success');
  } else if (_exportSelFormat === 'docx') {
    const escXml = s => s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    const body = chapters.map(ch => {
      const heading = `<w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:rPr><w:b/><w:sz w:val="32"/><w:rFonts w:ascii="Tahoma" w:hAnsi="Tahoma"/></w:rPr><w:t>${escXml(ch.title)}</w:t></w:r></w:p><w:p/>`;
      const content = (ch.translation || '(ยังไม่มีคำแปล)').split('\n').map(line =>
        `<w:p><w:r><w:rPr><w:rFonts w:ascii="Tahoma" w:hAnsi="Tahoma"/></w:rPr><w:t xml:space="preserve">${escXml(line)}</w:t></w:r></w:p>`).join('');
      return heading + content + '<w:p/><w:p/>';
    }).join('');
    const docXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr></w:body></w:document>`;
    const buf = buildDocxZip(docXml);
    downloadBlob(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }), `${name}_selected.docx`);
    showToast('Export DOCX สำเร็จ ✓', 'success');
  } else if (_exportSelFormat === 'zip') {
    const files = {};
    chapters.forEach(ch => {
      const num = String(ch.chapterNum || '0').padStart(3, '0');
      const safeName = ch.title.replace(/[\\/:*?"<>|]/g, '_');
      files[`${num}_${safeName}.txt`] = ch.translation || '(ยังไม่มีคำแปล)';
    });
    const buf = buildZipBuffer(files);
    downloadBlob(new Blob([buf], { type: 'application/zip' }), `${name}_selected.zip`);
    showToast('Export ZIP สำเร็จ ✓', 'success');
  }
}

// ─── Auto Glossary — Chunked + Source Tracking ───
// Override runAutoGlossary with chunked version
async function runAutoGlossary() {
  let text = '';
  let sourceChapterInfo = null; // { id, title, chapterNum } for single chapter

  if (_agTab === 'chapters') {
    const checked = [...document.querySelectorAll('.ag-ch-chk:checked')];
    if (!checked.length) { showToast('เลือกตอนก่อน', 'error'); return; }
    const parts = checked.map(el => {
      const ch = S.currentWs?.chapters.find(c => c.id === el.dataset.id);
      return ch ? { id: ch.id, title: ch.title, chapterNum: ch.chapterNum, text: ch.sourceText || '' } : null;
    }).filter(Boolean);
    // Store chapter info for source tracking (multi-chapter)
    window._agChapterInfoMap = {};
    parts.forEach(p => { window._agChapterInfoMap[p.id] = { id: p.id, title: p.title, chapterNum: p.chapterNum }; });
    text = parts.map(p => p.text).filter(Boolean).join('\n\n');
    // Mark chapters as to-be-tracked
    window._agCheckedChapters = parts;
  } else {
    text = document.getElementById('agSourceText').value.trim();
    window._agCheckedChapters = null;
    window._agChapterInfoMap = null;
  }

  if (!text) { showToast('ไม่มีข้อความให้วิเคราะห์', 'error'); return; }

  const btn = document.getElementById('agRunBtn');
  const status = document.getElementById('agStatus');
  btn.disabled = true;
  document.getElementById('agResults').style.display = 'none';
  _agTerms = [];

  const model = document.getElementById('agModel')?.value || document.getElementById('translateModel').value;
  const existing = (S.glossaryData || []).map(g => g.korean).join(', ') || '(ไม่มี)';

  // ── Chunked extraction: split every 15,000 chars at paragraph boundary ──
  const CHUNK_LIMIT = 15000;
  const chunks = [];
  if (text.length <= CHUNK_LIMIT) {
    chunks.push(text);
  } else {
    let pos = 0;
    while (pos < text.length) {
      let end = pos + CHUNK_LIMIT;
      if (end < text.length) {
        const nl = text.lastIndexOf('\n', end);
        if (nl > pos + CHUNK_LIMIT * 0.5) end = nl + 1;
      } else { end = text.length; }
      chunks.push(text.slice(pos, end));
      pos = end;
    }
  }

  status.textContent = chunks.length > 1
    ? `🤖 วิเคราะห์ ${chunks.length} ส่วน (${text.length.toLocaleString()} ตัวอักษร)...`
    : '🤖 กำลังวิเคราะห์...';

  try {
    let allTerms = [];
    const seenKorean = new Set((S.glossaryData || []).map(g => g.korean));

    for (let ci = 0; ci < chunks.length; ci++) {
      const chunk = chunks[ci];
      if (chunks.length > 1) status.textContent = `🤖 วิเคราะห์ส่วน ${ci+1}/${chunks.length}...`;

      // Build existing list including terms found so far
      const existingNow = [...seenKorean].join(', ') || '(ไม่มี)';
      const prompt = agGetPrompt().replace('{existing}', existingNow).replace('{text}', chunk).replace('{thai_snippet}', '');

      try {
        const res = await callOpenRouter({ model, messages: [{ role: 'user', content: prompt }], temperature: 0.2, max_tokens: 2000 });
        const raw = res.choices?.[0]?.message?.content?.trim() || '[]';
        const terms = JSON.parse(raw.replace(/```json|```/g, '').trim());
        if (Array.isArray(terms)) {
          terms.forEach(t => {
            if (t.korean && !seenKorean.has(t.korean)) {
              seenKorean.add(t.korean);
              // Attach source chapter info
              if (window._agCheckedChapters?.length === 1) {
                t.sourceChapterId = window._agCheckedChapters[0].id;
                t.sourceChapterTitle = window._agCheckedChapters[0].title;
                t.sourceChapterNum = window._agCheckedChapters[0].chapterNum;
              } else if (window._agCheckedChapters?.length > 1) {
                // Find which chapter text contains this term
                const found = window._agCheckedChapters.find(p => p.text.includes(t.korean));
                if (found) {
                  t.sourceChapterId = found.id;
                  t.sourceChapterTitle = found.title;
                  t.sourceChapterNum = found.chapterNum;
                }
              }
              allTerms.push(t);
            }
          });
        }
      } catch (chunkErr) {
        // Skip failed chunk, continue
        console.warn(`Auto Glossary chunk ${ci+1} failed:`, chunkErr.message);
      }
    }

    _agTerms = allTerms;
    if (!_agTerms.length) {
      status.textContent = '✓ ไม่พบคำศัพท์ใหม่';
      document.getElementById('agResults').style.display = 'none';
      return;
    }
    status.textContent = `พบ ${_agTerms.length} คำใหม่`;
    renderAgResults(_agTerms);
    document.getElementById('agResults').style.display = 'block';

  } catch (e) { status.textContent = '❌ ' + e.message; }
  finally { btn.disabled = false; }
}

// ─── Patch addSelectedGlossary to include source + mark chapters ───
async function addSelectedGlossary() {
  if (!S.currentWsId) { showToast('เลือก Workspace ก่อน', 'error'); return; }
  const selected = _agTerms.filter((_, i) => document.getElementById(`ag-chk-${i}`)?.checked)
    .map((t) => {
      const i = _agTerms.indexOf(t);
      return { ...t, thai: document.getElementById(`ag-thai-${i}`)?.value?.trim() || t.thai };
    });
  if (!selected.length) { showToast('ไม่ได้เลือกคำ', 'error'); return; }
  let added = 0;
  selected.forEach(term => {
    const exists = S.currentWs.glossary.findIndex(g => g.korean === term.korean);
    if (exists < 0) { S.currentWs.glossary.push(term); added++; }
  });
  S.glossaryData = S.currentWs.glossary;

  // Mark chapters that were analysed as glossaryExtracted = true
  if (window._agCheckedChapters?.length) {
    window._agCheckedChapters.forEach(info => {
      const ch = S.currentWs.chapters.find(c => c.id === info.id);
      if (ch) ch.glossaryExtracted = true;
    });
  }

  await lsSaveWorkspace(S.currentWs);
  renderGlossaryTable();
  if (S.currentTab === 'chapters') renderChapters();
  closeModal('modal-autoglossary');
  showToast(`เพิ่ม ${added} คำลงคลังศัพท์แล้ว ✓`, 'success');
}

// ─── Glossary Type System ───
const PRESET_TYPES = {
  character: 'ตัวละคร',
  title:     'ตำแหน่ง/ยศ',
  rank:      'ลำดับขั้น',
  term:      'คำศัพท์ทั่วไป',
  honorific: 'คำยกย่อง',
  place:     'สถานที่',
  skill:     'ทักษะ/วิชา',
  item:      'ไอเทม/วัตถุ',
  clan:      'กลุ่ม/สำนัก',
  monster:   'มอนสเตอร์/สัตว์',
};

// Ensure a type value exists in the gType select; add option if not
function ensureTypeInDropdown(type) {
  if (!type) return;
  const sel = document.getElementById('gType');
  if (!sel) return;
  const exists = [...sel.options].some(o => o.value === type);
  if (!exists) {
    const opt = document.createElement('option');
    opt.value = type;
    opt.textContent = type + ' (custom)';
    sel.appendChild(opt);
  }
}

// Rebuild glossaryTypeFilter จาก preset + custom types ของ workspace + types ใน glossary
// (rebuild ทุกครั้ง — กัน option ค้างข้าม workspace)
function refreshTypeFilter() {
  const sel = document.getElementById('glossaryTypeFilter');
  if (!sel) return;
  const cur = sel.value;
  const types = new Set([...Object.keys(PRESET_TYPES), ...(S.currentWs?.customGlossaryTypes || [])]);
  (S.glossaryData || []).forEach(g => { const t = g.type?.trim(); if (t) types.add(t); });
  sel.innerHTML = '<option value="">ทุกประเภท</option>' +
    [...types].map(t => `<option value="${esc(t)}">${PRESET_TYPES[t] || t}</option>`).join('');
  if (cur && [...sel.options].some(o => o.value === cur)) sel.value = cur;
}

// Rebuild gType select: preset + custom types (persist ใน ws.customGlossaryTypes) + ตัวเลือกเพิ่มประเภทใหม่
function populateGlossaryTypeSelects() {
  const sel = document.getElementById('gType');
  if (sel) {
    const cur = sel.value;
    const customs = S.currentWs?.customGlossaryTypes || [];
    sel.innerHTML =
      Object.entries(PRESET_TYPES).map(([v, label]) => `<option value="${v}">${label}</option>`).join('') +
      customs.map(t => `<option value="${esc(t)}">${esc(t)} (custom)</option>`).join('') +
      `<option value="__newtype__">＋ ประเภทใหม่…</option>`;
    sel.value = (cur && [...sel.options].some(o => o.value === cur)) ? cur : 'term';
  }
  refreshTypeFilter();
}

// "＋ ประเภทใหม่…" — ถามชื่อ บันทึกเข้า workspace แล้วเลือกให้เลย
(function initCustomTypeOption() {
  const sel = document.getElementById('gType');
  if (!sel) return;
  sel.addEventListener('change', function () {
    if (this.value !== '__newtype__') return;
    const v = (prompt('ชื่อประเภทใหม่ (สั้นๆ เช่น ยานพาหนะ):') || '').trim();
    if (!v) { this.value = 'term'; return; }
    if (S.currentWs) {
      S.currentWs.customGlossaryTypes = [...new Set([...(S.currentWs.customGlossaryTypes || []), v])];
      lsSaveWorkspace(S.currentWs).catch(() => {});
    }
    populateGlossaryTypeSelects();
    this.value = v;
    document.getElementById('gGenderGroup').style.display = 'none';
  });
})();

// Get CSS class for any type (preset or custom)
function getTagClass(type) {
  const known = ['character','title','term','rank','honorific','place','skill','item','clan','monster'];
  return known.includes(type) ? `tag-${type}` : 'tag-custom';
}

// ─── Duplicate Check (รองรับทุกภาษา) ───
let _lastSubstrPairs = [];

// เป็น "คำเกาหลี" หรือไม่ — ต้องมีอักษรฮันกึล (Hangul) และต้องไม่มีคานะญี่ปุ่น
// ใช้กรองการตรวจคำซ้อน (substring) ให้ทำเฉพาะคำเกาหลีเท่านั้น
function isKoreanTerm(s) {
  if (!s) return false;
  if (/[぀-ヿ]/.test(s)) return false;                       // มีฮิรางานะ/คาตากานะ = ญี่ปุ่น
  return /[가-힣ᄀ-ᇿ㄰-㆏ꥠ-꥿]/.test(s); // มีฮันกึล
}

// ตรวจว่า `full` เป็น "คำซ้อน" ของ `sub` หรือไม่ — ตรวจเฉพาะคำเกาหลีเท่านั้น
// (ทั้ง sub และ full ต้องเป็นคำเกาหลี — คำภาษาอื่นจะข้ามไป ไม่ถือเป็นคำซ้อน)
// • รูปแบบมีเว้นวรรค: นับเฉพาะเมื่อ sub เป็น token ต้น/ท้ายที่ขอบคำ
// • รูปแบบไม่เว้นวรรค (ปกติของเกาหลี): นับเมื่อส่วนที่เกินสั้น (≤3 อักษร — มักเป็นคำชี้/คำต่อท้าย)
function isSubstringDup(sub, full) {
  if (!sub || !full || sub === full || !full.includes(sub)) return false;
  if (!isKoreanTerm(sub) || !isKoreanTerm(full)) return false;       // ตรวจแต่เกาหลี
  const hasSpaces = /\s/.test(sub) || /\s/.test(full);
  if (hasSpaces) {
    return full.startsWith(sub + ' ') || full.endsWith(' ' + sub) || full.includes(' ' + sub + ' ');
  }
  const idx   = full.indexOf(sub);
  const extra = full.length - sub.length; // จำนวนอักษรส่วนเกินรวม
  // ต้องเป็น prefix หรือ suffix (ขอบใดขอบหนึ่งตรงกัน) และส่วนเกินสั้น
  const isEdge = (idx === 0) || (idx + sub.length === full.length);
  return isEdge && extra <= 3;
}

// normalize คำเกาหลีก่อนเทียบ: รวม Unicode เป็น NFC + ตัดอักขระล่องหน (zero-width) + trim
// (กันคำที่ "ดูเหมือนกัน" แต่ byte ต่างกัน เลยตรวจไม่เจอ)
function _normGlossKey(s) {
  return (s || '').normalize('NFC').replace(/[​-‍﻿]/g, '').trim();
}

let _dupExactGroups = [];   // [{ key, korean, entries:[{korean,thai}], count }]

// คำนวณคำซ้ำทั้งหมด (ไม่แก้ไขข้อมูล) — exact groups + substring pairs
function computeGlossaryDuplicates() {
  const data = S.glossaryData || [];
  const map = new Map();                 // normKey -> [entries]
  data.forEach(e => {
    const k = _normGlossKey(e.korean);
    if (!k) return;
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(e);
  });
  const exactGroups = [];
  for (const [key, entries] of map) {
    if (entries.length > 1) exactGroups.push({ key, korean: entries[0].korean, entries, count: entries.length });
  }
  // substring pairs (เทียบจาก key ที่ unique แล้ว)
  const uniqKeys = [...map.keys()];
  const firstThai = {};
  for (const [k, es] of map) firstThai[k] = es[0].thai || '';
  const pairs = [];
  for (let i = 0; i < uniqKeys.length; i++) {
    for (let j = 0; j < uniqKeys.length; j++) {
      if (i === j) continue;
      if (isSubstringDup(uniqKeys[i], uniqKeys[j])) {
        if (!pairs.some(p => p.sub === uniqKeys[i] && p.full === uniqKeys[j])) {
          pairs.push({ sub: uniqKeys[i], full: uniqKeys[j], subThai: firstThai[uniqKeys[i]], fullThai: firstThai[uniqKeys[j]] });
        }
      }
    }
  }
  return { exactGroups, pairs };
}

// แสดงผลคำซ้ำในแถบ alert (ไม่ลบอัตโนมัติ — ผู้ใช้กดลบเอง) · คืน true ถ้าพบคำซ้ำ
function renderDupPanel() {
  const dupAlert = document.getElementById('glossaryDupAlert');
  if (!dupAlert) return false;
  const { exactGroups, pairs } = computeGlossaryDuplicates();
  _dupExactGroups = exactGroups;
  _lastSubstrPairs = pairs;
  if (!exactGroups.length && !pairs.length) { dupAlert.style.display = 'none'; dupAlert.innerHTML = ''; return false; }

  const btnDanger = 'background:var(--crimson-light);color:#fff;border:none;padding:2px 8px;border-radius:4px;cursor:pointer;font-size:0.72rem';
  let html = '';

  // ── คำเกาหลีซ้ำแบบเป๊ะ ──
  if (exactGroups.length) {
    const totalDup = exactGroups.reduce((s, g) => s + (g.count - 1), 0);
    html += '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:6px">' +
      '<span>⚠ <strong>คำเกาหลีซ้ำ ' + exactGroups.length + ' คำ</strong> (มีตัวซ้ำเกินรวม ' + totalDup + ')</span>' +
      '<button onclick="dupRemoveAllExact()" style="' + btnDanger + '">🗑 ลบให้เหลืออย่างละ 1</button>' +
      '</div>';
    html += exactGroups.slice(0, 12).map((g, idx) =>
      '<div style="display:flex;align-items:center;gap:6px;font-size:0.78rem;padding:2px 0">' +
        '<span style="color:var(--gold);font-weight:600">' + esc(g.korean) + '</span>' +
        '<span style="color:var(--text-muted)">×' + g.count + '</span>' +
        '<span style="color:var(--text-muted);font-size:0.7rem;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + g.entries.map(e => esc(e.thai || '—')).join(' / ') + '</span>' +
        '<button onclick="dupRemoveGroup(' + idx + ')" style="' + btnDanger + '">ลบซ้ำ</button>' +
      '</div>'
    ).join('');
    if (exactGroups.length > 12) html += '<div style="font-size:0.72rem;color:var(--text-muted)">...และอีก ' + (exactGroups.length - 12) + ' คำ</div>';
  }

  // ── คำซ้อน (substring) — ต้องใช้วิจารณญาณ ให้ AI ช่วยได้ ──
  if (pairs.length) {
    if (exactGroups.length) html += '<div style="border-top:1px solid var(--border);margin:6px 0"></div>';
    const shown = pairs.slice(0, 8);
    const more  = pairs.length - shown.length;
    html += '<div style="margin-bottom:4px;display:flex;align-items:center;gap:8px;flex-wrap:wrap">' +
      '<span>🔍 <strong>คำซ้อน ' + pairs.length + ' คู่</strong> — อาจ inject ผิด</span>' +
      '<button id="dupAiResolveBtn" onclick="aiResolveSubstrDups()" style="background:linear-gradient(135deg,#7a5820,#c9a84c);color:#0c0800;border:none;padding:2px 10px;border-radius:4px;cursor:pointer;font-size:0.72rem;font-weight:600">🤖 ให้ AI จัดการ</button>' +
      '<button id="dupFixBtn" onclick="aiFixSubstrConsistency()" title="ตรวจคู่ที่คำแปลของส่วนซ้อนไม่ตรงกัน แล้วแก้ทั้งสองให้ใช้คำเดียวกัน" style="background:linear-gradient(135deg,#2a5d4c,#4cc9a0);color:#04120c;border:none;padding:2px 10px;border-radius:4px;cursor:pointer;font-size:0.72rem;font-weight:600">🔧 แก้คำแปลให้ตรงกัน</button>' +
      '</div>';
    html += '<div id="dupAiStatus" style="font-size:0.74rem;color:var(--gold);min-height:16px"></div>';
    html += shown.map(p =>
      '<div style="font-size:0.78rem;padding:2px 0;color:var(--text-secondary)">' +
        '<span style="color:var(--gold)">' + esc(p.sub) + '</span>' +
        '<span style="color:var(--text-muted)"> ⊂ </span>' +
        '<span style="color:var(--text-primary)">' + esc(p.full) + '</span>' +
        '<span style="color:var(--text-muted);font-size:0.7rem"> — "' + esc(p.subThai) + '" vs "' + esc(p.fullThai) + '"</span>' +
      '</div>'
    ).join('');
    if (more > 0) html += '<div style="font-size:0.72rem;color:var(--text-muted)">...และอีก ' + more + ' คู่</div>';
  }

  html += '<button onclick="document.getElementById(\'glossaryDupAlert\').style.display=\'none\'" style="background:none;border:none;color:var(--text-muted);cursor:pointer;font-size:0.8rem;float:right;margin-top:4px">✕</button>';

  dupAlert.style.display = 'block';
  dupAlert.innerHTML = html;
  return true;
}

function checkDuplicateGlossary() {
  if (!(S.glossaryData || []).length) { showToast('คลังศัพท์ว่างเปล่า', ''); return; }
  const found = renderDupPanel();
  if (!found) showToast('✓ ไม่พบคำซ้ำ', 'success');
}

// ลบตัวซ้ำของกลุ่มเดียว (เก็บตัวแรก) — อ้างอิงด้วย index กัน bug จากอักขระพิเศษใน onclick
async function dupRemoveGroup(idx) {
  const g = _dupExactGroups[idx];
  if (!g || !S.currentWs) return;
  let kept = false;
  S.currentWs.glossary = (S.currentWs.glossary || []).filter(e => {
    if (_normGlossKey(e.korean) !== g.key) return true;
    if (!kept) { kept = true; return true; }   // เก็บตัวแรก
    return false;                               // ตัวซ้ำที่เหลือ → ลบ
  });
  S.glossaryData = S.currentWs.glossary;
  if (typeof _glossarySelected !== 'undefined' && _glossarySelected) _glossarySelected.clear();
  await lsSaveWorkspace(S.currentWs);
  renderGlossaryTable();
  showToast('ลบคำซ้ำของ "' + g.korean + '" แล้ว ✓', 'success');
  renderDupPanel();
}

// ลบตัวซ้ำทุกกลุ่ม (เก็บอย่างละ 1)
async function dupRemoveAllExact() {
  if (!S.currentWs) return;
  const seen = new Set();
  const deduped = [];
  let removed = 0;
  (S.currentWs.glossary || []).forEach(e => {
    const k = _normGlossKey(e.korean);
    if (!k) { deduped.push(e); return; }
    if (seen.has(k)) { removed++; }
    else { seen.add(k); deduped.push(e); }
  });
  if (!removed) { showToast('ไม่มีคำซ้ำเป๊ะ', ''); return; }
  S.currentWs.glossary = deduped;
  S.glossaryData = deduped;
  if (typeof _glossarySelected !== 'undefined' && _glossarySelected) _glossarySelected.clear();
  await lsSaveWorkspace(S.currentWs);
  renderGlossaryTable();
  showToast('ลบคำซ้ำ ' + removed + ' รายการแล้ว ✓', 'success');
  renderDupPanel();
}

// ─── AI Resolve Substring Duplicates (รองรับทุกภาษา) ───
// ── Fast-path: คำต่อท้าย/honorific ที่รู้จัก (Korean + บางภาษา) → ตัดสินเองทันทีไม่ต้องรอ AI ──
// ภาษาอื่นๆ ที่ไม่อยู่ในลิสต์นี้จะถูกส่งให้ AI วิเคราะห์ (prompt รองรับทุกภาษา)
const KOREAN_NAME_SUFFIXES = [
  // multilingual honorifics (fast-path)
  'さん','様','君','ちゃん','殿','先生','-san','-sama','-kun','-chan','님',
  // honorifics
  '씨','님','군','양','아','야',
  // social roles ที่ต่อท้ายชื่อ
  '선배','후배','형','오빠','언니','누나','아저씨','아줌마','할머니','할아버지',
  // titles/ranks ที่ใช้ต่อท้ายชื่อบุคคล
  '왕','왕자','공주','황제','황후','대왕','소왕','영주','기사','단장','단원',
  '대장','장군','총장','수장','두목','보스','마스터','스승','제자',
  // particles ที่บ่งชัด
  '이','가','은','는','을','를','의','와','과','도','만','로','으로',
  '에서','한테','께','에게','이다','이라','부터','까지',
];

const DUP_RESOLVE_PROMPT = `You are a multilingual glossary expert. The source language of these terms may be ANY language (Korean, Japanese, Chinese, English, Russian, etc.). Analyze pairs of glossary entries where the shorter source term appears inside the longer one.

RULES (apply to whatever language the terms are in):
- If the longer term = shorter term + a grammatical particle, inflection, article, plural/possessive/case marker, or punctuation, then action = "delete_full". (e.g. Korean 이하율 vs 이하율이; English "king" vs "king's"; Japanese 田中 vs 田中は)
- If the longer term = shorter term + an honorific or social title (e.g. Korean 씨/님/선배, Japanese さん/様/殿, Chinese 先生, English Mr/Sir/Lady), then action = "delete_full" — the base term is sufficient for glossary purposes.
- If both terms are CLEARLY different independent concepts (e.g. Korean 검 = sword vs 검기 = sword aura; English "sword" vs "swordsman"), then action = "keep_both".
- When unsure, action = "keep_both".

PAIRS (JSON):
{pairs}

Respond with ONLY a raw JSON array. No markdown fences, no explanation before or after.
Each element must have exactly these fields: sub, full, action, reason
The action field must be exactly one of these three strings: delete_full, delete_sub, keep_both

Example output:
[{"sub":"이하율","full":"이하율이","action":"delete_full","reason":"particle 이"},{"sub":"밀실론자","full":"밀실론자 선배","action":"delete_full","reason":"선배 = honorific suffix, base term sufficient"},{"sub":"검","full":"검기","action":"keep_both","reason":"검기 = sword aura, different meaning"}]`;

async function aiResolveSubstrDups() {
  if (!_lastSubstrPairs.length) return;
  if (!S.currentWsId) { showToast('เลือก Workspace ก่อน', 'error'); return; }

  const btn    = document.getElementById('dupAiResolveBtn');
  const status = document.getElementById('dupAiStatus');
  if (!btn || !status) return;

  btn.disabled = true;
  btn.textContent = '🤖 กำลังวิเคราะห์...';

  // ── Pre-check: คู่ที่ suffix ตรงกับ known list → ตัดสินเองทันที ──
  const preDecisions = [];
  const needAI = [];

  for (const p of _lastSubstrPairs) {
    // suffix = ส่วนที่เกิน sub ออกมาใน full (trim ช่องว่าง)
    const suffix = p.full.replace(p.sub, '').trim();
    if (KOREAN_NAME_SUFFIXES.includes(suffix)) {
      preDecisions.push({ sub: p.sub, full: p.full, action: 'delete_full', reason: `suffix "${suffix}" = honorific/particle` });
    } else {
      needAI.push(p);
    }
  }

  // ถ้าทุกคู่ถูก pre-check จัดการหมด → ไม่ต้อง call AI เลย
  let allDecisions = [...preDecisions];

  if (needAI.length > 0) {
    status.textContent = `Pre-check: ${preDecisions.length} คู่ · ส่ง AI อีก ${needAI.length} คู่...`;
    const model = document.getElementById('translateModel')?.value || 'google/gemini-2.5-flash';
    const pairData = needAI.map(p => ({ sub: p.sub, full: p.full, subThai: p.subThai, fullThai: p.fullThai }));

    try {
      const prompt = DUP_RESOLVE_PROMPT.replace('{pairs}', JSON.stringify(pairData, null, 2));
      const res = await callOpenRouter({ model, messages: [{ role: 'user', content: prompt }], temperature: 0.1, max_tokens: 1500 });
      const raw = (res.choices?.[0]?.message?.content || '').trim();
      let cleaned = raw.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/, '').trim()
        .replace(/[\u201C\u201D\u201E\u201F]/g, '"').replace(/[\u2018\u2019\u201A\u201B]/g, "'");

      let aiDecisions = null;
      try { aiDecisions = JSON.parse(cleaned); } catch {}
      if (!Array.isArray(aiDecisions)) {
        try { const m = cleaned.match(/\[[\s\S]*\]/); if (m) aiDecisions = JSON.parse(m[0]); } catch {}
      }
      if (!Array.isArray(aiDecisions)) {
        const objMatches = [...cleaned.matchAll(/\{[^{}]*"sub"\s*:\s*"([^"]+)"[^{}]*"full"\s*:\s*"([^"]+)"[^{}]*"action"\s*:\s*"([^"]+)"[^{}]*/g)];
        if (objMatches.length) aiDecisions = objMatches.map(m => ({ sub: m[1], full: m[2], action: m[3], reason: '' }));
      }
      if (Array.isArray(aiDecisions)) allDecisions = [...allDecisions, ...aiDecisions];
    } catch (e) {
      // AI ล้มเหลว แต่ยังมี preDecisions ที่จัดการได้
      if (!preDecisions.length) {
        status.textContent = '❌ ' + e.message;
        btn.disabled = false; btn.textContent = '🤖 ให้ AI จัดการ';
        return;
      }
    }
  } else {
    status.textContent = `Pre-check จัดการได้ ${preDecisions.length} คู่ ไม่ต้องใช้ AI`;
  }

  // ── Apply all decisions (pre-check + AI) ──
  try {
    const toDelete = new Set();
    let keepBothCount = 0;
    allDecisions.forEach(d => {
      if (d.action === 'delete_full') toDelete.add(d.full);
      else if (d.action === 'delete_sub') toDelete.add(d.sub);
      else keepBothCount++;
    });

    if (!toDelete.size) {
      status.textContent = `✓ ทุกคู่ต่างความหมาย เก็บไว้ทั้งหมด (${keepBothCount} คู่)`;
      btn.disabled = false; btn.textContent = '🤖 ให้ AI จัดการ';
      return;
    }

    const before = S.currentWs.glossary.length;
    S.currentWs.glossary = S.currentWs.glossary.filter(g => !toDelete.has(g.korean.trim()));
    S.glossaryData = S.currentWs.glossary;
    await lsSaveWorkspace(S.currentWs);
    renderGlossaryTable();

    const deleted = before - S.currentWs.glossary.length;
    const preCount = preDecisions.filter(d => d.action !== 'keep_both').length;
    const aiCount  = deleted - preCount;
    const reasons  = allDecisions
      .filter(d => d.action !== 'keep_both')
      .slice(0, 3)
      .map(d => `"${d.action === 'delete_full' ? d.full : d.sub}" (${d.reason})`)
      .join(' · ');

    const summary = preCount > 0 && aiCount > 0
      ? `Pre-check ${preCount} + AI ${aiCount} = ลบ ${deleted} คำ`
      : `ลบ ${deleted} คำ`;
    status.textContent = `✓ ${summary} · เก็บทั้งคู่ ${keepBothCount} คู่ · ${reasons}`;
    showToast(`จัดการ substring ซ้ำ — ลบ ${deleted} คำ ✓`, 'success');
    _lastSubstrPairs = [];
    setTimeout(() => checkDuplicateGlossary(), 400);

  } catch (e) {
    status.textContent = '❌ ' + e.message;
    btn.disabled = false; btn.textContent = '🤖 ให้ AI จัดการ';
  }
}

// ─── ตรวจทาน #2: แก้คำแปลของคู่ substring ให้สอดคล้องกัน (รองรับเกาหลี) ───
// ปัญหา: คำสั้น (겁화="กอบฮวา") ถูกแปลคนละแบบกับตอนที่อยู่ในคำยาว (겁화 가문="ตระกูลเพลิงกัลป์")
// → ให้ AI เลือกคำแปลที่ถูกต้องของส่วนที่ใช้ร่วมกัน แล้วแก้ทั้งสอง entry ให้ตรงกัน (ไม่แตะภาษาเกาหลี)
const DUP_FIX_PROMPT = `You are a Thai glossary consistency editor for a Korean→Thai webnovel glossary.
Each item is a pair where the shorter Korean term (sub) appears inside the longer Korean term (full).
Your job: find pairs where the shared Korean part is translated INCONSISTENTLY between the two Thai entries, then rewrite BOTH Thai entries so the shared part is rendered IDENTICALLY.

Inconsistency example:
- sub:  겁화 = "กอบฮวา"            (raw transliteration)
- full: 겁화 가문 = "ตระกูลเพลิงกัลป์"  (meaning-based; 가문 = ตระกูล, 겁화 = เพลิงกัลป์)
Here 겁화 is "กอบฮวา" alone but "เพลิงกัลป์" inside the compound → inconsistent.
Decide ONE best Thai for 겁화 and apply it to both:
  → 겁화 = "เพลิงกัลป์", 겁화 가문 = "ตระกูลเพลิงกัลป์"

RULES:
- Pick the single best canonical Thai for the SHARED Korean part. Prefer the meaning-based rendering already used inside the compound over a raw transliteration that doesn't match; otherwise keep whatever reads best and is most consistent.
- Rewrite subThai and fullThai so the shared part is spelled the same in both. Keep the extra word(s) of the longer term (e.g. 가문 → ตระกูล) intact.
- NEVER change the Korean. Only change the Thai.
- If a pair is ALREADY consistent (the sub's Thai already appears inside the full's Thai), or the two legitimately differ and need no change, set action = "ok" and leave the Thai as given.

PAIRS (JSON):
{pairs}

Respond with ONLY a raw JSON array. No markdown fences, no text before/after.
Each element must have exactly: sub, full, action, subThai, fullThai, reason
action must be exactly "fix" or "ok".

Example output:
[{"sub":"겁화","full":"겁화 가문","action":"fix","subThai":"เพลิงกัลป์","fullThai":"ตระกูลเพลิงกัลป์","reason":"unify 겁화 → เพลิงกัลป์"},{"sub":"검","full":"검기","action":"ok","subThai":"ดาบ","fullThai":"กระบี่ปราณ","reason":"different concepts, already fine"}]`;

async function aiFixSubstrConsistency() {
  if (!_lastSubstrPairs.length) return;
  if (!S.currentWsId) { showToast('เลือก Workspace ก่อน', 'error'); return; }

  const btn    = document.getElementById('dupFixBtn');
  const status = document.getElementById('dupAiStatus');
  if (!btn || !status) return;

  btn.disabled = true;
  const origLabel = btn.textContent;
  btn.textContent = '🔧 กำลังตรวจ...';
  status.textContent = `กำลังตรวจคำแปล ${_lastSubstrPairs.length} คู่...`;

  const model = document.getElementById('translateModel')?.value || 'google/gemini-2.5-flash';
  const pairData = _lastSubstrPairs.map(p => ({ sub: p.sub, full: p.full, subThai: p.subThai, fullThai: p.fullThai }));

  let decisions = null;
  try {
    const prompt = DUP_FIX_PROMPT.replace('{pairs}', JSON.stringify(pairData, null, 2));
    const res = await callOpenRouter({ model, messages: [{ role: 'user', content: prompt }], temperature: 0.1, max_tokens: 2000 });
    let cleaned = (res.choices?.[0]?.message?.content || '').trim()
      .replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/, '').trim()
      .replace(/[“”„‟]/g, '"').replace(/[‘’‚‛]/g, "'");
    try { decisions = JSON.parse(cleaned); } catch {}
    if (!Array.isArray(decisions)) { const m = cleaned.match(/\[[\s\S]*\]/); if (m) try { decisions = JSON.parse(m[0]); } catch {} }
  } catch (e) {
    status.textContent = '❌ ' + e.message;
    btn.disabled = false; btn.textContent = origLabel;
    return;
  }

  if (!Array.isArray(decisions)) {
    status.textContent = '❌ AI ตอบไม่ใช่ JSON — ลองใหม่อีกครั้ง';
    btn.disabled = false; btn.textContent = origLabel;
    return;
  }

  // ── สร้างแผนแก้: korean (trim) → thai ใหม่ (เฉพาะ action=fix และคำแปลเปลี่ยนจริง) ──
  const newThaiByKorean = new Map();
  const changeList = [];
  decisions.forEach(d => {
    if (!d || d.action !== 'fix') return;
    const sub = (d.sub || '').trim(), full = (d.full || '').trim();
    const st = (d.subThai || '').trim(), ft = (d.fullThai || '').trim();
    if (sub && st) newThaiByKorean.set(sub, st);
    if (full && ft) newThaiByKorean.set(full, ft);
    changeList.push({ sub, full, st, ft, reason: d.reason || '' });
  });

  if (!newThaiByKorean.size) {
    status.textContent = '✓ คำแปลทุกคู่สอดคล้องกันแล้ว ไม่ต้องแก้';
    btn.disabled = false; btn.textContent = origLabel;
    return;
  }

  // ── ลงมือแก้คลังศัพท์ (เทียบด้วย korean ที่ trim แล้ว · แก้ทุก entry ที่ตรง) ──
  try {
    let updated = 0;
    S.currentWs.glossary.forEach(g => {
      const k = (g.korean || '').trim();
      if (newThaiByKorean.has(k)) {
        const nt = newThaiByKorean.get(k);
        if ((g.thai || '').trim() !== nt) { g.thai = nt; updated++; }
      }
    });
    S.glossaryData = S.currentWs.glossary;
    await lsSaveWorkspace(S.currentWs);
    renderGlossaryTable();

    const detail = changeList.slice(0, 3)
      .map(c => `"${c.sub}"→"${c.st}"`)
      .join(' · ');
    status.textContent = `✓ แก้คำแปลให้ตรงกัน ${updated} รายการ${detail ? ' · ' + detail : ''}`;
    showToast(`ตรวจทานคำแปล — แก้ ${updated} รายการให้สอดคล้อง ✓`, 'success');
    setTimeout(() => checkDuplicateGlossary(), 400);
  } catch (e) {
    status.textContent = '❌ ' + e.message;
    btn.disabled = false; btn.textContent = origLabel;
  }
}

document.querySelectorAll('.modal-backdrop').forEach(el => {
  el.addEventListener('click', e => { if (e.target === el) el.classList.remove('open'); });
});

// ─── Auto Glossary Prompt Editor ───
const _agDefaultPrompt = `You are a Korean webnovel terminology extractor. Extract proper nouns and special terms from Korean text.

EXISTING GLOSSARY (skip these): {existing}

KOREAN SOURCE TEXT:
{text}

{thai_snippet}

Return ONLY JSON array (no markdown):
[{"korean":"term","thai":"Thai translation","type":"character|title|rank|term|honorific|place","gender":"male|female|neutral","note":"English meaning"}]

Rules:
- Only extract names, titles, skills, places, ranks — NOT common words
- Provide natural Thai translations that are CONSISTENT with professional Thai webnovel prose, so that when these terms are injected into the translated chapter they read seamlessly and never break the reader's flow
- Apply professional proofreading (พิสูจน์อักษร): correct Thai spelling/tone marks, clean transliteration, no stray source-language characters; pick ONE canonical Thai spelling per term and keep it stable
- type must be one of: character, title, rank, term, honorific, place
- gender: REQUIRED for type="character". Infer aggressively from ALL available cues:
  • Korean pronouns: 그/남자/형/오빠/아버지/아들/왕/황제 = male | 그녀/여자/언니/누나/어머니/딸/왕비 = female
  • Thai translation pronouns if provided: เขา/ผม/กู = male | เธอ/นาง/ฉัน/หนู = female
  • Leave "neutral" ONLY if genuinely impossible to determine
- Return empty array [] if no new terms found`;

function agTogglePromptEditor() {
  const wrap = document.getElementById('agPromptEditorWrap');
  const visible = wrap.style.display !== 'none';
  if (visible) {
    wrap.style.display = 'none';
  } else {
    // โหลด prompt ปัจจุบัน (จาก localStorage ถ้ามี ไม่งั้นใช้ default)
    const saved = localStorage.getItem('nt8_ag_prompt');
    document.getElementById('agPromptEditor').value = saved || _agDefaultPrompt;
    wrap.style.display = 'block';
  }
}

function agSavePrompt() {
  const val = document.getElementById('agPromptEditor').value.trim();
  if (!val.includes('{text}')) { showToast('Prompt ต้องมี {text}', 'error'); return; }
  if (!val.includes('{existing}')) { showToast('Prompt ต้องมี {existing}', 'error'); return; }
  localStorage.setItem('nt8_ag_prompt', val);
  showToast('บันทึก Prompt แล้ว ✓', 'success');
}

function agResetPrompt() {
  if (!confirm('คืนค่า Prompt เป็น default?')) return;
  localStorage.removeItem('nt8_ag_prompt');
  document.getElementById('agPromptEditor').value = _agDefaultPrompt;
  showToast('คืนค่า Prompt แล้ว ✓', 'success');
}

function agGetPrompt() {
  return localStorage.getItem('nt8_ag_prompt') || _agDefaultPrompt;
}

// ─── Clean Source Text (ลบ Base64 / ขยะ) ───
function cleanText(text) {
  return text
    // ลบ Base64 string (ยาว 20+ ตัว ประกอบด้วย A-Za-z0-9+/= ติดกัน)
    .replace(/[A-Za-z0-9+/]{20,}={0,2}/g, '')
    // ลบ URL ที่ติดมา
    .replace(/https?:\/\/\S+/g, '')
    // ลบช่องว่างซ้ำบนบรรทัดเดียวกัน
    .replace(/[ \t]{2,}/g, ' ')
    // ลบบรรทัดว่างเกิน 2 บรรทัดติดกัน
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// ─── Normalize Korean internet slang/jamo → Thai equivalents ───
function normalizeKoreanSlang(text) {
  if (!text) return text;

  return text
    // ── ㅋ (웃음/หัวเราะ) → 555 ──
    .replace(/ㅋ{8,}/g, '5555555')
    .replace(/ㅋ{6,7}/g, '555555')
    .replace(/ㅋ{4,5}/g, '5555')
    .replace(/ㅋ{3}/g, '555')
    .replace(/ㅋㅋ/g, '55')
    .replace(/ㅋ/g, '5')

    // ── ㅎ (웃음/อ่อนๆ) → 55 ──
    .replace(/ㅎ{4,}/g, '5555')
    .replace(/ㅎ{3}/g, '555')
    .replace(/ㅎㅎ/g, '55')
    .replace(/ㅎ/g, '5')

    // ── ㅠ / ㅜ (ร้องไห้) → ปล่อย AI ตัดสินเอง (ไม่แปลง) ──

    // ── ㄷㄷ (หวาดกลัว/ขนลุก) → สั่นเลย ──
    .replace(/ㄷ{4,}/g, 'สั่นเลย')
    .replace(/ㄷ{2,3}/g, 'สั่น')
    .replace(/ㄷ(?=\s|$)/g, 'สั่น')

    // ── ㅇㅇ (ยืนยัน) → อือ ──
    .replace(/ㅇㅇ+/g, 'อือ')

    // ── ㄴㄴ (ปฏิเสธ) → ไม่ๆ ──
    .replace(/ㄴㄴ+/g, 'ไม่ๆ')

    // ── ㅡㅡ (หน้าตาย) → -_- ──
    .replace(/ㅡㅡ+/g, '-_-')

    // ── ลด noise จาก !! ... ~~ มากเกิน ──
    .replace(/!{5,}/g, '!!!!!')
    .replace(/\?{5,}/g, '?????')
    .replace(/\.{4,}/g, '...')
    .replace(/~{4,}/g, '~~~');
}

function prepareSourceForTranslation(text) {
  return normalizeKoreanSlang(text);
}

function cleanSourceText() {
  const ta = document.getElementById('sourceText');
  const original = ta.value;
  const cleaned = cleanText(original);
  if (cleaned === original) { showToast('ไม่พบสิ่งที่ต้องลบ', ''); return; }

  const removed = original.length - cleaned.length;
  if (!confirm(`ลบออก ${removed.toLocaleString()} ตัวอักษร จากต้นฉบับปัจจุบัน\nดำเนินการ?`)) return;
  ta.value = cleaned;
  updateSourceStats();
  showToast(`🧹 ลบออก ${removed.toLocaleString()} ตัวอักษร ✓`, 'success');
}

async function cleanAllSourceTexts() {
  if (!S.currentWs) return;
  if (!confirm(`ลบ Base64/ขยะจาก sourceText ทุกตอนใน "${S.currentWs.name}"\nดำเนินการ? (สามารถ Undo ได้ครั้งเดียว)`)) return;
  // Undo snapshot — snapshot ทุก sourceText ก่อนแก้
  S._undoStack = {
    type: 'clean_all_source',
    snapshot: S.currentWs.chapters.map(c => ({ id: c.id, sourceText: c.sourceText }))
  };
  let totalRemoved = 0, chaptersAffected = 0;
  S.currentWs.chapters.forEach(ch => {
    if (!ch.sourceText) return;
    const cleaned = cleanText(ch.sourceText);
    if (cleaned !== ch.sourceText) {
      totalRemoved += ch.sourceText.length - cleaned.length;
      ch.sourceText = cleaned;
      chaptersAffected++;
    }
  });
  if (!chaptersAffected) { S._undoStack = null; showToast('ไม่พบสิ่งที่ต้องลบในทุกตอน', ''); return; }
  await lsSaveWorkspace(S.currentWs);
  showToast(`🧹 ลบออก ${totalRemoved.toLocaleString()} ตัวอักษร จาก ${chaptersAffected} ตอน — <u style="cursor:pointer" onclick="undoLastAction()">Undo</u>`, 'success');
}

// ─── Add Line Breaks (เพิ่ม 1 บรรทัดว่างระหว่างทุกบรรทัด) ───
function addLineBreaks(text) {
  return text
    // แต่ละบรรทัดที่มีเนื้อหา → เพิ่ม \n ต่อท้าย (ทำให้มี blank line คั่น)
    .split('\n')
    .map(line => line.trimEnd())
    .join('\n\n')
    // ลด blank lines ที่ซ้ำกัน (เผื่อมีบรรทัดอยู่แล้ว) ให้เหลือแค่ 1
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// เพิ่ม \n หลัง \n ตัวสุดท้ายที่ตามด้วย non-\n (แทรก blank line ก่อนย่อหน้าสุดท้าย)
function addOneLine(text) {
  // เพิ่ม \n อีก 1 ตัวในทุก gap ระหว่าง paragraph (กี่ครั้งก็ได้)
  // หา sequence ของ \n ที่มีอยู่ทุกตำแหน่ง แล้วเพิ่มอีก 1 เสมอ
  const result = text.replace(/\n+/g, (match) => match + '\n');
  return result;
}

function addLineBreaksOutput() {
  const output = document.getElementById('translationOutput');
  const text = output.innerText?.trim() || '';
  if (!text || text === 'คำแปลจะปรากฏที่นี่...') { showToast('ยังไม่มีคำแปล', 'error'); return; }

  const result = addLineBreaks(text);
  output.innerHTML = '';
  const el = document.createElement('div');
  el.className = 'segment-text';
  el.style.whiteSpace = 'pre-wrap';
  el.textContent = result;
  output.appendChild(el);
  showToast('📐 เพิ่ม Line Break แล้ว ✓', 'success');
}

function addOneLineOutput() {
  const output = document.getElementById('translationOutput');
  const text = output.innerText?.trim() || '';
  if (!text || text === 'คำแปลจะปรากฏที่นี่...') { showToast('ยังไม่มีคำแปล', 'error'); return; }

  const result = addOneLine(text);
  if (result === text) { showToast('ไม่มีบรรทัดให้เพิ่ม', ''); return; }
  output.innerHTML = '';
  const el = document.createElement('div');
  el.className = 'segment-text';
  el.style.whiteSpace = 'pre-wrap';
  el.textContent = result;
  output.appendChild(el);
  showToast('📐 Add 1 Line แล้ว ✓', 'success');
}

async function addOneLineAllChapters() {
  if (!S.currentWs) return;
  if (!confirm(`Add 1 Line ใน translation ทุกตอนใน "${S.currentWs.name}"\nไม่สามารถย้อนกลับได้ ดำเนินการ?`)) return;
  let chaptersAffected = 0;
  S.currentWs.chapters.forEach(ch => {
    if (!ch.translation) return;
    const result = addOneLine(ch.translation);
    if (result !== ch.translation) {
      ch.translation = result;
      chaptersAffected++;
    }
  });
  if (!chaptersAffected) { showToast('ไม่มีตอนที่ต้องเพิ่ม', ''); return; }
  await lsSaveWorkspace(S.currentWs);
  showToast(`📐 Add 1 Line ใน ${chaptersAffected} ตอน ✓`, 'success');
}

async function addLineBreaksAllChapters() {
  if (!S.currentWs) return;
  if (!confirm(`เพิ่ม Line Break ใน translation ทุกตอนใน "${S.currentWs.name}"\nไม่สามารถย้อนกลับได้ ดำเนินการ?`)) return;
  let chaptersAffected = 0;
  S.currentWs.chapters.forEach(ch => {
    if (!ch.translation) return;
    const result = addLineBreaks(ch.translation);
    if (result !== ch.translation) {
      ch.translation = result;
      chaptersAffected++;
    }
  });
  if (!chaptersAffected) { showToast('ทุกตอนมี Line Break แล้ว', ''); return; }
  await lsSaveWorkspace(S.currentWs);
  showToast(`📐 เพิ่ม Line Break ใน ${chaptersAffected} ตอน ✓`, 'success');
}

// ─── Prev Chapter Type select toggle ───
document.addEventListener('DOMContentLoaded', () => {
  const chk = document.getElementById('usePrevChapter');
  const sel = document.getElementById('prevChapterType');
  if (chk && sel) {
    chk.addEventListener('change', () => {
      sel.style.display = chk.checked ? '' : 'none';
    });
  }
  // Apply saved theme on load
  themeApplyFromStorage();
});

// ═══════════════════════════════════════════════
// ─── Bulk Rename — Find & Replace in Title Names ───
// ═══════════════════════════════════════════════

// useRegex=true → ใช้ pattern ดิบ (รองรับ regex name delete เมื่อชื่อซ้ำหลายตอนจน replace ธรรมดาไม่พอ)
function brFrBuildRegex(term, caseSensitive, useRegex, flags) {
  const p = useRegex ? term : term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const f = (flags || '') + (caseSensitive ? '' : 'i');
  return new RegExp(p, f);
}

function brFrMakeRegex() {
  const find = document.getElementById('brFrFind')?.value || '';
  const info = document.getElementById('brFrInfo');
  const cs = document.getElementById('brFrCase')?.checked;
  const useRegex = document.getElementById('brFrRegex')?.checked;
  if (!find) { if (info) { info.textContent = 'พิมพ์เพื่อค้นหา'; info.style.color = 'var(--text-muted)'; } return null; }
  try { return brFrBuildRegex(find, cs, useRegex, 'g'); }
  catch (e) { if (info) { info.textContent = 'Regex ผิด: ' + e.message; info.style.color = 'var(--crimson-light)'; } return false; }
}

function brFrLive() {
  const info = document.getElementById('brFrInfo');
  if (!info) return;
  const regex = brFrMakeRegex();
  if (regex === null) { brFrClearHighlights(); return; }
  if (regex === false) { brFrClearHighlights(); return; }
  const targets = brTargetInputs();
  let total = 0, rows = 0;
  document.querySelectorAll('.bulk-rename-input').forEach(inp => { inp.style.background = ''; inp.style.borderBottomColor = ''; });
  targets.forEach(inp => {
    const hits = (inp.value.match(regex) || []).length;
    if (hits) { total += hits; rows++; inp.style.background = 'rgba(201,168,76,0.1)'; inp.style.borderBottomColor = 'var(--gold)'; }
  });
  if (total) { info.textContent = `พบ ${total} จุดใน ${rows} ตอน`; info.style.color = 'var(--gold)'; }
  else { info.textContent = 'ไม่พบ'; info.style.color = 'var(--crimson-light)'; }
}

function brFrClearHighlights() {
  document.querySelectorAll('.bulk-rename-input').forEach(inp => {
    inp.style.background = '';
    inp.style.borderBottomColor = '';
  });
}

// แกนกลาง replace/delete — ทำเฉพาะแถวที่เลือก (หรือทุกแถวถ้าไม่เลือก)
function brFrApply(replaceWith, verb) {
  const info = document.getElementById('brFrInfo');
  const regex = brFrMakeRegex();
  if (!regex) { if (info && regex === null) { info.textContent = 'ใส่คำค้นหาก่อน'; info.style.color = 'var(--crimson-light)'; } return; }
  const targets = brTargetInputs();
  let total = 0, rows = 0;
  targets.forEach(inp => {
    const orig = inp.value;
    const hits = (orig.match(regex) || []).length;
    if (!hits) return;
    inp.value = orig.replace(regex, replaceWith);
    total += hits; rows++;
    inp.style.background = 'rgba(76,175,80,0.1)'; inp.style.borderBottomColor = '#4caf50';
  });
  if (total) { info.textContent = `${verb} ${total} จุดใน ${rows} ตอนแล้ว ✓ (ยังไม่บันทึก — กด 💾)`; info.style.color = '#4caf50'; }
  else { info.textContent = `ไม่พบสิ่งที่ต้อง${verb}`; info.style.color = 'var(--crimson-light)'; }
}

function brFrReplaceAll() {
  brFrApply(document.getElementById('brFrReplace')?.value || '', 'แทนที่');
}

// ลบส่วนที่ตรง pattern ออก (เหมาะกับลบชื่อ/คำซ้ำด้วย regex)
function brFrDeleteMatches() {
  brFrApply('', 'ลบ');
}

// ═══════════════════════════════════════════════
// ─── Theme Editor ───
// ═══════════════════════════════════════════════

const THEME_KEY = 'nt_theme_v1';

const THEME_DEFAULTS = {
  accent:       '#c9a84c',
  bgVoid:       '#080b0f',
  bgSurface:    '#111520',
  textPrimary:  '#d8dde8',
  textSecondary:'#8090a8',
  crimson:      '#c23048',
  fontBody:     "'Noto Sans Thai','Noto Serif Thai',sans-serif",
  fontSize:     '15',
  radius:       '6',
};

const THEME_PRESETS = {
  'dark-gold': {
    accent:'#c9a84c', bgVoid:'#080b0f', bgSurface:'#111520',
    textPrimary:'#d8dde8', textSecondary:'#8090a8', crimson:'#c23048',
    fontBody:"'Noto Sans Thai','Noto Serif Thai',sans-serif", fontSize:'15', radius:'6',
  },
  'deep-blue': {
    accent:'#4a8fd0', bgVoid:'#060a10', bgSurface:'#0a1525',
    textPrimary:'#ccd8e8', textSecondary:'#6a88a8', crimson:'#c23048',
    fontBody:"'Noto Sans Thai','Noto Serif Thai',sans-serif", fontSize:'15', radius:'6',
  },
  'forest': {
    accent:'#6abf7a', bgVoid:'#070e08', bgSurface:'#0d1810',
    textPrimary:'#cce8cc', textSecondary:'#78a880', crimson:'#c23048',
    fontBody:"'Noto Sans Thai','Noto Serif Thai',sans-serif", fontSize:'15', radius:'8',
  },
  'crimson': {
    accent:'#e05050', bgVoid:'#0a0608', bgSurface:'#180d0d',
    textPrimary:'#e8d0d0', textSecondary:'#a87878', crimson:'#e05050',
    fontBody:"'Noto Sans Thai','Noto Serif Thai',sans-serif", fontSize:'15', radius:'4',
  },
  'light': {
    accent:'#8b6914', bgVoid:'#f5f0e8', bgSurface:'#ffffff',
    textPrimary:'#1a1a2e', textSecondary:'#555577', crimson:'#c0392b',
    fontBody:"'Noto Sans Thai','Noto Serif Thai',sans-serif", fontSize:'15', radius:'8',
  },
};

function openThemeEditor() {
  // Load current values from storage or defaults
  const saved = themeLoad();
  document.getElementById('th-accent').value           = saved.accent;
  document.getElementById('th-accent-hex').value       = saved.accent;
  document.getElementById('th-bg-void').value          = saved.bgVoid;
  document.getElementById('th-bg-void-hex').value      = saved.bgVoid;
  document.getElementById('th-bg-surface').value       = saved.bgSurface;
  document.getElementById('th-bg-surface-hex').value   = saved.bgSurface;
  document.getElementById('th-text-primary').value     = saved.textPrimary;
  document.getElementById('th-text-primary-hex').value = saved.textPrimary;
  document.getElementById('th-text-secondary').value   = saved.textSecondary;
  document.getElementById('th-text-secondary-hex').value = saved.textSecondary;
  document.getElementById('th-crimson').value          = saved.crimson;
  document.getElementById('th-crimson-hex').value      = saved.crimson;
  document.getElementById('th-font-body').value        = saved.fontBody;
  document.getElementById('th-font-size').value        = saved.fontSize;
  document.getElementById('th-font-size-val').textContent = saved.fontSize + 'px';
  document.getElementById('th-radius').value           = saved.radius;
  document.getElementById('th-radius-val').textContent = saved.radius + 'px';
  openModal('modal-theme');
}

function themeLoad() {
  try { return { ...THEME_DEFAULTS, ...JSON.parse(localStorage.getItem(THEME_KEY) || '{}') }; }
  catch { return { ...THEME_DEFAULTS }; }
}

function themeReadInputs() {
  return {
    accent:        document.getElementById('th-accent').value,
    bgVoid:        document.getElementById('th-bg-void').value,
    bgSurface:     document.getElementById('th-bg-surface').value,
    textPrimary:   document.getElementById('th-text-primary').value,
    textSecondary: document.getElementById('th-text-secondary').value,
    crimson:       document.getElementById('th-crimson').value,
    fontBody:      document.getElementById('th-font-body').value,
    fontSize:      document.getElementById('th-font-size').value,
    radius:        document.getElementById('th-radius').value,
  };
}

function themeApply(t) {
  // Derive additional colours from base values
  const root = document.documentElement;
  root.style.setProperty('--accent',           t.accent);
  root.style.setProperty('--gold',             t.accent);
  root.style.setProperty('--gold-light',       lighten(t.accent, 25));
  root.style.setProperty('--gold-dim',         darken(t.accent, 20));
  root.style.setProperty('--accent-glow',      hexToRgba(t.accent, 0.2));
  root.style.setProperty('--bg-void',          t.bgVoid);
  root.style.setProperty('--bg-deep',          lighten(t.bgVoid, 4));
  root.style.setProperty('--bg-surface',       t.bgSurface);
  root.style.setProperty('--bg-panel',         lighten(t.bgSurface, 3));
  root.style.setProperty('--bg-raised',        lighten(t.bgSurface, 8));
  root.style.setProperty('--bg-hover',         lighten(t.bgSurface, 12));
  root.style.setProperty('--text-primary',     t.textPrimary);
  root.style.setProperty('--text-gold',        t.accent);
  root.style.setProperty('--text-secondary',   t.textSecondary);
  root.style.setProperty('--text-muted',       darken(t.textSecondary, 20));
  root.style.setProperty('--crimson-light',    t.crimson);
  root.style.setProperty('--crimson',          darken(t.crimson, 20));
  root.style.setProperty('--font-body',        t.fontBody);
  root.style.setProperty('--radius',           t.radius + 'px');
  root.style.setProperty('--radius-lg',        (parseInt(t.radius) * 2) + 'px');
  document.documentElement.style.fontSize      = t.fontSize + 'px';
}

function themePreview() {
  // sync hex inputs with color pickers
  ['accent','bg-void','bg-surface','text-primary','text-secondary','crimson'].forEach(k => {
    const colorEl = document.getElementById('th-' + k);
    const hexEl   = document.getElementById('th-' + k + '-hex');
    if (colorEl && hexEl) hexEl.value = colorEl.value;
  });
  themeApply(themeReadInputs());
}

function themeHexInput(colorId, hexId) {
  const hexEl = document.getElementById(hexId);
  const val = hexEl.value.trim();
  if (/^#[0-9a-fA-F]{6}$/.test(val)) {
    document.getElementById(colorId).value = val;
    themeApply(themeReadInputs());
  }
}

function themeSave() {
  const t = themeReadInputs();
  localStorage.setItem(THEME_KEY, JSON.stringify(t));
  themeApply(t);
  closeModal('modal-theme');
  showToast('บันทึก Theme แล้ว ✓', 'success');
}

function themeReset() {
  if (!confirm('คืนค่า Theme เป็น default?')) return;
  localStorage.removeItem(THEME_KEY);
  themeApply(THEME_DEFAULTS);
  closeModal('modal-theme');
  showToast('คืนค่า Theme แล้ว ✓', 'success');
}

function themeApplyPreset(name) {
  const p = THEME_PRESETS[name];
  if (!p) return;
  // fill inputs
  document.getElementById('th-accent').value             = p.accent;
  document.getElementById('th-accent-hex').value         = p.accent;
  document.getElementById('th-bg-void').value            = p.bgVoid;
  document.getElementById('th-bg-void-hex').value        = p.bgVoid;
  document.getElementById('th-bg-surface').value         = p.bgSurface;
  document.getElementById('th-bg-surface-hex').value     = p.bgSurface;
  document.getElementById('th-text-primary').value       = p.textPrimary;
  document.getElementById('th-text-primary-hex').value   = p.textPrimary;
  document.getElementById('th-text-secondary').value     = p.textSecondary;
  document.getElementById('th-text-secondary-hex').value = p.textSecondary;
  document.getElementById('th-crimson').value            = p.crimson;
  document.getElementById('th-crimson-hex').value        = p.crimson;
  document.getElementById('th-font-body').value          = p.fontBody;
  document.getElementById('th-font-size').value          = p.fontSize;
  document.getElementById('th-font-size-val').textContent = p.fontSize + 'px';
  document.getElementById('th-radius').value             = p.radius;
  document.getElementById('th-radius-val').textContent   = p.radius + 'px';
  themeApply(p);
}

function themeApplyFromStorage() {
  const saved = themeLoad();
  // Only apply if user has saved custom theme
  if (localStorage.getItem(THEME_KEY)) themeApply(saved);
}

// ─── Colour helpers ───
function hexToRgba(hex, alpha) {
  const r = parseInt(hex.slice(1,3),16), g = parseInt(hex.slice(3,5),16), b = parseInt(hex.slice(5,7),16);
  return `rgba(${r},${g},${b},${alpha})`;
}
function lighten(hex, pct) {
  let r = parseInt(hex.slice(1,3),16), g = parseInt(hex.slice(3,5),16), b = parseInt(hex.slice(5,7),16);
  r = Math.min(255, r + Math.round(pct * 2.55));
  g = Math.min(255, g + Math.round(pct * 2.55));
  b = Math.min(255, b + Math.round(pct * 2.55));
  return '#' + [r,g,b].map(v => v.toString(16).padStart(2,'0')).join('');
}
function darken(hex, pct) {
  let r = parseInt(hex.slice(1,3),16), g = parseInt(hex.slice(3,5),16), b = parseInt(hex.slice(5,7),16);
  r = Math.max(0, r - Math.round(pct * 2.55));
  g = Math.max(0, g - Math.round(pct * 2.55));
  b = Math.max(0, b - Math.round(pct * 2.55));
  return '#' + [r,g,b].map(v => v.toString(16).padStart(2,'0')).join('');
}


// ═══════════════════════════════════════════════
// ─── Glossary Export ───
// ═══════════════════════════════════════════════

function _getGlossaryExportData() {
  const scopeAll = document.querySelector('input[name="gexScope"][value="all"]')?.checked ?? true;
  const typeFilter = document.getElementById('gexTypeFilter')?.value || '';
  let data = [...(S.glossaryData || [])];
  if (!scopeAll && typeFilter) data = data.filter(g => g.type === typeFilter);
  else if (!scopeAll) data = [...(S.glossaryData || [])]; // "filtered" แต่ไม่ได้เลือก type = ทั้งหมด
  return data;
}

function _getGlossaryExportCols() {
  return {
    korean: document.getElementById('gexColKorean')?.checked ?? true,
    thai:   document.getElementById('gexColThai')?.checked ?? true,
    type:   document.getElementById('gexColType')?.checked ?? true,
    note:   document.getElementById('gexColNote')?.checked ?? true,
    source: document.getElementById('gexColSource')?.checked ?? false,
  };
}

function openGlossaryExport() {
  if (!S.glossaryData?.length) { showToast('คลังศัพท์ว่างเปล่า', 'error'); return; }
  // sync type filter from main glossary filter
  const mainFilter = document.getElementById('glossaryTypeFilter')?.value || '';
  const scopeRadio = document.querySelector('input[name="gexScope"][value="filtered"]');
  const gexType = document.getElementById('gexTypeFilter');
  if (mainFilter && gexType) {
    gexType.value = mainFilter;
    if (scopeRadio) scopeRadio.checked = true;
  } else {
    document.querySelector('input[name="gexScope"][value="all"]').checked = true;
  }
  glossaryExportPreview();
  openModal('modal-glossary-export');
}

function getSmartGlossary(content, glossaryArray) {
  if (!glossaryArray || glossaryArray.length === 0) return [];

  // 1. แยกคำที่เป็น "Global" (เช่น ชื่อพระเอก) ให้ติดไปทุกตอน
  const globalTerms = glossaryArray.filter(g => g.note && g.note.toLowerCase().includes('global'));
  const normalTerms = glossaryArray.filter(g => !g.note || !g.note.toLowerCase().includes('global'));

  // 2. สร้างลิสต์คำเกาหลีเพื่อทำ Regex (เรียงจากยาวไปสั้น)
  const sortedKeys = normalTerms
    .map(g => (g.korean || '').trim())
    .filter(k => k.length > 0)
    .sort((a, b) => b.length - a.length);

  if (sortedKeys.length === 0) return globalTerms;

  // 3. สร้าง Pattern ค้นหา
  const pattern = new RegExp(sortedKeys.map(k => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'g');

  // 4. สแกนหาคำที่ Match ในเนื้อหา
  const matches = new Set(content.match(pattern) || []);
  const matchedGlossary = normalTerms.filter(g => matches.has((g.korean || '').trim()));

  // 5. รวมผลลัพธ์และลบตัวซ้ำ
  const final = [...globalTerms, ...matchedGlossary];
  return Array.from(new Map(final.map(item => [item.korean, item])).values());
}

function glossaryExportPreview() {
  const data = _getGlossaryExportData();
  const cols = _getGlossaryExportCols();
  const info = document.getElementById('glossaryExportInfo');
  const box  = document.getElementById('glossaryExportPreviewBox');
  if (info) info.textContent = `${data.length} รายการที่จะ export`;

  // Preview: CSV format เสมอ (ดูง่ายสุด)
  const header = [];
  if (cols.korean) header.push('Korean');
  if (cols.thai)   header.push('Thai');
  if (cols.type)   header.push('Type');
  if (cols.note)   header.push('Note');
  if (cols.source) header.push('Source');

  const preview = data.slice(0, 5).map(g => {
    const row = [];
    if (cols.korean) row.push(g.korean || '');
    if (cols.thai)   row.push(g.thai || '');
    if (cols.type)   row.push(g.type || '');
    if (cols.note)   row.push(g.note || '');
    if (cols.source) row.push(g.sourceChapterTitle ? `#${g.sourceChapterNum||'?'} ${g.sourceChapterTitle}` : '');
    return row.map(v => v.includes(',') || v.includes('"') ? `"${v.replace(/"/g,'""')}"` : v).join(',');
  });

  if (box) box.textContent = [header.join(','), ...preview].join('\n') + (data.length > 5 ? `\n...และอีก ${data.length - 5} แถว` : '');
}

function doExportGlossary(format) {
  const data = _getGlossaryExportData();
  if (!data.length) { showToast('ไม่มีข้อมูล', 'error'); return; }
  const cols = _getGlossaryExportCols();
  const wsName = S.currentWs?.name || 'glossary';
  const filename = `${wsName}_glossary`;

  if (format === 'json') {
    // JSON — export ทุก field เสมอ (ไม่กรอง col เพราะ JSON ต้องการ structure ครบ)
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json;charset=utf-8' });
    downloadBlob(blob, `${filename}.json`);
    showToast('Export JSON สำเร็จ ✓', 'success');
    return;
  }

  // สร้าง row array ตาม cols ที่เลือก
  const header = [];
  if (cols.korean) header.push('Korean');
  if (cols.thai)   header.push('Thai');
  if (cols.type)   header.push('Type');
  if (cols.note)   header.push('Note');
  if (cols.source) header.push('Source');

  const rows = data.map(g => {
    const row = [];
    if (cols.korean) row.push(g.korean || '');
    if (cols.thai)   row.push(g.thai || '');
    if (cols.type)   row.push(g.type || '');
    if (cols.note)   row.push(g.note || '');
    if (cols.source) row.push(g.sourceChapterTitle ? `#${g.sourceChapterNum||'?'} ${g.sourceChapterTitle}` : '');
    return row;
  });

  if (format === 'csv') {
    const csvEsc = v => (v.includes(',') || v.includes('"') || v.includes('\n'))
      ? `"${v.replace(/"/g, '""')}"` : v;
    const lines = [header, ...rows].map(r => r.map(csvEsc).join(','));
    const blob = new Blob(['\uFEFF' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
    downloadBlob(blob, `${filename}.csv`);
    showToast('Export CSV สำเร็จ ✓', 'success');
    return;
  }

  if (format === 'txt') {
    // Tab-separated, readable
    const lines = [header.join('\t'), ...rows.map(r => r.join('\t'))];
    const blob = new Blob([lines.join('\n')], { type: 'text/plain;charset=utf-8' });
    downloadBlob(blob, `${filename}.txt`);
    showToast('Export TXT สำเร็จ ✓', 'success');
    return;
  }

  if (format === 'md') {
    // Markdown table
    const sep = header.map(() => '---');
    const mdRows = rows.map(r => '| ' + r.map(v => v.replace(/\|/g, '\\|')).join(' | ') + ' |');
    const md = [
      `# Glossary — ${wsName}`,
      '',
      '| ' + header.join(' | ') + ' |',
      '| ' + sep.join(' | ') + ' |',
      ...mdRows,
    ].join('\n');
    const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
    downloadBlob(blob, `${filename}.md`);
    showToast('Export MD สำเร็จ ✓', 'success');
    return;
  }

  if (format === 'xlsx') {
    // XLSX แบบ pure XML (SpreadsheetML) — ไม่ต้องใช้ library
    const xmlEsc = s => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
    const allRows = [header, ...rows];
    const sheetRows = allRows.map(r =>
      '<Row>' + r.map(v => `<Cell><Data ss:Type="String">${xmlEsc(v)}</Data></Cell>`).join('') + '</Row>'
    ).join('\n');

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
  xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
  <Styles>
    <Style ss:ID="header">
      <Font ss:Bold="1"/>
      <Interior ss:Color="#1a1f35" ss:Pattern="Solid"/>
      <Font ss:Color="#c9a84c" ss:Bold="1"/>
    </Style>
  </Styles>
  <Worksheet ss:Name="Glossary">
    <Table>
${sheetRows}
    </Table>
  </Worksheet>
</Workbook>`;
    const blob = new Blob([xml], { type: 'application/vnd.ms-excel;charset=utf-8' });
    downloadBlob(blob, `${filename}.xls`);
    showToast('Export XLSX สำเร็จ ✓ (เปิดด้วย Excel/Sheets ได้)', 'success');
    return;
  }
}
