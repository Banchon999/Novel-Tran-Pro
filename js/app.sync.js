// ═══════════════════════════════════════════════
// ─── Sync นิยายข้ามเครื่อง ───
// ═══════════════════════════════════════════════
// ปลายทาง 2 แบบ ใช้ engine เดียวกัน (adapter: list / get / put / remove)
//   - 'supabase' : Premium → Supabase Storage  workspaces/{uid}/{wsId}.json
//   - 'gdrive'   : ผู้ใช้ฟรี → Google Drive ของผู้ใช้เอง (โฟลเดอร์ซ่อนของแอป appDataFolder)
// กฎ: ห้ามทำข้อมูลหาย — ไม่ลบในเครื่องเพราะฝั่ง remote ไม่มี (อัปโหลดขึ้นไปแทน)
//     แก้ทั้งสองฝั่ง → ถามผู้ใช้ และเก็บสำเนาฝั่งที่ไม่ได้เลือกไว้เป็น workspace แยก

const SYNC = {
  target: null, adapter: null, state: null,
  busy: false, again: false, againPull: false, timer: null, firstDirtyAt: 0,
  status: '', error: '', lastOk: 0, lastPull: 0, applying: false,
  driveToken: null, driveExp: 0, driveIds: {},
};
const SYNC_DEBOUNCE_MS = 4000;
const LS_DRIVE_ON  = 'nt8_sync_gdrive';      // ผู้ใช้เปิด sync Google Drive
const LS_CLOUD_OFF = 'nt8_sync_cloud_off';   // Premium ปิด sync คลาวด์เอง
const GIS_URL = 'https://accounts.google.com/gsi/client';
const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.appdata';

// ── adapter: Supabase Storage (Premium) ──
const SupabaseSync = {
  label: 'คลาวด์ NovelTrans',
  icon: '☁',
  _path: id => `${ACC.session.user.id}/${id}.json`,
  async list() {
    const { data, error } = await ACC.sb.storage.from('workspaces').list(ACC.session.user.id, { limit: 1000 });
    if (error) throw error;
    return (data || []).filter(o => o.name.endsWith('.json')).map(o => ({ id: o.name.slice(0, -5), rev: o.updated_at || o.created_at || '' }));
  },
  async get(id) {
    const { data, error } = await ACC.sb.storage.from('workspaces').download(this._path(id));
    if (error) throw error;
    return JSON.parse(await data.text());
  },
  async put(id, json) {
    const { error } = await ACC.sb.storage.from('workspaces')
      .upload(this._path(id), new Blob([json], { type: 'application/json' }), { upsert: true, contentType: 'application/json', cacheControl: '0' });
    if (error) {
      if (/row-level security|policy|403/i.test(error.message || '')) throw new Error('Premium หมดอายุ — อัปโหลดขึ้นคลาวด์ไม่ได้ (ข้อมูลในเครื่องยังอยู่ครบ)');
      if (/exceeded|too large|413/i.test(error.message || '')) throw new Error('ไฟล์นิยายใหญ่เกิน 50MB — แยกเป็นหลายเรื่องหรือลบตอนที่ไม่ใช้');
      throw error;
    }
    return null;   // Storage ไม่คืนเวลาแก้ → engine อ่านจาก list() ทีหลัง
  },
  async remove(id) {
    const { error } = await ACC.sb.storage.from('workspaces').remove([this._path(id)]);
    if (error) throw error;
  },
};

// ── adapter: Google Drive (ผู้ใช้ฟรี) ──
async function driveToken(interactive) {
  if (SYNC.driveToken && Date.now() < SYNC.driveExp - 60e3) return SYNC.driveToken;
  try {
    const c = JSON.parse(sessionStorage.getItem('nt8_gdrive_tok') || 'null');
    if (c && Date.now() < c.exp - 60e3) { SYNC.driveToken = c.t; SYNC.driveExp = c.exp; return c.t; }
  } catch {}
  if (!interactive) { const e = new Error('การเชื่อม Google Drive หมดอายุ — กด 🔄 Sync เพื่อเชื่อมใหม่'); e.needAuth = true; throw e; }
  await loadScriptOnce(GIS_URL);
  return new Promise((resolve, reject) => {
    const tc = google.accounts.oauth2.initTokenClient({
      client_id: ACC.config.googleClientId,
      scope: DRIVE_SCOPE,
      callback: (resp) => {
        if (resp.error) return reject(new Error('เชื่อม Google Drive ไม่สำเร็จ: ' + resp.error));
        if (!google.accounts.oauth2.hasGrantedAllScopes(resp, DRIVE_SCOPE)) return reject(new Error('ต้องอนุญาตสิทธิ์ Google Drive ก่อน'));
        SYNC.driveToken = resp.access_token;
        SYNC.driveExp = Date.now() + (Number(resp.expires_in) || 3600) * 1000;
        try { sessionStorage.setItem('nt8_gdrive_tok', JSON.stringify({ t: SYNC.driveToken, exp: SYNC.driveExp })); } catch {}
        resolve(SYNC.driveToken);
      },
      error_callback: (e) => reject(new Error(e?.type === 'popup_closed' ? 'ปิดหน้าต่าง Google ก่อนอนุญาต' : 'เชื่อม Google Drive ไม่สำเร็จ (popup ถูกบล็อก?)')),
    });
    tc.requestAccessToken({ prompt: '' });
  });
}

