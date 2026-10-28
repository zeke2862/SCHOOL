-- ============================================================
-- 124. 學生姓名結尾的數字（1、2…，用來區分同名）自動去掉（可重複執行）
-- ------------------------------------------------------------
-- 新增／修改學生時，姓名結尾的半形或全形數字一律拿掉；整個姓名只有數字的不處理。
-- 在資料庫端處理，所以手動新增、批次匯入、程式修改都一體適用。
-- ============================================================
create or replace function public.students_strip_name_digits()
returns trigger language plpgsql as $$
begin
  if new.name ~ '[0-9０-９]+$' and regexp_replace(new.name, '[0-9０-９]+$', '') <> '' then
    new.name := btrim(regexp_replace(new.name, '[0-9０-９]+$', ''));
  end if;
  return new;
end;
$$;

drop trigger if exists trg_students_strip_name_digits on public.students;
create trigger trg_students_strip_name_digits before insert or update of name on public.students
  for each row execute function public.students_strip_name_digits();
