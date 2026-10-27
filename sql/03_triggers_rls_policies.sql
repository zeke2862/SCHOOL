-- =====================================================================
-- 華雲學校管理系統  全新安裝用 SQL  (3/4)  觸發器／RLS／權限政策
-- =====================================================================
-- 內容：觸發器、啟用 RLS、186 條 RLS 政策、函式執行權限。
--
-- 這 4 份檔案是把舊的 sql/1 ~ sql/104 共 104 份遷移檔，在一個空資料庫依序
-- 執行完畢後匯出的「最終狀態」，只適用於【全新、空的】Supabase 專案。
-- 既有資料庫不需要、也不要再執行（舊的 104 份已經套用過了）。
--
-- 執行順序（Supabase 後台 SQL Editor，逐份貼上執行）：
--   01_schema.sql → 02_constraints_indexes.sql → 03_triggers_rls_policies.sql → 04_seed_and_storage.sql
-- =====================================================================

--
-- Name: app_users auto_assign_admin_departments; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER auto_assign_admin_departments AFTER INSERT ON public.app_users FOR EACH ROW EXECUTE FUNCTION public.trg_auto_assign_admin_departments();

--
-- Name: club_attendance club_attendance_after_write; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER club_attendance_after_write AFTER INSERT OR UPDATE ON public.club_attendance FOR EACH ROW EXECUTE FUNCTION public.trg_club_attendance_sync();

--
-- Name: club_scores club_scores_after_submit; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER club_scores_after_submit AFTER INSERT OR UPDATE ON public.club_scores FOR EACH ROW EXECUTE FUNCTION public.trg_club_scores_sync();

--
-- Name: pending_changes on_pending_change_approved; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER on_pending_change_approved AFTER UPDATE ON public.pending_changes FOR EACH ROW EXECUTE FUNCTION public.trg_apply_on_approve();

--
-- Name: conduct_events trg_enforce_conduct_event_rules; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_enforce_conduct_event_rules BEFORE INSERT ON public.conduct_events FOR EACH ROW EXECUTE FUNCTION public.enforce_conduct_event_rules();

--
-- Name: attendance trg_log_attendance_change; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_log_attendance_change AFTER INSERT OR UPDATE ON public.attendance FOR EACH ROW EXECUTE FUNCTION public.log_attendance_change();

--
-- Name: scores trg_log_score_change; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_log_score_change AFTER INSERT OR DELETE OR UPDATE ON public.scores FOR EACH ROW EXECUTE FUNCTION public.log_score_change();

--
-- Name: submission_windows trg_log_submission_window_reopen; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_log_submission_window_reopen AFTER UPDATE ON public.submission_windows FOR EACH ROW EXECUTE FUNCTION public.log_submission_window_reopen();

--
-- Name: profile_edit_requests trg_notify_homeroom_on_profile_edit_request; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_notify_homeroom_on_profile_edit_request AFTER INSERT ON public.profile_edit_requests FOR EACH ROW EXECUTE FUNCTION public.notify_homeroom_on_profile_edit_request();

--
-- Name: exam_sessions trg_notify_on_exam_session_sent; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_notify_on_exam_session_sent AFTER UPDATE ON public.exam_sessions FOR EACH ROW EXECUTE FUNCTION public.notify_homeroom_on_exam_session_sent();

--
-- Name: substitute_assignments trg_notify_on_substitute_assignment; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_notify_on_substitute_assignment AFTER INSERT ON public.substitute_assignments FOR EACH ROW EXECUTE FUNCTION public.notify_teachers_on_substitute_assignment();

--
-- Name: general_inventory_transactions trg_recompute_inventory_stock; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_recompute_inventory_stock AFTER INSERT OR DELETE OR UPDATE ON public.general_inventory_transactions FOR EACH ROW EXECUTE FUNCTION public.recompute_inventory_stock();

--
-- Name: exam_class_roster_status academic_manage_exam_class_roster_status; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY academic_manage_exam_class_roster_status ON public.exam_class_roster_status USING ((public.is_system_admin() OR (public.current_role_name() = 'admin_a'::public.user_role) OR public.has_department('academic'::public.admin_department))) WITH CHECK ((public.is_system_admin() OR (public.current_role_name() = 'admin_a'::public.user_role) OR public.has_department('academic'::public.admin_department)));

--
-- Name: exam_room_classes academic_manage_exam_room_classes; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY academic_manage_exam_room_classes ON public.exam_room_classes USING ((public.is_system_admin() OR public.has_department('academic'::public.admin_department))) WITH CHECK ((public.is_system_admin() OR public.has_department('academic'::public.admin_department)));

--
-- Name: exam_room_seats academic_manage_exam_room_seats; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY academic_manage_exam_room_seats ON public.exam_room_seats USING ((public.is_system_admin() OR public.has_department('academic'::public.admin_department))) WITH CHECK ((public.is_system_admin() OR public.has_department('academic'::public.admin_department)));

--
-- Name: exam_rooms academic_manage_exam_rooms; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY academic_manage_exam_rooms ON public.exam_rooms USING ((public.is_system_admin() OR public.has_department('academic'::public.admin_department))) WITH CHECK ((public.is_system_admin() OR public.has_department('academic'::public.admin_department)));

--
-- Name: exam_sessions academic_manage_exam_sessions; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY academic_manage_exam_sessions ON public.exam_sessions USING ((public.is_system_admin() OR public.has_department('academic'::public.admin_department))) WITH CHECK ((public.is_system_admin() OR public.has_department('academic'::public.admin_department)));

--
-- Name: academic_terms; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.academic_terms ENABLE ROW LEVEL SECURITY;

--
-- Name: exam_seat_students academic_write_exam_seat_students; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY academic_write_exam_seat_students ON public.exam_seat_students USING ((public.is_system_admin() OR (public.current_role_name() = 'admin_a'::public.user_role) OR public.has_department('academic'::public.admin_department))) WITH CHECK ((public.is_system_admin() OR (public.current_role_name() = 'admin_a'::public.user_role) OR public.has_department('academic'::public.admin_department)));

--
-- Name: account_audit_log; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.account_audit_log ENABLE ROW LEVEL SECURITY;

--
-- Name: students admin_delete_students; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY admin_delete_students ON public.students FOR DELETE USING ((public.is_system_admin() OR public.has_department('academic'::public.admin_department)));

--
-- Name: staff_notifications admin_insert_notifications; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY admin_insert_notifications ON public.staff_notifications FOR INSERT WITH CHECK ((public.is_system_admin() OR public.has_department('discipline'::public.admin_department)));

--
-- Name: clubs admin_manage_clubs; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY admin_manage_clubs ON public.clubs USING ((public.is_system_admin() OR public.has_department('academic'::public.admin_department))) WITH CHECK ((public.is_system_admin() OR public.has_department('academic'::public.admin_department)));

--
-- Name: club_members admin_manage_members; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY admin_manage_members ON public.club_members USING ((public.is_system_admin() OR public.has_department('academic'::public.admin_department))) WITH CHECK ((public.is_system_admin() OR public.has_department('academic'::public.admin_department)));

--
-- Name: bulletin_posts admin_manage_posts; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY admin_manage_posts ON public.bulletin_posts USING ((public.current_role_name() = ANY (ARRAY['system_admin_s'::public.user_role, 'admin_a'::public.user_role, 'admin_b'::public.user_role]))) WITH CHECK ((public.current_role_name() = ANY (ARRAY['system_admin_s'::public.user_role, 'admin_a'::public.user_role, 'admin_b'::public.user_role])));

--
-- Name: club_preferences admin_manage_preferences; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY admin_manage_preferences ON public.club_preferences USING ((public.is_system_admin() OR public.has_department('academic'::public.admin_department))) WITH CHECK ((public.is_system_admin() OR public.has_department('academic'::public.admin_department)));

--
-- Name: club_selection_windows admin_manage_selection_windows; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY admin_manage_selection_windows ON public.club_selection_windows USING ((public.is_system_admin() OR public.has_department('academic'::public.admin_department))) WITH CHECK ((public.is_system_admin() OR public.has_department('academic'::public.admin_department)));

--
-- Name: submission_windows admin_manage_submission_windows; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY admin_manage_submission_windows ON public.submission_windows USING (((public.current_role_name() = ANY (ARRAY['admin_a'::public.user_role, 'admin_b'::public.user_role, 'system_admin_s'::public.user_role])) OR ((data_type = '出缺勤'::text) AND public.has_department('discipline'::public.admin_department)) OR ((data_type = ANY (ARRAY['期中考'::text, '期末考'::text, '平時分'::text])) AND public.has_department('academic'::public.admin_department)))) WITH CHECK (((public.current_role_name() = ANY (ARRAY['admin_a'::public.user_role, 'admin_b'::public.user_role, 'system_admin_s'::public.user_role])) OR ((data_type = '出缺勤'::text) AND public.has_department('discipline'::public.admin_department)) OR ((data_type = ANY (ARRAY['期中考'::text, '期末考'::text, '平時分'::text])) AND public.has_department('academic'::public.admin_department))));

