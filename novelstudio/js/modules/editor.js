// ═══ M2 — Editor: เขียนรายตอน (autosave, รายชื่อตอน, ไฮไลต์ Codex, quick-add) ═══

import {
  S, uid, now, emit, on, currentChapter, selectChapter, saveChapter, refreshChapters,
} from '../state.js';
import { dbPut, dbDel, dbBulkPut } from '../db.js';
import { countWords, fmtNum, escapeHtml, highlightCodexHtml, debounce } from '../utils/text.js';
import { toast, openMenu, confirmModal, openModal } from '../utils/ui.js';
import { renderAiPanel, refreshContextBar } from './ai-assist.js';
import { renderCodexMiniList, openCodexModal } from './codex.js';
import { openSummaryModal, statusLabel } from './memory.js';

let els = {};          // อ้างอิง DOM ปัจจุบันของหน้าเขียน
let leftTab = 'chapters';
let busBound = false;

// ── API ให้แผง AI ใช้ ──
const editorApi = {
  getSelection() {
    const ta = els.textarea;
    if (!ta) return null;
    return { start: ta.selectionStart, end: ta.selectionEnd, text: ta.value.slice(ta.selectionStart, ta.selectionEnd) };
  },
  appendText(text) {
    const ta = els.textarea;
    if (!ta) return;
    const sep = ta.value.trim() ? '\n\n' : '';
    ta.value = ta.value.replace(/\s+$/, '') + sep + text.trim() + '\n';
    ta.scrollTop = ta.scrollHeight;
    onInput();
    saveNow();
  },
  replaceRange(start, end, newText, expectedOld) {
    const ta = els.textarea;
    if (!ta) return false;
    let s = start, e = end;
    if (ta.value.slice(s, e) !== expectedOld) {
      const i = ta.value.indexOf(expectedOld);
      if (i < 0) return false;
      s = i; e = i + expectedOld.length;
    }
    ta.value = ta.value.slice(0, s) + newText + ta.value.slice(e);
    ta.setSelectionRange(s, s + newText.length);
    onInput();
    saveNow();
    return true;
  },
  scrollToText(quote) {
    const ta = els.textarea;
    if (!ta || !quote) return false;
    const i = ta.value.indexOf(quote.trim());
    if (i < 0) return false;
    ta.focus();
    ta.setSelectionRange(i, i + quote.trim().length);
    // ใช้ backdrop (layout ตรงกับ textarea เป๊ะ) หา offset จริงของตำแหน่ง
    const before = escapeHtml(ta.value.slice(0, i));
    const target = escapeHtml(ta.value.slice(i, i + quote.trim().length));
    els.backdrop.innerHTML = `${before}<mark id="scroll-target" style="background:var(--accent-soft);border-bottom:2px solid var(--accent)">${target}</mark>${escapeHtml(ta.value.slice(i + quote.trim().length))}`;
    const mark = els.backdrop.querySelector('#scroll-target');
    if (mark) ta.scrollTop = Math.max(0, mark.offsetTop - ta.clientHeight / 3);
    syncBackdropScroll();
    setTimeout(() => updateBackdrop(), 2200);
    return true;
  },
  flushSave() { if (saveDebounced.pending()) saveDebounced.flush(); },
};

// ── autosave (debounce 2 วิ) ──
const saveDebounced = debounce(saveNow, 2000);
const visualDebounced = debounce(() => { updateBackdrop(); updateWordCount(); refreshContextBar(); }, 500);

async function saveNow() {
  const ch = currentChapter();
  const ta = els.textarea;
  if (!ch || !ta || !ta.isConnected) return;
  if (ch.content === ta.value) return;
  ch.content = ta.value;
  ch.wordCount = countWords(ch.content);
  await saveChapter(ch);
  updateChapterRow(ch);
  setSaveState('✓ บันทึกแล้ว');
}

function onInput() {
  setSaveState('กำลังพิมพ์…');
  saveDebounced();
  visualDebounced();
}

function setSaveState(msg) {
  if (els.saveState) els.saveState.textContent = msg;
}

