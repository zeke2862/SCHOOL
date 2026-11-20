-- ============================================================
-- 156. 資料庫安全加固（依 Supabase 顧問報告）
-- ------------------------------------------------------------
-- A. club_submission_status 檢視表改成 security_invoker：原本用建立者的權限執行，會繞過 RLS，
--    而且未登入的人（anon）也讀得到。這個檢視表程式裡沒有任何地方使用，順便收回 anon 讀取權。
-- B. 收回「未登入者」對 SECURITY DEFINER 函式的執行權（共 112 個；原本是 PUBLIC＋anon 都有）。
--    保留兩個：current_role_name（登入頁讀公佈欄的權限政策會用到）、comp_public_view（競賽公開頁，
--    本身要有連結代碼才查得到）。登入者（authenticated）與後端（service_role）的權限維持不變。
-- C. 再收回「登入者也不需要直接呼叫」的函式（共 53 個）：26 個觸發器函式（觸發器運作不需要呼叫者有
--    執行權）＋27 個只被其他 SECURITY DEFINER 函式或後端使用的內部函式。已逐一比對：
--    權限政策、檢視表、預設值、CHECK、其他函式內文、前端 rpc 呼叫（含 admin/clubs 的動態呼叫）都沒有用到。
-- D. 24 個 SECURITY DEFINER／plpgsql 函式固定 search_path = public, pg_temp，防止被劫持。
--    刻意不處理「非 SECURITY DEFINER 的一般 SQL 函式」（20 個）：加上 SET 之後資料庫就不能把它們內嵌進
--    權限政策，會讓查詢變慢；而它們以呼叫者自己的權限執行，被劫持也無法提權。
-- 原本的函式權限先備份到 ops_backup.fn_acl_156（不在 API 對外的 schema），回復見檔案最後。
-- 可重複執行。
--
-- ⚠️ 以後新增 SECURITY DEFINER 函式時：資料庫預設會讓 PUBLIC／anon 都能執行，請在函式後面加上
--    revoke execute on function public.xxx(...) from public, anon;
--    grant execute on function public.xxx(...) to authenticated, service_role;
--    只有「真的要給未登入者用」的才例外。
-- ============================================================

-- ===== 備份原本的函式權限 =====
create schema if not exists ops_backup;
create table if not exists ops_backup.fn_acl_156 (sig text not null, grantee text not null, priv text not null);
insert into ops_backup.fn_acl_156 (sig, grantee, priv)
select p.oid::regprocedure::text,
       case a.grantee when 0 then 'public' else a.grantee::regrole::text end,
       a.privilege_type
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
where n.nspname = 'public' and p.prokind = 'f'
  and not exists (select 1 from ops_backup.fn_acl_156);
revoke all on schema ops_backup from public, anon, authenticated;
revoke all on ops_backup.fn_acl_156 from public, anon, authenticated;

-- ===== A. 檢視表 =====
alter view public.club_submission_status set (security_invoker = true);
revoke all on public.club_submission_status from anon;

-- ===== B. 收回未登入者的執行權 =====
do $$
declare r record; n int := 0;
begin
  for r in
    select p.oid::regprocedure::text sig
    from pg_proc p join pg_namespace x on x.oid = p.pronamespace
    where x.nspname = 'public' and p.prokind = 'f' and p.prosecdef
      and p.proname not in ('current_role_name', 'comp_public_view')
      and has_function_privilege('anon', p.oid, 'execute')
  loop
    execute format('revoke execute on function %s from public, anon', r.sig);
    execute format('grant execute on function %s to authenticated, service_role', r.sig);
    n := n + 1;
  end loop;
  raise notice 'B: 收回 % 個函式的未登入執行權', n;
end $$;

-- ===== C. 收回登入者不需要直接呼叫的函式 =====
do $$
declare r record; n int := 0;
begin
  for r in
    select p.oid::regprocedure::text sig
    from pg_proc p join pg_namespace x on x.oid = p.pronamespace
    where x.nspname = 'public' and p.prokind = 'f' and p.prosecdef
      and (p.prorettype = 'trigger'::regtype
           or p.proname = any (array[
             '_inherit_term_settings','acting_principal','apply_pending_change','attendance_adjustment',
             'attendance_settled','attendance_settled_for_class','can_proxy_club_selection','class_of_student_on',
             'class_periods_on','club_active_count','comp_account_active','comp_notify_homeroom',
             'current_staff_has_guardian_email_match','effective_uids','guardian_phone_match_exists',
             'leave_approver_teacher_ids','leave_is_by_academic_lead','my_acting_state','report_card_grade_rank',
             'report_card_ready','rollover_candidates','scoped_student_totals','scores_settled','staff_rank',
             'student_current_status','sync_club_attendance_to_attendance','sync_club_score_to_scores']))
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', r.sig);
    n := n + 1;
  end loop;
  raise notice 'C: 收回 % 個函式的登入者執行權', n;
end $$;

-- ===== D. 固定 search_path（只處理 SECURITY DEFINER 與 plpgsql 函式）=====
do $$
declare r record; n int := 0;
begin
  for r in
    select p.oid::regprocedure::text sig
    from pg_proc p
    join pg_namespace x on x.oid = p.pronamespace
    join pg_language l on l.oid = p.prolang
    where x.nspname = 'public' and p.prokind = 'f' and (p.prosecdef or l.lanname <> 'sql')
      and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%')
      and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
  loop
    execute format('alter function %s set search_path = public, pg_temp', r.sig);
    n := n + 1;
  end loop;
  raise notice 'D: 固定 % 個函式的 search_path', n;
end $$;

-- ===== 回復（需要時才執行）=====
-- 1) 檢視表：
--    alter view public.club_submission_status reset (security_invoker);
--    grant select on public.club_submission_status to anon;
-- 2) 函式權限：照備份表還原（先全部收回，再依備份逐筆授權）
--    do $$ declare r record; begin
--      for r in select distinct sig from ops_backup.fn_acl_156 loop
--        begin execute format('revoke all on function %s from public, anon, authenticated, service_role', r.sig);
--        exception when undefined_function then null; end;
--      end loop;
--      for r in select sig, grantee, priv from ops_backup.fn_acl_156 where grantee in ('public','anon','authenticated','service_role') loop
--        begin execute format('grant %s on function %s to %s', r.priv, r.sig, r.grantee);
--        exception when undefined_function then null; end;
--      end loop;
--    end $$;
-- 3) search_path：不需要回復（只是多了固定值，不影響功能）；若真要拿掉：
--    alter function public.函式名(參數型別) reset search_path;
