// e2e: บัญชี · Premium · sync (mock Supabase / /api/* / Google ทั้งหมด — ไม่เรียกของจริง)
// ใช้: bash tests/e2e/run.sh  (รันต่อจาก e2e.js อัตโนมัติ)
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const fs = require('fs'), path = require('path'), { execSync } = require('child_process');

const BASE = 'http://localhost:' + (process.env.PORT || 8099);
const SB = 'https://sb.test';
const SUPA_JS = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/dist/umd/supabase.js';
const VENDOR = path.join(__dirname, 'vendor', 'supabase.js');
if (!fs.existsSync(VENDOR)) {
  fs.mkdirSync(path.dirname(VENDOR), { recursive: true });
  execSync(`curl -sSfL ${SUPA_JS} -o ${VENDOR}`);
}

const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url');
const UID = '11111111-2222-3333-4444-555555555555';
const jwt = (exp = Math.floor(Date.now() / 1000) + 3600) => `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: UID, role: 'authenticated', email: 'reader@test.local', exp })}.sig`;
const user = { id: UID, email: 'reader@test.local', aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: {} };
const session = () => ({ access_token: jwt(), refresh_token: 'rt', token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, user });

const GIS_STUB = `window.google = { accounts: { oauth2: {
  initTokenClient: (cfg) => ({ requestAccessToken: () => { window.__gisAsked = (window.__gisAsked||0)+1; setTimeout(() => cfg.callback({ access_token: 'gtok', expires_in: 3600, scope: '${'https://www.googleapis.com/auth/drive.appdata'}' }), 10); } }),
  hasGrantedAllScopes: () => true, revoke: (t, cb) => cb && cb() } } };`;