// ── หน้าเขียนหลัก ──
export function renderWrite(main) {
  if (!S.project) {
    main.innerHTML = `<div class="empty-state"><div class="big">✍️</div>ยังไม่ได้เปิดเรื่อง<br>
      <button class="btn primary" style="margin-top:14px" onclick="location.hash='#/projects'">ไปหน้าเรื่องของฉัน</button></div>`;
    return;
  }

  const layout = document.createElement('div');
  layout.className = 'write-layout';
  layout.innerHTML = `
    <aside class="pane-left">
      <div class="tabs" id="left-tabs">
        <button data-tab="chapters">📑 ตอน</button>
        <button data-tab="codex">📚 Codex</button>
      </div>
      <div class="pane-head" id="left-head"></div>
      <div id="left-body" style="display:flex;flex-direction:column;flex:1;min-height:0;overflow-y:auto"></div>
    </aside>
    <section class="pane-center">
      <div class="editor-head">
        <div class="row1">
          <button class="btn ghost icon mobile-only" id="btn-drawer" title="รายชื่อตอน">☰</button>
          <input type="text" class="editor-title" id="ch-title" placeholder="ชื่อตอน…">
          <select id="ch-status" title="สถานะตอน" style="min-height:34px;padding:4px 6px">
            <option value="draft">✏️ ร่าง</option>
            <option value="done">✅ เสร็จ</option>
            <option value="published">📤 เผยแพร่แล้ว</option>
          </select>
        </div>
        <div class="editor-meta">
          <span id="ch-wc"></span>
          <span id="save-state" style="min-width:80px"></span>
          <span class="spacer" style="flex:1"></span>
          <button class="btn ghost sm" id="btn-summary">📝 สรุปตอนนี้</button>
          <button class="btn ghost sm" id="btn-zen" title="โหมดเขียนโล่ง">🧘 โล่ง</button>
        </div>
        <details class="prev-summary" id="prev-sum" style="display:none">
          <summary>⏮ สรุปตอนก่อนหน้า</summary>
          <div id="prev-sum-text"></div>
        </details>
      </div>
      <div class="editor-wrap" id="editor-wrap">
        <div id="sel-bar"><button class="btn sm primary" id="sel-add"></button></div>
        <div class="editor-backdrop" id="ed-backdrop"></div>
        <textarea class="editor-textarea" id="ed-text" placeholder="เริ่มเขียนได้เลย…" spellcheck="false"></textarea>
      </div>
    </section>
    <aside class="pane-right" id="ai-pane"></aside>
    <div class="drawer-backdrop" id="drawer-bd"></div>`;

  main.replaceChildren(layout);
  main.style.overflowY = 'hidden';

  els = {
    layout,
    leftBody: layout.querySelector('#left-body'),
    leftHead: layout.querySelector('#left-head'),
    textarea: layout.querySelector('#ed-text'),
    backdrop: layout.querySelector('#ed-backdrop'),
    title: layout.querySelector('#ch-title'),
    status: layout.querySelector('#ch-status'),
    wc: layout.querySelector('#ch-wc'),
    saveState: layout.querySelector('#save-state'),
    prevSum: layout.querySelector('#prev-sum'),
    prevSumText: layout.querySelector('#prev-sum-text'),
    selBar: layout.querySelector('#sel-bar'),
    selAdd: layout.querySelector('#sel-add'),
  };

  els.textarea.style.setProperty('--editor-font-size', `${S.settings.editorFontSize || 18}px`);
  els.backdrop.style.setProperty('--editor-font-size', `${S.settings.editorFontSize || 18}px`);
  els.textarea.style.fontSize = `${S.settings.editorFontSize || 18}px`;
  els.backdrop.style.fontSize = `${S.settings.editorFontSize || 18}px`;

  // แท็บซ้าย
  layout.querySelectorAll('#left-tabs button').forEach(b => {
    b.classList.toggle('active', b.dataset.tab === leftTab);
    b.onclick = () => { leftTab = b.dataset.tab; renderLeftPane(); };
  });

  // editor events
  els.textarea.addEventListener('input', onInput);
  els.textarea.addEventListener('scroll', syncBackdropScroll);
  els.textarea.addEventListener('blur', () => editorApi.flushSave());
  ['mouseup', 'keyup', 'touchend'].forEach(ev =>
    els.textarea.addEventListener(ev, () => setTimeout(updateSelBar, 10)));

  els.title.onchange = async () => {
    const ch = currentChapter();
    if (!ch) return;
    ch.title = els.title.value.trim();
    await saveChapter(ch);
    renderChapterList();
  };
  els.status.onchange = async () => {
    const ch = currentChapter();
    if (!ch) return;
    ch.status = els.status.value;
    await saveChapter(ch);
    renderChapterList();
  };
  layout.querySelector('#btn-summary').onclick = () => {
    const ch = currentChapter();
    if (ch) { editorApi.flushSave(); openSummaryModal(ch); }
  };
  layout.querySelector('#btn-zen').onclick = () => document.body.classList.add('zen');
  layout.querySelector('#btn-drawer').onclick = () => document.body.classList.add('drawer-open');
  layout.querySelector('#drawer-bd').onclick = () => document.body.classList.remove('drawer-open', 'sheet-open');

  els.selAdd.onclick = () => {
    const sel = editorApi.getSelection();
    const name = sel?.text?.trim();
    if (!name) return;
    const ta = els.textarea;
    const surrounding = ta.value.slice(Math.max(0, sel.start - 250), Math.min(ta.value.length, sel.end + 250));
    hideSelBar();
    openCodexModal({
      prefill: { name, surrounding },
      onSaved: () => { updateBackdrop(); refreshContextBar(); renderLeftPane(); },
    });
  };

  renderAiPanel(layout.querySelector('#ai-pane'), editorApi);
  renderLeftPane();
  loadChapterIntoEditor();
  bindBusOnce();
}

