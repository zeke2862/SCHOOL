-- ============================================================
-- 117. 公佈欄：顯示天數（超過自動隱藏）＋永久保存
-- ------------------------------------------------------------
--   valid_days  ：發布後顯示幾天；空白（NULL）＝永久保存
--   expires_at  ：到期時間（發布時間＋天數）；空白＝永久。超過這個時間，一般使用者就看不到這篇，
--                 公佈欄管理頁仍看得到（標示「已過期」），可以編輯或「重新發布」。
-- 既有公告維持永久。可重複執行。
-- ============================================================
alter table public.bulletin_posts add column if not exists valid_days int check (valid_days is null or valid_days > 0);
alter table public.bulletin_posts add column if not exists expires_at timestamptz;
create index if not exists idx_bulletin_expires on public.bulletin_posts (expires_at);

-- 一般使用者：已發布、而且還沒到期的才看得到；管理員（S／A／B）全部看得到
drop policy if exists public_read_published_posts on public.bulletin_posts;
create policy public_read_published_posts on public.bulletin_posts for select
  using (
    (is_published = true and (expires_at is null or expires_at > now()))
    or current_role_name() = any (array['system_admin_s'::user_role, 'admin_a'::user_role, 'admin_b'::user_role])
  );

notify pgrst, 'reload schema';
