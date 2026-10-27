-- ============================================================
-- 114. 新學期設為「目前生效」時，上一個學期自動變成「已結束」
-- ------------------------------------------------------------
-- 原本 set_current_academic_term 只會把舊的取消「目前生效」，狀態還是「進行中」，
-- 結果上學期看起來還在進行。現在改成：
--   * 被設為目前生效的學期 → 狀態「進行中」
--   * 比它早的學期（學年度較小，或同學年的上學期對下學期）→ 狀態「已結束」
--   * 比它晚的學期維持原狀（例如還沒開始的下一學年，狀態保持「規劃中」）
-- 另外把目前資料做一次修正：比目前生效學期早的學期，一律改成已結束。可重複執行。
-- ============================================================
create or replace function public.set_current_academic_term(p_academic_year int, p_term text) returns void
language plpgsql security definer
as $$
declare
  v_rank int := p_academic_year * 2 + (case when p_term = '下學期' then 1 else 0 end);
begin
  if not (is_system_admin() or has_department('dev')) then
    raise exception '只有開發人員可以切換目前生效學年學期';
  end if;
  update academic_terms set is_current = false where is_current = true;
  update academic_terms set is_current = true, status = '進行中'
    where academic_year = p_academic_year and term = p_term;
  if not found then
    raise exception '找不到學年度 % % ，請先新增這個學年學期', p_academic_year, p_term;
  end if;
  update academic_terms
     set status = '已結束'
   where academic_year * 2 + (case when term = '下學期' then 1 else 0 end) < v_rank
     and status <> '已結束';
end;
$$;

-- 現況修正：比目前生效學期早的，改成已結束
update academic_terms t
   set status = '已結束'
  from academic_terms cur
 where cur.is_current
   and t.academic_year * 2 + (case when t.term = '下學期' then 1 else 0 end) < cur.academic_year * 2 + (case when cur.term = '下學期' then 1 else 0 end)
   and t.status <> '已結束';

-- ============================================================
-- 出缺勤累計（示警、全校出缺勤總覽用的 student_absence_counts）改成「只算目前生效學期」
-- ------------------------------------------------------------
-- 原本是把學生所有出缺勤紀錄加總（含上個學期），新學期一開始就會帶著上學期的曠課、請假節數，
-- 示警門檻、全校出缺勤總覽都會誤判。現在只算目前生效學期的起訖日之間（沒填起日用預設開學日：
-- 上學期 5/1、下學期 10/20；沒填迄日不設上限）；完全沒有設定目前學期時才退回全部累計。
-- ============================================================
create or replace view public.student_absence_counts with (security_invoker = true) as
with cur as (
  select coalesce(t.term_start_date, make_date(t.academic_year, case when t.term = '下學期' then 10 else 5 end, case when t.term = '下學期' then 20 else 1 end)) as d_start,
         t.term_end_date as d_end
    from academic_terms t where t.is_current limit 1
)
select a.student_no,
       count(*) filter (where a.status = any (array['事假'::attendance_status, '病假'::attendance_status, '曠課'::attendance_status])) as absence_periods,
       count(*) filter (where a.status = '事假'::attendance_status) as personal_leave_periods,
       count(*) filter (where a.status = '病假'::attendance_status) as sick_leave_periods,
       count(*) filter (where a.status = '曠課'::attendance_status) as truancy_periods,
       count(*) filter (where a.status = '遲到'::attendance_status) as late_periods,
       count(*) filter (where a.status = '公假'::attendance_status) as excused_periods,
       count(*) filter (where a.status = '出席'::attendance_status) as present_periods
  from attendance a
 where not exists (select 1 from cur)
    or (a.record_date >= (select d_start from cur) and (select d_end from cur) is null)
    or (a.record_date >= (select d_start from cur) and a.record_date <= (select d_end from cur))
 group by a.student_no;
