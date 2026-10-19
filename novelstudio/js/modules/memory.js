// ═══ M6 — Continuity Memory: สรุปตอน / ไทม์ไลน์เรื่อง ═══

import { S, saveChapter, emit } from '../state.js';
import { escapeHtml, fmtNum } from '../utils/text.js';
import { aiCall } from '../ai/openrouter.js';
import { buildMessages, taskSummarize } from '../ai/prompts.js';
import { toast, openModal } from '../utils/ui.js';

// ── STORY MEMORY สำหรับ prompt: synopsis + สรุป N ตอนล่าสุดก่อนตอนปัจจุบัน ──
export function getStoryMemory(chapter) {
  const parts = [];
  if (S.project?.synopsis?.trim()) parts.push(`เรื่องย่อ: ${S.project.synopsis.trim()}`);

  const depth = S.settings.memoryDepth ?? 5;
  if (depth > 0) {
    const curNum = chapter?.number ?? Infinity;
    const prev = S.chapters
      .filter(c => c.number < curNum && c.summary?.trim())
      .sort((a, b) => a.number - b.number)
      .slice(-depth);
    if (prev.length) {
      parts.push('สรุปตอนก่อนหน้า (เรียงเก่า→ใหม่):');
      for (const c of prev) {
        parts.push(`[ตอนที่ ${c.number}${c.title ? ` — ${c.title}` : ''}]\n${c.summary.trim()}`);
      }
    }
  }
  return parts.join('\n\n');
}

// ── สรุปตอนด้วย AI แล้วบันทึกลง chapter.summary ──
export async function summarizeChapter(chapter, { silent = false } = {}) {
  if (!chapter?.content?.trim()) throw new Error('ตอนนี้ยังไม่มีเนื้อหาให้สรุป');
  const messages = buildMessages({
    project: S.project,
    settings: S.settings,
    worldContext: '',
    storyMemory: '',
    task: taskSummarize({ chapterText: chapter.content, chapterTitle: chapter.title }),
  });
  const r = await aiCall({ messages, maxTokens: 500, temperature: 0.3 });
  chapter.summary = r.text.trim();
  await saveChapter(chapter);
  emit('chapters-changed');
  if (!silent) toast(`✓ สรุปตอนที่ ${chapter.number} แล้ว`, 'ok');
  return chapter.summary;
}

export function unsummarizedCount() {
  return S.chapters.filter(c => c.content?.trim() && !c.summary?.trim()).length;
}

// ── modal แก้สรุปเอง ──
export function openSummaryModal(chapter) {
  openModal({
    title: `📝 สรุปตอนที่ ${chapter.number}${chapter.title ? ` — ${chapter.title}` : ''}`,
    bodyHtml: `
      <textarea id="sum-text" rows="7" placeholder="ยังไม่มีสรุป — พิมพ์เอง หรือกด 🤖 ให้ AI สรุป">${escapeHtml(chapter.summary || '')}</textarea>
      <span class="hint">สรุปนี้ถูกแนบให้ AI เป็น "ความจำของเรื่อง" ตอนเขียนตอนถัดๆ ไป</span>`,
    buttons: [
      {
        label: '🤖 ให้ AI สรุป',
        onClick: async (body) => {
          const btnStatus = body.querySelector('#sum-text');
          btnStatus.placeholder = 'กำลังสรุป…';
          try {
            const sum = await summarizeChapter(chapter, { silent: true });
            btnStatus.value = sum;
          } catch (e) { toast(e.message, 'err'); }
          return false; // ไม่ปิด modal
        },
      },
      { label: 'ยกเลิก', onClick: () => {} },
      {
        label: '💾 บันทึก', cls: 'primary',
        onClick: async (body) => {
          chapter.summary = body.querySelector('#sum-text').value.trim();
          await saveChapter(chapter);
          emit('chapters-changed');
          toast('บันทึกสรุปแล้ว', 'ok');
        },
      },
    ],
  });
}

// ── หน้าไทม์ไลน์เรื่อง ──
export function renderTimeline(main) {
  if (!S.project) {
    main.innerHTML = `<div class="empty-state"><div class="big">🕑</div>ยังไม่ได้เปิดเรื่อง — ไปที่หน้า "เรื่องของฉัน" ก่อน</div>`;
    return;
  }
  const page = document.createElement('div');
  page.className = 'page';
  const missing = unsummarizedCount();
  page.innerHTML = `
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:16px;flex-wrap:wrap">
      <h2 style="margin:0;flex:1">🕑 ไทม์ไลน์ — ${escapeHtml(S.project.title)}</h2>
      ${missing ? `<button class="btn" id="tl-sum-all">🤖 สรุปที่ค้าง ${missing} ตอน</button>` : ''}
    </div>
    ${S.project.synopsis ? `<div class="card" style="margin-bottom:18px"><b>เรื่องย่อ</b><div style="color:var(--text-dim);font-size:13.5px;white-space:pre-wrap">${escapeHtml(S.project.synopsis)}</div></div>` : ''}
    <div id="tl-list"></div>`;

  const list = page.querySelector('#tl-list');
  const chapters = [...S.chapters].sort((a, b) => a.number - b.number);
  if (!chapters.length) {
    list.innerHTML = '<div class="empty-state">ยังไม่มีตอน</div>';
  }
  for (const c of chapters) {
    const item = document.createElement('div');
    item.className = 'tl-item';
    item.innerHTML = `
      <div class="tl-num">${c.number}</div>
      <div class="tl-body">
        <h4>${escapeHtml(c.title || `ตอนที่ ${c.number}`)}
          <span class="status-chip status-${c.status || 'draft'}">${statusLabel(c.status)}</span>
          <span class="hint">${fmtNum(c.wordCount || 0)} คำ</span>
          <button class="btn ghost sm" data-edit>✏️</button>
        </h4>
        ${c.summary?.trim()
          ? `<div class="tl-sum">${escapeHtml(c.summary)}</div>`
          : `<div class="tl-none">ยังไม่สรุป${c.content?.trim() ? ' — <a href="javascript:void 0" data-sum>🤖 สรุปเลย</a>' : ' (ยังไม่มีเนื้อหา)'}</div>`}
      </div>`;
    item.querySelector('[data-edit]').onclick = () => openSummaryModal(c);
    const sumLink = item.querySelector('[data-sum]');
    if (sumLink) sumLink.onclick = async () => {
      sumLink.textContent = '⏳ กำลังสรุป…';
      try { await summarizeChapter(c); renderTimeline(main); }
      catch (e) { toast(e.message, 'err'); sumLink.textContent = '🤖 สรุปเลย'; }
    };
    list.appendChild(item);
  }

  const sumAll = page.querySelector('#tl-sum-all');
  if (sumAll) sumAll.onclick = async () => {
    sumAll.disabled = true;
    const targets = chapters.filter(c => c.content?.trim() && !c.summary?.trim());
    let done = 0;
    for (const c of targets) {
      sumAll.textContent = `⏳ สรุปตอนที่ ${c.number}… (${done + 1}/${targets.length})`;
      try { await summarizeChapter(c, { silent: true }); done++; }
      catch (e) { toast(`ตอนที่ ${c.number}: ${e.message}`, 'err'); break; }
    }
    if (done) toast(`✓ สรุปแล้ว ${done} ตอน`, 'ok');
    renderTimeline(main);
  };

  main.replaceChildren(page);
}

export function statusLabel(s) {
  return { draft: 'ร่าง', done: 'เสร็จ', published: 'เผยแพร่แล้ว' }[s] || 'ร่าง';
}
