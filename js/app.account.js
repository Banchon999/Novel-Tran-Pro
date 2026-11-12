// ═══════════════════════════════════════════════
// ─── บัญชีผู้ใช้ · Premium (Supabase Auth) ───
// ═══════════════════════════════════════════════
// - บัญชีไม่บังคับ: เปิดผ่านไฟล์ zip / ไม่มี /api/config → ฟีเจอร์บัญชีซ่อนทั้งหมด แอปทำงานแบบเดิม
// - Premium = provider 'premium' → ส่งไป /api/ai (เซิร์ฟเวอร์ใช้ OpenRouter key ของระบบ + ตัดโควต้า)
// - สิทธิ์ทั้งหมดตัดสินในฐานข้อมูล — ฝั่งนี้แค่แสดงผล

const ACC = { config: null, sb: null, session: null, account: null, ready: false, _quotaTimer: null };
const SUPABASE_JS_URL = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/dist/umd/supabase.js';

function loadScriptOnce(src) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)?.dataset.loaded) return resolve();
    const s = document.createElement('script');
    s.src = src; s.async = true;
    s.onload = () => { s.dataset.loaded = '1'; resolve(); };
    s.onerror = () => reject(new Error('โหลดสคริปต์ไม่สำเร็จ: ' + src));
    document.head.appendChild(s);
  });
}

// ── provider Premium (ลงทะเบียนตั้งแต่โหลดไฟล์ เพื่อให้ workspace ที่เลือก premium ไว้ไม่หลุดกลับ openrouter) ──
PROVIDERS.premium = {
  label: '⭐ NovelTrans Premium',
  lsKey: null,                 // ไม่มี key ให้ผู้ใช้ใส่ — ใช้ session
  keyPlaceholder: '', keyHint: '',
  sse: 'openai',
  serverMessages: true,        // error จากเซิร์ฟเวอร์เป็นข้อความไทยพร้อมใช้
  publicModels: true,          // ดึงรายการโมเดลได้โดยไม่ต้องมี key
  available: () => !!ACC.config?.premiumAI,
  getKey: () => (ACC.session && ACC.account?.premium_active) ? ACC.session.access_token : '',
  async resolveKey() {
    if (!ACC.sb) return '';
    try { const { data } = await ACC.sb.auth.getSession(); ACC.session = data.session || null; } catch {}
    return PROVIDERS.premium.getKey();
  },
  missingKeyMessage: () => !ACC.config?.premiumAI ? 'ระบบ Premium ยังไม่เปิดบนเว็บนี้'
    : !ACC.session ? 'เข้าสู่ระบบก่อนใช้ Premium — เมนู ☰ → 👤 บัญชี'
    : 'บัญชีนี้ยังไม่ใช่ Premium (หรือหมดอายุ) — กด ⭐ ขอ Premium ที่เมนู ☰',
  defaultModel: () => ACC.defaultModel || PROVIDERS.premium.models[0][1][0][0],
  models: [[null, [['google/gemini-3.1-flash-lite', 'Gemini 3.1 Flash Lite 💰 แนะนำ']]]],
  buildRequest({ model, messages, temperature, max_tokens, stream, key }) {
    return {
      url: 'api/ai',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: { model, messages, temperature, max_tokens, stream },
    };
  },
  testEndpoint: () => ({ url: 'api/models', headers: {} }),
  extractText: d => d.choices?.[0]?.message?.content ?? '',
  extractUsage: d => ({ inTok: d.usage?.prompt_tokens || 0, outTok: d.usage?.completion_tokens || 0 }),
  afterCall: () => accScheduleQuotaRefresh(),
};

// ข้อความเมื่อยังไม่มี key ของ provider ปัจจุบัน (ใช้ทุกจุดที่เช็ค getApiKey())
function noKeyMsg() {
  const prov = PROVIDERS[getProvider()];
  return prov?.missingKeyMessage ? prov.missingKeyMessage() : 'ยังไม่ได้ตั้ง API Key — ไปที่ ⚙ ตั้งค่า';
}