function bindBusOnce() {
  if (busBound) return;
  busBound = true;
  on('chapters-changed', () => { if (isLive()) renderChapterList(); });
  on('codex-changed', () => {
    if (!isLive()) return;
    updateBackdrop();
    refreshContextBar();
    if (leftTab === 'codex') renderLeftPane();
  });
  on('chapter-selected', () => { if (isLive()) { loadChapterIntoEditor(); renderChapterList(); } });
  // กันข้อมูลหายตอนสลับแอพ/ปิดจอมือถือ
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') editorApi.flushSave();
  });
  window.addEventListener('beforeunload', () => editorApi.flushSave());
}

function isLive() {
  return !!els.layout?.isConnected;
}

// ── pane ซ้าย ──
function renderLeftPane() {
  if (!isLive()) return;
  els.layout.querySelectorAll('#left-tabs button').forEach(b =>
    b.classList.toggle('active', b.dataset.tab === leftTab));

  if (leftTab === 'chapters') {
    els.leftHead.innerHTML = `<span>${S.chapters.length} ตอน</span><span class="spacer"></span>
      <button class="btn sm primary" id="btn-new-ch">＋ ตอนใหม่</button>`;
    els.leftHead.querySelector('#btn-new-ch').onclick = newChapter;
    const ul = document.createElement('ul');
    ul.className = 'ch-list';
    ul.id = 'ch-list';
    els.leftBody.replaceChildren(ul);
    renderChapterList();
  } else {
    els.leftHead.innerHTML = `<span>${S.codex.length} รายการ</span><span class="spacer"></span>
      <button class="btn sm primary" id="btn-new-cdx">＋ เพิ่ม</button>`;
    els.leftHead.querySelector('#btn-new-cdx').onclick = () =>
      openCodexModal({ onSaved: () => renderLeftPane() });
    renderCodexMiniList(els.leftBody);
  }
}

