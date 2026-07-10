// ═══ app.js — entry point, router ระหว่างโมดูล, header, init ═══

import { openDB } from './db.js';
import { S, on, emit, saveSettings, refreshProjects, openProject } from './state.js';
import { escapeHtml } from './utils/text.js';
import { renderProjects, openNewProjectModal } from './modules/projects.js';
import { renderWrite } from './modules/editor.js';
import { renderCodexPage } from './modules/codex.js';
import { renderTimeline } from './modules/memory.js';
import { renderSettings } from './modules/settings.js';

const ROUTES = {
  projects: renderProjects,
  write: renderWrite,
  codex: renderCodexPage,
  timeline: renderTimeline,
  settings: renderSettings,
};

function routeFromHash() {
  const r = (location.hash || '').replace(/^#\/?/, '').split('?')[0];
  return ROUTES[r] ? r : null;
}

export function navigate(route) {
  if (location.hash !== `#/${route}`) {
    location.hash = `#/${route}`;
  } else {
    render();
  }
}

async function render() {
  const main = document.getElementById('app-main');
  const route = routeFromHash() || 'projects';
  S.route = route;
  document.body.dataset.route = route;
  document.body.classList.remove('drawer-open', 'sheet-open', 'zen');
  main.style.overflowY = route === 'write' ? 'hidden' : 'auto';
  renderHeader();
  renderMobileNav();
  await ROUTES[route](main);
}

// ── Header ──
function renderHeader() {
  const hdr = document.getElementById('app-header');
  const backupOld = S.settings.lastBackupAt
    ? Date.now() - S.settings.lastBackupAt > 7 * 864e5
    : S.allProjects.length > 0;
  hdr.innerHTML = `
    <div class="logo" id="hdr-logo">📖 Novel<span>Studio</span></div>
    <select id="hdr-project" title="สลับเรื่อง"></select>
    <nav id="hdr-nav">
      <button class="nav-btn ${S.route === 'write' ? 'active' : ''}" data-nav="write">✍️ เขียน</button>
      <button class="nav-btn ${S.route === 'codex' ? 'active' : ''}" data-nav="codex">📚 Codex</button>
      <button class="nav-btn ${S.route === 'timeline' ? 'active' : ''}" data-nav="timeline">🕑 ไทม์ไลน์</button>
      <button class="nav-btn ${S.route === 'settings' ? 'active' : ''}" data-nav="settings" style="position:relative">⚙️${backupOld ? ' <span class="badge" title="ยังไม่ได้ backup" style="position:absolute;top:6px;right:4px"></span>' : ''}</button>
    </nav>`;

  hdr.querySelector('#hdr-logo').onclick = () => navigate('projects');
  hdr.querySelectorAll('[data-nav]').forEach(b => b.onclick = () => navigate(b.dataset.nav));

  const sel = hdr.querySelector('#hdr-project');
  const opts = [
    `<option value="">— เรื่องของฉัน —</option>`,
    ...S.allProjects.map(p =>
      `<option value="${p.id}" ${S.project?.id === p.id ? 'selected' : ''}>${escapeHtml(p.title)}</option>`),
    `<option value="__new__">＋ เรื่องใหม่…</option>`,
  ];
  sel.innerHTML = opts.join('');
  sel.onchange = async () => {
    if (sel.value === '__new__') { openNewProjectModal(); sel.value = S.project?.id || ''; return; }
    if (!sel.value) { navigate('projects'); return; }
    await openProject(sel.value);
    if (S.route === 'projects') navigate('write');
    else render();
  };
}

// ── Mobile bottom nav ──
function renderMobileNav() {
  const nav = document.getElementById('mobile-nav');
  const items = [
    ['write', '✍️', 'เขียน'],
    ['codex', '📚', 'Codex'],
    ['timeline', '🕑', 'ไทม์ไลน์'],
    ['projects', '📖', 'เรื่อง'],
    ['settings', '⚙️', 'ตั้งค่า'],
  ];
  nav.innerHTML = items.map(([r, ico, label]) =>
    `<button data-nav="${r}" class="${S.route === r ? 'active' : ''}"><span class="ico">${ico}</span>${label}</button>`).join('');
  nav.querySelectorAll('button').forEach(b => b.onclick = () => navigate(b.dataset.nav));
}

// ── init ──
async function init() {
  document.documentElement.dataset.theme = S.settings.theme || 'dark';
  await openDB();
  await refreshProjects();

  on('nav', navigate);
  on('project-open', () => renderHeader());
  on('projects-changed', () => renderHeader());
  on('project-meta-changed', () => { renderHeader(); if (S.route === 'projects') render(); });

  document.getElementById('fab-ai').onclick = () => document.body.classList.toggle('sheet-open');
  document.getElementById('zen-exit').onclick = () => document.body.classList.remove('zen');
  window.addEventListener('hashchange', render);

  // เด้งเข้าโปรเจกต์ล่าสุดอัตโนมัติ
  const last = S.settings.lastProjectId;
  if (!routeFromHash() && last && S.allProjects.some(p => p.id === last)) {
    await openProject(last);
    navigate('write');
  } else if (routeFromHash() && routeFromHash() !== 'projects' && last && S.allProjects.some(p => p.id === last)) {
    await openProject(last);
  }
  await render();
}

init().catch(e => {
  console.error(e);
  document.getElementById('app-main').innerHTML =
    `<div class="empty-state"><div class="big">💥</div>เปิดแอพไม่สำเร็จ: ${escapeHtml(e.message)}<br>
     <span class="hint">ต้องเปิดผ่าน http:// (เช่น python -m http.server) ไม่ใช่ file:// และใช้ browser รุ่นใหม่</span></div>`;
});
