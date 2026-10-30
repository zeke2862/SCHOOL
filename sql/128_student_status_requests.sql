-- ============================================================
-- 128. 導師申請學生「休學／轉學／轉班」，教務處同意後系統立刻修正班級名單
-- ------------------------------------------------------------
-- 流程：導師在「出缺勤登錄（點名）」頁按「學籍異動申請」→ 選類別（休學／轉學／轉班）
--       → 勾選本班同學（可批次，每位學生各填原因，預設「搬家到曼谷」）→ 送出
--       → 教務處到「審核中心 › 學籍異動申請」按同意
--       → 同意後（以下全部在同一個交易裡完成）：
--          休學／轉學：寫入 student_status_changes（student_is_hidden() 立刻為真，
--                      該生的名冊、成績、出缺勤、獎懲等資料從一般畫面全部隱藏）；
--                      該生的家長／學生本人入口帳號標記停權（suspended_at），
--                      並由 API 同步把對應的登入帳號封鎖（見 app/api/admin/student-status-requests/decide）。
--                      座號保留（enrollments 不動），其他同學的座號不變。
--          轉班：    舊班紀錄標成非現行，新班新增一筆現行紀錄（座號＝新班目前最大座號＋1），
--                    舊班其他同學的座號不變。
-- 隱藏後只有教務處、管理員A、系統管理員S 查得到（本檔同時把原本連管理員B 都放行的
-- 隱藏政策收斂成這三種身分）。
-- 導師沒有直接寫入權限，一律走下面的函式；可重複執行。
-- ============================================================

-- ---------- 1. 入口帳號停權欄位 ----------
alter table public.portal_accounts add column if not exists suspended_at timestamptz;
alter table public.portal_accounts add column if not exists suspended_reason text;

-- 停權帳號在資料庫這層也不再被視為「該學生的家長／本人」（就算登入封鎖沒成功，也讀不到資料）
create or replace function public.is_linked_parent(p_student_no text) returns boolean
language sql stable as $$
  select exists (
    select 1 from portal_accounts pa
    where pa.auth_user_id = auth.uid() and pa.student_no = p_student_no and pa.suspended_at is null
  );
$$;

create or replace function public.current_portal_student_no() returns text
language sql stable as $$
  select student_no from portal_accounts
  where auth_user_id = auth.uid() and relation = '學生本人' and suspended_at is null
  limit 1;
$$;

-- ---------- 2. 誰能看到已隱藏學生：教務處、管理員A、系統管理員S ----------
create or replace function public.can_view_hidden_students() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(current_role_name()::text in ('admin_a', 'system_admin_s'), false)
         or has_department('academic');
$$;
grant execute on function public.can_view_hidden_students() to authenticated;

drop policy if exists hide_status_changed_students_students on public.students;
create policy hide_status_changed_students_students on public.students as restrictive
  using (public.can_view_hidden_students() or not public.student_is_hidden(student_no))
  with check (public.can_view_hidden_students() or not public.student_is_hidden(student_no));

drop policy if exists hide_status_changed_students_enrollments on public.enrollments;
create policy hide_status_changed_students_enrollments on public.enrollments as restrictive
  using (public.can_view_hidden_students() or not public.student_is_hidden(student_no))
  with check (public.can_view_hidden_students() or not public.student_is_hidden(student_no));

drop policy if exists hide_status_changed_students_attendance on public.attendance;
create policy hide_status_changed_students_attendance on public.attendance as restrictive
  using (public.can_view_hidden_students() or not public.student_is_hidden(student_no))
  with check (public.can_view_hidden_students() or not public.student_is_hidden(student_no));

drop policy if exists hide_status_changed_students_conduct_events on public.conduct_events;
create policy hide_status_changed_students_conduct_events on public.conduct_events as restrictive
  using (public.can_view_hidden_students() or not public.student_is_hidden(student_no))
  with check (public.can_view_hidden_students() or not public.student_is_hidden(student_no));

drop policy if exists hide_status_changed_students_guardians on public.guardians;
create policy hide_status_changed_students_guardians on public.guardians as restrictive
  using (public.can_view_hidden_students() or not public.student_is_hidden(student_no))
  with check (public.can_view_hidden_students() or not public.student_is_hidden(student_no));

