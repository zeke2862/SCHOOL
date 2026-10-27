-- ============================================================
-- 115. 儲存桶（Storage buckets）與存取政策
-- ------------------------------------------------------------
-- 新的 Supabase 專案裡沒有任何儲存桶，所以：
--   * 備份（手動／每日自動）寫不進 backup-uploads → 一律「備份失敗」
--   * 成績單圖片、網站圖片（site-assets）、學籍佐證文件（student-documents）也都會上傳失敗
-- 這份把三個桶和 sql/04 裡的存取政策補齊。可重複執行。
-- ============================================================
insert into storage.buckets (id, name, public) values
  ('site-assets',       'site-assets',       true),   -- 網站圖片、成績單圖片（公開讀取）
  ('backup-uploads',    'backup-uploads',    false),  -- 備份檔（私有）
  ('student-documents', 'student-documents', false)   -- 學籍佐證文件（私有）
on conflict (id) do nothing;

-- site-assets
drop policy if exists public_read_site_assets on storage.objects;
create policy public_read_site_assets on storage.objects for select using (bucket_id = 'site-assets');
drop policy if exists system_admin_write_site_assets on storage.objects;
create policy system_admin_write_site_assets on storage.objects for insert
  with check (bucket_id = 'site-assets' and current_role_name() = 'system_admin_s');
drop policy if exists system_admin_update_site_assets on storage.objects;
create policy system_admin_update_site_assets on storage.objects for update
  using (bucket_id = 'site-assets' and current_role_name() = 'system_admin_s')
  with check (bucket_id = 'site-assets' and current_role_name() = 'system_admin_s');
drop policy if exists system_admin_delete_site_assets on storage.objects;
create policy system_admin_delete_site_assets on storage.objects for delete
  using (bucket_id = 'site-assets' and current_role_name() = 'system_admin_s');
drop policy if exists admin_write_report_card_images on storage.objects;
create policy admin_write_report_card_images on storage.objects for insert
  with check (bucket_id = 'site-assets' and (storage.foldername(name))[1] = 'report-card'
              and current_role_name() in ('admin_a','admin_b','system_admin_s'));
drop policy if exists admin_update_report_card_images on storage.objects;
create policy admin_update_report_card_images on storage.objects for update
  using (bucket_id = 'site-assets' and (storage.foldername(name))[1] = 'report-card'
         and current_role_name() in ('admin_a','admin_b','system_admin_s'))
  with check (bucket_id = 'site-assets' and (storage.foldername(name))[1] = 'report-card'
              and current_role_name() in ('admin_a','admin_b','system_admin_s'));
drop policy if exists admin_delete_report_card_images on storage.objects;
create policy admin_delete_report_card_images on storage.objects for delete
  using (bucket_id = 'site-assets' and (storage.foldername(name))[1] = 'report-card'
         and current_role_name() in ('admin_a','admin_b','system_admin_s'));

-- backup-uploads（伺服器用服務金鑰寫入，不受這些政策限制；以下是給系統管理員從前端下載／上傳還原檔用）
drop policy if exists system_admin_s_write_backup_uploads on storage.objects;
create policy system_admin_s_write_backup_uploads on storage.objects for insert
  with check (bucket_id = 'backup-uploads' and current_role_name() = 'system_admin_s');
drop policy if exists system_admin_s_read_backup_uploads on storage.objects;
create policy system_admin_s_read_backup_uploads on storage.objects for select
  using (bucket_id = 'backup-uploads' and current_role_name() = 'system_admin_s');
drop policy if exists system_admin_s_delete_backup_uploads on storage.objects;
create policy system_admin_s_delete_backup_uploads on storage.objects for delete
  using (bucket_id = 'backup-uploads' and current_role_name() = 'system_admin_s');

-- student-documents：教務與管理員可以上傳、查看（用簽名網址下載）
drop policy if exists academic_write_student_documents on storage.objects;
create policy academic_write_student_documents on storage.objects for insert
  with check (bucket_id = 'student-documents' and (current_role_name() in ('admin_a','admin_b','system_admin_s') or has_department('academic')));
drop policy if exists academic_read_student_documents on storage.objects;
create policy academic_read_student_documents on storage.objects for select
  using (bucket_id = 'student-documents' and (current_role_name() in ('admin_a','admin_b','system_admin_s') or has_department('academic')));