async function setup(browser, { premium, googleClientId = '' }) {
  const ctx = await browser.newContext({ serviceWorkers: 'block' });
  const page = await ctx.newPage();
  const log = { ai: [], rpc: [], uploads: [], removes: [], drive: [], errors: [] };
  const remote = {};           // id → { text, updated_at }
  const driveFiles = {};       // fileId → { name, text, modifiedTime }
  let tick = 0; const stamp = () => new Date(Date.UTC(2026, 10, 12, 0, 0, ++tick)).toISOString();
  const account = { email: user.email, plan: premium ? 'premium' : 'free', premium_until: null, premium_active: !!premium, quota_usd: 2, used_usd: 0.25, is_admin: false, pending_request: false };
  page.on('pageerror', e => log.errors.push(e.message));

  await page.route('**/api/config', r => r.fulfill({ json: { accounts: true, supabaseUrl: SB, supabaseAnonKey: 'sb_publishable_test', googleClientId, premiumAI: true } }));
  await page.route('**/api/models', r => r.fulfill({ json: { data: [{ id: 'google/gemini-3.1-flash-lite', name: 'Flash Lite' }, { id: 'deepseek/deepseek-v3.2', name: 'DS' }], default_model: 'google/gemini-3.1-flash-lite' } }));
  await page.route('**/api/ai', async r => {
    const body = JSON.parse(r.request().postData() || '{}');
    log.ai.push({ auth: r.request().headers()['authorization'], body });
    if (!account.premium_active) return r.fulfill({ status: 403, json: { error: { message: 'บัญชีนี้ยังไม่ใช่ Premium' } } });
    if (!body.stream) return r.fulfill({ json: { choices: [{ message: { content: 'คำแปลพรีเมียม' }, finish_reason: 'stop' }], usage: { prompt_tokens: 5, completion_tokens: 5 } } });
    const sse = `data: ${JSON.stringify({ choices: [{ delta: { content: 'คำแปลพรีเมียม' } }] })}\n\ndata: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 5, completion_tokens: 5, cost: 0.0001 } })}\n\ndata: [DONE]\n\n`;
    return r.fulfill({ status: 200, headers: { 'content-type': 'text/event-stream' }, body: sse });
  });
  await page.route(SUPA_JS, r => r.fulfill({ path: VENDOR, headers: { 'content-type': 'application/javascript' } }));
  await page.route('https://accounts.google.com/gsi/client', r => r.fulfill({ body: GIS_STUB, headers: { 'content-type': 'application/javascript' } }));
  await page.route('https://www.googleapis.com/**', async r => {
    const req = r.request(), u = new URL(req.url()), m = req.method();
    log.drive.push(`${m} ${u.pathname}${u.search}`);
    if (req.headers()['authorization'] !== 'Bearer gtok') return r.fulfill({ status: 401, json: {} });
    if (m === 'GET' && u.pathname === '/drive/v3/files')
      return r.fulfill({ json: { files: Object.entries(driveFiles).map(([id, f]) => ({ id, name: f.name, modifiedTime: f.modifiedTime })) } });
    if (m === 'POST' && u.pathname === '/upload/drive/v3/files') {
      const raw = req.postData() || '';
      const name = /"name":"([^"]+)"/.exec(raw)?.[1];
      const parts = raw.split(/\r\n--nt[a-z0-9]+/);
      const id = 'f' + (Object.keys(driveFiles).length + 1);
      driveFiles[id] = { name, text: parts[1]?.split('\r\n\r\n')[1] || '', modifiedTime: stamp(), parent: raw.includes('appDataFolder') };
      return r.fulfill({ json: { id, modifiedTime: driveFiles[id].modifiedTime } });
    }
    const fm = /^\/(?:upload\/)?drive\/v3\/files\/([^/]+)$/.exec(u.pathname);
    if (fm && m === 'PATCH') { const f = driveFiles[fm[1]]; f.text = req.postData(); f.modifiedTime = stamp(); return r.fulfill({ json: { id: fm[1], modifiedTime: f.modifiedTime } }); }
    if (fm && m === 'GET') return r.fulfill({ body: driveFiles[fm[1]].text, headers: { 'content-type': 'application/json' } });
    if (fm && m === 'DELETE') { delete driveFiles[fm[1]]; return r.fulfill({ status: 204, body: '' }); }
    return r.fulfill({ status: 404, json: {} });
  });
  await page.route(SB + '/**', async r => {
    const req = r.request(), u = new URL(req.url()), m = req.method(), p = u.pathname;
    if (p === '/auth/v1/token') return r.fulfill({ json: session() });
    if (p === '/auth/v1/logout') return r.fulfill({ status: 204, body: '' });
    if (p === '/auth/v1/user') return r.fulfill({ json: user });
    if (p.startsWith('/rest/v1/rpc/')) {
      const fn = p.split('/').pop();
      log.rpc.push(fn);
      if (fn === 'my_account') return r.fulfill({ json: account });
      if (fn === 'request_premium') { account.pending_request = true; return r.fulfill({ json: { ok: true } }); }
      return r.fulfill({ json: null });
    }
    if (p === '/storage/v1/object/list/workspaces') {
      if (!account.premium_active) return r.fulfill({ json: [] });
      return r.fulfill({ json: Object.entries(remote).map(([id, o]) => ({ name: id + '.json', updated_at: o.updated_at })) });
    }
    const om = /^\/storage\/v1\/object\/workspaces\/[^/]+\/([^/]+)\.json$/.exec(p);
    if (om && m === 'POST') {
      if (!account.premium_active) return r.fulfill({ status: 403, json: { message: 'new row violates row-level security policy' } });
      const raw = req.postDataBuffer().toString('utf8');
      const text = raw.slice(raw.indexOf('{"'), raw.lastIndexOf('}') + 1);
      remote[om[1]] = { text, updated_at: stamp() };
      log.uploads.push(om[1]);
      return r.fulfill({ json: { Key: 'workspaces/' + om[1] } });
    }
    if (om && m === 'GET') return r.fulfill({ body: remote[om[1]].text, headers: { 'content-type': 'application/json' } });
    if (p === '/storage/v1/object/workspaces' && m === 'DELETE') {
      const { prefixes } = JSON.parse(req.postData() || '{}');
      for (const x of prefixes || []) { const id = x.split('/').pop().replace(/\.json$/, ''); delete remote[id]; log.removes.push(id); }
      return r.fulfill({ json: [] });
    }
    return r.fulfill({ status: 404, json: { message: 'not mocked ' + p } });
  });
  await page.goto(BASE + '/index.html');
  await page.waitForTimeout(700);
  return { ctx, page, log, remote, driveFiles, account };
}