function renderChapterList() {
  const ul = els.layout?.querySelector('#ch-list');
  if (!ul) return;
  ul.replaceChildren();
  const sorted = [...S.chapters].sort((a, b) => a.number - b.number);
  for (const ch of sorted) {
    const li = document.createElement('li');
    li.className = `ch-item ${ch.id === S.chapterId ? 'active' : ''}`;
    li.dataset.id = ch.id;
    li.draggable = true;
    const needSum = ch.content?.trim() && !ch.summary?.trim();
    li.innerHTML = `
      <span class="num">${ch.number}</span>
      <span class="ttl">${escapeHtml(ch.title || `ตอนที่ ${ch.number}`)}</span>
      ${needSum ? '<span class="no-sum" title="ยังไม่สรุปตอน">📝</span>' : ''}
      <span class="wc">${fmtNum(ch.wordCount || 0)}</span>
      <span class="status-chip status-${ch.status || 'draft'}" title="${statusLabel(ch.status)}">●</span>
      <button class="btn ghost icon sm menu-btn">⋮</button>`;
    li.onclick = async (e) => {
      if (e.target.closest('.menu-btn')) return;
      editorApi.flushSave();
      await selectChapter(ch.id);
      document.body.classList.remove('drawer-open');
    };
    li.querySelector('.menu-btn').onclick = (e) => {
      e.stopPropagation();
      chapterMenu(e.currentTarget, ch);
    };
    // drag reorder
    li.addEventListener('dragstart', (e) => e.dataTransfer.setData('text/plain', ch.id));
    li.addEventListener('dragover', (e) => { e.preventDefault(); li.classList.add('dragover'); });
    li.addEventListener('dragleave', () => li.classList.remove('dragover'));
    li.addEventListener('drop', async (e) => {
      e.preventDefault();
      li.classList.remove('dragover');
      const fromId = e.dataTransfer.getData('text/plain');
      if (fromId && fromId !== ch.id) await moveChapter(fromId, ch.id);
    });
    ul.appendChild(li);
  }
}

function updateChapterRow(ch) {
  const li = els.layout?.querySelector(`.ch-item[data-id="${ch.id}"]`);
  if (!li) return;
  li.querySelector('.wc').textContent = fmtNum(ch.wordCount || 0);
  const needSum = ch.content?.trim() && !ch.summary?.trim();
  const badge = li.querySelector('.no-sum');
  if (needSum && !badge) renderChapterList();
  if (!needSum && badge) badge.remove();
}

function chapterMenu(anchor, ch) {
  openMenu(anchor, [
    { label: 'สรุปตอนนี้', icon: '📝', onClick: () => openSummaryModal(ch) },
    { label: 'เปลี่ยนชื่อตอน', icon: '✏️', onClick: () => renameChapter(ch) },
    'hr',
    { label: 'ย้ายขึ้น', icon: '⬆️', onClick: () => nudgeChapter(ch, -1) },
    { label: 'ย้ายลง', icon: '⬇️', onClick: () => nudgeChapter(ch, +1) },
    'hr',
    { label: 'ลบตอนนี้', icon: '🗑', cls: 'danger', onClick: () => deleteChapter(ch) },
  ]);
}

function renameChapter(ch) {
  openModal({
    title: '✏️ เปลี่ยนชื่อตอน',
    bodyHtml: `<label class="fld">ชื่อตอน<input type="text" id="rn-title" value="${escapeHtml(ch.title || '')}"></label>`,
    buttons: [
      { label: 'ยกเลิก', onClick: () => {} },
      {
        label: '💾 บันทึก', cls: 'primary',
        onClick: async (body) => {
          ch.title = body.querySelector('#rn-title').value.trim();
          await saveChapter(ch);
          renderChapterList();
          if (ch.id === S.chapterId) els.title.value = ch.title;
        },
      },
    ],
    onOpen: (body) => body.querySelector('#rn-title').focus(),
  });
}

async function newChapter() {
  editorApi.flushSave();
  const number = S.chapters.reduce((m, c) => Math.max(m, c.number || 0), 0) + 1;
  const ch = {
    id: uid('ch'),
    projectId: S.project.id,
    number,
    title: `ตอนที่ ${number}`,
    content: '',
    summary: '',
    status: 'draft',
    wordCount: 0,
    updatedAt: now(),
  };
  await dbPut('chapters', ch);
  await refreshChapters();
  await selectChapter(ch.id);
  els.textarea?.focus();
}

async function moveChapter(fromId, toId) {
  const sorted = [...S.chapters].sort((a, b) => a.number - b.number);
  const fromIdx = sorted.findIndex(c => c.id === fromId);
  const toIdx = sorted.findIndex(c => c.id === toId);
  if (fromIdx < 0 || toIdx < 0) return;
  const [moved] = sorted.splice(fromIdx, 1);
  sorted.splice(toIdx, 0, moved);
  await renumber(sorted);
}

async function nudgeChapter(ch, dir) {
  const sorted = [...S.chapters].sort((a, b) => a.number - b.number);
  const i = sorted.findIndex(c => c.id === ch.id);
  const j = i + dir;
  if (j < 0 || j >= sorted.length) return;
  [sorted[i], sorted[j]] = [sorted[j], sorted[i]];
  await renumber(sorted);
}

