-- 一個學生同一學年學期只能在一個社團（狀態「在社」）。
-- 要轉社：先把舊社團該學生設為「退社」，再加入或恢復新社團。
create or replace function public.trg_club_members_one_per_term() returns trigger
language plpgsql
as $$
declare
  v_year int;
  v_term text;
  v_other text;
begin
  if new.status <> '在社' then
    return new;
  end if;

  select academic_year, term into v_year, v_term from clubs where id = new.club_id;

  select c.name into v_other
  from club_members m
  join clubs c on c.id = m.club_id
  where m.student_no = new.student_no
    and m.status = '在社'
    and m.club_id <> new.club_id
    and m.id is distinct from new.id
    and c.academic_year = v_year
    and c.term = v_term
  limit 1;

  if v_other is not null then
    raise exception '學生 % 本學期已在「%」社團，一人只能參加一個社團，請先把他在該社團設為退社', new.student_no, v_other;
  end if;
  return new;
end;
$$;

drop trigger if exists club_members_one_per_term on public.club_members;
create trigger club_members_one_per_term
  before insert or update of status, club_id on public.club_members
  for each row execute function public.trg_club_members_one_per_term();
