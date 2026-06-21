# 💡 KnowFacts Factory — โรงงานผลิตคลิป Shorts ช่อง "รู้ไหม?"

แอป PWA สำหรับ **ผลิตคลิป Shorts สาย "รู้ไหม?" ให้เร็วที่สุด** — สร้างบนสถาปัตยกรรมเดียวกับ
**NovelTrans Pro** (vanilla JS ไม่มี build step · IndexedDB · เรียก AI หลายเจ้าตรงจาก browser ·
ติดตั้งเป็นแอป + ใช้ออฟไลน์ได้) และ **ใช้ API Key ร่วมกับ NovelTrans** (ไม่ต้องตั้งใหม่)

> ตัดทุกอย่างที่ไม่จำเป็นออก เหลือเฉพาะ Workflow ที่ผลิตคลิปได้เร็วที่สุด — ออกแบบให้คู่กับ NotebookLM

---

## 🏭 Workflow (ตรงตามสูตรช่อง "รู้ไหม?")

| ขั้น | ทำอะไร | ที่ไหนในแอป |
|---|---|---|
| 1. สะสมข้อมูล | รวมลิงก์ Wikipedia / Reddit TIL / NoStupidQuestions / ScienceAlert / LiveScience / NatGeo → โยนเข้า **NotebookLM** | นอกแอป (วันหยุด 30 นาที) |
| 2. AI หา Fact | วางแหล่งข้อมูล → AI สกัด Fact (คนไม่รู้ + อธิบายใน 20 วิ + น่าตกใจ + มีหลักฐาน) | แท็บ **💡 หา Fact** |
| 3. AI ให้คะแนน Viral | Shock + Curiosity + Shareability (อย่างละ 1–10) เรียงมาก→น้อย เก็บ **รวม ≥ 24** | แท็บ **🔥 คะแนน** |
| 4. AI เขียน Script | Hook · Fact · Explanation · Question — **ไม่เกิน 50 คำ** | การ์ดคลิป → ปุ่ม ✍️ |
| 5. AI แตก 4 ฉาก | สร้าง image prompt ภาษาอังกฤษ (documentary · realistic · 4K · 9:16) | การ์ดคลิป → ปุ่ม 🎬 |
| 6. สร้างภาพ | เอา prompt ไปวางใน Gemini / ChatGPT / Flux — 4 ภาพ/คลิป | คัดลอก prompt จากแอป |
| 7. เสียง | คัดลอก "บทพากย์" ไปทำ TTS (CapCut) — ใช้เสียงเดิมทั้งช่องเพื่อสร้างเอกลักษณ์ | การ์ดคลิป → 📋 บทพากย์ |
| 8. ตัดต่อ | Template เดียว: Hook 0–3 / Fact 3–8 / Explanation 8–15 / Question 15–20 + Auto Caption | Timeline ในการ์ดคลิป |

---

## 📂 โครงสร้าง = Kanban Board (แท็บ 🏭 Factory)

แต่ละคลิปคือการ์ดที่ไหลผ่าน 6 คอลัมน์ (ตรงกับโฟลเดอร์ในสูตรเดิม):

```
💡 Ideas → 📝 Scripts → 🖼️ Images → 🎙️ Voice → 🎬 Videos → 🚀 Published
```

การ์ดจะเลื่อนสถานะอัตโนมัติเมื่อทำแต่ละขั้นเสร็จ (หรือเลื่อนเองได้ในหน้ารายละเอียดคลิป)

---

## 🗓️ ระบบผลิต 30 คลิป/สัปดาห์ (แท็บ 📅 ผลิต)

- ตารางทั้งสัปดาห์ (อาทิตย์หา Fact → จันทร์ Script → อังคารภาพ → พุธ TTS → พฤหัสตัดต่อ)
- **Batch Script / Batch ฉาก** — รันทีเดียวทุกคลิปที่ค้าง
- ตั้งเวลาโพสต์ **09:00 / 13:00 / 19:00** (วันละ 3 คลิป)
- **ระบบซีรีส์** (สูตรโตเร็ว) — 🐱 สัตว์ · ⚡ ธรรมชาติ · 🧠 ร่างกาย แยกเป็น EP ต่อเนื่อง
  เพื่อให้คนดูต่อเป็นชุด แทนที่จะดูคลิปเดียวแล้วหาย

---

## ▶️ วิธีเปิด

ต้องเปิดผ่าน `http://` (ไม่ใช่ `file://` ไม่งั้น IndexedDB ไม่ทำงาน)

```bash
cd knowfacts
./serve.sh          # → http://localhost:8090
# หรือ
python3 -m http.server 8090
```

ครั้งแรกไปที่ **⚙ ตั้งค่า** → เลือก Provider → วาง API Key → 🩺 ทดสอบ
(ถ้าเคยตั้งใน NovelTrans แล้ว key จะใช้ได้ทันทีเพราะเก็บที่เดียวกัน)

---

## 🤖 AI Providers (เหมือน NovelTrans)

OpenRouter · Google Gemini · OpenAI · Anthropic Claude · DeepSeek — เรียกตรงจาก browser
- แนะนำเริ่มต้น: **Gemini 2.5 Flash** (เร็ว ถูก คุณภาพดีสำหรับงานนี้)
- ข้อความ error บอกสาเหตุชัด (key ผิด / rate limit / เครดิตหมด / CORS)

## 💾 ข้อมูล

- เก็บใน **IndexedDB** ของ browser ทั้งหมด (`KnowFactsDB`)
- API Key เก็บใน localStorage (`nt8_apikey_*` — ใช้ร่วมกับ NovelTrans)
- Export / Import เป็น JSON ได้ในหน้า ⚙ ตั้งค่า

## 📁 ไฟล์

```
knowfacts/
├── index.html              ← หน้าหลัก (topbar + nav + main + modal)
├── style.css               ← ธีม dark+gold
├── js/
│   ├── kf.providers.js     ← AI providers + aiCall/aiStream + cost (อิง app.providers.js)
│   ├── kf.core.js          ← state, IndexedDB, prompts, AI pipeline (หา Fact/คะแนน/Script/ฉาก)
│   └── kf.app.js           ← UI ทุกหน้า + Kanban board + batch + ซีรีส์ + import/export
├── manifest.webmanifest    ← PWA
├── sw.js                   ← service worker (offline)
├── icon.svg
└── serve.sh
```
