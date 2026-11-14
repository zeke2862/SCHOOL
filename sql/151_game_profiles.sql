-- ============================================================
-- 151. 遊戲化面板（RPG／經營風）的個人進度表
-- ------------------------------------------------------------
-- 只存「經驗值、星星、連勝、建築等級」這些玩家進度；任務本身（點名、通知）
-- 一律由既有資料表即時推導，不重複儲存。每位老師一列，只能讀寫自己的那一列。
-- 沒執行這份 SQL 也不會壞：前端會退回用這台裝置的瀏覽器記錄進度（換裝置就不會跟著走）。
-- 可重複執行。
-- ============================================================

create table if not exists public.game_profiles (
  teacher_id uuid primary key references public.teachers(id) on delete cascade,
  xp integer not null default 0,
  stars integer not null default 0,
  streak integer not null default 0,
  last_day date,
  claimed_day date,
  claimed jsonb not null default '[]'::jsonb,
  buildings jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

-- 寵物（飼料、領養的夥伴）與花園（花圃、圖鑑）。已經執行過舊版的人，重跑這份即可補上欄位
alter table public.game_profiles add column if not exists extras jsonb not null default '{}'::jsonb;

alter table public.game_profiles enable row level security;

drop policy if exists game_profiles_own on public.game_profiles;
create policy game_profiles_own on public.game_profiles for all to authenticated
  using (teacher_id = public.current_teacher_id())
  with check (teacher_id = public.current_teacher_id());

-- 代課教師當天要能看到「這節點名了沒」，任務板才不會把已點名的代課節次顯示成未完成
drop policy if exists substitute_read_roll_calls on public.attendance_roll_calls;
create policy substitute_read_roll_calls on public.attendance_roll_calls
  for select using (public.is_substitute_today(class_id, period_no));
