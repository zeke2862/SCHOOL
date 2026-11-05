-- 143: 競賽系統（賽事 / 組別 / 項目 / 報名 / 評審 / 評分 / 公布與修正 / 作品投票 / QR 公開成績頁）
-- 請先跑 142（新增 competition_guest 角色），再跑本檔。可重複執行。
-- 設計重點：
--   * 任何教師（非訪客）都能建立賽事，建立者自動成為承辦人。
--   * 學生用「學生本人」入口帳號報名，系統依目前班級的年級自動判斷可報名組別。
--   * 報名/撤回/公布/修正都走函式（SECURITY DEFINER），不開放直接寫表，規則集中在資料庫。
--   * 成績先公布、公布後才能修正；每次修正必填說明，自動產生「修正公告」。
--   * 外校只看公開成績頁（QR 碼），不碰系統；公開頁只透過 comp_public_view() 取資料。

-- ===================== 0. 通知類別加上「賽事通知」 =====================
alter table public.staff_notifications drop constraint if exists staff_notifications_category_check;
alter table public.staff_notifications add constraint staff_notifications_category_check
  check (category = any (array['個資修改申請','出缺勤示警','代課通知','考場通知','學生資料變更','審核通知','代理通知','請假申請','學籍異動申請','賽事通知']));

-- ===================== 1. 資料表 =====================
create table if not exists public.comp_events (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  scope text not null default 'internal' check (scope in ('internal','external')),   -- internal=校內；external=含外校（外校資料由承辦人匯入建檔）
  status text not null default 'draft' check (status in ('draft','open','closed','running','finished')),
  academic_year int,
  term text check (term in ('上學期','下學期')),
  reg_open_at timestamptz,
  reg_close_at timestamptz,
  public_enabled boolean not null default false,    -- QR 公開成績頁總開關
  public_token text not null unique default replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
  config jsonb not null default '{}'::jsonb,        -- max_items_per_person、public_show_score 等
  created_by uuid not null default auth.uid(),
  created_at timestamptz not null default now(),
  constraint comp_events_window_chk check (reg_close_at is null or reg_open_at is null or reg_close_at > reg_open_at)
);

create table if not exists public.comp_organizers (
  event_id uuid not null references public.comp_events(id) on delete cascade,
  user_id uuid not null references public.app_users(id) on delete cascade,
  added_at timestamptz not null default now(),
  primary key (event_id, user_id)
);

create table if not exists public.comp_groups (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.comp_events(id) on delete cascade,
  code text not null,
  name text not null,
  grade_levels text[] not null default '{}',      -- 例：{'1年','2年'}；須與 classes.grade_level 文字一致
  teacher_only boolean not null default false,    -- 教師組
  sort_no int not null default 0,
  unique (event_id, code)
);

create table if not exists public.comp_items (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.comp_events(id) on delete cascade,
  group_id uuid not null references public.comp_groups(id) on delete cascade,
  code text not null,
  name text not null,
  score_type text not null default 'judge'
    check (score_type in ('judge','test','chess','record','vote')),
  judge_count int not null default 3,
  criteria jsonb not null default '[]'::jsonb,    -- [{label, weight}]
  quota int,                                      -- 人數上限（空=不限）
  config jsonb not null default '{}'::jsonb,      -- 例：vote_open_at、vote_close_at、votes_per_voter、drop_high_low
  revision int not null default 0,                -- 公布後每修正一次 +1
  published_at timestamptz,
  published_by uuid,
  sort_no int not null default 0,
  unique (event_id, code)
);
create index if not exists comp_items_event_idx on public.comp_items(event_id);

create table if not exists public.comp_registrations (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.comp_events(id) on delete cascade,
  item_id uuid not null references public.comp_items(id) on delete cascade,
  kind text not null check (kind in ('student','teacher','external')),
  student_no text references public.students(student_no) on delete set null,
  teacher_user_id uuid references public.app_users(id) on delete set null,
  display_name text not null,                      -- 登記當下的姓名（公開頁用）
  school_name text,                                -- 學校（校內=本校；外校=匯入）
  grade_label text,
  diet text,
  draw_number text,
  status text not null default 'registered' check (status in ('registered','withdrawn')),
  registered_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  constraint comp_reg_identity_chk check (
    (kind = 'student'  and student_no is not null) or
    (kind = 'teacher'  and teacher_user_id is not null) or
    (kind = 'external')
  )
);
create unique index if not exists comp_reg_uq_student on public.comp_registrations(item_id, student_no)
  where status = 'registered' and student_no is not null;
create unique index if not exists comp_reg_uq_teacher on public.comp_registrations(item_id, teacher_user_id)
  where status = 'registered' and teacher_user_id is not null;
create index if not exists comp_reg_item_idx on public.comp_registrations(item_id);
create index if not exists comp_reg_student_idx on public.comp_registrations(student_no);

create table if not exists public.comp_staff (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.comp_events(id) on delete cascade,
  user_id uuid not null references public.app_users(id) on delete cascade,
  staff_role text not null default 'judge' check (staff_role in ('judge','referee','staff')),
  item_id uuid references public.comp_items(id) on delete cascade,   -- 空=尚未分派到項目（志願中）
  status text not null default 'volunteered' check (status in ('volunteered','assigned','declined')),
  source text not null default 'volunteer' check (source in ('volunteer','assigned','guest')),
  prefer_note text,
  avoid_note text,
  conflict_override boolean not null default false,   -- 只有承辦人能設為 true
  created_at timestamptz not null default now()
);
create unique index if not exists comp_staff_uq on public.comp_staff(event_id, user_id, staff_role, coalesce(item_id, '00000000-0000-0000-0000-000000000000'::uuid));
create index if not exists comp_staff_user_idx on public.comp_staff(user_id);

