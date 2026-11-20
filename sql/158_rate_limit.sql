-- ============================================================
-- 158. 家長／學生入口的嘗試次數限制（免費方案，不需要額外服務）
-- ------------------------------------------------------------
-- 為什麼：入口登入是「HY＋學號」加「手機號碼」，學號連號、容易猜，手機號碼只有約 9 碼，
--        以前完全沒有限制嘗試次數，程式可以一直試；申請帳號的入口也能被灌申請。
-- 作法：用一張很小的計數表（rate_limits）記「某個鍵在目前這段時間內失敗了幾次」。
--   鍵的寫法由後端決定，例如 login:code:HY0123（同一個登入代碼）、login:ip:1.2.3.4（同一個來源 IP）。
--   rate_limit_wait(鍵, 上限, 視窗秒數)  → 0 表示可以繼續；大於 0 表示被擋，數字是還要等幾秒
--   rate_limit_hit(鍵, 視窗秒數)         → 記一次失敗（視窗過期會自動重算）
--   rate_limit_clear(鍵)                 → 清掉這個鍵（登入成功時清掉該代碼的失敗次數）
-- 只有後端（service_role）能呼叫；登入者與未登入者都不能直接碰這張表或這些函式。
-- 超過一天的舊紀錄會在寫入時順手清掉（約 2% 的機率觸發一次），表不會越長越大。
-- 可重複執行。回復見檔案最後。
-- ============================================================

create table if not exists public.rate_limits (
  key          text primary key,
  hits         int not null default 0,
  window_start timestamptz not null default now()
);
alter table public.rate_limits enable row level security;
revoke all on public.rate_limits from public, anon, authenticated;
drop policy if exists rate_limits_deny_all on public.rate_limits;
create policy rate_limits_deny_all on public.rate_limits for all to anon, authenticated using (false) with check (false);

create or replace function public.rate_limit_wait(p_key text, p_max int, p_window_secs int) returns int
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce((
    select case
             when hits >= p_max and window_start + make_interval(secs => p_window_secs) > now()
             then ceil(extract(epoch from (window_start + make_interval(secs => p_window_secs) - now())))::int
             else 0
           end
    from public.rate_limits where key = p_key
  ), 0)
$$;

create or replace function public.rate_limit_hit(p_key text, p_window_secs int) returns int
language plpgsql security definer set search_path = public, pg_temp as $$
declare v int;
begin
  insert into public.rate_limits as r (key, hits, window_start) values (p_key, 1, now())
  on conflict (key) do update set
    hits = case when r.window_start + make_interval(secs => p_window_secs) <= now() then 1 else r.hits + 1 end,
    window_start = case when r.window_start + make_interval(secs => p_window_secs) <= now() then now() else r.window_start end
  returning r.hits into v;
  if random() < 0.02 then
    delete from public.rate_limits where window_start < now() - interval '1 day';
  end if;
  return v;
end $$;

create or replace function public.rate_limit_clear(p_key text) returns void
language sql security definer set search_path = public, pg_temp as $$
  delete from public.rate_limits where key = p_key
$$;

revoke execute on function public.rate_limit_wait(text, int, int), public.rate_limit_hit(text, int), public.rate_limit_clear(text) from public, anon, authenticated;
grant execute on function public.rate_limit_wait(text, int, int), public.rate_limit_hit(text, int), public.rate_limit_clear(text) to service_role;

-- ===== 回復（需要時才執行）=====
-- drop function if exists public.rate_limit_wait(text, int, int);
-- drop function if exists public.rate_limit_hit(text, int);
-- drop function if exists public.rate_limit_clear(text);
-- drop table if exists public.rate_limits;
