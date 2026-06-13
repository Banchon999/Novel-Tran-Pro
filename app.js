// ═══════════════════════════════════════════════
// NovelTrans v10 Pro — Multi-file Edition
// IndexedDB backend + OpenRouter API (SSE streaming)
// ═══════════════════════════════════════════════
'use strict';

// ─── State ───
const S = {
  currentWsId: null,
  currentWs: null,
  currentTab: 'translate',
  translating: false,
  editingChapterId: null,
  editingStyleId: null,
  editingGlossaryKorean: null,
  activeStyleId: '',
  glossaryData: [],
  costs: { tokens: { total:0, input:0, output:0 }, costUSD:0, costTHB:0 },
  abortCtrl: null,  // ← global AbortController สำหรับหยุดการแปลได้จริง
};

// ─── Styles & Presets ───
// ทั้ง Style และ Translation Preset เป็น "ของผู้ใช้" ทั้งหมด (เก็บใน workspace)
// ค่าด้านล่างเป็นเพียง "ตัวอย่างเริ่มต้น" ที่จะถูก seed ให้ workspace ใหม่ — ผู้ใช้แก้/ลบได้อิสระ
const SEED_STYLES = [
  { id: 'sample-natural', emoji: '🌿', name: 'Natural (ตัวอย่าง)', prompt: 'แปลให้เป็นธรรมชาติ อ่านง่าย เหมือนนิยายไทยต้นฉบับ' },
];

// ─── Translation Presets (ตัวอย่างเริ่มต้น) ───
const SEED_PRESETS = [
  {
    id: 'sample-literary', name: 'นิยาย (ตัวอย่าง)', emoji: '📖',
    temperature: 0.65, polish: true,
    systemPrompt: `You are a professional Korean → Thai literary webnovel translator.

CORE MISSION: Produce Thai prose that reads like it was written by a gifted Thai novelist — not a translation. Preserve the author's voice, rhythm, and emotional depth.

TRANSLATION PRINCIPLES:
• Write naturally in Thai: transform Korean structures into authentic Thai syntax
• Preserve the author's tone: lyrical, epic, dark, or intimate
• Use rich, precise vocabulary — avoid flat or generic choices
• Action scenes: punchy, visceral, rhythmic
• Internal monologue: natural Thai first-person
• Preserve all paragraph breaks and pacing exactly
• Do not add, omit, or summarize any content

THAI PRONOUN RULES — CRITICAL, NO EXCEPTIONS:
• Male characters → 3rd: เขา/ของเขา | 1st (speech & narration): ผม/กู/ข้า (match register). NEVER use ฉัน/เธอ for males.
• Female characters → 3rd: เธอ/นาง/ของเธอ | 1st (speech & narration): ฉัน/หนู/อิฉัน. NEVER use ผม/กู for females.
• Unknown gender → เขา (3rd) / ฉัน (1st) as default
• NARRATOR PRONOUN: First-person narration (나/저) → use narrator's gender from glossary. Male narrator → ผม. Female narrator → ฉัน. Do NOT default to ผม without checking glossary first.

INTERPRETIVE DEPTH:
• Before translating, identify who is speaking/thinking, the emotion, and the scene's narrative purpose.
• Convey subtext and feeling — not just words. The reader must experience the character's inner world.
• Rhythm: short, staccato sentences for action; flowing, lyrical prose for inner reflection.
{style_note}
GLOSSARY:
{glossary}

{context}
Translate the following Korean text into beautiful Thai prose. Output ONLY the Thai translation, nothing else:

{text}`,
  },
];

// ─── User Styles & Presets helpers ───
// รับประกันว่า workspace มี style/preset ของผู้ใช้อย่างน้อย 1 รายการ (seed ตัวอย่างให้ครั้งแรก)
function ensureWsStylesPresets(ws) {
  if (!ws) return ws;
  if (!Array.isArray(ws.customStyles)) ws.customStyles = [];
  if (ws.customStyles.length === 0) ws.customStyles = SEED_STYLES.map(s => ({ ...s }));
  if (!Array.isArray(ws.presets)) {
    // migrate prompt ที่ผู้ใช้เคย customize ไว้บน built-in preset เดิม → กลายเป็น preset ของผู้ใช้
    const migrated = [];
    if (ws.customPresets && typeof ws.customPresets === 'object') {
      for (const [key, v] of Object.entries(ws.customPresets)) {
        if (v && v.systemPrompt) {
          migrated.push({
            id: 'preset-' + key, name: key, emoji: '📖',
            systemPrompt: v.systemPrompt,
            temperature: (v.temperature !== undefined ? v.temperature : 0.6),
            polish: false,
          });
        }
      }
    }
    ws.presets = migrated.length ? migrated : SEED_PRESETS.map(p => ({ ...p }));
    delete ws.customPresets;
  }
  if (ws.presets.length === 0) ws.presets = SEED_PRESETS.map(p => ({ ...p }));
  if (!ws.presetId || !ws.presets.some(p => p.id === ws.presetId)) {
    ws.presetId = ws.presets[0]?.id || '';
  }
  return ws;
}

// ตรวจว่า preset เป็นโหมดแก้ MTL หรือไม่ (มี placeholder {mtl_draft})
function presetIsMtlFix(p) {
  return !!(p && typeof p.systemPrompt === 'string' && p.systemPrompt.includes('{mtl_draft}'));
}

function getStyleById(id) {
  if (!id) return null;
  return (S.currentWs?.customStyles || []).find(s => s.id === id) || null;
}

function getActivePreset(ws) {
  const list = (ws && Array.isArray(ws.presets)) ? ws.presets : [];
  return list.find(p => p.id === ws?.presetId) || list[0] || SEED_PRESETS[0];
}

function buildTranslatePrompt({ sourceText, glossaryStr = '', contextStr = '', styleNote = '', ws = null, mtlDraft = '' }) {
  const preset = getActivePreset(ws);
  return preset.systemPrompt
    .replace('{style_note}', styleNote ? `STYLE GUIDE:\n${styleNote}\n` : '')
    .replace('{glossary}',   glossaryStr || '(ไม่มี)')
    .replace('{context}',   contextStr)
    .replace('{text}',      sourceText)
    .replace('{mtl_draft}', mtlDraft || '(ไม่มี MTL draft)');
}

// ─── Prompts ───
const TRANSLATE_PROMPT = `You are a professional Korean → Thai webnovel translator specializing in fantasy, martial arts, and action genres.

TRANSLATION RULES:
• Maintain natural, immersive Thai narrative flow — write like a Thai novelist, not a translator
• Follow the glossary strictly — never deviate from established terms
• Preserve the original tone: serious, epic, cinematic
• Do NOT translate proper names unless they appear in the glossary
• Keep action scenes punchy and visceral
• Render internal monologue in natural Thai first-person
• Preserve paragraph structure exactly
• Do not add or omit any sentences

THAI PRONOUN RULES — CRITICAL, NO EXCEPTIONS:
• Male characters (gender:male) → 3rd-person: เขา/ของเขา — 1st-person (speech & narration): ผม / กู / ข้า (match story register). NEVER use เธอ/นาง for males.
• Female characters (gender:female) → 3rd-person: เธอ/นาง/ของเธอ — 1st-person (speech & narration): ฉัน / หนู / ข้าพเจ้า. NEVER use ผม/กู for females.
• Unknown gender → use เขา (3rd) / ฉัน (1st) as default until clarified.
• Apply these pronouns consistently for BOTH dialogue AND first-person narration.
• NARRATOR PRONOUN: When translating first-person narration (나/저 in Korean), use the narrator/protagonist's gender from glossary — NOT a generic default. Male narrator → ผม; Female narrator → ฉัน.

INTERPRETIVE DEPTH — READ, DON'T JUST TRANSLATE:
• Before translating each passage, identify: who is speaking/thinking/acting, the emotion, and the scene's purpose.
• Convey feeling and subtext — the reader should experience what the character experiences.
• Match sentence rhythm to the scene: short punchy sentences for action, flowing prose for reflection.

{style_note}

GLOSSARY (Korean = Thai translation | gender | pronoun guide):
{glossary}

{context}

Translate the following Korean text into Thai. Output ONLY the Thai translation, nothing else:

{text}`;

const POLISH_PROMPT = `You are a Thai literary editor specializing in webnovel polish and refinement.

Refine this Thai translation for natural flow, readability, and narrative immersion.

RULES: Fix unnatural structures, improve word choices, ensure smooth flow. Do NOT change meaning. Keep dark fantasy tone.

GLOSSARY (preserve these terms):
{glossary}

Refine the following Thai translation. Output ONLY the polished Thai text, nothing else:

{text}`;

const QA_PROMPT = `You are a QA specialist for Korean → Thai webnovel translation. Analyze translation quality and return JSON.

CHECK FOR: glossary violations, missing content, hallucinations, mistranslations, name consistency.

GLOSSARY: {glossary}
SOURCE (Korean): {source}
TRANSLATION (Thai): {translation}

Respond ONLY with JSON (no markdown):
{"pass":true,"score":0-100,"issues":[{"type":"string","description":"string","suggestion":"string"}],"summary":"string"}`;

const AUTOGLOSSARY_PROMPT = `You are a Korean webnovel terminology extractor. Extract proper nouns and special terms from Korean text.

EXISTING GLOSSARY (skip these): {existing}

KOREAN SOURCE TEXT:
{text}

{thai_snippet}

Return ONLY JSON array (no markdown):
[{"korean":"term","thai":"Thai translation","type":"character|title|rank|term|honorific|place","gender":"male|female|neutral","note":"English meaning"}]

Rules:
- Only extract names, titles, skills, places, ranks — NOT common words
- Provide natural Thai translations
- type must be one of: character, title, rank, term, honorific, place
- gender: REQUIRED for type="character". Infer carefully from ALL available cues — but accuracy matters more than confidence:
  • Korean pronouns (strongest signal): 그/남자/형/오빠/아버지/아들/왕/황제/그는/그가 = male | 그녀/여자/언니/누나/어머니/딸/왕비/그녀는/그녀가 = female
  • Korean kinship terms used FOR the character: 형/오빠/아버지/할아버지 = male | 언니/누나/어머니/할머니 = female
  • Korean dialogue honorifics when others address the character: ~씨/~님 is neutral; 여왕/공주 = female; 왕자/황자 = male
  • Thai translation pronouns if provided (strong signal): เขา/ผม/กู/ท่าน(masc context) = male | เธอ/นาง/ฉัน/หนู = female
  • Korean fantasy name patterns: names ending in 아/야/이 with feminine context = likely female; strong warrior names without feminine markers = likely male
  • First-person Korean 나/저 does NOT indicate gender — look at surrounding context instead
  • CAUTION for chapter 1 / first appearance: If cues are ambiguous or mixed, assign "neutral" — it is BETTER to be neutral and correct later than to assign wrong gender permanently.
  • Only assign male/female when you are CONFIDENT from at least one clear signal above.
- Return empty array [] if no new terms found`;

const CHAPTER_SUMMARY_PROMPT = `You are a Thai webnovel chapter summarizer. Summarize the key context from this Thai translation chapter.

OUTPUT FORMAT — respond ONLY with this structure, no extra text:
ตัวละคร: [ชื่อตัวละครที่ปรากฏ พร้อมบทบาทสั้นๆ]
เหตุการณ์: [สิ่งที่เกิดขึ้นในตอนนี้ 2-3 ประโยค]
ค้างอยู่: [สิ่งที่ยังไม่ได้รับการแก้ไข หรือเหตุการณ์ที่กำลังจะเกิดขึ้น]
สำนวน: [tone และรูปแบบภาษาที่ใช้ เช่น epic, มืดหม่น, ตลก]

TEXT (Thai translation of chapter {chapter_num} "{chapter_title}"):
{text}`;

// ─── Storage: costs & API key stay in localStorage (tiny), workspaces → IndexedDB ───
const LS_KEY_COSTS = 'nt8_costs';
const LS_KEY_API   = 'nt8_apikey';

// ── IndexedDB wrapper ──
const IDB_NAME    = 'NovelTransDB';
const IDB_VERSION = 1;
let _idb = null;

function idbOpen() {
  if (_idb) return Promise.resolve(_idb);
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, IDB_VERSION);
    req.onupgradeneeded = e => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('workspaces')) db.createObjectStore('workspaces', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('meta'))       db.createObjectStore('meta');
    };
    req.onsuccess = e => { _idb = e.target.result; resolve(_idb); };
    req.onerror   = e => reject(e.target.error);
  });
}

function idbGet(store, key) {
  return idbOpen().then(db => new Promise((resolve, reject) => {
    const tx  = db.transaction(store, 'readonly');
    const req = tx.objectStore(store).get(key);
    req.onsuccess = () => resolve(req.result ?? null);
    req.onerror   = () => reject(req.error);
  }));
}

function idbPut(store, value, key) {
  return idbOpen().then(db => new Promise((resolve, reject) => {
    const tx  = db.transaction(store, 'readwrite');
    const req = key !== undefined ? tx.objectStore(store).put(value, key) : tx.objectStore(store).put(value);
    req.onsuccess = () => resolve();
    req.onerror   = (e) => {
      const err = e.target.error;
      if (err?.name === 'QuotaExceededError' || err?.name === 'NS_ERROR_DOM_QUOTA_REACHED') {
        showToast('⚠ พื้นที่จัดเก็บเต็ม (IndexedDB Quota) — กรุณา Export JSON แล้วลบ Workspace เก่าออก', 'error');
      }
      reject(err);
    };
  }));
}

function idbDelete(store, key) {
  return idbOpen().then(db => new Promise((resolve, reject) => {
    const tx  = db.transaction(store, 'readwrite');
    const req = tx.objectStore(store).delete(key);
    req.onsuccess = () => resolve();
    req.onerror   = () => reject(req.error);
  }));
}

function idbGetAll(store) {
  return idbOpen().then(db => new Promise((resolve, reject) => {
    const tx  = db.transaction(store, 'readonly');
    const req = tx.objectStore(store).getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => reject(req.error);
  }));
}

// ── Workspace list stored in IDB meta ──
async function lsGetWorkspaceList() {
  return (await idbGet('meta', 'ws_list')) || [];
}
async function lsSaveWorkspaceList(list) {
  await idbPut('meta', list, 'ws_list');
}
async function lsGetWorkspace(id) {
  return (await idbGet('workspaces', id)) || null;
}
async function lsSaveWorkspace(ws) {
  await idbPut('workspaces', ws);
  const list = await lsGetWorkspaceList();
  const idx  = list.findIndex(w => w.id === ws.id);
  const meta = { id: ws.id, name: ws.name, emoji: ws.emoji || '📖', chapterCount: (ws.chapters || []).length };
  if (idx >= 0) list[idx] = meta; else list.push(meta);
  await lsSaveWorkspaceList(list);
}
async function lsDeleteWorkspace(id) {
  await idbDelete('workspaces', id);
  const list = (await lsGetWorkspaceList()).filter(w => w.id !== id);
  await lsSaveWorkspaceList(list);
}

// ── last_ws in IDB meta ──
async function getLastWs()       { return (await idbGet('meta', 'last_ws')) || null; }
async function setLastWs(id)     { await idbPut('meta', id, 'last_ws'); }
async function clearLastWs()     { await idbDelete('meta', 'last_ws'); }

// ── Migration: move old localStorage workspaces into IDB (runs once) ──
async function migrateFromLocalStorage() {
  const migrated = localStorage.getItem('nt8_idb_migrated');
  if (migrated) return;
  try {
    let oldList;
    try { oldList = JSON.parse(localStorage.getItem('nt8_workspaces') || '[]'); }
    catch { oldList = []; }

    if (!oldList.length) { localStorage.setItem('nt8_idb_migrated', '1'); return; }

    let count = 0, skipped = 0;
    for (const meta of oldList) {
      const raw = localStorage.getItem('nt8_ws_' + meta.id);
      if (!raw) { skipped++; continue; }
      try {
        const ws = JSON.parse(raw);
        await idbPut('workspaces', ws);
        count++;
      } catch(parseErr) {
        // Truncated JSON — try to salvage: keep the meta entry so user knows it existed
        console.warn(`Migration: workspace ${meta.id} "${meta.name}" has corrupt JSON, skipping`);
        skipped++;
      }
    }

    await idbPut('meta', oldList.slice(), 'ws_list');
    const lastWs = localStorage.getItem('nt8_last_ws');
    if (lastWs) await idbPut('meta', lastWs, 'last_ws');

    // Clean up old keys only for successfully migrated workspaces
    for (const meta of oldList) localStorage.removeItem('nt8_ws_' + meta.id);
    localStorage.removeItem('nt8_workspaces');
    localStorage.removeItem('nt8_last_ws');
    localStorage.setItem('nt8_idb_migrated', '1');

    if (count) showToast(`✓ ย้ายข้อมูล ${count} Workspace มา IndexedDB แล้ว`, 'success');
    if (skipped) {
      setTimeout(() => showToast(`⚠ ${skipped} Workspace มีข้อมูลเสียหาย (localStorage เต็ม) — ใช้ Import JSON แทน`, 'error'), 2000);
    }
  } catch(e) {
    console.warn('Migration failed:', e);
    localStorage.setItem('nt8_idb_migrated', '1');
  }
}

function genId() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }

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
  for (const [group, items] of prov.models) {
    const opts = items.map(([id, label]) => {
      if (id === selected) found = true;
      return `<option value="${id}">${label}</option>`;
    }).join('');
    html += group ? `<optgroup label="${group}">${opts}</optgroup>` : opts;
  }
  // custom model id ที่ผู้ใช้เคยเพิ่มของ provider นี้
  for (const id of (S.currentWs?.settings?.customModels?.[provName] || [])) {
    if (id === selected) found = true;
    html += `<option value="${id}">⭐ ${id}</option>`;
  }
  if (selected && !found) html += `<option value="${selected}">⭐ ${selected}</option>`;
  if (includeCustomOption) html += `<option value="__custom__">✏ กำหนดเอง…</option>`;
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
  if (!S.currentWs) return;
  const provName = getProvider();
  if (v === '__custom__') {
    const id = prompt(`ใส่ model id ของ ${PROVIDERS[provName].label} (เช่น ${defaultModelFor(provName)}):`);
    if (!id || !id.trim()) { renderProviderUI(); return; }
    v = id.trim();
    const cm = S.currentWs.settings?.customModels || {};
    cm[provName] = [...new Set([...(cm[provName] || []), v])];
    S.currentWs.settings = { ...(S.currentWs.settings || {}), customModels: cm };
  }
  S.currentWs.settings = { ...(S.currentWs.settings || {}), translateModel: v };
  await lsSaveWorkspace(S.currentWs);
  renderProviderUI();
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

// ─── Keyboard Shortcuts ───
document.addEventListener('keydown', (e) => {
  const tag = document.activeElement?.tagName;
  const isInput = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';

  // Esc — ปิด modal ที่เปิดอยู่
  if (e.key === 'Escape') {
    const open = document.querySelector('.modal-backdrop.open, .modal-backdrop[style*="flex"]');
    if (open) { closeModal(open.id); e.preventDefault(); return; }
  }

  // Ctrl/Cmd + Enter — เริ่มแปล (เฉพาะใน translate tab)
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
    if (S.currentTab === 'translate' && !S.translating) {
      e.preventDefault();
      const translateBtn = document.getElementById('translateBtn') || document.querySelector('[onclick*="startTranslation"]');
      if (translateBtn && !translateBtn.disabled) translateBtn.click();
    }
    return;
  }

  // Ctrl/Cmd + S — บันทึก chapter (เมื่อ modal-view-chapter เปิด)
  if ((e.ctrlKey || e.metaKey) && e.key === 's') {
    const chModal = document.getElementById('modal-view-chapter');
    if (chModal && (chModal.classList.contains('open') || chModal.style.display !== 'none')) {
      e.preventDefault();
      saveChapter();
    }
    return;
  }

  // Ctrl/Cmd + F — focus search (ใน chapters/glossary tab)
  if ((e.ctrlKey || e.metaKey) && e.key === 'f' && !isInput) {
    const searchBox = S.currentTab === 'glossary'
      ? document.getElementById('glossarySearch')
      : document.getElementById('chapterSearch');
    if (searchBox) { e.preventDefault(); searchBox.focus(); searchBox.select(); }
  }
});

// ─── Init ───
document.addEventListener('DOMContentLoaded', async () => {
  // Load costs (still in localStorage — tiny)
  try { S.costs = JSON.parse(localStorage.getItem(LS_KEY_COSTS)) || S.costs; } catch {}
  updateCostUI();
  checkHealth();
  document.getElementById('sourceText').addEventListener('input', updateSourceStats);

  // Migrate old localStorage data → IndexedDB (runs once)
  await migrateFromLocalStorage();

  await loadWorkspaceList();

  const lastWs = await getLastWs();
  if (lastWs) await selectWorkspace(lastWs);
  else renderProviderUI(); // ไม่มี workspace ก็ยังต้องมีรายการ provider/model ใน quick bar

  checkBackupReminderOnLoad();
});

// ─── Health ───
function checkHealth() {
  const dot = document.getElementById('statusDot');
  const txt = document.getElementById('statusText');
  const provName = getProvider();
  const label = PROVIDERS[provName].label;
  if (getApiKey(provName)) {
    dot.className = 'status-dot ok';
    txt.textContent = `${label}: Key พร้อมใช้`;
  } else {
    dot.className = 'status-dot error';
    txt.textContent = `${label}: ยังไม่ได้ตั้ง Key`;
  }
}

// ─── Sidebar ───
function openSidebar() {
  document.getElementById('sidebar').classList.add('open');
  document.getElementById('sidebarOverlay').classList.add('active');
}
function closeSidebar() {
  document.getElementById('sidebar').classList.remove('open');
  document.getElementById('sidebarOverlay').classList.remove('active');
}

// ─── Workspace List ───
async function loadWorkspaceList() {
  const list = await lsGetWorkspaceList();
  S.wsList = list; // track for backup reminder
  const el = document.getElementById('wsList');
  if (!list.length) {
    el.innerHTML = '<div style="font-size:0.75rem;color:var(--text-muted);padding:6px 0">ยังไม่มี Workspace</div>';
    return;
  }
  el.innerHTML = list.map(w => `
    <div class="ws-item ${S.currentWsId === w.id ? 'active' : ''}" onclick="selectWorkspace('${w.id}')">
      <span class="ws-emoji">${w.emoji || '📖'}</span>
      <div class="ws-info">
        <div class="ws-name">${esc(w.name)}</div>
        <div class="ws-meta">${w.chapterCount || 0} ตอน</div>
      </div>
    </div>
  `).join('');
}

async function selectWorkspace(id) {
  // ปิด reader + ยกเลิก prefetch ก่อนสลับ workspace (กันแปลข้ามเรื่อง)
  if (typeof rState !== 'undefined' && rState.active) closeReader();
  const ws = await lsGetWorkspace(id);
  if (!ws) { showToast('ไม่พบ Workspace', 'error'); return; }
  ensureWsStylesPresets(ws);
  S.currentWsId = id;
  S.currentWs = ws;
  S.glossaryData = ws.glossary || [];
  await setLastWs(id);
  populateGlossaryTypeSelects(); // custom types ของ workspace นี้ (รวม filter)

  document.getElementById('noWsMsg').style.display = 'none';
  document.getElementById('wsContent').className = 'ws-content-visible';
  document.getElementById('wsNameHeader').textContent = `${ws.emoji || '📖'} ${ws.name}`;

  renderProviderUI();
  checkHealth();

  // Restore active style (ของผู้ใช้เท่านั้น) — ถ้าไม่พบ ใช้ style แรกที่มี
  const savedStyle = ws.settings?.activeStyleId;
  const styleList = ws.customStyles || [];
  if (savedStyle && styleList.some(s => s.id === savedStyle)) {
    S.activeStyleId = savedStyle;
  } else {
    S.activeStyleId = styleList[0]?.id || '';
  }

  await loadWorkspaceList();
  // reset bulk mode เมื่อเปลี่ยน workspace
  _bulkMode = false;
  const bdb = document.getElementById('bulkDeleteBar');
  const bme = document.getElementById('bulkModeEntryBar');
  if (bdb) bdb.style.display = 'none';
  if (bme) bme.style.display = 'flex';
  renderCurrentTab();
  updateChapterSaveSelect();
  renderStyleSelect();
  closeSidebar();
}

// ─── Tab Switching ───
function switchTab(tab) {
  S.currentTab = tab;
  document.querySelectorAll('.sub-tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.tab-content').forEach(c => c.style.display = 'none');
  document.querySelector(`[data-tab="${tab}"]`).classList.add('active');
  document.getElementById(`tab-${tab}`).style.display = 'flex';
  renderCurrentTab();
}

function renderCurrentTab() {
  switch (S.currentTab) {
    case 'chapters': renderChapters(); break;
    case 'glossary': renderGlossaryTable(); break;
    case 'styles': renderStyles(); break;
    case 'settings-ws': renderWsSettings(); break;
  }
}

// ─── Create Workspace ───
async function createWorkspace() {
  const name = document.getElementById('newWsName').value.trim();
  if (!name) { showToast('กรุณาใส่ชื่อนิยาย', 'error'); return; }
  const ws = {
    id: genId(),
    name,
    emoji: document.getElementById('newWsEmoji').value.trim() || '📖',
    description: document.getElementById('newWsDesc').value.trim(),
    chapters: [],
    glossary: [],
    customStyles: [],
    presets: [],
    settings: { translateModel: 'deepseek/deepseek-chat', temperature: 0.7 },
    createdAt: Date.now(),
  };
  ensureWsStylesPresets(ws);
  await lsSaveWorkspace(ws);
  closeModal('modal-new-ws');
  document.getElementById('newWsName').value = '';
  document.getElementById('newWsEmoji').value = '';
  document.getElementById('newWsDesc').value = '';
  await selectWorkspace(ws.id);
  showToast(`สร้าง "${name}" สำเร็จ`, 'success');
}

async function deleteCurrentWorkspace() {
  if (!S.currentWsId) return;
  if (!confirm(`ลบ "${S.currentWs?.name}" ทั้งหมด? ไม่สามารถกู้คืนได้`)) return;
  await lsDeleteWorkspace(S.currentWsId);
  S.currentWsId = null; S.currentWs = null;
  await clearLastWs();
  document.getElementById('noWsMsg').style.display = 'flex';
  document.getElementById('wsContent').className = 'ws-content-hidden';
  document.getElementById('wsNameHeader').textContent = '—';
  await loadWorkspaceList();
  showToast('ลบ Workspace แล้ว', '');
}

// ─── Workspace Settings ───
function renderWsSettings() {
  if (!S.currentWs) return;
  const w = S.currentWs;
  document.getElementById('wsEditName').value = w.name || '';
  document.getElementById('wsEditDesc').value = w.description || '';
  document.getElementById('wsEditEmoji').value = w.emoji || '📖';
  renderProviderUI();
  const temp = w.settings?.temperature ?? 0.7;
  document.getElementById('wsTemp').value = temp;
  document.getElementById('wsTempVal').textContent = temp;
  const autoGlossary = w.settings?.autoGlossary !== false;
  document.getElementById('wsAutoGlossary').checked = autoGlossary;
  const pcc = document.getElementById('wsPrevCtxChars');
  if (pcc) pcc.value = w.settings?.prevCtxChars || 400;
  renderPresetSelect();
  // Context Memory settings
  const ctx = wsGetContext(w);
  const ctxEnabledEl  = document.getElementById('wsCtxEnabled');
  const ctxOptionsEl  = document.getElementById('wsCtxOptions');
  const ctxMaxTokEl   = document.getElementById('wsCtxMaxTokens');
  if (ctxEnabledEl)  ctxEnabledEl.checked = ctx.enabled;
  if (ctxOptionsEl)  ctxOptionsEl.style.display = ctx.enabled ? 'block' : 'none';
  if (ctxMaxTokEl)   ctxMaxTokEl.value = String(ctx.maxTokens || 1500);
  ctxUpdateStatusBadge(w);
}

async function saveWsSettings() {
  if (!S.currentWsId) return;
  S.currentWs.name = document.getElementById('wsEditName').value.trim();
  S.currentWs.description = document.getElementById('wsEditDesc').value.trim();
  S.currentWs.emoji = document.getElementById('wsEditEmoji').value.trim() || '📖';
  const wsModelVal = document.getElementById('wsTranslateModel').value;
  S.currentWs.settings = {
    ...(S.currentWs.settings || {}),
    aiProvider: document.getElementById('wsProviderSelect')?.value || 'openrouter',
    // '__custom__' ถูก resolve แล้วใน onModelChange — กันค่าหลุดมาที่นี่
    ...(wsModelVal && wsModelVal !== '__custom__' ? { translateModel: wsModelVal } : {}),
    temperature: parseFloat(document.getElementById('wsTemp').value),
    autoGlossary: document.getElementById('wsAutoGlossary').checked,
    prevCtxChars: Math.max(100, Math.min(4000, parseInt(document.getElementById('wsPrevCtxChars')?.value) || 400)),
  };
  const presetSel = document.getElementById('wsPresetSelect');
  if (presetSel) S.currentWs.presetId = presetSel.value || (S.currentWs.presets?.[0]?.id || '');
  await lsSaveWorkspace(S.currentWs);
  document.getElementById('wsNameHeader').textContent = `${S.currentWs.emoji} ${S.currentWs.name}`;
  await loadWorkspaceList();
  showToast('บันทึกแล้ว ✓', 'success');
}

// ─── Export / Import ───
async function exportWorkspaceJSON() {
  if (!S.currentWs) return;
  const blob = new Blob([JSON.stringify(S.currentWs, null, 2)], { type: 'application/json' });
  downloadBlob(blob, `${S.currentWs.name}_noveltrans.json`);
  _markBackupDone();
  showToast('Export JSON สำเร็จ', 'success');
}

// Export ALL workspaces in one file
async function exportAllWorkspacesJSON() {
  const list = await lsGetWorkspaceList();
  if (!list.length) { showToast('ไม่มี Workspace', 'error'); return; }
  const all = [];
  for (const meta of list) {
    const ws = await lsGetWorkspace(meta.id);
    if (ws) all.push(ws);
  }
  const ts   = new Date().toISOString().slice(0, 16).replace('T', '_').replace(':', '');
  const blob = new Blob([JSON.stringify({ exportedAt: Date.now(), workspaces: all }, null, 2)], { type: 'application/json' });
  downloadBlob(blob, `NovelTrans_ALL_${ts}.json`);
  _markBackupDone();
  showToast(`Export สำเร็จ ${all.length} Workspace ✓`, 'success');
}

// ── Backup reminder system ──
const LS_LAST_BACKUP = 'nt8_last_backup_ts';
const BACKUP_WARN_HOURS = 12; // warn after 12h without backup

function _markBackupDone() {
  localStorage.setItem(LS_LAST_BACKUP, String(Date.now()));
  _updateBackupWarning();
}

function _getLastBackupTs() {
  return parseInt(localStorage.getItem(LS_LAST_BACKUP) || '0', 10);
}

function _updateBackupWarning() {
  const el = document.getElementById('backupWarnBar');
  if (!el) return;
  const ts   = _getLastBackupTs();
  const age  = (Date.now() - ts) / 3600000; // hours
  const list = S.wsList || [];
  if (!list.length) { el.style.display = 'none'; return; }

  if (ts === 0) {
    el.style.display = 'flex';
    el.innerHTML = `⚠ ยังไม่เคย Backup — ข้อมูลอาจหายถ้าเบราว์เซอร์ล้างข้อมูล &nbsp;<button class="btn-xs" onclick="exportAllWorkspacesJSON()" style="background:var(--gold);color:#000;font-weight:600">💾 Backup ทันที</button>`;
  } else if (age > BACKUP_WARN_HOURS) {
    const h = Math.floor(age);
    el.style.display = 'flex';
    el.innerHTML = `⚠ Backup ครั้งล่าสุด ${h} ชั่วโมงที่แล้ว &nbsp;<button class="btn-xs" onclick="exportAllWorkspacesJSON()" style="background:var(--gold);color:#000;font-weight:600">💾 Backup ทันที</button> <button class="btn-xs" onclick="document.getElementById('backupWarnBar').style.display='none'" style="margin-left:4px;opacity:0.6">✕</button>`;
  } else {
    el.style.display = 'none';
  }
}

async function checkBackupReminderOnLoad() {
  // Give it a moment for workspace list to load
  await new Promise(r => setTimeout(r, 1000));
  _updateBackupWarning();
}

// Warn before closing tab if backup overdue > 24h
window.addEventListener('beforeunload', (e) => {
  const ts  = _getLastBackupTs();
  const age = (Date.now() - ts) / 3600000;
  if ((ts === 0 || age > 24) && (S.wsList?.length > 0)) {
    e.preventDefault();
    e.returnValue = 'ยังไม่ได้ Backup Workspace — ต้องการออกใช่ไหม?';
  }
});

// ─── Glossary Inheritance (import from another WS) ───
async function openGlossaryInherit() {
  if (!S.currentWs) { showToast('เลือก Workspace ก่อน', 'error'); return; }
  const list = await lsGetWorkspaceList();
  const sel = document.getElementById('inheritWsSelect');
  sel.innerHTML = '<option value="">— เลือก Workspace —</option>' +
    list.filter(w => w.id !== S.currentWsId)
        .map(w => `<option value="${w.id}">${esc(w.emoji || '📖')} ${esc(w.name)} (${w.chapterCount || 0} ตอน)</option>`)
        .join('');
  document.getElementById('inheritPreviewInfo').textContent = '';
  openModal('modal-glossary-inherit');
}

async function previewInheritGlossary() {
  const id = document.getElementById('inheritWsSelect').value;
  if (!id) { document.getElementById('inheritPreviewInfo').textContent = ''; return; }
  const ws = await lsGetWorkspace(id);
  if (!ws) return;
  const total = ws.glossary?.length || 0;
  const newTerms = (ws.glossary || []).filter(g => !S.currentWs.glossary.some(x => x.korean === g.korean)).length;
  document.getElementById('inheritPreviewInfo').textContent =
    `${total} คำใน WS นั้น — ใหม่ที่จะ import: ${newTerms} คำ`;
}

async function confirmInheritGlossary() {
  const id = document.getElementById('inheritWsSelect').value;
  if (!id) { showToast('เลือก Workspace ก่อน', 'error'); return; }
  const ws = await lsGetWorkspace(id);
  if (!ws?.glossary?.length) { showToast('Workspace นั้นไม่มีคลังศัพท์', 'error'); return; }
  const skipDup   = document.getElementById('inheritSkipDup').checked;
  const charsOnly = document.getElementById('inheritCharsOnly').checked;
  let added = 0;
  for (const g of ws.glossary) {
    if (charsOnly && g.type !== 'character') continue;
    if (skipDup && S.currentWs.glossary.some(x => x.korean === g.korean)) continue;
    S.currentWs.glossary.push({ ...g });
    added++;
  }
  if (!added) { showToast('ไม่มีคำใหม่ที่จะ import', ''); return; }
  S.glossaryData = S.currentWs.glossary;
  await lsSaveWorkspace(S.currentWs);
  renderGlossaryTable();
  closeModal('modal-glossary-inherit');
  showToast(`Import ${added} คำจาก "${ws.name}" สำเร็จ ✓`, 'success');
}

// ─── Glossary CSV Import ───
const VALID_TYPES = new Set(['character','title','rank','term','honorific','place','skill','item','clan','monster']);
const VALID_GENDERS = new Set(['male','female','neutral']);
let _csvPendingRows = [];

function openGlossaryCSVImport() {
  if (!S.currentWs) { showToast('เลือก Workspace ก่อน', 'error'); return; }
  document.getElementById('glossaryCsvFile').click();
}

function handleGlossaryCSVImport(e) {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (ev) => {
    const text = ev.target.result;
    _csvPendingRows = parseGlossaryCSV(text);
    renderCSVPreview(_csvPendingRows);
    openModal('modal-glossary-csv-import');
  };
  reader.readAsText(file, 'UTF-8');
  e.target.value = '';
}

