-- ============================================================
-- 125. 家長幫學生請假：導師核准後自動寫進出缺席表
-- ------------------------------------------------------------
-- 流程：家長（家長帳號 HY＋學號）在入口「請假」分頁填日期、病假／事假、原因（可只請某幾節）
--       → 系統通知該班導師 → 導師到「審核中心 › 學生請假申請」按核准
--       → 系統依該班當天的上課節數，把病假／事假寫進出缺席表（attendance），覆蓋原本的曠課／遲到／出席；
--         已經是「公假」的節次不會被改掉。拒絕則只留紀錄。
-- 家長沒有直接寫入權限，一律走下面的函式；可重複執行。
-- ============================================================

create table if not exists public.student_leave_requests (
  id uuid primary key default gen_random_uuid(),
  student_no text not null references public.students(student_no) on delete cascade,
  student_name text,
  class_id uuid references public.classes(id) on delete set null,
  class_label text,
  leave_type text not null check (leave_type in ('病假', '事假')),
  start_date date not null,
  end_date date not null,
  period_from int,                       -- 兩個都是 null＝整天；只請某幾節時只能單日
  period_to int,
  reason text,
  status text not null default '待審核' check (status in ('待審核', '已核准', '已拒絕', '已取消')),
  requested_by uuid references public.portal_accounts(id) on delete set null,
  requested_at timestamptz not null default now(),
  decided_by uuid references public.teachers(id) on delete set null,
  decided_at timestamptz,
  decision_note text,
  applied_periods int,                   -- 核准時實際寫入出缺席表的節數
  constraint student_leave_dates_ok check (end_date >= start_date),
  constraint student_leave_periods_ok check (
    (period_from is null and period_to is null)
    or (period_from is not null and period_to is not null and period_from >= 1 and period_to >= period_from and start_date = end_date)
  )
);
create index if not exists idx_student_leave_class_status on public.student_leave_requests (class_id, status);
create index if not exists idx_student_leave_student on public.student_leave_requests (student_no, requested_at desc);

alter table public.student_leave_requests enable row level security;

drop policy if exists leave_read on public.student_leave_requests;
create policy leave_read on public.student_leave_requests for select to authenticated
  using (
    public.is_linked_parent(student_no)
    or public.is_system_admin() or public.has_department('academic')
    or exists (select 1 from public.classes c where c.id = student_leave_requests.class_id
               and c.homeroom_teacher_id = public.current_teacher_id())
  );

-- 通知類別加上「請假申請」
alter table public.staff_notifications drop constraint if exists staff_notifications_category_check;
alter table public.staff_notifications add constraint staff_notifications_category_check
  check (category = any (array['個資修改申請','出缺勤示警','代課通知','考場通知','學生資料變更','審核通知','代理通知','請假申請']));

-- 某班某天要上幾節：班級 > 部別 > 全校（跟前端 getEffectivePeriodCount 同一套）；週日或沒設定回 0
create or replace function public.class_periods_on(p_class_id uuid, p_date date) returns int
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select period_count from period_config where scope = '班級' and scope_ref = p_class_id::text and weekday = extract(isodow from p_date)::int limit 1),
    (select pc.period_count from period_config pc join classes c on c.id = p_class_id
      where pc.scope = '部別' and pc.scope_ref = c.department and pc.weekday = extract(isodow from p_date)::int limit 1),
    (select period_count from period_config where scope = '全校' and weekday = extract(isodow from p_date)::int limit 1),
    0);
$$;

