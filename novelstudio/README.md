# 📖 NovelStudio — สตูดิโอแต่งนิยาย พร้อมผู้ช่วย AI

เว็บแอพแต่งนิยายหลายโมดูล เก็บข้อมูลในเครื่อง (IndexedDB) เรียก AI ผ่าน OpenRouter
ไม่มี build step — vanilla JS (ES Modules) เปิดใช้ได้ทั้งคอมและมือถือ

> สร้างตามสเปกใน `NovelStudioPlanWorkflow.md` — แนวเดียวกับ NovelTrans/NovelForge

## วิธีรัน

ES Modules ต้องรันผ่าน `http://` (เปิด `file://` ตรงๆ ไม่ได้):

```bash
# คอม (มี Python)
cd novelstudio && python -m http.server 8080

# หรือ Node
npx serve novelstudio

# Termux (มือถือ Android)
pkg install python && cd novelstudio && python -m http.server 8080
```

แล้วเปิด `http://localhost:8080`

> ถ้ารันจาก root ของ repo (`Novel-Tran-Pro`) ให้เปิด `http://localhost:8080/novelstudio/`

## เริ่มใช้ (~30 วินาที)

1. กด **＋ เรื่องใหม่** → ใส่ชื่อเรื่อง + เลือกแนว → เข้าหน้าเขียนทันที (มีตอนที่ 1 รอไว้แล้ว)
2. อยากใช้ AI: ไปที่ **⚙️ ตั้งค่า** → ใส่ OpenRouter API Key (สมัครฟรีที่ [openrouter.ai/keys](https://openrouter.ai/keys))
3. เขียนได้เลย — Codex ค่อยเติมระหว่างทาง (ลากคลุมชื่อในเนื้อหา → "➕ เพิ่มเข้า Codex")

## ฟีเจอร์

| โมดูล | ความสามารถ |
|---|---|
| **M1 Projects** | การ์ดโปรเจกต์, สร้าง/แก้/duplicate/ลบ/export รายเรื่อง, สลับเรื่องจาก header |
| **M2 Editor** | เขียนรายตอน autosave 2 วิ, นับคำสด (Intl.Segmenter), ลากเรียงตอน, สถานะตอน, ไฮไลต์ชื่อจาก Codex ในเนื้อหา, โหมดเขียนโล่ง 🧘 |
| **M3 Codex** | ฐานข้อมูลโลก: ตัวละคร/สถานที่/สกิล/ไอเทม/กฎ, aliases, tags, ปักหมุด 📌, ค้นหา+filter, quick-add จากหน้าเขียน + AI ร่างคำอธิบายจากบริบท |
| **M4 AI Assist** | ✍️ เขียนต่อ · ✨ เกลาสำนวน (เทียบก่อน/หลัง) · 🏷️ คิดชื่อ (กด＋เข้า Codex ได้เลย) · 🔍 เช็คต่อเนื่อง (คลิกเด้งไปตำแหน่งในตอน) · 💡 ระดมไอเดีย — ทุกคำสั่งมีช่อง "คำสั่งเพิ่มเติม" + streaming |
| **M5 Context Picker** | Auto-detect ชื่อในตอน + pinned + เลือกเอง, ตัวนับ budget (ตัวอักษร/token), จำการเลือกต่อตอน |
| **M6 Continuity Memory** | สรุปตอนด้วย AI (แก้มือได้), แนบสรุป N ตอนล่าสุดให้ AI อัตโนมัติ, หน้าไทม์ไลน์เรื่อง, badge ตอนที่ยังไม่สรุป |
| **M7 Settings** | API key (localStorage เท่านั้น), โมเดลหลัก+สำรอง (fallback อัตโนมัติ), แก้ genre prompt, ธีมมืด/สว่าง, Export/Import JSON (merge/replace), export .txt ทั้งเรื่อง |

## สถาปัตยกรรม AI (โครง prompt 4 ชั้น)

```
[1] SYSTEM   บทบาทผู้ช่วยนักเขียนนิยายไทย + กฎภาษา + genre prompt (fantasy/murim/romance/custom)
[2] WORLD    Codex ที่เลือกจาก Context Picker (pinned > auto-detect > manual, ตัดตาม budget)
[3] MEMORY   synopsis + สรุป N ตอนล่าสุด
[4] TASK     คำสั่งเฉพาะ action + เนื้อหา + คำกำกับจากผู้ใช้
```

- Streaming ทุกคำสั่ง ยกเว้น "เช็คต่อเนื่อง" (ขอ JSON ต้องรอครบ)
- Retry อัตโนมัติ 2 ครั้งเมื่อ error ชั่วคราว → สลับโมเดลสำรอง → แจ้งผู้ใช้
- แสดงค่าใช้จ่ายโดยประมาณต่อคำสั่ง (จาก usage ของ OpenRouter)

## โครงไฟล์

```
novelstudio/
├── index.html
├── css/            theme.css · layout.css · components.css
├── js/
│   ├── app.js      entry + router        db.js  IndexedDB wrapper     state.js  state + event bus
│   ├── modules/    projects · editor · codex · ai-assist · context · memory · settings
│   ├── ai/         openrouter.js · prompts.js · genres.js
│   └── utils/      export.js · text.js · ui.js
└── README.md
```

## ข้อควรรู้

- **ข้อมูลอยู่ใน browser เครื่องเดียว** — เคลียร์ browser data = หาย · แอพเตือนเมื่อไม่ได้ backup เกิน 7 วัน → กด Export เก็บไฟล์ไว้
- **ย้ายเครื่อง**: Settings → Export ทั้งแอพ → ส่งไฟล์ไปอีกเครื่อง → Import (Export ไม่รวม API key)
- API key เก็บใน localStorage — อย่า deploy ขึ้นเว็บสาธารณะทั้งที่ใส่ key ไว้

## Roadmap ถัดไป (Phase 5+)

- เก็บงาน mobile UX, คีย์ลัด, สถิติการเขียน
- Supabase sync คอม↔มือถือ (schema เผื่อไว้แล้ว: ทุก record มี `id` + `updatedAt`)
- Export EPUB