function parseGlossaryCSV(text) {
  // รองรับ CSV, TSV, และตัวคั่นอื่นๆ
  const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n').filter(l => l.trim());
  if (!lines.length) return [];
  // Auto-detect delimiter
  const delim = lines[0].includes('\t') ? '\t' : ',';
  const rows = [];
  // ข้ามบรรทัดแรก (header) ถ้ามี Korean/korean/เกาหลี
  const firstLow = lines[0].toLowerCase();
  const startIdx = (firstLow.includes('korean') || firstLow.includes('เกาหลี') || firstLow.includes('kr')) ? 1 : 0;
  for (let i = startIdx; i < lines.length; i++) {
    const cols = splitCSVLine(lines[i], delim);
    const korean = (cols[0] || '').trim();
    const thai   = (cols[1] || '').trim();
    if (!korean || !thai) continue;
    const rawType   = (cols[2] || '').trim().toLowerCase();
    const rawGender = (cols[3] || '').trim().toLowerCase();
    const note      = (cols[4] || '').trim();
    const type   = VALID_TYPES.has(rawType)   ? rawType   : 'term';
    const gender = VALID_GENDERS.has(rawGender) ? rawGender : '';
    const exists = S.currentWs.glossary.some(g => g.korean === korean);
    rows.push({ korean, thai, type, gender, note, exists, selected: !exists });
  }
  return rows;
}

function splitCSVLine(line, delim) {
  const cols = [];
  let cur = '', inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') { inQ = !inQ; continue; }
    if (c === delim && !inQ) { cols.push(cur); cur = ''; continue; }
    cur += c;
  }
  cols.push(cur);
  return cols;
}

function renderCSVPreview(rows) {
  const tbody = document.getElementById('csvPreviewBody');
  const newRows  = rows.filter(r => !r.exists).length;
  const dupRows  = rows.filter(r => r.exists).length;
  document.getElementById('csvImportStats').textContent =
    `พบ ${rows.length} รายการ — ใหม่: ${newRows} | ซ้ำ (ข้ามอัตโนมัติ): ${dupRows}`;
  tbody.innerHTML = rows.map((r, idx) => `
    <tr style="opacity:${r.exists ? 0.45 : 1}">
      <td style="padding:4px 8px">${esc(r.korean)}</td>
      <td style="padding:4px 8px">${esc(r.thai)}</td>
      <td style="padding:4px 8px">${esc(r.type)}</td>
      <td style="padding:4px 8px">${esc(r.gender)}</td>
      <td style="padding:4px 8px;max-width:120px;overflow:hidden;text-overflow:ellipsis">${esc(r.note)}</td>
      <td style="padding:4px 8px">
        ${r.exists
          ? '<span style="color:var(--text-muted)">ซ้ำ</span>'
          : `<input type="checkbox" data-idx="${idx}" ${r.selected ? 'checked' : ''} onchange="_csvToggle(${idx},this.checked)">`}
      </td>
    </tr>
  `).join('');
}

function _csvToggle(idx, val) { _csvPendingRows[idx].selected = val; }

async function confirmGlossaryCSVImport() {
  const toAdd = _csvPendingRows.filter(r => r.selected && !r.exists);
  if (!toAdd.length) { showToast('ไม่มีรายการที่จะ import', 'error'); return; }
  toAdd.forEach(r => {
    const entry = { korean: r.korean, thai: r.thai, type: r.type, note: r.note };
    if (r.type === 'character' && r.gender) entry.gender = r.gender;
    S.currentWs.glossary.push(entry);
  });
  S.glossaryData = S.currentWs.glossary;
  await lsSaveWorkspace(S.currentWs);
  renderGlossaryTable();
  closeModal('modal-glossary-csv-import');
  showToast(`Import สำเร็จ: เพิ่ม ${toAdd.length} คำ ✓`, 'success');
}

// ─── Multi-Workspace Export ───
async function openMultiExport() {
  const list = await lsGetWorkspaceList();
  if (!list.length) { showToast('ไม่มี Workspace', 'error'); return; }
  const container = document.getElementById('multiExportList');
  container.innerHTML = list.map(w => `
    <label style="display:flex;align-items:center;gap:8px;padding:6px 8px;border-radius:6px;cursor:pointer;background:var(--bg-card);border:1px solid var(--border)">
      <input type="checkbox" class="multi-exp-chk" data-id="${w.id}" checked style="width:16px;height:16px;cursor:pointer">
      <span style="font-size:1.1rem">${w.emoji || '📖'}</span>
      <span style="flex:1;font-size:0.88rem">${esc(w.name)}</span>
      <span style="font-size:0.75rem;color:var(--text-muted)">${w.chapterCount || 0} ตอน</span>
    </label>
  `).join('');
  container.querySelectorAll('.multi-exp-chk').forEach(cb => cb.addEventListener('change', multiExportUpdateCount));
  multiExportUpdateCount();
  openModal('modal-multi-export');
}

function multiExportSelectAll(val) {
  document.querySelectorAll('.multi-exp-chk').forEach(cb => { cb.checked = val; });
  multiExportUpdateCount();
}

function multiExportUpdateCount() {
  const n = document.querySelectorAll('.multi-exp-chk:checked').length;
  document.getElementById('multiExportCount').textContent = `${n} Workspace ที่เลือก`;
}

async function doMultiExport() {
  const checked = [...document.querySelectorAll('.multi-exp-chk:checked')];
  if (!checked.length) { showToast('เลือก Workspace ก่อน', 'error'); return; }

  showToast(`กำลังโหลด ${checked.length} Workspace...`, '');
  const workspaces = [];
  for (const cb of checked) {
    const ws = await lsGetWorkspace(cb.dataset.id);
    if (ws) workspaces.push(ws);
  }

  const bundle = {
    _format: 'noveltrans-multi-export',
    _version: 1,
    _exportedAt: new Date().toISOString(),
    _count: workspaces.length,
    workspaces,
  };

  const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' });
  const date = new Date().toISOString().slice(0, 10);
  downloadBlob(blob, `noveltrans_backup_${date}_${workspaces.length}ws.json`);
  _markBackupDone();
  closeModal('modal-multi-export');
  showToast(`Export ${workspaces.length} Workspace สำเร็จ ✓`, 'success');
}

function openImportWs() { document.getElementById('importWsFile').click(); }

async function importWorkspace(e) {
  const file = e.target.files[0];
  if (!file) return;
  try {
    const text = await file.text();
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch (parseErr) {
      parsed = tryRepairJson(text);
      if (!parsed) throw new Error(`JSON เสียหาย (${parseErr.message})`);
      showToast('⚠ JSON ถูกซ่อมแซมบางส่วน ข้อมูลอาจไม่ครบ', 'error');
    }

    // ─ Multi-export bundle ─
    if (parsed?._format === 'noveltrans-multi-export' && Array.isArray(parsed.workspaces)) {
      let imported = 0;
      for (const ws of parsed.workspaces) {
        if (!ws.id || !ws.name) continue;
        if (!ws.chapters) ws.chapters = [];
        if (!ws.glossary) ws.glossary = [];
        if (!ws.customStyles) ws.customStyles = [];
        if (!ws.settings) ws.settings = {};
        await lsSaveWorkspace(ws);
        imported++;
      }
      await loadWorkspaceList();
      showToast(`Import Bundle สำเร็จ: ${imported} Workspace ✓`, 'success');
      e.target.value = '';
      return;
    }

    // ─ Single workspace ─
    const ws = parsed;
    if (!ws.id || !ws.name) throw new Error('ไฟล์ไม่ถูกต้อง — ไม่พบ id หรือ name');
    if (!ws.chapters) ws.chapters = [];
    if (!ws.glossary) ws.glossary = [];
    if (!ws.customStyles) ws.customStyles = [];
    if (!ws.settings) ws.settings = {};
    await lsSaveWorkspace(ws);
    await selectWorkspace(ws.id);
    showToast(`Import "${ws.name}" สำเร็จ (${ws.chapters.length} ตอน)`, 'success');
  } catch (err) {
    showToast('Import ล้มเหลว: ' + err.message, 'error');
  }
  e.target.value = '';
}

// ── Attempt to repair truncated JSON by closing unclosed brackets/braces ──
function tryRepairJson(text) {
  let t = text.trimEnd().replace(/,\s*$/, ''); // strip trailing comma
  const stack = [];
  let inStr = false, escape = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (escape) { escape = false; continue; }
    if (c === '\\' && inStr) { escape = true; continue; }
    if (c === '"' && !escape) { inStr = !inStr; continue; }
    if (!inStr) {
      if (c === '{' || c === '[') stack.push(c);
      else if (c === '}' || c === ']') stack.pop();
    }
  }
  if (!stack.length) return null;
  const closing = stack.reverse().map(c => c === '{' ? '}' : ']').join('');
  try { return JSON.parse(t + closing); } catch { return null; }
}

// ─── Chapters ───
let _bulkMode = false;

function enterBulkMode() {
  _bulkMode = true;
  document.getElementById('bulkDeleteBar').style.display = 'flex';
  document.getElementById('bulkModeEntryBar').style.display = 'none';
  document.getElementById('chkSelectAll').checked = false;
  renderChapters();
  updateBulkCount();
}

function exitBulkMode() {
  _bulkMode = false;
  document.getElementById('bulkDeleteBar').style.display = 'none';
  document.getElementById('bulkModeEntryBar').style.display = 'flex';
  document.getElementById('chkSelectAll').checked = false;
  renderChapters();
}

function updateBulkCount() {
  const n = document.querySelectorAll('.ch-chk:checked').length;
  document.getElementById('bulkDeleteCount').textContent = `${n} ตอนที่เลือก`;
}

function chSelectAll(checked) {
  document.querySelectorAll('.ch-chk').forEach(el => el.checked = checked);
  updateBulkCount();
}

function chSelectPending() {
  document.querySelectorAll('.ch-chk').forEach(el => {
    const ch = S.currentWs?.chapters.find(c => c.id === el.dataset.id);
    el.checked = ch?.status !== 'translated';
  });
  updateBulkCount();
}

function chSelectTranslated() {
  document.querySelectorAll('.ch-chk').forEach(el => {
    const ch = S.currentWs?.chapters.find(c => c.id === el.dataset.id);
    el.checked = ch?.status === 'translated';
  });
  updateBulkCount();
}

async function deleteSelectedChapters() {
  const checked = [...document.querySelectorAll('.ch-chk:checked')];
  if (!checked.length) { showToast('ยังไม่ได้เลือกตอน', 'error'); return; }
  if (!confirm(`ลบ ${checked.length} ตอนที่เลือก?\nไม่สามารถกู้คืนได้`)) return;
  const ids = new Set(checked.map(el => el.dataset.id));
  S.currentWs.chapters = S.currentWs.chapters.filter(ch => !ids.has(ch.id));
  await lsSaveWorkspace(S.currentWs);
  renderChapters();
  updateChapterSaveSelect();
  updateBulkCount();
  document.getElementById('chkSelectAll').checked = false;
  showToast(`ลบ ${ids.size} ตอนแล้ว ✓`, 'success');
}

// ─── Range Select helper (Shift+click) ───
// ใช้ร่วมกันทุก list — เก็บ lastIndex ต่อ "group"
const _lastCheckedIdx = {};

function rangeCheckboxClick(e, groupKey, checkboxSelector, onAfter) {
  const allBoxes = [...document.querySelectorAll(checkboxSelector)];
  const idx = allBoxes.indexOf(e.target);
  if (idx < 0) return;

  if (e.shiftKey && _lastCheckedIdx[groupKey] !== undefined) {
    const from = Math.min(_lastCheckedIdx[groupKey], idx);
    const to   = Math.max(_lastCheckedIdx[groupKey], idx);
    const targetState = e.target.checked;
    for (let i = from; i <= to; i++) {
      allBoxes[i].checked = targetState;
    }
  }
  _lastCheckedIdx[groupKey] = idx;
  if (onAfter) onAfter();
}

function renderChapters() {
  const list = document.getElementById('chapterList');
  const chapters = S.currentWs?.chapters || [];
  document.getElementById('chapterCount').textContent = `${chapters.length} ตอน`;
  if (!chapters.length) {
    list.innerHTML = '<div style="text-align:center;padding:30px;color:var(--text-muted);font-size:0.85rem">ยังไม่มีตอน — กด ＋ เพิ่มตอน</div>';
    return;
  }
  list.innerHTML = [...chapters]
    .sort((a, b) => (a.chapterNum || 0) - (b.chapterNum || 0))
    .map(ch => `
      <div class="chapter-card${_bulkMode ? ' bulk-mode' : ''}" onclick="${_bulkMode ? `chToggle('${ch.id}')` : `openChapter('${ch.id}')`}">
        ${_bulkMode ? `<input type="checkbox" class="ch-chk" data-id="${ch.id}" style="accent-color:var(--gold);flex-shrink:0;width:16px;height:16px" onclick="event.stopPropagation();rangeCheckboxClick(event,'ch-bulk','.ch-chk',updateBulkCount)" onchange="updateBulkCount()" title="Shift+คลิก เพื่อเลือกช่วง"/>` : ''}
        <div class="ch-num">#${ch.chapterNum || '?'}</div>
        <div class="ch-info">
          <div class="ch-title">${esc(ch.title)}${ch.glossaryExtracted ? '<span class="ch-glossary-badge">📖 Glossary</span>' : ''}</div>
          <div class="ch-meta">${ch.updatedAt ? new Date(ch.updatedAt).toLocaleDateString('th-TH') : ''} ${ch.wordCount ? `· ${ch.wordCount.toLocaleString()} ตัวอักษร` : ''}</div>
        </div>
        <div class="ch-status">
          <span class="status-badge ${ch.status === 'translated' ? 'translated' : ch.status === 'partial' ? 'partial' : 'pending'}">
            ${ch.status === 'translated' ? '✓ แปลแล้ว'
              : ch.status === 'partial' ? `◐ แปลค้าง${ch.chunkProgress?.chunks?.length ? ` (${ch.chunkProgress.chunks.length} chunk)` : ''}`
              : '○ รอแปล'}
          </span>
          ${!_bulkMode && ch.translation ? `<button class="ch-read-btn" onclick="event.stopPropagation();openReader('${ch.id}')" title="เปิดโหมดอ่าน">📖</button>` : ''}
        </div>
      </div>
    `).join('');
}

function chToggle(id) {
  const chk = document.querySelector(`.ch-chk[data-id="${id}"]`);
  if (chk) { chk.checked = !chk.checked; updateBulkCount(); }
}

