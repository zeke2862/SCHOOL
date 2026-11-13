-- ============================================================
-- 148. 教師自己請假：改為「教務主任核准」後才生效
-- ------------------------------------------------------------
-- 規則：
--   * 教師自己送出的請假，狀態一律是「待核准」；系統發站內通知給教務處所有「主管(lead)」，
--     並由 120 的機制同步寄信（信裡不放內容，請登入查看）。
--   * 教務主任（或系統管理員S）核准 → 有選代課老師的節次變「已排定」、沒選的變「待安排」；
--     這時才通知代課教師與請假教師（並提醒雙方先做課程交接）。
--     退回 → 變「已取消」並通知請假教師（附退回原因）。
--   * 教務處（含承辦人員）代為輸入的請假（entered_by_academic = true）維持「立即生效」，不走核准。
--   * 待核准的節次，教師本人仍可自己取消。
--   * 只有教務主管／系統管理員S能把「待核准」改成核准或退回（資料庫端擋，承辦人員直接改資料表也不行）。
-- 需在 147 之後執行；可重複執行。
-- ============================================================

-- 1. 狀態與核准紀錄欄位
alter table substitute_assignments drop constraint if exists substitute_assignments_status_check;
alter table substitute_assignments add constraint substitute_assignments_status_check
  check (status in ('待核准', '待安排', '已排定', '已完成', '已取消'));
alter table substitute_assignments add column if not exists approved_by uuid references app_users(id);
alter table substitute_assignments add column if not exists approved_at timestamptz;
alter table substitute_assignments add column if not exists approval_note text;

-- 2. 權限：教師自己請假只能送「待核准」；本人可取消還沒發生的（含待核准）
drop policy if exists teacher_insert_own_leave on substitute_assignments;
create policy teacher_insert_own_leave on substitute_assignments
  for insert
  with check (
    original_teacher_id = current_teacher_id()
    and requested_by = auth.uid()
    and entered_by_academic = false
    and status = '待核准'
  );

drop policy if exists teacher_cancel_own_leave on substitute_assignments;
create policy teacher_cancel_own_leave on substitute_assignments
  for update
  using (original_teacher_id = current_teacher_id() and status in ('待核准', '待安排', '已排定') and substitute_date >= current_date)
  with check (original_teacher_id = current_teacher_id() and status = '已取消' and approved_by is null);

-- 3. 只有教務主管／系統管理員S能核准或退回
create or replace function guard_leave_approval() returns trigger as $$
begin
  if tg_op = 'UPDATE' and old.status = '待核准' and new.status <> '待核准' then
    -- 本人取消（沒有核准者）放行；其他轉換一律要教務主管或系統管理員S
    if not (new.status = '已取消' and new.approved_by is null) then
      if not (is_system_admin() or is_department_lead('academic')) then
        raise exception '只有教務主任（教務處主管）或系統管理員可以核准或退回請假';
      end if;
    end if;
  end if;
  return new;
end;
$$ language plpgsql security definer set search_path = public;

drop trigger if exists trg_guard_leave_approval on substitute_assignments;
create trigger trg_guard_leave_approval
  before update on substitute_assignments
  for each row execute function guard_leave_approval();

-- 4. 核准／退回：一次處理同一次請假（leave_group）或指定的幾筆
create or replace function decide_leave(p_ids uuid[], p_approve boolean, p_note text default null)
returns int language plpgsql security definer set search_path = public as $$
declare v_n int;
begin
  if not (is_system_admin() or is_department_lead('academic')) then
    raise exception '只有教務主任（教務處主管）或系統管理員可以核准或退回請假';
  end if;
  if not p_approve and coalesce(btrim(p_note), '') = '' then
    raise exception '退回請假請填寫原因';
  end if;
  update substitute_assignments
     set status = case when not p_approve then '已取消'
                       when substitute_teacher_id is null then '待安排' else '已排定' end,
         approved_by = auth.uid(), approved_at = now(), approval_note = nullif(btrim(p_note), ''),
         cancelled_at = case when p_approve then cancelled_at else now() end
   where id = any(p_ids) and status = '待核准';
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;
grant execute on function decide_leave(uuid[], boolean, text) to authenticated;

-- 5. 空堂老師查詢：「待核准」的代課人選也先算有課，避免同一節被兩人選走
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
      and sa.period_no = p_period_no and sa.status in ('待核准', '已排定', '已完成')
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

-- 6. 通知
create or replace function notify_teachers_on_substitute_assignment() returns trigger as $$
declare
  v_class_label text;
  v_text text;
  v_orig text;
  v_sub text;
  v_first boolean;
  v_n int;
  v_dmin date;
  v_dmax date;
  v_lead uuid;
