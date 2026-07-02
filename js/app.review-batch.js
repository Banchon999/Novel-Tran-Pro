// ─── Review Search state ───
let _rsMatches = [];
let _rsMatchIdx = -1;
let _rsCurrentTexts = {};   // { chId: liveText }
let _rsPendingChanges = {}; // { chId: newText } — accumulated, saved on close
let _rsBStartFull = 0;      // actual index in full text where context slice starts
let _rsAEndFull   = 0;      // actual index in full text where context slice ends
let _rsEditMode   = false;  // true = free-edit textarea mode

function openFindReplace() {
  document.getElementById('frFind').value = '';
  document.getElementById('frReplace').value = '';
  document.getElementById('frMatchInfo').textContent = 'พิมพ์เพื่อค้นหา';
  document.getElementById('frMatchInfo').style.color = 'var(--text-muted)';
  document.getElementById('frWsResults').style.display = 'none';
  _frMatches = []; _frMatchIdx = -1;
  frRenderHistory();
  openModal('modal-findreplace');
  setTimeout(() => document.getElementById('frFind').focus(), 150);
}

function getFROptions() {
  return {
    caseSensitive: document.getElementById('frCaseSensitive').checked,
    wholeWord: document.getElementById('frWholeWord').checked,
    regex: document.getElementById('frRegex').checked,
  };
}

function buildFRRegex(term, opts, flags) {
  let p = opts.regex ? term : term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (opts.wholeWord && !opts.regex) p = `\\b${p}\\b`;
  const f = (flags !== undefined ? flags : '') + (opts.caseSensitive ? '' : 'i');
  return new RegExp(p, f);
}

function frKeyDown(e) {
  if (e.key === 'Enter') { e.shiftKey ? frNavPrev() : frNavNext(); }
}

function frLiveSearch() {
  const term = document.getElementById('frFind').value;
  const scope = document.getElementById('frScope').value;
  _frMatches = []; _frMatchIdx = -1;

  if (!term) {
    document.getElementById('frMatchInfo').textContent = 'พิมพ์เพื่อค้นหา';
    document.getElementById('frMatchInfo').style.color = 'var(--text-muted)';
    document.getElementById('frWsResults').style.display = 'none';
    return;
  }

  const opts = getFROptions();
  try {
    if (scope === 'current') {
      const text = document.getElementById('translationOutput').innerText || '';
      const regex = buildFRRegex(term, opts, 'g');
      const matches = [...text.matchAll(regex)];
      _frMatches = matches.map(m => ({ chId: null, chTitle: null, index: m.index, match: m[0] }));
      const info = document.getElementById('frMatchInfo');
      if (matches.length) {
        info.textContent = `พบ ${matches.length} รายการ`;
        info.style.color = 'var(--gold)';
        _frMatchIdx = 0;
        frHighlightInOutput(term, opts);
      } else {
        info.textContent = 'ไม่พบคำนี้';
        info.style.color = 'var(--crimson-light)';
      }
      document.getElementById('frWsResults').style.display = 'none';
    } else {
      // workspace scan
      const chapters = S.currentWs?.chapters || [];
      const wsDiv = document.getElementById('frWsResults');
      let totalHits = 0;
      let html = '';
      chapters.forEach(ch => {
        if (!ch.translation) return;
        const regex = buildFRRegex(term, opts, 'g');
        const hits = [...ch.translation.matchAll(regex)];
        if (!hits.length) return;
        totalHits += hits.length;
        const preview = ch.translation.slice(Math.max(0, hits[0].index - 30), hits[0].index + 60).replace(/\n/g,' ');
        html += `<div style="padding:3px 0;border-bottom:1px solid var(--border)"><span style="color:var(--gold);font-size:0.72rem">#${ch.chapterNum||'?'} ${esc(ch.title)}</span> <span style="color:var(--text-muted)">— ${hits.length} รายการ</span><div style="color:var(--text-secondary);font-size:0.72rem;margin-top:1px">...${esc(preview)}...</div></div>`;
      });
      const info = document.getElementById('frMatchInfo');
      if (totalHits) {
        info.textContent = `พบ ${totalHits} รายการใน Workspace`;
        info.style.color = 'var(--gold)';
        wsDiv.innerHTML = html || '<div style="color:var(--text-muted);padding:4px">ไม่พบในตอนไหน</div>';
        wsDiv.style.display = 'block';
      } else {
        info.textContent = 'ไม่พบในทุกตอน';
        info.style.color = 'var(--crimson-light)';
        wsDiv.style.display = 'none';
      }
    }
  } catch(e) {
    document.getElementById('frMatchInfo').textContent = 'Regex ไม่ถูกต้อง';
    document.getElementById('frMatchInfo').style.color = 'var(--crimson-light)';
  }
}

function frHighlightInOutput(term, opts) {
  // visual highlight via mark tags (only for current scope)
  const output = document.getElementById('translationOutput');
  // Remove old highlights
  output.querySelectorAll('mark.fr-hl').forEach(m => {
    m.replaceWith(document.createTextNode(m.textContent));
  });
  if (!term) return;
  try {
    const regex = buildFRRegex(term, opts, 'g');
    const walk = (node) => {
      if (node.nodeType === 3) {
        const parts = node.textContent.split(regex);
        if (parts.length <= 1) return;
        const frag = document.createDocumentFragment();
        let lastIdx = 0;
        const matches = [...node.textContent.matchAll(regex)];
        matches.forEach((m, i) => {
          frag.appendChild(document.createTextNode(node.textContent.slice(lastIdx, m.index)));
          const mark = document.createElement('mark');
          mark.className = 'fr-hl';
          mark.textContent = m[0];
          mark.style.background = 'rgba(201,168,76,0.35)';
          mark.style.color = 'var(--gold-light)';
          mark.style.borderRadius = '2px';
          frag.appendChild(mark);
          lastIdx = m.index + m[0].length;
        });
        frag.appendChild(document.createTextNode(node.textContent.slice(lastIdx)));
        node.parentNode.replaceChild(frag, node);
      } else if (node.nodeType === 1 && !['mark'].includes(node.tagName.toLowerCase())) {
        [...node.childNodes].forEach(walk);
      }
    };
    [...output.childNodes].forEach(walk);
    // Scroll to first match
    const firstMark = output.querySelector('mark.fr-hl');
    if (firstMark) firstMark.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    _frHighlightNodes = [...output.querySelectorAll('mark.fr-hl')];
    frUpdateActiveHighlight();
  } catch {}
}

function frUpdateActiveHighlight() {
  _frHighlightNodes.forEach((m, i) => {
    m.style.background = i === _frMatchIdx ? 'rgba(201,168,76,0.7)' : 'rgba(201,168,76,0.3)';
    m.style.outline = i === _frMatchIdx ? '2px solid var(--gold)' : 'none';
  });
  if (_frHighlightNodes[_frMatchIdx]) {
    _frHighlightNodes[_frMatchIdx].scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }
  const info = document.getElementById('frMatchInfo');
  if (_frHighlightNodes.length) {
    info.textContent = `${_frMatchIdx + 1} / ${_frHighlightNodes.length} รายการ`;
    info.style.color = 'var(--gold)';
  }
}

function frNavNext() {
  if (!_frHighlightNodes.length) { frLiveSearch(); return; }
  _frMatchIdx = (_frMatchIdx + 1) % _frHighlightNodes.length;
  frUpdateActiveHighlight();
}
function frNavPrev() {
  if (!_frHighlightNodes.length) return;
  _frMatchIdx = (_frMatchIdx - 1 + _frHighlightNodes.length) % _frHighlightNodes.length;
  frUpdateActiveHighlight();
}

function frFindAll() {
  frLiveSearch();
}

async function frReplaceAll() {
  const find = document.getElementById('frFind').value;
  const replace = document.getElementById('frReplace').value;
  const info = document.getElementById('frMatchInfo');
  if (!find) { info.textContent = 'ใส่คำค้นหาก่อน'; return; }
  const opts = getFROptions();
  const scope = document.getElementById('frScope').value;

  frPushHistory(find, replace);

  try {
    const regex = buildFRRegex(find, opts, 'g');
    if (scope === 'current') {
      const output = document.getElementById('translationOutput');
      // remove highlights first
      output.querySelectorAll('mark.fr-hl').forEach(m => m.replaceWith(document.createTextNode(m.textContent)));
      const segments = output.querySelectorAll('.segment-text');
      let total = 0;
      if (segments.length > 0) {
        segments.forEach(seg => {
          const orig = seg.textContent;
          const hits = orig.match(buildFRRegex(find, opts, 'g'));
          if (hits) { seg.textContent = orig.replace(regex, replace); total += hits.length; }
        });
      } else {
        const orig = output.innerText;
        const hits = orig.match(regex);
        total = hits ? hits.length : 0;
        if (total) output.textContent = orig.replace(regex, replace);
      }
      info.textContent = total ? `แทนที่ ${total} รายการแล้ว ✓` : 'ไม่พบ';
      info.style.color = total ? '#4caf50' : 'var(--crimson-light)';
      _frMatches = []; _frHighlightNodes = []; _frMatchIdx = -1;
    } else {
      // workspace-wide replace
      let total = 0;
      (S.currentWs?.chapters || []).forEach(ch => {
        if (!ch.translation) return;
        const hits = ch.translation.match(buildFRRegex(find, opts, 'g'));
        if (hits) { ch.translation = ch.translation.replace(regex, replace); total += hits.length; }
      });
      if (total) await lsSaveWorkspace(S.currentWs);
      info.textContent = total ? `แทนที่ ${total} รายการในทุกตอนแล้ว ✓` : 'ไม่พบ';
      info.style.color = total ? '#4caf50' : 'var(--crimson-light)';
    }
  } catch(e) { info.textContent = 'Regex ไม่ถูกต้อง'; info.style.color = 'var(--crimson-light)'; }
}