// ── เริ่มระบบ ──
async function accInit() {
  if (!location.protocol.startsWith('http')) return;
  try {
    const r = await fetch('api/config', { cache: 'no-store' });
    if (!r.ok || !/json/.test(r.headers.get('content-type') || '')) return;   // static host ทั่วไป / zip → ไม่มีระบบบัญชี
    ACC.config = await r.json();
  } catch { return; }
  if (!ACC.config?.accounts) { syncInit(); return; }   // ไม่มีระบบบัญชี แต่อาจมี Google Drive

  document.getElementById('accSection').style.display = '';
  accHandleAuthRedirectError();
  accRender();
  try {
    await loadScriptOnce(SUPABASE_JS_URL);
  } catch (e) {
    document.getElementById('accBox').innerHTML = '<div class="acc-muted">โหลดระบบบัญชีไม่สำเร็จ (ออฟไลน์?) — ใช้งานแบบใส่ API Key เองได้ตามปกติ</div>';
    syncInit();
    return;
  }
  ACC.sb = window.supabase.createClient(ACC.config.supabaseUrl, ACC.config.supabaseAnonKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, storageKey: 'nt8_auth' },
  });
  ACC.sb.auth.onAuthStateChange((evt, session) => {
    ACC.session = session || null;
    if (evt === 'PASSWORD_RECOVERY') setTimeout(accPromptNewPassword, 300);
    if (evt === 'SIGNED_OUT') { ACC.account = null; accAfterChange(); return; }
    if (evt === 'INITIAL_SESSION' || evt === 'SIGNED_IN' || evt === 'USER_UPDATED') {
      // ห้าม await ใน callback นี้ (supabase-js จะค้าง) → ทำต่อนอก callback
      setTimeout(() => accRefresh().then(() => { if (evt === 'SIGNED_IN') closeModal('modal-account'); }), 0);
    }
  });
  loadPremiumModels();
  ACC.ready = true;
  syncInit();
}

// กลับมาจากลิงก์ในอีเมล/ล็อกอิน Google ที่ล้มเหลว (#error=...&error_code=otp_expired) → บอกผู้ใช้เป็นภาษาไทย + ล้าง URL
function accHandleAuthRedirectError() {
  const h = new URLSearchParams(location.hash.slice(1));
  const code = h.get('error_code') || h.get('error');
  if (!code) return;
  const msg = code === 'otp_expired'
    ? 'ลิงก์ในอีเมลหมดอายุหรือถูกใช้ไปแล้ว — ลองเข้าสู่ระบบ หรือกด "ลืมรหัสผ่าน" เพื่อขอลิงก์ใหม่'
    : 'ยืนยันตัวตนไม่สำเร็จ: ' + (h.get('error_description') || code);
  history.replaceState(null, '', location.pathname + location.search);
  setTimeout(() => showToast(msg, 'error'), 400);
}

async function loadPremiumModels() {
  try {
    const r = await fetch('api/models');
    if (!r.ok) return;
    const j = await r.json();
    if (Array.isArray(j.data) && j.data.length) {
      PROVIDERS.premium.models = [[null, j.data.map(m => [m.id, m.name || m.id])]];
      ACC.defaultModel = j.default_model || j.data[0].id;
      if (getProvider() === 'premium') renderProviderUI();
    }
  } catch {}
}

async function accRefresh() {
  if (!ACC.sb || !ACC.session) { ACC.account = null; accAfterChange(); return; }
  const { data, error } = await ACC.sb.rpc('my_account');
  if (!error) ACC.account = data;
  accAfterChange();
}

function accAfterChange() {
  accRender();
  if (typeof renderProviderUI === 'function') renderProviderUI();
  if (typeof checkHealth === 'function') checkHealth();
  if (typeof syncOnAccountChange === 'function') syncOnAccountChange();
}

// ยอดโควต้าเปลี่ยนหลังเรียก Premium → อัปเดตแบบหน่วง (ไม่ยิงทุก chunk)
function accScheduleQuotaRefresh() {
  clearTimeout(ACC._quotaTimer);
  ACC._quotaTimer = setTimeout(() => accRefresh().catch(() => {}), 4000);
}

// ── UI ใน sidebar ──
function accFmtDate(ts) { return ts ? new Date(ts).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: 'numeric' }) : ''; }

