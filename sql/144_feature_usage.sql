-- 144：功能使用次數統計（供首頁「我的常用」、方塊顏色深淺、「全校常用」標記使用）
-- 只記「某個帳號點過某個功能方塊幾次」，不記時間點、不記內容；一個帳號最多幾十列，資料量很小。
-- 資料表鎖死（開 RLS 又不給任何直接存取的 policy），一律透過下面三支函式讀寫：
--   bump_feature_usage(jsonb)   把「{功能代號: 次數}」加到自己名下（前端累積一陣子才批次送一次）
--   my_feature_usage()          只回傳自己的次數
--   school_feature_usage()      只回傳「有多少人用過」的匯總人數，看不到誰用了什麼
-- 功能代號格式：hub:入口代號 、 tab:入口代號/功能代號 、 extra:其他連結代號
-- 回復：見檔案最後的 drop 指令。

create table if not exists public.feature_usage (
  user_id uuid not null references public.app_users(id) on delete cascade,
  key text not null check (key ~ '^(hub|tab|extra):[A-Za-z0-9_/-]{1,80}$'),
  n integer not null default 0 check (n >= 0),
  primary key (user_id, key)
);
alter table public.feature_usage enable row level security;
revoke all on public.feature_usage from public, anon, authenticated;

create or replace function public.bump_feature_usage(p_counts jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare v_me uuid := auth.uid(); r record; v_n int; v_i int := 0;
begin
  if v_me is null or p_counts is null or jsonb_typeof(p_counts) <> 'object' then return; end if;
  if not exists (select 1 from app_users where id = v_me) then return; end if;
  for r in select key, value from jsonb_each_text(p_counts) loop
    v_i := v_i + 1;
    exit when v_i > 60;                                          -- 一次最多 60 個功能
    continue when r.key !~ '^(hub|tab|extra):[A-Za-z0-9_/-]{1,80}$';
    begin
      v_n := least(greatest(r.value::int, 0), 200);
    exception when others then
      continue;
    end;
    continue when v_n = 0;
    insert into feature_usage(user_id, key, n) values (v_me, r.key, v_n)
      on conflict (user_id, key) do update set n = feature_usage.n + excluded.n;
  end loop;
end $$;

create or replace function public.my_feature_usage() returns table(key text, n integer)
language sql stable security definer set search_path = public as $$
  select f.key, f.n from feature_usage f where f.user_id = auth.uid() and f.n > 0;
$$;

-- 全校：每個功能有幾位老師用過（tab 另外加總到它所屬的 hub）
create or replace function public.school_feature_usage() returns table(key text, users integer)
language sql stable security definer set search_path = public as $$
  with u as (
    select user_id, key as k from feature_usage where n > 0
    union
    select user_id, 'hub:' || split_part(substr(key, 5), '/', 1) from feature_usage where n > 0 and key like 'tab:%'
  )
  select k, count(distinct user_id)::int from u
  where auth.uid() is not null
  group by k;
$$;

revoke all on function public.bump_feature_usage(jsonb) from public, anon;
revoke all on function public.my_feature_usage() from public, anon;
revoke all on function public.school_feature_usage() from public, anon;
grant execute on function public.bump_feature_usage(jsonb) to authenticated;
grant execute on function public.my_feature_usage() to authenticated;
grant execute on function public.school_feature_usage() to authenticated;

-- ===== 回復（不要了就執行這段）=====
-- drop function if exists public.bump_feature_usage(jsonb);
-- drop function if exists public.my_feature_usage();
-- drop function if exists public.school_feature_usage();
-- drop table if exists public.feature_usage;
