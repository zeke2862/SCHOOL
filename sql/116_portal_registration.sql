-- ============================================================
-- 116. 家長／學生帳號：第一次由自己「申請」，導師核對後批准
-- ------------------------------------------------------------
-- 原本：學校要先把每位學生／監護人的手機號碼輸入進學籍資料，家長才能用「登入代碼＋手機」登入。
-- 現在：家長／學生第一次在登入頁輸入「登入代碼（HY＋學號；學生本人 HYS＋學號）」和自己的手機號碼，
--       按「申請帳號」，系統就把申請送給那個班的導師；導師對照手上的資料表，確認這支手機真的是
--       自己班學生／家長的，按「核准」——系統會把這支手機自動寫進學籍資料
--       （家長 → 監護人聯絡電話；學生本人 → 學生電話），之後就能直接用代碼＋手機登入，不用學校再輸入。
-- 可重複執行。
-- ============================================================

-- 手機號碼比對用的「標準化」：只留數字、去掉泰國國碼 66、去掉開頭的 0（跟登入驗證用同一套規則）
create or replace function public.portal_phone_key(p text) returns text
language sql immutable as $$
  select case when d2 like '0%' then substr(d2, 2) else d2 end
  from (select case when d like '66%' and length(d) > 9 then substr(d, 3) else d end as d2
        from (select regexp_replace(coalesce(p, ''), '\D', '', 'g') as d) a) b;
$$;

create table if not exists public.portal_registration_requests (
  id uuid primary key default gen_random_uuid(),
  student_no text not null references public.students(student_no) on delete cascade,
  login_code text not null,
  relation text not null check (relation in ('家長', '學生本人')),
  phone text not null,
  phone_key text generated always as (public.portal_phone_key(phone)) stored,
  student_name text,
  class_id uuid references public.classes(id) on delete set null,
  class_label text,
  status text not null default '待審核' check (status in ('待審核', '已核准', '已拒絕')),
  requested_at timestamptz not null default now(),
  decided_by uuid references public.teachers(id) on delete set null,
  decided_at timestamptz,
  decision_note text
);
create index if not exists idx_portal_reg_class_status on public.portal_registration_requests (class_id, status);
create index if not exists idx_portal_reg_student on public.portal_registration_requests (student_no);
-- 同一個代碼＋同一支手機，同一時間只留一筆待審核的（重複按申請不會洗版）
create unique index if not exists uq_portal_reg_pending
  on public.portal_registration_requests (login_code, phone_key) where status = '待審核';

alter table public.portal_registration_requests enable row level security;

-- 讀取：教務／系統管理員看全部；導師只看自己班的。寫入一律走伺服器（申請）或下面的函式（審核），不開放直接寫。
drop policy if exists staff_read_portal_registration on public.portal_registration_requests;
create policy staff_read_portal_registration on public.portal_registration_requests for select to authenticated
  using (
    public.is_system_admin() or public.has_department('academic')
    or exists (select 1 from public.classes c where c.id = portal_registration_requests.class_id
               and c.homeroom_teacher_id = public.current_teacher_id())
  );

-- 有新申請 → 站內通知該班導師
create or replace function public.notify_homeroom_on_portal_request() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_hr uuid;
begin
  select homeroom_teacher_id into v_hr from classes where id = new.class_id;
  if v_hr is not null then
    insert into staff_notifications (teacher_id, category, message, student_no)
    values (v_hr, '審核通知',
            '有' || new.relation || '申請建立登入帳號：' || coalesce(new.student_name, new.student_no) ||
            '（' || coalesce(new.class_label, '') || '），手機 ' || new.phone || '。請到「審核中心 › 家長／學生帳號申請」對照手上資料後核准或拒絕。',
            new.student_no);
  end if;
  return new;
end $$;
drop trigger if exists trg_notify_portal_request on public.portal_registration_requests;
create trigger trg_notify_portal_request after insert on public.portal_registration_requests
  for each row execute function public.notify_homeroom_on_portal_request();

-- 審核：核准 → 把手機寫進學籍資料；拒絕 → 只記錄
create or replace function public.decide_portal_registration(p_id uuid, p_approve boolean, p_relation text default '監護人', p_note text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r portal_registration_requests; v_ok boolean; v_added boolean := false;
begin
  select * into r from portal_registration_requests where id = p_id for update;
  if not found then raise exception '找不到這筆申請'; end if;
  if r.status <> '待審核' then raise exception '這筆申請已經處理過了（%）', r.status; end if;

  v_ok := is_system_admin() or has_department('academic')
          or exists (select 1 from classes c where c.id = r.class_id and c.homeroom_teacher_id = current_teacher_id());
  if not v_ok then raise exception '只有這個班的導師（或教務／系統管理員）可以審核'; end if;

  if p_approve then
    if r.relation = '學生本人' then
      update students set phone = r.phone, updated_at = now() where student_no = r.student_no;
    else
      if not exists (select 1 from guardians g where g.student_no = r.student_no and portal_phone_key(g.phone) = r.phone_key) then
        insert into guardians (student_no, relation, phone) values (r.student_no, coalesce(nullif(p_relation, ''), '監護人'), r.phone);
        v_added := true;
      end if;
    end if;
  end if;

  update portal_registration_requests
     set status = case when p_approve then '已核准' else '已拒絕' end,
         decided_by = current_teacher_id(), decided_at = now(), decision_note = p_note
   where id = p_id;
  return jsonb_build_object('approved', p_approve, 'guardianAdded', v_added);
end $$;
grant execute on function public.decide_portal_registration(uuid, boolean, text, text) to authenticated;

notify pgrst, 'reload schema';
