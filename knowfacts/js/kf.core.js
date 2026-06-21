// ═══════════════════════════════════════════════
// KnowFacts Factory — Core (state, storage, prompts, AI pipeline)
// โครงสร้างอิงจาก NovelTrans Pro: PWA + IndexedDB + Multi-provider AI ตรงจาก browser
// ═══════════════════════════════════════════════
'use strict';

// ─── Global State ───
const KF = {
  settings: {
    provider: 'openrouter',
    model: 'google/gemini-2.5-flash',
    temperature: 0.8,
    channelName: 'รู้ไหม?',
    minTotalScore: 24,       // เก็บเฉพาะ Fact ที่คะแนนรวม ≥ ค่านี้
    ttsVoice: 'เสียงผู้บรรยายหลัก',
  },
  costs: { input: 0, output: 0, usd: 0 },
  facts: [],     // รายการ Fact → คลิป (ทั้งหมด)
  series: [],    // ซีรีส์/หมวด
  filter: { stage: 'all', series: 'all', q: '' },
  _abort: null,
};

// ─── Production Stages (= โครงสร้าง Folder) ───
const STAGES = [
  { id: 'ideas',     emoji: '💡', label: 'Ideas',     desc: 'Fact ที่เก็บมา' },
  { id: 'scripts',   emoji: '📝', label: 'Scripts',   desc: 'มีสคริปต์แล้ว' },
  { id: 'images',    emoji: '🖼️', label: 'Images',    desc: 'มี Prompt ภาพ/ภาพแล้ว' },
  { id: 'voice',     emoji: '🎙️', label: 'Voice',     desc: 'อัดเสียง TTS แล้ว' },
  { id: 'videos',    emoji: '🎬', label: 'Videos',    desc: 'ตัดต่อเสร็จ' },
  { id: 'published', emoji: '🚀', label: 'Published', desc: 'โพสต์แล้ว' },
];
const stageInfo = id => STAGES.find(s => s.id === id) || STAGES[0];
const stageIndex = id => Math.max(0, STAGES.findIndex(s => s.id === id));

// ─── Posting slots (วันละ 3 คลิป) ───
const POST_SLOTS = ['09:00', '13:00', '19:00'];

// ─── Weekly factory schedule (ระบบผลิต 30 คลิป/สัปดาห์) ───
const WEEK_PLAN = [
  { day: 'อาทิตย์', emoji: '🔎', task: 'หา Fact 100 เรื่อง → คัดเหลือ 30', time: '1 ชม.', stage: 'ideas' },
  { day: 'จันทร์',  emoji: '📝', task: 'สร้าง Script 30 อัน',              time: '20 นาที', stage: 'scripts' },
  { day: 'อังคาร',  emoji: '🖼️', task: 'สร้างภาพ 30 คลิป (4 ภาพ/คลิป)',   time: '40 นาที', stage: 'images' },
  { day: 'พุธ',     emoji: '🎙️', task: 'TTS 30 คลิป',                     time: '10 นาที', stage: 'voice' },
  { day: 'พฤหัส',   emoji: '🎬', task: 'ตัดต่อรวดเดียว',                   time: '1 ชม.',  stage: 'videos' },
  { day: 'ศุกร์',   emoji: '🚀', task: 'ตั้งเวลาโพสต์ 09:00 / 13:00 / 19:00', time: '—',   stage: 'published' },
];

// ─── Edit timeline template (Template เดียว) ───
const TIMELINE = [
  { part: 'hook',        range: '0–3 วิ',   label: 'Hook' },
  { part: 'fact',        range: '3–8 วิ',   label: 'Fact' },
  { part: 'explanation', range: '8–15 วิ',  label: 'Explanation' },
  { part: 'question',    range: '15–20 วิ', label: 'Question' },
];

// ─── Seed series (สูตรโตเร็ว: ทำเป็นซีรีส์) ───
const SEED_SERIES = [
  { id: 'animals', emoji: '🐱', name: 'รู้ไหม? สัตว์' },
  { id: 'nature',  emoji: '⚡', name: 'รู้ไหม? ธรรมชาติ' },
  { id: 'body',    emoji: '🧠', name: 'รู้ไหม? ร่างกาย' },
];

const DEFAULT_SOURCES = `https://en.wikipedia.org/wiki/Special:Random
Reddit — r/todayilearned
Reddit — r/NoStupidQuestions
ScienceAlert
LiveScience
National Geographic`;

// ═══════════════════════════════════════════════
// ─── IndexedDB storage (single-doc) ───
// ═══════════════════════════════════════════════
const IDB_NAME = 'KnowFactsDB', IDB_VERSION = 1;
let _idb = null;

