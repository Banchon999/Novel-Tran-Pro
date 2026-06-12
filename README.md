# NovelTrans v11 Pro — Reader + Multi-provider Edition

## ใหม่ใน v11

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
├── app.js       ← JavaScript ทั้งหมด
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