async function addChapter() {
  const title = document.getElementById('newChTitle').value.trim();
  if (!title) { showToast('ใส่ชื่อตอนก่อน', 'error'); return; }
  const ch = {
    id: genId(),
    title,
    chapterNum: parseInt(document.getElementById('newChNum').value) || (S.currentWs.chapters.length + 1),
    notes: document.getElementById('newChNotes').value.trim(),
    sourceText: '', translation: '',
    status: 'pending',
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  S.currentWs.chapters.push(ch);
  await lsSaveWorkspace(S.currentWs);
  closeModal('modal-new-chapter');
  document.getElementById('newChTitle').value = '';
  document.getElementById('newChNum').value = '';
  document.getElementById('newChNotes').value = '';
  renderChapters();
  updateChapterSaveSelect();
  showToast(`เพิ่ม "${title}" แล้ว`, 'success');
}

function openChapter(id) {
  const ch = S.currentWs?.chapters.find(c => c.id === id);
  if (!ch) return;
  S.editingChapterId = id;
  document.getElementById('viewChTitle').textContent = `#${ch.chapterNum || '?'} ${ch.title}`;
  document.getElementById('viewChSource').value = ch.sourceText || '';
  document.getElementById('viewChTranslation').value = ch.translation || '';
  document.getElementById('viewChNotes').value = ch.notes || '';
  _updateChapterNav();
  openModal('modal-view-chapter');
}

function _getSortedChapters() {
  return [...(S.currentWs?.chapters || [])].sort((a, b) => (a.chapterNum || 0) - (b.chapterNum || 0));
}

function _updateChapterNav() {
  const sorted = _getSortedChapters();
  const idx = sorted.findIndex(c => c.id === S.editingChapterId);
  const total = sorted.length;
  const navLabel = document.getElementById('viewChNavLabel');
  const prevBtn  = document.getElementById('viewChPrevBtn');
  const nextBtn  = document.getElementById('viewChNextBtn');
  if (!navLabel || !prevBtn || !nextBtn) return;
  navLabel.textContent = total > 0 ? `ตอนที่ ${idx + 1} / ${total}` : '';
  prevBtn.disabled = idx <= 0;
  prevBtn.style.opacity = idx <= 0 ? '0.35' : '1';
  nextBtn.disabled = idx >= total - 1;
  nextBtn.style.opacity = idx >= total - 1 ? '0.35' : '1';
}

async function navigateChapter(dir) {
  // Auto-save before navigating
  if (S.editingChapterId) {
    const cur = S.currentWs?.chapters.find(c => c.id === S.editingChapterId);
    if (cur) {
      cur.sourceText  = document.getElementById('viewChSource').value;
      cur.translation = document.getElementById('viewChTranslation').value;
      cur.notes       = document.getElementById('viewChNotes').value;
      cur.status      = cur.translation ? 'translated' : 'pending';
      cur.wordCount   = cur.translation.length;
      cur.updatedAt   = Date.now();
      await lsSaveWorkspace(S.currentWs);
      renderChapters();
    }
  }
  const sorted = _getSortedChapters();
  const idx = sorted.findIndex(c => c.id === S.editingChapterId);
  const next = sorted[idx + dir];
  if (!next) return;
  S.editingChapterId = next.id;
  document.getElementById('viewChTitle').textContent = `#${next.chapterNum || '?'} ${next.title}`;
  document.getElementById('viewChSource').value = next.sourceText || '';
  document.getElementById('viewChTranslation').value = next.translation || '';
  document.getElementById('viewChNotes').value = next.notes || '';
  _updateChapterNav();
}

async function saveChapter() {
  if (!S.editingChapterId) return;
  const ch = S.currentWs.chapters.find(c => c.id === S.editingChapterId);
  if (!ch) return;
  ch.sourceText = document.getElementById('viewChSource').value;
  ch.translation = document.getElementById('viewChTranslation').value;
  ch.notes = document.getElementById('viewChNotes').value;
  ch.status = ch.translation ? 'translated' : 'pending';
  ch.wordCount = ch.translation.length;
  ch.updatedAt = Date.now();
  await lsSaveWorkspace(S.currentWs);
  renderChapters();
  showToast('บันทึกตอนแล้ว ✓', 'success');
}

async function deleteCurrentChapter() {
  if (!S.editingChapterId || !confirm('ลบตอนนี้?')) return;
  const sorted = _getSortedChapters();
  const idx = sorted.findIndex(c => c.id === S.editingChapterId);
  // Undo snapshot
  const deletedCh = S.currentWs.chapters.find(c => c.id === S.editingChapterId);
  S._undoStack = { type: 'delete_chapter', chapter: JSON.parse(JSON.stringify(deletedCh)) };
  S.currentWs.chapters = S.currentWs.chapters.filter(c => c.id !== S.editingChapterId);
  await lsSaveWorkspace(S.currentWs);
  renderChapters();
  updateChapterSaveSelect();
  showToast('ลบตอนแล้ว — <u style="cursor:pointer" onclick="undoLastAction()">Undo</u>', '');
  const newSorted = _getSortedChapters();
  if (newSorted.length) {
    const next = newSorted[Math.min(idx, newSorted.length - 1)];
    S.editingChapterId = next.id;
    document.getElementById('viewChTitle').textContent = `#${next.chapterNum || '?'} ${next.title}`;
    document.getElementById('viewChSource').value = next.sourceText || '';
    document.getElementById('viewChTranslation').value = next.translation || '';
    document.getElementById('viewChNotes').value = next.notes || '';
    _updateChapterNav();
  } else {
    closeModal('modal-view-chapter');
  }
}

async function undoLastAction() {
  const action = S._undoStack;
  if (!action) { showToast('ไม่มีอะไรให้ Undo', ''); return; }
  S._undoStack = null;

  if (action.type === 'delete_chapter') {
    const ch = action.chapter;
    // Re-insert; avoid duplicate id
    if (!S.currentWs.chapters.find(c => c.id === ch.id)) {
      S.currentWs.chapters.push(ch);
    }
    // Renumber by current order
    [...S.currentWs.chapters]
      .sort((a, b) => (a.chapterNum || 0) - (b.chapterNum || 0))
      .forEach((c, i) => { c.chapterNum = i + 1; });
    await lsSaveWorkspace(S.currentWs);
    renderChapters();
    updateChapterSaveSelect();
    // Open the restored chapter
    S.editingChapterId = ch.id;
    document.getElementById('viewChTitle').textContent = `#${ch.chapterNum || '?'} ${ch.title}`;
    document.getElementById('viewChSource').value = ch.sourceText || '';
    document.getElementById('viewChTranslation').value = ch.translation || '';
    document.getElementById('viewChNotes').value = ch.notes || '';
    _updateChapterNav();
    openModal('modal-view-chapter');
    showToast('↩ Undo: คืนตอนที่ลบแล้ว', 'success');

  } else if (action.type === 'clean_all_source') {
    for (const snap of action.snapshot) {
      const ch = S.currentWs.chapters.find(c => c.id === snap.id);
      if (ch) ch.sourceText = snap.sourceText;
    }
    await lsSaveWorkspace(S.currentWs);
    renderChapters();
    // Refresh open chapter view if applicable
    if (S.editingChapterId) {
      const ch = S.currentWs.chapters.find(c => c.id === S.editingChapterId);
      if (ch) document.getElementById('viewChSource').value = ch.sourceText || '';
    }
    showToast('↩ Undo: คืน Source Text ทุกตอนแล้ว', 'success');
  }
}

function loadChapterToTranslate() {
  const ch = S.currentWs?.chapters.find(c => c.id === S.editingChapterId);
  if (!ch) return;
  document.getElementById('sourceText').value = ch.sourceText || '';
  updateSourceStats();
  // มีงานแปลค้าง → ตั้ง chunk size เดิมให้เลย จะได้ resume ได้ทันทีตอนกดแปล
  if (ch.chunkProgress?.chunkSize) {
    const cs = document.getElementById('chunkSize');
    if (cs) cs.value = ch.chunkProgress.chunkSize;
    showToast(`มีงานแปลค้าง ${ch.chunkProgress.chunks?.length || 0} chunk — กดแปลเพื่อทำต่อ`, '');
  }
  closeModal('modal-view-chapter');
  switchTab('translate');
  showToast(`โหลด "${ch.title}" แล้ว`, 'success');
}

function updateChapterSaveSelect() {
  const sel = document.getElementById('chapterSaveTarget');
  const chapters = S.currentWs?.chapters || [];
  sel.innerHTML = `<option value="">— บันทึกลงตอน —</option>` +
    chapters.map(ch => `<option value="${ch.id}">#${ch.chapterNum || '?'} ${esc(ch.title)}</option>`).join('');
}

async function saveToChapter() {
  const chId = document.getElementById('chapterSaveTarget').value;
  if (!chId) { showToast('เลือกตอนก่อน', 'error'); return; }
  const source = document.getElementById('sourceText').value.trim();
  const output = document.getElementById('translationOutput');
  const translation = output.innerText.trim();
  if (!translation || translation === 'คำแปลจะปรากฏที่นี่...') { showToast('ยังไม่มีคำแปล', 'error'); return; }
  const ch = S.currentWs.chapters.find(c => c.id === chId);
  if (!ch) return;
  ch.sourceText = source;
  ch.translation = translation;
  ch.status = 'translated';
  ch.wordCount = translation.length;
  ch.updatedAt = Date.now();
  await lsSaveWorkspace(S.currentWs);
  updateChapterSaveSelect();
  showToast('บันทึกลงตอนแล้ว ✓', 'success');
}

// ─── Glossary Manager ───
function renderGlossaryTable(filter = '', typeFilter = '', sortBy = 'default') {
  const tbody = document.getElementById('glossaryTableBody');
  let data = [...(S.glossaryData || [])];
  if (filter) {
    const q = filter.toLowerCase();
    data = data.filter(g => g.korean.includes(q) || g.thai.includes(q) || (g.note || '').toLowerCase().includes(q));
  }
  if (typeFilter) data = data.filter(g => g.type === typeFilter);

  // Sort
  if (sortBy === 'korean-az') data.sort((a,b) => a.korean.localeCompare(b.korean));
  else if (sortBy === 'korean-za') data.sort((a,b) => b.korean.localeCompare(a.korean));
  else if (sortBy === 'thai-az') data.sort((a,b) => a.thai.localeCompare(b.thai, 'th'));
  else if (sortBy === 'type') data.sort((a,b) => (a.type||'').localeCompare(b.type||''));
  // default = insertion order (no sort)

  document.getElementById('glossaryCount').textContent = `${data.length} รายการ`;
  if (!data.length) {
    tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;padding:20px;color:var(--text-muted)">ไม่พบรายการ</td></tr>`;
    return;
  }
  // Refresh type filter dropdown with any custom types
  refreshTypeFilter();
  const GENDER_LABEL = { male: '♂ ชาย', female: '♀ หญิง', neutral: '⚥ กลาง' };
  tbody.innerHTML = data.map(g => `
    <tr${g._rootWarning ? ' class="tr-root-warn"' : ''}>
      <td class="td-korean">${esc(g.korean)}</td>
      <td class="td-thai">${esc(g.thai)}${g._rootWarning ? `<span class="root-warn-badge" title="คำนี้มี root ซ้ำกับ &quot;${esc(g._rootWarning)}&quot; ที่มีอยู่แล้ว">⚠ root ซ้ำ</span>` : ''}</td>
      <td><span class="tag ${getTagClass(g.type || 'term')}">${esc(g.type || 'term')}</span></td>
      <td class="td-gender">${g.gender ? GENDER_LABEL[g.gender] || esc(g.gender) : '—'}</td>
      <td class="td-note">${esc(g.note || '')}</td>
      <td class="td-source">${g.sourceChapterTitle ? `<span title="${esc(g.sourceChapterTitle)}">#${g.sourceChapterNum || '?'} ${esc(g.sourceChapterTitle.slice(0,18))}${g.sourceChapterTitle.length>18?'…':''}</span>` : '<span style="color:var(--text-muted)">—</span>'}</td>
      <td class="td-del">
        <button onclick="editGlossaryEntry('${esc(g.korean)}')" title="แก้ไข">✏</button>
        <button onclick="deleteGlossaryEntry('${esc(g.korean)}')" title="ลบ">✕</button>
      </td>
    </tr>
  `).join('');
}

function filterGlossary() {
  renderGlossaryTable(
    document.getElementById('glossarySearch').value.trim(),
    document.getElementById('glossaryTypeFilter').value,
    document.getElementById('glossarySortSelect')?.value || 'default'
  );
}

function openAddGlossary() {
  S.editingGlossaryKorean = null;
  document.getElementById('glossaryModalTitle').textContent = '＋ เพิ่มคำศัพท์';
  ['gKorean','gThai','gNote'].forEach(id => document.getElementById(id).value = '');
  populateGlossaryTypeSelects();
  document.getElementById('gType').value = 'term';
  document.getElementById('gGenderGroup').style.display = 'none';
  document.getElementById('gGender').value = '';
  document.getElementById('gKorean').readOnly = false;
  openModal('modal-add-glossary');
}

function editGlossaryEntry(korean) {
  const entry = S.glossaryData.find(g => g.korean === korean);
  if (!entry) return;
  S.editingGlossaryKorean = korean;
  document.getElementById('glossaryModalTitle').textContent = '✏ แก้ไขคำศัพท์';
  document.getElementById('gKorean').value = entry.korean;
  document.getElementById('gKorean').readOnly = true;
  document.getElementById('gThai').value = entry.thai;
  populateGlossaryTypeSelects();
  // Auto-add type if not in preset dropdown (legacy types ที่ยังไม่อยู่ใน customGlossaryTypes)
  ensureTypeInDropdown(entry.type);
  document.getElementById('gType').value = entry.type || 'term';
  document.getElementById('gNote').value = entry.note || '';
  // gender: แสดงเฉพาะ character
  const isChar = (entry.type || 'term') === 'character';
  document.getElementById('gGenderGroup').style.display = isChar ? '' : 'none';
  document.getElementById('gGender').value = entry.gender || '';
  openModal('modal-add-glossary');
}

async function saveGlossaryEntry() {
  const korean = document.getElementById('gKorean').value.trim();
  const thai = document.getElementById('gThai').value.trim();
  if (!korean || !thai) { showToast('กรอก Korean และ Thai ก่อน', 'error'); return; }
  const type = document.getElementById('gType').value;
  if (type === '__newtype__') { showToast('เลือกประเภทก่อน', 'error'); return; }
  // type ที่ไม่ใช่ preset → persist ลง workspace (เดิมหายตอน reload)
  if (!PRESET_TYPES[type] && S.currentWs && !(S.currentWs.customGlossaryTypes || []).includes(type)) {
    S.currentWs.customGlossaryTypes = [...(S.currentWs.customGlossaryTypes || []), type];
  }
  const gender = type === 'character' ? document.getElementById('gGender').value : '';
  const entry = { korean, thai, type, note: document.getElementById('gNote').value.trim(), ...(gender ? { gender } : {}) };
  if (S.editingGlossaryKorean) {
    // ลบ entry เก่าก่อน (กรณีผู้ใช้เปลี่ยน Korean term ด้วย)
    S.currentWs.glossary = S.currentWs.glossary.filter(g => g.korean !== S.editingGlossaryKorean);
    // ถ้ามี Korean ใหม่ที่ซ้ำกับ entry อื่น → ทับ entry นั้น
    const dupIdx = S.currentWs.glossary.findIndex(g => g.korean === korean);
    if (dupIdx >= 0) S.currentWs.glossary[dupIdx] = entry;
    else S.currentWs.glossary.push(entry);
  } else {
    const exists = S.currentWs.glossary.findIndex(g => g.korean === korean);
    if (exists >= 0) S.currentWs.glossary[exists] = entry;
    else S.currentWs.glossary.push(entry);
  }
  S.glossaryData = S.currentWs.glossary;
  await lsSaveWorkspace(S.currentWs);
  closeModal('modal-add-glossary');
  renderGlossaryTable();
  showToast(`บันทึก "${korean}" แล้ว`, 'success');
  // Resolve QA issue if opened from QA modal
  if (window._qaPendingResolve) {
    window._qaPendingResolve.callback();
    window._qaPendingResolve = null;
  }
}

async function deleteGlossaryEntry(korean) {
  if (!confirm(`ลบ "${korean}"?`)) return;
  S.currentWs.glossary = S.currentWs.glossary.filter(g => g.korean !== korean);
  S.glossaryData = S.currentWs.glossary;
  await lsSaveWorkspace(S.currentWs);
  renderGlossaryTable();
  showToast(`ลบ "${korean}" แล้ว`, '');
}

// ─── Split Chapter ───
function openSplitChapter() {
  const ch = S.currentWs?.chapters.find(c => c.id === S.editingChapterId);
  if (!ch) return;
  const lines = (ch.sourceText || '').split('\n');
  document.getElementById('splitTotalLines').textContent = `(ทั้งหมด ${lines.length} บรรทัด)`;
  document.getElementById('splitLineNum').value = Math.ceil(lines.length / 2);
  document.getElementById('splitTitle1').value = ch.title;
  document.getElementById('splitTitle2').value = ch.title + ' (2)';
  document.getElementById('splitPreview').textContent = '';
  document.getElementById('splitLineNum').oninput = updateSplitPreview;
  updateSplitPreview();
  openModal('modal-split-chapter');
}

function updateSplitPreview() {
  const ch = S.currentWs?.chapters.find(c => c.id === S.editingChapterId);
  if (!ch) return;
  const lines = (ch.sourceText || '').split('\n');
  const at = parseInt(document.getElementById('splitLineNum').value) || 1;
  const p1 = lines.slice(0, at).join('\n').slice(0, 120);
  const p2 = lines.slice(at).join('\n').slice(0, 120);
  document.getElementById('splitPreview').textContent =
    `ส่วนที่ 1 (${at} บรรทัด):\n${p1}…\n\nส่วนที่ 2 (${lines.length - at} บรรทัด):\n${p2}…`;
}

async function confirmSplitChapter() {
  const ch = S.currentWs?.chapters.find(c => c.id === S.editingChapterId);
  if (!ch) return;
  const lines = (ch.sourceText || '').split('\n');
  const at = Math.max(1, Math.min(parseInt(document.getElementById('splitLineNum').value) || 1, lines.length - 1));
  const title1 = document.getElementById('splitTitle1').value.trim() || ch.title;
  const title2 = document.getElementById('splitTitle2').value.trim() || ch.title + ' (2)';

  // แก้ part 1 (ใช้ id เดิม)
  ch.title = title1;
  ch.sourceText = lines.slice(0, at).join('\n');
  ch.translation = '';
  ch.status = 'pending';
  ch.updatedAt = Date.now();

  // สร้าง part 2 ใหม่ (chapterNum +0.5 ก่อน renumber)
  const newCh = {
    id: genId(),
    title: title2,
    chapterNum: (ch.chapterNum || 0) + 0.5,
    sourceText: lines.slice(at).join('\n'),
    translation: '',
    status: 'pending',
    notes: '',
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  S.currentWs.chapters.push(newCh);

  // Renumber ทั้ง WS ตามลำดับ
  [...S.currentWs.chapters]
    .sort((a, b) => (a.chapterNum || 0) - (b.chapterNum || 0))
    .forEach((c, i) => { c.chapterNum = i + 1; });

  await lsSaveWorkspace(S.currentWs);
  renderChapters();
  updateChapterSaveSelect();
  closeModal('modal-split-chapter');
  closeModal('modal-view-chapter');
  showToast(`✂ Split เสร็จ — "${title1}" และ "${title2}"`, 'success');
}

// ─── Merge Chapter ───
function openMergeChapter() {
  const sorted = _getSortedChapters();
  const idx = sorted.findIndex(c => c.id === S.editingChapterId);
  const ch = sorted[idx];
  if (!ch) return;
  const next = sorted[idx + 1];
  const prev = sorted[idx - 1];
  let info = `<b>${esc(ch.title)}</b>`;
  if (next) info += `<br>+ ถัดไป: <b>${esc(next.title)}</b>`;
  else info += '<br><span style="color:var(--crimson-light)">ไม่มีตอนถัดไป</span>';
  if (prev) info += `<br>+ ก่อนหน้า: <b>${esc(prev.title)}</b>`;
  else info += '<br><span style="color:var(--text-muted)">ไม่มีตอนก่อนหน้า</span>';
  document.getElementById('mergeInfo').innerHTML = info;
  document.getElementById('mergeTitleResult').value = ch.title;
  // default direction
  const radios = document.querySelectorAll('input[name="mergeDir"]');
  radios.forEach(r => { if (r.value === 'next') r.checked = true; });
  openModal('modal-merge-chapter');
}

async function confirmMergeChapter() {
  const sorted = _getSortedChapters();
  const idx = sorted.findIndex(c => c.id === S.editingChapterId);
  const ch = sorted[idx];
  if (!ch) return;
  const dir = document.querySelector('input[name="mergeDir"]:checked')?.value || 'next';
  const other = dir === 'next' ? sorted[idx + 1] : sorted[idx - 1];
  if (!other) { showToast(`ไม่มีตอน${dir === 'next' ? 'ถัดไป' : 'ก่อนหน้า'}`, 'error'); return; }
  const newTitle = document.getElementById('mergeTitleResult').value.trim() || ch.title;

  // Merge: ต้นฉบับ + แปล ต่อกัน
  const sep = '\n\n';
  const [first, second] = dir === 'next' ? [ch, other] : [other, ch];
  ch.title = newTitle;
  ch.chapterNum = first.chapterNum;
  ch.sourceText  = [first.sourceText, second.sourceText].filter(Boolean).join(sep);
  ch.translation = [first.translation, second.translation].filter(Boolean).join(sep);
  ch.status = ch.translation.trim() ? 'translated' : 'pending';
  ch.wordCount = ch.translation.length;
  ch.updatedAt = Date.now();

  // ลบตอนที่ merge เข้าไป
  S.currentWs.chapters = S.currentWs.chapters.filter(c => c.id !== other.id);

  // Renumber
  [...S.currentWs.chapters]
    .sort((a, b) => (a.chapterNum || 0) - (b.chapterNum || 0))
    .forEach((c, i) => { c.chapterNum = i + 1; });

  await lsSaveWorkspace(S.currentWs);
  renderChapters();
  updateChapterSaveSelect();
  closeModal('modal-merge-chapter');
  closeModal('modal-view-chapter');
  showToast(`🔗 Merge เสร็จ — "${newTitle}"`, 'success');
}

// ─── Styles (ของผู้ใช้ทั้งหมด) ───
function renderStyles() {
  const grid = document.getElementById('customStylesGrid');
  if (!grid) return;
  const customs = S.currentWs?.customStyles || [];
  if (!customs.length) {
    grid.innerHTML = '<div class="styles-empty">ยังไม่มี — กด ＋ สร้าง Style</div>';
    return;
  }
  grid.innerHTML = customs.map(s => `
    <div class="style-card ${S.activeStyleId === s.id ? 'active' : ''}" onclick="setActiveStyle('${s.id}')">
      <span class="style-emoji">${s.emoji || '🖊'}</span>
      <span class="style-name">${esc(s.name)}</span>
      <button class="style-edit" onclick="event.stopPropagation();openEditStyle('${s.id}')" title="แก้ไข Style นี้">✏</button>
    </div>
  `).join('');
}

function renderStyleSelect() {
  const sel = document.getElementById('activeStyleSelect');
  if (!sel) return;
  const customs = S.currentWs?.customStyles || [];
  const customOpts = customs.map(s => `<option value="${s.id}">${s.emoji || '🖊'} ${esc(s.name)}</option>`).join('');
  sel.innerHTML = `<option value="">— ไม่ใช้ Style —</option>` + customOpts;
  sel.value = S.activeStyleId || '';
}

async function setActiveStyle(id) {
  S.activeStyleId = id;
  const sel = document.getElementById('activeStyleSelect');
  if (sel) sel.value = id;
  if (S.currentWs) {
    renderStyles();
    // Save to workspace settings so it persists
    S.currentWs.settings = { ...(S.currentWs.settings || {}), activeStyleId: id };
    await lsSaveWorkspace(S.currentWs);
  }
}

function openNewStyle() {
  S.editingStyleId = null;
  document.getElementById('styleModalTitle').textContent = '＋ สร้าง Style';
  ['styleEmoji','styleName','stylePrompt','styleTestText'].forEach(id => document.getElementById(id).value = '');
  document.getElementById('stylePreviewResult').style.display = 'none';
  document.getElementById('deleteStyleBtn').style.display = 'none';
  openModal('modal-new-style');
}

function openEditStyle(id) {
  const style = S.currentWs?.customStyles?.find(s => s.id === id);
  if (!style) return;
  S.editingStyleId = id;
  document.getElementById('styleModalTitle').textContent = '✏ แก้ไข Style';
  document.getElementById('styleEmoji').value = style.emoji || '';
  document.getElementById('styleName').value = style.name;
  document.getElementById('stylePrompt').value = style.prompt;
  document.getElementById('styleTestText').value = '';
  document.getElementById('stylePreviewResult').style.display = 'none';
  document.getElementById('deleteStyleBtn').style.display = 'inline-flex';
  openModal('modal-new-style');
}

async function saveStyle() {
  const name = document.getElementById('styleName').value.trim();
  const prompt = document.getElementById('stylePrompt').value.trim();
  if (!name || !prompt) { showToast('กรอกชื่อและ Prompt ก่อน', 'error'); return; }
  const styleObj = { id: S.editingStyleId || genId(), name, emoji: document.getElementById('styleEmoji').value.trim() || '🖊', prompt };
  if (!S.currentWs.customStyles) S.currentWs.customStyles = [];
  if (S.editingStyleId) {
    const idx = S.currentWs.customStyles.findIndex(s => s.id === S.editingStyleId);
    if (idx >= 0) S.currentWs.customStyles[idx] = styleObj;
    else S.currentWs.customStyles.push(styleObj);
  } else {
    S.currentWs.customStyles.push(styleObj);
  }
  S.editingStyleId = null;  // reset after save
  await lsSaveWorkspace(S.currentWs);
  closeModal('modal-new-style');
  renderStyles(); renderStyleSelect();
  showToast('บันทึก Style แล้ว ✓', 'success');
}

async function deleteStyle() {
  if (!S.editingStyleId || !confirm('ลบ Style นี้?')) return;
  S.currentWs.customStyles = S.currentWs.customStyles.filter(s => s.id !== S.editingStyleId);
  if (S.activeStyleId === S.editingStyleId) {
    const fallback = S.currentWs.customStyles[0]?.id || '';
    S.activeStyleId = fallback;
    S.currentWs.settings = { ...(S.currentWs.settings || {}), activeStyleId: fallback };
  }
  S.editingStyleId = null;  // reset after delete
  await lsSaveWorkspace(S.currentWs);
  closeModal('modal-new-style');
  renderStyles(); renderStyleSelect();
  showToast('ลบ Style แล้ว', '');
}

async function previewStyle() {
  const text = document.getElementById('styleTestText').value.trim();
  const stylePromptTxt = document.getElementById('stylePrompt').value.trim();
  if (!text || !stylePromptTxt) { showToast('ใส่ข้อความและ Prompt ก่อน', 'error'); return; }
  const resultEl = document.getElementById('stylePreviewResult');
  resultEl.textContent = 'กำลังทดสอบ...';
  resultEl.style.display = 'block';
  try {
    const result = await translateSegmentDirect(text, [], { model: document.getElementById('translateModel').value, customStylePrompt: stylePromptTxt, useMemory: false });
    resultEl.textContent = result.translation || '(ไม่มีผลลัพธ์)';
  } catch (e) { resultEl.textContent = '❌ ' + e.message; }
}

// ─── Translation Core (v10 — True Stream, Sequential) ───

// ความยาว context จากตอน/chunk ก่อนหน้า (ตัวอักษร) — ตั้งได้ต่อ workspace, default 400
function getPrevCtxChars() {
  const v = parseInt(S.currentWs?.settings?.prevCtxChars);
  return Math.max(100, Math.min(4000, v || 400));
}

function getOptions() {
  const styleId = document.getElementById('activeStyleSelect')?.value || S.activeStyleId;
  const customStylePrompt = getStyleById(styleId)?.prompt || null;
  const wsGlossary = {};
  (S.currentWs?.glossary || []).forEach(g => { wsGlossary[g.korean] = { thai: g.thai, type: g.type, note: g.note }; });

  // Prev chapter context
  let prevChapterContext = '';
  const usePrev = document.getElementById('usePrevChapter')?.checked;
  if (usePrev && S.currentWs?.chapters?.length) {
    const srcType = document.getElementById('prevChapterType')?.value || 'translation';
    const chapters = S.currentWs.chapters;
    const curId = S.editingChapterId;
    const curIdx = curId ? chapters.findIndex(c => c.id === curId) : -1;
    let prevCh = null;
    if (curIdx > 0) {
      prevCh = chapters[curIdx - 1];
    } else if (!curId) {
      for (let i = chapters.length - 1; i >= 0; i--) {
        if (chapters[i].translation) { prevCh = chapters[i]; break; }
      }
    }
    if (prevCh) {
      const ctxText = srcType === 'source' ? prevCh.sourceText : prevCh.translation;
      if (ctxText?.trim()) {
        const label = srcType === 'source' ? 'PREVIOUS CHAPTER (Original)' : 'PREVIOUS CHAPTER (Thai Translation)';
        const snippet = ctxText.trim().slice(-(getPrevCtxChars() * 2)); // ระดับตอนให้ context ยาวกว่า chunk 2 เท่า
        prevChapterContext = `${label} — last part:\n${snippet}\n`;
      }
    }
  }

  return {
    model: document.getElementById('translateModel').value,
    usePolish: document.getElementById('usePolish').checked,
    useMemory: document.getElementById('useMemory').checked,
    temperature: S.currentWs?.settings?.temperature ?? 0.7,
    chunkSize: parseInt(document.getElementById('chunkSize')?.value || '0') || 0,
    customStylePrompt,
    wsGlossary,
    prevChapterContext,
  };
}

function splitText(text) {
  const paragraphs = text.split(/\n\n+/).map(p => p.trim()).filter(Boolean);
  if (paragraphs.length === 0) return [{ index: 0, text }];
  return paragraphs.map((p, i) => ({ index: i, text: p }));
}

function buildGlossaryStr(wsGlossary) {
  const GENDER_MAP   = { male: 'male/ชาย', female: 'female/หญิง', neutral: 'neutral/กลาง' };
  const PRONOUN_3RD  = { male: '3rd→เขา/ของเขา', female: '3rd→เธอ/นาง/ของเธอ' };
  const PRONOUN_1ST  = { male: '1st→ผม/กู/ข้า', female: '1st→ฉัน/หนู/อิฉัน' };
  const entries = Object.entries(wsGlossary || {});
  if (!entries.length) return '(ไม่มี)';
  return entries.map(([k, v]) => {
    const parts = [v.thai];
    if (v.type === 'character' && v.gender && v.gender !== 'neutral') {
      parts.push(`gender:${GENDER_MAP[v.gender] || v.gender}`);
      parts.push(PRONOUN_3RD[v.gender]);
      parts.push(PRONOUN_1ST[v.gender]);
    } else if (v.type === 'character' && v.gender === 'neutral') {
      parts.push('gender:neutral/กลาง');
    }
    if (v.note) parts.push(v.note);
    return `${k} = ${parts.join(' | ')}`;
  }).join('\n');
}

function buildContextStr(segments, currentIndex) {
  if (currentIndex <= 0) return '';
  const prev = segments.slice(Math.max(0, currentIndex - 2), currentIndex);
  const translated = prev.filter(s => s.translation);
  if (!translated.length) return '';
  return `CONTEXT (previous paragraphs):\n${translated.map(s => s.translation).join('\n\n')}\n`;
}

// In-memory cache — LRU, จำกัด 200 entries (~50MB กัน leak)
const _MC_MAX = 200;
const _memoryCache = {};          // key → value
const _memoryCacheOrder = [];     // insertion order สำหรับ LRU eviction

function _mcSet(key, value) {
  if (_memoryCache[key] !== undefined) {
    // refresh position
    const pos = _memoryCacheOrder.indexOf(key);
    if (pos !== -1) _memoryCacheOrder.splice(pos, 1);
  } else if (_memoryCacheOrder.length >= _MC_MAX) {
    // evict oldest
    const oldest = _memoryCacheOrder.shift();
    delete _memoryCache[oldest];
  }
  _memoryCache[key] = value;
  _memoryCacheOrder.push(key);
}

function _mcGet(key) {
  return _memoryCache[key];
}

// ── True SSE streaming per segment — ใช้ aiStream (provider-aware) ──
async function streamSegment(text, contextSegs, options, onChunk, onDone) {
  const { model, temperature = 0.7, customStylePrompt, wsGlossary = {}, useMemory = true } = options;
  const cacheKey = text.slice(0, 120);

  if (useMemory && _mcGet(cacheKey)) {
    onChunk(_mcGet(cacheKey));
    onDone(_mcGet(cacheKey), true);
    return;
  }

  const key = getApiKey();
  if (!key) throw new Error('ยังไม่ได้ตั้ง API Key — ไปที่ ⚙ ตั้งค่า');

  const glossaryStr = buildGlossaryStr(wsGlossary);
  const contextStr = buildContextStr(contextSegs, contextSegs.length);
  const prompt = buildTranslatePrompt({
    sourceText: text,
    glossaryStr,
    contextStr,
    styleNote: customStylePrompt || '',
    ws: null, // streamSegment ไม่ผูกกับ ws ใดๆ (ใช้ literary as default)
  });

  // AbortController with 120s timeout
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), getTimeoutMs('chunk'));

  let inTok = 0, outTok = 0;
  let fullText = '';
  try {
    fullText = await aiStream(
      { model, temperature, max_tokens: Math.max(2000, Math.ceil(text.length * 2)), messages: [{ role: 'user', content: prompt }] },
      onChunk,
      (i, o) => { inTok = i; outTok = o; },
      ctrl.signal
    );
  } finally {
    clearTimeout(timer);
  }

  if (inTok || outTok) addCosts(inTok, outTok, model);
  if (useMemory && fullText) _mcSet(cacheKey, fullText);
  onDone(fullText, false);
}

// Fallback non-streaming (for preview/polish)
async function translateSegmentDirect(text, allSegments = [], options = {}) {
  const { model = 'google/gemini-2.5-flash', temperature = 0.7, customStylePrompt, wsGlossary = {}, useMemory = true, usePolish = false } = options;
  const cacheKey = text.slice(0, 120);
  if (useMemory && _mcGet(cacheKey)) return { translation: _mcGet(cacheKey), fromMemory: true };

  const glossaryStr = buildGlossaryStr(wsGlossary);
  const contextStr = buildContextStr(allSegments, allSegments.findIndex(s => s.text === text));
  const styleNote = customStylePrompt ? `STYLE GUIDE:\n${customStylePrompt}\n` : '';
  const prompt = TRANSLATE_PROMPT
    .replace('{style_note}', styleNote)
    .replace('{glossary}', glossaryStr)
    .replace('{context}', contextStr)
    .replace('{text}', text);

  const res = await callOpenRouter({ model, messages: [{ role: 'user', content: prompt }], temperature, max_tokens: Math.max(2000, Math.ceil(text.length * 2)) });
  let translation = res.choices?.[0]?.message?.content?.trim() || '';

  if (usePolish && translation) {
    const polishPrompt = POLISH_PROMPT.replace('{glossary}', glossaryStr).replace('{text}', translation);
    try {
      const pr = await callOpenRouter({ model, messages: [{ role: 'user', content: polishPrompt }], temperature: 0.5, max_tokens: Math.max(2000, translation.length * 2) });
      translation = pr.choices?.[0]?.message?.content?.trim() || translation;
    } catch {}
  }
  if (useMemory) _mcSet(cacheKey, translation);
  return { translation, fromMemory: false };
}

async function startTranslation() {
  const rawText = document.getElementById('sourceText').value.trim();
  if (!rawText) { showToast('ใส่ข้อความก่อน', 'error'); return; }
  if (S.translating) return;
  if (typeof rState !== 'undefined') readerCancelPrefetch(); // งาน manual มาก่อน prefetch
  // normalize Korean slang/jamo ก่อนส่ง AI (ไม่แก้ textarea)
  const text = prepareSourceForTranslation(rawText);
  const opts = getOptions();
  if (opts.chunkSize > 0) {
    await translateChunked(text, opts);
  } else {
    await translateAllStream(text);
  }
}

// ─── Auto Extract Glossary หลังแปลเสร็จ ───
// chapterInfo = { id, title, chapterNum } หรือ null ถ้าไม่รู้ตอน
async function autoExtractGlossaryAfterTranslation(sourceText, model, chapterInfo = null, translationText = '') {
  if (!S.currentWsId || !S.currentWs) return;
  if (!sourceText?.trim()) return;
  if (S.currentWs.settings?.autoGlossary === false) return;

  if (!Array.isArray(S.currentWs.glossary)) S.currentWs.glossary = [];

  const existing = S.currentWs.glossary.map(g => g.korean).join(', ') || '(none)';

  // เพิ่ม snippet ของ Thai translation เพื่อช่วย AI detect gender จากสรรพนามไทย
  const thaiSnippet = translationText?.trim()
    ? `THAI TRANSLATION (use Thai pronouns เขา/เธอ/ผม/ฉัน etc. to help infer character gender):\n${translationText.slice(0, 3000)}`
    : '';

  const basePrompt = (() => { try { return agGetPrompt(); } catch { return AUTOGLOSSARY_PROMPT; } })();
  const prompt = basePrompt
    .replace('{existing}', existing)
    .replace('{text}', sourceText.slice(0, 8000))
    .replace('{thai_snippet}', thaiSnippet);

  try {
    const res = await callOpenRouter({
      model: model || document.getElementById('translateModel')?.value || 'google/gemini-2.5-flash',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.2,
      max_tokens: 1500,
    });

    const raw = (res.choices?.[0]?.message?.content || '').trim().replace(/```json|```/g, '').trim();
    let terms;
    try { terms = JSON.parse(raw); }
    catch { terms = tryRepairJson(raw) || []; }

    if (!Array.isArray(terms) || !terms.length) {
      showToast('📖 Auto Glossary: ไม่พบคำศัพท์ใหม่', '');
      return;
    }

    let added = 0;
    terms.forEach(term => {
      if (!term.korean || !term.thai) return;
      const exactExists = S.currentWs.glossary.some(g => g.korean === term.korean);
      if (exactExists) return;
      // แนบ source chapter info ถ้ามี
      const entry = { ...term };
      // sanitize gender — only valid for character type, and must be a known value
      if (entry.type !== 'character' || !['male','female','neutral'].includes(entry.gender)) {
        delete entry.gender;
      }
      if (chapterInfo?.title) {
        entry.sourceChapterId    = chapterInfo.id    || null;
        entry.sourceChapterTitle = chapterInfo.title;
        entry.sourceChapterNum   = chapterInfo.chapterNum || null;
      }
      S.currentWs.glossary.push(entry);
      added++;
    });

    if (added > 0) {
      S.glossaryData = S.currentWs.glossary;
      await lsSaveWorkspace(S.currentWs);
      if (S.currentTab === 'glossary') renderGlossaryTable();
      const chLabel = chapterInfo?.title ? ` (ตอน #${chapterInfo.chapterNum||'?'} ${chapterInfo.title.slice(0,20)})` : '';
      showToast(`📖 Auto Glossary: เพิ่ม ${added} คำใหม่${chLabel} ✓`, 'success');
    } else {
      showToast('📖 Auto Glossary: คำทั้งหมดมีในคลังแล้ว', '');
    }
  } catch (e) {
    showToast(`📖 Auto Glossary ล้มเหลว: ${e.message}`, 'error');
  }
}

async function translateAllStream(text) {
  setTranslating(true);
  clearTranslation();
  showProgress(true);
  setStage('split', 'done');
  setStage('glossary', 'active');
  await new Promise(r => setTimeout(r, 60));
  setStage('glossary', 'done');
  setStage('translate', 'active');

  const output = document.getElementById('translationOutput');
  output.innerHTML = '';

  const options = getOptions();
  const cacheKey = text.slice(0, 120);

  // Build prompt — whole text as one
  const glossaryStr = buildGlossaryStr(options.wsGlossary);
  const styleNote = options.customStylePrompt ? options.customStylePrompt : '';
  const storyCtx = ctxGetPromptText(S.currentWs);
  const prevCtx  = (storyCtx ? storyCtx + '\n\n' : '') + (options.prevChapterContext ? `${options.prevChapterContext}\n` : '');
  const preset = getActivePreset(S.currentWs);
  const mtlDraft = presetIsMtlFix(preset)
    ? (() => { const c = S.currentWs?.chapters?.find(ch => ch.id === S.editingChapterId); return c?.translation || ''; })()
    : '';
  const prompt = buildTranslatePrompt({
    sourceText: text,
    glossaryStr,
    contextStr: prevCtx,
    styleNote,
    ws: S.currentWs,
    mtlDraft,
  });

  const key = getApiKey();
  if (!key) { showToast('ยังไม่ได้ตั้ง API Key', 'error'); setTranslating(false); showProgress(false); return; }

  const doTranslate = async () => {
  output.innerHTML = '';
  const txtEl = document.createElement('div');
  txtEl.className = 'segment-text';
  txtEl.style.whiteSpace = 'pre-wrap';
  const cursor = document.createElement('span');
  cursor.className = 'stream-cursor';
  txtEl.appendChild(cursor);
  output.appendChild(txtEl);

  // Check memory
  if (options.useMemory && _mcGet(cacheKey)) {
    cursor.remove();
    txtEl.textContent = _mcGet(cacheKey);
    setStage('translate', 'done'); setStage('done', 'done');
    updateProgress(100, 'แปลเสร็จสิ้น ✓');
    document.getElementById('translationStats').textContent = 'โหลดจาก Memory ✓';
    showToast('แปลเสร็จสิ้น ✓ (Memory)', 'success');
    return;
  }

  try {
    let charCount = 0;
    S.abortCtrl = new AbortController();
    const timer = setTimeout(() => S.abortCtrl.abort(), getTimeoutMs('full'));

    let inTok = 0, outTok = 0;
    let fullText = '';

    try {
      fullText = await aiStream(
        { model: options.model, temperature: preset.temperature ?? options.temperature, max_tokens: Math.max(4000, Math.ceil(text.length * 2)), messages: [{ role: 'user', content: prompt }] },
        (delta) => {
          charCount += delta.length;
          fullText += delta;
          if (cursor.parentNode === txtEl) txtEl.insertBefore(document.createTextNode(delta), cursor);
          else txtEl.appendChild(document.createTextNode(delta));
          const est = Math.min(95, Math.round(charCount / Math.max(text.length, 1) * 80));
          updateProgress(est, `กำลังแปล... ${charCount.toLocaleString()} ตัวอักษร`);
          if (output.scrollHeight - output.scrollTop - output.clientHeight < 160) output.scrollTop = output.scrollHeight;
        },
        (i, o) => { inTok = i; outTok = o; },
        S.abortCtrl.signal
      );
    } finally {
      clearTimeout(timer);
    }

    cursor.remove();
    if (inTok || outTok) addCosts(inTok, outTok, options.model);

    if (options.useMemory && fullText) _mcSet(cacheKey, fullText);

    // Optional polish
    if (options.usePolish && fullText) {
      setStage('polish', 'active');
      updateProgress(97, 'Polish...');
      const pp = POLISH_PROMPT.replace('{glossary}', glossaryStr).replace('{text}', fullText);
      try {
        const pr = await callOpenRouter({ model: options.model, messages: [{ role: 'user', content: pp }], temperature: 0.5, max_tokens: Math.max(4000, fullText.length * 2) });
        const polished = pr.choices?.[0]?.message?.content?.trim();
        if (polished) { fullText = polished; txtEl.textContent = polished; }
      } catch {}
      setStage('polish', 'done');
    }

    setStage('translate', 'done');
    setStage('done', 'done');
    updateProgress(100, 'แปลเสร็จสิ้น ✓');
    document.getElementById('translationStats').textContent = `${fullText.length.toLocaleString()} ตัวอักษร`;
    showToast('แปลเสร็จสิ้น ✓', 'success');
    // ดึง chapter info จาก chapter ที่กำลัง edit อยู่ (ถ้ามี)
    const _streamChInfo = S.editingChapterId
      ? (() => { const c = S.currentWs?.chapters?.find(ch => ch.id === S.editingChapterId); return c ? { id: c.id, title: c.title, chapterNum: c.chapterNum } : null; })()
      : null;
    autoExtractGlossaryAfterTranslation(text, options.model, _streamChInfo);
    // Context Memory: generate summary (non-blocking)
    if (_streamChInfo && fullText) {
      ctxAddSummary(S.currentWs, _streamChInfo.id, _streamChInfo.chapterNum, _streamChInfo.title, fullText)
        .catch(e => console.warn('[CTX]', e));
    }

  } catch (e) {
    cursor.remove();
    if (e.name === 'AbortError') {
      txtEl.textContent = '⬛ ถูกหยุดโดยผู้ใช้';
      updateProgress(0, 'หยุดแล้ว');
      showToast('⬛ หยุดการแปลแล้ว', '');
    } else {
      txtEl.textContent = `❌ ${e.message}`;
      showToast('Error: ' + e.message, 'error');
    }
  }
  }; // end doTranslate

  try {
    await doTranslate();
  } finally {
    setTranslating(false);
    setTimeout(() => showProgress(false), 4000);
  }
}

// ─── Chunk-based translation ───
function splitByChunkSize(text, size) {
  if (!size || size <= 0) return [text];
  const chunks = [];
  // Try to split at natural boundaries (newline) near the chunk boundary
  let pos = 0;
  while (pos < text.length) {
    let end = pos + size;
    if (end >= text.length) {
      chunks.push(text.slice(pos));
      break;
    }
    // Look for nearest newline within ±20% of chunk size to split cleanly
    const lookBack = Math.floor(size * 0.2);
    const nlPos = text.lastIndexOf('\n', end);
    if (nlPos > pos + size - lookBack) {
      end = nlPos + 1; // split after newline
    } else {
      // No good newline — try space
      const spPos = text.lastIndexOf(' ', end);
      if (spPos > pos + size - lookBack) end = spPos + 1;
    }
    chunks.push(text.slice(pos, end));
    pos = end;
  }
  return chunks.filter(c => c.trim());
}

// hash เบาๆ ไว้เช็คว่า source เดิมไหม (length + หัว/ท้าย 64 ตัวอักษร)
function _chunkSrcHash(text) {
  return text.length + ':' + text.slice(0, 64) + ':' + text.slice(-64);
}

async function translateChunked(text, options) {
  setTranslating(true);
  clearTranslation();
  showProgress(true);
  setStage('glossary', 'active');
  await new Promise(r => setTimeout(r, 60));
  setStage('glossary', 'done');
  setStage('translate', 'active');

  const output = document.getElementById('translationOutput');
  output.innerHTML = '';

  const chunks = splitByChunkSize(text, options.chunkSize);
  const n = chunks.length;

  const styleNote = options.customStylePrompt ? `STYLE GUIDE:\n${options.customStylePrompt}\n` : '';
  const key = getApiKey();
  if (!key) { showToast('ยังไม่ได้ตั้ง API Key', 'error'); setTranslating(false); showProgress(false); return; }

  let completedTranslations = [];
  let startIdx = 0;

  // ── Resume งานแปลค้าง: chapter เดิม + source/chunkSize ตรงกัน → แปลต่อจาก chunk ล่าสุด ──
  const _srcHash = _chunkSrcHash(text);
  if (S.editingChapterId && S.currentWs) {
    const _rCh = S.currentWs.chapters?.find(ch => ch.id === S.editingChapterId);
    const cp = _rCh?.chunkProgress;
    if (cp && cp.srcHash === _srcHash && cp.chunkSize === options.chunkSize
        && Array.isArray(cp.chunks) && cp.chunks.length > 0 && cp.chunks.length < n) {
      if (confirm(`พบงานแปลค้างไว้ ${cp.chunks.length}/${n} chunk — แปลต่อจากเดิมเลยไหม?\n(ยกเลิก = เริ่มแปลใหม่ทั้งหมด)`)) {
        completedTranslations = [...cp.chunks];
        startIdx = cp.chunks.length;
      }
    }
  }

  showToast(startIdx > 0
    ? `แปลต่อจาก chunk ${startIdx + 1}/${n} (${options.chunkSize} ตัวอักษร/chunk)`
    : `แบ่งเป็น ${n} chunk (${options.chunkSize} ตัวอักษร/chunk)`, '');

  // แสดง chunk ที่เสร็จค้างไว้แล้ว
  for (let i = 0; i < startIdx; i++) {
    const wrapEl = document.createElement('div');
    wrapEl.className = 'translation-segment';
    wrapEl.innerHTML = `<div class="segment-index"><span>chunk ${i + 1}/${n}</span><span class="seg-status cached">📦 ค้างไว้</span></div>`;
    const txtEl = document.createElement('div');
    txtEl.className = 'segment-text';
    txtEl.style.whiteSpace = 'pre-wrap';
    txtEl.textContent = completedTranslations[i];
    wrapEl.appendChild(txtEl);
    output.appendChild(wrapEl);
  }

  try {
    for (let i = startIdx; i < n; i++) {
      const chunk = chunks[i];
      updateProgress(Math.round(i / n * 100), `chunk ${i+1}/${n} (${chunk.length} ตัวอักษร)`);

      // Smart Glossary: กรองเฉพาะคำที่ปรากฏใน chunk นี้ (ลด token)
      const smartGloss = getSmartGlossary(chunk, S.glossaryData);
      const smartGlossObj = smartGloss.reduce((acc, g) => { acc[g.korean] = { thai: g.thai, type: g.type, note: g.note, gender: g.gender }; return acc; }, {});
      const glossaryStr = buildGlossaryStr(smartGlossObj);

      // Build DOM for this chunk
      const wrapEl = document.createElement('div');
      wrapEl.className = 'translation-segment';

      const idxEl = document.createElement('div');
      idxEl.className = 'segment-index';
      idxEl.innerHTML = `<span>chunk ${i+1}/${n}</span><span class="seg-status active">⚡ กำลังแปล</span>`;

      const txtEl = document.createElement('div');
      txtEl.className = 'segment-text';
      txtEl.style.whiteSpace = 'pre-wrap';

      const cursor = document.createElement('span');
      cursor.className = 'stream-cursor';
      txtEl.appendChild(cursor);

      wrapEl.appendChild(idxEl);
      wrapEl.appendChild(txtEl);
      output.appendChild(wrapEl);
      wrapEl.scrollIntoView({ block: 'nearest', behavior: 'smooth' });

      const badge = idxEl.querySelector('.seg-status');

      // Check memory cache
      const cacheKey = chunk.slice(0, 120);
      if (options.useMemory && _mcGet(cacheKey)) {
        cursor.remove();
        txtEl.textContent = _mcGet(cacheKey);
        completedTranslations.push(txtEl.textContent);
        badge.className = 'seg-status cached';
        badge.innerHTML = '📦 Memory';
        updateProgress(Math.round((i+1)/n*100), `chunk ${i+1}/${n} เสร็จ`);
        continue;
      }

      // Build context from tail of previous translation only (ลด token)
      const prevTail = completedTranslations.length
        ? completedTranslations[completedTranslations.length - 1].slice(-getPrevCtxChars())
        : '';
      const chunkCtx = prevTail ? `CONTEXT (ท้ายของ chunk ก่อนหน้า):\n${prevTail}\n` : '';
      const _baseCtx = (options.prevChapterContext && !completedTranslations.length)
        ? options.prevChapterContext + '\n' + chunkCtx
        : chunkCtx;
      // Inject story context on first chunk only (ประหยัด token)
      const _storyCtx = !completedTranslations.length ? ctxGetPromptText(S.currentWs) : '';
      const ctxStr = (_storyCtx ? _storyCtx + '\n\n' : '') + _baseCtx;

      const chunkPreset = getActivePreset(S.currentWs);
      const prompt = buildTranslatePrompt({
        sourceText: chunk,
        glossaryStr,
        contextStr: ctxStr,
        styleNote: options.customStylePrompt || '',
        ws: S.currentWs,
      });

      let chunkFull = '';
      let inTok = 0, outTok = 0;

      try {
        // ใช้ global abort + timeout 120s
        S.abortCtrl = new AbortController();
        const timer = setTimeout(() => S.abortCtrl.abort(), getTimeoutMs('chunk'));
        try {
          chunkFull = await aiStream(
            { model: options.model, temperature: chunkPreset.temperature ?? options.temperature, max_tokens: Math.max(2000, Math.ceil(chunk.length * 2)), messages: [{ role: 'user', content: prompt }] },
            (delta) => {
              chunkFull += delta;
              if (cursor.parentNode === txtEl) txtEl.insertBefore(document.createTextNode(delta), cursor);
              else txtEl.appendChild(document.createTextNode(delta));
              if (output.scrollHeight - output.scrollTop - output.clientHeight < 160) output.scrollTop = output.scrollHeight;
            },
            (i, o) => { inTok = i; outTok = o; },
            S.abortCtrl.signal
          );
        } finally { clearTimeout(timer); }

        cursor.remove();
        if (inTok || outTok) addCosts(inTok, outTok, options.model);

        if (options.useMemory && chunkFull) _mcSet(cacheKey, chunkFull);
        completedTranslations.push(chunkFull);

        // Polish pass
        if (options.usePolish && chunkFull) {
          badge.className = 'seg-status active';
          badge.textContent = '✨ Polish';
          const pp = POLISH_PROMPT.replace('{glossary}', glossaryStr).replace('{text}', chunkFull);
          try {
            const pr = await callOpenRouter({ model: options.model, messages: [{ role: 'user', content: pp }], temperature: 0.5, max_tokens: Math.max(2000, Math.ceil(chunkFull.length * 1.2)) });
            const polished = pr.choices?.[0]?.message?.content?.trim();
            if (polished) { chunkFull = polished; txtEl.textContent = polished; completedTranslations[completedTranslations.length-1] = polished; }
          } catch {}
        }

        badge.className = 'seg-status done';
        badge.textContent = `✓ ${chunkFull.length} ตัวอักษร`;
        updateProgress(Math.round((i+1)/n*100), `chunk ${i+1}/${n} เสร็จ`);

        // Partial save: บันทึก chunk ที่เสร็จแล้วเข้า chapter ทันที (กัน data loss ถ้าหยุดกลางคัน)
        // + chunkProgress สำหรับ resume — ลบทิ้งเมื่อแปลครบ
        if (S.editingChapterId && S.currentWs) {
          const _pCh = S.currentWs.chapters?.find(ch => ch.id === S.editingChapterId);
          if (_pCh) {
            _pCh.translation = completedTranslations.join('\n\n');
            _pCh.status = i + 1 < n ? 'partial' : 'translated';
            if (i + 1 < n) {
              _pCh.chunkProgress = { chunkSize: options.chunkSize, srcHash: _srcHash, chunks: [...completedTranslations], updatedAt: Date.now() };
            } else {
              delete _pCh.chunkProgress;
            }
            _pCh.updatedAt = Date.now();
            lsSaveWorkspace(S.currentWs).catch(() => {});
          }
        }

      } catch (err) {
        cursor.remove();
        // ถ้า user กดหยุด → ออกจาก loop ทันที
        if (err.name === 'AbortError') {
          badge.className = 'seg-status error';
          badge.textContent = '⬛ หยุดแล้ว';
          txtEl.textContent = '⬛ ถูกหยุดโดยผู้ใช้';
          updateProgress(Math.round((i+1)/n*100), `หยุดที่ chunk ${i+1}/${n}`);
          break;
        }
        badge.className = 'seg-status error';
        badge.textContent = '✗ Error';
        txtEl.textContent = `❌ ${err.message}`;
        completedTranslations.push('');
        updateProgress(Math.round((i+1)/n*100), `chunk ${i+1}/${n} Error`);
      }
    }

    setStage('translate', 'done');
    if (options.usePolish) setStage('polish', 'done');
    setStage('done', 'done');
    updateProgress(100, 'แปลเสร็จสิ้น ✓');
    const totalChars = completedTranslations.join('').length;
    document.getElementById('translationStats').textContent = `แปลเสร็จ ${n} chunks · ${totalChars.toLocaleString()} ตัวอักษร`;
    showToast(`แปลเสร็จ ${n} chunks ✓`, 'success');

    // ── Auto Extract Glossary ──
    const _chunkChInfo = S.editingChapterId
      ? (() => { const c = S.currentWs?.chapters?.find(ch => ch.id === S.editingChapterId); return c ? { id: c.id, title: c.title, chapterNum: c.chapterNum } : null; })()
      : null;
    const _fullTranslation = completedTranslations.join('\n\n');
    autoExtractGlossaryAfterTranslation(text, options.model, _chunkChInfo, _fullTranslation);
    // Context Memory: generate summary (non-blocking)
    if (_chunkChInfo && _fullTranslation) {
      ctxAddSummary(S.currentWs, _chunkChInfo.id, _chunkChInfo.chapterNum, _chunkChInfo.title, _fullTranslation)
        .catch(e => console.warn('[CTX]', e));
    }

  } catch (e) {
    showToast('Error: ' + e.message, 'error');
  } finally {
    setTranslating(false);
    setTimeout(() => showProgress(false), 4000);
  }
}


// ─── QA Check ───
async function runQACheck() {
  const source = document.getElementById('sourceText').value.trim();
  const translation = document.getElementById('translationOutput').innerText.trim();
  if (!source || !translation || translation === 'คำแปลจะปรากฏที่นี่...') {
    showToast('ต้องมีทั้งต้นฉบับและคำแปลก่อน', 'error'); return;
  }
  showToast('กำลังตรวจ QA...', '');
  try {
    const glossaryStr = buildGlossaryStr(getOptions().wsGlossary);
    const prompt = QA_PROMPT
      .replace('{glossary}', glossaryStr)
      .replace('{source}', source)
      .replace('{translation}', translation);
    const res = await callOpenRouter({ model: document.getElementById('translateModel').value, messages: [{ role: 'user', content: prompt }], temperature: 0.1, max_tokens: 1000 });
    const txt = res.choices?.[0]?.message?.content?.trim() || '{}';
    const r = JSON.parse(txt.replace(/```json|```/g, '').trim());
    const msg = r.pass ? `✓ PASS (${r.score}/100): ${r.summary}` : `✗ FAIL (${r.score}/100): ${r.summary}`;
    showToast(msg, r.pass ? 'success' : 'error');
  } catch (e) { showToast('QA ล้มเหลว: ' + e.message, 'error'); }
}

// ─── Glossary Detection ───
function detectGlossary() {
  const text = document.getElementById('sourceText').value.trim();
  if (!text) { showToast('ใส่ข้อความก่อน', 'error'); return; }
  const glossary = S.currentWs?.glossary || [];
  if (!glossary.length) { showToast('ยังไม่มีคลังศัพท์', ''); return; }

  let highlighted = esc(text);
  let matchCount = 0;
  glossary.forEach(g => {
    const escaped = g.korean.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(escaped, 'g');
    if (regex.test(highlighted)) {
      matchCount++;
      highlighted = highlighted.replace(new RegExp(escaped, 'g'), `<mark class="glossary-term" title="${esc(g.thai)}">${esc(g.korean)}</mark>`);
    }
  });

  if (!matchCount) { showToast('ไม่พบคำศัพท์ในคลัง', ''); return; }
  const hl = document.getElementById('sourceHighlight');
  hl.innerHTML = highlighted;
  hl.style.display = 'block';
  document.getElementById('sourceText').style.display = 'none';
  showToast(`พบ ${matchCount} คำศัพท์ (แตะเพื่อซ่อน)`, 'success');
}

function hideHighlight() {
  document.getElementById('sourceHighlight').style.display = 'none';
  document.getElementById('sourceText').style.display = 'block';
}

// ─── API Key Settings (ต่อ provider) ───
function openApiSettings() {
  const c = document.getElementById('apiKeysContainer');
  const active = getProvider();
  c.innerHTML = Object.entries(PROVIDERS).map(([id, p]) => `
    <div class="sf-group" style="border-bottom:1px solid var(--border);padding-bottom:10px;margin-bottom:10px">
      <div class="sf-label">${p.label}${id === active ? ' <span style="color:var(--gold);font-size:0.68rem">← ใช้อยู่</span>' : ''}</div>
      <input id="apiKey-${id}" type="password" class="text-input" placeholder="${p.keyPlaceholder}"/>
      <div style="display:flex;align-items:center;gap:10px;margin-top:4px;flex-wrap:wrap">
        <button class="btn-xs" onclick="testApiKey('${id}')">▶ ทดสอบ</button>
        <span id="apiTestResult-${id}" style="font-size:0.72rem;color:var(--text-muted)">${p.keyHint}</span>
      </div>
    </div>`).join('');
  c.innerHTML += `
    <div class="sf-group" style="margin-top:4px">
      <div class="sf-label">⏱ Timeout การเรียก AI (วินาที)</div>
      <div style="display:flex;align-items:center;gap:8px">
        <input id="apiTimeoutSec" type="number" class="text-input" style="width:90px" min="20" max="900" step="10"/>
        <span style="font-size:0.72rem;color:var(--text-muted)">default 120 — โมเดลช้า/ตอนยาวให้เพิ่ม (ทั้งตอนได้เวลา 1.5 เท่า)</span>
      </div>
    </div>`;
  // เติมค่า key เดิมผ่าน .value (เลี่ยงปัญหา escape ใน attribute)
  for (const [id, p] of Object.entries(PROVIDERS)) {
    const el = document.getElementById('apiKey-' + id);
    if (el) el.value = localStorage.getItem(p.lsKey) || '';
  }
  document.getElementById('apiTimeoutSec').value = parseInt(localStorage.getItem('nt8_timeout_s')) || 120;
  openModal('modal-settings');
}

function saveApiKey() {
  let saved = 0;
  for (const [id, p] of Object.entries(PROVIDERS)) {
    const el = document.getElementById('apiKey-' + id);
    if (!el) continue;
    const v = el.value.trim();
    if (v) { localStorage.setItem(p.lsKey, v); saved++; }
    else localStorage.removeItem(p.lsKey);
  }
  const tSec = Math.max(20, Math.min(900, parseInt(document.getElementById('apiTimeoutSec')?.value) || 120));
  localStorage.setItem('nt8_timeout_s', String(tSec));
  closeModal('modal-settings');
  checkHealth();
  renderProviderUI();
  showToast(`บันทึก API Key แล้ว ✓ (${saved} provider)`, 'success');
}

async function testApiKey(provId) {
  const p = PROVIDERS[provId];
  if (!p) return;
  const key = document.getElementById('apiKey-' + provId)?.value.trim();
  const result = document.getElementById('apiTestResult-' + provId);
  if (!key) { result.textContent = '⚠ ใส่ key ก่อน'; result.style.color = 'var(--gold)'; return; }
  result.textContent = 'กำลังทดสอบ...'; result.style.color = 'var(--text-muted)';
  try {
    const t = p.testEndpoint(key);
    const res = await fetch(t.url, { headers: t.headers });
    if (res.ok) { result.textContent = '✓ Key ใช้งานได้'; result.style.color = '#4caf50'; }
    else { result.textContent = `✗ Key ไม่ถูกต้อง (HTTP ${res.status})`; result.style.color = 'var(--crimson-light)'; }
  } catch { result.textContent = '✗ ทดสอบไม่สำเร็จ (เครือข่าย/CORS)'; result.style.color = 'var(--crimson-light)'; }
}

// ─── Cost Tracker ───
function resetCosts() {
  S.costs = { tokens: { total:0, input:0, output:0 }, costUSD:0, costTHB:0 };
  localStorage.setItem(LS_KEY_COSTS, JSON.stringify(S.costs));
  updateCostUI();
  showToast('รีเซ็ตต้นทุนแล้ว', '');
}

// ─── Progress UI ───
function showProgress(show) {
  document.getElementById('progressContainer').style.display = show ? 'block' : 'none';
  if (show) { ['glossary','translate','polish','done'].forEach(s => setStage(s,'')); updateProgress(0,'กำลังเริ่ม...'); }
}
function updateProgress(pct, label) {
  document.getElementById('progressFill').style.width = pct + '%';
  document.getElementById('progressPct').textContent = pct + '%';
  if (label) document.getElementById('progressLabel').textContent = label;
}
function setStage(stage, status) {
  const el = document.getElementById(`stage-${stage}`);
  if (el) el.className = 'stage' + (status ? ' ' + status : '');
}

// ─── Auto Glossary ───
let _agTerms = [];
let _agTab = 'manual';

function agSwitchTab(tab) {
  _agTab = tab;
  document.getElementById('agPanelManual').style.display = tab === 'manual' ? 'block' : 'none';
  document.getElementById('agPanelChapters').style.display = tab === 'chapters' ? 'block' : 'none';
  const btnManual = document.getElementById('agTabManual');
  const btnChapters = document.getElementById('agTabChapters');
  btnManual.style.borderBottom = tab === 'manual' ? '2px solid var(--gold)' : 'none';
  btnManual.style.color = tab === 'manual' ? 'var(--gold)' : '';
  btnManual.className = tab === 'manual' ? 'btn btn-secondary btn-sm' : 'btn btn-ghost btn-sm';
  btnChapters.style.borderBottom = tab === 'chapters' ? '2px solid var(--gold)' : 'none';
  btnChapters.style.color = tab === 'chapters' ? 'var(--gold)' : '';
  btnChapters.className = tab === 'chapters' ? 'btn btn-secondary btn-sm' : 'btn btn-ghost btn-sm';
}

function agRenderChapterList() {
  const list = document.getElementById('agChapterList');
  const chapters = [...(S.currentWs?.chapters || [])].sort((a,b) => (a.chapterNum||0)-(b.chapterNum||0));
  if (!chapters.length) { list.innerHTML = '<div style="font-size:0.78rem;color:var(--text-muted);padding:6px">ยังไม่มีตอน</div>'; return; }
  list.innerHTML = chapters.map(ch => `
    <label class="ag-ch-row" style="display:flex;align-items:center;gap:8px;padding:5px 6px;border-radius:4px;cursor:pointer">
      <input type="checkbox" class="ag-ch-chk" data-id="${ch.id}" style="accent-color:var(--gold)" onchange="agUpdateChaptersInfo()"/>
      <span style="font-size:0.78rem;color:var(--text-muted);min-width:28px">#${ch.chapterNum||'?'}</span>
      <span style="font-size:0.82rem;color:var(--text-primary);flex:1">${esc(ch.title)}</span>
      <span style="font-size:0.68rem;color:var(--text-muted)">${ch.sourceText ? ch.sourceText.length.toLocaleString()+' ตัวอักษร' : 'ไม่มีต้นฉบับ'}</span>
    </label>
  `).join('');
}

function agUpdateChaptersInfo() {
  const checked = document.querySelectorAll('.ag-ch-chk:checked');
  const total = [...checked].reduce((s, el) => {
    const ch = S.currentWs?.chapters.find(c => c.id === el.dataset.id);
    return s + (ch?.sourceText?.length || 0);
  }, 0);
  document.getElementById('agChaptersInfo').textContent = checked.length ? `เลือก ${checked.length} ตอน · ${total.toLocaleString()} ตัวอักษรรวม` : '';
}

function agSelectAllChapters() {
  document.querySelectorAll('.ag-ch-chk').forEach(el => el.checked = true);
  agUpdateChaptersInfo();
}
function agDeselectAllChapters() {
  document.querySelectorAll('.ag-ch-chk').forEach(el => el.checked = false);
  agUpdateChaptersInfo();
}

function openAutoGlossary() {
  const src = document.getElementById('sourceText')?.value?.trim() || '';
  document.getElementById('agSourceText').value = src;
  document.getElementById('agResults').style.display = 'none';
  document.getElementById('agStatus').textContent = '';
  _agTerms = [];
  _agTab = 'manual';
  agSwitchTab('manual');
  agRenderChapterList();
  renderModelSelect(document.getElementById('agModel'), getProvider(), document.getElementById('translateModel')?.value, false);
  openModal('modal-autoglossary');
}



function renderAgResults(terms) {
  const list = document.getElementById('agResultList');
  list.innerHTML = terms.map((t, i) => `
    <div class="ag-item selected" id="ag-item-${i}" onclick="toggleAgItem(${i})">
      <input class="ag-check" type="checkbox" id="ag-chk-${i}" checked onclick="event.stopPropagation();syncAgItem(${i})"/>
      <span class="ag-korean">${esc(t.korean)}</span>
      <span class="ag-arrow">→</span>
      <input class="ag-thai-input" id="ag-thai-${i}" value="${esc(t.thai)}" onclick="event.stopPropagation()" title="แก้ไขคำแปล"/>
      <span class="ag-type-badge"><span class="tag tag-${t.type || 'term'}">${t.type || 'term'}</span></span>
      <span class="ag-note">${esc(t.note || '')}</span>
    </div>
  `).join('');
}

function toggleAgItem(i) {
  const chk = document.getElementById(`ag-chk-${i}`);
  const item = document.getElementById(`ag-item-${i}`);
  chk.checked = !chk.checked;
  item.classList.toggle('selected', chk.checked);
}
function syncAgItem(i) {
  const chk = document.getElementById(`ag-chk-${i}`);
  document.getElementById(`ag-item-${i}`).classList.toggle('selected', chk.checked);
}
function selectAllAg() { _agTerms.forEach((_, i) => { document.getElementById(`ag-chk-${i}`).checked = true; document.getElementById(`ag-item-${i}`).classList.add('selected'); }); }
function deselectAllAg() { _agTerms.forEach((_, i) => { document.getElementById(`ag-chk-${i}`).checked = false; document.getElementById(`ag-item-${i}`).classList.remove('selected'); }); }



// ─── Find & Replace (v2) ───
let _frMatches = [];
let _frMatchIdx = -1;
let _frHighlightNodes = [];
let _frHistory = (() => { try { return JSON.parse(sessionStorage.getItem('fr_history') || '[]'); } catch { return []; } })();

// ─── Translation Context Memory ───
const CTX_SUMMARY_PROMPT = `วิเคราะห์และสรุปบทนี้สำหรับใช้เป็น context ในการแปลตอนถัดไป โดยระบุ:
1. ตัวละครที่ปรากฏ: ชื่อ, เพศ, สรรพนามที่ใช้แทนตัว (ผม/ฉัน/เรา/กู ฯลฯ)
2. เหตุการณ์สำคัญ (2-3 ประโยค)
3. อารมณ์/บรรยากาศท้ายตอน

ตอบเป็นภาษาไทย กระชับ ไม่เกิน 120 คำ`;

const CTX_COMPRESS_PROMPT = `รวม context summaries เหล่านี้ให้เป็น summary เดียว ไม่เกิน 180 คำ คงไว้ซึ่งชื่อตัวละคร เพศ สรรพนาม และเหตุการณ์สำคัญที่ยังส่งผลต่อเรื่อง:`;

function wsGetContext(ws) {
  if (!ws) return null;
  if (!ws.translationContext) {
    ws.translationContext = { enabled: false, maxTokens: 1500, summaries: [] };
  }
  return ws.translationContext;
}

function ctxEstimateTokens(text) {
  return Math.ceil((text || '').length / 3); // Thai ~3 chars/token
}

function ctxGetTotalTokens(ws) {
  const ctx = wsGetContext(ws);
  return ctx ? ctx.summaries.reduce((s, x) => s + (x.tokens || 0), 0) : 0;
}

function ctxGetPromptText(ws) {
  const ctx = wsGetContext(ws);
  if (!ctx || !ctx.enabled || !ctx.summaries.length) return '';
  const parts = ctx.summaries.map(s => {
    const label = s.compressed ? `📚 ${s.title}` : `ตอน ${s.chapterNum}${s.title ? ': ' + s.title : ''}`;
    return `[${label}]\n${s.text}`;
  });
  return `### บริบทเรื่องที่ผ่านมา (ใช้เพื่อความสอดคล้องในการแปล — ห้ามแปลส่วนนี้)\n${parts.join('\n\n')}`;
}

async function ctxAddSummary(ws, chId, chapterNum, title, translatedText) {
  const ctx = wsGetContext(ws);
  if (!ctx || !ctx.enabled || !translatedText?.trim()) return;

  const summary = await ctxGenerateSummary(translatedText, ws);
  if (!summary) return;

  // Remove old entry for same chapter
  ctx.summaries = ctx.summaries.filter(s => s.chId !== chId);
  ctx.summaries.push({
    chId, chapterNum: chapterNum || 0, title: title || '',
    text: summary, tokens: ctxEstimateTokens(summary),
    compressed: false, createdAt: Date.now()
  });
  ctx.summaries.sort((a, b) => (a.chapterNum || 0) - (b.chapterNum || 0));

  await ctxMaybeCompress(ws);
  await lsSaveWorkspace(ws);
  ctxUpdateStatusBadge(ws);

  // Refresh modal if open
  if (document.getElementById('modal-ctx-manager')?.style.display !== 'none') ctxRenderSummaries();
}

async function ctxGenerateSummary(translatedText, ws) {
  const ctx = wsGetContext(ws);
  try {
    const res = await callOpenRouter({
      model: 'google/gemini-2.5-flash-lite',
      messages: [{ role: 'user', content: `${CTX_SUMMARY_PROMPT}\n\n---\n${translatedText.slice(0, 4000)}` }],
      temperature: 0.3, max_tokens: 350,
    });
    return res.choices?.[0]?.message?.content?.trim() || null;
  } catch(e) {
    console.warn('[CTX] summary failed:', e);
    return null;
  }
}

async function ctxMaybeCompress(ws) {
  const ctx = wsGetContext(ws);
  if (!ctx) return;
  const total = ctxGetTotalTokens(ws);
  if (total <= ctx.maxTokens) return;
  if (ctx.summaries.length <= 2) { ctx.summaries.shift(); return; }

  const toCompress = ctx.summaries.slice(0, -2);
  const toKeep     = ctx.summaries.slice(-2);
  const combined   = toCompress.map(s => `[${s.compressed ? s.title : 'ตอน ' + s.chapterNum}]:\n${s.text}`).join('\n\n');

  try {
    const res = await callOpenRouter({
      model: 'google/gemini-2.5-flash-lite',
      messages: [{ role: 'user', content: `${CTX_COMPRESS_PROMPT}\n\n${combined}` }],
      temperature: 0.3, max_tokens: 500,
    });
    const compressed = res.choices?.[0]?.message?.content?.trim();
    if (compressed) {
      const first = toCompress[0], last = toCompress[toCompress.length - 1];
      ctx.summaries = [{
        chId: `compressed_${Date.now()}`,
        chapterNum: first.chapterNum,
        title: `สรุปรวม ตอน ${first.chapterNum}–${last.chapterNum}`,
        text: compressed, tokens: ctxEstimateTokens(compressed),
        compressed: true, createdAt: Date.now()
      }, ...toKeep];
      showToast('🧠 Context compressed อัตโนมัติ', 'info', 2500);
    }
  } catch(e) {
    console.warn('[CTX] compress failed:', e);
    ctx.summaries.shift(); // fallback: drop oldest
  }
}

// ── Context Manager UI ──
function openContextManager() {
  const ws = S.currentWs;
  if (!ws) { showToast('เปิด Workspace ก่อน', 'error'); return; }
  ctxRenderSummaries();
  openModal('modal-ctx-manager');
}

function ctxRenderSummaries() {
  const ws  = S.currentWs;
  const ctx = wsGetContext(ws);
  const list    = document.getElementById('ctxSummaryList');
  const totalEl = document.getElementById('ctxTokenTotal');
  const barEl   = document.getElementById('ctxTokenBar');
  if (!ctx || !list) return;

  const total = ctxGetTotalTokens(ws);
  const pct   = Math.min(100, Math.round((total / (ctx.maxTokens || 1500)) * 100));
  if (totalEl) totalEl.textContent = `${total} / ${ctx.maxTokens} tokens (${pct}%)`;
  if (barEl) {
    barEl.style.width = pct + '%';
    barEl.style.background = pct > 85 ? 'var(--crimson)' : pct > 60 ? 'var(--gold)' : 'var(--accent)';
  }

  if (!ctx.summaries.length) {
    list.innerHTML = `<div style="text-align:center;color:var(--text-muted);padding:28px;font-size:0.83rem">
      ยังไม่มี context summary<br>
      <span style="font-size:0.75rem">จะถูกสร้างอัตโนมัติหลังแปลแต่ละตอน (เมื่อเปิดใช้งาน)</span>
    </div>`;
    return;
  }

  list.innerHTML = ctx.summaries.map((s, idx) => `
    <div style="background:var(--surface-1);border:1px solid var(--border);border-radius:var(--radius);padding:10px 12px;margin-bottom:8px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
        <div style="font-size:0.78rem;font-weight:600;color:var(--text-primary)">
          ${s.compressed ? '📚 ' + s.title : '📄 ตอน ' + s.chapterNum + (s.title ? ': ' + s.title : '')}
        </div>
        <div style="display:flex;align-items:center;gap:6px">
          <span style="font-size:0.68rem;color:var(--text-muted)">${s.tokens || 0} tokens</span>
          <button class="btn-xs" onclick="ctxDeleteSummary(${idx})" style="color:var(--crimson-light)" title="ลบ">🗑</button>
        </div>
      </div>
      <textarea
        style="width:100%;box-sizing:border-box;background:var(--bg-deep);border:1px solid var(--border);
               border-radius:4px;padding:6px 8px;font-size:0.78rem;line-height:1.7;color:var(--text-secondary);
               resize:vertical;min-height:70px;font-family:inherit"
        onchange="ctxUpdateSummary(${idx}, this.value)">${escHtml(s.text)}</textarea>
    </div>
  `).join('');
}

function ctxUpdateSummary(idx, newText) {
  const ctx = wsGetContext(S.currentWs);
  if (!ctx?.summaries[idx]) return;
  ctx.summaries[idx].text   = newText;
  ctx.summaries[idx].tokens = ctxEstimateTokens(newText);
  // Refresh token bar only
  const total = ctxGetTotalTokens(S.currentWs);
  const pct   = Math.min(100, Math.round((total / (ctx.maxTokens || 1500)) * 100));
  const totalEl = document.getElementById('ctxTokenTotal');
  const barEl   = document.getElementById('ctxTokenBar');
  if (totalEl) totalEl.textContent = `${total} / ${ctx.maxTokens} tokens (${pct}%)`;
  if (barEl) barEl.style.width = pct + '%';
}

function ctxDeleteSummary(idx) {
  const ctx = wsGetContext(S.currentWs);
  if (!ctx) return;
  ctx.summaries.splice(idx, 1);
  ctxRenderSummaries();
}

async function ctxSaveAndClose() {
  await lsSaveWorkspace(S.currentWs);
  ctxUpdateStatusBadge(S.currentWs);
  showToast('บันทึก context แล้ว ✓', 'success');
  closeModal('modal-ctx-manager');
}

async function ctxResetAll() {
  if (!confirm('ล้าง context ทั้งหมดใช่ไหม?')) return;
  const ctx = wsGetContext(S.currentWs);
  if (ctx) ctx.summaries = [];
  await lsSaveWorkspace(S.currentWs);
  ctxUpdateStatusBadge(S.currentWs);
  ctxRenderSummaries();
  showToast('ล้าง context แล้ว', 'info');
}

function ctxToggleEnabled(enabled) {
  const ctx = wsGetContext(S.currentWs);
  if (!ctx) return;
  ctx.enabled = enabled;
  document.getElementById('wsCtxOptions').style.display = enabled ? 'block' : 'none';
  ctxUpdateStatusBadge(S.currentWs);
  lsSaveWorkspace(S.currentWs);
}

function ctxSetMaxTokens(val) {
  const ctx = wsGetContext(S.currentWs);
  if (!ctx) return;
  ctx.maxTokens = parseInt(val) || 1500;
  ctxUpdateStatusBadge(S.currentWs);
  lsSaveWorkspace(S.currentWs);
}

function ctxUpdateStatusBadge(ws) {
  const ctx = wsGetContext(ws);
  const el  = document.getElementById('wsCtxStatus');
  if (!el || !ctx) return;
  const n     = ctx.summaries.length;
  const total = ctxGetTotalTokens(ws);
  const pct   = Math.min(100, Math.round((total / (ctx.maxTokens || 1500)) * 100));
  el.textContent = n ? `${n} summary · ${total} tokens (${pct}%)` : 'ยังไม่มี summary';
  el.style.color = pct > 85 ? 'var(--crimson-light)' : pct > 60 ? 'var(--gold)' : 'var(--text-muted)';
}

// ─── Review Search state ───
let _rsMatches = [];
let _rsMatchIdx = -1;
let _rsCurrentTexts = {};   // { chId: liveText }
let _rsPendingChanges = {}; // { chId: newText } — accumulated, saved on close
let _rsBStartFull = 0;      // actual index in full text where context slice starts
let _rsAEndFull   = 0;      // actual index in full text where context slice ends
let _rsEditMode   = false;  // true = free-edit textarea mode

function openFindReplace() {
  document.getElementById('frFind').value = '';
  document.getElementById('frReplace').value = '';
  document.getElementById('frMatchInfo').textContent = 'พิมพ์เพื่อค้นหา';
  document.getElementById('frMatchInfo').style.color = 'var(--text-muted)';
  document.getElementById('frWsResults').style.display = 'none';
  _frMatches = []; _frMatchIdx = -1;
  frRenderHistory();
  openModal('modal-findreplace');
  setTimeout(() => document.getElementById('frFind').focus(), 150);
}

function getFROptions() {
  return {
    caseSensitive: document.getElementById('frCaseSensitive').checked,
    wholeWord: document.getElementById('frWholeWord').checked,
    regex: document.getElementById('frRegex').checked,
  };
}

function buildFRRegex(term, opts, flags) {
  let p = opts.regex ? term : term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (opts.wholeWord && !opts.regex) p = `\\b${p}\\b`;
  const f = (flags !== undefined ? flags : '') + (opts.caseSensitive ? '' : 'i');
  return new RegExp(p, f);
}

function frKeyDown(e) {
  if (e.key === 'Enter') { e.shiftKey ? frNavPrev() : frNavNext(); }
}

function frLiveSearch() {
  const term = document.getElementById('frFind').value;
  const scope = document.getElementById('frScope').value;
  _frMatches = []; _frMatchIdx = -1;

  if (!term) {
    document.getElementById('frMatchInfo').textContent = 'พิมพ์เพื่อค้นหา';
    document.getElementById('frMatchInfo').style.color = 'var(--text-muted)';
    document.getElementById('frWsResults').style.display = 'none';
    return;
  }

  const opts = getFROptions();
  try {
    if (scope === 'current') {
      const text = document.getElementById('translationOutput').innerText || '';
      const regex = buildFRRegex(term, opts, 'g');
      const matches = [...text.matchAll(regex)];
      _frMatches = matches.map(m => ({ chId: null, chTitle: null, index: m.index, match: m[0] }));
      const info = document.getElementById('frMatchInfo');
      if (matches.length) {
        info.textContent = `พบ ${matches.length} รายการ`;
        info.style.color = 'var(--gold)';
        _frMatchIdx = 0;
        frHighlightInOutput(term, opts);
      } else {
        info.textContent = 'ไม่พบคำนี้';
        info.style.color = 'var(--crimson-light)';
      }
      document.getElementById('frWsResults').style.display = 'none';
    } else {
      // workspace scan
      const chapters = S.currentWs?.chapters || [];
      const wsDiv = document.getElementById('frWsResults');
      let totalHits = 0;
      let html = '';
      chapters.forEach(ch => {
        if (!ch.translation) return;
        const regex = buildFRRegex(term, opts, 'g');
        const hits = [...ch.translation.matchAll(regex)];
        if (!hits.length) return;
        totalHits += hits.length;
        const preview = ch.translation.slice(Math.max(0, hits[0].index - 30), hits[0].index + 60).replace(/\n/g,' ');
        html += `<div style="padding:3px 0;border-bottom:1px solid var(--border)"><span style="color:var(--gold);font-size:0.72rem">#${ch.chapterNum||'?'} ${esc(ch.title)}</span> <span style="color:var(--text-muted)">— ${hits.length} รายการ</span><div style="color:var(--text-secondary);font-size:0.72rem;margin-top:1px">...${esc(preview)}...</div></div>`;
      });
      const info = document.getElementById('frMatchInfo');
      if (totalHits) {
        info.textContent = `พบ ${totalHits} รายการใน Workspace`;
        info.style.color = 'var(--gold)';
        wsDiv.innerHTML = html || '<div style="color:var(--text-muted);padding:4px">ไม่พบในตอนไหน</div>';
        wsDiv.style.display = 'block';
      } else {
        info.textContent = 'ไม่พบในทุกตอน';
        info.style.color = 'var(--crimson-light)';
        wsDiv.style.display = 'none';
      }
    }
  } catch(e) {
    document.getElementById('frMatchInfo').textContent = 'Regex ไม่ถูกต้อง';
    document.getElementById('frMatchInfo').style.color = 'var(--crimson-light)';
  }
}

function frHighlightInOutput(term, opts) {
  // visual highlight via mark tags (only for current scope)
  const output = document.getElementById('translationOutput');
  // Remove old highlights
  output.querySelectorAll('mark.fr-hl').forEach(m => {
    m.replaceWith(document.createTextNode(m.textContent));
  });
  if (!term) return;
  try {
    const regex = buildFRRegex(term, opts, 'g');
    const walk = (node) => {
      if (node.nodeType === 3) {
        const parts = node.textContent.split(regex);
        if (parts.length <= 1) return;
        const frag = document.createDocumentFragment();
        let lastIdx = 0;
        const matches = [...node.textContent.matchAll(regex)];
        matches.forEach((m, i) => {
          frag.appendChild(document.createTextNode(node.textContent.slice(lastIdx, m.index)));
          const mark = document.createElement('mark');
          mark.className = 'fr-hl';
          mark.textContent = m[0];
          mark.style.background = 'rgba(201,168,76,0.35)';
          mark.style.color = 'var(--gold-light)';
          mark.style.borderRadius = '2px';
          frag.appendChild(mark);
          lastIdx = m.index + m[0].length;
        });
        frag.appendChild(document.createTextNode(node.textContent.slice(lastIdx)));
        node.parentNode.replaceChild(frag, node);
      } else if (node.nodeType === 1 && !['mark'].includes(node.tagName.toLowerCase())) {
        [...node.childNodes].forEach(walk);
      }
    };
    [...output.childNodes].forEach(walk);
    // Scroll to first match
    const firstMark = output.querySelector('mark.fr-hl');
    if (firstMark) firstMark.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    _frHighlightNodes = [...output.querySelectorAll('mark.fr-hl')];
    frUpdateActiveHighlight();
  } catch {}
}

function frUpdateActiveHighlight() {
  _frHighlightNodes.forEach((m, i) => {
    m.style.background = i === _frMatchIdx ? 'rgba(201,168,76,0.7)' : 'rgba(201,168,76,0.3)';
    m.style.outline = i === _frMatchIdx ? '2px solid var(--gold)' : 'none';
  });
  if (_frHighlightNodes[_frMatchIdx]) {
    _frHighlightNodes[_frMatchIdx].scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }
  const info = document.getElementById('frMatchInfo');
  if (_frHighlightNodes.length) {
    info.textContent = `${_frMatchIdx + 1} / ${_frHighlightNodes.length} รายการ`;
    info.style.color = 'var(--gold)';
  }
}

function frNavNext() {
  if (!_frHighlightNodes.length) { frLiveSearch(); return; }
  _frMatchIdx = (_frMatchIdx + 1) % _frHighlightNodes.length;
  frUpdateActiveHighlight();
}
function frNavPrev() {
  if (!_frHighlightNodes.length) return;
  _frMatchIdx = (_frMatchIdx - 1 + _frHighlightNodes.length) % _frHighlightNodes.length;
  frUpdateActiveHighlight();
}

function frFindAll() {
  frLiveSearch();
}

async function frReplaceAll() {
  const find = document.getElementById('frFind').value;
  const replace = document.getElementById('frReplace').value;
  const info = document.getElementById('frMatchInfo');
  if (!find) { info.textContent = 'ใส่คำค้นหาก่อน'; return; }
  const opts = getFROptions();
  const scope = document.getElementById('frScope').value;

  frPushHistory(find, replace);

  try {
    const regex = buildFRRegex(find, opts, 'g');
    if (scope === 'current') {
      const output = document.getElementById('translationOutput');
      // remove highlights first
      output.querySelectorAll('mark.fr-hl').forEach(m => m.replaceWith(document.createTextNode(m.textContent)));
      const segments = output.querySelectorAll('.segment-text');
      let total = 0;
      if (segments.length > 0) {
        segments.forEach(seg => {
          const orig = seg.textContent;
          const hits = orig.match(buildFRRegex(find, opts, 'g'));
          if (hits) { seg.textContent = orig.replace(regex, replace); total += hits.length; }
        });
      } else {
        const orig = output.innerText;
        const hits = orig.match(regex);
        total = hits ? hits.length : 0;
        if (total) output.textContent = orig.replace(regex, replace);
      }
      info.textContent = total ? `แทนที่ ${total} รายการแล้ว ✓` : 'ไม่พบ';
      info.style.color = total ? '#4caf50' : 'var(--crimson-light)';
      _frMatches = []; _frHighlightNodes = []; _frMatchIdx = -1;
    } else {
      // workspace-wide replace
      let total = 0;
      (S.currentWs?.chapters || []).forEach(ch => {
        if (!ch.translation) return;
        const hits = ch.translation.match(buildFRRegex(find, opts, 'g'));
        if (hits) { ch.translation = ch.translation.replace(regex, replace); total += hits.length; }
      });
      if (total) await lsSaveWorkspace(S.currentWs);
      info.textContent = total ? `แทนที่ ${total} รายการในทุกตอนแล้ว ✓` : 'ไม่พบ';
      info.style.color = total ? '#4caf50' : 'var(--crimson-light)';
    }
  } catch(e) { info.textContent = 'Regex ไม่ถูกต้อง'; info.style.color = 'var(--crimson-light)'; }
}

function frReplaceCurrent() {
  const find = document.getElementById('frFind').value;
  const replace = document.getElementById('frReplace').value;
  const info = document.getElementById('frMatchInfo');
  if (!find) return;
  const opts = getFROptions();
  frPushHistory(find, replace);

  try {
    const output = document.getElementById('translationOutput');
    // replace only current highlighted match
    if (_frHighlightNodes[_frMatchIdx]) {
      _frHighlightNodes[_frMatchIdx].replaceWith(document.createTextNode(replace));
      _frHighlightNodes.splice(_frMatchIdx, 1);
      if (_frMatchIdx >= _frHighlightNodes.length) _frMatchIdx = Math.max(0, _frHighlightNodes.length - 1);
      frUpdateActiveHighlight();
      info.textContent = `แทนที่แล้ว · เหลือ ${_frHighlightNodes.length} รายการ`;
      info.style.color = '#4caf50';
    } else {
      // fallback: replace first occurrence
      output.querySelectorAll('mark.fr-hl').forEach(m => m.replaceWith(document.createTextNode(m.textContent)));
      const text = output.innerText;
      const regex = buildFRRegex(find, opts);
      const replaced = text.replace(regex, replace);
      if (replaced !== text) { output.textContent = replaced; info.textContent = 'แทนที่ 1 รายการแล้ว'; info.style.color = '#4caf50'; }
      else { info.textContent = 'ไม่พบ'; info.style.color = 'var(--crimson-light)'; }
    }
  } catch(e) { info.textContent = 'Regex ไม่ถูกต้อง'; info.style.color = 'var(--crimson-light)'; }
}

function frPushHistory(find, replace) {
  if (!find) return;
  const entry = { find, replace };
  _frHistory = [entry, ..._frHistory.filter(h => h.find !== find || h.replace !== replace)].slice(0, 8);
  sessionStorage.setItem('fr_history', JSON.stringify(_frHistory));
  frRenderHistory();
}

function frRenderHistory() {
  const wrap = document.getElementById('frHistoryWrap');
  if (!wrap) return;
  wrap.innerHTML = _frHistory.slice(0, 5).map((h, i) => `
    <span class="btn-xs" onclick="frApplyHistory(${i})" title="${esc(h.find)} → ${esc(h.replace)}" style="max-width:80px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(h.find)}</span>
  `).join('');
}

function frApplyHistory(i) {
  const h = _frHistory[i];
  if (!h) return;
  document.getElementById('frFind').value = h.find;
  document.getElementById('frReplace').value = h.replace;
  frLiveSearch();
}

// ─── Review Search ───
function openReviewSearch(prefill) {
  _rsMatches = [];
  _rsMatchIdx = -1;
  _rsCurrentTexts = {};
  _rsPendingChanges = {};

  const findEl = document.getElementById('rsFind');
  const repEl  = document.getElementById('rsReplaceInput');
  findEl.value = prefill || '';
  repEl.value  = '';

  _rsEditMode = false;
  ['rsProgressBar','rsContextWrap'].forEach(id => document.getElementById(id).style.display = 'none');
  document.getElementById('rsReplaceWrap').style.display = 'none';
  document.getElementById('rsEndMsg').style.display = 'none';
  document.getElementById('rsSaveBtn').style.display = 'none';

  openModal('modal-review-search');
  setTimeout(() => { findEl.focus(); if (prefill) rsSearch(); }, 150);
}

function _rsGetOpts() {
  return {
    caseSensitive: document.getElementById('rsCaseSensitive').checked,
    wholeWord:     document.getElementById('rsWholeWord').checked,
    regex:         document.getElementById('rsRegex').checked,
  };
}

function rsSearch() {
  const term = document.getElementById('rsFind').value.trim();
  if (!term) { showToast('ใส่คำค้นหาก่อน', 'error'); return; }

  const opts     = _rsGetOpts();
  const chapters = S.currentWs?.chapters || [];

  _rsMatches       = [];
  _rsMatchIdx      = -1;
  _rsCurrentTexts  = {};
  _rsPendingChanges = {};

  // Snapshot live texts
  chapters.forEach(ch => { if (ch.translation) _rsCurrentTexts[ch.id] = ch.translation; });

  // Build match list — track occurrenceIndex within each chapter
  try {
    chapters.forEach(ch => {
      if (!ch.translation) return;
      const re   = buildFRRegex(term, opts, 'g');
      const hits = [...ch.translation.matchAll(re)];
      hits.forEach((m, occIdx) => {
        _rsMatches.push({
          chId: ch.id,
          chapterNum: ch.chapterNum,
          title:      ch.title || '',
          occurrenceIndex: occIdx, // which occurrence in the original text
          match:    m[0],
          replaced: false,
        });
      });
    });
  } catch(e) {
    showToast('Regex ไม่ถูกต้อง', 'error');
    return;
  }

  document.getElementById('rsEndMsg').style.display = 'none';
  document.getElementById('rsSaveBtn').style.display = 'none';

  if (!_rsMatches.length) {
    showToast(`ไม่พบ "${term}" ในทุกตอน`, 'info');
    ['rsProgressBar','rsContextWrap'].forEach(id => document.getElementById(id).style.display = 'none');
    document.getElementById('rsReplaceWrap').style.display = 'none';
    return;
  }

  _rsMatchIdx = 0;
  rsRenderCurrent();
}

function rsRenderCurrent() {
  const m = _rsMatches[_rsMatchIdx];
  if (!m) return;

  const CONTEXT = 160;
  const term    = document.getElementById('rsFind').value.trim();
  const opts    = _rsGetOpts();
  const text    = _rsCurrentTexts[m.chId] || '';

  // How many earlier matches in the same chapter were REPLACED (text was removed)?
  const replacedBefore = _rsMatches
    .slice(0, _rsMatchIdx)
    .filter(x => x.chId === m.chId && x.replaced)
    .length;
  const occInCurrent = m.occurrenceIndex - replacedBefore;

  let hit;
  try {
    const re   = buildFRRegex(term, opts, 'g');
    const hits = [...text.matchAll(re)];
    hit = hits[occInCurrent];
  } catch(e) { hit = null; }

  if (!hit) { rsGoNext(); return; } // occurrence dissolved — skip silently

  const idx       = hit.index;
  const matchText = hit[0];
  const bStart    = Math.max(0, idx - CONTEXT);
  const aEnd      = Math.min(text.length, idx + matchText.length + CONTEXT);
  const before    = (bStart > 0 ? '…' : '') + text.slice(bStart, idx);
  const after     = text.slice(idx + matchText.length, aEnd) + (aEnd < text.length ? '…' : '');

  // Store slice boundaries for free-edit mode
  _rsBStartFull = bStart;
  _rsAEndFull   = aEnd;

  // Exit edit mode when navigating to new match
  if (_rsEditMode) rsExitEditMode();

  // Build context display
  const ctxDiv = document.getElementById('rsContextDisplay');
  ctxDiv.innerHTML = '';

  const bNode = document.createElement('span');
  bNode.style.cssText = 'color:var(--text-muted);white-space:pre-wrap';
  bNode.textContent = before;

  const markEl = document.createElement('mark');
  markEl.style.cssText = [
    'background:rgba(201,168,76,0.45)',
    'color:var(--gold-light)',
    'border-radius:3px',
    'padding:0 3px',
    'font-weight:700',
    'outline:2px solid var(--gold)',
    'white-space:pre-wrap',
  ].join(';');
  markEl.textContent = matchText;

  const aNode = document.createElement('span');
  aNode.style.cssText = 'color:var(--text-muted);white-space:pre-wrap';
  aNode.textContent = after;

  ctxDiv.appendChild(bNode);
  ctxDiv.appendChild(markEl);
  ctxDiv.appendChild(aNode);
  setTimeout(() => markEl.scrollIntoView({ block: 'nearest', behavior: 'smooth' }), 40);

  // Progress
  const pct = ((_rsMatchIdx + 1) / _rsMatches.length) * 100;
  document.getElementById('rsProgressFill').style.width = pct + '%';
  document.getElementById('rsCountInfo').textContent =
    `${_rsMatchIdx + 1} / ${_rsMatches.length} รายการ`;
  document.getElementById('rsCountInfo').style.color = 'var(--gold)';
  document.getElementById('rsChapterInfo').textContent =
    `ตอน ${m.chapterNum ?? '?'}: ${m.title}`;

  document.getElementById('rsProgressBar').style.display = 'block';
  document.getElementById('rsContextWrap').style.display  = 'block';
  document.getElementById('rsReplaceWrap').style.display  = 'flex';
  document.getElementById('rsEndMsg').style.display       = 'none';

  // Pre-fill replace input with the matched word
  const repEl = document.getElementById('rsReplaceInput');
  repEl.value = matchText;
  repEl.focus();
  repEl.select();
}

function rsReplaceAndNext() {
  const m = _rsMatches[_rsMatchIdx];
  if (!m) return;

  const term       = document.getElementById('rsFind').value.trim();
  const replaceWith = document.getElementById('rsReplaceInput').value;
  const opts       = _rsGetOpts();

  const replacedBefore = _rsMatches
    .slice(0, _rsMatchIdx)
    .filter(x => x.chId === m.chId && x.replaced)
    .length;
  const occInCurrent = m.occurrenceIndex - replacedBefore;

  let text = _rsCurrentTexts[m.chId] || '';
  try {
    const re   = buildFRRegex(term, opts, 'g');
    const hits = [...text.matchAll(re)];
    const hit  = hits[occInCurrent];
    if (hit) {
      text = text.slice(0, hit.index) + replaceWith + text.slice(hit.index + hit[0].length);
      _rsCurrentTexts[m.chId]  = text;
      _rsPendingChanges[m.chId] = text;
      m.replaced = true;
    }
  } catch(e) {}

  rsGoNext();
}

function rsSkip() { rsGoNext(); }

// ── Free-edit mode ──
function rsToggleEditMode() {
  if (_rsEditMode) {
    rsExitEditMode();
  } else {
    rsEnterEditMode();
  }
}

function rsEnterEditMode() {
  const m = _rsMatches[_rsMatchIdx];
  if (!m) return;

  _rsEditMode = true;

  // Pre-fill textarea with the actual text slice (no decorative '…')
  const text    = _rsCurrentTexts[m.chId] || '';
  const snippet = text.slice(_rsBStartFull, _rsAEndFull);
  const editTa  = document.getElementById('rsContextEdit');
  editTa.value  = snippet;

  // Show textarea, hide highlight div and replace input
  document.getElementById('rsContextDisplay').style.display = 'none';
  editTa.style.display = 'block';
  document.getElementById('rsEditHint').style.display = 'block';
  document.getElementById('rsReplaceWrap').style.display = 'none';

  // Swap footer buttons
  document.getElementById('rsReplaceBtn').style.display  = 'none';
  document.getElementById('rsSkipBtn').style.display     = 'none';
  document.getElementById('rsSaveContextBtn').style.display = 'inline-flex';

  // Update toggle button label
  document.getElementById('rsEditToggleBtn').textContent = '✕ ยกเลิกแก้ไข';
  document.getElementById('rsEditToggleBtn').style.color = 'var(--crimson-light)';

  // Scroll to highlight (find position of match in textarea)
  const term  = document.getElementById('rsFind').value.trim();
  const opts  = _rsGetOpts();
  try {
    const re  = buildFRRegex(term, opts);
    const pos = snippet.search(re);
    if (pos >= 0) {
      editTa.focus();
      editTa.setSelectionRange(pos, pos + (snippet.match(re)?.[0]?.length || 0));
    } else {
      editTa.focus();
    }
  } catch(e) { editTa.focus(); }
}

function rsExitEditMode() {
  _rsEditMode = false;
  document.getElementById('rsContextDisplay').style.display = 'block';
  document.getElementById('rsContextEdit').style.display    = 'none';
  document.getElementById('rsEditHint').style.display       = 'none';
  document.getElementById('rsReplaceWrap').style.display    = 'flex';
  document.getElementById('rsReplaceBtn').style.display     = 'inline-flex';
  document.getElementById('rsSkipBtn').style.display        = 'inline-flex';
  document.getElementById('rsSaveContextBtn').style.display = 'none';
  document.getElementById('rsEditToggleBtn').textContent    = '✏ แก้ไขตรงๆ';
  document.getElementById('rsEditToggleBtn').style.color    = '';
}

function rsSaveContextAndNext() {
  const m = _rsMatches[_rsMatchIdx];
  if (!m) return;

  const editedSnippet = document.getElementById('rsContextEdit').value;
  const fullText      = _rsCurrentTexts[m.chId] || '';
  const newText       = fullText.slice(0, _rsBStartFull) + editedSnippet + fullText.slice(_rsAEndFull);

  if (newText !== fullText) {
    _rsCurrentTexts[m.chId]   = newText;
    _rsPendingChanges[m.chId] = newText;
    m.replaced = true; // mark so occurrence indices adjust
  }

  rsExitEditMode();
  rsGoNext();
}

function rsNavPrev() {
  if (_rsMatchIdx > 0) {
    _rsMatchIdx--;
    document.getElementById('rsEndMsg').style.display = 'none';
    rsRenderCurrent();
  }
}

function rsGoNext() {
  if (_rsMatchIdx < _rsMatches.length - 1) {
    _rsMatchIdx++;
    rsRenderCurrent();
  } else {
    // All done
    document.getElementById('rsContextWrap').style.display  = 'none';
    document.getElementById('rsReplaceWrap').style.display  = 'none';
    document.getElementById('rsEndMsg').style.display       = 'block';
    document.getElementById('rsSaveBtn').style.display         = 'inline-flex';
    document.getElementById('rsSkipBtn').style.display         = 'none';
    document.getElementById('rsReplaceBtn').style.display      = 'none';
    document.getElementById('rsSaveContextBtn').style.display  = 'none';
    if (_rsEditMode) rsExitEditMode();

    const info = document.getElementById('rsCountInfo');
    info.textContent = `✓ ตรวจครบ ${_rsMatches.length} รายการ`;
    info.style.color = '#4caf50';
    document.getElementById('rsProgressFill').style.width = '100%';
  }
}

async function rsSaveAndClose() {
  const changedIds = Object.keys(_rsPendingChanges);
  if (changedIds.length) {
    const chs = S.currentWs?.chapters || [];
    chs.forEach(ch => {
      if (_rsPendingChanges[ch.id] !== undefined) {
        ch.translation = _rsPendingChanges[ch.id];
        ch.updatedAt   = Date.now();
        // recalculate wordCount
        ch.wordCount   = ch.translation.length;
      }
    });
    await lsSaveWorkspace(S.currentWs);
    renderChapters();
    showToast(`บันทึกการแก้ไข ${changedIds.length} ตอนแล้ว ✓`, 'success');
  }
  closeModal('modal-review-search');

  // Reset button states for next open
  _rsEditMode = false;
  document.getElementById('rsSkipBtn').style.display        = '';
  document.getElementById('rsReplaceBtn').style.display     = '';
  document.getElementById('rsSaveContextBtn').style.display = 'none';
  document.getElementById('rsEditToggleBtn').textContent    = '✏ แก้ไขตรงๆ';
  document.getElementById('rsEditToggleBtn').style.color    = '';
}

// ─── Export ───
function openExportModal() {
  const wsName = S.currentWs?.name;
  const label = document.getElementById('wsExportLabel');
  const btns = document.getElementById('wsExportBtns');
  if (wsName) { label.textContent = `📚 Export ทั้ง Workspace — ${wsName}`; btns.style.display = 'flex'; }
  else { label.textContent = ''; btns.style.display = 'none'; }
  openModal('modal-export');
}

function getTranslationText() {
  const text = document.getElementById('translationOutput').innerText?.trim() || '';
  return text === 'คำแปลจะปรากฏที่นี่...' ? '' : text;
}

function exportCurrentTXT() {
  const text = getTranslationText();
  if (!text) { showToast('ยังไม่มีคำแปล', 'error'); return; }
  downloadBlob(new Blob([text], { type: 'text/plain;charset=utf-8' }), `${S.currentWs?.name || 'translation'}.txt`);
  showToast('Export TXT สำเร็จ ✓', 'success');
}

function exportWorkspaceTXT() {
  if (!S.currentWs) return;
  const chapters = [...(S.currentWs.chapters || [])].sort((a, b) => (a.chapterNum||0) - (b.chapterNum||0));
  const text = chapters.map(ch => `=== ${ch.title} ===\n\n${ch.translation || '(ยังไม่มีคำแปล)'}`).join('\n\n\n');
  downloadBlob(new Blob([text], { type: 'text/plain;charset=utf-8' }), `${S.currentWs.name}.txt`);
  showToast('Export TXT สำเร็จ ✓', 'success');
}

// ── DOCX helpers ──
function buildDocxXml(title, paragraphs) {
  const escXml = s => s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  const paras = paragraphs.map(p => {
    if (!p.trim()) return '<w:p/>';
    const lines = p.split('\n');
    return lines.map(line => `<w:p><w:r><w:rPr><w:rFonts w:ascii="Tahoma" w:hAnsi="Tahoma"/></w:rPr><w:t xml:space="preserve">${escXml(line)}</w:t></w:r></w:p>`).join('');
  }).join('');
  const titleXml = title ? `<w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:rPr><w:b/><w:sz w:val="36"/><w:rFonts w:ascii="Tahoma" w:hAnsi="Tahoma"/></w:rPr><w:t>${escXml(title)}</w:t></w:r></w:p><w:p/>` : '';
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:wpc="http://schemas.microsoft.com/office/word/2010/wordprocessingCanvas"
  xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
  xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<w:body>
${titleXml}${paras}
<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr>
</w:body>
</w:document>`;
}

function buildDocxZip(docXml) {
  // Build a minimal .docx (ZIP) containing word/document.xml
  const files = {
    '_rels/.rels': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`,
    'word/_rels/document.xml.rels': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>`,
    'word/document.xml': docXml,
    '[Content_Types].xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`,
  };
  return buildZipBuffer(files);
}

