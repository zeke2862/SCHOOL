-- 145：國小學生選社由導師代填
--
-- 規則：
--   * 國小（classes.department = '國小'）學生沒有個人帳號，一律由「該班導師」代填；
--     教務處／系統管理員可以替任何學生補登（不限學制、不受開放時間限制，但抽籤完成後仍不能改）。
--   * 國中以上維持原本學生自己登入選社；國小學生即使有 portal 帳號，也被資料庫擋下，不能自己選。
--   * 志願序（兩種抽籤法）與即時搶選兩種方式都支援代填。
--   * 所有代填動作寫進 club_proxy_log，事後查得到「誰、何時、替誰、做了什麼」。
--
-- 需在 133、135 之後執行。回復方式見檔案最後。

-- ---------- 判斷用輔助函式 ----------

-- 學生「現行學籍」是不是國小
create or replace function public.student_is_elementary(p_student_no text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from enrollments e join classes c on c.id = e.class_id
    where e.student_no = p_student_no and e.is_current and c.department = '國小'
  );
$$;

-- 目前登入者是不是該（國小）學生現行班級的導師（讀取名單用）
create or replace function public.is_homeroom_of_student(p_student_no text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from enrollments e join classes c on c.id = e.class_id
    where e.student_no = p_student_no and e.is_current
      and c.department = '國小' and c.homeroom_teacher_id = current_teacher_id()
  );
$$;

-- 目前登入者能不能替這位學生在指定學年學期代填選社
create or replace function public.can_proxy_club_selection(p_student_no text, p_year int, p_term text) returns boolean
language sql stable security definer set search_path = public as $$
  select is_system_admin() or has_department('academic')
    or exists (
      select 1 from enrollments e join classes c on c.id = e.class_id
      where e.student_no = p_student_no and e.term = p_term and c.academic_year = p_year
        and c.department = '國小' and c.homeroom_teacher_id = current_teacher_id()
    );
$$;

-- ---------- 代填紀錄 ----------
create table if not exists public.club_proxy_log (
  id uuid primary key default gen_random_uuid(),
  academic_year int not null,
  term text not null check (term in ('上學期', '下學期')),
  student_no text not null,
  action text not null,            -- 儲存志願序／即時搶選報名／取消即時搶選
  detail text,                     -- 志願序的社團名稱順序、或搶到的社團名稱
  acted_by uuid references public.app_users(id),
  acted_via text not null,         -- 導師代填／教務處補登
  created_at timestamptz not null default now()
);
create index if not exists idx_club_proxy_log_student on public.club_proxy_log (student_no, created_at desc);
alter table public.club_proxy_log enable row level security;
drop policy if exists academic_read_club_proxy_log on public.club_proxy_log;
create policy academic_read_club_proxy_log on public.club_proxy_log for select
  using (is_system_admin() or has_department('academic'));

-- ---------- 讀取權限：導師看得到自己班（國小）學生的志願序與是否已入社 ----------
drop policy if exists homeroom_read_class_preferences on public.club_preferences;
create policy homeroom_read_class_preferences on public.club_preferences for select
  using (is_homeroom_of_student(student_no));

drop policy if exists homeroom_read_class_members on public.club_members;
create policy homeroom_read_class_members on public.club_members for select
  using (is_homeroom_of_student(student_no));

-- ---------- 國小學生不能自己選：志願序（RLS）與即時搶選（函式）都擋 ----------
drop policy if exists portal_manage_own_preferences on public.club_preferences;
create policy portal_manage_own_preferences on public.club_preferences for all
  using (
    student_no = current_portal_student_no()
    and not student_is_elementary(student_no)
    and exists (
      select 1 from club_selection_windows w
      where w.academic_year = club_preferences.academic_year and w.term = club_preferences.term
        and w.method like '志願序_%'
        and now() between w.opens_at and coalesce(w.closes_at, 'infinity'::timestamptz)
        and not w.is_finalized
    )
  )
  with check (
    student_no = current_portal_student_no()
    and not student_is_elementary(student_no)
    and exists (
      select 1 from club_selection_windows w
      where w.academic_year = club_preferences.academic_year and w.term = club_preferences.term
        and w.method like '志願序_%'
        and now() between w.opens_at and coalesce(w.closes_at, 'infinity'::timestamptz)
        and not w.is_finalized
    )
  );

