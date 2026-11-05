create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
create schema auth;
create function auth.uid() returns uuid language sql stable as $$ select nullif(nullif(current_setting('request.jwt.claims', true),'')::json->>'sub','')::uuid $$;
create schema storage;
create table storage.buckets (id text primary key, name text, public boolean default false);
create table storage.objects (id uuid default gen_random_uuid() primary key, bucket_id text, name text, owner uuid);
alter table storage.objects enable row level security;

create type public.user_role as enum ('system_admin_s','admin_a','admin_b','homeroom_teacher','subject_teacher');
create table public.app_users (id uuid primary key, name text not null, role public.user_role not null, is_temporary boolean default false, account_expires_at timestamptz, home_org text, must_change_password boolean default false);
create table public.teachers (id uuid default gen_random_uuid() primary key, app_user_id uuid, name text not null);
create table public.students (student_no text primary key, name text not null);
create table public.classes (id uuid default gen_random_uuid() primary key, class_name text, academic_year int, department text, grade_level text not null, homeroom_teacher_id uuid references public.teachers(id));
create table public.enrollments (id uuid default gen_random_uuid() primary key, student_no text not null, class_id uuid not null, term text, seat_no int, is_current boolean default true);
create table public.portal_accounts (id uuid default gen_random_uuid() primary key, student_no text, auth_user_id uuid, relation text default '家長');
create table public.staff_notifications (id uuid default gen_random_uuid() primary key, teacher_id uuid not null, category text not null, message text not null, student_no text, created_at timestamptz default now(), read_at timestamptz);

create function public.current_role_name() returns public.user_role language sql stable as $$ select role from app_users where id = auth.uid() $$;
create function public.is_system_admin() returns boolean language sql stable as $$ select current_role_name() = 'system_admin_s' $$;
create function public.current_teacher_id() returns uuid language sql stable as $$ select id from teachers where app_user_id = auth.uid() $$;
create function public.current_portal_student_no() returns text language sql stable as $$
  select student_no from portal_accounts where auth_user_id = auth.uid() and relation = '學生本人' limit 1 $$;

grant usage on schema public, auth to anon, authenticated;
-- 模擬正式站「登入就能讀」的寬鬆政策，用來驗證訪客隔離
alter table public.classes enable row level security; create policy r on public.classes for select using (true);
alter table public.teachers enable row level security; create policy r on public.teachers for select using (true);
alter table public.app_users enable row level security; create policy r on public.app_users for select using (true);
alter table public.staff_notifications enable row level security; create policy r on public.staff_notifications for select using (true);
alter table public.students enable row level security; create policy r on public.students for select using (true);

-- 模擬正式庫的 student_is_hidden（休學/轉學/退學/畢業/肄業）
create table public.hidden_stub (student_no text primary key);
create function public.student_is_hidden(p text) returns boolean language sql stable as $$ select exists (select 1 from public.hidden_stub where student_no = p) $$;
