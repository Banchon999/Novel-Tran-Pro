-- NovelTrans: บัญชีผู้ใช้ · Premium · โควต้า AI · คำขอ Premium · sync คลาวด์
-- สิทธิ์ทั้งหมดบังคับในฐานข้อมูล (RLS + ฟังก์ชัน SECURITY DEFINER) — เซิร์ฟเวอร์ใช้แค่ anon key + JWT ผู้ใช้
-- เพิ่มแอดมิน (ไม่ commit อีเมลลง repo):  insert into public.admin_emails(email) values ('you@example.com');

-- ───────────── ตาราง ─────────────
create table if not exists public.app_config (
  id int primary key default 1 check (id = 1),
  premium_models jsonb not null,
  default_model text not null,
  default_quota_usd numeric(10,4) not null default 2 check (default_quota_usd >= 0),
  updated_at timestamptz not null default now()
);
insert into public.app_config (id, premium_models, default_model, default_quota_usd) values (1,
  '[{"id":"google/gemini-3.1-flash-lite","name":"Gemini 3.1 Flash Lite 💰 แนะนำ"},
    {"id":"deepseek/deepseek-v3.2","name":"DeepSeek V3.2"},
    {"id":"google/gemini-3.5-flash-lite","name":"Gemini 3.5 Flash Lite"},
    {"id":"openai/gpt-5-nano","name":"GPT-5 Nano"},
    {"id":"qwen/qwen3.8-flash","name":"Qwen3.8 Flash"},
    {"id":"google/gemma-4-26b-a4b-it","name":"Gemma 4 26B 💰"}]'::jsonb,
  'google/gemini-3.1-flash-lite', 2)
on conflict (id) do nothing;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  display_name text,
  plan text not null default 'free' check (plan in ('free', 'premium')),
  premium_until timestamptz,
  monthly_quota_usd numeric(10,4) not null default 2 check (monthly_quota_usd >= 0),
  created_at timestamptz not null default now()
);

create table if not exists public.admins (
  user_id uuid primary key references auth.users(id) on delete cascade
);
create table if not exists public.admin_emails (
  email text primary key
);

create table if not exists public.usage_log (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  model text not null,
  input_tokens int not null default 0 check (input_tokens >= 0),
  output_tokens int not null default 0 check (output_tokens >= 0),
  cost_usd numeric(12,6) not null default 0 check (cost_usd >= 0),
  created_at timestamptz not null default now()
);
create index if not exists usage_log_user_time on public.usage_log (user_id, created_at);

create table if not exists public.premium_requests (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  contact text check (char_length(contact) <= 200),
  note text check (char_length(note) <= 1000),
  status text not null default 'pending' check (status in ('pending', 'done', 'rejected')),
  created_at timestamptz not null default now()
);
create index if not exists premium_requests_user on public.premium_requests (user_id);

-- ───────────── RLS ─────────────
alter table public.app_config       enable row level security;
alter table public.profiles         enable row level security;
alter table public.admins           enable row level security;
alter table public.admin_emails     enable row level security;
alter table public.usage_log        enable row level security;
alter table public.premium_requests enable row level security;

drop policy if exists "config readable" on public.app_config;
create policy "config readable" on public.app_config for select to anon, authenticated using (true);
drop policy if exists "own profile" on public.profiles;
create policy "own profile" on public.profiles for select to authenticated using (id = (select auth.uid()));
drop policy if exists "own usage" on public.usage_log;
create policy "own usage" on public.usage_log for select to authenticated using (user_id = (select auth.uid()));
drop policy if exists "own requests" on public.premium_requests;
create policy "own requests" on public.premium_requests for select to authenticated using (user_id = (select auth.uid()));
-- admins / admin_emails: ไม่มี policy = อ่าน/เขียนผ่าน API ไม่ได้เลย (ใช้ผ่านฟังก์ชันเท่านั้น)

-- ───────────── สมัครใหม่ → สร้าง profile ─────────────
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, email, display_name, monthly_quota_usd)
  values (new.id, new.email,
          coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name'),
          coalesce((select default_quota_usd from public.app_config where id = 1), 2))
  on conflict (id) do nothing;
  return new;
