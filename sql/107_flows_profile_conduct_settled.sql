-- =====================================================================
-- 107：審核流程調整（請在 105、105b、106 之後執行；可重複執行）
--  (1) 家長／學生修改基本資料：不審核、直接生效；通知導師（導師按「已閱讀」）；
--      改姓名／泰文姓名／出生日期／身分證號 另外通知教務處
--  (2) 獎懲：所有教師都送申請 → 訓導處審核 → 管理員A →（A 決定）管理員S；
--      訓導處自己送的申請直接到管理員A
--  (3) 成績、出缺席「結算（鎖定）後」修改：一律要批示到管理員A，再由 A 決定是否送 S
-- 「管理員A」＝帳號角色 admin_a，且屬於該業務部門、或沒有掛任何部門（校長／副校長等）；
--  系統管理員S、開發人員可代行任何一關。同一個人不能在同一筆申請上連審兩關。
-- =====================================================================

-- ---------- 共用：誰可以當「管理員A」這一關 ----------
create or replace function public.is_stage_a_approver(p_dept public.admin_department)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_system_admin()
      or ((select role from app_users where id = auth.uid()) = 'admin_a'
          and (public.has_department(p_dept)
               or not exists (select 1 from app_user_departments where app_user_id = auth.uid())));
$$;
grant execute on function public.is_stage_a_approver(public.admin_department) to authenticated;

-- =====================================================================
-- (1) 家長／學生修改基本資料
-- =====================================================================
alter table public.profile_edit_requests
  add column if not exists notify_academic boolean not null default false,
  add column if not exists homeroom_read_at timestamptz,
  add column if not exists homeroom_read_by uuid,
  add column if not exists academic_read_at timestamptz,
  add column if not exists academic_read_by uuid;
alter table public.profile_edit_requests drop constraint if exists profile_edit_requests_status_check;
alter table public.profile_edit_requests add constraint profile_edit_requests_status_check
  check (status in ('待審核','已核准','已駁回','已生效'));

alter table public.staff_notifications drop constraint if exists staff_notifications_category_check;
alter table public.staff_notifications add constraint staff_notifications_category_check
  check (category in ('個資修改申請','出缺勤示警','代課通知','考場通知','學生資料變更','審核通知'));

create or replace function public.apply_profile_edit()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_student_fields text[] := array['name','gender','thai_name','dob','id_number','nationality','religion',
                                   'blood_type','address','phone','previous_school','previous_school_grade'];
  v_guardian_fields text[] := array['name','chinese_name','phone','email','address','occupation'];
begin
  if new.target_table = 'students' then
    if not (new.field_name = any(v_student_fields)) then
      raise exception '這個欄位不能由家長／學生修改：%', new.field_name;
    end if;
    if new.field_name = 'dob' then
      execute 'update public.students set dob = $1::date, updated_at = now() where student_no = $2'
        using nullif(btrim(new.new_value), ''), new.student_no;
    elsif new.field_name = 'name' then
      if btrim(coalesce(new.new_value,'')) = '' then raise exception '姓名不能空白'; end if;
      update public.students set name = btrim(new.new_value), updated_at = now() where student_no = new.student_no;
    else
      execute format('update public.students set %I = $1, updated_at = now() where student_no = $2', new.field_name)
        using nullif(btrim(new.new_value), ''), new.student_no;
    end if;
    new.notify_academic := new.field_name in ('name','thai_name','dob','id_number');
  elsif new.target_table = 'guardians' then
    if not (new.field_name = any(v_guardian_fields)) then
      raise exception '這個監護人欄位不能修改：%', new.field_name;
    end if;
    if new.guardian_id is null or not exists (select 1 from guardians g where g.id = new.guardian_id and g.student_no = new.student_no) then
      raise exception '找不到這位監護人';
    end if;
    execute format('update public.guardians set %I = $1 where id = $2', new.field_name)
      using nullif(btrim(new.new_value), ''), new.guardian_id;
    new.notify_academic := false;
  end if;
  new.status := '已生效';
  new.reviewed_at := now();
  return new;
end; $$;

drop trigger if exists trg_apply_profile_edit on public.profile_edit_requests;
create trigger trg_apply_profile_edit before insert on public.profile_edit_requests
  for each row execute function public.apply_profile_edit();

