// ทดสอบ /api/ai แบบไม่เรียกของจริง (mock Supabase RPC + OpenRouter) · ใช้: node tests/api/run-api.js
const http = require('http');
const realFetch = global.fetch;

process.env.SUPABASE_URL = 'https://sb.test';
process.env.SUPABASE_ANON_KEY = 'sb_publishable_test';
process.env.OPENROUTER_API_KEY = 'sk-or-server';

// ── mock ──
const state = { check: { ok: true }, checkStatus: 200, usage: [], upstream: [], upStatus: 200, upStream: null, upJson: null };
global.fetch = async (url, opts = {}) => {
  url = String(url);
  if (url.startsWith('https://sb.test/rest/v1/rpc/premium_check')) {
    state.lastCheckAuth = opts.headers.Authorization;
    return new Response(JSON.stringify(state.check), { status: state.checkStatus });
  }
  if (url.startsWith('https://sb.test/rest/v1/rpc/record_usage')) {
    state.usage.push(JSON.parse(opts.body));
    return new Response(null, { status: 204 });
  }
  if (url === 'https://openrouter.ai/api/v1/models') {
    return new Response(JSON.stringify({ data: [{ id: 'm/ok', pricing: { prompt: '0.000001', completion: '0.000002' } }] }));
  }
  if (url === 'https://openrouter.ai/api/v1/chat/completions') {
    state.upstream.push({ body: JSON.parse(opts.body), auth: opts.headers.Authorization });
    if (state.upStatus !== 200) return new Response(JSON.stringify({ error: { message: 'bad key' } }), { status: state.upStatus });
    if (state.upStream) return new Response(new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(state.upStream)); c.close(); } }), { status: 200 });
    return new Response(JSON.stringify(state.upJson), { status: 200 });
  }
  throw new Error('unexpected fetch ' + url);
};

const handler = require('../../api/ai.js');
const server = http.createServer((req, res) => handler(req, res));

let fail = 0;
const ok = (name, cond, extra) => { console.log((cond ? 'PASS ' : 'FAIL ') + name + (cond || extra === undefined ? '' : ' → ' + JSON.stringify(extra))); if (!cond) fail++; };

server.listen(0, async () => {
  const base = `http://127.0.0.1:${server.address().port}/api/ai`;
  const call = (body, token = 'user-jwt', method = 'POST') => realFetch(base, {
    method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: method === 'POST' ? JSON.stringify(body) : undefined,
  });
  const msg = { model: 'm/ok', messages: [{ role: 'user', content: 'สวัสดี' }], max_tokens: 99999, temperature: 0.3 };

  try {
    let r = await call(msg, '', 'POST');
    ok('ไม่มี token → 401', r.status === 401);

    r = await call(msg, 'x', 'GET');
    ok('GET → 405', r.status === 405);

    r = await call({ model: 'm/ok', messages: 'oops' });
    ok('messages ผิดรูป → 400', r.status === 400);

    state.check = { ok: false, code: 403, message: 'บัญชีนี้ยังไม่ใช่ Premium' };
    r = await call(msg); let j = await r.json();
    ok('ไม่ใช่ Premium → 403 + ข้อความไทย', r.status === 403 && /Premium/.test(j.error.message), j);
    ok('ส่ง JWT ผู้ใช้ไปตรวจสิทธิ์', state.lastCheckAuth === 'Bearer user-jwt');
    ok('ไม่ผ่านสิทธิ์ → ไม่เรียก OpenRouter', state.upstream.length === 0);

    state.check = { ok: false, code: 402, message: 'โควต้าหมด' };
    r = await call(msg);
    ok('โควต้าหมด → 402', r.status === 402);

    state.check = {}; state.checkStatus = 401;
    r = await call(msg);
    ok('JWT หมดอายุ → 401', r.status === 401);
    state.checkStatus = 200;

    // ── ผ่านสิทธิ์ · ไม่ stream ──
    state.check = { ok: true };
    state.upJson = { choices: [{ message: { content: 'คำแปล' }, finish_reason: 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 5, cost: 0.0042 } };
    r = await call(msg); j = await r.json();
    ok('ไม่ stream → 200 + เนื้อหา', r.status === 200 && j.choices[0].message.content === 'คำแปล', j);
    const up = state.upstream.at(-1);
    ok('ใช้ key ของเซิร์ฟเวอร์', up.auth === 'Bearer sk-or-server');
    ok('จำกัด max_tokens ≤ 16000', up.body.max_tokens === 16000, up.body.max_tokens);
    ok('ขอ usage จาก OpenRouter', up.body.usage?.include === true);
    ok('บันทึกต้นทุนจริง', state.usage.at(-1)?.p_cost === 0.0042 && state.usage.at(-1)?.p_in === 10, state.usage.at(-1));

    // ── stream ──
    state.upJson = null;
    state.upStream = `: OPENROUTER PROCESSING\n\ndata: {"choices":[{"delta":{"content":"สวัส"}}]}\n\ndata: {"choices":[{"delta":{"content":"ดี"},"finish_reason":"stop"}],"usage":{"prompt_tokens":7,"completion_tokens":3,"cost":0.001}}\n\ndata: [DONE]\n\n`;
    const nUsage = state.usage.length;
    r = await call({ ...msg, stream: true });
    const text = await r.text();
    ok('stream → content-type SSE', /text\/event-stream/.test(r.headers.get('content-type')));
    ok('stream ส่งต่อครบ', text.includes('สวัส') && text.includes('[DONE]'));
    ok('stream บันทึก usage 1 ครั้ง', state.usage.length === nUsage + 1 && state.usage.at(-1).p_cost === 0.001, state.usage.at(-1));

    // ── stream ไม่มี cost → ประมาณจากราคาโมเดล ──
    state.upStream = `data: {"choices":[{"delta":{"content":"abcdefgh"}}]}\n\ndata: [DONE]\n\n`;
    r = await call({ ...msg, stream: true }); await r.text();
    const est = state.usage.at(-1);
    ok('ไม่มี cost → ประมาณ (> 0)', est.p_cost > 0 && est.p_out === 2, est);

    // ── upstream พัง: 401 ของ key ระบบ → 502 (ไม่ให้ผู้ใช้คิดว่า key ตัวเองผิด) ──
    state.upStream = null; state.upStatus = 401;
    r = await call(msg); j = await r.json();
    ok('key ระบบเสีย → 502', r.status === 502 && /Premium/.test(j.error.message), j);
    state.upStatus = 429;
    r = await call(msg);
    ok('upstream rate limit → 429', r.status === 429);
  } catch (e) {
    console.log('FAIL exception', e); fail++;
  }
  server.close();
  console.log(fail ? `SOMETHING FAILED (${fail})` : 'ALL OK');
  process.exit(fail ? 1 : 0);
});
