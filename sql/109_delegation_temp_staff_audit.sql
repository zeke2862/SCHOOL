-- 109: (1) delegation (proxy) + temporary (visiting) teachers
--      (2) change audit log for corrections (first-time score / attendance entry is NOT logged here)
--      (3) subject teacher can read same-subject history of students they currently teach
-- Safe to run more than once. Run AFTER 108.
-- Design: acting state is stored in the DB (acting_sessions), NOT in an HTTP header,
--         so it works through the normal Supabase client with no CORS / client changes.

-- ===== A. temp-staff columns =====
alter table public.app_users add column if not exists is_temporary boolean not null default false;
alter table public.app_users add column if not exists account_expires_at timestamptz;
alter table public.app_users add column if not exists home_org text;

-- ===== B. delegation tables =====
create table if not exists public.proxy_delegations (
  id uuid primary key default gen_random_uuid(),
  principal_user_id uuid not null references public.app_users(id) on delete cascade,
  agent_user_id     uuid not null references public.app_users(id) on delete cascade,
  start_at timestamptz not null,
  end_at   timestamptz not null,
  reason text,
  status text not null default 'active' check (status in ('active','revoked')),
  set_by uuid not null,
  set_by_higher boolean not null default false,
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  revoked_by uuid,
  constraint proxy_delegations_time_chk check (end_at > start_at),
  constraint proxy_delegations_self_chk check (principal_user_id <> agent_user_id)
);
create index if not exists proxy_delegations_agent_idx on public.proxy_delegations(agent_user_id, status, start_at, end_at);
create index if not exists proxy_delegations_principal_idx on public.proxy_delegations(principal_user_id, status);
alter table public.proxy_delegations enable row level security;

create table if not exists public.acting_sessions (
  agent_user_id uuid primary key references public.app_users(id) on delete cascade,
  principal_user_id uuid not null references public.app_users(id) on delete cascade,
  delegation_id uuid not null references public.proxy_delegations(id) on delete cascade,
  started_at timestamptz not null default now()
);
alter table public.acting_sessions enable row level security;   -- no policies: RPC only

create table if not exists public.email_outbox (
  id uuid primary key default gen_random_uuid(),
  to_user_id uuid not null references public.app_users(id) on delete cascade,
  subject text not null,
  body text not null,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  error text
);
alter table public.email_outbox enable row level security;      -- no policies: service role only

alter table public.staff_notifications drop constraint if exists staff_notifications_category_check;
alter table public.staff_notifications add constraint staff_notifications_category_check
  check (category = any (array['個資修改申請','出缺勤示警','代課通知','考場通知','學生資料變更','審核通知','代理通知']));

-- ===== C. rank + acting helpers =====
-- 50 = S / dev dept ; 40 = admin_a ; 30 = dept lead ; 20 = admin_b / dept staff ; 10 = teachers
create or replace function public.staff_rank(p_uid uuid) returns int
language sql stable security definer set search_path = public as $$
  select case
    when exists (select 1 from app_users u where u.id = p_uid and u.role = 'system_admin_s')
      or exists (select 1 from app_user_departments d where d.app_user_id = p_uid and d.department = 'dev') then 50
    when exists (select 1 from app_users u where u.id = p_uid and u.role = 'admin_a') then 40
    when exists (select 1 from app_user_departments d where d.app_user_id = p_uid and d.level = 'lead') then 30
    when exists (select 1 from app_user_departments d where d.app_user_id = p_uid)
      or exists (select 1 from app_users u where u.id = p_uid and u.role = 'admin_b') then 20
    else 10 end;
$$;

create or replace function public.acting_principal() returns uuid
language sql stable security definer set search_path = public as $$
  select s.principal_user_id
  from acting_sessions s
  join proxy_delegations d on d.id = s.delegation_id
  join app_users ag on ag.id = s.agent_user_id
  where s.agent_user_id = auth.uid()
    and d.status = 'active'
    and d.agent_user_id = s.agent_user_id
    and d.principal_user_id = s.principal_user_id
    and now() between d.start_at and d.end_at
    and (ag.account_expires_at is null or ag.account_expires_at > now());
$$;

