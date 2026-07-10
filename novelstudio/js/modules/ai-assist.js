// ═══ M4 — AI Assist: แผงคำสั่ง AI 5 ฟีเจอร์ (เขียนต่อ/เกลา/คิดชื่อ/เช็คต่อเนื่อง/ระดมไอเดีย) ═══

import { S, currentChapter } from '../state.js';
import { escapeHtml, allNames } from '../utils/text.js';
import { toast } from '../utils/ui.js';
import { aiCall, usageText } from '../ai/openrouter.js';
import {
  buildMessages, taskContinue, taskRefine, taskName, taskCheck, taskBrainstorm,
} from '../ai/prompts.js';
import { buildContext, renderContextBar } from './context.js';
import { openCodexModal, CDX_TYPES } from './codex.js';
import { typeLabel } from '../ai/prompts.js';

const ACTIONS = {
  continue:  { icon: '✍️', label: 'เขียนต่อ',    temp: 0.85 },
  refine:    { icon: '✨', label: 'เกลาสำนวน',   temp: 0.6 },
  name:      { icon: '🏷️', label: 'คิดชื่อ',     temp: 0.9 },
  check:     { icon: '🔍', label: 'เช็คต่อเนื่อง', temp: 0.2, noStream: true },
  brainstorm:{ icon: '💡', label: 'ระดมไอเดีย',  temp: 0.9 },
};

// state ของแผง (คงอยู่ระหว่าง re-render ของ editor)
const P = {
  action: 'continue',
  running: false,
  abort: null,
  lastText: '',
  lastSelection: null, // สำหรับ refine
  container: null,
  editorApi: null,
};

export function renderAiPanel(container, editorApi) {
  P.container = container;
  P.editorApi = editorApi;
  container.classList.add('ai-panel');
  container.innerHTML = `
    <div class="pane-head">✨ ผู้ช่วย AI<span class="spacer"></span>
      <button class="btn ghost icon" id="ai-close" title="ปิด">✕</button></div>
    <div class="ai-body">
      <div id="ctx-slot"></div>
      <div class="ai-actions" id="ai-actions"></div>
      <div class="ai-opts" id="ai-opts"></div>
      <input type="text" id="ai-note" placeholder="คำสั่งเพิ่มเติม (เช่น เน้นบรรยากาศหม่นๆ)…" autocomplete="off">
      <button class="btn primary" id="ai-run">▶ เริ่ม</button>
      <div id="ai-status" class="hint" style="display:none"></div>
      <div class="ai-out" id="ai-out" style="display:none"></div>
      <div id="ai-extra"></div>
      <div class="ai-result-btns" id="ai-btns"></div>
      <div class="ai-cost" id="ai-cost"></div>
    </div>`;

  container.querySelector('#ai-close').onclick = () => document.body.classList.remove('sheet-open');

  const actionsEl = container.querySelector('#ai-actions');
  for (const [key, a] of Object.entries(ACTIONS)) {
    const b = document.createElement('button');
    b.dataset.action = key;
    b.innerHTML = `<span class="ico">${a.icon}</span>${a.label}`;
    b.onclick = () => { P.action = key; syncActionUI(); };
    actionsEl.appendChild(b);
  }

  container.querySelector('#ai-run').onclick = () => P.running ? stopRun() : run();
  refreshContextBar();
  syncActionUI();
}

export function refreshContextBar() {
  const slot = P.container?.querySelector('#ctx-slot');
  if (!slot) return;
  renderContextBar(slot, currentChapter(), () => refreshContextBar());
}

