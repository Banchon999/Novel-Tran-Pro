// ═══════════════════════════════════════════════
// NovelTrans v13.1 Pro — Multi-file Edition
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

// ─── ความต่อเนื่องของคำแปลข้ามตอน (เหมือนนักแปลคนเดียว) ───
// 1) แปลแบบคงที่: temperature สูงทำให้เลือกคำต่างกันทุกรอบ → ตอนแปลใช้ไม่เกิน 0.3 (ไม่แก้ค่าใน preset) — ค่าเริ่มต้นเปิด
const STABLE_TEMP_MAX = 0.3;
function stableTempOn(ws) { return ws?.settings?.stableTemp !== false; }
function translateTemp(t, ws = S.currentWs) {
  const v = (typeof t === 'number' && isFinite(t)) ? t : 0.7;
  return stableTempOn(ws) ? Math.min(v, STABLE_TEMP_MAX) : v;
}

// 2) คู่มือการแปลของนิยาย (Style Sheet + Voice Bible) — การตัดสินใจที่ต้องยึดทุกตอน
const STYLE_SHEET_FIELDS = [
  ['translit',  'นโยบายทับศัพท์ / แปลความหมาย (แยกตามหมวด)', 'TRANSLITERATE vs TRANSLATE POLICY (by category)',
    'เช่น ชื่อคน/สถานที่: ทับศัพท์ · ชื่อสกิล/ท่า: แปลความหมาย · ศัพท์เกม (마나 레벨 스탯): ทับศัพท์ มานา เลเวล สเตตัส · ยศขุนนาง: แปล (공작=ดยุก)'],
  ['terms',     'คำประจำเรื่อง / วลีติดปาก (ต้องเหมือนเดิมทุกครั้ง)', 'RECURRING TERMS & CATCHPHRASES (render identically every time)',
    'เช่น 도련님 = คุณชาย · 기사단 = อัศวินแห่ง… · คำติดปากตัวเอก “…”'],
  ['narration', 'น้ำเสียงบรรยาย + คำแทนตัวผู้เล่า', 'NARRATION VOICE',
    'เช่น บรรยายบุรุษที่ 3 ภาษากึ่งทางการ ประโยคกระชับ · ผู้เล่าบุรุษที่ 1 ใช้ "ผม"'],
  ['format',    'รูปแบบ ความคิด / เสียง / ข้อความระบบ', 'FORMATTING OF THOUGHTS / SOUND EFFECTS / SYSTEM MESSAGES',
    'เช่น ความคิดใช้ ‘…’ · ข้อความระบบใช้ […] · เสียงประกอบทับศัพท์ ไม่แปล'],
  ['voices',    'น้ำเสียงตัวละครหลัก', 'CHARACTER VOICES',
    'เช่น เลออน: สุภาพแต่ห้วน ใช้ "ผม" กับผู้ใหญ่ · อาเรีย: อ่อนหวาน ลงท้าย ค่ะ/คะ'],
];
function buildStyleSheetBlock(ws) {
  const ss = ws?.styleSheet || {};
  const parts = STYLE_SHEET_FIELDS.filter(([k]) => String(ss[k] || '').trim()).map(([k, , en]) => `${en}:\n${fixAddressGenderText(String(ss[k]).trim())}`);
  if (!parts.length) return '';
  return `━━━━━━━━━━━━━━━━━━━━
TRANSLATION STYLE SHEET for this novel — decisions already made by the translator; follow them exactly in every chapter
━━━━━━━━━━━━━━━━━━━━
${parts.join('\n\n')}
• Adapt the sentence to fit these decisions and the glossary — never change a decided term, transliteration or voice to fit a sentence.`;
}
function applyStyleSheet(systemPrompt, ws) {
  const b = buildStyleSheetBlock(ws);
  return b && !systemPrompt.includes('TRANSLATION STYLE SHEET') ? injectPromptBlock(systemPrompt, b) : systemPrompt;
}

// 3) preset ไม่มี {context} → เดิมบริบท (สรุปเรื่อง/ท้ายตอนก่อน) ถูกทิ้งเงียบ ๆ → แทรกเป็นบล็อกแทน
function applyContext(systemPrompt, contextStr) {
  if (!contextStr || !String(contextStr).trim() || systemPrompt.includes('{context}')) return systemPrompt;
  return injectPromptBlock(systemPrompt, `━━━━━━━━━━━━━━━━━━━━
CONTEXT FROM EARLIER CHAPTERS (for consistency of names, terms and wording only — do NOT translate or output this)
━━━━━━━━━━━━━━━━━━━━
${contextStr}`);
}

function buildTranslatePrompt({ sourceText, glossaryStr = '', contextStr = '', styleNote = '', ws = null, mtlDraft = '', speakerMap = null }) {
  const preset = getActivePreset(ws);
  // langify ทำท้ายสุด: บล็อกกฎที่แทรกภายหลัง (ครับ/ค่ะ, เพศ) มีตัวอย่างภาษาเกาหลี — ตัดออกเมื่อต้นฉบับไม่ใช่เกาหลี
  return langify(applyContext(applySpeakerMap(applyParticleRules(applyStyleSheet(applyConsistencyLock(applyGenreNotes(applyLangNotes(preset.systemPrompt, ws), ws, sourceText), ws), ws)), speakerMap), contextStr), ws)
    .replace('{style_note}', styleNote ? `STYLE GUIDE:\n${styleNote}\n` : '')
    .replace('{glossary}',   glossaryStr || '(ไม่มี)')
    .replace('{context}',   contextStr)
    .replace('{text}',      sourceText)
    .replace('{mtl_draft}', mtlDraft || '(ไม่มี MTL draft)');
}

