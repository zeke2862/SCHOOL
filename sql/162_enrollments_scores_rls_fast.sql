-- ============================================================
-- 162. 選課表與成績表權限政策效能（接續 sql/157、161，同一作法）
-- ------------------------------------------------------------
-- 原因：enrollments 有 6 條讀取政策、scores 有 5 條讀取政策，都是「每一列呼叫一次函式／跑一次 EXISTS」，
--       老師看不到的列要把全部條件跑完才被排除。實測：導師載入「全部在籍選課」約 6.6 秒（正式站累計平均 2.6 秒、最長 7.4 秒），
--       成績相關查詢平均 1 秒以上。
-- 作法：每次查詢先算出「這位使用者看得到的名單」一次，再用雜湊比對。新增的函式（皆 SECURITY DEFINER，只用呼叫者自己的身分判斷，
--       已收回未登入者執行權）：
--   選課表：my_homeroom_class_ids()、my_teaching_class_terms()、my_current_taught_student_nos()、
--           my_current_homeroom_student_nos()、substitute_class_ids()
--           （社團用 sql/157 的 club_teacher_student_nos()；家長與隱藏學生用 sql/161 的 my_linked_student_nos()、hidden_student_nos()）
--   成績表：my_homeroom_enrollment_ids()、my_teaching_enrollment_subjects()、my_history_homeroom_enrollment_ids()、
--           my_history_teaching_enrollment_subjects()、my_linked_enrollment_ids()、hidden_enrollment_ids()
-- 看得到哪些列的規則完全沒變（已逐一比對套用前後的結果，見提交說明）。寫入政策（admin_write_*、scores_insert／update／delete）完全沒動。
--
-- ⚠️ 維護注意：這些函式繞過了其他表的權限政策。以後若改了「誰能看到選課／成績」的規則，需一併修改這裡的函式。
-- 可重複執行。回復見檔案最後（原本的政策全文）。
-- ============================================================

-- ===== 選課表用 =====
create or replace function public.my_homeroom_class_ids() returns setof uuid
language sql stable security definer set search_path = public, pg_temp as $$
  select c.id from classes c where c.homeroom_teacher_id = current_teacher_id()
$$;

create or replace function public.my_teaching_class_terms() returns table (class_id uuid, term text)
language sql stable security definer set search_path = public, pg_temp as $$
  select cs.class_id, cs.term from class_schedule cs
  where cs.teacher_id = current_teacher_id() and cs.term is not null
$$;

create or replace function public.my_current_taught_student_nos() returns setof text
language sql stable security definer set search_path = public, pg_temp as $$
  select cur.student_no from enrollments cur join class_schedule cs on cs.class_id = cur.class_id
  where cur.is_current = true and cs.teacher_id = current_teacher_id()
$$;

create or replace function public.my_current_homeroom_student_nos() returns setof text
language sql stable security definer set search_path = public, pg_temp as $$
  select cur.student_no from enrollments cur join classes c on c.id = cur.class_id
  where cur.is_current = true and c.homeroom_teacher_id = current_teacher_id()
$$;

create or replace function public.substitute_class_ids() returns setof uuid
language sql stable security definer set search_path = public, pg_temp as $$
  select sa.class_id from substitute_assignments sa
  where sa.substitute_teacher_id = current_teacher_id()
    and sa.substitute_date = taipei_today()
    and sa.status in ('已排定', '已完成')
$$;

-- ===== 成績表用 =====
create or replace function public.my_homeroom_enrollment_ids() returns setof uuid
language sql stable security definer set search_path = public, pg_temp as $$
  select e.id from enrollments e join classes c on c.id = e.class_id
  where c.homeroom_teacher_id = current_teacher_id()
$$;

create or replace function public.my_teaching_enrollment_subjects() returns table (enrollment_id uuid, subject text)
language sql stable security definer set search_path = public, pg_temp as $$
  select e.id, cs.subject from enrollments e join class_schedule cs on cs.class_id = e.class_id
  where cs.teacher_id = current_teacher_id() and cs.subject is not null
