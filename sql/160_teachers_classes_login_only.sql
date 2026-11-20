-- ============================================================
-- 160. 教師名單與班級表只給「已登入」的人讀（未登入者不再讀得到）
-- ------------------------------------------------------------
-- 為什麼：teachers 與 classes 的讀取政策（read_teachers、read_classes）原本是 using (true) 且沒有限定角色，
--        連未登入者拿到網站公開金鑰都能讀：41 位教職員姓名、對應的登入帳號 UUID（app_user_id）、34 班導師對應。
--        登入頁、家長入口、公開競賽頁都沒有用到這兩張表（家長入口走後端 service_role，不受影響）。
-- 作法：政策條件不變（登入者仍然讀得到全部，系統行為不變），只把適用對象從「所有人」限縮為 authenticated。
-- 可重複執行。回復：
--   alter policy read_teachers on public.teachers to public;
--   alter policy read_classes  on public.classes  to public;
-- ============================================================

alter policy read_teachers on public.teachers to authenticated;
alter policy read_classes  on public.classes  to authenticated;
