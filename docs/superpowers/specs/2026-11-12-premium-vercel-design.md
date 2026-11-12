# NovelTrans บน Vercel + ระบบบัญชี / Premium — Design

วันที่: 2026-11-12 · สถานะ: อนุมัติแล้ว (Max)

## เป้าหมาย
- Deploy แอปขึ้น Vercel ให้คนทั่วไปใช้แปลได้
- **ฟรี**: ใส่ API key เอง (BYOK เหมือนเดิม) · เก็บข้อมูลในเครื่อง + sync ไป **Google Drive ของผู้ใช้เอง** (ถ้าเชื่อม)
- **Premium**: แปลด้วย AI ในตัว (OpenRouter key ของเจ้าของระบบ อยู่บนเซิร์ฟเวอร์) + **sync นิยายขึ้นคลาวด์** (Supabase Storage)
- ล็อกอิน: อีเมล+รหัสผ่าน และ Google (Supabase Auth)
- ยังไม่เก็บเงิน — แอดมินเปิด/ต่ออายุ Premium เองในหน้าแอดมิน · ผู้ใช้กด "ขอ Premium" ได้

## ข้อจำกัด
- แอปเดิมเป็น static (Vanilla JS, ไม่มี build) — คงไว้ ไฟล์ zip ใน Release ต้องยังใช้ได้แบบไม่มีบัญชี
- บัญชีไม่บังคับ — ไม่ล็อกอินก็ใช้ BYOK + เก็บในเครื่องได้ทั้งหมด
- ไม่มี service-role key บน Vercel — สิทธิ์ทั้งหมดบังคับด้วย RLS + ฟังก์ชัน Postgres (SECURITY DEFINER) ที่เช็คสิทธิ์เอง

## สถาปัตยกรรม
```
Browser (static app) ──► Supabase Auth / RPC / Storage (anon key + JWT ผู้ใช้)
        │                      ▲
        └──► Vercel /api/ai ───┘ (ตรวจ JWT, เช็คสิทธิ์/โควต้าผ่าน RPC ด้วย JWT ผู้ใช้)
                    └──► OpenRouter (OPENROUTER_API_KEY)
Browser ──► Google Drive appDataFolder (ผู้ใช้ฟรี, token จาก Google Identity Services)
```

### Vercel Functions
| Endpoint | หน้าที่ |
|---|---|
| `GET /api/config` | คืน `supabaseUrl`, `supabaseAnonKey`, `googleClientId` (จาก env) — ไม่มี env = ฟีเจอร์บัญชีซ่อน |
| `GET /api/models` | รายการโมเดลที่ Premium ใช้ได้ (จาก `app_config`) รูปแบบ OpenAI `{data:[{id,name}]}` |
| `POST /api/ai` | proxy แบบ OpenAI chat completions: ตรวจ JWT → `premium_check(model)` → ส่งต่อ OpenRouter (stream/ไม่ stream, เปิด `usage.include`) → `record_usage(...)` ด้วยต้นทุนจริง |

`/api/ai` บังคับ: `max_tokens ≤ 16000`, body ≤ 1MB, โมเดลต้องอยู่ใน allowlist. Error ตอบเป็น `{error:{message}}` ภาษาไทย: 401 ไม่ได้ล็อกอิน, 403 ไม่ใช่ Premium/หมดอายุ/โมเดลไม่อนุญาต, 402 โควต้าเดือนนี้หมด.

### ฐานข้อมูล (Supabase)
- `profiles(id → auth.users, email, display_name, plan 'free'|'premium', premium_until, monthly_quota_usd default 2, created_at)` — สร้างอัตโนมัติด้วย trigger ตอนสมัคร · ผู้ใช้อ่านได้เฉพาะแถวตัวเอง แก้ไม่ได้
- `usage_log(id, user_id, model, input_tokens, output_tokens, cost_usd, created_at)` — ผู้ใช้อ่านของตัวเอง เขียนผ่าน RPC เท่านั้น
- `premium_requests(id, user_id, contact, note, status 'pending'|'done'|'rejected', created_at)` — ผู้ใช้สร้าง/อ่านของตัวเอง
- `app_config(id=1, premium_models jsonb, default_model, default_quota_usd)` — อ่านได้ทุกคน แก้ผ่าน RPC แอดมิน
- `admins(user_id)` — รายชื่อแอดมิน
- RPC: `is_admin()`, `is_premium(uid)`, `my_account()`, `premium_check(model)`, `record_usage(model,in,out,cost)` (cost ≥ 0, เพิ่มได้อย่างเดียว), `admin_list_users(q)`, `admin_set_premium(uid, days, quota)`, `admin_revoke_premium(uid)`, `admin_list_requests()`, `admin_resolve_request(id,status)`, `admin_set_config(models, default_model, default_quota)`
- Storage bucket `workspaces` (private): path `{uid}/{wsId}.json` — RLS: เจ้าของ + `is_premium(auth.uid())`

### Frontend
- `js/app.account.js` — โหลด config, supabase-js (UMD pinned), ล็อกอิน/สมัคร/ออก, สถานะบัญชี + โควต้า, ปุ่มขอ Premium, provider `premium`
- `js/app.sync.js` — sync engine เดียว + adapter 2 ตัว (`supabase`, `gdrive`) interface `list() / get(id) / put(id, json) / remove(id)`
  - จุดเกาะ: `lsSaveWorkspace` / `lsDeleteWorkspace` → mark dirty + sync แบบหน่วง 4 วินาที
  - เปิดแอป/ล็อกอิน → ดึงรายการ remote, ฝั่งไหนใหม่กว่าชนะ; ถ้าแก้ทั้งสองฝั่งตั้งแต่ sync ล่าสุด → ถามผู้ใช้
  - สถานะ sync เก็บใน IDB meta `sync_state`
- `PROVIDERS.premium` — OpenAI-compatible ชี้ `/api/ai`, key = access token (resolve แบบ async ก่อนเรียกทุกครั้ง), โมเดลจาก `/api/models`
- `admin.html` — หน้าแอดมิน (ผู้ใช้, คำขอ, ตั้งค่าโมเดล/โควต้า)
- `sw.js` — ไม่ยุ่งกับ `/api/*` และ cross-origin ของ Supabase/Google

## การทดสอบ
- `tests/api/run-api.js` — ทดสอบ `/api/ai` ด้วย mock Supabase/OpenRouter: ไม่มี token, ไม่ใช่ Premium, โควต้าหมด, โมเดลไม่อนุญาต, stream ผ่าน + บันทึก usage
- e2e Playwright เดิมต้องผ่าน (ไม่ล็อกอิน = เหมือนเดิม)
- smoke test บน URL Vercel จริง

## สิ่งที่เจ้าของระบบต้องทำเอง
1. ใส่ `OPENROUTER_API_KEY` ใน Vercel
2. สร้าง Google OAuth Client → ใส่ใน Supabase (Google provider) + `GOOGLE_CLIENT_ID` ใน Vercel
3. สมัครบัญชีบนเว็บแล้วให้ระบบเพิ่มเป็นแอดมิน

## ความเสี่ยงที่ยอมรับ
- เช็คโควต้าก่อนเรียก → request พร้อมกันหลายตัวอาจเกินโควต้าเล็กน้อย
- Supabase ฟรี pause เมื่อไม่มีการใช้ 7 วัน
