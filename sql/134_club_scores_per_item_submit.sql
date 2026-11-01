-- 社團成績：期中考／期末考／平時分「分項」送出與鎖定。
-- 每一項各自有 *_submitted：暫存時只存在 club_scores；該項「正式送出並鎖定」才回寫學期總成績（scores）。
-- is_submitted 改成「任一項已送出」（沿用給 club_submission_status 等舊用途）。

alter table public.club_scores
  add column if not exists midterm_submitted boolean not null default false,
  add column if not exists final_submitted boolean not null default false,
  add column if not exists daily_submitted boolean not null default false;

-- 舊資料：原本整列已送出的，三項都視為已送出（有分數的才算）
update public.club_scores
set midterm_submitted = (score_midterm is not null),
    final_submitted = (score_final is not null),
    daily_submitted = (score_daily is not null)
where is_submitted;

-- 鎖定改由觸發器逐項把關，RLS 不再用整列 is_submitted 擋社團老師
drop policy if exists club_teacher_manage_scores on public.club_scores;
create policy club_teacher_manage_scores on public.club_scores
  using (public.is_club_teacher(club_id))
  with check (public.is_club_teacher(club_id));

create or replace function public.trg_club_scores_guard() returns trigger
language plpgsql
as $$
declare
  v_privileged boolean := coalesce(public.is_system_admin(), false) or coalesce(public.has_department('academic'::public.admin_department), false);
begin
  if tg_op = 'INSERT' then
    -- 舊版匯入（只帶 is_submitted）→ 視為已有分數的三項都送出
    if new.is_submitted and not (new.midterm_submitted or new.final_submitted or new.daily_submitted) then
      new.midterm_submitted := new.score_midterm is not null;
      new.final_submitted := new.score_final is not null;
      new.daily_submitted := new.score_daily is not null;
    end if;
  elsif not v_privileged then
    if old.midterm_submitted and (new.score_midterm is distinct from old.score_midterm or not new.midterm_submitted) then
      raise exception '期中考成績已正式送出並鎖定，如需更正請洽教務處協助解鎖';
    end if;
    if old.final_submitted and (new.score_final is distinct from old.score_final or not new.final_submitted) then
      raise exception '期末考成績已正式送出並鎖定，如需更正請洽教務處協助解鎖';
    end if;
    if old.daily_submitted and (new.score_daily is distinct from old.score_daily or not new.daily_submitted) then
      raise exception '平時分已正式送出並鎖定，如需更正請洽教務處協助解鎖';
    end if;
  end if;
  new.is_submitted := new.midterm_submitted or new.final_submitted or new.daily_submitted;
  return new;
end;
$$;

drop trigger if exists club_scores_guard on public.club_scores;
create trigger club_scores_guard
  before insert or update on public.club_scores
  for each row execute function public.trg_club_scores_guard();

-- 回寫學期總成績：只寫「已送出」的那幾項；同學期有多筆註冊時優先現行註冊
create or replace function public.sync_club_score_to_scores(p_club_id uuid, p_student_no text) returns void
language plpgsql security definer
as $$
declare
  v_club record;
  v_enrollment_id uuid;
  v_score record;
begin
  select * into v_club from clubs where id = p_club_id;
  if v_club is null then
    return;
  end if;

  select * into v_score from club_scores where club_id = p_club_id and student_no = p_student_no;
  if v_score is null then
    return;
  end if;

  select e.id into v_enrollment_id
  from enrollments e
  join classes c on c.id = e.class_id
  where e.student_no = p_student_no
    and e.term = v_club.term
    and c.academic_year = v_club.academic_year
  order by e.is_current desc, e.id desc
  limit 1;

  if v_enrollment_id is null then
    raise notice '學生 % 在 %學年度 %，找不到對應班級學籍，社團成績無法回寫學期總表（請確認學籍資料）', p_student_no, v_club.academic_year, v_club.term;
    return;
  end if;

  if v_score.midterm_submitted and v_score.score_midterm is not null then
    insert into scores (enrollment_id, exam_type, subject, score, recorded_by)
    values (v_enrollment_id, '期中考', '才藝', v_score.score_midterm, v_score.recorded_by)
    on conflict (enrollment_id, exam_type, subject)
    do update set score = excluded.score, recorded_by = excluded.recorded_by, updated_at = now();
  end if;

  if v_score.final_submitted and v_score.score_final is not null then
    insert into scores (enrollment_id, exam_type, subject, score, recorded_by)
    values (v_enrollment_id, '期末考', '才藝', v_score.score_final, v_score.recorded_by)
    on conflict (enrollment_id, exam_type, subject)
    do update set score = excluded.score, recorded_by = excluded.recorded_by, updated_at = now();
  end if;

  if v_score.daily_submitted and v_score.score_daily is not null then
    insert into scores (enrollment_id, exam_type, subject, score, recorded_by)
    values (v_enrollment_id, '平時分', '才藝', v_score.score_daily, v_score.recorded_by)
    on conflict (enrollment_id, exam_type, subject)
    do update set score = excluded.score, recorded_by = excluded.recorded_by, updated_at = now();
  end if;
end;
$$;

create or replace function public.trg_club_scores_sync() returns trigger
language plpgsql security definer
as $$
begin
  if new.midterm_submitted or new.final_submitted or new.daily_submitted then
    perform sync_club_score_to_scores(new.club_id, new.student_no);
  end if;
  return new;
end;
$$;
