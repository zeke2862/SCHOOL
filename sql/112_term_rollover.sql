-- ============================================================
-- 112. 新學期升級作業（整批、一次完成）
-- ------------------------------------------------------------
-- 原本的升級作業是前端一個學生一個學生查、寫（一千多人要送上萬次請求），所以要等很久，
-- 座號也只是「處理到第幾個就排第幾號」。改成在資料庫裡一次算完、一次寫入：
--   * 同學年 上學期 → 下學期：學生留在同一個班，開新學期的學籍，座號依學號重新排（或沿用原座號）。
--   * 下學期 → 新學年上學期：依年級對照升一年級（沒填「年級升級對照表」就用內建順序：
--     幼乙→幼甲→1年…6年→初一→初二→初三→高一→高二→高三→畢業），班別不變，
--     新學年的班不存在就自動建立，座號依學號重新排；最高年級的學生可選擇標記為畢業。
--   * 併班／擴班：可以「依班級改編」（例如 5年孝＋5年忠 → 6年忠），改編規則用 p_map 傳入。
--   * 已退學／畢業／肄業／轉學的學生不會升級；已經有新學期學籍的學生會略過，重複執行不會重複建立。
-- 需在 109 之後執行；可重複執行。
-- ============================================================

-- 內建的年級順序（年級升級對照表沒填的年級才會用到）
create or replace function public.rollover_default_next(p_dept text, p_grade text)
returns table(next_dept text, next_grade text) language sql stable as $$
  select next_department, next_grade_level from grade_progression where department = p_dept and grade_level = p_grade
  union all
  select d.nd, d.ng from (values
    ('幼兒園','幼乙','幼兒園','幼甲'), ('幼兒園','幼甲','國小','1年'),
    ('國小','1年','國小','2年'), ('國小','2年','國小','3年'), ('國小','3年','國小','4年'),
    ('國小','4年','國小','5年'), ('國小','5年','國小','6年'), ('國小','6年','國中','初一'),
    ('國中','初一','國中','初二'), ('國中','初二','國中','初三'), ('國中','初三','高中','高一'),
    ('高中','高一','高中','高二'), ('高中','高二','高中','高三')
  ) as d(dp, gr, nd, ng)
  where d.dp = p_dept and d.gr = p_grade
    and not exists (select 1 from grade_progression g where g.department = p_dept and g.grade_level = p_grade)
  limit 1;
$$;

-- 舊版函式（沒有改編參數）先移除，避免同名重複
drop function if exists public.rollover_candidates(int, text, int, text, boolean);
drop function if exists public.rollover_preview(int, text, int, text, boolean);
drop function if exists public.run_term_rollover(int, text, int, text, boolean, boolean, boolean);

-- 這次升級作業會處理哪些學生、各自升到哪個班。
-- p_map：班級改編規則，例如 [{"dept":"國小","grade":"5年","class":"孝","to_class":"忠"}]；
--        也可以加 "to_dept"、"to_grade" 指定去別的年級。沒寫到的班照「年級升級對照」走、班別不變。
create or replace function public.rollover_candidates(p_sy int, p_st text, p_ty int, p_tt text, p_promote boolean, p_map jsonb default '[]'::jsonb)
returns table (enroll_id uuid, student_no text, seat_no int, class_id uuid, department text, grade_level text, class_name text,
               homeroom_teacher_id uuid, next_dept text, next_grade text, target_class text, graduating boolean, remapped boolean)
language sql stable security definer set search_path = public as $$
  select e.id, e.student_no, e.seat_no, c.id, c.department, c.grade_level, c.class_name, c.homeroom_teacher_id,
         coalesce(mm.td, case when p_ty = p_sy then c.department when p_promote then n.next_dept else c.department end),
         coalesce(mm.tg, case when p_ty = p_sy then c.grade_level when p_promote then n.next_grade else c.grade_level end),
         coalesce(mm.tc, c.class_name),
         (mm.tg is null and p_ty <> p_sy and p_promote and n.next_grade is null),
         (mm.tc is not null or mm.tg is not null or mm.td is not null)
  from enrollments e
  join classes c on c.id = e.class_id
  left join lateral public.rollover_default_next(c.department, c.grade_level) n on true
  left join lateral (
    select nullif(m->>'to_class', '') tc, nullif(m->>'to_dept', '') td, nullif(m->>'to_grade', '') tg
      from jsonb_array_elements(coalesce(p_map, '[]'::jsonb)) m
     where m->>'dept' = c.department and m->>'grade' = c.grade_level and m->>'class' = c.class_name limit 1) mm on true
  where e.is_current and e.term = p_st and c.academic_year = p_sy
    and coalesce((select s.status::text from student_status_changes s where s.student_no = e.student_no order by s.effective_date desc, s.created_at desc limit 1), '') not in ('退學', '畢業', '肄業', '轉學')
    and not exists (select 1 from enrollments e2 join classes c2 on c2.id = e2.class_id where e2.student_no = e.student_no and e2.term = p_tt and c2.academic_year = p_ty);
$$;

-- 預覽：不寫入，回傳人數、各班去向，給畫面確認用
create or replace function public.rollover_preview(p_sy int, p_st text, p_ty int, p_tt text, p_promote boolean default true, p_map jsonb default '[]'::jsonb)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v jsonb;
begin
  if not (is_system_admin() or is_department_lead('academic')) then raise exception '只有教務主管或系統管理員可以執行升級作業'; end if;
  select jsonb_build_object(
    'students', count(*),
    'graduating', count(*) filter (where graduating),
    'sameYear', (p_sy = p_ty),
    'classes', coalesce((select jsonb_agg(jsonb_build_object('dept', department, 'grade', grade_level, 'class', class_name, 'n', n,
                         'to_dept', next_dept, 'to_grade', next_grade, 'to_class', target_class, 'graduating', graduating, 'remapped', remapped)
                         order by department, grade_level, class_name)
                from (select department, grade_level, class_name, next_dept, next_grade, target_class, graduating, remapped, count(*) n
                        from rollover_candidates(p_sy, p_st, p_ty, p_tt, p_promote, p_map) group by 1,2,3,4,5,6,7,8) q), '[]'::jsonb),
    'newClasses', (select count(*) from (select distinct next_dept, next_grade, target_class from rollover_candidates(p_sy, p_st, p_ty, p_tt, p_promote, p_map) r
                    where not graduating
                      and not exists (select 1 from classes c where c.academic_year = p_ty and c.department = r.next_dept and c.grade_level = r.next_grade and c.class_name = r.target_class)) x)
  ) into v from rollover_candidates(p_sy, p_st, p_ty, p_tt, p_promote, p_map);
  return v;
end $$;

-- 執行升級作業
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
                else row_number() over (partition by tgt_class order by student_no)
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

grant execute on function public.rollover_preview(int, text, int, text, boolean, jsonb) to authenticated;
grant execute on function public.run_term_rollover(int, text, int, text, boolean, boolean, boolean, jsonb) to authenticated;
notify pgrst, 'reload schema';
