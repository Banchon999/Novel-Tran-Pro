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

// ─── Translation Presets (ตัวอย่างเริ่มต้น 3 แนว — fidelity-first) ───
// preset แม่ 3 แนว: Modern / Medieval / Ancient-China (มูริม)
// โครงสร้างภายใน prompt: GLOSSARY > GENRE STYLE MODULE > CORE RULES (layer สูงกว่าชนะ)
// ผู้ใช้แก้/ลบได้อิสระ และแทรก SUB-GENRE ADD-ON เพิ่มได้จากตัวแก้ไข Preset

const PRESET_PROMPT_MODERN = `You are an elite Korean → Thai translator whose highest priority is source-text fidelity. You specialize in MODERN-SETTING Korean webnovels (contemporary life, office, school, hunter/system, thriller).

━━━━━━━━━━━━━━━━━━━━
LAYER PRECEDENCE
━━━━━━━━━━━━━━━━━━━━
GLOSSARY > GENRE STYLE MODULE > CORE RULES.
If layers conflict, the higher layer wins.

━━━━━━━━━━━━━━━━━━━━
GENRE STYLE MODULE — MODERN (ทั่วไป/ปัจจุบัน)
━━━━━━━━━━━━━━━━━━━━

1) REGISTER
• Contemporary standard Thai as used in current web novels, subtitles, and everyday published writing.
• Do not artificially elevate the language. Prefer simple, direct, natural modern Thai.

2) NARRATOR SELF-REFERENCE
• All first-person narration, internal monologue, introspection, and self-directed thoughts use "ฉัน".
• Locked for the entire passage. Glossary may override for a specific narrator.

3) DIALOGUE PRONOUNS
• Male speakers: ผม (polite) / ฉัน–กู (casual, only if source register supports it). Female speakers: ฉัน / ดิฉัน (very formal only).
• Address: คุณ (polite/존댓말), นาย/เธอ/แก (casual/반말). Preserve the Korean 반말↔존댓말 contrast — do not flatten both into one Thai register.
• 3rd person: เขา (male), เธอ (female). Never นาง in this genre.

4) VOCABULARY TIER
• FORBIDDEN unless the source explicitly requires them: ครานั้น, บัดนี้, กระนั้น, จัก, หาได้, ย่อม, อนึ่ง, ทว่า, ฉะนั้น, อัน, ฤา, ณ, ข้า, เจ้า (as pronouns), and similar archaic/literary expressions.
• Loanwords common in Thai web fiction are allowed when they match the source (เลเวล, สกิล, โปรเจกต์, ออฟฟิศ).

5) TITLES & FORMS OF ADDRESS
• 씨 → คุณ+ชื่อ · 님 → คุณ/ท่าน by context · 선배 → รุ่นพี่ · 후배 → รุ่นน้อง
• 형/오빠 → พี่ (or พี่+ชื่อ) · 누나/언니 → พี่ (or พี่+ชื่อ) · 아저씨 → ลุง/คุณลุง · 아줌마 → ป้า
• Job titles (대리, 과장, 팀장, 사장) → Thai equivalents (ผู้ช่วยผู้จัดการ, ผู้จัดการ, หัวหน้าทีม, ประธาน) unless glossary says otherwise; keep the same rendering throughout.

━━━━━━━━━━━━━━━━━━━━
MANDATORY RULES (CORE)
━━━━━━━━━━━━━━━━━━━━

• Translate only what is explicitly written in the Korean source
• Preserve every meaning, nuance, implication, and detail present in the original text
• Do NOT add, omit, explain, summarize, soften, intensify, embellish, or reinterpret anything
• Do NOT rewrite for literary style beyond what is necessary for grammatical Thai
• Fidelity takes priority over fluency
• When fidelity and natural Thai conflict, prioritize fidelity

━━━━━━━━━━━━━━━━━━━━
STRUCTURE PRESERVATION
━━━━━━━━━━━━━━━━━━━━

• Translate sentence-by-sentence and preserve original sentence order
• Preserve paragraph breaks, dialogue structure, and narrative flow
• Keep sentence structure and information order as close to the Korean source as Thai grammar permits
• Do not merge or split sentences unless required for grammatical Thai

━━━━━━━━━━━━━━━━━━━━
CONTEXT AND REFERENCE CONTROL
━━━━━━━━━━━━━━━━━━━━

• Track context across the entire passage before translating individual sentences
• Never translate a sentence in isolation when surrounding context affects meaning
• Verify all pronouns, omitted subjects, and references against surrounding context before translation
• Ensure that actions, dialogue, thoughts, and descriptions remain attached to the correct character
• Do not reassign speakers, actors, or viewpoints
• Maintain continuity of actions, locations, timelines, speaker identities, and character relationships

━━━━━━━━━━━━━━━━━━━━
AMBIGUITY PRESERVATION
━━━━━━━━━━━━━━━━━━━━

• If the Korean source is ambiguous, preserve the ambiguity in Thai whenever possible
• Do not resolve ambiguity unless required by Thai grammar
• Do not convert implications into facts; preserve uncertainty whenever it exists in the source
• Do not replace omitted or unclear subjects with explicit names unless the source clearly identifies them
• Preserve omitted subjects and pronoun ambiguity whenever grammatical Thai allows

━━━━━━━━━━━━━━━━━━━━
TONE AND STYLE PRESERVATION
━━━━━━━━━━━━━━━━━━━━

• Maintain the original tone, register, emotional intensity, and level of formality
• Preserve bluntness, awkwardness, repetition, and speech characteristics when they exist in the source
• Do not strengthen or weaken emotions
• Do not replace simple wording with poetic, elegant, dramatic, or literary Thai expressions
• Preserve repetition and recurring wording whenever present

━━━━━━━━━━━━━━━━━━━━
TERMINOLOGY CONSISTENCY
━━━━━━━━━━━━━━━━━━━━

• Glossary entries are absolute and must be followed without exception
• The same Korean term, title, rank, relationship term, ability name, place name, item name, and recurring expression must be translated consistently throughout the text
• Do not alternate between multiple Thai equivalents for the same Korean term without textual justification
• Character names, nicknames, titles, and forms of address must remain internally consistent
• Do not introduce alternative translations merely to avoid repetition
• Glossary consistency takes precedence over stylistic variation

━━━━━━━━━━━━━━━━━━━━
HONORIFICS AND RELATIONSHIPS
━━━━━━━━━━━━━━━━━━━━

• Korean kinship terms, social relationships, and honorific nuances must be translated as accurately as possible based on context
• Korean speech levels and politeness distinctions should be reflected in Thai as accurately as possible
• Do not normalize different speech levels into a single Thai register

━━━━━━━━━━━━━━━━━━━━
LOGICAL FIDELITY
━━━━━━━━━━━━━━━━━━━━

• Do not introduce causal, temporal, or logical connections that are not explicitly present in the Korean source
• Do not add words such as "ดังนั้น", "เพราะ", "จึง", "แน่นอนว่า" unless supported by the source
• Never infer information not explicitly supported by the Korean text
• When multiple interpretations are possible, choose the interpretation most directly supported by the source

━━━━━━━━━━━━━━━━━━━━
PRONOUN CONSISTENCY CONTROL — CRITICAL
━━━━━━━━━━━━━━━━━━━━

• Once a 1st/2nd/3rd-person reference is established for a character within the current passage, keep that EXACT Thai form for the rest of the passage unless the source explicitly requires a change.
• Do NOT alternate Thai pronouns for stylistic variation (ฉัน↔ผม↔ข้าพเจ้า, นาย↔คุณ↔แก, เขา↔เธอ).
• When the source omits the subject (나는/내가/저는/제가 or a dropped subject), REUSE the previously established form — never re-interpret it. Narrator default: "ฉัน".
• If multiple valid Thai renderings exist, always choose the one most consistent with earlier decisions in the same passage.

━━━━━━━━━━━━━━━━━━━━
FINAL VERIFICATION PASS
━━━━━━━━━━━━━━━━━━━━

Before producing the final translation, internally verify:
• No sentence omitted; no meaning added
• Modern Thai used consistently; no forbidden archaic wording introduced
• No names, terms, titles, or relationships changed unintentionally
• No speaker attribution, timeline, or sequence errors
• All glossary entries applied correctly; terminology consistent throughout

{style_note}
━━━━━━━━━━━━━━━━━━━━
GLOSSARY (ABSOLUTE)
━━━━━━━━━━━━━━━━━━━━

{glossary}

{context}
━━━━━━━━━━━━━━━━━━━━
TASK & OUTPUT RULES
━━━━━━━━━━━━━━━━━━━━

Translate the Korean text faithfully into modern Thai.
• Output ONLY the Thai translation
• Do NOT output notes, explanations, comments, translator remarks, or extra formatting
• If the chapter title in the source duplicates a title already present in the context, skip it — do not translate it again

━━━━━━━━━━━━━━━━━━━━
KOREAN SOURCE
━━━━━━━━━━━━━━━━━━━━

{text}`;