function syncActionUI() {
  const c = P.container;
  if (!c) return;
  c.querySelectorAll('#ai-actions button').forEach(b =>
    b.classList.toggle('active', b.dataset.action === P.action));

  const opts = c.querySelector('#ai-opts');
  if (P.action === 'continue') {
    opts.innerHTML = `
      <label class="fld">ความยาว
        <select id="opt-len">
          <option value="short">สั้น (1 ย่อหน้า)</option>
          <option value="medium" selected>กลาง (2-3 ย่อหน้า)</option>
          <option value="long">ยาว (4-5 ย่อหน้า)</option>
        </select></label>`;
  } else if (P.action === 'refine') {
    const sel = P.editorApi?.getSelection();
    opts.innerHTML = `
      <span class="hint">${sel?.text ? `จะเกลาข้อความที่เลือก (${sel.text.length} ตัวอักษร)` : '⚠ ลากเลือกข้อความในตอนก่อน แล้วค่อยกดเริ่ม'}</span>
      <label class="fld">โทน
        <select id="opt-tone">
          <option value="">คงโทนเดิม</option>
          <option value="เข้มข้น จริงจังขึ้น">เข้มข้น/จริงจัง</option>
          <option value="นุ่มนวล อบอุ่นขึ้น">นุ่มนวล/อบอุ่น</option>
          <option value="หม่น กดดัน">หม่น/กดดัน</option>
          <option value="สนุก มีลูกเล่น">สนุก/มีลูกเล่น</option>
          <option value="กระชับ ตัดคำฟุ่มเฟือย">กระชับขึ้น</option>
        </select></label>`;
  } else if (P.action === 'name') {
    opts.innerHTML = `
      <div class="fld-row">
        <label class="fld">ประเภท
          <select id="opt-ntype">${CDX_TYPES.map(t => `<option value="${t}">${typeLabel(t)}</option>`).join('')}</select></label>
      </div>
      <label class="fld">คำใบ้
        <input type="text" id="opt-hint" placeholder="เช่น สกิลดาบสายน้ำแข็ง ของตัวร้าย"></label>`;
  } else if (P.action === 'check') {
    opts.innerHTML = `<span class="hint">ตรวจตอนปัจจุบันเทียบกับ Codex + สรุปตอนก่อนๆ แล้วรายงานจุดขัดแย้ง</span>`;
  } else if (P.action === 'brainstorm') {
    opts.innerHTML = `
      <label class="fld">โจทย์
        <textarea id="opt-bs" rows="2" placeholder="เช่น จะให้ตัวร้ายเปิดตัวยังไงให้เซอร์ไพรส์ / ทางไปต่อของ arc นี้"></textarea></label>`;
  }
  clearResult();
}

function clearResult() {
  const c = P.container;
  if (!c) return;
  c.querySelector('#ai-out').style.display = 'none';
  c.querySelector('#ai-out').textContent = '';
  c.querySelector('#ai-extra').innerHTML = '';
  c.querySelector('#ai-btns').innerHTML = '';
  c.querySelector('#ai-cost').textContent = '';
  c.querySelector('#ai-status').style.display = 'none';
}

function setRunning(running) {
  P.running = running;
  const btn = P.container?.querySelector('#ai-run');
  if (btn) {
    btn.textContent = running ? '⏹ หยุด' : '▶ เริ่ม';
    btn.classList.toggle('danger', running);
    btn.classList.toggle('primary', !running);
  }
}

function stopRun() {
  P.abort?.abort();
}

// ── รวบรวม input ต่อ action → { task, maxTokens, error } ──
function collectTask() {
  const c = P.container;
  const ch = currentChapter();
  const userNote = c.querySelector('#ai-note').value.trim();
  const content = ch?.content || '';

  switch (P.action) {
    case 'continue': {
      if (!content.trim()) return { error: 'ตอนนี้ยังว่าง — เขียนสักหน่อยก่อนให้ AI ต่อ (หรือใช้ 💡 ระดมไอเดีย)' };
      const length = c.querySelector('#opt-len')?.value || 'medium';
      return {
        task: taskContinue({ tailText: content.slice(-2000), length, userNote }),
        maxTokens: { short: 700, medium: 1400, long: 2400 }[length],
      };
    }
    case 'refine': {
      const sel = P.editorApi.getSelection();
      if (!sel?.text?.trim()) return { error: 'ลากเลือกข้อความที่จะเกลาก่อน' };
      if (sel.text.length > 6000) return { error: 'เลือกยาวเกินไป (เกิน 6,000 ตัวอักษร) — แบ่งเกลาทีละท่อน' };
      P.lastSelection = sel;
      const tone = c.querySelector('#opt-tone')?.value || '';
      return {
        task: taskRefine({ selectedText: sel.text, tone, userNote }),
        maxTokens: Math.min(4000, Math.max(600, Math.ceil(sel.text.length / 1.5))),
      };
    }
    case 'name': {
      const nameType = c.querySelector('#opt-ntype')?.value || 'character';
      const hint = c.querySelector('#opt-hint')?.value.trim() || '';
      const existingNames = S.codex.flatMap(e => allNames(e)).slice(0, 80);
      return { task: taskName({ nameType, hint, existingNames, userNote }), maxTokens: 900, nameType };
    }
    case 'check': {
      if (!content.trim()) return { error: 'ตอนนี้ยังว่าง — ไม่มีอะไรให้เช็ค' };
      return { task: taskCheck({ chapterText: content.slice(0, 30000), userNote }), maxTokens: 2500 };
    }
    case 'brainstorm': {
      const prompt = c.querySelector('#opt-bs')?.value.trim();
      if (!prompt) return { error: 'พิมพ์โจทย์ก่อน — อยากได้ไอเดียเรื่องอะไร' };
      return { task: taskBrainstorm({ prompt, userNote }), maxTokens: 2000 };
    }
  }
}