end $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- ───────────── ฟังก์ชันช่วย ─────────────
create or replace function public.month_start()
returns timestamptz language sql stable set search_path = '' as $$
  select (date_trunc('month', now() at time zone 'Asia/Bangkok')) at time zone 'Asia/Bangkok'
$$;

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and (
    exists (select 1 from public.admins a where a.user_id = auth.uid())
    or exists (select 1 from auth.users u join public.admin_emails e on lower(e.email) = lower(u.email)
               where u.id = auth.uid() and u.email_confirmed_at is not null))
$$;

create or replace function public.is_premium(uid uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles p
                 where p.id = uid and p.plan = 'premium' and (p.premium_until is null or p.premium_until > now()))
$$;

create or replace function public.used_this_month(uid uuid)
returns numeric language sql stable security definer set search_path = '' as $$
  select coalesce(sum(cost_usd), 0) from public.usage_log where user_id = uid and created_at >= public.month_start()
$$;

-- ───────────── ฟังก์ชันของผู้ใช้ ─────────────
create or replace function public.my_account()
returns json language plpgsql volatile security definer set search_path = '' as $$
declare p public.profiles; uid uuid := auth.uid();
begin
  if uid is null then return null; end if;
  select * into p from public.profiles where id = uid;
  if not found then  -- ผู้ใช้ที่สมัครก่อนมี trigger
    insert into public.profiles (id, email) select id, email from auth.users where id = uid on conflict do nothing;
    select * into p from public.profiles where id = uid;
  end if;
  return json_build_object(
    'email', p.email, 'display_name', p.display_name, 'plan', p.plan, 'premium_until', p.premium_until,
    'premium_active', public.is_premium(uid), 'quota_usd', p.monthly_quota_usd,
    'used_usd', public.used_this_month(uid), 'is_admin', public.is_admin(),
    'pending_request', exists (select 1 from public.premium_requests r where r.user_id = uid and r.status = 'pending'));
end $$;

-- เรียกโดย /api/ai ก่อนส่งต่อ OpenRouter (ด้วย JWT ผู้ใช้)
create or replace function public.premium_check(p_model text)
returns json language plpgsql stable security definer set search_path = '' as $$
declare uid uuid := auth.uid(); q numeric; used numeric; allowed boolean;
begin
  if uid is null then return json_build_object('ok', false, 'code', 401, 'message', 'ยังไม่ได้เข้าสู่ระบบ'); end if;
  if not public.is_premium(uid) then
    return json_build_object('ok', false, 'code', 403, 'message', 'บัญชีนี้ยังไม่ใช่ Premium หรือ Premium หมดอายุแล้ว');
  end if;
  select exists (select 1 from public.app_config c, jsonb_array_elements(c.premium_models) m
                 where c.id = 1 and m->>'id' = p_model) into allowed;
  if not allowed then
    return json_build_object('ok', false, 'code', 403, 'message', 'โมเดล ' || coalesce(p_model, '?') || ' ไม่อยู่ในรายการ Premium — เลือกโมเดลจากรายการ');
  end if;
  select monthly_quota_usd into q from public.profiles where id = uid;
  used := public.used_this_month(uid);
  if used >= q then
    return json_build_object('ok', false, 'code', 402, 'message',
      format('โควต้า Premium เดือนนี้หมดแล้ว (ใช้ไป $%s จาก $%s) — รีเซ็ตต้นเดือน หรือติดต่อแอดมิน', round(used, 2), round(q, 2)));
  end if;
  return json_build_object('ok', true, 'remaining_usd', q - used);
end $$;

-- บันทึกต้นทุนจริง (เพิ่มได้อย่างเดียว — ผู้ใช้เรียกเองก็ได้แค่ทำให้ยอดตัวเองสูงขึ้น)
create or replace function public.record_usage(p_model text, p_in int, p_out int, p_cost numeric)
returns void language plpgsql volatile security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  insert into public.usage_log (user_id, model, input_tokens, output_tokens, cost_usd)
  values (auth.uid(), left(coalesce(p_model, '?'), 200), greatest(coalesce(p_in, 0), 0),
          greatest(coalesce(p_out, 0), 0), greatest(coalesce(p_cost, 0), 0));