--
-- Name: admin_module_categories; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.admin_module_categories ENABLE ROW LEVEL SECURITY;

--
-- Name: admin_module_order; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.admin_module_order ENABLE ROW LEVEL SECURITY;

--
-- Name: attendance_audit_log admin_only_read_attendance_audit; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY admin_only_read_attendance_audit ON public.attendance_audit_log FOR SELECT USING (public.is_admin_sa());

--
-- Name: score_audit_log admin_only_read_score_audit; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY admin_only_read_score_audit ON public.score_audit_log FOR SELECT USING (public.is_admin_sa());

--
-- Name: submission_window_audit_log admin_only_read_window_audit; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY admin_only_read_window_audit ON public.submission_window_audit_log FOR SELECT USING (public.is_admin_sa());

--
-- Name: status_change_attachments admin_only_status_attachments; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY admin_only_status_attachments ON public.status_change_attachments USING ((public.is_system_admin() OR public.has_department('academic'::public.admin_department))) WITH CHECK ((public.is_system_admin() OR public.has_department('academic'::public.admin_department)));

--
-- Name: student_status_changes admin_only_status_changes; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY admin_only_status_changes ON public.student_status_changes USING ((public.is_system_admin() OR public.has_department('academic'::public.admin_department))) WITH CHECK ((public.is_system_admin() OR public.has_department('academic'::public.admin_department)));

--
-- Name: account_audit_log admin_read_account_audit_log; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY admin_read_account_audit_log ON public.account_audit_log FOR SELECT USING ((public.is_system_admin() OR public.has_department('dev'::public.admin_department)));

--
-- Name: backups admin_read_backups; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY admin_read_backups ON public.backups FOR SELECT USING ((public.is_system_admin() OR public.has_department('dev'::public.admin_department)));

--
-- Name: students admin_update_students; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY admin_update_students ON public.students FOR UPDATE USING ((public.is_system_admin() OR public.has_department('academic'::public.admin_department))) WITH CHECK ((public.is_system_admin() OR public.has_department('academic'::public.admin_department)));

--
-- Name: classes admin_write_classes; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY admin_write_classes ON public.classes USING ((public.is_system_admin() OR public.has_department('academic'::public.admin_department))) WITH CHECK ((public.is_system_admin() OR public.has_department('academic'::public.admin_department)));

--
-- Name: conduct_events admin_write_conduct_events; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY admin_write_conduct_events ON public.conduct_events USING ((public.current_role_name() = ANY (ARRAY['admin_a'::public.user_role, 'admin_b'::public.user_role, 'system_admin_s'::public.user_role]))) WITH CHECK ((public.current_role_name() = ANY (ARRAY['admin_a'::public.user_role, 'admin_b'::public.user_role, 'system_admin_s'::public.user_role])));

--
-- Name: enrollments admin_write_enrollments; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY admin_write_enrollments ON public.enrollments USING ((public.is_system_admin() OR public.has_department('academic'::public.admin_department))) WITH CHECK ((public.is_system_admin() OR public.has_department('academic'::public.admin_department)));

--
-- Name: report_card_merge_template admin_write_report_card_merge_template; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY admin_write_report_card_merge_template ON public.report_card_merge_template USING ((public.current_role_name() = ANY (ARRAY['admin_a'::public.user_role, 'admin_b'::public.user_role, 'system_admin_s'::public.user_role]))) WITH CHECK ((public.current_role_name() = ANY (ARRAY['admin_a'::public.user_role, 'admin_b'::public.user_role, 'system_admin_s'::public.user_role])));

--
-- Name: report_card_style admin_write_report_card_style; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY admin_write_report_card_style ON public.report_card_style USING ((public.current_role_name() = ANY (ARRAY['admin_a'::public.user_role, 'admin_b'::public.user_role, 'system_admin_s'::public.user_role]))) WITH CHECK ((public.current_role_name() = ANY (ARRAY['admin_a'::public.user_role, 'admin_b'::public.user_role, 'system_admin_s'::public.user_role])));

--
-- Name: report_card_xlsx_template admin_write_report_card_xlsx_template; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY admin_write_report_card_xlsx_template ON public.report_card_xlsx_template USING ((public.current_role_name() = ANY (ARRAY['admin_a'::public.user_role, 'admin_b'::public.user_role, 'system_admin_s'::public.user_role]))) WITH CHECK ((public.current_role_name() = ANY (ARRAY['admin_a'::public.user_role, 'admin_b'::public.user_role, 'system_admin_s'::public.user_role])));

--
-- Name: score_adjustments admin_write_score_adjustments; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY admin_write_score_adjustments ON public.score_adjustments USING ((public.is_system_admin() OR public.has_department('academic'::public.admin_department))) WITH CHECK ((public.is_system_admin() OR public.has_department('academic'::public.admin_department)));

--
-- Name: students admin_write_students; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY admin_write_students ON public.students FOR INSERT WITH CHECK ((public.is_system_admin() OR public.has_department('academic'::public.admin_department)));

--
-- Name: teachers admin_write_teachers; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY admin_write_teachers ON public.teachers USING ((public.current_role_name() = ANY (ARRAY['admin_a'::public.user_role, 'admin_b'::public.user_role, 'system_admin_s'::public.user_role]))) WITH CHECK ((public.current_role_name() = ANY (ARRAY['admin_a'::public.user_role, 'admin_b'::public.user_role, 'system_admin_s'::public.user_role])));

--
-- Name: maintenance_tickets any_staff_report_maintenance_ticket; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY any_staff_report_maintenance_ticket ON public.maintenance_tickets FOR INSERT WITH CHECK ((auth.uid() IS NOT NULL));

--
-- Name: app_user_departments; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.app_user_departments ENABLE ROW LEVEL SECURITY;

--
-- Name: app_user_module_overrides; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.app_user_module_overrides ENABLE ROW LEVEL SECURITY;

--
-- Name: attendance; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.attendance ENABLE ROW LEVEL SECURITY;

--
-- Name: attendance_alert_settings; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.attendance_alert_settings ENABLE ROW LEVEL SECURITY;

--
-- Name: attendance_audit_log; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.attendance_audit_log ENABLE ROW LEVEL SECURITY;

--
-- Name: attendance attendance_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY attendance_delete ON public.attendance FOR DELETE USING ((( SELECT public.is_system_admin() AS is_system_admin) OR ( SELECT public.has_department('discipline'::public.admin_department) AS has_department) OR ( SELECT public.has_department('dev'::public.admin_department) AS has_department) OR public.can_write_attendance(student_no, record_date, period_no, id)));

--
-- Name: attendance attendance_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY attendance_insert ON public.attendance FOR INSERT WITH CHECK ((( SELECT public.is_system_admin() AS is_system_admin) OR ( SELECT public.has_department('discipline'::public.admin_department) AS has_department) OR ( SELECT public.has_department('dev'::public.admin_department) AS has_department) OR public.can_write_attendance(student_no, record_date, period_no, id)));

--
-- Name: attendance_notifications; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.attendance_notifications ENABLE ROW LEVEL SECURITY;

--
-- Name: attendance attendance_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY attendance_read ON public.attendance FOR SELECT USING (public.can_read_attendance(student_no, period_no));

--
-- Name: attendance_score_display_settings; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.attendance_score_display_settings ENABLE ROW LEVEL SECURITY;

--
-- Name: attendance attendance_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY attendance_update ON public.attendance FOR UPDATE USING ((( SELECT public.is_system_admin() AS is_system_admin) OR ( SELECT public.has_department('discipline'::public.admin_department) AS has_department) OR ( SELECT public.has_department('dev'::public.admin_department) AS has_department) OR public.can_write_attendance(student_no, record_date, period_no, id))) WITH CHECK ((( SELECT public.is_system_admin() AS is_system_admin) OR ( SELECT public.has_department('discipline'::public.admin_department) AS has_department) OR ( SELECT public.has_department('dev'::public.admin_department) AS has_department) OR public.can_write_attendance(student_no, record_date, period_no, id)));

--
-- Name: backups; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.backups ENABLE ROW LEVEL SECURITY;

--
-- Name: bulletin_posts; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.bulletin_posts ENABLE ROW LEVEL SECURITY;

--
-- Name: class_schedule; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.class_schedule ENABLE ROW LEVEL SECURITY;

--
-- Name: classes; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.classes ENABLE ROW LEVEL SECURITY;

--
-- Name: clock_day_overrides; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.clock_day_overrides ENABLE ROW LEVEL SECURITY;

--
-- Name: clock_day_overrides clock_day_overrides_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY clock_day_overrides_read ON public.clock_day_overrides FOR SELECT TO authenticated USING ((( SELECT public.can_manage_staff_clock() AS can_manage_staff_clock) OR (device_code IN ( SELECT public.my_clock_codes() AS my_clock_codes))));