create or replace function public.notify_profile_edit()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_name text; v_label text; v_homeroom uuid;
begin
  select name into v_name from students where student_no = new.student_no;
  v_label := case new.field_name
    when 'name' then '姓名' when 'thai_name' then '泰文姓名' when 'dob' then '出生日期'
    when 'id_number' then '身分證／護照號碼' when 'address' then '地址' when 'phone' then '電話'
    else new.field_name end;
  if new.target_table = 'guardians' then v_label := '監護人' || v_label; end if;

  select c.homeroom_teacher_id into v_homeroom
    from enrollments e join classes c on c.id = e.class_id
   where e.student_no = new.student_no and e.is_current
   order by e.created_at desc limit 1;
  if v_homeroom is not null then
    insert into staff_notifications(teacher_id, category, message, student_no)
    values (v_homeroom, '學生資料變更',
            format('%s（%s）的%s已由家長／學生更新為「%s」（原：%s），請閱讀確認。',
                   coalesce(v_name,new.student_no), new.student_no, v_label, new.new_value, coalesce(new.old_value,'空白')),
            new.student_no);
  end if;

  if new.notify_academic then
    insert into staff_notifications(teacher_id, category, message, student_no)
    select distinct t.id, '學生資料變更',
           format('【教務處】%s（%s）的%s已變更為「%s」（原：%s），請核對學籍資料。',
                  coalesce(v_name,new.student_no), new.student_no, v_label, new.new_value, coalesce(new.old_value,'空白')),
           new.student_no
      from app_user_departments d join teachers t on t.app_user_id = d.app_user_id
     where d.department = 'academic';
  end if;
  return null;
end; $$;

-- 舊版「請導師審核」通知觸發器：改成新版通知後移除，避免導師收到兩則
drop trigger if exists trg_notify_homeroom_on_profile_edit_request on public.profile_edit_requests;
drop trigger if exists trg_notify_profile_edit on public.profile_edit_requests;
create trigger trg_notify_profile_edit after insert on public.profile_edit_requests
  for each row execute function public.notify_profile_edit();

create or replace function public.mark_profile_edits_read(p_ids uuid[], p_as text)
returns int language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if p_as = 'homeroom' then
    update profile_edit_requests r set homeroom_read_at = now(), homeroom_read_by = auth.uid()
     where r.id = any(p_ids) and r.homeroom_read_at is null
       and (is_system_admin() or exists (
             select 1 from enrollments e join classes c on c.id = e.class_id
              where e.student_no = r.student_no and e.is_current and c.homeroom_teacher_id = current_teacher_id()));
  elsif p_as = 'academic' then
    if not (is_system_admin() or has_department('academic'::admin_department)) then
      raise exception '只有教務處可以標記教務已閱讀';
    end if;
    update profile_edit_requests r set academic_read_at = now(), academic_read_by = auth.uid()
     where r.id = any(p_ids) and r.notify_academic and r.academic_read_at is null;
  else
    raise exception 'p_as 只能是 homeroom 或 academic';
  end if;
  get diagnostics n = row_count;
  return n;
end; $$;
revoke all on function public.mark_profile_edits_read(uuid[], text) from public, anon;
grant execute on function public.mark_profile_edits_read(uuid[], text) to authenticated;

-- =====================================================================
-- (2) 獎懲：教師 → 訓導處 → 管理員A →（A 決定）S
-- =====================================================================
-- 訓導處（或 S／開發人員）自己送出的申請，直接進到「待A審核」
create or replace function public.route_conduct_event_request()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if has_department('discipline'::admin_department) or is_system_admin() then
    new.status := '待A審核';
  else
    new.status := '待B審核';
  end if;
  new.b_decision := null; new.b_by := null; new.b_at := null;
  new.a_decision := null; new.a_by := null; new.a_at := null;
  new.s_decision := null; new.s_by := null; new.s_at := null;
  new.applied_at := null; new.conduct_event_id := null;
  return new;
end; $$;
drop trigger if exists trg_route_conduct_event_request on public.conduct_event_requests;
create trigger trg_route_conduct_event_request before insert on public.conduct_event_requests
  for each row execute function public.route_conduct_event_request();

drop policy if exists read_conduct_event_request on public.conduct_event_requests;
create policy read_conduct_event_request on public.conduct_event_requests
  for select to authenticated using (
    requested_by = auth.uid() or public.is_system_admin()
    or public.has_department('discipline'::public.admin_department)
    or public.is_stage_a_approver('discipline'::public.admin_department));

