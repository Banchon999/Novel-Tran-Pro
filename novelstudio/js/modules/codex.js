// ═══ M3 — Codex: ฐานข้อมูลโลก ═══

import { S, uid, now, emit, refreshCodex, saveCodexEntry, currentChapter } from '../state.js';
import { dbDel } from '../db.js';
import { openModal, openMenu, openInfoPop, confirmModal, toast } from '../utils/ui.js';
import { escapeHtml } from '../utils/text.js';
import { typeLabel } from '../ai/prompts.js';
import { aiCall } from '../ai/openrouter.js';
import { buildMessages, taskDraftCodex } from '../ai/prompts.js';

export const CDX_TYPES = ['character', 'place', 'skill', 'item', 'rule', 'other'];
const TYPE_ICONS = { character: '🧑', place: '🏔', skill: '⚡', item: '🗡', rule: '📜', other: '📌' };

export function typeIcon(t) { return TYPE_ICONS[t] || '📌'; }

let pageState = { tab: 'all', q: '', tag: '' };

// ── หน้า Codex เต็ม ──
export function renderCodexPage(main) {
  if (!S.project) {
    main.innerHTML = `<div class="empty-state"><div class="big">📚</div>ยังไม่ได้เปิดเรื่อง — ไปที่หน้า "เรื่องของฉัน" ก่อน</div>`;
    return;
  }
  const page = document.createElement('div');
  page.className = 'page';
  page.innerHTML = `
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:12px;flex-wrap:wrap">
      <h2 style="margin:0;flex:1">📚 Codex — ${escapeHtml(S.project.title)}</h2>
      <button class="btn primary" id="cdx-add">＋ เพิ่มรายการ</button>
    </div>
    <div class="tabs" id="cdx-tabs"></div>
    <div style="display:flex;gap:8px;margin:12px 0;flex-wrap:wrap">
      <input type="text" id="cdx-q" placeholder="🔎 ค้นหาชื่อ/คำอธิบาย…" style="flex:1;min-width:180px" value="${escapeHtml(pageState.q)}">
      <select id="cdx-tag" style="max-width:180px"></select>
    </div>
    <div class="card-grid" id="cdx-grid"></div>
    <div class="empty-state" id="cdx-empty" style="display:none"></div>`;

  const tabs = page.querySelector('#cdx-tabs');
  const tabDefs = [['all', '✳️ ทั้งหมด'], ...CDX_TYPES.map(t => [t, `${TYPE_ICONS[t]} ${typeLabel(t)}`])];
  for (const [key, label] of tabDefs) {
    const b = document.createElement('button');
    b.textContent = label;
    b.className = pageState.tab === key ? 'active' : '';
    b.onclick = () => { pageState.tab = key; renderCodexPage(main); };
    tabs.appendChild(b);
  }

  const tagSel = page.querySelector('#cdx-tag');
  const allTags = [...new Set(S.codex.flatMap(e => e.tags || []))].sort((a, b) => a.localeCompare(b, 'th'));
  tagSel.innerHTML = `<option value="">🏷 ทุก tag</option>` +
    allTags.map(t => `<option value="${escapeHtml(t)}" ${t === pageState.tag ? 'selected' : ''}>${escapeHtml(t)}</option>`).join('');
  tagSel.onchange = () => { pageState.tag = tagSel.value; renderGrid(page); };

  page.querySelector('#cdx-q').oninput = (e) => { pageState.q = e.target.value; renderGrid(page); };
  page.querySelector('#cdx-add').onclick = () =>
    openCodexModal({ prefill: { type: pageState.tab !== 'all' ? pageState.tab : 'character' } });

  renderGrid(page);
  main.replaceChildren(page);
}