$$;

create or replace function public.my_history_homeroom_enrollment_ids() returns setof uuid
language sql stable security definer set search_path = public, pg_temp as $$
  select e.id from enrollments e
  where e.student_no in (select cur.student_no from enrollments cur join classes c on c.id = cur.class_id
                          where cur.is_current = true and c.homeroom_teacher_id = current_teacher_id())
$$;

create or replace function public.my_history_teaching_enrollment_subjects() returns table (enrollment_id uuid, subject text)
language sql stable security definer set search_path = public, pg_temp as $$
  select e.id, cs.subject from enrollments e
  join enrollments cur on cur.student_no = e.student_no and cur.is_current = true
  join class_schedule cs on cs.class_id = cur.class_id
  where cs.teacher_id = current_teacher_id() and cs.subject is not null
$$;

create or replace function public.my_linked_enrollment_ids() returns setof uuid
language sql stable security definer set search_path = public, pg_temp as $$
  select e.id from enrollments e
  where e.student_no in (select pa.student_no from portal_accounts pa where pa.auth_user_id = auth.uid() and pa.suspended_at is null)
$$;

create or replace function public.hidden_enrollment_ids() returns setof uuid
language sql stable security definer set search_path = public, pg_temp as $$
  select e.id from enrollments e where e.student_no in (select public.hidden_student_nos())
$$;

revoke execute on function
  public.my_homeroom_class_ids(), public.my_teaching_class_terms(), public.my_current_taught_student_nos(),
  public.my_current_homeroom_student_nos(), public.substitute_class_ids(),
  public.my_homeroom_enrollment_ids(), public.my_teaching_enrollment_subjects(), public.my_history_homeroom_enrollment_ids(),
  public.my_history_teaching_enrollment_subjects(), public.my_linked_enrollment_ids(), public.hidden_enrollment_ids()
  from public, anon;
grant execute on function
  public.my_homeroom_class_ids(), public.my_teaching_class_terms(), public.my_current_taught_student_nos(),
  public.my_current_homeroom_student_nos(), public.substitute_class_ids(),
  public.my_homeroom_enrollment_ids(), public.my_teaching_enrollment_subjects(), public.my_history_homeroom_enrollment_ids(),
  public.my_history_teaching_enrollment_subjects(), public.my_linked_enrollment_ids(), public.hidden_enrollment_ids()
  to authenticated, service_role;

-- ===== 選課表政策（適用對象、指令、寬鬆／限制型都不變，只改條件）=====
alter policy staff_read_enrollments on public.enrollments
  using ( (select is_system_admin()) or (select has_department('academic')) or (select has_department('discipline'))
          or class_id in (select public.my_homeroom_class_ids())
          or (class_id, term) in (select t.class_id, t.term from public.my_teaching_class_terms() t) );

alter policy teacher_read_history_enrollments on public.enrollments
  using ( student_no in (select public.my_current_taught_student_nos()) );

alter policy homeroom_read_history_enrollments on public.enrollments
  using ( student_no in (select public.my_current_homeroom_student_nos()) );

alter policy club_teacher_read_club_enrollments on public.enrollments
  using ( student_no in (select public.club_teacher_student_nos()) );

alter policy substitute_read_enrollments on public.enrollments
  using ( class_id in (select public.substitute_class_ids()) );

alter policy parent_read_own_enrollments on public.enrollments
  using ( student_no in (select public.my_linked_student_nos()) );

alter policy hide_status_changed_students_enrollments on public.enrollments
  using ( (select can_view_hidden_students()) or student_no not in (select public.hidden_student_nos()) )
  with check ( (select can_view_hidden_students()) or student_no not in (select public.hidden_student_nos()) );

-- ===== 成績表政策 =====
alter policy scores_select on public.scores
  using ( (select is_system_admin()) or (select has_department('academic'))
          or enrollment_id in (select public.my_homeroom_enrollment_ids())
          or (enrollment_id, subject) in (select t.enrollment_id, t.subject from public.my_teaching_enrollment_subjects() t) );