--
-- Name: clock_day_overrides clock_day_overrides_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY clock_day_overrides_write ON public.clock_day_overrides TO authenticated USING (( SELECT public.can_manage_staff_clock() AS can_manage_staff_clock)) WITH CHECK (( SELECT public.can_manage_staff_clock() AS can_manage_staff_clock));

--
-- Name: clock_employee_map; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.clock_employee_map ENABLE ROW LEVEL SECURITY;

--
-- Name: clock_employee_map clock_employee_map_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY clock_employee_map_read ON public.clock_employee_map FOR SELECT TO authenticated USING ((( SELECT public.can_manage_staff_clock() AS can_manage_staff_clock) OR (device_code IN ( SELECT public.my_clock_codes() AS my_clock_codes))));

--
-- Name: clock_employee_map clock_employee_map_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY clock_employee_map_write ON public.clock_employee_map TO authenticated USING (( SELECT public.can_manage_staff_clock() AS can_manage_staff_clock)) WITH CHECK (( SELECT public.can_manage_staff_clock() AS can_manage_staff_clock));

--
-- Name: clock_holidays; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.clock_holidays ENABLE ROW LEVEL SECURITY;

--
-- Name: clock_holidays clock_holidays_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY clock_holidays_read ON public.clock_holidays FOR SELECT TO authenticated USING (true);

--
-- Name: clock_holidays clock_holidays_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY clock_holidays_write ON public.clock_holidays TO authenticated USING (( SELECT public.can_manage_staff_clock() AS can_manage_staff_clock)) WITH CHECK (( SELECT public.can_manage_staff_clock() AS can_manage_staff_clock));

--
-- Name: clock_import_log; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.clock_import_log ENABLE ROW LEVEL SECURITY;

--
-- Name: clock_import_log clock_import_log_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY clock_import_log_read ON public.clock_import_log FOR SELECT TO authenticated USING (( SELECT public.can_manage_staff_clock() AS can_manage_staff_clock));

--
-- Name: clock_records; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.clock_records ENABLE ROW LEVEL SECURITY;

--
-- Name: clock_records clock_records_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY clock_records_read ON public.clock_records FOR SELECT TO authenticated USING ((( SELECT public.can_manage_staff_clock() AS can_manage_staff_clock) OR (device_code IN ( SELECT public.my_clock_codes() AS my_clock_codes))));

--
-- Name: clock_records clock_records_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY clock_records_write ON public.clock_records TO authenticated USING (( SELECT public.can_manage_staff_clock() AS can_manage_staff_clock)) WITH CHECK (( SELECT public.can_manage_staff_clock() AS can_manage_staff_clock));

--
-- Name: clock_shifts; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.clock_shifts ENABLE ROW LEVEL SECURITY;

--
-- Name: clock_shifts clock_shifts_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY clock_shifts_read ON public.clock_shifts FOR SELECT TO authenticated USING (true);

--
-- Name: clock_shifts clock_shifts_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY clock_shifts_write ON public.clock_shifts TO authenticated USING (( SELECT public.can_manage_staff_clock() AS can_manage_staff_clock)) WITH CHECK (( SELECT public.can_manage_staff_clock() AS can_manage_staff_clock));

--
-- Name: club_attendance; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.club_attendance ENABLE ROW LEVEL SECURITY;

--
-- Name: club_members; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.club_members ENABLE ROW LEVEL SECURITY;

--
-- Name: club_preferences; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.club_preferences ENABLE ROW LEVEL SECURITY;

--
-- Name: club_scores; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.club_scores ENABLE ROW LEVEL SECURITY;

--
-- Name: club_selection_windows; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.club_selection_windows ENABLE ROW LEVEL SECURITY;

--
-- Name: club_attendance club_teacher_manage_attendance; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY club_teacher_manage_attendance ON public.club_attendance USING (public.is_club_teacher(club_id)) WITH CHECK (public.is_club_teacher(club_id));

--
-- Name: club_scores club_teacher_manage_scores; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY club_teacher_manage_scores ON public.club_scores USING ((public.is_club_teacher(club_id) AND ((NOT is_submitted) OR public.is_system_admin() OR public.has_department('academic'::public.admin_department)))) WITH CHECK ((public.is_club_teacher(club_id) AND ((NOT is_submitted) OR public.is_system_admin() OR public.has_department('academic'::public.admin_department))));

--
-- Name: club_members club_teacher_read_members; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY club_teacher_read_members ON public.club_members FOR SELECT USING (public.is_club_teacher(club_id));

--
-- Name: clubs club_teacher_update_own_club; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY club_teacher_update_own_club ON public.clubs FOR UPDATE USING ((teacher_id = public.current_teacher_id())) WITH CHECK ((teacher_id = public.current_teacher_id()));

--
-- Name: clubs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.clubs ENABLE ROW LEVEL SECURITY;

--
-- Name: conduct_event_requests; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.conduct_event_requests ENABLE ROW LEVEL SECURITY;

--
-- Name: conduct_events; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.conduct_events ENABLE ROW LEVEL SECURITY;

--
-- Name: conduct_point_defaults; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.conduct_point_defaults ENABLE ROW LEVEL SECURITY;

--
-- Name: conduct_scores; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.conduct_scores ENABLE ROW LEVEL SECURITY;

--
-- Name: correction_requests; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.correction_requests ENABLE ROW LEVEL SECURITY;

--
-- Name: conduct_event_requests create_own_conduct_event_request; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY create_own_conduct_event_request ON public.conduct_event_requests FOR INSERT WITH CHECK (((requested_by = auth.uid()) AND (public.is_system_admin() OR public.has_department('discipline'::public.admin_department) OR public.teacher_teaches_student(student_no))));

--
-- Name: curriculum; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.curriculum ENABLE ROW LEVEL SECURITY;

--
-- Name: maintenance_tickets department_lead_delete_maintenance_ticket; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY department_lead_delete_maintenance_ticket ON public.maintenance_tickets FOR DELETE USING ((public.is_system_admin() OR public.is_department_lead('general'::public.admin_department)));

--
-- Name: maintenance_tickets department_lead_manage_maintenance_ticket; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY department_lead_manage_maintenance_ticket ON public.maintenance_tickets FOR UPDATE USING ((public.is_system_admin() OR public.is_department_lead('general'::public.admin_department))) WITH CHECK ((public.is_system_admin() OR public.is_department_lead('general'::public.admin_department)));

--
-- Name: correction_requests department_lead_review_requests; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY department_lead_review_requests ON public.correction_requests FOR UPDATE USING ((public.is_system_admin() OR ((data_type = '出缺勤'::text) AND public.is_department_lead('discipline'::public.admin_department)) OR ((data_type = ANY (ARRAY['期中考'::text, '期末考'::text, '平時分'::text])) AND public.is_department_lead('academic'::public.admin_department))));

--
-- Name: attendance_alert_settings department_lead_write_attendance_alert_settings; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY department_lead_write_attendance_alert_settings ON public.attendance_alert_settings USING ((public.is_system_admin() OR public.is_department_lead('discipline'::public.admin_department))) WITH CHECK ((public.is_system_admin() OR public.is_department_lead('discipline'::public.admin_department)));

--
-- Name: class_schedule department_lead_write_class_schedule; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY department_lead_write_class_schedule ON public.class_schedule USING ((public.is_system_admin() OR public.is_department_lead('academic'::public.admin_department))) WITH CHECK ((public.is_system_admin() OR public.is_department_lead('academic'::public.admin_department)));

--
-- Name: conduct_point_defaults department_lead_write_conduct_point_defaults; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY department_lead_write_conduct_point_defaults ON public.conduct_point_defaults USING ((public.is_system_admin() OR public.is_department_lead('discipline'::public.admin_department))) WITH CHECK ((public.is_system_admin() OR public.is_department_lead('discipline'::public.admin_department)));

--
-- Name: curriculum department_lead_write_curriculum; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY department_lead_write_curriculum ON public.curriculum USING ((public.is_system_admin() OR public.is_department_lead('academic'::public.admin_department))) WITH CHECK ((public.is_system_admin() OR public.is_department_lead('academic'::public.admin_department)));

--
-- Name: general_inventory_items department_lead_write_general_inventory_items; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY department_lead_write_general_inventory_items ON public.general_inventory_items USING ((public.is_system_admin() OR public.is_department_lead('general'::public.admin_department))) WITH CHECK ((public.is_system_admin() OR public.is_department_lead('general'::public.admin_department)));

--
-- Name: general_inventory_transactions department_lead_write_general_inventory_transactions; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY department_lead_write_general_inventory_transactions ON public.general_inventory_transactions USING ((public.is_system_admin() OR public.is_department_lead('general'::public.admin_department))) WITH CHECK ((public.is_system_admin() OR public.is_department_lead('general'::public.admin_department)));

--
-- Name: grade_progression department_lead_write_grade_progression; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY department_lead_write_grade_progression ON public.grade_progression USING ((public.is_system_admin() OR public.is_department_lead('academic'::public.admin_department))) WITH CHECK ((public.is_system_admin() OR public.is_department_lead('academic'::public.admin_department)));

