-- =====================================================================
-- 105：四部門 Excel 上傳支援 ＋ 課表重複列清理
-- ---------------------------------------------------------------------
-- 已上線的資料庫，在 Supabase 後台 SQL Editor 依「步驟 A → B → C」順序執行即可。
-- 全新安裝：01～04 執行完再執行這一份即可（步驟 B 在空資料庫上不會刪到任何東西）。
-- =====================================================================


-- =====================================================================
-- 步驟 A（建議必做）：讓「Excel 上傳」可以匯入完整獎懲紀錄
-- ---------------------------------------------------------------------
-- 原本 conduct_events 有一個「寫入前檢查」觸發器：不是系統管理員S、也不是訓導部門的人，
-- 只能登記「嘉獎／小功」，而且分數會被強制改成預設值。
-- 四部門 Excel 的上傳是由伺服器（service role）代為寫入，身分判斷不到「系統管理員S／訓導」，
-- 會被這個檢查擋下來，大功／大過／警告等紀錄、以及自訂分數就匯入不進去。
-- 這裡只加一個例外：伺服器端 service role 的寫入直接放行；
-- 一般老師透過網頁登記的規則完全不變。
-- =====================================================================
-- 【合併說明】步驟 A 已整合進 107（同樣放行 service role，另外放行審核通過後的寫入），
-- 這裡改成註解，避免順序弄錯時把 107 的版本蓋掉。
-- CREATE OR REPLACE FUNCTION public.enforce_conduct_event_rules() RETURNS trigger
--     LANGUAGE plpgsql SECURITY DEFINER
--     SET search_path TO 'public'
--     AS $$
-- declare
--   v_default numeric;
-- begin
--   -- 伺服器端（service role）代為寫入，例如四部門 Excel 上傳：直接放行
--   if coalesce(auth.role(), '') = 'service_role' then
--     return new;
--   end if;

--   if is_system_admin() or has_department('discipline') then
--     return new;
--   end if;

--   if new.reason is null or btrim(new.reason) = '' then
--     raise exception '獎懲登記一定要填寫原因';
--   end if;
--   if new.event_type not in ('嘉獎', '小功') then
--     raise exception '教師只能登記嘉獎或小功';
--   end if;
--   select points into v_default from conduct_point_defaults where item = new.event_type;
--   new.points := coalesce(v_default, case new.event_type when '小功' then 3 else 1 end);
--   if new.points > 3 then
--     raise exception '教師單筆獎勵上限為 1 小功';
--   end if;
--   return new;
-- end;
-- $$;



-- =====================================================================
-- 步驟 B：清掉「任課教師設定」重複列（可以先只跑 B-1 看有多少筆）
-- ---------------------------------------------------------------------
-- class_schedule 裡 weekday、period_no 都是空的列＝「這個班這一科由誰教」。
-- 舊版上傳程式每次都會多新增一筆（詳見 lib/bulkHandlers.ts 的修正說明），越積越多。
-- 這裡只刪「同班、同學年、同學期、同科目、同老師」完全相同的多餘列，每組保留 id 最小的 1 筆；
-- 有排星期節次的正式課表一筆都不會動。
-- 執行前建議先到「開發人員資料中心」按一次「立即備份」。
-- =====================================================================

-- B-1：先看有多少筆會被刪（只查詢，不改資料）
SELECT count(*) AS will_delete
FROM public.class_schedule a
JOIN public.class_schedule b
  ON a.weekday IS NULL AND a.period_no IS NULL
 AND b.weekday IS NULL AND b.period_no IS NULL
 AND a.class_id = b.class_id AND a.academic_year = b.academic_year AND a.term = b.term
 AND a.subject = b.subject AND a.teacher_id = b.teacher_id
 AND a.id > b.id;

-- B-2：真的刪除
DELETE FROM public.class_schedule a
USING public.class_schedule b
WHERE a.weekday IS NULL AND a.period_no IS NULL
  AND b.weekday IS NULL AND b.period_no IS NULL
  AND a.class_id = b.class_id AND a.academic_year = b.academic_year AND a.term = b.term
  AND a.subject = b.subject AND a.teacher_id = b.teacher_id
  AND a.id > b.id;

-- B-3：加上唯一限制，以後資料庫自己擋住重複（B-2 做完才能執行）
CREATE UNIQUE INDEX IF NOT EXISTS class_schedule_assignment_uk
  ON public.class_schedule (class_id, academic_year, term, subject, teacher_id)
  WHERE weekday IS NULL AND period_no IS NULL;


-- =====================================================================
-- 步驟 C（只查詢，不改資料）：需要人工判斷的重複
-- =====================================================================

-- C-1：同一位學生、同一天、同類別、同事由，卻有兩筆以上「獎懲申請」（可能是批次重複送出）
SELECT r.student_no, s.name AS student_name, r.event_date, r.event_type, r.reason,
       count(*) AS copies,
       string_agg(r.status || '／批次' || left(r.batch_id::text, 6) || '／' || r.count || '次=' || r.points || '分', '；' ORDER BY r.requested_at) AS detail
FROM public.conduct_event_requests r
LEFT JOIN public.students s ON s.student_no = r.student_no
GROUP BY r.student_no, s.name, r.event_date, r.event_type, r.reason
HAVING count(*) > 1
ORDER BY r.event_date DESC, r.student_no;

-- C-2：姓名相同的學生（確認是不是同一個人重複建檔，不同年級的同名通常是不同人）
SELECT s.name, array_agg(s.student_no ORDER BY s.student_no) AS student_nos, count(*) AS people
FROM public.students s
GROUP BY s.name
HAVING count(*) > 1
ORDER BY s.name;

-- C-3：有學籍異動紀錄為「休學／退學」，但編班資料仍標示為目前在籍（is_current = true）
SELECT e.student_no, s.name, e.is_current, c.status, c.effective_date
FROM public.enrollments e
JOIN public.students s ON s.student_no = e.student_no
JOIN LATERAL (
  SELECT status, effective_date FROM public.student_status_changes sc
  WHERE sc.student_no = e.student_no ORDER BY effective_date DESC, created_at DESC LIMIT 1
) c ON true
WHERE e.is_current AND c.status IN ('休學', '退學', '轉學', '畢業', '肄業');

-- C-4：成績表裡出現、但「科目與比重設定」裡沒有的科目名稱（常是同一科的不同寫法）
SELECT sc.subject, count(*) AS score_rows
FROM public.scores sc
WHERE NOT EXISTS (SELECT 1 FROM public.curriculum cu WHERE cu.subject = sc.subject)
GROUP BY sc.subject
ORDER BY score_rows DESC;
