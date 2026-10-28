-- ============================================================
-- 123. 依學號自動判定性別（可重複執行）
-- ------------------------------------------------------------
-- 6 碼學號第 3 碼 1＝男、2＝女。新增／修改學生時，若性別空白就自動補上；
-- 並把現有性別空白的 6 碼學號學生補齊。已有性別的不覆蓋；3～4 碼舊學號無法判定，維持原樣。
-- ============================================================
create or replace function public.gender_from_student_no(p_no text)
returns text language sql immutable as $$
  select case when btrim(coalesce(p_no, '')) ~ '^\d{6}$'
              then case substr(btrim(p_no), 3, 1) when '1' then '男' when '2' then '女' else null end
         else null end;
$$;

create or replace function public.students_fill_gender()
returns trigger language plpgsql as $$
begin
  if btrim(coalesce(new.gender, '')) = '' then
    new.gender := public.gender_from_student_no(new.student_no);
  end if;
  return new;
end;
$$;

drop trigger if exists trg_students_fill_gender on public.students;
create trigger trg_students_fill_gender before insert or update of student_no, gender on public.students
  for each row execute function public.students_fill_gender();

update public.students set gender = public.gender_from_student_no(student_no)
 where btrim(coalesce(gender, '')) = '' and public.gender_from_student_no(student_no) is not null;