function idbOpen() {
  if (_idb) return Promise.resolve(_idb);
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, IDB_VERSION);
    req.onupgradeneeded = e => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('state')) db.createObjectStore('state');
    };
    req.onsuccess = e => { _idb = e.target.result; resolve(_idb); };
    req.onerror = e => reject(e.target.error);
  });
}
function idbGet(key) {
  return idbOpen().then(db => new Promise((resolve, reject) => {
    const req = db.transaction('state', 'readonly').objectStore('state').get(key);
    req.onsuccess = () => resolve(req.result ?? null);
    req.onerror = () => reject(req.error);
  }));
}
function idbPut(key, value) {
  return idbOpen().then(db => new Promise((resolve, reject) => {
    const tx = db.transaction('state', 'readwrite');
    const req = tx.objectStore('state').put(value, key);
    req.onsuccess = () => resolve();
    req.onerror = e => {
      const err = e.target.error;
      if (err?.name === 'QuotaExceededError') showToast('⚠ พื้นที่จัดเก็บเต็ม — Export ข้อมูลแล้วลบของเก่า', 'error');
      reject(err);
    };
  }));
}

let _saveTimer = null;
function saveState(immediate = false) {
  const doc = { facts: KF.facts, series: KF.series, settings: KF.settings };
  const run = () => idbPut('main', doc).catch(e => console.warn('save failed', e));
  if (immediate) return run();
  clearTimeout(_saveTimer);
  _saveTimer = setTimeout(run, 600);
}

async function loadState() {
  const doc = await idbGet('main');
  if (doc) {
    KF.facts = Array.isArray(doc.facts) ? doc.facts : [];
    KF.series = Array.isArray(doc.series) && doc.series.length ? doc.series : SEED_SERIES.map(s => ({ ...s }));
    KF.settings = { ...KF.settings, ...(doc.settings || {}) };
  } else {
    KF.series = SEED_SERIES.map(s => ({ ...s }));
    await saveState(true);
  }
}

function genId() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }

// ═══════════════════════════════════════════════
// ─── Prompts ───
// ═══════════════════════════════════════════════
function findFactsPrompt({ sources, count, seriesName }) {
  const hint = seriesName ? `\nโฟกัสเฉพาะหัวข้อที่เข้ากับซีรีส์ "${seriesName}"\n` : '';
  return `คุณคือนักหา "Fact น่าทึ่ง" สำหรับช่อง Shorts ภาษาไทยชื่อ "${KF.settings.channelName}"

จากข้อมูล/แหล่งอ้างอิงด้านล่าง ค้นหา Fact ที่ตรง "ทุก" เงื่อนไขนี้:
• คนส่วนใหญ่ไม่รู้
• อธิบายจบได้ภายใน 20 วินาที
• น่าตกใจ / น่าทึ่ง
• มีหลักฐานทางวิทยาศาสตร์หรือประวัติศาสตร์รองรับ (ห้ามแต่ง/ห้ามมั่ว)
${hint}
ส่งกลับมา ${count} ข้อ เป็น JSON array เท่านั้น (ห้ามมี markdown, ห้ามมีข้อความอื่น):
[{"topic":"หัวข้อสั้นๆ เช่น แมว","fact":"ข้อเท็จจริง 1 ประโยคกระชับ","explain":"คำอธิบายว่าทำไม 1-2 ประโยค"}]

ข้อมูล/แหล่งอ้างอิง:
${sources}`;
}

function scorePrompt(facts) {
  const list = facts.map(f => ({ id: f.id, topic: f.topic, fact: f.fact })).slice(0, 60);
  return `ให้คะแนนศักยภาพไวรัลของแต่ละ Fact สำหรับคลิป Shorts 3 แกน (จำนวนเต็ม 1-10):
• shock — น่าตกใจ/เซอร์ไพรส์แค่ไหน
• curiosity — กระตุ้นความอยากรู้/หยุดนิ้วเลื่อนแค่ไหน
• shareability — คนอยากแชร์ต่อให้เพื่อนแค่ไหน

ส่งกลับ JSON array เท่านั้น (ห้าม markdown) ครบทุก id:
[{"id":"<id เดิม>","shock":n,"curiosity":n,"shareability":n}]

FACTS:
${JSON.stringify(list, null, 0)}`;
}

function scriptPrompt(fact) {
  return `เขียนสคริปต์คลิป Shorts ภาษาไทยจาก Fact นี้ — ความยาวรวม "ไม่เกิน 50 คำ"
โครงสร้าง 4 ส่วน:
• hook — ประโยคเปิดดึงดูด เริ่มด้วย "${KF.settings.channelName}"
• fact — ข้อเท็จจริงหลัก ชัด กระชับ
• explanation — เหตุผล/คำอธิบายสั้นๆ
• question — คำถามชวนคิด/ชวนคอมเมนต์ปิดท้าย

ส่ง JSON เท่านั้น (ห้าม markdown):
{"hook":"","fact":"","explanation":"","question":""}

หัวข้อ: ${fact.topic}
Fact: ${fact.fact}
อธิบาย: ${fact.explain || ''}`;
}

