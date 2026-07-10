// ═══ M5 — Context Picker: เลือกบริบทส่ง AI (auto-detect / pinned / manual / budget) ═══

import { S, saveChapter } from '../state.js';
import { detectCodexMentions, escapeHtml, fmtNum, estimateTokens } from '../utils/text.js';
import { formatWorldContext, typeLabel } from '../ai/prompts.js';
import { openModal, openInfoPop } from '../utils/ui.js';
import { typeIcon } from './codex.js';
import { getStoryMemory } from './memory.js';

// ── รวมรายการ context ของตอนนี้ ──
// คืน [{entry, source: 'pinned'|'auto'|'manual'}] เรียงตามลำดับความสำคัญ (pinned > auto > manual)
export function computeContextItems(chapter) {
  const removed = new Set(chapter?.ctxRemove || []);
  const added = new Set(chapter?.ctxAdd || []);
  const content = chapter?.content || '';

  const pinned = S.codex.filter(e => e.pinned);
  const pinnedIds = new Set(pinned.map(e => e.id));

  const auto = detectCodexMentions(content, S.codex)
    .filter(e => !pinnedIds.has(e.id) && !removed.has(e.id));
  const autoIds = new Set(auto.map(e => e.id));

  const manual = S.codex.filter(e =>
    added.has(e.id) && !pinnedIds.has(e.id) && !autoIds.has(e.id));

  return [
    ...pinned.map(entry => ({ entry, source: 'pinned' })),
    ...auto.map(entry => ({ entry, source: 'auto' })),
    ...manual.map(entry => ({ entry, source: 'manual' })),
  ];
}

// ── ประกอบ WORLD CONTEXT + STORY MEMORY ภายใต้ budget ──
// ตัดตามลำดับความสำคัญ: pinned > auto > manual (ตัด manual เก่าสุดก่อน)
export function buildContext(chapter) {
  const budget = S.settings.maxContextChars || 8000;
  const items = computeContextItems(chapter);
  const storyMemory = getStoryMemory(chapter);

  let remaining = budget - storyMemory.length;
  const included = [];
  let trimmed = 0;
  // ใส่จากท้าย (manual ใหม่สุดโดนตัดก่อน) — วนตามลำดับความสำคัญ
  for (const it of items) {
    const block = formatWorldContext([it.entry]);
    if (block.length <= remaining || it.source === 'pinned') {
      included.push(it);
      remaining -= block.length;
    } else {
      trimmed++;
    }
  }
  const worldContext = formatWorldContext(included.map(i => i.entry));
  const chars = worldContext.length + storyMemory.length;
  return { items, included, trimmed, worldContext, storyMemory, chars, budget, over: chars > budget };
}

// ── แถบ context บนแผง AI ──
export function renderContextBar(container, chapter, onChanged) {
  const ctx = buildContext(chapter);
  const bar = document.createElement('div');
  bar.className = 'ctx-bar';

  const srcIcon = { pinned: '📌', auto: '🔍', manual: '✋' };
  const chipsHtml = ctx.items.map((it, i) => `
    <span class="chip clickable t-${it.entry.type}" data-i="${i}" title="${it.source === 'pinned' ? 'ปักหมุด' : it.source === 'auto' ? 'ตรวจพบในเนื้อหา' : 'เลือกเอง'}">
      ${srcIcon[it.source]} ${escapeHtml(it.entry.name)}
      ${it.source !== 'pinned' ? '<span class="x" data-x>✕</span>' : ''}
    </span>`).join('');

  bar.innerHTML = `
    <div class="ctx-head">📦 บริบทที่จะส่งให้ AI
      <span class="spacer"></span>
      <button class="btn ghost sm" data-manage>จัดการ</button>
    </div>
    <div class="ctx-chips">${chipsHtml || '<span class="hint">ยังไม่มีบริบท — ปักหมุดหรือเพิ่ม Codex ก่อน</span>'}</div>
    <div class="ctx-meter ${ctx.over ? 'over' : ''}">
      ${fmtNum(ctx.chars)} / ${fmtNum(ctx.budget)} ตัวอักษร (~${fmtNum(estimateTokens(ctx.chars))} token)
      ${ctx.trimmed ? ` · ⚠ เกิน budget ตัดออก ${ctx.trimmed} รายการ` : ''}
    </div>`;

  bar.querySelectorAll('.chip[data-i]').forEach(chip => {
    const it = ctx.items[+chip.dataset.i];
    chip.onclick = (e) => {
      if (e.target.closest('[data-x]')) return;
      e.stopPropagation();
      openInfoPop(chip,
        `${typeIcon(it.entry.type)} ${escapeHtml(it.entry.name)} <span class="hint">· ${typeLabel(it.entry.type)} · ${it.source === 'pinned' ? 'ปักหมุด' : it.source === 'auto' ? 'auto-detect' : 'เลือกเอง'}</span>`,
        it.entry.description);
    };
    const x = chip.querySelector('[data-x]');
    if (x) x.onclick = async (e) => {
      e.stopPropagation();
      await excludeEntry(chapter, it);
      onChanged?.();
    };
  });

  bar.querySelector('[data-manage]').onclick = () => openManageModal(chapter, onChanged);

  container.replaceChildren(bar);
  return ctx;
}