create or replace function public.join_club_first_come(p_club_id uuid) returns text
language plpgsql security definer as $$
declare
  v_student_no text;
  v_club record;
  v_window record;
  v_current_count int;
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

  select count(*) into v_current_count from club_members where club_id = p_club_id and status = '在社';
  if v_club.capacity is not null and v_current_count >= v_club.capacity then
    return '名額已滿，請選別的社團';
  end if;

  insert into club_members (club_id, student_no) values (p_club_id, v_student_no);
  return '報名成功';
end;
$$;

-- ---------- 代填：志願序 ----------
-- p_club_ids 依志願順序排列（第一個＝志願一）；傳空陣列＝清除這位學生的志願。
create or replace function public.proxy_save_club_preferences(p_student_no text, p_year int, p_term text, p_club_ids uuid[])
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_window record;
  v_admin boolean := is_system_admin() or has_department('academic');
  v_max int;
  v_n int := coalesce(array_length(p_club_ids, 1), 0);
  v_names text;
begin
  if not can_proxy_club_selection(p_student_no, p_year, p_term) then
    return jsonb_build_object('ok', false, 'message', '您沒有權限替這位學生選社（只有該班導師或教務處可以）');
  end if;

  select * into v_window from club_selection_windows where academic_year = p_year and term = p_term;
  if v_window is null then
    return jsonb_build_object('ok', false, 'message', '教務處尚未開放這學期的選社作業');
  end if;
  if v_window.method not like '志願序_%' then
    return jsonb_build_object('ok', false, 'message', '這學期是即時搶選，請改用「報名」按鈕');
  end if;
  if v_window.is_finalized then
    return jsonb_build_object('ok', false, 'message', '電腦抽籤已經執行完畢，不能再修改志願，請洽教務處');
  end if;
  if not v_admin then
    if now() < v_window.opens_at then
      return jsonb_build_object('ok', false, 'message', '還沒到開放填寫的時間');
    end if;
    if v_window.closes_at is not null and now() > v_window.closes_at then
      return jsonb_build_object('ok', false, 'message', '填寫時間已經截止，請洽教務處補登');
    end if;
  end if;

  v_max := least(coalesce(v_window.max_choices, 5), 10);
  if v_n > v_max then
    return jsonb_build_object('ok', false, 'message', format('最多只能填 %s 個志願', v_max));
  end if;
  if v_n > 0 and (select count(distinct x) from unnest(p_club_ids) x) <> v_n then
    return jsonb_build_object('ok', false, 'message', '志願清單裡有重複選到同一個社團');
  end if;
  if v_n > 0 and (
    select count(*) from clubs where id = any(p_club_ids) and academic_year = p_year and term = p_term and is_active
  ) <> v_n then
    return jsonb_build_object('ok', false, 'message', '志願裡有已停用或不屬於這學期的社團，請重新整理頁面');
  end if;

  delete from club_preferences where academic_year = p_year and term = p_term and student_no = p_student_no;
  if v_n > 0 then
    insert into club_preferences (academic_year, term, student_no, club_id, choice_rank)
    select p_year, p_term, p_student_no, t.club_id, t.ord::int
    from unnest(p_club_ids) with ordinality as t(club_id, ord);
  end if;

  select string_agg(c.name, ' → ' order by t.ord) into v_names
  from unnest(p_club_ids) with ordinality as t(club_id, ord) join clubs c on c.id = t.club_id;

  insert into club_proxy_log (academic_year, term, student_no, action, detail, acted_by, acted_via)
  values (p_year, p_term, p_student_no, '儲存志願序', coalesce(v_names, '（清空）'), auth.uid(),
          case when v_admin then '教務處補登' else '導師代填' end);

  return jsonb_build_object('ok', true, 'message', case when v_n = 0 then '已清除志願' else '已儲存' end);