create table if not exists public.comp_scores (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.comp_items(id) on delete cascade,
  registration_id uuid not null references public.comp_registrations(id) on delete cascade,
  judge_user_id uuid references public.app_users(id) on delete set null,   -- test/chess/record 由承辦人輸入時為空
  raw jsonb not null default '{}'::jsonb,           -- 逐項分數 / 勝敗場數 / 紀錄
  total numeric,
  submitted boolean not null default false,
  submitted_at timestamptz,
  entered_by uuid default auth.uid(),
  proxy boolean not null default false,             -- 承辦人代填紙本
  updated_at timestamptz not null default now()
);
create unique index if not exists comp_scores_uq on public.comp_scores(item_id, registration_id, coalesce(judge_user_id, '00000000-0000-0000-0000-000000000000'::uuid));

-- 公布後的正式成績（公開頁與學生看到的就是這張）
create table if not exists public.comp_results (
  item_id uuid not null references public.comp_items(id) on delete cascade,
  registration_id uuid not null references public.comp_registrations(id) on delete cascade,
  total numeric,
  rank int,
  award text,
  updated_at timestamptz not null default now(),
  primary key (item_id, registration_id)
);

-- 公告：公布公告 / 修正公告 / 一般說明
create table if not exists public.comp_notices (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.comp_events(id) on delete cascade,
  item_id uuid references public.comp_items(id) on delete cascade,
  kind text not null check (kind in ('publish','correction','info')),
  revision int,
  title text not null,
  body text,
  changes jsonb,                                    -- [{registration_id,name,before:{},after:{}}]
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);
create index if not exists comp_notices_event_idx on public.comp_notices(event_id, created_at desc);

-- 作品投票（繪畫/布置）
create table if not exists public.comp_entries (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.comp_items(id) on delete cascade,
  entry_no int not null,
  title text,
  photo_path text not null,                         -- storage bucket 'competition' 內的路徑
  registration_id uuid references public.comp_registrations(id) on delete set null,  -- 公布成績時用（作品當作一位「參賽者」，school_name 放班級/作者）
  uploaded_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  unique (item_id, entry_no)
);
alter table public.comp_entries add column if not exists registration_id uuid references public.comp_registrations(id) on delete set null;
create table if not exists public.comp_votes (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.comp_items(id) on delete cascade,
  entry_id uuid not null references public.comp_entries(id) on delete cascade,
  voter_user_id uuid not null default auth.uid() references public.app_users(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (entry_id, voter_user_id)
);

-- ===================== 2. 輔助函式 =====================
-- 是否為正式教職員（不含賽事訪客、不含學生/家長入口帳號）
create or replace function public.comp_is_staff() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from app_users where id = auth.uid() and role::text <> 'competition_guest');
$$;

create or replace function public.comp_is_guest() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from app_users where id = auth.uid() and role::text = 'competition_guest');
$$;

-- 帳號是否仍有效（臨時帳號到期後立即失效；每日排程才會停用登入，這裡避免空窗期）
create or replace function public.comp_account_active() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from app_users where id = auth.uid()
                 and (account_expires_at is null or account_expires_at > now()));
$$;

create or replace function public.comp_is_organizer(p_event uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.is_system_admin(), false)
      or exists (select 1 from comp_organizers where event_id = p_event and user_id = auth.uid());
$$;

create or replace function public.comp_event_of_item(p_item uuid) returns uuid
language sql stable security definer set search_path = public as $$
  select event_id from comp_items where id = p_item;
$$;