--
-- Name: grading_rules department_lead_write_grading_rules; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY department_lead_write_grading_rules ON public.grading_rules USING ((public.is_system_admin() OR public.is_department_lead('academic'::public.admin_department))) WITH CHECK ((public.is_system_admin() OR public.is_department_lead('academic'::public.admin_department)));

--
-- Name: locked_periods department_lead_write_locked_periods; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY department_lead_write_locked_periods ON public.locked_periods USING ((public.is_system_admin() OR public.is_department_lead('academic'::public.admin_department))) WITH CHECK ((public.is_system_admin() OR public.is_department_lead('academic'::public.admin_department)));

--
-- Name: period_config department_lead_write_period_config; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY department_lead_write_period_config ON public.period_config USING ((public.is_system_admin() OR public.is_department_lead('academic'::public.admin_department))) WITH CHECK ((public.is_system_admin() OR public.is_department_lead('academic'::public.admin_department)));

--
-- Name: substitute_assignments department_lead_write_substitute_assignments; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY department_lead_write_substitute_assignments ON public.substitute_assignments USING ((public.is_system_admin() OR public.is_department_lead('academic'::public.admin_department))) WITH CHECK ((public.is_system_admin() OR public.is_department_lead('academic'::public.admin_department)));

--
-- Name: utility_bills department_lead_write_utility_bills; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY department_lead_write_utility_bills ON public.utility_bills USING ((public.is_system_admin() OR public.is_department_lead('general'::public.admin_department))) WITH CHECK ((public.is_system_admin() OR public.is_department_lead('general'::public.admin_department)));

--
-- Name: teacher_appointment_letters dev_all_teacher_appointment_letters; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY dev_all_teacher_appointment_letters ON public.teacher_appointment_letters USING ((public.is_system_admin() OR public.has_department('dev'::public.admin_department))) WITH CHECK ((public.is_system_admin() OR public.has_department('dev'::public.admin_department)));

--
-- Name: teacher_letter_settings dev_all_teacher_letter_settings; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY dev_all_teacher_letter_settings ON public.teacher_letter_settings USING ((public.is_system_admin() OR public.has_department('dev'::public.admin_department))) WITH CHECK ((public.is_system_admin() OR public.has_department('dev'::public.admin_department)));

--
-- Name: teacher_service_certificates dev_all_teacher_service_certificates; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY dev_all_teacher_service_certificates ON public.teacher_service_certificates USING ((public.is_system_admin() OR public.has_department('dev'::public.admin_department))) WITH CHECK ((public.is_system_admin() OR public.has_department('dev'::public.admin_department)));

--
-- Name: academic_terms dev_write_academic_terms; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY dev_write_academic_terms ON public.academic_terms USING ((public.is_system_admin() OR public.has_department('dev'::public.admin_department))) WITH CHECK ((public.is_system_admin() OR public.has_department('dev'::public.admin_department)));

--
-- Name: attendance_score_display_settings dev_write_attendance_score_display_settings; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY dev_write_attendance_score_display_settings ON public.attendance_score_display_settings USING ((public.is_system_admin() OR public.has_department('dev'::public.admin_department))) WITH CHECK ((public.is_system_admin() OR public.has_department('dev'::public.admin_department)));

--
-- Name: homeroom_attendance_assist_settings dev_write_homeroom_attendance_assist_settings; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY dev_write_homeroom_attendance_assist_settings ON public.homeroom_attendance_assist_settings USING ((public.is_system_admin() OR public.has_department('dev'::public.admin_department))) WITH CHECK ((public.is_system_admin() OR public.has_department('dev'::public.admin_department)));

--
-- Name: password_policy_settings dev_write_password_policy_settings; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY dev_write_password_policy_settings ON public.password_policy_settings USING ((public.is_system_admin() OR public.has_department('dev'::public.admin_department))) WITH CHECK ((public.is_system_admin() OR public.has_department('dev'::public.admin_department)));

--
-- Name: portal_login_settings dev_write_portal_login_settings; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY dev_write_portal_login_settings ON public.portal_login_settings USING ((public.is_system_admin() OR public.has_department('dev'::public.admin_department))) WITH CHECK ((public.is_system_admin() OR public.has_department('dev'::public.admin_department)));

--
-- Name: teacher_login_settings dev_write_teacher_login_settings; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY dev_write_teacher_login_settings ON public.teacher_login_settings USING ((public.is_system_admin() OR public.has_department('dev'::public.admin_department))) WITH CHECK ((public.is_system_admin() OR public.has_department('dev'::public.admin_department)));

--
-- Name: attendance_notifications discipline_dept_read_attendance_notifications; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY discipline_dept_read_attendance_notifications ON public.attendance_notifications FOR SELECT USING (( SELECT public.has_department('discipline'::public.admin_department) AS has_department));

--
-- Name: conduct_events discipline_write_conduct_events; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY discipline_write_conduct_events ON public.conduct_events USING ((public.is_system_admin() OR public.has_department('discipline'::public.admin_department))) WITH CHECK ((public.is_system_admin() OR public.has_department('discipline'::public.admin_department)));

--
-- Name: enrollments; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.enrollments ENABLE ROW LEVEL SECURITY;

--
-- Name: exam_class_roster_status; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.exam_class_roster_status ENABLE ROW LEVEL SECURITY;

--
-- Name: exam_room_classes; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.exam_room_classes ENABLE ROW LEVEL SECURITY;

--
-- Name: exam_room_seats; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.exam_room_seats ENABLE ROW LEVEL SECURITY;

--
-- Name: exam_rooms; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.exam_rooms ENABLE ROW LEVEL SECURITY;

--
-- Name: exam_seat_students; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.exam_seat_students ENABLE ROW LEVEL SECURITY;

--
-- Name: exam_sessions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.exam_sessions ENABLE ROW LEVEL SECURITY;

--
-- Name: general_inventory_items; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.general_inventory_items ENABLE ROW LEVEL SECURITY;

--
-- Name: general_inventory_transactions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.general_inventory_transactions ENABLE ROW LEVEL SECURITY;

--
-- Name: grade_progression; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.grade_progression ENABLE ROW LEVEL SECURITY;

--
-- Name: grading_rules; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.grading_rules ENABLE ROW LEVEL SECURITY;

--
-- Name: guardians; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.guardians ENABLE ROW LEVEL SECURITY;

--
-- Name: attendance hide_status_changed_students_attendance; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY hide_status_changed_students_attendance ON public.attendance AS RESTRICTIVE USING (((( SELECT public.current_role_name() AS current_role_name) = ANY (ARRAY['admin_a'::public.user_role, 'admin_b'::public.user_role, 'system_admin_s'::public.user_role])) OR (NOT public.student_is_hidden(student_no)))) WITH CHECK (((( SELECT public.current_role_name() AS current_role_name) = ANY (ARRAY['admin_a'::public.user_role, 'admin_b'::public.user_role, 'system_admin_s'::public.user_role])) OR (NOT public.student_is_hidden(student_no))));

--
-- Name: conduct_events hide_status_changed_students_conduct_events; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY hide_status_changed_students_conduct_events ON public.conduct_events AS RESTRICTIVE USING (((( SELECT public.current_role_name() AS current_role_name) = ANY (ARRAY['admin_a'::public.user_role, 'admin_b'::public.user_role, 'system_admin_s'::public.user_role])) OR (NOT public.student_is_hidden(student_no)))) WITH CHECK (((( SELECT public.current_role_name() AS current_role_name) = ANY (ARRAY['admin_a'::public.user_role, 'admin_b'::public.user_role, 'system_admin_s'::public.user_role])) OR (NOT public.student_is_hidden(student_no))));

--
-- Name: enrollments hide_status_changed_students_enrollments; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY hide_status_changed_students_enrollments ON public.enrollments AS RESTRICTIVE USING (((public.current_role_name() = ANY (ARRAY['admin_a'::public.user_role, 'admin_b'::public.user_role, 'system_admin_s'::public.user_role])) OR (NOT public.student_is_hidden(student_no)))) WITH CHECK (((public.current_role_name() = ANY (ARRAY['admin_a'::public.user_role, 'admin_b'::public.user_role, 'system_admin_s'::public.user_role])) OR (NOT public.student_is_hidden(student_no))));

--
-- Name: guardians hide_status_changed_students_guardians; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY hide_status_changed_students_guardians ON public.guardians AS RESTRICTIVE USING (((( SELECT public.current_role_name() AS current_role_name) = ANY (ARRAY['admin_a'::public.user_role, 'admin_b'::public.user_role, 'system_admin_s'::public.user_role])) OR (NOT public.student_is_hidden(student_no)))) WITH CHECK (((( SELECT public.current_role_name() AS current_role_name) = ANY (ARRAY['admin_a'::public.user_role, 'admin_b'::public.user_role, 'system_admin_s'::public.user_role])) OR (NOT public.student_is_hidden(student_no))));

