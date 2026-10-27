-- 106: (1) conduct privacy  (2) dev dept == system admin  (3) department-split approvals
--      (4) attendance correction batches (homeroom -> handler -> supervisor)
-- Safe to run more than once.

-- ===== (2) developer department counts as system admin =====
create or replace function public.is_system_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(public.current_role_name() = 'system_admin_s', false)
      or public.has_department('dev'::public.admin_department);
$$;

create or replace function public.is_admin_sa()
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_system_admin() or public.current_role_name() = 'admin_a';
$$;

-- ===== (1) conduct events: only own (parent/student), recording teacher, homeroom, discipline, S/dev =====
drop policy if exists read_conduct_events on public.conduct_events;
drop policy if exists read_conduct_events_linked_parent on public.conduct_events;
create policy read_conduct_events_linked_parent on public.conduct_events
  for select to authenticated using (public.is_linked_parent(student_no));
-- academic dept needs read-only access for report cards
drop policy if exists read_conduct_events_academic on public.conduct_events;
create policy read_conduct_events_academic on public.conduct_events
  for select to authenticated using (public.has_department('academic'::public.admin_department));

-- role-wide admin write (any admin_a/b, any dept) -> removed; discipline dept / S / dev remain
drop policy if exists admin_write_conduct_events on public.conduct_events;

-- ===== (3) department-split approvals =====
-- conduct requests: discipline only (+S/dev) and the requester
drop policy if exists read_conduct_event_request on public.conduct_event_requests;
create policy read_conduct_event_request on public.conduct_event_requests
  for select to authenticated using (
    requested_by = auth.uid() or public.is_system_admin()
    or public.has_department('discipline'::public.admin_department));

