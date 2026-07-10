// ═══ prompts.js — prompt templates ทุก action (โครง 4 ชั้น) ═══
//
// [1] SYSTEM: บทบาท "ผู้ช่วยนักเขียนนิยายไทย" + กฎภาษา + genre prompt
// [2] WORLD CONTEXT: รายการ Codex ที่เลือกจาก Context Picker
// [3] STORY MEMORY: synopsis + สรุป N ตอนล่าสุด
// [4] TASK: คำสั่งเฉพาะ action + เนื้อหาที่เกี่ยว + คำกำกับจากผู้ใช้

import { genrePrompt } from './genres.js';

const BASE_SYSTEM = `คุณคือ "ผู้ช่วยนักเขียนนิยายไทย" มืออาชีพ ทำงานเคียงข้างผู้เขียน ไม่ใช่เขียนแทน

กฎเหล็ก:
1. ตอบเป็นภาษาไทยเท่านั้น (ยกเว้นชื่อเฉพาะ/ศัพท์ที่เรื่องกำหนดไว้)
2. ใช้ชื่อตัวละคร สถานที่ สกิล ไอเทม ตาม WORLD CONTEXT เท่านั้น — ห้ามแปลง สะกดใหม่ หรือคิดชื่อทับของเดิม
3. รักษาความต่อเนื่องกับ STORY MEMORY อย่างเคร่งครัด ห้ามขัดแย้งกับเหตุการณ์ที่เกิดไปแล้ว
4. เลียนสำนวน โทน ระดับภาษา และสรรพนามตามเนื้อหาต้นฉบับของผู้เขียน
5. ทำเฉพาะสิ่งที่ TASK สั่ง — ไม่เกริ่นนำ ไม่อธิบายตัวเอง ไม่ใส่หัวข้อหรือคำลงท้ายที่ไม่ได้ขอ`;

const TYPE_LABELS = {
  character: 'ตัวละคร',
  place: 'สถานที่',
  skill: 'สกิล/วิชา',
  item: 'ไอเทม/ของ',
  rule: 'กฎของโลก',
  other: 'อื่นๆ',
};

export function typeLabel(t) { return TYPE_LABELS[t] || t; }

// จัดรูปแบบ Codex entries เป็นบล็อก WORLD CONTEXT กระชับ
export function formatWorldContext(entries) {
  if (!entries?.length) return '';
  const byType = {};
  for (const e of entries) (byType[e.type] ||= []).push(e);
  const lines = [];
  for (const [type, list] of Object.entries(byType)) {
    lines.push(`## ${TYPE_LABELS[type] || type}`);
    for (const e of list) {
      const alias = e.aliases?.length ? ` (ชื่ออื่น: ${e.aliases.join(', ')})` : '';
      lines.push(`- ${e.name}${alias}: ${(e.description || '').trim()}`);
    }
  }
  return lines.join('\n');
}

// ประกอบ messages ตามโครง 4 ชั้น
export function buildMessages({ project, settings, worldContext, storyMemory, task }) {
  const sysParts = [BASE_SYSTEM];
  const gp = genrePrompt(project, settings);
  if (gp) sysParts.push(gp);

  const userParts = [];
  if (worldContext) userParts.push(`═══ WORLD CONTEXT (ข้อมูลโลกของเรื่อง) ═══\n${worldContext}`);
  if (storyMemory) userParts.push(`═══ STORY MEMORY (เรื่องราวถึงปัจจุบัน) ═══\n${storyMemory}`);
  userParts.push(`═══ TASK ═══\n${task}`);

  return [
    { role: 'system', content: sysParts.join('\n\n') },
    { role: 'user', content: userParts.join('\n\n') },
  ];
}

const noteLine = (userNote) => userNote?.trim() ? `\nคำกำกับเพิ่มเติมจากผู้เขียน (สำคัญ): ${userNote.trim()}` : '';

// ── TASK ต่อ action ──

export function taskContinue({ tailText, length, userNote }) {
  const lenMap = { short: '1 ย่อหน้า', medium: '2-3 ย่อหน้า', long: '4-5 ย่อหน้า' };
  return `นี่คือส่วนท้ายของตอนที่กำลังเขียน:
---
${tailText}
---
เขียนต่อจากจุดที่ค้างไว้ ${lenMap[length] || '2-3 ย่อหน้า'} ให้เนื้อเรื่องไหลลื่นต่อเนื่อง สำนวนและจังหวะเดียวกับต้นฉบับ${noteLine(userNote)}

ตอบเฉพาะเนื้อหาที่เขียนต่อเท่านั้น ห้ามทวนข้อความเดิม`;
}

