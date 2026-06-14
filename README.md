# NovelTrans v12 Pro — User-Owned Styles/Presets Edition

## ใหม่ล่าสุด
- **📚 แบ่ง chunk ตอนแปล Batch (เลือกได้หลายโหมด)** — ตั้งใน ⚙ ตั้งค่า Workspace · เดิม batch
  ส่งทั้งตอนเป็นคำขอเดียว (ตอนยาวเสี่ยงคำแปลถูกตัด/timeout) · ตอนนี้เลือกได้ 3 โหมด:
  **ปิด** (เดิม) · **Smart** (แบ่งเฉพาะตอนที่ยาวเกินขนาดที่ตั้ง ตัดที่ขอบย่อหน้า) ·
  **ตามตัวอักษร** (แบ่งทุกตอนเท่า ๆ กัน) · แต่ละ chunk มี context ต่อเนื่อง (ท้ายคำแปล chunk
  ก่อนหน้า + summary ตอนก่อน) และ glossary เฉพาะ chunk · เก็บใน `settings.batchChunkMode`,
  `settings.batchChunkSize`
- **🔧 ตรวจทานคำแปลให้สอดคล้อง (เช็คคำซ้ำ)** — ปุ่มใหม่ในแผงคำซ้อน: ตรวจคู่ substring
  ที่ "ส่วนที่ใช้ร่วมกัน" ถูกแปลคนละแบบ (เช่น `겁화`="กอบฮวา" แต่ `겁화 가문`="ตระกูลเพลิงกัลป์")
  แล้วให้ AI เลือกคำแปลที่ถูกต้องของส่วนร่วม + แก้ทั้งสอง entry ให้ใช้คำเดียวกัน (`겁화`→"เพลิงกัลป์")
  · ไม่แตะต้นฉบับเกาหลี · ทำงานคู่กับปุ่ม "🤖 ให้ AI จัดการ" (ตัวลบคำซ้ำ) เดิม
- **🔒 Consistency Lock (ล็อกความสม่ำเสมอ)** — เปิด/ปิดได้ต่อ workspace (⚙ ตั้งค่า Workspace)
  เมื่อเปิดจะแทรกกฎเข้า prompt ตอนแปล: ล็อกสรรพนาม (Pronoun) + ระดับภาษา (Register) +
  มุมมองเล่าเรื่อง (POV) + ความเสถียรของคำแปล (Deterministic) · แก้ปัญหา "กดแปลรอบสอง
  ได้ฉัน รอบสามได้ผม รอบสี่ได้ข้าพเจ้า" ทั้งที่ต้นฉบับเดิม · **เลือกสรรพนามบุรุษ 1
  เริ่มต้นได้** (ฉัน/ผม/ข้าพเจ้า/ข้า… หรือ "อัตโนมัติ" = อิงเพศจาก glossary) สำหรับกรณี
  ต้นฉบับละประธาน (나는/내가/저는/제가) · ไม่บังคับ inject ถ้า preset มีบล็อกนี้อยู่แล้ว
  (idempotent) · เก็บใน `settings.consistencyLock`, `settings.consistencySelfRef`
- **📱 PWA (ติดตั้งเป็นแอพ + ใช้ออฟไลน์ได้)** — มี `manifest.webmanifest` + `sw.js` (service worker)
  ที่ precache app shell (HTML/CSS/JS/ไอคอน) จึงเปิดแอพแบบ offline ได้ และ "Add to Home Screen"
  ได้บนมือถือ · การเรียก API ไม่ถูก cache (ปล่อยผ่านเครือข่ายตรง)
- **🈁 เช็คคำซ้อน (substring) เฉพาะภาษาเกาหลี** — ตรวจคู่คำซ้อนเฉพาะคำที่เป็นเกาหลี (มีฮันกึล
  และไม่มีคานะญี่ปุ่น) เท่านั้น · คำภาษาอื่น (อังกฤษ/ญี่ปุ่น/จีน) จะไม่ถูกแจ้งเป็นคำซ้อน
  (เช็คคำซ้ำเป๊ะยังทำกับทุกภาษาเหมือนเดิม)
