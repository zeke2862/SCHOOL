-- 教師「停用」標記：留職停薪等暫時不在校的教師，不刪資料與帳號，只是不再出現在空堂／代課選單。
-- 復職時把 active 改回 true 即可。
alter table public.teachers add column if not exists active boolean not null default true;

-- 空堂老師查詢：排除已停用的教師（其餘條件與 sql/110 相同）
create or replace function available_substitute_teachers(
  p_academic_year int, p_term text, p_weekday int, p_period_no int, p_date date
) returns table (teacher_id uuid, teacher_name text)
language sql stable security definer set search_path to 'public'
as $$
  select t.id, t.name
  from teachers t
  where t.active
  and not exists (
    select 1 from class_schedule cs
    where cs.teacher_id = t.id and cs.academic_year = p_academic_year and cs.term = p_term
      and cs.weekday = p_weekday and cs.period_no = p_period_no
  )
  and not exists (
    select 1 from substitute_assignments sa
    where sa.substitute_teacher_id = t.id and sa.substitute_date = p_date
      and sa.period_no = p_period_no and sa.status in ('已排定', '已完成')
  )
  and not exists (
    select 1 from substitute_assignments sa
    where sa.original_teacher_id = t.id and sa.substitute_date = p_date
      and sa.period_no = p_period_no and sa.status <> '已取消'
  )
  and (select current_teacher_id() is not null or is_system_admin() or has_department('academic'))
  order by t.name;
$$;

-- 陳超：留職停薪
update public.teachers set active = false where name = '陳超';
