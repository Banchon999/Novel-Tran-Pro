// ═══ M1 — Projects: จัดการโปรเจกต์ ═══

import { S, uid, now, emit, refreshProjects, openProject, saveProject, closeProject } from '../state.js';
import { dbPut, dbDel, dbListBy, dbBulkPut, dbBulkDel } from '../db.js';
import { openModal, openMenu, confirmModal, toast } from '../utils/ui.js';
import { escapeHtml, fmtDate, fmtNum } from '../utils/text.js';
import { GENRES, genreLabel } from '../ai/genres.js';
import { exportProject, exportProjectTxt } from '../utils/export.js';

export async function renderProjects(main) {
  await refreshProjects();
  const page = document.createElement('div');
  page.className = 'page';
  page.innerHTML = `
    <h2 style="margin:4px 0 16px">📖 เรื่องของฉัน</h2>
    <div class="card-grid" id="prj-grid"></div>`;
  const grid = page.querySelector('#prj-grid');

  const newCard = document.createElement('div');
  newCard.className = 'card prj-new';
  newCard.textContent = '＋ เรื่องใหม่';
  newCard.onclick = () => openNewProjectModal();
  grid.appendChild(newCard);

  for (const p of S.allProjects) {
    grid.appendChild(projectCard(p));
  }

  if (!S.allProjects.length) {
    const es = document.createElement('div');
    es.className = 'empty-state';
    es.innerHTML = `<div class="big">✍️</div>เริ่มเรื่องแรกของคุณ — กด "＋ เรื่องใหม่"<br>
      <span class="hint">ใส่แค่ชื่อเรื่องกับแนว แล้วเขียนได้เลย</span>`;
    page.appendChild(es);
  }

  main.replaceChildren(page);
}

function projectCard(p) {
  const card = document.createElement('div');
  card.className = 'card prj-card';
  card.innerHTML = `
    <h3>${escapeHtml(p.title)}</h3>
    ${p.synopsis ? `<div class="syn">${escapeHtml(p.synopsis)}</div>` : ''}
    <div class="meta">
      <span class="chip">${genreLabel(p.genre)}</span>
      <span>อัปเดต ${fmtDate(p.updatedAt)}</span>
    </div>
    <button class="btn ghost icon menu-btn">⋮</button>`;
  card.onclick = async (e) => {
    if (e.target.closest('.menu-btn')) return;
    await openProject(p.id);
    emit('nav', 'write');
  };
  card.querySelector('.menu-btn').onclick = (e) => {
    e.stopPropagation();
    openMenu(e.currentTarget, [
      { label: 'เปิดเขียน', icon: '✍️', onClick: async () => { await openProject(p.id); emit('nav', 'write'); } },
      { label: 'แก้ไขข้อมูลเรื่อง', icon: '📝', onClick: () => openEditProjectModal(p) },
      'hr',
      { label: 'Duplicate', icon: '📑', onClick: () => duplicateProject(p) },
      { label: 'Export JSON', icon: '📦', onClick: () => exportProject(p.id).then(() => toast('Export แล้ว', 'ok')).catch(err => toast(err.message, 'err')) },
      { label: 'Export .txt (ทั้งเรื่อง)', icon: '📄', onClick: () => exportProjectTxt(p.id).catch(err => toast(err.message, 'err')) },
      'hr',
      { label: 'ลบเรื่องนี้', icon: '🗑', cls: 'danger', onClick: () => deleteProject(p) },
    ]);
  };
  return card;
}

// ── สร้างเรื่องใหม่: ชื่อ + แนว แล้วเข้า Editor ทันที ──
export function openNewProjectModal() {
  let genre = 'fantasy';
  const m = openModal({
    title: '＋ เรื่องใหม่',
    bodyHtml: `
      <label class="fld">ชื่อเรื่อง
        <input type="text" id="np-title" placeholder="เช่น ดาบเทพจอมมาร" autocomplete="off"></label>
      <label class="fld">แนวเรื่อง</label>
      <div class="genre-pick" id="np-genre"></div>
      <label class="fld" id="np-custom-wrap" style="display:none">system prompt แนวเรื่อง (กำหนดเอง)
        <textarea id="np-custom" rows="3" placeholder="อธิบายแนว/โทน/กติกาภาษาของเรื่องให้ AI"></textarea></label>
      <label class="fld">เรื่องย่อ (เว้นได้ เติมทีหลัง)
        <textarea id="np-syn" rows="2"></textarea></label>`,
    buttons: [
      { label: 'ยกเลิก', onClick: () => {} },
      {
        label: '✍️ สร้างแล้วเขียนเลย', cls: 'primary',
        onClick: async (body) => {
          const title = body.querySelector('#np-title').value.trim();
          if (!title) { toast('ใส่ชื่อเรื่องก่อน', 'err'); return false; }
          const p = {
            id: uid('prj'),
            title,
            genre,
            customGenrePrompt: body.querySelector('#np-custom').value.trim(),
            synopsis: body.querySelector('#np-syn').value.trim(),
            createdAt: now(),
            updatedAt: now(),
          };
          await dbPut('projects', p);
          // idea-first: มีตอนที่ 1 รอไว้เลย เปิดมาเขียนได้ทันที
          await dbPut('chapters', {
            id: uid('ch'), projectId: p.id, number: 1, title: 'ตอนที่ 1',
            content: '', summary: '', status: 'draft', wordCount: 0, updatedAt: now(),
          });
          await openProject(p.id);
          emit('nav', 'write');
        },
      },
    ],
    onOpen: (body) => {
      renderGenrePick(body.querySelector('#np-genre'), genre, g => {
        genre = g;
        body.querySelector('#np-custom-wrap').style.display = g === 'custom' ? '' : 'none';
      });
      body.querySelector('#np-title').focus();
    },
  });
  return m;
}