const DriveSync = {
  label: 'Google Drive',
  icon: '🟢',
  interactive: false,
  async _api(url, opts = {}) {
    const t = await driveToken(this.interactive);
    const r = await fetch(url, { ...opts, headers: { ...(opts.headers || {}), Authorization: `Bearer ${t}` } });
    if (r.status === 401) {
      SYNC.driveToken = null; try { sessionStorage.removeItem('nt8_gdrive_tok'); } catch {}
      const e = new Error('การเชื่อม Google Drive หมดอายุ — กด 🔄 Sync เพื่อเชื่อมใหม่'); e.needAuth = true; throw e;
    }
    if (r.status === 403) {
      const j = await r.json().catch(() => ({}));
      throw new Error(/storageQuota/i.test(JSON.stringify(j)) ? 'พื้นที่ Google Drive เต็ม' : 'Google Drive ไม่อนุญาต (403)');
    }
    if (!r.ok && r.status !== 404) throw new Error(`Google Drive HTTP ${r.status}`);
    return r;
  },
  async list() {
    const r = await this._api('https://www.googleapis.com/drive/v3/files?spaces=appDataFolder&pageSize=1000&fields=files(id,name,modifiedTime)&orderBy=modifiedTime');
    const j = await r.json();
    SYNC.driveIds = {};
    const out = {};
    for (const f of j.files || []) {   // เรียงเก่า→ใหม่ ชื่อซ้ำ = ใช้ไฟล์ล่าสุด
      if (!f.name.endsWith('.json')) continue;
      const id = f.name.slice(0, -5);
      SYNC.driveIds[id] = f.id; out[id] = { id, rev: f.modifiedTime };
    }
    return Object.values(out);
  },
  async get(id) {
    if (!SYNC.driveIds[id]) await this.list();
    const r = await this._api(`https://www.googleapis.com/drive/v3/files/${SYNC.driveIds[id]}?alt=media`);
    return r.json();
  },
  async put(id, json) {
    if (!(id in SYNC.driveIds)) await this.list();
    const fid = SYNC.driveIds[id];
    let r;
    if (fid) {
      r = await this._api(`https://www.googleapis.com/upload/drive/v3/files/${fid}?uploadType=media&fields=id,modifiedTime`,
        { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: json });
    }
    if (!fid || r.status === 404) {
      const b = 'nt' + Math.random().toString(36).slice(2);
      const meta = JSON.stringify({ name: `${id}.json`, parents: ['appDataFolder'], mimeType: 'application/json' });
      const body = new Blob([`--${b}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n--${b}\r\nContent-Type: application/json\r\n\r\n`, json, `\r\n--${b}--`]);
      r = await this._api('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,modifiedTime',
        { method: 'POST', headers: { 'Content-Type': `multipart/related; boundary=${b}` }, body });
    }
    const j = await r.json();
    SYNC.driveIds[id] = j.id;
    return j.modifiedTime || null;
  },
  async remove(id) {
    if (!(id in SYNC.driveIds)) await this.list();
    const fid = SYNC.driveIds[id];
    if (fid) await this._api(`https://www.googleapis.com/drive/v3/files/${fid}`, { method: 'DELETE' });
    delete SYNC.driveIds[id];
  },
};

// ── เลือกปลายทาง ──
function syncWantedTarget() {
  if (ACC.session && ACC.account?.premium_active && !localStorage.getItem(LS_CLOUD_OFF)) return 'supabase';
  if (ACC.config?.googleClientId && localStorage.getItem(LS_DRIVE_ON)) return 'gdrive';
  return null;
}