function frReplaceCurrent() {
  const find = document.getElementById('frFind').value;
  const replace = document.getElementById('frReplace').value;
  const info = document.getElementById('frMatchInfo');
  if (!find) return;
  const opts = getFROptions();
  frPushHistory(find, replace);

  try {
    const output = document.getElementById('translationOutput');
    // replace only current highlighted match
    if (_frHighlightNodes[_frMatchIdx]) {
      _frHighlightNodes[_frMatchIdx].replaceWith(document.createTextNode(replace));
      _frHighlightNodes.splice(_frMatchIdx, 1);
      if (_frMatchIdx >= _frHighlightNodes.length) _frMatchIdx = Math.max(0, _frHighlightNodes.length - 1);
      frUpdateActiveHighlight();
      info.textContent = `แทนที่แล้ว · เหลือ ${_frHighlightNodes.length} รายการ`;
      info.style.color = '#4caf50';
    } else {
      // fallback: replace first occurrence
      output.querySelectorAll('mark.fr-hl').forEach(m => m.replaceWith(document.createTextNode(m.textContent)));
      const text = output.innerText;
      const regex = buildFRRegex(find, opts);
      const replaced = text.replace(regex, replace);
      if (replaced !== text) { output.textContent = replaced; info.textContent = 'แทนที่ 1 รายการแล้ว'; info.style.color = '#4caf50'; }
      else { info.textContent = 'ไม่พบ'; info.style.color = 'var(--crimson-light)'; }
    }
  } catch(e) { info.textContent = 'Regex ไม่ถูกต้อง'; info.style.color = 'var(--crimson-light)'; }
}

function frPushHistory(find, replace) {
  if (!find) return;
  const entry = { find, replace };
  _frHistory = [entry, ..._frHistory.filter(h => h.find !== find || h.replace !== replace)].slice(0, 8);
  sessionStorage.setItem('fr_history', JSON.stringify(_frHistory));
  frRenderHistory();
}

function frRenderHistory() {
  const wrap = document.getElementById('frHistoryWrap');
  if (!wrap) return;
  wrap.innerHTML = _frHistory.slice(0, 5).map((h, i) => `
    <span class="btn-xs" onclick="frApplyHistory(${i})" title="${esc(h.find)} → ${esc(h.replace)}" style="max-width:80px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(h.find)}</span>
  `).join('');
}

function frApplyHistory(i) {
  const h = _frHistory[i];
  if (!h) return;
  document.getElementById('frFind').value = h.find;
  document.getElementById('frReplace').value = h.replace;
  frLiveSearch();
}

// ─── Review Search ───
function openReviewSearch(prefill) {
  _rsMatches = [];
  _rsMatchIdx = -1;
  _rsCurrentTexts = {};
  _rsPendingChanges = {};

  const findEl = document.getElementById('rsFind');
  const repEl  = document.getElementById('rsReplaceInput');
  findEl.value = prefill || '';
  repEl.value  = '';

  _rsEditMode = false;
  ['rsProgressBar','rsContextWrap'].forEach(id => document.getElementById(id).style.display = 'none');
  document.getElementById('rsReplaceWrap').style.display = 'none';
  document.getElementById('rsEndMsg').style.display = 'none';
  document.getElementById('rsSaveBtn').style.display = 'none';

  openModal('modal-review-search');
  setTimeout(() => { findEl.focus(); if (prefill) rsSearch(); }, 150);
}

function _rsGetOpts() {
  return {
    caseSensitive: document.getElementById('rsCaseSensitive').checked,
    wholeWord:     document.getElementById('rsWholeWord').checked,
    regex:         document.getElementById('rsRegex').checked,
  };
}

function rsSearch() {
  const term = document.getElementById('rsFind').value.trim();
  if (!term) { showToast('ใส่คำค้นหาก่อน', 'error'); return; }

  const opts     = _rsGetOpts();
  const chapters = S.currentWs?.chapters || [];

  _rsMatches       = [];
  _rsMatchIdx      = -1;
  _rsCurrentTexts  = {};
  _rsPendingChanges = {};

  // Snapshot live texts
  chapters.forEach(ch => { if (ch.translation) _rsCurrentTexts[ch.id] = ch.translation; });

  // Build match list — track occurrenceIndex within each chapter
  try {
    chapters.forEach(ch => {
      if (!ch.translation) return;
      const re   = buildFRRegex(term, opts, 'g');
      const hits = [...ch.translation.matchAll(re)];
      hits.forEach((m, occIdx) => {
        _rsMatches.push({
          chId: ch.id,
          chapterNum: ch.chapterNum,
          title:      ch.title || '',
          occurrenceIndex: occIdx, // which occurrence in the original text
          match:    m[0],
          replaced: false,
        });
      });
    });
  } catch(e) {
    showToast('Regex ไม่ถูกต้อง', 'error');
    return;
  }

  document.getElementById('rsEndMsg').style.display = 'none';
  document.getElementById('rsSaveBtn').style.display = 'none';

  if (!_rsMatches.length) {
    showToast(`ไม่พบ "${term}" ในทุกตอน`, 'info');
    ['rsProgressBar','rsContextWrap'].forEach(id => document.getElementById(id).style.display = 'none');
    document.getElementById('rsReplaceWrap').style.display = 'none';
    return;
  }

  _rsMatchIdx = 0;
  rsRenderCurrent();
}

function rsRenderCurrent() {
  const m = _rsMatches[_rsMatchIdx];
  if (!m) return;

  const CONTEXT = 160;
  const term    = document.getElementById('rsFind').value.trim();
  const opts    = _rsGetOpts();
  const text    = _rsCurrentTexts[m.chId] || '';

  // How many earlier matches in the same chapter were REPLACED (text was removed)?
  const replacedBefore = _rsMatches
    .slice(0, _rsMatchIdx)
    .filter(x => x.chId === m.chId && x.replaced)
    .length;
  const occInCurrent = m.occurrenceIndex - replacedBefore;

  let hit;
  try {
    const re   = buildFRRegex(term, opts, 'g');
    const hits = [...text.matchAll(re)];
    hit = hits[occInCurrent];
  } catch(e) { hit = null; }

  if (!hit) { rsGoNext(); return; } // occurrence dissolved — skip silently

  const idx       = hit.index;
  const matchText = hit[0];
  const bStart    = Math.max(0, idx - CONTEXT);
  const aEnd      = Math.min(text.length, idx + matchText.length + CONTEXT);
  const before    = (bStart > 0 ? '…' : '') + text.slice(bStart, idx);
  const after     = text.slice(idx + matchText.length, aEnd) + (aEnd < text.length ? '…' : '');

  // Store slice boundaries for free-edit mode
  _rsBStartFull = bStart;
  _rsAEndFull   = aEnd;

  // Exit edit mode when navigating to new match
  if (_rsEditMode) rsExitEditMode();

  // Build context display
  const ctxDiv = document.getElementById('rsContextDisplay');
  ctxDiv.innerHTML = '';

  const bNode = document.createElement('span');
  bNode.style.cssText = 'color:var(--text-muted);white-space:pre-wrap';
  bNode.textContent = before;

  const markEl = document.createElement('mark');
  markEl.style.cssText = [
    'background:rgba(201,168,76,0.45)',
    'color:var(--gold-light)',
    'border-radius:3px',
    'padding:0 3px',
    'font-weight:700',
    'outline:2px solid var(--gold)',
    'white-space:pre-wrap',
  ].join(';');
  markEl.textContent = matchText;

  const aNode = document.createElement('span');
  aNode.style.cssText = 'color:var(--text-muted);white-space:pre-wrap';
  aNode.textContent = after;

  ctxDiv.appendChild(bNode);
  ctxDiv.appendChild(markEl);
  ctxDiv.appendChild(aNode);
  setTimeout(() => markEl.scrollIntoView({ block: 'nearest', behavior: 'smooth' }), 40);

  // Progress
  const pct = ((_rsMatchIdx + 1) / _rsMatches.length) * 100;
  document.getElementById('rsProgressFill').style.width = pct + '%';
  document.getElementById('rsCountInfo').textContent =
    `${_rsMatchIdx + 1} / ${_rsMatches.length} รายการ`;
  document.getElementById('rsCountInfo').style.color = 'var(--gold)';
  document.getElementById('rsChapterInfo').textContent =
    `ตอน ${m.chapterNum ?? '?'}: ${m.title}`;

  document.getElementById('rsProgressBar').style.display = 'block';
  document.getElementById('rsContextWrap').style.display  = 'block';
  document.getElementById('rsReplaceWrap').style.display  = 'flex';
  document.getElementById('rsEndMsg').style.display       = 'none';

  // Pre-fill replace input with the matched word
  const repEl = document.getElementById('rsReplaceInput');
  repEl.value = matchText;
  repEl.focus();
  repEl.select();
}