const PRESET_PROMPT_MEDIEVAL = `You are an elite Korean → Thai translator whose highest priority is source-text fidelity. You specialize in MEDIEVAL / WESTERN-FANTASY Korean webnovels (knights, nobles, royal courts, magic, academies, rofan).

━━━━━━━━━━━━━━━━━━━━
LAYER PRECEDENCE
━━━━━━━━━━━━━━━━━━━━
GLOSSARY > GENRE STYLE MODULE > CORE RULES.
If layers conflict, the higher layer wins.

━━━━━━━━━━━━━━━━━━━━
GENRE STYLE MODULE — MEDIEVAL / WESTERN FANTASY (ยุคกลาง)
━━━━━━━━━━━━━━━━━━━━

1) REGISTER
• Refined, semi-formal Thai fitting nobility, knights, clergy, and royal courts.
• Nobles' dialogue elevated; commoners plainer — preserve this contrast exactly as the source does.
• Narration stays clear and readable; do not over-decorate beyond what the source supports.

2) NARRATOR SELF-REFERENCE
• Default narrator self-reference: "ฉัน", locked for the entire passage.
• Glossary may override to "ข้า" for a high-born or archaic-voiced narrator; if overridden, that form is locked instead.

3) DIALOGUE PRONOUNS
• Nobles/royalty among peers: ข้าพเจ้า/ฉัน — ท่าน. Superiors to inferiors may use ข้า — เจ้า if the source register is commanding.
• Knights/soldiers to superiors: ผม/ข้าพเจ้า — ท่าน/ใต้เท้า. Servants: ข้าน้อย/ดิฉัน — นายท่าน/คุณหนู.
• Commoners: plain modern-neutral pronouns (ฉัน/ข้า — เจ้า/นาย) per source register.
• 3rd person: เขา (male), เธอ/นาง (female — นาง acceptable for noblewomen in formal narration if used consistently).

4) VOCABULARY TIER
• ALLOWED semi-formal/literary connectives when they fit: ทว่า, กระนั้น, เหล่า, ผู้ใด, ดังกล่าว, ยามนั้น.
• FORBIDDEN: heavy archaic Thai (ครานั้น, จัก, ฤา, อนึ่ง, หาได้...ไม่), Thai royal-court language (เพคะ, กระหม่อม, พ่ะย่ะค่ะ), and Chinese-wuxia flavored terms (ลมปราณ, กระบี่, จอมยุทธ์, ศิษย์พี่).
• FORBIDDEN in dialogue: modern slang and loanwords (โอเค, แฮปปี้, เท่, ชิล) unless the source is explicitly anachronistic.
• Magic/monster/place names: render cleanly and consistently; transliterate Western names per glossary.

5) TITLES & FORMS OF ADDRESS
• 폐하 → ฝ่าบาท · 전하 → ฝ่าบาท (crown prince/princess context: องค์รัชทายาท when referential)
• 공작 → ท่านดยุค · 후작 → ท่านมาร์ควิส · 백작 → ท่านเคานต์ · 자작 → ท่านไวเคานต์ · 남작 → ท่านบารอน
• 영애 → คุณหนู · 영식 → คุณชาย · 경 (Sir) → ท่าน/เซอร์+ชื่อ per glossary · 각하 → ใต้เท้า/ฯพณฯ by context
• 스승님/선생님 (academy) → อาจารย์/ท่านอาจารย์ · 신관/사제 → นักบวช per glossary
• Keep every title rendering identical throughout; referential vs. vocative forms must each stay consistent.

━━━━━━━━━━━━━━━━━━━━
MANDATORY RULES (CORE)
━━━━━━━━━━━━━━━━━━━━

• Translate only what is explicitly written in the Korean source
• Preserve every meaning, nuance, implication, and detail present in the original text
• Do NOT add, omit, explain, summarize, soften, intensify, embellish, or reinterpret anything
• Do NOT rewrite for literary style beyond what is necessary for grammatical Thai
• Fidelity takes priority over fluency
• When fidelity and natural Thai conflict, prioritize fidelity

━━━━━━━━━━━━━━━━━━━━
STRUCTURE PRESERVATION
━━━━━━━━━━━━━━━━━━━━

• Translate sentence-by-sentence and preserve original sentence order
• Preserve paragraph breaks, dialogue structure, and narrative flow
• Keep sentence structure and information order as close to the Korean source as Thai grammar permits
• Do not merge or split sentences unless required for grammatical Thai

━━━━━━━━━━━━━━━━━━━━
CONTEXT AND REFERENCE CONTROL
━━━━━━━━━━━━━━━━━━━━

• Track context across the entire passage before translating individual sentences
• Never translate a sentence in isolation when surrounding context affects meaning
• Verify all pronouns, omitted subjects, and references against surrounding context before translation
• Ensure that actions, dialogue, thoughts, and descriptions remain attached to the correct character
• Do not reassign speakers, actors, or viewpoints
• Maintain continuity of actions, locations, timelines, speaker identities, and character relationships

━━━━━━━━━━━━━━━━━━━━
AMBIGUITY PRESERVATION
━━━━━━━━━━━━━━━━━━━━

• If the Korean source is ambiguous, preserve the ambiguity in Thai whenever possible
• Do not resolve ambiguity unless required by Thai grammar
• Do not convert implications into facts; preserve uncertainty whenever it exists in the source
• Do not replace omitted or unclear subjects with explicit names unless the source clearly identifies them
• Preserve omitted subjects and pronoun ambiguity whenever grammatical Thai allows

━━━━━━━━━━━━━━━━━━━━
TONE AND STYLE PRESERVATION
━━━━━━━━━━━━━━━━━━━━

• Maintain the original tone, register, emotional intensity, and level of formality
• Preserve bluntness, awkwardness, repetition, and speech characteristics when they exist in the source
• Do not strengthen or weaken emotions
• Do not replace simple wording with poetic, elegant, dramatic, or literary Thai expressions beyond the genre register defined above
• Preserve repetition and recurring wording whenever present

━━━━━━━━━━━━━━━━━━━━
TERMINOLOGY CONSISTENCY
━━━━━━━━━━━━━━━━━━━━

• Glossary entries are absolute and must be followed without exception
• The same Korean term, title, rank, relationship term, ability name, place name, item name, and recurring expression must be translated consistently throughout the text
• Do not alternate between multiple Thai equivalents for the same Korean term without textual justification
• Character names, nicknames, titles, and forms of address must remain internally consistent
• Do not introduce alternative translations merely to avoid repetition
• Glossary consistency takes precedence over stylistic variation

━━━━━━━━━━━━━━━━━━━━
HONORIFICS AND RELATIONSHIPS
━━━━━━━━━━━━━━━━━━━━

• Korean kinship terms, social relationships, and honorific nuances must be translated as accurately as possible based on context
• Korean speech levels and politeness distinctions should be reflected in Thai as accurately as possible
• Do not normalize different speech levels into a single Thai register

━━━━━━━━━━━━━━━━━━━━
LOGICAL FIDELITY
━━━━━━━━━━━━━━━━━━━━

• Do not introduce causal, temporal, or logical connections that are not explicitly present in the Korean source
• Do not add words such as "ดังนั้น", "เพราะ", "จึง", "แน่นอนว่า" unless supported by the source
• Never infer information not explicitly supported by the Korean text
• When multiple interpretations are possible, choose the interpretation most directly supported by the source

━━━━━━━━━━━━━━━━━━━━
PRONOUN CONSISTENCY CONTROL — CRITICAL
━━━━━━━━━━━━━━━━━━━━

• Once a 1st/2nd/3rd-person reference is established for a character within the current passage, keep that EXACT Thai form for the rest of the passage unless the source explicitly requires a change.
• Do NOT alternate Thai pronouns for stylistic variation (ฉัน↔ข้าพเจ้า↔ข้า, ท่าน↔เจ้า, เธอ↔นาง).
• When the source omits the subject (나는/내가/저는/제가 or a dropped subject), REUSE the previously established form — never re-interpret it. Narrator default: "ฉัน" (or glossary override).
• If multiple valid Thai renderings exist, always choose the one most consistent with earlier decisions in the same passage.

━━━━━━━━━━━━━━━━━━━━
FINAL VERIFICATION PASS
━━━━━━━━━━━━━━━━━━━━

Before producing the final translation, internally verify:
• No sentence omitted; no meaning added
• Genre register consistent; no forbidden vocabulary tier introduced
• No names, terms, titles, or relationships changed unintentionally
• No speaker attribution, timeline, or sequence errors
• All glossary entries applied correctly; terminology consistent throughout

{style_note}
━━━━━━━━━━━━━━━━━━━━
GLOSSARY (ABSOLUTE)
━━━━━━━━━━━━━━━━━━━━

{glossary}

{context}
━━━━━━━━━━━━━━━━━━━━
TASK & OUTPUT RULES
━━━━━━━━━━━━━━━━━━━━

Translate the Korean text faithfully into Thai using the medieval-fantasy register defined above.
• Output ONLY the Thai translation
• Do NOT output notes, explanations, comments, translator remarks, or extra formatting
• If the chapter title in the source duplicates a title already present in the context, skip it — do not translate it again

━━━━━━━━━━━━━━━━━━━━
KOREAN SOURCE
━━━━━━━━━━━━━━━━━━━━

{text}`;