--
-- Name: scores hide_status_changed_students_scores; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY hide_status_changed_students_scores ON public.scores AS RESTRICTIVE USING (((public.current_role_name() = ANY (ARRAY['admin_a'::public.user_role, 'admin_b'::public.user_role, 'system_admin_s'::public.user_role])) OR (NOT public.student_is_hidden(( SELECT e.student_no
   FROM public.enrollments e
  WHERE (e.id = scores.enrollment_id)))))) WITH CHECK (((public.current_role_name() = ANY (ARRAY['admin_a'::public.user_role, 'admin_b'::public.user_role, 'system_admin_s'::public.user_role])) OR (NOT public.student_is_hidden(( SELECT e.student_no
   FROM public.enrollments e
  WHERE (e.id = scores.enrollment_id))))));

--
-- Name: student_remarks hide_status_changed_students_student_remarks; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY hide_status_changed_students_student_remarks ON public.student_remarks AS RESTRICTIVE USING (((( SELECT public.current_role_name() AS current_role_name) = ANY (ARRAY['admin_a'::public.user_role, 'admin_b'::public.user_role, 'system_admin_s'::public.user_role])) OR (NOT public.student_is_hidden(( SELECT e.student_no
   FROM public.enrollments e
  WHERE (e.id = student_remarks.enrollment_id)))))) WITH CHECK (((( SELECT public.current_role_name() AS current_role_name) = ANY (ARRAY['admin_a'::public.user_role, 'admin_b'::public.user_role, 'system_admin_s'::public.user_role])) OR (NOT public.student_is_hidden(( SELECT e.student_no
   FROM public.enrollments e
  WHERE (e.id = student_remarks.enrollment_id))))));

--
-- Name: students hide_status_changed_students_students; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY hide_status_changed_students_students ON public.students AS RESTRICTIVE USING (((( SELECT public.current_role_name() AS current_role_name) = ANY (ARRAY['admin_a'::public.user_role, 'admin_b'::public.user_role, 'system_admin_s'::public.user_role])) OR (NOT public.student_is_hidden(student_no)))) WITH CHECK (((( SELECT public.current_role_name() AS current_role_name) = ANY (ARRAY['admin_a'::public.user_role, 'admin_b'::public.user_role, 'system_admin_s'::public.user_role])) OR (NOT public.student_is_hidden(student_no))));

--
-- Name: guardians homeroom_and_admin_guardians; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY homeroom_and_admin_guardians ON public.guardians USING ((public.is_system_admin() OR public.has_department('academic'::public.admin_department) OR (EXISTS ( SELECT 1
   FROM (public.enrollments e
     JOIN public.classes c ON ((c.id = e.class_id)))
  WHERE ((e.student_no = guardians.student_no) AND (c.homeroom_teacher_id = public.current_teacher_id()))))));

--
-- Name: conduct_scores homeroom_and_admin_only_conduct_scores; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY homeroom_and_admin_only_conduct_scores ON public.conduct_scores USING (((public.current_role_name() = ANY (ARRAY['admin_a'::public.user_role, 'admin_b'::public.user_role, 'system_admin_s'::public.user_role])) OR (EXISTS ( SELECT 1
   FROM (public.enrollments e
     JOIN public.classes c ON ((c.id = e.class_id)))
  WHERE ((e.id = conduct_scores.enrollment_id) AND (c.homeroom_teacher_id = public.current_teacher_id()))))));

--
-- Name: student_remarks homeroom_and_admin_only_remarks; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY homeroom_and_admin_only_remarks ON public.student_remarks USING ((public.is_system_admin() OR public.has_department('academic'::public.admin_department) OR (EXISTS ( SELECT 1
   FROM (public.enrollments e
     JOIN public.classes c ON ((c.id = e.class_id)))
  WHERE ((e.id = student_remarks.enrollment_id) AND (c.homeroom_teacher_id = public.current_teacher_id()))))));

--
-- Name: homeroom_attendance_assist_settings; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.homeroom_attendance_assist_settings ENABLE ROW LEVEL SECURITY;

--
-- Name: attendance_notifications homeroom_insert_attendance_notifications; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY homeroom_insert_attendance_notifications ON public.attendance_notifications FOR INSERT WITH CHECK (((public.current_role_name() = ANY (ARRAY['admin_a'::public.user_role, 'admin_b'::public.user_role, 'system_admin_s'::public.user_role])) OR (EXISTS ( SELECT 1
   FROM (public.enrollments e
     JOIN public.classes c ON ((c.id = e.class_id)))
  WHERE ((e.student_no = attendance_notifications.student_no) AND (e.is_current = true) AND (c.homeroom_teacher_id = public.current_teacher_id()))))));

--
-- Name: submission_windows homeroom_insert_own_class_lock; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY homeroom_insert_own_class_lock ON public.submission_windows FOR INSERT WITH CHECK (((scope = '班級'::text) AND (data_type = ANY (ARRAY['期中考'::text, '期末考'::text, '平時分'::text])) AND (is_locked = true) AND (EXISTS ( SELECT 1
   FROM public.classes c
  WHERE (((c.id)::text = submission_windows.scope_ref) AND (c.homeroom_teacher_id = public.current_teacher_id()))))));

--
-- Name: exam_class_roster_status homeroom_submit_own_class_roster_status; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY homeroom_submit_own_class_roster_status ON public.exam_class_roster_status USING (((EXISTS ( SELECT 1
   FROM public.classes c
  WHERE ((c.id = exam_class_roster_status.class_id) AND (c.homeroom_teacher_id = public.current_teacher_id())))) AND (submitted = false))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.classes c
  WHERE ((c.id = exam_class_roster_status.class_id) AND (c.homeroom_teacher_id = public.current_teacher_id())))));

--
-- Name: submission_windows homeroom_update_own_class_lock; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY homeroom_update_own_class_lock ON public.submission_windows FOR UPDATE USING (((scope = '班級'::text) AND (data_type = ANY (ARRAY['期中考'::text, '期末考'::text, '平時分'::text])) AND (EXISTS ( SELECT 1
   FROM public.classes c
  WHERE (((c.id)::text = submission_windows.scope_ref) AND (c.homeroom_teacher_id = public.current_teacher_id())))))) WITH CHECK (((scope = '班級'::text) AND (data_type = ANY (ARRAY['期中考'::text, '期末考'::text, '平時分'::text])) AND (is_locked = true) AND (EXISTS ( SELECT 1
   FROM public.classes c
  WHERE (((c.id)::text = submission_windows.scope_ref) AND (c.homeroom_teacher_id = public.current_teacher_id()))))));

--
-- Name: students homeroom_update_own_class_students; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY homeroom_update_own_class_students ON public.students FOR UPDATE USING ((EXISTS ( SELECT 1
   FROM (public.enrollments e
     JOIN public.classes c ON ((c.id = e.class_id)))
  WHERE ((e.student_no = students.student_no) AND (e.is_current = true) AND (c.homeroom_teacher_id = public.current_teacher_id()))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM (public.enrollments e
     JOIN public.classes c ON ((c.id = e.class_id)))
  WHERE ((e.student_no = students.student_no) AND (e.is_current = true) AND (c.homeroom_teacher_id = public.current_teacher_id())))));

--
-- Name: exam_seat_students homeroom_write_own_class_exam_seat_students; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY homeroom_write_own_class_exam_seat_students ON public.exam_seat_students USING (((EXISTS ( SELECT 1
   FROM (public.exam_room_seats ers
     JOIN public.classes c ON ((c.id = ers.class_id)))
  WHERE ((ers.id = exam_seat_students.exam_room_seat_id) AND (c.homeroom_teacher_id = public.current_teacher_id())))) AND (NOT (EXISTS ( SELECT 1
   FROM ((public.exam_room_seats ers
     JOIN public.exam_rooms er ON ((er.id = ers.exam_room_id)))
     JOIN public.exam_class_roster_status rs ON (((rs.exam_session_id = er.exam_session_id) AND (rs.class_id = ers.class_id))))
  WHERE ((ers.id = exam_seat_students.exam_room_seat_id) AND (rs.submitted = true))))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM (public.exam_room_seats ers
     JOIN public.classes c ON ((c.id = ers.class_id)))
  WHERE ((ers.id = exam_seat_students.exam_room_seat_id) AND (c.homeroom_teacher_id = public.current_teacher_id())))));

--
-- Name: attendance_audit_log insert_attendance_audit; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY insert_attendance_audit ON public.attendance_audit_log FOR INSERT WITH CHECK ((auth.uid() IS NOT NULL));

--
-- Name: score_audit_log insert_score_audit; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY insert_score_audit ON public.score_audit_log FOR INSERT WITH CHECK ((auth.uid() IS NOT NULL));

--
-- Name: pending_changes lead_read_department_pending_change; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY lead_read_department_pending_change ON public.pending_changes FOR SELECT USING ((public.is_system_admin() OR public.is_department_lead(department)));

