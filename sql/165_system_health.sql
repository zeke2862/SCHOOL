-- ============================================================
-- 165. 系統健康檢查（資安與效能檢測報告 第三級：監控與告警）
-- ------------------------------------------------------------
-- 1) system_health_log：每天排程（以及管理者按「立即檢查」）檢查一次的結果紀錄，系統管理員／開發人員只能讀，寫入只有伺服器端（service role）。
-- 2) admin_health_snapshot()：一次取回資料庫大小、連線數、儲存空間用量、最久的執行中查詢、最慢的查詢清單。
--    SECURITY DEFINER，已收回所有人的執行權，只給 service_role（伺服器端用）。
--    慢查詢清單來自 pg_stat_statements（累計值，不含個別參數內容，只有語句樣式）。
-- 可重複執行。回復見檔案最後。
-- ============================================================
create table if not exists public.system_health_log (
  id bigint generated always as identity primary key,
  checked_at timestamptz not null default now(),
  source text not null check (source in ('cron', 'manual')),
  status text not null check (status in ('ok', 'warning', 'critical')),
  alerts jsonb not null default '[]'::jsonb,
  metrics jsonb not null default '{}'::jsonb
);
create index if not exists idx_system_health_log_checked_at on public.system_health_log (checked_at desc);

alter table public.system_health_log enable row level security;
drop policy if exists system_health_log_read on public.system_health_log;
create policy system_health_log_read on public.system_health_log for select to authenticated
  using ((select is_system_admin()) or (select has_department('dev')));
revoke all on public.system_health_log from anon, authenticated;
grant select on public.system_health_log to authenticated;
grant all on public.system_health_log to service_role;

create or replace function public.admin_health_snapshot() returns jsonb
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare r jsonb;
begin
  select jsonb_build_object(
    'db_bytes', pg_database_size(current_database()),
    'conns', (select count(*) from pg_stat_activity where datname = current_database()),
    'max_conns', current_setting('max_connections')::int,
    'storage_bytes', (select coalesce(sum((metadata->>'size')::bigint), 0) from storage.objects),
    'backup_storage_bytes', (select coalesce(sum((metadata->>'size')::bigint), 0) from storage.objects where bucket_id = 'backup-uploads'),
    'longest_query_seconds', (select coalesce(max(extract(epoch from now() - query_start)), 0)::int from pg_stat_activity
                               where datname = current_database() and state = 'active' and pid <> pg_backend_pid()),
    'cache_hit_ratio', (select round(sum(blks_hit) * 100.0 / nullif(sum(blks_hit + blks_read), 0), 2) from pg_stat_database where datname = current_database()),
    'slow_queries', (
      select coalesce(jsonb_agg(x), '[]'::jsonb) from (
        select left(regexp_replace(s.query, '\s+', ' ', 'g'), 140) as q, s.calls,
               round(s.mean_exec_time::numeric, 0) as mean_ms, round(s.max_exec_time::numeric, 0) as max_ms
          from extensions.pg_stat_statements s join pg_roles ro on ro.oid = s.userid
         where s.dbid = (select oid from pg_database where datname = current_database())
           and ro.rolname in ('authenticated', 'anon', 'service_role', 'postgres')
           and s.calls >= 20 and s.mean_exec_time > 500
           and s.query not ilike '%pg_stat%' and s.query not ilike '%admin_health_snapshot%'
         order by s.mean_exec_time desc limit 5
      ) x
    )
  ) into r;
  return r;
end;
$$;
revoke execute on function public.admin_health_snapshot() from public, anon, authenticated;
grant execute on function public.admin_health_snapshot() to service_role;

-- ===== 回復（需要時才執行）=====
-- drop function if exists public.admin_health_snapshot();
-- drop table if exists public.system_health_log;
