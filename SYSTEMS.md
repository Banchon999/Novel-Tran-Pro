# NovelTrans Pro — รายการระบบทั้งหมด (System Reference)

> เอกสารอ้างอิงสั้น ๆ ว่าแอพมีระบบอะไรบ้าง อยู่ตรงไหนใน UI และอยู่ไฟล์ไหนในโค้ด
> ใช้คู่กับ `README.md` (README = changelog/วิธีใช้, ไฟล์นี้ = แผนที่ระบบ)

## สารบัญ
1. [โครงสร้างแอพ / UI](#1-โครงสร้างแอพ--ui)
2. [Workspace & ข้อมูล](#2-workspace--ข้อมูล)
3. [AI Provider & โมเดล & ต้นทุน](#3-ai-provider--โมเดล--ต้นทุน)
4. [ระบบแปล (Translate Core)](#4-ระบบแปล-translate-core)
5. [Batch Translate](#5-batch-translate)
6. [Prompt / Style / Preset](#6-prompt--style--preset)
7. [Context & ความสม่ำเสมอ](#7-context--ความสม่ำเสมอ)
8. [ตอน (Chapters)](#8-ตอน-chapters)
9. [อ่าน/แก้ไข & Reader](#9-อ่านแก้ไข--reader)
10. [คลังศัพท์ (Glossary)](#10-คลังศัพท์-glossary)
11. [ค้นหา/แทนที่ & ตรวจทาน](#11-ค้นหาแทนที่--ตรวจทาน)
12. [เครื่องมือจัดการข้อความ](#12-เครื่องมือจัดการข้อความ)
13. [Import / Export / Backup](#13-import--export--backup)
14. [UI ทั่วไป (Theme, Shortcut, PWA)](#14-ui-ทั่วไป-theme-shortcut-pwa)
15. [ที่เก็บข้อมูล (Storage keys)](#15-ที่เก็บข้อมูล-storage-keys)
16. [แผนที่ไฟล์ → ระบบ](#16-แผนที่ไฟล์--ระบบ)

---

## 1. โครงสร้างแอพ / UI

| ส่วน | มีอะไร |
|---|---|
| **Sidebar** (☰) | สถานะ API, ต้นทุนรวม, รายการ Workspace, Import WS, Export หลาย WS, Backup ทั้งหมด (1-click), ⚙ ตั้งค่า API Key, 🎨 Theme Editor |
| **Header** | ชื่อ Workspace ปัจจุบัน + badge ต้นทุน + แถบเตือน Backup |
| **แท็บ ⚡ แปล** | ต้นฉบับ ↔ คำแปล, ตัวเลือก Polish/Memory/Prev Ch/Chunk, QA, Find, Export, มิเตอร์ token |
| **แท็บ 📚 ตอน** | รายการตอน, เพิ่มตอน, Import EPUB, แปล Batch, แก้ชื่อตอน, Re-number, เลือกหลายตอน |
| **แท็บ 📖 อ่าน/แก้ไข** | อ่าน/แก้ไขตอน, sync ตำแหน่ง, ไฮไลต์ศัพท์, แทนที่ในตอน, แปลตอนนี้ |
| **แท็บ 📖 คลังศัพท์** | ตาราง Glossary, Auto, เช็คซ้ำ, สรรพนาม, Export, CSV Import, Import จาก WS อื่น |
| **แท็บ 🖊 Styles** | สร้าง/แก้/ลบ Style, ปุ่มจัดการ Preset |
| **แท็บ ⚙ ตั้งค่า** | ตั้งค่า Workspace ทั้งหมด (ดูข้อ 2) + เครื่องมือทั้ง WS + ต้นทุน |
| **Reader Overlay** | โหมดอ่านเต็มจอ + prefetch (ข้อ 9) — เปิดจาก ⛶ เต็มจอ (แท็บอ่าน), 📖 อ่านต่อ (แท็บตอน), 📖 อ่าน (หน้าดูตอน) |

---

## 2. Workspace & ข้อมูล
`js/app.workspace.js`, `js/app.core.js`

- **Workspace = นิยาย 1 เรื่อง** — เก็บตอน, glossary, styles, presets, settings, context memory, ต้นทุน แยกกัน
- สร้าง / เลือก / ลบ Workspace, จำ WS ล่าสุดที่เปิด (`getLastWs`)
- **ตั้งค่า Workspace** (แท็บ ⚙):
  - ชื่อนิยาย, คำอธิบาย, Emoji
  - Translation Preset ที่ใช้
  - AI Provider + โมเดลแปล + 🔄 Fetch โมเดล
  - Temperature
  - ความยาว context จากตอน/chunk ก่อนหน้า (`prevCtxChars`, default 400, ช่วง 100–4000)
  - โหมดแบ่ง chunk ตอน Batch (ปิด / Smart / ตามตัวอักษร) + ขนาด chunk
  - Auto Glossary หลังแปล (เปิด/ปิด)
  - 🔒 Consistency Lock + สรรพนามบุรุษ 1 เริ่มต้น
  - 🧠 Context Memory + token budget
  - Export JSON / ลบ Workspace
- **Storage**: IndexedDB (`NovelTransDB`) สำหรับ workspace, localStorage สำหรับ key/ต้นทุน/theme
- **Migration อัตโนมัติ** จาก localStorage เก่า → IndexedDB (รันครั้งเดียว)

---

## 3. AI Provider & โมเดล & ต้นทุน
`js/app.providers.js`

| ระบบ | รายละเอียด |
|---|---|
| **Multi-provider** | OpenRouter, Google Gemini, OpenAI, Anthropic Claude, DeepSeek — เลือกต่อ Workspace |
| **API Key ต่อ provider** | ⚙ ตั้งค่า API Key + ปุ่มทดสอบ key (`testApiKey`) — OpenRouter ตรวจที่ `/api/v1/key` และแสดงเครดิตคงเหลือ |
| **Timeout ปรับได้** | default 120s (`nt8_timeout_s`) |
| **aiCall / aiStream** | เรียกแบบปกติ / แบบ stream (SSE) แปลงให้เป็นรูปแบบเดียวกันทุก provider |
| **Error ภาษาไทย** | แยก 401 / 402 / 429 / 5xx / CORS / network |
| **🔄 Fetch Models** | ดึงรายชื่อโมเดลจาก API ของ provider + cache ไว้ (`nt8_fetched_models`) · **กรองเหลือเฉพาะโมเดลข้อความ** (`isTextModel`: ตัดโมเดลสร้างภาพ/เสียง/วิดีโอ, embedding, TTS, ถอดเสียง, `:batch`, openrouter/auto) |
| **โมเดลที่ไม่อยู่ในรายการ** | ไม่มีช่องพิมพ์ model id เอง — เลือกได้เฉพาะโมเดลตั้งต้นหรือที่ 🔄 Fetch มา (ถ้าค่าที่บันทึกไว้ไม่อยู่ในรายการ จะแสดงเป็น ⭐ แทน) |
| **🧮 มิเตอร์ Context Window** | ประมาณ token ที่จะส่ง เทียบกับ context สูงสุดของโมเดล |
| **Cost Tracker** | คิดค่าใช้จ่ายตาม input/output token ต่อโมเดล — แสดง USD/THB, แยกต่อ WS + รวม, รีเซ็ตได้ · OpenRouter: กด 🔄 Fetch แล้วใช้ราคาจริงจาก API (ไม่งั้นใช้ตาราง `MODEL_COSTS` ราคา ณ 2026-10-03) |
| **Health check** | จุดสถานะ API ใน sidebar |

---

## 4. ระบบแปล (Translate Core)
`js/app.translate.js`, `js/app.reader-presets.js` (`translateChapterCore`)

- **แปลแบบ True Stream** — เห็นคำแปลไหลออกมาสด ๆ, กดหยุดได้
- **ตัวเลือกในแท็บแปล**
  - **Polish** — ขัดเกลาคำแปลรอบสอง (POLISH_PROMPT / พิสูจน์อักษร)
  - **Memory** — cache คำแปลในหน่วยความจำ (สูงสุด 200 รายการ, หายเมื่อรีโหลด)
    - key ของ cache = โมเดล + preset + ข้อความเต็ม (chunk ที่ขึ้นต้นเหมือนกันไม่ปนกัน)
  - **Prev Ch** — แนบท้ายตอนก่อนหน้า (เลือกได้ว่าเป็น คำแปล หรือ ต้นฉบับ)
  - **Chunk** — จำนวนตัวอักษรต่อ chunk (0 = ส่งทั้งก้อน)
- **แปลแบบ Chunk + Resume** — กดหยุด / chunk error / หมดเวลา → แปลหยุดที่ chunk นั้น ตอนเป็น `◐ แปลค้าง` (ไม่ขึ้น ✓ ทั้งที่ขาด) กดแปลใหม่จะถามว่าแปลต่อจาก chunk เดิมไหม (`chunkProgress`)
- **Timeout แยกจากการกดหยุด** — หมดเวลาแจ้งเป็น error "หมดเวลา" · ใน Batch ตอนที่หมดเวลาจะ log error แล้ว**แปลตอนถัดไปต่อ** (ไม่หยุดทั้งชุด)
- **🗣 คำลงท้าย ครับ/ค่ะ** — ดูข้อ 7
- **Auto Extract Glossary หลังแปล** — ดึงศัพท์ใหม่เข้าคลังอัตโนมัติ (ถ้าเปิดไว้)
- **🔍 QA Check** — AI ให้คะแนนคุณภาพคำแปล PASS/FAIL + สรุป
- **🔍 Detect Glossary** — ไฮไลต์คำในต้นฉบับที่มีอยู่ในคลังศัพท์
- **โหลดจากตอน / บันทึกลงตอน** — ดึงต้นฉบับจากตอน แล้วเซฟคำแปลกลับ
- **Progress UI** — แถบขั้นตอน Glossary → แปล → Polish → เสร็จ
- **Shortcut** Ctrl/Cmd + Enter = เริ่มแปล

---

## 5. Batch Translate
`js/app.review-batch.js` (`startBatchChapters`)

- เลือกหลายตอน (ทั้งหมด / เฉพาะรอแปล) แล้วแปลต่อเนื่อง
- **แบ่ง chunk ตอนยาว** 3 โหมด: ปิด / Smart (ตัดที่ย่อหน้า, แนะนำ) / ตามตัวอักษร
  - แต่ละ chunk มี context ต่อเนื่อง (ท้าย chunk ก่อน + summary ตอนก่อน) และ glossary เฉพาะ chunk
- **ส่ง context ข้ามตอนที่แปลใน batch เดียวกัน** — สร้าง summary ตอนก่อนหน้าแบบขนาน (สูงสุด 5 พร้อมกัน)
- รองรับ Polish + Auto Glossary + Context Memory ระหว่าง batch

---

## 6. Prompt / Style / Preset
`js/app.core.js`, `js/app.chapters-glossary.js`, `js/app.reader-presets.js`

| ระบบ | รายละเอียด |
|---|---|
| **Styles** (แท็บ 🖊) | สไตล์การเขียนของผู้ใช้ — สร้าง/แก้/ลบ/ตั้งเป็น active/พรีวิว |
| **Translation Presets** | ชุด prompt หลักสำหรับแปล — สร้าง/แก้/ลบเต็มรูปแบบ (✏ จัดการ Preset) |
| **Preset ตัวอย่าง 6 แบบ** | แปลตรงตัว 🔤 · จีนกำลังภายใน 🥋 · ยุคกลางตะวันตก 🏰 · วรรณกรรม 📖 · เน้นบทสนทนา 🎭 · เว็บตูน/มือถือ 📱 (เพิ่มกลับได้ด้วย `addMissingSeedPresets`) |
| **กฎกลางที่ฝังใน preset** | Consistency & reading flow, กฎสรรพนามไทย, Proofreading |
| **Prompt ระบบอื่น** | Polish, QA, Auto Glossary, Chapter Summary, Context Summary/Compress, แปลชื่อตอน, Dup Resolve, Dup Fix |
| **แก้ prompt เองได้** | Auto Glossary prompt, แปลชื่อตอน prompt (`titlePromptTemplate`) |

---

## 7. Context & ความสม่ำเสมอ
`js/app.translate.js`, `js/app.core.js`

- **🧠 Context Memory** — หลังแปลแต่ละตอน AI สรุปเนื้อเรื่อง (ตัวละคร/เพศ/สรรพนาม/เหตุการณ์) เก็บไว้ใช้แปลตอนถัดไป
  - ⚠ การสรุปใช้โมเดล `google/gemini-2.5-flash-lite` แบบ fix ไว้ ส่งผ่าน provider ที่เลือกอยู่ → ใช้ได้กับ **OpenRouter** · ถ้าใช้ OpenAI / Anthropic / DeepSeek ตรง จะเรียกไม่สำเร็จและ**ไม่มี summary ถูกบันทึก** (ไม่มี error ขึ้นหน้าจอ)
  - Token budget 500–3000, เกินแล้ว **บีบอัด summary อัตโนมัติ**
  - Context Manager: ดู / แก้ / ลบ summary ทีละอัน, ล้างทั้งหมด
- **🔒 Consistency Lock** — แทรกกฎล็อก สรรพนาม + ระดับภาษา + POV + ความเสถียรคำแปล
  - เลือกสรรพนามบุรุษ 1: อัตโนมัติ / ฉัน / ผม / ดิฉัน / ข้าพเจ้า / กระผม / ข้า / ข้าน้อย / เรา / หนู / กู
  - ไม่แทรกซ้ำถ้า preset มีบล็อกนี้อยู่แล้ว
- **📘 ความต่อเนื่องเหมือนนักแปลคนเดียว** (ตั้งค่า Workspace)
  - **🎯 แปลแบบคงที่** (ค่าเริ่มต้นเปิด) — ตอนแปล/Polish ใช้ temperature ไม่เกิน 0.3 (`translateTemp`) ไม่แก้ค่าใน preset · เตือนเมื่อปิดแล้ว temperature > 0.5
  - **คู่มือการแปลของนิยาย** (`ws.styleSheet`: ทับศัพท์/แปล ตามหมวด · คำประจำเรื่อง · น้ำเสียงบรรยาย · รูปแบบความคิด/เสียง/ระบบ · น้ำเสียงตัวละคร) → แทรกทุกการแปล (`applyStyleSheet`) · ปุ่ม 🤖 ร่างคู่มือจากตอนที่แปลแล้ว (เติมเฉพาะช่องว่าง, ผู้ใช้บันทึกเอง)
  - **บริบทไม่หาย** — preset ไม่มี `{context}` ก็แทรกบริบทเป็นบล็อก (`applyContext`) · แปลตอนเดียว/อ่านเต็มจอ/Prefetch แนบท้ายคำแปลตอนก่อนเป็นตัวอย่างสำนวน (`prevChapterTail`)
  - **ดึงศัพท์ใหม่ก่อนแปล** (`preExtractTerms`, เมื่อเปิด Auto Glossary) — คำที่โผล่ครั้งแรกก็แปลตามคลัง (เดิมดึงหลังแปล → ครั้งแรกทับศัพท์ ครั้งต่อไปแปล) · Batch ดึงต่อตอน · Auto Glossary เก็บศัพท์ประจำแนวที่วนซ้ำ + บันทึกว่าทับศัพท์/แปล
  - **ตรวจไม่ตรงคลัง** (local) — หลังแปลเตือนคำที่ต้นฉบับมีแต่คำแปลไม่ใช้คำไทยตามคลัง (`glossaryMisses`) · ชุดทดสอบ `tests/consistency/`
- **Glossary + เพศ/สรรพนาม** — ส่งข้อมูลเพศของตัวละครเข้า prompt ด้วย
- **🚻 ตรวจสรรพนาม/เพศ** — สแกนหา "เขา" ใกล้ตัวละครหญิง (และกลับกัน) ทำงาน local ไม่เสียเงิน → กระโดดไปแก้ใน Review Search
  - ไม่นับคำประสม (ภูเขา, หุบเขา, นางฟ้า, นางสาว ฯลฯ) และนับสรรพนามแต่ละจุดครั้งเดียว
- **🗣 ระบบกัน ครับ/ค่ะ ผิด** (3 ชั้น)
  1. **กฎใน prompt** — แทรก `SPEECH PARTICLE RULES` ทุกการแปลตอน runtime (มีผลกับ preset เดิมด้วย): คำลงท้ายตามเพศ**ผู้พูด**, ห้ามผสม, ต้องตรงกับ ผม/ดิฉัน, ไม่รู้เพศ → ใช้คำกลาง · Glossary ส่ง `particle→ครับ` / `particle→ค่ะ/คะ` ต่อตัวละคร · Polish ห้ามสลับเพศคำลงท้าย
  2. **ตัวตรวจ local** (ใน modal 🚻 สรรพนาม/ครับ-ค่ะ) — "ชัดเจน": ผสม ครับ+ค่ะ / ขัดกับ ผม-ดิฉัน ในบทพูดเดียว · "น่าสงสัย": ไม่ตรงเพศผู้พูดจากแท็กบทพูด (เช่น `ลีน่ากล่าว “…ครับ”`) · รองรับราชาศัพท์ พ่ะย่ะค่ะ/เพคะ, ไม่นับ คะแนน/เส้นผม
  3. **ตรวจอัตโนมัติหลังแปล** — แท็บแปล / Batch / อ่าน-แก้ไข / Reader เตือนถ้าพบจุดน่าสงสัย
- **🗺 Speaker Map + ตรวจเพศหลังแปล** (ตั้งค่า Workspace → เปิด/ปิด + เลือก "โมเดลช่วย", ค่าเริ่มต้น Gemini 3 Flash Preview)
  - ก่อนแปล: โมเดลช่วยระบุผู้พูด/เพศของทุกบทพูด + ชื่อไทยของตัวละครที่ยังไม่อยู่ในคลัง · ระดับภาษาเกาหลีตรวจ local (…요/…니다 = สุภาพ → ครับ/ค่ะ · 반말/하다체 → ไม่ใส่หางเสียง)
  - ในแผนที่ใส่แค่ลำดับบทพูด ไม่ใส่ข้อความเกาหลี (ใส่แล้วโมเดลราคาถูกทิ้งบทพูดเป็นเกาหลี)
  - หลังแปล: ตัดบรรทัดเกาหลีที่โมเดลคัดลอกมา (ตอบสองภาษา) · แทนชื่อเกาหลีที่หลุดด้วยชื่อไทย · ตัดหมายเหตุผู้แปลที่โมเดลแทรกเอง · แก้ ครับ/ค่ะ/ผม/ฉัน ตามผู้พูด · ตรวจ เขา/เธอ ในบรรยาย 2 รอบ (เสนอคำแก้ → ถามแยกว่าคำนั้นหมายถึงใคร รับเฉพาะเมื่อเพศตรงคลังศัพท์)
  - ชุดทดสอบ: `tests/gender/` (ดู README ในโฟลเดอร์)

---

## 8. ตอน (Chapters)
`js/app.chapters-glossary.js`, `js/app.tools.js`

- เพิ่ม / เปิดดู / แก้ / ลบตอน, เลื่อนตอนก่อน-ถัดไป
- สถานะตอน: `รอแปล` · `◐ แปลค้าง` · `✓ แปลแล้ว`
- **เลือกหลายตอน** (bulk) + Shift+คลิก เลือกช่วง, เลือกเฉพาะรอแปล/แปลแล้ว, ลบที่เลือก
- **↩ Undo** การกระทำล่าสุด (ลบตอน, Clean Source ทุกตอน, แยกตอน, รวมตอน)
- **✂ แยกตอน (Split)** พร้อมพรีวิว — ถ้ามีคำแปลจะเตือนก่อน (ต้องแปลใหม่) · **🔗 รวมตอน (Merge)** — ถ้าแปลไม่ครบทั้งคู่ ผลเป็น `รอแปล`
- **🔢 Re-number** เรียงเลขตอนใหม่ทั้งหมด
- **✏ แก้ชื่อตอน (Bulk Rename)**
  - แปลชื่อตอนด้วย AI (ทีละ 30 ตอน), เลือกโมเดลได้, แก้ prompt ได้
  - เลือกเฉพาะแถวที่ติ๊ก (ไม่ติ๊ก = ทุกแถว)
  - Find & Replace / ลบข้อความในชื่อตอน (รองรับ regex)
- **🔎 ตรวจคำ** → เปิด Review Search ข้ามทุกตอน

---

## 9. อ่าน/แก้ไข & Reader
`js/app.reader-presets.js`

**แท็บ 📖 อ่าน/แก้ไข**
- สลับโหมด 📖 อ่าน ↔ ✏ แก้ไข — **จำตำแหน่ง scroll ให้ตรงกัน** ทั้งสองทาง
- 🖍 ไฮไลต์คำแปลที่ตรงกับ Glossary (สีตามประเภท, hover เห็นต้นฉบับ) — จำค่าต่อ WS
- ค้นหา/แทนที่ในตอน + นับจำนวนที่เจอ, สถิติตัวอักษร
- ⚡ แปลตอนนี้, 💾 บันทึกการแก้ไข, ◀ ▶ เลื่อนตอน

**Reader Overlay (อ่านเต็มจอ)** — `openReaderFull()` · เปิดจาก ⛶ เต็มจอ (แท็บอ่าน/แก้ไข), 📖 อ่านต่อ (แท็บตอน), 📖 อ่าน (หน้าดูตอน) · ปิด/กด Back แล้วแท็บอ่านไปอยู่ตอนเดียวกัน
- ธีม สว่าง/ซีเปีย/มืด, ขนาดฟอนต์, ระยะบรรทัด — จำต่อ WS
- 📖 อ่านต่อ (จำตำแหน่งล่าสุด `readerPosition`)
- **Prefetch** — แปลตอนถัดไป 1–2 ตอนล่วงหน้าเบื้องหลัง
- ตอนที่ยังไม่แปล → ⚡ แปลตอนนี้ แล้วอ่านสดระหว่าง stream

---

## 10. คลังศัพท์ (Glossary)
`js/app.chapters-glossary.js`, `js/app.tools.js`, `js/app.workspace.js`

| ระบบ | รายละเอียด |
|---|---|
| **ตาราง Glossary** | ค้นหา, กรองประเภท, เรียง (ล่าสุด / เกาหลี A→Z, Z→A / ไทย ก→ฮ / ประเภท) |
| **ข้อมูลต่อคำ** | เกาหลี, ไทย, ประเภท, เพศ, หมายเหตุ, ตอนที่พบ |
| **ประเภทคำ** | ตัวละคร, ตำแหน่ง/ยศ, ลำดับขั้น, คำศัพท์, คำยกย่อง, สถานที่, ทักษะ, ไอเทม, กลุ่ม/สำนัก, มอนสเตอร์ + **ประเภท custom** (บันทึกถาวร) |
| **เพิ่ม/แก้/ลบ** | ทีละคำ หรือเลือกหลายคำแล้วลบ |
| **🤖 Auto Glossary** | AI ดึงศัพท์จากข้อความ/หลายตอน (แบ่ง chunk 15,000 ตัวอักษร) + ติดตามว่าเจอในตอนไหน + เลือกก่อนเพิ่ม · max_tokens 12000 (โมเดลที่ "คิดก่อนตอบ" ใช้ token ส่วนนี้ด้วย) · อ่าน JSON แบบทนทาน (`parseJsonArrayLoose` กู้ผลที่ถูกตัด) · ส่วนที่ล้มเหลว/ถูกตัด แจ้งเป็น ⚠ ไม่ขึ้น "ไม่พบ" เงียบ ๆ |
| **🔎 เช็คคำซ้ำ** | คำซ้ำเป๊ะ (ทุกภาษา, normalize Unicode) + คำซ้อน substring (เฉพาะเกาหลี) |
| **🤖 ให้ AI จัดการคำซ้อน** | ตัดสินว่าคู่ไหนควรลบ (มี fast-path คำต่อท้ายเกาหลีที่รู้จัก) |
| **🔧 ตรวจทานให้สอดคล้อง** | AI แก้คำแปลของคู่ substring ให้ใช้คำเดียวกัน (ไม่แตะต้นฉบับ) |
| **🚻 สรรพนาม/ครับ-ค่ะ** | ดูข้อ 7 |
| **📤 Export** | TXT / MD / CSV / JSON / XLS (ปุ่มเขียน XLSX แต่ไฟล์จริงเป็น SpreadsheetML นามสกุล `.xls`) — เลือกขอบเขต, ประเภท, คอลัมน์ (มีคอลัมน์ เพศ) |
| **📥 CSV Import** | นำเข้าพร้อมพรีวิว + ติ๊กเลือกแถว · มี header → อ่านคอลัมน์ตามชื่อ (ไฟล์ Export นำกลับเข้ามาได้ตรงช่อง) · ไม่มี header → Korean,Thai,Type,Gender,Note |
| **คำเรียกขานตามเพศ** | 도련님/공자님 → คุณชาย · 아가씨/영애 → คุณหนู — แก้ให้อัตโนมัติทั้งตอนเพิ่มคำและตอนส่งเข้า prompt (`fixAddressGender`) |
| **🔗 Import จาก WS อื่น** | สืบทอด glossary จาก Workspace อื่น |
| **Smart Glossary** | ส่งเฉพาะคำที่เจอในข้อความนั้นเข้า prompt (ประหยัด token) |

---

## 11. ค้นหา/แทนที่ & ตรวจทาน
`js/app.review-batch.js`

- **⇄ Find & Replace** (แท็บแปล) — ค้นหาสด, ไฮไลต์, ถัดไป/ก่อนหน้า, แทนที่ทีละอัน/ทั้งหมด, case/regex/ทั้งคำ, **ประวัติการแทนที่**
- **🔎 Review Search** (ข้ามทุกตอน) — ไล่ดูทีละจุดพร้อม context, แทนที่แล้วไปต่อ / ข้าม, **โหมดแก้อิสระ** แก้ข้อความรอบ ๆ ได้, บันทึกแล้วปิด

---

## 12. เครื่องมือจัดการข้อความ
`js/app.tools.js`

| เครื่องมือ | ใช้กับ |
|---|---|
| 🧹 **Clean Source** — ลบ Base64/ขยะ + แปลงสแลง/jamo เกาหลี | ต้นฉบับ (ตอนเดียว / ทุกตอน) |
| 📐 **Add Line Break** — เว้น 1 บรรทัดว่างระหว่างทุกบรรทัด | คำแปล (ตอนเดียว / ทุกตอน) |
| 📏 **Add 1 Line** | คำแปล (ตอนเดียว / ทุกตอน) |
| ⎘ คัดลอกคำแปล, ✕ ล้างต้นฉบับ/คำแปล | แท็บแปล |

---

## 13. Import / Export / Backup
`js/app.review-batch.js`, `js/app.tools.js`, `js/app.workspace.js`

| ระบบ | รายละเอียด |
|---|---|
| **📗 Import EPUB** | แตกไฟล์เป็นตอน ๆ อัตโนมัติ (ZIP parser เขียนเอง, เดาชื่อตอน) |
| **Export คำแปล** | TXT / DOCX (ตอนเดียว หรือทั้ง WS), ZIP, **เลือกตอนที่จะ export** |
| **Export Workspace** | JSON (WS เดียว), หลาย WS, **Backup ทั้งหมด 1-click** |
| **Import Workspace** | จากไฟล์ JSON (WS เดียว / Export หลาย WS / **Backup ทั้งหมด**) + **ซ่อม JSON ที่ขาดท้าย** อัตโนมัติ (ถูกตัดกลางข้อความก็กู้ส่วนที่ครบได้) |
| **เตือน Backup** | ขึ้นแถบเตือนถ้าไม่ได้ backup เกิน 12 ชม. |

---

## 14. UI ทั่วไป (Theme, Shortcut, PWA)

- **🎨 Theme Editor** — ปรับสี/ฟอนต์เอง + preset 5 แบบ (dark-gold, deep-blue, forest, crimson, light), พรีวิว/รีเซ็ต
- **Keyboard Shortcuts**
  - `Esc` ปิด modal
  - `Ctrl/Cmd + Enter` เริ่มแปล (แท็บแปล)
  - `Ctrl/Cmd + S` บันทึกตอน (ตอนเปิดหน้าดูตอน)
  - `Ctrl/Cmd + F` โฟกัสช่องค้นหา (แท็บคลังศัพท์ · แท็บตอนไม่มีช่องค้นหา)
- **📱 PWA** — ติดตั้งเป็นแอพ, เปิด offline ได้ (`sw.js` precache app shell, ไม่ cache การเรียก API)
  - ⚠ แก้ไฟล์ app shell ต้องเพิ่มเลข `CACHE` ใน `sw.js`
- **Toast / Modal / Progress** helper กลาง

---

## 15. ที่เก็บข้อมูล (Storage keys)

**localStorage**
| key | เก็บอะไร |
|---|---|
| `nt8_apikey` | API key OpenRouter |
| `nt8_apikey_gemini` / `_openai` / `_anthropic` / `_deepseek` | API key ต่อ provider |
| `nt8_timeout_s` | timeout การเรียก AI |
| `nt8_costs` | ต้นทุนสะสม |
| `nt8_fetched_models` | cache รายชื่อโมเดลที่ fetch มา |
| `nt8_last_backup_ts` | เวลา backup ล่าสุด |
| `nt_theme_v1` | ธีม |

**IndexedDB `NovelTransDB`** — Workspace ทั้งหมด + รายการ WS + WS ล่าสุด

**ฟิลด์สำคัญใน Workspace**
- `chapters[]` (`sourceText`, `translation`, `status`, `chunkProgress`)
- `glossary[]`, `customGlossaryTypes`
- `customStyles` (Styles), `presets`, `presetId` (preset ที่ใช้อยู่)
- `settings`: `aiProvider`, `translateModel`, `temperature`, `activeStyleId`, `autoGlossary`, `prevCtxChars`, `batchChunkMode`, `batchChunkSize`, `consistencyLock`, `consistencySelfRef`, `titleModel`, `titlePromptTemplate`
- `readerSettings` (รวม `glossaryHl`), `readerPosition`
- `translationContext` (`enabled`, `maxTokens`, `summaries`) — Context Memory
- `costs` — ต้นทุนของ WS นี้

---

## 16. แผนที่ไฟล์ → ระบบ

| ไฟล์ | ระบบหลัก |
|---|---|
| `index.html` | โครง UI ทั้งหมด: sidebar, 6 แท็บ, ~23 modal, reader overlay |
| `style.css` | สไตล์ทั้งหมด |
| `js/app.core.js` | State (`S`), seed styles/presets, กฎ prompt กลาง, Consistency Lock, prompts ระบบ, IndexedDB, migration |
| `js/app.providers.js` | AI providers, aiCall/aiStream, เลือก provider/model, Fetch models, context window, ต้นทุน |
| `js/app.workspace.js` | Shortcuts, init, sidebar, Workspace CRUD/settings, export/import JSON, backup reminder, glossary inherit, CSV import, multi-export |
| `js/app.chapters-glossary.js` | แท็บตอน (bulk, split, merge, undo), ตาราง Glossary, Styles |
| `js/app.translate.js` | แกนการแปล (stream/chunk/resume), auto-glossary หลังแปล, QA, detect glossary, API settings, Auto Glossary UI, Context Memory |
| `js/app.review-batch.js` | Find & Replace, Review Search, Export TXT/DOCX/ZIP, Batch translate, utilities, มิเตอร์ token, EPUB import |
| `js/app.tools.js` | Re-number, Bulk Rename, export select, Auto Glossary แบบ chunk, ประเภทคำ, เช็คคำซ้ำ + AI resolve/fix, Clean source, line break, Theme Editor, Glossary Export |
| `js/app.reader-presets.js` | `translateChapterCore`, Preset CRUD, แท็บอ่าน/แก้ไข, Reader overlay + prefetch, ตรวจสรรพนาม/เพศ |
| `sw.js` / `manifest.webmanifest` | PWA |
| `serve.sh` | เปิด local server (Termux) |
