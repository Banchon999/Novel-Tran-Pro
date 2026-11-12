// POST /api/ai — Premium AI proxy (OpenAI chat-completions format → OpenRouter)
// ลำดับ: ตรวจ JWT → premium_check (Premium? โมเดลอนุญาต? โควต้าเหลือ?) → OpenRouter → record_usage ด้วยต้นทุนจริง
// OPENROUTER_API_KEY อยู่บนเซิร์ฟเวอร์เท่านั้น ผู้ใช้ไม่เห็น
const { env, supabaseConfigured, sendError, bearer, rpc, readJsonBody } = require('./_lib/common');

const MAX_BODY = 1.5 * 1024 * 1024;
const MAX_TOKENS_CAP = 16000;
const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';

// ราคาโมเดล (USD/token) ไว้ประมาณต้นทุนเมื่อ OpenRouter ไม่ส่ง cost มา (เช่น ผู้ใช้กดหยุดกลางทาง)
let _pricing = null, _pricingAt = 0;
async function modelPrice(model) {
  if (!_pricing || Date.now() - _pricingAt > 6 * 3600e3) {
    try {
      const r = await fetch('https://openrouter.ai/api/v1/models');
      const j = await r.json();
      _pricing = {};
      for (const m of j.data || []) _pricing[m.id] = { in: parseFloat(m.pricing?.prompt) || 0, out: parseFloat(m.pricing?.completion) || 0 };
      _pricingAt = Date.now();
    } catch { _pricing = _pricing || {}; }
  }
  return _pricing[model] || { in: 1e-6, out: 4e-6 };   // ไม่รู้ราคา → ค่ากลางแบบระวัง
}

function estimateTokens(text) {
  const s = String(text || '');
  const dense = (s.match(/[ᄀ-ᇿ⺀-꓏가-힯豈-﫿฀-๿]/g) || []).length;
  return Math.ceil(dense / 1.2 + (s.length - dense) / 4);
}

async function recordUsage(token, model, usage, fallbackIn, fallbackOutText) {
  let inTok = usage?.prompt_tokens || 0, outTok = usage?.completion_tokens || 0;
  let cost = typeof usage?.cost === 'number' ? usage.cost : null;
  if (cost === null) {
    if (!inTok) inTok = fallbackIn;
    if (!outTok) outTok = estimateTokens(fallbackOutText);
    const p = await modelPrice(model);
    cost = inTok * p.in + outTok * p.out;
  }
  const r = await rpc('record_usage', { p_model: model, p_in: inTok, p_out: outTok, p_cost: cost }, token)
    .catch(e => ({ ok: false, data: String(e) }));
  if (!r.ok) console.error('record_usage failed', r.status, r.data);
}

