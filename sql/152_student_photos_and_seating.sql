-- ============================================================
-- 152. 學生照片＋班級座位表
-- ------------------------------------------------------------
-- 學生照片：
--   * 放在私有儲存桶 student-photos（不公開；登入的教職員拿「有時效的簽名網址」才看得到）
--   * 檔名固定是「學號.jpg」，上傳前瀏覽器已縮成大頭照（約 20～40KB），桶子另外限制單檔 200KB、只收 JPEG
--   * 誰看得到：看得到這位學生學籍資料的教職員（導師、任課、訓導、教務…，沿用 students 的權限）
--     家長／學生帳號、賽事訪客一律看不到
--   * 誰能上傳／更換／刪除：該生目前班級的導師、教務處、管理員A、系統管理員S
--   * student_photos 只記「誰有照片、什麼時候換的」，畫面不用去翻儲存桶
-- 班級座位表：
--   * 一班一張（class_seat_charts），存幾排幾列與每個位子坐誰
--   * 教職員都能看；該班導師、教務處、管理員可以排
-- 可重複執行。還沒執行前，畫面上的照片與座位表功能會顯示「尚未啟用」，其他功能不受影響。
-- ============================================================

-- ---------- 共用判斷 ----------
-- 是不是教職員（app_users 裡有帳號、而且不是賽事訪客）；家長／學生帳號不在 app_users 裡
create or replace function public.is_staff_user() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from app_users where id = auth.uid() and role::text <> 'competition_guest');
$$;
grant execute on function public.is_staff_user() to authenticated;

-- 能不能上傳／更換／刪除這位學生的照片
create or replace function public.can_write_student_photo(p_student_no text) returns boolean
language sql stable security definer set search_path = public as $$
  select current_role_name()::text in ('system_admin_s', 'admin_a')
      or has_department('academic')
      or exists (
        select 1 from enrollments e join classes c on c.id = e.class_id
         where e.student_no = p_student_no and e.is_current and c.homeroom_teacher_id = current_teacher_id()
      );
$$;
grant execute on function public.can_write_student_photo(text) to authenticated;

-- 儲存桶裡的檔名（學號.jpg）→ 學號
create or replace function public.photo_student_no(p_name text) returns text
language sql immutable as $$ select regexp_replace(p_name, '\.jpg$', '') $$;
grant execute on function public.photo_student_no(text) to authenticated;

-- ---------- 誰有照片 ----------
create table if not exists public.student_photos (
  student_no text primary key references public.students(student_no) on update cascade on delete cascade,
  updated_at timestamptz not null default now(),
  updated_by uuid default auth.uid()
);
alter table public.student_photos enable row level security;

drop policy if exists staff_read_student_photos on public.student_photos;
create policy staff_read_student_photos on public.student_photos for select
  using (public.is_staff_user() and exists (select 1 from public.students s where s.student_no = student_photos.student_no));

drop policy if exists writer_insert_student_photos on public.student_photos;
create policy writer_insert_student_photos on public.student_photos for insert
  with check (public.can_write_student_photo(student_no));
drop policy if exists writer_update_student_photos on public.student_photos;
create policy writer_update_student_photos on public.student_photos for update
  using (public.can_write_student_photo(student_no)) with check (public.can_write_student_photo(student_no));
drop policy if exists writer_delete_student_photos on public.student_photos;
create policy writer_delete_student_photos on public.student_photos for delete
  using (public.can_write_student_photo(student_no));

grant select, insert, update, delete on public.student_photos to authenticated;

-- ---------- 私有儲存桶 ----------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('student-photos', 'student-photos', false, 204800, array['image/jpeg'])
on conflict (id) do update set public = false, file_size_limit = 204800, allowed_mime_types = array['image/jpeg'];

drop policy if exists staff_read_student_photo_files on storage.objects;
create policy staff_read_student_photo_files on storage.objects for select
  using (
    bucket_id = 'student-photos' and public.is_staff_user()
    and exists (select 1 from public.students s where s.student_no = public.photo_student_no(name))
  );
drop policy if exists writer_insert_student_photo_files on storage.objects;
create policy writer_insert_student_photo_files on storage.objects for insert
  with check (bucket_id = 'student-photos' and public.can_write_student_photo(public.photo_student_no(name)));
drop policy if exists writer_update_student_photo_files on storage.objects;
create policy writer_update_student_photo_files on storage.objects for update
  using (bucket_id = 'student-photos' and public.can_write_student_photo(public.photo_student_no(name)))
  with check (bucket_id = 'student-photos' and public.can_write_student_photo(public.photo_student_no(name)));
drop policy if exists writer_delete_student_photo_files on storage.objects;
create policy writer_delete_student_photo_files on storage.objects for delete
  using (bucket_id = 'student-photos' and public.can_write_student_photo(public.photo_student_no(name)));

-- ---------- 班級座位表 ----------
-- seats：{"排-列": "學號"}，例如 {"0-0": "1130001", "0-1": "1130002"}；排 0 是最靠近講台的那一排
create table if not exists public.class_seat_charts (
  class_id uuid primary key references public.classes(id) on delete cascade,
  seat_rows integer not null default 7 check (seat_rows between 1 and 12),
  seat_cols integer not null default 6 check (seat_cols between 1 and 12),
  seats jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  updated_by uuid default auth.uid()
);
alter table public.class_seat_charts enable row level security;

create or replace function public.can_write_seat_chart(p_class_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select current_role_name()::text in ('system_admin_s', 'admin_a')
      or has_department('academic')
      or exists (select 1 from classes c where c.id = p_class_id and c.homeroom_teacher_id = current_teacher_id());
$$;
grant execute on function public.can_write_seat_chart(uuid) to authenticated;

drop policy if exists staff_read_seat_charts on public.class_seat_charts;
create policy staff_read_seat_charts on public.class_seat_charts for select using (public.is_staff_user());
drop policy if exists writer_insert_seat_charts on public.class_seat_charts;
create policy writer_insert_seat_charts on public.class_seat_charts for insert with check (public.can_write_seat_chart(class_id));
drop policy if exists writer_update_seat_charts on public.class_seat_charts;
create policy writer_update_seat_charts on public.class_seat_charts for update
  using (public.can_write_seat_chart(class_id)) with check (public.can_write_seat_chart(class_id));
drop policy if exists writer_delete_seat_charts on public.class_seat_charts;
create policy writer_delete_seat_charts on public.class_seat_charts for delete using (public.can_write_seat_chart(class_id));

grant select, insert, update, delete on public.class_seat_charts to authenticated;
