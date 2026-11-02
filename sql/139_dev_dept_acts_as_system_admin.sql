-- 「開發人員（dev）部門」的帳號要具備跟系統管理員S完全相同的權限。
-- is_system_admin() 本來就把 dev 算進去，但還有一批資料庫政策與函式是直接比對
-- current_role_name() = 'system_admin_s'（網站內容、系統設定、模組顯示設定、帳號部門管理、
-- 備份上傳、公佈欄、成績單範本、教師資料、可看已隱藏學生…），dev 帳號會被擋下。
-- 這裡讓 current_role_name() 對 dev 部門成員回傳 system_admin_s，所有這些政策與函式就一次對齊。
-- （前端與 API 本來就把 dev 視同 S：lib/supabaseClient.ts、lib/effectiveRole.ts。）
create or replace function public.current_role_name()
returns public.user_role
language sql
stable
security definer
set search_path to 'public'
as $$
  select case
           when exists (select 1 from app_user_departments d where d.app_user_id = u.id and d.department = 'dev')
             then 'system_admin_s'::user_role
           else u.role
         end
  from app_users u
  where u.id = auth.uid()
    and (u.account_expires_at is null or u.account_expires_at > now());
$$;
