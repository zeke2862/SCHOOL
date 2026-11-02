-- 聘書（歷年教師資料）與帳號管理對應：新增對應欄位，並從帳號管理反向回填。
-- 只新增欄位、只填「目前是空的」欄位，不會覆蓋任何既有資料，可重複執行。
--
-- 新增欄位（teacher_service_certificates）：
--   app_user_id    對應 app_users.id（帳號管理），之後以這個 id 為準，不再靠姓名
--   teacher_id     對應 teachers.id（教師名單；打卡人員對照、班級導師都是用這個）
--   email          登入信箱（只供顯示與核對；實際存放在 Supabase auth，改信箱請走帳號管理）
--   renewal_status 聘用結果：待定／已發聘／不續聘（之後「確定發聘或不續聘才調整帳號」的依據）

alter table public.teacher_service_certificates
  add column if not exists app_user_id uuid references public.app_users(id) on delete set null,
  add column if not exists teacher_id uuid references public.teachers(id) on delete set null,
  add column if not exists email text,
  add column if not exists renewal_status text not null default '待定';

alter table public.teacher_service_certificates
  drop constraint if exists teacher_service_certificates_renewal_status_check;
alter table public.teacher_service_certificates
  add constraint teacher_service_certificates_renewal_status_check
  check (renewal_status in ('待定', '已發聘', '不續聘'));

create index if not exists idx_teacher_service_certificates_app_user_id on public.teacher_service_certificates(app_user_id);
create index if not exists idx_teacher_service_certificates_teacher_id on public.teacher_service_certificates(teacher_id);

-- 同一個帳號／教師只能對到一筆聘書資料（空值不限）
create unique index if not exists uq_teacher_service_certificates_app_user_id
  on public.teacher_service_certificates(app_user_id) where app_user_id is not null;
create unique index if not exists uq_teacher_service_certificates_teacher_id
  on public.teacher_service_certificates(teacher_id) where teacher_id is not null;

-- 回填 1：帳號。只在「聘書姓名唯一」且「帳號管理裡同名帳號也唯一」時才配對，同名或對不到的一律留空，交給人工處理。
with c as (
  select id, regexp_replace(name, '[[:space:]　]', '', 'g') as k
  from public.teacher_service_certificates
  where app_user_id is null
), c_unique as (
  select k from c group by k having count(*) = 1
), u as (
  select id, regexp_replace(name, '[[:space:]　]', '', 'g') as k
  from public.app_users
), u_unique as (
  select k from u group by k having count(*) = 1
)
update public.teacher_service_certificates t
set app_user_id = u.id
from c, c_unique, u, u_unique
where t.id = c.id
  and c.k = c_unique.k
  and u.k = u_unique.k
  and c.k = u.k
  and not exists (select 1 from public.teacher_service_certificates x where x.app_user_id = u.id);

-- 回填 2：教師名單。已有帳號的，用 teachers.app_user_id 對應；其餘用姓名唯一比對。
update public.teacher_service_certificates t
set teacher_id = tc.id
from public.teachers tc
where t.teacher_id is null
  and t.app_user_id is not null
  and tc.app_user_id = t.app_user_id
  and not exists (select 1 from public.teacher_service_certificates x where x.teacher_id = tc.id);

with c as (
  select id, regexp_replace(name, '[[:space:]　]', '', 'g') as k
  from public.teacher_service_certificates
  where teacher_id is null
), c_unique as (
  select k from c group by k having count(*) = 1
), tc as (
  select id, regexp_replace(name, '[[:space:]　]', '', 'g') as k
  from public.teachers
), tc_unique as (
  select k from tc group by k having count(*) = 1
)
update public.teacher_service_certificates t
set teacher_id = tc.id
from c, c_unique, tc, tc_unique
where t.id = c.id
  and c.k = c_unique.k
  and tc.k = tc_unique.k
  and c.k = tc.k
  and not exists (select 1 from public.teacher_service_certificates x where x.teacher_id = tc.id);

-- 回填 3：信箱，從登入帳號（auth.users）帶過來。
update public.teacher_service_certificates t
set email = au.email
from auth.users au
where t.email is null
  and t.app_user_id = au.id;

-- 預覽：執行後可用下面這段看結果（沒配到的就是需要人工處理的）
-- select name, app_user_id is not null as has_account, teacher_id is not null as has_teacher, email
-- from public.teacher_service_certificates order by seq_no nulls first;
