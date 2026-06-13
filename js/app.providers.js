// ═══════════════════════════════════════════════
// ─── AI Providers ───────────────────────────────
// ═══════════════════════════════════════════════
// dispatch table: ทุก provider บอกวิธีสร้าง request + วิธีอ่านผล/usage + รูปแบบ SSE
// เรียกใช้ผ่าน 2 ฟังก์ชันกลาง: aiCall (ไม่ stream) / aiStream (stream)

const PROVIDERS = {
  openrouter: {
    label: 'OpenRouter',
    lsKey: LS_KEY_API, // key เดิม — ผู้ใช้เก่าไม่ต้องตั้งใหม่
    keyPlaceholder: 'sk-or-v1-...',
    keyHint: 'สมัครฟรีที่ openrouter.ai/keys — key เดียวใช้ได้หลายโมเดล',
    sse: 'openai',
    models: [
      ['── Google ──', [['google/gemini-2.5-flash','Gemini 2.5 Flash 🔥'],['google/gemini-2.5-flash-lite','Gemini 2.5 Flash Lite'],['google/gemini-2.5-pro','Gemini 2.5 Pro'],['google/gemini-2.0-flash-001','Gemini 2.0 Flash'],['google/gemini-1.5-flash','Gemini 1.5 Flash']]],
      ['── OpenAI ──', [['openai/gpt-5-nano','GPT-5 Nano ✨'],['openai/gpt-5','GPT-5'],['openai/gpt-4.1-nano','GPT-4.1 Nano'],['openai/gpt-4o-mini','GPT-4o Mini'],['openai/gpt-4o','GPT-4o'],['openai/gpt-oss-120b','GPT-OSS 120B']]],
      ['── DeepSeek ──', [['deepseek/deepseek-v3.2','DeepSeek V3.2 🆕'],['deepseek/deepseek-chat-v3-0324','DeepSeek V3 (Mar)'],['deepseek/deepseek-chat','DeepSeek V3'],['deepseek/deepseek-r1','DeepSeek R1']]],
      ['── xAI ──', [['x-ai/grok-4','Grok 4'],['x-ai/grok-4-fast','Grok 4 Fast']]],
      ['── อื่นๆ ──', [['anthropic/claude-haiku-4.5','Claude Haiku 4.5'],['anthropic/claude-3-haiku','Claude Haiku 3'],['meta-llama/llama-3.3-70b-instruct:free','Llama 3.3 70B (ฟรี)'],['meta-llama/llama-4-scout:free','Llama 4 Scout (ฟรี)']]],
    ],
    buildRequest({ model, messages, temperature, max_tokens, stream, key }) {
      return {
        url: 'https://openrouter.ai/api/v1/chat/completions',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}`, 'HTTP-Referer': location.origin, 'X-Title': 'NovelTrans v10 Pro' },
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
      // แอพนี้ส่ง user message เดียวเสมอ — รวม content เป็น turn เดียว
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
    models: [[null, [['gpt-5-nano','GPT-5 Nano ✨'],['gpt-5-mini','GPT-5 Mini'],['gpt-5','GPT-5'],['gpt-4.1-nano','GPT-4.1 Nano'],['gpt-4o-mini','GPT-4o Mini'],['gpt-4o','GPT-4o']]]],
    buildRequest({ model, messages, temperature, max_tokens, stream, key }) {
      return {
        url: 'https://api.openai.com/v1/chat/completions',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}` },
        // stream_options จำเป็นเพื่อให้ OpenAI ส่ง usage ใน chunk สุดท้าย
        body: { model, messages, temperature, max_tokens: max_tokens, ...(stream ? { stream: true, stream_options: { include_usage: true } } : {}) },
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
          // จำเป็น: Anthropic บล็อก browser CORS เว้นแต่ใส่ header นี้ (key อยู่ในเครื่องผู้ใช้เอง)
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

// timeout ของการเรียก AI (วินาที) — ตั้งได้ใน ⚙ ตั้งค่า API Key, default 120
// kind: 'chunk' = ต่อ chunk/segment, 'full' = ทั้งตอน (ให้เวลา 1.5 เท่า)
function getTimeoutMs(kind = 'chunk') {
  const base = Math.max(20, Math.min(900, parseInt(localStorage.getItem('nt8_timeout_s')) || 120));
  return Math.round(base * (kind === 'full' ? 1.5 : 1) * 1000);
}

// provider ปัจจุบันของ workspace — default openrouter เพื่อให้ workspace เก่าทำงานเหมือนเดิม
function getProvider() {
  const p = S.currentWs?.settings?.aiProvider || 'openrouter';
  return PROVIDERS[p] ? p : 'openrouter';
}

// ไม่ส่ง argument = key ของ provider ปัจจุบัน (call-site เดิมทั้งหมดใช้ได้ต่อ)
function getApiKey(provider) {
  const prov = PROVIDERS[provider || getProvider()] || PROVIDERS.openrouter;
  return localStorage.getItem(prov.lsKey) || '';
}

// แปลง HTTP error เป็นข้อความไทยที่บอกสาเหตุ + วิธีแก้
async function aiHttpError(prov, res) {
  let msg = '';
  try {
    const err = await res.json();
    msg = err.error?.message || err.message || '';
  } catch {}
  const s = res.status;
  if (s === 401 || s === 403) return new Error(`🔑 ${prov.label}: API Key ไม่ถูกต้องหรือหมดสิทธิ์${msg ? ` — ${msg}` : ''}`);
  if (s === 429) {
    const retry = res.headers.get('retry-after');
    return new Error(`⏳ ${prov.label}: ติด Rate Limit${retry ? ` — รอ ${retry} วินาที` : ''} แล้วลองใหม่`);
  }
  if (s === 402) return new Error(`💳 ${prov.label}: เครดิตหมด — เติมเงินก่อนใช้งาน`);
  if (s >= 500) return new Error(`⚠ ${prov.label}: เซิร์ฟเวอร์มีปัญหา (HTTP ${s}) — ลองใหม่อีกครั้ง`);
  return new Error(`${prov.label}: HTTP ${s}${msg ? ` — ${msg}` : ''}`);
}

function aiNetworkError(prov, provName) {
  return new Error(`🌐 ${prov.label}: เชื่อมต่อไม่ได้ — อาจติด CORS หรืออินเทอร์เน็ตขัดข้อง${provName !== 'openrouter' ? ' (แนะนำลองใช้ OpenRouter แทน)' : ''}`);
}

// ── เรียก AI แบบไม่ stream — คืนรูป choices แบบ OpenAI เสมอ (call-site เดิมอ่าน choices[0].message.content) ──
async function aiCall({ model, messages, temperature = 0.7, max_tokens = 2000 }) {
  const provName = getProvider();
  const prov = PROVIDERS[provName];
  const key = getApiKey(provName);
  if (!key) throw new Error(`ยังไม่ได้ตั้ง API Key ของ ${prov.label} — ไปที่ ⚙ ตั้งค่า`);

  const req = prov.buildRequest({ model, messages, temperature, max_tokens, stream: false, key });
  let res;
  try {
    res = await fetch(req.url, { method: 'POST', headers: req.headers, body: JSON.stringify(req.body) });
  } catch (e) {
    if (e.name === 'AbortError') throw e;
    throw aiNetworkError(prov, provName);
  }
  if (!res.ok) throw await aiHttpError(prov, res);

  const data = await res.json();
  const usage = prov.extractUsage(data);
  addCosts(usage.inTok, usage.outTok, model, provName);
  return { choices: [{ message: { content: prov.extractText(data) } }], usage: data.usage || usage, _raw: data };
}

// alias เดิม — call-site ไม่ stream ทั้งหมดใช้ต่อได้โดยไม่แก้
const callOpenRouter = aiCall;

// ── เรียก AI แบบ stream — parser ตามรูปแบบ SSE ของแต่ละ provider ──
async function aiStream({ model, messages, temperature = 0.7, max_tokens = 2000 }, onChunk, onUsage, signal) {
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
  let buf = '', fullText = '', done = false;
  let inTok = 0, outTok = 0;

  const handleData = (raw) => {
    if (raw === '[DONE]') { done = true; return; }
    let evt;
    try { evt = JSON.parse(raw); } catch { return; }
    if (prov.sse === 'openai') {
      const delta = evt.choices?.[0]?.delta?.content;
      if (delta) { fullText += delta; onChunk(delta); }
      if (evt.usage) { inTok = evt.usage.prompt_tokens || 0; outTok = evt.usage.completion_tokens || 0; onUsage(inTok, outTok); }
      if (evt.choices?.[0]?.finish_reason === 'stop') done = true;
    } else if (prov.sse === 'gemini') {
      const delta = (evt.candidates?.[0]?.content?.parts || []).map(p => p.text || '').join('');
      if (delta) { fullText += delta; onChunk(delta); }
      if (evt.usageMetadata) { inTok = evt.usageMetadata.promptTokenCount || 0; outTok = evt.usageMetadata.candidatesTokenCount || 0; onUsage(inTok, outTok); }
    } else if (prov.sse === 'anthropic') {
      if (evt.type === 'content_block_delta' && evt.delta?.type === 'text_delta' && evt.delta.text) { fullText += evt.delta.text; onChunk(evt.delta.text); }
      else if (evt.type === 'message_start') { inTok = evt.message?.usage?.input_tokens || 0; onUsage(inTok, outTok); }
      else if (evt.type === 'message_delta') { outTok = evt.usage?.output_tokens || outTok; onUsage(inTok, outTok); }
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
      if (!line.startsWith('data:')) continue; // ข้าม event:/comment/keep-alive
      handleData(line.slice(5).trim());
      if (done) break;
    }
  }
  reader.cancel().catch(() => {});
  return fullText;
}

// ── Provider / Model selection UI ──
function defaultModelFor(provName) {
  return provName === 'openrouter' ? 'deepseek/deepseek-chat' : PROVIDERS[provName].models[0][1][0][0];
}

function renderProviderSelect(sel, current) {
  if (!sel) return;
  sel.innerHTML = Object.entries(PROVIDERS).map(([id, p]) =>
    `<option value="${id}">${p.label}${getApiKey(id) ? '' : ' ⚠'}</option>`).join('');
  sel.value = current;
}

function renderModelSelect(sel, provName, selected, includeCustomOption = true) {
  if (!sel) return;
  const prov = PROVIDERS[provName];
  let found = false;
  let html = '';
  // ✅ ถ้า fetch รายการโมเดลจาก API มาแล้ว → ใช้รายการนั้น (item 3: fetch อย่างเดียว)
  const fetched = _fetchedModels[provName];
  if (fetched && fetched.length) {
    const opts = fetched.map(m => {
      if (m.id === selected) found = true;
      return `<option value="${m.id}">${esc(m.label || m.id)}</option>`;
    }).join('');
    html += `<optgroup label="จาก API (${fetched.length} โมเดล)">${opts}</optgroup>`;
  } else {
    // ยังไม่ได้ fetch → ใช้รายการตั้งต้น (กดปุ่ม 🔄 เพื่อดึงจาก API)
    for (const [group, items] of prov.models) {
      const opts = items.map(([id, label]) => {
        if (id === selected) found = true;
        return `<option value="${id}">${label}</option>`;
      }).join('');
      html += group ? `<optgroup label="${group}">${opts}</optgroup>` : opts;
    }
  }
  if (selected && !found) html += `<option value="${selected}">⭐ ${selected}</option>`;
  sel.innerHTML = html;
  sel.value = selected || defaultModelFor(provName);
}

// sync provider+model selects ทั้ง quick bar และหน้า settings จากค่าใน workspace
// (ไม่มี workspace → แสดง default openrouter เพื่อให้แท็บแปลใช้งานได้)
function renderProviderUI() {
  const provName = getProvider();
  const model = S.currentWs?.settings?.translateModel || defaultModelFor(provName);
  renderProviderSelect(document.getElementById('translateProvider'), provName);
  renderProviderSelect(document.getElementById('wsProviderSelect'), provName);
  renderModelSelect(document.getElementById('translateModel'), provName, model);
  renderModelSelect(document.getElementById('wsTranslateModel'), provName, model);
  ctxUpdateTokenMeter();
}

async function onProviderChange(p) {
  if (!S.currentWs || !PROVIDERS[p]) return;
  S.currentWs.settings = { ...(S.currentWs.settings || {}), aiProvider: p, translateModel: defaultModelFor(p) };
  await lsSaveWorkspace(S.currentWs);
  renderProviderUI();
  checkHealth();
  if (!getApiKey(p)) showToast(`ยังไม่มี API Key ของ ${PROVIDERS[p].label} — ตั้งได้ที่ ⚙ ตั้งค่า API Key`, '');
}

async function onModelChange(v) {
  if (!S.currentWs || !v) return;
  S.currentWs.settings = { ...(S.currentWs.settings || {}), translateModel: v };
  await lsSaveWorkspace(S.currentWs);
  renderProviderUI();
  ctxUpdateTokenMeter();
}

// ═══════════════════════════════════════════════
// ─── Fetch Models จาก API ของ provider (item 3) ──
// ═══════════════════════════════════════════════
const _fetchedModels = {};      // provName → [{ id, label, context }]
const _modelContextMap = {};    // model id → context window (tokens)
const LS_KEY_MODELS = 'nt8_fetched_models';

// แปลง response ของแต่ละ provider → [{ id, label, context }]
function parseModelsResponse(provName, json) {
  try {
    if (provName === 'gemini') {
      return (json.models || [])
        .filter(m => !m.supportedGenerationMethods || m.supportedGenerationMethods.includes('generateContent'))
        .map(m => ({
          id: String(m.name || '').replace(/^models\//, ''),
          label: m.displayName || String(m.name || '').replace(/^models\//, ''),
          context: m.inputTokenLimit || null,
        }))
        .filter(m => m.id);
    }
    if (provName === 'anthropic') {
      return (json.data || []).map(m => ({ id: m.id, label: m.display_name || m.id, context: 200000 })).filter(m => m.id);
    }
    // openrouter / openai / deepseek → OpenAI-style { data: [{ id, name, context_length }] }
    return (json.data || []).map(m => ({
      id: m.id,
      label: m.name ? `${m.name}` : m.id,
      context: m.context_length || m.context_window || null,
    })).filter(m => m.id);
  } catch { return []; }
}

async function fetchModels(provName) {
  const prov = PROVIDERS[provName];
  if (!prov || !prov.testEndpoint) throw new Error('provider ไม่รองรับการ fetch');
  const key = getApiKey(provName);
  if (!key) throw new Error(`ยังไม่ได้ตั้ง API Key ของ ${prov.label}`);
  const { url, headers } = prov.testEndpoint(key);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), getTimeoutMs('chunk'));
  let res;
  try {
    res = await fetch(url, { headers, signal: ctrl.signal });
  } catch (e) {
    throw aiNetworkError(prov, provName);
  } finally { clearTimeout(timer); }
  if (!res.ok) throw await aiHttpError(prov, res);
  const json = await res.json();
  let list = parseModelsResponse(provName, json);
  // เรียงตามชื่อ
  list.sort((a, b) => (a.label || a.id).localeCompare(b.label || b.id));
  _fetchedModels[provName] = list;
  list.forEach(m => { if (m.context) _modelContextMap[m.id] = m.context; });
  saveFetchedModelsCache();
  return list;
}

function saveFetchedModelsCache() {
  try {
    localStorage.setItem(LS_KEY_MODELS, JSON.stringify({ models: _fetchedModels, ctx: _modelContextMap }));
  } catch {}
}

function loadFetchedModelsCache() {
  try {
    const raw = JSON.parse(localStorage.getItem(LS_KEY_MODELS) || '{}');
    Object.assign(_fetchedModels, raw.models || {});
    Object.assign(_modelContextMap, raw.ctx || {});
  } catch {}
}

// ปุ่ม 🔄 ใน UI — ดึงรายการโมเดลของ provider ปัจจุบันแล้ว refresh dropdown
async function onFetchModels(btn) {
  const provName = getProvider();
  const label = btn ? btn.textContent : '';
  if (btn) { btn.disabled = true; btn.textContent = '⏳'; }
  try {
    const list = await fetchModels(provName);
    renderProviderUI();
    showToast(`ดึง ${list.length} โมเดลจาก ${PROVIDERS[provName].label} แล้ว ✓`, 'success');
  } catch (e) {
    showToast(e.message || 'ดึงรายการโมเดลไม่สำเร็จ', 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = label || '🔄'; }
  }
}

// ── ขนาด context window ของโมเดล (tokens) — ใช้กับมิเตอร์ (item 4) ──
// ลำดับการหา: รายการที่ fetch มา → ตารางค่าที่รู้จัก → เดาจากชื่อ → ค่า default
const KNOWN_MODEL_CONTEXT = [
  [/gemini-2\.5|gemini-2\.0|gemini-1\.5/i, 1048576],
  [/gpt-5|gpt-4\.1/i, 1047576],
  [/gpt-4o/i, 128000],
  [/claude/i, 200000],
  [/deepseek/i, 128000],
  [/grok-4/i, 256000],
  [/llama-4/i, 1048576],
  [/llama-3/i, 131072],
];
function getModelContextWindow(model) {
  if (!model) return 128000;
  const bare = model.includes(':') ? model.split(':').pop() : (model.includes('/') ? model.split('/').pop() : model);
  if (_modelContextMap[model]) return _modelContextMap[model];
  if (_modelContextMap[bare]) return _modelContextMap[bare];
  for (const [re, ctx] of KNOWN_MODEL_CONTEXT) if (re.test(model)) return ctx;
  return 128000; // default ปลอดภัย
}

// ประมาณจำนวน token จากข้อความ (heuristic ครอบคลุมหลายภาษา)
// อังกฤษ ~4 ตัวอักษร/token, CJK/ไทย token หนาแน่นกว่า → ใช้ ~2 ตัวอักษร/token เป็นค่ากลาง
function estimateTokens(text) {
  if (!text) return 0;
  const s = String(text);
  const cjk = (s.match(/[ᄀ-ᇿ⺀-꓏가-힯豈-﫿฀-๿]/g) || []).length;
  const rest = s.length - cjk;
  return Math.ceil(cjk / 1.2 + rest / 4);
}

const MODEL_COSTS = {
  // Google
  'google/gemini-2.5-flash':           { in: 0.15,  out: 0.60 },
  'google/gemini-2.5-flash-lite':      { in: 0.075, out: 0.30 },
  'google/gemini-2.5-pro':             { in: 1.25,  out: 10.0 },
  'google/gemini-2.0-flash-001':       { in: 0.10,  out: 0.40 },
  'google/gemini-1.5-flash':           { in: 0.075, out: 0.30 },
  // OpenAI
  'openai/gpt-5-nano':                 { in: 0.15,  out: 0.60 },
  'openai/gpt-5':                      { in: 5.00,  out: 25.0 },
  'openai/gpt-4.1-nano':               { in: 0.10,  out: 0.40 },
  'openai/gpt-4o-mini':                { in: 0.15,  out: 0.60 },
  'openai/gpt-4o':                     { in: 2.50,  out: 10.0 },
  'openai/gpt-oss-120b':               { in: 1.00,  out: 4.00 },
  // DeepSeek
  'deepseek/deepseek-v3.2':            { in: 0.14,  out: 0.28 },
  'deepseek/deepseek-chat-v3-0324':    { in: 0.14,  out: 0.28 },
  'deepseek/deepseek-chat':            { in: 0.14,  out: 0.28 },
  'deepseek/deepseek-r1':              { in: 0.55,  out: 2.19 },
  // xAI
  'x-ai/grok-4':                       { in: 3.00,  out: 15.0 },
  'x-ai/grok-4-fast':                  { in: 0.20,  out: 0.50 },
  // Anthropic / Meta
  'anthropic/claude-haiku-4.5':        { in: 0.80,  out: 4.00 },
  'anthropic/claude-3-haiku':          { in: 0.25,  out: 1.25 },
  'meta-llama/llama-3.3-70b-instruct:free': { in: 0, out: 0 },
  'meta-llama/llama-4-scout:free':     { in: 0,     out: 0 },
  // ── Direct providers (namespaced 'provider:model') ──
  'gemini:gemini-2.5-flash':           { in: 0.30,  out: 2.50 },
  'gemini:gemini-2.5-flash-lite':      { in: 0.10,  out: 0.40 },
  'gemini:gemini-2.5-pro':             { in: 1.25,  out: 10.0 },
  'gemini:gemini-2.0-flash':           { in: 0.10,  out: 0.40 },
  'openai:gpt-5-nano':                 { in: 0.05,  out: 0.40 },
  'openai:gpt-5-mini':                 { in: 0.25,  out: 2.00 },
  'openai:gpt-5':                      { in: 1.25,  out: 10.0 },
  'openai:gpt-4.1-nano':               { in: 0.10,  out: 0.40 },
  'openai:gpt-4o-mini':                { in: 0.15,  out: 0.60 },
  'openai:gpt-4o':                     { in: 2.50,  out: 10.0 },
  'anthropic:claude-haiku-4-5':        { in: 1.00,  out: 5.00 },
  'anthropic:claude-sonnet-4-6':       { in: 3.00,  out: 15.0 },
  'anthropic:claude-opus-4-8':         { in: 5.00,  out: 25.0 },
  'deepseek:deepseek-chat':            { in: 0.27,  out: 1.10 },
  'deepseek:deepseek-reasoner':        { in: 0.55,  out: 2.19 },
};

function addCosts(inputTok, outputTok, model, provider) {
  const prov = provider || getProvider();
  const rates = MODEL_COSTS[prov + ':' + model] || MODEL_COSTS[model] || { in: 0.1, out: 0.3 };  // fallback ใช้ค่ากลาง ไม่เกินจริง
  const usd = (inputTok / 1e6 * rates.in) + (outputTok / 1e6 * rates.out);
  // ─ Global cost ─
  S.costs.tokens.input += inputTok;
  S.costs.tokens.output += outputTok;
  S.costs.tokens.total += inputTok + outputTok;
  S.costs.costUSD += usd;
  S.costs.costTHB = S.costs.costUSD * 35;
  localStorage.setItem(LS_KEY_COSTS, JSON.stringify(S.costs));
  // ─ Per-Workspace cost ─
  if (S.currentWs) {
    if (!S.currentWs.costs) S.currentWs.costs = { tokens: { total:0, input:0, output:0 }, costUSD:0 };
    S.currentWs.costs.tokens.input  += inputTok;
    S.currentWs.costs.tokens.output += outputTok;
    S.currentWs.costs.tokens.total  += inputTok + outputTok;
    S.currentWs.costs.costUSD       += usd;
    // debounce save (ไม่ save ทุก chunk)
    clearTimeout(S._costSaveTimer);
    S._costSaveTimer = setTimeout(() => lsSaveWorkspace(S.currentWs).catch(() => {}), 3000);
  }
  updateCostUI();
}

function fmtUSD(v) {
  // C2: แสดง 4 ทศนิยมถ้า < $0.01, ไม่งั้น 2 ทศนิยม
  if (v === 0) return '$0.0000';
  return v < 0.01 ? '$' + v.toFixed(4) : '$' + v.toFixed(2);
}

function updateCostUI() {
  const c = S.costs;
  document.getElementById('totalTokens').textContent = c.tokens.total.toLocaleString();
  document.getElementById('inputTokens').textContent = c.tokens.input.toLocaleString();
  document.getElementById('outputTokens').textContent = c.tokens.output.toLocaleString();
  document.getElementById('costUSD').textContent = fmtUSD(c.costUSD);
  document.getElementById('costTHB').textContent = '฿' + c.costTHB.toFixed(2);
  document.getElementById('costBadge').textContent = fmtUSD(c.costUSD);
  document.getElementById('costMini').textContent = fmtUSD(c.costUSD);
  // Per-WS cost
  const wc = S.currentWs?.costs;
  const wsUSD = document.getElementById('wsOwnCostUSD');
  const wsTok = document.getElementById('wsOwnTokens');
  if (wsUSD) wsUSD.textContent = fmtUSD(wc?.costUSD || 0);
  if (wsTok) wsTok.textContent = (wc?.tokens?.total || 0).toLocaleString();
}

function resetWsCosts() {
  if (!S.currentWs) return;
  if (!confirm('รีเซ็ต cost ของ Workspace นี้?')) return;
  S.currentWs.costs = { tokens: { total:0, input:0, output:0 }, costUSD:0 };
  lsSaveWorkspace(S.currentWs).catch(() => {});
  updateCostUI();
  showToast('รีเซ็ต cost ของ Workspace นี้แล้ว', 'success');
}