end;
$$;

-- ---------- 代填：即時搶選報名 ----------
create or replace function public.proxy_join_club_first_come(p_student_no text, p_club_id uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_club record;
  v_window record;
  v_admin boolean := is_system_admin() or has_department('academic');
  v_count int;
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

  select count(*) into v_count from club_members where club_id = p_club_id and status = '在社';
  if v_club.capacity is not null and v_count >= v_club.capacity then
    return jsonb_build_object('ok', false, 'message', '「' || v_club.name || '」名額已滿，請選別的社團');
  end if;

  -- 以前退過這個社的，恢復為在社（club_members 同學生同社團只能有一列）
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

-- ---------- 代填：取消即時搶選（填錯時更正；開放期間內才能取消，教務處不受時間限制） ----------
create or replace function public.proxy_leave_club_first_come(p_student_no text, p_year int, p_term text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_window record;
  v_admin boolean := is_system_admin() or has_department('academic');
  v_names text;
begin
  if not can_proxy_club_selection(p_student_no, p_year, p_term) then
    return jsonb_build_object('ok', false, 'message', '您沒有權限替這位學生更正選社');
  end if;
  select * into v_window from club_selection_windows where academic_year = p_year and term = p_term;
  if v_window is null or v_window.method <> '即時搶選' then
    return jsonb_build_object('ok', false, 'message', '這學期不是即時搶選');
  end if;
  if not v_admin and (now() < v_window.opens_at or (v_window.closes_at is not null and now() > v_window.closes_at)) then
    return jsonb_build_object('ok', false, 'message', '已超過開放時間，要更正請洽教務處');
  end if;

  select string_agg(c.name, '、') into v_names
  from club_members m join clubs c on c.id = m.club_id
  where m.student_no = p_student_no and c.academic_year = p_year and c.term = p_term and m.status = '在社';
  if v_names is null then
    return jsonb_build_object('ok', false, 'message', '這位學生目前沒有加入任何社團');
  end if;

  delete from club_members m using clubs c
  where m.club_id = c.id and m.student_no = p_student_no and c.academic_year = p_year and c.term = p_term;

  insert into club_proxy_log (academic_year, term, student_no, action, detail, acted_by, acted_via)
  values (p_year, p_term, p_student_no, '取消即時搶選', v_names, auth.uid(),
          case when v_admin then '教務處補登' else '導師代填' end);

  return jsonb_build_object('ok', true, 'message', '已取消');
end;
$$;

grant execute on function public.proxy_save_club_preferences(text, int, text, uuid[]) to authenticated;
grant execute on function public.proxy_join_club_first_come(text, uuid) to authenticated;
grant execute on function public.proxy_leave_club_first_come(text, int, text) to authenticated;

-- ============================================================
-- 回復（需要時手動執行）：
--   drop function if exists public.proxy_save_club_preferences(text, int, text, uuid[]);
--   drop function if exists public.proxy_join_club_first_come(text, uuid);
--   drop function if exists public.proxy_leave_club_first_come(text, int, text);
--   drop policy if exists homeroom_read_class_preferences on public.club_preferences;
--   drop policy if exists homeroom_read_class_members on public.club_members;
--   -- 然後把 portal_manage_own_preferences 與 join_club_first_come 改回 133/原始版本（拿掉 student_is_elementary 判斷）
--   drop table if exists public.club_proxy_log;
--   drop function if exists public.can_proxy_club_selection(text, int, text);
--   drop function if exists public.is_homeroom_of_student(text);
--   drop function if exists public.student_is_elementary(text);
-- ============================================================