- **🤖 แปลชื่อตอน — เลือกได้หลายโมเดล + custom prompt** — dropdown โมเดลในหน้า "แก้ชื่อตอน"
  ดึงตาม provider ปัจจุบัน (รวมโมเดลที่ 🔄 fetch มา/กำหนดเอง) · จำค่าแยกต่อ workspace
  (`settings.titleModel`) · แก้ prompt แปลชื่อตอนเองได้ (`settings.titlePromptTemplate`)

## ใหม่ใน v12 (refactor)
- **Styles & Translation Presets เป็นของผู้ใช้ทั้งหมด** — ไม่มีของ built-in แล้ว; workspace ใหม่จะมีตัวอย่าง 1 อันที่แก้/ลบได้ และจัดการ Preset แบบสร้าง/แก้/ลบได้เต็มรูปแบบ
- **🔄 Fetch โมเดลจาก API** — ดึงรายชื่อโมเดลล่าสุดจาก provider โดยตรง (เลิกพิมพ์ model id เอง)
- **🧮 มิเตอร์ Context Window** — แสดงจำนวน token ที่จะส่ง (system + glossary + บริบท + ต้นฉบับ) เทียบกับ context window สูงสุดของโมเดล
- **📖 แท็บ "อ่าน/แก้ไข" ใหม่** — รวมการอ่านและเครื่องมือแก้ไข (แก้ข้อความ inline + ค้นหา/แทนที่ในตอน) แยกออกจากแท็บตอน
- **เช็คคำซ้ำรองรับทุกภาษา** — ตรวจคำซ้อนแบบเป็นกลางต่อภาษา (รู้จักขอบคำของภาษาที่มีเว้นวรรค + คำต่อท้ายของภาษาที่ไม่เว้นวรรค)
- **ตัดออก:** ระบบ Marathon, QA Glossary, และระบบเช็คความสอดคล้อง

## เดิมใน v11

### 📖 Reader Mode — แปลไปอ่านไป
- ปุ่ม `📖 อ่าน` ในรายการตอน / `📖 อ่านต่อ` ใน toolbar (จำตำแหน่งล่าสุด)
- ธีมอ่าน 3 แบบ (สว่าง/ซีเปีย/มืด) + ปรับขนาดฟอนต์/ระยะบรรทัด — จำค่าต่อ Workspace
- **Prefetch**: ขณะอ่านตอน N ระบบแปลตอน N+1 (และ N+2) ให้เองเบื้องหลังแบบเรียงลำดับ
  (glossary + context memory ของตอนก่อนหน้าเสร็จก่อนเสมอ) — กดตอนถัดไปได้ทันทีไม่ต้องรอ
- ตอนที่ยังไม่แปล: กด `⚡ แปลตอนนี้` แล้วอ่านสดระหว่าง stream ได้เลย
- เคารพคิว Marathon และ daily limit เดียวกัน — ไม่แปลซ้ำ ไม่แย่งงาน

### 🌐 Multi-provider AI
- เลือก provider ได้ต่อ Workspace: **OpenRouter** (เดิม), **Google Gemini**, **OpenAI**,
  **Anthropic Claude**, **DeepSeek** (ต่อ API ตรงเจ้า ไม่ผ่านตัวกลาง)
- ตั้ง API Key แยกต่อ provider ใน ⚙ ตั้งค่า API Key (key OpenRouter เดิมใช้ได้ต่อทันที)
- ใส่ model id กำหนดเองได้ (`✏ กำหนดเอง…` ในรายการโมเดล)
- ข้อความ error บอกสาเหตุชัด: key ผิด (401) / rate limit (429) / เครดิตหมด (402) / server (5xx) / CORS
- หมายเหตุ CORS: ทุกเจ้าเรียกตรงจาก browser ได้ (Anthropic ใช้ header พิเศษซึ่งแอพใส่ให้แล้ว)
  ถ้าเจ้าไหนเชื่อมต่อไม่ได้ ให้ใช้ OpenRouter แทน