-- p_decision：'同意' / '不同意'；管理員A 另外可以選 '送S'
create or replace function public.decide_conduct_event_request(p_id uuid, p_decision text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_row conduct_event_requests;
  v_uid uuid := auth.uid();
  v_new_id uuid;
begin
  if p_decision not in ('同意','不同意','送S') then raise exception '決定只能是「同意」「不同意」或「送S」'; end if;
  select * into v_row from conduct_event_requests where id = p_id for update;
  if v_row is null then raise exception '找不到這筆申請'; end if;

  if v_row.status = '待B審核' then
    if not (has_department('discipline'::admin_department) or is_system_admin()) then
      raise exception '這一關由訓導處審核，您沒有權限';
    end if;
    if p_decision = '送S' then raise exception '訓導處這一關只能「同意」或「不同意」'; end if;
    if v_row.requested_by = v_uid and not is_system_admin() then raise exception '不能審核自己送出的申請'; end if;
    update conduct_event_requests set b_decision = p_decision, b_by = v_uid, b_at = now(),
      status = case when p_decision = '不同意' then '已駁回' else '待A審核' end
     where id = p_id;

  elsif v_row.status = '待A審核' then
    if not is_stage_a_approver('discipline'::admin_department) then
      raise exception '這一關由管理員A審核，您沒有權限';
    end if;
    if not is_system_admin() and (v_row.requested_by = v_uid or v_row.b_by = v_uid) then
      raise exception '同一個人不能在同一筆申請上連審兩關，請由其他管理員A或系統管理員S處理';
    end if;
    update conduct_event_requests set a_decision = case when p_decision = '不同意' then '不同意' else '同意' end,
      a_by = v_uid, a_at = now(),
      status = case p_decision when '不同意' then '已駁回' when '送S' then '待S審核' else '已核准' end
     where id = p_id;

  elsif v_row.status = '待S審核' then
    if not is_system_admin() then raise exception '這一關由管理員S審核，您沒有權限'; end if;
    if p_decision = '送S' then raise exception '已經在管理員S這一關'; end if;
    update conduct_event_requests set s_decision = p_decision, s_by = v_uid, s_at = now(),
      status = case when p_decision = '不同意' then '已駁回' else '已核准' end
     where id = p_id;
  else
    raise exception '這筆申請已經處理完成（%），不能重複審核', v_row.status;
  end if;

  select * into v_row from conduct_event_requests where id = p_id;
  if v_row.status = '已核准' and v_row.applied_at is null then
    perform set_config('app.conduct_via_request', '1', true);
    insert into conduct_events (student_no, event_date, event_type, points, count, reason, recorded_by)
    values (v_row.student_no, v_row.event_date, v_row.event_type, v_row.points, v_row.count, v_row.reason,
            (select id from teachers where app_user_id = v_row.requested_by))
    on conflict on constraint conduct_events_student_date_type_key
    do update set points = excluded.points, count = excluded.count, reason = excluded.reason, recorded_by = excluded.recorded_by
    returning id into v_new_id;
    perform set_config('app.conduct_via_request', '', true);
    update conduct_event_requests set applied_at = now(), conduct_event_id = v_new_id where id = p_id;
  end if;
end; $$;

-- 寫入檢查：審核通過後的寫入、伺服器端（service role，例如四部門 Excel 上傳）直接放行
create or replace function public.enforce_conduct_event_rules()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_default numeric;
begin
  if coalesce(current_setting('app.conduct_via_request', true), '') = '1' then return new; end if;
  if coalesce(auth.role(), '') = 'service_role' then return new; end if;
  if is_system_admin() or has_department('discipline') then return new; end if;
  if new.reason is null or btrim(new.reason) = '' then raise exception '獎懲登記一定要填寫原因'; end if;
  if new.event_type not in ('嘉獎','小功') then raise exception '教師只能登記嘉獎或小功'; end if;
  select points into v_default from conduct_point_defaults where item = new.event_type;
  new.points := coalesce(v_default, case new.event_type when '小功' then 3 else 1 end);
  if new.points > 3 then raise exception '教師單筆獎勵上限為 1 小功'; end if;
  return new;
end; $$;

-- 訓導處不再「直接登記」獎懲（一律送管理員A）；仍可修正／刪除既有紀錄。
-- 直接新增只保留給系統管理員S／開發人員（例如整批匯入舊資料）。
drop policy if exists discipline_write_conduct_events on public.conduct_events;
drop policy if exists sa_insert_conduct_events on public.conduct_events;
drop policy if exists discipline_update_conduct_events on public.conduct_events;
drop policy if exists discipline_delete_conduct_events on public.conduct_events;
create policy sa_insert_conduct_events on public.conduct_events for insert to authenticated
  with check (public.is_system_admin());
create policy discipline_update_conduct_events on public.conduct_events for update to authenticated
  using (public.is_system_admin() or public.has_department('discipline'::public.admin_department))
  with check (public.is_system_admin() or public.has_department('discipline'::public.admin_department));
create policy discipline_delete_conduct_events on public.conduct_events for delete to authenticated
  using (public.is_system_admin() or public.has_department('discipline'::public.admin_department));

-- =====================================================================
-- (3a) 出缺席：結算（班級出缺勤已鎖定）後的修正 → 訓導承辦 → 管理員A →（A 決定）S
-- =====================================================================
create or replace function public.attendance_settled_for_class(p_class_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(public.submission_window_locked(
           p_class_id, c.academic_year,
           coalesce((select e.term from enrollments e where e.class_id = c.id and e.is_current limit 1),
                    (select t.term from current_academic_term() t)),
           '出缺勤'), false)
    from classes c where c.id = p_class_id;
$$;

create or replace function public.attendance_settled(p_student_no text)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(bool_or(public.attendance_settled_for_class(e.class_id)), false)
    from enrollments e where e.student_no = p_student_no and e.is_current;
$$;
grant execute on function public.attendance_settled_for_class(uuid) to authenticated;
grant execute on function public.attendance_settled(text) to authenticated;

-- 訓導處直接改出缺席：只限「尚未結算」；結算後只有 S／開發人員能直接改，其他人走修正申請
create or replace function public.can_write_attendance(p_student_no text, p_record_date date, p_period_no integer, p_attendance_id uuid default null)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare v_is_owner boolean;
begin
  if is_system_admin() then return true; end if;
  if has_department('discipline') and not attendance_settled(p_student_no) then return true; end if;

  v_is_owner := exists (
    select 1 from enrollments e join classes c on c.id = e.class_id
     where e.student_no = p_student_no and c.homeroom_teacher_id = current_teacher_id()
  ) or exists (
    select 1 from enrollments e join class_schedule cs on cs.class_id = e.class_id
     where e.student_no = p_student_no and cs.teacher_id = current_teacher_id() and cs.period_no = p_period_no
  );
  if not v_is_owner then return false; end if;
  if not attendance_locked(p_student_no, p_record_date) then return true; end if;
  return (p_attendance_id is not null and has_approved_correction(p_attendance_id))
    or exists (select 1 from enrollments e where e.student_no = p_student_no and has_approved_window_open(e.class_id));
end; $$;

drop policy if exists attendance_insert on public.attendance;
drop policy if exists attendance_update on public.attendance;
drop policy if exists attendance_delete on public.attendance;
create policy attendance_insert on public.attendance for insert to authenticated
  with check (public.can_write_attendance(student_no, record_date, period_no, id));
create policy attendance_update on public.attendance for update to authenticated
  using (public.can_write_attendance(student_no, record_date, period_no, id))
  with check (public.can_write_attendance(student_no, record_date, period_no, id));
create policy attendance_delete on public.attendance for delete to authenticated
  using (public.can_write_attendance(student_no, record_date, period_no, id));

alter table public.attendance_correction_batches
  add column if not exists after_settlement boolean not null default false,
  add column if not exists a_by uuid, add column if not exists a_at timestamptz,
  add column if not exists a_decision text, add column if not exists a_note text;
alter table public.attendance_correction_batches drop constraint if exists attendance_correction_batches_status_check;
alter table public.attendance_correction_batches add constraint attendance_correction_batches_status_check
  check (status in ('待承辦審核','待長官批示','待A批示','待S批示','已核准','已駁回'));

drop policy if exists acb_select on public.attendance_correction_batches;
create policy acb_select on public.attendance_correction_batches for select to authenticated using (
  requested_by = public.current_teacher_id() or public.is_system_admin()
  or public.has_department('discipline'::public.admin_department)
  or (status in ('待A批示','待S批示','已核准','已駁回') and public.is_stage_a_approver('discipline'::public.admin_department)));

create or replace function public.submit_attendance_correction(p_class_id uuid, p_reason text, p_items jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_tid uuid := current_teacher_id();
  v_homeroom boolean;
  s attendance_alert_settings;
  v_id uuid;
  v_students int; v_cells int; v_recent int; v_need boolean := false; v_why text := '';
  v_from date; v_to date; it jsonb; v_old text; v_settled boolean;
begin
  if v_tid is null then raise exception '只有教師帳號可以送出出缺席修正申請'; end if;
  if p_reason is null or btrim(p_reason) = '' then raise exception '請填寫修正理由'; end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception '沒有任何要修正的內容';
  end if;
  select exists(select 1 from classes where id = p_class_id and homeroom_teacher_id = v_tid) into v_homeroom;
  v_settled := attendance_settled_for_class(p_class_id);

  create temp table if not exists _acc_items(student_no text, record_date date, period_no int, old_status text, new_status text) on commit drop;
  truncate _acc_items;
  for it in select * from jsonb_array_elements(p_items) loop
    if not exists (select 1 from enrollments e where e.class_id = p_class_id and e.student_no = it->>'student_no') then
      raise exception '學生 % 不在這個班級', it->>'student_no';
    end if;
    if not v_homeroom and not exists (select 1 from class_schedule cs where cs.class_id = p_class_id and cs.teacher_id = v_tid and cs.period_no = (it->>'period_no')::int) then
      raise exception '您不是這班導師，也不是第 % 節的任課教師', it->>'period_no';
    end if;
    select status::text into v_old from attendance
     where student_no = it->>'student_no' and record_date = (it->>'record_date')::date and period_no = (it->>'period_no')::int;
    v_old := coalesce(v_old, '出席');
    if v_old = it->>'new_status' then continue; end if;
    insert into _acc_items values (it->>'student_no', (it->>'record_date')::date, (it->>'period_no')::int, v_old, it->>'new_status');
  end loop;

  select count(distinct student_no), count(*), min(record_date), max(record_date) into v_students, v_cells, v_from, v_to from _acc_items;
  if v_cells = 0 then raise exception '所有格子都沒有實際變更，不需要申請'; end if;

  select * into s from attendance_alert_settings where id = 1;
  select count(*) into v_recent from attendance_correction_batches
   where requested_by = v_tid and created_at >= now() - make_interval(days => coalesce(s.correction_teacher_window_days, 30));
  if v_settled then
    v_need := true; v_why := '出缺席已結算（鎖定），修改須經管理員A批示';
  else
    if v_students > coalesce(s.correction_max_students, 5) then
      v_need := true; v_why := format('本次涉及 %s 位學生，超過上限 %s 位', v_students, coalesce(s.correction_max_students, 5));
    end if;
    if v_recent + 1 > coalesce(s.correction_teacher_limit, 3) then
      v_need := true;
      v_why := trim(both '；' from v_why || case when v_why <> '' then '；' else '' end ||
        format('此教師近 %s 天已申請 %s 次，本次為第 %s 次，超過上限 %s 次',
               coalesce(s.correction_teacher_window_days, 30), v_recent, v_recent + 1, coalesce(s.correction_teacher_limit, 3)));
    end if;
  end if;

  insert into attendance_correction_batches(requested_by, class_id, date_from, date_to, reason, student_count, cell_count,
                                            teacher_recent_count, needs_supervisor, needs_supervisor_reason, after_settlement)
  values (v_tid, p_class_id, v_from, v_to, btrim(p_reason), v_students, v_cells, v_recent, v_need, nullif(v_why, ''), v_settled)
  returning id into v_id;
  insert into attendance_correction_items(batch_id, student_no, record_date, period_no, old_status, new_status)
  select v_id, student_no, record_date, period_no, old_status, new_status from _acc_items;
  return v_id;
end; $$;

create or replace function public.review_attendance_correction(p_batch_id uuid, p_decision text, p_note text default null)
returns void language plpgsql security definer set search_path = public as $$
declare b attendance_correction_batches; v_uid uuid := auth.uid(); v_req_uid uuid;
begin
  if p_decision not in ('同意','不同意','送S') then raise exception '決定只能是「同意」「不同意」或「送S」'; end if;
  if p_decision = '不同意' and (p_note is null or btrim(p_note) = '') then raise exception '不同意時請填寫原因'; end if;
  select * into b from attendance_correction_batches where id = p_batch_id for update;
  if b.id is null then raise exception '找不到這筆申請'; end if;
  select app_user_id into v_req_uid from teachers where id = b.requested_by;
  if p_decision = '送S' and b.status <> '待A批示' then raise exception '只有管理員A這一關可以選「送S」'; end if;

  if b.status = '待承辦審核' then
    if not (has_department('discipline'::admin_department) or is_system_admin()) then
      raise exception '出缺席修正由訓導處承辦人審核，您沒有權限';
    end if;
    if v_req_uid = v_uid and not is_system_admin() then raise exception '不能審核自己送出的申請'; end if;
    update attendance_correction_batches set handler_by = v_uid, handler_at = now(), handler_decision = p_decision, handler_note = p_note,
      status = case when p_decision = '不同意' then '已駁回'
                    when after_settlement then '待A批示'
                    when needs_supervisor then '待長官批示'
                    else '已核准' end
     where id = p_batch_id;

  elsif b.status = '待長官批示' then
    if not (is_department_lead('discipline'::admin_department) or is_system_admin()) then
      raise exception '此申請需訓導主任（長官）批示，您沒有權限';
    end if;
    if (b.handler_by = v_uid or v_req_uid = v_uid) and not is_system_admin() then
      raise exception '承辦人與批示者不能是同一人，請由訓導主任或管理員批示';
    end if;
    update attendance_correction_batches set supervisor_by = v_uid, supervisor_at = now(), supervisor_decision = p_decision, supervisor_note = p_note,
      status = case when p_decision = '不同意' then '已駁回' else '已核准' end
     where id = p_batch_id;

  elsif b.status = '待A批示' then
    if not is_stage_a_approver('discipline'::admin_department) then raise exception '這一關由管理員A批示，您沒有權限'; end if;
    if (b.handler_by = v_uid or v_req_uid = v_uid) and not is_system_admin() then
      raise exception '同一個人不能在同一筆申請上連審兩關';
    end if;
    update attendance_correction_batches set a_by = v_uid, a_at = now(), a_decision = p_decision, a_note = p_note,
      status = case p_decision when '不同意' then '已駁回' when '送S' then '待S批示' else '已核准' end
     where id = p_batch_id;

  elsif b.status = '待S批示' then
    if not is_system_admin() then raise exception '這一關由管理員S批示，您沒有權限'; end if;
    update attendance_correction_batches set supervisor_by = v_uid, supervisor_at = now(), supervisor_decision = p_decision, supervisor_note = p_note,
      status = case when p_decision = '不同意' then '已駁回' else '已核准' end
     where id = p_batch_id;
  else
    raise exception '這筆申請已處理完成（%）', b.status;
  end if;

  select * into b from attendance_correction_batches where id = p_batch_id;
  if b.status = '已核准' and b.applied_at is null then
    insert into attendance(student_no, record_date, period_no, status, recorded_by, updated_at)
    select i.student_no, i.record_date, i.period_no, i.new_status::attendance_status, b.requested_by, now()
      from attendance_correction_items i where i.batch_id = p_batch_id
    on conflict (student_no, record_date, period_no)
    do update set status = excluded.status, recorded_by = excluded.recorded_by, updated_at = now();
    update attendance_correction_batches set applied_at = now() where id = p_batch_id;
  end if;
end; $$;
revoke all on function public.review_attendance_correction(uuid, text, text) from public, anon;
grant execute on function public.review_attendance_correction(uuid, text, text) to authenticated;
revoke all on function public.submit_attendance_correction(uuid, text, jsonb) from public, anon;
grant execute on function public.submit_attendance_correction(uuid, text, jsonb) to authenticated;

-- =====================================================================
-- (3b) 成績：結算（鎖定）後的修改 → 教務處審核 → 管理員A →（A 決定）S
-- =====================================================================
create or replace function public.scores_settled(p_class_id uuid, p_academic_year int, p_term text, p_exam_type text)
returns boolean language sql stable security definer set search_path = public as $$
  select public.scores_locked(p_class_id, p_academic_year, p_term, p_exam_type)
      or coalesce(public.submission_window_locked(p_class_id, p_academic_year, p_term, p_exam_type), false);
$$;
grant execute on function public.scores_settled(uuid, int, text, text) to authenticated;

-- 教務處直接改成績：只限「尚未結算」；結算後只有 S／開發人員能直接改
create or replace function public.can_write_score(p_enrollment_id uuid, p_subject text, p_exam_type text, p_score_id uuid default null)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare v_class_id uuid; v_academic_year int; v_term text; v_is_owner boolean;
begin
  select c.id, c.academic_year, e.term into v_class_id, v_academic_year, v_term
    from enrollments e join classes c on c.id = e.class_id where e.id = p_enrollment_id;
  if is_system_admin() then return true; end if;
  if has_department('academic') then
    return not scores_settled(v_class_id, v_academic_year, v_term, p_exam_type);
  end if;
  v_is_owner := exists (select 1 from class_schedule cs
                         where cs.class_id = v_class_id and cs.teacher_id = current_teacher_id() and cs.subject = p_subject);
  if not v_is_owner then return false; end if;
  if not scores_locked(v_class_id, v_academic_year, v_term, p_exam_type) then return true; end if;
  return p_score_id is not null and has_approved_correction(p_score_id);
end; $$;

create table if not exists public.score_correction_batches (
  id uuid primary key default gen_random_uuid(),
  requested_by uuid not null,              -- auth.uid()
  requested_teacher_id uuid,
  class_id uuid not null,
  academic_year int not null,
  term text not null,
  subject text not null,
  exam_type text not null,
  reason text not null check (btrim(reason) <> ''),
  cell_count int not null,
  status text not null default '待教務審核'
    check (status in ('待教務審核','待A批示','待S批示','已核准','已駁回')),
  handler_by uuid, handler_at timestamptz, handler_decision text, handler_note text,
  a_by uuid, a_at timestamptz, a_decision text, a_note text,
  s_by uuid, s_at timestamptz, s_decision text, s_note text,
  applied_at timestamptz,
  created_at timestamptz not null default now()
);
create table if not exists public.score_correction_items (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.score_correction_batches(id) on delete cascade,
  enrollment_id uuid not null,
  old_score numeric,
  new_score numeric check (new_score is null or (new_score >= 0 and new_score <= 100))
);
create index if not exists scb_status_idx on public.score_correction_batches(status);
create index if not exists sci_batch_idx on public.score_correction_items(batch_id);
alter table public.score_correction_batches enable row level security;
alter table public.score_correction_items enable row level security;
revoke insert, update, delete on public.score_correction_batches, public.score_correction_items from anon, authenticated;
revoke all on public.score_correction_batches, public.score_correction_items from anon;

drop policy if exists scb_select on public.score_correction_batches;
create policy scb_select on public.score_correction_batches for select to authenticated using (
  requested_by = auth.uid() or public.is_system_admin()
  or public.has_department('academic'::public.admin_department)
  or (status in ('待A批示','待S批示','已核准','已駁回') and public.is_stage_a_approver('academic'::public.admin_department)));
drop policy if exists sci_select on public.score_correction_items;
create policy sci_select on public.score_correction_items for select to authenticated using (
  exists (select 1 from public.score_correction_batches b where b.id = batch_id));

create or replace function public.submit_score_correction(p_class_id uuid, p_subject text, p_exam_type text, p_reason text, p_items jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid(); v_tid uuid := current_teacher_id();
  v_year int; v_term text; v_id uuid; it jsonb; v_old numeric; v_new numeric; v_cnt int;
begin
  if v_uid is null then raise exception '請先登入'; end if;
  if p_reason is null or btrim(p_reason) = '' then raise exception '請填寫修正理由'; end if;
  if p_exam_type not in ('期中考','期末考','平時分') then raise exception '考試類型不正確'; end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then raise exception '沒有任何要修正的內容'; end if;

  select c.academic_year into v_year from classes c where c.id = p_class_id;
  select e.term into v_term from enrollments e where e.class_id = p_class_id and e.is_current limit 1;
  if v_year is null or v_term is null then raise exception '找不到這個班級的學年／學期'; end if;
  if not scores_settled(p_class_id, v_year, v_term, p_exam_type) then
    raise exception '這個考試類型尚未結算（鎖定），請直接修改成績即可，不需要申請';
  end if;
  if not (is_system_admin() or has_department('academic'::admin_department)
          or current_role_name() in ('admin_a','admin_b')
          or exists (select 1 from class_schedule cs where cs.class_id = p_class_id and cs.teacher_id = v_tid and cs.subject = p_subject)) then
    raise exception '您不是這班「%」的任課教師，不能申請修正', p_subject;
  end if;

  create temp table if not exists _scc_items(enrollment_id uuid, old_score numeric, new_score numeric) on commit drop;
  truncate _scc_items;
  for it in select * from jsonb_array_elements(p_items) loop
    if not exists (select 1 from enrollments e where e.id = (it->>'enrollment_id')::uuid and e.class_id = p_class_id) then
      raise exception '有學生不在這個班級';
    end if;
    v_new := nullif(it->>'new_score', '')::numeric;
    if v_new is not null and (v_new < 0 or v_new > 100) then raise exception '分數必須在 0～100 之間'; end if;
    select score into v_old from scores
     where enrollment_id = (it->>'enrollment_id')::uuid and subject = p_subject and exam_type = p_exam_type::exam_type;
    if v_old is not distinct from v_new then continue; end if;
    insert into _scc_items values ((it->>'enrollment_id')::uuid, v_old, v_new);
  end loop;
  select count(*) into v_cnt from _scc_items;
  if v_cnt = 0 then raise exception '所有分數都沒有實際變更，不需要申請'; end if;

  insert into score_correction_batches(requested_by, requested_teacher_id, class_id, academic_year, term, subject, exam_type, reason, cell_count)
  values (v_uid, v_tid, p_class_id, v_year, v_term, p_subject, p_exam_type, btrim(p_reason), v_cnt)
  returning id into v_id;
  insert into score_correction_items(batch_id, enrollment_id, old_score, new_score)
  select v_id, enrollment_id, old_score, new_score from _scc_items;
  return v_id;
end; $$;

create or replace function public.review_score_correction(p_batch_id uuid, p_decision text, p_note text default null)
returns void language plpgsql security definer set search_path = public as $$
declare b score_correction_batches; v_uid uuid := auth.uid();
begin
  if p_decision not in ('同意','不同意','送S') then raise exception '決定只能是「同意」「不同意」或「送S」'; end if;
  if p_decision = '不同意' and (p_note is null or btrim(p_note) = '') then raise exception '不同意時請填寫原因'; end if;
  select * into b from score_correction_batches where id = p_batch_id for update;
  if b.id is null then raise exception '找不到這筆申請'; end if;
  if p_decision = '送S' and b.status <> '待A批示' then raise exception '只有管理員A這一關可以選「送S」'; end if;

  if b.status = '待教務審核' then
    if not (has_department('academic'::admin_department) or is_system_admin()) then raise exception '這一關由教務處審核，您沒有權限'; end if;
    if b.requested_by = v_uid and not is_system_admin() then raise exception '不能審核自己送出的申請'; end if;
    update score_correction_batches set handler_by = v_uid, handler_at = now(), handler_decision = p_decision, handler_note = p_note,
      status = case when p_decision = '不同意' then '已駁回' else '待A批示' end
     where id = p_batch_id;
  elsif b.status = '待A批示' then
    if not is_stage_a_approver('academic'::admin_department) then raise exception '這一關由管理員A批示，您沒有權限'; end if;
    if (b.handler_by = v_uid or b.requested_by = v_uid) and not is_system_admin() then raise exception '同一個人不能在同一筆申請上連審兩關'; end if;
    update score_correction_batches set a_by = v_uid, a_at = now(), a_decision = p_decision, a_note = p_note,
      status = case p_decision when '不同意' then '已駁回' when '送S' then '待S批示' else '已核准' end
     where id = p_batch_id;
  elsif b.status = '待S批示' then
    if not is_system_admin() then raise exception '這一關由管理員S批示，您沒有權限'; end if;
    update score_correction_batches set s_by = v_uid, s_at = now(), s_decision = p_decision, s_note = p_note,
      status = case when p_decision = '不同意' then '已駁回' else '已核准' end
     where id = p_batch_id;
  else
    raise exception '這筆申請已處理完成（%）', b.status;
  end if;

  select * into b from score_correction_batches where id = p_batch_id;
  if b.status = '已核准' and b.applied_at is null then
    delete from scores s using score_correction_items i
     where i.batch_id = p_batch_id and i.new_score is null
       and s.enrollment_id = i.enrollment_id and s.subject = b.subject and s.exam_type = b.exam_type::exam_type;
    insert into scores(enrollment_id, exam_type, subject, score, recorded_by, updated_at)
    select i.enrollment_id, b.exam_type::exam_type, b.subject, i.new_score, b.requested_teacher_id, now()
      from score_correction_items i where i.batch_id = p_batch_id and i.new_score is not null
    on conflict (enrollment_id, exam_type, subject)
    do update set score = excluded.score, recorded_by = coalesce(excluded.recorded_by, scores.recorded_by), updated_at = now();
    update score_correction_batches set applied_at = now() where id = p_batch_id;
  end if;
end; $$;
revoke all on function public.submit_score_correction(uuid, text, text, text, jsonb) from public, anon;
revoke all on function public.review_score_correction(uuid, text, text) from public, anon;
grant execute on function public.submit_score_correction(uuid, text, text, text, jsonb) to authenticated;
grant execute on function public.review_score_correction(uuid, text, text) to authenticated;