create or replace function public.effective_uids() returns setof uuid
language sql stable security definer set search_path = public as $$
  select x from (select auth.uid() as x union select public.acting_principal()) q where x is not null;
$$;

-- ===== D. permission helpers =====
-- 代理只代理「一線教學工作」：代理期間只有「導師班／任課科目（teacher_id）」換成被代理者的；
-- 角色與部門權限一律維持代理人「自己的」，所以代理人拿不到審核、核准、行政權限。
create or replace function public.current_role_name() returns public.user_role
language sql stable security definer set search_path = public as $$
  select u.role from app_users u
  where u.id = auth.uid()
    and (u.account_expires_at is null or u.account_expires_at > now());
$$;

create or replace function public.current_teacher_id() returns uuid
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select t.id from teachers t where t.app_user_id = public.acting_principal() limit 1),
    (select t.id from teachers t where t.app_user_id = auth.uid() limit 1));
$$;

create or replace function public.has_department(p_dept public.admin_department) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from app_user_departments where app_user_id = auth.uid() and department = p_dept)
     and exists (select 1 from app_users u where u.id = auth.uid() and (u.account_expires_at is null or u.account_expires_at > now()));
$$;

create or replace function public.is_department_lead(p_dept public.admin_department) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from app_user_departments where app_user_id = auth.uid() and department = p_dept and level = 'lead')
     and exists (select 1 from app_users u where u.id = auth.uid() and (u.account_expires_at is null or u.account_expires_at > now()));
$$;

create or replace function public.is_department_lead_of(p_department public.admin_department) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_department_lead(p_department);
$$;