function accRender() {
  const box = document.getElementById('accBox');
  if (!box) return;
  if (!ACC.session) {
    box.innerHTML = `<button class="sb-action-btn acc-login-btn" onclick="openAccountModal()">👤 เข้าสู่ระบบ / สมัครฟรี</button>
      <div class="acc-muted">${ACC.config?.premiumAI ? '⭐ Premium: แปลได้ทันทีไม่ต้องมี API Key + เก็บนิยายบนคลาวด์' : ''}</div>`;
    return;
  }
  const a = ACC.account || {};
  const email = esc(a.email || ACC.session.user?.email || '');
  let plan;
  if (a.premium_active) {
    const used = Number(a.used_usd) || 0, quota = Number(a.quota_usd) || 0;
    const pct = quota > 0 ? Math.min(100, used / quota * 100) : 100;
    plan = `<span class="acc-badge acc-premium">⭐ PREMIUM</span>
      <div class="acc-muted">${a.premium_until ? 'ถึง ' + accFmtDate(a.premium_until) : 'ไม่มีวันหมดอายุ'}</div>
      <div class="acc-quota" title="โควต้า AI เดือนนี้"><div class="acc-quota-bar" style="width:${pct.toFixed(1)}%"></div></div>
      <div class="acc-muted">โควต้าเดือนนี้ ${fmtUSD(used)} / ${fmtUSD(quota)}</div>`;
  } else {
    const expired = a.plan === 'premium' && !a.premium_active;
    plan = `<span class="acc-badge">FREE</span>${expired ? ' <span class="acc-muted">Premium หมดอายุแล้ว</span>' : ''}
      ${a.pending_request
        ? '<div class="acc-muted">⏳ ส่งคำขอ Premium แล้ว — รอแอดมินอนุมัติ</div>'
        : '<button class="sb-action-btn acc-req-btn" onclick="openPremiumRequest()">⭐ ขอ Premium</button>'}`;
  }
  box.innerHTML = `
    <div class="acc-email" title="${email}">👤 ${email}</div>
    ${plan}
    <div class="acc-row">
      ${a.is_admin ? '<a class="btn-xs" href="admin.html" target="_blank" rel="noopener">🛠 แอดมิน</a>' : ''}
      <button class="btn-xs" onclick="accRefresh()">↻</button>
      <button class="btn-xs" onclick="accSignOut()">ออกจากระบบ</button>
    </div>`;
}

// ── Modal เข้าสู่ระบบ / สมัคร ──
function openAccountModal() {
  if (!ACC.sb) { showToast('ระบบบัญชียังโหลดไม่เสร็จ — ลองใหม่อีกครั้ง', 'error'); return; }
  document.getElementById('accGoogleBtn').style.display = ACC.config?.googleClientId ? '' : 'none';
  document.getElementById('accMsg').textContent = '';
  closeSidebar();
  openModal('modal-account');
  setTimeout(() => document.getElementById('accEmail')?.focus(), 50);
}

function accMsg(text, isErr) {
  const el = document.getElementById('accMsg');
  el.textContent = text;
  el.style.color = isErr ? 'var(--crimson-light)' : 'var(--text-muted)';
}

function accTranslateAuthError(e) {
  const m = String(e?.message || e || '');
  if (/Invalid login credentials/i.test(m)) return 'อีเมลหรือรหัสผ่านไม่ถูกต้อง';
  if (/Email not confirmed/i.test(m)) return 'ยังไม่ได้ยืนยันอีเมล — เปิดลิงก์ในอีเมลที่ได้รับก่อน';
  if (/already registered|already been registered/i.test(m)) return 'อีเมลนี้สมัครไว้แล้ว — กดเข้าสู่ระบบ';
  if (/Password should be at least/i.test(m)) return 'รหัสผ่านต้องยาวอย่างน้อย 6 ตัวอักษร';
  if (/rate limit|too many/i.test(m)) return 'ส่งคำขอถี่เกินไป — รอสักครู่แล้วลองใหม่';
  if (/valid email|invalid email/i.test(m)) return 'รูปแบบอีเมลไม่ถูกต้อง';
  return m || 'เกิดข้อผิดพลาด';
}

