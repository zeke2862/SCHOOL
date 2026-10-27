-- =====================================================================
-- 華雲學校管理系統  全新安裝用 SQL  (1/4)  資料表／函式／View
-- =====================================================================
-- 內容：列舉型別、79 張資料表、79 支函式、12 個 View。
--
-- 這 4 份檔案是把舊的 sql/1 ~ sql/104 共 104 份遷移檔，在一個空資料庫依序
-- 執行完畢後匯出的「最終狀態」，只適用於【全新、空的】Supabase 專案。
-- 既有資料庫不需要、也不要再執行（舊的 104 份已經套用過了）。
--
-- 執行順序（Supabase 後台 SQL Editor，逐份貼上執行）：
--   01_schema.sql → 02_constraints_indexes.sql → 03_triggers_rls_policies.sql → 04_seed_and_storage.sql
-- =====================================================================

set check_function_bodies = false;

--
-- Name: admin_department; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.admin_department AS ENUM (
    'dev',
    'academic',
    'discipline',
    'general'
);

--
-- Name: attendance_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.attendance_status AS ENUM (
    '出席',
    '曠課',
    '遲到',
    '病假',
    '事假',
    '公假'
);

--
-- Name: department_level; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.department_level AS ENUM (
    'lead',
    'staff'
);

--
-- Name: enrollment_status_type; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.enrollment_status_type AS ENUM (
    '入學',
    '休學',
    '退學',
    '畢業',
    '肄業',
    '復學',
    '轉學'
);

--
-- Name: exam_type; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.exam_type AS ENUM (
    '期中考',
    '期末考',
    '平時分'
);

--
-- Name: general_item_category; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.general_item_category AS ENUM (
    '書庫',
    '校服',
    '簿本'
);

--
-- Name: ledger_direction; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.ledger_direction AS ENUM (
    '入庫',
    '售出',
    '借出',
    '歸還',
    '調整',
    '報損'
);

--
-- Name: teacher_letter_category; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.teacher_letter_category AS ENUM (
    '自聘教師聘書',
    '當年教師聘書'
);

--
-- Name: user_role; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.user_role AS ENUM (
    'system_admin_s',
    'admin_a',
    'admin_b',
    'homeroom_teacher',
    'subject_teacher'
);

