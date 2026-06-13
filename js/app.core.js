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

// ─── Translation Presets (ตัวอย่างเริ่มต้น 6 แบบ) ───
// บล็อกกฎที่ใช้ร่วมกันทุก preset + auto-glossary เพื่อ "คุมการแปลให้เหมือนกัน"
// ทำให้สำนวน/อารมณ์อ่านต่อเนื่อง และมีการพิสูจน์อักษรระดับมืออาชีพในตัว prompt
const SHARED_CORE_RULES = `CONSISTENCY & READING FLOW (keep the reader's immersion unbroken across the whole chapter):
• Write natural, fluent Thai that reads as continuous prose — never word-by-word or choppy MTL.
• Follow the GLOSSARY exactly: same name/term → the same Thai every time; never invent variant spellings.
• Keep tone, register, and each character's voice consistent sentence-to-sentence and chapter-wide.
• Preserve paragraph breaks, sentence count, and pacing. Never add, omit, summarize, or reorder content.
• Do not translate proper names unless they appear in the glossary.`;

const SHARED_PRONOUN_RULES = `THAI PRONOUN RULES — CRITICAL, NO EXCEPTIONS:
• Male (gender:male) → 3rd: เขา/ของเขา | 1st: ผม/กู/ข้า (match register). NEVER use ฉัน/เธอ/นาง for males.
• Female (gender:female) → 3rd: เธอ/นาง/ของเธอ | 1st: ฉัน/หนู/อิฉัน. NEVER use ผม/กู for females.
• Unknown gender → use เขา (3rd) / ฉัน (1st) as default until clarified.
• First-person narration (나/저/我 etc.) → use the narrator's gender from the glossary; do not default blindly.`;

const SHARED_PROOFREAD_RULES = `PROFESSIONAL PROOFREADING (พิสูจน์อักษรระดับมืออาชีพ) — the output must be publish-ready Thai:
• Correct Thai spelling, vowels and tone marks (วรรณยุกต์), and word spacing; zero typos or doubled characters.
• Clean Thai punctuation/spacing around quotes & parentheses; remove any leftover source-language characters or stray symbols.
• Replace flat or repeated word choices with precise, idiomatic Thai; fix awkward word order.
• Keep numbers, units, and names formatted cleanly and consistently.
• Re-read the finished text once for naturalness and consistency before output.`;

function mkSeedPreset(id, name, emoji, temperature, polish, role, styleBlock) {
  return { id, name, emoji, temperature, polish, systemPrompt:
`You are a professional webnovel translator (source language → Thai). ${role}

${styleBlock}

${SHARED_CORE_RULES}

${SHARED_PRONOUN_RULES}

${SHARED_PROOFREAD_RULES}
{style_note}
GLOSSARY:
{glossary}

{context}
Translate the following source text into Thai. Output ONLY the Thai translation, nothing else:

{text}` };
}

const SEED_PRESETS = [
  mkSeedPreset('seed-literal', 'แปลตรงตัว', '🔤', 0.1, false,
    'You translate as faithfully and literally as possible while keeping the Thai grammatical and readable.',
`LITERAL STYLE:
• Stay as close to the source meaning and sentence structure as Thai grammar allows.
• Do NOT add creative embellishment, interpretation, or extra description beyond the source.
• Prefer the most direct, accurate Thai equivalent for each phrase; keep sentence count where possible.`),
  mkSeedPreset('seed-wuxia', 'แปลจีนกำลังภายใน', '🥋', 0.6, true,
    'You specialize in Chinese-style wuxia / murim (กำลังภายใน) cultivation webnovels.',
`WUXIA / MURIM STYLE:
• Use a classical, slightly archaic Thai martial-arts register (เกียรติยศ, วรยุทธ์, ชี่, จอมยุทธ์, สำนัก, ตระกูล).
• Render cultivation/realm/sect/technique terms consistently; keep honorifics (ท่าน, อาวุโส) per glossary.
• Battle scenes: rhythmic and forceful; inner-energy descriptions vivid but controlled.
• Keep the epic, honor-bound tone throughout.`),
  mkSeedPreset('seed-medieval', 'แปลยุคกลางตะวันตก', '🏰', 0.6, true,
    'You specialize in medieval / European high-fantasy webnovels (knights, kingdoms, magic).',
`MEDIEVAL FANTASY STYLE:
• Use a refined, slightly formal Thai register fitting nobility, knights, clergy, and royal courts.
• Keep titles/ranks (อัศวิน, ขุนนาง, ราชา, ราชินี, เจ้าชาย) consistent with the glossary.
• Render magic, monsters, and place names cleanly; preserve the grand, storybook atmosphere.
• Nobles' dialogue elevated; commoners plainer — keep the contrast.`),
  mkSeedPreset('seed-literary', 'นิยายทั่วไป (วรรณกรรม)', '📖', 0.65, true,
    'You produce literary Thai prose that reads as if written by a gifted Thai novelist.',
`LITERARY STYLE:
• Preserve the author's voice — lyrical, dark, intimate, or epic as the scene demands.
• Use rich, precise vocabulary; convey subtext and emotion, not just words.
• Vary rhythm: short and punchy for action, flowing for reflection.`),
  mkSeedPreset('seed-dialogue', 'เน้นบทสนทนา', '🎭', 0.6, false,
    'You specialize in natural, character-distinct dialogue.',
`DIALOGUE STYLE:
• Each character sounds distinct in Thai, matching personality and status (nobles elevated, rough types colloquial).
• Preserve speech quirks, catchphrases, and verbal tics; keep narration clear and concise.`),
  mkSeedPreset('seed-webtoon', 'เว็บตูน/อ่านมือถือ', '📱', 0.55, false,
    'You translate for webtoons and light novels optimized for fast mobile reading.',
`WEBTOON STYLE:
• Short, punchy Thai sentences — break long source sentences into 2–3 shorter ones.
• Easy to scan, contemporary Thai for young-adult readers; no dense blocks.
• Action stays kinetic and visceral.`),
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
// หมายเหตุ: prompt แปลหลักมาจาก preset ของผู้ใช้ (ดู SEED_PRESETS / buildTranslatePrompt ด้านบน)
const POLISH_PROMPT = `You are a professional Thai literary editor and proofreader (พิสูจน์อักษร) specializing in webnovels.

Refine this Thai translation for natural flow, readability, and narrative immersion — without changing meaning.

RULES:
• Fix unnatural structures and awkward word order; improve flat or repeated word choices.
• Correct Thai spelling, vowels, tone marks (วรรณยุกต์), and word spacing; remove typos, doubled characters, and any stray source-language characters or symbols.
• Keep tone, character voice, and pacing consistent; do NOT add, omit, or alter meaning.
• Preserve all glossary terms exactly as given.

GLOSSARY (preserve these terms):
{glossary}

Refine and proofread the following Thai translation. Output ONLY the polished Thai text, nothing else:

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
- Provide natural Thai translations that are CONSISTENT with professional Thai webnovel prose, so that when these terms are injected into the translated chapter they read seamlessly and never break the reader's flow
- Apply professional proofreading (พิสูจน์อักษร): correct Thai spelling/tone marks, clean transliteration, no stray source-language characters; pick ONE canonical Thai spelling per term and keep it stable
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

