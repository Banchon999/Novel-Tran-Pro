// ส่วนกลางของ Vercel Functions — ไฟล์/โฟลเดอร์ที่ขึ้นต้นด้วย _ ไม่ถูกสร้างเป็น endpoint
// ใช้แค่ anon key + JWT ของผู้ใช้ → สิทธิ์ทั้งหมดถูกบังคับในฐานข้อมูล (RLS / ฟังก์ชันที่เช็คสิทธิ์เอง)

function env(name) { return (process.env[name] || '').trim(); }

function supabaseConfigured() { return !!(env('SUPABASE_URL') && env('SUPABASE_ANON_KEY')); }

function sendJson(res, status, obj, headers = {}) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);
  res.end(JSON.stringify(obj));
}

function sendError(res, status, message) {
  sendJson(res, status, { error: { message, code: status } });
}

function bearer(req) {
  const h = req.headers['authorization'] || '';
  const m = /^Bearer\s+(.+)$/i.exec(h);
  return m ? m[1].trim() : '';
}

// เรียกฟังก์ชัน Postgres ผ่าน PostgREST ด้วย JWT ของผู้ใช้ (ไม่มี token = anon)
async function rpc(fn, args, token) {
  const url = `${env('SUPABASE_URL').replace(/\/+$/, '')}/rest/v1/rpc/${fn}`;
  const anon = env('SUPABASE_ANON_KEY');
  const r = await fetch(url, {
    method: 'POST',
    // publishable key ใส่แค่ apikey · Authorization ใส่เฉพาะ JWT ของผู้ใช้
    headers: { 'Content-Type': 'application/json', apikey: anon, ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(args || {}),
  });
  const text = await r.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { ok: r.ok, status: r.status, data };
}

async function restSelect(path) {
  const anon = env('SUPABASE_ANON_KEY');
  const r = await fetch(`${env('SUPABASE_URL').replace(/\/+$/, '')}/rest/v1/${path}`, {
    headers: { apikey: anon },
  });
  if (!r.ok) throw new Error(`Supabase HTTP ${r.status}`);
  return r.json();
}

// อ่าน body JSON เอง (กันกรณี runtime ไม่ได้ parse ให้) + จำกัดขนาด
async function readJsonBody(req, maxBytes) {
  if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) return req.body;
  if (typeof req.body === 'string') return JSON.parse(req.body);
  const chunks = []; let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > maxBytes) { const e = new Error('too large'); e.status = 413; throw e; }
    chunks.push(c);
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  return raw ? JSON.parse(raw) : {};
}

module.exports = { env, supabaseConfigured, sendJson, sendError, bearer, rpc, restSelect, readJsonBody };