function exportCurrentDOCX() {
  const text = getTranslationText();
  if (!text) { showToast('ยังไม่มีคำแปล', 'error'); return; }
  const docXml = buildDocxXml(S.currentWs?.name || '', text.split('\n\n'));
  const buf = buildDocxZip(docXml);
  downloadBlob(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }), `${S.currentWs?.name || 'translation'}.docx`);
  showToast('Export DOCX สำเร็จ ✓', 'success');
}

function exportWorkspaceDOCX() {
  if (!S.currentWs) return;
  const chapters = [...(S.currentWs.chapters || [])].sort((a,b) => (a.chapterNum||0)-(b.chapterNum||0));
  const escXml = s => s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  const body = chapters.map(ch => {
    const heading = `<w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:rPr><w:b/><w:sz w:val="32"/><w:rFonts w:ascii="Tahoma" w:hAnsi="Tahoma"/></w:rPr><w:t>${escXml(ch.title)}</w:t></w:r></w:p><w:p/>`;
    const content = (ch.translation || '(ยังไม่มีคำแปล)').split('\n').map(line =>
      `<w:p><w:r><w:rPr><w:rFonts w:ascii="Tahoma" w:hAnsi="Tahoma"/></w:rPr><w:t xml:space="preserve">${escXml(line)}</w:t></w:r></w:p>`).join('');
    return heading + content + '<w:p/><w:p/>';
  }).join('');
  const docXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr></w:body></w:document>`;
  const buf = buildDocxZip(docXml);
  downloadBlob(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }), `${S.currentWs.name}.docx`);
  showToast('Export DOCX สำเร็จ ✓', 'success');
}

function exportWorkspaceZIP() {
  if (!S.currentWs) return;
  const chapters = [...(S.currentWs.chapters || [])].sort((a,b) => (a.chapterNum||0)-(b.chapterNum||0));
  const files = {};
  chapters.forEach(ch => {
    const num = String(ch.chapterNum || '0').padStart(3, '0');
    const safeName = ch.title.replace(/[\\/:*?"<>|]/g, '_');
    const fname = `${num}_${safeName}.txt`;
    files[fname] = ch.translation || '(ยังไม่มีคำแปล)';
  });
  const buf = buildZipBuffer(files);
  downloadBlob(new Blob([buf], { type: 'application/zip' }), `${S.currentWs.name}.zip`);
  showToast('Export ZIP สำเร็จ ✓', 'success');
}

// ── Pure-JS ZIP builder ──
function buildZipBuffer(files) {
  const enc = new TextEncoder();
  const localHeaders = [];
  const centralHeaders = [];
  let offset = 0;

  function crc32(data) {
    let crc = 0xFFFFFFFF;
    const table = crc32.table || (crc32.table = (() => {
      const t = new Uint32Array(256);
      for (let i = 0; i < 256; i++) {
        let c = i;
        for (let j = 0; j < 8; j++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
        t[i] = c;
      }
      return t;
    })());
    for (let i = 0; i < data.length; i++) crc = table[(crc ^ data[i]) & 0xFF] ^ (crc >>> 8);
    return (crc ^ 0xFFFFFFFF) >>> 0;
  }

  function u16le(v) { return [(v & 0xFF), (v >> 8) & 0xFF]; }
  function u32le(v) { return [(v & 0xFF), (v >> 8) & 0xFF, (v >> 16) & 0xFF, (v >> 24) & 0xFF]; }
  function concat(...arrays) {
    const total = arrays.reduce((s, a) => s + a.length, 0);
    const out = new Uint8Array(total);
    let pos = 0;
    for (const a of arrays) { out.set(a, pos); pos += a.length; }
    return out;
  }

  const parts = [];
  for (const [name, content] of Object.entries(files)) {
    const nameBytes = enc.encode(name);
    const dataBytes = typeof content === 'string' ? enc.encode(content) : content;
    const crc = crc32(dataBytes);
    const localHeader = new Uint8Array([
      0x50,0x4B,0x03,0x04, // sig
      0x14,0x00, // version
      0x00,0x00, // flags
      0x00,0x00, // compression (stored)
      0x00,0x00, 0x00,0x00, // mod time/date
      ...u32le(crc),
      ...u32le(dataBytes.length),
      ...u32le(dataBytes.length),
      ...u16le(nameBytes.length),
      0x00,0x00, // extra len
      ...nameBytes,
    ]);
    localHeaders.push({ name: nameBytes, offset, crc, size: dataBytes.length });
    parts.push(localHeader, dataBytes);
    offset += localHeader.length + dataBytes.length;
  }

  const centralStart = offset;
  for (const lh of localHeaders) {
    const centralEntry = new Uint8Array([
      0x50,0x4B,0x01,0x02,
      0x14,0x00, 0x14,0x00,
      0x00,0x00, 0x00,0x00,
      0x00,0x00, 0x00,0x00,
      ...u32le(lh.crc),
      ...u32le(lh.size),
      ...u32le(lh.size),
      ...u16le(lh.name.length),
      0x00,0x00,             // extra field length
      0x00,0x00,             // file comment length
      0x00,0x00,             // disk number start
      0x00,0x00,             // internal file attributes
      0x00,0x00,0x00,0x00,   // external file attributes (4 bytes)
      ...u32le(lh.offset),
      ...lh.name,
    ]);
    parts.push(centralEntry);
    offset += centralEntry.length;
  }

  const centralSize = offset - centralStart;
  const eocd = new Uint8Array([
    0x50,0x4B,0x05,0x06,
    0x00,0x00, 0x00,0x00,
    ...u16le(localHeaders.length),
    ...u16le(localHeaders.length),
    ...u32le(centralSize),
    ...u32le(centralStart),
    0x00,0x00,
  ]);
  parts.push(eocd);
  return concat(...parts);
}


// ─── Batch Chapter Translate ───
function openBatchChapters() {
  if (!S.currentWs) { showToast('เลือก Workspace ก่อน', 'error'); return; }
  const chapters = [...(S.currentWs.chapters || [])].sort((a,b) => (a.chapterNum||0)-(b.chapterNum||0));
  if (!chapters.length) { showToast('ยังไม่มีตอน', 'error'); return; }
  document.getElementById('bchChapterList').innerHTML = chapters.map(ch => `
    <label class="bch-ch-row" style="display:flex;align-items:center;gap:8px;padding:5px 6px;border-radius:4px;cursor:pointer">
      <input type="checkbox" class="bch-chk" data-id="${ch.id}" style="accent-color:var(--gold)"
        onclick="rangeCheckboxClick(event,'bch-modal','.bch-chk',bchUpdateCount)"
        onchange="bchUpdateCount()" title="Shift+คลิก เพื่อเลือกช่วง"/>
      <span style="font-size:0.76rem;color:var(--text-muted);min-width:26px">#${ch.chapterNum||'?'}</span>
      <span style="flex:1;font-size:0.82rem;color:var(--text-primary)">${esc(ch.title)}</span>
      <span class="status-badge ${ch.status==='translated'?'translated':'pending'}" style="font-size:0.6rem">${ch.status==='translated'?'&#10003; แปลแล้ว':'&#9675; รอ'}</span>
      <span style="font-size:0.68rem;color:var(--text-muted)">${ch.sourceText?ch.sourceText.length.toLocaleString()+' ตัวอักษร':'&#8212;'}</span>
    </label>
  `).join('');
  // populate รายการโมเดลตาม provider ปัจจุบัน (ไม่มีตัวเลือกกำหนดเอง — เลือกจาก quick bar แทน)
  renderModelSelect(document.getElementById('bchModel'), getProvider(), document.getElementById('translateModel').value, false);
  document.getElementById('bchProgressBox').style.display = 'none';
  document.getElementById('bchLog').innerHTML = '';
  document.getElementById('bchStartBtn').disabled = false;
  document.getElementById('bchSelectedCount').textContent = '0 ตอนที่เลือก';
  openModal('modal-batch-chapters');
}
function bchUpdateCount() {
  document.getElementById('bchSelectedCount').textContent = `${document.querySelectorAll('.bch-chk:checked').length} ตอนที่เลือก`;
}
function bchSelectAll()    { document.querySelectorAll('.bch-chk').forEach(el => el.checked = true);  bchUpdateCount(); }
function bchDeselectAll()  { document.querySelectorAll('.bch-chk').forEach(el => el.checked = false); bchUpdateCount(); }
function bchSelectPending() {
  document.querySelectorAll('.bch-chk').forEach(el => {
    const ch = S.currentWs?.chapters.find(c => c.id === el.dataset.id);
    el.checked = ch?.status !== 'translated';
  });
  bchUpdateCount();
}
async function startBatchChapters() {
  const checked = [...document.querySelectorAll('.bch-chk:checked')];
  if (!checked.length) { showToast('เลือกตอนก่อน', 'error'); return; }
  if (S.translating) { showToast('กำลังแปลอยู่', 'error'); return; }
  const skipTranslated = document.getElementById('bchSkipTranslated').checked;
  const model          = document.getElementById('bchModel').value;
  const usePolish      = document.getElementById('bchUsePolish').checked;
  const usePrevContext = document.getElementById('bchUsePrevContext').checked;
  // Batch: glossaryStr จะสร้างใหม่ per chapter (smart filtering)
  let selectedChapters = checked
    .map(el => S.currentWs.chapters.find(c => c.id === el.dataset.id)).filter(Boolean)
    .sort((a,b) => (a.chapterNum||0)-(b.chapterNum||0));
  if (skipTranslated) selectedChapters = selectedChapters.filter(ch => ch.status !== 'translated');
  if (!selectedChapters.length) { showToast('ไม่มีตอนที่ต้องแปล', ''); return; }
  setTranslating(true);
  const btn = document.getElementById('bchStartBtn');
  btn.disabled = true;
  const log = document.getElementById('bchLog');
  document.getElementById('bchProgressBox').style.display = 'block';
  log.innerHTML = '';
  if (!getApiKey()) { showToast('ยังไม่ได้ตั้ง API Key', 'error'); setTranslating(false); btn.disabled = false; return; }
  const n = selectedChapters.length;

  // ── Summary cache: chapterId → summary string ──
  const _summaryCache = {};
  const CONCURRENCY = 5; // parallel summary calls สูงสุด

  // helper: สร้าง prompt สรุปสำหรับ prevCh
  function buildSummaryPrompt(prevCh) {
    const textSample = prevCh.translation.length > 6000
      ? prevCh.translation.slice(0, 3000) + '\n...\n' + prevCh.translation.slice(-3000)
      : prevCh.translation;
    return CHAPTER_SUMMARY_PROMPT
      .replace('{chapter_num}',   prevCh.chapterNum || '?')
      .replace('{chapter_title}', prevCh.title)
      .replace('{text}',          textSample);
  }

  // helper: หาตอนก่อนหน้าที่แปลแล้ว
  const allSorted = [...(S.currentWs.chapters||[])].sort((a,b)=>(a.chapterNum||0)-(b.chapterNum||0));
  function findPrevTranslated(ch) {
    const idx = allSorted.findIndex(c => c.id === ch.id);
    for (let i = idx - 1; i >= 0; i--) {
      if (allSorted[i].translation?.trim()) return allSorted[i];
    }
    return null;
  }

  // ── PHASE 1: Pre-summarize pass (parallel, concurrency = 5) ──
  if (usePrevContext) {
    // รวบรวม prevCh ที่ต้องสรุป (unique, มี translation, ยังไม่ cache)
    const toSummarize = [];
    const seen = new Set();
    for (const ch of selectedChapters) {
      const prev = findPrevTranslated(ch);
      if (prev && !seen.has(prev.id) && !_summaryCache[prev.id]) {
        seen.add(prev.id);
        toSummarize.push(prev);
      }
    }

    if (toSummarize.length) {
      addLog(log, `📝 Pre-summarize ${toSummarize.length} ตอน (parallel x${Math.min(CONCURRENCY, toSummarize.length)})...`, '');
      document.getElementById('bchProgressLabel').textContent = `[เฟส 1/2] สรุปบริบท 0/${toSummarize.length} ตอน...`;

      let doneSum = 0;

      // run with concurrency limit
      async function runWithConcurrency(tasks, limit) {
        const results = new Array(tasks.length);
        let idx = 0;
        async function worker() {
          while (idx < tasks.length) {
            const i = idx++;
            results[i] = await tasks[i]();
          }
        }
        const workers = Array.from({ length: Math.min(limit, tasks.length) }, worker);
        await Promise.all(workers);
        return results;
      }

      const tasks = toSummarize.map(prevCh => async () => {
        try {
          const res = await callOpenRouter({
            model,
            messages: [{ role: 'user', content: buildSummaryPrompt(prevCh) }],
            temperature: 0.1,
            max_tokens: 300,
          });
          _summaryCache[prevCh.id] = res.choices?.[0]?.message?.content?.trim() || '';
        } catch {
          // fallback: ท้าย 600 ตัวอักษร — mark ด้วย key พิเศษ
          _summaryCache[prevCh.id] = '__fallback__' + prevCh.translation.trim().slice(-Math.round(getPrevCtxChars() * 1.5));
        }
        doneSum++;
        document.getElementById('bchProgressLabel').textContent = `[เฟส 1/2] สรุปบริบท ${doneSum}/${toSummarize.length} ตอน...`;
        document.getElementById('bchProgressFill').style.width = Math.round(doneSum / toSummarize.length * 30) + '%';
        document.getElementById('bchProgressPct').textContent = Math.round(doneSum / toSummarize.length * 30) + '%';
        addLog(log, `📝 สรุปตอน #${prevCh.chapterNum||'?'} "${prevCh.title}" ✓`, 'cached');
      });

      await runWithConcurrency(tasks, CONCURRENCY);
      document.getElementById('bchProgressLabel').textContent = `[เฟส 2/2] กำลังแปล ${n} ตอน...`;
      addLog(log, `✓ Pre-summarize เสร็จ — เริ่มแปล ${n} ตอน`, 'success');
    }
  }

  // helper: ดึง context string จาก cache
  function getCtxFromCache(ch) {
    const prev = findPrevTranslated(ch);
    if (!prev) return '';
    const cached = _summaryCache[prev.id];
    if (!cached) return '';
    if (cached.startsWith('__fallback__')) {
      return `PREVIOUS CHAPTER CONTEXT (ตอน #${prev.chapterNum||'?'} "${prev.title}") — ท้ายตอน:\n${cached.slice(12)}\n`;
    }
    return `PREVIOUS CHAPTER SUMMARY (ตอน #${prev.chapterNum||'?'} "${prev.title}"):\n${cached}\n`;
  }

  // ── PHASE 2: แปลทีละตอน (sequential) ──
  addLog(log, `⚡ เริ่มแปล ${n} ตอน...`, '');
  let batchStopped = false;
  for (let i = 0; i < n; i++) {
    const ch = selectedChapters[i];
    const pct = 30 + Math.round(i / n * 70); // progress 30%→100% ในช่วงแปล
    document.getElementById('bchProgressFill').style.width = pct + '%';
    document.getElementById('bchProgressPct').textContent = pct + '%';
    document.getElementById('bchProgressLabel').textContent = `แปลตอน ${i+1}/${n}: ${ch.title}`;
    if (!ch.sourceText?.trim()) {
      addLog(log, `⚠ #${ch.chapterNum||'?'} "${ch.title}" — ไม่มีต้นฉบับ ข้าม`, 'error');
      continue;
    }
    const ctxStr = usePrevContext ? getCtxFromCache(ch) : '';
    addLog(log, `⚡ #${ch.chapterNum||'?'} ${ch.title}${ctxStr ? ' [+summary]' : ''}...`, '');
    try {
      const styleId = document.getElementById('activeStyleSelect')?.value || S.activeStyleId;
      const csp = getStyleById(styleId)?.prompt || null;
      // Smart Glossary per chapter (ลด token)
      const chSmartGloss = getSmartGlossary(ch.sourceText, S.glossaryData);
      const chGlossObj = chSmartGloss.reduce((acc, g) => { acc[g.korean] = { thai: g.thai, type: g.type, note: g.note, gender: g.gender }; return acc; }, {});
      const chGlossaryStr = buildGlossaryStr(chGlossObj);
      const batchPreset = getActivePreset(S.currentWs);
      const prompt = buildTranslatePrompt({
        sourceText: prepareSourceForTranslation(ch.sourceText),
        glossaryStr: chGlossaryStr,
        contextStr: ctxStr,
        styleNote: csp || '',
        ws: S.currentWs,
      });
      S.abortCtrl = new AbortController();
      const timer = setTimeout(() => S.abortCtrl.abort(), getTimeoutMs('full'));
      let fullText = '', inTok = 0, outTok = 0;
      try {
        fullText = await aiStream(
          { model, temperature: batchPreset.temperature ?? 0.65, max_tokens: Math.max(4000, Math.ceil(ch.sourceText.length * 2)), messages: [{role:'user',content:prompt}] },
          d => { fullText += d; }, (inp,out) => { inTok=inp; outTok=out; }, S.abortCtrl.signal
        );
      } finally { clearTimeout(timer); }
      if (inTok||outTok) addCosts(inTok, outTok, model);
      if (usePolish && fullText) {
        try {
          const pr = await callOpenRouter({ model, messages:[{role:'user',content:POLISH_PROMPT.replace('{glossary}',chGlossaryStr).replace('{text}',fullText)}], temperature:0.5, max_tokens:Math.max(4000,Math.ceil(fullText.length*1.2)) });
          fullText = pr.choices?.[0]?.message?.content?.trim() || fullText;
        } catch {}
      }
      ch.translation = fullText; ch.status = 'translated'; ch.wordCount = fullText.length; ch.updatedAt = Date.now();
      await lsSaveWorkspace(S.currentWs);
      addLog(log, `✓ #${ch.chapterNum||'?'} "${ch.title}" — ${fullText.length.toLocaleString()} ตัวอักษร`, 'success');
    } catch (err) {
      if (err.name === 'AbortError') {
        addLog(log, `⬛ หยุดที่ตอน #${ch.chapterNum||'?'} "${ch.title}"`, 'error');
        batchStopped = true;
        break;
      }
      addLog(log, `✗ #${ch.chapterNum||'?'} "${ch.title}" — ${err.message}`, 'error');
    }
    document.getElementById('bchProgressFill').style.width = (30 + Math.round((i+1)/n*70)) + '%';
    document.getElementById('bchProgressPct').textContent  = (30 + Math.round((i+1)/n*70)) + '%';
  }

  document.getElementById('bchProgressFill').style.width = '100%';
  document.getElementById('bchProgressPct').textContent   = '100%';
  document.getElementById('bchProgressLabel').textContent = batchStopped ? 'หยุดแล้ว ⬛' : `เสร็จสิ้น ${n} ตอน ✓`;
  renderChapters();
  setTranslating(false);
  btn.disabled = false;
  showToast(batchStopped ? '⬛ หยุด Batch แล้ว' : `Batch แปลเสร็จ ${n} ตอน ✓`, batchStopped ? '' : 'success');

  // ── Auto Extract Glossary จาก source texts ทั้ง batch รวมกัน (ครั้งเดียว) ──
  if (!batchStopped) {
    const allSource = selectedChapters
      .map(ch => ch.sourceText?.trim())
      .filter(Boolean)
      .join('\n\n')
      .slice(0, 12000);
    // สร้าง label แสดงช่วงตอน
    const firstCh = selectedChapters[0];
    const lastCh  = selectedChapters[selectedChapters.length - 1];
    const batchChInfo = firstCh ? {
      id: null,
      title: firstCh.id === lastCh.id
        ? firstCh.title
        : `#${firstCh.chapterNum||'?'}–#${lastCh.chapterNum||'?'}`,
      chapterNum: firstCh.chapterNum || null,
    } : null;
    const allTranslation = selectedChapters
      .map(ch => ch.translation?.trim())
      .filter(Boolean)
      .join('\n\n')
      .slice(0, 6000);
    autoExtractGlossaryAfterTranslation(allSource, model, batchChInfo, allTranslation);
  }
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ─── Utilities ───
function setTranslating(val) {
  S.translating = val;
  const btn = document.getElementById('translateBtn');
  if (!btn) return;
  if (val) {
    btn.innerHTML = '⬛ หยุด';
    btn.classList.add('btn-stop');
    btn.onclick = stopTranslation;
  } else {
    btn.innerHTML = '⚡ แปล';
    btn.classList.remove('btn-stop');
    btn.onclick = startTranslation;
    S.abortCtrl = null;
  }
}