async function syncSetTarget(target) {
  if (target === SYNC.target) return;
  clearTimeout(SYNC.timer);
  SYNC.target = target;
  SYNC.adapter = target === 'supabase' ? SupabaseSync : target === 'gdrive' ? DriveSync : null;
  SYNC.error = ''; SYNC.status = '';
  if (!target) { SYNC.state = null; syncRender(); return; }
  SYNC.state = (await idbGet('meta', 'sync_state_' + target)) || { items: {}, deleted: [] };
  // เรื่องในเครื่องที่ยังไม่เคย sync กับปลายทางนี้ → รออัปโหลด
  for (const w of await lsGetWorkspaceList()) if (!SYNC.state.items[w.id]) SYNC.state.items[w.id] = { rev: '', dirty: true, v: 1 };
  await syncSaveState();
  syncRender();
  syncRun({ pull: true });
}

async function syncSaveState() {
  if (SYNC.target && SYNC.state) await idbPut('meta', SYNC.state, 'sync_state_' + SYNC.target).catch(() => {});
}

function syncOnAccountChange() { syncSetTarget(syncWantedTarget()); }

function syncInit() {
  if (ACC.config?.googleClientId && !ACC.account?.premium_active) loadScriptOnce(GIS_URL).catch(() => {});   // โหลดไว้ก่อน → popup ไม่โดนบล็อก
  syncSetTarget(syncWantedTarget());
  syncRender();
}

// ── เกาะการบันทึก/ลบ workspace ──
const _syncOrigSave = lsSaveWorkspace;
lsSaveWorkspace = async function (ws) {
  await _syncOrigSave(ws);
  if (!SYNC.applying && ws?.id) syncMarkDirty(ws.id);
};
const _syncOrigDelete = lsDeleteWorkspace;
lsDeleteWorkspace = async function (id) {
  await _syncOrigDelete(id);
  if (SYNC.target && SYNC.state) {
    const had = SYNC.state.items[id]?.rev;
    delete SYNC.state.items[id];
    if (had && !SYNC.state.deleted.includes(id)) SYNC.state.deleted.push(id);
    await syncSaveState();
    syncSchedule();
  }
};

function syncMarkDirty(id) {
  if (!SYNC.target || !SYNC.state) return;
  const it = SYNC.state.items[id] || (SYNC.state.items[id] = { rev: '', v: 0 });
  it.dirty = true; it.v = (it.v || 0) + 1;
  syncSaveState();
  syncSchedule();
}

// หน่วง 4 วิหลังแก้ล่าสุด แต่ไม่เกิน 30 วิจากการแก้ครั้งแรก (ตอนแปลยาว ๆ บันทึกถี่มาก — ไม่ให้เลื่อนไปเรื่อย ๆ)
const SYNC_MAX_WAIT_MS = 30000;
function syncSchedule() {
  clearTimeout(SYNC.timer);
  const now = Date.now();
  if (!SYNC.firstDirtyAt) SYNC.firstDirtyAt = now;
  const delay = Math.max(0, Math.min(SYNC_DEBOUNCE_MS, SYNC.firstDirtyAt + SYNC_MAX_WAIT_MS - now));
  SYNC.timer = setTimeout(() => { SYNC.firstDirtyAt = 0; syncRun({}); }, delay);
}

async function syncWsName(id) {
  return (await lsGetWorkspaceList()).find(w => w.id === id)?.name || id;
}

// เขียน workspace ที่ได้จาก remote ลงเครื่อง (ไม่ถือเป็นการแก้ในเครื่อง)
async function syncApply(ws) {
  SYNC.applying = true;
  try { await lsSaveWorkspace(ws); } finally { SYNC.applying = false; }
}