end $$;

create or replace function public.request_premium(p_contact text, p_note text)
returns json language plpgsql volatile security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if exists (select 1 from public.premium_requests where user_id = auth.uid() and status = 'pending') then
    return json_build_object('ok', false, 'message', 'มีคำขอที่รอแอดมินอยู่แล้ว');
  end if;
  insert into public.premium_requests (user_id, contact, note)
  values (auth.uid(), left(coalesce(p_contact, ''), 200), left(coalesce(p_note, ''), 1000));
  return json_build_object('ok', true);
end $$;

-- ───────────── ฟังก์ชันแอดมิน ─────────────
create or replace function public.assert_admin()
returns void language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'admin only' using errcode = '42501'; end if;
end $$;

create or replace function public.admin_list_users(p_q text default '', p_limit int default 200)
returns table (id uuid, email text, display_name text, plan text, premium_until timestamptz, premium_active boolean,
               quota_usd numeric, used_usd numeric, created_at timestamptz, last_used timestamptz, pending_request boolean)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.assert_admin();
  return query
    select p.id, p.email, p.display_name, p.plan, p.premium_until, public.is_premium(p.id),
           p.monthly_quota_usd, public.used_this_month(p.id), p.created_at,
           (select max(u.created_at) from public.usage_log u where u.user_id = p.id),
           exists (select 1 from public.premium_requests r where r.user_id = p.id and r.status = 'pending')
    from public.profiles p
    where coalesce(p_q, '') = '' or p.email ilike '%' || p_q || '%' or p.display_name ilike '%' || p_q || '%'
    order by (exists (select 1 from public.premium_requests r where r.user_id = p.id and r.status = 'pending')) desc,
             p.created_at desc
    limit least(greatest(coalesce(p_limit, 200), 1), 1000);
end $$;

-- ต่ออายุ Premium p_days วัน (นับต่อจากวันหมดอายุเดิมถ้ายังไม่หมด) · p_days <= 0 = ไม่มีวันหมดอายุ
create or replace function public.admin_set_premium(p_uid uuid, p_days int, p_quota numeric default null)
returns void language plpgsql volatile security definer set search_path = '' as $$
begin
  perform public.assert_admin();
  update public.profiles set
    plan = 'premium',
    premium_until = case when coalesce(p_days, 0) <= 0 then null
                         else greatest(coalesce(premium_until, now()), now()) + make_interval(days => p_days) end,
    monthly_quota_usd = coalesce(p_quota, monthly_quota_usd)
  where id = p_uid;
  update public.premium_requests set status = 'done' where user_id = p_uid and status = 'pending';
end $$;

create or replace function public.admin_set_quota(p_uid uuid, p_quota numeric)
returns void language plpgsql volatile security definer set search_path = '' as $$
begin
  perform public.assert_admin();
  if p_quota is null or p_quota < 0 then raise exception 'quota ต้อง >= 0'; end if;
  update public.profiles set monthly_quota_usd = p_quota where id = p_uid;
end $$;

create or replace function public.admin_revoke_premium(p_uid uuid)
returns void language plpgsql volatile security definer set search_path = '' as $$
begin
  perform public.assert_admin();
  update public.profiles set plan = 'free', premium_until = null where id = p_uid;
end $$;

