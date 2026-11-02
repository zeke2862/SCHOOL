-- 「聘書」從系統管理搬到【行政管理】的獨立入口，使用者改為：教務處、管理員A、系統管理員S（開發人員部門原本就能用）。
-- 資料庫的存取權限也要跟著放寬，不然畫面開得起來、資料讀寫會被擋。
do $$
declare t text;
begin
  foreach t in array array['teacher_service_certificates','teacher_appointment_letters','teacher_letter_settings'] loop
    execute format('drop policy if exists academic_admin_all_%1$s on public.%1$s', t);
    execute format(
      'create policy academic_admin_all_%1$s on public.%1$s for all using (public.has_department(''academic''::public.admin_department) or public.current_role_name()::text = ''admin_a'') with check (public.has_department(''academic''::public.admin_department) or public.current_role_name()::text = ''admin_a'')',
      t);
  end loop;
end $$;