function renderGenrePick(container, current, onPick) {
  container.replaceChildren();
  for (const [key, g] of Object.entries(GENRES)) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = key === current ? 'active' : '';
    b.innerHTML = `<span class="ico">${g.icon}</span>${escapeHtml(g.label)}`;
    b.onclick = () => {
      container.querySelectorAll('button').forEach(x => x.classList.remove('active'));
      b.classList.add('active');
      onPick(key);
    };
    container.appendChild(b);
  }
}

export function openEditProjectModal(p, onSaved) {
  let genre = p.genre || 'fantasy';
  openModal({
    title: '📝 แก้ไขข้อมูลเรื่อง',
    bodyHtml: `
      <label class="fld">ชื่อเรื่อง
        <input type="text" id="ep-title" value="${escapeHtml(p.title)}"></label>
      <label class="fld">แนวเรื่อง</label>
      <div class="genre-pick" id="ep-genre"></div>
      <label class="fld" id="ep-custom-wrap" style="display:${genre === 'custom' ? '' : 'none'}">system prompt แนวเรื่อง (กำหนดเอง)
        <textarea id="ep-custom" rows="3">${escapeHtml(p.customGenrePrompt || '')}</textarea></label>
      <label class="fld">เรื่องย่อ
        <textarea id="ep-syn" rows="3">${escapeHtml(p.synopsis || '')}</textarea>
        <span class="hint">เรื่องย่อถูกส่งให้ AI เป็นส่วนหนึ่งของ STORY MEMORY ทุกครั้ง</span></label>`,
    buttons: [
      { label: 'ยกเลิก', onClick: () => {} },
      {
        label: '💾 บันทึก', cls: 'primary',
        onClick: async (body) => {
          const title = body.querySelector('#ep-title').value.trim();
          if (!title) { toast('ชื่อเรื่องห้ามว่าง', 'err'); return false; }
          p.title = title;
          p.genre = genre;
          p.customGenrePrompt = body.querySelector('#ep-custom').value.trim();
          p.synopsis = body.querySelector('#ep-syn').value.trim();
          await saveProject(p);
          await refreshProjects();
          emit('project-meta-changed', p);
          onSaved?.(p);
          toast('บันทึกแล้ว', 'ok');
        },
      },
    ],
    onOpen: (body) => {
      renderGenrePick(body.querySelector('#ep-genre'), genre, g => {
        genre = g;
        body.querySelector('#ep-custom-wrap').style.display = g === 'custom' ? '' : 'none';
      });
    },
  });
}

async function duplicateProject(p) {
  const copy = { ...p, id: uid('prj'), title: `${p.title} (สำเนา)`, createdAt: now(), updatedAt: now() };
  await dbPut('projects', copy);
  const chapters = await dbListBy('chapters', 'projectId', p.id);
  const codex = await dbListBy('codex', 'projectId', p.id);
  await dbBulkPut('chapters', chapters.map(c => ({ ...c, id: uid('ch'), projectId: copy.id })));
  await dbBulkPut('codex', codex.map(c => ({ ...c, id: uid('cdx'), projectId: copy.id })));
  await refreshProjects();
  emit('nav', 'projects');
  toast(`สร้างสำเนา "${copy.title}" แล้ว`, 'ok');
}

async function deleteProject(p) {
  const ok = await confirmModal('🗑 ลบเรื่องนี้?',
    `"${p.title}" จะถูกลบพร้อมทุกตอนและ Codex ทั้งหมด — กู้คืนไม่ได้ (แนะนำ Export ก่อนลบ)`,
    { danger: true, okLabel: 'ลบถาวร' });
  if (!ok) return;
  const chapters = await dbListBy('chapters', 'projectId', p.id);
  const codex = await dbListBy('codex', 'projectId', p.id);
  await dbBulkDel('chapters', chapters.map(c => c.id));
  await dbBulkDel('codex', codex.map(c => c.id));
  await dbDel('projects', p.id);
  if (S.project?.id === p.id) closeProject();
  await refreshProjects();
  emit('nav', 'projects');
  toast('ลบแล้ว', 'ok');
}