// ─── Consistency Lock (ระบบล็อกความสม่ำเสมอ — กดเปิด/ปิดต่อ workspace) ───
// แก้ปัญหา "กดแปลรอบสองได้สรรพนามคนละแบบ" โดยล็อกสรรพนาม/ระดับภาษา/มุมมอง/การตัดสินใจ
// ค่าที่เก็บใน ws.settings: consistencyLock (bool), consistencySelfRef (string|'auto')
function buildConsistencyBlock(selfRef) {
  const sr = (selfRef && selfRef !== 'auto') ? selfRef : '';
  const defaultRule = sr
    ? `• Unless the source explicitly indicates otherwise, render first-person narration/self-reference as "${sr}" and keep it fixed for the ENTIRE passage.\n• Do NOT substitute other first-person forms (ฉัน/ผม/ข้า/ข้าพเจ้า/กระผม/ดิฉัน ฯลฯ) and do NOT upgrade or downgrade the level of formality.`
    : `• When the source does not specify, derive the narrator's 1st-person Thai word from the glossary gender (male→ผม, female→ฉัน, unknown→ฉัน) and keep it fixed for the whole passage.\n• Do NOT upgrade or downgrade the level of formality beyond what the source/glossary supports.`;
  return `━━━━━━━━━━━━━━━━━━━━
PRONOUN CONSISTENCY CONTROL (ล็อกสรรพนาม) — CRITICAL
━━━━━━━━━━━━━━━━━━━━
• Once a 1st/2nd/3rd-person reference is established for a character within the current passage, keep that EXACT Thai form for the rest of the passage unless the source explicitly requires a change.
• Do NOT alternate Thai pronouns for stylistic variation (e.g. ฉัน↔ผม↔ข้าพเจ้า, นาย↔คุณ↔แก, เขา↔เธอ).
• When the source omits the subject or uses bare forms (나는/내가/저는/제가 or a dropped subject), REUSE the previously established form — never re-interpret it.
• Narrative consistency outweighs stylistic diversity. Use the minimum interpretation needed to stay consistent.

━━━━━━━━━━━━━━━━━━━━
REGISTER CONSISTENCY (ล็อกระดับภาษา)
━━━━━━━━━━━━━━━━━━━━
• Once a speaker's Thai speech register is established, preserve it throughout the passage.
• Do NOT fluctuate between colloquial / neutral / polite / formal / literary / archaic Thai without explicit evidence from the source.
• Avoid unnecessary variation in self-reference and address terms.
• Keep each speaker's polite particles (ครับ/ค่ะ/คะ…) consistent with their gender and established register.

━━━━━━━━━━━━━━━━━━━━
NARRATIVE POV LOCK (ล็อกมุมมองเล่าเรื่อง)
━━━━━━━━━━━━━━━━━━━━
• Once the narrative voice is established, do NOT change the narrator's Thai self-reference during the same passage.
• First-person narration must retain the SAME Thai self-reference throughout the passage unless the source explicitly changes the speaker/identity.

━━━━━━━━━━━━━━━━━━━━
DEFAULT THAI SELF-REFERENCE (สรรพนามบุรุษ 1 เริ่มต้น)
━━━━━━━━━━━━━━━━━━━━
${defaultRule}

━━━━━━━━━━━━━━━━━━━━
DETERMINISTIC TRANSLATION POLICY
━━━━━━━━━━━━━━━━━━━━
• If multiple valid Thai renderings exist, always choose the one most consistent with earlier decisions in the same passage.
• Prefer consistency with earlier choices over re-evaluating alternatives.
• Treat established terminology, pronouns, titles, honorifics, relationship terms, and self-references as LOCKED for the rest of the passage unless the source explicitly changes them.`;
}

// ─── Speech Particles (คำลงท้าย ครับ/ค่ะ — ใส่ทุก prompt เสมอ) ───
// preset ใน workspace เก็บ prompt แบบเต็มไว้ตอนสร้าง → แก้ค่าคงที่ไม่ถึง workspace เดิม จึง inject ตอน runtime แทน
const SPEECH_PARTICLE_RULES = `━━━━━━━━━━━━━━━━━━━━
SPEECH PARTICLE RULES (คำลงท้าย ครับ/ค่ะ) — CRITICAL
━━━━━━━━━━━━━━━━━━━━
• Thai polite particles follow the gender of the SPEAKER of that line — never the listener, never the narrator.
• Before writing each line of dialogue, identify who is speaking (dialogue tags, turn order, glossary gender), then choose the particle.
• Male speaker: ครับ / นะครับ / ครับผม / ขอรับ · Female speaker: ค่ะ / คะ / นะคะ / เจ้าค่ะ.
• Royal register: male speaker → พ่ะย่ะค่ะ · female speaker → เพคะ.
• NEVER mix male and female particles inside one line of dialogue.
• The particle must agree with the speaker's self-pronoun in the same line (ผม/กระผม → ครับ · ดิฉัน/อิฉัน → ค่ะ/คะ).
• If the speaker or their gender is unclear, do NOT guess: use a gender-neutral ending (นะ, จ้ะ, or no particle) instead.
• Forms of address follow the gender of the person ADDRESSED (공자님/도련님 → คุณชาย · 아가씨/영애 → คุณหนู · 부인 → ท่านหญิง/คุณนาย); never call a male character คุณหนู or a female one คุณชาย.
• Narration pronouns follow each character's gender: male → เขา · female → เธอ/นาง — check the glossary before every เขา/เธอ/นาง.
• If the Korean source itself uses a wrong-gender pronoun for a character whose gender is in the glossary (a typo such as 그녀 for a male), follow the glossary gender — silently: never add notes, brackets or explanations to the translation.`;

// แทรกบล็อกกฎเข้า prompt ของ preset — วางต่อจาก {glossary} (ห่างจากต้นฉบับ)
// เดิมวางก่อน {text} ซึ่งใน preset ที่มีหัวข้อ "KOREAN SOURCE" ก่อน {text} บล็อกจะไปอยู่ใต้หัวข้อนั้น
// → AI บางตัว (Gemini Flash Lite) สับสนแล้วส่งต้นฉบับเกาหลีกลับมาทั้งตอน
function injectPromptBlock(systemPrompt, block) {
  if (!block || typeof systemPrompt !== 'string') return systemPrompt;
  if (systemPrompt.includes('{glossary}')) return systemPrompt.replace('{glossary}', '{glossary}\n\n' + block);
  if (systemPrompt.includes('{text}')) return systemPrompt.replace('{text}', block + '\n\n{text}');
  return systemPrompt + '\n\n' + block;
}

function applyParticleRules(systemPrompt) {
  if (typeof systemPrompt !== 'string' || systemPrompt.includes('SPEECH PARTICLE RULES')) return systemPrompt;
  return injectPromptBlock(systemPrompt, SPEECH_PARTICLE_RULES);
}

