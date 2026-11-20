-- ============================================================
-- 161. 出缺勤表權限政策效能（比照 sql/157 處理學生表的作法）
-- ------------------------------------------------------------
-- 原因：attendance 的讀取政策是「每一列都呼叫一次函式」：
--   attendance_read                         → can_read_attendance(學號, 節次)（內含 2 個 EXISTS 子查詢）
--   parent_read_own_attendance              → is_linked_parent(學號)
--   substitute_read_attendance              → 每列一個 EXISTS（再呼叫 is_substitute_today）
--   hide_status_changed_students_attendance → can_view_hidden_students() 與 student_is_hidden(學號)（限制型，每列都要過）
--   以上用 OR／AND 串接，老師看不到的列（絕大多數）要把全部條件都跑完才被排除。
--   實測：導師查「自己班一週」的出缺勤約 0.9～1.3 秒；正式站累計該類查詢平均 3.3 秒、最長 8 秒。
-- 作法：每次查詢只先算出「這位使用者看得到的學號／（學號,節次）名單」一次，再用雜湊比對，不再逐列呼叫函式：
--   my_homeroom_student_nos()        導師班（含歷史選課紀錄）的學生
--   my_taught_student_periods()      任課班級的（學號,節次）——只能看自己上的那幾節
--   substitute_student_periods()     今天代課的（學號,節次）
--   my_linked_student_nos()          家長／學生入口帳號綁定的學號（未停權）
--   hidden_student_nos()             最新學籍異動為休學／轉學／退學／畢業／肄業的學號
-- 看得到哪些列的規則完全沒變。五個函式都是 SECURITY DEFINER，只用「呼叫者自己的身分」算出名單，已收回未登入者的執行權。
--
-- ⚠️ 維護注意：這些函式繞過了選課表等表的權限政策。以後若改了「誰能看到某生出缺勤」的規則（can_read_attendance），
--    需一併修改這裡的函式。can_read_attendance() 等舊函式保留未刪（其他地方可能還在用）。
-- 可重複執行。回復見檔案最後（原本的政策全文）。
-- ============================================================

create or replace function public.my_homeroom_student_nos() returns setof text
language sql stable security definer set search_path = public, pg_temp as $$
  select e.student_no from enrollments e join classes c on c.id = e.class_id
  where c.homeroom_teacher_id = current_teacher_id()
$$;

create or replace function public.my_taught_student_periods() returns table (student_no text, period_no integer)
language sql stable security definer set search_path = public, pg_temp as $$
  select e.student_no, cs.period_no from enrollments e join class_schedule cs on cs.class_id = e.class_id
  where cs.teacher_id = current_teacher_id() and cs.period_no is not null   -- 節次為空的資料列本來就比對不到，排除以免列比較回傳 NULL
$$;

create or replace function public.substitute_student_periods() returns table (student_no text, period_no integer)
language sql stable security definer set search_path = public, pg_temp as $$
  select e.student_no, sa.period_no from enrollments e join substitute_assignments sa on sa.class_id = e.class_id
  where sa.substitute_teacher_id = current_teacher_id()
    and sa.substitute_date = taipei_today()
    and sa.status in ('已排定', '已完成')
    and sa.period_no is not null
$$;

create or replace function public.my_linked_student_nos() returns setof text
language sql stable security definer set search_path = public, pg_temp as $$
  select pa.student_no from portal_accounts pa
  where pa.auth_user_id = auth.uid() and pa.suspended_at is null
$$;

create or replace function public.hidden_student_nos() returns setof text
language sql stable security definer set search_path = public, pg_temp as $$
  select s.student_no from (
    select distinct on (student_no) student_no, status
      from student_status_changes
     order by student_no, effective_date desc, created_at desc
  ) s
  where s.status in ('休學', '轉學', '退學', '畢業', '肄業')
$$;

revoke execute on function public.my_homeroom_student_nos(), public.my_taught_student_periods(), public.substitute_student_periods(),
  public.my_linked_student_nos(), public.hidden_student_nos() from public, anon;
grant execute on function public.my_homeroom_student_nos(), public.my_taught_student_periods(), public.substitute_student_periods(),
  public.my_linked_student_nos(), public.hidden_student_nos() to authenticated, service_role;

-- ===== 以下四條政策的條件改寫（適用對象、指令、寬鬆／限制型都不變）=====
alter policy attendance_read on public.attendance
  using ( (select is_system_admin()) or (select has_department('discipline')) or (select has_department('dev'))
          or student_no in (select public.my_homeroom_student_nos())
          or (student_no, period_no) in (select t.student_no, t.period_no from public.my_taught_student_periods() t) );

alter policy parent_read_own_attendance on public.attendance
  using ( student_no in (select public.my_linked_student_nos()) );

alter policy substitute_read_attendance on public.attendance
  using ( record_date = (select taipei_today())
          and (student_no, period_no) in (select t.student_no, t.period_no from public.substitute_student_periods() t) );

alter policy hide_status_changed_students_attendance on public.attendance
  using ( (select can_view_hidden_students()) or student_no not in (select public.hidden_student_nos()) );

-- ===== 回復（需要時才執行）=====
-- alter policy attendance_read on public.attendance using (can_read_attendance(student_no, period_no));
-- alter policy parent_read_own_attendance on public.attendance using (is_linked_parent(student_no));
-- alter policy substitute_read_attendance on public.attendance
--   using (exists (select 1 from enrollments e where e.student_no = attendance.student_no
--                    and is_substitute_today(e.class_id, attendance.period_no) and attendance.record_date = taipei_today()));
-- alter policy hide_status_changed_students_attendance on public.attendance
--   using (can_view_hidden_students() or (not student_is_hidden(student_no)));
-- drop function if exists public.my_homeroom_student_nos(), public.my_taught_student_periods(), public.substitute_student_periods(),
--   public.my_linked_student_nos(), public.hidden_student_nos();