function rsReplaceAndNext() {
  const m = _rsMatches[_rsMatchIdx];
  if (!m) return;

  const term       = document.getElementById('rsFind').value.trim();
  const replaceWith = document.getElementById('rsReplaceInput').value;
  const opts       = _rsGetOpts();

  const replacedBefore = _rsMatches
    .slice(0, _rsMatchIdx)
    .filter(x => x.chId === m.chId && x.replaced)
    .length;
  const occInCurrent = m.occurrenceIndex - replacedBefore;

  let text = _rsCurrentTexts[m.chId] || '';
  try {
    const re   = buildFRRegex(term, opts, 'g');
    const hits = [...text.matchAll(re)];
    const hit  = hits[occInCurrent];
    if (hit) {
      text = text.slice(0, hit.index) + replaceWith + text.slice(hit.index + hit[0].length);
      _rsCurrentTexts[m.chId]  = text;
      _rsPendingChanges[m.chId] = text;
      m.replaced = true;
    }
  } catch(e) {}

  rsGoNext();
}

function rsSkip() { rsGoNext(); }

// ── Free-edit mode ──
function rsToggleEditMode() {
  if (_rsEditMode) {
    rsExitEditMode();
  } else {
    rsEnterEditMode();
  }
}

function rsEnterEditMode() {
  const m = _rsMatches[_rsMatchIdx];
  if (!m) return;

  _rsEditMode = true;

  // Pre-fill textarea with the actual text slice (no decorative '…')
  const text    = _rsCurrentTexts[m.chId] || '';
  const snippet = text.slice(_rsBStartFull, _rsAEndFull);
  const editTa  = document.getElementById('rsContextEdit');
  editTa.value  = snippet;

  // Show textarea, hide highlight div and replace input
  document.getElementById('rsContextDisplay').style.display = 'none';
  editTa.style.display = 'block';
  document.getElementById('rsEditHint').style.display = 'block';
  document.getElementById('rsReplaceWrap').style.display = 'none';

  // Swap footer buttons
  document.getElementById('rsReplaceBtn').style.display  = 'none';
  document.getElementById('rsSkipBtn').style.display     = 'none';
  document.getElementById('rsSaveContextBtn').style.display = 'inline-flex';

  // Update toggle button label
  document.getElementById('rsEditToggleBtn').textContent = '✕ ยกเลิกแก้ไข';
  document.getElementById('rsEditToggleBtn').style.color = 'var(--crimson-light)';

  // Scroll to highlight (find position of match in textarea)
  const term  = document.getElementById('rsFind').value.trim();
  const opts  = _rsGetOpts();
  try {
    const re  = buildFRRegex(term, opts);
    const pos = snippet.search(re);
    if (pos >= 0) {
      editTa.focus();
      editTa.setSelectionRange(pos, pos + (snippet.match(re)?.[0]?.length || 0));
    } else {
      editTa.focus();
    }
  } catch(e) { editTa.focus(); }
}

function rsExitEditMode() {
  _rsEditMode = false;
  document.getElementById('rsContextDisplay').style.display = 'block';
  document.getElementById('rsContextEdit').style.display    = 'none';
  document.getElementById('rsEditHint').style.display       = 'none';
  document.getElementById('rsReplaceWrap').style.display    = 'flex';
  document.getElementById('rsReplaceBtn').style.display     = 'inline-flex';
  document.getElementById('rsSkipBtn').style.display        = 'inline-flex';
  document.getElementById('rsSaveContextBtn').style.display = 'none';
  document.getElementById('rsEditToggleBtn').textContent    = '✏ แก้ไขตรงๆ';
  document.getElementById('rsEditToggleBtn').style.color    = '';
}

function rsSaveContextAndNext() {
  const m = _rsMatches[_rsMatchIdx];
  if (!m) return;

  const editedSnippet = document.getElementById('rsContextEdit').value;
  const fullText      = _rsCurrentTexts[m.chId] || '';
  const newText       = fullText.slice(0, _rsBStartFull) + editedSnippet + fullText.slice(_rsAEndFull);

  if (newText !== fullText) {
    _rsCurrentTexts[m.chId]   = newText;
    _rsPendingChanges[m.chId] = newText;
    m.replaced = true; // mark so occurrence indices adjust
  }

  rsExitEditMode();
  rsGoNext();
}

function rsNavPrev() {
  if (_rsMatchIdx > 0) {
    _rsMatchIdx--;
    document.getElementById('rsEndMsg').style.display = 'none';
    rsRenderCurrent();
  }
}

function rsGoNext() {
  if (_rsMatchIdx < _rsMatches.length - 1) {
    _rsMatchIdx++;
    rsRenderCurrent();
  } else {
    // All done
    document.getElementById('rsContextWrap').style.display  = 'none';
    document.getElementById('rsReplaceWrap').style.display  = 'none';
    document.getElementById('rsEndMsg').style.display       = 'block';
    document.getElementById('rsSaveBtn').style.display         = 'inline-flex';
    document.getElementById('rsSkipBtn').style.display         = 'none';
    document.getElementById('rsReplaceBtn').style.display      = 'none';
    document.getElementById('rsSaveContextBtn').style.display  = 'none';
    if (_rsEditMode) rsExitEditMode();

    const info = document.getElementById('rsCountInfo');
    info.textContent = `✓ ตรวจครบ ${_rsMatches.length} รายการ`;
    info.style.color = '#4caf50';
    document.getElementById('rsProgressFill').style.width = '100%';
  }
}

async function rsSaveAndClose() {
  const changedIds = Object.keys(_rsPendingChanges);
  if (changedIds.length) {
    const chs = S.currentWs?.chapters || [];
    chs.forEach(ch => {
      if (_rsPendingChanges[ch.id] !== undefined) {
        ch.translation = _rsPendingChanges[ch.id];
        ch.updatedAt   = Date.now();
        // recalculate wordCount
        ch.wordCount   = ch.translation.length;
      }
    });
    await lsSaveWorkspace(S.currentWs);
    renderChapters();
    showToast(`บันทึกการแก้ไข ${changedIds.length} ตอนแล้ว ✓`, 'success');
  }
  closeModal('modal-review-search');

  // Reset button states for next open
  _rsEditMode = false;
  document.getElementById('rsSkipBtn').style.display        = '';
  document.getElementById('rsReplaceBtn').style.display     = '';
  document.getElementById('rsSaveContextBtn').style.display = 'none';
  document.getElementById('rsEditToggleBtn').textContent    = '✏ แก้ไขตรงๆ';
  document.getElementById('rsEditToggleBtn').style.color    = '';
}

// ─── Export ───
function openExportModal() {
  const wsName = S.currentWs?.name;
  const label = document.getElementById('wsExportLabel');
  const btns = document.getElementById('wsExportBtns');
  if (wsName) { label.textContent = `📚 Export ทั้ง Workspace — ${wsName}`; btns.style.display = 'flex'; }
  else { label.textContent = ''; btns.style.display = 'none'; }
  openModal('modal-export');
}

function getTranslationText() {
  const text = document.getElementById('translationOutput').innerText?.trim() || '';
  return text === 'คำแปลจะปรากฏที่นี่...' ? '' : text;
}

function exportCurrentTXT() {
  const text = getTranslationText();
  if (!text) { showToast('ยังไม่มีคำแปล', 'error'); return; }
  downloadBlob(new Blob([text], { type: 'text/plain;charset=utf-8' }), `${S.currentWs?.name || 'translation'}.txt`);
  showToast('Export TXT สำเร็จ ✓', 'success');
}

function exportWorkspaceTXT() {
  if (!S.currentWs) return;
  const chapters = [...(S.currentWs.chapters || [])].sort((a, b) => (a.chapterNum||0) - (b.chapterNum||0));
  const text = chapters.map(ch => `=== ${ch.title} ===\n\n${ch.translation || '(ยังไม่มีคำแปล)'}`).join('\n\n\n');
  downloadBlob(new Blob([text], { type: 'text/plain;charset=utf-8' }), `${S.currentWs.name}.txt`);
  showToast('Export TXT สำเร็จ ✓', 'success');
}

