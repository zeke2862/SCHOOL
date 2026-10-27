-- ============================================================
-- 110. 請假＆代課系統
-- ------------------------------------------------------------
-- 在原本的代課安排（substitute_assignments，一列＝一節課）上加：
--   1. 一般教師自己請假：只能替「自己」的課請假，並且可以順便選一位那一節有空堂的老師代課
--      （也可以先不選，由教務處之後安排 → 狀態「待安排」）。
--   2. 教務處（含承辦人員）臨時接到請假通知，可以直接代為輸入並安排代課人選，
--      不再需要送審（請假是即時的事，等主管核准來不及）。
-- 需在 109 之後執行；可重複執行。
-- ============================================================

-- 1. 欄位：代課教師可以先空著；多記請假類別、同一次請假的群組、是誰輸入的
alter table substitute_assignments alter column substitute_teacher_id drop not null;
alter table substitute_assignments add column if not exists leave_type text;
alter table substitute_assignments add column if not exists leave_group uuid;
alter table substitute_assignments add column if not exists requested_by uuid references app_users(id);
alter table substitute_assignments add column if not exists entered_by_academic boolean not null default false;
alter table substitute_assignments add column if not exists cancelled_at timestamptz;

-- 2. 狀態多一個「待安排」（已請假、還沒指定代課老師）
alter table substitute_assignments drop constraint if exists substitute_assignments_status_check;
alter table substitute_assignments add constraint substitute_assignments_status_check
  check (status in ('待安排', '已排定', '已完成', '已取消'));

-- 3. 「同一班同一天同一節只能有一筆」改成只算沒取消的；取消後才能重新請假
alter table substitute_assignments drop constraint if exists substitute_assignments_class_id_substitute_date_period_no_key;
create unique index if not exists uq_substitute_active_slot
  on substitute_assignments (class_id, substitute_date, period_no) where status <> '已取消';

-- 4. 空堂老師查詢：改成 security definer（一般教師看不到別人的課表，但要能查到「誰那節有空」），
--    並且排除：那節本來有課、已被指派去代別堂、自己那節也請假的老師
create or replace function available_substitute_teachers(
  p_academic_year int, p_term text, p_weekday int, p_period_no int, p_date date
) returns table (teacher_id uuid, teacher_name text)
language sql stable security definer set search_path = public as $$
  select t.id, t.name
  from teachers t
  where not exists (
    select 1 from class_schedule cs
    where cs.teacher_id = t.id and cs.academic_year = p_academic_year and cs.term = p_term
      and cs.weekday = p_weekday and cs.period_no = p_period_no
  )
  and not exists (
    select 1 from substitute_assignments sa
    where sa.substitute_teacher_id = t.id and sa.substitute_date = p_date
      and sa.period_no = p_period_no and sa.status in ('已排定', '已完成')
  )
  and not exists (
    select 1 from substitute_assignments sa
    where sa.original_teacher_id = t.id and sa.substitute_date = p_date
      and sa.period_no = p_period_no and sa.status <> '已取消'
  )
  and (select current_teacher_id() is not null or is_system_admin() or has_department('academic'))
  order by t.name;
$$;
grant execute on function available_substitute_teachers(int, text, int, int, date) to authenticated;

-- 5. 權限
--    教務部門（主管與承辦）：可直接新增／修改，不走送審
drop policy if exists department_lead_write_substitute_assignments on substitute_assignments;
drop policy if exists academic_write_substitute_assignments on substitute_assignments;
create policy academic_write_substitute_assignments on substitute_assignments
  for all
  using (is_system_admin() or has_department('academic'))
  with check (is_system_admin() or has_department('academic'));

--    一般教師：只能替自己的課請假（原任課教師必須是自己，且登記人是自己）
drop policy if exists teacher_insert_own_leave on substitute_assignments;
create policy teacher_insert_own_leave on substitute_assignments
  for insert
  with check (
    original_teacher_id = current_teacher_id()
    and requested_by = auth.uid()
    and entered_by_academic = false
    and status in ('待安排', '已排定')
  );

--    一般教師：只能取消自己還沒發生的請假（今天以後），其他欄位不能亂改
drop policy if exists teacher_cancel_own_leave on substitute_assignments;
create policy teacher_cancel_own_leave on substitute_assignments
  for update
  using (original_teacher_id = current_teacher_id() and status in ('待安排', '已排定') and substitute_date >= current_date)
  with check (original_teacher_id = current_teacher_id() and status = '已取消');

-- 6. 通知：新增時通知原任課教師與代課教師（代課老師可能是空的）；
--    之後教務處補上代課人選時（待安排→已排定）也通知
create or replace function notify_teachers_on_substitute_assignment() returns trigger as $$
declare
  v_class_label text;
  v_text text;
  v_orig text;
  v_sub text;
begin
  if tg_op = 'UPDATE' then
    if not (old.substitute_teacher_id is null and new.substitute_teacher_id is not null and new.status = '已排定') then
      return new;
    end if;
  end if;
  if new.status = '已取消' then return new; end if;

  select coalesce(c.grade_level, '') || coalesce(c.class_name, '') into v_class_label from classes c where c.id = new.class_id;
  select name into v_orig from teachers where id = new.original_teacher_id;
  select name into v_sub from teachers where id = new.substitute_teacher_id;
  v_text := new.substitute_date || ' 第' || new.period_no || '節（' || coalesce(v_class_label, '') || '／' || new.subject || '）';

  if new.substitute_teacher_id is null then
    insert into staff_notifications (teacher_id, category, message)
    values (new.original_teacher_id, '代課通知', v_text || '已登記請假，尚未安排代課教師，教務處會再安排。');
  else
    insert into staff_notifications (teacher_id, category, message)
    values (new.original_teacher_id, '代課通知', v_text || '已安排代課，代課教師：' || coalesce(v_sub, '') || coalesce('，事由：' || new.reason, ''));
    insert into staff_notifications (teacher_id, category, message)
    values (new.substitute_teacher_id, '代課通知', v_text || '已安排由您代課，原任課教師：' || coalesce(v_orig, '') || coalesce('，事由：' || new.reason, ''));
  end if;
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists trg_notify_on_substitute_assignment on substitute_assignments;
create trigger trg_notify_on_substitute_assignment
  after insert or update on substitute_assignments
  for each row execute function notify_teachers_on_substitute_assignment();
