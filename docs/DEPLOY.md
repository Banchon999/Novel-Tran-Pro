# Deploy NovelTrans ขึ้น Vercel + เปิดระบบบัญชี / Premium

แอปเป็นเว็บ static + Vercel Functions 3 ตัวใน `api/` (ไม่มี build step) · ฐานข้อมูล/ล็อกอิน/ที่เก็บไฟล์ใช้ Supabase

```
เบราว์เซอร์ ──► Supabase (ล็อกอิน · สิทธิ์ · โควต้า · sync คลาวด์)   ← สิทธิ์บังคับในฐานข้อมูล (RLS)
     └──► /api/ai (Vercel) ──► OpenRouter   ← key อยู่บนเซิร์ฟเวอร์เท่านั้น
     └──► Google Drive ของผู้ใช้ (ผู้ใช้ฟรีที่กดเชื่อม)
```

## 1. Supabase (ครั้งเดียว)
1. สร้างโปรเจกต์ที่ [supabase.com](https://supabase.com) (region ใกล้ไทย: Singapore / Tokyo)
2. **SQL Editor** → วางไฟล์ `supabase/migrations/20261112000000_accounts_premium.sql` ทั้งไฟล์ → Run
3. ตั้งแอดมิน (อีเมลที่จะใช้สมัครบนเว็บ):
   ```sql
   insert into public.admin_emails(email) values ('อีเมลของคุณ');
   ```
4. **Project Settings → API**: จด `Project URL` และ `Publishable key` (หรือ anon key)

## 2. Vercel
1. [vercel.com/new](https://vercel.com/new) → Import repo นี้ → Framework Preset: **Other** (ไม่ต้องตั้ง build)
2. **Environment Variables**
   | ชื่อ | ค่า | จำเป็น |
   |---|---|---|
   | `SUPABASE_URL` | Project URL ของ Supabase | ✅ |
   | `SUPABASE_ANON_KEY` | Publishable key (เปิดเผยได้ — สิทธิ์คุมด้วย RLS) | ✅ |
   | `OPENROUTER_API_KEY` | key จาก [openrouter.ai/keys](https://openrouter.ai/keys) — **ใช้จ่ายค่า AI ของผู้ใช้ Premium** | ✅ สำหรับ Premium |
   | `GOOGLE_CLIENT_ID` | OAuth Client ID (ข้อ 4) | ไม่บังคับ (ปุ่ม Google + Drive) |
3. Deploy → ได้ URL เช่น `https://noveltrans.vercel.app`

> แนะนำตั้ง **วงเงิน (credit limit)** ของ key OpenRouter ที่ใช้กับ Premium ไว้ในหน้า Keys ของ OpenRouter — กันค่าใช้จ่ายเกินถ้ามีอะไรผิดพลาด

## 3. Supabase → Authentication
1. **URL Configuration**
   - Site URL: `https://<โดเมน vercel ของคุณ>`
   - Redirect URLs: `https://<โดเมน vercel ของคุณ>/**`
   (ไม่ตั้ง = ลิงก์ยืนยันอีเมล/ล็อกอิน Google เด้งไป localhost)
2. **อีเมล:** อีเมลในตัวของ Supabase ส่งได้แค่ไม่กี่ฉบับต่อชั่วโมง — มีผู้ใช้จริงต้องตั้ง **Custom SMTP** (เช่น [Resend](https://resend.com) ฟรี 3,000 ฉบับ/เดือน): Authentication → Emails → SMTP Settings
   - อย่าปิด "Confirm email" — การยืนยันอีเมลกันคนสมัครด้วยอีเมลของคนอื่น (รวมถึงอีเมลแอดมิน)

## 4. Google (ไม่บังคับ — ปุ่ม "เข้าสู่ระบบด้วย Google" + ผู้ใช้ฟรี sync Google Drive)
1. [console.cloud.google.com](https://console.cloud.google.com) → สร้างโปรเจกต์
2. **APIs & Services → Library** → เปิด **Google Drive API**
3. **OAuth consent screen** → External → ใส่ชื่อแอป/อีเมล → Scopes: เพิ่ม `.../auth/drive.appdata` → Publish app
4. **Credentials → Create OAuth client ID** → Web application
   - Authorized JavaScript origins: `https://<โดเมน vercel ของคุณ>`
   - Authorized redirect URIs: `https://<project-ref>.supabase.co/auth/v1/callback`
5. Supabase → Authentication → Providers → **Google** → ใส่ Client ID + Client Secret → Enable
6. Vercel → Environment Variables → `GOOGLE_CLIENT_ID` = Client ID → Redeploy

## 5. ใช้งาน
1. เปิดเว็บ → ☰ → 👤 เข้าสู่ระบบ / สมัครฟรี → สมัครด้วยอีเมลแอดมิน → ยืนยันอีเมล
2. ☰ → 🛠 แอดมิน (หรือ `/admin.html`)
   - **ผู้ใช้:** +30 วัน / กำหนดวัน / ไม่หมดอายุ / ตั้งโควต้า / ยกเลิก Premium
   - **คำขอ Premium:** ผู้ใช้กด "⭐ ขอ Premium" แล้วฝากช่องทางติดต่อ → กดเปิดสิทธิ์ได้เลย
   - **โมเดล / โควต้า:** รายการโมเดลที่ Premium ใช้ได้ + โควต้าเริ่มต้น (USD/เดือน, รีเซ็ตต้นเดือนเวลาไทย)

## ต้นทุน / ข้อจำกัดที่ควรรู้
- โควต้าเริ่มต้น **$2/เดือน/คน** ≈ หลายร้อยตอนกับ Gemini Flash Lite (ขึ้นกับความยาวตอน) — ปรับในหน้าแอดมิน
- เช็คโควต้าก่อนเรียกแต่ละครั้ง → ถ้ายิงพร้อมกันหลาย request อาจเกินโควต้าได้เล็กน้อย
- Supabase ฟรี: ที่เก็บไฟล์ 1GB รวม · ไฟล์ละไม่เกิน 50MB (นิยาย 1 เรื่อง = 1 ไฟล์) · **pause อัตโนมัติถ้าไม่มีการใช้งาน 7 วัน**
- Vercel Hobby: ห้ามใช้เชิงพาณิชย์ — ถ้าเริ่มเก็บเงินค่า Premium ให้อัปเป็น Pro
- ลบเรื่องในเครื่องหนึ่ง → ลบบนคลาวด์ด้วย แต่เครื่องอื่นที่ยังมีเรื่องนั้นอยู่จะอัปโหลดกลับขึ้นไป (ตั้งใจ: กันข้อมูลหาย)

## ทดสอบ
```bash
bash tests/e2e/run.sh    # syntax + API proxy + e2e (mock ทั้งหมด ไม่เสียเงิน)
```