drop policy if exists hide_status_changed_students_scores on public.scores;
create policy hide_status_changed_students_scores on public.scores as restrictive
  using (public.can_view_hidden_students()
         or not public.student_is_hidden((select e.student_no from enrollments e where e.id = scores.enrollment_id)))
  with check (public.can_view_hidden_students()
         or not public.student_is_hidden((select e.student_no from enrollments e where e.id = scores.enrollment_id)));

drop policy if exists hide_status_changed_students_student_remarks on public.student_remarks;
create policy hide_status_changed_students_student_remarks on public.student_remarks as restrictive
  using (public.can_view_hidden_students()
         or not public.student_is_hidden((select e.student_no from enrollments e where e.id = student_remarks.enrollment_id)))
  with check (public.can_view_hidden_students()
         or not public.student_is_hidden((select e.student_no from enrollments e where e.id = student_remarks.enrollment_id)));

-- ---------- 3. 申請表 ----------
create table if not exists public.student_status_requests (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null,                       -- 同一次送出的多位學生共用
  request_type text not null check (request_type in ('休學', '轉學', '轉班')),
  student_no text not null references public.students(student_no) on delete cascade,
  student_name text,
  class_id uuid references public.classes(id) on delete set null,
  class_label text,
  seat_no int,
  target_class_id uuid references public.classes(id) on delete set null,   -- 只有「轉班」用
  target_class_label text,
  reason text,
  status text not null default '待審核' check (status in ('待審核', '已核准', '已駁回', '已取消')),
  requested_by uuid references public.teachers(id) on delete set null,
  requester_name text,
  requested_at timestamptz not null default now(),
  decided_by uuid,
  decider_name text,
  decided_at timestamptz,
  decision_note text,
  constraint student_status_req_target_ok check (request_type <> '轉班' or target_class_id is not null)
);
create index if not exists idx_student_status_req_status on public.student_status_requests (status, requested_at desc);
create index if not exists idx_student_status_req_class on public.student_status_requests (class_id, status);
create index if not exists idx_student_status_req_student on public.student_status_requests (student_no);

alter table public.student_status_requests enable row level security;
drop policy if exists status_req_read on public.student_status_requests;
create policy status_req_read on public.student_status_requests for select to authenticated
  using (
    public.can_view_hidden_students()
    or exists (select 1 from public.classes c where c.id = student_status_requests.class_id
               and c.homeroom_teacher_id = public.current_teacher_id())
  );

-- 通知類別加上「學籍異動申請」
alter table public.staff_notifications drop constraint if exists staff_notifications_category_check;
alter table public.staff_notifications add constraint staff_notifications_category_check
  check (category = any (array['個資修改申請','出缺勤示警','代課通知','考場通知','學生資料變更','審核通知','代理通知','請假申請','學籍異動申請']));

-- ---------- 4. 導師送出申請 ----------
-- p_items 例：[{"student_no":"0123","reason":"搬家到曼谷"}, ...]
create or replace function public.submit_student_status_requests(p_type text, p_items jsonb, p_target_class uuid default null)
returns int language plpgsql security definer set search_path = public as $$
declare
  v_teacher uuid := current_teacher_id();
  v_tname text;
  v_batch uuid := gen_random_uuid();
  v_item jsonb; v_no text; v_reason text;
  v_name text; v_class uuid; v_label text; v_seat int; v_hr uuid;
  v_tlabel text; v_count int := 0; v_names text[] := '{}';
begin
  if v_teacher is null then raise exception '只有教師帳號可以送出申請'; end if;
  if p_type not in ('休學', '轉學', '轉班') then raise exception '類別只能是休學、轉學或轉班'; end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception '請至少勾選一位學生';
  end if;
  select name into v_tname from teachers where id = v_teacher;

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
    if v_hr is distinct from v_teacher and not is_system_admin() then
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