async function excludeEntry(chapter, it) {
  if (!chapter) return;
  chapter.ctxAdd = (chapter.ctxAdd || []).filter(id => id !== it.entry.id);
  if (it.source === 'auto') {
    chapter.ctxRemove = [...new Set([...(chapter.ctxRemove || []), it.entry.id])];
  }
  await saveChapter(chapter);
}

async function includeEntry(chapter, id) {
  if (!chapter) return;
  chapter.ctxRemove = (chapter.ctxRemove || []).filter(x => x !== id);
  const items = computeContextItems(chapter);
  if (!items.some(it => it.entry.id === id)) {
    chapter.ctxAdd = [...new Set([...(chapter.ctxAdd || []), id])];
  }
  await saveChapter(chapter);
}

// ── modal จัดการ: ติ๊กเลือกทุกรายการเอง ──
function openManageModal(chapter, onChanged) {
  const render = (body) => {
    const q = body.querySelector('#ctxm-q')?.value?.trim().toLowerCase() || '';
    const items = computeContextItems(chapter);
    const includedIds = new Set(items.map(it => it.entry.id));
    const srcById = new Map(items.map(it => [it.entry.id, it.source]));
    const list = body.querySelector('#ctxm-list');
    const entries = S.codex.filter(e =>
      !q || `${e.name} ${(e.aliases || []).join(' ')}`.toLowerCase().includes(q));

    list.innerHTML = entries.length ? '' : '<div class="hint" style="padding:8px">ไม่พบรายการ</div>';
    for (const e of entries) {
      const src = srcById.get(e.id);
      const row = document.createElement('label');
      row.style.cssText = 'display:flex;gap:9px;align-items:center;padding:7px 6px;border-radius:7px;cursor:pointer;font-size:13.5px';
      row.onmouseenter = () => row.style.background = 'var(--bg-hover)';
      row.onmouseleave = () => row.style.background = '';
      row.innerHTML = `
        <input type="checkbox" ${includedIds.has(e.id) ? 'checked' : ''} ${e.pinned ? 'disabled' : ''}>
        <span class="type-dot t-${e.type}"></span>
        <span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(e.name)}</span>
        <span class="hint">${e.pinned ? '📌 ปักหมุด' : src === 'auto' ? '🔍 auto' : src === 'manual' ? '✋ เลือกเอง' : ''}</span>`;
      row.querySelector('input').onchange = async (ev) => {
        if (ev.target.checked) await includeEntry(chapter, e.id);
        else await excludeEntry(chapter, { entry: e, source: srcById.get(e.id) || 'manual' });
        render(body);
      };
      list.appendChild(row);
    }
  };

  openModal({
    title: '📦 จัดการบริบท (ตอนนี้)',
    bodyHtml: `
      <span class="hint">📌 รายการปักหมุดถูกส่งเสมอ · 🔍 auto = ตรวจพบชื่อในเนื้อหา · ติ๊กเพิ่ม/เอาออกได้ ระบบจำไว้ต่อตอน</span>
      <input type="text" id="ctxm-q" placeholder="🔎 ค้นหา…">
      <div id="ctxm-list" style="max-height:46vh;overflow-y:auto"></div>`,
    buttons: [{ label: 'เสร็จ', cls: 'primary', onClick: () => {} }],
    onOpen: (body) => {
      render(body);
      body.querySelector('#ctxm-q').oninput = () => render(body);
    },
    onClose: () => onChanged?.(),
  });
}
