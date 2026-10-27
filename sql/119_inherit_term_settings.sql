-- ============================================================
-- 119. 科目比重／整體佔比：下學期直接沿用上學期，新學年再詢問是否套用
-- ------------------------------------------------------------
-- 沿用的內容：
--   * grading_rules（期中／期末／平時 整體佔比）
--   * curriculum（各年級科目、科目比重、每週節數）
-- 只「補上目標學期還沒有的」：目標學期已經有的設定一律不動，所以有變動的科目可以先自己輸入，
-- 之後再執行沿用也不會被蓋掉。可重複執行。
--
-- 使用時機：
--   * 同學年 上學期→下學期：把學期設為「目前生效」（set_current_academic_term）時自動沿用，不用詢問。
--   * 新學年：升級作業的對話框會問「是否沿用上學期的科目比重與整體佔比」，勾選才套用
--     （呼叫 inherit_term_settings）。
-- ============================================================

create or replace function public._inherit_term_settings(p_from_year int, p_from_term text, p_to_year int, p_to_term text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_rules int := 0; v_cur int := 0;
begin
  insert into grading_rules (academic_year, term, midterm_weight, final_weight, daily_weight)
    select p_to_year, p_to_term, midterm_weight, final_weight, daily_weight
      from grading_rules where academic_year = p_from_year and term = p_from_term
    on conflict (academic_year, term) do nothing;
  get diagnostics v_rules = row_count;

  insert into curriculum (academic_year, term, grade_level, subject, weight, periods)
    select p_to_year, p_to_term, grade_level, subject, weight, periods
      from curriculum where academic_year = p_from_year and term = p_from_term
    on conflict (academic_year, term, grade_level, subject) do nothing;
  get diagnostics v_cur = row_count;

  return jsonb_build_object('grading_rules', v_rules, 'curriculum', v_cur);
end $$;

-- 給畫面呼叫：教務主管／系統管理員／開發人員
create or replace function public.inherit_term_settings(p_from_year int, p_from_term text, p_to_year int, p_to_term text)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not (is_system_admin() or has_department('dev') or is_department_lead('academic')) then
    raise exception '只有教務主管、系統管理員或開發人員可以沿用科目比重';
  end if;
  return _inherit_term_settings(p_from_year, p_from_term, p_to_year, p_to_term);
end $$;
grant execute on function public.inherit_term_settings(int, text, int, text) to authenticated;

-- 下學期設為「目前生效」時，自動沿用同學年上學期的設定（其餘邏輯與 114 相同）
create or replace function public.set_current_academic_term(p_academic_year int, p_term text) returns void
language plpgsql security definer
as $$
declare
  v_rank int := p_academic_year * 2 + (case when p_term = '下學期' then 1 else 0 end);
begin
  if not (is_system_admin() or has_department('dev')) then
    raise exception '只有開發人員可以切換目前生效學年學期';
  end if;
  update academic_terms set is_current = false where is_current = true;
  update academic_terms set is_current = true, status = '進行中'
    where academic_year = p_academic_year and term = p_term;
  if not found then
    raise exception '找不到學年度 % % ，請先新增這個學年學期', p_academic_year, p_term;
  end if;
  update academic_terms
     set status = '已結束'
   where academic_year * 2 + (case when term = '下學期' then 1 else 0 end) < v_rank
     and status <> '已結束';
  if p_term = '下學期' then
    perform _inherit_term_settings(p_academic_year, '上學期', p_academic_year, '下學期');
  end if;
end;
$$;

-- 現況：目前學年的下學期先補齊
select _inherit_term_settings(academic_year, '上學期', academic_year, '下學期') from academic_terms where is_current and term = '下學期';

notify pgrst, 'reload schema';
