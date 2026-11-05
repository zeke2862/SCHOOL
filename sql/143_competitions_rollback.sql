-- 143 的回復腳本：移除競賽系統的所有資料表、函式、政策，並把通知類別限制還原成上線前的清單。
-- ⚠️ 會刪除所有賽事、報名、分數、作品投票資料，執行前請先備份（或確認真的要放棄）。
-- 不處理的部分：
--   * 142 新增的 user_role 值 'competition_guest'：PostgreSQL 無法移除列舉值，留著不影響其他功能。
--   * 訪客帳號（app_users.role = 'competition_guest'）：本腳本會列出，請另外到「賽事訪客」或帳號管理停用。
--   * Storage 的 'competition' 儲存桶：Supabase 不允許用 SQL 刪除，請到後台 Storage 手動刪除。
-- 可重複執行。

do $$
declare t record; f record; n int;
begin
  -- 1) 訪客隔離政策（加在所有既有資料表上的限制性政策）
  for t in select schemaname, tablename from pg_policies where policyname = 'comp_guest_block' and schemaname = 'public' loop
    execute format('drop policy if exists comp_guest_block on %I.%I', t.schemaname, t.tablename);
  end loop;

  -- 2) 作品照片的 Storage 政策
  execute 'drop policy if exists comp_photo_read on storage.objects';
  execute 'drop policy if exists comp_photo_write on storage.objects';
  execute 'drop policy if exists comp_photo_delete on storage.objects';

  -- 3) 資料表（cascade 會一併移除它們的政策與觸發器）
  for t in select c.relname from pg_class c join pg_namespace ns on ns.oid = c.relnamespace
           where ns.nspname = 'public' and c.relkind = 'r' and c.relname like 'comp\_%' loop
    execute format('drop table if exists public.%I cascade', t.relname);
  end loop;

  -- 4) 函式（comp_* 與觸發器函式 trg_comp_*）
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
           where ns.nspname = 'public' and (p.proname like 'comp\_%' or p.proname like 'trg\_comp\_%') loop
    execute format('drop function if exists %s cascade', f.sig);
  end loop;

  -- 5) 通知類別限制還原（先刪掉「賽事通知」的通知，否則還原會失敗）
  delete from public.staff_notifications where category = '賽事通知';
  alter table public.staff_notifications drop constraint if exists staff_notifications_category_check;
  alter table public.staff_notifications add constraint staff_notifications_category_check
    check (category = any (array['個資修改申請','出缺勤示警','代課通知','考場通知','學生資料變更','審核通知','代理通知','請假申請','學籍異動申請']));

  -- 6) 提醒：還有訪客帳號
  select count(*) into n from public.app_users where role::text = 'competition_guest';
  if n > 0 then
    raise notice '還有 % 個賽事訪客帳號（app_users.role = competition_guest），請另外停用或刪除', n;
  end if;
end $$;