function filteredEntries() {
  const q = pageState.q.trim().toLowerCase();
  return S.codex.filter(e => {
    if (pageState.tab !== 'all' && e.type !== pageState.tab) return false;
    if (pageState.tag && !(e.tags || []).includes(pageState.tag)) return false;
    if (q) {
      const hay = `${e.name} ${(e.aliases || []).join(' ')} ${e.description || ''}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

function renderGrid(page) {
  const grid = page.querySelector('#cdx-grid');
  const empty = page.querySelector('#cdx-empty');
  const list = filteredEntries();
  grid.replaceChildren(...list.map(e => codexCard(e)));
  empty.style.display = list.length ? 'none' : '';
  empty.innerHTML = S.codex.length
    ? 'ไม่พบรายการที่ตรงเงื่อนไข'
    : `<div class="big">📚</div>Codex ยังว่าง — เพิ่มตัวละคร/สถานที่/สกิลของเรื่อง<br><span class="hint">หรือลากคลุมชื่อในหน้าเขียนแล้วกด "เพิ่มเข้า Codex" ได้เลย</span>`;
}

function codexCard(e) {
  const card = document.createElement('div');
  card.className = 'card cdx-card';
  card.innerHTML = `
    <h4><span class="type-dot t-${e.type}"></span>${escapeHtml(e.name)}
      ${e.aliases?.length ? `<span class="hint">(${escapeHtml(e.aliases.join(', '))})</span>` : ''}</h4>
    <div class="desc">${escapeHtml(e.description || '(ไม่มีคำอธิบาย)')}</div>
    ${e.tags?.length ? `<div class="tags">${e.tags.map(t => `<span class="chip">${escapeHtml(t)}</span>`).join('')}</div>` : ''}
    <button class="btn ghost icon pin-btn ${e.pinned ? 'pinned' : ''}" title="ปักหมุด = ส่งให้ AI ทุกครั้ง">${e.pinned ? '📌' : '📍'}</button>`;
  card.onclick = (ev) => {
    if (ev.target.closest('.pin-btn')) return;
    openCodexModal({ entry: e });
  };
  card.querySelector('.pin-btn').onclick = async (ev) => {
    ev.stopPropagation();
    e.pinned = !e.pinned;
    await saveCodexEntry(e);
    toast(e.pinned ? `📌 ปักหมุด "${e.name}" — ส่งให้ AI ทุกครั้ง` : `เลิกปักหมุด "${e.name}"`);
  };
  return card;
}

// ── mini list สำหรับ sidebar ใน Editor ──
export function renderCodexMiniList(container) {
  container.replaceChildren();
  const wrap = document.createElement('div');
  wrap.style.cssText = 'display:flex;flex-direction:column;padding:4px 8px 20px;flex:1;overflow-y:auto';
  if (!S.codex.length) {
    wrap.innerHTML = `<div class="hint" style="padding:10px">Codex ยังว่าง — ลากคลุมชื่อในเนื้อหาเพื่อเพิ่ม หรือกด ＋ ด้านบน</div>`;
  }
  for (const e of S.codex) {
    const item = document.createElement('div');
    item.className = 'cdx-mini';
    item.innerHTML = `<span class="type-dot t-${e.type}"></span>
      <span class="nm">${escapeHtml(e.name)}</span>${e.pinned ? '📌' : ''}`;
    item.onclick = (ev) => {
      ev.stopPropagation();
      openInfoPop(item,
        `<span class="type-dot t-${e.type}"></span> ${escapeHtml(e.name)} <span class="hint">· ${typeLabel(e.type)}</span>`,
        e.description);
    };
    item.ondblclick = () => openCodexModal({ entry: e });
    wrap.appendChild(item);
  }
  container.appendChild(wrap);
}

// ── modal เพิ่ม/แก้ไข entry ──
// openCodexModal({ entry, prefill: {type, name, description, surrounding}, onSaved })
export function openCodexModal({ entry = null, prefill = {}, onSaved } = {}) {
  if (!S.project) { toast('เปิดเรื่องก่อน', 'err'); return; }
  const isNew = !entry;
  const e = entry || {
    id: uid('cdx'),
    projectId: S.project.id,
    type: prefill.type || 'character',
    name: prefill.name || '',
    aliases: [],
    description: prefill.description || '',
    tags: [],
    pinned: false,
  };

  openModal({
    title: isNew ? '＋ เพิ่มเข้า Codex' : `📝 แก้ไข: ${e.name}`,
    bodyHtml: `
      <div class="fld-row">
        <label class="fld">ประเภท
          <select id="cx-type">${CDX_TYPES.map(t =>
            `<option value="${t}" ${e.type === t ? 'selected' : ''}>${TYPE_ICONS[t]} ${typeLabel(t)}</option>`).join('')}</select></label>
        <label class="fld">ชื่อ
          <input type="text" id="cx-name" value="${escapeHtml(e.name)}" placeholder="เช่น อีซอจุน"></label>
      </div>
      <label class="fld">ชื่อเรียกอื่น (คั่นด้วย , — ใช้ตอน auto-detect)
        <input type="text" id="cx-alias" value="${escapeHtml((e.aliases || []).join(', '))}" placeholder="เช่น จอมดาบเงา, ศิษย์พี่ใหญ่"></label>
      <label class="fld">คำอธิบาย
        <textarea id="cx-desc" rows="4" placeholder="ใส่สั้นๆ ก่อนได้ ค่อยเติมทีหลัง">${escapeHtml(e.description || '')}</textarea></label>
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
        <button class="btn sm" id="cx-ai-draft">🪄 ให้ AI ร่างคำอธิบายจากบริบท</button>
        <span class="hint" id="cx-ai-status"></span>
      </div>
      <div class="fld-row">
        <label class="fld">Tags (คั่นด้วย ,)
          <input type="text" id="cx-tags" value="${escapeHtml((e.tags || []).join(', '))}" placeholder="เช่น ตัวเอก, สำนักเมฆขาว"></label>
      </div>
      <label style="display:flex;gap:8px;align-items:center;font-size:13.5px;cursor:pointer">
        <input type="checkbox" id="cx-pin" ${e.pinned ? 'checked' : ''}>
        📌 ปักหมุด — ส่งเข้า AI ทุกครั้งไม่ว่าจะถูก detect หรือไม่</label>`,
    buttons: [
      ...(isNew ? [] : [{
        label: '🗑 ลบ', cls: 'danger',
        onClick: async () => {
          const ok = await confirmModal('ลบรายการ Codex?', `ลบ "${e.name}" ออกจาก Codex`, { danger: true, okLabel: 'ลบ' });
          if (!ok) return false;
          await dbDel('codex', e.id);
          await refreshCodex();
          toast('ลบแล้ว', 'ok');
        },
      }]),
      { label: 'ยกเลิก', onClick: () => {} },
      {
        label: '💾 บันทึก', cls: 'primary',
        onClick: async (body) => {
          const name = body.querySelector('#cx-name').value.trim();
          if (!name) { toast('ใส่ชื่อก่อน', 'err'); return false; }
          e.type = body.querySelector('#cx-type').value;
          e.name = name;
          e.aliases = body.querySelector('#cx-alias').value.split(',').map(s => s.trim()).filter(Boolean);
          e.description = body.querySelector('#cx-desc').value.trim();
          e.tags = body.querySelector('#cx-tags').value.split(',').map(s => s.trim()).filter(Boolean);
          e.pinned = body.querySelector('#cx-pin').checked;
          await saveCodexEntry(e);
          onSaved?.(e);
          toast(`💾 บันทึก "${e.name}" แล้ว`, 'ok');
        },
      },
    ],
    onOpen: (body) => {
      if (isNew && !e.name) body.querySelector('#cx-name').focus();
      body.querySelector('#cx-ai-draft').onclick = async (ev) => {
        const btn = ev.currentTarget;
        const status = body.querySelector('#cx-ai-status');
        const name = body.querySelector('#cx-name').value.trim();
        if (!name) { toast('ใส่ชื่อก่อนถึงจะร่างได้', 'err'); return; }
        const surrounding = prefill.surrounding || surroundingFromChapter(name);
        if (!surrounding) { toast(`ไม่พบ "${name}" ในเนื้อหาตอนปัจจุบัน — พิมพ์เองหรือเขียนถึงก่อน`, 'err'); return; }
        btn.disabled = true;
        status.textContent = 'กำลังร่าง…';
        try {
          const messages = buildMessages({
            project: S.project, settings: S.settings,
            worldContext: '', storyMemory: '',
            task: taskDraftCodex({ name, surrounding }),
          });
          const r = await aiCall({ messages, maxTokens: 300, temperature: 0.4 });
          body.querySelector('#cx-desc').value = r.text.trim();
          status.textContent = '✓ ร่างแล้ว แก้ต่อได้เลย';
        } catch (err) {
          status.textContent = '';
          toast(err.message, 'err');
        } finally {
          btn.disabled = false;
        }
      };
    },
  });
}

// หา 500 ตัวอักษรรอบตำแหน่งที่ชื่อปรากฏในตอนปัจจุบัน (ใช้ตอน AI ร่างคำอธิบาย)
function surroundingFromChapter(name) {
  const ch = currentChapter();
  const content = ch?.content || '';
  const i = content.indexOf(name);
  if (i < 0) return '';
  return content.slice(Math.max(0, i - 250), i + name.length + 250);
}
