-- =====================================================================
-- 華雲學校管理系統  全新安裝用 SQL  (4/4)  預設資料與儲存桶
-- =====================================================================
-- 內容：系統預設設定列、獎懲預設分數、受治理資料表清單、打卡班別、
--       Storage 儲存桶與其存取政策。
-- 需在 01~03 執行完之後才執行。
-- 注意：本檔不含任何學生／教師資料，也不含第一位系統管理員帳號
--       （請依 README「建立第一位系統管理員」步驟手動建立）。
-- =====================================================================

-- ---------- 系統設定（各一列） ----------
insert into public.attendance_alert_settings (id, threshold_periods, exam_deduction_absence_threshold, backfill_overdue_days)
  values (1, 3, NULL, 7);
insert into public.attendance_score_display_settings (id, exclude_attendance_from_partial_scores)
  values (true, false);
insert into public.homeroom_attendance_assist_settings (id, allow_present_to_leave)
  values (true, false);
insert into public.password_policy_settings (id, force_change_on_first_login)
  values (true, false);
insert into public.portal_login_settings (id, email_verification_enabled)
  values (true, true);
insert into public.teacher_login_settings (id, home_path)
  values (true, '/admin');
insert into public.teacher_letter_settings (id, school_name_zh, principal_name, chairman_name, phone, address)
  values (1, '泰國清萊雲南會館附屬華雲學校', '董嬌玫', '顏協清', '053734209', '618 M6 Mae Sai Chiang Rai Thai 57130');

-- ---------- 獎懲預設加扣分（僅供參考，不影響總成績計算） ----------
insert into public.conduct_point_defaults (item, points) values
  ('曠課', -3.33), ('遲到', -0.67), ('事假', -1.67), ('病假', 0.00), ('公假', 0.00),
  ('嘉獎', 1.00), ('警告', -1.00), ('小功', 3.00), ('小過', -3.00), ('大功', 9.00), ('大過', -9.00);

-- ---------- 受「待審核變更」機制管轄的資料表 ----------
insert into public.governed_tables (table_name, primary_key_column, department, description) values
  ('curriculum',                     'id',                   'academic',   '科目與比重設定'),
  ('class_schedule',                 'id',                   'academic',   '課表/任課教師設定'),
  ('period_config',                  'id',                   'academic',   '節次設定'),
  ('grade_progression',              'department,grade_level','academic',  '年級升級對照表'),
  ('grading_rules',                  'academic_year,term',   'academic',   '成績計分比重設定'),
  ('attendance_alert_settings',      'id',                   'discipline', '出缺席示警門檻設定'),
  ('conduct_point_defaults',         'item',                 'discipline', '獎懲加扣分參考值'),
  ('substitute_assignments',         'id',                   'academic',   '代課安排登記'),
  ('locked_periods',                 'id',                   'academic',   '共同科目時間鎖定'),
  ('general_inventory_items',        'id',                   'general',    '書庫/校服/簿本 品項主檔'),
  ('general_inventory_transactions', 'id',                   'general',    '書庫/校服/簿本 進出紀錄'),
  ('maintenance_tickets',            'id',                   'general',    '修繕登記'),
  ('utility_bills',                  'id',                   'general',    '水電網路等費用');

-- ---------- 打卡班別 ----------
insert into public.clock_shifts (name, start_time, end_time, late_grace_min, early_grace_min, work_days, window_before_min, window_after_min, active, sort_order) values
  ('平日晚班', '17:00', '20:30', 10, 10, '{1,2,3,4,5}', 180, 240, true, 1),
  ('週六早班', '07:30', '12:00', 10, 10, '{6}',         180, 240, true, 2);

-- ---------- Storage 儲存桶 ----------
insert into storage.buckets (id, name, public) values
  ('site-assets',    'site-assets',    true),   -- 網站圖片、成績單圖片（公開讀取）
  ('backup-uploads', 'backup-uploads', false);  -- 大型備份還原檔（私有）
-- 另外 README 提到的 student-documents（學籍佐證）桶請在後台手動建立（私有）。

-- ---------- Storage 存取政策 ----------
create policy public_read_site_assets on storage.objects for select
  using (bucket_id = 'site-assets');
create policy system_admin_write_site_assets on storage.objects for insert
  with check (bucket_id = 'site-assets' and current_role_name() = 'system_admin_s');
create policy system_admin_update_site_assets on storage.objects for update
  using (bucket_id = 'site-assets' and current_role_name() = 'system_admin_s')
  with check (bucket_id = 'site-assets' and current_role_name() = 'system_admin_s');
create policy system_admin_delete_site_assets on storage.objects for delete
  using (bucket_id = 'site-assets' and current_role_name() = 'system_admin_s');

create policy admin_write_report_card_images on storage.objects for insert
  with check (bucket_id = 'site-assets' and (storage.foldername(name))[1] = 'report-card'
              and current_role_name() in ('admin_a','admin_b','system_admin_s'));
create policy admin_update_report_card_images on storage.objects for update
  using (bucket_id = 'site-assets' and (storage.foldername(name))[1] = 'report-card'
         and current_role_name() in ('admin_a','admin_b','system_admin_s'))
  with check (bucket_id = 'site-assets' and (storage.foldername(name))[1] = 'report-card'
              and current_role_name() in ('admin_a','admin_b','system_admin_s'));
create policy admin_delete_report_card_images on storage.objects for delete
  using (bucket_id = 'site-assets' and (storage.foldername(name))[1] = 'report-card'
         and current_role_name() in ('admin_a','admin_b','system_admin_s'));

create policy system_admin_s_write_backup_uploads on storage.objects for insert
  with check (bucket_id = 'backup-uploads' and current_role_name() = 'system_admin_s');
create policy system_admin_s_read_backup_uploads on storage.objects for select
  using (bucket_id = 'backup-uploads' and current_role_name() = 'system_admin_s');
create policy system_admin_s_delete_backup_uploads on storage.objects for delete
  using (bucket_id = 'backup-uploads' and current_role_name() = 'system_admin_s');
