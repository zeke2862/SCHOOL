-- ============================================================
-- 127. 教職員打卡：特殊時段（某段日期改用不同的上下班時間）＋考試週
-- ------------------------------------------------------------
-- 例如開學前後、考試週全校都在，但下班時間提早到 19:00。
-- 特殊時段只「改時間」，不改上班日：落在期間內、而且當天本來就有排班的人，
-- 把班別的上班／下班時間換成這裡設定的（空白＝維持原班別的時間）。
-- shift_ids 空的＝套用到所有班別；有勾就只改那些班別（避免週六早班也被改成 19:00 下班）。
--
-- kind：
--   fixed      ＝固定日期（date_from～date_to）
--   exam_week  ＝考試週：日期不用填，自動抓「成績收件時段」全校層級的期中考／期末考開放日（opens_at）
--                當第一天，往後算一週（7 天）。收件時段沒填開放日就不會產生考試週。
-- 可重複執行。
-- ============================================================

create table if not exists public.clock_special_periods (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  kind text not null default 'fixed' check (kind in ('fixed', 'exam_week')),
  date_from date,
  date_to date,
  shift_ids uuid[] not null default '{}',
  start_time time,
  end_time time,
  active boolean not null default true,
  note text,
  created_at timestamptz not null default now(),
  constraint clock_special_periods_dates_ok check (
    kind = 'exam_week' or (date_from is not null and date_to is not null and date_to >= date_from)
  )
);

alter table public.clock_special_periods enable row level security;

-- 與班別相同：所有已登入教職員可讀（自己的頁面要用來推算），只有管理權限者可寫
drop policy if exists clock_special_periods_read on public.clock_special_periods;
create policy clock_special_periods_read on public.clock_special_periods for select to authenticated using (true);
drop policy if exists clock_special_periods_write on public.clock_special_periods;
create policy clock_special_periods_write on public.clock_special_periods for all to authenticated
  using ((select can_manage_staff_clock())) with check ((select can_manage_staff_clock()));

-- 考試週第一天：成績收件時段（全校層級）的期中考／期末考開放日（泰國日期）。
-- security definer：一般教職員讀不到 submission_windows，但「我的打卡紀錄」也要用考試週推算。
create or replace function public.clock_exam_weeks()
returns table(academic_year int, term text, exam text, first_day date)
language sql
stable
security definer
set search_path = public
as $$
  select w.academic_year, w.term, w.data_type, min((w.opens_at at time zone 'Asia/Bangkok')::date)
  from submission_windows w
  where w.scope = '全校' and w.data_type in ('期中考', '期末考') and w.opens_at is not null
    and exists (select 1 from app_users where id = auth.uid())
  group by w.academic_year, w.term, w.data_type
  order by 4;
$$;

grant execute on function public.clock_exam_weeks() to authenticated;

-- 範例（先停用，請到「班別與放假日 › 特殊時段」改好日期、班別後再勾啟用）
insert into public.clock_special_periods (name, kind, date_from, date_to, end_time, active, note)
select '縮短上班（範例）', 'fixed', date '2026-11-02', date '2026-11-06', time '19:00', false, '範例：全校都在，下班提早到 19:00。請改日期、勾選適用班別後啟用。'
where not exists (select 1 from public.clock_special_periods);

insert into public.clock_special_periods (name, kind, end_time, active, note)
select '考試週', 'exam_week', time '19:00', false, '日期自動抓成績收件時段（全校）的期中考／期末考開放日，算一週。請確認時間後啟用。'
where not exists (select 1 from public.clock_special_periods where kind = 'exam_week');
