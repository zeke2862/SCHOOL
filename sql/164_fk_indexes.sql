-- ============================================================
-- 164. 補常用外鍵索引（資安與效能檢測報告 #11）
-- ------------------------------------------------------------
-- 檢測列出 104 個「外鍵欄位沒有索引」。逐一評估後只補「會被查詢條件／join 常用、或資料表會長大」的欄位：
--   - 競賽系統（comp_*）：用報名／項目／賽事做 join 與篩選，一場活動上百筆報名、每筆多個評分
--   - 學生聯絡人、考場座位、社團成績／志願、狀態異動附件、成績修改紀錄：都是「用學號／上層編號回查」的欄位
-- 刻意不補的：created_by／updated_by／decided_by／recorded_by 這類「誰建立的」稽核欄位（只在刪除帳號或教師時才會被檢查，
--   而且表很小；attendance 等寫入頻繁的大表多一個索引反而拖慢每次點名存檔）。
-- 刻意不刪的「從未使用」索引：共 13 個、合計不到 400 KB，且統計只涵蓋約 7 週（含寒暑假），多數是學生學號／班級狀態篩選，
--   開學期間才會用到；刪掉省不了什麼、誤刪代價卻高。
-- 這些表目前都只有幾十到幾千列，建立索引只要毫秒、不影響使用。可重複執行（if not exists）。
-- 回復：drop index if exists <索引名>；（見最後一段）
-- ============================================================
create index if not exists idx_comp_registrations_event      on public.comp_registrations (event_id);
create index if not exists idx_comp_scores_registration      on public.comp_scores (registration_id);
create index if not exists idx_comp_results_registration     on public.comp_results (registration_id);
create index if not exists idx_comp_entries_registration     on public.comp_entries (registration_id);
create index if not exists idx_comp_votes_item               on public.comp_votes (item_id);
create index if not exists idx_comp_items_group              on public.comp_items (group_id);
create index if not exists idx_comp_staff_item               on public.comp_staff (item_id);
create index if not exists idx_comp_notices_item             on public.comp_notices (item_id);
create index if not exists idx_guardians_student_no          on public.guardians (student_no);
create index if not exists idx_exam_seat_students_student_no on public.exam_seat_students (student_no);
create index if not exists idx_exam_class_roster_status_class on public.exam_class_roster_status (class_id);
create index if not exists idx_club_preferences_club         on public.club_preferences (club_id);
create index if not exists idx_club_preferences_student_no   on public.club_preferences (student_no);
create index if not exists idx_club_scores_student_no        on public.club_scores (student_no);
create index if not exists idx_club_attendance_student_no    on public.club_attendance (student_no);
create index if not exists idx_status_change_attachments_change on public.status_change_attachments (status_change_id);
create index if not exists idx_score_audit_log_score         on public.score_audit_log (score_id);
create index if not exists idx_conduct_event_requests_student_no on public.conduct_event_requests (student_no);
create index if not exists idx_conduct_event_requests_event  on public.conduct_event_requests (conduct_event_id);
create index if not exists idx_profile_edit_requests_student_no on public.profile_edit_requests (student_no);
create index if not exists idx_student_status_requests_target_class on public.student_status_requests (target_class_id);

-- ===== 回復（需要時才執行）=====
-- drop index if exists
--   idx_comp_registrations_event, idx_comp_scores_registration, idx_comp_results_registration, idx_comp_entries_registration,
--   idx_comp_votes_item, idx_comp_items_group, idx_comp_staff_item, idx_comp_notices_item, idx_guardians_student_no,
--   idx_exam_seat_students_student_no, idx_exam_class_roster_status_class, idx_club_preferences_club, idx_club_preferences_student_no,
--   idx_club_scores_student_no, idx_club_attendance_student_no, idx_status_change_attachments_change, idx_score_audit_log_score,
--   idx_conduct_event_requests_student_no, idx_conduct_event_requests_event, idx_profile_edit_requests_student_no,
--   idx_student_status_requests_target_class;