(async () => {
  const browser = await chromium.launch();
  let fail = 0; const ok = (n, c, extra) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (c || extra === undefined ? '' : ' → ' + JSON.stringify(extra))); if (!c) fail++; };
  const waitFor = async (page, fn, ms = 8000) => { try { await page.waitForFunction(fn, null, { timeout: ms }); return true; } catch { return false; } };

  // ═══ 1) Premium: ยังไม่ล็อกอิน → ล็อกอิน → แปลผ่าน /api/ai → sync คลาวด์ ═══
  {
    const { ctx, page, log, remote, account } = await setup(browser, { premium: true });
    const ev = (f, a) => page.evaluate(f, a);

    const pre = await ev(async () => {
      const w = { id: 'wsA', name: 'เรื่องเอ', glossary: [], customStyles: [], presets: [], createdAt: Date.now(),
        chapters: [{ id: 'c1', title: '1', chapterNum: 1, sourceText: '레온은 창문 너머로 비가 내리는 정원을 내려다보았다.', translation: '', status: 'pending' }],
        settings: { sourceLang: 'ko', autoGlossary: false, speakerMap: false } };
      await lsSaveWorkspace(w); await selectWorkspace(w.id);
      await onProviderChange('premium');
      let err = '';
      try { await aiCall({ model: S.currentWs.settings.translateModel, messages: [{ role: 'user', content: 'x' }] }); } catch (e) { err = e.message; }
      return {
        accVisible: getComputedStyle(document.getElementById('accSection')).display !== 'none',
        loginBtn: !!document.querySelector('#accBox .acc-login-btn'),
        hasPremiumOpt: [...document.getElementById('translateProvider').options].some(o => o.value === 'premium'),
        firstOpt: document.getElementById('translateProvider').options[0].value,
        model: S.currentWs.settings.translateModel,
        status: document.getElementById('statusText').textContent, err,
        apiSettingsHasPremium: (openApiSettings(), !!document.getElementById('apiKey-premium')),
      };
    });
    await ev(() => closeModal('modal-settings'));
    ok('ไม่ล็อกอิน: แสดงส่วนบัญชี + ปุ่มเข้าสู่ระบบ', pre.accVisible && pre.loginBtn, pre);
    ok('มี provider Premium และขึ้นเป็นตัวแรก', pre.hasPremiumOpt && pre.firstOpt === 'premium', pre);
    ok('โมเดลเริ่มต้นจาก /api/models', pre.model === 'google/gemini-3.1-flash-lite', pre.model);
    ok('ยังไม่ล็อกอิน → บอกให้เข้าสู่ระบบ (ไม่ยิง /api/ai)', /เข้าสู่ระบบ/.test(pre.err) && /เข้าสู่ระบบ/.test(pre.status) && log.ai.length === 0, pre);
    ok('หน้าตั้งค่า API Key ไม่มีช่อง Premium', !pre.apiSettingsHasPremium);

    // ล็อกอินผ่าน UI
    await ev(() => openAccountModal());
    await page.fill('#accEmail', 'reader@test.local');
    await page.fill('#accPassword', 'secret123');
    await page.click('#modal-account .btn-primary');
    const loggedIn = await waitFor(page, () => document.querySelector('#accBox .acc-premium'));
    const after = await ev(() => ({
      modalOpen: document.getElementById('modal-account').classList.contains('open'),
      quota: document.querySelector('#accBox')?.textContent || '',
      status: document.getElementById('statusText').textContent,
    }));
    ok('ล็อกอินแล้วแสดง ⭐ PREMIUM + โควต้า', loggedIn && /\$0\.25/.test(after.quota) && /\$2\.00/.test(after.quota), after);
    ok('ล็อกอินแล้วปิด modal + สถานะพร้อมใช้', !after.modalOpen && /พร้อมใช้/.test(after.status), after);

    // แปลด้วย Premium
    const tr = await ev(async () => { await translateChapterCore(S.currentWs.chapters[0], { awaitGlossary: true }); return S.currentWs.chapters[0].translation; });
    const aiStream = log.ai.find(x => x.body.stream);
    ok('แปลผ่าน /api/ai ได้ผลลัพธ์', /คำแปลพรีเมียม/.test(tr || ''), tr);
    ok('ส่ง access token ของบัญชี ไม่ใช่ API key', aiStream && /^Bearer ey/.test(aiStream.auth), aiStream?.auth);
    ok('ใช้โมเดล Premium', aiStream?.body.model === 'google/gemini-3.1-flash-lite');

    // sync คลาวด์: เรื่องในเครื่องถูกอัปโหลด
    const up1 = await waitFor(page, () => SYNC.target === 'supabase' && !SYNC.busy && SYNC.lastOk > 0);
    ok('Premium → เปิด sync คลาวด์อัตโนมัติ + อัปโหลดเรื่องในเครื่อง', up1 && log.uploads.includes('wsA') && !!remote.wsA, log.uploads);
    ok('sync สำเร็จ = นับเป็น backup', await ev(() => Date.now() - _getLastBackupTs() < 60000));

    // แก้ในเครื่อง → อัปโหลดเองหลังหน่วง
    const n0 = log.uploads.length;
    await ev(async () => { S.currentWs.description = 'แก้แล้ว'; await lsSaveWorkspace(S.currentWs); });
    const t0 = Date.now();
    while (Date.now() - t0 < 12000 && !(log.uploads.length > n0 && JSON.parse(remote.wsA.text).description === 'แก้แล้ว' && !(await ev(() => SYNC.busy || Object.values(SYNC.state.items).some(i => i.dirty))))) await page.waitForTimeout(250);
    ok('แก้ workspace → อัปโหลดอัตโนมัติ (หน่วงสั้น ๆ)', log.uploads.length > n0 && JSON.parse(remote.wsA.text).description === 'แก้แล้ว', log.uploads);

    // เครื่องอื่นแก้ → ดึงลงมา
    const w = JSON.parse(remote.wsA.text); w.name = 'เรื่องเอ (แก้จากมือถือ)';
    remote.wsA = { text: JSON.stringify(w), updated_at: '2026-11-12T09:00:00.000Z' };
    const other = JSON.parse(remote.wsA.text); other.id = 'wsB'; other.name = 'เรื่องบีจากเครื่องอื่น';
    remote.wsB = { text: JSON.stringify(other), updated_at: '2026-11-12T09:00:01.000Z' };
    const pulled = await ev(async () => { await syncRun({ pull: true }); const l = await lsGetWorkspaceList(); return { a: l.find(x => x.id === 'wsA')?.name, b: l.find(x => x.id === 'wsB')?.name, cur: S.currentWs.name, err: SYNC.error }; });
    ok('ดึงเรื่องที่แก้จากเครื่องอื่น + อัปเดตหน้าที่เปิดอยู่', pulled.a === 'เรื่องเอ (แก้จากมือถือ)' && pulled.cur === pulled.a, pulled);
    ok('ดึงเรื่องใหม่จากคลาวด์ลงเครื่อง', pulled.b === 'เรื่องบีจากเครื่องอื่น', pulled);
    ok('ของที่ดึงลงมาไม่ถูกอัปโหลดซ้ำ', !(await ev(() => Object.values(SYNC.state.items).some(i => i.dirty))));

    // แก้ทั้งสองฝั่ง → ถาม → เลือกใช้คลาวด์ → เก็บสำเนาในเครื่อง
    await ev(async () => { clearTimeout(SYNC.timer); S.currentWs.description = 'แก้ในเครื่อง'; await lsSaveWorkspace(S.currentWs); clearTimeout(SYNC.timer); });
    const w2 = JSON.parse(remote.wsA.text); w2.description = 'แก้บนคลาวด์';
    remote.wsA = { text: JSON.stringify(w2), updated_at: '2026-11-12T10:00:00.000Z' };
    let dialogMsg = '';
    page.once('dialog', d => { dialogMsg = d.message(); d.accept(); });
    const conf = await ev(async () => {
      await syncRun({ pull: true });
      const l = await lsGetWorkspaceList();
      const copy = l.find(x => x.name.includes('สำเนาเครื่องนี้'));
      return { desc: (await lsGetWorkspace('wsA')).description, copy: copy ? (await lsGetWorkspace(copy.id)).description : null };
    });
    ok('แก้ทั้งสองฝั่ง → ถามผู้ใช้', /ข้อมูลไม่ตรงกัน/.test(dialogMsg), dialogMsg);
    ok('เลือกคลาวด์ → ใช้ของคลาวด์ + เก็บของเครื่องเป็นสำเนา (ไม่หาย)', conf.desc === 'แก้บนคลาวด์' && conf.copy === 'แก้ในเครื่อง', conf);

    // ลบ workspace → ลบบนคลาวด์ด้วย
    await ev(async () => { await lsDeleteWorkspace('wsB'); });
    await waitFor(page, () => !SYNC.busy && !SYNC.state.deleted.length, 12000);
    ok('ลบ workspace → ลบบนคลาวด์', log.removes.includes('wsB') && !remote.wsB, log.removes);

    // Premium หมดอายุ → หยุด sync คลาวด์ + Premium ใช้ไม่ได้ (ข้อมูลในเครื่องยังอยู่)
    account.premium_active = false; account.plan = 'premium';
    const exp = await ev(async () => { await accRefresh(); await new Promise(r => setTimeout(r, 300)); return { target: SYNC.target, status: document.getElementById('statusText').textContent, box: document.getElementById('accBox').textContent, ws: (await lsGetWorkspaceList()).length }; });
    ok('Premium หมดอายุ → ปิด sync คลาวด์ + แจ้งสถานะ', exp.target === null && /ยังไม่ใช่ Premium/.test(exp.status) && /หมดอายุ/.test(exp.box), exp);
    ok('Premium หมดอายุ → ข้อมูลในเครื่องยังอยู่ครบ', exp.ws >= 2, exp);

    // ออกจากระบบ
    page.once('dialog', d => d.accept());
    const out = await ev(async () => { await accSignOut(); return { login: !!document.querySelector('#accBox .acc-login-btn'), key: getApiKey('premium') }; });
    ok('ออกจากระบบ → กลับเป็นปุ่มเข้าสู่ระบบ', out.login && out.key === '', out);
    ok('ไม่มี error ในหน้า (Premium)', log.errors.length === 0, log.errors);
    await ctx.close();
  }

  // ═══ 2) ผู้ใช้ฟรี: ขอ Premium + เชื่อม Google Drive ═══
  {
    const { ctx, page, log, driveFiles } = await setup(browser, { premium: false, googleClientId: 'cid.apps.googleusercontent.com' });
    const ev = (f, a) => page.evaluate(f, a);
    await ev(async () => {
      localStorage.setItem('nt8_auth', JSON.stringify(window.__sess));
    }).catch(() => {});
    // ล็อกอินแบบ free
    await ev(() => openAccountModal());
    await page.fill('#accEmail', 'reader@test.local');
    await page.fill('#accPassword', 'secret123');
    await page.click('#modal-account .btn-primary');
    await waitFor(page, () => document.querySelector('#accBox .acc-req-btn'));
    const free = await ev(() => ({
      badge: document.querySelector('#accBox .acc-badge')?.textContent,
      driveBtn: /เชื่อม Google Drive/.test(document.getElementById('syncBox').textContent),
      target: SYNC.target,
    }));
    ok('ผู้ใช้ฟรี: แสดง FREE + ปุ่มขอ Premium', free.badge === 'FREE', free);
    ok('ผู้ใช้ฟรี: มีปุ่มเชื่อม Google Drive, ยังไม่ sync', free.driveBtn && free.target === null, free);

    // ขอ Premium
    await ev(() => document.querySelector('#accBox .acc-req-btn').click());
    await page.fill('#premReqContact', 'line: reader1');
    await page.click('#modal-premium-request .btn-primary');
    const pend = await waitFor(page, () => /รอแอดมินอนุมัติ/.test(document.getElementById('accBox').textContent));
    ok('ขอ Premium → ส่งคำขอ + แสดงรออนุมัติ', pend && log.rpc.includes('request_premium'), log.rpc);

    // เชื่อม Drive
    await ev(async () => {
      const w = { id: 'wsD', name: 'เรื่องไดรฟ์', glossary: [], customStyles: [], presets: [], chapters: [], settings: {}, createdAt: Date.now() };
      await lsSaveWorkspace(w);
    });
    await ev(() => document.querySelector('#syncBox .sb-action-btn').click());
    const drv = await waitFor(page, () => SYNC.target === 'gdrive' && !SYNC.busy && SYNC.lastOk > 0);
    const df = Object.values(driveFiles);
    ok('เชื่อม Google Drive → อัปโหลดลง appDataFolder', drv && df.some(f => f.name === 'wsD.json' && f.parent && JSON.parse(f.text).name === 'เรื่องไดรฟ์'), { drv, df: df.map(f => f.name), log: log.drive, err: await ev(() => SYNC.error) });
    ok('Drive: ใช้ scope appdata เท่านั้น', await ev(() => DRIVE_SCOPE === 'https://www.googleapis.com/auth/drive.appdata'));

    // แก้ → PATCH ไฟล์เดิม (ไม่สร้างซ้ำ)
    await ev(async () => { const w = await lsGetWorkspace('wsD'); w.description = 'v2'; await lsSaveWorkspace(w); });
    await waitFor(page, () => !SYNC.busy && !SYNC.state.items.wsD.dirty, 12000);
    const files = Object.values(driveFiles).filter(f => f.name === 'wsD.json');
    ok('Drive: แก้แล้วอัปเดตไฟล์เดิม ไม่สร้างไฟล์ซ้ำ', files.length === 1 && JSON.parse(files[0].text).description === 'v2', { n: files.length, log: log.drive });
    ok('ไม่มี error ในหน้า (ฟรี)', log.errors.length === 0, log.errors);
    await ctx.close();
  }

  // ═══ 3) เว็บที่ไม่มี /api (zip / static host) → ไม่มีอะไรเปลี่ยน ═══
  {
    const ctx = await browser.newContext({ serviceWorkers: 'block' });
    const page = await ctx.newPage();
    const errs = []; page.on('pageerror', e => errs.push(e.message));
    await page.goto(BASE + '/index.html'); await page.waitForTimeout(600);
    const r = await page.evaluate(() => ({
      acc: getComputedStyle(document.getElementById('accSection')).display,
      sync: getComputedStyle(document.getElementById('syncSection')).display,
      prem: [...document.getElementById('translateProvider').options].some(o => o.value === 'premium'),
    }));
    ok('ไม่มี /api → ซ่อนบัญชี/sync และไม่มี provider Premium', r.acc === 'none' && r.sync === 'none' && !r.prem, r);
    ok('ไม่มี error ในหน้า (ไม่มี /api)', errs.length === 0, errs);
    await ctx.close();
  }

  await browser.close();
  console.log(fail ? `SOMETHING FAILED (${fail})` : 'ALL OK');
  process.exit(fail ? 1 : 0);
})();
