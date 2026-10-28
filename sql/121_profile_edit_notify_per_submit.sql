-- ============================================================
-- 121. 家長／學生更新基本資料的通知：一次送出只發一則（請在 107 之後執行；可重複執行）
-- ------------------------------------------------------------
-- 原本 trg_notify_profile_edit 是 for each row，家長在入口一次改 12 項（前端一次 insert 12 列），
-- 導師就收到 12 則通知。改成 for each statement + 轉移表（new table），
-- 同一次送出裡「同一個學生、同一個送出帳號」合併成一則，內容逐項列出變更欄位。
-- 只改通知；apply_profile_edit（直接生效）與 mark_profile_edits_read（導師／教務已閱讀）不變。
-- ============================================================
create or replace function public.profile_edit_field_label(p_table text, p_field text)
returns text language sql immutable as $$
  select case p_field
    when 'name' then '姓名' when 'gender' then '性別' when 'thai_name' then '泰文姓名'
    when 'dob' then '出生日期' when 'id_number' then '身分證／護照號碼' when 'nationality' then '國籍'
    when 'religion' then '宗教' when 'blood_type' then '血型' when 'address' then '地址'
    when 'phone' then '電話' when 'previous_school' then '原就讀學校' when 'previous_school_grade' then '原就讀年級'
    when 'chinese_name' then '中文姓名' when 'email' then 'Email' when 'occupation' then '職業'
    else p_field end;
$$;

create or replace function public.notify_profile_edit_batch()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  r record; v_name text; v_homeroom uuid; v_all text; v_acad text; v_all_n int; v_acad_n int;
begin
  for r in select distinct student_no, requested_by from new_rows loop
    select name into v_name from students where student_no = r.student_no;

    with items as (
      select n.*,
             case when n.target_table = 'guardians' then coalesce(nullif(g.relation, ''), '監護人') else '' end
               || profile_edit_field_label(n.target_table, n.field_name) as label
        from new_rows n left join guardians g on g.id = n.guardian_id
       where n.student_no = r.student_no and n.requested_by is not distinct from r.requested_by
    ), numbered as (
      select i.*, row_number() over (order by i.target_table desc, i.guardian_id nulls first, i.label) as k from items i
    )
    select count(*),
           string_agg(format('%s. %s：「%s」（原：%s）', k, label, coalesce(new_value, ''), coalesce(nullif(old_value, ''), '空白')), E'\n' order by k),
           count(*) filter (where notify_academic),
           string_agg(format('・%s：「%s」（原：%s）', label, coalesce(new_value, ''), coalesce(nullif(old_value, ''), '空白')), E'\n' order by k)
             filter (where notify_academic)
      into v_all_n, v_all, v_acad_n, v_acad
      from numbered;

    select c.homeroom_teacher_id into v_homeroom
      from enrollments e join classes c on c.id = e.class_id
     where e.student_no = r.student_no and e.is_current
     order by e.created_at desc limit 1;
    if v_homeroom is not null then
      insert into staff_notifications(teacher_id, category, message, student_no)
      values (v_homeroom, '學生資料變更',
              format('%s（%s）的資料已由家長／學生更新 %s 項，請閱讀確認：', coalesce(v_name, r.student_no), r.student_no, v_all_n)
                || E'\n' || v_all,
              r.student_no);
    end if;

    if v_acad_n > 0 then
      insert into staff_notifications(teacher_id, category, message, student_no)
      select distinct t.id, '學生資料變更',
             format('【教務處】%s（%s）有 %s 項學籍資料已變更，請核對：', coalesce(v_name, r.student_no), r.student_no, v_acad_n)
               || E'\n' || v_acad,
             r.student_no
        from app_user_departments d join teachers t on t.app_user_id = d.app_user_id
       where d.department = 'academic';
    end if;
  end loop;
  return null;
end; $$;

drop trigger if exists trg_notify_profile_edit on public.profile_edit_requests;
create trigger trg_notify_profile_edit after insert on public.profile_edit_requests
  referencing new table as new_rows
  for each statement execute function public.notify_profile_edit_batch();

notify pgrst, 'reload schema';