alter policy homeroom_read_history_scores on public.scores
  using ( enrollment_id in (select public.my_history_homeroom_enrollment_ids()) );

alter policy teacher_read_same_subject_history_scores on public.scores
  using ( (enrollment_id, subject) in (select t.enrollment_id, t.subject from public.my_history_teaching_enrollment_subjects() t) );

alter policy parent_read_own_scores on public.scores
  using ( enrollment_id in (select public.my_linked_enrollment_ids()) );

alter policy hide_status_changed_students_scores on public.scores
  using ( (select can_view_hidden_students()) or enrollment_id not in (select public.hidden_enrollment_ids()) )
  with check ( (select can_view_hidden_students()) or enrollment_id not in (select public.hidden_enrollment_ids()) );

-- ===== 回復（需要時才執行）=====
-- alter policy staff_read_enrollments on public.enrollments using (
--   (select is_system_admin()) or (select has_department('academic'::admin_department)) or (select has_department('discipline'::admin_department))
--   or exists (select 1 from classes c where c.id = enrollments.class_id and c.homeroom_teacher_id = (select current_teacher_id()))
--   or exists (select 1 from class_schedule cs where cs.class_id = enrollments.class_id and cs.term = enrollments.term and cs.teacher_id = (select current_teacher_id())));
-- alter policy teacher_read_history_enrollments on public.enrollments using (teaches_student_subject_now(student_no, null::text));
-- alter policy homeroom_read_history_enrollments on public.enrollments using (homeroom_of_student_now(student_no));
-- alter policy club_teacher_read_club_enrollments on public.enrollments using (exists (select 1 from club_members m
--   where m.student_no = enrollments.student_no and m.status = '在社' and is_club_teacher(m.club_id)));
-- alter policy substitute_read_enrollments on public.enrollments using (is_substitute_today(class_id));
-- alter policy parent_read_own_enrollments on public.enrollments using (is_linked_parent(student_no));
-- alter policy hide_status_changed_students_enrollments on public.enrollments
--   using (can_view_hidden_students() or (not student_is_hidden(student_no)))
--   with check (can_view_hidden_students() or (not student_is_hidden(student_no)));
-- alter policy scores_select on public.scores using (is_system_admin() or has_department('academic')
--   or exists (select 1 from enrollments e join class_schedule cs on cs.class_id = e.class_id
--               where e.id = scores.enrollment_id and cs.teacher_id = current_teacher_id() and cs.subject = scores.subject)
--   or exists (select 1 from enrollments e join classes c on c.id = e.class_id
--               where e.id = scores.enrollment_id and c.homeroom_teacher_id = current_teacher_id()));
-- alter policy homeroom_read_history_scores on public.scores using (exists (select 1 from enrollments e
--   where e.id = scores.enrollment_id and homeroom_of_student_now(e.student_no)));
-- alter policy teacher_read_same_subject_history_scores on public.scores using (exists (select 1 from enrollments e
--   where e.id = scores.enrollment_id and teaches_student_subject_now(e.student_no, scores.subject)));
-- alter policy parent_read_own_scores on public.scores using (exists (select 1 from enrollments e
--   where e.id = scores.enrollment_id and is_linked_parent(e.student_no)));
-- alter policy hide_status_changed_students_scores on public.scores
--   using (can_view_hidden_students() or (not student_is_hidden((select e.student_no from enrollments e where e.id = scores.enrollment_id))))
--   with check (can_view_hidden_students() or (not student_is_hidden((select e.student_no from enrollments e where e.id = scores.enrollment_id))));
-- drop function if exists public.my_homeroom_class_ids(), public.my_teaching_class_terms(), public.my_current_taught_student_nos(),
--   public.my_current_homeroom_student_nos(), public.substitute_class_ids(), public.my_homeroom_enrollment_ids(),
--   public.my_teaching_enrollment_subjects(), public.my_history_homeroom_enrollment_ids(),
--   public.my_history_teaching_enrollment_subjects(), public.my_linked_enrollment_ids(), public.hidden_enrollment_ids();
