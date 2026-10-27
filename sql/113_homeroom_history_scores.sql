-- ============================================================
-- 113. 導師可以看「目前班上學生」過去所有學期（含上一個年級）的成績
-- ------------------------------------------------------------
-- 原本的規則（sql/109）：
--   * 任課教師：可以看「自己現在教的學生」在「同一科目」的歷年成績（不論是誰打的）。
--   * 導師：只能看「這個學籍所屬班級的導師是自己」的成績。學生升到新學年、換了新班之後，
--     舊學年的學籍屬於舊班，新導師就看不到學生去年的成績。
-- 新增：導師對「目前在自己班上的學生」，可以看這位學生所有學期的學籍與成績
-- （各科期中考、期末考、平時分；總分／排名由畫面依成績算出）與操行成績，方便提醒哪些學生要特別用功才能升級。
-- 只放寬「讀取」，不影響新增／修改成績的權限。可重複執行。
-- ============================================================

create or replace function public.homeroom_of_student_now(p_student_no text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from enrollments cur
    join classes c on c.id = cur.class_id
    where cur.student_no = p_student_no and cur.is_current = true
      and c.homeroom_teacher_id = public.current_teacher_id());
$$;

drop policy if exists homeroom_read_history_enrollments on public.enrollments;
create policy homeroom_read_history_enrollments on public.enrollments for select to authenticated
  using (public.homeroom_of_student_now(student_no));

drop policy if exists homeroom_read_history_scores on public.scores;
create policy homeroom_read_history_scores on public.scores for select to authenticated
  using (exists (select 1 from enrollments e where e.id = scores.enrollment_id
                 and public.homeroom_of_student_now(e.student_no)));

drop policy if exists homeroom_read_history_conduct_scores on public.conduct_scores;
create policy homeroom_read_history_conduct_scores on public.conduct_scores for select to authenticated
  using (exists (select 1 from enrollments e where e.id = conduct_scores.enrollment_id
                 and public.homeroom_of_student_now(e.student_no)));

notify pgrst, 'reload schema';
