-- 146：社團名額只算「有現行學籍」的在社學生
-- 休學、退學的學生不佔名額（club_members 的入社紀錄保留，復學後自動恢復計入）。
-- 影響：選社頁顯示的已報名人數、即時搶選（學生自選／導師代填）的額滿判斷。
-- 需在 145 之後執行。回復：把 club_member_counts 與兩支 join 函式改回 145／原始版本即可。

create or replace function public.club_active_count(p_club_id uuid) returns int
language sql stable security definer set search_path = public as $$
  select count(*)::int from club_members m
  where m.club_id = p_club_id and m.status = '在社'
    and exists (select 1 from enrollments e where e.student_no = m.student_no and e.is_current);
$$;

create or replace function public.club_member_counts(p_academic_year int, p_term text)
returns table(club_id uuid, current_count bigint) as $$
  select c.id, count(m.id)
  from clubs c
  left join club_members m on m.club_id = c.id and m.status = '在社'
    and exists (select 1 from enrollments e where e.student_no = m.student_no and e.is_current)
  where c.academic_year = p_academic_year and c.term = p_term
  group by c.id;
$$ language sql stable security definer;

-- 以下兩支函式與 145 相同，只把「目前人數」改用 club_active_count()
create or replace function public.join_club_first_come(p_club_id uuid) returns text
language plpgsql security definer as $$
declare
  v_student_no text;
  v_club record;
  v_window record;
begin
  v_student_no := current_portal_student_no();
  if v_student_no is null then
    return '找不到您的學生資料，請確認是用學生本人帳號登入';
  end if;
  if student_is_elementary(v_student_no) then
    return '國小學生的社團由導師代為報名，請洽班導師';
  end if;

  select * into v_club from clubs where id = p_club_id;
  if v_club is null or not v_club.is_active then
    return '找不到這個社團';
  end if;

  select * into v_window from club_selection_windows
  where academic_year = v_club.academic_year and term = v_club.term;
  if v_window is null or v_window.method <> '即時搶選' then
    return '這學期不是用即時搶選的方式選社';
  end if;
  if now() < v_window.opens_at then
    return '還沒到開放搶選的時間';
  end if;
  if v_window.closes_at is not null and now() > v_window.closes_at then
    return '搶選時間已經結束';
  end if;

  if exists (
    select 1 from club_members m join clubs c on c.id = m.club_id
    where m.student_no = v_student_no and c.academic_year = v_club.academic_year and c.term = v_club.term and m.status = '在社'
  ) then
    return '您這學期已經加入其他社團了';
  end if;

  perform pg_advisory_xact_lock(hashtext(p_club_id::text));

  if v_club.capacity is not null and club_active_count(p_club_id) >= v_club.capacity then
    return '名額已滿，請選別的社團';
  end if;

  insert into club_members (club_id, student_no) values (p_club_id, v_student_no);
  return '報名成功';
end;
$$;

create or replace function public.proxy_join_club_first_come(p_student_no text, p_club_id uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_club record;
  v_window record;
  v_admin boolean := is_system_admin() or has_department('academic');
begin
  select * into v_club from clubs where id = p_club_id;
  if v_club is null or not v_club.is_active then
    return jsonb_build_object('ok', false, 'message', '找不到這個社團');
  end if;
  if not can_proxy_club_selection(p_student_no, v_club.academic_year, v_club.term) then
    return jsonb_build_object('ok', false, 'message', '您沒有權限替這位學生選社（只有該班導師或教務處可以）');
  end if;

  select * into v_window from club_selection_windows where academic_year = v_club.academic_year and term = v_club.term;
  if v_window is null or v_window.method <> '即時搶選' then
    return jsonb_build_object('ok', false, 'message', '這學期不是即時搶選，請改填志願序');
  end if;
  if not v_admin then
    if now() < v_window.opens_at then
      return jsonb_build_object('ok', false, 'message', '還沒到開放搶選的時間');
    end if;
    if v_window.closes_at is not null and now() > v_window.closes_at then
      return jsonb_build_object('ok', false, 'message', '搶選時間已經結束，請洽教務處補登');
    end if;
  end if;

  if exists (
    select 1 from club_members m join clubs c on c.id = m.club_id
    where m.student_no = p_student_no and c.academic_year = v_club.academic_year and c.term = v_club.term and m.status = '在社'
  ) then
    return jsonb_build_object('ok', false, 'message', '這位學生這學期已經加入社團了，要改請先取消');
  end if;

  perform pg_advisory_xact_lock(hashtext(p_club_id::text));

  if v_club.capacity is not null and club_active_count(p_club_id) >= v_club.capacity then
    return jsonb_build_object('ok', false, 'message', '「' || v_club.name || '」名額已滿，請選別的社團');
  end if;

  update club_members set status = '在社', joined_at = now() where club_id = p_club_id and student_no = p_student_no;
  if not found then
    insert into club_members (club_id, student_no) values (p_club_id, p_student_no);
  end if;

  insert into club_proxy_log (academic_year, term, student_no, action, detail, acted_by, acted_via)
  values (v_club.academic_year, v_club.term, p_student_no, '即時搶選報名', v_club.name, auth.uid(),
          case when v_admin then '教務處補登' else '導師代填' end);

  return jsonb_build_object('ok', true, 'message', '報名成功：' || v_club.name);
end;
$$;
