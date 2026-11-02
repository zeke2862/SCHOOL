-- 開發人員（dev）部門改為「唯讀」：看得到全部資料（is_system_admin() 仍包含 dev，所以各表的讀取政策照樣放行），
-- 但不能新增、修改、刪除。系統管理員S（帳號角色 system_admin_s）不受限制。
-- 取代 sql/139（那版是讓 dev 視同 S，權限過大）。

-- 1) 還原：current_role_name() 回到只看帳號本身的角色
create or replace function public.current_role_name()
returns public.user_role
language sql
stable
security definer
set search_path to 'public'
as $$
  select u.role from app_users u
  where u.id = auth.uid()
    and (u.account_expires_at is null or u.account_expires_at > now());
$$;

-- 2) 「只有開發人員身分、不是系統管理員S」的人
create or replace function public.is_dev_readonly()
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select exists (select 1 from app_user_departments d where d.app_user_id = auth.uid() and d.department = 'dev')
     and coalesce((select u.role <> 'system_admin_s' from app_users u where u.id = auth.uid()), false);
$$;

-- 3) 對所有 public 資料表加「限制型」政策：開發人員唯讀不能 INSERT／UPDATE／DELETE
--    （限制型政策與其他政策是 AND：即使其他政策允許寫入，這條不過就擋下）。
--    例外：app_users（自己改密碼狀態等）、staff_notifications（把通知標為已讀）。
create or replace function public.apply_dev_readonly_policies()
returns void
language plpgsql
as $$
declare r record;
begin
  for r in
    select c.relname
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity
      and c.relname not in ('app_users', 'staff_notifications')
  loop
    execute format('drop policy if exists dev_readonly_ins on public.%I', r.relname);
    execute format('drop policy if exists dev_readonly_upd on public.%I', r.relname);
    execute format('drop policy if exists dev_readonly_del on public.%I', r.relname);
    execute format('create policy dev_readonly_ins on public.%I as restrictive for insert with check (not (select public.is_dev_readonly()))', r.relname);
    execute format('create policy dev_readonly_upd on public.%I as restrictive for update using (not (select public.is_dev_readonly())) with check (not (select public.is_dev_readonly()))', r.relname);
    execute format('create policy dev_readonly_del on public.%I as restrictive for delete using (not (select public.is_dev_readonly()))', r.relname);
  end loop;
end $$;

select public.apply_dev_readonly_policies();
-- 之後新增資料表，記得再執行一次：select public.apply_dev_readonly_policies();
