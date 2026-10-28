-- ============================================================
-- 122. 升級／換學期的座號排序：新增「先男女、再學號」選項（請在 118 之後執行；可重複執行）
-- ------------------------------------------------------------
-- run_term_rollover 加一個參數 p_seat_order：
--   'student_no'（預設，與 118 相同）＝依學號由小到大；
--   'gender'＝先男生、再女生（性別空白或其他的排最後），同性別內再依學號。
-- 舊的 8 個參數版本先刪掉，避免 RPC 同名多載分不清楚。其餘邏輯與 118 相同。
-- ============================================================
drop function if exists public.run_term_rollover(int, text, int, text, boolean, boolean, boolean, jsonb);

-- 排座號用的性別順序：男 0、女 1、其他／空白 2（「女生」這種寫法也當女生）
create or replace function public.seat_gender_rank(p_gender text)
returns int language sql immutable as $$
  select case when btrim(coalesce(p_gender, '')) like '男%' then 0
              when btrim(coalesce(p_gender, '')) like '女%' then 1 else 2 end;
$$;

create or replace function public.run_term_rollover(
  p_sy int, p_st text, p_ty int, p_tt text,
  p_promote boolean default true,      -- 跨學年時：true＝升一年級；false＝留在原年級（重讀／不升）
  p_graduate boolean default true,     -- 跨學年且已是最高年級：true＝標記為畢業
  p_keep_seats boolean default false,  -- 同學年且沒有改編時：true＝沿用原座號；false＝依學號重新排
  p_map jsonb default '[]'::jsonb,     -- 班級改編規則（併班／擴班／改班名）
  p_seat_order text default 'student_no' -- 重排座號的順序：'student_no'＝依學號；'gender'＝先男女、再學號
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

  -- 座號：沿用只限「同學年、完全沒有改編」；其他情況依學號（或先男女再學號）重排（接在該班新學期已有的座號後面）
  with numbered as (
    select enroll_id, student_no, tgt_class,
           case when p_keep_seats and p_ty = p_sy and coalesce(jsonb_array_length(p_map), 0) = 0 then seat_no
                else row_number() over (partition by tgt_class order by
                       (case when p_seat_order = 'gender' then (select seat_gender_rank(s.gender) from students s where s.student_no = _ro.student_no) else 0 end),
                       (case when student_no ~ '^[0-9]+$' then student_no::numeric end), student_no)
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


grant execute on function public.run_term_rollover(int, text, int, text, boolean, boolean, boolean, jsonb, text) to authenticated;

notify pgrst, 'reload schema';