// ── DOCX helpers ──
function buildDocxXml(title, paragraphs) {
  const escXml = s => s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  const paras = paragraphs.map(p => {
    if (!p.trim()) return '<w:p/>';
    const lines = p.split('\n');
    return lines.map(line => `<w:p><w:r><w:rPr><w:rFonts w:ascii="Tahoma" w:hAnsi="Tahoma"/></w:rPr><w:t xml:space="preserve">${escXml(line)}</w:t></w:r></w:p>`).join('');
  }).join('');
  const titleXml = title ? `<w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:rPr><w:b/><w:sz w:val="36"/><w:rFonts w:ascii="Tahoma" w:hAnsi="Tahoma"/></w:rPr><w:t>${escXml(title)}</w:t></w:r></w:p><w:p/>` : '';
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:wpc="http://schemas.microsoft.com/office/word/2010/wordprocessingCanvas"
  xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
  xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<w:body>
${titleXml}${paras}
<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr>
</w:body>
</w:document>`;
}

function buildDocxZip(docXml) {
  // Build a minimal .docx (ZIP) containing word/document.xml
  const files = {
    '_rels/.rels': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`,
    'word/_rels/document.xml.rels': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>`,
    'word/document.xml': docXml,
    '[Content_Types].xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`,
  };
  return buildZipBuffer(files);
}

function exportCurrentDOCX() {
  const text = getTranslationText();
  if (!text) { showToast('ยังไม่มีคำแปล', 'error'); return; }
  const docXml = buildDocxXml(S.currentWs?.name || '', text.split('\n\n'));
  const buf = buildDocxZip(docXml);
  downloadBlob(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }), `${S.currentWs?.name || 'translation'}.docx`);
  showToast('Export DOCX สำเร็จ ✓', 'success');
}