function accCreds() {
  const email = document.getElementById('accEmail').value.trim();
  const password = document.getElementById('accPassword').value;
  if (!email) { accMsg('กรอกอีเมล', true); return null; }
  return { email, password };
}

async function accSignIn() {
  const c = accCreds(); if (!c) return;
  if (!c.password) { accMsg('กรอกรหัสผ่าน', true); return; }
  accMsg('กำลังเข้าสู่ระบบ...');
  const { error } = await ACC.sb.auth.signInWithPassword(c);
  if (error) accMsg(accTranslateAuthError(error), true);
  else { accMsg(''); showToast('เข้าสู่ระบบแล้ว ✓', 'success'); }
}

async function accSignUp() {
  const c = accCreds(); if (!c) return;
  if ((c.password || '').length < 6) { accMsg('ตั้งรหัสผ่านอย่างน้อย 6 ตัวอักษร', true); return; }
  accMsg('กำลังสมัคร...');
  const { data, error } = await ACC.sb.auth.signUp({ ...c, options: { emailRedirectTo: location.origin + location.pathname } });
  if (error) { accMsg(accTranslateAuthError(error), true); return; }
  if (data.session) { showToast('สมัครและเข้าสู่ระบบแล้ว ✓', 'success'); return; }
  accMsg('✉ ส่งลิงก์ยืนยันไปที่อีเมลแล้ว — เปิดลิงก์แล้วกลับมาเข้าสู่ระบบ (ดูในจดหมายขยะด้วย)');
}

async function accGoogle() {
  const { error } = await ACC.sb.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: location.origin + location.pathname } });
  if (error) accMsg(accTranslateAuthError(error), true);
}

async function accForgot() {
  const email = document.getElementById('accEmail').value.trim();
  if (!email) { accMsg('กรอกอีเมลก่อน แล้วกด "ลืมรหัสผ่าน" อีกครั้ง', true); return; }
  const { error } = await ACC.sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname });
  if (error) accMsg(accTranslateAuthError(error), true);
  else accMsg('✉ ส่งลิงก์ตั้งรหัสผ่านใหม่ไปที่อีเมลแล้ว');
}

async function accPromptNewPassword() {
  const pw = prompt('ตั้งรหัสผ่านใหม่ (อย่างน้อย 6 ตัวอักษร)');
  if (!pw) return;
  const { error } = await ACC.sb.auth.updateUser({ password: pw });
  showToast(error ? accTranslateAuthError(error) : 'เปลี่ยนรหัสผ่านแล้ว ✓', error ? 'error' : 'success');
}

async function accSignOut() {
  if (!confirm('ออกจากระบบ? (ข้อมูลนิยายในเครื่องยังอยู่ครบ)')) return;
  await ACC.sb.auth.signOut().catch(() => {});
  ACC.session = null; ACC.account = null;
  accAfterChange();
  showToast('ออกจากระบบแล้ว', '');
}

// ── ขอ Premium ──
function openPremiumRequest() {
  closeSidebar();
  document.getElementById('premReqContact').value = '';
  document.getElementById('premReqNote').value = '';
  openModal('modal-premium-request');
}

async function submitPremiumRequest() {
  const contact = document.getElementById('premReqContact').value.trim();
  const note = document.getElementById('premReqNote').value.trim();
  if (!contact) { showToast('กรอกช่องทางติดต่อ (LINE / Facebook / อีเมล) เพื่อให้แอดมินติดต่อกลับ', 'error'); return; }
  const { data, error } = await ACC.sb.rpc('request_premium', { p_contact: contact, p_note: note });
  if (error) { showToast('ส่งคำขอไม่สำเร็จ: ' + error.message, 'error'); return; }
  if (!data?.ok) { showToast(data?.message || 'ส่งคำขอไม่สำเร็จ', 'error'); return; }
  closeModal('modal-premium-request');
  showToast('ส่งคำขอ Premium แล้ว ✓ แอดมินจะติดต่อกลับ', 'success');
  accRefresh();
}

document.addEventListener('DOMContentLoaded', () => { accInit(); });
