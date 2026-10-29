-- ============================================================
-- 126. 教職員打卡：自動判定放假日（80% 以上的人沒打卡）
-- ------------------------------------------------------------
-- 某天「排了班的在職人員」裡，有打卡的不到 (1 - p_ratio)（預設 80% 以上沒打卡），
-- 就把那天當放假日計算，不會讓全校一起變成缺勤。不寫入 clock_holidays，每次查詢當場計算；
-- 要正式記下來仍可到「班別與放假日」手動加入。
-- * 只判斷「打卡資料已經完整」的日子：早於最新一筆機器打卡的那天（當天晚班可能還沒同步，不判斷）。
-- * 排班人數少於 3 人的日子不判斷（人太少，比例沒意義）。
-- * 只回傳每天的人數統計，不含個人資料；所有教職員都可以呼叫（「我的打卡紀錄」也要用）。
-- 可重複執行。
-- ============================================================

create or replace function public.clock_auto_holidays(p_from date, p_to date, p_ratio numeric default 0.8)
returns table(day date, scheduled int, punched int)
language sql
stable
security definer
set search_path = public
as $$
  with last_day as (
    select max(punch_date) as d from clock_records where not voided and source <> 'manual'
  ),
  days as (
    select g::date as day
    from last_day, generate_series(p_from, least(p_to, last_day.d - 1), interval '1 day') g
    where last_day.d is not null
  ),
  sched as (
    -- 每天「有排班」的在職人員：掛的班別裡有任何一個啟用、且當天星期在上班日內
    select d.day, e.device_code
    from days d
    join clock_employee_map e on e.active
    where exists (
      select 1 from clock_shifts s
      where s.id = any(e.shift_ids) and s.active and extract(isodow from d.day)::int = any(s.work_days)
    )
  ),
  stats as (
    select s.day,
           count(*)::int as scheduled,
           count(*) filter (where exists (
             select 1 from clock_records r where r.device_code = s.device_code and r.punch_date = s.day and not r.voided
           ))::int as punched
    from sched s
    group by s.day
  )
  select day, scheduled, punched
  from stats
  where exists (select 1 from app_users where id = auth.uid())
    and scheduled >= 3
    and punched <= scheduled * (1 - p_ratio)
  order by day;
$$;

grant execute on function public.clock_auto_holidays(date, date, numeric) to authenticated;