function exportWorkspaceDOCX() {
  if (!S.currentWs) return;
  const chapters = [...(S.currentWs.chapters || [])].sort((a,b) => (a.chapterNum||0)-(b.chapterNum||0));
  const escXml = s => s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  const body = chapters.map(ch => {
    const heading = `<w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:rPr><w:b/><w:sz w:val="32"/><w:rFonts w:ascii="Tahoma" w:hAnsi="Tahoma"/></w:rPr><w:t>${escXml(ch.title)}</w:t></w:r></w:p><w:p/>`;
    const content = (ch.translation || '(ยังไม่มีคำแปล)').split('\n').map(line =>
      `<w:p><w:r><w:rPr><w:rFonts w:ascii="Tahoma" w:hAnsi="Tahoma"/></w:rPr><w:t xml:space="preserve">${escXml(line)}</w:t></w:r></w:p>`).join('');
    return heading + content + '<w:p/><w:p/>';
  }).join('');
  const docXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr></w:body></w:document>`;
  const buf = buildDocxZip(docXml);
  downloadBlob(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }), `${S.currentWs.name}.docx`);
  showToast('Export DOCX สำเร็จ ✓', 'success');
}

function exportWorkspaceZIP() {
  if (!S.currentWs) return;
  const chapters = [...(S.currentWs.chapters || [])].sort((a,b) => (a.chapterNum||0)-(b.chapterNum||0));
  const files = {};
  chapters.forEach(ch => {
    const num = String(ch.chapterNum || '0').padStart(3, '0');
    const safeName = ch.title.replace(/[\\/:*?"<>|]/g, '_');
    const fname = `${num}_${safeName}.txt`;
    files[fname] = ch.translation || '(ยังไม่มีคำแปล)';
  });
  const buf = buildZipBuffer(files);
  downloadBlob(new Blob([buf], { type: 'application/zip' }), `${S.currentWs.name}.zip`);
  showToast('Export ZIP สำเร็จ ✓', 'success');
}

// ── Pure-JS ZIP builder ──
function buildZipBuffer(files) {
  const enc = new TextEncoder();
  const localHeaders = [];
  const centralHeaders = [];
  let offset = 0;

  function crc32(data) {
    let crc = 0xFFFFFFFF;
    const table = crc32.table || (crc32.table = (() => {
      const t = new Uint32Array(256);
      for (let i = 0; i < 256; i++) {
        let c = i;
        for (let j = 0; j < 8; j++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
        t[i] = c;
      }
      return t;
    })());
    for (let i = 0; i < data.length; i++) crc = table[(crc ^ data[i]) & 0xFF] ^ (crc >>> 8);
    return (crc ^ 0xFFFFFFFF) >>> 0;
  }

  function u16le(v) { return [(v & 0xFF), (v >> 8) & 0xFF]; }
  function u32le(v) { return [(v & 0xFF), (v >> 8) & 0xFF, (v >> 16) & 0xFF, (v >> 24) & 0xFF]; }
  function concat(...arrays) {
    const total = arrays.reduce((s, a) => s + a.length, 0);
    const out = new Uint8Array(total);
    let pos = 0;
    for (const a of arrays) { out.set(a, pos); pos += a.length; }
    return out;
  }

  const parts = [];
  for (const [name, content] of Object.entries(files)) {
    const nameBytes = enc.encode(name);
    const dataBytes = typeof content === 'string' ? enc.encode(content) : content;
    const crc = crc32(dataBytes);
    const localHeader = new Uint8Array([
      0x50,0x4B,0x03,0x04, // sig
      0x14,0x00, // version
      0x00,0x00, // flags
      0x00,0x00, // compression (stored)
      0x00,0x00, 0x00,0x00, // mod time/date
      ...u32le(crc),
      ...u32le(dataBytes.length),
      ...u32le(dataBytes.length),
      ...u16le(nameBytes.length),
      0x00,0x00, // extra len
      ...nameBytes,
    ]);
    localHeaders.push({ name: nameBytes, offset, crc, size: dataBytes.length });
    parts.push(localHeader, dataBytes);
    offset += localHeader.length + dataBytes.length;
  }

  const centralStart = offset;
  for (const lh of localHeaders) {
    const centralEntry = new Uint8Array([
      0x50,0x4B,0x01,0x02,
      0x14,0x00, 0x14,0x00,
      0x00,0x00, 0x00,0x00,
      0x00,0x00, 0x00,0x00,
      ...u32le(lh.crc),
      ...u32le(lh.size),
      ...u32le(lh.size),
      ...u16le(lh.name.length),
      0x00,0x00,             // extra field length
      0x00,0x00,             // file comment length
      0x00,0x00,             // disk number start
      0x00,0x00,             // internal file attributes
      0x00,0x00,0x00,0x00,   // external file attributes (4 bytes)
      ...u32le(lh.offset),
      ...lh.name,
    ]);
    parts.push(centralEntry);
    offset += centralEntry.length;
  }

  const centralSize = offset - centralStart;
  const eocd = new Uint8Array([
    0x50,0x4B,0x05,0x06,
    0x00,0x00, 0x00,0x00,
    ...u16le(localHeaders.length),
    ...u16le(localHeaders.length),
    ...u32le(centralSize),
    ...u32le(centralStart),
    0x00,0x00,
  ]);
  parts.push(eocd);
  return concat(...parts);
}


// ─── Batch Chapter Translate ───
function openBatchChapters() {
  if (!S.currentWs) { showToast('เลือก Workspace ก่อน', 'error'); return; }
  const chapters = [...(S.currentWs.chapters || [])].sort((a,b) => (a.chapterNum||0)-(b.chapterNum||0));
  if (!chapters.length) { showToast('ยังไม่มีตอน', 'error'); return; }
  document.getElementById('bchChapterList').innerHTML = chapters.map(ch => `
    <label class="bch-ch-row" style="display:flex;align-items:center;gap:8px;padding:5px 6px;border-radius:4px;cursor:pointer">
      <input type="checkbox" class="bch-chk" data-id="${ch.id}" style="accent-color:var(--gold)"
        onclick="rangeCheckboxClick(event,'bch-modal','.bch-chk',bchUpdateCount)"
        onchange="bchUpdateCount()" title="Shift+คลิก เพื่อเลือกช่วง"/>
      <span style="font-size:0.76rem;color:var(--text-muted);min-width:26px">#${ch.chapterNum||'?'}</span>
      <span style="flex:1;font-size:0.82rem;color:var(--text-primary)">${esc(ch.title)}</span>
      <span class="status-badge ${ch.status==='translated'?'translated':'pending'}" style="font-size:0.6rem">${ch.status==='translated'?'&#10003; แปลแล้ว':'&#9675; รอ'}</span>
      <span style="font-size:0.68rem;color:var(--text-muted)">${ch.sourceText?ch.sourceText.length.toLocaleString()+' ตัวอักษร':'&#8212;'}</span>
    </label>
  `).join('');
  // populate รายการโมเดลตาม provider ปัจจุบัน (ไม่มีตัวเลือกกำหนดเอง — เลือกจาก quick bar แทน)
  renderModelSelect(document.getElementById('bchModel'), getProvider(), document.getElementById('translateModel').value, false);
  document.getElementById('bchProgressBox').style.display = 'none';
  document.getElementById('bchLog').innerHTML = '';
  document.getElementById('bchStartBtn').disabled = false;
  document.getElementById('bchSelectedCount').textContent = '0 ตอนที่เลือก';
  openModal('modal-batch-chapters');
}
function bchUpdateCount() {
  document.getElementById('bchSelectedCount').textContent = `${document.querySelectorAll('.bch-chk:checked').length} ตอนที่เลือก`;
}
function bchSelectAll()    { document.querySelectorAll('.bch-chk').forEach(el => el.checked = true);  bchUpdateCount(); }
function bchDeselectAll()  { document.querySelectorAll('.bch-chk').forEach(el => el.checked = false); bchUpdateCount(); }
function bchSelectPending() {
  document.querySelectorAll('.bch-chk').forEach(el => {
    const ch = S.currentWs?.chapters.find(c => c.id === el.dataset.id);
    el.checked = ch?.status !== 'translated';
  });
  bchUpdateCount();
}
async function startBatchChapters() {
  const checked = [...document.querySelectorAll('.bch-chk:checked')];
  if (!checked.length) { showToast('เลือกตอนก่อน', 'error'); return; }
  if (S.translating) { showToast('กำลังแปลอยู่', 'error'); return; }
  const skipTranslated = document.getElementById('bchSkipTranslated').checked;
  const model          = document.getElementById('bchModel').value;
  const usePolish      = document.getElementById('bchUsePolish').checked;
  const usePrevContext = document.getElementById('bchUsePrevContext').checked;
  // ── โหมดแบ่ง chunk สำหรับ batch (ตั้งใน ⚙ ตั้งค่า Workspace) ──
  const batchChunkMode = S.currentWs?.settings?.batchChunkMode || 'off';
  const batchChunkSize = Math.max(1000, Math.min(20000, parseInt(S.currentWs?.settings?.batchChunkSize) || 3000));
  // Batch: glossaryStr จะสร้างใหม่ per chapter (smart filtering)
  let selectedChapters = checked
    .map(el => S.currentWs.chapters.find(c => c.id === el.dataset.id)).filter(Boolean)
    .sort((a,b) => (a.chapterNum||0)-(b.chapterNum||0));
  if (skipTranslated) selectedChapters = selectedChapters.filter(ch => ch.status !== 'translated');
  if (!selectedChapters.length) { showToast('ไม่มีตอนที่ต้องแปล', ''); return; }
  setTranslating(true);
  const btn = document.getElementById('bchStartBtn');
  btn.disabled = true;
  const log = document.getElementById('bchLog');
  document.getElementById('bchProgressBox').style.display = 'block';
  log.innerHTML = '';
  if (!getApiKey()) { showToast('ยังไม่ได้ตั้ง API Key', 'error'); setTranslating(false); btn.disabled = false; return; }
  const n = selectedChapters.length;

  // ── Summary cache: chapterId → summary string ──
  const _summaryCache = {};
  const CONCURRENCY = 5; // parallel summary calls สูงสุด

  // helper: สร้าง prompt สรุปสำหรับ prevCh
  function buildSummaryPrompt(prevCh) {
    const textSample = prevCh.translation.length > 6000
      ? prevCh.translation.slice(0, 3000) + '\n...\n' + prevCh.translation.slice(-3000)
      : prevCh.translation;
    return CHAPTER_SUMMARY_PROMPT
      .replace('{chapter_num}',   prevCh.chapterNum || '?')
      .replace('{chapter_title}', prevCh.title)
      .replace('{text}',          textSample);
  }

  // helper: หาตอนก่อนหน้าที่แปลแล้ว
  const allSorted = [...(S.currentWs.chapters||[])].sort((a,b)=>(a.chapterNum||0)-(b.chapterNum||0));
  function findPrevTranslated(ch) {
    const idx = allSorted.findIndex(c => c.id === ch.id);
    for (let i = idx - 1; i >= 0; i--) {
      if (allSorted[i].translation?.trim()) return allSorted[i];
    }
    return null;
  }

  // ── PHASE 1: Pre-summarize pass (parallel, concurrency = 5) ──
  if (usePrevContext) {
    // รวบรวม prevCh ที่ต้องสรุป (unique, มี translation, ยังไม่ cache)
    const toSummarize = [];
    const seen = new Set();
    for (const ch of selectedChapters) {
      const prev = findPrevTranslated(ch);
      if (prev && !seen.has(prev.id) && !_summaryCache[prev.id]) {
        seen.add(prev.id);
        toSummarize.push(prev);
      }
    }

    if (toSummarize.length) {
      addLog(log, `📝 Pre-summarize ${toSummarize.length} ตอน (parallel x${Math.min(CONCURRENCY, toSummarize.length)})...`, '');
      document.getElementById('bchProgressLabel').textContent = `[เฟส 1/2] สรุปบริบท 0/${toSummarize.length} ตอน...`;

      let doneSum = 0;

      // run with concurrency limit
      async function runWithConcurrency(tasks, limit) {
        const results = new Array(tasks.length);
        let idx = 0;
        async function worker() {
          while (idx < tasks.length) {
            const i = idx++;
            results[i] = await tasks[i]();
          }
        }
        const workers = Array.from({ length: Math.min(limit, tasks.length) }, worker);
        await Promise.all(workers);
        return results;
      }

      const tasks = toSummarize.map(prevCh => async () => {
        try {
          const res = await callOpenRouter({
            model,
            messages: [{ role: 'user', content: buildSummaryPrompt(prevCh) }],
            temperature: 0.1,
            max_tokens: 300,
          });
          _summaryCache[prevCh.id] = res.choices?.[0]?.message?.content?.trim() || '';
        } catch {
          // fallback: ท้าย 600 ตัวอักษร — mark ด้วย key พิเศษ
          _summaryCache[prevCh.id] = '__fallback__' + prevCh.translation.trim().slice(-Math.round(getPrevCtxChars() * 1.5));
        }
        doneSum++;
        document.getElementById('bchProgressLabel').textContent = `[เฟส 1/2] สรุปบริบท ${doneSum}/${toSummarize.length} ตอน...`;
        document.getElementById('bchProgressFill').style.width = Math.round(doneSum / toSummarize.length * 30) + '%';
        document.getElementById('bchProgressPct').textContent = Math.round(doneSum / toSummarize.length * 30) + '%';
        addLog(log, `📝 สรุปตอน #${prevCh.chapterNum||'?'} "${prevCh.title}" ✓`, 'cached');
      });

      await runWithConcurrency(tasks, CONCURRENCY);
      document.getElementById('bchProgressLabel').textContent = `[เฟส 2/2] กำลังแปล ${n} ตอน...`;
      addLog(log, `✓ Pre-summarize เสร็จ — เริ่มแปล ${n} ตอน`, 'success');
    }
  }

  // helper: ดึง context string จาก cache
  function getCtxFromCache(ch) {
    const prev = findPrevTranslated(ch);
    if (!prev) return '';
    const cached = _summaryCache[prev.id];
    if (!cached) {
      // safety net: ตอนก่อนหน้าแปลแล้วแต่ไม่มี summary ใน cache → ใช้ท้ายตอนแทน (ไม่ทิ้ง context)
      const tail = prev.translation.trim().slice(-Math.round(getPrevCtxChars() * 1.5));
      return tail ? `PREVIOUS CHAPTER CONTEXT (ตอน #${prev.chapterNum||'?'} "${prev.title}") — ท้ายตอน:\n${tail}\n` : '';
    }
    if (cached.startsWith('__fallback__')) {
      return `PREVIOUS CHAPTER CONTEXT (ตอน #${prev.chapterNum||'?'} "${prev.title}") — ท้ายตอน:\n${cached.slice(12)}\n`;
    }
    return `PREVIOUS CHAPTER SUMMARY (ตอน #${prev.chapterNum||'?'} "${prev.title}"):\n${cached}\n`;
  }

  // ── PHASE 2: แปลทีละตอน (sequential) ──
  addLog(log, `⚡ เริ่มแปล ${n} ตอน...`, '');
  let batchStopped = false;
  for (let i = 0; i < n; i++) {
    const ch = selectedChapters[i];
    const pct = 30 + Math.round(i / n * 70); // progress 30%→100% ในช่วงแปล
    document.getElementById('bchProgressFill').style.width = pct + '%';
    document.getElementById('bchProgressPct').textContent = pct + '%';
    document.getElementById('bchProgressLabel').textContent = `แปลตอน ${i+1}/${n}: ${ch.title}`;
    if (!ch.sourceText?.trim()) {
      addLog(log, `⚠ #${ch.chapterNum||'?'} "${ch.title}" — ไม่มีต้นฉบับ ข้าม`, 'error');
      continue;
    }
    const ctxStr = usePrevContext ? getCtxFromCache(ch) : '';
    addLog(log, `⚡ #${ch.chapterNum||'?'} ${ch.title}${ctxStr ? ' [+summary]' : ''}...`, '');
    try {
      const styleId = document.getElementById('activeStyleSelect')?.value || S.activeStyleId;
      const csp = getStyleById(styleId)?.prompt || null;
      const batchPreset = getActivePreset(S.currentWs);
      const src = prepareSourceForTranslation(ch.sourceText);
      // ── แบ่ง chunk ตามโหมดที่ตั้งไว้ (off=ทั้งตอน, smart=เฉพาะตอนยาว, fixed=ทุกตอน) ──
      const chChunks = getBatchChunks(src, batchChunkMode, batchChunkSize);
      const multi = chChunks.length > 1;
      if (multi) addLog(log, `  ↳ แบ่งเป็น ${chChunks.length} chunk (${batchChunkMode})`, '');

      let fullText = '';
      for (let ci = 0; ci < chChunks.length; ci++) {
        const chunk = chChunks[ci];
        // Smart Glossary per chunk (ลด token)
        const cg = getSmartGlossary(chunk, S.glossaryData);
        const cgObj = cg.reduce((acc, g) => { acc[g.korean] = { thai: g.thai, type: g.type, note: g.note, gender: g.gender }; return acc; }, {});
        const cgStr = buildGlossaryStr(cgObj);
        // context: ตอน summary เฉพาะ chunk แรก + ท้ายคำแปล chunk ก่อนหน้า (ต่อเนื่อง)
        const prevTail = ci > 0 ? fullText.slice(-getPrevCtxChars()) : '';
        const chunkCtx = (ci === 0 ? ctxStr : '') + (prevTail ? `CONTEXT (ท้าย chunk ก่อนหน้า):\n${prevTail}\n` : '');
        const prompt = buildTranslatePrompt({ sourceText: chunk, glossaryStr: cgStr, contextStr: chunkCtx, styleNote: csp || '', ws: S.currentWs });
        if (multi) document.getElementById('bchProgressLabel').textContent = `แปลตอน ${i+1}/${n} · chunk ${ci+1}/${chChunks.length}: ${ch.title}`;

        S.abortCtrl = new AbortController();
        const timer = setTimeout(() => S.abortCtrl.abort(), getTimeoutMs(multi ? 'chunk' : 'full'));
        let part = '', inTok = 0, outTok = 0;
        try {
          part = await aiStream(
            { model, temperature: batchPreset.temperature ?? 0.65, max_tokens: Math.max(2000, Math.ceil(chunk.length * 2)), messages: [{role:'user',content:prompt}] },
            d => { part += d; }, (inp,out) => { inTok=inp; outTok=out; }, S.abortCtrl.signal
          );
        } finally { clearTimeout(timer); }
        if (inTok||outTok) addCosts(inTok, outTok, model);
        fullText += (ci > 0 && part ? '\n\n' : '') + part;
      }

      if (usePolish && fullText) {
        try {
          const fg = getSmartGlossary(src, S.glossaryData);
          const fgStr = buildGlossaryStr(fg.reduce((acc, g) => { acc[g.korean] = { thai: g.thai, type: g.type, note: g.note, gender: g.gender }; return acc; }, {}));
          const pr = await callOpenRouter({ model, messages:[{role:'user',content:POLISH_PROMPT.replace('{glossary}',fgStr).replace('{text}',fullText)}], temperature:0.5, max_tokens:Math.max(4000,Math.ceil(fullText.length*1.2)) });
          fullText = pr.choices?.[0]?.message?.content?.trim() || fullText;
        } catch {}
      }
      ch.translation = fullText; ch.status = 'translated'; ch.wordCount = fullText.length; ch.updatedAt = Date.now();
      await lsSaveWorkspace(S.currentWs);
      addLog(log, `✓ #${ch.chapterNum||'?'} "${ch.title}" — ${fullText.length.toLocaleString()} ตัวอักษร`, 'success');

      // ── สรุปตอนที่เพิ่งแปลเสร็จทันที เพื่อให้ตอนถัดไปใน batch ได้ context ต่อเนื่อง ──
      // (เฟส 1 สรุปได้เฉพาะตอนที่แปลก่อนเริ่ม batch — ตอนที่แปลใหม่ใน loop ต้องสรุปที่นี่)
      const ctxMem = wsGetContext(S.currentWs);
      const nextCh = selectedChapters[i + 1];
      const needForNext = usePrevContext && nextCh && findPrevTranslated(nextCh)?.id === ch.id;
      if (fullText && (needForNext || ctxMem?.enabled)) {
        try {
          const sres = await callOpenRouter({
            model,
            messages: [{ role: 'user', content: buildSummaryPrompt(ch) }],
            temperature: 0.1,
            max_tokens: 300,
          });
          const sum = sres.choices?.[0]?.message?.content?.trim() || '';
          if (sum) {
            _summaryCache[ch.id] = sum;
            if (needForNext) addLog(log, `  ↳ 📝 สรุปบริบทส่งต่อตอนถัดไป ✓`, 'cached');
            // ป้อน Context Memory ด้วย summary เดียวกัน (ไม่เรียก AI ซ้ำ)
            if (ctxMem?.enabled) {
              try { await ctxAddSummaryText(S.currentWs, ch.id, ch.chapterNum, ch.title, sum); } catch {}
            }
          } else {
            _summaryCache[ch.id] = '__fallback__' + fullText.trim().slice(-Math.round(getPrevCtxChars() * 1.5));
          }
        } catch {
          _summaryCache[ch.id] = '__fallback__' + fullText.trim().slice(-Math.round(getPrevCtxChars() * 1.5));
        }
      }
    } catch (err) {
      if (err.name === 'AbortError') {
        addLog(log, `⬛ หยุดที่ตอน #${ch.chapterNum||'?'} "${ch.title}"`, 'error');
        batchStopped = true;
        break;
      }
      addLog(log, `✗ #${ch.chapterNum||'?'} "${ch.title}" — ${err.message}`, 'error');
    }
    document.getElementById('bchProgressFill').style.width = (30 + Math.round((i+1)/n*70)) + '%';
    document.getElementById('bchProgressPct').textContent  = (30 + Math.round((i+1)/n*70)) + '%';
  }

  document.getElementById('bchProgressFill').style.width = '100%';
  document.getElementById('bchProgressPct').textContent   = '100%';
  document.getElementById('bchProgressLabel').textContent = batchStopped ? 'หยุดแล้ว ⬛' : `เสร็จสิ้น ${n} ตอน ✓`;
  renderChapters();
  setTranslating(false);
  btn.disabled = false;
  showToast(batchStopped ? '⬛ หยุด Batch แล้ว' : `Batch แปลเสร็จ ${n} ตอน ✓`, batchStopped ? '' : 'success');

  // ── Auto Extract Glossary จาก source texts ทั้ง batch รวมกัน (ครั้งเดียว) ──
  if (!batchStopped) {
    const allSource = selectedChapters
      .map(ch => ch.sourceText?.trim())
      .filter(Boolean)
      .join('\n\n')
      .slice(0, 12000);
    // สร้าง label แสดงช่วงตอน
    const firstCh = selectedChapters[0];
    const lastCh  = selectedChapters[selectedChapters.length - 1];
    const batchChInfo = firstCh ? {
      id: null,
      title: firstCh.id === lastCh.id
        ? firstCh.title
        : `#${firstCh.chapterNum||'?'}–#${lastCh.chapterNum||'?'}`,
      chapterNum: firstCh.chapterNum || null,
    } : null;
    const allTranslation = selectedChapters
      .map(ch => ch.translation?.trim())
      .filter(Boolean)
      .join('\n\n')
      .slice(0, 6000);
    autoExtractGlossaryAfterTranslation(allSource, model, batchChInfo, allTranslation);
  }
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ─── Utilities ───
function setTranslating(val) {
  S.translating = val;
  const btn = document.getElementById('translateBtn');
  if (!btn) return;
  if (val) {
    btn.innerHTML = '⬛ หยุด';
    btn.classList.add('btn-stop');
    btn.onclick = stopTranslation;
  } else {
    btn.innerHTML = '⚡ แปล';
    btn.classList.remove('btn-stop');
    btn.onclick = startTranslation;
    S.abortCtrl = null;
  }
}