async function run() {
  const c = P.container;
  const ch = currentChapter();
  if (!ch && P.action !== 'brainstorm' && P.action !== 'name') { toast('เปิดตอนก่อน', 'err'); return; }
  P.editorApi?.flushSave?.();

  const collected = collectTask();
  if (collected.error) { toast(collected.error, 'err'); return; }

  const action = ACTIONS[P.action];
  const ctx = buildContext(ch);
  const messages = buildMessages({
    project: S.project,
    settings: S.settings,
    worldContext: ctx.worldContext,
    storyMemory: ctx.storyMemory,
    task: collected.task,
  });

  clearResult();
  const out = c.querySelector('#ai-out');
  const status = c.querySelector('#ai-status');
  out.style.display = '';
  status.style.display = '';
  status.textContent = '⏳ กำลังเรียก AI…';
  out.innerHTML = '<span class="cursor"></span>';
  setRunning(true);
  P.abort = new AbortController();

  let text = '';
  const stream = !action.noStream;
  try {
    const r = await aiCall({
      messages,
      temperature: action.temp,
      maxTokens: collected.maxTokens,
      stream,
      signal: P.abort.signal,
      onStatus: (msg) => { status.textContent = `⏳ ${msg}`; },
      onChunk: (delta) => {
        text += delta;
        status.style.display = 'none';
        out.textContent = text;
        out.insertAdjacentHTML('beforeend', '<span class="cursor"></span>');
        out.scrollTop = out.scrollHeight;
      },
    });
    text = r.text || text;
    P.lastText = text;
    status.style.display = 'none';
    out.textContent = text;
    c.querySelector('#ai-cost').textContent = usageText(r.usage, r.usedFallback, r.model);
    renderResult(collected);
  } catch (e) {
    status.style.display = 'none';
    if (e.name === 'AbortError') {
      if (text) { P.lastText = text; out.textContent = text; renderResult(collected); toast('หยุดแล้ว — ใช้ข้อความเท่าที่ได้ หรือลองใหม่'); }
      else { out.style.display = 'none'; }
    } else {
      out.style.display = 'none';
      toast(e.message, 'err', 4200);
    }
  } finally {
    setRunning(false);
    P.abort = null;
  }
}