### 🔁 ความต่อเนื่องการแปล
- **Resume งานแปลค้าง**: หยุดแปลแบบ chunk กลางคัน → กดแปลใหม่จะถามว่าแปลต่อจาก chunk เดิมไหม
  (ตอนสถานะ `◐ แปลค้าง` ในรายการตอน)
- **ตรวจสรรพนาม/เพศ** (`🚻 สรรพนาม` ในแท็บ Glossary): สแกนหา "เขา" ใกล้ชื่อตัวละครหญิง ฯลฯ
  พร้อมกระโดดไปแก้ใน Review Search — ทำงาน local ไม่เสียค่า AI
- ความยาว context จากตอน/chunk ก่อนหน้า ปรับได้ในตั้งค่า Workspace (default 400 ตัวอักษร)

### 🔧 อื่นๆ
- ประเภทคำศัพท์ custom บันทึกถาวรต่อ Workspace (เดิมหายตอน reload)
- Timeout การเรียก AI ปรับได้ (default 120s) ใน ⚙ ตั้งค่า API Key
- EPUB import ทนทานขึ้น + ข้อความ error ภาษาไทยชัดเจน (ZIP64/ไฟล์เสีย/WebView เก่า)

### ข้อมูลที่เก็บเพิ่ม (backward-compatible — Workspace เก่าใช้ได้ทันที)
- localStorage: `nt8_apikey_gemini/openai/anthropic/deepseek`, `nt8_timeout_s`
- Workspace: `settings.aiProvider`, `settings.customModels`, `settings.prevCtxChars`,
  `readerSettings`, `readerPosition`, `customGlossaryTypes`, ต่อตอน: `chunkProgress`

---

## โครงสร้างไฟล์
```
NovelTrans/
├── index.html   ← หน้าหลัก
├── style.css    ← CSS ทั้งหมด
├── js/          ← JavaScript (แยกเป็นโมดูลตามหน้าที่ โหลดตามลำดับ)
│   ├── app.core.js              ← state, styles/presets, prompts, storage/IndexedDB
│   ├── app.providers.js         ← AI providers, fetch models, ต้นทุน
│   ├── app.workspace.js         ← init, workspace list/settings, import/export
│   ├── app.chapters-glossary.js ← แท็บตอน + คลังศัพท์ + styles
│   ├── app.translate.js         ← แกนการแปล, auto-glossary, context memory
│   ├── app.review-batch.js      ← review search, export, แปล batch, EPUB
│   ├── app.tools.js             ← เครื่องมือ (dup-check, type system, theme ฯลฯ)
│   └── app.reader-presets.js    ← แท็บอ่าน/แก้ไข, preset CRUD, reader
├── serve.sh     ← สคริปต์เปิด server
└── README.md    ← ไฟล์นี้
```

## วิธีใช้บน Termux

### 1. ติดตั้ง Python (ถ้ายังไม่มี)
```bash
pkg update && pkg install python
```

### 2. คัดลอกโฟลเดอร์ไปที่ต้องการ
```bash
cp -r NovelTrans ~/storage/shared/NovelTrans
```

### 3. เปิด server
```bash
cd ~/storage/shared/NovelTrans
chmod +x serve.sh
./serve.sh
```

### 4. เปิด browser
ไปที่ `http://localhost:8080`

---

## หรือเปิดทีเดียวด้วยคำสั่งเดียว
```bash
cd ~/path/to/NovelTrans && python3 -m http.server 8080
```

แล้วเปิด browser → `http://localhost:8080`

---

## หมายเหตุ
- **ห้ามเปิดแบบ `file://`** เพราะ IndexedDB จะไม่ทำงานข้ามไฟล์
- ข้อมูลทั้งหมด (Workspace, Chapter) เก็บใน IndexedDB ของ browser
- API Key เก็บใน localStorage ของ browser