// คำแปลสั้นผิดปกติ = ถูกตัดกลางคันหรือตกหล่น (เทียบจำนวนอักษรไทยกับอักษรเกาหลี/จีน/ญี่ปุ่นในต้นฉบับ)
// จากเทสจริง: ปกติ 2.1–2.7 เท่า · stream ถูกตัด ≈ 1.0 · แปลตกหล่นทั้งช่วง ≈ 1.6 → เกณฑ์ < 1.5
// ใช้เฉพาะต้นฉบับที่เป็นอักษรเอเชียตะวันออก ≥ 800 ตัว (ภาษาอังกฤษอัตราส่วนต่างกันมาก)
function looksIncomplete(src, out) {
  const cjk = (String(src || '').match(/[\uac00-\ud7a3\u4e00-\u9fff\u3040-\u30ff]/g) || []).length;
  if (cjk < 800) return false;
  const thai = (String(out || '').match(/[\u0e00-\u0e7f]/g) || []).length;
  return thai < cjk * 1.5;
}

// AI ส่งต้นฉบับกลับมาโดยไม่แปล? (อักษรเกาหลี/จีน/ญี่ปุ่นเกิน 30% ของตัวอักษรทั้งหมด)
function looksUntranslated(text) {
  const t = String(text || '');
  if (getSourceLang().code === 'en') {   // ต้นฉบับอังกฤษ: อักษรละตินเกินครึ่ง = ไม่ได้แปล
    const lat = (t.match(/[A-Za-z]/g) || []).length, th = (t.match(/[\u0e00-\u0e7f]/g) || []).length;
    return lat > 200 && lat / Math.max(1, lat + th) > 0.5;
  }
  const cjk = (t.match(/[\uac00-\ud7a3\u3131-\u318e\u4e00-\u9fff\u3040-\u30ff]/g) || []).length;
  const thai = (t.match(/[\u0e00-\u0e7f]/g) || []).length;
  return cjk > 50 && cjk / Math.max(1, cjk + thai) > 0.3;
}

// โมเดลบางตัว (เช่น Gemini 3 Flash) ตอบสองภาษา: บรรทัดเกาหลีต้นฉบับสลับกับคำแปล → ตัดบรรทัดที่คัดลอกจากต้นฉบับทิ้ง
// คืน { text, removed, missing } — missing = จำนวนย่อหน้าที่ขาดเมื่อเทียบต้นฉบับ (มีแต่บรรทัดเกาหลี ไม่มีคำแปล)
// หมายเหตุ: ทดลองแล้วการต่อท้าย prompt ว่า "ห้ามคัดลอกภาษาเกาหลี" ทำให้โมเดลตอบสองภาษามากขึ้น → แก้ที่ผลลัพธ์แทน
function stripSourceEcho(src, out) {
  const norm = s => String(s).replace(/\s+/g, '');
  const SRC = norm(src);
  let removed = 0;
  const srcRe = getSourceLang().scriptG;   // เกาหลี/จีน/ละติน ตามภาษาต้นฉบับของเรื่อง
  const kept = String(out || '').split('\n').filter(l => {
    const h = (l.match(srcRe) || []).length, th = (l.match(/[\u0e00-\u0e7f]/g) || []).length;
    if (h > 3 && h > th && SRC.includes(norm(l))) { removed++; return false; }
    return true;
  });
  if (!removed) return { text: out, removed: 0, missing: 0 };
  const text = kept.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  const cnt = s => String(s).split('\n').filter(x => x.trim()).length;
  return { text, removed, missing: Math.max(0, cnt(src) - cnt(text)) };
}

