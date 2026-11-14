-- ============================================================
-- 149. 教務主任自己請假 → 改由校長（系統管理員S）核定
-- ------------------------------------------------------------
--   * 請假人本身是教務處主管（教務主任）時，核定通知（站內＋寄信）改發給「系統管理員S」（校長），
--     而且只有系統管理員S能核准／退回；一般教師的請假仍由教務主任核定。
--   * 任何人都不能核准／退回自己的請假（教務主任若同時是系統管理員S也一樣，須由另一位S處理）。
-- 需在 148 之後執行；可重複執行。
-- ============================================================

-- 請假人是不是教務處主管
create or replace function leave_is_by_academic_lead(p_teacher uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from teachers t join app_user_departments d on d.app_user_id = t.app_user_id
                  where t.id = p_teacher and d.department = 'academic' and d.level = 'lead');
$$;

-- 這筆請假該通知誰核定（排除請假人自己）：教務主任的請假→系統管理員S；其他人→教務處主管（找不到就改給系統管理員S）
create or replace function leave_approver_teacher_ids(p_teacher uuid) returns setof uuid
language plpgsql stable security definer set search_path = public as $$
begin
  if not leave_is_by_academic_lead(p_teacher) then
    return query select t.id from app_user_departments d join teachers t on t.app_user_id = d.app_user_id
                  where d.department = 'academic' and d.level = 'lead' and coalesce(t.active, true) and t.id <> p_teacher;
    if found then return; end if;
  end if;
  return query select t.id from app_users u join teachers t on t.app_user_id = u.id
                where u.role = 'system_admin_s' and coalesce(t.active, true) and t.id <> p_teacher;
end;
$$;

-- 給畫面判斷哪些請假要由校長核定
create or replace function academic_lead_teacher_ids() returns setof uuid
language sql stable security definer set search_path = public as $$
  select t.id from teachers t join app_user_departments d on d.app_user_id = t.app_user_id
   where d.department = 'academic' and d.level = 'lead';
$$;
grant execute on function academic_lead_teacher_ids() to authenticated;

create or replace function guard_leave_approval() returns trigger as $$
begin
  if tg_op = 'UPDATE' and old.status = '待核准' and new.status <> '待核准' then
    if not (new.status = '已取消' and new.approved_by is null) then
      if exists (select 1 from teachers t where t.id = old.original_teacher_id and t.app_user_id = auth.uid()) then
        raise exception '不能核准或退回自己的請假，請由另一位核定人處理';
      end if;
      if leave_is_by_academic_lead(old.original_teacher_id) then
        if not coalesce((select u.role = 'system_admin_s' from app_users u where u.id = auth.uid()), false) then
          raise exception '教務主任的請假須由校長（系統管理員S）核准或退回';
        end if;
      elsif not (is_system_admin() or is_department_lead('academic')) then
        raise exception '只有教務主任（教務處主管）或系統管理員可以核准或退回請假';
      end if;
    end if;
  end if;
  return new;
end;
$$ language plpgsql security definer set search_path = public;

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
      for v_lead in select leave_approver_teacher_ids(new.original_teacher_id)
      loop
        insert into staff_notifications (teacher_id, category, message)
        values (v_lead, '請假待核准',
          coalesce(v_orig, '') || ' 老師申請請假（' || coalesce(new.leave_type, '請假') || '）：' ||
          case when v_dmin = v_dmax then v_dmin::text else v_dmin || '～' || v_dmax end || '，共 ' || v_n || ' 節' ||
          coalesce('，事由：' || new.reason, '') || '。請到「代課安排」頁的「待核准的請假」按同意或退回' ||
          case when leave_is_by_academic_lead(new.original_teacher_id) then '（教務主任的請假由校長／管理員S核定）。' else '。' end);
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