function scenesPrompt(fact) {
  const s = fact.script || {};
  return `แบ่งสคริปต์ Shorts นี้เป็น "4 ฉาก" และเขียน image prompt ภาษาอังกฤษของแต่ละฉาก
Style บังคับทุกฉาก: documentary, photorealistic, cinematic lighting, 4K, vertical 9:16 framing

ส่ง JSON array 4 ชิ้นเท่านั้น (ห้าม markdown):
[{"n":1,"caption":"สิ่งที่เห็นในฉาก (ไทยสั้นๆ)","prompt":"detailed english image generation prompt"}]

สคริปต์:
Hook: ${s.hook || ''}
Fact: ${s.fact || fact.fact}
Explanation: ${s.explanation || fact.explain || ''}
Question: ${s.question || ''}`;
}

// ดึง JSON ออกจากผลลัพธ์ AI (ตัด markdown fence / ข้อความรอบข้าง)
function extractJSON(text) {
  if (!text) throw new Error('AI ไม่ส่งข้อมูลกลับมา');
  let t = text.trim().replace(/^```(?:json)?/i, '').replace(/```$/,'').trim();
  // หา array หรือ object ก้อนแรก
  const firstArr = t.indexOf('['), firstObj = t.indexOf('{');
  let start = -1, open = '[', close = ']';
  if (firstArr >= 0 && (firstObj < 0 || firstArr < firstObj)) { start = firstArr; open = '['; close = ']'; }
  else if (firstObj >= 0) { start = firstObj; open = '{'; close = '}'; }
  if (start >= 0) {
    let depth = 0, inStr = false, esc = false;
    for (let i = start; i < t.length; i++) {
      const c = t[i];
      if (inStr) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') inStr = false; continue; }
      if (c === '"') inStr = true;
      else if (c === open) depth++;
      else if (c === close) { depth--; if (depth === 0) { t = t.slice(start, i + 1); break; } }
    }
  }
  try { return JSON.parse(t); }
  catch (e) { throw new Error('แปลงผลลัพธ์ AI เป็น JSON ไม่สำเร็จ — ลองกดทำใหม่อีกครั้ง'); }
}

// ═══════════════════════════════════════════════
// ─── AI Pipeline ───
// ═══════════════════════════════════════════════
const M = () => KF.settings.model;
const T = () => KF.settings.temperature;

// 2. หา Fact → array {topic, fact, explain}
async function kfFindFacts({ sources, count, seriesName }, signal) {
  const out = await aiCall({ model: M(), temperature: T(), max_tokens: 8000, signal,
    messages: [{ role: 'user', content: findFactsPrompt({ sources, count, seriesName }) }] });
  const arr = extractJSON(out);
  if (!Array.isArray(arr)) throw new Error('ผลลัพธ์ไม่ใช่รายการ');
  return arr.filter(x => x && x.fact).map(x => ({
    topic: String(x.topic || '').trim(),
    fact: String(x.fact || '').trim(),
    explain: String(x.explain || '').trim(),
  }));
}

// 3. ให้คะแนน Viral → map id → scores
async function kfScore(facts, signal) {
  const out = await aiCall({ model: M(), temperature: 0.3, max_tokens: 4000, signal,
    messages: [{ role: 'user', content: scorePrompt(facts) }] });
  const arr = extractJSON(out);
  const map = {};
  (Array.isArray(arr) ? arr : []).forEach(r => {
    if (!r || !r.id) return;
    const shock = clampScore(r.shock), curiosity = clampScore(r.curiosity), share = clampScore(r.shareability ?? r.share);
    map[r.id] = { shock, curiosity, share, total: shock + curiosity + share };
  });
  return map;
}
function clampScore(n) { n = parseInt(n); return isNaN(n) ? 0 : Math.max(0, Math.min(10, n)); }

// 4. เขียน Script → {hook, fact, explanation, question}
async function kfWriteScript(fact, signal) {
  const out = await aiCall({ model: M(), temperature: T(), max_tokens: 2000, signal,
    messages: [{ role: 'user', content: scriptPrompt(fact) }] });
  const o = extractJSON(out);
  return {
    hook: String(o.hook || '').trim(),
    fact: String(o.fact || '').trim(),
    explanation: String(o.explanation || '').trim(),
    question: String(o.question || '').trim(),
  };
}

// 5. แตกฉาก → [{n, caption, prompt}]
async function kfMakeScenes(fact, signal) {
  const out = await aiCall({ model: M(), temperature: 0.6, max_tokens: 3000, signal,
    messages: [{ role: 'user', content: scenesPrompt(fact) }] });
  const arr = extractJSON(out);
  return (Array.isArray(arr) ? arr : []).slice(0, 4).map((s, i) => ({
    n: s.n || i + 1,
    caption: String(s.caption || '').trim(),
    prompt: String(s.prompt || '').trim(),
    imageUrl: '',
  }));
}

// 6/7. ประกอบ Voice script (TTS-ready) จากสคริปต์
function voiceText(fact) {
  const s = fact.script;
  if (!s) return '';
  return [s.hook, s.fact, s.explanation, s.question].filter(Boolean).join('\n');
}

// นับคำ (ไทยตัดด้วยช่องว่าง + ประมาณ) — ใช้เช็คเพดาน 50 คำ
function wordCount(text) {
  if (!text) return 0;
  return text.trim().split(/\s+/).filter(Boolean).length;
}
