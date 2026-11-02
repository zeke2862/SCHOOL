-- 班級點名冊封面的版面設定（全校共用一份）：每個文字／圖片的位置、大小、字級、顏色…存成 JSON。
-- 教職員都能讀（列印封面要用），只有系統管理員或教務處能修改。
create table if not exists public.rollbook_cover_layout (
  id boolean primary key default true check (id),
  layout jsonb not null,
  updated_by uuid,
  updated_at timestamptz not null default now()
);

alter table public.rollbook_cover_layout enable row level security;

drop policy if exists rollbook_cover_layout_read on public.rollbook_cover_layout;
create policy rollbook_cover_layout_read on public.rollbook_cover_layout
  for select using (exists (select 1 from public.app_users u where u.id = auth.uid()));

drop policy if exists rollbook_cover_layout_write on public.rollbook_cover_layout;
create policy rollbook_cover_layout_write on public.rollbook_cover_layout
  for all
  using (public.is_system_admin() or public.has_department('academic'::public.admin_department))
  with check (public.is_system_admin() or public.has_department('academic'::public.admin_department));