function stopTranslation() {
  if (!S.translating) return;
  if (S.abortCtrl) { S.abortCtrl.abort(); }
  showToast('⬛ กำลังหยุด...', '');
}
function updateSourceStats() {
  const len = document.getElementById('sourceText').value.length;
  document.getElementById('sourceStats').textContent = `${len.toLocaleString()} ตัวอักษร`;
  ctxUpdateTokenMeter();
}

// ── มิเตอร์ context window (item 4) ──
// ประมาณ token ของคำขอแปลปัจจุบัน = system prompt + glossary + บริบทเรื่อง + ต้นฉบับ
// เทียบกับ context window สูงสุดของโมเดลที่เลือก แล้วแสดง used / max (%)
function ctxUpdateTokenMeter() {
  const el = document.getElementById('ctxTokenMeter');
  if (!el) return;
  const model = document.getElementById('translateModel')?.value
    || S.currentWs?.settings?.translateModel || '';
  const maxCtx = getModelContextWindow(model);
  const src = document.getElementById('sourceText')?.value || '';
  let used = estimateTokens(src);
  // system prompt (preset)
  const preset = getActivePreset(S.currentWs);
  if (preset?.systemPrompt) used += estimateTokens(preset.systemPrompt);
  // บริบทเรื่อง (context memory)
  used += estimateTokens(ctxGetPromptText(S.currentWs));
  // glossary ที่เกี่ยวข้องกับต้นฉบับ (smart glossary)
  try {
    if (src.trim() && (S.glossaryData || []).length) {
      const sg = getSmartGlossary(src, S.glossaryData);
      const gObj = {};
      sg.forEach(g => { gObj[g.korean] = { thai: g.thai, type: g.type, note: g.note }; });
      used += estimateTokens(buildGlossaryStr(gObj));
    }
  } catch {}
  const pct = maxCtx ? Math.min(999, Math.round(used / maxCtx * 100)) : 0;
  const fmt = n => n >= 1000 ? (n / 1000).toFixed(n >= 10000 ? 0 : 1) + 'k' : String(n);
  el.textContent = `🧮 ${fmt(used)} / ${fmt(maxCtx)} (${pct}%)`;
  el.style.color = pct > 90 ? 'var(--crimson-light)' : pct > 70 ? 'var(--gold)' : 'var(--text-muted)';
  el.title = `ประมาณ ${used.toLocaleString()} token จาก context window ${maxCtx.toLocaleString()} ของโมเดล ${model || '—'}`;
}
function clearSource() { document.getElementById('sourceText').value = ''; updateSourceStats(); hideHighlight(); }
function clearTranslation() {
  document.getElementById('translationOutput').innerHTML = '<div class="output-placeholder">คำแปลจะปรากฏที่นี่...</div>';
  document.getElementById('translationStats').textContent = 'รอการแปล';
}
async function copyTranslation() {
  const text = document.getElementById('translationOutput').innerText.trim();
  if (!text || text === 'คำแปลจะปรากฏที่นี่...') { showToast('ยังไม่มีคำแปล', 'error'); return; }
  try { await navigator.clipboard.writeText(text); showToast('คัดลอกแล้ว ✓', 'success'); }
  catch { showToast('คัดลอกล้มเหลว', 'error'); }
}
function addLog(el, msg, cls) {
  const d = document.createElement('div');
  d.className = 'log-entry' + (cls ? ' ' + cls : '');
  d.textContent = msg;
  el.appendChild(d);
  el.scrollTop = el.scrollHeight;
}
function esc(str) {
  if (!str) return '';
  const d = document.createElement('div'); d.textContent = str; return d.innerHTML;
}
function openModal(id) { document.getElementById(id).classList.add('open'); }
function closeModal(id) { document.getElementById(id).classList.remove('open'); }