// แทรกบล็อกกฎ Consistency เข้า systemPrompt (ก่อน {text}) เมื่อ workspace เปิดใช้งาน
// idempotent: ถ้า prompt ของผู้ใช้มีบล็อกนี้อยู่แล้ว จะไม่แทรกซ้ำ
function applyConsistencyLock(systemPrompt, ws) {
  if (!ws?.settings?.consistencyLock || typeof systemPrompt !== 'string') return systemPrompt;
  if (systemPrompt.includes('PRONOUN CONSISTENCY CONTROL')) return systemPrompt;
  return injectPromptBlock(systemPrompt, buildConsistencyBlock(ws.settings.consistencySelfRef));
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
• Do NOT change the gender of speech particles (ครับ ↔ ค่ะ/คะ) unless one contradicts the speaker's gender given in the glossary; never mix both in one line of dialogue.

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

// ─── Prompt สกัดคำศัพท์ (Auto Glossary) — แยกตามภาษาต้นฉบับ ───
// เดิมมีแม่แบบเกาหลีอันเดียวแล้ว langify เป็นจีน/อังกฤษ → AI ได้กฎ/ตัวอย่างไม่ตรงภาษา (key "korean", ถอดเสียงจีนแบบพินอินดิบ)
// ตอนนี้แต่ละภาษามี prompt ของตัวเอง: ขอบเขตคำ, วิธีถอดเสียง/แปลแบบที่สำนักพิมพ์ไทยใช้, สัญญาณบอกเพศ, ตัวอย่างผลลัพธ์
// placeholder: {existing} {text} {thai_snippet}
const _AG_COMMON_FIELDS = `"type": one of character | title | rank | term | honorific | place | skill | item | clan | monster
"note": short English meaning + the decision "ทับศัพท์" (transliterated) or "แปลความหมาย" (translated) — keep that decision for the whole novel

OUTPUT: ONLY a raw JSON array — no markdown fences, no text before or after. Return [] if there is nothing new.`;

const AUTOGLOSSARY_PROMPTS = {
  ko: `You are a professional Korean→Thai web-novel terminology editor. Build glossary entries for the Thai translation of the KOREAN text below.
SOURCE LANGUAGE: Korean (한국어).

EXISTING GLOSSARY — already decided, never output these again: {existing}

KOREAN SOURCE TEXT:
{text}

{thai_snippet}

WHAT TO EXTRACT
- Every named entity, including minor ones: characters (full name), places, organizations / guilds / sects / families, skills and techniques, weapons and items, monsters and races, named quests or events.
- Titles, ranks, grades and forms of address that must read the same in every chapter (헌터, S급, 공작, 사형, 도련님).
- Recurring genre or system vocabulary the reader must see consistently (게이트, 마석, 상태창, 레이드, 내공, 기사단).
- NOT ordinary words (사람, 목소리, 화면), verbs, adjectives, numbers, chapter headings, or whole phrases.

"source" — the Korean term exactly as written in the text, in base form:
- Strip particles and endings (은/는/이/가/을/를/의/에게/에서/께서/으로/이다…). Keep 님 only when it is part of a form of address (도련님).
- One concept per entry: split "숨겨진 퀘스트 '회귀자의 맹세'" into the quest name only (회귀자의 맹세); split "오크 군단장 그로칸" into 그로칸 (character) and 오크 군단장 (title). Never include quotes or brackets.

"thai" — Thai script only (no Hangul, no brackets, no explanations), one canonical spelling:
- Korean personal names: transliterate syllable by syllable the way Thai publishers do — 김 คิม · 이 อี · 박 พัค · 최 ชเว · 정 จอง · 강 คัง · 조 โจ · 윤 ยุน · 장 จัง · 한 ฮัน · 오 โอ · 서 ซอ · 신 ชิน · 권 ควอน · 황 ฮวัง · 송 ซง · 백 แพ็ก; syllables: 준 จุน · 민 มิน · 서 ซอ · 지 จี · 훈 ฮุน · 현 ฮยอน · 우 อู · 영 ยอง · 은 อึน · 희 ฮี · 수 ซู · 연 ยอน · 태 แท · 하 ฮา · 진 จิน. Example: 이서준 อีซอจุน.
- Sino-Korean names (murim / Chinese-style settings): ALWAYS transliterate the KOREAN reading written in the text — never convert to Mandarin or to old Thai-Chinese names. Compound surnames: 제갈 เจกัล · 사마 ซามา · 구양 กูยาง · 상관 ซังกวาน · 남궁 นัมกุง · 모용 โมยง · 황보 ฮวังโบ · 동방 ดงบัง · 서문 ซอมุน · 독고 ทกโก · 장손 จังซน · 영호 ยองโฮ. Sects, families and places likewise: 화산 ฮวาซาน · 소림 โซริม · 무당 มูดัง · 아미 อามี · 당가 ตระกูลดัง · 사천 ซาชอน · 남궁세가 ตระกูลนัมกุง — the Chinese-style Thai names (เส้าหลิน บู๊ตึ๊ง ง้อไบ๊ ถัง เสฉวน หัวซาน) are WRONG for a Korean source. Only purely descriptive names are translated (개방 พรรคกระยาจก · 마교 พรรคมาร · 무림맹 พันธมิตรยุทธภพ · 구파일방 เก้าสำนักหนึ่งพรรค).
- Meaningful names (skills, items, places, guilds, quests): translate the meaning in natural Thai web-novel style (검성 ราชันกระบี่, 붉은 달 길드 กิลด์จันทร์แดง); transliterate only when the name has no meaning to translate. Real places keep their Thai names (서울 โซล).
- English loanwords written in Hangul → the Thai loanword readers know: 게이트 เกต · 던전 ดันเจี้ยน · 던전 브레이크 ดันเจี้ยนเบรก · 레이드 เรด · 스킬 สกิล · 퀘스트 เควสต์ · 길드 กิลด์ · 레벨 เลเวล · 인벤토리 ช่องเก็บของ — except 시스템 (the System) → ระบบ.
- Sino-Korean martial / fantasy terms follow the established Thai renderings (내공 พลังภายใน · 단전 ตันเถียน · 마석 หินเวท · 기사단 คณะอัศวิน · 공작 ดยุก).
- Forms of address carry the gender of the person ADDRESSED: 도련님/공자님 → คุณชาย (male) · 아가씨/영애 → คุณหนู (female) · 부인 → ท่านหญิง/คุณนาย.

"gender" — REQUIRED for type "character": male | female | neutral. Evidence, strongest first: 그/그는/그가 → male, 그녀 → female; kinship or role words used FOR the person (형/오빠/아버지/아들/왕자 male · 언니/누나/어머니/딸/영애/하녀/공주 female); how others address them; Thai pronouns in the Thai translation if given (เขา male · เธอ/นาง female — weak evidence; ผม/ฉัน prove nothing). 나/저 prove nothing. If unsure → "neutral".
${_AG_COMMON_FIELDS}
Example:
[{"source":"이서준","thai":"อีซอจุน","type":"character","gender":"male","note":"protagonist · ทับศัพท์"},{"source":"붉은 달 길드","thai":"กิลด์จันทร์แดง","type":"clan","note":"Red Moon Guild · แปลความหมาย"},{"source":"마석","thai":"หินเวท","type":"item","note":"mana stone · แปลความหมาย"}]`,

  zh: `You are a professional Chinese→Thai web-novel terminology editor (จีนกำลังภายใน · เซียน · แฟนตาซีจีน). Build glossary entries for the Thai translation of the CHINESE text below.
SOURCE LANGUAGE: Chinese (中文, simplified or traditional) — read it as Mandarin.

EXISTING GLOSSARY — already decided, never output these again: {existing}

CHINESE SOURCE TEXT:
{text}

{thai_snippet}

WHAT TO EXTRACT
- Every named entity, including minor ones: characters (full name 姓+名, Daoist names such as 玄机子), places (山 峰 殿 阁 城 谷 潭 林), sects / clans / families (宗 门 派 阁 家 族), techniques and manuals (titles in 《》, …剑法 …掌 …诀 …经), artifacts, pills and treasures (…剑 …丹 …符 …鼎 玉简), beasts.
- Cultivation realms and ranks (炼气 筑基 金丹 …), positions and titles (掌门 长老 执法长老 内门弟子), forms of address used as titles (师兄 师尊 前辈 公子 姑娘).
- Recurring genre vocabulary the reader must see consistently (灵气 灵力 丹田 剑意 储物袋 宗门大比 闭关).
- NOT ordinary words (少女 声音 白衣), insults (废物), verbs, idioms (成语 such as 一日千里), chapter headings, or sentences.

"source" — copy the characters exactly from the text: no pinyin, no 《》 or quotes, no trailing 的/了/之. For realms keep one bare entry (筑基 for 筑基期/筑基初期/筑基境).

"thai" — Thai script only (no Chinese characters, no pinyin, no brackets), one canonical spelling:
- Personal names: transliterate from MANDARIN with Thai tone marks approximating the tones, as Thai publishers of Chinese novels do.
  Initials: b ป · p พ · d ต · t ท · g ก · k ค · h ฮ/ห · j จ · q ช · x ซ · zh จ · ch ช · sh ซ · r ร · z จ · c ช · s ซ · y ย · w ว. Finals: -ian เอียน · -uan อวน · xuan/xue เสวียน/เสวีย · -iu อิว · -ui อุย/เว่ย · -ong อง · -eng เอิง · -e เออ · -ao เอา · -ou โอว · ü (yu xu ju qu) อวี · zhi chi shi zi ci si ri → จือ ชือ ซือ. Tone 1 สามัญ · 2 จัตวา · 3 เอก · 4 โท. 无/吴 = อู๋, never หวู.
  Common surnames (use exactly): 王 หวัง · 李 หลี่ · 张 จาง · 刘 หลิว · 陈 เฉิน · 杨 หยาง · 赵 จ้าว · 黄 หวง · 周 โจว · 吴 อู๋ · 林 หลิน · 叶 เย่ · 萧 เซียว · 苏 ซู · 楚 ฉู่ · 秦 ฉิน · 沈 เสิ่น · 顾 กู้ · 江 เจียง · 云 อวิ๋น · 白 ไป๋ · 韩 หาน · 唐 ถัง · 许 สวี่ · 徐 สวี · 孙 ซุน · 宋 ซ่ง · 谢 เซี่ย · 陆 ลู่ · 凌 หลิง · 慕容 มู่หรง · 上官 ซ่างกวน · 欧阳 โอวหยาง · 司马 ซือหม่า · 南宫 หนานกง.
  Examples: 林动 หลินต้ง · 萧炎 เซียวเหยียน · 苏柔 ซูโหรว · 韩立 หานลี่ · 张无忌 จางอู๋จี้ · 楚雪 ฉู่เสวี่ย.
- Sects, places, techniques, artifacts: translate the MEANING in the Thai จีนกำลังภายใน style. Descriptive words are translated (落日 ตะวันลับ · 万妖 หมื่นอสูร · 寒 เย็นเยียบ · 赤焰 เปลวเพลิงชาด); only a core that is a family name or an opaque poetic name stays transliterated inside the Thai frame (青云宗 สำนักชิงอวิ๋น). 宗/门/派 สำนัก · 阁 หอ · 殿 ตำหนัก · 峰 ยอดเขา · 谷/峡谷 หุบเขา · 城 นคร · 经 คัมภีร์ · 剑法 วิชากระบี่ · 丹 โอสถ · 灵器 อาวุธวิญญาณ · 飞剑 กระบี่เหิน. Examples: 天剑宗 สำนักกระบี่สวรรค์ · 藏经阁 หอคัมภีร์ · 万妖山脉 เทือกเขาหมื่นอสูร · 碧霞峰 ยอดเขาปี้เสีย · 《玄冰诀》 เคล็ดวิชาน้ำแข็งเสวียน.
  NEVER spell a whole sect, realm or technique phonetically (天剑宗 is NOT เทียนเจี้ยนจง; 炼气 is NOT เลี่ยนชี่).
- Genre vocabulary: 江湖 ยุทธจักร · 武林 บู๊ลิ้ม · 灵气 ปราณวิญญาณ · 灵力 พลังวิญญาณ · 丹田 ตันเถียน · 剑意 เจตจำนงกระบี่ · 储物袋 ถุงเก็บของ · 玉简 แผ่นหยก · 闭关 ปิดด่านบำเพ็ญ · 宗门大比 การประลองใหญ่ของสำนัก · 内门弟子 ศิษย์สายใน · 外门弟子 ศิษย์สายนอก.
- Realms: 炼气 ขั้นหลอมปราณ · 筑基 ขั้นสร้างรากฐาน · 金丹 ขั้นแก่นทองคำ · 元婴 ขั้นวิญญาณก่อกำเนิด · 化神 ขั้นแปลงเทพ (期/境 add nothing).
- Forms of address: 师兄 ศิษย์พี่ · 师弟 ศิษย์น้อง · 师姐 ศิษย์พี่หญิง · 师妹 ศิษย์น้องหญิง · 师尊/师父 ท่านอาจารย์ · 前辈 ท่านผู้อาวุโส · 长老 ผู้อาวุโส · 掌门 เจ้าสำนัก · 公子/少爷 คุณชาย (male) · 小姐/姑娘 คุณหนู/แม่นาง (female).

"gender" — REQUIRED for type "character": male | female | neutral. Evidence, strongest first: 他 → male, 她 → female; 少年/公子/少爷/老者/师兄/父/子 male · 少女/小姐/姑娘/仙子/师姐/师妹/母/女 female; how others address them; Thai pronouns in the Thai translation if given (weak evidence). If unsure → "neutral".
${_AG_COMMON_FIELDS}
Example:
[{"source":"韩立","thai":"หานลี่","type":"character","gender":"male","note":"protagonist · ทับศัพท์"},{"source":"藏经阁","thai":"หอคัมภีร์","type":"place","note":"Scripture Pavilion · แปลความหมาย"},{"source":"金丹","thai":"ขั้นแก่นทองคำ","type":"rank","note":"Golden Core realm · แปลความหมาย"}]`,

  en: `You are a professional English→Thai web-novel terminology editor (fantasy · LitRPG · romance fantasy). Build glossary entries for the Thai translation of the ENGLISH text below.
SOURCE LANGUAGE: English.

EXISTING GLOSSARY — already decided, never output these again: {existing}

ENGLISH SOURCE TEXT:
{text}

{thai_snippet}

WHAT TO EXTRACT
- Every named entity, including minor ones: characters, places, organizations / guilds / houses, skills, classes, spells, items and weapons, races and monsters, named quests or events.
- Multi-word proper nouns as ONE entry (Silver Tower, Adventurers' Guild). Titles used like names and noble ranks (Archmage, Grand Elder, Duke of X).
- Recurring system / genre vocabulary the reader must see consistently (Level, Status Window, mana crystal, B-rank).
- NOT ordinary words, words capitalized only because they start a sentence, pronouns, numbers, chapter headings, system-message labels (Quest Accepted, Reward) or rarity labels (Common, Rare, Epic).

"source" — exactly as written (keep capitalization), without a leading "The" unless it is part of a title in quotes or brackets, without possessive 's, no brackets or quotes, no numbers (Level 27 → Level).

"thai" — Thai script only, one canonical spelling:
- Personal names: transliterate by English pronunciation, following Royal Institute practice — readable, without tone marks unless the common spelling has them, ์ on silent final letters, given name and family name separated by a space (Leon Ashford เลออน แอชฟอร์ด · Elena เอเลนา · Victor วิกเตอร์ · Arthur อาร์เธอร์).
- Meaningful names (places, organizations, skills, items, quests): translate the meaning when it reads naturally in Thai fantasy (Whispering Forest ป่ากระซิบ · Silver Tower หอคอยเงิน); transliterate coined or opaque names (Ravenmoor เรเวนมัวร์).
- Game terms → the Thai loanwords readers know: Level เลเวล · Skill สกิล · Quest เควสต์ · Class คลาส · Dungeon ดันเจี้ยน · Guild กิลด์ · Status Window หน้าต่างสถานะ.
- Titles: Duke ดยุก · Marquis มาร์ควิส · Earl เอิร์ล · Count เคานต์ · Baron บารอน · Lady เลดี้ · Lord ลอร์ด · Sir เซอร์ · Archmage จอมเวทสูงสุด · Young master คุณชาย (male) · Young lady/Miss คุณหนู (female).

"gender" — REQUIRED for type "character": male | female | neutral. Evidence: he/him/his → male, she/her → female; Mr/Sir/Lord/King/Prince/Duke/brother/father → male; Ms/Mrs/Miss/Lady/Queen/Princess/Duchess/sister/mother → female. If unsure → "neutral".
${_AG_COMMON_FIELDS}
Example:
[{"source":"Leon Ashford","thai":"เลออน แอชฟอร์ด","type":"character","gender":"male","note":"protagonist · ทับศัพท์"},{"source":"Silver Tower","thai":"หอคอยเงิน","type":"place","note":"mage tower · แปลความหมาย"},{"source":"Status Window","thai":"หน้าต่างสถานะ","type":"term","note":"system UI · แปลความหมาย"}]`,
};
const AUTOGLOSSARY_PROMPT = AUTOGLOSSARY_PROMPTS.ko;   // ชื่อเดิม (เผื่อโค้ดเก่าอ้างถึง)

// คำเรียกขานที่บอกเพศของ "คนที่ถูกเรียก" — AI คลังศัพท์เคยใส่ 도련님 = คุณหนู (ผิดเพศ) แล้วลามทุกตอน
const ADDRESS_GENDER = [
  { re: /^(도련님|공자님|도령님?|소공자님?|젊은 ?주인님|公子|少爷|少主|young (?:master|lord))$/i, bad: /คุณหนู|คุณหญิง|ท่านหญิง|คุณนาย/, thai: 'คุณชาย' },
  { re: /^(아가씨|영애님?|공녀님?|아씨|小姐|young lady|miss)$/i, bad: /คุณชาย|ท่านชาย|นายน้อย/, thai: 'คุณหนู' },
];
// ข้อความแบบ "도련님 = คุณหนู" ในคู่มือการแปล → แก้คำไทยให้ตรงเพศ (ใช้กับคู่มือที่ AI ร่าง/ผู้ใช้เขียน)
function fixAddressGenderText(text) {
  return String(text || '').replace(/([가-힣]+(?: ?[가-힣]+)?)(\s*[=:→]\s*)([^\s,·()\n]+)/g, (m, ko, sep, th) => {
    const fixed = fixAddressGender(ko, th);
    return fixed === th ? m : ko + sep + fixed;
  });
}
// นิยายเกาหลีแนวมู่หลินใช้ชื่อจีน แต่เรื่องนี้ถอดเป็น "เสียงเกาหลี" เสมอ — AI บางตัว (Gemini Flash Lite) ติดชื่อจีนแบบไทยเดิม
// (เส้าหลิน, ถัง, หนานกง) → ถ้าต้นฉบับมีคำเกาหลีนั้น และคำไทยใช้เสียงจีน ให้แก้เป็นเสียงเกาหลี
// [ฮันกึล, เสียงเกาหลี, เสียงจีนแบบไทยที่ต้องแก้...] — แซ่ซ้อนจากตารางของผู้ใช้ + สำนัก/สถานที่ที่เจอบ่อย
const KO_SINO_READINGS = [
  ['제갈', 'เจกัล', 'จูกัด', 'จูเก่อ', 'จูเก๋อ'], ['사마', 'ซามา', 'ซือหม่า'], ['구양', 'กูยาง', 'โอวหยาง'], ['상관', 'ซังกวาน', 'ซ่างกวน', 'ซ่างกวาน'],
  ['남궁', 'นัมกุง', 'หนานกง'], ['모용', 'โมยง', 'มู่หรง'], ['황보', 'ฮวังโบ', 'หวงฝู่'], ['동방', 'ดงบัง', 'ตงฟาง'],
  ['서문', 'ซอมุน', 'ซีเหมิน'], ['독고', 'ทกโก', 'ตูกู', 'ตู๋กู'], ['장손', 'จังซน', 'จางซุน'], ['영호', 'ยองโฮ', 'ลิ้งหู', 'หลิงหู'],
  ['소림', 'โซริม', 'เส้าหลิน'], ['무당', 'มูดัง', 'บู๊ตึ๊ง', 'อู่ตัง'], ['아미', 'อามี', 'ง้อไบ๊', 'เอ๋อเหมย'], ['화산', 'ฮวาซาน', 'หัวซาน', 'ฮว้าซัว'],
  ['사천', 'ซาชอน', 'เสฉวน', 'ซื่อชวน'], ['당가', 'ดัง', 'ถัง'],
];
function fixSinoKoreanReading(korean, thai) {
  const k = String(korean || ''), t0 = String(thai || '');
  if (!/[가-힣]/.test(k) || !t0) return thai;
  let t = t0;
  for (const [ko, kr, ...zh] of KO_SINO_READINGS) {
    if (!k.includes(ko)) continue;
    for (const z of zh) if (t.includes(z)) t = t.split(z).join(kr);
  }
  // แซ่ 당 (唐) ขึ้นต้นชื่อ: 당소소 = ถังโซโซ → ดังโซโซ (เฉพาะต้นคำ — กัน 정당 ฯลฯ)
  if (k.startsWith('당') && t.startsWith('ถัง')) t = 'ดัง' + t.slice(3);
  return t === t0 ? thai : t;
}
function fixAddressGender(korean, thai) {
  const k = String(korean || '').trim();
  for (const a of ADDRESS_GENDER) if (a.re.test(k) && a.bad.test(String(thai || ''))) return a.thai;
  return thai;
}

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
  const meta = { id: ws.id, name: ws.name, emoji: ws.emoji || '📖', coverThumb: ws.coverThumb || '', chapterCount: (ws.chapters || []).length };
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
// ─── ภาษาต้นฉบับ (เกาหลี / จีน / อังกฤษ) ───
// ws.settings.sourceLang — ไม่ได้ตั้ง → เดาจากต้นฉบับของตอนในเรื่อง (นิยายเก่า = เกาหลี)
// prompt ทุกตัวเขียนสำหรับเกาหลี → langify(): เปลี่ยนชื่อภาษา + ตัดบรรทัดตัวอย่างภาษาเกาหลีออก + เติมกฎของภาษานั้น
// ═══════════════════════════════════════════════
const SOURCE_LANGS = {
  ko: { code: 'ko', name: 'Korean',  th: 'เกาหลี', short: 'KO', script: /[가-힣]/,  scriptG: /[가-힣]/g,
        placeholder: 'วางข้อความภาษาเกาหลีที่นี่...' },
  zh: { code: 'zh', name: 'Chinese', th: 'จีน',    short: 'ZH', script: /[一-鿿㐀-䶿]/, scriptG: /[一-鿿㐀-䶿]/g,
        placeholder: 'วางข้อความภาษาจีนที่นี่...' },
  en: { code: 'en', name: 'English', th: 'อังกฤษ', short: 'EN', script: /[A-Za-z]/, scriptG: /[A-Za-z]/g,
        placeholder: 'Paste English text here... (วางข้อความภาษาอังกฤษ)' },
};

// เดาภาษาจากตัวอักษรที่พบมากสุด (คานะญี่ปุ่นยังไม่รองรับ → null)
function detectSourceLang(text) {
  const t = String(text || '').slice(0, 6000);
  const n = re => (t.match(re) || []).length;
  const ko = n(/[가-힣]/g), kana = n(/[぀-ヿ]/g), han = n(/[一-鿿㐀-䶿]/g), lat = n(/[A-Za-z]/g);
  if (ko >= 20 && ko >= han) return 'ko';
  if (kana >= 20 && kana * 3 >= han) return null;
  if (han >= 20) return 'zh';
  if (lat >= 80) return 'en';
  return null;
}

function getSourceLang(ws = (typeof S !== 'undefined' ? S.currentWs : null)) {
  const code = ws?.settings?.sourceLang;
  if (SOURCE_LANGS[code]) return SOURCE_LANGS[code];
  let sample = (ws?.chapters || []).filter(c => c.sourceText).slice(0, 3).map(c => c.sourceText.slice(0, 2000)).join('\n');
  // ยังไม่มีตอน → ดูจากช่องต้นฉบับในแท็บแปล
  if (!sample && typeof document !== 'undefined') sample = document.getElementById('sourceText')?.value || '';
  return SOURCE_LANGS[detectSourceLang(sample)] || SOURCE_LANGS.ko;
}

// กฎเฉพาะภาษา — ใส่ใน prompt แปล และ prompt สกัดคำ
const LANG_NOTES = {
  zh: {
    translate: `━━━━━━━━━━━━━━━━━━━━
SOURCE LANGUAGE: CHINESE (Chinese → Thai web novel)
━━━━━━━━━━━━━━━━━━━━
• Names: transliterate from Mandarin the way Thai publishers of Chinese novels do (林动 → หลินต้ง, 苏柔 → ซูโหรว). Never leave Chinese characters in the Thai.
• Sects, realms, techniques, artifacts, places: follow the glossary; if absent, translate the meaning in the established Thai จีนกำลังภายใน style (宗 → สำนัก, 阁 → หอ, 境 → ขอบเขต/ขั้น, 丹 → โอสถ/ยาเม็ด) and keep it identical every time.
• Forms of address follow the gender of the person ADDRESSED: 公子/少爷/少主 → คุณชาย (male) · 小姐/姑娘 → คุณหนู/แม่นาง (female) — never call a male คุณหนู or a female คุณชาย.
• Other forms of address: 师兄 ศิษย์พี่ · 师弟 ศิษย์น้อง · 师姐 ศิษย์พี่หญิง · 师妹 ศิษย์น้องหญิง · 师父/师尊 ท่านอาจารย์ · 前辈 ผู้อาวุโส · 公子 คุณชาย · 姑娘/小姐 แม่นาง/คุณหนู · 大人 ใต้เท้า.
• 他 = male (เขา) · 她 = female (นาง/เธอ, follow the style already used) · Chinese has no polite particles: choose ครับ/ค่ะ (or none) from the speaker's gender and the situation.
• Idioms (成语) and cultivation jargon: render the meaning naturally in Thai; do not translate word by word.`,
    glossary: `- Gender cues (Chinese): 他/男/哥/兄/师兄/父/爷/公子/少爷/王/皇帝 = male | 她/女/姐/妹/师姐/师妹/母/娘/姑娘/小姐/公主/皇后 = female
- Names: Thai transliteration from Mandarin (林动 = หลินต้ง); sects/realms/techniques: meaning-based Thai in the wuxia/xianxia tradition (天剑宗 = สำนักกระบี่สวรรค์, 筑基境 = ขอบเขตสร้างรากฐาน)
- Terms are usually 2–6 characters with no spaces; extract the full term exactly as it appears in the text`,
  },
  en: {
    translate: `━━━━━━━━━━━━━━━━━━━━
SOURCE LANGUAGE: ENGLISH (English → Thai web novel)
━━━━━━━━━━━━━━━━━━━━
• Translate meaning, not word order: restructure English sentences into natural Thai prose; avoid "ถูก…" passives and literal "มัน" unless natural.
• Names: Thai transliteration following the glossary (keep one spelling); titles Mr./Lady/Sir/Lord/Your Majesty → นาย/เลดี้ หรือ ท่านหญิง/เซอร์/ท่านลอร์ด/ฝ่าบาท as fits the setting.
• Forms of address follow the gender of the person ADDRESSED: "Young master"/"Young lord" → คุณชาย (male) · "Young lady"/"Miss" → คุณหนู (female) — never call a male คุณหนู or a female คุณชาย.
• he/him/his = male (เขา) · she/her = female (เธอ/นาง) · English has no polite particles: choose ครับ/ค่ะ (or none) from the speaker's gender and the situation.
• Keep system/status-window text in [ ] and game terms consistent with the glossary (Level, Skill, Status → เลเวล, สกิล, สเตตัส unless the glossary says otherwise).
• Do not leave English words in the Thai unless they are proper nouns the glossary keeps in English.`,
    glossary: `- Gender cues (English): he/him/his/Mr/Sir/Lord/King/Prince/brother/father = male | she/her/Ms/Mrs/Miss/Lady/Queen/Princess/sister/mother = female
- Extract proper nouns (characters, places, organizations, skills, items, titles) and recurring genre/system terms — not common English words
- Keep the English term exactly as written (original capitalization)`,
  },
};

// เปลี่ยน prompt ที่เขียนสำหรับเกาหลี → ภาษาต้นฉบับของเรื่อง
// dropKorean: ตัดบรรทัดที่มีตัวอักษรเกาหลี (ตัวอย่าง/กฎเฉพาะเกาหลี) — ใช้กับ "แม่แบบ" ก่อนใส่ข้อความจริงเท่านั้น
function langify(tpl, ws, { dropKorean = true } = {}) {
  const L = getSourceLang(ws);
  if (L.code === 'ko' || typeof tpl !== 'string') return tpl;
  let t = tpl;
  if (dropKorean) t = t.split('\n').filter(l => !/[가-힣]/.test(l) || /\{[a-z_]+\}/.test(l)).join('\n');
  return t.replace(/\bKOREAN\b/g, L.name.toUpperCase()).replace(/\bKorean\b/g, L.name)
          .replace(/เกาหลี/g, L.th).replace(/\[KO\]/g, `[${L.short}]`);
}

// แนวทางการแปลตามแนวนิยาย (ws.settings.genrePreset — ข้อมูลอยู่ใน app.glossary-ai.js)
function applyGenreNotes(systemPrompt, ws, text) {
  if (typeof buildGenreBlock !== 'function' || typeof systemPrompt !== 'string' || systemPrompt.includes('GENRE GUIDE:')) return systemPrompt;
  return injectPromptBlock(systemPrompt, buildGenreBlock(ws, text));
}

function applyLangNotes(systemPrompt, ws) {
  const L = getSourceLang(ws);
  const note = LANG_NOTES[L.code]?.translate;
  if (!note || typeof systemPrompt !== 'string' || systemPrompt.includes('SOURCE LANGUAGE:')) return systemPrompt;
  return injectPromptBlock(systemPrompt, note);
}

// prompt สกัดคำ: แปลงภาษา + กฎเฉพาะภาษา (ใส่ก่อนบรรทัด "Return empty array")
// prompt สกัดคำ: เลือกตามภาษา (lang = ภาษาที่ตรวจพบจากข้อความจริง ถ้าไม่ส่งมาใช้ภาษาของ workspace)
// • prompt สำเร็จรูปของภาษานั้น (AUTOGLOSSARY_PROMPTS) → ใช้ตรง ๆ ไม่ต้องแปลง
// • prompt ที่ผู้ใช้แก้เอง/แบบเก่า (เขียนสำหรับเกาหลี) → แปลงภาษา + เติมกฎเฉพาะภาษา (LANG_NOTES)
// • แนวนิยาย: เติมเมื่อแนวนั้นตรงกับภาษาของข้อความเท่านั้น (ชุดคำเกาหลีไม่ไปปนกับต้นฉบับจีน)
function _glossInsert(t, rule) {
  let i = t.lastIndexOf('\nOUTPUT:');
  if (i < 0) i = t.lastIndexOf('- Return empty array');
  return i >= 0 ? t.slice(0, i) + '\n' + rule + '\n' + t.slice(i) : t + '\n' + rule;
}
function langifyGlossaryPrompt(tpl, ws, lang) {
  const code = SOURCE_LANGS[lang] ? lang : getSourceLang(ws).code;
  const lws = { ...(ws || {}), settings: { ...(ws?.settings || {}), sourceLang: code } };
  const builtIn = typeof AUTOGLOSSARY_PROMPTS !== 'undefined' && Object.values(AUTOGLOSSARY_PROMPTS).includes(tpl);
  let t = tpl;
  if (!builtIn) {
    t = langify(tpl, lws);
    const extra = LANG_NOTES[code]?.glossary;
    if (extra && !t.includes(extra)) t = _glossInsert(t, extra);
  }
  const g = typeof getGenrePreset === 'function' ? getGenrePreset(ws) : null;
  if (g && g.lang === code && !t.includes('GENRE (')) {
    t = _glossInsert(t, `GENRE (${g.name}) — follow these Thai conventions for new terms:\n${g.guide}\nStandard renderings for this genre: ${g.terms.map(([s, th]) => s + ' = ' + th).join(' · ')}`);
  }
  return t;
}

// AI บางตัวเปลี่ยนชื่อ key ตามภาษา ("chinese"/"source"/"term" แทน "korean") → เดิมถูกทิ้งหมดแล้วขึ้น "ไม่พบคำ"
const _TERM_KEYS = ['korean', 'source', 'original', 'chinese', 'english', 'japanese', 'term', 'word', 'name', 'zh', 'en', 'ko', 'src', 'source_term', 'sourceTerm'];
const _THAI_KEYS = ['thai', 'th', 'translation', 'thai_translation', 'thaiTranslation', 'target'];
function normalizeTermKeys(t) {
  if (!t || typeof t !== 'object') return t;
  if (!t.korean) for (const k of _TERM_KEYS) if (typeof t[k] === 'string' && t[k].trim()) { t.korean = t[k].trim(); break; }
  if (!t.thai) for (const k of _THAI_KEYS) if (typeof t[k] === 'string' && t[k].trim()) { t.thai = t[k].trim(); break; }
  // AI บางตัวติด 《》 / 「」 / เครื่องหมายคำพูดมากับชื่อ → คำในคลังจะไม่ตรงกับต้นฉบับ
  if (typeof t.korean === 'string') t.korean = t.korean.trim().replace(/^[《「『【\["'“‘]+|[》」』】\]"'”’]+$/g, '').trim();
  return t;
}
