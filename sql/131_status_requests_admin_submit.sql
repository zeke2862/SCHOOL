-- ============================================================
-- 131. 學籍異動申請：教務處、管理員A、系統管理員S 也可以替任何班送出
-- ------------------------------------------------------------
-- 導師仍只能申請自己導師班的學生；這三種身分不限班級。送出後一樣是「待審核」，由有權限的人按同意。可重複執行。
-- ============================================================
create or replace function public.submit_student_status_requests(p_type text, p_items jsonb, p_target_class uuid default null)
returns int language plpgsql security definer set search_path = public as $$
declare
  v_teacher uuid := current_teacher_id();
  v_admin boolean := can_view_hidden_students();  -- 教務處、管理員A、系統管理員S：可替任何班送出
  v_tname text;
  v_batch uuid := gen_random_uuid();
  v_item jsonb; v_no text; v_reason text;
  v_name text; v_class uuid; v_label text; v_seat int; v_hr uuid;
  v_tlabel text; v_count int := 0; v_names text[] := '{}';
begin
  if v_teacher is null and not v_admin then raise exception '只有教師帳號（或教務處、管理員A、S）可以送出申請'; end if;
  if p_type not in ('休學', '轉學', '轉班') then raise exception '類別只能是休學、轉學或轉班'; end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception '請至少勾選一位學生';
  end if;
  select coalesce((select name from teachers where id = v_teacher), (select name from app_users where id = auth.uid())) into v_tname;

  if p_type = '轉班' then
    if p_target_class is null then raise exception '轉班請選擇轉入的班級'; end if;
    select academic_year || ' ' || grade_level || class_name into v_tlabel from classes where id = p_target_class;
    if v_tlabel is null then raise exception '找不到轉入的班級'; end if;
  end if;

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_no := btrim(coalesce(v_item->>'student_no', ''));
    v_reason := nullif(btrim(coalesce(v_item->>'reason', '')), '');
    if v_no = '' then continue; end if;
    if v_reason is null then raise exception '學號 % 沒有填寫原因', v_no; end if;

    select e.class_id, e.seat_no, c.homeroom_teacher_id, c.academic_year || ' ' || c.grade_level || c.class_name
      into v_class, v_seat, v_hr, v_label
      from enrollments e join classes c on c.id = e.class_id
     where e.student_no = v_no and e.is_current
     order by e.created_at desc limit 1;
    if v_class is null then raise exception '學號 % 查不到現行班級', v_no; end if;
    if v_hr is distinct from v_teacher and not v_admin then
      raise exception '學號 % 不是你導師班的學生', v_no;
    end if;
    if student_is_hidden(v_no) then raise exception '學號 % 已經是休學／轉學等狀態', v_no; end if;
    if p_type = '轉班' and p_target_class = v_class then raise exception '學號 % 轉入的班級就是原班級', v_no; end if;
    if exists (select 1 from student_status_requests where student_no = v_no and status = '待審核') then
      raise exception '學號 % 已有一筆待教務處審核的申請，請不要重複送出', v_no;
    end if;

    select name into v_name from students where student_no = v_no;
    insert into student_status_requests (batch_id, request_type, student_no, student_name, class_id, class_label, seat_no,
                                         target_class_id, target_class_label, reason, requested_by, requester_name)
    values (v_batch, p_type, v_no, v_name, v_class, v_label, v_seat,
            case when p_type = '轉班' then p_target_class end, case when p_type = '轉班' then v_tlabel end,
            v_reason, v_teacher, v_tname);
    v_count := v_count + 1;
    v_names := v_names || coalesce(v_name, v_no);
  end loop;

  if v_count = 0 then raise exception '請至少勾選一位學生'; end if;

  -- 站內通知教務處
  insert into staff_notifications (teacher_id, category, message)
  select distinct t.id, '學籍異動申請',
         coalesce(v_tname, '導師') || ' 申請 ' || p_type || '（' || v_count || ' 位）：' || array_to_string(v_names[1:5], '、') ||
         case when v_count > 5 then ' 等' else '' end ||
         '。請到「審核中心 › 學籍異動申請」同意或駁回。'
    from teachers t
    join app_user_departments d on d.app_user_id = t.app_user_id and d.department = 'academic';
  return v_count;
end $$;
grant execute on function public.submit_student_status_requests(text, jsonb, uuid) to authenticated;

notify pgrst, 'reload schema';