-- ===== E. delegation RPCs =====
create or replace function public.create_delegation(
  p_principal uuid, p_agent uuid, p_start timestamptz, p_end timestamptz, p_reason text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := auth.uid();
  v_rank_me int; v_rank_pr int; v_id uuid; v_higher boolean;
  v_pr_name text; v_ag_name text; v_me_name text; v_msg text; v_threshold int; r record;
begin
  if v_me is null then raise exception '未登入'; end if;
  if public.acting_principal() is not null then raise exception '代理期間不能再設定代理（代理權不能轉給第三人）'; end if;
  if p_principal = p_agent then raise exception '代理人不能是本人'; end if;
  if p_end <= p_start then raise exception '結束時間必須晚於開始時間'; end if;
  if p_end > p_start + interval '366 days' then raise exception '單次代理最長一年'; end if;
  if p_end <= now() then raise exception '結束時間已經過了'; end if;
  if not exists (select 1 from app_users where id = p_principal) then raise exception '找不到被代理人'; end if;
  if not exists (select 1 from app_users a where a.id = p_agent and (a.account_expires_at is null or a.account_expires_at > now()))
    then raise exception '代理人帳號不存在或已到期'; end if;

  v_rank_me := public.staff_rank(v_me);
  v_rank_pr := public.staff_rank(p_principal);
  v_higher := (v_me <> p_principal);
  if v_me = p_principal then
    if v_rank_pr >= 40 and v_rank_me < 50 then raise exception '管理員A以上的代理人，須由系統管理員S設定'; end if;
  else
    if not (v_rank_me > v_rank_pr or (v_rank_me = 50 and v_rank_pr = 50)) then
      raise exception '只能為層級比自己低的人設定代理人';
    end if;
    if v_rank_pr >= 40 and v_rank_me < 50 then raise exception '管理員A以上的代理人，須由系統管理員S設定'; end if;
  end if;

  insert into proxy_delegations(principal_user_id, agent_user_id, start_at, end_at, reason, set_by, set_by_higher)
  values (p_principal, p_agent, p_start, p_end, p_reason, v_me, v_higher)
  returning id into v_id;

  select name into v_pr_name from app_users where id = p_principal;
  select name into v_ag_name from app_users where id = p_agent;
  select name into v_me_name from app_users where id = v_me;
  v_msg := format('%s 已設定代理人：%s 將於 %s 至 %s 代理 %s 的職務%s（設定人：%s）',
                  v_pr_name, v_ag_name, to_char(p_start at time zone 'Asia/Bangkok','YYYY-MM-DD HH24:MI'),
                  to_char(p_end at time zone 'Asia/Bangkok','YYYY-MM-DD HH24:MI'), v_pr_name,
                  case when coalesce(p_reason,'') = '' then '' else '，事由：' || p_reason end, v_me_name);

  -- recipients: higher level (+ the agent and the principal themselves)
  v_threshold := greatest(30, v_rank_pr + 10);
  for r in
    select u.id as uid from app_users u
    where u.id <> v_me and (
      u.id in (p_agent, p_principal)
      or (v_rank_pr < 50 and public.staff_rank(u.id) >= v_threshold)
      or (v_rank_pr = 50 and u.id <> p_principal and public.staff_rank(u.id) = 50))
      and (u.account_expires_at is null or u.account_expires_at > now())
  loop
    insert into email_outbox(to_user_id, subject, body)
    values (r.uid, '【校務系統】代理人設定通知：' || v_pr_name, v_msg);
    insert into staff_notifications(teacher_id, category, message)
    select t.id, '代理通知', v_msg from teachers t where t.app_user_id = r.uid;
  end loop;
  return v_id;
end $$;

create or replace function public.revoke_delegation(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare d proxy_delegations%rowtype; v_me uuid := auth.uid(); v_msg text;
begin
  select * into d from proxy_delegations where id = p_id and status = 'active';
  if not found then raise exception '找不到有效的代理設定'; end if;
  if not (v_me in (d.principal_user_id, d.agent_user_id, d.set_by)
          or public.staff_rank(v_me) > public.staff_rank(d.principal_user_id)
          or (public.staff_rank(v_me) = 50 and public.staff_rank(d.principal_user_id) = 50)) then
    raise exception '沒有權限撤銷這筆代理設定';
  end if;
  update proxy_delegations set status = 'revoked', revoked_at = now(), revoked_by = v_me where id = p_id;
  delete from acting_sessions where delegation_id = p_id;
  v_msg := format('代理設定已撤銷：%s 不再代理 %s（撤銷人：%s）',
    (select name from app_users where id = d.agent_user_id), (select name from app_users where id = d.principal_user_id),
    (select name from app_users where id = v_me));
  insert into staff_notifications(teacher_id, category, message)
  select t.id, '代理通知', v_msg from teachers t where t.app_user_id in (d.principal_user_id, d.agent_user_id) and t.app_user_id <> v_me;
end $$;

create or replace function public.start_acting(p_principal uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_d uuid;
begin
  if auth.uid() is null then raise exception '未登入'; end if;
  select id into v_d from proxy_delegations
   where principal_user_id = p_principal and agent_user_id = auth.uid()
     and status = 'active' and now() between start_at and end_at
   order by end_at desc limit 1;
  if v_d is null then raise exception '目前沒有可用的代理設定'; end if;
  insert into acting_sessions(agent_user_id, principal_user_id, delegation_id)
  values (auth.uid(), p_principal, v_d)
  on conflict (agent_user_id) do update
    set principal_user_id = excluded.principal_user_id, delegation_id = excluded.delegation_id, started_at = now();
end $$;

create or replace function public.stop_acting() returns void
language sql security definer set search_path = public as $$
  delete from acting_sessions where agent_user_id = auth.uid();
$$;

-- who am I acting for right now (for the banner)
create or replace function public.my_acting_state() returns table(principal_user_id uuid, principal_name text, end_at timestamptz)
language sql stable security definer set search_path = public as $$
  select s.principal_user_id, (select name from app_users where id = s.principal_user_id), d.end_at
  from acting_sessions s join proxy_delegations d on d.id = s.delegation_id
  where s.agent_user_id = auth.uid() and public.acting_principal() is not null;
$$;

create or replace function public.my_delegations() returns table(
  id uuid, principal_user_id uuid, principal_name text, agent_user_id uuid, agent_name text,
  start_at timestamptz, end_at timestamptz, reason text, status text, set_by uuid, set_by_name text,
  is_active boolean, i_am_agent boolean, can_revoke boolean)
language sql stable security definer set search_path = public as $$
  select d.id, d.principal_user_id, p.name, d.agent_user_id, a.name, d.start_at, d.end_at, d.reason, d.status,
         d.set_by, s.name,
         (d.status = 'active' and now() between d.start_at and d.end_at),
         (d.agent_user_id = auth.uid()),
         (d.status = 'active' and (auth.uid() in (d.principal_user_id, d.agent_user_id, d.set_by)
            or public.staff_rank(auth.uid()) > public.staff_rank(d.principal_user_id)
            or (public.staff_rank(auth.uid()) = 50 and public.staff_rank(d.principal_user_id) = 50)))
  from proxy_delegations d
  join app_users p on p.id = d.principal_user_id
  join app_users a on a.id = d.agent_user_id
  left join app_users s on s.id = d.set_by
  where d.principal_user_id = auth.uid() or d.agent_user_id = auth.uid() or d.set_by = auth.uid()
     or public.staff_rank(auth.uid()) > public.staff_rank(d.principal_user_id)
     or (public.staff_rank(auth.uid()) = 50 and public.staff_rank(d.principal_user_id) = 50)
  order by d.created_at desc;
$$;

-- people the caller may set an agent FOR (self + lower levels) and people who can BE an agent
create or replace function public.delegation_people() returns table(
  id uuid, name text, role public.user_role, rank int, is_temporary boolean, home_org text, can_be_principal boolean)
language sql stable security definer set search_path = public as $$
  select u.id, u.name, u.role, public.staff_rank(u.id), u.is_temporary, u.home_org,
         (u.id = auth.uid()
          or public.staff_rank(auth.uid()) > public.staff_rank(u.id)
          or (public.staff_rank(auth.uid()) = 50 and public.staff_rank(u.id) = 50))
  from app_users u
  where auth.uid() is not null and (u.account_expires_at is null or u.account_expires_at > now())
  order by u.name;
$$;

-- RLS: delegations readable by the people involved + higher levels (writes only via RPC)
drop policy if exists proxy_delegations_read on public.proxy_delegations;
create policy proxy_delegations_read on public.proxy_delegations for select to authenticated
  using (auth.uid() in (principal_user_id, agent_user_id, set_by) or public.is_admin_sa());

-- ===== F. change audit log =====
create table if not exists public.change_audit_log (
  id bigserial primary key,
  table_name text not null,
  op text not null,
  row_id text,
  old_row jsonb,
  new_row jsonb,
  actor_user_id uuid,
  acting_for_user_id uuid,
  changed_at timestamptz not null default now()
);
create index if not exists change_audit_log_time_idx on public.change_audit_log(changed_at desc);
create index if not exists change_audit_log_table_idx on public.change_audit_log(table_name, changed_at desc);
alter table public.change_audit_log enable row level security;
drop policy if exists change_audit_log_read on public.change_audit_log;
create policy change_audit_log_read on public.change_audit_log for select to authenticated
  using (public.is_admin_sa());

create or replace function public.audit_row_change() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_old jsonb; v_new jsonb; v_pk text := coalesce(tg_argv[0], 'id'); v_id text; v_do jsonb; v_dn jsonb;
begin
  if auth.uid() is null then return coalesce(new, old); end if;   -- system / service-role jobs (restore, cron)
  if tg_op = 'INSERT' then
    v_new := to_jsonb(new);
  elsif tg_op = 'DELETE' then
    v_old := to_jsonb(old);
  else
    v_old := to_jsonb(old); v_new := to_jsonb(new);
    if v_old = v_new then return new; end if;
    select jsonb_object_agg(k, v_old -> k), jsonb_object_agg(k, v_new -> k)
      into v_do, v_dn
      from jsonb_object_keys(v_new) k where (v_old -> k) is distinct from (v_new -> k);
    v_old := v_do; v_new := v_dn;
    if v_new is null then return new; end if;
  end if;
  v_id := coalesce(to_jsonb(coalesce(new, old)) ->> v_pk, to_jsonb(coalesce(new, old)) ->> 'id');
  insert into change_audit_log(table_name, op, row_id, old_row, new_row, actor_user_id, acting_for_user_id)
  values (tg_table_name, tg_op, v_id, v_old, v_new, auth.uid(), public.acting_principal());
  return coalesce(new, old);
end $$;

do $$
declare
  spec text[][] := array[
    -- table, ops (I/U/D), primary key column
    ['students','IUD','student_no'],['guardians','IUD','id'],['enrollments','IUD','id'],['classes','IUD','id'],
    ['class_schedule','IUD','id'],['teachers','IUD','id'],['curriculum','IUD','id'],['grading_rules','IUD','id'],
    ['locked_periods','IUD','id'],['period_config','IUD','id'],['attendance_alert_settings','IUD','id'],
    ['academic_terms','IUD','id'],['grade_progression','IUD','id'],['student_status_changes','IUD','id'],
    ['substitute_assignments','IUD','id'],['clubs','IUD','id'],['submission_windows','IUD','id'],
    ['app_user_departments','IUD','id'],['app_user_module_overrides','IUD','id'],['app_users','IUD','id'],
    ['portal_accounts','IUD','id'],['proxy_delegations','IUD','id'],['exam_sessions','IUD','id'],
    ['exam_rooms','IUD','id'],['report_card_style','IUD','id'],['site_settings','IUD','id'],
    ['site_content','IUD','id'],['bulletin_posts','IUD','id'],['clock_shifts','IUD','id'],
    ['clock_holidays','IUD','id'],['clock_day_overrides','IUD','id'],['clock_employee_map','IUD','id'],
    ['general_inventory_items','IUD','id'],['utility_bills','IUD','id'],['maintenance_tickets','IUD','id'],
    ['conduct_point_defaults','IUD','id'],['password_policy_settings','IUD','id'],['portal_login_settings','IUD','id'],
    ['teacher_login_settings','IUD','id'],['homeroom_attendance_assist_settings','IUD','id'],
    ['attendance_score_display_settings','IUD','id'],['score_adjustments','IUD','id'],
    ['teacher_appointment_letters','IUD','id'],['teacher_letter_settings','IUD','id'],
    ['report_card_merge_template','IUD','id'],['report_card_xlsx_template','IUD','id'],
    -- first-time entry is NOT logged (insert skipped): only corrections / deletions
    ['conduct_scores','UD','id'],['student_remarks','UD','id'],['conduct_events','UD','id'],
    ['club_scores','UD','id'],['club_attendance','UD','id'],['club_members','UD','id'],
    ['general_inventory_transactions','UD','id'],['clock_records','UD','id'],
    ['attendance','D','id']
  ];
  i int; t text; ops text; pk text; ev text;
begin
  for i in 1 .. array_length(spec, 1) loop
    t := spec[i][1]; ops := spec[i][2]; pk := spec[i][3];
    if to_regclass('public.' || t) is null then continue; end if;
    ev := concat_ws(' or ',
      case when ops like '%I%' then 'insert' end,
      case when ops like '%U%' then 'update' end,
      case when ops like '%D%' then 'delete' end);
    execute format('drop trigger if exists zz_audit_row_change on public.%I', t);
    execute format('create trigger zz_audit_row_change after %s on public.%I for each row execute function public.audit_row_change(%L)', ev, t, pk);
  end loop;
end $$;

-- existing score / attendance logs: also record the REAL person and who they were acting for
alter table public.score_audit_log add column if not exists actor_user_id uuid;
alter table public.score_audit_log add column if not exists acting_for_user_id uuid;
alter table public.attendance_audit_log add column if not exists actor_user_id uuid;
alter table public.attendance_audit_log add column if not exists acting_for_user_id uuid;
create or replace function public.stamp_actor() returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.actor_user_id := auth.uid();
  new.acting_for_user_id := public.acting_principal();
  return new;
end $$;
drop trigger if exists zz_stamp_actor on public.score_audit_log;
create trigger zz_stamp_actor before insert on public.score_audit_log for each row execute function public.stamp_actor();
drop trigger if exists zz_stamp_actor on public.attendance_audit_log;
create trigger zz_stamp_actor before insert on public.attendance_audit_log for each row execute function public.stamp_actor();

-- acting start/stop is itself audited
drop trigger if exists zz_audit_row_change on public.acting_sessions;
create trigger zz_audit_row_change after insert or delete on public.acting_sessions
  for each row execute function public.audit_row_change('agent_user_id');

-- ===== G. subject teacher: same-subject history of students they currently teach =====
create or replace function public.teaches_student_subject_now(p_student_no text, p_subject text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from enrollments cur
    join class_schedule cs on cs.class_id = cur.class_id
    where cur.student_no = p_student_no and cur.is_current = true
      and cs.teacher_id = public.current_teacher_id()
      and (p_subject is null or cs.subject = p_subject));
$$;

drop policy if exists teacher_read_history_enrollments on public.enrollments;
create policy teacher_read_history_enrollments on public.enrollments for select to authenticated
  using (public.teaches_student_subject_now(student_no, null));

drop policy if exists teacher_read_same_subject_history_scores on public.scores;
create policy teacher_read_same_subject_history_scores on public.scores for select to authenticated
  using (exists (select 1 from enrollments e where e.id = scores.enrollment_id
                 and public.teaches_student_subject_now(e.student_no, scores.subject)));

-- ===== H. grants =====
revoke all on function public.create_delegation(uuid,uuid,timestamptz,timestamptz,text) from public, anon;
revoke all on function public.revoke_delegation(uuid) from public, anon;
revoke all on function public.start_acting(uuid) from public, anon;
revoke all on function public.stop_acting() from public, anon;
revoke all on function public.my_acting_state() from public, anon;
revoke all on function public.my_delegations() from public, anon;
revoke all on function public.delegation_people() from public, anon;
grant execute on function public.create_delegation(uuid,uuid,timestamptz,timestamptz,text) to authenticated;
grant execute on function public.revoke_delegation(uuid) to authenticated;
grant execute on function public.start_acting(uuid) to authenticated;
grant execute on function public.stop_acting() to authenticated;
grant execute on function public.my_acting_state() to authenticated;
grant execute on function public.my_delegations() to authenticated;
grant execute on function public.delegation_people() to authenticated;

-- ===== I. 前端用的「我現在的有效身分」（一次回傳 角色／部門／導師／任課／代理狀態） =====
create or replace function public.my_effective_identity() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_me uuid := auth.uid(); v_pr uuid := public.acting_principal(); v_tid uuid := public.current_teacher_id(); r jsonb;
begin
  if v_me is null then return null; end if;
  select jsonb_build_object(
    'uid', v_me,
    'name', (select name from app_users where id = v_me),
    'real_role', (select role from app_users where id = v_me),
    'role', public.current_role_name(),
    'is_temporary', coalesce((select is_temporary from app_users where id = v_me), false),
    'account_expires_at', (select account_expires_at from app_users where id = v_me),
    'expired', coalesce((select account_expires_at <= now() from app_users where id = v_me), false),
    'departments', coalesce((select jsonb_agg(distinct jsonb_build_object('department', department, 'level', level))
                              from app_user_departments where app_user_id = v_me), '[]'::jsonb),
    'teacher_id', v_tid,
    'is_homeroom', exists (select 1 from classes where homeroom_teacher_id = v_tid),
    'is_teaching', exists (select 1 from class_schedule where teacher_id = v_tid),
    'is_club_teacher', exists (select 1 from clubs where teacher_id = v_tid),
    'acting', case when v_pr is null then null else
       (select jsonb_build_object('principal_id', v_pr, 'principal_name', (select name from app_users where id = v_pr), 'end_at', d.end_at)
          from acting_sessions s join proxy_delegations d on d.id = s.delegation_id where s.agent_user_id = v_me) end,
    'acting_options', coalesce((select jsonb_agg(jsonb_build_object('principal_id', d.principal_user_id,
                                  'principal_name', (select name from app_users where id = d.principal_user_id), 'end_at', d.end_at))
                                from proxy_delegations d
                                where d.agent_user_id = v_me and d.status = 'active' and now() between d.start_at and d.end_at), '[]'::jsonb)
  ) into r;
  return r;
end $$;
revoke all on function public.my_effective_identity() from public, anon;
grant execute on function public.my_effective_identity() to authenticated;
revoke all on function public.staff_rank(uuid) from public, anon;
grant execute on function public.staff_rank(uuid) to authenticated;
revoke all on function public.teaches_student_subject_now(text,text) from public, anon;
grant execute on function public.teaches_student_subject_now(text,text) to authenticated;
