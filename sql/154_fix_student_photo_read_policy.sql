-- ============================================================
-- 154. 修正學生照片儲存桶的讀取政策
-- ------------------------------------------------------------
-- 問題：sql/152 的 staff_read_student_photo_files 在子查詢 (from students s) 裡寫 photo_student_no(name)，
--       這個 name 被解析成 students.name（學生姓名），不是 storage.objects.name（檔名），
--       於是永遠比對不到 → 導師、教務處上傳（upsert 需要先讀）會被擋成「沒有權限」，也取不到簽名網址。
-- 修正：明確寫成 objects.name。可重複執行。
-- ============================================================
drop policy if exists staff_read_student_photo_files on storage.objects;
create policy staff_read_student_photo_files on storage.objects for select
  using (
    bucket_id = 'student-photos' and public.is_staff_user()
    and exists (select 1 from public.students s where s.student_no = public.photo_student_no(objects.name))
  );
