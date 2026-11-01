-- 社團老師（不一定是學生的導師或任課老師）要能看到自己社團「在社」學生的姓名與註冊班級／座號，
-- 否則點名冊、成績輸入只剩學號。只開放 SELECT，且只限自己社團的在社學生；
-- 休學／轉學等被隱藏的學生仍由 hide_status_changed_* 限制性政策擋住。
drop policy if exists club_teacher_read_club_students on public.students;
create policy club_teacher_read_club_students on public.students
  for select
  using (
    exists (
      select 1
      from public.club_members m
      where m.student_no = students.student_no
        and m.status = '在社'
        and public.is_club_teacher(m.club_id)
    )
  );

drop policy if exists club_teacher_read_club_enrollments on public.enrollments;
create policy club_teacher_read_club_enrollments on public.enrollments
  for select
  using (
    exists (
      select 1
      from public.club_members m
      where m.student_no = enrollments.student_no
        and m.status = '在社'
        and public.is_club_teacher(m.club_id)
    )
  );
