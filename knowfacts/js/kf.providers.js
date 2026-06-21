// ═══════════════════════════════════════════════
// KnowFacts Factory — AI Providers
// ─── self-contained, adapted from NovelTrans app.providers.js ───
// ใช้ API Key ร่วมกับ NovelTrans (localStorage keys เดียวกัน: nt8_apikey_*)
// เรียกผ่าน 2 ฟังก์ชันกลาง: aiCall (ไม่ stream) / aiStream (stream)
// ═══════════════════════════════════════════════
'use strict';

const PROVIDERS = {
  openrouter: {
    label: 'OpenRouter',
    lsKey: 'nt8_apikey',           // key เดียวกับ NovelTrans
    keyPlaceholder: 'sk-or-v1-...',
    keyHint: 'สมัครฟรีที่ openrouter.ai/keys — key เดียวใช้ได้หลายโมเดล',
    sse: 'openai',
    models: [
      ['── Google ──', [['google/gemini-2.5-flash','Gemini 2.5 Flash 🔥'],['google/gemini-2.5-flash-lite','Gemini 2.5 Flash Lite'],['google/gemini-2.5-pro','Gemini 2.5 Pro'],['google/gemini-2.0-flash-001','Gemini 2.0 Flash']]],
      ['── OpenAI ──', [['openai/gpt-5-nano','GPT-5 Nano ✨'],['openai/gpt-5','GPT-5'],['openai/gpt-4.1-nano','GPT-4.1 Nano'],['openai/gpt-4o-mini','GPT-4o Mini']]],
      ['── DeepSeek ──', [['deepseek/deepseek-v3.2','DeepSeek V3.2 🆕'],['deepseek/deepseek-chat','DeepSeek V3'],['deepseek/deepseek-r1','DeepSeek R1']]],
      ['── อื่นๆ ──', [['anthropic/claude-haiku-4.5','Claude Haiku 4.5'],['x-ai/grok-4-fast','Grok 4 Fast'],['meta-llama/llama-3.3-70b-instruct:free','Llama 3.3 70B (ฟรี)']]],
    ],
    buildRequest({ model, messages, temperature, max_tokens, stream, key }) {
      return {
        url: 'https://openrouter.ai/api/v1/chat/completions',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}`, 'HTTP-Referer': location.origin, 'X-Title': 'KnowFacts Factory' },
        body: { model, messages, temperature, max_tokens, stream },
      };
    },
    testEndpoint: key => ({ url: 'https://openrouter.ai/api/v1/models', headers: { 'Authorization': `Bearer ${key}` } }),
    extractText: d => d.choices?.[0]?.message?.content ?? '',
    extractUsage: d => ({ inTok: d.usage?.prompt_tokens || 0, outTok: d.usage?.completion_tokens || 0 }),
  },

  gemini: {
    label: 'Google Gemini',
    lsKey: 'nt8_apikey_gemini',
    keyPlaceholder: 'AIza...',
    keyHint: 'สร้าง key ฟรีที่ aistudio.google.com/apikey',
    sse: 'gemini',
    models: [[null, [['gemini-2.5-flash','Gemini 2.5 Flash 🔥'],['gemini-2.5-flash-lite','Gemini 2.5 Flash Lite'],['gemini-2.5-pro','Gemini 2.5 Pro'],['gemini-2.0-flash','Gemini 2.0 Flash']]]],
    buildRequest({ model, messages, temperature, max_tokens, stream, key }) {
      const text = messages.map(m => m.content).join('\n\n');
      return {
        url: `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:${stream ? 'streamGenerateContent?alt=sse' : 'generateContent'}`,
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
        body: { contents: [{ role: 'user', parts: [{ text }] }], generationConfig: { temperature, maxOutputTokens: max_tokens } },
      };
    },
    testEndpoint: key => ({ url: 'https://generativelanguage.googleapis.com/v1beta/models', headers: { 'x-goog-api-key': key } }),
    extractText: d => (d.candidates?.[0]?.content?.parts || []).map(p => p.text || '').join(''),
    extractUsage: d => ({ inTok: d.usageMetadata?.promptTokenCount || 0, outTok: d.usageMetadata?.candidatesTokenCount || 0 }),
  },

  openai: {
    label: 'OpenAI',
    lsKey: 'nt8_apikey_openai',
    keyPlaceholder: 'sk-...',
    keyHint: 'สร้าง key ที่ platform.openai.com/api-keys',
    sse: 'openai',
    models: [[null, [['gpt-5-nano','GPT-5 Nano ✨'],['gpt-5-mini','GPT-5 Mini'],['gpt-5','GPT-5'],['gpt-4.1-nano','GPT-4.1 Nano'],['gpt-4o-mini','GPT-4o Mini']]]],
    buildRequest({ model, messages, temperature, max_tokens, stream, key }) {
      return {
        url: 'https://api.openai.com/v1/chat/completions',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}` },
        body: { model, messages, temperature, max_tokens, ...(stream ? { stream: true, stream_options: { include_usage: true } } : {}) },
      };
    },
    testEndpoint: key => ({ url: 'https://api.openai.com/v1/models', headers: { 'Authorization': `Bearer ${key}` } }),
    extractText: d => d.choices?.[0]?.message?.content ?? '',
    extractUsage: d => ({ inTok: d.usage?.prompt_tokens || 0, outTok: d.usage?.completion_tokens || 0 }),
  },

  anthropic: {
    label: 'Anthropic Claude',
    lsKey: 'nt8_apikey_anthropic',
    keyPlaceholder: 'sk-ant-...',
    keyHint: 'สร้าง key ที่ console.anthropic.com',
    sse: 'anthropic',
    models: [[null, [['claude-haiku-4-5','Claude Haiku 4.5'],['claude-sonnet-4-6','Claude Sonnet 4.6'],['claude-opus-4-8','Claude Opus 4.8']]]],
    buildRequest({ model, messages, temperature, max_tokens, stream, key }) {
      return {
        url: 'https://api.anthropic.com/v1/messages',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': key,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true',
        },
        body: { model, max_tokens: max_tokens || 4000, temperature: Math.min(1, temperature), messages, ...(stream ? { stream: true } : {}) },
      };
    },
    testEndpoint: key => ({ url: 'https://api.anthropic.com/v1/models', headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' } }),
    extractText: d => (d.content || []).map(b => b.text || '').join(''),
    extractUsage: d => ({ inTok: d.usage?.input_tokens || 0, outTok: d.usage?.output_tokens || 0 }),
  },

  deepseek: {
    label: 'DeepSeek',
    lsKey: 'nt8_apikey_deepseek',
    keyPlaceholder: 'sk-...',
    keyHint: 'สร้าง key ที่ platform.deepseek.com',
    sse: 'openai',
    models: [[null, [['deepseek-chat','DeepSeek Chat (V3)'],['deepseek-reasoner','DeepSeek Reasoner (R1)']]]],
    buildRequest({ model, messages, temperature, max_tokens, stream, key }) {
      return {
        url: 'https://api.deepseek.com/chat/completions',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}` },
        body: { model, messages, temperature, max_tokens, stream },
      };
    },
    testEndpoint: key => ({ url: 'https://api.deepseek.com/models', headers: { 'Authorization': `Bearer ${key}` } }),
    extractText: d => d.choices?.[0]?.message?.content ?? '',
    extractUsage: d => ({ inTok: d.usage?.prompt_tokens || 0, outTok: d.usage?.completion_tokens || 0 }),
  },
};

function getTimeoutMs() {
  const base = Math.max(20, Math.min(900, parseInt(localStorage.getItem('nt8_timeout_s')) || 120));
  return base * 1000;
}

function getProvider() {
  const p = KF.settings.provider || 'openrouter';
  return PROVIDERS[p] ? p : 'openrouter';
}

function getApiKey(provider) {
  const prov = PROVIDERS[provider || getProvider()] || PROVIDERS.openrouter;
  return localStorage.getItem(prov.lsKey) || '';
}

async function aiHttpError(prov, res) {
  let msg = '';
  try { const err = await res.json(); msg = err.error?.message || err.message || ''; } catch {}
  const s = res.status;
  if (s === 401 || s === 403) return new Error(`🔑 ${prov.label}: API Key ไม่ถูกต้องหรือหมดสิทธิ์${msg ? ` — ${msg}` : ''}`);
  if (s === 429) { const retry = res.headers.get('retry-after'); return new Error(`⏳ ${prov.label}: ติด Rate Limit${retry ? ` — รอ ${retry} วินาที` : ''} แล้วลองใหม่`); }
  if (s === 402) return new Error(`💳 ${prov.label}: เครดิตหมด — เติมเงินก่อนใช้งาน`);
  if (s >= 500) return new Error(`⚠ ${prov.label}: เซิร์ฟเวอร์มีปัญหา (HTTP ${s}) — ลองใหม่อีกครั้ง`);
  return new Error(`${prov.label}: HTTP ${s}${msg ? ` — ${msg}` : ''}`);
}

function aiNetworkError(prov, provName) {
  return new Error(`🌐 ${prov.label}: เชื่อมต่อไม่ได้ — อาจติด CORS หรืออินเทอร์เน็ตขัดข้อง${provName !== 'openrouter' ? ' (แนะนำลองใช้ OpenRouter แทน)' : ''}`);
}

// ── เรียก AI แบบไม่ stream — คืนข้อความล้วน ──
async function aiCall({ model, messages, temperature = 0.7, max_tokens = 4000, signal }) {
  const provName = getProvider();
  const prov = PROVIDERS[provName];
  const key = getApiKey(provName);
  if (!key) throw new Error(`ยังไม่ได้ตั้ง API Key ของ ${prov.label} — ไปที่ ⚙ ตั้งค่า`);

  const ctrl = signal ? null : new AbortController();
  const sig = signal || ctrl.signal;
  const timer = setTimeout(() => ctrl?.abort(), getTimeoutMs());
  const req = prov.buildRequest({ model, messages, temperature, max_tokens, stream: false, key });
  let res;
  try {
    res = await fetch(req.url, { method: 'POST', headers: req.headers, body: JSON.stringify(req.body), signal: sig });
  } catch (e) {
    if (e.name === 'AbortError') throw e;
    throw aiNetworkError(prov, provName);
  } finally { clearTimeout(timer); }
  if (!res.ok) throw await aiHttpError(prov, res);

  const data = await res.json();
  const usage = prov.extractUsage(data);
  addCosts(usage.inTok, usage.outTok, model, provName);
  return prov.extractText(data);
}

// ── เรียก AI แบบ stream ──
async function aiStream({ model, messages, temperature = 0.7, max_tokens = 4000 }, onChunk, signal) {
  const provName = getProvider();
  const prov = PROVIDERS[provName];
  const key = getApiKey(provName);
  if (!key) throw new Error(`ยังไม่ได้ตั้ง API Key ของ ${prov.label} — ไปที่ ⚙ ตั้งค่า`);

  const req = prov.buildRequest({ model, messages, temperature, max_tokens, stream: true, key });
  let res;
  try {
    res = await fetch(req.url, { method: 'POST', headers: req.headers, body: JSON.stringify(req.body), signal });
  } catch (e) {
    if (e.name === 'AbortError') throw e;
    throw aiNetworkError(prov, provName);
  }
  if (!res.ok) throw await aiHttpError(prov, res);

  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '', fullText = '', done = false, inTok = 0, outTok = 0;

  const handleData = (raw) => {
    if (raw === '[DONE]') { done = true; return; }
    let evt; try { evt = JSON.parse(raw); } catch { return; }
    if (prov.sse === 'openai') {
      const delta = evt.choices?.[0]?.delta?.content;
      if (delta) { fullText += delta; onChunk && onChunk(delta, fullText); }
      if (evt.usage) { inTok = evt.usage.prompt_tokens || 0; outTok = evt.usage.completion_tokens || 0; }
    } else if (prov.sse === 'gemini') {
      const delta = (evt.candidates?.[0]?.content?.parts || []).map(p => p.text || '').join('');
      if (delta) { fullText += delta; onChunk && onChunk(delta, fullText); }
      if (evt.usageMetadata) { inTok = evt.usageMetadata.promptTokenCount || 0; outTok = evt.usageMetadata.candidatesTokenCount || 0; }
    } else if (prov.sse === 'anthropic') {
      if (evt.type === 'content_block_delta' && evt.delta?.text) { fullText += evt.delta.text; onChunk && onChunk(evt.delta.text, fullText); }
      else if (evt.type === 'message_start') inTok = evt.message?.usage?.input_tokens || 0;
      else if (evt.type === 'message_delta') outTok = evt.usage?.output_tokens || outTok;
      else if (evt.type === 'message_stop') done = true;
      else if (evt.type === 'error') throw new Error(`${prov.label}: ${evt.error?.message || 'stream error'}`);
    }
  };

  while (!done) {
    const { done: d, value } = await reader.read();
    if (d) break;
    buf += dec.decode(value, { stream: true });
    const lines = buf.split('\n');
    buf = lines.pop() ?? '';
    for (const line of lines) {
      if (!line.startsWith('data:')) continue;
      handleData(line.slice(5).trim());
      if (done) break;
    }
  }
  reader.cancel().catch(() => {});
  addCosts(inTok, outTok, model, provName);
  return fullText;
}

// ── Cost tracking (เก็บ kf_costs ใน localStorage) ──
const MODEL_COSTS = {
  'google/gemini-2.5-flash': { in: 0.15, out: 0.60 }, 'google/gemini-2.5-flash-lite': { in: 0.075, out: 0.30 },
  'google/gemini-2.5-pro': { in: 1.25, out: 10.0 }, 'openai/gpt-5-nano': { in: 0.15, out: 0.60 },
  'openai/gpt-4.1-nano': { in: 0.10, out: 0.40 }, 'openai/gpt-4o-mini': { in: 0.15, out: 0.60 },
  'deepseek/deepseek-chat': { in: 0.14, out: 0.28 }, 'anthropic/claude-haiku-4.5': { in: 0.80, out: 4.00 },
  'gemini:gemini-2.5-flash': { in: 0.30, out: 2.50 }, 'gemini:gemini-2.5-flash-lite': { in: 0.10, out: 0.40 },
  'openai:gpt-5-nano': { in: 0.05, out: 0.40 }, 'openai:gpt-4o-mini': { in: 0.15, out: 0.60 },
  'anthropic:claude-haiku-4-5': { in: 1.00, out: 5.00 }, 'deepseek:deepseek-chat': { in: 0.27, out: 1.10 },
};

function addCosts(inTok, outTok, model, provider) {
  const rates = MODEL_COSTS[provider + ':' + model] || MODEL_COSTS[model] || { in: 0.1, out: 0.3 };
  const usd = (inTok / 1e6 * rates.in) + (outTok / 1e6 * rates.out);
  KF.costs.input += inTok; KF.costs.output += outTok; KF.costs.usd += usd;
  localStorage.setItem('kf_costs', JSON.stringify(KF.costs));
  updateCostUI();
}

function loadCosts() {
  try { Object.assign(KF.costs, JSON.parse(localStorage.getItem('kf_costs') || '{}')); } catch {}
}

function updateCostUI() {
  const el = document.getElementById('costMini');
  if (el) el.textContent = '$' + (KF.costs.usd < 0.01 ? KF.costs.usd.toFixed(4) : KF.costs.usd.toFixed(2));
}

// ── Provider / Model selects ──
function renderProviderSelect(sel, current) {
  if (!sel) return;
  sel.innerHTML = Object.entries(PROVIDERS).map(([id, p]) =>
    `<option value="${id}">${p.label}${getApiKey(id) ? '' : ' ⚠'}</option>`).join('');
  sel.value = current;
}

function renderModelSelect(sel, provName, selected) {
  if (!sel) return;
  const prov = PROVIDERS[provName];
  let found = false, html = '';
  for (const [group, items] of prov.models) {
    const opts = items.map(([id, label]) => { if (id === selected) found = true; return `<option value="${id}">${label}</option>`; }).join('');
    html += group ? `<optgroup label="${group}">${opts}</optgroup>` : opts;
  }
  if (selected && !found) html += `<option value="${selected}">⭐ ${selected}</option>`;
  sel.innerHTML = html;
  sel.value = selected || (provName === 'openrouter' ? 'google/gemini-2.5-flash' : prov.models[0][1][0][0]);
}