-- 家長送出請假（只有家長身分的帳號；學生本人不能自己請）
create or replace function public.submit_student_leave(
  p_student_no text, p_type text, p_start date, p_end date,
  p_period_from int default null, p_period_to int default null, p_reason text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_acc uuid; v_class uuid; v_name text; v_label text; v_id uuid;
begin
  select id into v_acc from portal_accounts
   where auth_user_id = auth.uid() and student_no = p_student_no and relation = '家長' limit 1;
  if v_acc is null then raise exception '只有這位學生的家長帳號可以幫他請假'; end if;
  if p_type not in ('病假', '事假') then raise exception '請假類別只能選病假或事假'; end if;
  if p_start is null or p_end is null or p_end < p_start then raise exception '日期不正確，結束日不能早於開始日'; end if;
  if p_end - p_start > 30 then raise exception '一次最多請 31 天，更長的請分開送出或洽導師'; end if;
  if p_start < current_date - 14 then raise exception '只能補請最近 14 天內的假，更早的請洽導師'; end if;
  if (p_period_from is null) <> (p_period_to is null) then raise exception '節次要填起訖兩個'; end if;
  if p_period_from is not null and p_start <> p_end then raise exception '只請某幾節時，只能選同一天'; end if;
  if exists (select 1 from student_leave_requests
              where student_no = p_student_no and status = '待審核'
                and start_date <= p_end and end_date >= p_start) then
    raise exception '這段日期已經有一筆待導師審核的請假，請不要重複送出';
  end if;

  v_class := class_of_student_on(p_student_no, p_start);
  select s.name, coalesce(c.grade_level, '') || coalesce(c.class_name, '')
    into v_name, v_label
    from students s left join classes c on c.id = v_class where s.student_no = p_student_no;

  insert into student_leave_requests (student_no, student_name, class_id, class_label, leave_type, start_date, end_date,
                                      period_from, period_to, reason, requested_by)
  values (p_student_no, v_name, v_class, v_label, p_type, p_start, p_end,
          p_period_from, p_period_to, nullif(btrim(coalesce(p_reason, '')), ''), v_acc)
  returning id into v_id;
  return v_id;
end $$;
grant execute on function public.submit_student_leave(text, text, date, date, int, int, text) to authenticated;

-- 家長在導師處理前可以撤回
create or replace function public.cancel_student_leave(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare r student_leave_requests;
begin
  select * into r from student_leave_requests where id = p_id for update;
  if not found then raise exception '找不到這筆請假'; end if;
  if not is_linked_parent(r.student_no) then raise exception '只有這位學生的家長可以撤回'; end if;
  if r.status <> '待審核' then raise exception '導師已經處理過了（%），無法撤回', r.status; end if;
  update student_leave_requests set status = '已取消', decided_at = now() where id = p_id;
end $$;
grant execute on function public.cancel_student_leave(uuid) to authenticated;

-- 有新請假 → 站內通知該班導師
create or replace function public.notify_homeroom_on_leave() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_hr uuid;
begin
  select homeroom_teacher_id into v_hr from classes where id = new.class_id;
  if v_hr is not null then
    insert into staff_notifications (teacher_id, category, message, student_no)
    values (v_hr, '請假申請',
            '家長幫 ' || coalesce(new.student_name, new.student_no) || '（' || coalesce(new.class_label, '') || '）申請' || new.leave_type ||
            '：' || new.start_date || case when new.end_date <> new.start_date then ' ～ ' || new.end_date else '' end ||
            '。請到「審核中心 › 學生請假申請」核准或拒絕，核准後會自動寫進出缺席表。',
            new.student_no);
  end if;
  return new;
end $$;
drop trigger if exists trg_notify_leave on public.student_leave_requests;
create trigger trg_notify_leave after insert on public.student_leave_requests
  for each row execute function public.notify_homeroom_on_leave();

-- 導師審核：核准 → 把每一天、每一節寫進出缺席表
create or replace function public.decide_student_leave(p_id uuid, p_approve boolean, p_note text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r student_leave_requests; d date; n int; p int; v_from int; v_to int; v_total int := 0; v_rows int;
begin
  select * into r from student_leave_requests where id = p_id for update;
  if not found then raise exception '找不到這筆請假'; end if;
  if r.status <> '待審核' then raise exception '這筆請假已經處理過了（%）', r.status; end if;
  if not (is_system_admin() or has_department('academic')
          or exists (select 1 from classes c where c.id = r.class_id and c.homeroom_teacher_id = current_teacher_id())) then
    raise exception '只有這個班的導師（或教務／系統管理員）可以審核';
  end if;

  if p_approve then
    if r.class_id is null then raise exception '這位學生查不到班級，無法判斷節數，請洽教務處'; end if;
    for d in select generate_series(r.start_date, r.end_date, interval '1 day')::date loop
      n := class_periods_on(r.class_id, d);
      continue when n <= 0;
      v_from := coalesce(r.period_from, 1);
      v_to := least(coalesce(r.period_to, n), n);
      continue when v_from > v_to;
      for p in v_from..v_to loop
        insert into attendance (student_no, record_date, period_no, status, recorded_by)
        values (r.student_no, d, p, r.leave_type::attendance_status, current_teacher_id())
        on conflict (student_no, record_date, period_no)
        do update set status = excluded.status, recorded_by = excluded.recorded_by, updated_at = now()
          where attendance.status <> '公假';
        get diagnostics v_rows = row_count;
        v_total := v_total + v_rows;
      end loop;
    end loop;
    if v_total = 0 then
      raise exception '這段日期沒有可寫入的上課節次（週日、或這個班／部別還沒設定每天幾節），請洽教務處設定節數後再核准';
    end if;
  end if;

  update student_leave_requests
     set status = case when p_approve then '已核准' else '已拒絕' end,
         decided_by = current_teacher_id(), decided_at = now(),
         decision_note = nullif(btrim(coalesce(p_note, '')), ''),
         applied_periods = case when p_approve then v_total end
   where id = p_id;
  return jsonb_build_object('approved', p_approve, 'periods', v_total);
end $$;
grant execute on function public.decide_student_leave(uuid, boolean, text) to authenticated;

notify pgrst, 'reload schema';