-- 此人是否被分派到該項目當評審/裁判
create or replace function public.comp_is_assigned(p_item uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.comp_account_active()
     and exists (select 1 from comp_staff where item_id = p_item and user_id = auth.uid()
                 and status = 'assigned' and staff_role in ('judge','referee'));
$$;

-- 賽事對這個人是否可見（草稿只有承辦人與已被邀請的訪客看得到）
create or replace function public.comp_event_visible(p_event uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select case
    when public.comp_is_organizer(p_event) then true
    when public.comp_is_guest() then public.comp_account_active()
                                     and exists (select 1 from comp_staff where event_id = p_event and user_id = auth.uid())
    else exists (select 1 from comp_events where id = p_event and status <> 'draft')
  end;
$$;

-- 學生本人目前的年級文字（給前端算可報名組別）
create or replace function public.comp_my_grade() returns text
language sql stable security definer set search_path = public as $$
  select c.grade_level
  from enrollments e join classes c on c.id = e.class_id
  where e.student_no = public.current_portal_student_no() and e.is_current
  order by c.academic_year desc limit 1;
$$;

create or replace function public.comp_notify_homeroom(p_student_no text, p_message text) returns void
language plpgsql security definer set search_path = public as $$
declare v_teacher uuid;
begin
  select c.homeroom_teacher_id into v_teacher
  from enrollments e join classes c on c.id = e.class_id
  where e.student_no = p_student_no and e.is_current
  order by c.academic_year desc limit 1;
  if v_teacher is not null then
    insert into staff_notifications (teacher_id, category, message, student_no)
    values (v_teacher, '賽事通知', p_message, p_student_no);
  end if;
end $$;

-- ===================== 3. 觸發器 =====================
-- 建立賽事者自動成為承辦人
create or replace function public.trg_comp_event_creator() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into comp_organizers (event_id, user_id) values (new.id, new.created_by) on conflict do nothing;
  return new;
end $$;
drop trigger if exists comp_event_creator on public.comp_events;
create trigger comp_event_creator after insert on public.comp_events
  for each row execute function public.trg_comp_event_creator();

-- 評審/裁判分派的利益衝突檢查：
--   (1) 不能評自己也有報名的項目；(2) 不能評有自己導生報名的項目。承辦人可用 conflict_override 例外。
create or replace function public.trg_comp_staff_conflict() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_teacher uuid;
begin
  if new.conflict_override and not public.comp_is_organizer(new.event_id) then
    raise exception '只有承辦人可以設定利益衝突例外';
  end if;
  if new.status = 'assigned' and new.item_id is not null and new.staff_role in ('judge','referee')
     and not new.conflict_override then
    if exists (select 1 from comp_registrations r
               where r.item_id = new.item_id and r.status = 'registered' and r.teacher_user_id = new.user_id) then
      raise exception '利益衝突：此人本身有報名這個項目，不能同時擔任評審/裁判';
    end if;
    select id into v_teacher from teachers where app_user_id = new.user_id;
    if v_teacher is not null and exists (
      select 1 from comp_registrations r
      join enrollments e on e.student_no = r.student_no and e.is_current
      join classes c on c.id = e.class_id
      where r.item_id = new.item_id and r.status = 'registered' and c.homeroom_teacher_id = v_teacher) then
      raise exception '利益衝突：此項目有這位老師的導生參賽（承辦人可設定例外）';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists comp_staff_conflict on public.comp_staff;
create trigger comp_staff_conflict before insert or update on public.comp_staff
  for each row execute function public.trg_comp_staff_conflict();

-- 志願：非承辦人只能新增「自己、志願中、未分派」的列
create or replace function public.trg_comp_staff_self_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not public.comp_is_organizer(new.event_id) then
    if new.user_id <> auth.uid() or new.status <> 'volunteered' or new.source <> 'volunteer'
       or new.conflict_override or not public.comp_is_staff() then
      raise exception '志願只能替自己登記，且需由承辦人分派';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists comp_staff_self_guard on public.comp_staff;
create trigger comp_staff_self_guard before insert on public.comp_staff
  for each row execute function public.trg_comp_staff_self_guard();

-- 這個投票項目現在能不能投/收回票：投票類項目、尚未公布成績、在投票時間內
create or replace function public.comp_vote_open(p_item uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from comp_items i
    where i.id = p_item and i.score_type = 'vote' and i.published_at is null
      and (nullif(i.config->>'vote_open_at','') is null  or now() >= (i.config->>'vote_open_at')::timestamptz)
      and (nullif(i.config->>'vote_close_at','') is null or now() <= (i.config->>'vote_close_at')::timestamptz));
$$;

-- 投票規則：只有正式教職員、投票期間內、不超過每人票數上限
create or replace function public.trg_comp_vote_rules() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_item comp_items; v_limit int; v_open timestamptz; v_close timestamptz; v_used int; v_entry_item uuid;
begin
  if new.voter_user_id <> auth.uid() or not public.comp_is_staff() then
    raise exception '只有本校教職員可以投票';
  end if;
  select * into v_item from comp_items where id = new.item_id;
  if v_item.id is null or v_item.score_type <> 'vote' then raise exception '此項目不是投票項目'; end if;
  select item_id into v_entry_item from comp_entries where id = new.entry_id;
  if v_entry_item is distinct from new.item_id then raise exception '作品不屬於此項目'; end if;
  if not public.comp_vote_open(new.item_id) then raise exception '不在投票時間內，或成績已公布'; end if;
  v_limit := nullif(v_item.config->>'votes_per_voter','')::int;
  if v_limit is not null then
    select count(*) into v_used from comp_votes where item_id = new.item_id and voter_user_id = new.voter_user_id;
    if v_used >= v_limit then raise exception '已達每人票數上限（% 票）', v_limit; end if;
  end if;
  return new;
end $$;
drop trigger if exists comp_vote_rules on public.comp_votes;
create trigger comp_vote_rules before insert on public.comp_votes
  for each row execute function public.trg_comp_vote_rules();

-- ===================== 4. 報名 / 撤回 =====================
create or replace function public.comp_register(p_item uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_item comp_items; v_group comp_groups; v_ev comp_events;
  v_stu text := public.current_portal_student_no();
  v_grade text; v_name text; v_id uuid; v_max int; v_cnt int; v_hidden boolean;
begin
  select * into v_item from comp_items where id = p_item;
  if v_item.id is null then raise exception '找不到這個項目'; end if;
  select * into v_group from comp_groups where id = v_item.group_id;
  select * into v_ev from comp_events where id = v_item.event_id;
  if v_ev.status <> 'open' then raise exception '這場賽事目前未開放報名'; end if;
  if (v_ev.reg_open_at is not null and now() < v_ev.reg_open_at)
     or (v_ev.reg_close_at is not null and now() > v_ev.reg_close_at) then
    raise exception '不在報名時間內';
  end if;
  if v_item.score_type = 'vote' then raise exception '這是作品投票項目，由承辦人上傳作品，不需報名'; end if;
  if v_item.quota is not null and
     (select count(*) from comp_registrations where item_id = p_item and status = 'registered') >= v_item.quota then
    raise exception '這個項目人數已滿';
  end if;
  v_max := nullif(v_ev.config->>'max_items_per_person','')::int;

  if v_stu is not null then
    -- 休學/轉學/退學/畢業/肄業的學生不能報名（校務系統用 student_is_hidden 判斷）。
    -- 用動態呼叫：沒有這個函式的環境（例如全新的測試庫）會略過檢查，而不是整支函式壞掉。
    if to_regprocedure('public.student_is_hidden(text)') is not null then
      execute 'select public.student_is_hidden($1)' into v_hidden using v_stu;
      if coalesce(v_hidden, false) then raise exception '你的學籍狀態目前無法報名，請洽教務處'; end if;
    end if;
    if v_group.teacher_only then raise exception '教師組不開放學生報名'; end if;
    v_grade := public.comp_my_grade();
    if v_grade is null or not (v_grade = any (v_group.grade_levels)) then
      raise exception '你的年級（%）不符合這個組別', coalesce(v_grade,'未知');
    end if;
    if v_max is not null then
      select count(*) into v_cnt from comp_registrations where event_id = v_ev.id and student_no = v_stu and status = 'registered';
      if v_cnt >= v_max then raise exception '每人最多報名 % 項', v_max; end if;
    end if;
    select name into v_name from students where student_no = v_stu;
    insert into comp_registrations (event_id, item_id, kind, student_no, display_name, school_name, grade_label)
      values (v_ev.id, p_item, 'student', v_stu, coalesce(v_name, v_stu), '華雲學校', v_grade)
      returning id into v_id;
    perform public.comp_notify_homeroom(v_stu,
      coalesce(v_name, v_stu) || ' 報名了「' || v_ev.title || '」' || v_group.name || '・' || v_item.name);
  elsif public.comp_is_staff() then
    if not v_group.teacher_only then raise exception '這個組別不是教師組'; end if;
    if v_max is not null then
      select count(*) into v_cnt from comp_registrations where event_id = v_ev.id and teacher_user_id = auth.uid() and status = 'registered';
      if v_cnt >= v_max then raise exception '每人最多報名 % 項', v_max; end if;
    end if;
    if exists (select 1 from comp_staff where item_id = p_item and user_id = auth.uid()
               and status = 'assigned' and staff_role in ('judge','referee') and not conflict_override) then
      raise exception '你已被分派擔任此項目評審/裁判，不能同時參賽';
    end if;
    select name into v_name from app_users where id = auth.uid();
    insert into comp_registrations (event_id, item_id, kind, teacher_user_id, display_name, school_name, grade_label)
      values (v_ev.id, p_item, 'teacher', auth.uid(), v_name, '華雲學校', '教師')
      returning id into v_id;
  else
    raise exception '只有學生本人帳號或本校教師可以報名';
  end if;
  return v_id;
exception when unique_violation then
  raise exception '你已經報名過這個項目了';
end $$;

create or replace function public.comp_withdraw(p_reg uuid) returns void
language plpgsql security definer set search_path = public as $$
declare r comp_registrations; v_ev comp_events;
begin
  select * into r from comp_registrations where id = p_reg;
  if r.id is null then raise exception '找不到報名資料'; end if;
  select * into v_ev from comp_events where id = r.event_id;
  if not (public.comp_is_organizer(r.event_id)
          or (r.student_no is not null and r.student_no = public.current_portal_student_no())
          or (r.teacher_user_id is not null and r.teacher_user_id = auth.uid())) then
    raise exception '沒有權限';
  end if;
  if not public.comp_is_organizer(r.event_id) and v_ev.status <> 'open' then
    raise exception '報名已截止，如需撤回請洽承辦人';
  end if;
  update comp_registrations set status = 'withdrawn' where id = p_reg;
  if r.student_no is not null then
    perform public.comp_notify_homeroom(r.student_no, r.display_name || ' 撤回了「' || v_ev.title || '」的報名');
  end if;
end $$;

-- ===================== 5. 送出評分 / 公布 / 修正 =====================
-- 評審送出自己的分數（送出後鎖定，需承辦人解鎖才能改）
create or replace function public.comp_submit_my_scores(p_item uuid) returns int
language plpgsql security definer set search_path = public as $$
declare v_regs int; v_have int;
begin
  if not public.comp_is_assigned(p_item) then raise exception '你不是此項目的評審/裁判'; end if;
  select count(*) into v_regs from comp_registrations where item_id = p_item and status = 'registered';
  select count(*) into v_have from comp_scores s join comp_registrations r on r.id = s.registration_id
    where s.item_id = p_item and s.judge_user_id = auth.uid() and r.status = 'registered' and s.total is not null;
  if v_have < v_regs then raise exception '還有 % 位選手沒有打分，請補完再送出', v_regs - v_have; end if;
  update comp_scores set submitted = true, submitted_at = now(), updated_at = now()
    where item_id = p_item and judge_user_id = auth.uid() and not submitted;
  return v_regs;
end $$;

create or replace function public.comp_unlock_scores(p_item uuid, p_judge uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.comp_is_organizer(public.comp_event_of_item(p_item)) then raise exception '只有承辦人可以解鎖'; end if;
  if exists (select 1 from comp_items where id = p_item and published_at is not null) then
    raise exception '已公布的項目請用「成績修正」';
  end if;
  update comp_scores set submitted = false, submitted_at = null, updated_at = now()
    where item_id = p_item and judge_user_id = p_judge;
end $$;

-- 公布：p_results = [{"registration_id":"..","total":95.5,"rank":1,"award":"第1名"}, ...]
create or replace function public.comp_publish_item(p_item uuid, p_results jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare v_item comp_items; v_missing text; v_regs int;
begin
  select * into v_item from comp_items where id = p_item;
  if v_item.id is null then raise exception '找不到項目'; end if;
  if not public.comp_is_organizer(v_item.event_id) then raise exception '只有承辦人可以公布成績'; end if;
  if v_item.published_at is not null then raise exception '此項目已公布，如需更動請用「成績修正」'; end if;
  if jsonb_typeof(p_results) <> 'array' or jsonb_array_length(p_results) = 0 then raise exception '沒有可公布的成績'; end if;

  if v_item.score_type = 'judge' then
    select count(*) into v_regs from comp_registrations where item_id = p_item and status = 'registered';
    select string_agg(u.name, '、') into v_missing
    from comp_staff st join app_users u on u.id = st.user_id
    where st.item_id = p_item and st.status = 'assigned' and st.staff_role = 'judge'
      and (select count(*) from comp_scores s join comp_registrations r on r.id = s.registration_id
           where s.item_id = p_item and s.judge_user_id = st.user_id and s.submitted and r.status = 'registered') < v_regs;
    if v_missing is not null then raise exception '這些評審尚未送出全部分數：%', v_missing; end if;
  end if;

  insert into comp_results (item_id, registration_id, total, rank, award)
  select p_item, (x->>'registration_id')::uuid, nullif(x->>'total','')::numeric, nullif(x->>'rank','')::int, nullif(x->>'award','')
  from jsonb_array_elements(p_results) x
  where exists (select 1 from comp_registrations r where r.id = (x->>'registration_id')::uuid and r.item_id = p_item)
  on conflict (item_id, registration_id) do update
    set total = excluded.total, rank = excluded.rank, award = excluded.award, updated_at = now();

  update comp_items set published_at = now(), published_by = auth.uid(), revision = 0 where id = p_item;
  insert into comp_notices (event_id, item_id, kind, revision, title, body)
    values (v_item.event_id, p_item, 'publish', 0, '成績公布：' || v_item.name, '「' || v_item.name || '」成績已公布。');
end $$;

-- 修正：公布後的任何更動都必須寫說明，自動產生「修正公告」並通知相關導師/教師
create or replace function public.comp_correct_item(p_item uuid, p_results jsonb, p_reason text) returns int
language plpgsql security definer set search_path = public as $$
declare
  v_item comp_items; v_changes jsonb := '[]'::jsonb; x jsonb; old comp_results; r comp_registrations;
  v_new_total numeric; v_new_rank int; v_new_award text; v_rev int; v_body text := ''; v_notify uuid;
begin
  select * into v_item from comp_items where id = p_item;
  if v_item.id is null then raise exception '找不到項目'; end if;
  if not public.comp_is_organizer(v_item.event_id) then raise exception '只有承辦人可以修正成績'; end if;
  if v_item.published_at is null then raise exception '尚未公布，請直接公布'; end if;
  if p_reason is null or length(trim(p_reason)) < 2 then raise exception '請填寫修正說明'; end if;

  for x in select * from jsonb_array_elements(p_results) loop
    select * into r from comp_registrations where id = (x->>'registration_id')::uuid and item_id = p_item;
    continue when r.id is null;
    select * into old from comp_results where item_id = p_item and registration_id = r.id;
    v_new_total := nullif(x->>'total','')::numeric;
    v_new_rank  := nullif(x->>'rank','')::int;
    v_new_award := nullif(x->>'award','');
    if old.registration_id is null
       or old.total is distinct from v_new_total or old.rank is distinct from v_new_rank or old.award is distinct from v_new_award then
      v_changes := v_changes || jsonb_build_array(jsonb_build_object(
        'registration_id', r.id, 'name', r.display_name, 'school', r.school_name,
        'before', jsonb_build_object('total', old.total, 'rank', old.rank, 'award', old.award),
        'after',  jsonb_build_object('total', v_new_total, 'rank', v_new_rank, 'award', v_new_award)));
      v_body := v_body || r.display_name || '：' ||
        coalesce(old.rank::text || '名/' || coalesce(old.award,'-'), '無') || ' → ' ||
        coalesce(v_new_rank::text || '名/' || coalesce(v_new_award,'-'), '無') || E'\n';
      insert into comp_results (item_id, registration_id, total, rank, award)
        values (p_item, r.id, v_new_total, v_new_rank, v_new_award)
        on conflict (item_id, registration_id) do update
          set total = excluded.total, rank = excluded.rank, award = excluded.award, updated_at = now();
      if r.student_no is not null then
        perform public.comp_notify_homeroom(r.student_no,
          '成績修正：' || r.display_name || '「' || v_item.name || '」，說明：' || trim(p_reason));
      elsif r.teacher_user_id is not null then
        select id into v_notify from teachers where app_user_id = r.teacher_user_id;
        if v_notify is not null then
          insert into staff_notifications (teacher_id, category, message)
          values (v_notify, '賽事通知', '成績修正：「' || v_item.name || '」，說明：' || trim(p_reason));
        end if;
      end if;
    end if;
  end loop;

  if jsonb_array_length(v_changes) = 0 then raise exception '沒有任何更動'; end if;
  update comp_items set revision = revision + 1 where id = p_item returning revision into v_rev;
  insert into comp_notices (event_id, item_id, kind, revision, title, body, changes)
    values (v_item.event_id, p_item, 'correction', v_rev,
            '成績修正公告（' || v_item.name || '，第 ' || v_rev || ' 次修正）',
            '修正說明：' || trim(p_reason) || E'\n\n更動內容：\n' || v_body, v_changes);
  return v_rev;
end $$;

-- 作品投票統計（只有承辦人；投票期間結束前也可看，方便承辦人掌握）
create or replace function public.comp_vote_tally(p_item uuid) returns table(entry_id uuid, entry_no int, title text, votes bigint)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.comp_is_organizer(public.comp_event_of_item(p_item)) then raise exception '只有承辦人可以看票數'; end if;
  return query
    select e.id, e.entry_no, e.title, count(v.id)
    from comp_entries e left join comp_votes v on v.entry_id = e.id
    where e.item_id = p_item group by e.id, e.entry_no, e.title order by count(v.id) desc, e.entry_no;
end $$;

-- ===================== 6. 成績檢視（QR 公開頁 / 校內賽事頁共用） =====================
-- 內部函式：組出「已公布」的項目、成績與公告。不做權限檢查，所以不開放任何人直接呼叫，
-- 只能經由下面兩個有檢查的包裝函式使用。
create or replace function public.comp_view_json(p_event uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_ev comp_events; v_show_score boolean;
begin
  select * into v_ev from comp_events where id = p_event;
  if v_ev.id is null then return null; end if;
  v_show_score := coalesce((v_ev.config->>'public_show_score')::boolean, false);
  return jsonb_build_object(
    'title', v_ev.title,
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'group', g.name, 'item', i.name, 'revision', i.revision, 'published_at', i.published_at,
        'results', coalesce((
          select jsonb_agg(jsonb_build_object(
            'name', r.display_name, 'school', r.school_name, 'rank', res.rank, 'award', res.award,
            'total', case when v_show_score then res.total else null end) order by res.rank nulls last, r.display_name)
          from comp_results res join comp_registrations r on r.id = res.registration_id
          where res.item_id = i.id), '[]'::jsonb))
        order by g.sort_no, i.sort_no)
      from comp_items i join comp_groups g on g.id = i.group_id
      where i.event_id = v_ev.id and i.published_at is not null), '[]'::jsonb),
    'notices', coalesce((
      select jsonb_agg(jsonb_build_object(
        'kind', n.kind, 'title', n.title, 'body', n.body, 'revision', n.revision, 'created_at', n.created_at)
        order by n.created_at desc)
      from comp_notices n where n.event_id = v_ev.id
        and (n.item_id is null or exists (select 1 from comp_items i where i.id = n.item_id and i.published_at is not null))), '[]'::jsonb));
end $$;
revoke all on function public.comp_view_json(uuid) from public, anon, authenticated;

-- QR 公開頁：用代碼取得，且承辦人必須已開啟公開頁
create or replace function public.comp_public_view(p_token text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_id uuid;
begin
  select id into v_id from comp_events where public_token = p_token and public_enabled;
  if v_id is null then return null; end if;
  return public.comp_view_json(v_id);
end $$;

-- 校內賽事頁：登入且看得到這場賽事的人（學生、教師）可取得，不需要開啟公開頁
create or replace function public.comp_event_view(p_event uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.comp_event_visible(p_event) then return null; end if;
  return public.comp_view_json(p_event);
end $$;

-- 各項目目前報名人數（學生看不到別人的報名資料，所以額滿與否要靠這個函式）
create or replace function public.comp_item_counts(p_event uuid) returns table(item_id uuid, registered bigint)
language sql stable security definer set search_path = public as $$
  select i.id, count(r.id) filter (where r.status = 'registered')
  from comp_items i left join comp_registrations r on r.item_id = i.id
  where i.event_id = p_event and public.comp_event_visible(p_event)
  group by i.id;
$$;

-- ===================== 7. RLS =====================
alter table public.comp_events        enable row level security;
alter table public.comp_organizers    enable row level security;
alter table public.comp_groups        enable row level security;
alter table public.comp_items         enable row level security;
alter table public.comp_registrations enable row level security;
alter table public.comp_staff         enable row level security;
alter table public.comp_scores        enable row level security;
alter table public.comp_results       enable row level security;
alter table public.comp_notices       enable row level security;
alter table public.comp_entries       enable row level security;
alter table public.comp_votes         enable row level security;

-- events
drop policy if exists comp_events_sel on public.comp_events;
-- created_by = auth.uid() 必須直接寫在政策裡：insert ... returning 時，承辦人那一列要等 AFTER 觸發器才寫入，
-- 函式看不到同一個指令剛新增的列。
create policy comp_events_sel on public.comp_events for select to authenticated
  using (created_by = auth.uid() or public.comp_event_visible(id));
drop policy if exists comp_events_ins on public.comp_events;
create policy comp_events_ins on public.comp_events for insert to authenticated
  with check (public.comp_is_staff() and created_by = auth.uid());
drop policy if exists comp_events_upd on public.comp_events;
create policy comp_events_upd on public.comp_events for update to authenticated
  using (public.comp_is_organizer(id)) with check (public.comp_is_organizer(id));
drop policy if exists comp_events_del on public.comp_events;
create policy comp_events_del on public.comp_events for delete to authenticated using (public.comp_is_organizer(id));

-- organizers
drop policy if exists comp_org_sel on public.comp_organizers;
create policy comp_org_sel on public.comp_organizers for select to authenticated
  using (public.comp_is_organizer(event_id) or user_id = auth.uid());
drop policy if exists comp_org_all on public.comp_organizers;
create policy comp_org_all on public.comp_organizers for all to authenticated
  using (public.comp_is_organizer(event_id)) with check (public.comp_is_organizer(event_id));

-- groups / items
drop policy if exists comp_groups_sel on public.comp_groups;
create policy comp_groups_sel on public.comp_groups for select to authenticated using (public.comp_event_visible(event_id));
drop policy if exists comp_groups_all on public.comp_groups;
create policy comp_groups_all on public.comp_groups for all to authenticated
  using (public.comp_is_organizer(event_id)) with check (public.comp_is_organizer(event_id));
drop policy if exists comp_items_sel on public.comp_items;
create policy comp_items_sel on public.comp_items for select to authenticated using (public.comp_event_visible(event_id));
drop policy if exists comp_items_all on public.comp_items;
create policy comp_items_all on public.comp_items for all to authenticated
  using (public.comp_is_organizer(event_id)) with check (public.comp_is_organizer(event_id));

-- registrations：承辦人全部；本人看自己；被分派的評審看該項目名單；導師看自己導生
drop policy if exists comp_reg_sel on public.comp_registrations;
create policy comp_reg_sel on public.comp_registrations for select to authenticated using (
  public.comp_is_organizer(event_id)
  or (student_no is not null and student_no = public.current_portal_student_no())
  or teacher_user_id = auth.uid()
  or public.comp_is_assigned(item_id)
  or (student_no is not null and exists (
        select 1 from enrollments e join classes c on c.id = e.class_id
        where e.student_no = comp_registrations.student_no and e.is_current
          and c.homeroom_teacher_id = public.current_teacher_id()))
);
drop policy if exists comp_reg_org on public.comp_registrations;
create policy comp_reg_org on public.comp_registrations for all to authenticated
  using (public.comp_is_organizer(event_id)) with check (public.comp_is_organizer(event_id));
-- 學生/教師本人報名、撤回一律走 comp_register / comp_withdraw，不開放直接寫入

-- staff
drop policy if exists comp_staff_sel on public.comp_staff;
create policy comp_staff_sel on public.comp_staff for select to authenticated
  using (public.comp_is_organizer(event_id) or user_id = auth.uid());
drop policy if exists comp_staff_org on public.comp_staff;
create policy comp_staff_org on public.comp_staff for all to authenticated
  using (public.comp_is_organizer(event_id)) with check (public.comp_is_organizer(event_id));
drop policy if exists comp_staff_vol on public.comp_staff;
create policy comp_staff_vol on public.comp_staff for insert to authenticated
  with check (user_id = auth.uid() and status = 'volunteered' and source = 'volunteer' and public.comp_is_staff());
drop policy if exists comp_staff_withdraw on public.comp_staff;
create policy comp_staff_withdraw on public.comp_staff for delete to authenticated
  using (user_id = auth.uid() and status = 'volunteered');

-- scores：評審只能看/寫自己的、且未送出前才能改；承辦人全部
drop policy if exists comp_scores_sel on public.comp_scores;
create policy comp_scores_sel on public.comp_scores for select to authenticated using (
  public.comp_is_organizer(public.comp_event_of_item(item_id)) or judge_user_id = auth.uid());
drop policy if exists comp_scores_org on public.comp_scores;
create policy comp_scores_org on public.comp_scores for all to authenticated
  using (public.comp_is_organizer(public.comp_event_of_item(item_id)))
  with check (public.comp_is_organizer(public.comp_event_of_item(item_id)));
drop policy if exists comp_scores_ins on public.comp_scores;
create policy comp_scores_ins on public.comp_scores for insert to authenticated with check (
  judge_user_id = auth.uid() and public.comp_is_assigned(item_id) and not submitted and not proxy
  and exists (select 1 from comp_items i where i.id = item_id and i.published_at is null));
drop policy if exists comp_scores_upd on public.comp_scores;
create policy comp_scores_upd on public.comp_scores for update to authenticated
  using (judge_user_id = auth.uid() and not submitted and public.comp_is_assigned(item_id))
  with check (judge_user_id = auth.uid() and not submitted and not proxy and public.comp_is_assigned(item_id));

-- results / notices：公布後所有可看到賽事的人都看得到；寫入只走函式
drop policy if exists comp_results_sel on public.comp_results;
create policy comp_results_sel on public.comp_results for select to authenticated using (
  public.comp_is_organizer(public.comp_event_of_item(item_id))
  or exists (select 1 from comp_items i where i.id = item_id and i.published_at is not null
             and public.comp_event_visible(i.event_id)));
drop policy if exists comp_notices_sel on public.comp_notices;
create policy comp_notices_sel on public.comp_notices for select to authenticated using (
  public.comp_is_organizer(event_id) or public.comp_event_visible(event_id));
drop policy if exists comp_notices_org on public.comp_notices;
create policy comp_notices_org on public.comp_notices for insert to authenticated
  with check (public.comp_is_organizer(event_id) and kind = 'info');

-- entries / votes
drop policy if exists comp_entries_sel on public.comp_entries;
create policy comp_entries_sel on public.comp_entries for select to authenticated
  using (public.comp_event_visible(public.comp_event_of_item(item_id)) and (public.comp_is_staff() or public.comp_is_organizer(public.comp_event_of_item(item_id))));
drop policy if exists comp_entries_org on public.comp_entries;
create policy comp_entries_org on public.comp_entries for all to authenticated
  using (public.comp_is_organizer(public.comp_event_of_item(item_id)))
  with check (public.comp_is_organizer(public.comp_event_of_item(item_id)));
drop policy if exists comp_votes_sel on public.comp_votes;
create policy comp_votes_sel on public.comp_votes for select to authenticated using (voter_user_id = auth.uid());
drop policy if exists comp_votes_ins on public.comp_votes;
create policy comp_votes_ins on public.comp_votes for insert to authenticated with check (voter_user_id = auth.uid());
drop policy if exists comp_votes_del on public.comp_votes;
create policy comp_votes_del on public.comp_votes for delete to authenticated
  using (voter_user_id = auth.uid() and public.comp_vote_open(item_id));

-- ===================== 8. 函式權限 =====================
revoke all on function public.comp_public_view(text) from public;
grant execute on function public.comp_public_view(text) to anon, authenticated;
-- 函式預設任何人(含未登入的 anon)都能呼叫。競賽函式一律收回，只開放登入者；
-- 只有 QR 公開頁用的 comp_public_view 保留給 anon。內部函式連登入者都不能直接呼叫。
do $$
declare f record;
begin
  for f in select p.oid::regprocedure as sig, p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname like 'comp\_%' and p.prokind = 'f' loop
    execute format('revoke all on function %s from public, anon', f.sig);
    if f.proname = 'comp_public_view' then
      execute format('grant execute on function %s to anon, authenticated', f.sig);
    elsif f.proname in ('comp_view_json', 'comp_apply_guest_block') then
      execute format('revoke all on function %s from authenticated', f.sig);
    else
      execute format('grant execute on function %s to authenticated', f.sig);
    end if;
  end loop;
end $$;
grant execute on function public.comp_register(uuid), public.comp_withdraw(uuid),
  public.comp_submit_my_scores(uuid), public.comp_unlock_scores(uuid, uuid),
  public.comp_publish_item(uuid, jsonb), public.comp_correct_item(uuid, jsonb, text),
  public.comp_vote_tally(uuid), public.comp_my_grade() to authenticated;

-- ===================== 9. 作品照片儲存 =====================
insert into storage.buckets (id, name, public) values ('competition', 'competition', false)
  on conflict (id) do nothing;
drop policy if exists comp_photo_read on storage.objects;
create policy comp_photo_read on storage.objects for select to authenticated
  using (bucket_id = 'competition' and public.comp_is_staff());
drop policy if exists comp_photo_write on storage.objects;
create policy comp_photo_write on storage.objects for insert to authenticated
  with check (bucket_id = 'competition' and public.comp_is_staff());
drop policy if exists comp_photo_delete on storage.objects;
create policy comp_photo_delete on storage.objects for delete to authenticated
  using (bucket_id = 'competition' and public.comp_is_staff() and owner = auth.uid());

-- ===================== 10. 賽事訪客隔離（對所有既有資料表加「限制性」政策） =====================
-- 現有校務系統有約 20 張表的 SELECT 政策是「只要登入就能讀」(using (true))，例如班級、教師名單、社團、課表。
-- RESTRICTIVE 政策會與所有既有政策取交集，所以只要訪客不通過它，不管其他政策怎麼寫都讀不到。
-- 例外（訪客登入或使用賽事一定要用到）：賽事資料表(comp_*)、登入設定表、app_users 只能讀自己那一列。
-- 注意：之後新增的資料表不會自動套用，請在新表的 migration 末尾重跑本段，或執行：
--   select public.comp_apply_guest_block();
create or replace function public.comp_apply_guest_block() returns int
language plpgsql security definer set search_path = public as $$
declare t record; n int := 0;
begin
  for t in
    select c.relname
    from pg_class c join pg_namespace ns on ns.oid = c.relnamespace
    where ns.nspname = 'public' and c.relkind in ('r','p')
      and c.relname not like 'comp\_%'
      and c.relname not in ('app_users','portal_login_settings','teacher_login_settings','password_policy_settings')
  loop
    execute format('drop policy if exists comp_guest_block on public.%I', t.relname);
    execute format('create policy comp_guest_block on public.%I as restrictive for all to authenticated using ((select not public.comp_is_guest())) with check ((select not public.comp_is_guest()))', t.relname);
    n := n + 1;
  end loop;
  -- app_users：訪客只能讀自己那一列，不能列出全校教職員
  drop policy if exists comp_guest_block on public.app_users;
  create policy comp_guest_block on public.app_users as restrictive for all to authenticated
    using (not public.comp_is_guest() or id = auth.uid())
    with check (not public.comp_is_guest());
  return n + 1;
end $$;
revoke all on function public.comp_apply_guest_block() from public, anon, authenticated;
select public.comp_apply_guest_block();