function upstreamError(status, msg) {
  if (status === 429) return [429, 'ระบบ Premium ติด Rate Limit ชั่วคราว — รอสักครู่แล้วลองใหม่'];
  if (status === 400) return [400, `คำขอไม่ถูกต้อง${msg ? ` — ${msg}` : ''}`];
  // 401/402/403 = ปัญหาที่ key ของระบบ ไม่ใช่ของผู้ใช้ → อย่าให้แอปขึ้นว่า "API Key ไม่ถูกต้อง"
  return [502, `ระบบ Premium ขัดข้องชั่วคราว (upstream ${status}) — แจ้งแอดมินถ้ายังเป็นอยู่`];
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return sendError(res, 405, 'ใช้ POST เท่านั้น'); }
  if (!supabaseConfigured() || !env('OPENROUTER_API_KEY')) return sendError(res, 503, 'ระบบ Premium ยังไม่เปิดใช้งานบนเซิร์ฟเวอร์นี้');

  const token = bearer(req);
  if (!token) return sendError(res, 401, 'ยังไม่ได้เข้าสู่ระบบ — เข้าสู่ระบบก่อนใช้ Premium');
  if (Number(req.headers['content-length'] || 0) > MAX_BODY) return sendError(res, 413, 'ข้อความยาวเกินไป — แบ่ง chunk ให้เล็กลง');

  let body;
  try { body = await readJsonBody(req, MAX_BODY); }
  catch (e) { return sendError(res, e.status || 400, e.status === 413 ? 'ข้อความยาวเกินไป — แบ่ง chunk ให้เล็กลง' : 'JSON ไม่ถูกต้อง'); }

  const { model, messages } = body || {};
  if (typeof model !== 'string' || !Array.isArray(messages) || !messages.length ||
      !messages.every(m => m && typeof m.content === 'string' && ['system', 'user', 'assistant'].includes(m.role))) {
    return sendError(res, 400, 'รูปแบบคำขอไม่ถูกต้อง (ต้องมี model และ messages)');
  }

  // สิทธิ์ + โควต้า — ตัดสินในฐานข้อมูลด้วย JWT ของผู้ใช้
  const chk = await rpc('premium_check', { p_model: model }, token).catch(() => null);
  if (!chk) return sendError(res, 502, 'ตรวจสิทธิ์ไม่สำเร็จ — ลองใหม่อีกครั้ง');
  if (chk.status === 401 || chk.status === 403) return sendError(res, 401, 'เซสชันหมดอายุ — เข้าสู่ระบบใหม่');
  if (!chk.ok) return sendError(res, 502, 'ตรวจสิทธิ์ไม่สำเร็จ — ลองใหม่อีกครั้ง');
  if (!chk.data?.ok) return sendError(res, chk.data?.code || 403, chk.data?.message || 'ไม่มีสิทธิ์ใช้ Premium');

  const stream = !!body.stream;
  const temperature = Number.isFinite(body.temperature) ? Math.max(0, Math.min(2, body.temperature)) : 0.7;
  const max_tokens = Math.max(1, Math.min(MAX_TOKENS_CAP, parseInt(body.max_tokens) || 4000));
  const promptText = messages.map(m => m.content).join('\n');

  const ctrl = new AbortController();
  let clientGone = false;
  res.on('close', () => { if (!res.writableEnded) { clientGone = true; ctrl.abort(); } });

  let up;
  try {
    up = await fetch(OPENROUTER_URL, {
      method: 'POST',
      signal: ctrl.signal,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${env('OPENROUTER_API_KEY')}`,
        'HTTP-Referer': env('PUBLIC_SITE_URL') || `https://${req.headers.host || 'noveltrans.vercel.app'}`,
        'X-Title': 'NovelTrans Premium',
      },
      body: JSON.stringify({ model, messages, temperature, max_tokens, stream, usage: { include: true } }),
    });
  } catch (e) {
    if (clientGone) return;
    return sendError(res, 502, 'เชื่อมต่อผู้ให้บริการ AI ไม่ได้ — ลองใหม่อีกครั้ง');
  }

  if (!up.ok) {
    let msg = '';
    try { const j = await up.json(); msg = j.error?.message || ''; } catch {}
    console.error('openrouter error', up.status, msg);
    const [st, m] = upstreamError(up.status, msg);
    return sendError(res, st, m);
  }

  if (!stream) {
    const data = await up.json();
    await recordUsage(token, model, data.usage, estimateTokens(promptText), data.choices?.[0]?.message?.content || '');
    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    return res.end(JSON.stringify(data));
  }

  // stream: ส่งต่อทีละ chunk + แอบอ่าน usage จาก event สุดท้าย
  res.statusCode = 200;
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('X-Accel-Buffering', 'no');
  if (res.flushHeaders) res.flushHeaders();

  const dec = new TextDecoder();
  let buf = '', outText = '', usage = null;
  const scan = (line) => {
    if (!line.startsWith('data:')) return;
    const raw = line.slice(5).trim();
    if (!raw || raw === '[DONE]') return;
    try {
      const evt = JSON.parse(raw);
      const d = evt.choices?.[0]?.delta?.content;
      if (d) outText += d;
      if (evt.usage) usage = evt.usage;
    } catch {}
  };
  try {
    const reader = up.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(Buffer.from(value));
      buf += dec.decode(value, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop() ?? '';
      lines.forEach(scan);
    }
    if (buf) scan(buf);
  } catch (e) {
    if (!clientGone) console.error('stream error', e && e.message);
  } finally {
    // บันทึกก่อนจบ response (ฟังก์ชันอาจถูกหยุดหลัง end) · ผู้ใช้กดหยุดกลางทาง = ประมาณจากข้อความที่ได้
    await recordUsage(token, model, usage, estimateTokens(promptText), outText);
    if (!res.writableEnded) res.end();
  }
};