--
-- Name: pending_changes lead_review_pending_change; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY lead_review_pending_change ON public.pending_changes FOR UPDATE USING ((public.is_system_admin() OR public.is_department_lead(department))) WITH CHECK ((public.is_system_admin() OR public.is_department_lead(department)));

--
-- Name: locked_periods; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.locked_periods ENABLE ROW LEVEL SECURITY;

--
-- Name: maintenance_tickets; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.maintenance_tickets ENABLE ROW LEVEL SECURITY;

--
-- Name: submission_window_audit_log no_direct_write_window_audit; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY no_direct_write_window_audit ON public.submission_window_audit_log USING (false) WITH CHECK (false);

--
-- Name: profile_edit_requests parent_create_edit_request; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY parent_create_edit_request ON public.profile_edit_requests FOR INSERT WITH CHECK ((EXISTS ( SELECT 1
   FROM public.portal_accounts pa
  WHERE ((pa.id = profile_edit_requests.requested_by) AND (pa.auth_user_id = auth.uid()) AND ((pa.relation = '家長'::text) OR ((pa.relation = '學生本人'::text) AND (profile_edit_requests.target_table = 'students'::text) AND (profile_edit_requests.field_name = ANY (ARRAY['phone'::text, 'address'::text])) AND (profile_edit_requests.guardian_id IS NULL)))))));

--
-- Name: status_change_attachments parent_read_own_attachments; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY parent_read_own_attachments ON public.status_change_attachments FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.student_status_changes sc
  WHERE ((sc.id = status_change_attachments.status_change_id) AND public.is_linked_parent(sc.student_no)))));

--
-- Name: attendance parent_read_own_attendance; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY parent_read_own_attendance ON public.attendance FOR SELECT USING (public.is_linked_parent(student_no));

--
-- Name: profile_edit_requests parent_read_own_edit_requests; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY parent_read_own_edit_requests ON public.profile_edit_requests FOR SELECT USING (((EXISTS ( SELECT 1
   FROM public.portal_accounts pa
  WHERE ((pa.id = profile_edit_requests.requested_by) AND (pa.auth_user_id = auth.uid())))) OR public.is_system_admin() OR (EXISTS ( SELECT 1
   FROM (public.enrollments e
     JOIN public.classes c ON ((c.id = e.class_id)))
  WHERE ((e.student_no = profile_edit_requests.student_no) AND (c.homeroom_teacher_id = public.current_teacher_id()))))));

--
-- Name: enrollments parent_read_own_enrollments; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY parent_read_own_enrollments ON public.enrollments FOR SELECT USING (public.is_linked_parent(student_no));

--
-- Name: guardians parent_read_own_guardians; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY parent_read_own_guardians ON public.guardians FOR SELECT USING (public.is_linked_parent(student_no));

--
-- Name: scores parent_read_own_scores; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY parent_read_own_scores ON public.scores FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.enrollments e
  WHERE ((e.id = scores.enrollment_id) AND public.is_linked_parent(e.student_no)))));

--
-- Name: student_status_changes parent_read_own_status_changes; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY parent_read_own_status_changes ON public.student_status_changes FOR SELECT USING (public.is_linked_parent(student_no));

--
-- Name: students parent_read_own_student; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY parent_read_own_student ON public.students FOR SELECT USING (public.is_linked_parent(student_no));

--
-- Name: password_policy_settings; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.password_policy_settings ENABLE ROW LEVEL SECURITY;

--
-- Name: pending_changes; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.pending_changes ENABLE ROW LEVEL SECURITY;

--
-- Name: period_config; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.period_config ENABLE ROW LEVEL SECURITY;

--
-- Name: portal_accounts; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.portal_accounts ENABLE ROW LEVEL SECURITY;

--
-- Name: portal_login_settings; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.portal_login_settings ENABLE ROW LEVEL SECURITY;

--
-- Name: club_preferences portal_manage_own_preferences; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY portal_manage_own_preferences ON public.club_preferences USING (((student_no = public.current_portal_student_no()) AND (EXISTS ( SELECT 1
   FROM public.club_selection_windows w
  WHERE ((w.academic_year = club_preferences.academic_year) AND (w.term = club_preferences.term) AND (w.method ~~ '志願序_%'::text) AND ((now() >= w.opens_at) AND (now() <= COALESCE(w.closes_at, 'infinity'::timestamp with time zone))) AND (NOT w.is_finalized)))))) WITH CHECK (((student_no = public.current_portal_student_no()) AND (EXISTS ( SELECT 1
   FROM public.club_selection_windows w
  WHERE ((w.academic_year = club_preferences.academic_year) AND (w.term = club_preferences.term) AND (w.method ~~ '志願序_%'::text) AND ((now() >= w.opens_at) AND (now() <= COALESCE(w.closes_at, 'infinity'::timestamp with time zone))) AND (NOT w.is_finalized))))));

--
-- Name: clubs portal_read_clubs; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY portal_read_clubs ON public.clubs FOR SELECT USING ((public.current_portal_student_no() IS NOT NULL));

--
-- Name: club_members portal_read_own_membership; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY portal_read_own_membership ON public.club_members FOR SELECT USING ((student_no = public.current_portal_student_no()));

--
-- Name: profile_edit_requests; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.profile_edit_requests ENABLE ROW LEVEL SECURITY;

--
-- Name: portal_login_settings public_read_portal_login_settings; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY public_read_portal_login_settings ON public.portal_login_settings FOR SELECT USING (true);

--
-- Name: bulletin_posts public_read_published_posts; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY public_read_published_posts ON public.bulletin_posts FOR SELECT USING (((is_published = true) OR (public.current_role_name() = ANY (ARRAY['system_admin_s'::public.user_role, 'admin_a'::public.user_role, 'admin_b'::public.user_role]))));

--
-- Name: academic_terms read_academic_terms; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY read_academic_terms ON public.academic_terms FOR SELECT USING (((public.current_role_name() IS NOT NULL) OR public.has_department('dev'::public.admin_department) OR public.has_department('academic'::public.admin_department) OR public.has_department('discipline'::public.admin_department) OR public.has_department('general'::public.admin_department)));

--
-- Name: attendance_alert_settings read_attendance_alert_settings; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY read_attendance_alert_settings ON public.attendance_alert_settings FOR SELECT USING ((auth.uid() IS NOT NULL));

--
-- Name: class_schedule read_class_schedule; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY read_class_schedule ON public.class_schedule FOR SELECT USING (true);

--
-- Name: classes read_classes; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY read_classes ON public.classes FOR SELECT USING (true);

--
-- Name: clubs read_clubs; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY read_clubs ON public.clubs FOR SELECT USING (true);

--
-- Name: conduct_event_requests read_conduct_event_request; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY read_conduct_event_request ON public.conduct_event_requests FOR SELECT USING (((requested_by = auth.uid()) OR (public.current_role_name() = ANY (ARRAY['admin_a'::public.user_role, 'admin_b'::public.user_role, 'system_admin_s'::public.user_role]))));

--
-- Name: conduct_events read_conduct_events; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY read_conduct_events ON public.conduct_events FOR SELECT USING (true);

--
-- Name: conduct_events read_conduct_events_for_history; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY read_conduct_events_for_history ON public.conduct_events FOR SELECT USING ((public.is_system_admin() OR public.has_department('discipline'::public.admin_department) OR (recorded_by = ( SELECT public.current_teacher_id() AS current_teacher_id)) OR (EXISTS ( SELECT 1
   FROM (public.enrollments e
     JOIN public.classes c ON ((c.id = e.class_id)))
  WHERE ((e.student_no = conduct_events.student_no) AND (c.homeroom_teacher_id = ( SELECT public.current_teacher_id() AS current_teacher_id))))) OR public.is_linked_parent(student_no)));

--
-- Name: conduct_point_defaults read_conduct_point_defaults; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY read_conduct_point_defaults ON public.conduct_point_defaults FOR SELECT USING (true);

--
-- Name: curriculum read_curriculum; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY read_curriculum ON public.curriculum FOR SELECT USING (true);

--
-- Name: exam_class_roster_status read_exam_class_roster_status; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY read_exam_class_roster_status ON public.exam_class_roster_status FOR SELECT USING ((auth.uid() IS NOT NULL));

--
-- Name: exam_room_classes read_exam_room_classes; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY read_exam_room_classes ON public.exam_room_classes FOR SELECT USING ((auth.uid() IS NOT NULL));

--
-- Name: exam_room_seats read_exam_room_seats; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY read_exam_room_seats ON public.exam_room_seats FOR SELECT USING ((auth.uid() IS NOT NULL));

--
-- Name: exam_rooms read_exam_rooms; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY read_exam_rooms ON public.exam_rooms FOR SELECT USING ((auth.uid() IS NOT NULL));

--
-- Name: exam_seat_students read_exam_seat_students; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY read_exam_seat_students ON public.exam_seat_students FOR SELECT USING ((auth.uid() IS NOT NULL));

--
-- Name: exam_sessions read_exam_sessions; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY read_exam_sessions ON public.exam_sessions FOR SELECT USING ((auth.uid() IS NOT NULL));

