-- ============================================================
-- 150. 代課教師當天可點名：讀學生名冊、讀／寫該班該節的出缺席
-- ------------------------------------------------------------
-- 問題：被安排代課的老師，每日點名頁看不到代課的班，資料庫權限也只認「導師」與
-- 「課表上的任課教師」，代課老師即使看得到也無法存檔。
-- 作法：代課安排（substitute_assignments，狀態「已排定」或「已完成」）生效的「那一天」，
--       代課教師視同該班該節的任課教師。只限當天（臺北時間），隔天自動失效。
--       待核准／待安排／已取消的不算。
-- 前端（每日點名頁）另外負責把代課節次加進節次清單，並隱藏原任課教師當天那一節。
-- ============================================================

-- 臺北時間的今天（資料庫預設是 UTC，早上 8 點前會差一天）
create or replace function public.taipei_today() returns date
language sql stable as $$ select (now() at time zone 'Asia/Taipei')::date $$;
grant execute on function public.taipei_today() to authenticated;

-- 我今天是不是這個班（可指定節次）的代課老師
create or replace function public.is_substitute_today(p_class_id uuid, p_period_no integer default null)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from substitute_assignments sa
     where sa.class_id = p_class_id
       and sa.substitute_teacher_id = current_teacher_id()
       and sa.substitute_date = taipei_today()
       and sa.status in ('已排定', '已完成')
       and (p_period_no is null or sa.period_no = p_period_no)
  );
$$;
grant execute on function public.is_substitute_today(uuid, integer) to authenticated;

-- 學生名冊：代課老師當天可讀該班學生（姓名與編班）
drop policy if exists substitute_read_enrollments on public.enrollments;
create policy substitute_read_enrollments on public.enrollments
  for select using (public.is_substitute_today(class_id));

drop policy if exists substitute_read_students on public.students;
create policy substitute_read_students on public.students
  for select using (
    exists (
      select 1 from public.enrollments e
       where e.student_no = students.student_no
         and public.is_substitute_today(e.class_id)
    )
  );

-- 出缺席讀取：代課當天、代課那一節
drop policy if exists substitute_read_attendance on public.attendance;
create policy substitute_read_attendance on public.attendance
  for select using (
    exists (
      select 1 from public.enrollments e
       where e.student_no = attendance.student_no
         and public.is_substitute_today(e.class_id, attendance.period_no)
         and attendance.record_date = public.taipei_today()
    )
  );

-- 出缺席寫入：把「代課老師（當天、該節）」併入 owner 判斷，其餘邏輯同 107
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
  ) or (
    p_record_date = taipei_today()
    and exists (
      select 1 from enrollments e
       where e.student_no = p_student_no and is_substitute_today(e.class_id, p_period_no)
    )
  );
  if not v_is_owner then return false; end if;
  if not attendance_locked(p_student_no, p_record_date) then return true; end if;
  return (p_attendance_id is not null and has_approved_correction(p_attendance_id))
    or exists (select 1 from enrollments e where e.student_no = p_student_no and has_approved_window_open(e.class_id));
end; $$;

notify pgrst, 'reload schema';
