# ชุดทดสอบเพศ / สรรพนาม / ครับ-ค่ะ

ทดสอบด้วยบทจำลอง (ไม่ใช้นิยายจริง → เร็วและถูก) เรียก OpenRouter จริง ต้องมี key (ผ่าน proxy หรือ `OPENROUTER_API_KEY`)

| ไฟล์ | ใช้ทำอะไร | ค่าใช้จ่าย/รอบ |
|---|---|---|
| `scenarios.json` | บทจำลอง 3 ตอน (37 ย่อหน้า) ติดป้ายเฉลยทุกย่อหน้า: ใครพูด, ควรสุภาพไหม, ประธานในบรรยายเพศอะไร | — |
| `run-scenarios.js` | แปลทั้ง 3 ตอนผ่านแอปจริง (Chromium) คลังศัพท์เริ่มว่าง + Auto Glossary แล้วตรวจอัตโนมัติ | ~$0.01/โมเดล |
| `proofread-cases.json` | เคสตัวตรวจเพศหลังแปล: ต้องแก้ 3 เคส, ห้ามแก้ 3 เคส | — |
| `run-proofread.js` | รันเคสด้านบนกับ `genderProofread` (ไม่ต้องแปลใหม่) | ~$0.005 |
| `run-speakermap-models.js` | เทียบโมเดลช่วยของแผนที่ผู้พูด: เพศต่อบรรทัดเทียบเฉลย (เคสเล็ก) + ตอนจริงเทียบโมเดลแรก (ตรงกี่บรรทัด · เพศสลับกี่บรรทัด) + ราคาจริง + เวลา | ตามโมเดล (Gemma 4 26B ~$0.0002/ตอน) |
| `archaic-cases.json` + `run-archaic-speakermap.js` | เปิด/ปิดแผนที่ผู้พูด ในเรื่องยุทธภพจีน/เกาหลี และออฟฟิศเกาหลี: ยุทธภพต้องเป็น ข้า/ขอรับ/เจ้าค่ะ (ผม/ครับ/ค่ะ = 0) · ออฟฟิศต้องยังเป็น ผม/ครับ | ~$0.013/รอบ 2 ครั้ง (Gemini 3.1 Flash Lite) |
| `title-cases.json` + `run-title-3lang.js` | ผู้อำนวยการถูกเรียกด้วยตำแหน่งอย่างเดียว ทั้ง เกาหลี/จีน/อังกฤษ: A ตั้งเพศหญิง → ไม่มี "เขา" · B ไม่รู้เพศ → ไม่มี เขา/เธอ · ผู้เล่าชาย → บรรยาย "ฉัน" + พูดสุภาพ "ครับ" · X สกัดคำ → ตำแหน่งได้เพศ, ตำแหน่งที่หลายคนมีไม่มีเพศ | ~$0.007/รอบ (Gemini 3.1 Flash Lite) |

```bash
node tests/gender/run-scenarios.js google/gemini-3.1-flash-lite,google/gemini-3.5-flash-lite,google/gemini-3-flash-preview mytag
node tests/gender/run-proofread.js 2          # 2 รอบ · GPM=<model> เปลี่ยนโมเดลตรวจ
node tests/gender/run-title-3lang.js google/gemini-3.1-flash-lite 2   # ต้องเปิด http.server 8099 ก่อน
node tests/gender/run-archaic-speakermap.js 2          # แผนที่ผู้พูดในเรื่องยุทธภพ · PREV=1 / GENRE='{"ko":"ko-murim"}'
node tests/gender/run-speakermap-models.js google/gemini-3-flash-preview,google/gemma-4-26b-a4b-it   # เลือกโมเดลช่วย · WS_FILE=<workspace.json> CHAPTERS=2,7 วัดกับตอนจริง
WS_TEMPLATE=my-workspace.json node tests/gender/run-scenarios.js <model>   # ใช้พรีเซ็ตของ workspace จริง
```

ผลลัพธ์อยู่ใน `tests/gender/out/` (ไม่ commit)

## อ่านผล run-scenarios
- **พูดผิดเพศ** = บทพูด/ความคิดของผู้หญิงมี ครับ/ผม หรือของผู้ชายมี ค่ะ/คะ/ดิฉัน → ผิดจริง
- **บรรยายน่าสงสัย** = ย่อหน้าบรรยายที่ประธานเป็นหญิงมี "เขา" (หรือกลับกัน) → ต้องดูด้วยตา เพราะ "เขา" อาจหมายถึงคนอื่นในประโยค (เช่น "สาวใช้ของเขา")
- **ขาดหางเสียง / หางเสียงเกิน** = ระดับภาษาไม่ตรงต้นฉบับ (สุภาพ ↔ ภาษาปกติ)
- **เพศในคลัง** = Auto Glossary สกัดเพศตัวละครถูกกี่ตัว

## ผลล่าสุด (2026-10-03)
| โมเดลแปล | พูดผิดเพศ | บรรยายผิดจริง | หางเสียง | เพศในคลัง | ตอนล้มเหลว |
|---|---|---|---|---|---|
| Gemini 3.1 Flash Lite | 0 | 0 | ถูกหมด | 5/5 | 0 |
| Gemini 3.5 Flash Lite | 0 | 0 | ถูกหมด | 5/5 | 0 |
| Gemini 3 Flash Preview | 0 | 0 | ถูกหมด | 5/5 | 0 |

run-proofread: 12/12 (2 รอบ)