create or replace function public.decide_conduct_event_request(p_id uuid, p_decision text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_row conduct_event_requests;
  v_role user_role := current_role_name();
  v_uid uuid := auth.uid();
  v_new_id uuid;
  v_tier int;
  v_disc boolean := has_department('discipline'::admin_department);
  v_lead boolean := is_department_lead('discipline'::admin_department);
begin
  if p_decision not in ('同意','不同意') then raise exception '決定只能是「同意」或「不同意」'; end if;
  select * into v_row from conduct_event_requests where id = p_id for update;
  if v_row is null then raise exception '找不到這筆申請'; end if;
  v_tier := case v_row.event_type when '嘉獎' then 1 when '警告' then 1 when '小功' then 2 when '小過' then 2 when '大功' then 3 when '大過' then 3 else 1 end;

  if v_row.status = '待B審核' then
    if not (v_disc and (v_role = 'admin_b' or is_system_admin())) then
      raise exception '這筆獎懲屬訓導處業務，目前輪到訓導承辦（B）審核，您沒有權限';
    end if;
    update conduct_event_requests set b_decision=p_decision,b_by=v_uid,b_at=now(),
      status = case when p_decision='不同意' then '已駁回' when v_tier=1 then '已核准' else '待A審核' end where id=p_id;
  elsif v_row.status = '待A審核' then
    if not ((v_lead and v_role = 'admin_a') or is_system_admin()) then
      raise exception '目前輪到訓導主任（A）審核，您沒有權限';
    end if;
    update conduct_event_requests set a_decision=p_decision,a_by=v_uid,a_at=now(),
      status = case when p_decision='不同意' then '已駁回' when v_tier=3 then '待S審核' else '已核准' end where id=p_id;
  elsif v_row.status = '待S審核' then
    if not is_system_admin() then raise exception '目前輪到管理員S審核，您沒有權限'; end if;
    update conduct_event_requests set s_decision=p_decision,s_by=v_uid,s_at=now(),
      status = case when p_decision='不同意' then '已駁回' else '已核准' end where id=p_id;
  else
    raise exception '這筆申請已經處理完成（%），不能重複審核', v_row.status;
  end if;

  select * into v_row from conduct_event_requests where id = p_id;
  if v_row.status = '已核准' and v_row.applied_at is null then
    insert into conduct_events (student_no,event_date,event_type,points,count,reason,recorded_by)
    values (v_row.student_no,v_row.event_date,v_row.event_type,v_row.points,v_row.count,v_row.reason,
            (select id from teachers where app_user_id = v_row.requested_by))
    on conflict on constraint conduct_events_student_date_type_key
    do update set points=excluded.points,count=excluded.count,reason=excluded.reason,recorded_by=excluded.recorded_by
    returning id into v_new_id;
    update conduct_event_requests set applied_at=now(), conduct_event_id=v_new_id where id=p_id;
  end if;
end; $$;

-- submission windows: attendance -> discipline, grades -> academic (no more any-admin access)
drop policy if exists admin_manage_submission_windows on public.submission_windows;
create policy admin_manage_submission_windows on public.submission_windows for all to authenticated
  using (public.is_system_admin()
     or (data_type='出缺勤' and public.has_department('discipline'::public.admin_department))
     or (data_type in ('期中考','期末考','平時分') and public.has_department('academic'::public.admin_department)))
  with check (public.is_system_admin()
     or (data_type='出缺勤' and public.has_department('discipline'::public.admin_department))
     or (data_type in ('期中考','期末考','平時分') and public.has_department('academic'::public.admin_department)));

-- correction requests: attendance handled by any discipline member (承辦), grades by academic lead
drop policy if exists teacher_view_own_requests on public.correction_requests;
create policy teacher_view_own_requests on public.correction_requests for select to authenticated using (
  requested_by = public.current_teacher_id() or public.is_system_admin()
  or (data_type='出缺勤' and public.has_department('discipline'::public.admin_department))
  or (data_type in ('期中考','期末考','平時分') and public.is_department_lead('academic'::public.admin_department)));
drop policy if exists department_lead_review_requests on public.correction_requests;
create policy department_lead_review_requests on public.correction_requests for update to authenticated using (
  public.is_system_admin()
  or (data_type='出缺勤' and public.has_department('discipline'::public.admin_department))
  or (data_type in ('期中考','期末考','平時分') and public.is_department_lead('academic'::public.admin_department)));

-- ===== (4) attendance correction batches =====
alter table public.attendance_alert_settings
  add column if not exists correction_max_students int not null default 5,
  add column if not exists correction_teacher_limit int not null default 3,
  add column if not exists correction_teacher_window_days int not null default 30;

create table if not exists public.attendance_correction_batches (
  id uuid primary key default gen_random_uuid(),
  requested_by uuid not null,            -- teachers.id
  class_id uuid not null,
  date_from date not null,
  date_to date not null,
  reason text not null check (btrim(reason) <> ''),
  student_count int not null,
  cell_count int not null,
  teacher_recent_count int not null default 0,
  needs_supervisor boolean not null default false,
  needs_supervisor_reason text,
  status text not null default '待承辦審核'
    check (status in ('待承辦審核','待長官批示','已核准','已駁回')),
  handler_by uuid, handler_at timestamptz, handler_decision text, handler_note text,
  supervisor_by uuid, supervisor_at timestamptz, supervisor_decision text, supervisor_note text,
  applied_at timestamptz,
  created_at timestamptz not null default now()
);
create table if not exists public.attendance_correction_items (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.attendance_correction_batches(id) on delete cascade,
  student_no text not null,
  record_date date not null,
  period_no int not null,
  old_status text not null,
  new_status text not null
);
create index if not exists acb_status_idx on public.attendance_correction_batches(status);
create index if not exists aci_batch_idx on public.attendance_correction_items(batch_id);

alter table public.attendance_correction_batches enable row level security;
alter table public.attendance_correction_items enable row level security;

drop policy if exists acb_select on public.attendance_correction_batches;
create policy acb_select on public.attendance_correction_batches for select to authenticated using (
  requested_by = public.current_teacher_id() or public.is_system_admin()
  or public.has_department('discipline'::public.admin_department));
drop policy if exists aci_select on public.attendance_correction_items;
create policy aci_select on public.attendance_correction_items for select to authenticated using (
  exists (select 1 from public.attendance_correction_batches b where b.id = batch_id));
revoke insert, update, delete on public.attendance_correction_batches from anon, authenticated;
revoke insert, update, delete on public.attendance_correction_items from anon, authenticated;
revoke all on public.attendance_correction_batches, public.attendance_correction_items from anon;

create or replace function public.submit_attendance_correction(p_class_id uuid, p_reason text, p_items jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_tid uuid := current_teacher_id();
  v_homeroom boolean;
  s attendance_alert_settings;
  v_id uuid;
  v_students int; v_cells int; v_recent int; v_need boolean := false; v_why text := '';
  v_from date; v_to date; it jsonb; v_old text;
begin
  if v_tid is null then raise exception '只有教師帳號可以送出出缺席修正申請'; end if;
  if p_reason is null or btrim(p_reason) = '' then raise exception '請填寫修正理由'; end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception '沒有任何要修正的內容';
  end if;
  select exists(select 1 from classes where id=p_class_id and homeroom_teacher_id=v_tid) into v_homeroom;

  create temp table if not exists _acc_items(student_no text, record_date date, period_no int, old_status text, new_status text) on commit drop;
  truncate _acc_items;
  for it in select * from jsonb_array_elements(p_items) loop
    if not exists (select 1 from enrollments e where e.class_id=p_class_id and e.student_no = it->>'student_no') then
      raise exception '學生 % 不在這個班級', it->>'student_no';
    end if;
    if not v_homeroom and not exists (select 1 from class_schedule cs where cs.class_id=p_class_id and cs.teacher_id=v_tid and cs.period_no=(it->>'period_no')::int) then
      raise exception '您不是這班導師，也不是第 % 節的任課教師', it->>'period_no';
    end if;
    select status::text into v_old from attendance
      where student_no = it->>'student_no' and record_date=(it->>'record_date')::date and period_no=(it->>'period_no')::int;
    v_old := coalesce(v_old,'出席');
    if v_old = it->>'new_status' then continue; end if;
    insert into _acc_items values (it->>'student_no',(it->>'record_date')::date,(it->>'period_no')::int, v_old, it->>'new_status');
  end loop;

  select count(distinct student_no), count(*), min(record_date), max(record_date) into v_students, v_cells, v_from, v_to from _acc_items;
  if v_cells = 0 then raise exception '所有格子都沒有實際變更，不需要申請'; end if;

  select * into s from attendance_alert_settings where id=1;
  select count(*) into v_recent from attendance_correction_batches
    where requested_by=v_tid and created_at >= now() - make_interval(days => coalesce(s.correction_teacher_window_days,30));
  if v_students > coalesce(s.correction_max_students,5) then
    v_need := true; v_why := format('本次涉及 %s 位學生，超過上限 %s 位', v_students, coalesce(s.correction_max_students,5));
  end if;
  if v_recent + 1 > coalesce(s.correction_teacher_limit,3) then
    v_need := true;
    v_why := trim(both '；' from v_why || case when v_why<>'' then '；' else '' end ||
      format('此教師近 %s 天已申請 %s 次，本次為第 %s 次，超過上限 %s 次', coalesce(s.correction_teacher_window_days,30), v_recent, v_recent+1, coalesce(s.correction_teacher_limit,3)));
  end if;

  insert into attendance_correction_batches(requested_by,class_id,date_from,date_to,reason,student_count,cell_count,teacher_recent_count,needs_supervisor,needs_supervisor_reason)
  values (v_tid,p_class_id,v_from,v_to,btrim(p_reason),v_students,v_cells,v_recent,v_need,nullif(v_why,'')) returning id into v_id;
  insert into attendance_correction_items(batch_id,student_no,record_date,period_no,old_status,new_status)
    select v_id,student_no,record_date,period_no,old_status,new_status from _acc_items;
  return v_id;
end; $$;

create or replace function public.review_attendance_correction(p_batch_id uuid, p_decision text, p_note text default null)
returns void language plpgsql security definer set search_path = public as $$
declare b attendance_correction_batches; v_uid uuid := auth.uid();
begin
  if p_decision not in ('同意','不同意') then raise exception '決定只能是「同意」或「不同意」'; end if;
  if p_decision='不同意' and (p_note is null or btrim(p_note)='') then raise exception '不同意時請填寫原因'; end if;
  select * into b from attendance_correction_batches where id=p_batch_id for update;
  if b.id is null then raise exception '找不到這筆申請'; end if;

  if b.status='待承辦審核' then
    if not (has_department('discipline'::admin_department) or is_system_admin()) then
      raise exception '出缺席修正由訓導處承辦人審核，您沒有權限';
    end if;
    update attendance_correction_batches set handler_by=v_uid, handler_at=now(), handler_decision=p_decision, handler_note=p_note,
      status = case when p_decision='不同意' then '已駁回' when needs_supervisor then '待長官批示' else '已核准' end
    where id=p_batch_id;
  elsif b.status='待長官批示' then
    if not (is_department_lead('discipline'::admin_department) or is_system_admin()) then
      raise exception '此申請需訓導主任（長官）批示，您沒有權限';
    end if;
    if b.handler_by = v_uid and not is_system_admin() then
      raise exception '承辦人與批示者不能是同一人，請由訓導主任或管理員批示';
    end if;
    update attendance_correction_batches set supervisor_by=v_uid, supervisor_at=now(), supervisor_decision=p_decision, supervisor_note=p_note,
      status = case when p_decision='不同意' then '已駁回' else '已核准' end
    where id=p_batch_id;
  else
    raise exception '這筆申請已處理完成（%）', b.status;
  end if;

  select * into b from attendance_correction_batches where id=p_batch_id;
  if b.status='已核准' and b.applied_at is null then
    insert into attendance(student_no,record_date,period_no,status,recorded_by,updated_at)
      select i.student_no,i.record_date,i.period_no,i.new_status::attendance_status,b.requested_by,now()
      from attendance_correction_items i where i.batch_id=p_batch_id
    on conflict (student_no,record_date,period_no)
    do update set status=excluded.status, recorded_by=excluded.recorded_by, updated_at=now();
    update attendance_correction_batches set applied_at=now() where id=p_batch_id;
  end if;
end; $$;

revoke all on function public.submit_attendance_correction(uuid,text,jsonb) from public, anon;
revoke all on function public.review_attendance_correction(uuid,text,text) from public, anon;
grant execute on function public.submit_attendance_correction(uuid,text,jsonb) to authenticated;
grant execute on function public.review_attendance_correction(uuid,text,text) to authenticated;

-- profile edit requests (parent/student change basic data) belong to academic dept
drop policy if exists academic_read_profile_edit_requests on public.profile_edit_requests;
create policy academic_read_profile_edit_requests on public.profile_edit_requests
  for select to authenticated using (public.has_department('academic'::public.admin_department));