export function taskRefine({ selectedText, tone, userNote }) {
  return `เกลาสำนวนข้อความต่อไปนี้ให้ดีขึ้น: ลื่นไหล กระชับ เห็นภาพ คงความหมายและเหตุการณ์เดิมครบถ้วน
โทนที่ต้องการ: ${tone || 'คงโทนเดิมของต้นฉบับ'}
---
${selectedText}
---${noteLine(userNote)}

ตอบเฉพาะข้อความเวอร์ชันเกลาแล้วเท่านั้น`;
}

export function taskName({ nameType, hint, existingNames, userNote }) {
  return `คิดชื่อ${TYPE_LABELS[nameType] || nameType}ใหม่ให้ 8-10 ชื่อ ให้เข้ากับแนวเรื่องและโลกของเรื่อง
โจทย์/คำใบ้: ${hint || '(ไม่ระบุ — คิดให้เข้ากับเรื่อง)'}
${existingNames?.length ? `ชื่อที่มีอยู่แล้วในเรื่อง (ห้ามซ้ำ และให้โทนเข้ากัน): ${existingNames.join(', ')}` : ''}${noteLine(userNote)}

ตอบเป็นรายการ 1 บรรทัดต่อ 1 ชื่อ รูปแบบ:
ชื่อ — ความหมาย/ที่มาสั้นๆ
ห้ามใส่ข้อความอื่นนอกจากรายการ`;
}

export function taskCheck({ chapterText, userNote }) {
  return `ตรวจความต่อเนื่องของเนื้อหาตอนนี้ เทียบกับ WORLD CONTEXT และ STORY MEMORY:
---
${chapterText}
---
หาจุดผิดพลาดประเภท: ชื่อสะกดผิด/เพี้ยนจาก Codex, ข้อมูลขัดแย้งกับตอนก่อนหรือ Codex, ตรรกะ/ไทม์ไลน์หลุด, ตัวละครทำสิ่งที่ขัดกับข้อมูลตัวละคร${noteLine(userNote)}

ตอบเป็น JSON array เท่านั้น (ไม่มีข้อความอื่น ไม่มี markdown fence) รูปแบบ:
[{"type":"ประเภทปัญหา","location":"คำพูดสั้นๆ ที่คัดลอกตรงจากเนื้อหาตอน ตรงจุดที่มีปัญหา (10-30 ตัวอักษร)","detail":"อธิบายปัญหา","suggestion":"วิธีแก้ที่แนะนำ"}]
ถ้าไม่พบปัญหาเลย ตอบ []`;
}

export function taskBrainstorm({ prompt, userNote }) {
  return `ระดมไอเดียพัฒนาเรื่องจากโจทย์ของผู้เขียน:
"${prompt}"

เสนอ 3-5 ทางเลือก แต่ละทางเลือกเขียนรูปแบบ:
【ชื่อไอเดียสั้นๆ】
เนื้อหาไอเดีย 2-4 ประโยค
ข้อดี: ...
ข้อควรระวัง: ...
${noteLine(userNote)}
ให้ทุกไอเดียต่อยอดจาก STORY MEMORY ได้จริง ไม่ขัดแย้งกับ WORLD CONTEXT`;
}

export function taskSummarize({ chapterText, chapterTitle }) {
  return `สรุปเนื้อหาตอน "${chapterTitle || ''}" ต่อไปนี้เป็น 3-5 บรรทัด สำหรับใช้เป็น "ความจำของเรื่อง" ในการเขียนตอนถัดไป:
---
${chapterText}
---
ให้ครอบคลุม: เหตุการณ์สำคัญที่เกิดขึ้น, ตัวละครที่ปรากฏ, ข้อมูลใหม่ที่เปิดเผย, ปมที่ค้างไว้ท้ายตอน
ตอบเฉพาะข้อความสรุปเท่านั้น`;
}

export function taskDraftCodex({ name, surrounding }) {
  return `ผู้เขียนเพิ่งเพิ่ม "${name}" เข้าฐานข้อมูลโลกของเรื่อง (Codex)
นี่คือบริบทรอบๆ ที่ "${name}" ปรากฏในเนื้อหา:
---
${surrounding}
---
ร่างคำอธิบายสั้นๆ 1-3 ประโยคสำหรับ "${name}" จากข้อมูลในบริบทเท่านั้น (อย่าแต่งเพิ่มเกินที่เห็น)
ตอบเฉพาะคำอธิบายเท่านั้น`;
}
