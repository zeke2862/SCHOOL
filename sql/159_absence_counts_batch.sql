-- ============================================================
-- 159. 缺課節數批次查詢（點名儲存後「逐位學生各查一次」改成「一次查完」）
-- ------------------------------------------------------------
-- 為什麼：點名儲存後，前端對每位被異動的學生各查一次 student_absence_counts 檢視表
--        （用來判斷是否達到「缺課通知」門檻）。正式站統計：37,520 次呼叫、平均 286 ms，
--        佔資料庫總查詢耗時約 65%，平均每次儲存會多出約 29 次查詢。
--        檢視表是 security_invoker，每查一位學生，就要把他整學期的出缺勤逐列跑一次權限函式。
-- 作法：新增 student_absence_periods(學號陣列)，一次回傳多位學生本學期的缺課節數。
--   * 權限在「每位學生」檢查一次，不再逐列檢查，且規則與 attendance_read 政策相同：
--       - 系統管理員／訓導／開發人員：看得到全部節次
--       - 該生的導師（任一選課紀錄的班級導師）：看得到全部節次
--       - 其他任課教師：只算自己任教的節次（對應 class_schedule 的 teacher_id + period_no）
--   * 同樣遵守 attendance 的限制型政策（競賽訪客、隱藏學生）。
--   * 學期範圍、計入的狀態（事假／病假／曠課）與 student_absence_counts.absence_periods 完全一致。
--   * 檢視表原封不動，其他頁面（全校出缺勤報表）照舊使用。
-- 只有登入者可呼叫（沿用 sql/156 的做法，未登入者不能執行）。可重複執行。
-- 回復：drop function public.student_absence_periods(text[]);  （前端需同時退回舊版）
-- ============================================================

create or replace function public.student_absence_periods(p_student_nos text[])
returns table (student_no text, absence_periods bigint)
language sql stable security definer set search_path = public, pg_temp as $$
  with cur as (
    select coalesce(t.term_start_date, make_date(t.academic_year,
             case when t.term = '下學期' then 10 else 5 end,
             case when t.term = '下學期' then 20 else 1 end)) as d_start,
           t.term_end_date as d_end
      from academic_terms t where t.is_current limit 1
  ),
  me as (
    select (select current_teacher_id()) as tid,
           ((select is_system_admin()) or (select has_department('discipline')) or (select has_department('dev'))) as full_access
  ),
  req as (
    -- attendance 表另有兩條「限制型」政策：競賽訪客帳號什麼都看不到、休學／轉學等隱藏學生只有特定身分看得到；這裡一併遵守
    select distinct x as sn from unnest(p_student_nos) x
     where x is not null
       and not (select comp_is_guest())
       and ((select can_view_hidden_students()) or not student_is_hidden(x))
  ),
  full_ok as (
    select r.sn from req r, me
     where me.full_access
        or exists (select 1 from enrollments e join classes c on c.id = e.class_id
                    where e.student_no = r.sn and c.homeroom_teacher_id = me.tid)
  ),
  rows_ as (
    select a.student_no as sn, a.status
      from attendance a
     where a.student_no in (select sn from req)
       and ( not exists (select 1 from cur)
             or ( a.record_date >= (select d_start from cur)
                  and ((select d_end from cur) is null or a.record_date <= (select d_end from cur)) ) )
       and ( a.student_no in (select sn from full_ok)
             or exists (select 1 from enrollments e join class_schedule cs on cs.class_id = e.class_id
                         where e.student_no = a.student_no
                           and cs.teacher_id = (select tid from me)
                           and cs.period_no = a.period_no) )
  )
  select r.sn, count(w.sn) filter (where w.status in ('事假', '病假', '曠課'))::bigint
    from req r left join rows_ w on w.sn = r.sn
   group by r.sn;
$$;

revoke all on function public.student_absence_periods(text[]) from public, anon;
grant execute on function public.student_absence_periods(text[]) to authenticated;