--
-- Name: admin_insert_backup(text, uuid, jsonb, jsonb, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_insert_backup(p_kind text, p_created_by uuid, p_tables jsonb, p_table_counts jsonb, p_storage_path text DEFAULT NULL::text) RETURNS TABLE(id uuid, created_at timestamp with time zone)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    SET statement_timeout TO '10min'
    AS $$
begin
  return query
    insert into backups (kind, created_by, tables, table_counts, storage_path)
    values (p_kind, p_created_by, p_tables, p_table_counts, p_storage_path)
    returning backups.id, backups.created_at;
end;
$$;

--
-- Name: apply_pending_change(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.apply_pending_change(p_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
declare
  v_row pending_changes;
  v_pk_col text;
  v_set_clause text;
  v_col text;
  v_val jsonb;
begin
  select * into v_row from pending_changes where id = p_id;
  if v_row is null then
    raise exception '找不到這筆待審核紀錄';
  end if;
  if v_row.status <> '已核准' then
    raise exception '只有狀態為「已核准」的紀錄可以套用';
  end if;
  if v_row.applied_at is not null then
    return; -- 已經套用過，不要重複寫入
  end if;

  select primary_key_column into v_pk_col
  from governed_tables where table_name = v_row.table_name;
  if v_pk_col is null then
    raise exception '資料表 % 不在允許清單內', v_row.table_name;
  end if;

  if v_row.operation = 'insert' then
    execute format(
      'insert into %I (%s) values (%s)',
      v_row.table_name,
      (select string_agg(quote_ident(key), ', ') from jsonb_each_text(v_row.payload)),
      (select string_agg(quote_nullable(value), ', ') from jsonb_each_text(v_row.payload))
    );

  elsif v_row.operation = 'update' then
    v_set_clause := (
      select string_agg(format('%I = %L', key, value), ', ')
      from jsonb_each_text(v_row.payload)
    );
    execute format(
      'update %I set %s where %I = %L',
      v_row.table_name, v_set_clause, v_pk_col, v_row.record_key
    );

  elsif v_row.operation = 'delete' then
    execute format(
      'delete from %I where %I = %L',
      v_row.table_name, v_pk_col, v_row.record_key
    );
  end if;

  update pending_changes set applied_at = now() where id = p_id;
end;
$$;

--
-- Name: attendance_adjustment(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.attendance_adjustment(p_enrollment_id uuid) RETURNS numeric
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_student_no text;
  v_academic_year int;
  v_term text;
  v_grade_level text;
  v_start date;
  v_end date;
  v_deduction numeric := 0;
  v_attendance_weight numeric;
begin
  select e.student_no, c.academic_year, e.term, c.grade_level
    into v_student_no, v_academic_year, v_term, v_grade_level
  from enrollments e join classes c on c.id = e.class_id
  where e.id = p_enrollment_id;

  if v_student_no is null then
    return 0;
  end if;

  select term_start_date, term_end_date into v_start, v_end
  from academic_terms
  where academic_year = v_academic_year and term = v_term;

  if v_start is null or v_end is null then
    return 0;
  end if;

  select coalesce(sum(cpd.points), 0) into v_deduction
  from attendance a
  join conduct_point_defaults cpd on cpd.item = a.status::text
  where a.student_no = v_student_no
    and a.record_date between v_start and v_end
    and a.status <> '出席';

  if v_deduction = 0 then
    select cu.weight * 100 into v_attendance_weight
    from curriculum cu
    where cu.academic_year = v_academic_year
      and cu.term = v_term
      and cu.grade_level = v_grade_level
      and cu.subject in ('全勤', '出缺席')
    limit 1;
    return coalesce(v_attendance_weight, 0);
  end if;

  return v_deduction;
end;
$$;

--
-- Name: attendance_locked(text, date); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.attendance_locked(p_student_no text, p_record_date date) RETURNS boolean
    LANGUAGE sql STABLE
    AS $$
  select
    (
      -- 條件一（沿用原本邏輯）：該班被管理員手動整班鎖定
      exists (
        select 1
        from submission_windows sw
        join enrollments e on e.student_no = p_student_no
        join classes c on c.id = e.class_id
        where sw.data_type = '出缺勤'
          and sw.scope = '班級'
          and sw.scope_ref = c.id::text
          and sw.is_locked = true
      )
    )
    or
    (
      -- 條件二（本次新增）：記錄日期已超過逾期天數，自動視為鎖定
      p_record_date < (current_date - (
        select coalesce(backfill_overdue_days, 7) from attendance_alert_settings where id = 1
      ))
    );
$$;

--
-- Name: attendance_score(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.attendance_score(p_enrollment_id uuid) RETURNS numeric
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_student_no text;
  v_academic_year int;
  v_term text;
  v_start date;
  v_end date;
  v_deduction numeric;
  v_record_count int;
begin
  select e.student_no, c.academic_year, e.term
    into v_student_no, v_academic_year, v_term
  from enrollments e join classes c on c.id = e.class_id
  where e.id = p_enrollment_id;

  if v_student_no is null then
    return null;
  end if;

  select term_start_date, term_end_date into v_start, v_end
  from academic_terms
  where academic_year = v_academic_year and term = v_term;

  if v_start is null or v_end is null then
    return null;
  end if;

  select count(*), coalesce(sum(cpd.points), 0)
    into v_record_count, v_deduction
  from attendance a
  left join conduct_point_defaults cpd on cpd.item = a.status::text
  where a.student_no = v_student_no
    and a.record_date between v_start and v_end
    and a.status <> '出席';

  -- 完全沒有任何一筆曠課/遲到/病假/事假/公假紀錄（真正全勤）才給100分；
  -- 只要有紀錄，即使剛好加總=0，也照原始加總結果顯示（=0），不會被誤判成全勤。
  return case when v_record_count = 0 then 100 else v_deduction end;
end;
$$;

--
-- Name: FUNCTION attendance_score(p_enrollment_id uuid); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.attendance_score(p_enrollment_id uuid) IS '這個學生這個學期的「出缺席」科目分數：全勤=100分，否則=依【整體佔比與加扣分規則】
   加總的扣分點數（不設下限，可以是很大的負數）。跟其他科目一樣，之後會再乘上科目比重
   (curriculum.weight，例如3%) 才會反映到總分，這裡回傳的是分數本身，不是已經乘過比重
   的貢獻值。';

--
-- Name: attendance_scores_for_enrollments(uuid[]); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.attendance_scores_for_enrollments(p_enrollment_ids uuid[]) RETURNS TABLE(enrollment_id uuid, score numeric)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  -- 邏輯與 attendance_score()（sql/50）逐項相同：學期起訖日任一為空 → null；
  -- 區間內完全沒有非「出席」紀錄 → 100；否則為扣分點數加總。
  select
    e.id as enrollment_id,
    case
      when at.term_start_date is null or at.term_end_date is null then null
      when coalesce(x.cnt, 0) = 0 then 100::numeric
      else coalesce(x.deduction, 0)
    end as score
  from enrollments e
  join classes c on c.id = e.class_id
  left join academic_terms at
    on at.academic_year = c.academic_year and at.term = e.term
  left join lateral (
    select count(*) as cnt, coalesce(sum(cpd.points), 0) as deduction
    from attendance a
    left join conduct_point_defaults cpd on cpd.item = a.status::text
    where a.student_no = e.student_no
      and a.record_date between at.term_start_date and at.term_end_date
      and a.status <> '出席'
  ) x on true
  where e.id = any(p_enrollment_ids);
$$;

--
-- Name: available_substitute_teachers(integer, text, integer, integer, date); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.available_substitute_teachers(p_academic_year integer, p_term text, p_weekday integer, p_period_no integer, p_date date) RETURNS TABLE(teacher_id uuid, teacher_name text)
    LANGUAGE sql STABLE
    AS $$
  select t.id, t.name
  from teachers t
  where not exists (
    select 1 from class_schedule cs
    where cs.teacher_id = t.id
      and cs.academic_year = p_academic_year
      and cs.term = p_term
      and cs.weekday = p_weekday
      and cs.period_no = p_period_no
  )
  and not exists (
    -- 排除當天已經被排去代別堂課的老師
    select 1 from substitute_assignments sa
    where sa.substitute_teacher_id = t.id
      and sa.substitute_date = p_date
      and sa.period_no = p_period_no
      and sa.status = '已排定'
  )
  order by t.name;
$$;

--
-- Name: can_manage_staff_clock(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.can_manage_staff_clock() RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select
    coalesce(current_role_name()::text in ('system_admin_s', 'admin_a'), false)
    or has_department('academic'::admin_department);
$$;

--
-- Name: can_read_attendance(text, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.can_read_attendance(p_student_no text, p_period_no integer) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    AS $$
  select
    (select is_system_admin()) or (select has_department('discipline')) or (select has_department('dev'))
    or exists (
      select 1 from enrollments e
      join classes c on c.id = e.class_id
      where e.student_no = p_student_no
        and c.homeroom_teacher_id = (select current_teacher_id())
    )
    or exists (
      select 1 from enrollments e
      join class_schedule cs on cs.class_id = e.class_id
      where e.student_no = p_student_no
        and cs.teacher_id = (select current_teacher_id())
        and cs.period_no = p_period_no
    );
$$;

--
-- Name: can_write_attendance(text, date, integer, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.can_write_attendance(p_student_no text, p_record_date date, p_period_no integer, p_attendance_id uuid DEFAULT NULL::uuid) RETURNS boolean
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    AS $$
declare
  v_is_owner boolean;
begin
  if is_system_admin() or has_department('discipline') or has_department('dev') then
    return true;
  end if;

  v_is_owner := exists (
    select 1 from enrollments e
    join classes c on c.id = e.class_id
    where e.student_no = p_student_no
      and c.homeroom_teacher_id = current_teacher_id()
  ) or exists (
    select 1 from enrollments e
    join class_schedule cs on cs.class_id = e.class_id
    where e.student_no = p_student_no
      and cs.teacher_id = current_teacher_id()
      and cs.period_no = p_period_no
  );
  if not v_is_owner then
    return false;
  end if;

  if not attendance_locked(p_student_no, p_record_date) then
    return true;
  end if;

  return (p_attendance_id is not null and has_approved_correction(p_attendance_id))
    or exists (
      select 1 from enrollments e
      where e.student_no = p_student_no
        and has_approved_window_open(e.class_id)
    );
end;
$$;

--
-- Name: can_write_score(uuid, text, text, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.can_write_score(p_enrollment_id uuid, p_subject text, p_exam_type text, p_score_id uuid DEFAULT NULL::uuid) RETURNS boolean
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    AS $$
declare
  v_class_id uuid;
  v_academic_year int;
  v_term text;
  v_is_owner boolean;
begin
  select c.id, c.academic_year, e.term into v_class_id, v_academic_year, v_term
  from enrollments e join classes c on c.id = e.class_id
  where e.id = p_enrollment_id;

  if is_system_admin() or has_department('academic') or has_department('dev') then
    return true; -- 教務處不受鎖定限制，負責審核與最終處理；開發人員批次匯入情境同理
  end if;

  v_is_owner := exists (
    select 1 from class_schedule cs
    where cs.class_id = v_class_id and cs.teacher_id = current_teacher_id() and cs.subject = p_subject
  );

  if not v_is_owner then
    return false;
  end if;

  if not scores_locked(v_class_id, v_academic_year, v_term, p_exam_type) then
    return true;
  end if;

  return p_score_id is not null and has_approved_correction(p_score_id);
end;
$$;

--
-- Name: canonical_phone(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.canonical_phone(p text) RETURNS text
    LANGUAGE plpgsql IMMUTABLE
    AS $$
declare
  d text;
begin
  d := regexp_replace(coalesce(p, ''), '\D', '', 'g');
  if left(d, 2) = '66' and length(d) > 9 then
    d := substring(d from 3);
  end if;
  if left(d, 1) = '0' then
    d := substring(d from 2);
  end if;
  return d;
end;
$$;

--
-- Name: claim_portal_accounts_for_current_staff(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.claim_portal_accounts_for_current_staff(p_email text) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  claimed_count integer := 0;
  g record;
  v_login_code text;
begin
  if p_email is null or trim(p_email) = '' then
    return 0;
  end if;

  for g in
    select distinct student_no
    from guardians
    where lower(trim(email)) = lower(trim(p_email))
      and email is not null
      and trim(email) <> ''
  loop
    v_login_code := 'HY' || g.student_no;
    if exists (select 1 from portal_accounts where login_code = v_login_code) then
      -- 信箱比對通過，等同真正登入頁驗證過的強度，直接覆蓋成這次的登入身分，
      -- 不管原本是 null 還是已經綁過別的身分（含這個人自己過去用家長查詢入口
      -- 登入留下的身分）。
      update portal_accounts set auth_user_id = auth.uid() where login_code = v_login_code;
      claimed_count := claimed_count + 1;
    else
      insert into portal_accounts (student_no, login_code, email, relation, auth_user_id, created_by)
      values (g.student_no, v_login_code, p_email, '家長', auth.uid(), auth.uid());
      claimed_count := claimed_count + 1;
    end if;
  end loop;

  return claimed_count;
end;
$$;

--
-- Name: claim_portal_accounts_for_current_staff_by_phone(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.claim_portal_accounts_for_current_staff_by_phone(p_phone text) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  claimed_count integer := 0;
  g record;
  v_login_code text;
  v_email text;
begin
  if p_phone is null or trim(p_phone) = '' or length(canonical_phone(p_phone)) < 8 then
    return 0;
  end if;

  for g in
    select distinct gu.student_no, gu.email
    from guardians gu
    where phones_match(gu.phone, p_phone)
  loop
    v_login_code := 'HY' || g.student_no;
    if exists (select 1 from portal_accounts where login_code = v_login_code) then
      -- 手機比對通過，等同真正家長登入頁（app/api/portal/request-login）驗證
      -- 過的強度，直接覆蓋成這次的登入身分，不管原本是 null 還是已經綁過別的
      -- 身分（很可能就是這個人自己過去用家長查詢入口登入留下的身分）。
      update portal_accounts set auth_user_id = auth.uid() where login_code = v_login_code;
      claimed_count := claimed_count + 1;
    else
      v_email := coalesce(nullif(trim(g.email), ''), v_login_code || '@phone-verified.internal');
      insert into portal_accounts (student_no, login_code, email, relation, auth_user_id, created_by)
      values (g.student_no, v_login_code, v_email, '家長', auth.uid(), auth.uid());
      claimed_count := claimed_count + 1;
    end if;
  end loop;

  return claimed_count;
end;
$$;

--
-- Name: claim_sibling_portal_accounts_for_current_staff(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.claim_sibling_portal_accounts_for_current_staff() RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  claimed_count integer := 0;
  my_student_nos text[];
  my_phones text[];
  my_emails text[];
  g record;
  v_login_code text;
begin
  select array_agg(distinct student_no) into my_student_nos
  from portal_accounts
  where auth_user_id = auth.uid();

  if my_student_nos is null or array_length(my_student_nos, 1) = 0 then
    return 0;
  end if;

  select array_agg(distinct phone) into my_phones
  from guardians
  where student_no = any(my_student_nos) and phone is not null and trim(phone) <> '';

  select array_agg(distinct lower(trim(email))) into my_emails
  from guardians
  where student_no = any(my_student_nos) and email is not null and trim(email) <> '';

  for g in
    select distinct gu.student_no, gu.email
    from guardians gu
    where not (gu.student_no = any(my_student_nos))
      and (
        (my_phones is not null and gu.phone is not null and exists (
          select 1 from unnest(my_phones) mp where phones_match(gu.phone, mp)
        ))
        or
        (my_emails is not null and gu.email is not null and lower(trim(gu.email)) = any(my_emails))
      )
  loop
    v_login_code := 'HY' || g.student_no;
    if exists (select 1 from portal_accounts where login_code = v_login_code) then
      update portal_accounts set auth_user_id = auth.uid() where login_code = v_login_code;
      claimed_count := claimed_count + 1;
    else
      insert into portal_accounts (student_no, login_code, email, relation, auth_user_id, created_by)
      values (
        g.student_no,
        v_login_code,
        coalesce(nullif(trim(g.email), ''), v_login_code || '@phone-verified.internal'),
        '家長',
        auth.uid(),
        auth.uid()
      );
      claimed_count := claimed_count + 1;
    end if;
  end loop;

  return claimed_count;
end;
$$;

--
-- Name: class_attendance_adjustment_batch(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.class_attendance_adjustment_batch(p_class_id uuid, p_term text) RETURNS TABLE(enrollment_id uuid, attendance_score numeric, raw_adjustment numeric)
    LANGUAGE sql STABLE
    AS $$
  select s.enrollment_id, s.score, s.score
  from attendance_scores_for_enrollments(
    array(select e.id from enrollments e where e.class_id = p_class_id and e.term = p_term)
  ) s;
$$;

--
-- Name: class_lock_status(uuid, integer, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.class_lock_status(p_class_id uuid, p_academic_year integer, p_term text) RETURNS TABLE(mid_locked boolean, fin_locked boolean, day_locked boolean)
    LANGUAGE sql STABLE
    AS $$
  select
    exam_type_locked(p_class_id, p_academic_year, p_term, '期中考'),
    exam_type_locked(p_class_id, p_academic_year, p_term, '期末考'),
    exam_type_locked(p_class_id, p_academic_year, p_term, '平時分');
$$;

--
-- Name: class_rankings_for_class(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.class_rankings_for_class(p_class_id uuid, p_term text) RETURNS TABLE(enrollment_id uuid, class_id uuid, term text, academic_year integer, name text, seat_no integer, student_no text, total_score numeric, class_rank bigint, midterm_total numeric, midterm_class_rank bigint, final_total numeric, final_class_rank bigint, daily_total numeric, daily_class_rank bigint, midterm_average numeric, final_average numeric, daily_average numeric)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  with scoped_enrollments as (
    select e.id, e.class_id, e.term, c.academic_year, st.name, e.seat_no, e.student_no
    from enrollments e
    join classes c on c.id = e.class_id
    join students st on st.student_no = e.student_no
    where e.class_id = p_class_id and e.term = p_term
      and not student_is_hidden(e.student_no)
  ),
  totals as (
    select * from scoped_student_totals(array(select id from scoped_enrollments))
  ),
  ranked as (
    select
      se.id as enrollment_id, se.class_id, se.term, se.academic_year, se.name, se.seat_no, se.student_no,
      t.total_score,
      rank() over (order by t.total_score desc) as class_rank,
      t.midterm_total,
      rank() over (order by t.midterm_average desc) as midterm_class_rank,
      t.final_total,
      rank() over (order by t.final_average desc) as final_class_rank,
      t.daily_total,
      rank() over (order by t.daily_average desc) as daily_class_rank,
      t.midterm_average, t.final_average, t.daily_average
    from scoped_enrollments se
    left join totals t on t.enrollment_id = se.id
  ),
  cl as (
    select
      exam_type_locked(p_class_id, c.academic_year, p_term, '期中考') as mid_locked,
      exam_type_locked(p_class_id, c.academic_year, p_term, '期末考') as fin_locked,
      exam_type_locked(p_class_id, c.academic_year, p_term, '平時分') as day_locked
    from classes c
    where c.id = p_class_id
  )
  select
    ranked.enrollment_id, ranked.class_id, ranked.term, ranked.academic_year,
    ranked.name, ranked.seat_no, ranked.student_no,
    case when cl.mid_locked and cl.fin_locked and cl.day_locked then ranked.total_score end,
    case when cl.mid_locked and cl.fin_locked and cl.day_locked then ranked.class_rank end,
    case when cl.mid_locked then ranked.midterm_total end,
    case when cl.mid_locked then ranked.midterm_class_rank end,
    case when cl.fin_locked then ranked.final_total end,
    case when cl.fin_locked then ranked.final_class_rank end,
    case when cl.day_locked then ranked.daily_total end,
    case when cl.day_locked then ranked.daily_class_rank end,
    case when cl.mid_locked then ranked.midterm_average end,
    case when cl.fin_locked then ranked.final_average end,
    case when cl.day_locked then ranked.daily_average end
  from ranked, cl
  where (
    (select is_system_admin())
    or (select has_department('academic'))
    or exists (select 1 from classes c2 where c2.id = p_class_id and c2.homeroom_teacher_id = (select current_teacher_id()))
    or is_linked_parent(ranked.student_no)
  );
$$;

--
-- Name: clock_last_data_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.clock_last_data_at() RETURNS timestamp with time zone
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select max(punched_at) from clock_records where not voided;
$$;

--
-- Name: clock_quiet_days(date, date, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.clock_quiet_days(p_from date, p_to date, p_max_people integer DEFAULT 2) RETURNS TABLE(day date, people integer)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  with bounds as (
    select greatest(p_from, min(punch_date)) as lo, least(p_to, max(punch_date)) as hi from clock_records where not voided
  ),
  counts as (
    select punch_date, count(distinct device_code)::int as people
    from clock_records, bounds
    where not voided and punch_date between bounds.lo and bounds.hi
    group by punch_date
  )
  select d::date as day, coalesce(c.people, 0)::int as people
  from bounds, generate_series(bounds.lo, bounds.hi, interval '1 day') d
  left join counts c on c.punch_date = d::date
  where can_manage_staff_clock()
    and extract(isodow from d) <> 7
    and coalesce(c.people, 0) <= p_max_people
    and d::date not in (select holiday_date from clock_holidays)
  order by 1;
$$;

--
-- Name: club_member_counts(integer, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.club_member_counts(p_academic_year integer, p_term text) RETURNS TABLE(club_id uuid, current_count bigint)
    LANGUAGE sql STABLE SECURITY DEFINER
    AS $$
  select c.id, count(m.id)
  from clubs c
  left join club_members m on m.club_id = c.id and m.status = '在社'
  where c.academic_year = p_academic_year and c.term = p_term
  group by c.id;
$$;

--
-- Name: current_academic_term(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.current_academic_term() RETURNS TABLE(academic_year integer, term text)
    LANGUAGE sql STABLE
    AS $$
  select academic_year, term from academic_terms where is_current = true limit 1;
$$;

--
-- Name: current_portal_student_no(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.current_portal_student_no() RETURNS text
    LANGUAGE sql STABLE
    AS $$
  select student_no from portal_accounts
  where auth_user_id = auth.uid() and relation = '學生本人'
  limit 1;
$$;

--
-- Name: current_role_name(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.current_role_name() RETURNS public.user_role
    LANGUAGE sql STABLE
    AS $$
  select role from app_users where id = auth.uid();
$$;

--
-- Name: current_staff_has_bound_portal_accounts(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.current_staff_has_bound_portal_accounts() RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select exists (select 1 from portal_accounts where auth_user_id = auth.uid());
$$;

--
-- Name: current_staff_has_guardian_email_match(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.current_staff_has_guardian_email_match(p_email text) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select exists (
    select 1
    from guardians g
    where lower(trim(g.email)) = lower(trim(p_email))
      and g.email is not null
      and trim(g.email) <> ''
      and p_email is not null
      and trim(p_email) <> ''
  );
$$;

--
-- Name: current_teacher_id(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.current_teacher_id() RETURNS uuid
    LANGUAGE sql STABLE
    AS $$
  select id from teachers where app_user_id = auth.uid();
$$;

--
-- Name: decide_conduct_event_request(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.decide_conduct_event_request(p_id uuid, p_decision text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_row conduct_event_requests;
  v_role user_role := current_role_name();
  v_uid uuid := auth.uid();
  v_new_id uuid;
  v_tier int; -- 1=只需B；2=B再送A；3=B→A再送S。嘉獎/警告=1，小功/小過=2，大功/大過=3
begin
  if p_decision not in ('同意', '不同意') then
    raise exception '決定只能是「同意」或「不同意」';
  end if;

  select * into v_row from conduct_event_requests where id = p_id for update;
  if v_row is null then
    raise exception '找不到這筆申請';
  end if;

  v_tier := case v_row.event_type
    when '嘉獎' then 1 when '警告' then 1
    when '小功' then 2 when '小過' then 2
    when '大功' then 3 when '大過' then 3
    else 1
  end;

  if v_row.status = '待B審核' then
    if v_role <> 'admin_b' then
      raise exception '目前這筆申請輪到管理員B審核，您沒有權限審核';
    end if;
    update conduct_event_requests set
      b_decision = p_decision, b_by = v_uid, b_at = now(),
      status = case
        when p_decision = '不同意' then '已駁回'
        when v_tier = 1 then '已核准'
        else '待A審核'
      end
    where id = p_id;

  elsif v_row.status = '待A審核' then
    if v_role <> 'admin_a' then
      raise exception '目前這筆申請輪到管理員A審核，您沒有權限審核';
    end if;
    update conduct_event_requests set
      a_decision = p_decision, a_by = v_uid, a_at = now(),
      status = case
        when p_decision = '不同意' then '已駁回'
        when v_tier = 3 then '待S審核'
        else '已核准'
      end
    where id = p_id;

  elsif v_row.status = '待S審核' then
    if v_role <> 'system_admin_s' then
      raise exception '目前這筆申請輪到管理員S審核，您沒有權限審核';
    end if;
    update conduct_event_requests set
      s_decision = p_decision, s_by = v_uid, s_at = now(),
      status = case when p_decision = '不同意' then '已駁回' else '已核准' end
    where id = p_id;

  else
    raise exception '這筆申請已經處理完成（%），不能重複審核', v_row.status;
  end if;

  select * into v_row from conduct_event_requests where id = p_id;
  if v_row.status = '已核准' and v_row.applied_at is null then
    insert into conduct_events (student_no, event_date, event_type, points, count, reason, recorded_by)
    values (
      v_row.student_no, v_row.event_date, v_row.event_type, v_row.points, v_row.count, v_row.reason,
      (select id from teachers where app_user_id = v_row.requested_by)
    )
    on conflict on constraint conduct_events_student_date_type_key
    do update set points = excluded.points, count = excluded.count, reason = excluded.reason, recorded_by = excluded.recorded_by
    returning id into v_new_id;
    update conduct_event_requests set applied_at = now(), conduct_event_id = v_new_id where id = p_id;
  end if;
end;
$$;

--
-- Name: delete_orphan_score_subject(integer, text, text, text, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.delete_orphan_score_subject(p_academic_year integer, p_term text, p_grade_level text, p_subject text, p_class_id uuid DEFAULT NULL::uuid) RETURNS integer
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
declare v_count integer;
begin
  if p_subject in ('全勤', '出缺席') then
    return 0;
  end if;
  with del as (
    delete from scores s
    using enrollments e, classes c
    where e.id = s.enrollment_id and c.id = e.class_id
      and c.academic_year = p_academic_year and e.term = p_term and c.grade_level = p_grade_level
      and s.subject = p_subject
      and (p_class_id is null or c.id = p_class_id)
      and exists (
        select 1 from curriculum k
        where k.academic_year = c.academic_year and k.term = e.term and k.grade_level = c.grade_level
      )
      and not exists (
        select 1 from curriculum k
        where k.academic_year = c.academic_year and k.term = e.term and k.grade_level = c.grade_level
          and k.subject = s.subject
      )
    returning 1
  )
  select count(*) into v_count from del;
  return v_count;
end;
$$;

--
-- Name: discipline_adjustment(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.discipline_adjustment(p_enrollment_id uuid) RETURNS numeric
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_student_no text;
  v_academic_year int;
  v_term text;
  v_start date;
  v_end date;
  v_adjustment numeric := 0;
begin
  select e.student_no, c.academic_year, e.term
    into v_student_no, v_academic_year, v_term
  from enrollments e join classes c on c.id = e.class_id
  where e.id = p_enrollment_id;

  if v_student_no is null then
    return 0;
  end if;

  select term_start_date, term_end_date into v_start, v_end
  from academic_terms
  where academic_year = v_academic_year and term = v_term;

  if v_start is null or v_end is null then
    return 0;
  end if;

  select coalesce(sum(ce.points), 0) into v_adjustment
  from conduct_events ce
  where ce.student_no = v_student_no
    and ce.event_date between v_start and v_end;

  return v_adjustment;
end;
$$;

--
-- Name: enforce_conduct_event_rules(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.enforce_conduct_event_rules() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_default numeric;
begin
  if is_system_admin() or has_department('discipline') then
    -- 訓導/管理員：不限種類、不限點數；原因由登記畫面要求必填（不在這裡強制，
    -- 避免影響 lib/bulkHandlers.ts「一鍵上傳」既有沒有原因欄位的批次匯入）。
    return new;
  end if;

  if new.reason is null or btrim(new.reason) = '' then
    raise exception '獎懲登記一定要填寫原因';
  end if;
  if new.event_type not in ('嘉獎', '小功') then
    raise exception '教師只能登記嘉獎或小功';
  end if;
  select points into v_default from conduct_point_defaults where item = new.event_type;
  new.points := coalesce(v_default, case new.event_type when '小功' then 3 else 1 end);
  if new.points > 3 then
    raise exception '教師單筆獎勵上限為 1 小功';
  end if;
  return new;
end;
$$;

--
-- Name: exam_type_locked(uuid, integer, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.exam_type_locked(p_class_id uuid, p_academic_year integer, p_term text, p_data_type text) RETURNS boolean
    LANGUAGE sql STABLE
    AS $$
  select submission_window_locked(p_class_id, p_academic_year, p_term, p_data_type);
$$;

--
-- Name: grade_rankings_for_class(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.grade_rankings_for_class(p_class_id uuid, p_term text) RETURNS TABLE(enrollment_id uuid, class_id uuid, term text, academic_year integer, department text, grade_level text, name text, seat_no integer, student_no text, total_score numeric, grade_rank bigint, midterm_total numeric, midterm_grade_rank bigint, final_total numeric, final_grade_rank bigint, daily_total numeric, daily_grade_rank bigint, midterm_average numeric, final_average numeric, daily_average numeric)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  with target_scope as (
    select c.academic_year, c.department, c.grade_level
    from classes c where c.id = p_class_id
  ),
  scoped_enrollments as (
    select e.id, e.class_id, e.term, c.academic_year, c.department, c.grade_level, st.name, e.seat_no, e.student_no
    from enrollments e
    join classes c on c.id = e.class_id
    join target_scope tg on c.academic_year = tg.academic_year and c.department = tg.department and c.grade_level = tg.grade_level
    join students st on st.student_no = e.student_no
    where e.term = p_term
      and not student_is_hidden(e.student_no)
  ),
  totals as (
    select * from scoped_student_totals(array(select id from scoped_enrollments))
  ),
  ranked as (
    select
      se.id as enrollment_id, se.class_id, se.term, se.academic_year, se.department, se.grade_level,
      se.name, se.seat_no, se.student_no,
      t.total_score,
      rank() over (order by t.total_score desc) as grade_rank,
      t.midterm_total,
      rank() over (order by t.midterm_average desc) as midterm_grade_rank,
      t.final_total,
      rank() over (order by t.final_average desc) as final_grade_rank,
      t.daily_total,
      rank() over (order by t.daily_average desc) as daily_grade_rank,
      t.midterm_average, t.final_average, t.daily_average
    from scoped_enrollments se
    left join totals t on t.enrollment_id = se.id
  ),
  -- 【sql/102】鎖定狀態每個「班」只算一次（原本每位學生各算 3 次）
  class_locks as (
    select d.class_id,
      exam_type_locked(d.class_id, d.academic_year, d.term, '期中考') as mid_locked,
      exam_type_locked(d.class_id, d.academic_year, d.term, '期末考') as fin_locked,
      exam_type_locked(d.class_id, d.academic_year, d.term, '平時分') as day_locked
    from (select distinct class_id, academic_year, term from scoped_enrollments) d
  )
  select
    ranked.enrollment_id, ranked.class_id, ranked.term, ranked.academic_year,
    ranked.department, ranked.grade_level, ranked.name, ranked.seat_no, ranked.student_no,
    case when cl.mid_locked and cl.fin_locked and cl.day_locked then ranked.total_score end,
    case when cl.mid_locked and cl.fin_locked and cl.day_locked then ranked.grade_rank end,
    case when cl.mid_locked then ranked.midterm_total end,
    case when cl.mid_locked then ranked.midterm_grade_rank end,
    case when cl.fin_locked then ranked.final_total end,
    case when cl.fin_locked then ranked.final_grade_rank end,
    case when cl.day_locked then ranked.daily_total end,
    case when cl.day_locked then ranked.daily_grade_rank end,
    case when cl.mid_locked then ranked.midterm_average end,
    case when cl.fin_locked then ranked.final_average end,
    case when cl.day_locked then ranked.daily_average end
  from ranked
  join class_locks cl on cl.class_id = ranked.class_id
  where (
    (select is_system_admin())
    or (select has_department('academic'))
    or exists (select 1 from classes c2 where c2.id = ranked.class_id and c2.homeroom_teacher_id = (select current_teacher_id()))
    or is_linked_parent(ranked.student_no)
  );
$$;

--
-- Name: guardian_phone_match_exists(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.guardian_phone_match_exists(p_phone text) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select exists (
    select 1 from guardians g where phones_match(g.phone, p_phone)
    union all
    select 1 from students s where phones_match(s.phone, p_phone)
  );
$$;

--
-- Name: guardian_phones_for_roster(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.guardian_phones_for_roster(p_student_no text) RETURNS TABLE(relation text, name text, phone text)
    LANGUAGE sql STABLE SECURITY DEFINER
    AS $$
  select g.relation, g.name, g.phone
  from guardians g
  where g.student_no = p_student_no
    and exists (select 1 from app_users where id = auth.uid())
    and not student_is_hidden(p_student_no);
$$;

--
-- Name: has_approved_correction(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.has_approved_correction(p_record_id uuid) RETURNS boolean
    LANGUAGE sql STABLE
    AS $$
  select exists (
    select 1 from correction_requests cr
    where cr.record_id = p_record_id and cr.status = '核准'
  );
$$;

--
-- Name: has_approved_window_open(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.has_approved_window_open(p_class_id uuid) RETURNS boolean
    LANGUAGE sql STABLE
    AS $$
  select exists (
    select 1 from correction_requests cr
    where cr.data_type = '出缺勤'
      and cr.scope = '班級'
      and cr.scope_ref = p_class_id::text
      and cr.status = '核准'
  );
$$;

--
-- Name: has_department(public.admin_department); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.has_department(p_dept public.admin_department) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select exists (
    select 1 from app_user_departments
    where app_user_id = auth.uid() and department = p_dept
  );
$$;

--
-- Name: is_admin_sa(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.is_admin_sa() RETURNS boolean
    LANGUAGE sql STABLE
    AS $$
  select current_role_name() in ('system_admin_s', 'admin_a');
$$;

--
-- Name: is_club_teacher(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.is_club_teacher(p_club_id uuid) RETURNS boolean
    LANGUAGE sql STABLE
    AS $$
  select is_system_admin() or has_department('academic')
    or exists (select 1 from clubs where id = p_club_id and teacher_id = current_teacher_id());
$$;

--
-- Name: is_department_lead(public.admin_department); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.is_department_lead(p_dept public.admin_department) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select exists (
    select 1 from app_user_departments
    where app_user_id = auth.uid() and department = p_dept and level = 'lead'
  );
$$;

--
-- Name: is_department_lead_of(public.admin_department); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.is_department_lead_of(p_department public.admin_department) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select exists (
    select 1 from app_user_departments
    where app_user_id = auth.uid()
      and department = p_department
      and level = 'lead'
  );
$$;

--
-- Name: is_linked_parent(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.is_linked_parent(p_student_no text) RETURNS boolean
    LANGUAGE sql STABLE
    AS $$
  select exists (
    select 1 from portal_accounts pa
    where pa.auth_user_id = auth.uid() and pa.student_no = p_student_no
  );
$$;

--
-- Name: is_system_admin(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.is_system_admin() RETURNS boolean
    LANGUAGE sql STABLE
    AS $$
  select current_role_name() = 'system_admin_s';
$$;

--
-- Name: join_club_first_come(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.join_club_first_come(p_club_id uuid) RETURNS text
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
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

--
-- Name: log_attendance_change(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.log_attendance_change() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  if tg_op = 'UPDATE' and old.status is distinct from new.status then
    insert into attendance_audit_log (attendance_id, changed_by, old_value, new_value)
    values (new.id, current_teacher_id(), old.status, new.status);
  elsif tg_op = 'INSERT' then
    insert into attendance_audit_log (attendance_id, changed_by, old_value, new_value)
    values (new.id, current_teacher_id(), null, new.status);
  end if;
  return new;
end;
$$;

--
-- Name: log_score_change(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.log_score_change() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  if tg_op = 'INSERT' then
    insert into score_audit_log (score_id, changed_by, old_value, new_value)
    values (new.id, current_teacher_id(), null, new.score::text);
  elsif tg_op = 'UPDATE' then
    if old.score is distinct from new.score then
      insert into score_audit_log (score_id, changed_by, old_value, new_value)
      values (new.id, current_teacher_id(), old.score::text, new.score::text);
    end if;
  elsif tg_op = 'DELETE' then
    insert into score_audit_log (score_id, changed_by, old_value, new_value)
    values (old.id, current_teacher_id(), old.score::text, null);
  end if;
  return coalesce(new, old);
end;
$$;

--
-- Name: log_submission_window_reopen(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.log_submission_window_reopen() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  was_locked boolean;
  now_locked boolean;
  v_reason text;
begin
  was_locked := old.is_locked or (old.closes_at is not null and old.closes_at < now());
  now_locked := new.is_locked or (new.closes_at is not null and new.closes_at < now());
  if was_locked and not now_locked then
    begin
      v_reason := current_setting('app.reopen_reason', true);
    exception when others then
      v_reason := null;
    end;
    insert into submission_window_audit_log (
      window_id, academic_year, term, data_type, scope, scope_ref,
      old_is_locked, new_is_locked, old_closes_at, new_closes_at, changed_by, reason
    ) values (
      new.id, new.academic_year, new.term, new.data_type, new.scope, new.scope_ref,
      old.is_locked, new.is_locked, old.closes_at, new.closes_at, auth.uid(), v_reason
    );
  end if;
  return new;
end;
$$;

--
-- Name: move_orphan_score_subject(integer, text, text, text, text, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.move_orphan_score_subject(p_academic_year integer, p_term text, p_grade_level text, p_old_subject text, p_new_subject text, p_class_id uuid DEFAULT NULL::uuid) RETURNS jsonb
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
declare v_moved integer; v_left integer;
begin
  if p_old_subject in ('全勤', '出缺席') or p_new_subject in ('全勤', '出缺席') then
    raise exception '全勤／出缺席是系統自動計算的科目，不能用這個功能搬移';
  end if;
  if not exists (
    select 1 from curriculum k
    where k.academic_year = p_academic_year and k.term = p_term
      and k.grade_level = p_grade_level and k.subject = p_new_subject
  ) then
    raise exception '目標科目「%」不在 % 學年度%【%】的科目與比重設定裡', p_new_subject, p_academic_year, p_term, p_grade_level;
  end if;

  with moved as (
    update scores s set subject = p_new_subject
    from enrollments e, classes c
    where e.id = s.enrollment_id and c.id = e.class_id
      and c.academic_year = p_academic_year and e.term = p_term and c.grade_level = p_grade_level
      and s.subject = p_old_subject
      and (p_class_id is null or c.id = p_class_id)
      and not exists (
        select 1 from curriculum k
        where k.academic_year = c.academic_year and k.term = e.term and k.grade_level = c.grade_level
          and k.subject = s.subject
      )
      -- 該學生同一種考試在目標科目已經有分數 → 不覆蓋（留在殘留清單，由人決定要不要刪）
      and not exists (
        select 1 from scores s2
        where s2.enrollment_id = s.enrollment_id and s2.exam_type = s.exam_type and s2.subject = p_new_subject
      )
    returning 1
  )
  select count(*) into v_moved from moved;

  select count(*) into v_left
  from scores s
  join enrollments e on e.id = s.enrollment_id
  join classes c on c.id = e.class_id
  where c.academic_year = p_academic_year and e.term = p_term and c.grade_level = p_grade_level
    and s.subject = p_old_subject and (p_class_id is null or c.id = p_class_id);

  return jsonb_build_object('moved', v_moved, 'skipped', v_left);
end;
$$;

--
-- Name: my_clock_codes(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.my_clock_codes() RETURNS SETOF integer
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select m.device_code
  from clock_employee_map m
  join teachers t on t.id = m.teacher_id
  where t.app_user_id = auth.uid();
$$;

--
-- Name: notify_homeroom_on_exam_session_sent(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.notify_homeroom_on_exam_session_sent() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_teacher_id uuid;
  v_class_label text;
  v_class_id uuid;
begin
  if new.status = '已發送' and (old.status is distinct from '已發送') then
    for v_class_id, v_teacher_id, v_class_label in
      select distinct c.id, c.homeroom_teacher_id, coalesce(c.grade_level, '') || coalesce(c.class_name, '')
      from exam_room_classes erc
      join exam_rooms er on er.id = erc.exam_room_id
      join classes c on c.id = erc.class_id
      where er.exam_session_id = new.id and c.homeroom_teacher_id is not null
    loop
      insert into staff_notifications (teacher_id, category, message)
      values (
        v_teacher_id,
        '考場通知',
        new.name || '考場表已公布，請進入【輸入考場名單】填入' || v_class_label || '學生的考場座位。'
      );
      insert into exam_class_roster_status (exam_session_id, class_id, submitted)
      values (new.id, v_class_id, false)
      on conflict (exam_session_id, class_id) do nothing;
    end loop;
  end if;
  return new;
end;
$$;

--
-- Name: notify_homeroom_on_profile_edit_request(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.notify_homeroom_on_profile_edit_request() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
declare
  v_teacher_id uuid;
  v_student_name text;
begin
  select c.homeroom_teacher_id into v_teacher_id
  from enrollments e
  join classes c on c.id = e.class_id
  where e.student_no = new.student_no and e.is_current = true
  limit 1;

  if v_teacher_id is not null then
    select name into v_student_name from students where student_no = new.student_no;
    insert into staff_notifications (teacher_id, category, message, student_no)
    values (
      v_teacher_id,
      '個資修改申請',
      coalesce(v_student_name, new.student_no) || ' 的家長／學生申請修改「' || new.field_name || '」，請至「學生資料修改申請審核」頁面處理。',
      new.student_no
    );
  end if;
  return new;
end;
$$;

--
-- Name: notify_teachers_on_substitute_assignment(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.notify_teachers_on_substitute_assignment() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
declare
  v_class_label text;
begin
  select coalesce(c.grade_level, '') || coalesce(c.class_name, '')
    into v_class_label
  from classes c where c.id = new.class_id;

  insert into staff_notifications (teacher_id, category, message)
  values (
    new.original_teacher_id,
    '代課通知',
    new.substitute_date || ' 第' || new.period_no || '節（' || coalesce(v_class_label, '') || '／' || new.subject ||
      '）已安排代課，代課教師：' || coalesce((select name from teachers where id = new.substitute_teacher_id), '') ||
      coalesce('，事由：' || new.reason, '')
  );

  insert into staff_notifications (teacher_id, category, message)
  values (
    new.substitute_teacher_id,
    '代課通知',
    new.substitute_date || ' 第' || new.period_no || '節（' || coalesce(v_class_label, '') || '／' || new.subject ||
      '）已安排由您代課，原任課教師：' || coalesce((select name from teachers where id = new.original_teacher_id), '') ||
      coalesce('，事由：' || new.reason, '')
  );

  return new;
end;
$$;

--
-- Name: orphan_score_subjects(integer, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.orphan_score_subjects(p_academic_year integer DEFAULT NULL::integer, p_term text DEFAULT NULL::text) RETURNS TABLE(class_id uuid, class_label text, academic_year integer, term text, grade_level text, subject text, score_count bigint, student_count bigint)
    LANGUAGE sql STABLE
    SET search_path TO 'public'
    AS $$
  select c.id, c.grade_level || c.class_name, c.academic_year, e.term, c.grade_level,
         s.subject, count(*), count(distinct e.id)
  from scores s
  join enrollments e on e.id = s.enrollment_id
  join classes c on c.id = e.class_id
  where (p_academic_year is null or c.academic_year = p_academic_year)
    and (p_term is null or e.term = p_term)
    and s.subject not in ('全勤', '出缺席')
    and exists (
      select 1 from curriculum k
      where k.academic_year = c.academic_year and k.term = e.term and k.grade_level = c.grade_level
    )
    and not exists (
      select 1 from curriculum k
      where k.academic_year = c.academic_year and k.term = e.term and k.grade_level = c.grade_level
        and k.subject = s.subject
    )
  group by c.id, c.grade_level, c.class_name, c.academic_year, e.term, s.subject
  order by c.academic_year desc, e.term, c.grade_level, c.class_name, s.subject;
$$;

--
-- Name: phones_match(text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.phones_match(a text, b text) RETURNS boolean
    LANGUAGE sql IMMUTABLE
    AS $$
  select
    length(canonical_phone(a)) >= 8
    and length(canonical_phone(b)) >= 8
    and canonical_phone(a) = canonical_phone(b);
$$;

--
-- Name: portal_student_academic_history(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.portal_student_academic_history(p_student_no text) RETURNS TABLE(enrollment_id uuid, class_id uuid, term text, academic_year integer, class_name text, grade_level text, total_score numeric, class_rank bigint, grade_rank bigint, midterm_total numeric, midterm_class_rank bigint, midterm_grade_rank bigint, final_total numeric, final_class_rank bigint, final_grade_rank bigint, daily_total numeric, daily_class_rank bigint, daily_grade_rank bigint)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  with target_enrollments as (
    select e.id as enrollment_id, e.class_id, e.term, c.academic_year, c.class_name, c.grade_level, c.department
    from enrollments e
    join classes c on c.id = e.class_id
    where e.student_no = p_student_no
      and (
        is_system_admin()
        or has_department('academic')
        or exists (select 1 from classes c2 where c2.id = e.class_id and c2.homeroom_teacher_id = current_teacher_id())
        or is_linked_parent(p_student_no)
      )
  ),
  class_groups as (
    select distinct class_id, term from target_enrollments
  ),
  class_scope_enrollments as (
    select e.id, e.class_id, e.term
    from enrollments e
    join class_groups cg on cg.class_id = e.class_id and cg.term = e.term
  ),
  class_totals as (
    select * from scoped_student_totals(array(select id from class_scope_enrollments))
  ),
  class_ranked as (
    select
      cse.id as enrollment_id,
      ct.total_score,
      rank() over (partition by cse.class_id, cse.term order by ct.total_score desc) as class_rank,
      ct.midterm_total,
      rank() over (partition by cse.class_id, cse.term order by ct.midterm_average desc) as midterm_class_rank,
      ct.final_total,
      rank() over (partition by cse.class_id, cse.term order by ct.final_average desc) as final_class_rank,
      ct.daily_total,
      rank() over (partition by cse.class_id, cse.term order by ct.daily_average desc) as daily_class_rank
    from class_scope_enrollments cse
    left join class_totals ct on ct.enrollment_id = cse.id
  ),
  grade_groups as (
    select distinct academic_year, department, grade_level, term from target_enrollments
  ),
  grade_scope_enrollments as (
    select e.id, c.academic_year, c.department, c.grade_level, e.term
    from enrollments e
    join classes c on c.id = e.class_id
    join grade_groups gg
      on gg.academic_year = c.academic_year
      and gg.department = c.department
      and gg.grade_level = c.grade_level
      and gg.term = e.term
  ),
  grade_totals as (
    select * from scoped_student_totals(array(select id from grade_scope_enrollments))
  ),
  grade_ranked as (
    select
      gse.id as enrollment_id,
      rank() over (partition by gse.academic_year, gse.department, gse.grade_level, gse.term order by gt.total_score desc) as grade_rank,
      rank() over (partition by gse.academic_year, gse.department, gse.grade_level, gse.term order by gt.midterm_average desc) as midterm_grade_rank,
      rank() over (partition by gse.academic_year, gse.department, gse.grade_level, gse.term order by gt.final_average desc) as final_grade_rank,
      rank() over (partition by gse.academic_year, gse.department, gse.grade_level, gse.term order by gt.daily_average desc) as daily_grade_rank
    from grade_scope_enrollments gse
    left join grade_totals gt on gt.enrollment_id = gse.id
  ),
  locks as (
    select
      te.enrollment_id,
      exam_type_locked(te.class_id, te.academic_year, te.term, '期中考') as mid_locked,
      exam_type_locked(te.class_id, te.academic_year, te.term, '期末考') as fin_locked,
      exam_type_locked(te.class_id, te.academic_year, te.term, '平時分') as day_locked
    from target_enrollments te
  )
  select
    te.enrollment_id, te.class_id, te.term, te.academic_year, te.class_name, te.grade_level,
    case when l.mid_locked and l.fin_locked and l.day_locked then cr.total_score end,
    case when l.mid_locked and l.fin_locked and l.day_locked then cr.class_rank end,
    case when l.mid_locked and l.fin_locked and l.day_locked then gr.grade_rank end,
    case when l.mid_locked then cr.midterm_total end,
    case when l.mid_locked then cr.midterm_class_rank end,
    case when l.mid_locked then gr.midterm_grade_rank end,
    case when l.fin_locked then cr.final_total end,
    case when l.fin_locked then cr.final_class_rank end,
    case when l.fin_locked then gr.final_grade_rank end,
    case when l.day_locked then cr.daily_total end,
    case when l.day_locked then cr.daily_class_rank end,
    case when l.day_locked then gr.daily_grade_rank end
  from target_enrollments te
  join locks l on l.enrollment_id = te.enrollment_id
  left join class_ranked cr on cr.enrollment_id = te.enrollment_id
  left join grade_ranked gr on gr.enrollment_id = te.enrollment_id;
$$;

--
-- Name: FUNCTION portal_student_academic_history(p_student_no text); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.portal_student_academic_history(p_student_no text) IS '給「家長/學生查詢入口」（app/(app)/portal/page.tsx）用：一次回傳某個學生
   所有學期的總分＋班排名＋年級排名。改成 security definer（見本檔案開頭說明），
   函式內部才能真正看到全班/全年級的資料來算出正確排名，不會被家長本人的 RLS
   限制成「只看得到自己小孩」而讓排名永遠算成第1名。';

--
-- Name: recompute_inventory_stock(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.recompute_inventory_stock() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
declare
  v_item_id uuid;
begin
  v_item_id := coalesce(new.item_id, old.item_id);
  update general_inventory_items
  set quantity_on_hand = (
    select coalesce(sum(
      case direction
        when '入庫' then quantity
        when '歸還' then quantity
        when '售出' then -quantity
        when '借出' then -quantity
        when '報損' then -quantity
        when '調整' then quantity  -- 「調整」統一視為正向修正，要減少庫存請用「報損」
      end
    ), 0)
    from general_inventory_transactions
    where item_id = v_item_id
  )
  where id = v_item_id;
  return null;
end;
$$;

--
-- Name: reopen_submission_window(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.reopen_submission_window(p_id uuid, p_reason text DEFAULT NULL::text) RETURNS void
    LANGUAGE plpgsql
    AS $$
begin
  perform set_config('app.reopen_reason', coalesce(p_reason, ''), true);
  update submission_windows set is_locked = false where id = p_id;
end;
$$;

--
-- Name: report_card_any_locked(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.report_card_any_locked(p_enrollment_id uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select
    coalesce(
      exam_type_locked(c.id, c.academic_year, e.term, '期中考')
      or exam_type_locked(c.id, c.academic_year, e.term, '期末考')
      or exam_type_locked(c.id, c.academic_year, e.term, '平時分'),
      false
    )
  from enrollments e
  join classes c on c.id = e.class_id
  where e.id = p_enrollment_id;
$$;

--
-- Name: report_card_class_rank(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.report_card_class_rank(p_enrollment_id uuid) RETURNS bigint
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  with target as (
    select e.class_id, e.term
    from enrollments e
    where e.id = p_enrollment_id
  ),
  scoped as (
    select t.enrollment_id, rank() over (order by t.total_score desc) as class_rank
    from student_total_scores t
    join enrollments e on e.id = t.enrollment_id
    join target tg on e.class_id = tg.class_id and e.term = tg.term
    where not student_is_hidden(e.student_no)
  )
  select class_rank from scoped where enrollment_id = p_enrollment_id;
$$;

--
-- Name: report_card_class_size(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.report_card_class_size(p_enrollment_id uuid) RETURNS bigint
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select count(*)
  from enrollments e
  join enrollments target on target.class_id = e.class_id and target.term = e.term
  where target.id = p_enrollment_id
    and not student_is_hidden(e.student_no);
$$;

--
-- Name: report_card_exam_type_locks(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.report_card_exam_type_locks(p_enrollment_id uuid) RETURNS TABLE(mid_locked boolean, fin_locked boolean, day_locked boolean)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select
    exam_type_locked(c.id, c.academic_year, e.term, '期中考'),
    exam_type_locked(c.id, c.academic_year, e.term, '期末考'),
    exam_type_locked(c.id, c.academic_year, e.term, '平時分')
  from enrollments e
  join classes c on c.id = e.class_id
  where e.id = p_enrollment_id;
$$;

--
-- Name: report_card_grade_rank(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.report_card_grade_rank(p_enrollment_id uuid) RETURNS bigint
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  with target as (
    select c.academic_year, e.term, c.department, c.grade_level
    from enrollments e join classes c on c.id = e.class_id
    where e.id = p_enrollment_id
  ),
  scoped as (
    select t.enrollment_id, rank() over (order by t.total_score desc) as grade_rank
    from student_total_scores t
    join enrollments e on e.id = t.enrollment_id
    join classes c on c.id = e.class_id
    join target tg on c.academic_year = tg.academic_year and e.term = tg.term
      and c.department = tg.department and c.grade_level = tg.grade_level
    where not student_is_hidden(e.student_no)
  )
  select grade_rank from scoped where enrollment_id = p_enrollment_id;
$$;

--
-- Name: report_card_ready(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.report_card_ready(p_enrollment_id uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select
    coalesce(
      exam_type_locked(c.id, c.academic_year, e.term, '期中考')
      and exam_type_locked(c.id, c.academic_year, e.term, '期末考')
      and exam_type_locked(c.id, c.academic_year, e.term, '平時分'),
      false
    )
  from enrollments e
  join classes c on c.id = e.class_id
  where e.id = p_enrollment_id;
$$;

--
-- Name: run_club_lottery_priority(integer, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.run_club_lottery_priority(p_academic_year integer, p_term text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
declare
  v_rank int;
  v_max_rank int;
  v_club record;
  v_remaining int;
begin
  delete from club_members m using clubs c
    where m.club_id = c.id and c.academic_year = p_academic_year and c.term = p_term;

  select max(choice_rank) into v_max_rank from club_preferences where academic_year = p_academic_year and term = p_term;
  if v_max_rank is null then
    return;
  end if;

  for v_rank in 1..v_max_rank loop
    for v_club in
      select id, capacity from clubs where academic_year = p_academic_year and term = p_term and is_active
    loop
      select coalesce(v_club.capacity, 2147483647) - count(*) into v_remaining
      from club_members where club_id = v_club.id;

      if v_remaining <= 0 then
        continue;
      end if;

      insert into club_members (club_id, student_no)
      select v_club.id, p.student_no
      from club_preferences p
      where p.academic_year = p_academic_year and p.term = p_term
        and p.club_id = v_club.id and p.choice_rank = v_rank
        and not exists (
          select 1 from club_members m2
          join clubs c2 on c2.id = m2.club_id
          where m2.student_no = p.student_no and c2.academic_year = p_academic_year and c2.term = p_term
        )
      order by random()
      limit v_remaining
      on conflict do nothing;
    end loop;
  end loop;

  update club_selection_windows set is_finalized = true, finalized_at = now()
  where academic_year = p_academic_year and term = p_term;
end;
$$;

--
-- Name: run_club_lottery_random_number(integer, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.run_club_lottery_random_number(p_academic_year integer, p_term text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
declare
  v_student record;
  v_pref record;
  v_capacity int;
  v_current_count int;
begin
  delete from club_members m using clubs c
    where m.club_id = c.id and c.academic_year = p_academic_year and c.term = p_term;

  for v_student in (
    select distinct student_no from club_preferences
    where academic_year = p_academic_year and term = p_term
    order by random()
  ) loop
    for v_pref in (
      select club_id from club_preferences
      where academic_year = p_academic_year and term = p_term and student_no = v_student.student_no
      order by choice_rank
    ) loop
      -- 【2026-08-24 修正】原本這裡只查 capacity，沒有檢查這個社團是不是還
      -- 「有效」（is_active）——如果學生填志願序之後，教務處把某個社團停用
      -- （例如老師請假、社團取消開課），這裡完全沒過濾，還是可能把學生分發
      -- 進一個已經停用的社團。第一志願優先法（run_club_lottery_priority）
      -- 迴圈本身就有 `and is_active` 這個條件，這裡改成一致的做法：查不到
      -- （代表社團已停用或不存在）就直接當作「這個志願不能選」，繼續看
      -- 學生的下一個志願。
      select capacity into v_capacity from clubs where id = v_pref.club_id and is_active;
      if not found then
        continue;
      end if;
      select count(*) into v_current_count from club_members where club_id = v_pref.club_id;
      if v_capacity is null or v_current_count < v_capacity then
        insert into club_members (club_id, student_no) values (v_pref.club_id, v_student.student_no)
        on conflict do nothing;
        exit;
      end if;
    end loop;
  end loop;

  update club_selection_windows set is_finalized = true, finalized_at = now()
  where academic_year = p_academic_year and term = p_term;
end;
$$;

--
-- Name: scoped_student_totals(uuid[]); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.scoped_student_totals(p_enrollment_ids uuid[]) RETURNS TABLE(enrollment_id uuid, total_score numeric, midterm_total numeric, final_total numeric, daily_total numeric, midterm_average numeric, final_average numeric, daily_average numeric)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  with settings as (
    select coalesce(
      (select exclude_attendance_from_partial_scores from attendance_score_display_settings where id = true),
      false
    ) as exclude_attendance
  ),
  target as (
    select e.id as enrollment_id, e.class_id, e.term, c.academic_year, c.grade_level
    from enrollments e
    join classes c on c.id = e.class_id
    where e.id = any(p_enrollment_ids)
  ),
  att as (
    -- 【sql/102】原本每位學生各呼叫一次 plpgsql 的 attendance_score()（每次 3 條查詢），
    -- 改成一次集合式查詢算完整份名單，結果完全相同。
    select a.enrollment_id, a.score
    from attendance_scores_for_enrollments(p_enrollment_ids) a
  ),
  -- 含出缺席的完整科目集合：一律拿來算 total_score（成績總表的總分/排名，
  -- 永遠含出缺席，不受開關影響）。
  ss as (
    select enrollment_id, subject,
      max(score) filter (where exam_type = '期中考') as midterm,
      max(score) filter (where exam_type = '期末考') as final,
      max(score) filter (where exam_type = '平時分') as daily
    from scores
    where enrollment_id = any(p_enrollment_ids)
      and subject not in ('全勤', '出缺席')
    group by enrollment_id, subject
    union all
    select t.enrollment_id, cu.subject, att.score, att.score, att.score
    from target t
    join att on att.enrollment_id = t.enrollment_id
    join lateral (
      select cu.subject, cu.weight
      from curriculum cu
      where cu.academic_year = t.academic_year
        and cu.term = t.term
        and cu.grade_level = t.grade_level
        and cu.subject in ('全勤', '出缺席')
        and cu.weight > 0
      order by (cu.subject = '出缺席') desc
      limit 1
    ) cu on true
  ),
  -- 「顯示用」子集合：只餵期中/期末/平時三部分。開關關閉時 ss_display＝ss（跟
  -- total_score 用同一份資料，行為不變）；開關開啟時濾掉出缺席這個科目。
  ss_display as (
    select ss.* from ss, settings
    where not (settings.exclude_attendance and ss.subject in ('全勤', '出缺席'))
  ),
  ss_weighted as (
    select
      ss.enrollment_id, ss.subject,
      (coalesce(ss.midterm, 0) * gr.midterm_weight
        + coalesce(ss.final, 0) * gr.final_weight
        + coalesce(ss.daily, 0) * gr.daily_weight) as subject_weighted_score
    from ss
    join target t on t.enrollment_id = ss.enrollment_id
    join grading_rules gr on gr.academic_year = t.academic_year and gr.term = t.term
  ),
  base as (
    select
      ssw.enrollment_id,
      sum(ssw.subject_weighted_score * cu.weight) as base_total
    from ss_weighted ssw
    join target t on t.enrollment_id = ssw.enrollment_id
    join curriculum cu
      on cu.academic_year = t.academic_year
      and cu.term = t.term
      and cu.grade_level = t.grade_level
      and cu.subject = ssw.subject
      and cu.weight > 0
    group by ssw.enrollment_id
  ),
  display_totals as (
    select
      ssd.enrollment_id,
      sum(ssd.midterm) filter (where ssd.midterm is not null) as midterm_total,
      sum(ssd.final) filter (where ssd.final is not null) as final_total,
      sum(ssd.daily) filter (where ssd.daily is not null) as daily_total,
      round(sum(ssd.midterm * cu.weight) filter (where ssd.midterm is not null), 2) as midterm_average,
      round(sum(ssd.final * cu.weight) filter (where ssd.final is not null), 2) as final_average,
      round(sum(ssd.daily * cu.weight) filter (where ssd.daily is not null), 2) as daily_average
    from ss_display ssd
    join target t on t.enrollment_id = ssd.enrollment_id
    join curriculum cu
      on cu.academic_year = t.academic_year
      and cu.term = t.term
      and cu.grade_level = t.grade_level
      and cu.subject = ssd.subject
      and cu.weight > 0
    group by ssd.enrollment_id
  ),
  adj as (
    select t.enrollment_id, coalesce(sum(sa.points), 0) as adjustment_total
    from target t
    left join score_adjustments sa
      on sa.academic_year = t.academic_year
      and sa.term = t.term
      and sa.is_active = true
    group by t.enrollment_id
  )
  select
    b.enrollment_id,
    round(b.base_total + a.adjustment_total, 2) as total_score,
    dt.midterm_total, dt.final_total, dt.daily_total,
    dt.midterm_average, dt.final_average, dt.daily_average
  from base b
  join adj a on a.enrollment_id = b.enrollment_id
  left join display_totals dt on dt.enrollment_id = b.enrollment_id;
$$;

--
-- Name: FUNCTION scoped_student_totals(p_enrollment_ids uuid[]); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.scoped_student_totals(p_enrollment_ids uuid[]) IS '班排名/年級排名/家長入口共用的計算來源（sql/63）。total_score（成績總表的總分/
   排名）永遠含出缺席真實成績，不受開關影響；midterm/final/daily 的 total 與
   average（期中/期末/平時三部分）才依 attendance_score_display_settings.
   exclude_attendance_from_partial_scores 這個開關排除出缺席（見 sql/68，取代
   sql/67 讓 total_score 也一起排除的錯誤行為，退回 sql/66 一開始的設計）。
   正式成績單（student_total_scores）是完全獨立的另一條計算路徑，不受這個
   開關影響，永遠是含出缺席的真實成績。';

--
-- Name: scores_locked(uuid, integer, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.scores_locked(p_class_id uuid, p_academic_year integer, p_term text, p_exam_type text) RETURNS boolean
    LANGUAGE sql STABLE
    AS $$
  select exists (
    select 1 from submission_windows sw
    where sw.data_type = p_exam_type
      and sw.scope = '班級'
      and sw.scope_ref = p_class_id::text
      and sw.academic_year = p_academic_year
      and sw.term = p_term
      and sw.is_locked = true
  );
$$;

--
-- Name: set_current_academic_term(integer, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_current_academic_term(p_academic_year integer, p_term text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
begin
  if not (is_system_admin() or has_department('dev')) then
    raise exception '只有開發人員可以切換目前生效學年學期';
  end if;
  update academic_terms set is_current = false where is_current = true;
  update academic_terms set is_current = true, status = '進行中'
    where academic_year = p_academic_year and term = p_term;
  if not found then
    raise exception '找不到學年度 % % ，請先新增這個學年學期', p_academic_year, p_term;
  end if;
end;
$$;

--
-- Name: student_current_status(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.student_current_status(p_student_no text) RETURNS public.enrollment_status_type
    LANGUAGE sql STABLE
    AS $$
  select status
  from student_status_changes
  where student_no = p_student_no
  order by effective_date desc, created_at desc
  limit 1;
$$;

--
-- Name: student_is_hidden(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.student_is_hidden(p_student_no text) RETURNS boolean
    LANGUAGE sql STABLE
    AS $$
  select coalesce(
    student_current_status(p_student_no) in ('休學', '轉學', '退學', '畢業', '肄業'),
    false
  );
$$;

--
-- Name: submission_window_locked(uuid, integer, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.submission_window_locked(p_class_id uuid, p_academic_year integer, p_term text, p_data_type text) RETURNS boolean
    LANGUAGE sql STABLE
    AS $$
  select coalesce(
    (
      select sw.is_locked or (sw.closes_at is not null and sw.closes_at < now())
      from submission_windows sw
      where sw.data_type = p_data_type and sw.scope = '班級'
        and sw.scope_ref = p_class_id::text
        and sw.academic_year = p_academic_year and sw.term = p_term
      limit 1
    ),
    (
      select sw.is_locked or (sw.closes_at is not null and sw.closes_at < now())
      from submission_windows sw
      join classes c on c.id = p_class_id
      where sw.data_type = p_data_type and sw.scope = '部別'
        and sw.scope_ref = c.department
        and sw.academic_year = p_academic_year and sw.term = p_term
      limit 1
    ),
    (
      select sw.is_locked or (sw.closes_at is not null and sw.closes_at < now())
      from submission_windows sw
      where sw.data_type = p_data_type and sw.scope = '全校'
        and sw.academic_year = p_academic_year and sw.term = p_term
      limit 1
    ),
    false
  );
$$;

--
-- Name: FUNCTION submission_window_locked(p_class_id uuid, p_academic_year integer, p_term text, p_data_type text); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.submission_window_locked(p_class_id uuid, p_academic_year integer, p_term text, p_data_type text) IS '成績/出缺勤某類資料在某班是否已鎖定（手動鎖定 或 開放結束時間已過，兩者任一成立），供前端寫入前檢查用，也是 exam_type_locked() 的實作。';

--
-- Name: sync_club_attendance_to_attendance(uuid, text, date); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.sync_club_attendance_to_attendance(p_club_id uuid, p_student_no text, p_record_date date) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
declare
  v_period int;
  v_status attendance_status;
  v_recorded_by uuid;
begin
  select period_no into v_period from clubs where id = p_club_id;
  if v_period is null then
    return;
  end if;

  select status, recorded_by into v_status, v_recorded_by
  from club_attendance where club_id = p_club_id and student_no = p_student_no and record_date = p_record_date;
  if v_status is null then
    return;
  end if;

  insert into attendance (student_no, record_date, period_no, status, recorded_by)
  values (p_student_no, p_record_date, v_period, v_status, v_recorded_by)
  on conflict (student_no, record_date, period_no)
  do update set status = excluded.status, recorded_by = excluded.recorded_by, updated_at = now();
end;
$$;

--
-- Name: sync_club_score_to_scores(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.sync_club_score_to_scores(p_club_id uuid, p_student_no text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
declare
  v_club record;
  v_enrollment_id uuid;
  v_score record;
begin
  select * into v_club from clubs where id = p_club_id;
  if v_club is null then
    return;
  end if;

  select * into v_score from club_scores where club_id = p_club_id and student_no = p_student_no;
  if v_score is null then
    return;
  end if;

  select e.id into v_enrollment_id
  from enrollments e
  join classes c on c.id = e.class_id
  where e.student_no = p_student_no
    and e.term = v_club.term
    and c.academic_year = v_club.academic_year
  order by e.id desc
  limit 1;

  if v_enrollment_id is null then
    raise notice '學生 % 在 %學年度 %，找不到對應班級學籍，社團成績無法回寫學期總表（請確認學籍資料）', p_student_no, v_club.academic_year, v_club.term;
    return;
  end if;

  if v_score.score_midterm is not null then
    insert into scores (enrollment_id, exam_type, subject, score, recorded_by)
    values (v_enrollment_id, '期中考', '才藝', v_score.score_midterm, v_score.recorded_by)
    on conflict (enrollment_id, exam_type, subject)
    do update set score = excluded.score, recorded_by = excluded.recorded_by, updated_at = now();
  end if;

  if v_score.score_final is not null then
    insert into scores (enrollment_id, exam_type, subject, score, recorded_by)
    values (v_enrollment_id, '期末考', '才藝', v_score.score_final, v_score.recorded_by)
    on conflict (enrollment_id, exam_type, subject)
    do update set score = excluded.score, recorded_by = excluded.recorded_by, updated_at = now();
  end if;

  if v_score.score_daily is not null then
    insert into scores (enrollment_id, exam_type, subject, score, recorded_by)
    values (v_enrollment_id, '平時分', '才藝', v_score.score_daily, v_score.recorded_by)
    on conflict (enrollment_id, exam_type, subject)
    do update set score = excluded.score, recorded_by = excluded.recorded_by, updated_at = now();
  end if;
end;
$$;

--
-- Name: teacher_teaches_student(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.teacher_teaches_student(p_student_no text) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select exists (
    select 1
    from enrollments e
    join classes c on c.id = e.class_id
    where e.student_no = p_student_no
      and (
        c.homeroom_teacher_id = current_teacher_id()
        or exists (
          select 1 from class_schedule cs
          where cs.class_id = e.class_id and cs.teacher_id = current_teacher_id()
        )
      )
  );
$$;

--
-- Name: trg_apply_on_approve(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.trg_apply_on_approve() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
begin
  if new.status = '已核准' and old.status <> '已核准' then
    perform apply_pending_change(new.id);
  end if;
  return new;
end;
$$;

--
-- Name: trg_auto_assign_admin_departments(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.trg_auto_assign_admin_departments() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
begin
  if NEW.role in ('admin_a', 'admin_b') then
    insert into app_user_departments (app_user_id, department, level)
    values
      (NEW.id, 'dev', 'lead'),
      (NEW.id, 'academic', 'lead'),
      (NEW.id, 'discipline', 'lead'),
      (NEW.id, 'general', 'lead')
    on conflict (app_user_id, department) do nothing;
  end if;
  return NEW;
end;
$$;

--
-- Name: trg_club_attendance_sync(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.trg_club_attendance_sync() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
begin
  perform sync_club_attendance_to_attendance(new.club_id, new.student_no, new.record_date);
  return new;
end;
$$;

--
-- Name: trg_club_scores_sync(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.trg_club_scores_sync() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
begin
  if new.is_submitted then
    perform sync_club_score_to_scores(new.club_id, new.student_no);
  end if;
  return new;
end;
$$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: academic_terms; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.academic_terms (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    academic_year integer NOT NULL,
    term text NOT NULL,
    term_start_date date,
    term_end_date date,
    is_current boolean DEFAULT false NOT NULL,
    status text DEFAULT '規劃中'::text NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT academic_terms_status_check CHECK ((status = ANY (ARRAY['規劃中'::text, '進行中'::text, '已結束'::text]))),
    CONSTRAINT academic_terms_term_check CHECK ((term = ANY (ARRAY['上學期'::text, '下學期'::text])))
);

--
-- Name: account_audit_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.account_audit_log (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    target_user_id uuid NOT NULL,
    action text NOT NULL,
    old_value text,
    new_value text,
    changed_by uuid,
    changed_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT account_audit_log_action_check CHECK ((action = ANY (ARRAY['role_change'::text, 'password_reset'::text, 'email_change'::text])))
);

--
-- Name: admin_module_categories; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.admin_module_categories (
    module_key text NOT NULL,
    category text NOT NULL,
    updated_by uuid,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    CONSTRAINT admin_module_categories_category_check CHECK ((category = ANY (ARRAY['academic'::text, 'discipline'::text, 'general'::text, 'teacher'::text, 'parent_student'::text, 'dev'::text])))
);

--
-- Name: admin_module_order; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.admin_module_order (
    module_key text NOT NULL,
    sort_order integer NOT NULL,
    updated_by uuid,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

--
-- Name: app_user_departments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.app_user_departments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    app_user_id uuid NOT NULL,
    department public.admin_department NOT NULL,
    level public.department_level DEFAULT 'staff'::public.department_level NOT NULL,
    granted_by uuid,
    granted_at timestamp with time zone DEFAULT now() NOT NULL
);

--
-- Name: app_user_module_overrides; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.app_user_module_overrides (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    app_user_id uuid NOT NULL,
    module_key text NOT NULL,
    visible boolean NOT NULL,
    updated_by uuid,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

--
-- Name: app_users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.app_users (
    id uuid NOT NULL,
    name text NOT NULL,
    role public.user_role NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    must_change_password boolean DEFAULT false NOT NULL
);

--
-- Name: attendance; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.attendance (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    student_no text NOT NULL,
    record_date date NOT NULL,
    period_no integer NOT NULL,
    status public.attendance_status DEFAULT '出席'::public.attendance_status NOT NULL,
    recorded_by uuid,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

--
-- Name: attendance_alert_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.attendance_alert_settings (
    id integer DEFAULT 1 NOT NULL,
    threshold_periods integer DEFAULT 3 NOT NULL,
    updated_by uuid,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    exam_deduction_absence_threshold integer,
    backfill_overdue_days integer DEFAULT 7 NOT NULL,
    CONSTRAINT attendance_alert_settings_singleton CHECK ((id = 1))
);

--
-- Name: COLUMN attendance_alert_settings.exam_deduction_absence_threshold; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.attendance_alert_settings.exam_deduction_absence_threshold IS '事假+病假+曠課累計節數達到此門檻，視為可能觸及扣考資格（僅供提醒，實際扣考由訓導處人工認定）';

--
-- Name: COLUMN attendance_alert_settings.backfill_overdue_days; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.attendance_alert_settings.backfill_overdue_days IS '出缺席記錄距上課日超過幾天視為逾期，逾期需送「開放申請」才能補登/修改';

--
-- Name: attendance_audit_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.attendance_audit_log (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    attendance_id uuid NOT NULL,
    changed_by uuid,
    changed_at timestamp with time zone DEFAULT now() NOT NULL,
    old_value text,
    new_value text
);

--
-- Name: attendance_notifications; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.attendance_notifications (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    student_no text NOT NULL,
    absence_count integer NOT NULL,
    threshold_snapshot integer NOT NULL,
    decision text NOT NULL,
    note text,
    decided_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT attendance_notifications_decision_check CHECK ((decision = ANY (ARRAY['已寄送'::text, '不寄送'::text])))
);

--
-- Name: attendance_score_display_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.attendance_score_display_settings (
    id boolean DEFAULT true NOT NULL,
    exclude_attendance_from_partial_scores boolean DEFAULT false NOT NULL,
    updated_by uuid,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT attendance_score_display_settings_singleton CHECK (id)
);

--
-- Name: backups; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.backups (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    created_by uuid,
    kind text NOT NULL,
    tables jsonb,
    table_counts jsonb NOT NULL,
    restored_at timestamp with time zone,
    restored_by uuid,
    storage_path text,
    CONSTRAINT backups_kind_check CHECK ((kind = ANY (ARRAY['自動'::text, '手動'::text, '上傳'::text]))),
    CONSTRAINT backups_tables_or_storage_chk CHECK (((tables IS NOT NULL) OR (storage_path IS NOT NULL)))
);

--
-- Name: bulletin_posts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.bulletin_posts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    title text NOT NULL,
    thumbnail_url text,
    content text DEFAULT ''::text NOT NULL,
    is_published boolean DEFAULT false NOT NULL,
    published_at timestamp with time zone,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

--
-- Name: classes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.classes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    class_name text NOT NULL,
    academic_year integer NOT NULL,
    department text NOT NULL,
    grade_level text NOT NULL,
    homeroom_teacher_id uuid
);

--
-- Name: curriculum; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.curriculum (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    academic_year integer NOT NULL,
    term text NOT NULL,
    grade_level text NOT NULL,
    subject text NOT NULL,
    weight numeric(4,3) NOT NULL,
    periods integer,
    CONSTRAINT curriculum_term_check CHECK ((term = ANY (ARRAY['上學期'::text, '下學期'::text])))
);

--
-- Name: enrollments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.enrollments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    student_no text NOT NULL,
    class_id uuid NOT NULL,
    term text NOT NULL,
    seat_no integer NOT NULL,
    is_current boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT enrollments_term_check CHECK ((term = ANY (ARRAY['上學期'::text, '下學期'::text])))
);

--
-- Name: grading_rules; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.grading_rules (
    academic_year integer NOT NULL,
    term text NOT NULL,
    midterm_weight numeric(4,3) DEFAULT 0.35 NOT NULL,
    final_weight numeric(4,3) DEFAULT 0.35 NOT NULL,
    daily_weight numeric(4,3) DEFAULT 0.30 NOT NULL,
    CONSTRAINT grading_rules_term_check CHECK ((term = ANY (ARRAY['上學期'::text, '下學期'::text])))
);

--
-- Name: score_adjustments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.score_adjustments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    academic_year integer NOT NULL,
    term text NOT NULL,
    name text NOT NULL,
    points numeric(5,2) NOT NULL,
    is_active boolean DEFAULT false NOT NULL,
    CONSTRAINT score_adjustments_term_check CHECK ((term = ANY (ARRAY['上學期'::text, '下學期'::text])))
);

--
-- Name: scores; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.scores (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    enrollment_id uuid NOT NULL,
    exam_type public.exam_type NOT NULL,
    subject text NOT NULL,
    score numeric(5,2),
    recorded_by uuid,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT scores_score_check CHECK (((score >= (0)::numeric) AND (score <= (100)::numeric)))
);

--
-- Name: student_adjustments; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.student_adjustments WITH (security_invoker='true') AS
 SELECT e.id AS enrollment_id,
    COALESCE(sum(sa.points), (0)::numeric) AS adjustment_total
   FROM ((public.enrollments e
     JOIN public.classes c ON ((c.id = e.class_id)))
     LEFT JOIN public.score_adjustments sa ON (((sa.academic_year = c.academic_year) AND (sa.term = e.term) AND (sa.is_active = true))))
  GROUP BY e.id;

--
-- Name: subject_scores; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.subject_scores WITH (security_invoker='true') AS
 SELECT scores.enrollment_id,
    scores.subject,
    max(scores.score) FILTER (WHERE (scores.exam_type = '期中考'::public.exam_type)) AS midterm,
    max(scores.score) FILTER (WHERE (scores.exam_type = '期末考'::public.exam_type)) AS final,
    max(scores.score) FILTER (WHERE (scores.exam_type = '平時分'::public.exam_type)) AS daily
   FROM public.scores
  WHERE (scores.subject <> ALL (ARRAY['全勤'::text, '出缺席'::text]))
  GROUP BY scores.enrollment_id, scores.subject
UNION ALL
 SELECT e.id AS enrollment_id,
    cu.subject,
    public.attendance_score(e.id) AS midterm,
    public.attendance_score(e.id) AS final,
    public.attendance_score(e.id) AS daily
   FROM ((public.enrollments e
     JOIN public.classes c ON ((c.id = e.class_id)))
     JOIN LATERAL ( SELECT cu_1.subject,
            cu_1.weight
           FROM public.curriculum cu_1
          WHERE ((cu_1.academic_year = c.academic_year) AND (cu_1.term = e.term) AND (cu_1.grade_level = c.grade_level) AND (cu_1.subject = ANY (ARRAY['全勤'::text, '出缺席'::text])) AND (cu_1.weight > (0)::numeric))
          ORDER BY (cu_1.subject = '出缺席'::text) DESC
         LIMIT 1) cu ON (true));

--
-- Name: subject_weighted_scores; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.subject_weighted_scores WITH (security_invoker='true') AS
 SELECT ss.enrollment_id,
    ss.subject,
    ss.midterm,
    ss.final,
    ss.daily,
    (((COALESCE(ss.midterm, (0)::numeric) * gr.midterm_weight) + (COALESCE(ss.final, (0)::numeric) * gr.final_weight)) + (COALESCE(ss.daily, (0)::numeric) * gr.daily_weight)) AS subject_weighted_score
   FROM (((public.subject_scores ss
     JOIN public.enrollments e ON ((e.id = ss.enrollment_id)))
     JOIN public.classes c ON ((c.id = e.class_id)))
     JOIN public.grading_rules gr ON (((gr.academic_year = c.academic_year) AND (gr.term = e.term))));

--
-- Name: student_base_scores; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.student_base_scores WITH (security_invoker='true') AS
 SELECT sw.enrollment_id,
    sum((sw.subject_weighted_score * cu.weight)) AS base_total
   FROM (((public.subject_weighted_scores sw
     JOIN public.enrollments e ON ((e.id = sw.enrollment_id)))
     JOIN public.classes c ON ((c.id = e.class_id)))
     JOIN public.curriculum cu ON (((cu.academic_year = c.academic_year) AND (cu.term = e.term) AND (cu.grade_level = c.grade_level) AND (cu.subject = sw.subject))))
  GROUP BY sw.enrollment_id;

--
-- Name: student_examtype_totals; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.student_examtype_totals WITH (security_invoker='true') AS
 SELECT ss.enrollment_id,
    sum(ss.midterm) FILTER (WHERE (ss.midterm IS NOT NULL)) AS midterm_total,
    sum(ss.final) FILTER (WHERE (ss.final IS NOT NULL)) AS final_total,
    sum(ss.daily) FILTER (WHERE (ss.daily IS NOT NULL)) AS daily_total,
    round(sum((ss.midterm * cu.weight)) FILTER (WHERE (ss.midterm IS NOT NULL)), 2) AS midterm_average,
    round(sum((ss.final * cu.weight)) FILTER (WHERE (ss.final IS NOT NULL)), 2) AS final_average,
    round(sum((ss.daily * cu.weight)) FILTER (WHERE (ss.daily IS NOT NULL)), 2) AS daily_average
   FROM (((public.subject_scores ss
     JOIN public.enrollments e ON ((e.id = ss.enrollment_id)))
     JOIN public.classes c ON ((c.id = e.class_id)))
     JOIN public.curriculum cu ON (((cu.academic_year = c.academic_year) AND (cu.term = e.term) AND (cu.grade_level = c.grade_level) AND (cu.subject = ss.subject))))
  WHERE (cu.weight > (0)::numeric)
  GROUP BY ss.enrollment_id;

--
-- Name: student_total_scores; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.student_total_scores WITH (security_invoker='true') AS
 SELECT b.enrollment_id,
    round(b.base_total, 2) AS base_total,
    a.adjustment_total,
    round((b.base_total + a.adjustment_total), 2) AS total_score
   FROM (public.student_base_scores b
     JOIN public.student_adjustments a ON ((a.enrollment_id = b.enrollment_id)));

--
-- Name: students; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.students (
    student_no text NOT NULL,
    name text NOT NULL,
    gender text,
    thai_name text,
    dob date,
    id_number text,
    nationality text,
    religion text,
    blood_type text,
    address text,
    phone text,
    photo_url text,
    previous_school text,
    previous_school_grade text,
    updated_at timestamp with time zone,
    updated_by uuid
);

--
-- Name: class_rankings; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.class_rankings WITH (security_invoker='true') AS
 WITH distinct_classes AS (
         SELECT DISTINCT e.class_id,
            c.academic_year,
            e.term
           FROM (public.enrollments e
             JOIN public.classes c ON ((c.id = e.class_id)))
        ), class_locks AS (
         SELECT distinct_classes.class_id,
            distinct_classes.academic_year,
            distinct_classes.term,
            public.exam_type_locked(distinct_classes.class_id, distinct_classes.academic_year, distinct_classes.term, '期中考'::text) AS mid_locked,
            public.exam_type_locked(distinct_classes.class_id, distinct_classes.academic_year, distinct_classes.term, '期末考'::text) AS fin_locked,
            public.exam_type_locked(distinct_classes.class_id, distinct_classes.academic_year, distinct_classes.term, '平時分'::text) AS day_locked
           FROM distinct_classes
        ), ranked AS (
         SELECT t.enrollment_id,
            e.class_id,
            e.term,
            c.academic_year,
            st.name,
            e.seat_no,
            e.student_no,
            t.total_score,
            rank() OVER (PARTITION BY e.class_id, e.term ORDER BY t.total_score DESC) AS class_rank,
            et.midterm_total,
            rank() OVER (PARTITION BY e.class_id, e.term ORDER BY et.midterm_average DESC) AS midterm_class_rank,
            et.final_total,
            rank() OVER (PARTITION BY e.class_id, e.term ORDER BY et.final_average DESC) AS final_class_rank,
            et.daily_total,
            rank() OVER (PARTITION BY e.class_id, e.term ORDER BY et.daily_average DESC) AS daily_class_rank,
            et.midterm_average,
            et.final_average,
            et.daily_average
           FROM ((((public.student_total_scores t
             JOIN public.enrollments e ON ((e.id = t.enrollment_id)))
             JOIN public.classes c ON ((c.id = e.class_id)))
             JOIN public.students st ON ((st.student_no = e.student_no)))
             LEFT JOIN public.student_examtype_totals et ON ((et.enrollment_id = t.enrollment_id)))
        )
 SELECT ranked.enrollment_id,
    ranked.class_id,
    ranked.term,
    ranked.academic_year,
    ranked.name,
    ranked.seat_no,
    ranked.student_no,
        CASE
            WHEN (cl.mid_locked AND cl.fin_locked AND cl.day_locked) THEN ranked.total_score
            ELSE NULL::numeric
        END AS total_score,
        CASE
            WHEN (cl.mid_locked AND cl.fin_locked AND cl.day_locked) THEN ranked.class_rank
            ELSE NULL::bigint
        END AS class_rank,
        CASE
            WHEN cl.mid_locked THEN ranked.midterm_total
            ELSE NULL::numeric
        END AS midterm_total,
        CASE
            WHEN cl.mid_locked THEN ranked.midterm_class_rank
            ELSE NULL::bigint
        END AS midterm_class_rank,
        CASE
            WHEN cl.fin_locked THEN ranked.final_total
            ELSE NULL::numeric
        END AS final_total,
        CASE
            WHEN cl.fin_locked THEN ranked.final_class_rank
            ELSE NULL::bigint
        END AS final_class_rank,
        CASE
            WHEN cl.day_locked THEN ranked.daily_total
            ELSE NULL::numeric
        END AS daily_total,
        CASE
            WHEN cl.day_locked THEN ranked.daily_class_rank
            ELSE NULL::bigint
        END AS daily_class_rank,
        CASE
            WHEN cl.mid_locked THEN ranked.midterm_average
            ELSE NULL::numeric
        END AS midterm_average,
        CASE
            WHEN cl.fin_locked THEN ranked.final_average
            ELSE NULL::numeric
        END AS final_average,
        CASE
            WHEN cl.day_locked THEN ranked.daily_average
            ELSE NULL::numeric
        END AS daily_average
   FROM (ranked
     JOIN class_locks cl ON (((cl.class_id = ranked.class_id) AND (cl.academic_year = ranked.academic_year) AND (cl.term = ranked.term))))
  WHERE (public.is_system_admin() OR public.has_department('academic'::public.admin_department) OR (EXISTS ( SELECT 1
           FROM public.classes c2
          WHERE ((c2.id = ranked.class_id) AND (c2.homeroom_teacher_id = public.current_teacher_id())))) OR public.is_linked_parent(ranked.student_no));

--
-- Name: class_schedule; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.class_schedule (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    class_id uuid NOT NULL,
    academic_year integer NOT NULL,
    term text NOT NULL,
    weekday integer,
    period_no integer,
    subject text NOT NULL,
    teacher_id uuid NOT NULL,
    CONSTRAINT class_schedule_term_check CHECK ((term = ANY (ARRAY['上學期'::text, '下學期'::text]))),
    CONSTRAINT class_schedule_weekday_check CHECK (((weekday >= 1) AND (weekday <= 6)))
);

--
-- Name: clock_day_overrides; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.clock_day_overrides (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    device_code integer NOT NULL,
    punch_date date NOT NULL,
    status text NOT NULL,
    note text,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT clock_day_overrides_status_check CHECK ((status = ANY (ARRAY['正常'::text, '請假'::text, '公出'::text, '休假'::text])))
);

--
-- Name: clock_employee_map; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.clock_employee_map (
    device_code integer NOT NULL,
    device_name text NOT NULL,
    display_name text,
    teacher_id uuid,
    shift_ids uuid[] DEFAULT '{}'::uuid[] NOT NULL,
    active boolean DEFAULT true NOT NULL,
    note text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

--
-- Name: clock_holidays; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.clock_holidays (
    holiday_date date NOT NULL,
    name text DEFAULT '放假'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

--
-- Name: clock_import_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.clock_import_log (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    source text NOT NULL,
    file_name text,
    rows_received integer DEFAULT 0 NOT NULL,
    rows_inserted integer DEFAULT 0 NOT NULL,
    rows_duplicate integer DEFAULT 0 NOT NULL,
    rows_invalid integer DEFAULT 0 NOT NULL,
    new_codes integer[] DEFAULT '{}'::integer[] NOT NULL,
    first_punch timestamp with time zone,
    last_punch timestamp with time zone,
    created_by uuid,
    error text
);

--
-- Name: clock_records; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.clock_records (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    device_code integer NOT NULL,
    device_name text,
    punched_at timestamp with time zone NOT NULL,
    punch_date date NOT NULL,
    direction text,
    machine_no integer DEFAULT 0 NOT NULL,
    method text,
    source text DEFAULT 'sync'::text NOT NULL,
    voided boolean DEFAULT false NOT NULL,
    voided_reason text,
    voided_by uuid,
    voided_at timestamp with time zone,
    note text,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT clock_records_source_check CHECK ((source = ANY (ARRAY['sync'::text, 'upload'::text, 'manual'::text])))
);

--
-- Name: clock_shifts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.clock_shifts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    start_time time without time zone NOT NULL,
    end_time time without time zone NOT NULL,
    late_grace_min integer DEFAULT 10 NOT NULL,
    early_grace_min integer DEFAULT 0 NOT NULL,
    work_days integer[] DEFAULT '{1,2,3,4,5}'::integer[] NOT NULL,
    window_before_min integer DEFAULT 180 NOT NULL,
    window_after_min integer DEFAULT 240 NOT NULL,
    active boolean DEFAULT true NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT clock_shifts_early_grace_min_check CHECK ((early_grace_min >= 0)),
    CONSTRAINT clock_shifts_late_grace_min_check CHECK ((late_grace_min >= 0)),
    CONSTRAINT clock_shifts_window_after_min_check CHECK ((window_after_min >= 0)),
    CONSTRAINT clock_shifts_window_before_min_check CHECK ((window_before_min >= 0))
);

--
-- Name: club_attendance; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.club_attendance (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    club_id uuid NOT NULL,
    student_no text NOT NULL,
    record_date date NOT NULL,
    status public.attendance_status DEFAULT '出席'::public.attendance_status NOT NULL,
    recorded_by uuid,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

--
-- Name: club_members; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.club_members (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    club_id uuid NOT NULL,
    student_no text NOT NULL,
    status text DEFAULT '在社'::text NOT NULL,
    joined_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT club_members_status_check CHECK ((status = ANY (ARRAY['在社'::text, '退社'::text])))
);

--
-- Name: club_preferences; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.club_preferences (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    academic_year integer NOT NULL,
    term text NOT NULL,
    student_no text NOT NULL,
    club_id uuid NOT NULL,
    choice_rank integer NOT NULL,
    submitted_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT club_preferences_choice_rank_check CHECK (((choice_rank >= 1) AND (choice_rank <= 10))),
    CONSTRAINT club_preferences_term_check CHECK ((term = ANY (ARRAY['上學期'::text, '下學期'::text])))
);

--
-- Name: club_scores; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.club_scores (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    club_id uuid NOT NULL,
    student_no text NOT NULL,
    score_midterm numeric(5,2),
    score_final numeric(5,2),
    score_daily numeric(5,2),
    is_submitted boolean DEFAULT false NOT NULL,
    submitted_at timestamp with time zone,
    recorded_by uuid,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT club_scores_score_daily_check CHECK (((score_daily >= (0)::numeric) AND (score_daily <= (100)::numeric))),
    CONSTRAINT club_scores_score_final_check CHECK (((score_final >= (0)::numeric) AND (score_final <= (100)::numeric))),
    CONSTRAINT club_scores_score_midterm_check CHECK (((score_midterm >= (0)::numeric) AND (score_midterm <= (100)::numeric)))
);

--
-- Name: club_selection_windows; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.club_selection_windows (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    academic_year integer NOT NULL,
    term text NOT NULL,
    method text NOT NULL,
    max_choices integer,
    opens_at timestamp with time zone NOT NULL,
    closes_at timestamp with time zone,
    is_finalized boolean DEFAULT false NOT NULL,
    finalized_at timestamp with time zone,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT club_selection_windows_method_check CHECK ((method = ANY (ARRAY['志願序_第一志願優先'::text, '志願序_隨機亂數'::text, '即時搶選'::text]))),
    CONSTRAINT club_selection_windows_term_check CHECK ((term = ANY (ARRAY['上學期'::text, '下學期'::text])))
);

--
-- Name: clubs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.clubs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    academic_year integer NOT NULL,
    term text NOT NULL,
    teacher_id uuid,
    external_teacher_name text,
    capacity integer,
    period_no integer,
    description text,
    is_active boolean DEFAULT true NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT clubs_term_check CHECK ((term = ANY (ARRAY['上學期'::text, '下學期'::text])))
);

--
-- Name: club_submission_status; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.club_submission_status AS
 SELECT id AS club_id,
    name AS club_name,
    academic_year,
    term,
    teacher_id,
    ( SELECT count(*) AS count
           FROM public.club_members m
          WHERE ((m.club_id = c.id) AND (m.status = '在社'::text))) AS member_count,
    ( SELECT count(DISTINCT s.student_no) AS count
           FROM public.club_scores s
          WHERE ((s.club_id = c.id) AND s.is_submitted)) AS submitted_score_count,
    ( SELECT max(a.record_date) AS max
           FROM public.club_attendance a
          WHERE (a.club_id = c.id)) AS last_attendance_date
   FROM public.clubs c
  WHERE (is_active = true);

--
-- Name: conduct_event_requests; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.conduct_event_requests (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    batch_id uuid NOT NULL,
    student_no text NOT NULL,
    event_date date NOT NULL,
    event_type text NOT NULL,
    count integer NOT NULL,
    points numeric(6,2) NOT NULL,
    reason text NOT NULL,
    requested_by uuid NOT NULL,
    requested_at timestamp with time zone DEFAULT now() NOT NULL,
    status text DEFAULT '待B審核'::text NOT NULL,
    b_decision text,
    b_by uuid,
    b_at timestamp with time zone,
    a_decision text,
    a_by uuid,
    a_at timestamp with time zone,
    s_decision text,
    s_by uuid,
    s_at timestamp with time zone,
    applied_at timestamp with time zone,
    conduct_event_id uuid,
    CONSTRAINT conduct_event_requests_a_decision_check CHECK ((a_decision = ANY (ARRAY['同意'::text, '不同意'::text]))),
    CONSTRAINT conduct_event_requests_b_decision_check CHECK ((b_decision = ANY (ARRAY['同意'::text, '不同意'::text]))),
    CONSTRAINT conduct_event_requests_count_check CHECK (((count >= 1) AND (count <= 5))),
    CONSTRAINT conduct_event_requests_event_type_check CHECK ((event_type = ANY (ARRAY['嘉獎'::text, '小功'::text, '大功'::text, '警告'::text, '小過'::text, '大過'::text]))),
    CONSTRAINT conduct_event_requests_s_decision_check CHECK ((s_decision = ANY (ARRAY['同意'::text, '不同意'::text]))),
    CONSTRAINT conduct_event_requests_status_check CHECK ((status = ANY (ARRAY['待B審核'::text, '待A審核'::text, '待S審核'::text, '已核准'::text, '已駁回'::text])))
);

--
-- Name: conduct_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.conduct_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    student_no text NOT NULL,
    event_date date NOT NULL,
    event_type text NOT NULL,
    points numeric(6,2) NOT NULL,
    recorded_by uuid,
    reason text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    count integer DEFAULT 1 NOT NULL,
    CONSTRAINT conduct_events_event_type_check CHECK ((event_type = ANY (ARRAY['嘉獎'::text, '小功'::text, '大功'::text, '警告'::text, '小過'::text, '大過'::text])))
);

--
-- Name: conduct_point_defaults; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.conduct_point_defaults (
    item text NOT NULL,
    points numeric(5,2) NOT NULL
);

--
-- Name: conduct_scores; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.conduct_scores (
    enrollment_id uuid NOT NULL,
    politeness numeric(5,2),
    dress numeric(5,2),
    service numeric(5,2),
    discipline numeric(5,2),
    updated_by uuid,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT conduct_scores_discipline_check CHECK (((discipline >= (0)::numeric) AND (discipline <= (100)::numeric))),
    CONSTRAINT conduct_scores_dress_check CHECK (((dress >= (0)::numeric) AND (dress <= (100)::numeric))),
    CONSTRAINT conduct_scores_politeness_check CHECK (((politeness >= (0)::numeric) AND (politeness <= (100)::numeric))),
    CONSTRAINT conduct_scores_service_check CHECK (((service >= (0)::numeric) AND (service <= (100)::numeric)))
);

--
-- Name: correction_requests; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.correction_requests (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    requested_by uuid NOT NULL,
    data_type text NOT NULL,
    record_id uuid,
    reason text,
    status text DEFAULT '待審核'::text NOT NULL,
    reviewed_by uuid,
    reviewed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    scope text,
    scope_ref text,
    academic_year integer,
    term text,
    CONSTRAINT correction_requests_data_type_check CHECK ((data_type = ANY (ARRAY['出缺勤'::text, '期中考'::text, '期末考'::text, '平時分'::text]))),
    CONSTRAINT correction_requests_scope_check CHECK ((scope = ANY (ARRAY['全校'::text, '部別'::text, '班級'::text]))),
    CONSTRAINT correction_requests_status_check CHECK ((status = ANY (ARRAY['待審核'::text, '核准'::text, '駁回'::text]))),
    CONSTRAINT correction_requests_target_check CHECK (((record_id IS NOT NULL) OR (scope IS NOT NULL))),
    CONSTRAINT correction_requests_term_check CHECK ((term = ANY (ARRAY['上學期'::text, '下學期'::text])))
);

--
-- Name: exam_class_roster_status; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.exam_class_roster_status (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    exam_session_id uuid NOT NULL,
    class_id uuid NOT NULL,
    submitted boolean DEFAULT false NOT NULL,
    submitted_by uuid,
    submitted_at timestamp with time zone
);

--
-- Name: exam_room_classes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.exam_room_classes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    exam_room_id uuid NOT NULL,
    class_id uuid NOT NULL,
    allocated_count integer DEFAULT 0 NOT NULL,
    CONSTRAINT exam_room_classes_allocated_count_check CHECK ((allocated_count >= 0))
);

--
-- Name: exam_room_seats; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.exam_room_seats (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    exam_room_id uuid NOT NULL,
    seat_no integer NOT NULL,
    row_no integer NOT NULL,
    col_no integer NOT NULL,
    class_id uuid
);

--
-- Name: exam_rooms; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.exam_rooms (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    exam_session_id uuid NOT NULL,
    room_name text NOT NULL,
    seat_capacity integer NOT NULL,
    grid_size integer NOT NULL,
    confirmed boolean DEFAULT false NOT NULL,
    confirmed_at timestamp with time zone,
    CONSTRAINT exam_rooms_grid_size_check CHECK (((grid_size > 0) AND (grid_size <= 7))),
    CONSTRAINT exam_rooms_seat_capacity_check CHECK (((seat_capacity > 0) AND (seat_capacity <= 49)))
);

--
-- Name: exam_seat_students; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.exam_seat_students (
    exam_room_seat_id uuid NOT NULL,
    student_no text,
    class_seat_no integer,
    updated_by uuid,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

--
-- Name: exam_sessions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.exam_sessions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    academic_year integer NOT NULL,
    term text NOT NULL,
    status text DEFAULT '編排中'::text NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    sent_at timestamp with time zone,
    excluded_class_ids uuid[] DEFAULT '{}'::uuid[] NOT NULL,
    CONSTRAINT exam_sessions_status_check CHECK ((status = ANY (ARRAY['編排中'::text, '已發送'::text, '已完成'::text]))),
    CONSTRAINT exam_sessions_term_check CHECK ((term = ANY (ARRAY['上學期'::text, '下學期'::text])))
);

--
-- Name: general_inventory_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.general_inventory_items (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    category public.general_item_category NOT NULL,
    name text NOT NULL,
    spec text,
    unit text DEFAULT '件'::text NOT NULL,
    unit_price numeric(10,2),
    quantity_on_hand integer DEFAULT 0 NOT NULL,
    note text,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    low_stock_threshold integer DEFAULT 3 NOT NULL,
    CONSTRAINT general_inventory_items_low_stock_threshold_check CHECK ((low_stock_threshold >= 0))
);

--
-- Name: general_inventory_transactions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.general_inventory_transactions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    item_id uuid NOT NULL,
    direction public.ledger_direction NOT NULL,
    quantity integer NOT NULL,
    unit_price_at_time numeric(10,2),
    counterparty text,
    note text,
    recorded_by uuid,
    recorded_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT general_inventory_transactions_quantity_check CHECK ((quantity > 0))
);

--
-- Name: governed_tables; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.governed_tables (
    table_name text NOT NULL,
    primary_key_column text NOT NULL,
    department public.admin_department NOT NULL,
    description text
);

--
-- Name: grade_progression; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.grade_progression (
    department text NOT NULL,
    grade_level text NOT NULL,
    next_department text NOT NULL,
    next_grade_level text NOT NULL
);

--
-- Name: grade_rankings; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.grade_rankings WITH (security_invoker='true') AS
 WITH distinct_classes AS (
         SELECT DISTINCT e.class_id,
            c.academic_year,
            e.term
           FROM (public.enrollments e
             JOIN public.classes c ON ((c.id = e.class_id)))
        ), class_locks AS (
         SELECT distinct_classes.class_id,
            distinct_classes.academic_year,
            distinct_classes.term,
            public.exam_type_locked(distinct_classes.class_id, distinct_classes.academic_year, distinct_classes.term, '期中考'::text) AS mid_locked,
            public.exam_type_locked(distinct_classes.class_id, distinct_classes.academic_year, distinct_classes.term, '期末考'::text) AS fin_locked,
            public.exam_type_locked(distinct_classes.class_id, distinct_classes.academic_year, distinct_classes.term, '平時分'::text) AS day_locked
           FROM distinct_classes
        ), ranked AS (
         SELECT t.enrollment_id,
            e.class_id,
            e.term,
            c.academic_year,
            c.department,
            c.grade_level,
            st.name,
            e.seat_no,
            e.student_no,
            t.total_score,
            rank() OVER (PARTITION BY c.academic_year, e.term, c.department, c.grade_level ORDER BY t.total_score DESC) AS grade_rank,
            et.midterm_total,
            rank() OVER (PARTITION BY c.academic_year, e.term, c.department, c.grade_level ORDER BY et.midterm_average DESC) AS midterm_grade_rank,
            et.final_total,
            rank() OVER (PARTITION BY c.academic_year, e.term, c.department, c.grade_level ORDER BY et.final_average DESC) AS final_grade_rank,
            et.daily_total,
            rank() OVER (PARTITION BY c.academic_year, e.term, c.department, c.grade_level ORDER BY et.daily_average DESC) AS daily_grade_rank,
            et.midterm_average,
            et.final_average,
            et.daily_average
           FROM ((((public.student_total_scores t
             JOIN public.enrollments e ON ((e.id = t.enrollment_id)))
             JOIN public.classes c ON ((c.id = e.class_id)))
             JOIN public.students st ON ((st.student_no = e.student_no)))
             LEFT JOIN public.student_examtype_totals et ON ((et.enrollment_id = t.enrollment_id)))
        )
 SELECT ranked.enrollment_id,
    ranked.class_id,
    ranked.term,
    ranked.academic_year,
    ranked.department,
    ranked.grade_level,
    ranked.name,
    ranked.seat_no,
    ranked.student_no,
        CASE
            WHEN (cl.mid_locked AND cl.fin_locked AND cl.day_locked) THEN ranked.total_score
            ELSE NULL::numeric
        END AS total_score,
        CASE
            WHEN (cl.mid_locked AND cl.fin_locked AND cl.day_locked) THEN ranked.grade_rank
            ELSE NULL::bigint
        END AS grade_rank,
        CASE
            WHEN cl.mid_locked THEN ranked.midterm_total
            ELSE NULL::numeric
        END AS midterm_total,
        CASE
            WHEN cl.mid_locked THEN ranked.midterm_grade_rank
            ELSE NULL::bigint
        END AS midterm_grade_rank,
        CASE
            WHEN cl.fin_locked THEN ranked.final_total
            ELSE NULL::numeric
        END AS final_total,
        CASE
            WHEN cl.fin_locked THEN ranked.final_grade_rank
            ELSE NULL::bigint
        END AS final_grade_rank,
        CASE
            WHEN cl.day_locked THEN ranked.daily_total
            ELSE NULL::numeric
        END AS daily_total,
        CASE
            WHEN cl.day_locked THEN ranked.daily_grade_rank
            ELSE NULL::bigint
        END AS daily_grade_rank,
        CASE
            WHEN cl.mid_locked THEN ranked.midterm_average
            ELSE NULL::numeric
        END AS midterm_average,
        CASE
            WHEN cl.fin_locked THEN ranked.final_average
            ELSE NULL::numeric
        END AS final_average,
        CASE
            WHEN cl.day_locked THEN ranked.daily_average
            ELSE NULL::numeric
        END AS daily_average
   FROM (ranked
     JOIN class_locks cl ON (((cl.class_id = ranked.class_id) AND (cl.academic_year = ranked.academic_year) AND (cl.term = ranked.term))))
  WHERE (public.is_system_admin() OR public.has_department('academic'::public.admin_department) OR (EXISTS ( SELECT 1
           FROM public.classes c2
          WHERE ((c2.id = ranked.class_id) AND (c2.homeroom_teacher_id = public.current_teacher_id())))) OR public.is_linked_parent(ranked.student_no));

--
-- Name: guardians; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.guardians (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    student_no text NOT NULL,
    relation text NOT NULL,
    name text,
    chinese_name text,
    occupation text,
    phone text,
    email text,
    address text
);

--
-- Name: homeroom_attendance_assist_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.homeroom_attendance_assist_settings (
    id boolean DEFAULT true NOT NULL,
    allow_present_to_leave boolean DEFAULT false NOT NULL,
    updated_by uuid,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT homeroom_attendance_assist_settings_singleton CHECK (id)
);

--
-- Name: locked_periods; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.locked_periods (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    academic_year integer NOT NULL,
    term text NOT NULL,
    scope text NOT NULL,
    scope_ref text,
    weekday integer NOT NULL,
    period_no integer NOT NULL,
    subject text NOT NULL,
    note text,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT locked_periods_scope_check CHECK ((scope = ANY (ARRAY['全校'::text, '部別'::text, '班級'::text]))),
    CONSTRAINT locked_periods_term_check CHECK ((term = ANY (ARRAY['上學期'::text, '下學期'::text]))),
    CONSTRAINT locked_periods_weekday_check CHECK (((weekday >= 1) AND (weekday <= 6)))
);

--
-- Name: maintenance_tickets; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.maintenance_tickets (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    location text NOT NULL,
    issue text NOT NULL,
    status text DEFAULT '待處理'::text NOT NULL,
    reported_by uuid,
    assigned_to text,
    reported_at timestamp with time zone DEFAULT now() NOT NULL,
    resolved_at timestamp with time zone,
    note text,
    CONSTRAINT maintenance_tickets_status_check CHECK ((status = ANY (ARRAY['待處理'::text, '處理中'::text, '已完成'::text, '取消'::text])))
);

--
-- Name: password_policy_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.password_policy_settings (
    id boolean DEFAULT true NOT NULL,
    force_change_on_first_login boolean DEFAULT false NOT NULL,
    updated_by uuid,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT password_policy_settings_singleton CHECK (id)
);

--
-- Name: pending_changes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pending_changes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    department public.admin_department NOT NULL,
    table_name text NOT NULL,
    operation text NOT NULL,
    record_key text,
    payload jsonb DEFAULT '{}'::jsonb NOT NULL,
    before_snapshot jsonb,
    requested_by uuid NOT NULL,
    requested_at timestamp with time zone DEFAULT now() NOT NULL,
    status text DEFAULT '待審核'::text NOT NULL,
    reviewed_by uuid,
    reviewed_at timestamp with time zone,
    review_note text,
    applied_at timestamp with time zone,
    CONSTRAINT pending_changes_operation_check CHECK ((operation = ANY (ARRAY['insert'::text, 'update'::text, 'delete'::text]))),
    CONSTRAINT pending_changes_record_key_check CHECK (((operation = 'insert'::text) OR (record_key IS NOT NULL))),
    CONSTRAINT pending_changes_status_check CHECK ((status = ANY (ARRAY['待審核'::text, '已核准'::text, '已駁回'::text])))
);

--
-- Name: period_config; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.period_config (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    scope text NOT NULL,
    scope_ref text,
    weekday integer NOT NULL,
    period_count integer NOT NULL,
    CONSTRAINT period_config_scope_check CHECK ((scope = ANY (ARRAY['全校'::text, '部別'::text, '班級'::text]))),
    CONSTRAINT period_config_weekday_check CHECK (((weekday >= 1) AND (weekday <= 6)))
);

--
-- Name: portal_accounts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.portal_accounts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    student_no text NOT NULL,
    login_code text NOT NULL,
    email text,
    relation text DEFAULT '家長'::text NOT NULL,
    auth_user_id uuid,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT portal_accounts_relation_check CHECK ((relation = ANY (ARRAY['家長'::text, '學生本人'::text])))
);

--
-- Name: COLUMN portal_accounts.login_code; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.portal_accounts.login_code IS 'HY+學號（家長，例如 HY0123）；HYS+學號（學生本人，例如 HYS0123）。兩種身分要用不同代碼，login_code 是 unique，同一個學生的家長帳號跟學生本人帳號不能共用同一組代碼，否則第二個會建立失敗。建立時由 app/(app)/admin/students/portal-accounts/page.tsx 自動產生。';

--
-- Name: portal_login_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.portal_login_settings (
    id boolean DEFAULT true NOT NULL,
    email_verification_enabled boolean DEFAULT true NOT NULL,
    updated_by uuid,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT portal_login_settings_singleton CHECK (id)
);

--
-- Name: profile_edit_requests; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.profile_edit_requests (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    student_no text NOT NULL,
    field_name text NOT NULL,
    old_value text,
    new_value text NOT NULL,
    requested_by uuid,
    requested_at timestamp with time zone DEFAULT now() NOT NULL,
    status text DEFAULT '待審核'::text NOT NULL,
    reviewed_by uuid,
    reviewed_at timestamp with time zone,
    target_table text DEFAULT 'students'::text NOT NULL,
    guardian_id uuid,
    CONSTRAINT profile_edit_requests_status_check CHECK ((status = ANY (ARRAY['待審核'::text, '已核准'::text, '已駁回'::text]))),
    CONSTRAINT profile_edit_requests_target_table_check CHECK ((target_table = ANY (ARRAY['students'::text, 'guardians'::text])))
);

--
-- Name: report_card_merge_template; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.report_card_merge_template (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    file_name text NOT NULL,
    file_data bytea NOT NULL,
    is_active boolean DEFAULT false NOT NULL,
    updated_by uuid,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

--
-- Name: report_card_style; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.report_card_style (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text DEFAULT '預設樣式'::text NOT NULL,
    config jsonb NOT NULL,
    is_active boolean DEFAULT false NOT NULL,
    updated_by uuid,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

--
-- Name: report_card_xlsx_template; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.report_card_xlsx_template (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    file_name text NOT NULL,
    file_data bytea NOT NULL,
    is_active boolean DEFAULT false NOT NULL,
    updated_by uuid,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

--
-- Name: scheduler_backups; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.scheduler_backups (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    academic_year integer NOT NULL,
    term text NOT NULL,
    note text,
    data jsonb NOT NULL,
    saved_at timestamp with time zone DEFAULT now() NOT NULL,
    saved_by uuid
);

--
-- Name: score_audit_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.score_audit_log (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    score_id uuid NOT NULL,
    changed_by uuid,
    changed_at timestamp with time zone DEFAULT now() NOT NULL,
    old_value text,
    new_value text
);

--
-- Name: site_content; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.site_content (
    content_key text NOT NULL,
    content_value text NOT NULL,
    updated_by uuid,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

--
-- Name: site_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.site_settings (
    setting_key text NOT NULL,
    setting_value text,
    updated_by uuid,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

--
-- Name: staff_notifications; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.staff_notifications (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    teacher_id uuid NOT NULL,
    category text NOT NULL,
    message text NOT NULL,
    student_no text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    read_at timestamp with time zone,
    CONSTRAINT staff_notifications_category_check CHECK ((category = ANY (ARRAY['個資修改申請'::text, '出缺勤示警'::text, '代課通知'::text, '考場通知'::text])))
);

--
-- Name: status_change_attachments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.status_change_attachments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    status_change_id uuid NOT NULL,
    file_url text NOT NULL,
    file_name text,
    uploaded_at timestamp with time zone DEFAULT now() NOT NULL
);

--
-- Name: student_absence_counts; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.student_absence_counts WITH (security_invoker='true') AS
 SELECT student_no,
    count(*) FILTER (WHERE (status = ANY (ARRAY['事假'::public.attendance_status, '病假'::public.attendance_status, '曠課'::public.attendance_status]))) AS absence_periods,
    count(*) FILTER (WHERE (status = '事假'::public.attendance_status)) AS personal_leave_periods,
    count(*) FILTER (WHERE (status = '病假'::public.attendance_status)) AS sick_leave_periods,
    count(*) FILTER (WHERE (status = '曠課'::public.attendance_status)) AS truancy_periods,
    count(*) FILTER (WHERE (status = '遲到'::public.attendance_status)) AS late_periods,
    count(*) FILTER (WHERE (status = '公假'::public.attendance_status)) AS excused_periods,
    count(*) FILTER (WHERE (status = '出席'::public.attendance_status)) AS present_periods
   FROM public.attendance
  GROUP BY student_no;

--
-- Name: student_remarks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.student_remarks (
    enrollment_id uuid NOT NULL,
    comment text,
    updated_by uuid,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

--
-- Name: student_status_changes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.student_status_changes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    student_no text NOT NULL,
    status public.enrollment_status_type NOT NULL,
    effective_date date NOT NULL,
    reason text,
    changed_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

--
-- Name: students_exceeding_exam_deduction_threshold; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.students_exceeding_exam_deduction_threshold WITH (security_invoker='true') AS
 SELECT student_no,
    absence_periods
   FROM public.student_absence_counts sac
  WHERE ((absence_periods >= ( SELECT attendance_alert_settings.exam_deduction_absence_threshold
           FROM public.attendance_alert_settings
          WHERE (attendance_alert_settings.id = 1))) AND (( SELECT attendance_alert_settings.exam_deduction_absence_threshold
           FROM public.attendance_alert_settings
          WHERE (attendance_alert_settings.id = 1)) IS NOT NULL));

--
-- Name: submission_window_audit_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.submission_window_audit_log (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    window_id uuid,
    academic_year integer NOT NULL,
    term text NOT NULL,
    data_type text NOT NULL,
    scope text NOT NULL,
    scope_ref text,
    old_is_locked boolean NOT NULL,
    new_is_locked boolean NOT NULL,
    old_closes_at timestamp with time zone,
    new_closes_at timestamp with time zone,
    changed_by uuid,
    changed_at timestamp with time zone DEFAULT now() NOT NULL,
    reason text
);

--
-- Name: submission_windows; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.submission_windows (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    academic_year integer NOT NULL,
    term text NOT NULL,
    data_type text NOT NULL,
    scope text NOT NULL,
    scope_ref text,
    opens_at timestamp with time zone,
    closes_at timestamp with time zone,
    is_locked boolean DEFAULT false NOT NULL,
    set_by uuid,
    CONSTRAINT submission_windows_data_type_check CHECK ((data_type = ANY (ARRAY['出缺勤'::text, '期中考'::text, '期末考'::text, '平時分'::text]))),
    CONSTRAINT submission_windows_scope_check CHECK ((scope = ANY (ARRAY['全校'::text, '部別'::text, '班級'::text]))),
    CONSTRAINT submission_windows_term_check CHECK ((term = ANY (ARRAY['上學期'::text, '下學期'::text])))
);

--
-- Name: substitute_assignments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.substitute_assignments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    academic_year integer NOT NULL,
    term text NOT NULL,
    class_id uuid NOT NULL,
    weekday integer NOT NULL,
    period_no integer NOT NULL,
    subject text NOT NULL,
    original_teacher_id uuid NOT NULL,
    substitute_teacher_id uuid NOT NULL,
    substitute_date date NOT NULL,
    reason text,
    status text DEFAULT '已排定'::text NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT substitute_assignments_status_check CHECK ((status = ANY (ARRAY['已排定'::text, '已完成'::text, '已取消'::text]))),
    CONSTRAINT substitute_assignments_term_check CHECK ((term = ANY (ARRAY['上學期'::text, '下學期'::text]))),
    CONSTRAINT substitute_assignments_weekday_check CHECK (((weekday >= 1) AND (weekday <= 7)))
);

--
-- Name: teacher_appointment_letters; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.teacher_appointment_letters (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    category public.teacher_letter_category NOT NULL,
    seq_no integer,
    name text NOT NULL,
    title text,
    gender text,
    term_no integer,
    start_date date,
    end_date date,
    resigned boolean DEFAULT false NOT NULL,
    issued_date date,
    note text,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

--
-- Name: teacher_letter_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.teacher_letter_settings (
    id integer DEFAULT 1 NOT NULL,
    school_name_zh text DEFAULT '泰國清萊雲南會館附屬華雲學校'::text NOT NULL,
    principal_name text DEFAULT '董嬌玫'::text NOT NULL,
    chairman_name text DEFAULT '顏協清'::text NOT NULL,
    phone text DEFAULT '053734209'::text NOT NULL,
    address text DEFAULT '618 M6 Mae Sai Chiang Rai Thai 57130'::text NOT NULL,
    updated_by uuid,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT teacher_letter_settings_singleton CHECK ((id = 1))
);

--
-- Name: teacher_login_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.teacher_login_settings (
    id boolean DEFAULT true NOT NULL,
    home_path text DEFAULT '/admin'::text NOT NULL,
    updated_by uuid,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT teacher_login_settings_singleton CHECK (id)
);

--
-- Name: teacher_schedule_conflicts; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.teacher_schedule_conflicts WITH (security_invoker='true') AS
 SELECT teacher_id,
    academic_year,
    term,
    weekday,
    period_no,
    count(*) AS conflict_count,
    array_agg(class_id) AS conflicting_class_ids
   FROM public.class_schedule
  WHERE ((weekday IS NOT NULL) AND (period_no IS NOT NULL))
  GROUP BY teacher_id, academic_year, term, weekday, period_no
 HAVING (count(*) > 1);

--
-- Name: teacher_service_certificates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.teacher_service_certificates (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    seq_no integer,
    self_hired boolean DEFAULT false NOT NULL,
    resigned boolean DEFAULT false NOT NULL,
    name text NOT NULL,
    birth_date date,
    nationality text,
    gender text,
    department text,
    title text,
    start_date_1 date,
    end_date_1 date,
    start_date_2 date,
    end_date_2 date,
    start_date_3 date,
    end_date_3 date,
    note text,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

--
-- Name: teachers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.teachers (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    app_user_id uuid,
    name text NOT NULL
);

--
-- Name: utility_bills; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.utility_bills (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    category text NOT NULL,
    billing_month date NOT NULL,
    amount numeric(10,2) NOT NULL,
    paid boolean DEFAULT false NOT NULL,
    paid_date date,
    note text,
    recorded_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT utility_bills_category_check CHECK ((category = ANY (ARRAY['水費'::text, '電費'::text, '網路費'::text, '其他'::text])))
);


