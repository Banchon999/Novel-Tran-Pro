// ═══ ui.js — toast / modal / menu popup / confirm ═══

import { escapeHtml } from './text.js';

// ── Toast ──
export function toast(msg, type = '', ms = 2600) {
  const root = document.getElementById('toast-root');
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = msg;
  root.appendChild(el);
  setTimeout(() => {
    el.style.opacity = '0';
    el.style.transition = 'opacity 0.3s';
    setTimeout(() => el.remove(), 320);
  }, ms);
}

// ── Modal ──
// openModal({ title, bodyHtml, wide, buttons: [{label, cls, onClick}], onOpen })
// onClick คืน false = ไม่ปิด modal
export function openModal({ title, bodyHtml = '', wide = false, buttons = [], onOpen, onClose }) {
  const root = document.getElementById('modal-root');
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.innerHTML = `
    <div class="modal ${wide ? 'wide' : ''}" role="dialog">
      <div class="modal-head">${escapeHtml(title)}<span class="spacer"></span>
        <button class="btn ghost icon" data-close>✕</button></div>
      <div class="modal-body"></div>
      <div class="modal-foot"></div>
    </div>`;
  const modal = backdrop.querySelector('.modal');
  const body = backdrop.querySelector('.modal-body');
  body.innerHTML = bodyHtml;
  const foot = backdrop.querySelector('.modal-foot');

  const close = () => { backdrop.remove(); onClose?.(); };
  backdrop.addEventListener('click', e => { if (e.target === backdrop) close(); });
  backdrop.querySelector('[data-close]').onclick = close;
  const escHandler = e => { if (e.key === 'Escape') { close(); document.removeEventListener('keydown', escHandler); } };
  document.addEventListener('keydown', escHandler);

  for (const b of buttons) {
    const btn = document.createElement('button');
    btn.className = `btn ${b.cls || ''}`;
    btn.textContent = b.label;
    btn.onclick = async () => {
      const r = await b.onClick?.(body, close);
      if (r !== false) close();
    };
    foot.appendChild(btn);
  }
  if (!buttons.length) foot.remove();

  root.appendChild(backdrop);
  onOpen?.(body, close, modal);
  return { body, close, modal };
}

export function confirmModal(title, message, { danger = false, okLabel = 'ตกลง' } = {}) {
  return new Promise(resolve => {
    openModal({
      title,
      bodyHtml: `<p style="margin:0;color:var(--text-dim)">${escapeHtml(message)}</p>`,
      buttons: [
        { label: 'ยกเลิก', onClick: () => resolve(false) },
        { label: okLabel, cls: danger ? 'danger' : 'primary', onClick: () => resolve(true) },
      ],
      onClose: () => resolve(false),
    });
  });
}

// ── เมนู popup ยึดตำแหน่งปุ่ม ──
// items: [{label, icon, cls, onClick}, 'hr']
export function openMenu(anchorEl, items) {
  closeMenus();
  const pop = document.createElement('div');
  pop.className = 'menu-pop';
  for (const it of items) {
    if (it === 'hr') { pop.appendChild(document.createElement('hr')); continue; }
    const b = document.createElement('button');
    b.className = it.cls || '';
    b.innerHTML = `${it.icon || ''} ${escapeHtml(it.label)}`;
    b.onclick = () => { closeMenus(); it.onClick?.(); };
    pop.appendChild(b);
  }
  document.body.appendChild(pop);
  const r = anchorEl.getBoundingClientRect();
  const pw = pop.offsetWidth, ph = pop.offsetHeight;
  let x = Math.min(r.left, window.innerWidth - pw - 8);
  let y = r.bottom + 4;
  if (y + ph > window.innerHeight - 8) y = Math.max(8, r.top - ph - 4);
  pop.style.left = `${Math.max(8, x)}px`;
  pop.style.top = `${y}px`;
  setTimeout(() => document.addEventListener('click', closeMenus, { once: true }), 0);
  return pop;
}

export function closeMenus() {
  document.querySelectorAll('.menu-pop, .info-pop').forEach(el => el.remove());
}

// ── info popup (ข้อมูลย่อ Codex) ──
export function openInfoPop(anchorEl, titleHtml, bodyText) {
  closeMenus();
  const pop = document.createElement('div');
  pop.className = 'info-pop';
  pop.innerHTML = `<h5>${titleHtml}</h5><p>${escapeHtml(bodyText || '(ไม่มีคำอธิบาย)')}</p>`;
  document.body.appendChild(pop);
  const r = anchorEl.getBoundingClientRect();
  const pw = pop.offsetWidth, ph = pop.offsetHeight;
  let x = Math.min(r.left, window.innerWidth - pw - 8);
  let y = r.bottom + 6;
  if (y + ph > window.innerHeight - 8) y = Math.max(8, r.top - ph - 6);
  pop.style.left = `${Math.max(8, x)}px`;
  pop.style.top = `${y}px`;
  setTimeout(() => document.addEventListener('click', closeMenus, { once: true }), 0);
  return pop;
}