begin
  select name into v_orig from teachers where id = new.original_teacher_id;

  -- (a) 教師自己送出、等教務主任核准：只通知教務主管（同一次請假只發一則）
  if tg_op = 'INSERT' and new.status = '待核准' then
    if new.leave_group is null then
      v_first := true;
    else
      v_first := new.id = (select s.id from substitute_assignments s where s.leave_group = new.leave_group order by s.id limit 1);
    end if;
    if v_first then
      select count(*), min(substitute_date), max(substitute_date) into v_n, v_dmin, v_dmax
        from substitute_assignments s where (new.leave_group is not null and s.leave_group = new.leave_group) or s.id = new.id;
      for v_lead in
        select t.id from app_user_departments d join teachers t on t.app_user_id = d.app_user_id
         where d.department = 'academic' and d.level = 'lead' and coalesce(t.active, true)
      loop
        insert into staff_notifications (teacher_id, category, message)
        values (v_lead, '請假待核准',
          coalesce(v_orig, '') || ' 老師申請請假（' || coalesce(new.leave_type, '請假') || '）：' ||
          case when v_dmin = v_dmax then v_dmin::text else v_dmin || '～' || v_dmax end || '，共 ' || v_n || ' 節' ||
          coalesce('，事由：' || new.reason, '') || '。請到「代課安排」頁的「待核准的請假」按同意或退回。');
      end loop;
    end if;
    return new;
  end if;

  select coalesce(c.grade_level, '') || coalesce(c.class_name, '') into v_class_label from classes c where c.id = new.class_id;
  select name into v_sub from teachers where id = new.substitute_teacher_id;
  v_text := new.substitute_date || ' 第' || new.period_no || '節（' || coalesce(v_class_label, '') || '／' || new.subject || '）';

  if tg_op = 'UPDATE' then
    -- (b) 教務主任退回
    if old.status = '待核准' and new.status = '已取消' and new.approved_by is not null then
      insert into staff_notifications (teacher_id, category, message)
      values (new.original_teacher_id, '請假結果', v_text || '的請假未獲核准' || coalesce('，原因：' || new.approval_note, '') || '。如仍需請假請洽教務處。');
      return new;
    end if;
    -- (c) 教務主任核准：這時才通知請假教師與代課教師，並提醒先做課程交接
    if old.status = '待核准' and new.status in ('已排定', '待安排') then
      if new.substitute_teacher_id is null then
        insert into staff_notifications (teacher_id, category, message)
        values (new.original_teacher_id, '請假結果', v_text || '的請假已核准，尚未安排代課教師，教務處會再安排。');
      else
        insert into staff_notifications (teacher_id, category, message)
        values (new.original_teacher_id, '請假結果', v_text || '的請假已核准，代課教師：' || coalesce(v_sub, '') || '。請務必先與代課教師溝通，完成課程進度與教材的交接。');
        insert into staff_notifications (teacher_id, category, message)
        values (new.substitute_teacher_id, '代課通知', v_text || '已安排由您代課，原任課教師：' || coalesce(v_orig, '') || coalesce('，事由：' || new.reason, '') || '。請與原任課教師確認課程進度與教材的交接。');
      end if;
      return new;
    end if;
    -- (d) 教務處補上代課人選（待安排→已排定）
    if not (old.substitute_teacher_id is null and new.substitute_teacher_id is not null and new.status = '已排定') then
      return new;
    end if;
  end if;
  if new.status = '已取消' then return new; end if;

  -- (e) 教務處代為輸入／補排：立即通知
  if new.substitute_teacher_id is null then
    insert into staff_notifications (teacher_id, category, message)
    values (new.original_teacher_id, '代課通知', v_text || '已登記請假，尚未安排代課教師，教務處會再安排。');
  else
    insert into staff_notifications (teacher_id, category, message)
    values (new.original_teacher_id, '代課通知', v_text || '已安排代課，代課教師：' || coalesce(v_sub, '') || coalesce('，事由：' || new.reason, '') || '。請先與代課教師溝通，完成課程交接。');
    insert into staff_notifications (teacher_id, category, message)
    values (new.substitute_teacher_id, '代課通知', v_text || '已安排由您代課，原任課教師：' || coalesce(v_orig, '') || coalesce('，事由：' || new.reason, '') || '。請與原任課教師確認課程交接。');
  end if;
  return new;
end;
$$ language plpgsql security definer set search_path = public;

notify pgrst, 'reload schema';