--
-- Name: general_inventory_items read_general_inventory_items; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY read_general_inventory_items ON public.general_inventory_items FOR SELECT USING ((auth.uid() IS NOT NULL));

--
-- Name: general_inventory_transactions read_general_inventory_transactions; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY read_general_inventory_transactions ON public.general_inventory_transactions FOR SELECT USING ((auth.uid() IS NOT NULL));

--
-- Name: grade_progression read_grade_progression; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY read_grade_progression ON public.grade_progression FOR SELECT USING (true);

--
-- Name: grading_rules read_grading_rules; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY read_grading_rules ON public.grading_rules FOR SELECT USING (true);

--
-- Name: locked_periods read_locked_periods; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY read_locked_periods ON public.locked_periods FOR SELECT USING ((auth.uid() IS NOT NULL));

--
-- Name: maintenance_tickets read_maintenance_tickets; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY read_maintenance_tickets ON public.maintenance_tickets FOR SELECT USING (((status <> '已完成'::text) OR public.is_system_admin() OR public.is_department_lead('general'::public.admin_department)));

--
-- Name: app_user_module_overrides read_own_module_overrides; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY read_own_module_overrides ON public.app_user_module_overrides FOR SELECT USING (((public.current_role_name() = 'system_admin_s'::public.user_role) OR (app_user_id = auth.uid())));

--
-- Name: app_user_departments read_own_or_department_lead; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY read_own_or_department_lead ON public.app_user_departments FOR SELECT USING (((public.current_role_name() = 'system_admin_s'::public.user_role) OR (app_user_id = auth.uid()) OR public.is_department_lead_of(department)));

--
-- Name: period_config read_period_config; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY read_period_config ON public.period_config FOR SELECT USING (true);

--
-- Name: report_card_merge_template read_report_card_merge_template; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY read_report_card_merge_template ON public.report_card_merge_template FOR SELECT USING (true);

--
-- Name: report_card_style read_report_card_style; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY read_report_card_style ON public.report_card_style FOR SELECT USING (true);

--
-- Name: report_card_xlsx_template read_report_card_xlsx_template; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY read_report_card_xlsx_template ON public.report_card_xlsx_template FOR SELECT USING (true);

--
-- Name: score_adjustments read_score_adjustments; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY read_score_adjustments ON public.score_adjustments FOR SELECT USING (true);

--
-- Name: club_selection_windows read_selection_windows; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY read_selection_windows ON public.club_selection_windows FOR SELECT USING (true);

--
-- Name: submission_windows read_submission_windows; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY read_submission_windows ON public.submission_windows FOR SELECT USING (true);

--
-- Name: substitute_assignments read_substitute_assignments; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY read_substitute_assignments ON public.substitute_assignments FOR SELECT USING ((public.is_system_admin() OR public.has_department('academic'::public.admin_department) OR (original_teacher_id = public.current_teacher_id()) OR (substitute_teacher_id = public.current_teacher_id())));

--
-- Name: teachers read_teachers; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY read_teachers ON public.teachers FOR SELECT USING (true);

--
-- Name: utility_bills read_utility_bills; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY read_utility_bills ON public.utility_bills FOR SELECT USING ((auth.uid() IS NOT NULL));

--
-- Name: report_card_merge_template; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.report_card_merge_template ENABLE ROW LEVEL SECURITY;

--
-- Name: report_card_style; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.report_card_style ENABLE ROW LEVEL SECURITY;

--
-- Name: report_card_xlsx_template; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.report_card_xlsx_template ENABLE ROW LEVEL SECURITY;

--
-- Name: scheduler_backups; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.scheduler_backups ENABLE ROW LEVEL SECURITY;

--
-- Name: scheduler_backups scheduler_backups_select_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY scheduler_backups_select_admin ON public.scheduler_backups FOR SELECT USING ((public.is_system_admin() OR public.has_department('academic'::public.admin_department)));

--
-- Name: score_adjustments; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.score_adjustments ENABLE ROW LEVEL SECURITY;

--
-- Name: score_audit_log; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.score_audit_log ENABLE ROW LEVEL SECURITY;

--
-- Name: scores; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.scores ENABLE ROW LEVEL SECURITY;

--
-- Name: scores scores_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY scores_delete ON public.scores FOR DELETE USING (public.can_write_score(enrollment_id, subject, (exam_type)::text, id));

--
-- Name: scores scores_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY scores_insert ON public.scores FOR INSERT WITH CHECK (public.can_write_score(enrollment_id, subject, (exam_type)::text));

--
-- Name: scores scores_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY scores_select ON public.scores FOR SELECT USING ((public.is_system_admin() OR public.has_department('academic'::public.admin_department) OR (EXISTS ( SELECT 1
   FROM (public.enrollments e
     JOIN public.class_schedule cs ON ((cs.class_id = e.class_id)))
  WHERE ((e.id = scores.enrollment_id) AND (cs.teacher_id = public.current_teacher_id()) AND (cs.subject = scores.subject)))) OR (EXISTS ( SELECT 1
   FROM (public.enrollments e
     JOIN public.classes c ON ((c.id = e.class_id)))
  WHERE ((e.id = scores.enrollment_id) AND (c.homeroom_teacher_id = public.current_teacher_id()))))));

--
-- Name: scores scores_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY scores_update ON public.scores FOR UPDATE USING (public.can_write_score(enrollment_id, subject, (exam_type)::text, id)) WITH CHECK (public.can_write_score(enrollment_id, subject, (exam_type)::text, id));

--
-- Name: portal_accounts self_read_portal_account; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY self_read_portal_account ON public.portal_accounts FOR SELECT USING ((auth_user_id = auth.uid()));

--
-- Name: site_content; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.site_content ENABLE ROW LEVEL SECURITY;

--
-- Name: site_settings; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.site_settings ENABLE ROW LEVEL SECURITY;

--
-- Name: pending_changes staff_create_pending_change; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY staff_create_pending_change ON public.pending_changes FOR INSERT WITH CHECK (((requested_by = auth.uid()) AND (public.has_department(department) OR public.is_system_admin())));

--
-- Name: portal_accounts staff_create_portal_accounts; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY staff_create_portal_accounts ON public.portal_accounts FOR INSERT WITH CHECK ((public.is_system_admin() OR public.has_department('academic'::public.admin_department) OR (EXISTS ( SELECT 1
   FROM (public.enrollments e
     JOIN public.classes c ON ((c.id = e.class_id)))
  WHERE ((e.student_no = portal_accounts.student_no) AND (c.homeroom_teacher_id = public.current_teacher_id()))))));

--
-- Name: portal_accounts staff_manage_portal_accounts; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY staff_manage_portal_accounts ON public.portal_accounts FOR UPDATE USING ((public.is_system_admin() OR public.has_department('academic'::public.admin_department))) WITH CHECK ((public.is_system_admin() OR public.has_department('academic'::public.admin_department)));

--
-- Name: staff_notifications; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.staff_notifications ENABLE ROW LEVEL SECURITY;

--
-- Name: attendance_notifications staff_read_attendance_notifications; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY staff_read_attendance_notifications ON public.attendance_notifications FOR SELECT USING (((public.current_role_name() = ANY (ARRAY['admin_a'::public.user_role, 'admin_b'::public.user_role, 'system_admin_s'::public.user_role])) OR (EXISTS ( SELECT 1
   FROM (public.enrollments e
     JOIN public.classes c ON ((c.id = e.class_id)))
  WHERE ((e.student_no = attendance_notifications.student_no) AND (e.is_current = true) AND (c.homeroom_teacher_id = public.current_teacher_id()))))));

--
-- Name: attendance_score_display_settings staff_read_attendance_score_display_settings; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY staff_read_attendance_score_display_settings ON public.attendance_score_display_settings FOR SELECT USING (true);

--
-- Name: enrollments staff_read_enrollments; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY staff_read_enrollments ON public.enrollments FOR SELECT USING ((( SELECT public.is_system_admin() AS is_system_admin) OR ( SELECT public.has_department('academic'::public.admin_department) AS has_department) OR ( SELECT public.has_department('discipline'::public.admin_department) AS has_department) OR (EXISTS ( SELECT 1
   FROM public.classes c
  WHERE ((c.id = enrollments.class_id) AND (c.homeroom_teacher_id = ( SELECT public.current_teacher_id() AS current_teacher_id))))) OR (EXISTS ( SELECT 1
   FROM public.class_schedule cs
  WHERE ((cs.class_id = enrollments.class_id) AND (cs.term = enrollments.term) AND (cs.teacher_id = ( SELECT public.current_teacher_id() AS current_teacher_id)))))));

--
-- Name: homeroom_attendance_assist_settings staff_read_homeroom_attendance_assist_settings; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY staff_read_homeroom_attendance_assist_settings ON public.homeroom_attendance_assist_settings FOR SELECT USING ((auth.uid() IS NOT NULL));