function stopTranslation() {
  if (!S.translating) return;
  if (S.abortCtrl) { S.abortCtrl.abort(); }
  showToast('⬛ กำลังหยุด...', '');
}
function updateSourceStats() {
  const len = document.getElementById('sourceText').value.length;
  document.getElementById('sourceStats').textContent = `${len.toLocaleString()} ตัวอักษร`;
}
function clearSource() { document.getElementById('sourceText').value = ''; updateSourceStats(); hideHighlight(); }
function clearTranslation() {
  document.getElementById('translationOutput').innerHTML = '<div class="output-placeholder">คำแปลจะปรากฏที่นี่...</div>';
  document.getElementById('translationStats').textContent = 'รอการแปล';
}
async function copyTranslation() {
  const text = document.getElementById('translationOutput').innerText.trim();
  if (!text || text === 'คำแปลจะปรากฏที่นี่...') { showToast('ยังไม่มีคำแปล', 'error'); return; }
  try { await navigator.clipboard.writeText(text); showToast('คัดลอกแล้ว ✓', 'success'); }
  catch { showToast('คัดลอกล้มเหลว', 'error'); }
}
function addLog(el, msg, cls) {
  const d = document.createElement('div');
  d.className = 'log-entry' + (cls ? ' ' + cls : '');
  d.textContent = msg;
  el.appendChild(d);
  el.scrollTop = el.scrollHeight;
}
function esc(str) {
  if (!str) return '';
  const d = document.createElement('div'); d.textContent = str; return d.innerHTML;
}
function openModal(id) { document.getElementById(id).classList.add('open'); }
function closeModal(id) { document.getElementById(id).classList.remove('open'); }

let _toastTimer = null;
function showToast(msg, type) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = 'toast show' + (type ? ' ' + type : '');
  if (_toastTimer) clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => { t.className = 'toast'; }, 3500);
}