-- ---------- 5. 導師在教務處處理前撤回 ----------
create or replace function public.cancel_student_status_request(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare r student_status_requests;
begin
  select * into r from student_status_requests where id = p_id for update;
  if not found then raise exception '找不到這筆申請'; end if;
  if r.status <> '待審核' then raise exception '教務處已經處理過了（%），無法撤回', r.status; end if;
  if r.requested_by is distinct from current_teacher_id() and not can_view_hidden_students() then
    raise exception '只有送出申請的導師可以撤回';
  end if;
  update student_status_requests set status = '已取消', decided_at = now() where id = p_id;
end $$;
grant execute on function public.cancel_student_status_request(uuid) to authenticated;

-- ---------- 6. 教務處同意／駁回（只給 API 用 service role 呼叫，因為還要同步封鎖登入帳號） ----------
-- 回傳：{ approved, type, student_no, auth_user_ids: [要封鎖登入的帳號 id] }
create or replace function public.apply_student_status_request(p_id uuid, p_approve boolean, p_note text, p_decider uuid, p_decider_name text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  r student_status_requests; v_enr enrollments; v_seat int; v_ban uuid[] := '{}';
begin
  select * into r from student_status_requests where id = p_id for update;
  if not found then raise exception '找不到這筆申請'; end if;
  if r.status <> '待審核' then raise exception '這筆申請已經處理過了（%）', r.status; end if;

  if p_approve then
    select * into v_enr from enrollments where student_no = r.student_no and is_current order by created_at desc limit 1;
    if v_enr.id is null then raise exception '% 查不到現行班級，無法處理', r.student_no; end if;

    if r.request_type in ('休學', '轉學') then
      insert into student_status_changes (student_no, status, effective_date, reason, changed_by)
      values (r.student_no, r.request_type::enrollment_status_type, current_date,
              coalesce(r.reason, '') || '（導師申請，教務處同意）', p_decider);

      update portal_accounts
         set suspended_at = now(), suspended_reason = r.request_type || '：' || coalesce(r.reason, '')
       where student_no = r.student_no and suspended_at is null;

      -- 只封鎖「純粹的入口帳號」：同時是教職員的家長帳號、或還綁著其他未停權學生（兄弟姊妹）的帳號不封，
      -- 這些靠上面的 suspended_at 在資料庫層擋掉該生資料即可。
      select coalesce(array_agg(distinct pa.auth_user_id), '{}') into v_ban
        from portal_accounts pa
       where pa.student_no = r.student_no and pa.auth_user_id is not null
         and not exists (select 1 from app_users u where u.id = pa.auth_user_id)
         and not exists (select 1 from portal_accounts o
                          where o.auth_user_id = pa.auth_user_id and o.suspended_at is null);
    else
      -- 轉班：舊班標成非現行（座號留在舊班，其他同學不變），新班新增一筆，座號接在新班最後
      -- （最大座號連同已離班、休學保留的座號一起算，才不會撞號；學生以前就待過新班則沿用原座號）
      update enrollments set is_current = false where id = v_enr.id;
      select seat_no into v_seat from enrollments
       where class_id = r.target_class_id and term = v_enr.term and student_no = r.student_no limit 1;
      if v_seat is not null then
        update enrollments set is_current = true
         where class_id = r.target_class_id and term = v_enr.term and student_no = r.student_no;
      else
        select coalesce(max(seat_no), 0) + 1 into v_seat from enrollments
         where class_id = r.target_class_id and term = v_enr.term;
        insert into enrollments (student_no, class_id, term, seat_no, is_current)
        values (r.student_no, r.target_class_id, v_enr.term, v_seat, true);
      end if;
    end if;
  end if;

  update student_status_requests
     set status = case when p_approve then '已核准' else '已駁回' end,
         decided_by = p_decider, decider_name = p_decider_name, decided_at = now(),
         decision_note = nullif(btrim(coalesce(p_note, '')), '')
   where id = p_id;

  -- 通知送出申請的導師
  if r.requested_by is not null then
    insert into staff_notifications (teacher_id, category, message, student_no)
    values (r.requested_by, '學籍異動申請',
            coalesce(r.student_name, r.student_no) || '（' || coalesce(r.class_label, '') || '）的' || r.request_type || '申請' ||
            case when p_approve then '教務處已同意，班級名單已更新。' else '被教務處駁回' || coalesce('：' || nullif(btrim(coalesce(p_note, '')), ''), '。') end,
            r.student_no);
  end if;

  return jsonb_build_object('approved', p_approve, 'type', r.request_type, 'student_no', r.student_no, 'auth_user_ids', to_jsonb(v_ban));
end $$;
revoke all on function public.apply_student_status_request(uuid, boolean, text, uuid, text) from public, anon, authenticated;
grant execute on function public.apply_student_status_request(uuid, boolean, text, uuid, text) to service_role;

notify pgrst, 'reload schema';
