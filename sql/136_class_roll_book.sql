-- 班級點名冊：本校教職員（有教職員帳號）都能取得「任一班」的在學名單（只含座號、學號、姓名、性別），
-- 用來列印點名冊。學生的其他個資（身分證、住址、電話…）不開放，休學／轉學／退學的學生不會出現。
create or replace function public.class_roll_book(p_class_id uuid, p_term text)
returns table(seat_no integer, student_no text, name text, gender text)
language sql
stable
security definer
set search_path = public
as $$
  select e.seat_no, s.student_no, s.name, s.gender
  from enrollments e
  join students s on s.student_no = e.student_no
  where e.class_id = p_class_id
    and e.term = p_term
    and e.is_current
    and not student_is_hidden(e.student_no)
    and exists (select 1 from app_users u where u.id = auth.uid())
  order by e.seat_no;
$$;

revoke all on function public.class_roll_book(uuid, text) from public;
grant execute on function public.class_roll_book(uuid, text) to authenticated;
