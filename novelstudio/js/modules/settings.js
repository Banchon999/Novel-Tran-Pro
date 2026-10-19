// ═══ M7 — Settings: API / โมเดล / prompt / ธีม / ข้อมูล ═══

import { S, saveSettings, emit, closeProject } from '../state.js';
import { dbClear, STORES } from '../db.js';
import { toast, confirmModal, openModal } from '../utils/ui.js';
import { escapeHtml, fmtDate } from '../utils/text.js';
import { GENRES } from '../ai/genres.js';
import { exportAll, exportProject, importData, pickJsonFile } from '../utils/export.js';

const COMMON_MODELS = [
  'anthropic/claude-sonnet-4.5',
  'anthropic/claude-haiku-4.5',
  'google/gemini-2.5-flash',
  'google/gemini-2.5-pro',
  'deepseek/deepseek-chat',
  'openai/gpt-4o-mini',
  'qwen/qwen3-235b-a22b',
];

export function renderSettings(main) {
  const st = S.settings;
  const backupOld = st.lastBackupAt && (Date.now() - st.lastBackupAt > 7 * 864e5);
  const page = document.createElement('div');
  page.className = 'page';
  page.innerHTML = `
    <h2 style="margin:4px 0 20px">⚙️ ตั้งค่า</h2>

    <div class="set-section">
      <h3>🤖 AI (OpenRouter)</h3>
      <label class="fld">API Key
        <span style="display:flex;gap:6px">
          <input type="password" id="st-key" style="flex:1" value="${escapeHtml(st.apiKey)}" placeholder="sk-or-…" autocomplete="off">
          <button class="btn icon" id="st-key-eye" title="แสดง/ซ่อน">👁</button>
        </span>
        <span class="hint">เก็บใน localStorage เครื่องนี้เท่านั้น ส่งออกเฉพาะไปยัง OpenRouter · สมัครฟรีที่ openrouter.ai/keys · ⚠ อย่า deploy แอพขึ้นเว็บสาธารณะทั้งที่ใส่ key ไว้</span></label>
      <div class="fld-row">
        <label class="fld">โมเดลหลัก
          <input type="text" id="st-model" list="model-list" value="${escapeHtml(st.model)}"></label>
        <label class="fld">โมเดลสำรอง (fallback อัตโนมัติเมื่อ error)
          <input type="text" id="st-fallback" list="model-list" value="${escapeHtml(st.fallbackModel)}"></label>
      </div>
      <datalist id="model-list">${COMMON_MODELS.map(m => `<option value="${m}">`).join('')}</datalist>
      <div class="fld-row">
        <label class="fld">Context budget (ตัวอักษร สำหรับ Codex + ความจำเรื่อง)
          <input type="number" id="st-budget" min="1000" max="60000" step="500" value="${st.maxContextChars}"></label>
        <label class="fld">แนบสรุปกี่ตอนล่าสุด
          <input type="number" id="st-depth" min="0" max="30" value="${st.memoryDepth}"></label>
      </div>
      <div><button class="btn" id="st-test">🔌 ทดสอบการเชื่อมต่อ</button> <span class="hint" id="st-test-out"></span></div>
    </div>

    <div class="set-section">
      <h3>🎭 System prompt ต่อแนวเรื่อง (advanced)</h3>
      <span class="hint">เว้นว่าง = ใช้ค่ามาตรฐานของแอพ · แก้เฉพาะแนวที่อยากปรับ</span>
      <div id="st-genres"></div>
    </div>

    <div class="set-section">
      <h3>🎨 การแสดงผล</h3>
      <div class="fld-row">
        <label class="fld">ธีม
          <select id="st-theme">
            <option value="dark" ${st.theme === 'dark' ? 'selected' : ''}>🌙 มืด</option>
            <option value="light" ${st.theme === 'light' ? 'selected' : ''}>☀️ สว่าง</option>
          </select></label>
        <label class="fld">ขนาดฟอนต์ editor (px)
          <input type="number" id="st-font" min="14" max="28" value="${st.editorFontSize}"></label>
      </div>
    </div>

    <div class="set-section">
      <h3>💾 ข้อมูล / Backup</h3>
      ${backupOld ? `<div class="hint" style="color:var(--warn)">⚠ ไม่ได้ backup มาเกิน 7 วันแล้ว (ล่าสุด: ${fmtDate(st.lastBackupAt)}) — ข้อมูลอยู่ใน browser เท่านั้น เคลียร์ browser = หาย</div>`
        : `<div class="hint">backup ล่าสุด: ${st.lastBackupAt ? fmtDate(st.lastBackupAt) : 'ยังไม่เคย — ข้อมูลอยู่ใน browser เท่านั้น แนะนำ export เก็บไว้'}</div>`}
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn primary" id="st-export-all">📦 Export ทั้งแอพ</button>
        ${S.project ? `<button class="btn" id="st-export-prj">📦 Export เฉพาะ "${escapeHtml(S.project.title)}"</button>` : ''}
        <button class="btn" id="st-import">📥 Import</button>
      </div>
      <div><button class="btn danger" id="st-clear">🧹 ล้างข้อมูลทั้งหมด</button></div>
    </div>`;

  // ── bindings ──
  const bind = (sel, key, transform = v => v) => {
    const el = page.querySelector(sel);
    el.onchange = () => {
      S.settings[key] = transform(el.value);
      saveSettings();
      toast('บันทึกแล้ว', 'ok', 1200);
    };
  };
  bind('#st-key', 'apiKey', v => v.trim());
  bind('#st-model', 'model', v => v.trim());
  bind('#st-fallback', 'fallbackModel', v => v.trim());
  bind('#st-budget', 'maxContextChars', v => Math.max(1000, +v || 8000));
  bind('#st-depth', 'memoryDepth', v => Math.max(0, +v || 0));
  bind('#st-font', 'editorFontSize', v => Math.min(28, Math.max(14, +v || 18)));

  page.querySelector('#st-key-eye').onclick = () => {
    const inp = page.querySelector('#st-key');
    inp.type = inp.type === 'password' ? 'text' : 'password';
  };

  page.querySelector('#st-theme').onchange = (e) => {
    S.settings.theme = e.target.value;
    saveSettings();
    document.documentElement.dataset.theme = S.settings.theme;
  };

  page.querySelector('#st-test').onclick = async (e) => {
    const out = page.querySelector('#st-test-out');
    const key = page.querySelector('#st-key').value.trim();
    if (!key) { out.textContent = '✗ ใส่ API Key ก่อน'; return; }
    e.target.disabled = true;
    out.textContent = '⏳ กำลังทดสอบ…';
    try {
      const res = await fetch('https://openrouter.ai/api/v1/models', { headers: { Authorization: `Bearer ${key}` } });
      out.textContent = res.ok ? '✓ เชื่อมต่อได้ key ใช้งานได้' : `✗ HTTP ${res.status} — key อาจไม่ถูกต้อง`;
    } catch {
      out.textContent = '✗ เชื่อมต่อไม่ได้ — เช็คอินเทอร์เน็ต';
    } finally {
      e.target.disabled = false;
    }
  };

  // genre prompt overrides
  const gwrap = page.querySelector('#st-genres');
  for (const [key, g] of Object.entries(GENRES)) {
    if (key === 'custom') continue; // custom แก้ที่ตัวโปรเจกต์
    const det = document.createElement('details');
    det.style.cssText = 'border:1px solid var(--border-soft);border-radius:8px;padding:8px 12px';
    det.innerHTML = `
      <summary style="cursor:pointer">${g.icon} ${escapeHtml(g.label)} ${S.settings.genrePrompts?.[key]?.trim() ? '<span class="chip">แก้แล้ว</span>' : ''}</summary>
      <textarea rows="6" data-genre="${key}" placeholder="${escapeHtml(g.prompt)}" style="width:100%;margin-top:8px">${escapeHtml(S.settings.genrePrompts?.[key] || '')}</textarea>
      <div class="hint" style="margin-top:4px">เว้นว่าง = ใช้ค่ามาตรฐาน (แสดงเป็น placeholder)</div>`;
    det.querySelector('textarea').onchange = (e) => {
      S.settings.genrePrompts = S.settings.genrePrompts || {};
      S.settings.genrePrompts[key] = e.target.value;
      saveSettings();
      toast('บันทึก prompt แล้ว', 'ok', 1200);
    };
    gwrap.appendChild(det);
  }

  // data
  page.querySelector('#st-export-all').onclick = async () => {
    await exportAll();
    toast('📦 Export แล้ว (ไม่รวม API key)', 'ok');
    renderSettings(main);
  };
  page.querySelector('#st-export-prj')?.addEventListener('click', async () => {
    await exportProject(S.project.id);
    toast('📦 Export โปรเจกต์แล้ว', 'ok');
  });
  page.querySelector('#st-import').onclick = async () => {
    try {
      const json = await pickJsonFile();
      if (!json) return;
      openModal({
        title: '📥 Import',
        bodyHtml: `<p style="margin:0;color:var(--text-dim)">พบ ${json.projects?.length || 0} เรื่อง, ${json.chapters?.length || 0} ตอน, ${json.codex?.length || 0} รายการ Codex<br><br>
          <b>Merge</b> = เพิ่ม/ทับเฉพาะรายการที่ id ตรงกัน (ปลอดภัย)<br>
          <b>Replace</b> = ล้างข้อมูลเดิมทั้งแอพก่อนแล้วใส่ของใหม่</p>`,
        buttons: [
          { label: 'ยกเลิก', onClick: () => {} },
          {
            label: 'Replace ทั้งแอพ', cls: 'danger',
            onClick: async () => {
              const ok = await confirmModal('ยืนยัน Replace?', 'ข้อมูลเดิมทั้งหมดจะถูกลบก่อน import', { danger: true, okLabel: 'Replace' });
              if (!ok) return false;
              const r = await importData(json, 'replace');
              closeProject();
              toast(`✓ Import แล้ว ${r.projects} เรื่อง / ${r.chapters} ตอน`, 'ok');
              emit('nav', 'projects');
            },
          },
          {
            label: 'Merge', cls: 'primary',
            onClick: async () => {
              const r = await importData(json, 'merge');
              closeProject();
              toast(`✓ Import แล้ว ${r.projects} เรื่อง / ${r.chapters} ตอน`, 'ok');
              emit('nav', 'projects');
            },
          },
        ],
      });
    } catch (e) {
      toast(e.message, 'err');
    }
  };
  page.querySelector('#st-clear').onclick = async () => {
    const ok = await confirmModal('🧹 ล้างข้อมูลทั้งหมด?',
      'ทุกเรื่อง ทุกตอน ทุก Codex จะหายถาวร (ตั้งค่า/API key ยังอยู่) — Export ก่อนถ้ายังไม่ได้ทำ',
      { danger: true, okLabel: 'ล้างทั้งหมด' });
    if (!ok) return;
    for (const s of STORES) await dbClear(s);
    closeProject();
    S.settings.lastProjectId = '';
    S.settings.lastChapterByProject = {};
    saveSettings();
    toast('ล้างข้อมูลแล้ว', 'ok');
    emit('nav', 'projects');
  };

  main.replaceChildren(page);
}