create or replace function public.admin_list_requests()
returns table (id bigint, user_id uuid, email text, contact text, note text, status text, created_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.assert_admin();
  return query
    select r.id, r.user_id, p.email, r.contact, r.note, r.status, r.created_at
    from public.premium_requests r left join public.profiles p on p.id = r.user_id
    order by (r.status = 'pending') desc, r.created_at desc limit 300;
end $$;

create or replace function public.admin_resolve_request(p_id bigint, p_status text)
returns void language plpgsql volatile security definer set search_path = '' as $$
begin
  perform public.assert_admin();
  if p_status not in ('pending', 'done', 'rejected') then raise exception 'bad status'; end if;
  update public.premium_requests set status = p_status where id = p_id;
end $$;

create or replace function public.admin_set_config(p_models jsonb, p_default_model text, p_default_quota numeric)
returns void language plpgsql volatile security definer set search_path = '' as $$
begin
  perform public.assert_admin();
  if jsonb_typeof(p_models) <> 'array' or jsonb_array_length(p_models) = 0 then raise exception 'ต้องมีโมเดลอย่างน้อย 1 ตัว'; end if;
  if not exists (select 1 from jsonb_array_elements(p_models) m where m->>'id' = p_default_model) then
    raise exception 'โมเดลเริ่มต้นต้องอยู่ในรายการ';
  end if;
  update public.app_config set premium_models = p_models, default_model = p_default_model,
    default_quota_usd = coalesce(p_default_quota, default_quota_usd), updated_at = now() where id = 1;
end $$;

-- สรุปยอดรวมเดือนนี้ (หน้าแอดมิน)
create or replace function public.admin_stats()
returns json language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.assert_admin();
  return json_build_object(
    'users', (select count(*) from public.profiles),
    'premium', (select count(*) from public.profiles p where public.is_premium(p.id)),
    'pending_requests', (select count(*) from public.premium_requests where status = 'pending'),
    'month_cost_usd', (select coalesce(sum(cost_usd), 0) from public.usage_log where created_at >= public.month_start()),
    'month_requests', (select count(*) from public.usage_log where created_at >= public.month_start()));
end $$;

-- ───────────── สิทธิ์เรียกฟังก์ชัน ─────────────
revoke execute on all functions in schema public from public, anon;
grant execute on function public.my_account(), public.premium_check(text), public.record_usage(text, int, int, numeric),
  public.request_premium(text, text), public.is_admin(), public.admin_list_users(text, int),
  public.admin_set_premium(uuid, int, numeric), public.admin_set_quota(uuid, numeric), public.admin_revoke_premium(uuid),
  public.admin_list_requests(), public.admin_resolve_request(bigint, text), public.admin_set_config(jsonb, text, numeric),
  public.admin_stats(), public.is_premium(uuid)
  to authenticated;
-- ฟังก์ชันภายใน: ใช้ได้เฉพาะจากฟังก์ชันอื่น / RLS
revoke execute on function public.handle_new_user(), public.used_this_month(uuid), public.assert_admin(), public.month_start() from authenticated;

-- ───────────── Storage: sync คลาวด์ (Premium) ─────────────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('workspaces', 'workspaces', false, 52428800, array['application/json'])
on conflict (id) do nothing;

-- อ่าน/ลบ: เจ้าของเสมอ (Premium หมดอายุก็ยังดึงข้อมูลคืนได้) · เขียน: เจ้าของ + Premium
drop policy if exists "ws read own" on storage.objects;
create policy "ws read own" on storage.objects for select to authenticated
  using (bucket_id = 'workspaces' and (storage.foldername(name))[1] = (select auth.uid())::text);
drop policy if exists "ws delete own" on storage.objects;
create policy "ws delete own" on storage.objects for delete to authenticated
  using (bucket_id = 'workspaces' and (storage.foldername(name))[1] = (select auth.uid())::text);
drop policy if exists "ws insert premium" on storage.objects;
create policy "ws insert premium" on storage.objects for insert to authenticated
  with check (bucket_id = 'workspaces' and (storage.foldername(name))[1] = (select auth.uid())::text
              and public.is_premium((select auth.uid())));
drop policy if exists "ws update premium" on storage.objects;
create policy "ws update premium" on storage.objects for update to authenticated
  using (bucket_id = 'workspaces' and (storage.foldername(name))[1] = (select auth.uid())::text)
  with check (bucket_id = 'workspaces' and (storage.foldername(name))[1] = (select auth.uid())::text
              and public.is_premium((select auth.uid())));
