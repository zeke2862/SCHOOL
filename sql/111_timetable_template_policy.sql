-- ============================================================
-- 111. 列印課表「模板」讓教務處也能修改
-- ------------------------------------------------------------
-- 列印課表的標題、備註、上課時間存在 site_settings（setting_key = 'timetable_template'）。
-- site_settings 原本只有系統管理員S能寫；這裡只開放「教務部門成員」寫這一筆（其他設定仍維持原規則）。
-- 可重複執行。
-- ============================================================
drop policy if exists academic_insert_timetable_template on public.site_settings;
create policy academic_insert_timetable_template on public.site_settings
  for insert with check (setting_key = 'timetable_template' and public.has_department('academic'));

drop policy if exists academic_update_timetable_template on public.site_settings;
create policy academic_update_timetable_template on public.site_settings
  for update using (setting_key = 'timetable_template' and public.has_department('academic'))
  with check (setting_key = 'timetable_template' and public.has_department('academic'));