// ─── Load from Chapter (Translate Tab) ───
function openLoadFromChapter() {
  if (!S.currentWs) { showToast('เลือก Workspace ก่อน', 'error'); return; }
  const chapters = S.currentWs.chapters || [];
  const listEl = document.getElementById('loadChapterList');
  if (!chapters.length) {
    listEl.innerHTML = '<div style="color:var(--text-muted);font-size:0.82rem;padding:10px 0">ยังไม่มีตอน</div>';
  } else {
    const sorted = [...chapters].sort((a,b) => (a.chapterNum||0)-(b.chapterNum||0));
    listEl.innerHTML = sorted.map(ch => `
      <div onclick="loadChapterSource('${ch.id}')" style="
        padding:10px 12px; background:var(--bg-deep); border:1px solid var(--border);
        border-radius:var(--radius); cursor:pointer; transition:all 0.15s;
        display:flex; align-items:center; gap:10px;
      " onmouseover="this.style.background='var(--bg-hover)'" onmouseout="this.style.background='var(--bg-deep)'">
        <span style="font-size:0.7rem;font-family:var(--font-mono);color:var(--text-muted);min-width:28px">#${ch.chapterNum||'?'}</span>
        <span style="flex:1;font-size:0.85rem;color:var(--text-primary)">${esc(ch.title)}</span>
        <span style="font-size:0.65rem;color:${ch.sourceText?'#4caf50':'var(--text-muted)'}">
          ${ch.sourceText ? `${ch.sourceText.length.toLocaleString()} ตัวอักษร` : 'ไม่มีต้นฉบับ'}
        </span>
      </div>
    `).join('');
  }
  openModal('modal-load-chapter');
}

function loadChapterSource(id) {
  const ch = S.currentWs?.chapters.find(c => c.id === id);
  if (!ch) return;
  if (!ch.sourceText) { showToast('ตอนนี้ไม่มีข้อความต้นฉบับ', 'error'); return; }
  document.getElementById('sourceText').value = ch.sourceText;
  updateSourceStats();
  closeModal('modal-load-chapter');
  showToast(`โหลด "${ch.title}" แล้ว`, 'success');
}

// ─── EPUB Import ───
function openEpubImport() { document.getElementById('epubFileInput').click(); }

async function handleEpubImport(e) {
  const file = e.target.files[0];
  if (!file) return;
  if (!S.currentWsId) { showToast('เลือก Workspace ก่อน', 'error'); return; }
  showToast('กำลังอ่าน EPUB...', '');
  try {
    const { chapters, skipped } = await parseEpub(file);
    if (!chapters.length) { showToast('ไม่พบเนื้อหาใน EPUB', 'error'); return; }
    // Find highest existing chapterNum to continue from
    const existingNums = S.currentWs.chapters.map(c => c.chapterNum || 0);
    const startNum = existingNums.length ? Math.max(...existingNums) + 1 : 1;
    let added = 0;
    for (let idx = 0; idx < chapters.length; idx++) {
      const ch = chapters[idx];
      const newCh = {
        id: genId(),
        title: ch.title,
        chapterNum: startNum + idx,  // sequential from max existing
        sourceText: ch.text,
        translation: '',
        status: 'pending',
        notes: 'นำเข้าจาก EPUB',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        wordCount: ch.text.length,
      };
      S.currentWs.chapters.push(newCh);
      added++;
    }
    await lsSaveWorkspace(S.currentWs);
    renderChapters();
    updateChapterSaveSelect();
    const skipNote = skipped > 0 ? ` (ข้าม ${skipped} ไฟล์ที่ไม่ใช่เนื้อหา)` : '';
    showToast(`Import สำเร็จ — เพิ่ม ${added} ตอน ✓${skipNote}`, 'success');
  } catch (err) {
    showToast('Import ล้มเหลว: ' + err.message, 'error');
  }
  e.target.value = '';
}

async function parseEpub(file) {
  const arrayBuffer = await file.arrayBuffer();
  // Read as ZIP (EPUB = ZIP)
  const zip = await loadZip(arrayBuffer);
  if (!zip) throw new Error('ไม่ใช่ไฟล์ EPUB ที่ถูกต้อง');

  // Find OPF file from container.xml
  const containerXml = await zip.readText('META-INF/container.xml');
  if (!containerXml) throw new Error('ไม่พบ META-INF/container.xml');

  const opfMatch = containerXml.match(/full-path="([^"]+\.opf)"/i);
  if (!opfMatch) throw new Error('ไม่พบไฟล์ OPF');
  const opfPath = opfMatch[1];
  const opfDir = opfPath.includes('/') ? opfPath.substring(0, opfPath.lastIndexOf('/') + 1) : '';

  const opfXml = await zip.readText(opfPath);
  if (!opfXml) throw new Error('อ่านไฟล์ OPF ไม่ได้');

  // Parse manifest items
  const itemsMap = {};
  const itemRegex = /<item\s+([^>]+)\/>/gi;
  let m;
  while ((m = itemRegex.exec(opfXml)) !== null) {
    const attrs = m[1];
    const id = (attrs.match(/id="([^"]+)"/) || [])[1];
    const href = (attrs.match(/href="([^"]+)"/) || [])[1];
    const mt = (attrs.match(/media-type="([^"]+)"/) || [])[1];
    if (id && href) itemsMap[id] = { href, mediaType: mt };
  }

  // Parse spine order
  const spineIds = [];
  const spineItemRegex = /<itemref\s+idref="([^"]+)"/gi;
  while ((m = spineItemRegex.exec(opfXml)) !== null) spineIds.push(m[1]);

  // Parse NCX/NAV for titles
  const titlesMap = {};
  // Try NCX first (EPUB 2)
  const ncxItem = Object.values(itemsMap).find(it => it.mediaType && it.mediaType.includes('ncx'));
  if (ncxItem) {
    const ncxPath = opfDir + ncxItem.href;
    const ncxXml = await zip.readText(ncxPath);
    if (ncxXml) {
      const navPoints = ncxXml.match(/<navPoint[\s\S]*?<\/navPoint>/gi) || [];
      navPoints.forEach(np => {
        const srcM = np.match(/src="([^"#"]+)/);
        const labelM = np.match(/<text>([\s\S]*?)<\/text>/);
        if (srcM && labelM) {
          const src = srcM[1].split('#')[0];
          titlesMap[src] = labelM[1].replace(/<[^>]+>/g,'').trim();
        }
      });
    }
  }

  // Extract chapters from spine
  const chapters = [];
  let skippedCount = 0;
  for (const spineId of spineIds) {
    const item = itemsMap[spineId];
    if (!item) { skippedCount++; continue; }
    if (item.mediaType && !item.mediaType.includes('html')) { skippedCount++; continue; }

    const filePath = opfDir + item.href;
    const htmlContent = await zip.readText(filePath);
    if (!htmlContent) { skippedCount++; continue; }

    const text = htmlToText(htmlContent);
    if (!text || text.trim().length < 30) { skippedCount++; continue; }

    const hrefBase = item.href.split('#')[0];
    const title = titlesMap[hrefBase] || titlesMap[item.href] || guessChapterTitle(text) || `ตอนที่ ${chapters.length + 1}`;

    // ถ้าบรรทัดแรกของ text ตรงกับชื่อตอน (เช่น NovelpiaParser ใหม่ใส่ EP.x - ชื่อ เป็น paragraph แรก)
    // → ตัดออกเพื่อไม่ให้เบิ้ลเวลา import
    let cleanText = text.trim();
    const firstLine = cleanText.split('\n')[0].trim();
    if (firstLine && title && firstLine === title.trim()) {
      cleanText = cleanText.slice(firstLine.length).replace(/^\n+/, '').trim();
    }
    if (!cleanText || cleanText.length < 10) { skippedCount++; continue; }

    chapters.push({ title, text: cleanText });
  }

  return { chapters, skipped: skippedCount };
}

// Minimal ZIP reader for EPUB (no external lib)
async function loadZip(arrayBuffer) {
  // WebView เก่า (Termux/Android รุ่นเก่า) ไม่มี DecompressionStream — บอกตรงๆ ดีกว่าพังเงียบ
  if (typeof DecompressionStream === 'undefined') {
    throw new Error('เบราว์เซอร์นี้ไม่รองรับการแตกไฟล์ ZIP (ต้องใช้ Chrome/WebView เวอร์ชัน 80+)');
  }
  // Use JSZip-like approach via DataView
  const bytes = new Uint8Array(arrayBuffer);
  const decoder = new TextDecoder('utf-8', { fatal: false });

  function readUint16(offset) { return bytes[offset] | (bytes[offset+1] << 8); }
  function readUint32(offset) { return bytes[offset] | (bytes[offset+1]<<8) | (bytes[offset+2]<<16) | (bytes[offset+3]<<24); }

  // Find End of Central Directory — สแกนเฉพาะท้ายไฟล์ตามสเปก (EOCD + comment สูงสุด 65,557 bytes)
  let eocdOffset = -1;
  const scanFloor = Math.max(0, bytes.length - 65557);
  for (let i = bytes.length - 22; i >= scanFloor; i--) {
    if (bytes[i]===0x50 && bytes[i+1]===0x4B && bytes[i+2]===0x05 && bytes[i+3]===0x06) {
      eocdOffset = i; break;
    }
  }
  if (eocdOffset < 0) {
    // แยกเคส ZIP64 ให้ข้อความชัด
    for (let i = bytes.length - 56; i >= scanFloor; i--) {
      if (bytes[i]===0x50 && bytes[i+1]===0x4B && bytes[i+2]===0x06 && bytes[i+3]===0x06) {
        throw new Error('ไฟล์ EPUB ใช้รูปแบบ ZIP64 ซึ่งยังไม่รองรับ (ไฟล์ใหญ่เกิน 4GB?)');
      }
    }
    throw new Error('ไม่ใช่ไฟล์ ZIP/EPUB ที่ถูกต้อง หรือไฟล์เสียหาย/ถูกตัดท้าย');
  }

  const cdOffset = readUint32(eocdOffset + 16);
  const cdEntries = readUint16(eocdOffset + 8);
  const files = {};
  let pos = cdOffset;

  for (let i = 0; i < cdEntries; i++) {
    if (pos + 46 > bytes.length) break;
    if (bytes[pos]!==0x50||bytes[pos+1]!==0x4B||bytes[pos+2]!==0x01||bytes[pos+3]!==0x02) break;
    const compression = readUint16(pos + 10);
    const compSize = readUint32(pos + 20);
    const uncompSize = readUint32(pos + 24);
    const fnLen = readUint16(pos + 28);
    const extraLen = readUint16(pos + 30);
    const commentLen = readUint16(pos + 32);
    const localOffset = readUint32(pos + 42);
    const filename = decoder.decode(bytes.slice(pos + 46, pos + 46 + fnLen));
    files[filename] = { compression, compSize, uncompSize, localOffset };
    pos += 46 + fnLen + extraLen + commentLen;
  }

  async function readText(filename) {
    const entry = files[filename];
    if (!entry) return null;
    let lPos = entry.localOffset;
    if (lPos + 30 > bytes.length) return null;
    const fnLen2 = readUint16(lPos + 26);
    const extraLen2 = readUint16(lPos + 28);
    lPos += 30 + fnLen2 + extraLen2;
    if (lPos + entry.compSize > bytes.length) return null; // entry ชี้เกินไฟล์ — ไฟล์ถูกตัดท้าย
    const compData = bytes.slice(lPos, lPos + entry.compSize);
    let result;
    if (entry.compression === 0) {
      result = compData;
    } else if (entry.compression === 8) {
      try {
        const ds = new DecompressionStream('deflate-raw');
        const writer = ds.writable.getWriter();
        writer.write(compData);
        writer.close();
        const chunks = [];
        const reader = ds.readable.getReader();
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          chunks.push(value);
        }
        const total = chunks.reduce((s,c) => s+c.length, 0);
        result = new Uint8Array(total);
        let off = 0;
        for (const c of chunks) { result.set(c, off); off += c.length; }
      } catch { return null; }
    } else { return null; }
    return decoder.decode(result);
  }

  return { readText };
}

function htmlToText(html) {
  // Strip style/script blocks first
  let text = html
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '');

  // ── กรองขยะ Novelpia ก่อนตรวจ structure ──
  // watermark hidden <p opacity:0>
  text = text.replace(/<p[^>]*opacity\s*:\s*0[^>]*>[\s\S]*?<\/p>/gi, '');
  // cover-wrapper / cover-text
  text = text.replace(/<div[^>]*class="[^"]*cover-(?:wrapper|text)[^"]*"[\s\S]*?<\/div>/gi, '');

  // Detect Novelpia-style EPUB: ผลิตโดย NovelpiaParser.jsonToHtml
  // โครงสร้าง: <div>บรรทัด</div><br/><div>บรรทัด</div>
  // WebToEpub ห่อด้วย <section> เสมอ → ห้าม exclude section
  // ✅ เช็คว่ามี <div>…</div> + <br> และ ไม่มี <p> หรือ <table>
  const isNovelpiaStyle = /<div[^>]*>[\s\S]*?<\/div>[\s\S]*?<br[\s/]*/i.test(text)
    && !/<p\b/i.test(text)
    && !/<table\b/i.test(text);

  if (isNovelpiaStyle) {
    // consecutive <div> โดยไม่มี <br> คั่น = paragraph ใหม่ → เพิ่ม blank line
    text = text.replace(/<\/div>\s*<div[^>]*>/gi, '</div>\n<div>');
    text = text.replace(/<br\s*\/?>/gi, '\n');   // <br> = ตัวคั่น paragraph
    text = text.replace(/<\/div>/gi, '\n');       // </div> = จบบรรทัด
    text = text.replace(/<[^>]+>/g, '');
  } else {
    text = text
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/p>/gi, '\n\n')
      .replace(/<\/div>/gi, '\n')
      .replace(/<\/h[1-6]>/gi, '\n\n')
      .replace(/<[^>]+>/g, '');
  }

  // Decode HTML entities
  text = text
    .replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>')
    .replace(/&nbsp;/g,' ')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n));

  // Normalise whitespace
  text = text
    .replace(/[ \t]+/g, ' ')
    .replace(/ \n/g, '\n')
    .replace(/\n /g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return text;
}

function guessChapterTitle(text) {
  const firstLine = text.split('\n')[0].trim().slice(0, 80);
  return firstLine || null;
}

// ─── Re-number All Chapters ───
async function renumberAllChapters() {
  if (!S.currentWs?.chapters.length) { showToast('ไม่มีตอน', 'error'); return; }
  if (!confirm('เรียงเลขตอนใหม่ตามลำดับปัจจุบัน (1, 2, 3...)?\nไม่กระทบต้นฉบับหรือคำแปล')) return;
  const sorted = [...S.currentWs.chapters].sort((a, b) => (a.chapterNum || 0) - (b.chapterNum || 0));
  sorted.forEach((ch, i) => {
    const real = S.currentWs.chapters.find(c => c.id === ch.id);
    if (real) real.chapterNum = i + 1;
  });
  await lsSaveWorkspace(S.currentWs);
  renderChapters();
  updateChapterSaveSelect();
  showToast('เรียงเลขตอนใหม่แล้ว ✓', 'success');
}

// ─── Bulk Rename ───
function openBulkRename() {
  if (!S.currentWs?.chapters.length) { showToast('ยังไม่มีตอน', 'error'); return; }
  const sorted = [...S.currentWs.chapters].sort((a, b) => (a.chapterNum || 0) - (b.chapterNum || 0));
  const list = document.getElementById('bulkRenameList');
  list.innerHTML = sorted.map(ch => `
    <div style="display:flex;align-items:center;gap:8px;padding:5px 6px;background:var(--bg-deep);border:1px solid var(--border);border-radius:var(--radius)">
      <span style="font-size:0.7rem;font-family:var(--font-mono);color:var(--text-muted);min-width:28px;flex-shrink:0">#${ch.chapterNum||'?'}</span>
      <input class="bulk-rename-input" data-id="${ch.id}" type="text" value="${esc(ch.title)}"
        style="flex:1;background:transparent;border:none;border-bottom:1px dashed var(--border);color:var(--text-primary);font-size:0.85rem;font-family:var(--font-body);outline:none;padding:2px 4px;"
        onfocus="this.style.borderBottomColor='var(--gold)'" onblur="this.style.borderBottomColor='var(--border)'"/>
    </div>
  `).join('');
  document.getElementById('bulkRenameStatus').textContent = '';
  openModal('modal-bulk-rename');
}