async function renumber(sorted) {
  sorted.forEach((c, i) => { c.number = i + 1; c.updatedAt = now(); });
  await dbBulkPut('chapters', sorted);
  await refreshChapters();
  loadChapterIntoEditor();
}

async function deleteChapter(ch) {
  const ok = await confirmModal('🗑 ลบตอนนี้?',
    `ลบ "ตอนที่ ${ch.number}${ch.title ? ` — ${ch.title}` : ''}" (${fmtNum(ch.wordCount || 0)} คำ) — กู้คืนไม่ได้`,
    { danger: true, okLabel: 'ลบถาวร' });
  if (!ok) return;
  await dbDel('chapters', ch.id);
  if (S.chapterId === ch.id) S.chapterId = null;
  await refreshChapters();
  const remain = [...S.chapters].sort((a, b) => a.number - b.number);
  await renumber(remain);
  if (!S.chapterId && remain.length) await selectChapter(remain[remain.length - 1].id);
  else loadChapterIntoEditor();
  toast('ลบตอนแล้ว', 'ok');
}

// ── โหลดตอนเข้า editor ──
function loadChapterIntoEditor() {
  if (!isLive()) return;
  const ch = currentChapter();
  const has = !!ch;
  els.textarea.disabled = !has;
  els.title.disabled = !has;
  els.status.disabled = !has;

  if (!has) {
    els.textarea.value = '';
    els.title.value = '';
    els.backdrop.innerHTML = '';
    els.wc.textContent = '';
    els.prevSum.style.display = 'none';
    els.textarea.placeholder = S.chapters.length
      ? 'เลือกตอนจากรายการด้านซ้าย…'
      : 'กด "＋ ตอนใหม่" ด้านซ้าย (หรือปุ่ม ☰ บนมือถือ) เพื่อเริ่มตอนแรก';
    return;
  }

  els.textarea.value = ch.content || '';
  els.title.value = ch.title || '';
  els.status.value = ch.status || 'draft';
  setSaveState('');
  updateWordCount();
  updateBackdrop();
  syncBackdropScroll();
  hideSelBar();
  refreshContextBar();

  // สรุปตอนก่อนหน้า (พับไว้บนหัวตอน)
  const prev = [...S.chapters].filter(c => c.number < ch.number).sort((a, b) => b.number - a.number)[0];
  if (prev?.summary?.trim()) {
    els.prevSum.style.display = '';
    els.prevSumText.textContent = prev.summary;
    els.prevSum.querySelector('summary').textContent = `⏮ สรุปตอนที่ ${prev.number}${prev.title ? ` — ${prev.title}` : ''}`;
  } else {
    els.prevSum.style.display = 'none';
  }
}

function updateWordCount() {
  const ch = currentChapter();
  if (!els.wc || !ch) return;
  els.wc.textContent = `${fmtNum(countWords(els.textarea.value))} คำ`;
}

// ── backdrop ไฮไลต์ชื่อ Codex ──
function updateBackdrop() {
  if (!isLive()) return;
  els.backdrop.innerHTML = highlightCodexHtml(els.textarea.value, S.codex) + '\n';
  syncBackdropScroll();
}

function syncBackdropScroll() {
  if (els.backdrop && els.textarea) els.backdrop.scrollTop = els.textarea.scrollTop;
}

// ── quick-add bar (ลากคลุมชื่อ → เพิ่มเข้า Codex) ──
function updateSelBar() {
  const sel = editorApi.getSelection();
  const text = sel?.text?.trim() || '';
  if (text && text.length <= 60 && !text.includes('\n')) {
    const already = S.codex.some(e => e.name === text || (e.aliases || []).includes(text));
    els.selAdd.textContent = already ? `"${text.slice(0, 20)}" มีใน Codex แล้ว` : `➕ เพิ่ม "${text.slice(0, 20)}${text.length > 20 ? '…' : ''}" เข้า Codex`;
    els.selAdd.disabled = already;
    els.selBar.classList.add('show');
  } else {
    hideSelBar();
  }
}

function hideSelBar() {
  els.selBar?.classList.remove('show');
}