let _toastTimer = null;
function showToast(msg, type) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = 'toast show' + (type ? ' ' + type : '');
  if (_toastTimer) clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => { t.className = 'toast'; }, 3500);
}

// ─── Load from Chapter (Translate Tab) ───
function openLoadFromChapter() {
  if (!S.currentWs) { showToast('เลือก Workspace ก่อน', 'error'); return; }
  const chapters = S.currentWs.chapters || [];
  const listEl = document.getElementById('loadChapterList');
  if (!chapters.length) {
    listEl.innerHTML = '<div style="color:var(--text-muted);font-size:0.82rem;padding:10px 0">ยังไม่มีตอน</div>';
  } else {
    const sorted = [...chapters].sort((a,b) => (a.chapterNum||0)-(b.chapterNum||0));
    listEl.innerHTML = sorted.map(ch => `
      <div onclick="loadChapterSource('${ch.id}')" style="
        padding:10px 12px; background:var(--bg-deep); border:1px solid var(--border);
        border-radius:var(--radius); cursor:pointer; transition:all 0.15s;
        display:flex; align-items:center; gap:10px;
      " onmouseover="this.style.background='var(--bg-hover)'" onmouseout="this.style.background='var(--bg-deep)'">
        <span style="font-size:0.7rem;font-family:var(--font-mono);color:var(--text-muted);min-width:28px">#${ch.chapterNum||'?'}</span>
        <span style="flex:1;font-size:0.85rem;color:var(--text-primary)">${esc(ch.title)}</span>
        <span style="font-size:0.65rem;color:${ch.sourceText?'#4caf50':'var(--text-muted)'}">
          ${ch.sourceText ? `${ch.sourceText.length.toLocaleString()} ตัวอักษร` : 'ไม่มีต้นฉบับ'}
        </span>
      </div>
    `).join('');
  }
  openModal('modal-load-chapter');
}

function loadChapterSource(id) {
  const ch = S.currentWs?.chapters.find(c => c.id === id);
  if (!ch) return;
  if (!ch.sourceText) { showToast('ตอนนี้ไม่มีข้อความต้นฉบับ', 'error'); return; }
  document.getElementById('sourceText').value = ch.sourceText;
  updateSourceStats();
  closeModal('modal-load-chapter');
  showToast(`โหลด "${ch.title}" แล้ว`, 'success');
}

// ─── EPUB Import ───
function openEpubImport() { document.getElementById('epubFileInput').click(); }

async function handleEpubImport(e) {
  const file = e.target.files[0];
  if (!file) return;
  if (!S.currentWsId) { showToast('เลือก Workspace ก่อน', 'error'); return; }
  showToast('กำลังอ่าน EPUB...', '');
  try {
    const { chapters, skipped } = await parseEpub(file);
    if (!chapters.length) { showToast('ไม่พบเนื้อหาใน EPUB', 'error'); return; }
    // Find highest existing chapterNum to continue from
    const existingNums = S.currentWs.chapters.map(c => c.chapterNum || 0);
    const startNum = existingNums.length ? Math.max(...existingNums) + 1 : 1;
    let added = 0;
    for (let idx = 0; idx < chapters.length; idx++) {
      const ch = chapters[idx];
      const newCh = {
        id: genId(),
        title: ch.title,
        chapterNum: startNum + idx,  // sequential from max existing
        sourceText: ch.text,
        translation: '',
        status: 'pending',
        notes: 'นำเข้าจาก EPUB',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        wordCount: ch.text.length,
      };
      S.currentWs.chapters.push(newCh);
      added++;
    }
    await lsSaveWorkspace(S.currentWs);
    renderChapters();
    updateChapterSaveSelect();
    const skipNote = skipped > 0 ? ` (ข้าม ${skipped} ไฟล์ที่ไม่ใช่เนื้อหา)` : '';
    showToast(`Import สำเร็จ — เพิ่ม ${added} ตอน ✓${skipNote}`, 'success');
  } catch (err) {
    showToast('Import ล้มเหลว: ' + err.message, 'error');
  }
  e.target.value = '';
}

