-- ============================================================
-- 130. 打卡特殊時段：新增「開學日（自動）」類型
-- ------------------------------------------------------------
-- 日期自動抓學年學期設定（academic_terms）每個學期的開學日，當天算一天。
-- 預設加一筆：開學當天晚班 19:30 下班（只套用平日晚班，星期六早班不受影響）。可重複執行。
-- ============================================================
alter table public.clock_special_periods drop constraint if exists clock_special_periods_kind_check;
alter table public.clock_special_periods add constraint clock_special_periods_kind_check check (kind in ('fixed', 'exam_week', 'term_start'));
alter table public.clock_special_periods drop constraint if exists clock_special_periods_dates_ok;
alter table public.clock_special_periods add constraint clock_special_periods_dates_ok check (
  kind in ('exam_week', 'term_start') or (date_from is not null and date_to is not null and date_to >= date_from)
);

insert into public.clock_special_periods (name, kind, shift_ids, end_time, active, note)
select '開學日', 'term_start',
       coalesce((select array_agg(id) from public.clock_shifts where work_days && array[1,2,3,4,5]), '{}'),
       '19:30', true, '日期自動抓學年學期的開學日；當天晚班 19:30 下班'
where not exists (select 1 from public.clock_special_periods where kind = 'term_start');
notify pgrst, 'reload schema';
