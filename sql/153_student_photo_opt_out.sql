-- ============================================================
-- 153. 學生照片：「此生不放照片」標記
-- ------------------------------------------------------------
-- 家長不同意使用肖像的學生，導師或教務處可以標記「不放照片」：
--   * student_photos 多一欄 opt_out；opt_out = true 的學生沒有照片檔，也不能再上傳
--   * 標記時畫面會先把既有的照片檔刪掉；這裡再由資料庫擋一次，避免有人繞過畫面上傳
--   * 取消標記＝把那一筆刪掉，之後就能正常上傳
-- 離校（畢業、轉出）學生的照片不會自動清除，會一直保留。
-- 可重複執行。需先執行 sql/152。
-- ============================================================

alter table public.student_photos add column if not exists opt_out boolean not null default false;

-- 這位學生可不可以放照片（沒有被標記「不放照片」）
create or replace function public.student_photo_allowed(p_student_no text) returns boolean
language sql stable security definer set search_path = public as $$
  select not exists (select 1 from student_photos p where p.student_no = p_student_no and p.opt_out);
$$;
grant execute on function public.student_photo_allowed(text) to authenticated;

drop policy if exists writer_insert_student_photo_files on storage.objects;
create policy writer_insert_student_photo_files on storage.objects for insert
  with check (
    bucket_id = 'student-photos'
    and public.can_write_student_photo(public.photo_student_no(name))
    and public.student_photo_allowed(public.photo_student_no(name))
  );
drop policy if exists writer_update_student_photo_files on storage.objects;
create policy writer_update_student_photo_files on storage.objects for update
  using (bucket_id = 'student-photos' and public.can_write_student_photo(public.photo_student_no(name)))
  with check (
    bucket_id = 'student-photos'
    and public.can_write_student_photo(public.photo_student_no(name))
    and public.student_photo_allowed(public.photo_student_no(name))
  );