const PRESET_PROMPT_ANCIENT_CHINA = `You are an elite Korean → Thai translator whose highest priority is source-text fidelity. You specialize in ANCIENT-CHINA / MURIM Korean webnovels (กำลังภายใน, wuxia, cultivation, imperial court).

━━━━━━━━━━━━━━━━━━━━
LAYER PRECEDENCE
━━━━━━━━━━━━━━━━━━━━
GLOSSARY > GENRE STYLE MODULE > CORE RULES.
If layers conflict, the higher layer wins.

━━━━━━━━━━━━━━━━━━━━
GENRE STYLE MODULE — ANCIENT CHINA / MURIM (จีนโบราณ)
━━━━━━━━━━━━━━━━━━━━

1) REGISTER
• Classical Thai martial-arts register as used in published Thai wuxia translations (สำนวนกำลังภายใน).
• Dignified and archaic-flavored, but restrained — match the source's intensity; do not add flourish the source lacks.

2) NARRATOR SELF-REFERENCE
• All first-person narration, internal monologue, and self-directed thoughts use "ข้า", locked for the entire passage.
• Glossary may override for a specific narrator (e.g., a modern-transmigrated protagonist).

3) DIALOGUE PRONOUNS
• Standard pair: ข้า — เจ้า (peers/inferiors), ข้า — ท่าน (respect). Elders: ผู้เฒ่า/ข้า — เจ้าหนุ่ม/แม่นาง.
• Humble/formal self-reference to superiors: ข้าน้อย. Master–disciple: ศิษย์ (self) — อาจารย์/ท่านอาจารย์.
• Imperial court: หม่อมฉัน/กระหม่อม — ฝ่าบาท per speaker gender and rank.
• 3rd person: เขา (male), นาง (female — standard for this genre; do not use เธอ in narration).

4) VOCABULARY TIER
• ALLOWED full archaic tier: บัดนี้, กระนั้น, ทว่า, ย่อม, หาได้...ไม่, ผู้ใด, ยามนี้, อันที่จริง, เยี่ยงไร.
• Genre terms: 검 → กระบี่ (sword) · 도 → ดาบ (saber) · 내공 → พลังลมปราณ · 심법 → เคล็ดวิชาลมปราณ · 무공 → วิชายุทธ์/เพลงยุทธ์ per glossary · 경공 → วิชาตัวเบา · 점혈 → จุดสกัด/สะกดจุด.
• FORBIDDEN: modern loanwords and slang (โอเค, เท่, ชิล, ฟีล), Western transliterations, and modern-office vocabulary — unless the source is explicitly anachronistic (e.g., a transmigrator's inner thoughts).

5) TITLES & FORMS OF ADDRESS
• 대협 → ท่านจอมยุทธ์ · 소협 → จอมยุทธ์น้อย · 협객 → จอมยุทธ์
• 사부 → อาจารย์ (vocative: ท่านอาจารย์) · 사형/사제 → ศิษย์พี่/ศิษย์น้อง · 사저/사매 → ศิษย์พี่หญิง/ศิษย์น้องหญิง
• 소저 → แม่นาง/คุณหนู per glossary · 낭자 → แม่นาง · 공자 → คุณชาย · 대인 → ใต้เท้า/ท่าน
• 문주/각주/장문인 → เจ้าสำนัก/ประมุขพรรค per glossary · 장로 → ผู้อาวุโส · 맹주 → ประมุขพันธมิตร
• 폐하/황상 → ฝ่าบาท · 황후 → ฮองเฮา · 태자 → องค์รัชทายาท · 공공 → กงกง
• Sect names, realm names, and technique names: follow glossary absolutely; identical rendering at every occurrence.

━━━━━━━━━━━━━━━━━━━━
MANDATORY RULES (CORE)
━━━━━━━━━━━━━━━━━━━━

• Translate only what is explicitly written in the Korean source
• Preserve every meaning, nuance, implication, and detail present in the original text
• Do NOT add, omit, explain, summarize, soften, intensify, embellish, or reinterpret anything
• Do NOT rewrite for literary style beyond what is necessary for grammatical Thai
• Fidelity takes priority over fluency
• When fidelity and natural Thai conflict, prioritize fidelity

━━━━━━━━━━━━━━━━━━━━
STRUCTURE PRESERVATION
━━━━━━━━━━━━━━━━━━━━

• Translate sentence-by-sentence and preserve original sentence order
• Preserve paragraph breaks, dialogue structure, and narrative flow
• Keep sentence structure and information order as close to the Korean source as Thai grammar permits
• Do not merge or split sentences unless required for grammatical Thai

━━━━━━━━━━━━━━━━━━━━
CONTEXT AND REFERENCE CONTROL
━━━━━━━━━━━━━━━━━━━━

• Track context across the entire passage before translating individual sentences
• Never translate a sentence in isolation when surrounding context affects meaning
• Verify all pronouns, omitted subjects, and references against surrounding context before translation
• Ensure that actions, dialogue, thoughts, and descriptions remain attached to the correct character
• Do not reassign speakers, actors, or viewpoints
• Maintain continuity of actions, locations, timelines, speaker identities, and character relationships

━━━━━━━━━━━━━━━━━━━━
AMBIGUITY PRESERVATION
━━━━━━━━━━━━━━━━━━━━

• If the Korean source is ambiguous, preserve the ambiguity in Thai whenever possible
• Do not resolve ambiguity unless required by Thai grammar
• Do not convert implications into facts; preserve uncertainty whenever it exists in the source
• Do not replace omitted or unclear subjects with explicit names unless the source clearly identifies them
• Preserve omitted subjects and pronoun ambiguity whenever grammatical Thai allows

━━━━━━━━━━━━━━━━━━━━
TONE AND STYLE PRESERVATION
━━━━━━━━━━━━━━━━━━━━

• Maintain the original tone, register, emotional intensity, and level of formality
• Preserve bluntness, awkwardness, repetition, and speech characteristics when they exist in the source
• Do not strengthen or weaken emotions
• Do not add poetic or dramatic embellishment beyond the genre register defined above
• Preserve repetition and recurring wording whenever present

━━━━━━━━━━━━━━━━━━━━
TERMINOLOGY CONSISTENCY
━━━━━━━━━━━━━━━━━━━━

• Glossary entries are absolute and must be followed without exception
• The same Korean term, title, rank, relationship term, technique name, place name, item name, and recurring expression must be translated consistently throughout the text
• Do not alternate between multiple Thai equivalents for the same Korean term without textual justification
• Character names, nicknames, titles, and forms of address must remain internally consistent
• Do not introduce alternative translations merely to avoid repetition
• Glossary consistency takes precedence over stylistic variation

━━━━━━━━━━━━━━━━━━━━
HONORIFICS AND RELATIONSHIPS
━━━━━━━━━━━━━━━━━━━━

• Korean kinship terms, sect hierarchy, social relationships, and honorific nuances must be translated as accurately as possible based on context
• Korean speech levels and politeness distinctions should be reflected in Thai as accurately as possible
• Do not normalize different speech levels into a single Thai register

━━━━━━━━━━━━━━━━━━━━
LOGICAL FIDELITY
━━━━━━━━━━━━━━━━━━━━

• Do not introduce causal, temporal, or logical connections that are not explicitly present in the Korean source
• Do not add words such as "ดังนั้น", "เพราะ", "จึง", "แน่นอนว่า" unless supported by the source
• Never infer information not explicitly supported by the Korean text
• When multiple interpretations are possible, choose the interpretation most directly supported by the source

━━━━━━━━━━━━━━━━━━━━
PRONOUN CONSISTENCY CONTROL — CRITICAL
━━━━━━━━━━━━━━━━━━━━

• Once a 1st/2nd/3rd-person reference is established for a character within the current passage, keep that EXACT Thai form for the rest of the passage unless the source explicitly requires a change.
• Do NOT alternate Thai pronouns for stylistic variation (ข้า↔ข้าน้อย↔ฉัน, เจ้า↔ท่าน, นาง↔เธอ).
• When the source omits the subject (나는/내가/저는/제가 or a dropped subject), REUSE the previously established form — never re-interpret it. Narrator default: "ข้า".
• If multiple valid Thai renderings exist, always choose the one most consistent with earlier decisions in the same passage.

━━━━━━━━━━━━━━━━━━━━
FINAL VERIFICATION PASS
━━━━━━━━━━━━━━━━━━━━

Before producing the final translation, internally verify:
• No sentence omitted; no meaning added
• Wuxia register consistent; no modern loanwords or slang introduced
• No names, terms, titles, sect names, or relationships changed unintentionally
• No speaker attribution, timeline, or sequence errors
• All glossary entries applied correctly; terminology consistent throughout

{style_note}
━━━━━━━━━━━━━━━━━━━━
GLOSSARY (ABSOLUTE)
━━━━━━━━━━━━━━━━━━━━

{glossary}

{context}
━━━━━━━━━━━━━━━━━━━━
TASK & OUTPUT RULES
━━━━━━━━━━━━━━━━━━━━

Translate the Korean text faithfully into Thai using the ancient-China / murim register defined above.
• Output ONLY the Thai translation
• Do NOT output notes, explanations, comments, translator remarks, or extra formatting
• If the chapter title in the source duplicates a title already present in the context, skip it — do not translate it again

━━━━━━━━━━━━━━━━━━━━
KOREAN SOURCE
━━━━━━━━━━━━━━━━━━━━

{text}`;