// ── pull: ดึงของใหม่จาก remote ──
async function syncPull() {
  const st = SYNC.state, ad = SYNC.adapter;
  const remote = await ad.list();
  const localIds = new Set((await lsGetWorkspaceList()).map(w => w.id));
  let changedCurrent = false, changed = false;
  for (const r of remote) {
    if (st.deleted.includes(r.id)) continue;
    const it = st.items[r.id];
    if (!localIds.has(r.id)) {                           // มีบน remote แต่ไม่มีในเครื่อง → ดาวน์โหลด
      const ws = await ad.get(r.id);
      if (!ws?.id) continue;
      await syncApply(ws);
      st.items[r.id] = { rev: r.rev, dirty: false, v: 0 };
      changed = true; continue;
    }
    if (it && it.rev === r.rev) continue;                 // remote ไม่เปลี่ยน
    if (r.id === S.currentWsId && S.translating) continue; // กำลังแปลเรื่องนี้ → รอบหน้า
    if (it && !it.dirty) {                                // แก้ที่อื่นอย่างเดียว → ใช้ของ remote
      const ws = await ad.get(r.id);
      if (!ws?.id) continue;
      await syncApply(ws);
      it.rev = r.rev;
      changed = true; if (r.id === S.currentWsId) changedCurrent = true;
      continue;
    }
    // แก้ทั้งสองฝั่ง (หรือเพิ่งเชื่อมครั้งแรกและมีทั้งสองฝั่ง) → ถาม
    const name = await syncWsName(r.id);
    const useRemote = confirm(`"${name}" มีทั้งในเครื่องนี้และใน ${ad.label} และข้อมูลไม่ตรงกัน\n\n` +
      `ตกลง = ใช้ข้อมูลจาก ${ad.label} (ของในเครื่องนี้เก็บเป็นสำเนาแยกไว้)\nยกเลิก = ใช้ข้อมูลในเครื่องนี้ (อัปโหลดทับ)`);
    if (useRemote) {
      const local = await lsGetWorkspace(r.id);
      const ws = await ad.get(r.id);
      if (!ws?.id) continue;
      if (local) {
        const copy = { ...local, id: genId(), name: `${local.name} (สำเนาเครื่องนี้)` };
        await lsSaveWorkspace(copy);   // สำเนาใหม่ → sync ขึ้นไปด้วย
      }
      await syncApply(ws);
      st.items[r.id] = { rev: r.rev, dirty: false, v: 0 };
      changed = true; if (r.id === S.currentWsId) changedCurrent = true;
    } else {
      st.items[r.id] = { ...(it || {}), rev: r.rev, dirty: true, v: (it?.v || 0) + 1 };
    }
  }
  // ในเครื่องมี แต่ remote ไม่มี → อัปโหลด (ไม่ลบในเครื่อง)
  const remoteIds = new Set(remote.map(r => r.id));
  for (const id of localIds) {
    if (!remoteIds.has(id)) { const it = st.items[id] || (st.items[id] = { rev: '', v: 0 }); it.dirty = true; it.rev = ''; }
  }
  SYNC.lastPull = Date.now();
  if (changed) {
    await loadWorkspaceList();
    if (changedCurrent && S.currentWsId) await selectWorkspace(S.currentWsId);
    showToast(`ดึงข้อมูลล่าสุดจาก ${ad.label} แล้ว ✓`, 'success');
  }
}

// ── push: อัปโหลดเรื่องที่แก้ + ลบที่สั่งลบ ──
async function syncPush() {
  const st = SYNC.state, ad = SYNC.adapter;
  for (const id of [...st.deleted]) {
    await ad.remove(id);
    st.deleted = st.deleted.filter(x => x !== id);
  }
  let needRevs = false, pushed = 0;
  for (const [id, it] of Object.entries(st.items)) {
    if (!it.dirty) continue;
    const ws = await lsGetWorkspace(id);
    if (!ws) { delete st.items[id]; continue; }
    const v0 = it.v;
    SYNC.status = `กำลังอัปโหลด "${ws.name}"...`; syncRender();
    const rev = await ad.put(id, JSON.stringify(ws));
    const cur = st.items[id] || it;
    cur.dirty = cur.v !== v0;          // ระหว่างอัปโหลดมีการแก้เพิ่ม → ยังค้าง
    if (rev) cur.rev = rev; else needRevs = true;
    pushed++;
    await syncSaveState();
  }
  if (needRevs) {   // Supabase: อ่านเวลาแก้จาก list เพื่อใช้เทียบรอบหน้า
    for (const r of await ad.list()) if (st.items[r.id] && !st.items[r.id].dirty) st.items[r.id].rev = r.rev;
  }
  return pushed;
}

async function syncRun({ pull = false, interactive = false } = {}) {
  if (!SYNC.target || !SYNC.adapter) return;
  if (SYNC.busy) { SYNC.again = true; SYNC.againPull ||= pull; return; }
  if (!navigator.onLine) { SYNC.error = 'ออฟไลน์ — จะ sync เมื่อกลับมาออนไลน์'; syncRender(); return; }
  SYNC.busy = true; SYNC.error = ''; SYNC.status = 'กำลัง sync...'; syncRender();
  const target = SYNC.target;
  DriveSync.interactive = interactive;
  try {
    if (pull) await syncPull();
    await syncPush();
    if (target !== SYNC.target) return;
    await syncSaveState();
    SYNC.lastOk = Date.now(); SYNC.status = '';
    if (typeof _markBackupDone === 'function') _markBackupDone();   // sync สำเร็จ = มีสำรองแล้ว
  } catch (e) {
    SYNC.error = e?.message || String(e);
    SYNC.status = '';
    console.warn('sync failed', e);
  } finally {
    DriveSync.interactive = false;
    SYNC.busy = false;
    syncRender();
    if (SYNC.again) { const p = SYNC.againPull; SYNC.again = false; SYNC.againPull = false; syncRun({ pull: p }); }
  }
}

