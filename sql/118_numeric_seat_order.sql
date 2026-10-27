-- ============================================================
-- 118. 升級／換學期的座號排序：學號依「數字大小」排，不再當文字排
-- ------------------------------------------------------------
-- 原本 order by student_no 是文字排序，"762" 會排在 "1003"、"2347" 之後（因為 "7" > "1"、"2"），
-- 學號很小的學生就被排到班上最後面。改成純數字學號依數值由小到大，非數字學號再依文字。
-- 只改排序，其餘邏輯與 112 相同。可重複執行。
-- ============================================================
create or replace function public.run_term_rollover(
  p_sy int, p_st text, p_ty int, p_tt text,
  p_promote boolean default true,      -- 跨學年時：true＝升一年級；false＝留在原年級（重讀／不升）
  p_graduate boolean default true,     -- 跨學年且已是最高年級：true＝標記為畢業
  p_keep_seats boolean default false,  -- 同學年且沒有改編時：true＝沿用原座號；false＝依學號重新排
  p_map jsonb default '[]'::jsonb      -- 班級改編規則（併班／擴班／改班名）
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_moved int; v_grad int; v_new int;
begin
  if not (is_system_admin() or is_department_lead('academic')) then raise exception '只有教務主管或系統管理員可以執行升級作業'; end if;
  if not ((p_sy = p_ty and p_st = '上學期' and p_tt = '下學期') or (p_ty = p_sy + 1 and p_st = '下學期' and p_tt = '上學期')) then
    raise exception '只支援「同學年 上學期→下學期」或「下學期→下一學年上學期」';
  end if;

  create temporary table _ro on commit drop as
    select r.*, null::uuid as tgt_class from rollover_candidates(p_sy, p_st, p_ty, p_tt, p_promote, p_map) r;

  -- 目標學年還沒有的班，自動建立（導師先沿用原班導師，之後可在「班級與導師設定」調整）
  with ins as (
    insert into classes (academic_year, department, grade_level, class_name, homeroom_teacher_id)
    select distinct on (next_dept, next_grade, target_class) p_ty, next_dept, next_grade, target_class, homeroom_teacher_id
      from _ro where not graduating
    on conflict (academic_year, department, grade_level, class_name) do nothing
    returning 1)
  select count(*) into v_new from ins;

  update _ro r set tgt_class =
      (select c.id from classes c where c.academic_year = p_ty and c.department = r.next_dept and c.grade_level = r.next_grade and c.class_name = r.target_class)
   where not r.graduating;

  -- 座號：沿用只限「同學年、完全沒有改編」；其他情況依學號重排（接在該班新學期已有的座號後面）
  with numbered as (
    select enroll_id, student_no, tgt_class,
           case when p_keep_seats and p_ty = p_sy and coalesce(jsonb_array_length(p_map), 0) = 0 then seat_no
                else row_number() over (partition by tgt_class order by (case when student_no ~ '^[0-9]+$' then student_no::numeric end), student_no)
                     + coalesce((select max(x.seat_no) from enrollments x where x.class_id = _ro.tgt_class and x.term = p_tt), 0) end as seat
      from _ro where not graduating and tgt_class is not null)
  insert into enrollments (student_no, class_id, term, seat_no, is_current)
  select student_no, tgt_class, p_tt, seat, true from numbered;
  get diagnostics v_moved = row_count;

  update enrollments e set is_current = false
   where e.id in (select enroll_id from _ro where not graduating and tgt_class is not null);

  v_grad := 0;
  if p_graduate then
    insert into student_status_changes (student_no, status, effective_date, reason)
      select student_no, '畢業'::enrollment_status_type, current_date, '升級作業（' || p_sy || p_st || '→' || p_ty || p_tt || '）' from _ro where graduating;
    get diagnostics v_grad = row_count;
    update enrollments e set is_current = false where e.id in (select enroll_id from _ro where graduating);
  end if;

  return jsonb_build_object('moved', v_moved, 'graduated', v_grad, 'newClasses', coalesce(v_new, 0));
end $$;


notify pgrst, 'reload schema';