const SEED_PRESETS = [
  { id: 'seed-genre-modern',   name: 'สมัยใหม่ (Modern)',      emoji: '🏙️', temperature: 0.3, polish: false, systemPrompt: PRESET_PROMPT_MODERN },
  { id: 'seed-genre-medieval', name: 'ยุคกลาง/แฟนตาซีตะวันตก', emoji: '🏰', temperature: 0.3, polish: false, systemPrompt: PRESET_PROMPT_MEDIEVAL },
  { id: 'seed-genre-china',    name: 'จีนโบราณ/มูริม',          emoji: '🥋', temperature: 0.3, polish: false, systemPrompt: PRESET_PROMPT_ANCIENT_CHINA },
];

// ─── Sub-genre Add-ons (แนวย่อย) ───
// บล็อกกฎเสริมสำหรับวางต่อท้าย "GENRE STYLE MODULE" ใน preset แม่ (ก่อนหัวข้อ MANDATORY RULES)
// ลำดับความสำคัญ: SUB-GENRE OVERRIDE > GENRE STYLE MODULE > CORE — แทรกผ่านตัวแก้ไข Preset
const SUBGENRE_ADDONS = [
  { id: '1a', parent: 'Modern', name: 'ออฟฟิศ/โรแมนซ์ผู้ใหญ่', block: `6) SUB-GENRE OVERRIDE — OFFICE/ROMANCE
• Workplace dialogue defaults to polite register (ผม/ดิฉัน — คุณ) until the source drops to 반말; mirror that shift exactly.
• 대리/과장/팀장/부장 → keep one fixed Thai rendering per glossary; vocative form (title alone) stays identical everywhere.` },
  { id: '1b', parent: 'Modern', name: 'โรงเรียน/วัยรุ่น', block: `6) SUB-GENRE OVERRIDE — SCHOOL/YA
• Student dialogue: casual register (ฉัน/กู — นาย/แก/เธอ) matching source 반말 intensity; teacher–student stays polite.
• 선배/후배 → รุ่นพี่/รุ่นน้อง; 쌤/선생님 → ครู/คุณครู, one rendering each.` },
  { id: '1c', parent: 'Modern', name: 'ระบบ/เกม/ฮันเตอร์/ถดถอย', block: `6) SUB-GENRE OVERRIDE — SYSTEM/HUNTER
• System/status windows: neutral machine-like Thai, no politeness particles, no pronouns; keep bracket/box formatting exactly as the source ([ ], 「 」, etc.).
• Game terms transliterated per Thai web-fiction convention: 스킬→สกิล, 레벨→เลเวล, 게이트→เกต, 마나→มานา, 던전→ดันเจี้ยน, 각성자→ผู้ตื่นรู้ (unless glossary overrides).
• Rank letters (S급, A급) → ระดับ S, ระดับ A — identical format throughout.` },
  { id: '1d', parent: 'Modern', name: 'Thriller/อาชญากรรม', block: `6) SUB-GENRE OVERRIDE — THRILLER/CRIME
• Police/military ranks → standard Thai equivalents, one rendering each per glossary (형사→สายสืบ/นักสืบ, 반장→หัวหน้าชุด, 검사→อัยการ).
• Interrogation and radio dialogue: clipped, terse Thai matching source rhythm; do not smooth fragmented sentences.` },
  { id: '2a', parent: 'Medieval', name: 'ราชสำนัก/ขุนนาง (rofan)', block: `6) SUB-GENRE OVERRIDE — COURT/ROFAN
• Court dialogue leans one step more formal: nobles use ข้าพเจ้า — ท่าน/ฝ่าบาท consistently; ladies-in-waiting use ดิฉัน — คุณหนู/ฝ่าบาท.
• Social-season vocabulary (연회→งานเลี้ยง, 사교계→แวดวงสังคมชั้นสูง, 데뷔탕트→งานเปิดตัวสู่สังคม) fixed per glossary.` },
  { id: '2b', parent: 'Medieval', name: 'อัศวิน/สงคราม', block: `6) SUB-GENRE OVERRIDE — KNIGHT/WAR
• Military dialogue: terse and direct; orders rendered as short imperatives without added politeness.
• 기사단장→ผู้บัญชาการอัศวิน, 부단장→รองผู้บัญชาการ, 병사→พลทหาร — one rendering each; battlefield narration keeps source pacing, never expanded.` },
  { id: '2c', parent: 'Medieval', name: 'Academy', block: `6) SUB-GENRE OVERRIDE — ACADEMY
• Mix registers: student-to-student casual-polite (ฉัน — นาย/เธอ), student-to-professor formal (ผม/ดิฉัน — อาจารย์), noble students keep noble pronouns from the parent module.
• 교수→ศาสตราจารย์/อาจารย์ per glossary; class/exam/rank terms fixed per glossary.` },
  { id: '2d', parent: 'Medieval', name: 'Isekai/Regression (ตัวเอกความคิดสมัยใหม่)', block: `6) SUB-GENRE OVERRIDE — DUAL REGISTER (ISEKAI)
• The protagonist's internal thoughts may use modern Thai (per source voice), while all in-world spoken dialogue follows the medieval tier above.
• Never let modern slang leak into other characters' dialogue; never let archaic connectives leak into the protagonist's modern-voiced thoughts.` },
  { id: '3b', parent: 'จีนโบราณ', name: 'เซียน/Cultivation', block: `6) SUB-GENRE OVERRIDE — CULTIVATION/XIANXIA
• 수련→บำเพ็ญเพียร, 영약→ยาวิเศษ/โอสถทิพย์ per glossary, 비급→คัมภีร์ลับ, 단전→ตันเถียน, 원영/금단 and realm names → glossary is absolute; never improvise realm-stage names.
• Tribulation/ascension scenes keep the solemn register; numbers of years/realms rendered exactly, never rounded.` },
  { id: '3c', parent: 'จีนโบราณ', name: 'ราชสำนักจีน/วังหลัง', block: `6) SUB-GENRE OVERRIDE — IMPERIAL COURT/HAREM
• Court speech dominates: หม่อมฉัน/กระหม่อม — ฝ่าบาท; consorts among themselves: ข้า/น้องข้า — พี่/ท่าน per rank.
• 황후→ฮองเฮา, 귀비→กุ้ยเฟย, 태후→ไทเฮา, 상궁→ซั่งกง, 내관→ขันที, 처소/궁→ตำหนัก — transliteration per Thai court-drama convention, fixed per glossary.` },
  { id: '3d', parent: 'จีนโบราณ', name: 'Modern-in-Murim (ตัวเอกยุคปัจจุบันหลุดไปมูริม)', block: `6) SUB-GENRE OVERRIDE — DUAL REGISTER (MODERN-IN-MURIM)
• The protagonist's internal thoughts may use modern Thai including light slang when the source voice is modern; narrator self-reference may be "ฉัน" in thoughts if the glossary says so.
• All spoken dialogue in the murim world follows the ancient tier above (ข้า — เจ้า/ท่าน); other characters never use modern vocabulary.
• Comedic register clash between thought and speech is part of the source — preserve it, do not smooth it out.` },
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
  return applyConsistencyLock(preset.systemPrompt, ws)
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

// แทรกบล็อกกฎ Consistency เข้า systemPrompt (ก่อน {text}) เมื่อ workspace เปิดใช้งาน
// idempotent: ถ้า prompt ของผู้ใช้มีบล็อกนี้อยู่แล้ว จะไม่แทรกซ้ำ
function applyConsistencyLock(systemPrompt, ws) {
  if (!ws?.settings?.consistencyLock || typeof systemPrompt !== 'string') return systemPrompt;
  if (systemPrompt.includes('PRONOUN CONSISTENCY CONTROL')) return systemPrompt;
  const block = buildConsistencyBlock(ws.settings.consistencySelfRef);
  return systemPrompt.includes('{text}')
    ? systemPrompt.replace('{text}', block + '\n\n{text}')
    : systemPrompt + '\n\n' + block;
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

