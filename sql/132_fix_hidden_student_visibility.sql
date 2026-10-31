-- ============================================================
-- 132. 修正：休學／轉學的學生，導師（一般教師）仍然看得到
-- ------------------------------------------------------------
-- 根因：student_current_status() / student_is_hidden() 是一般（invoker）函式，會套用「呼叫者」的 RLS。
-- 但 student_status_changes 這張表只有教務處、系統管理員看得到（admin_only_status_changes），
-- 導師查不到任何一筆紀錄 → 函式回傳 null／false → 「隱藏休學學生」的限制性政策形同虛設，
-- 導師的名冊、點名表、成績登錄都還看得到該生。
-- 做法：兩個函式改成 SECURITY DEFINER（以擁有者身分讀取狀態紀錄）。函式只回傳「這個學號目前是什麼狀態／
-- 是否隱藏」，不會洩漏其他欄位。可重複執行。
-- ============================================================
create or replace function public.student_current_status(p_student_no text)
returns enrollment_status_type
language sql stable security definer set search_path = public as $$
  select status
  from student_status_changes
  where student_no = p_student_no
  order by effective_date desc, created_at desc
  limit 1;
$$;

create or replace function public.student_is_hidden(p_student_no text)
returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(
    student_current_status(p_student_no) in ('休學', '轉學', '退學', '畢業', '肄業'),
    false
  );
$$;

grant execute on function public.student_current_status(text) to authenticated;
grant execute on function public.student_is_hidden(text) to authenticated;