// ── แสดงผลลัพธ์ + ปุ่มต่อ action ──
function renderResult(collected) {
  const c = P.container;
  const out = c.querySelector('#ai-out');
  const extra = c.querySelector('#ai-extra');
  const btns = c.querySelector('#ai-btns');
  btns.innerHTML = '';

  const addBtn = (label, cls, fn) => {
    const b = document.createElement('button');
    b.className = `btn sm ${cls || ''}`;
    b.textContent = label;
    b.onclick = fn;
    btns.appendChild(b);
    return b;
  };
  const retryBtn = () => addBtn('🔁 ลองใหม่', '', () => run());
  const discardBtn = () => addBtn('🗑 ทิ้ง', '', () => clearResult());

  if (P.action === 'continue') {
    addBtn('⤵ แทรกท้ายตอน', 'primary', () => {
      P.editorApi.appendText(P.lastText);
      toast('แทรกแล้ว — อ่านทวน/แก้ต่อได้เลย', 'ok');
      clearResult();
      refreshContextBar();
    });
    retryBtn(); discardBtn();

  } else if (P.action === 'refine') {
    const sel = P.lastSelection;
    extra.innerHTML = `<div class="hint" style="margin-bottom:4px">ก่อนเกลา:</div>
      <div class="diff-before">${escapeHtml(sel?.text || '')}</div>`;
    addBtn('♻ แทนที่ข้อความเดิม', 'primary', () => {
      const ok = P.editorApi.replaceRange(sel.start, sel.end, P.lastText, sel.text);
      if (ok) { toast('แทนที่แล้ว', 'ok'); clearResult(); }
      else toast('เนื้อหาถูกแก้ไปแล้ว — แทนที่อัตโนมัติไม่ได้ ใช้วิธีคัดลอกแทน', 'err', 4000);
    });
    addBtn('📋 คัดลอก', '', () => { navigator.clipboard?.writeText(P.lastText); toast('คัดลอกแล้ว', 'ok'); });
    retryBtn(); discardBtn();

  } else if (P.action === 'name') {
    // แปลงบรรทัด "ชื่อ — ความหมาย" เป็นรายการ + ปุ่มเพิ่มเข้า Codex
    const items = parseNameList(P.lastText);
    if (items.length) {
      out.style.display = 'none';
      extra.innerHTML = '';
      for (const it of items) {
        const row = document.createElement('div');
        row.className = 'name-item';
        row.innerHTML = `<b>${escapeHtml(it.name)}</b><span class="mean">${escapeHtml(it.meaning)}</span>`;
        const add = document.createElement('button');
        add.className = 'btn sm';
        add.textContent = '＋';
        add.title = 'เพิ่มเข้า Codex';
        add.onclick = () => openCodexModal({
          prefill: { type: collected.nameType, name: it.name, description: it.meaning },
          onSaved: () => { add.textContent = '✓'; add.disabled = true; refreshContextBar(); },
        });
        row.appendChild(add);
        extra.appendChild(row);
      }
    }
    retryBtn(); discardBtn();

  } else if (P.action === 'check') {
    const issues = parseCheckJson(P.lastText);
    if (issues === null) {
      // parse ไม่ได้ — แสดงข้อความดิบไว้อ่านเอง
    } else {
      out.style.display = 'none';
      extra.innerHTML = '';
      if (!issues.length) {
        extra.innerHTML = `<div class="hint" style="padding:8px">✅ ไม่พบจุดขัดแย้ง — ต่อเนื่องดี</div>`;
      }
      for (const it of issues) {
        const row = document.createElement('div');
        row.className = 'check-item';
        row.innerHTML = `
          <b>${escapeHtml(it.type || 'ปัญหา')}</b> — ${escapeHtml(it.detail || '')}
          ${it.location ? `<div class="loc">📍 "${escapeHtml(it.location)}" (แตะเพื่อไปยังตำแหน่ง)</div>` : ''}
          ${it.suggestion ? `<div class="sug">💡 ${escapeHtml(it.suggestion)}</div>` : ''}`;
        row.onclick = () => {
          if (it.location && !P.editorApi.scrollToText(it.location)) {
            toast('หาตำแหน่งไม่เจอ (เนื้อหาอาจถูกแก้แล้ว)', 'err');
          } else if (it.location) {
            document.body.classList.remove('sheet-open'); // มือถือ: ปิด sheet ให้เห็น editor
          }
        };
        extra.appendChild(row);
      }
    }
    retryBtn(); discardBtn();

  } else if (P.action === 'brainstorm') {
    addBtn('📋 คัดลอก', '', () => { navigator.clipboard?.writeText(P.lastText); toast('คัดลอกแล้ว', 'ok'); });
    retryBtn(); discardBtn();
  }
}

function parseNameList(text) {
  const items = [];
  for (const raw of text.split('\n')) {
    const line = raw.replace(/^[\s\d.\-•*)]+/, '').trim();
    if (!line) continue;
    const m = line.match(/^(.{1,60}?)\s*[—–:\-]\s+(.+)$/) || line.match(/^(.{1,60}?)\s*[—–:]\s*(.+)$/);
    if (m) items.push({ name: m[1].trim().replace(/^["'«]|["'»]$/g, ''), meaning: m[2].trim() });
  }
  return items;
}

function parseCheckJson(text) {
  let t = text.trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) t = fence[1].trim();
  const start = t.indexOf('[');
  const end = t.lastIndexOf(']');
  if (start < 0 || end <= start) return null;
  try {
    const arr = JSON.parse(t.slice(start, end + 1));
    return Array.isArray(arr) ? arr : null;
  } catch {
    return null;
  }
}
