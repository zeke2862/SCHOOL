-- =====================================================================
-- 108：「點名完成」紀錄（請在 107 之後執行；可重複執行）
-- ---------------------------------------------------------------------
-- 為什麼要有這張表：
--   出缺席的 Excel 下載與 JSON 備份改成「只放非出席（遲到／曠課／請假）」之後，
--   檔案只剩原本約 2～3%。但「某一節沒有任何紀錄」可能是全班都到，也可能是老師忘了點名，
--   兩者分不出來。這張表記下「哪一班、哪一天、第幾節已經點過名」，每班每節一筆，
--   跟「非出席紀錄」放在一起，就能完整還原：
--     有點名紀錄＋沒有非出席紀錄 → 全員出席
--     沒有點名紀錄                → 還沒點名
-- 資料怎麼來：
--   ① 每次寫入／修改出缺席（網頁點名、修正申請核准、Excel 上傳）時，資料庫自動記一筆
--   ② 執行這份 SQL 時，用現有的出缺席紀錄一次補齊歷史資料
-- =====================================================================

create table if not exists public.attendance_roll_calls (
  id uuid primary key default gen_random_uuid(),
  class_id uuid not null references public.classes(id) on delete cascade,
  record_date date not null,
  period_no integer not null,
  recorded_by uuid references public.teachers(id) on delete set null,
  first_recorded_at timestamptz not null default now(),
  last_recorded_at timestamptz not null default now(),
  constraint attendance_roll_calls_class_date_period_key unique (class_id, record_date, period_no)
);
create index if not exists attendance_roll_calls_date_idx on public.attendance_roll_calls(record_date);

alter table public.attendance_roll_calls enable row level security;

-- 讀取：跟出缺席相同的人（S／開發人員、訓導處、該班導師、該班任課教師）
drop policy if exists roll_calls_read on public.attendance_roll_calls;
create policy roll_calls_read on public.attendance_roll_calls for select to authenticated using (
  public.is_system_admin()
  or public.has_department('discipline'::public.admin_department)
  or exists (select 1 from public.classes c where c.id = class_id and c.homeroom_teacher_id = public.current_teacher_id())
  or exists (select 1 from public.class_schedule cs where cs.class_id = attendance_roll_calls.class_id and cs.teacher_id = public.current_teacher_id())
);
-- 寫入：一般使用者不直接寫，一律由下面的觸發器自動記錄；S／開發人員可手動整理
drop policy if exists roll_calls_admin_write on public.attendance_roll_calls;
create policy roll_calls_admin_write on public.attendance_roll_calls for all to authenticated
  using (public.is_system_admin()) with check (public.is_system_admin());

-- 某學生在某一天屬於哪一班：先看那天落在哪個學年學期，再找那學期的編班；
-- 學年學期沒設定日期時，退回用「目前在籍」的班級
create or replace function public.class_of_student_on(p_student_no text, p_date date)
returns uuid language sql stable security definer set search_path = public as $$
  select coalesce(
    (select e.class_id
       from academic_terms t
       join classes c on c.academic_year = t.academic_year
       join enrollments e on e.class_id = c.id and e.term = t.term and e.student_no = p_student_no
      where p_date between t.term_start_date and t.term_end_date
      order by e.is_current desc, e.created_at desc limit 1),
    (select e.class_id from enrollments e where e.student_no = p_student_no and e.is_current
      order by e.created_at desc limit 1));
$$;

create or replace function public.trg_record_roll_call()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into attendance_roll_calls(class_id, record_date, period_no, recorded_by)
  select v.class_id, new.record_date, new.period_no, coalesce(new.recorded_by, current_teacher_id())
    from (select class_of_student_on(new.student_no, new.record_date) as class_id) v
   where v.class_id is not null
  on conflict (class_id, record_date, period_no)
  do update set last_recorded_at = now(),
                recorded_by = coalesce(excluded.recorded_by, attendance_roll_calls.recorded_by);
  return null;
end; $$;

drop trigger if exists trg_record_roll_call on public.attendance;
create trigger trg_record_roll_call after insert or update of status, record_date, period_no on public.attendance
  for each row execute function public.trg_record_roll_call();

-- 歷史資料一次補齊（已存在的不會重複）。先把「學生＋日期」去重複再找班級，速度快很多；
-- 全校幾十萬筆出缺席大約需要數十秒。
with sd as (
  select distinct student_no, record_date from public.attendance
), sc as (
  select student_no, record_date, public.class_of_student_on(student_no, record_date) as class_id from sd
)
insert into public.attendance_roll_calls(class_id, record_date, period_no, recorded_by, first_recorded_at, last_recorded_at)
select sc.class_id, a.record_date, a.period_no,
       (array_agg(a.recorded_by order by a.updated_at desc) filter (where a.recorded_by is not null))[1],
       min(a.updated_at), max(a.updated_at)
  from public.attendance a
  join sc on sc.student_no = a.student_no and sc.record_date = a.record_date
 where sc.class_id is not null
 group by sc.class_id, a.record_date, a.period_no
on conflict (class_id, record_date, period_no) do nothing;
