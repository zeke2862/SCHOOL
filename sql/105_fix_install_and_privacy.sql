-- 105_fix_install_and_privacy.sql
-- 兩項修正，已在測試專案驗證（見測試報告）。正式資料庫請先在測試環境確認後再執行。

-- ① 全新安裝檔缺陷：app_users 啟用 RLS 卻沒有任何政策，
--    而 current_role_name() 不是 SECURITY DEFINER → 所有人讀到 NULL →
--    is_system_admin() 永遠為 false，所有依角色(admin_a/admin_b/system_admin_s)的權限政策失效。
--    （已在測試專案執行）
alter function public.current_role_name() security definer set search_path = public;
create policy app_users_select_self_or_admin on public.app_users for select to authenticated
  using (id = (select auth.uid()) or public.current_role_name() in ('admin_a','admin_b','system_admin_s') or public.has_department('dev'::public.admin_department));
create policy governed_tables_select_authenticated on public.governed_tables for select to authenticated using (true);

-- ② 隱私漏洞：conduct_events 有一條 SELECT 政策 using (true)，等於任何已登入者
--    （包含家長、學生、其他老師）都能用 API 讀到全校所有學生的獎懲紀錄。
--    改成：家長/學生只能讀自己孩子的；其他人沿用既有的 read_conduct_events_for_history 與管理員政策。
--    （已在測試專案以「執行後復原」方式驗證：家長/學生從看到 2 筆 → 只看到自己的 1 筆；
--      導師看本班、任課教師只看自己登記的。尚未正式套用。）
drop policy if exists read_conduct_events on public.conduct_events;
create policy read_conduct_events_linked_parent on public.conduct_events for select to authenticated
  using (public.is_linked_parent(student_no));
