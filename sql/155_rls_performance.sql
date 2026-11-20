-- ============================================================
-- 155. 資料庫效能整理（依 Supabase 顧問報告）
-- ------------------------------------------------------------
-- 不改變任何人「能不能看／能不能改」的結果，只減少每次查詢的重複運算：
--   A. 權限政策裡的 auth.uid() 改成 (select auth.uid())：整個查詢只算一次，不用每一列都重算
--      （顧問報告 auth_rls_initplan，共 42 條政策；只處理「還沒包起來」的，可重複執行）
--   B. 93 張表的 dev_read_all、10 條 dev 寫入政策：同樣把函式呼叫包成 (select ...)，
--      並把適用對象從 public 縮成 authenticated（未登入者的 auth.uid() 是空的，本來就一定不成立）
--   C. 補 4 個真的會被查到的外鍵索引（通知用老師／學生查詢、出缺勤異動紀錄回查）
-- 刻意沒做：刪除「沒用過的索引」（11 個、合計不到 300 KB，刪了沒有實益，資料變多後反而可能用到）、
--           刪除備份表 class_schedule_bak_20261103（168 筆，留著不佔空間，是否刪由人決定）。
-- 可重複執行。回復見檔案最後。
-- ============================================================

-- ===== A. auth.uid() 包成 initplan =====
do $$
declare
  r record;
  v_using text;
  v_check text;
  v_sql text;
  v_n int := 0;
begin
  for r in
    select schemaname, tablename, policyname, qual, with_check
    from pg_policies
    where schemaname = 'public'
      and (coalesce(qual, '') ~ '(?<!SELECT )auth\.uid\(\)' or coalesce(with_check, '') ~ '(?<!SELECT )auth\.uid\(\)')
  loop
    v_using := case when r.qual is null then null
                    else regexp_replace(r.qual, '(?<!SELECT )auth\.uid\(\)', '(select auth.uid())', 'g') end;
    v_check := case when r.with_check is null then null
                    else regexp_replace(r.with_check, '(?<!SELECT )auth\.uid\(\)', '(select auth.uid())', 'g') end;
    v_sql := format('alter policy %I on %I.%I', r.policyname, r.schemaname, r.tablename);
    if v_using is not null then v_sql := v_sql || ' using (' || v_using || ')'; end if;
    if v_check is not null then v_sql := v_sql || ' with check (' || v_check || ')'; end if;
    execute v_sql;
    v_n := v_n + 1;
  end loop;
  raise notice 'A: 已改寫 % 條政策', v_n;
end $$;

-- ===== B. dev 政策：函式包成 initplan、對象縮成 authenticated =====
do $$
declare
  r record;
  v_n int := 0;
begin
  for r in
    select tablename, policyname, qual, with_check
    from pg_policies
    where schemaname = 'public' and policyname = 'dev_read_all'
      and qual = 'has_department(''dev''::admin_department)'
  loop
    execute format('alter policy %I on public.%I to authenticated using ((select has_department(''dev''::admin_department)))',
                   r.policyname, r.tablename);
    v_n := v_n + 1;
  end loop;

  for r in
    select tablename, policyname
    from pg_policies
    where schemaname = 'public' and permissive = 'PERMISSIVE' and cmd = 'ALL'
      and policyname ~ '^dev_(all|write)_'
      and qual = '(is_system_admin() OR has_department(''dev''::admin_department))'
      and with_check = '(is_system_admin() OR has_department(''dev''::admin_department))'
  loop
    execute format('alter policy %I on public.%I to authenticated using ((select (is_system_admin() or has_department(''dev''::admin_department)))) with check ((select (is_system_admin() or has_department(''dev''::admin_department))))',
                   r.policyname, r.tablename);
    v_n := v_n + 1;
  end loop;
  raise notice 'B: 已改寫 % 條 dev 政策', v_n;
end $$;

-- ===== C. 外鍵索引 =====
create index if not exists idx_attendance_audit_log_attendance_id on public.attendance_audit_log (attendance_id);
create index if not exists idx_attendance_notifications_student_no on public.attendance_notifications (student_no);
create index if not exists idx_staff_notifications_student_no on public.staff_notifications (student_no);
create index if not exists idx_staff_notifications_teacher_id on public.staff_notifications (teacher_id);

-- ===== 回復（需要時才執行）=====
-- C：
--   drop index if exists public.idx_attendance_audit_log_attendance_id;
--   drop index if exists public.idx_attendance_notifications_student_no;
--   drop index if exists public.idx_staff_notifications_student_no;
--   drop index if exists public.idx_staff_notifications_teacher_id;
-- A（把 (select auth.uid()) 還原成 auth.uid()）：
--   do $$ declare r record; u text; c text; s text; begin
--     for r in select schemaname, tablename, policyname, qual, with_check from pg_policies
--              where schemaname='public' and (coalesce(qual,'')||coalesce(with_check,'')) like '%SELECT auth.uid()%'
--     loop
--       u := replace(replace(r.qual, '( SELECT auth.uid() AS uid)', 'auth.uid()'), '(select auth.uid())', 'auth.uid()');
--       c := replace(replace(r.with_check, '( SELECT auth.uid() AS uid)', 'auth.uid()'), '(select auth.uid())', 'auth.uid()');
--       s := format('alter policy %I on %I.%I', r.policyname, r.schemaname, r.tablename);
--       if u is not null then s := s || ' using (' || u || ')'; end if;
--       if c is not null then s := s || ' with check (' || c || ')'; end if;
--       execute s;
--     end loop; end $$;
-- B（dev 政策還原成對 public 開放、不包 select；dev_read_all 與 dev 寫入政策各自還原）：
--   do $$ declare r record; begin
--     for r in select tablename from pg_policies where schemaname='public' and policyname='dev_read_all' loop
--       execute format('alter policy dev_read_all on public.%I to public using (has_department(''dev''::admin_department))', r.tablename);
--     end loop;
--     for r in select tablename, policyname from pg_policies where schemaname='public' and policyname ~ '^dev_(all|write)_' loop
--       execute format('alter policy %I on public.%I to public using (is_system_admin() or has_department(''dev''::admin_department)) with check (is_system_admin() or has_department(''dev''::admin_department))', r.policyname, r.tablename);
--     end loop; end $$;