// กลับมาที่แท็บ / กลับมาออนไลน์ → ดึงของใหม่ (เว้นอย่างน้อย 2 นาที)
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && SYNC.target && Date.now() - SYNC.lastPull > 120e3) syncRun({ pull: true });
});
window.addEventListener('online', () => { if (SYNC.target) syncRun({ pull: true }); });

// ── ปุ่มใน sidebar ──
async function syncNow() {
  await syncRun({ pull: true, interactive: true });
  if (!SYNC.error) showToast('Sync เสร็จ ✓', 'success');
  else showToast(SYNC.error, 'error');
}

async function connectDrive() {
  if (!ACC.config?.googleClientId) return;
  try {
    await driveToken(true);    // เปิด popup ขอสิทธิ์ (ต้องเรียกจากการกดปุ่ม)
  } catch (e) { showToast(e.message, 'error'); return; }
  localStorage.setItem(LS_DRIVE_ON, '1');
  await syncSetTarget(syncWantedTarget());
  showToast('เชื่อม Google Drive แล้ว ✓ นิยายจะ sync อัตโนมัติ', 'success');
}

async function disconnectDrive() {
  if (!confirm('ยกเลิกการเชื่อม Google Drive? (ข้อมูลในเครื่องและใน Drive ยังอยู่ครบ)')) return;
  localStorage.removeItem(LS_DRIVE_ON);
  try {
    if (SYNC.driveToken && window.google?.accounts?.oauth2) google.accounts.oauth2.revoke(SYNC.driveToken, () => {});
    sessionStorage.removeItem('nt8_gdrive_tok');
  } catch {}
  SYNC.driveToken = null;
  await syncSetTarget(syncWantedTarget());
}

async function toggleCloudSync(on) {
  if (on) localStorage.removeItem(LS_CLOUD_OFF);
  else {
    if (!confirm('ปิด sync คลาวด์บนเครื่องนี้? (ข้อมูลบนคลาวด์ยังอยู่)')) return;
    localStorage.setItem(LS_CLOUD_OFF, '1');
  }
  await syncSetTarget(syncWantedTarget());
}

function syncRender() {
  const sec = document.getElementById('syncSection');
  const box = document.getElementById('syncBox');
  if (!sec || !box) return;
  const premium = !!(ACC.session && ACC.account?.premium_active);
  const canDrive = !!ACC.config?.googleClientId;
  const ad = SYNC.adapter;
  let html = '';
  if (ad) {
    const pending = SYNC.state ? Object.values(SYNC.state.items).filter(i => i.dirty).length + SYNC.state.deleted.length : 0;
    const line = SYNC.status ? `⏳ ${esc(SYNC.status)}`
      : SYNC.error ? `<span style="color:var(--crimson-light)">⚠ ${esc(SYNC.error)}</span>`
      : pending ? `รออัปโหลด ${pending} เรื่อง`
      : SYNC.lastOk ? `✓ ล่าสุด ${new Date(SYNC.lastOk).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })}` : 'พร้อม';
    html = `<div class="acc-email">${ad.icon} Sync: ${ad.label}</div>
      <div class="acc-muted">${line}</div>
      <div class="acc-row">
        <button class="btn-xs" onclick="syncNow()" ${SYNC.busy ? 'disabled' : ''}>🔄 Sync ตอนนี้</button>
        ${SYNC.target === 'gdrive' ? '<button class="btn-xs" onclick="disconnectDrive()">ยกเลิกเชื่อม</button>'
          : '<button class="btn-xs" onclick="toggleCloudSync(false)">ปิด</button>'}
      </div>`;
  } else if (premium) {
    html = `<button class="sb-action-btn" onclick="toggleCloudSync(true)">☁ เปิด Sync คลาวด์ (Premium)</button>`;
  } else if (canDrive) {
    html = `<button class="sb-action-btn" onclick="connectDrive()">🔗 เชื่อม Google Drive — เก็บนิยายข้ามเครื่อง</button>
      ${ACC.config?.accounts ? '<div class="acc-muted">⭐ Premium: sync คลาวด์อัตโนมัติ ไม่ต้องเชื่อม Drive</div>' : ''}`;
  }
  sec.style.display = html ? '' : 'none';
  box.innerHTML = html;
}