async function parseEpub(file) {
  const arrayBuffer = await file.arrayBuffer();
  // Read as ZIP (EPUB = ZIP)
  const zip = await loadZip(arrayBuffer);
  if (!zip) throw new Error('ไม่ใช่ไฟล์ EPUB ที่ถูกต้อง');

  // Find OPF file from container.xml
  const containerXml = await zip.readText('META-INF/container.xml');
  if (!containerXml) throw new Error('ไม่พบ META-INF/container.xml');

  const opfMatch = containerXml.match(/full-path="([^"]+\.opf)"/i);
  if (!opfMatch) throw new Error('ไม่พบไฟล์ OPF');
  const opfPath = opfMatch[1];
  const opfDir = opfPath.includes('/') ? opfPath.substring(0, opfPath.lastIndexOf('/') + 1) : '';

  const opfXml = await zip.readText(opfPath);
  if (!opfXml) throw new Error('อ่านไฟล์ OPF ไม่ได้');

  // Parse manifest items
  const itemsMap = {};
  const itemRegex = /<item\s+([^>]+)\/>/gi;
  let m;
  while ((m = itemRegex.exec(opfXml)) !== null) {
    const attrs = m[1];
    const id = (attrs.match(/id="([^"]+)"/) || [])[1];
    const href = (attrs.match(/href="([^"]+)"/) || [])[1];
    const mt = (attrs.match(/media-type="([^"]+)"/) || [])[1];
    if (id && href) itemsMap[id] = { href, mediaType: mt };
  }

  // Parse spine order
  const spineIds = [];
  const spineItemRegex = /<itemref\s+idref="([^"]+)"/gi;
  while ((m = spineItemRegex.exec(opfXml)) !== null) spineIds.push(m[1]);

  // Parse NCX/NAV for titles
  const titlesMap = {};
  // Try NCX first (EPUB 2)
  const ncxItem = Object.values(itemsMap).find(it => it.mediaType && it.mediaType.includes('ncx'));
  if (ncxItem) {
    const ncxPath = opfDir + ncxItem.href;
    const ncxXml = await zip.readText(ncxPath);
    if (ncxXml) {
      const navPoints = ncxXml.match(/<navPoint[\s\S]*?<\/navPoint>/gi) || [];
      navPoints.forEach(np => {
        const srcM = np.match(/src="([^"#"]+)/);
        const labelM = np.match(/<text>([\s\S]*?)<\/text>/);
        if (srcM && labelM) {
          const src = srcM[1].split('#')[0];
          titlesMap[src] = labelM[1].replace(/<[^>]+>/g,'').trim();
        }
      });
    }
  }

  // Extract chapters from spine
  const chapters = [];
  let skippedCount = 0;
  for (const spineId of spineIds) {
    const item = itemsMap[spineId];
    if (!item) { skippedCount++; continue; }
    if (item.mediaType && !item.mediaType.includes('html')) { skippedCount++; continue; }

    const filePath = opfDir + item.href;
    const htmlContent = await zip.readText(filePath);
    if (!htmlContent) { skippedCount++; continue; }

    const text = htmlToText(htmlContent);
    if (!text || text.trim().length < 30) { skippedCount++; continue; }

    const hrefBase = item.href.split('#')[0];
    const title = titlesMap[hrefBase] || titlesMap[item.href] || guessChapterTitle(text) || `ตอนที่ ${chapters.length + 1}`;

    // ถ้าบรรทัดแรกของ text ตรงกับชื่อตอน (เช่น NovelpiaParser ใหม่ใส่ EP.x - ชื่อ เป็น paragraph แรก)
    // → ตัดออกเพื่อไม่ให้เบิ้ลเวลา import
    let cleanText = text.trim();
    const firstLine = cleanText.split('\n')[0].trim();
    if (firstLine && title && firstLine === title.trim()) {
      cleanText = cleanText.slice(firstLine.length).replace(/^\n+/, '').trim();
    }
    if (!cleanText || cleanText.length < 10) { skippedCount++; continue; }

    chapters.push({ title, text: cleanText });
  }

  return { chapters, skipped: skippedCount };
}

// Minimal ZIP reader for EPUB (no external lib)
async function loadZip(arrayBuffer) {
  // WebView เก่า (Termux/Android รุ่นเก่า) ไม่มี DecompressionStream — บอกตรงๆ ดีกว่าพังเงียบ
  if (typeof DecompressionStream === 'undefined') {
    throw new Error('เบราว์เซอร์นี้ไม่รองรับการแตกไฟล์ ZIP (ต้องใช้ Chrome/WebView เวอร์ชัน 80+)');
  }
  // Use JSZip-like approach via DataView
  const bytes = new Uint8Array(arrayBuffer);
  const decoder = new TextDecoder('utf-8', { fatal: false });

  function readUint16(offset) { return bytes[offset] | (bytes[offset+1] << 8); }
  function readUint32(offset) { return bytes[offset] | (bytes[offset+1]<<8) | (bytes[offset+2]<<16) | (bytes[offset+3]<<24); }

  // Find End of Central Directory — สแกนเฉพาะท้ายไฟล์ตามสเปก (EOCD + comment สูงสุด 65,557 bytes)
  let eocdOffset = -1;
  const scanFloor = Math.max(0, bytes.length - 65557);
  for (let i = bytes.length - 22; i >= scanFloor; i--) {
    if (bytes[i]===0x50 && bytes[i+1]===0x4B && bytes[i+2]===0x05 && bytes[i+3]===0x06) {
      eocdOffset = i; break;
    }
  }
  if (eocdOffset < 0) {
    // แยกเคส ZIP64 ให้ข้อความชัด
    for (let i = bytes.length - 56; i >= scanFloor; i--) {
      if (bytes[i]===0x50 && bytes[i+1]===0x4B && bytes[i+2]===0x06 && bytes[i+3]===0x06) {
        throw new Error('ไฟล์ EPUB ใช้รูปแบบ ZIP64 ซึ่งยังไม่รองรับ (ไฟล์ใหญ่เกิน 4GB?)');
      }
    }
    throw new Error('ไม่ใช่ไฟล์ ZIP/EPUB ที่ถูกต้อง หรือไฟล์เสียหาย/ถูกตัดท้าย');
  }

  const cdOffset = readUint32(eocdOffset + 16);
  const cdEntries = readUint16(eocdOffset + 8);
  const files = {};
  let pos = cdOffset;

  for (let i = 0; i < cdEntries; i++) {
    if (pos + 46 > bytes.length) break;
    if (bytes[pos]!==0x50||bytes[pos+1]!==0x4B||bytes[pos+2]!==0x01||bytes[pos+3]!==0x02) break;
    const compression = readUint16(pos + 10);
    const compSize = readUint32(pos + 20);
    const uncompSize = readUint32(pos + 24);
    const fnLen = readUint16(pos + 28);
    const extraLen = readUint16(pos + 30);
    const commentLen = readUint16(pos + 32);
    const localOffset = readUint32(pos + 42);
    const filename = decoder.decode(bytes.slice(pos + 46, pos + 46 + fnLen));
    files[filename] = { compression, compSize, uncompSize, localOffset };
    pos += 46 + fnLen + extraLen + commentLen;
  }

  async function readText(filename) {
    const entry = files[filename];
    if (!entry) return null;
    let lPos = entry.localOffset;
    if (lPos + 30 > bytes.length) return null;
    const fnLen2 = readUint16(lPos + 26);
    const extraLen2 = readUint16(lPos + 28);
    lPos += 30 + fnLen2 + extraLen2;
    if (lPos + entry.compSize > bytes.length) return null; // entry ชี้เกินไฟล์ — ไฟล์ถูกตัดท้าย
    const compData = bytes.slice(lPos, lPos + entry.compSize);
    let result;
    if (entry.compression === 0) {
      result = compData;
    } else if (entry.compression === 8) {
      try {
        const ds = new DecompressionStream('deflate-raw');
        const writer = ds.writable.getWriter();
        writer.write(compData);
        writer.close();
        const chunks = [];
        const reader = ds.readable.getReader();
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          chunks.push(value);
        }
        const total = chunks.reduce((s,c) => s+c.length, 0);
        result = new Uint8Array(total);
        let off = 0;
        for (const c of chunks) { result.set(c, off); off += c.length; }
      } catch { return null; }
    } else { return null; }
    return decoder.decode(result);
  }

  return { readText };
}

function htmlToText(html) {
  // Strip style/script blocks first
  let text = html
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '');

  // ── กรองขยะ Novelpia ก่อนตรวจ structure ──
  // watermark hidden <p opacity:0>
  text = text.replace(/<p[^>]*opacity\s*:\s*0[^>]*>[\s\S]*?<\/p>/gi, '');
  // cover-wrapper / cover-text
  text = text.replace(/<div[^>]*class="[^"]*cover-(?:wrapper|text)[^"]*"[\s\S]*?<\/div>/gi, '');

  // Detect Novelpia-style EPUB: ผลิตโดย NovelpiaParser.jsonToHtml
  // โครงสร้าง: <div>บรรทัด</div><br/><div>บรรทัด</div>
  // WebToEpub ห่อด้วย <section> เสมอ → ห้าม exclude section
  // ✅ เช็คว่ามี <div>…</div> + <br> และ ไม่มี <p> หรือ <table>
  const isNovelpiaStyle = /<div[^>]*>[\s\S]*?<\/div>[\s\S]*?<br[\s/]*/i.test(text)
    && !/<p\b/i.test(text)
    && !/<table\b/i.test(text);

  if (isNovelpiaStyle) {
    // consecutive <div> โดยไม่มี <br> คั่น = paragraph ใหม่ → เพิ่ม blank line
    text = text.replace(/<\/div>\s*<div[^>]*>/gi, '</div>\n<div>');
    text = text.replace(/<br\s*\/?>/gi, '\n');   // <br> = ตัวคั่น paragraph
    text = text.replace(/<\/div>/gi, '\n');       // </div> = จบบรรทัด
    text = text.replace(/<[^>]+>/g, '');
  } else {
    text = text
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/p>/gi, '\n\n')
      .replace(/<\/div>/gi, '\n')
      .replace(/<\/h[1-6]>/gi, '\n\n')
      .replace(/<[^>]+>/g, '');
  }

  // Decode HTML entities
  text = text
    .replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>')
    .replace(/&nbsp;/g,' ')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n));

  // Normalise whitespace
  text = text
    .replace(/[ \t]+/g, ' ')
    .replace(/ \n/g, '\n')
    .replace(/\n /g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return text;
}

function guessChapterTitle(text) {
  const firstLine = text.split('\n')[0].trim().slice(0, 80);
  return firstLine || null;
}