async function bulkRenameWithAI() {
  const inputs = [...document.querySelectorAll('.bulk-rename-input')];
  if (!inputs.length) return;
  const btn = document.getElementById('bulkRenameAiBtn');
  const status = document.getElementById('bulkRenameStatus');
  btn.disabled = true;

  const titles = inputs.map(inp => inp.value.trim());
  const model = document.getElementById('bulkRenameModel').value;

  // แบ่ง batch ละ 30 ตอน เพื่อป้องกัน JSON truncation
  const BATCH = 30;
  const batches = [];
  for (let i = 0; i < titles.length; i += BATCH) batches.push(titles.slice(i, i + BATCH));

  let translated = [];
  try {
    for (let b = 0; b < batches.length; b++) {
      const batch = batches[b];
      status.textContent = `🤖 กำลังแปล batch ${b+1}/${batches.length} (${batch.length} ตอน)...`;

      const prompt = `You are a Korean to Thai chapter title translator.
Translate each chapter title to natural Thai. Return ONLY a valid JSON array of strings, nothing else.
The array must have exactly ${batch.length} elements.
Do NOT use markdown code blocks. Output only the raw JSON array.
Example: ["ชื่อตอนที่ 1","ชื่อตอนที่ 2"]

Chapter titles to translate:
${batch.map((t, i) => `${i+1}. ${t}`).join('\n')}`;

      const res = await callOpenRouter({
        model,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.2,
        max_tokens: Math.max(1000, batch.length * 40),
      });

      let raw = (res.choices?.[0]?.message?.content || '').trim();
      // Strip markdown fences if any
      raw = raw.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/,'').trim();

      let batchResult = null;
      try {
        batchResult = JSON.parse(raw);
      } catch {
        batchResult = tryRepairJson(raw);
      }

      if (!Array.isArray(batchResult)) {
        // Fallback: try to extract strings from the response line by line
        batchResult = raw.split('\n')
          .map(l => l.replace(/^\d+\.\s*/, '').replace(/^["']|["']$/g, '').trim())
          .filter(Boolean);
      }

      translated = translated.concat(batchResult);
    }

    // Apply results back to inputs
    let applied = 0;
    inputs.forEach((inp, i) => {
      if (translated[i] && typeof translated[i] === 'string' && translated[i].trim()) {
        inp.value = translated[i].trim();
        applied++;
      }
    });
    status.textContent = `✓ แปลชื่อ ${applied}/${titles.length} ตอนแล้ว`;
  } catch (e) {
    status.textContent = '❌ ' + e.message;
  } finally {
    btn.disabled = false;
  }
}

async function saveBulkRename() {
  const inputs = [...document.querySelectorAll('.bulk-rename-input')];
  let changed = 0;
  inputs.forEach(inp => {
    const id = inp.dataset.id;
    const newTitle = inp.value.trim();
    if (!newTitle) return;
    const ch = S.currentWs.chapters.find(c => c.id === id);
    if (ch && ch.title !== newTitle) { ch.title = newTitle; changed++; }
  });
  if (changed) {
    await lsSaveWorkspace(S.currentWs);
    renderChapters();
    updateChapterSaveSelect();
    showToast(`บันทึกชื่อ ${changed} ตอนแล้ว ✓`, 'success');
  } else {
    showToast('ไม่มีการเปลี่ยนแปลง', '');
  }
  closeModal('modal-bulk-rename');
}

// ─── Export Chapter Selector ───
let _exportSelFormat = 'txt';

function openExportSelect(format) {
  if (!S.currentWs) return;
  _exportSelFormat = format;
  const fmtLabel = { txt: 'TXT', docx: 'DOCX', zip: 'ZIP' }[format] || format.toUpperCase();
  document.getElementById('exportSelectTitle').textContent = `📤 เลือกตอน — Export ${fmtLabel}`;
  document.getElementById('exportSelConfirmBtn').textContent = `📤 Export ${fmtLabel}`;
  const chapters = [...S.currentWs.chapters].sort((a, b) => (a.chapterNum || 0) - (b.chapterNum || 0));
  const list = document.getElementById('exportSelList');
  list.innerHTML = chapters.map(ch => `
    <label style="display:flex;align-items:center;gap:8px;padding:5px 6px;border-radius:4px;cursor:pointer" onmouseover="this.style.background='var(--bg-hover)'" onmouseout="this.style.background=''">
      <input type="checkbox" class="export-sel-chk" data-id="${ch.id}" checked style="accent-color:var(--gold)"
        onclick="rangeCheckboxClick(event,'export-sel','.export-sel-chk',exportSelUpdateCount)"
        onchange="exportSelUpdateCount()" title="Shift+คลิก เพื่อเลือกช่วง"/>
      <span style="font-size:0.72rem;font-family:var(--font-mono);color:var(--text-muted);min-width:28px">#${ch.chapterNum||'?'}</span>
      <span style="flex:1;font-size:0.82rem;color:var(--text-primary)">${esc(ch.title)}</span>
      <span class="status-badge ${ch.status==='translated'?'translated':'pending'}" style="font-size:0.6rem">${ch.status==='translated'?'✓ แปลแล้ว':'○ รอ'}</span>
    </label>
  `).join('');
  exportSelUpdateCount();
  closeModal('modal-export');
  openModal('modal-export-select');
}

function exportSelUpdateCount() {
  const n = document.querySelectorAll('.export-sel-chk:checked').length;
  document.getElementById('exportSelCount').textContent = `${n} ตอนที่เลือก`;
}
function exportSelSelectAll() { document.querySelectorAll('.export-sel-chk').forEach(el => el.checked = true); exportSelUpdateCount(); }
function exportSelDeselectAll() { document.querySelectorAll('.export-sel-chk').forEach(el => el.checked = false); exportSelUpdateCount(); }
function exportSelSelectTranslated() {
  document.querySelectorAll('.export-sel-chk').forEach(el => {
    const ch = S.currentWs.chapters.find(c => c.id === el.dataset.id);
    el.checked = ch?.status === 'translated';
  });
  exportSelUpdateCount();
}

function confirmExportSelected() {
  const checked = [...document.querySelectorAll('.export-sel-chk:checked')];
  if (!checked.length) { showToast('เลือกตอนก่อน', 'error'); return; }
  const selectedIds = new Set(checked.map(el => el.dataset.id));
  const chapters = [...S.currentWs.chapters]
    .filter(ch => selectedIds.has(ch.id))
    .sort((a, b) => (a.chapterNum || 0) - (b.chapterNum || 0));
  const name = S.currentWs.name || 'export';
  closeModal('modal-export-select');
  if (_exportSelFormat === 'txt') {
    const text = chapters.map(ch => `=== ${ch.title} ===\n\n${ch.translation || '(ยังไม่มีคำแปล)'}`).join('\n\n\n');
    downloadBlob(new Blob([text], { type: 'text/plain;charset=utf-8' }), `${name}_selected.txt`);
    showToast('Export TXT สำเร็จ ✓', 'success');
  } else if (_exportSelFormat === 'docx') {
    const escXml = s => s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    const body = chapters.map(ch => {
      const heading = `<w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:rPr><w:b/><w:sz w:val="32"/><w:rFonts w:ascii="Tahoma" w:hAnsi="Tahoma"/></w:rPr><w:t>${escXml(ch.title)}</w:t></w:r></w:p><w:p/>`;
      const content = (ch.translation || '(ยังไม่มีคำแปล)').split('\n').map(line =>
        `<w:p><w:r><w:rPr><w:rFonts w:ascii="Tahoma" w:hAnsi="Tahoma"/></w:rPr><w:t xml:space="preserve">${escXml(line)}</w:t></w:r></w:p>`).join('');
      return heading + content + '<w:p/><w:p/>';
    }).join('');
    const docXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr></w:body></w:document>`;
    const buf = buildDocxZip(docXml);
    downloadBlob(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }), `${name}_selected.docx`);
    showToast('Export DOCX สำเร็จ ✓', 'success');
  } else if (_exportSelFormat === 'zip') {
    const files = {};
    chapters.forEach(ch => {
      const num = String(ch.chapterNum || '0').padStart(3, '0');
      const safeName = ch.title.replace(/[\\/:*?"<>|]/g, '_');
      files[`${num}_${safeName}.txt`] = ch.translation || '(ยังไม่มีคำแปล)';
    });
    const buf = buildZipBuffer(files);
    downloadBlob(new Blob([buf], { type: 'application/zip' }), `${name}_selected.zip`);
    showToast('Export ZIP สำเร็จ ✓', 'success');
  }
}

// ─── Auto Glossary — Chunked + Source Tracking ───
// Override runAutoGlossary with chunked version
async function runAutoGlossary() {
  let text = '';
  let sourceChapterInfo = null; // { id, title, chapterNum } for single chapter

  if (_agTab === 'chapters') {
    const checked = [...document.querySelectorAll('.ag-ch-chk:checked')];
    if (!checked.length) { showToast('เลือกตอนก่อน', 'error'); return; }
    const parts = checked.map(el => {
      const ch = S.currentWs?.chapters.find(c => c.id === el.dataset.id);
      return ch ? { id: ch.id, title: ch.title, chapterNum: ch.chapterNum, text: ch.sourceText || '' } : null;
    }).filter(Boolean);
    // Store chapter info for source tracking (multi-chapter)
    window._agChapterInfoMap = {};
    parts.forEach(p => { window._agChapterInfoMap[p.id] = { id: p.id, title: p.title, chapterNum: p.chapterNum }; });
    text = parts.map(p => p.text).filter(Boolean).join('\n\n');
    // Mark chapters as to-be-tracked
    window._agCheckedChapters = parts;
  } else {
    text = document.getElementById('agSourceText').value.trim();
    window._agCheckedChapters = null;
    window._agChapterInfoMap = null;
  }

  if (!text) { showToast('ไม่มีข้อความให้วิเคราะห์', 'error'); return; }

  const btn = document.getElementById('agRunBtn');
  const status = document.getElementById('agStatus');
  btn.disabled = true;
  document.getElementById('agResults').style.display = 'none';
  _agTerms = [];

  const model = document.getElementById('agModel')?.value || document.getElementById('translateModel').value;
  const existing = (S.glossaryData || []).map(g => g.korean).join(', ') || '(ไม่มี)';

  // ── Chunked extraction: split every 15,000 chars at paragraph boundary ──
  const CHUNK_LIMIT = 15000;
  const chunks = [];
  if (text.length <= CHUNK_LIMIT) {
    chunks.push(text);
  } else {
    let pos = 0;
    while (pos < text.length) {
      let end = pos + CHUNK_LIMIT;
      if (end < text.length) {
        const nl = text.lastIndexOf('\n', end);
        if (nl > pos + CHUNK_LIMIT * 0.5) end = nl + 1;
      } else { end = text.length; }
      chunks.push(text.slice(pos, end));
      pos = end;
    }
  }

  status.textContent = chunks.length > 1
    ? `🤖 วิเคราะห์ ${chunks.length} ส่วน (${text.length.toLocaleString()} ตัวอักษร)...`
    : '🤖 กำลังวิเคราะห์...';

  try {
    let allTerms = [];
    const seenKorean = new Set((S.glossaryData || []).map(g => g.korean));

    for (let ci = 0; ci < chunks.length; ci++) {
      const chunk = chunks[ci];
      if (chunks.length > 1) status.textContent = `🤖 วิเคราะห์ส่วน ${ci+1}/${chunks.length}...`;

      // Build existing list including terms found so far
      const existingNow = [...seenKorean].join(', ') || '(ไม่มี)';
      const prompt = agGetPrompt().replace('{existing}', existingNow).replace('{text}', chunk).replace('{thai_snippet}', '');

      try {
        const res = await callOpenRouter({ model, messages: [{ role: 'user', content: prompt }], temperature: 0.2, max_tokens: 2000 });
        const raw = res.choices?.[0]?.message?.content?.trim() || '[]';
        const terms = JSON.parse(raw.replace(/```json|```/g, '').trim());
        if (Array.isArray(terms)) {
          terms.forEach(t => {
            if (t.korean && !seenKorean.has(t.korean)) {
              seenKorean.add(t.korean);
              // Attach source chapter info
              if (window._agCheckedChapters?.length === 1) {
                t.sourceChapterId = window._agCheckedChapters[0].id;
                t.sourceChapterTitle = window._agCheckedChapters[0].title;
                t.sourceChapterNum = window._agCheckedChapters[0].chapterNum;
              } else if (window._agCheckedChapters?.length > 1) {
                // Find which chapter text contains this term
                const found = window._agCheckedChapters.find(p => p.text.includes(t.korean));
                if (found) {
                  t.sourceChapterId = found.id;
                  t.sourceChapterTitle = found.title;
                  t.sourceChapterNum = found.chapterNum;
                }
              }
              allTerms.push(t);
            }
          });
        }
      } catch (chunkErr) {
        // Skip failed chunk, continue
        console.warn(`Auto Glossary chunk ${ci+1} failed:`, chunkErr.message);
      }
    }

    _agTerms = allTerms;
    if (!_agTerms.length) {
      status.textContent = '✓ ไม่พบคำศัพท์ใหม่';
      document.getElementById('agResults').style.display = 'none';
      return;
    }
    status.textContent = `พบ ${_agTerms.length} คำใหม่`;
    renderAgResults(_agTerms);
    document.getElementById('agResults').style.display = 'block';

  } catch (e) { status.textContent = '❌ ' + e.message; }
  finally { btn.disabled = false; }
}

// ─── Patch addSelectedGlossary to include source + mark chapters ───
async function addSelectedGlossary() {
  if (!S.currentWsId) { showToast('เลือก Workspace ก่อน', 'error'); return; }
  const selected = _agTerms.filter((_, i) => document.getElementById(`ag-chk-${i}`)?.checked)
    .map((t) => {
      const i = _agTerms.indexOf(t);
      return { ...t, thai: document.getElementById(`ag-thai-${i}`)?.value?.trim() || t.thai };
    });
  if (!selected.length) { showToast('ไม่ได้เลือกคำ', 'error'); return; }
  let added = 0;
  selected.forEach(term => {
    const exists = S.currentWs.glossary.findIndex(g => g.korean === term.korean);
    if (exists < 0) { S.currentWs.glossary.push(term); added++; }
  });
  S.glossaryData = S.currentWs.glossary;

  // Mark chapters that were analysed as glossaryExtracted = true
  if (window._agCheckedChapters?.length) {
    window._agCheckedChapters.forEach(info => {
      const ch = S.currentWs.chapters.find(c => c.id === info.id);
      if (ch) ch.glossaryExtracted = true;
    });
  }

  await lsSaveWorkspace(S.currentWs);
  renderGlossaryTable();
  if (S.currentTab === 'chapters') renderChapters();
  closeModal('modal-autoglossary');
  showToast(`เพิ่ม ${added} คำลงคลังศัพท์แล้ว ✓`, 'success');
}

// ─── Glossary Type System ───
const PRESET_TYPES = {
  character: 'ตัวละคร',
  title:     'ตำแหน่ง/ยศ',
  rank:      'ลำดับขั้น',
  term:      'คำศัพท์ทั่วไป',
  honorific: 'คำยกย่อง',
  place:     'สถานที่',
  skill:     'ทักษะ/วิชา',
  item:      'ไอเทม/วัตถุ',
  clan:      'กลุ่ม/สำนัก',
  monster:   'มอนสเตอร์/สัตว์',
};

// Ensure a type value exists in the gType select; add option if not
function ensureTypeInDropdown(type) {
  if (!type) return;
  const sel = document.getElementById('gType');
  if (!sel) return;
  const exists = [...sel.options].some(o => o.value === type);
  if (!exists) {
    const opt = document.createElement('option');
    opt.value = type;
    opt.textContent = type + ' (custom)';
    sel.appendChild(opt);
  }
}

// Rebuild glossaryTypeFilter จาก preset + custom types ของ workspace + types ใน glossary
// (rebuild ทุกครั้ง — กัน option ค้างข้าม workspace)
function refreshTypeFilter() {
  const sel = document.getElementById('glossaryTypeFilter');
  if (!sel) return;
  const cur = sel.value;
  const types = new Set([...Object.keys(PRESET_TYPES), ...(S.currentWs?.customGlossaryTypes || [])]);
  (S.glossaryData || []).forEach(g => { const t = g.type?.trim(); if (t) types.add(t); });
  sel.innerHTML = '<option value="">ทุกประเภท</option>' +
    [...types].map(t => `<option value="${esc(t)}">${PRESET_TYPES[t] || t}</option>`).join('');
  if (cur && [...sel.options].some(o => o.value === cur)) sel.value = cur;
}

// Rebuild gType select: preset + custom types (persist ใน ws.customGlossaryTypes) + ตัวเลือกเพิ่มประเภทใหม่
function populateGlossaryTypeSelects() {
  const sel = document.getElementById('gType');
  if (sel) {
    const cur = sel.value;
    const customs = S.currentWs?.customGlossaryTypes || [];
    sel.innerHTML =
      Object.entries(PRESET_TYPES).map(([v, label]) => `<option value="${v}">${label}</option>`).join('') +
      customs.map(t => `<option value="${esc(t)}">${esc(t)} (custom)</option>`).join('') +
      `<option value="__newtype__">＋ ประเภทใหม่…</option>`;
    sel.value = (cur && [...sel.options].some(o => o.value === cur)) ? cur : 'term';
  }
  refreshTypeFilter();
}

// "＋ ประเภทใหม่…" — ถามชื่อ บันทึกเข้า workspace แล้วเลือกให้เลย
(function initCustomTypeOption() {
  const sel = document.getElementById('gType');
  if (!sel) return;
  sel.addEventListener('change', function () {
    if (this.value !== '__newtype__') return;
    const v = (prompt('ชื่อประเภทใหม่ (สั้นๆ เช่น ยานพาหนะ):') || '').trim();
    if (!v) { this.value = 'term'; return; }
    if (S.currentWs) {
      S.currentWs.customGlossaryTypes = [...new Set([...(S.currentWs.customGlossaryTypes || []), v])];
      lsSaveWorkspace(S.currentWs).catch(() => {});
    }
    populateGlossaryTypeSelects();
    this.value = v;
    document.getElementById('gGenderGroup').style.display = 'none';
  });
})();

// Get CSS class for any type (preset or custom)
function getTagClass(type) {
  const known = ['character','title','term','rank','honorific','place','skill','item','clan','monster'];
  return known.includes(type) ? `tag-${type}` : 'tag-custom';
}

// ─── Duplicate Check ───
let _lastSubstrPairs = [];

function checkDuplicateGlossary() {
  const data = S.glossaryData || [];
  if (!data.length) { showToast('คลังศัพท์ว่างเปล่า', ''); return; }

  const dupAlert = document.getElementById('glossaryDupAlert');

  // ── 1. Exact duplicates ──
  const seen = {};
  const exactDups = new Set();
  data.forEach(g => {
    const key = g.korean.trim();
    if (!key) return;
    if (seen[key]) exactDups.add(key);
    else seen[key] = true;
  });

  // ── 2. Korean substring overlaps เช่น 이하율 vs 이하율이 / 이하율의 ──
  _lastSubstrPairs = [];
  const keys = data.map(g => g.korean.trim()).filter(Boolean);
  for (let i = 0; i < keys.length; i++) {
    for (let j = 0; j < keys.length; j++) {
      if (i === j) continue;
      if (keys[j].includes(keys[i]) && keys[j] !== keys[i]) {
        const alreadyLogged = _lastSubstrPairs.some(p => p.sub === keys[i] && p.full === keys[j]);
        if (!alreadyLogged) {
          const subEntry  = data.find(g => g.korean === keys[i]);
          const fullEntry = data.find(g => g.korean === keys[j]);
          _lastSubstrPairs.push({ sub: keys[i], full: keys[j], subThai: subEntry?.thai||'', fullThai: fullEntry?.thai||'' });
        }
      }
    }
  }

  const hasIssues = exactDups.size > 0 || _lastSubstrPairs.length > 0;
  if (!hasIssues) {
    dupAlert.style.display = 'none';
    showToast('\u2713 \u0e44\u0e21\u0e48\u0e1e\u0e1a\u0e04\u0e33\u0e0b\u0e49\u0e33\u0e2b\u0e23\u0e37\u0e2d substring \u0e0b\u0e49\u0e2d\u0e19\u0e43\u0e19\u0e04\u0e25\u0e31\u0e07\u0e28\u0e31\u0e1e\u0e17\u0e4c', 'success');
    return;
  }

  let html = '';

  if (exactDups.size > 0) {
    const dupList = [...exactDups];
    html += '<div style="margin-bottom:6px">\u26a0 <strong>\u0e04\u0e33\u0e0b\u0e49\u0e33 exact ' + dupList.length + ' \u0e04\u0e33:</strong> ' + dupList.map(d => '<strong>' + esc(d) + '</strong>').join(', ') +
      ' &nbsp;<button onclick="removeDuplicateGlossary()" style="background:var(--crimson-light);color:#fff;border:none;padding:2px 8px;border-radius:4px;cursor:pointer;font-size:0.72rem">\u0e25\u0e1a\u0e0b\u0e49\u0e33\u0e2d\u0e31\u0e15\u0e42\u0e19\u0e21\u0e31\u0e15\u0e34</button></div>';
  }

  if (_lastSubstrPairs.length > 0) {
    const shown = _lastSubstrPairs.slice(0, 8);
    const more  = _lastSubstrPairs.length - shown.length;
    html += '<div style="margin-bottom:4px;display:flex;align-items:center;gap:8px;flex-wrap:wrap">' +
      '<span>\ud83d\udd0d <strong>Korean substring \u0e0b\u0e49\u0e2d\u0e19 ' + _lastSubstrPairs.length + ' \u0e04\u0e39\u0e48</strong> \u2014 \u0e2d\u0e32\u0e08 inject \u0e1c\u0e34\u0e14</span>' +
      '<button id="dupAiResolveBtn" onclick="aiResolveSubstrDups()" style="background:linear-gradient(135deg,#7a5820,#c9a84c);color:#0c0800;border:none;padding:2px 10px;border-radius:4px;cursor:pointer;font-size:0.72rem;font-weight:600">\ud83e\udd16 \u0e43\u0e2b\u0e49 AI \u0e08\u0e31\u0e14\u0e01\u0e32\u0e23</button>' +
      '</div>';
    html += '<div id="dupAiStatus" style="font-size:0.74rem;color:var(--gold);min-height:16px"></div>';
    html += shown.map(p =>
      '<div style="font-size:0.78rem;padding:2px 0;color:var(--text-secondary)">' +
        '<span style="color:var(--gold)">' + esc(p.sub) + '</span>' +
        '<span style="color:var(--text-muted)"> \u2282 </span>' +
        '<span style="color:var(--text-primary)">' + esc(p.full) + '</span>' +
        '<span style="color:var(--text-muted);font-size:0.7rem"> \u2014 "' + esc(p.subThai) + '" vs "' + esc(p.fullThai) + '"</span>' +
      '</div>'
    ).join('');
    if (more > 0) html += '<div style="font-size:0.72rem;color:var(--text-muted)">...\u0e41\u0e25\u0e30\u0e2d\u0e35\u0e01 ' + more + ' \u0e04\u0e39\u0e48</div>';
  }

  html += '<button onclick="document.getElementById(\'glossaryDupAlert\').style.display=\'none\'" style="background:none;border:none;color:var(--text-muted);cursor:pointer;font-size:0.8rem;float:right;margin-top:4px">\u2715</button>';

  dupAlert.style.display = 'block';
  dupAlert.innerHTML = html;
}

async function removeDuplicateGlossary() {
  const seen = new Set();
  const deduped = [];
  let removed = 0;
  (S.currentWs.glossary || []).forEach(g => {
    const key = g.korean.trim();
    if (!seen.has(key)) { seen.add(key); deduped.push(g); }
    else removed++;
  });
  S.currentWs.glossary = deduped;
  S.glossaryData = deduped;
  await lsSaveWorkspace(S.currentWs);
  document.getElementById('glossaryDupAlert').style.display = 'none';
  renderGlossaryTable();
  showToast(`ลบคำซ้ำ ${removed} รายการ ✓`, 'success');
}

// ─── AI Resolve Substring Duplicates ───
// ── Known Korean honorific/title suffixes ที่มักต่อท้ายชื่อ ──
// ถ้า full = sub + suffix เหล่านี้ → ลบ full ทันที ไม่ต้องรอ AI
const KOREAN_NAME_SUFFIXES = [
  // honorifics
  '씨','님','군','양','아','야',
  // social roles ที่ต่อท้ายชื่อ
  '선배','후배','형','오빠','언니','누나','아저씨','아줌마','할머니','할아버지',
  // titles/ranks ที่ใช้ต่อท้ายชื่อบุคคล
  '왕','왕자','공주','황제','황후','대왕','소왕','영주','기사','단장','단원',
  '대장','장군','총장','수장','두목','보스','마스터','스승','제자',
  // particles ที่บ่งชัด
  '이','가','은','는','을','를','의','와','과','도','만','로','으로',
  '에서','한테','께','에게','이다','이라','부터','까지',
];

const DUP_RESOLVE_PROMPT = `You are a Korean webnovel glossary expert. Analyze pairs of glossary entries where the shorter Korean term appears inside the longer one.

RULES:
- If the longer term = shorter term + Korean grammatical particle (이,의,을,를,가,은,는,이다,이라,로,으로,에,와,과,도,만,부터,까지,에서,한테,께,에게), then action = "delete_full"
- If the longer term = shorter term + Korean honorific or social title suffix (씨,님,군,양,선배,후배,형,오빠,언니,누나,왕,왕자,기사,장군,영주 etc.), then action = "delete_full" — because the base term is sufficient for glossary purposes
- If both terms have CLEARLY different meanings as independent concepts (e.g. 검 = sword vs 검기 = sword aura), then action = "keep_both"
- When unsure, action = "keep_both"

PAIRS (JSON):
{pairs}

Respond with ONLY a raw JSON array. No markdown fences, no explanation before or after.
Each element must have exactly these fields: sub, full, action, reason
The action field must be exactly one of these three strings: delete_full, delete_sub, keep_both

Example output:
[{"sub":"이하율","full":"이하율이","action":"delete_full","reason":"particle 이"},{"sub":"밀실론자","full":"밀실론자 선배","action":"delete_full","reason":"선배 = honorific suffix, base term sufficient"},{"sub":"검","full":"검기","action":"keep_both","reason":"검기 = sword aura, different meaning"}]`;

async function aiResolveSubstrDups() {
  if (!_lastSubstrPairs.length) return;
  if (!S.currentWsId) { showToast('เลือก Workspace ก่อน', 'error'); return; }

  const btn    = document.getElementById('dupAiResolveBtn');
  const status = document.getElementById('dupAiStatus');
  if (!btn || !status) return;

  btn.disabled = true;
  btn.textContent = '🤖 กำลังวิเคราะห์...';

  // ── Pre-check: คู่ที่ suffix ตรงกับ known list → ตัดสินเองทันที ──
  const preDecisions = [];
  const needAI = [];

  for (const p of _lastSubstrPairs) {
    // suffix = ส่วนที่เกิน sub ออกมาใน full (trim ช่องว่าง)
    const suffix = p.full.replace(p.sub, '').trim();
    if (KOREAN_NAME_SUFFIXES.includes(suffix)) {
      preDecisions.push({ sub: p.sub, full: p.full, action: 'delete_full', reason: `suffix "${suffix}" = honorific/particle` });
    } else {
      needAI.push(p);
    }
  }

  // ถ้าทุกคู่ถูก pre-check จัดการหมด → ไม่ต้อง call AI เลย
  let allDecisions = [...preDecisions];

  if (needAI.length > 0) {
    status.textContent = `Pre-check: ${preDecisions.length} คู่ · ส่ง AI อีก ${needAI.length} คู่...`;
    const model = document.getElementById('translateModel')?.value || 'google/gemini-2.5-flash';
    const pairData = needAI.map(p => ({ sub: p.sub, full: p.full, subThai: p.subThai, fullThai: p.fullThai }));

    try {
      const prompt = DUP_RESOLVE_PROMPT.replace('{pairs}', JSON.stringify(pairData, null, 2));
      const res = await callOpenRouter({ model, messages: [{ role: 'user', content: prompt }], temperature: 0.1, max_tokens: 1500 });
      const raw = (res.choices?.[0]?.message?.content || '').trim();
      let cleaned = raw.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/, '').trim()
        .replace(/[\u201C\u201D\u201E\u201F]/g, '"').replace(/[\u2018\u2019\u201A\u201B]/g, "'");

      let aiDecisions = null;
      try { aiDecisions = JSON.parse(cleaned); } catch {}
      if (!Array.isArray(aiDecisions)) {
        try { const m = cleaned.match(/\[[\s\S]*\]/); if (m) aiDecisions = JSON.parse(m[0]); } catch {}
      }
      if (!Array.isArray(aiDecisions)) {
        const objMatches = [...cleaned.matchAll(/\{[^{}]*"sub"\s*:\s*"([^"]+)"[^{}]*"full"\s*:\s*"([^"]+)"[^{}]*"action"\s*:\s*"([^"]+)"[^{}]*/g)];
        if (objMatches.length) aiDecisions = objMatches.map(m => ({ sub: m[1], full: m[2], action: m[3], reason: '' }));
      }
      if (Array.isArray(aiDecisions)) allDecisions = [...allDecisions, ...aiDecisions];
    } catch (e) {
      // AI ล้มเหลว แต่ยังมี preDecisions ที่จัดการได้
      if (!preDecisions.length) {
        status.textContent = '❌ ' + e.message;
        btn.disabled = false; btn.textContent = '🤖 ให้ AI จัดการ';
        return;
      }
    }
  } else {
    status.textContent = `Pre-check จัดการได้ ${preDecisions.length} คู่ ไม่ต้องใช้ AI`;
  }

  // ── Apply all decisions (pre-check + AI) ──
  try {
    const toDelete = new Set();
    let keepBothCount = 0;
    allDecisions.forEach(d => {
      if (d.action === 'delete_full') toDelete.add(d.full);
      else if (d.action === 'delete_sub') toDelete.add(d.sub);
      else keepBothCount++;
    });

    if (!toDelete.size) {
      status.textContent = `✓ ทุกคู่ต่างความหมาย เก็บไว้ทั้งหมด (${keepBothCount} คู่)`;
      btn.disabled = false; btn.textContent = '🤖 ให้ AI จัดการ';
      return;
    }

    const before = S.currentWs.glossary.length;
    S.currentWs.glossary = S.currentWs.glossary.filter(g => !toDelete.has(g.korean.trim()));
    S.glossaryData = S.currentWs.glossary;
    await lsSaveWorkspace(S.currentWs);
    renderGlossaryTable();

    const deleted = before - S.currentWs.glossary.length;
    const preCount = preDecisions.filter(d => d.action !== 'keep_both').length;
    const aiCount  = deleted - preCount;
    const reasons  = allDecisions
      .filter(d => d.action !== 'keep_both')
      .slice(0, 3)
      .map(d => `"${d.action === 'delete_full' ? d.full : d.sub}" (${d.reason})`)
      .join(' · ');

    const summary = preCount > 0 && aiCount > 0
      ? `Pre-check ${preCount} + AI ${aiCount} = ลบ ${deleted} คำ`
      : `ลบ ${deleted} คำ`;
    status.textContent = `✓ ${summary} · เก็บทั้งคู่ ${keepBothCount} คู่ · ${reasons}`;
    showToast(`จัดการ substring ซ้ำ — ลบ ${deleted} คำ ✓`, 'success');
    _lastSubstrPairs = [];
    setTimeout(() => checkDuplicateGlossary(), 400);

  } catch (e) {
    status.textContent = '❌ ' + e.message;
    btn.disabled = false; btn.textContent = '🤖 ให้ AI จัดการ';
  }
}

document.querySelectorAll('.modal-backdrop').forEach(el => {
  el.addEventListener('click', e => { if (e.target === el) el.classList.remove('open'); });
});

// ─── Auto Glossary Prompt Editor ───
const _agDefaultPrompt = `You are a Korean webnovel terminology extractor. Extract proper nouns and special terms from Korean text.

EXISTING GLOSSARY (skip these): {existing}

KOREAN SOURCE TEXT:
{text}

{thai_snippet}

Return ONLY JSON array (no markdown):
[{"korean":"term","thai":"Thai translation","type":"character|title|rank|term|honorific|place","gender":"male|female|neutral","note":"English meaning"}]

Rules:
- Only extract names, titles, skills, places, ranks — NOT common words
- Provide natural Thai translations
- type must be one of: character, title, rank, term, honorific, place
- gender: REQUIRED for type="character". Infer aggressively from ALL available cues:
  • Korean pronouns: 그/남자/형/오빠/아버지/아들/왕/황제 = male | 그녀/여자/언니/누나/어머니/딸/왕비 = female
  • Thai translation pronouns if provided: เขา/ผม/กู = male | เธอ/นาง/ฉัน/หนู = female
  • Leave "neutral" ONLY if genuinely impossible to determine
- Return empty array [] if no new terms found`;

function agTogglePromptEditor() {
  const wrap = document.getElementById('agPromptEditorWrap');
  const visible = wrap.style.display !== 'none';
  if (visible) {
    wrap.style.display = 'none';
  } else {
    // โหลด prompt ปัจจุบัน (จาก localStorage ถ้ามี ไม่งั้นใช้ default)
    const saved = localStorage.getItem('nt8_ag_prompt');
    document.getElementById('agPromptEditor').value = saved || _agDefaultPrompt;
    wrap.style.display = 'block';
  }
}

function agSavePrompt() {
  const val = document.getElementById('agPromptEditor').value.trim();
  if (!val.includes('{text}')) { showToast('Prompt ต้องมี {text}', 'error'); return; }
  if (!val.includes('{existing}')) { showToast('Prompt ต้องมี {existing}', 'error'); return; }
  localStorage.setItem('nt8_ag_prompt', val);
  showToast('บันทึก Prompt แล้ว ✓', 'success');
}

function agResetPrompt() {
  if (!confirm('คืนค่า Prompt เป็น default?')) return;
  localStorage.removeItem('nt8_ag_prompt');
  document.getElementById('agPromptEditor').value = _agDefaultPrompt;
  showToast('คืนค่า Prompt แล้ว ✓', 'success');
}

function agGetPrompt() {
  return localStorage.getItem('nt8_ag_prompt') || _agDefaultPrompt;
}

// ─── Clean Source Text (ลบ Base64 / ขยะ) ───
function cleanText(text) {
  return text
    // ลบ Base64 string (ยาว 20+ ตัว ประกอบด้วย A-Za-z0-9+/= ติดกัน)
    .replace(/[A-Za-z0-9+/]{20,}={0,2}/g, '')
    // ลบ URL ที่ติดมา
    .replace(/https?:\/\/\S+/g, '')
    // ลบช่องว่างซ้ำบนบรรทัดเดียวกัน
    .replace(/[ \t]{2,}/g, ' ')
    // ลบบรรทัดว่างเกิน 2 บรรทัดติดกัน
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// ─── Normalize Korean internet slang/jamo → Thai equivalents ───
function normalizeKoreanSlang(text) {
  if (!text) return text;

  return text
    // ── ㅋ (웃음/หัวเราะ) → 555 ──
    .replace(/ㅋ{8,}/g, '5555555')
    .replace(/ㅋ{6,7}/g, '555555')
    .replace(/ㅋ{4,5}/g, '5555')
    .replace(/ㅋ{3}/g, '555')
    .replace(/ㅋㅋ/g, '55')
    .replace(/ㅋ/g, '5')

    // ── ㅎ (웃음/อ่อนๆ) → 55 ──
    .replace(/ㅎ{4,}/g, '5555')
    .replace(/ㅎ{3}/g, '555')
    .replace(/ㅎㅎ/g, '55')
    .replace(/ㅎ/g, '5')

    // ── ㅠ / ㅜ (ร้องไห้) → ปล่อย AI ตัดสินเอง (ไม่แปลง) ──

    // ── ㄷㄷ (หวาดกลัว/ขนลุก) → สั่นเลย ──
    .replace(/ㄷ{4,}/g, 'สั่นเลย')
    .replace(/ㄷ{2,3}/g, 'สั่น')
    .replace(/ㄷ(?=\s|$)/g, 'สั่น')

    // ── ㅇㅇ (ยืนยัน) → อือ ──
    .replace(/ㅇㅇ+/g, 'อือ')

    // ── ㄴㄴ (ปฏิเสธ) → ไม่ๆ ──
    .replace(/ㄴㄴ+/g, 'ไม่ๆ')

    // ── ㅡㅡ (หน้าตาย) → -_- ──
    .replace(/ㅡㅡ+/g, '-_-')

    // ── ลด noise จาก !! ... ~~ มากเกิน ──
    .replace(/!{5,}/g, '!!!!!')
    .replace(/\?{5,}/g, '?????')
    .replace(/\.{4,}/g, '...')
    .replace(/~{4,}/g, '~~~');
}

function prepareSourceForTranslation(text) {
  return normalizeKoreanSlang(text);
}

function cleanSourceText() {
  const ta = document.getElementById('sourceText');
  const original = ta.value;
  const cleaned = cleanText(original);
  if (cleaned === original) { showToast('ไม่พบสิ่งที่ต้องลบ', ''); return; }

  const removed = original.length - cleaned.length;
  if (!confirm(`ลบออก ${removed.toLocaleString()} ตัวอักษร จากต้นฉบับปัจจุบัน\nดำเนินการ?`)) return;
  ta.value = cleaned;
  updateSourceStats();
  showToast(`🧹 ลบออก ${removed.toLocaleString()} ตัวอักษร ✓`, 'success');
}

async function cleanAllSourceTexts() {
  if (!S.currentWs) return;
  if (!confirm(`ลบ Base64/ขยะจาก sourceText ทุกตอนใน "${S.currentWs.name}"\nดำเนินการ? (สามารถ Undo ได้ครั้งเดียว)`)) return;
  // Undo snapshot — snapshot ทุก sourceText ก่อนแก้
  S._undoStack = {
    type: 'clean_all_source',
    snapshot: S.currentWs.chapters.map(c => ({ id: c.id, sourceText: c.sourceText }))
  };
  let totalRemoved = 0, chaptersAffected = 0;
  S.currentWs.chapters.forEach(ch => {
    if (!ch.sourceText) return;
    const cleaned = cleanText(ch.sourceText);
    if (cleaned !== ch.sourceText) {
      totalRemoved += ch.sourceText.length - cleaned.length;
      ch.sourceText = cleaned;
      chaptersAffected++;
    }
  });
  if (!chaptersAffected) { S._undoStack = null; showToast('ไม่พบสิ่งที่ต้องลบในทุกตอน', ''); return; }
  await lsSaveWorkspace(S.currentWs);
  showToast(`🧹 ลบออก ${totalRemoved.toLocaleString()} ตัวอักษร จาก ${chaptersAffected} ตอน — <u style="cursor:pointer" onclick="undoLastAction()">Undo</u>`, 'success');
}

// ─── Add Line Breaks (เพิ่ม 1 บรรทัดว่างระหว่างทุกบรรทัด) ───
function addLineBreaks(text) {
  return text
    // แต่ละบรรทัดที่มีเนื้อหา → เพิ่ม \n ต่อท้าย (ทำให้มี blank line คั่น)
    .split('\n')
    .map(line => line.trimEnd())
    .join('\n\n')
    // ลด blank lines ที่ซ้ำกัน (เผื่อมีบรรทัดอยู่แล้ว) ให้เหลือแค่ 1
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// เพิ่ม \n หลัง \n ตัวสุดท้ายที่ตามด้วย non-\n (แทรก blank line ก่อนย่อหน้าสุดท้าย)
function addOneLine(text) {
  // เพิ่ม \n อีก 1 ตัวในทุก gap ระหว่าง paragraph (กี่ครั้งก็ได้)
  // หา sequence ของ \n ที่มีอยู่ทุกตำแหน่ง แล้วเพิ่มอีก 1 เสมอ
  const result = text.replace(/\n+/g, (match) => match + '\n');
  return result;
}

function addLineBreaksOutput() {
  const output = document.getElementById('translationOutput');
  const text = output.innerText?.trim() || '';
  if (!text || text === 'คำแปลจะปรากฏที่นี่...') { showToast('ยังไม่มีคำแปล', 'error'); return; }

  const result = addLineBreaks(text);
  output.innerHTML = '';
  const el = document.createElement('div');
  el.className = 'segment-text';
  el.style.whiteSpace = 'pre-wrap';
  el.textContent = result;
  output.appendChild(el);
  showToast('📐 เพิ่ม Line Break แล้ว ✓', 'success');
}

function addOneLineOutput() {
  const output = document.getElementById('translationOutput');
  const text = output.innerText?.trim() || '';
  if (!text || text === 'คำแปลจะปรากฏที่นี่...') { showToast('ยังไม่มีคำแปล', 'error'); return; }

  const result = addOneLine(text);
  if (result === text) { showToast('ไม่มีบรรทัดให้เพิ่ม', ''); return; }
  output.innerHTML = '';
  const el = document.createElement('div');
  el.className = 'segment-text';
  el.style.whiteSpace = 'pre-wrap';
  el.textContent = result;
  output.appendChild(el);
  showToast('📐 Add 1 Line แล้ว ✓', 'success');
}

async function addOneLineAllChapters() {
  if (!S.currentWs) return;
  if (!confirm(`Add 1 Line ใน translation ทุกตอนใน "${S.currentWs.name}"\nไม่สามารถย้อนกลับได้ ดำเนินการ?`)) return;
  let chaptersAffected = 0;
  S.currentWs.chapters.forEach(ch => {
    if (!ch.translation) return;
    const result = addOneLine(ch.translation);
    if (result !== ch.translation) {
      ch.translation = result;
      chaptersAffected++;
    }
  });
  if (!chaptersAffected) { showToast('ไม่มีตอนที่ต้องเพิ่ม', ''); return; }
  await lsSaveWorkspace(S.currentWs);
  showToast(`📐 Add 1 Line ใน ${chaptersAffected} ตอน ✓`, 'success');
}

async function addLineBreaksAllChapters() {
  if (!S.currentWs) return;
  if (!confirm(`เพิ่ม Line Break ใน translation ทุกตอนใน "${S.currentWs.name}"\nไม่สามารถย้อนกลับได้ ดำเนินการ?`)) return;
  let chaptersAffected = 0;
  S.currentWs.chapters.forEach(ch => {
    if (!ch.translation) return;
    const result = addLineBreaks(ch.translation);
    if (result !== ch.translation) {
      ch.translation = result;
      chaptersAffected++;
    }
  });
  if (!chaptersAffected) { showToast('ทุกตอนมี Line Break แล้ว', ''); return; }
  await lsSaveWorkspace(S.currentWs);
  showToast(`📐 เพิ่ม Line Break ใน ${chaptersAffected} ตอน ✓`, 'success');
}

// ─── Prev Chapter Type select toggle ───
document.addEventListener('DOMContentLoaded', () => {
  const chk = document.getElementById('usePrevChapter');
  const sel = document.getElementById('prevChapterType');
  if (chk && sel) {
    chk.addEventListener('change', () => {
      sel.style.display = chk.checked ? '' : 'none';
    });
  }
  // Apply saved theme on load
  themeApplyFromStorage();
});

// ═══════════════════════════════════════════════
// ─── Bulk Rename — Find & Replace in Title Names ───
// ═══════════════════════════════════════════════

function brFrBuildRegex(term, caseSensitive, flags) {
  const p = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const f = (flags || '') + (caseSensitive ? '' : 'i');
  return new RegExp(p, f);
}

function brFrLive() {
  const find = document.getElementById('brFrFind')?.value || '';
  const info = document.getElementById('brFrInfo');
  if (!info) return;
  if (!find) { info.textContent = 'พิมพ์เพื่อค้นหา'; info.style.color = 'var(--text-muted)'; brFrClearHighlights(); return; }
  const cs = document.getElementById('brFrCase')?.checked;
  const regex = brFrBuildRegex(find, cs, 'g');
  let total = 0;
  document.querySelectorAll('.bulk-rename-input').forEach(inp => {
    const hits = (inp.value.match(regex) || []).length;
    total += hits;
    inp.style.background = hits ? 'rgba(201,168,76,0.1)' : '';
    inp.style.borderBottomColor = hits ? 'var(--gold)' : '';
  });
  if (total) { info.textContent = `พบ ${total} รายการใน ${document.querySelectorAll('.bulk-rename-input').length} ตอน`; info.style.color = 'var(--gold)'; }
  else { info.textContent = 'ไม่พบ'; info.style.color = 'var(--crimson-light)'; }
}

function brFrClearHighlights() {
  document.querySelectorAll('.bulk-rename-input').forEach(inp => {
    inp.style.background = '';
    inp.style.borderBottomColor = '';
  });
}

function brFrReplaceAll() {
  const find = document.getElementById('brFrFind')?.value || '';
  const replace = document.getElementById('brFrReplace')?.value || '';
  const info = document.getElementById('brFrInfo');
  if (!find) { info.textContent = 'ใส่คำค้นหาก่อน'; info.style.color = 'var(--crimson-light)'; return; }
  const cs = document.getElementById('brFrCase')?.checked;
  const regex = brFrBuildRegex(find, cs, 'g');
  let total = 0;
  document.querySelectorAll('.bulk-rename-input').forEach(inp => {
    const orig = inp.value;
    const result = orig.replace(regex, replace);
    if (result !== orig) { inp.value = result; total += (orig.match(regex) || []).length; inp.style.background = 'rgba(76,175,80,0.1)'; inp.style.borderBottomColor = '#4caf50'; }
    else { inp.style.background = ''; inp.style.borderBottomColor = ''; }
  });
  if (total) { info.textContent = `แทนที่ ${total} รายการแล้ว ✓`; info.style.color = '#4caf50'; }
  else { info.textContent = 'ไม่พบสิ่งที่ต้องแทนที่'; info.style.color = 'var(--crimson-light)'; }
}

// ═══════════════════════════════════════════════
// ─── Theme Editor ───
// ═══════════════════════════════════════════════

const THEME_KEY = 'nt_theme_v1';

const THEME_DEFAULTS = {
  accent:       '#c9a84c',
  bgVoid:       '#080b0f',
  bgSurface:    '#111520',
  textPrimary:  '#d8dde8',
  textSecondary:'#8090a8',
  crimson:      '#c23048',
  fontBody:     "'Noto Sans Thai','Noto Serif Thai',sans-serif",
  fontSize:     '15',
  radius:       '6',
};

const THEME_PRESETS = {
  'dark-gold': {
    accent:'#c9a84c', bgVoid:'#080b0f', bgSurface:'#111520',
    textPrimary:'#d8dde8', textSecondary:'#8090a8', crimson:'#c23048',
    fontBody:"'Noto Sans Thai','Noto Serif Thai',sans-serif", fontSize:'15', radius:'6',
  },
  'deep-blue': {
    accent:'#4a8fd0', bgVoid:'#060a10', bgSurface:'#0a1525',
    textPrimary:'#ccd8e8', textSecondary:'#6a88a8', crimson:'#c23048',
    fontBody:"'Noto Sans Thai','Noto Serif Thai',sans-serif", fontSize:'15', radius:'6',
  },
  'forest': {
    accent:'#6abf7a', bgVoid:'#070e08', bgSurface:'#0d1810',
    textPrimary:'#cce8cc', textSecondary:'#78a880', crimson:'#c23048',
    fontBody:"'Noto Sans Thai','Noto Serif Thai',sans-serif", fontSize:'15', radius:'8',
  },
  'crimson': {
    accent:'#e05050', bgVoid:'#0a0608', bgSurface:'#180d0d',
    textPrimary:'#e8d0d0', textSecondary:'#a87878', crimson:'#e05050',
    fontBody:"'Noto Sans Thai','Noto Serif Thai',sans-serif", fontSize:'15', radius:'4',
  },
  'light': {
    accent:'#8b6914', bgVoid:'#f5f0e8', bgSurface:'#ffffff',
    textPrimary:'#1a1a2e', textSecondary:'#555577', crimson:'#c0392b',
    fontBody:"'Noto Sans Thai','Noto Serif Thai',sans-serif", fontSize:'15', radius:'8',
  },
};

function openThemeEditor() {
  // Load current values from storage or defaults
  const saved = themeLoad();
  document.getElementById('th-accent').value           = saved.accent;
  document.getElementById('th-accent-hex').value       = saved.accent;
  document.getElementById('th-bg-void').value          = saved.bgVoid;
  document.getElementById('th-bg-void-hex').value      = saved.bgVoid;
  document.getElementById('th-bg-surface').value       = saved.bgSurface;
  document.getElementById('th-bg-surface-hex').value   = saved.bgSurface;
  document.getElementById('th-text-primary').value     = saved.textPrimary;
  document.getElementById('th-text-primary-hex').value = saved.textPrimary;
  document.getElementById('th-text-secondary').value   = saved.textSecondary;
  document.getElementById('th-text-secondary-hex').value = saved.textSecondary;
  document.getElementById('th-crimson').value          = saved.crimson;
  document.getElementById('th-crimson-hex').value      = saved.crimson;
  document.getElementById('th-font-body').value        = saved.fontBody;
  document.getElementById('th-font-size').value        = saved.fontSize;
  document.getElementById('th-font-size-val').textContent = saved.fontSize + 'px';
  document.getElementById('th-radius').value           = saved.radius;
  document.getElementById('th-radius-val').textContent = saved.radius + 'px';
  openModal('modal-theme');
}

function themeLoad() {
  try { return { ...THEME_DEFAULTS, ...JSON.parse(localStorage.getItem(THEME_KEY) || '{}') }; }
  catch { return { ...THEME_DEFAULTS }; }
}

function themeReadInputs() {
  return {
    accent:        document.getElementById('th-accent').value,
    bgVoid:        document.getElementById('th-bg-void').value,
    bgSurface:     document.getElementById('th-bg-surface').value,
    textPrimary:   document.getElementById('th-text-primary').value,
    textSecondary: document.getElementById('th-text-secondary').value,
    crimson:       document.getElementById('th-crimson').value,
    fontBody:      document.getElementById('th-font-body').value,
    fontSize:      document.getElementById('th-font-size').value,
    radius:        document.getElementById('th-radius').value,
  };
}

function themeApply(t) {
  // Derive additional colours from base values
  const root = document.documentElement;
  root.style.setProperty('--accent',           t.accent);
  root.style.setProperty('--gold',             t.accent);
  root.style.setProperty('--gold-light',       lighten(t.accent, 25));
  root.style.setProperty('--gold-dim',         darken(t.accent, 20));
  root.style.setProperty('--accent-glow',      hexToRgba(t.accent, 0.2));
  root.style.setProperty('--bg-void',          t.bgVoid);
  root.style.setProperty('--bg-deep',          lighten(t.bgVoid, 4));
  root.style.setProperty('--bg-surface',       t.bgSurface);
  root.style.setProperty('--bg-panel',         lighten(t.bgSurface, 3));
  root.style.setProperty('--bg-raised',        lighten(t.bgSurface, 8));
  root.style.setProperty('--bg-hover',         lighten(t.bgSurface, 12));
  root.style.setProperty('--text-primary',     t.textPrimary);
  root.style.setProperty('--text-gold',        t.accent);
  root.style.setProperty('--text-secondary',   t.textSecondary);
  root.style.setProperty('--text-muted',       darken(t.textSecondary, 20));
  root.style.setProperty('--crimson-light',    t.crimson);
  root.style.setProperty('--crimson',          darken(t.crimson, 20));
  root.style.setProperty('--font-body',        t.fontBody);
  root.style.setProperty('--radius',           t.radius + 'px');
  root.style.setProperty('--radius-lg',        (parseInt(t.radius) * 2) + 'px');
  document.documentElement.style.fontSize      = t.fontSize + 'px';
}

function themePreview() {
  // sync hex inputs with color pickers
  ['accent','bg-void','bg-surface','text-primary','text-secondary','crimson'].forEach(k => {
    const colorEl = document.getElementById('th-' + k);
    const hexEl   = document.getElementById('th-' + k + '-hex');
    if (colorEl && hexEl) hexEl.value = colorEl.value;
  });
  themeApply(themeReadInputs());
}

function themeHexInput(colorId, hexId) {
  const hexEl = document.getElementById(hexId);
  const val = hexEl.value.trim();
  if (/^#[0-9a-fA-F]{6}$/.test(val)) {
    document.getElementById(colorId).value = val;
    themeApply(themeReadInputs());
  }
}

function themeSave() {
  const t = themeReadInputs();
  localStorage.setItem(THEME_KEY, JSON.stringify(t));
  themeApply(t);
  closeModal('modal-theme');
  showToast('บันทึก Theme แล้ว ✓', 'success');
}

function themeReset() {
  if (!confirm('คืนค่า Theme เป็น default?')) return;
  localStorage.removeItem(THEME_KEY);
  themeApply(THEME_DEFAULTS);
  closeModal('modal-theme');
  showToast('คืนค่า Theme แล้ว ✓', 'success');
}

function themeApplyPreset(name) {
  const p = THEME_PRESETS[name];
  if (!p) return;
  // fill inputs
  document.getElementById('th-accent').value             = p.accent;
  document.getElementById('th-accent-hex').value         = p.accent;
  document.getElementById('th-bg-void').value            = p.bgVoid;
  document.getElementById('th-bg-void-hex').value        = p.bgVoid;
  document.getElementById('th-bg-surface').value         = p.bgSurface;
  document.getElementById('th-bg-surface-hex').value     = p.bgSurface;
  document.getElementById('th-text-primary').value       = p.textPrimary;
  document.getElementById('th-text-primary-hex').value   = p.textPrimary;
  document.getElementById('th-text-secondary').value     = p.textSecondary;
  document.getElementById('th-text-secondary-hex').value = p.textSecondary;
  document.getElementById('th-crimson').value            = p.crimson;
  document.getElementById('th-crimson-hex').value        = p.crimson;
  document.getElementById('th-font-body').value          = p.fontBody;
  document.getElementById('th-font-size').value          = p.fontSize;
  document.getElementById('th-font-size-val').textContent = p.fontSize + 'px';
  document.getElementById('th-radius').value             = p.radius;
  document.getElementById('th-radius-val').textContent   = p.radius + 'px';
  themeApply(p);
}

function themeApplyFromStorage() {
  const saved = themeLoad();
  // Only apply if user has saved custom theme
  if (localStorage.getItem(THEME_KEY)) themeApply(saved);
}

// ─── Colour helpers ───
function hexToRgba(hex, alpha) {
  const r = parseInt(hex.slice(1,3),16), g = parseInt(hex.slice(3,5),16), b = parseInt(hex.slice(5,7),16);
  return `rgba(${r},${g},${b},${alpha})`;
}
function lighten(hex, pct) {
  let r = parseInt(hex.slice(1,3),16), g = parseInt(hex.slice(3,5),16), b = parseInt(hex.slice(5,7),16);
  r = Math.min(255, r + Math.round(pct * 2.55));
  g = Math.min(255, g + Math.round(pct * 2.55));
  b = Math.min(255, b + Math.round(pct * 2.55));
  return '#' + [r,g,b].map(v => v.toString(16).padStart(2,'0')).join('');
}
function darken(hex, pct) {
  let r = parseInt(hex.slice(1,3),16), g = parseInt(hex.slice(3,5),16), b = parseInt(hex.slice(5,7),16);
  r = Math.max(0, r - Math.round(pct * 2.55));
  g = Math.max(0, g - Math.round(pct * 2.55));
  b = Math.max(0, b - Math.round(pct * 2.55));
  return '#' + [r,g,b].map(v => v.toString(16).padStart(2,'0')).join('');
}


// ═══════════════════════════════════════════════
// ─── Glossary Export ───
// ═══════════════════════════════════════════════

function _getGlossaryExportData() {
  const scopeAll = document.querySelector('input[name="gexScope"][value="all"]')?.checked ?? true;
  const typeFilter = document.getElementById('gexTypeFilter')?.value || '';
  let data = [...(S.glossaryData || [])];
  if (!scopeAll && typeFilter) data = data.filter(g => g.type === typeFilter);
  else if (!scopeAll) data = [...(S.glossaryData || [])]; // "filtered" แต่ไม่ได้เลือก type = ทั้งหมด
  return data;
}

function _getGlossaryExportCols() {
  return {
    korean: document.getElementById('gexColKorean')?.checked ?? true,
    thai:   document.getElementById('gexColThai')?.checked ?? true,
    type:   document.getElementById('gexColType')?.checked ?? true,
    note:   document.getElementById('gexColNote')?.checked ?? true,
    source: document.getElementById('gexColSource')?.checked ?? false,
  };
}

function openGlossaryExport() {
  if (!S.glossaryData?.length) { showToast('คลังศัพท์ว่างเปล่า', 'error'); return; }
  // sync type filter from main glossary filter
  const mainFilter = document.getElementById('glossaryTypeFilter')?.value || '';
  const scopeRadio = document.querySelector('input[name="gexScope"][value="filtered"]');
  const gexType = document.getElementById('gexTypeFilter');
  if (mainFilter && gexType) {
    gexType.value = mainFilter;
    if (scopeRadio) scopeRadio.checked = true;
  } else {
    document.querySelector('input[name="gexScope"][value="all"]').checked = true;
  }
  glossaryExportPreview();
  openModal('modal-glossary-export');
}

function getSmartGlossary(content, glossaryArray) {
  if (!glossaryArray || glossaryArray.length === 0) return [];

  // 1. แยกคำที่เป็น "Global" (เช่น ชื่อพระเอก) ให้ติดไปทุกตอน
  const globalTerms = glossaryArray.filter(g => g.note && g.note.toLowerCase().includes('global'));
  const normalTerms = glossaryArray.filter(g => !g.note || !g.note.toLowerCase().includes('global'));

  // 2. สร้างลิสต์คำเกาหลีเพื่อทำ Regex (เรียงจากยาวไปสั้น)
  const sortedKeys = normalTerms
    .map(g => (g.korean || '').trim())
    .filter(k => k.length > 0)
    .sort((a, b) => b.length - a.length);

  if (sortedKeys.length === 0) return globalTerms;

  // 3. สร้าง Pattern ค้นหา
  const pattern = new RegExp(sortedKeys.map(k => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'g');

  // 4. สแกนหาคำที่ Match ในเนื้อหา
  const matches = new Set(content.match(pattern) || []);
  const matchedGlossary = normalTerms.filter(g => matches.has((g.korean || '').trim()));

  // 5. รวมผลลัพธ์และลบตัวซ้ำ
  const final = [...globalTerms, ...matchedGlossary];
  return Array.from(new Map(final.map(item => [item.korean, item])).values());
}

function glossaryExportPreview() {
  const data = _getGlossaryExportData();
  const cols = _getGlossaryExportCols();
  const info = document.getElementById('glossaryExportInfo');
  const box  = document.getElementById('glossaryExportPreviewBox');
  if (info) info.textContent = `${data.length} รายการที่จะ export`;

  // Preview: CSV format เสมอ (ดูง่ายสุด)
  const header = [];
  if (cols.korean) header.push('Korean');
  if (cols.thai)   header.push('Thai');
  if (cols.type)   header.push('Type');
  if (cols.note)   header.push('Note');
  if (cols.source) header.push('Source');

  const preview = data.slice(0, 5).map(g => {
    const row = [];
    if (cols.korean) row.push(g.korean || '');
    if (cols.thai)   row.push(g.thai || '');
    if (cols.type)   row.push(g.type || '');
    if (cols.note)   row.push(g.note || '');
    if (cols.source) row.push(g.sourceChapterTitle ? `#${g.sourceChapterNum||'?'} ${g.sourceChapterTitle}` : '');
    return row.map(v => v.includes(',') || v.includes('"') ? `"${v.replace(/"/g,'""')}"` : v).join(',');
  });

  if (box) box.textContent = [header.join(','), ...preview].join('\n') + (data.length > 5 ? `\n...และอีก ${data.length - 5} แถว` : '');
}

function doExportGlossary(format) {
  const data = _getGlossaryExportData();
  if (!data.length) { showToast('ไม่มีข้อมูล', 'error'); return; }
  const cols = _getGlossaryExportCols();
  const wsName = S.currentWs?.name || 'glossary';
  const filename = `${wsName}_glossary`;

  if (format === 'json') {
    // JSON — export ทุก field เสมอ (ไม่กรอง col เพราะ JSON ต้องการ structure ครบ)
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json;charset=utf-8' });
    downloadBlob(blob, `${filename}.json`);
    showToast('Export JSON สำเร็จ ✓', 'success');
    return;
  }

  // สร้าง row array ตาม cols ที่เลือก
  const header = [];
  if (cols.korean) header.push('Korean');
  if (cols.thai)   header.push('Thai');
  if (cols.type)   header.push('Type');
  if (cols.note)   header.push('Note');
  if (cols.source) header.push('Source');

  const rows = data.map(g => {
    const row = [];
    if (cols.korean) row.push(g.korean || '');
    if (cols.thai)   row.push(g.thai || '');
    if (cols.type)   row.push(g.type || '');
    if (cols.note)   row.push(g.note || '');
    if (cols.source) row.push(g.sourceChapterTitle ? `#${g.sourceChapterNum||'?'} ${g.sourceChapterTitle}` : '');
    return row;
  });

  if (format === 'csv') {
    const csvEsc = v => (v.includes(',') || v.includes('"') || v.includes('\n'))
      ? `"${v.replace(/"/g, '""')}"` : v;
    const lines = [header, ...rows].map(r => r.map(csvEsc).join(','));
    const blob = new Blob(['\uFEFF' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
    downloadBlob(blob, `${filename}.csv`);
    showToast('Export CSV สำเร็จ ✓', 'success');
    return;
  }

  if (format === 'txt') {
    // Tab-separated, readable
    const lines = [header.join('\t'), ...rows.map(r => r.join('\t'))];
    const blob = new Blob([lines.join('\n')], { type: 'text/plain;charset=utf-8' });
    downloadBlob(blob, `${filename}.txt`);
    showToast('Export TXT สำเร็จ ✓', 'success');
    return;
  }

  if (format === 'md') {
    // Markdown table
    const sep = header.map(() => '---');
    const mdRows = rows.map(r => '| ' + r.map(v => v.replace(/\|/g, '\\|')).join(' | ') + ' |');
    const md = [
      `# Glossary — ${wsName}`,
      '',
      '| ' + header.join(' | ') + ' |',
      '| ' + sep.join(' | ') + ' |',
      ...mdRows,
    ].join('\n');
    const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
    downloadBlob(blob, `${filename}.md`);
    showToast('Export MD สำเร็จ ✓', 'success');
    return;
  }

  if (format === 'xlsx') {
    // XLSX แบบ pure XML (SpreadsheetML) — ไม่ต้องใช้ library
    const xmlEsc = s => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
    const allRows = [header, ...rows];
    const sheetRows = allRows.map(r =>
      '<Row>' + r.map(v => `<Cell><Data ss:Type="String">${xmlEsc(v)}</Data></Cell>`).join('') + '</Row>'
    ).join('\n');

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
  xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
  <Styles>
    <Style ss:ID="header">
      <Font ss:Bold="1"/>
      <Interior ss:Color="#1a1f35" ss:Pattern="Solid"/>
      <Font ss:Color="#c9a84c" ss:Bold="1"/>
    </Style>
  </Styles>
  <Worksheet ss:Name="Glossary">
    <Table>
${sheetRows}
    </Table>
  </Worksheet>
</Workbook>`;
    const blob = new Blob([xml], { type: 'application/vnd.ms-excel;charset=utf-8' });
    downloadBlob(blob, `${filename}.xls`);
    showToast('Export XLSX สำเร็จ ✓ (เปิดด้วย Excel/Sheets ได้)', 'success');
    return;
  }
}
// ─── Shared Translation Core ───
// แปล 1 ตอนแบบ headless (glossary → prompt → stream → polish → save → auto-glossary → ctx summary)
// ใช้ร่วมกันระหว่าง Marathon และ Reader prefetch
// awaitGlossary: true → รอ auto-glossary + context summary เสร็จก่อน resolve
//   (จำเป็นสำหรับ prefetch แบบเรียงตอน — ตอน N+1 ต้องเห็นศัพท์/บริบทจากตอน N)
async function translateChapterCore(ch, {
  presetId = S.currentWs?.presetId ?? 'literary',
  model = null,
  signal = null,
  onDelta = null,
  awaitGlossary = false,
} = {}) {
  const ws = S.currentWs;
  const presetBase = (ws.presets || []).find(p => p.id === presetId) || getActivePreset(ws);
  const systemPrompt = presetBase.systemPrompt;
  const temperature  = presetBase.temperature;
  const useModel = model || ws.settings?.translateModel || document.getElementById('translateModel')?.value || 'google/gemini-2.5-flash';

  const smartGloss  = getSmartGlossary(ch.sourceText, S.glossaryData);
  const glossObj    = smartGloss.reduce(function(a, g) { a[g.korean] = { thai: g.thai, type: g.type, note: g.note, gender: g.gender }; return a; }, {});
  const glossaryStr = buildGlossaryStr(glossObj);
  const mtlDraft    = presetIsMtlFix(presetBase) ? (ch.translation || '') : '';

  const prompt = systemPrompt
    .replace('{style_note}', '')
    .replace('{glossary}',   glossaryStr || '(ไม่มี)')
    .replace('{context}',    ctxGetPromptText(ws) || '')
    .replace('{text}',       prepareSourceForTranslation(ch.sourceText))
    .replace('{mtl_draft}',  mtlDraft || '(ไม่มี MTL draft)');

  // timeout ภายใน + เคารพ signal จาก caller (เดิม path Marathon ไม่มี timeout เลย — slot ค้างได้)
  const _ctrl = new AbortController();
  const _onAbort = () => _ctrl.abort();
  if (signal) {
    if (signal.aborted) _ctrl.abort();
    else signal.addEventListener('abort', _onAbort, { once: true });
  }
  const _timer = setTimeout(() => _ctrl.abort(), getTimeoutMs('full'));

  let inTok = 0, outTok = 0;
  let fullText = '';
  try {
    fullText = await aiStream(
      { model: useModel, temperature: temperature, max_tokens: Math.max(16000, Math.ceil(ch.sourceText.length * 4)), messages: [{ role: 'user', content: prompt }] },
      onDelta || function() {},
      function(i, o) { inTok = i; outTok = o; },
      _ctrl.signal
    );
  } finally {
    clearTimeout(_timer);
    if (signal) signal.removeEventListener('abort', _onAbort);
    if (inTok || outTok) addCosts(inTok, outTok, useModel);
  }

  if (!fullText || !fullText.trim()) throw new Error('AI ส่งผลลัพธ์ว่าง');

  if (presetBase.polish) {
    try {
      const pr = await callOpenRouter({
        model: useModel,
        messages: [{ role: 'user', content: POLISH_PROMPT.replace('{glossary}', glossaryStr).replace('{text}', fullText) }],
        temperature: 0.5,
        max_tokens: Math.max(3000, Math.ceil(fullText.length * 1.2)),
      });
      fullText = pr.choices?.[0]?.message?.content?.trim() || fullText;
    } catch (e) { /* polish failed, use unpolished */ }
  }

  ch.translation = fullText;
  ch.status      = 'translated';
  ch.wordCount   = fullText.length;
  ch.updatedAt   = Date.now();
  await lsSaveWorkspace(ws);

  // auto-glossary จับ error ภายในตัวเองอยู่แล้ว / ctx summary อาจ throw → catch เสมอ
  const glossP = autoExtractGlossaryAfterTranslation(ch.sourceText, useModel, { id: ch.id, title: ch.title, chapterNum: ch.chapterNum }, fullText);
  const ctxP   = ctxAddSummary(ws, ch.id, ch.chapterNum, ch.title, fullText);
  if (awaitGlossary) {
    await glossP;
    await ctxP.catch(e => console.warn('[CTX]', e));
  } else {
    ctxP.catch(e => console.warn('[CTX]', e));
  }
  return fullText;
}

// ─── Translation Presets (ของผู้ใช้ทั้งหมด — CRUD) ───
const PRESET_PROMPT_TEMPLATE = `You are a professional Korean → Thai webnovel translator.

RULES:
• Translate completely and accurately — no additions, no omissions
• Write natural, fluent Thai
• Follow all glossary terms exactly
• Maintain paragraph structure
• Thai pronouns: Male→เขา/ผม | Female→เธอ/ฉัน
{style_note}
GLOSSARY:
{glossary}

{context}
Translate this Korean text into Thai. Output ONLY the Thai translation:

{text}`;

// เติม dropdown เลือก preset ที่ใช้งาน (ในหน้า Settings)
function renderPresetSelect() {
  const sel = document.getElementById('wsPresetSelect');
  if (!sel) return;
  const presets = S.currentWs?.presets || [];
  sel.innerHTML = presets.map(p => `<option value="${p.id}">${p.emoji || '📖'} ${esc(p.name)}</option>`).join('')
    || '<option value="">— ยังไม่มี Preset —</option>';
  sel.value = S.currentWs?.presetId || presets[0]?.id || '';
}

// เติม dropdown ในตัวแก้ไข preset
function pePopulateSelect(selectId) {
  const sel = document.getElementById('pe-preset-select');
  if (!sel) return;
  const presets = S.currentWs?.presets || [];
  sel.innerHTML = presets.map(p => `<option value="${p.id}">${p.emoji || '📖'} ${esc(p.name)}</option>`).join('')
    + '<option value="__new__">＋ สร้าง Preset ใหม่…</option>';
  sel.value = selectId || presets[0]?.id || '__new__';
}

function openPresetEditor() {
  if (!S.currentWs) return;
  pePopulateSelect(S.currentWs.presetId);
  loadPresetForEdit();
  openModal('modal-preset-editor');
}

function loadPresetForEdit() {
  const id = document.getElementById('pe-preset-select')?.value;
  const nameEl   = document.getElementById('pe-name');
  const emojiEl  = document.getElementById('pe-emoji');
  const promptEl = document.getElementById('pe-prompt-text');
  const tempEl   = document.getElementById('pe-temperature');
  const tempVal  = document.getElementById('pe-temp-val');
  const polishEl = document.getElementById('pe-polish');
  const delBtn   = document.getElementById('pe-delete-btn');
  const isNew = (id === '__new__' || !id);
  const preset = isNew ? null : (S.currentWs?.presets || []).find(p => p.id === id);
  if (nameEl)   nameEl.value   = preset?.name || '';
  if (emojiEl)  emojiEl.value  = preset?.emoji || '📖';
  if (promptEl) promptEl.value = preset?.systemPrompt || PRESET_PROMPT_TEMPLATE;
  const temp = (preset?.temperature !== undefined) ? preset.temperature : 0.6;
  if (tempEl)  tempEl.value = temp;
  if (tempVal) tempVal.textContent = temp;
  if (polishEl) polishEl.checked = !!preset?.polish;
  if (delBtn)  delBtn.style.display = isNew ? 'none' : 'inline-flex';
}

async function savePreset() {
  if (!S.currentWs) return;
  const id          = document.getElementById('pe-preset-select')?.value;
  const name        = document.getElementById('pe-name')?.value?.trim();
  const emoji       = document.getElementById('pe-emoji')?.value?.trim() || '📖';
  const promptText  = document.getElementById('pe-prompt-text')?.value?.trim();
  const temperature = parseFloat(document.getElementById('pe-temperature')?.value || '0.6');
  const polish      = !!document.getElementById('pe-polish')?.checked;
  if (!name)       { showToast('ใส่ชื่อ Preset ก่อน', 'error'); return; }
  if (!promptText) { showToast('ใส่ System Prompt ก่อน', 'error'); return; }
  if (!promptText.includes('{text}')) { showToast('Prompt ต้องมี {text} (จุดแทรกต้นฉบับ)', 'error'); return; }

  if (!Array.isArray(S.currentWs.presets)) S.currentWs.presets = [];
  const isNew = (id === '__new__' || !id);
  if (isNew) {
    const newId = genId();
    S.currentWs.presets.push({ id: newId, name, emoji, systemPrompt: promptText, temperature, polish });
    S.currentWs.presetId = newId;
  } else {
    const idx = S.currentWs.presets.findIndex(p => p.id === id);
    const obj = { id, name, emoji, systemPrompt: promptText, temperature, polish };
    if (idx >= 0) S.currentWs.presets[idx] = obj; else S.currentWs.presets.push(obj);
  }
  await lsSaveWorkspace(S.currentWs);
  pePopulateSelect(isNew ? S.currentWs.presetId : id);
  loadPresetForEdit();
  renderPresetSelect();
  showToast('บันทึก Preset แล้ว ✓', 'success');
}

async function deletePreset() {
  if (!S.currentWs) return;
  const id = document.getElementById('pe-preset-select')?.value;
  if (!id || id === '__new__') return;
  const presets = S.currentWs.presets || [];
  if (presets.length <= 1) { showToast('ต้องมี Preset อย่างน้อย 1 อัน', 'error'); return; }
  if (!confirm('ลบ Preset นี้?')) return;
  S.currentWs.presets = presets.filter(p => p.id !== id);
  if (S.currentWs.presetId === id) S.currentWs.presetId = S.currentWs.presets[0]?.id || '';
  await lsSaveWorkspace(S.currentWs);
  pePopulateSelect(S.currentWs.presetId);
  loadPresetForEdit();
  renderPresetSelect();
  showToast('ลบ Preset แล้ว', '');
}

// ═══════════════════════════════════════════════
// ─── Reader Mode ────────────────────────────────
// ═══════════════════════════════════════════════
// อ่านเต็มจอ + จำตำแหน่ง/ตั้งค่าต่อ workspace — ธีม reader แยกจากธีมแอพ

const READER_DEFAULTS = { fontSize: 19, lineHeight: 1.9, theme: 'sepia', prefetchCount: 1 };

const rState = {
  active: false,
  chapterId: null,
  _scrollTimer: null,
  _pushedHistory: false,
  _navIdx: 0,
  _navTotal: 0,
  prefetch: { state: 'IDLE', ctrl: null, chapterId: null, retries: 0 },
};

function readerGetSettings() {
  return { ...READER_DEFAULTS, ...(S.currentWs?.readerSettings || {}) };
}

function openReader(chId) {
  const ch = S.currentWs?.chapters?.find(c => c.id === chId);
  if (!ch) { showToast('ไม่พบตอน', 'error'); return; }
  rState.active = true;
  rState.chapterId = chId;
  document.getElementById('readerOverlay').style.display = 'flex';
  readerApplySettings();
  readerRenderChapter(ch);
  // คืนตำแหน่ง scroll เฉพาะตอนที่บันทึกไว้ล่าสุด
  const pos = S.currentWs.readerPosition;
  const scroller = document.getElementById('readerScroll');
  requestAnimationFrame(() => {
    const denom = scroller.scrollHeight - scroller.clientHeight;
    scroller.scrollTop = (pos && pos.chapterId === chId && pos.scrollPct && denom > 0)
      ? pos.scrollPct * denom : 0;
    readerUpdateProgress();
  });
  if (!rState._pushedHistory) {
    try { history.pushState({ ntReader: true }, ''); rState._pushedHistory = true; } catch {}
  }
  readerSavePosition(true);
  readerKickPrefetch();
}

function openReaderResume() {
  const ws = S.currentWs;
  if (!ws) { showToast('เลือก Workspace ก่อน', 'error'); return; }
  const pos = ws.readerPosition;
  let ch = pos ? ws.chapters?.find(c => c.id === pos.chapterId) : null;
  if (!ch) ch = _getSortedChapters()[0];
  if (!ch) { showToast('ยังไม่มีตอนใน Workspace นี้', 'error'); return; }
  openReader(ch.id);
}

function openReaderFromModal() {
  const id = S.editingChapterId;
  closeModal('modal-view-chapter');
  if (id) openReader(id);
}

function closeReader(fromPopstate = false) {
  if (!rState.active) return;
  readerSavePosition(true);
  readerCancelPrefetch();
  rState.active = false;
  document.getElementById('readerOverlay').style.display = 'none';
  if (rState._pushedHistory && !fromPopstate) { try { history.back(); } catch {} }
  rState._pushedHistory = false;
  if (S.currentTab === 'chapters') renderChapters();
}

function readerRenderChapter(ch) {
  rState.chapterId = ch.id;
  document.getElementById('readerChTitle').textContent = `#${ch.chapterNum || '?'} ${ch.title || ''}`;
  const el = document.getElementById('readerContent');
  if (ch.translation?.trim()) {
    el.innerHTML = `<h2 class="reader-h2">${esc(ch.title || '')}</h2>` +
      ch.translation.split(/\n+/).map(p => p.trim()).filter(Boolean)
        .map(p => `<p>${esc(p)}</p>`).join('');
  } else {
    el.innerHTML = `<div class="reader-empty">
      <div style="font-size:2rem">📖</div>
      <div>ตอนนี้ยังไม่ได้แปล</div>
      ${ch.sourceText?.trim()
        ? `<button class="reader-nav-btn" style="font-size:0.9rem" onclick="readerTranslateCurrent()">⚡ แปลตอนนี้</button>`
        : `<div style="font-size:0.8rem">ไม่มีต้นฉบับ — เพิ่มต้นฉบับในแท็บ "ตอน" ก่อน</div>`}
    </div>`;
  }
  readerUpdateNav();
}

function readerUpdateNav() {
  const sorted = _getSortedChapters();
  const idx = sorted.findIndex(c => c.id === rState.chapterId);
  rState._navIdx = idx;
  rState._navTotal = sorted.length;
  const prev = document.getElementById('readerPrevBtn');
  const next = document.getElementById('readerNextBtn');
  if (prev) prev.disabled = idx <= 0;
  if (next) next.disabled = idx >= sorted.length - 1;
  readerUpdateProgress();
}

function readerUpdateProgress() {
  const scroller = document.getElementById('readerScroll');
  const label = document.getElementById('readerProgressLabel');
  if (!scroller || !label) return;
  const denom = scroller.scrollHeight - scroller.clientHeight;
  const pct = denom > 0 ? Math.min(100, Math.round(scroller.scrollTop / denom * 100)) : 100;
  label.textContent = rState._navTotal
    ? `ตอน ${rState._navIdx + 1}/${rState._navTotal} · ${pct}%` : '';
}

function readerNav(dir) {
  const sorted = _getSortedChapters();
  const idx = sorted.findIndex(c => c.id === rState.chapterId);
  const next = sorted[idx + dir];
  if (!next) return;
  readerRenderChapter(next);
  document.getElementById('readerScroll').scrollTop = 0;
  readerSavePosition(true);
  readerKickPrefetch();
}

// debounce 2s ระหว่าง scroll / ทันทีเมื่อ immediate (ปิด reader, เปลี่ยนตอน)
function readerSavePosition(immediate = false) {
  if (!S.currentWs || !rState.chapterId) return;
  const scroller = document.getElementById('readerScroll');
  const denom = scroller.scrollHeight - scroller.clientHeight;
  S.currentWs.readerPosition = {
    chapterId: rState.chapterId,
    scrollPct: denom > 0 ? Math.min(1, scroller.scrollTop / denom) : 0,
    updatedAt: Date.now(),
  };
  clearTimeout(rState._scrollTimer);
  if (immediate) lsSaveWorkspace(S.currentWs).catch(() => {});
  else rState._scrollTimer = setTimeout(() => lsSaveWorkspace(S.currentWs).catch(() => {}), 2000);
}

// ── Reader settings ──
function readerToggleSettings() {
  const bar = document.getElementById('readerSettingsBar');
  bar.style.display = bar.style.display === 'none' ? 'flex' : 'none';
}

function readerSaveSettings(patch) {
  if (!S.currentWs) return;
  S.currentWs.readerSettings = { ...readerGetSettings(), ...patch };
  readerApplySettings();
  lsSaveWorkspace(S.currentWs).catch(() => {});
}

function readerSetFontSize(delta) {
  const cur = readerGetSettings().fontSize;
  readerSaveSettings({ fontSize: Math.min(28, Math.max(16, cur + delta)) });
}
function readerSetLineHeight(v) { readerSaveSettings({ lineHeight: parseFloat(v) || READER_DEFAULTS.lineHeight }); }
function readerSetTheme(t) { readerSaveSettings({ theme: ['light','sepia','dark'].includes(t) ? t : 'sepia' }); }
function readerSetPrefetchCount(v) {
  readerSaveSettings({ prefetchCount: Math.min(2, Math.max(0, parseInt(v) || 0)) });
  readerKickPrefetch();
}

function readerApplySettings() {
  const s = readerGetSettings();
  const ov = document.getElementById('readerOverlay');
  ov.classList.remove('reader-theme-light', 'reader-theme-sepia', 'reader-theme-dark');
  ov.classList.add('reader-theme-' + s.theme);
  const content = document.getElementById('readerContent');
  content.style.fontSize = s.fontSize + 'px';
  content.style.lineHeight = s.lineHeight;
  document.getElementById('readerFontSizeVal').textContent = s.fontSize;
  document.getElementById('readerLineHeight').value = String(s.lineHeight);
  document.getElementById('readerPrefetchCount').value = String(s.prefetchCount);
  document.querySelectorAll('.reader-theme-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.theme === s.theme));
}

// ── Reader Prefetch ──
// แปลตอนถัดไปล่วงหน้า "ทีละตอนเรียงลำดับ" เสมอ — auto-glossary + context summary
// ของตอน N ต้องเสร็จก่อนเริ่มตอน N+1 (awaitGlossary:true) ไม่งั้นความต่อเนื่องพัง
// กติการ่วม: ระบบแปลทำงานพร้อมกันได้ทีละราย (manual/batch/marathon/prefetch) — prefetch ยอมถอยเสมอ

function readerSetChip(text) {
  const chip = document.getElementById('readerPrefetchChip');
  if (!chip) return;
  chip.textContent = text;
  chip.style.display = text ? '' : 'none';
}

function readerPickPrefetchTarget() {
  const count = readerGetSettings().prefetchCount;
  if (!count) return null;
  const sorted = _getSortedChapters();
  const idx = sorted.findIndex(c => c.id === rState.chapterId);
  if (idx < 0) return null;
  for (let i = idx + 1; i <= idx + count && i < sorted.length; i++) {
    const ch = sorted[i];
    if (ch.status === 'translated') continue;
    if (!ch.sourceText?.trim()) continue;
    return ch;
  }
  return null;
}

function readerKickPrefetch() {
  if (!rState.active) return;
  if (rState.prefetch.state !== 'IDLE') return; // worker เดียวเสมอ
  readerPrefetchWorker();
}

async function readerPrefetchWorker() {
  const pf = rState.prefetch;
  pf.state = 'SCANNING';
  pf.retries = 0;
  try {
    while (rState.active) {
      if (S.translating) break;       // งานแปลอื่นมาก่อน — prefetch ถอย
      if (!getApiKey()) break;
      const ch = readerPickPrefetchTarget();
      if (!ch) break;
      pf.chapterId = ch.id;
      pf.ctrl = new AbortController();
      pf.state = 'TRANSLATING';
      let chars = 0;
      readerSetChip(`⚡ กำลังแปลตอนถัดไป #${ch.chapterNum || '?'}…`);
      try {
        await translateChapterCore(ch, {
          signal: pf.ctrl.signal,
          awaitGlossary: true,
          onDelta: d => {
            chars += d.length;
            readerSetChip(`⚡ กำลังแปลตอนถัดไป #${ch.chapterNum || '?'}… ${chars.toLocaleString()} ตัว`);
          },
        });
        pf.retries = 0;
        readerSetChip(`✓ #${ch.chapterNum || '?'} พร้อมอ่าน · รวม ${fmtUSD(S.costs.costUSD)}`);
        readerUpdateNav();
        if (S.currentTab === 'chapters') renderChapters();
      } catch (err) {
        if (err.name === 'AbortError' || !rState.active) { readerSetChip(''); break; }
        pf.retries++;
        if (pf.retries > 2) {
          readerSetChip(`✗ แปลล่วงหน้าไม่สำเร็จ: ${err.message}`);
          break;
        }
        readerSetChip(`↻ แปล #${ch.chapterNum || '?'} ไม่สำเร็จ — ลองใหม่ (${pf.retries}/2)…`);
        await new Promise(r => setTimeout(r, 2500 * pf.retries));
      } finally {
        pf.ctrl = null;
        pf.chapterId = null;
      }
      pf.state = 'SCANNING';
    }
  } finally {
    pf.state = 'IDLE';
    pf.ctrl = null;
    pf.chapterId = null;
  }
}

// ยกเลิก: แค่ abort — worker จะจัดการ state ของตัวเองใน finally (กัน worker ซ้อน)
function readerCancelPrefetch() {
  if (rState.prefetch.ctrl) { try { rState.prefetch.ctrl.abort(); } catch {} }
  readerSetChip('');
}

// แปลตอนที่กำลังเปิดอ่าน — stream สดให้อ่านไประหว่างแปล
async function readerTranslateCurrent() {
  const ch = S.currentWs?.chapters?.find(c => c.id === rState.chapterId);
  if (!ch || !ch.sourceText?.trim()) return;
  if (!getApiKey()) { showToast('ยังไม่ได้ตั้ง API Key — ไปที่ ⚙ ตั้งค่า', 'error'); return; }
  if (S.translating) { showToast('มีงานแปลอื่นทำงานอยู่ — รอสักครู่แล้วลองใหม่', 'error'); return; }
  if (rState.prefetch.state === 'TRANSLATING') readerCancelPrefetch();

  const el = document.getElementById('readerContent');
  el.innerHTML = `<h2 class="reader-h2">${esc(ch.title || '')}</h2>
    <div style="text-align:center;margin-bottom:1.2em">
      <button class="reader-nav-btn" onclick="readerCancelCurrentTranslate()">⬛ หยุดแปล</button>
    </div>
    <div id="readerLiveText" style="white-space:pre-wrap"></div>`;
  const live = document.getElementById('readerLiveText');
  const scroller = document.getElementById('readerScroll');

  rState.prefetch.state = 'TRANSLATING';
  rState.prefetch.chapterId = ch.id;
  rState.prefetch.ctrl = new AbortController();
  try {
    await translateChapterCore(ch, {
      signal: rState.prefetch.ctrl.signal,
      awaitGlossary: true,
      onDelta: d => {
        if (!live.isConnected) return;
        // ตามท้ายข้อความเฉพาะตอนผู้อ่านอยู่ใกล้ก้นจอ (ไม่แย่ง scroll)
        const nearBottom = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 160;
        live.textContent += d;
        if (nearBottom) scroller.scrollTop = scroller.scrollHeight;
      },
    });
    readerRenderChapter(ch);
    if (S.currentTab === 'chapters') renderChapters();
  } catch (err) {
    if (err.name !== 'AbortError') showToast(`แปลไม่สำเร็จ: ${err.message}`, 'error');
    readerRenderChapter(ch);
  } finally {
    rState.prefetch.state = 'IDLE';
    rState.prefetch.ctrl = null;
    rState.prefetch.chapterId = null;
  }
  readerKickPrefetch();
}

function readerCancelCurrentTranslate() {
  if (rState.prefetch.ctrl) { try { rState.prefetch.ctrl.abort(); } catch {} }
}

// ── init listeners ──
(function readerInit() {
  const scroller = document.getElementById('readerScroll');
  if (scroller) scroller.addEventListener('scroll', () => {
    if (rState.active) { readerSavePosition(); readerUpdateProgress(); }
  });
  document.addEventListener('keydown', e => {
    if (!rState.active) return;
    const tag = e.target?.tagName;
    if (e.key === 'Escape') closeReader();
    else if (tag !== 'SELECT' && tag !== 'INPUT' && tag !== 'TEXTAREA') {
      if (e.key === 'ArrowRight') readerNav(1);
      else if (e.key === 'ArrowLeft') readerNav(-1);
    }
  });
  window.addEventListener('popstate', () => { if (rState.active) closeReader(true); });
})();

// ═══════════════════════════════════════════════
// ─── Pronoun / Gender Consistency Check ─────────
// ═══════════════════════════════════════════════
// สแกน local ล้วนๆ (ไม่เรียก AI ไม่มีค่าใช้จ่าย): นับสรรพนามบุรุษที่ 3
// ในหน้าต่าง ±120 ตัวอักษรรอบชื่อตัวละคร แล้วเทียบกับเพศใน Glossary

const _PRONOUN_MALE   = ['เขา'];
const _PRONOUN_FEMALE = ['เธอ', 'นาง', 'หล่อน'];

function pronounScanChapter(ch, characters) {
  const text = ch.translation || '';
  if (!text.trim()) return [];
  const issues = [];
  for (const g of characters) {
    const name = g.thai;
    // หาตำแหน่งชื่อทั้งหมด (จำกัด 200 จุดกันตอนยาวผิดปกติ)
    const pos = [];
    let idx = text.indexOf(name);
    while (idx !== -1 && pos.length < 200) { pos.push(idx); idx = text.indexOf(name, idx + name.length); }
    if (!pos.length) continue;

    let male = 0, female = 0;
    for (const p of pos) {
      const win = text.slice(Math.max(0, p - 120), p + name.length + 120);
      for (const w of _PRONOUN_MALE)   male   += win.split(w).length - 1;
      for (const w of _PRONOUN_FEMALE) female += win.split(w).length - 1;
    }
    const expectMale = g.gender === 'male';
    const wrong = expectMale ? female : male;
    const right = expectMale ? male : female;
    const total = wrong + right;
    // threshold: มีสรรพนามรวม ≥3 และฝั่งผิดเกิน 40% — กัน false positive จากบทสนทนา
    if (total >= 3 && wrong / total > 0.4) {
      const samples = [];
      const wrongWords = expectMale ? _PRONOUN_FEMALE : _PRONOUN_MALE;
      for (const p of pos) {
        if (samples.length >= 2) break;
        const win = text.slice(Math.max(0, p - 120), p + name.length + 120);
        if (wrongWords.some(w => win.includes(w))) samples.push('…' + win.trim().slice(0, 160) + '…');
      }
      issues.push({ name, gender: g.gender, wrong, right, samples });
    }
  }
  return issues;
}

function openPronounCheck() {
  if (!S.currentWs) { showToast('เลือก Workspace ก่อน', 'error'); return; }
  const characters = (S.currentWs.glossary || []).filter(g =>
    g.type === 'character' && (g.gender === 'male' || g.gender === 'female') && g.thai);
  const box = document.getElementById('pronounCheckResults');

  if (!characters.length) {
    box.innerHTML = '<div style="color:var(--text-muted);font-size:0.8rem;padding:14px;text-align:center">ไม่มีตัวละครที่ระบุเพศใน Glossary — เพิ่มคำศัพท์ประเภท "ตัวละคร" พร้อมเพศก่อน</div>';
    openModal('modal-pronoun-check');
    return;
  }

  const rows = [];
  for (const ch of _getSortedChapters()) {
    for (const it of pronounScanChapter(ch, characters)) rows.push({ ch, ...it });
  }

  const GENDER_TH = { male: 'ชาย', female: 'หญิง' };
  box.innerHTML = rows.length ? rows.map(r => `
    <div style="border:1px solid var(--border);border-radius:var(--radius);padding:10px;background:var(--bg-deep)">
      <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
        <b>${esc(r.name)}</b>
        <span class="tag tag-term" style="font-size:0.66rem">เพศ${GENDER_TH[r.gender]}</span>
        <span style="font-size:0.76rem;color:var(--crimson-light)">สรรพนามเพศตรงข้าม ${r.wrong} ครั้งใกล้ชื่อ (ตรงเพศ ${r.right})</span>
        <span style="font-size:0.74rem;color:var(--text-muted)">ตอน #${r.ch.chapterNum || '?'} ${esc((r.ch.title || '').slice(0, 24))}</span>
        <button class="btn-xs" style="margin-left:auto" data-name="${esc(r.name)}"
          onclick="closeModal('modal-pronoun-check');openReviewSearch(this.dataset.name)">🔎 ตรวจใน Review</button>
      </div>
      ${r.samples.map(s => `<div style="font-size:0.74rem;color:var(--text-secondary);margin-top:6px;padding:6px;background:var(--surface-2);border-radius:4px;line-height:1.6">${esc(s)}</div>`).join('')}
    </div>`).join('')
    : '<div style="color:#4caf50;font-size:0.84rem;padding:14px;text-align:center">✓ ไม่พบสรรพนามขัดแย้งกับเพศของตัวละคร</div>';
  openModal('modal-pronoun-check');
}