--
-- Name: admin_module_categories staff_read_module_categories; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY staff_read_module_categories ON public.admin_module_categories FOR SELECT USING ((public.current_role_name() IS NOT NULL));

--
-- Name: admin_module_order staff_read_module_order; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY staff_read_module_order ON public.admin_module_order FOR SELECT USING ((public.current_role_name() IS NOT NULL));

--
-- Name: pending_changes staff_read_own_pending_change; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY staff_read_own_pending_change ON public.pending_changes FOR SELECT USING ((requested_by = auth.uid()));

--
-- Name: password_policy_settings staff_read_password_policy_settings; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY staff_read_password_policy_settings ON public.password_policy_settings FOR SELECT USING (true);

--
-- Name: site_content staff_read_site_content; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY staff_read_site_content ON public.site_content FOR SELECT USING ((public.current_role_name() IS NOT NULL));

--
-- Name: site_settings staff_read_site_settings; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY staff_read_site_settings ON public.site_settings FOR SELECT USING ((public.current_role_name() IS NOT NULL));

--
-- Name: students staff_read_students; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY staff_read_students ON public.students FOR SELECT USING ((public.is_system_admin() OR public.has_department('academic'::public.admin_department) OR public.has_department('discipline'::public.admin_department) OR (EXISTS ( SELECT 1
   FROM (public.enrollments e
     JOIN public.classes c ON ((c.id = e.class_id)))
  WHERE ((e.student_no = students.student_no) AND (c.homeroom_teacher_id = public.current_teacher_id())))) OR (EXISTS ( SELECT 1
   FROM (public.class_schedule cs
     JOIN public.enrollments e2 ON ((e2.class_id = cs.class_id)))
  WHERE ((e2.student_no = students.student_no) AND (cs.teacher_id = public.current_teacher_id()))))));

--
-- Name: teacher_login_settings staff_read_teacher_login_settings; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY staff_read_teacher_login_settings ON public.teacher_login_settings FOR SELECT USING (true);

--
-- Name: status_change_attachments; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.status_change_attachments ENABLE ROW LEVEL SECURITY;

--
-- Name: student_remarks; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.student_remarks ENABLE ROW LEVEL SECURITY;

--
-- Name: student_status_changes; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.student_status_changes ENABLE ROW LEVEL SECURITY;

--
-- Name: students; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.students ENABLE ROW LEVEL SECURITY;

--
-- Name: submission_window_audit_log; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.submission_window_audit_log ENABLE ROW LEVEL SECURITY;

--
-- Name: submission_windows; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.submission_windows ENABLE ROW LEVEL SECURITY;

--
-- Name: substitute_assignments; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.substitute_assignments ENABLE ROW LEVEL SECURITY;

--
-- Name: admin_module_categories system_admin_delete_module_categories; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY system_admin_delete_module_categories ON public.admin_module_categories FOR DELETE USING ((public.current_role_name() = 'system_admin_s'::public.user_role));

--
-- Name: admin_module_order system_admin_delete_module_order; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY system_admin_delete_module_order ON public.admin_module_order FOR DELETE USING ((public.current_role_name() = 'system_admin_s'::public.user_role));

--
-- Name: site_content system_admin_delete_site_content; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY system_admin_delete_site_content ON public.site_content FOR DELETE USING ((public.current_role_name() = 'system_admin_s'::public.user_role));

--
-- Name: site_settings system_admin_delete_site_settings; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY system_admin_delete_site_settings ON public.site_settings FOR DELETE USING ((public.current_role_name() = 'system_admin_s'::public.user_role));

--
-- Name: app_user_departments system_admin_manage_departments; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY system_admin_manage_departments ON public.app_user_departments USING ((public.current_role_name() = 'system_admin_s'::public.user_role)) WITH CHECK ((public.current_role_name() = 'system_admin_s'::public.user_role));

--
-- Name: app_user_module_overrides system_admin_manage_module_overrides; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY system_admin_manage_module_overrides ON public.app_user_module_overrides USING ((public.current_role_name() = 'system_admin_s'::public.user_role)) WITH CHECK ((public.current_role_name() = 'system_admin_s'::public.user_role));

--
-- Name: admin_module_categories system_admin_update_module_categories; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY system_admin_update_module_categories ON public.admin_module_categories FOR UPDATE USING ((public.current_role_name() = 'system_admin_s'::public.user_role)) WITH CHECK ((public.current_role_name() = 'system_admin_s'::public.user_role));

--
-- Name: admin_module_order system_admin_update_module_order; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY system_admin_update_module_order ON public.admin_module_order FOR UPDATE USING ((public.current_role_name() = 'system_admin_s'::public.user_role)) WITH CHECK ((public.current_role_name() = 'system_admin_s'::public.user_role));

--
-- Name: site_content system_admin_update_site_content; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY system_admin_update_site_content ON public.site_content FOR UPDATE USING ((public.current_role_name() = 'system_admin_s'::public.user_role)) WITH CHECK ((public.current_role_name() = 'system_admin_s'::public.user_role));

--
-- Name: site_settings system_admin_update_site_settings; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY system_admin_update_site_settings ON public.site_settings FOR UPDATE USING ((public.current_role_name() = 'system_admin_s'::public.user_role)) WITH CHECK ((public.current_role_name() = 'system_admin_s'::public.user_role));

--
-- Name: admin_module_categories system_admin_write_module_categories; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY system_admin_write_module_categories ON public.admin_module_categories FOR INSERT WITH CHECK ((public.current_role_name() = 'system_admin_s'::public.user_role));

--
-- Name: admin_module_order system_admin_write_module_order; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY system_admin_write_module_order ON public.admin_module_order FOR INSERT WITH CHECK ((public.current_role_name() = 'system_admin_s'::public.user_role));

--
-- Name: site_content system_admin_write_site_content; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY system_admin_write_site_content ON public.site_content FOR INSERT WITH CHECK ((public.current_role_name() = 'system_admin_s'::public.user_role));

--
-- Name: site_settings system_admin_write_site_settings; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY system_admin_write_site_settings ON public.site_settings FOR INSERT WITH CHECK ((public.current_role_name() = 'system_admin_s'::public.user_role));

--
-- Name: teacher_appointment_letters; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.teacher_appointment_letters ENABLE ROW LEVEL SECURITY;

--
-- Name: correction_requests teacher_create_requests; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY teacher_create_requests ON public.correction_requests FOR INSERT WITH CHECK ((requested_by = public.current_teacher_id()));

--
-- Name: teacher_letter_settings; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.teacher_letter_settings ENABLE ROW LEVEL SECURITY;

--
-- Name: teacher_login_settings; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.teacher_login_settings ENABLE ROW LEVEL SECURITY;

--
-- Name: staff_notifications teacher_mark_own_notifications_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY teacher_mark_own_notifications_read ON public.staff_notifications FOR UPDATE USING ((teacher_id = public.current_teacher_id())) WITH CHECK ((teacher_id = public.current_teacher_id()));

--
-- Name: staff_notifications teacher_read_own_notifications; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY teacher_read_own_notifications ON public.staff_notifications FOR SELECT USING (((teacher_id = public.current_teacher_id()) OR public.is_system_admin() OR public.has_department('discipline'::public.admin_department)));

--
-- Name: teacher_service_certificates; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.teacher_service_certificates ENABLE ROW LEVEL SECURITY;

--
-- Name: correction_requests teacher_view_own_requests; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY teacher_view_own_requests ON public.correction_requests FOR SELECT USING (((requested_by = public.current_teacher_id()) OR public.is_system_admin() OR ((data_type = '出缺勤'::text) AND public.is_department_lead('discipline'::public.admin_department)) OR ((data_type = ANY (ARRAY['期中考'::text, '期末考'::text, '平時分'::text])) AND public.is_department_lead('academic'::public.admin_department))));

--
-- Name: teachers; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.teachers ENABLE ROW LEVEL SECURITY;

--
-- Name: utility_bills; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.utility_bills ENABLE ROW LEVEL SECURITY;


--
-- 函式執行權限（Supabase 預設會把 public 內函式開放給 anon/authenticated，
-- 以下三支函式有特別收緊，需在建立函式之後執行）
--
-- 備份寫入函式：只有伺服器端（service_role）呼叫。
-- 註：舊版 sql/79 對 4 參數版本做了這個收緊，但 sql/97、sql/100 改成 5 參數版本後
--     忘了重做，導致舊資料庫上 anon/authenticated 目前其實可以呼叫它。這裡補回。
revoke all on function public.admin_insert_backup(text, uuid, jsonb, jsonb, text) from public, anon, authenticated;
grant execute on function public.admin_insert_backup(text, uuid, jsonb, jsonb, text) to service_role;

revoke all on function public.guardian_phones_for_roster(text) from public, anon;
grant execute on function public.guardian_phones_for_roster(text) to authenticated;

revoke all on function public.decide_conduct_event_request(uuid, text) from public, anon;
grant execute on function public.decide_conduct_event_request(uuid, text) to authenticated;
