-- ============================================================
-- 157. 學生表權限政策效能（老師查整張學生表約 19 秒 → 約 2 秒）
-- ------------------------------------------------------------
-- 原因：students 的讀取政策有 3 條，是「每看一位學生，就去查一次選課表／社團成員表」的相關子查詢；
--       選課表、社團成員表自己也有權限政策（各約 10 個條件、逐列呼叫函式），形成「權限政策裡再跑權限政策」，
--       每位學生約 15 毫秒，1,200 多位學生就是十幾秒。
-- 作法：每次查詢只先算出「這位使用者看得到的學號名單」一次，再用學號比對（資料庫會把它建成雜湊，不再逐列重查）。
--   substitute_student_nos()    今天代課班級的學生        → 取代 substitute_read_students
--   club_teacher_student_nos()  自己帶的社團（或教務／系統管理員）的在社社員 → 取代 club_teacher_read_club_students
--   my_taught_student_nos()     導師班與任課班的學生        → 取代 staff_read_students 裡的兩個 EXISTS
-- 看得到誰的規則完全沒變；已對全部 41 個教職員帳號與 6 個家長帳號，逐一比對套用前後看得到的完整學生名單。
-- 三個函式是 SECURITY DEFINER，只回傳「呼叫者本來就看得到的學號」（用的是呼叫者自己的身分判斷），
-- 已收回未登入者的執行權。
--
-- ⚠️ 維護注意：這三個函式繞過了選課表／社團成員表的權限政策。如果以後改了「誰能看到選課表」的規則，
--    學生表不會自動跟著改，需要一併修改這三個函式。
-- 可重複執行。回復見檔案最後（原本的政策全文都在那裡）。
-- ============================================================

create or replace function public.substitute_student_nos() returns setof text
language sql stable security definer set search_path = public, pg_temp as $$
  select e.student_no from enrollments e
  where exists (select 1 from substitute_assignments sa
                 where sa.class_id = e.class_id
                   and sa.substitute_teacher_id = current_teacher_id()
                   and sa.substitute_date = taipei_today()
                   and sa.status in ('已排定', '已完成'))
$$;

create or replace function public.club_teacher_student_nos() returns setof text
language sql stable security definer set search_path = public, pg_temp as $$
  select m.student_no from club_members m join clubs c on c.id = m.club_id
  where m.status = '在社'
    and (is_system_admin() or has_department('academic') or c.teacher_id = current_teacher_id())
$$;

create or replace function public.my_taught_student_nos() returns setof text
language sql stable security definer set search_path = public, pg_temp as $$
  select e.student_no from enrollments e join classes c on c.id = e.class_id
  where c.homeroom_teacher_id = current_teacher_id()
  union
  select e2.student_no from class_schedule cs join enrollments e2 on e2.class_id = cs.class_id
  where cs.teacher_id = current_teacher_id()
$$;

revoke execute on function public.substitute_student_nos(), public.club_teacher_student_nos(), public.my_taught_student_nos() from public, anon;
grant execute on function public.substitute_student_nos(), public.club_teacher_student_nos(), public.my_taught_student_nos() to authenticated, service_role;

drop policy if exists substitute_read_students on public.students;
create policy substitute_read_students on public.students for select
  using (student_no in (select public.substitute_student_nos()));

drop policy if exists club_teacher_read_club_students on public.students;
create policy club_teacher_read_club_students on public.students for select
  using (student_no in (select public.club_teacher_student_nos()));

drop policy if exists staff_read_students on public.students;
create policy staff_read_students on public.students for select
  using (is_system_admin() or has_department('academic') or has_department('discipline')
         or student_no in (select public.my_taught_student_nos()));

-- ===== 回復（需要時才執行）=====
-- drop policy if exists substitute_read_students on public.students;
-- create policy substitute_read_students on public.students for select
--   using (exists (select 1 from enrollments e where e.student_no = students.student_no and is_substitute_today(e.class_id)));
-- drop policy if exists club_teacher_read_club_students on public.students;
-- create policy club_teacher_read_club_students on public.students for select
--   using (exists (select 1 from club_members m where m.student_no = students.student_no and m.status = '在社' and is_club_teacher(m.club_id)));
-- drop policy if exists staff_read_students on public.students;
-- create policy staff_read_students on public.students for select
--   using (is_system_admin() or has_department('academic') or has_department('discipline')
--     or exists (select 1 from enrollments e join classes c on c.id = e.class_id
--                 where e.student_no = students.student_no and c.homeroom_teacher_id = current_teacher_id())
--     or exists (select 1 from class_schedule cs join enrollments e2 on e2.class_id = cs.class_id
--                 where e2.student_no = students.student_no and cs.teacher_id = current_teacher_id()));
-- drop function if exists public.substitute_student_nos();
-- drop function if exists public.club_teacher_student_nos();
-- drop function if exists public.my_taught_student_nos();
