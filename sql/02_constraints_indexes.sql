-- =====================================================================
-- 華雲學校管理系統  全新安裝用 SQL  (2/4)  主鍵／外鍵／索引
-- =====================================================================
-- 內容：PRIMARY KEY、UNIQUE、CHECK、FOREIGN KEY 與索引。
--
-- 這 4 份檔案是把舊的 sql/1 ~ sql/104 共 104 份遷移檔，在一個空資料庫依序
-- 執行完畢後匯出的「最終狀態」，只適用於【全新、空的】Supabase 專案。
-- 既有資料庫不需要、也不要再執行（舊的 104 份已經套用過了）。
--
-- 執行順序（Supabase 後台 SQL Editor，逐份貼上執行）：
--   01_schema.sql → 02_constraints_indexes.sql → 03_triggers_rls_policies.sql → 04_seed_and_storage.sql
-- =====================================================================

--
-- Name: academic_terms academic_terms_academic_year_term_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.academic_terms
    ADD CONSTRAINT academic_terms_academic_year_term_key UNIQUE (academic_year, term);

--
-- Name: academic_terms academic_terms_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.academic_terms
    ADD CONSTRAINT academic_terms_pkey PRIMARY KEY (id);

--
-- Name: account_audit_log account_audit_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.account_audit_log
    ADD CONSTRAINT account_audit_log_pkey PRIMARY KEY (id);

--
-- Name: admin_module_categories admin_module_categories_module_key_category_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admin_module_categories
    ADD CONSTRAINT admin_module_categories_module_key_category_key UNIQUE (module_key, category);

--
-- Name: admin_module_categories admin_module_categories_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admin_module_categories
    ADD CONSTRAINT admin_module_categories_pkey PRIMARY KEY (id);

--
-- Name: admin_module_order admin_module_order_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admin_module_order
    ADD CONSTRAINT admin_module_order_pkey PRIMARY KEY (module_key);

--
-- Name: app_user_departments app_user_departments_app_user_id_department_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_user_departments
    ADD CONSTRAINT app_user_departments_app_user_id_department_key UNIQUE (app_user_id, department);

--
-- Name: app_user_departments app_user_departments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_user_departments
    ADD CONSTRAINT app_user_departments_pkey PRIMARY KEY (id);

--
-- Name: app_user_module_overrides app_user_module_overrides_app_user_id_module_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_user_module_overrides
    ADD CONSTRAINT app_user_module_overrides_app_user_id_module_key_key UNIQUE (app_user_id, module_key);

--
-- Name: app_user_module_overrides app_user_module_overrides_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_user_module_overrides
    ADD CONSTRAINT app_user_module_overrides_pkey PRIMARY KEY (id);

--
-- Name: app_users app_users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_users
    ADD CONSTRAINT app_users_pkey PRIMARY KEY (id);

--
-- Name: attendance_alert_settings attendance_alert_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.attendance_alert_settings
    ADD CONSTRAINT attendance_alert_settings_pkey PRIMARY KEY (id);

--
-- Name: attendance_audit_log attendance_audit_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.attendance_audit_log
    ADD CONSTRAINT attendance_audit_log_pkey PRIMARY KEY (id);

--
-- Name: attendance_notifications attendance_notifications_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.attendance_notifications
    ADD CONSTRAINT attendance_notifications_pkey PRIMARY KEY (id);

--
-- Name: attendance attendance_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.attendance
    ADD CONSTRAINT attendance_pkey PRIMARY KEY (id);

--
-- Name: attendance_score_display_settings attendance_score_display_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.attendance_score_display_settings
    ADD CONSTRAINT attendance_score_display_settings_pkey PRIMARY KEY (id);

--
-- Name: attendance attendance_student_no_record_date_period_no_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.attendance
    ADD CONSTRAINT attendance_student_no_record_date_period_no_key UNIQUE (student_no, record_date, period_no);

--
-- Name: backups backups_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.backups
    ADD CONSTRAINT backups_pkey PRIMARY KEY (id);

--
-- Name: bulletin_posts bulletin_posts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bulletin_posts
    ADD CONSTRAINT bulletin_posts_pkey PRIMARY KEY (id);

--
-- Name: class_schedule class_schedule_class_id_academic_year_term_weekday_period_n_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.class_schedule
    ADD CONSTRAINT class_schedule_class_id_academic_year_term_weekday_period_n_key UNIQUE (class_id, academic_year, term, weekday, period_no);

--
-- Name: class_schedule class_schedule_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.class_schedule
    ADD CONSTRAINT class_schedule_pkey PRIMARY KEY (id);

--
-- Name: classes classes_academic_year_department_grade_level_class_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.classes
    ADD CONSTRAINT classes_academic_year_department_grade_level_class_name_key UNIQUE (academic_year, department, grade_level, class_name);

--
-- Name: classes classes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.classes
    ADD CONSTRAINT classes_pkey PRIMARY KEY (id);

--
-- Name: clock_day_overrides clock_day_overrides_device_code_punch_date_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.clock_day_overrides
    ADD CONSTRAINT clock_day_overrides_device_code_punch_date_key UNIQUE (device_code, punch_date);

--
-- Name: clock_day_overrides clock_day_overrides_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.clock_day_overrides
    ADD CONSTRAINT clock_day_overrides_pkey PRIMARY KEY (id);

--
-- Name: clock_employee_map clock_employee_map_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.clock_employee_map
    ADD CONSTRAINT clock_employee_map_pkey PRIMARY KEY (device_code);

--
-- Name: clock_holidays clock_holidays_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.clock_holidays
    ADD CONSTRAINT clock_holidays_pkey PRIMARY KEY (holiday_date);

--
-- Name: clock_import_log clock_import_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.clock_import_log
    ADD CONSTRAINT clock_import_log_pkey PRIMARY KEY (id);

--
-- Name: clock_records clock_records_device_code_punched_at_machine_no_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.clock_records
    ADD CONSTRAINT clock_records_device_code_punched_at_machine_no_key UNIQUE (device_code, punched_at, machine_no);

--
-- Name: clock_records clock_records_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.clock_records
    ADD CONSTRAINT clock_records_pkey PRIMARY KEY (id);

--
-- Name: clock_shifts clock_shifts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.clock_shifts
    ADD CONSTRAINT clock_shifts_pkey PRIMARY KEY (id);

--
-- Name: club_attendance club_attendance_club_id_student_no_record_date_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.club_attendance
    ADD CONSTRAINT club_attendance_club_id_student_no_record_date_key UNIQUE (club_id, student_no, record_date);

--
-- Name: club_attendance club_attendance_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.club_attendance
    ADD CONSTRAINT club_attendance_pkey PRIMARY KEY (id);

--
-- Name: club_members club_members_club_id_student_no_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.club_members
    ADD CONSTRAINT club_members_club_id_student_no_key UNIQUE (club_id, student_no);

--
-- Name: club_members club_members_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.club_members
    ADD CONSTRAINT club_members_pkey PRIMARY KEY (id);

--
-- Name: club_preferences club_preferences_academic_year_term_student_no_choice_rank_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.club_preferences
    ADD CONSTRAINT club_preferences_academic_year_term_student_no_choice_rank_key UNIQUE (academic_year, term, student_no, choice_rank);

--
-- Name: club_preferences club_preferences_academic_year_term_student_no_club_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.club_preferences
    ADD CONSTRAINT club_preferences_academic_year_term_student_no_club_id_key UNIQUE (academic_year, term, student_no, club_id);

--
-- Name: club_preferences club_preferences_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.club_preferences
    ADD CONSTRAINT club_preferences_pkey PRIMARY KEY (id);

--
-- Name: club_scores club_scores_club_id_student_no_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.club_scores
    ADD CONSTRAINT club_scores_club_id_student_no_key UNIQUE (club_id, student_no);

--
-- Name: club_scores club_scores_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.club_scores
    ADD CONSTRAINT club_scores_pkey PRIMARY KEY (id);

--
-- Name: club_selection_windows club_selection_windows_academic_year_term_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.club_selection_windows
    ADD CONSTRAINT club_selection_windows_academic_year_term_key UNIQUE (academic_year, term);

--
-- Name: club_selection_windows club_selection_windows_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.club_selection_windows
    ADD CONSTRAINT club_selection_windows_pkey PRIMARY KEY (id);

--
-- Name: clubs clubs_name_academic_year_term_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.clubs
    ADD CONSTRAINT clubs_name_academic_year_term_key UNIQUE (name, academic_year, term);

--
-- Name: clubs clubs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.clubs
    ADD CONSTRAINT clubs_pkey PRIMARY KEY (id);

--
-- Name: conduct_event_requests conduct_event_requests_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.conduct_event_requests
    ADD CONSTRAINT conduct_event_requests_pkey PRIMARY KEY (id);

--
-- Name: conduct_events conduct_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.conduct_events
    ADD CONSTRAINT conduct_events_pkey PRIMARY KEY (id);

--
-- Name: conduct_events conduct_events_student_date_type_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.conduct_events
    ADD CONSTRAINT conduct_events_student_date_type_key UNIQUE (student_no, event_date, event_type);

--
-- Name: conduct_point_defaults conduct_point_defaults_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.conduct_point_defaults
    ADD CONSTRAINT conduct_point_defaults_pkey PRIMARY KEY (item);

--
-- Name: conduct_scores conduct_scores_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.conduct_scores
    ADD CONSTRAINT conduct_scores_pkey PRIMARY KEY (enrollment_id);

--
-- Name: correction_requests correction_requests_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.correction_requests
    ADD CONSTRAINT correction_requests_pkey PRIMARY KEY (id);

--
-- Name: curriculum curriculum_academic_year_term_grade_level_subject_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.curriculum
    ADD CONSTRAINT curriculum_academic_year_term_grade_level_subject_key UNIQUE (academic_year, term, grade_level, subject);

--
-- Name: curriculum curriculum_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.curriculum
    ADD CONSTRAINT curriculum_pkey PRIMARY KEY (id);

--
-- Name: enrollments enrollments_class_id_term_seat_no_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.enrollments
    ADD CONSTRAINT enrollments_class_id_term_seat_no_key UNIQUE (class_id, term, seat_no);

--
-- Name: enrollments enrollments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.enrollments
    ADD CONSTRAINT enrollments_pkey PRIMARY KEY (id);

--
-- Name: exam_class_roster_status exam_class_roster_status_exam_session_id_class_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.exam_class_roster_status
    ADD CONSTRAINT exam_class_roster_status_exam_session_id_class_id_key UNIQUE (exam_session_id, class_id);

--
-- Name: exam_class_roster_status exam_class_roster_status_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.exam_class_roster_status
    ADD CONSTRAINT exam_class_roster_status_pkey PRIMARY KEY (id);

--
-- Name: exam_room_classes exam_room_classes_exam_room_id_class_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.exam_room_classes
    ADD CONSTRAINT exam_room_classes_exam_room_id_class_id_key UNIQUE (exam_room_id, class_id);

--
-- Name: exam_room_classes exam_room_classes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.exam_room_classes
    ADD CONSTRAINT exam_room_classes_pkey PRIMARY KEY (id);

--
-- Name: exam_room_seats exam_room_seats_exam_room_id_seat_no_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.exam_room_seats
    ADD CONSTRAINT exam_room_seats_exam_room_id_seat_no_key UNIQUE (exam_room_id, seat_no);

--
-- Name: exam_room_seats exam_room_seats_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.exam_room_seats
    ADD CONSTRAINT exam_room_seats_pkey PRIMARY KEY (id);

--
-- Name: exam_rooms exam_rooms_exam_session_id_room_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.exam_rooms
    ADD CONSTRAINT exam_rooms_exam_session_id_room_name_key UNIQUE (exam_session_id, room_name);

--
-- Name: exam_rooms exam_rooms_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.exam_rooms
    ADD CONSTRAINT exam_rooms_pkey PRIMARY KEY (id);

--
-- Name: exam_seat_students exam_seat_students_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.exam_seat_students
    ADD CONSTRAINT exam_seat_students_pkey PRIMARY KEY (exam_room_seat_id);

--
-- Name: exam_sessions exam_sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.exam_sessions
    ADD CONSTRAINT exam_sessions_pkey PRIMARY KEY (id);

--
-- Name: general_inventory_items general_inventory_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.general_inventory_items
    ADD CONSTRAINT general_inventory_items_pkey PRIMARY KEY (id);

--
-- Name: general_inventory_transactions general_inventory_transactions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.general_inventory_transactions
    ADD CONSTRAINT general_inventory_transactions_pkey PRIMARY KEY (id);

--
-- Name: governed_tables governed_tables_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.governed_tables
    ADD CONSTRAINT governed_tables_pkey PRIMARY KEY (table_name);

--
-- Name: grade_progression grade_progression_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grade_progression
    ADD CONSTRAINT grade_progression_pkey PRIMARY KEY (department, grade_level);

--
-- Name: grading_rules grading_rules_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grading_rules
    ADD CONSTRAINT grading_rules_pkey PRIMARY KEY (academic_year, term);

--
-- Name: guardians guardians_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.guardians
    ADD CONSTRAINT guardians_pkey PRIMARY KEY (id);

--
-- Name: homeroom_attendance_assist_settings homeroom_attendance_assist_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.homeroom_attendance_assist_settings
    ADD CONSTRAINT homeroom_attendance_assist_settings_pkey PRIMARY KEY (id);

--
-- Name: locked_periods locked_periods_academic_year_term_scope_scope_ref_weekday_p_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.locked_periods
    ADD CONSTRAINT locked_periods_academic_year_term_scope_scope_ref_weekday_p_key UNIQUE (academic_year, term, scope, scope_ref, weekday, period_no);

--
-- Name: locked_periods locked_periods_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.locked_periods
    ADD CONSTRAINT locked_periods_pkey PRIMARY KEY (id);

--
-- Name: maintenance_tickets maintenance_tickets_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.maintenance_tickets
    ADD CONSTRAINT maintenance_tickets_pkey PRIMARY KEY (id);

--
-- Name: password_policy_settings password_policy_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.password_policy_settings
    ADD CONSTRAINT password_policy_settings_pkey PRIMARY KEY (id);

--
-- Name: pending_changes pending_changes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pending_changes
    ADD CONSTRAINT pending_changes_pkey PRIMARY KEY (id);

--
-- Name: period_config period_config_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.period_config
    ADD CONSTRAINT period_config_pkey PRIMARY KEY (id);

--
-- Name: portal_accounts portal_accounts_login_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.portal_accounts
    ADD CONSTRAINT portal_accounts_login_code_key UNIQUE (login_code);

--
-- Name: portal_accounts portal_accounts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.portal_accounts
    ADD CONSTRAINT portal_accounts_pkey PRIMARY KEY (id);

--
-- Name: portal_login_settings portal_login_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.portal_login_settings
    ADD CONSTRAINT portal_login_settings_pkey PRIMARY KEY (id);

--
-- Name: profile_edit_requests profile_edit_requests_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profile_edit_requests
    ADD CONSTRAINT profile_edit_requests_pkey PRIMARY KEY (id);

--
-- Name: report_card_merge_template report_card_merge_template_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.report_card_merge_template
    ADD CONSTRAINT report_card_merge_template_pkey PRIMARY KEY (id);

--
-- Name: report_card_style report_card_style_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.report_card_style
    ADD CONSTRAINT report_card_style_pkey PRIMARY KEY (id);

--
-- Name: report_card_xlsx_template report_card_xlsx_template_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.report_card_xlsx_template
    ADD CONSTRAINT report_card_xlsx_template_pkey PRIMARY KEY (id);

--
-- Name: scheduler_backups scheduler_backups_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.scheduler_backups
    ADD CONSTRAINT scheduler_backups_pkey PRIMARY KEY (id);

--
-- Name: score_adjustments score_adjustments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.score_adjustments
    ADD CONSTRAINT score_adjustments_pkey PRIMARY KEY (id);

--
-- Name: score_audit_log score_audit_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.score_audit_log
    ADD CONSTRAINT score_audit_log_pkey PRIMARY KEY (id);

--
-- Name: scores scores_enrollment_id_exam_type_subject_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.scores
    ADD CONSTRAINT scores_enrollment_id_exam_type_subject_key UNIQUE (enrollment_id, exam_type, subject);

--
-- Name: scores scores_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.scores
    ADD CONSTRAINT scores_pkey PRIMARY KEY (id);

--
-- Name: site_content site_content_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.site_content
    ADD CONSTRAINT site_content_pkey PRIMARY KEY (content_key);

--
-- Name: site_settings site_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.site_settings
    ADD CONSTRAINT site_settings_pkey PRIMARY KEY (setting_key);

--
-- Name: staff_notifications staff_notifications_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.staff_notifications
    ADD CONSTRAINT staff_notifications_pkey PRIMARY KEY (id);

--
-- Name: status_change_attachments status_change_attachments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.status_change_attachments
    ADD CONSTRAINT status_change_attachments_pkey PRIMARY KEY (id);

--
-- Name: student_remarks student_remarks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.student_remarks
    ADD CONSTRAINT student_remarks_pkey PRIMARY KEY (enrollment_id);

--
-- Name: student_status_changes student_status_changes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.student_status_changes
    ADD CONSTRAINT student_status_changes_pkey PRIMARY KEY (id);

--
-- Name: students students_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.students
    ADD CONSTRAINT students_pkey PRIMARY KEY (student_no);

--
-- Name: submission_window_audit_log submission_window_audit_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.submission_window_audit_log
    ADD CONSTRAINT submission_window_audit_log_pkey PRIMARY KEY (id);

--
-- Name: submission_windows submission_windows_academic_year_term_data_type_scope_scope_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.submission_windows
    ADD CONSTRAINT submission_windows_academic_year_term_data_type_scope_scope_key UNIQUE (academic_year, term, data_type, scope, scope_ref);

--
-- Name: submission_windows submission_windows_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.submission_windows
    ADD CONSTRAINT submission_windows_pkey PRIMARY KEY (id);

--
-- Name: substitute_assignments substitute_assignments_class_id_substitute_date_period_no_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.substitute_assignments
    ADD CONSTRAINT substitute_assignments_class_id_substitute_date_period_no_key UNIQUE (class_id, substitute_date, period_no);

--
-- Name: substitute_assignments substitute_assignments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.substitute_assignments
    ADD CONSTRAINT substitute_assignments_pkey PRIMARY KEY (id);

--
-- Name: teacher_appointment_letters teacher_appointment_letters_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.teacher_appointment_letters
    ADD CONSTRAINT teacher_appointment_letters_pkey PRIMARY KEY (id);

--
-- Name: teacher_letter_settings teacher_letter_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.teacher_letter_settings
    ADD CONSTRAINT teacher_letter_settings_pkey PRIMARY KEY (id);

--
-- Name: teacher_login_settings teacher_login_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.teacher_login_settings
    ADD CONSTRAINT teacher_login_settings_pkey PRIMARY KEY (id);

--
-- Name: teacher_service_certificates teacher_service_certificates_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.teacher_service_certificates
    ADD CONSTRAINT teacher_service_certificates_pkey PRIMARY KEY (id);

--
-- Name: teachers teachers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.teachers
    ADD CONSTRAINT teachers_pkey PRIMARY KEY (id);

--
-- Name: utility_bills utility_bills_category_billing_month_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.utility_bills
    ADD CONSTRAINT utility_bills_category_billing_month_key UNIQUE (category, billing_month);

--
-- Name: utility_bills utility_bills_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.utility_bills
    ADD CONSTRAINT utility_bills_pkey PRIMARY KEY (id);

--
-- Name: academic_terms_only_one_current; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX academic_terms_only_one_current ON public.academic_terms USING btree (is_current) WHERE (is_current = true);

--
-- Name: idx_attendance_record_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_attendance_record_date ON public.attendance USING btree (record_date);

--
-- Name: idx_attendance_student_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_attendance_student_date ON public.attendance USING btree (student_no, record_date);

--
-- Name: idx_class_schedule_teacher_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_class_schedule_teacher_id ON public.class_schedule USING btree (teacher_id);

--
-- Name: idx_classes_homeroom_teacher_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_classes_homeroom_teacher_id ON public.classes USING btree (homeroom_teacher_id);

--
-- Name: idx_clock_day_overrides_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_clock_day_overrides_date ON public.clock_day_overrides USING btree (punch_date);

--
-- Name: idx_clock_employee_map_teacher; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_clock_employee_map_teacher ON public.clock_employee_map USING btree (teacher_id);

--
-- Name: idx_clock_import_log_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_clock_import_log_created ON public.clock_import_log USING btree (created_at DESC);

--
-- Name: idx_clock_records_code_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_clock_records_code_date ON public.clock_records USING btree (device_code, punch_date);

--
-- Name: idx_clock_records_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_clock_records_date ON public.clock_records USING btree (punch_date);

--
-- Name: idx_club_attendance_club_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_club_attendance_club_date ON public.club_attendance USING btree (club_id, record_date);

--
-- Name: idx_club_members_club; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_club_members_club ON public.club_members USING btree (club_id);

--
-- Name: idx_club_members_student; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_club_members_student ON public.club_members USING btree (student_no);

--
-- Name: idx_conduct_event_requests_batch; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_conduct_event_requests_batch ON public.conduct_event_requests USING btree (batch_id);

--
-- Name: idx_conduct_event_requests_requested_by; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_conduct_event_requests_requested_by ON public.conduct_event_requests USING btree (requested_by);

--
-- Name: idx_conduct_event_requests_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_conduct_event_requests_status ON public.conduct_event_requests USING btree (status);

--
-- Name: idx_conduct_events_student_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_conduct_events_student_date ON public.conduct_events USING btree (student_no, event_date);

--
-- Name: idx_enrollments_student_no; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_enrollments_student_no ON public.enrollments USING btree (student_no);

--
-- Name: idx_exam_room_classes_class; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_exam_room_classes_class ON public.exam_room_classes USING btree (class_id);

--
-- Name: idx_exam_room_seats_class; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_exam_room_seats_class ON public.exam_room_seats USING btree (class_id);

--
-- Name: idx_exam_room_seats_room; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_exam_room_seats_room ON public.exam_room_seats USING btree (exam_room_id);

--
-- Name: idx_general_inventory_tx_item; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_general_inventory_tx_item ON public.general_inventory_transactions USING btree (item_id);

--
-- Name: idx_pending_changes_dept_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pending_changes_dept_status ON public.pending_changes USING btree (department, status);

--
-- Name: idx_portal_accounts_auth_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_portal_accounts_auth_user_id ON public.portal_accounts USING btree (auth_user_id);

--
-- Name: idx_portal_accounts_email; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_portal_accounts_email ON public.portal_accounts USING btree (lower(email));

--
-- Name: idx_portal_accounts_student_no; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_portal_accounts_student_no ON public.portal_accounts USING btree (student_no);

--
-- Name: idx_student_status_changes_latest; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_student_status_changes_latest ON public.student_status_changes USING btree (student_no, effective_date DESC, created_at DESC);

--
-- Name: idx_substitute_assignments_orig_teacher; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_substitute_assignments_orig_teacher ON public.substitute_assignments USING btree (original_teacher_id, substitute_date);

--
-- Name: idx_substitute_assignments_sub_teacher; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_substitute_assignments_sub_teacher ON public.substitute_assignments USING btree (substitute_teacher_id, substitute_date);

--
-- Name: idx_teacher_appointment_letters_category; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_teacher_appointment_letters_category ON public.teacher_appointment_letters USING btree (category);

--
-- Name: idx_teacher_appointment_letters_name; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_teacher_appointment_letters_name ON public.teacher_appointment_letters USING btree (name);

--
-- Name: idx_teacher_service_certificates_name; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_teacher_service_certificates_name ON public.teacher_service_certificates USING btree (name);

--
-- Name: idx_teachers_app_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_teachers_app_user_id ON public.teachers USING btree (app_user_id);

--
-- Name: only_one_system_admin_s; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX only_one_system_admin_s ON public.app_users USING btree (role) WHERE (role = 'system_admin_s'::public.user_role);

--
-- Name: period_config_scope_ref_weekday_uk; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX period_config_scope_ref_weekday_uk ON public.period_config USING btree (scope, scope_ref, weekday) WHERE (scope_ref IS NOT NULL);

--
-- Name: period_config_scope_weekday_school_uk; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX period_config_scope_weekday_school_uk ON public.period_config USING btree (scope, weekday) WHERE (scope_ref IS NULL);

--
-- Name: scheduler_backups_year_term_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX scheduler_backups_year_term_idx ON public.scheduler_backups USING btree (academic_year, term, saved_at DESC);

--
-- Name: academic_terms academic_terms_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.academic_terms
    ADD CONSTRAINT academic_terms_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.app_users(id);

--
-- Name: account_audit_log account_audit_log_changed_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.account_audit_log
    ADD CONSTRAINT account_audit_log_changed_by_fkey FOREIGN KEY (changed_by) REFERENCES public.app_users(id);

--
-- Name: account_audit_log account_audit_log_target_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.account_audit_log
    ADD CONSTRAINT account_audit_log_target_user_id_fkey FOREIGN KEY (target_user_id) REFERENCES public.app_users(id) ON DELETE CASCADE;

--
-- Name: admin_module_categories admin_module_categories_updated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admin_module_categories
    ADD CONSTRAINT admin_module_categories_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES public.app_users(id);

--
-- Name: admin_module_order admin_module_order_updated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admin_module_order
    ADD CONSTRAINT admin_module_order_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES public.app_users(id);

--
-- Name: app_user_departments app_user_departments_app_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_user_departments
    ADD CONSTRAINT app_user_departments_app_user_id_fkey FOREIGN KEY (app_user_id) REFERENCES public.app_users(id) ON DELETE CASCADE;

--
-- Name: app_user_departments app_user_departments_granted_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_user_departments
    ADD CONSTRAINT app_user_departments_granted_by_fkey FOREIGN KEY (granted_by) REFERENCES public.app_users(id);

--
-- Name: app_user_module_overrides app_user_module_overrides_app_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_user_module_overrides
    ADD CONSTRAINT app_user_module_overrides_app_user_id_fkey FOREIGN KEY (app_user_id) REFERENCES public.app_users(id) ON DELETE CASCADE;

--
-- Name: app_user_module_overrides app_user_module_overrides_updated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_user_module_overrides
    ADD CONSTRAINT app_user_module_overrides_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES public.app_users(id);

--
-- Name: app_users app_users_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_users
    ADD CONSTRAINT app_users_id_fkey FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;

--
-- Name: attendance_alert_settings attendance_alert_settings_updated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.attendance_alert_settings
    ADD CONSTRAINT attendance_alert_settings_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES public.app_users(id);

--
-- Name: attendance_audit_log attendance_audit_log_attendance_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.attendance_audit_log
    ADD CONSTRAINT attendance_audit_log_attendance_id_fkey FOREIGN KEY (attendance_id) REFERENCES public.attendance(id);

--
-- Name: attendance_audit_log attendance_audit_log_changed_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.attendance_audit_log
    ADD CONSTRAINT attendance_audit_log_changed_by_fkey FOREIGN KEY (changed_by) REFERENCES public.teachers(id);

--
-- Name: attendance_notifications attendance_notifications_decided_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.attendance_notifications
    ADD CONSTRAINT attendance_notifications_decided_by_fkey FOREIGN KEY (decided_by) REFERENCES public.teachers(id);

--
-- Name: attendance_notifications attendance_notifications_student_no_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.attendance_notifications
    ADD CONSTRAINT attendance_notifications_student_no_fkey FOREIGN KEY (student_no) REFERENCES public.students(student_no) ON DELETE CASCADE;

--
-- Name: attendance attendance_recorded_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.attendance
    ADD CONSTRAINT attendance_recorded_by_fkey FOREIGN KEY (recorded_by) REFERENCES public.teachers(id);

--
-- Name: attendance_score_display_settings attendance_score_display_settings_updated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.attendance_score_display_settings
    ADD CONSTRAINT attendance_score_display_settings_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES public.app_users(id);

--
-- Name: attendance attendance_student_no_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.attendance
    ADD CONSTRAINT attendance_student_no_fkey FOREIGN KEY (student_no) REFERENCES public.students(student_no);

--
-- Name: backups backups_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.backups
    ADD CONSTRAINT backups_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.app_users(id);

--
-- Name: backups backups_restored_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.backups
    ADD CONSTRAINT backups_restored_by_fkey FOREIGN KEY (restored_by) REFERENCES public.app_users(id);

--
-- Name: bulletin_posts bulletin_posts_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bulletin_posts
    ADD CONSTRAINT bulletin_posts_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.app_users(id);

--
-- Name: class_schedule class_schedule_class_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.class_schedule
    ADD CONSTRAINT class_schedule_class_id_fkey FOREIGN KEY (class_id) REFERENCES public.classes(id);

--
-- Name: class_schedule class_schedule_teacher_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.class_schedule
    ADD CONSTRAINT class_schedule_teacher_id_fkey FOREIGN KEY (teacher_id) REFERENCES public.teachers(id);

--
-- Name: classes classes_homeroom_teacher_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.classes
    ADD CONSTRAINT classes_homeroom_teacher_id_fkey FOREIGN KEY (homeroom_teacher_id) REFERENCES public.teachers(id);

--
-- Name: clock_day_overrides clock_day_overrides_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.clock_day_overrides
    ADD CONSTRAINT clock_day_overrides_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.app_users(id) ON DELETE SET NULL;

--
-- Name: clock_employee_map clock_employee_map_teacher_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.clock_employee_map
    ADD CONSTRAINT clock_employee_map_teacher_id_fkey FOREIGN KEY (teacher_id) REFERENCES public.teachers(id) ON DELETE SET NULL;

--
-- Name: clock_import_log clock_import_log_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.clock_import_log
    ADD CONSTRAINT clock_import_log_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.app_users(id) ON DELETE SET NULL;

--
-- Name: clock_records clock_records_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.clock_records
    ADD CONSTRAINT clock_records_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.app_users(id) ON DELETE SET NULL;

--
-- Name: clock_records clock_records_voided_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.clock_records
    ADD CONSTRAINT clock_records_voided_by_fkey FOREIGN KEY (voided_by) REFERENCES public.app_users(id) ON DELETE SET NULL;

--
-- Name: club_attendance club_attendance_club_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.club_attendance
    ADD CONSTRAINT club_attendance_club_id_fkey FOREIGN KEY (club_id) REFERENCES public.clubs(id) ON DELETE CASCADE;

--
-- Name: club_attendance club_attendance_recorded_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.club_attendance
    ADD CONSTRAINT club_attendance_recorded_by_fkey FOREIGN KEY (recorded_by) REFERENCES public.teachers(id);

--
-- Name: club_attendance club_attendance_student_no_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.club_attendance
    ADD CONSTRAINT club_attendance_student_no_fkey FOREIGN KEY (student_no) REFERENCES public.students(student_no);

--
-- Name: club_members club_members_club_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.club_members
    ADD CONSTRAINT club_members_club_id_fkey FOREIGN KEY (club_id) REFERENCES public.clubs(id) ON DELETE CASCADE;

--
-- Name: club_members club_members_student_no_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.club_members
    ADD CONSTRAINT club_members_student_no_fkey FOREIGN KEY (student_no) REFERENCES public.students(student_no);

--
-- Name: club_preferences club_preferences_club_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.club_preferences
    ADD CONSTRAINT club_preferences_club_id_fkey FOREIGN KEY (club_id) REFERENCES public.clubs(id) ON DELETE CASCADE;

--
-- Name: club_preferences club_preferences_student_no_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.club_preferences
    ADD CONSTRAINT club_preferences_student_no_fkey FOREIGN KEY (student_no) REFERENCES public.students(student_no);

--
-- Name: club_scores club_scores_club_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.club_scores
    ADD CONSTRAINT club_scores_club_id_fkey FOREIGN KEY (club_id) REFERENCES public.clubs(id) ON DELETE CASCADE;

--
-- Name: club_scores club_scores_recorded_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.club_scores
    ADD CONSTRAINT club_scores_recorded_by_fkey FOREIGN KEY (recorded_by) REFERENCES public.teachers(id);

--
-- Name: club_scores club_scores_student_no_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.club_scores
    ADD CONSTRAINT club_scores_student_no_fkey FOREIGN KEY (student_no) REFERENCES public.students(student_no);

--
-- Name: club_selection_windows club_selection_windows_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.club_selection_windows
    ADD CONSTRAINT club_selection_windows_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.app_users(id);

--
-- Name: clubs clubs_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.clubs
    ADD CONSTRAINT clubs_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.app_users(id);

--
-- Name: clubs clubs_teacher_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.clubs
    ADD CONSTRAINT clubs_teacher_id_fkey FOREIGN KEY (teacher_id) REFERENCES public.teachers(id);

--
-- Name: conduct_event_requests conduct_event_requests_a_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.conduct_event_requests
    ADD CONSTRAINT conduct_event_requests_a_by_fkey FOREIGN KEY (a_by) REFERENCES public.app_users(id);

--
-- Name: conduct_event_requests conduct_event_requests_b_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.conduct_event_requests
    ADD CONSTRAINT conduct_event_requests_b_by_fkey FOREIGN KEY (b_by) REFERENCES public.app_users(id);

--
-- Name: conduct_event_requests conduct_event_requests_conduct_event_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.conduct_event_requests
    ADD CONSTRAINT conduct_event_requests_conduct_event_id_fkey FOREIGN KEY (conduct_event_id) REFERENCES public.conduct_events(id);

--
-- Name: conduct_event_requests conduct_event_requests_requested_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.conduct_event_requests
    ADD CONSTRAINT conduct_event_requests_requested_by_fkey FOREIGN KEY (requested_by) REFERENCES public.app_users(id);

--
-- Name: conduct_event_requests conduct_event_requests_s_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.conduct_event_requests
    ADD CONSTRAINT conduct_event_requests_s_by_fkey FOREIGN KEY (s_by) REFERENCES public.app_users(id);

--
-- Name: conduct_event_requests conduct_event_requests_student_no_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.conduct_event_requests
    ADD CONSTRAINT conduct_event_requests_student_no_fkey FOREIGN KEY (student_no) REFERENCES public.students(student_no);

--
-- Name: conduct_events conduct_events_recorded_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.conduct_events
    ADD CONSTRAINT conduct_events_recorded_by_fkey FOREIGN KEY (recorded_by) REFERENCES public.teachers(id);

--
-- Name: conduct_events conduct_events_student_no_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.conduct_events
    ADD CONSTRAINT conduct_events_student_no_fkey FOREIGN KEY (student_no) REFERENCES public.students(student_no);

--
-- Name: conduct_scores conduct_scores_enrollment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.conduct_scores
    ADD CONSTRAINT conduct_scores_enrollment_id_fkey FOREIGN KEY (enrollment_id) REFERENCES public.enrollments(id);

--
-- Name: conduct_scores conduct_scores_updated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.conduct_scores
    ADD CONSTRAINT conduct_scores_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES public.teachers(id);

--
-- Name: correction_requests correction_requests_requested_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.correction_requests
    ADD CONSTRAINT correction_requests_requested_by_fkey FOREIGN KEY (requested_by) REFERENCES public.teachers(id);

--
-- Name: correction_requests correction_requests_reviewed_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.correction_requests
    ADD CONSTRAINT correction_requests_reviewed_by_fkey FOREIGN KEY (reviewed_by) REFERENCES public.app_users(id);

--
-- Name: enrollments enrollments_class_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.enrollments
    ADD CONSTRAINT enrollments_class_id_fkey FOREIGN KEY (class_id) REFERENCES public.classes(id);

--
-- Name: enrollments enrollments_student_no_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.enrollments
    ADD CONSTRAINT enrollments_student_no_fkey FOREIGN KEY (student_no) REFERENCES public.students(student_no);

--
-- Name: exam_class_roster_status exam_class_roster_status_class_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.exam_class_roster_status
    ADD CONSTRAINT exam_class_roster_status_class_id_fkey FOREIGN KEY (class_id) REFERENCES public.classes(id);

--
-- Name: exam_class_roster_status exam_class_roster_status_exam_session_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.exam_class_roster_status
    ADD CONSTRAINT exam_class_roster_status_exam_session_id_fkey FOREIGN KEY (exam_session_id) REFERENCES public.exam_sessions(id) ON DELETE CASCADE;

--
-- Name: exam_class_roster_status exam_class_roster_status_submitted_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.exam_class_roster_status
    ADD CONSTRAINT exam_class_roster_status_submitted_by_fkey FOREIGN KEY (submitted_by) REFERENCES public.teachers(id);

--
-- Name: exam_room_classes exam_room_classes_class_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.exam_room_classes
    ADD CONSTRAINT exam_room_classes_class_id_fkey FOREIGN KEY (class_id) REFERENCES public.classes(id);

--
-- Name: exam_room_classes exam_room_classes_exam_room_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.exam_room_classes
    ADD CONSTRAINT exam_room_classes_exam_room_id_fkey FOREIGN KEY (exam_room_id) REFERENCES public.exam_rooms(id) ON DELETE CASCADE;

--
-- Name: exam_room_seats exam_room_seats_class_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.exam_room_seats
    ADD CONSTRAINT exam_room_seats_class_id_fkey FOREIGN KEY (class_id) REFERENCES public.classes(id);

--
-- Name: exam_room_seats exam_room_seats_exam_room_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.exam_room_seats
    ADD CONSTRAINT exam_room_seats_exam_room_id_fkey FOREIGN KEY (exam_room_id) REFERENCES public.exam_rooms(id) ON DELETE CASCADE;

--
-- Name: exam_rooms exam_rooms_exam_session_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.exam_rooms
    ADD CONSTRAINT exam_rooms_exam_session_id_fkey FOREIGN KEY (exam_session_id) REFERENCES public.exam_sessions(id) ON DELETE CASCADE;

--
-- Name: exam_seat_students exam_seat_students_exam_room_seat_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.exam_seat_students
    ADD CONSTRAINT exam_seat_students_exam_room_seat_id_fkey FOREIGN KEY (exam_room_seat_id) REFERENCES public.exam_room_seats(id) ON DELETE CASCADE;

--
-- Name: exam_seat_students exam_seat_students_student_no_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.exam_seat_students
    ADD CONSTRAINT exam_seat_students_student_no_fkey FOREIGN KEY (student_no) REFERENCES public.students(student_no);

--
-- Name: exam_seat_students exam_seat_students_updated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.exam_seat_students
    ADD CONSTRAINT exam_seat_students_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES public.teachers(id);

--
-- Name: exam_sessions exam_sessions_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.exam_sessions
    ADD CONSTRAINT exam_sessions_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.app_users(id);

--
-- Name: general_inventory_items general_inventory_items_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.general_inventory_items
    ADD CONSTRAINT general_inventory_items_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.app_users(id);

--
-- Name: general_inventory_transactions general_inventory_transactions_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.general_inventory_transactions
    ADD CONSTRAINT general_inventory_transactions_item_id_fkey FOREIGN KEY (item_id) REFERENCES public.general_inventory_items(id) ON DELETE CASCADE;

--
-- Name: general_inventory_transactions general_inventory_transactions_recorded_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.general_inventory_transactions
    ADD CONSTRAINT general_inventory_transactions_recorded_by_fkey FOREIGN KEY (recorded_by) REFERENCES public.app_users(id);

--
-- Name: guardians guardians_student_no_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.guardians
    ADD CONSTRAINT guardians_student_no_fkey FOREIGN KEY (student_no) REFERENCES public.students(student_no) ON DELETE CASCADE;

--
-- Name: homeroom_attendance_assist_settings homeroom_attendance_assist_settings_updated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.homeroom_attendance_assist_settings
    ADD CONSTRAINT homeroom_attendance_assist_settings_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES public.app_users(id);

--
-- Name: locked_periods locked_periods_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.locked_periods
    ADD CONSTRAINT locked_periods_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.app_users(id);

--
-- Name: maintenance_tickets maintenance_tickets_reported_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.maintenance_tickets
    ADD CONSTRAINT maintenance_tickets_reported_by_fkey FOREIGN KEY (reported_by) REFERENCES public.app_users(id);

--
-- Name: password_policy_settings password_policy_settings_updated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.password_policy_settings
    ADD CONSTRAINT password_policy_settings_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES public.app_users(id);

--
-- Name: pending_changes pending_changes_requested_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pending_changes
    ADD CONSTRAINT pending_changes_requested_by_fkey FOREIGN KEY (requested_by) REFERENCES public.app_users(id);

--
-- Name: pending_changes pending_changes_reviewed_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pending_changes
    ADD CONSTRAINT pending_changes_reviewed_by_fkey FOREIGN KEY (reviewed_by) REFERENCES public.app_users(id);

--
-- Name: pending_changes pending_changes_table_name_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pending_changes
    ADD CONSTRAINT pending_changes_table_name_fkey FOREIGN KEY (table_name) REFERENCES public.governed_tables(table_name);

--
-- Name: portal_accounts portal_accounts_auth_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.portal_accounts
    ADD CONSTRAINT portal_accounts_auth_user_id_fkey FOREIGN KEY (auth_user_id) REFERENCES auth.users(id);

--
-- Name: portal_accounts portal_accounts_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.portal_accounts
    ADD CONSTRAINT portal_accounts_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.app_users(id);

--
-- Name: portal_accounts portal_accounts_student_no_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.portal_accounts
    ADD CONSTRAINT portal_accounts_student_no_fkey FOREIGN KEY (student_no) REFERENCES public.students(student_no) ON DELETE CASCADE;

--
-- Name: portal_login_settings portal_login_settings_updated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.portal_login_settings
    ADD CONSTRAINT portal_login_settings_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES public.app_users(id);

--
-- Name: profile_edit_requests profile_edit_requests_guardian_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profile_edit_requests
    ADD CONSTRAINT profile_edit_requests_guardian_id_fkey FOREIGN KEY (guardian_id) REFERENCES public.guardians(id);

--
-- Name: profile_edit_requests profile_edit_requests_requested_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profile_edit_requests
    ADD CONSTRAINT profile_edit_requests_requested_by_fkey FOREIGN KEY (requested_by) REFERENCES public.portal_accounts(id);

--
-- Name: profile_edit_requests profile_edit_requests_reviewed_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profile_edit_requests
    ADD CONSTRAINT profile_edit_requests_reviewed_by_fkey FOREIGN KEY (reviewed_by) REFERENCES public.app_users(id);

--
-- Name: profile_edit_requests profile_edit_requests_student_no_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profile_edit_requests
    ADD CONSTRAINT profile_edit_requests_student_no_fkey FOREIGN KEY (student_no) REFERENCES public.students(student_no) ON DELETE CASCADE;

--
-- Name: report_card_merge_template report_card_merge_template_updated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.report_card_merge_template
    ADD CONSTRAINT report_card_merge_template_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES public.teachers(id);

--
-- Name: report_card_style report_card_style_updated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.report_card_style
    ADD CONSTRAINT report_card_style_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES public.teachers(id);

--
-- Name: report_card_xlsx_template report_card_xlsx_template_updated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.report_card_xlsx_template
    ADD CONSTRAINT report_card_xlsx_template_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES public.teachers(id);

--
-- Name: scheduler_backups scheduler_backups_saved_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.scheduler_backups
    ADD CONSTRAINT scheduler_backups_saved_by_fkey FOREIGN KEY (saved_by) REFERENCES auth.users(id);

--
-- Name: score_audit_log score_audit_log_changed_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.score_audit_log
    ADD CONSTRAINT score_audit_log_changed_by_fkey FOREIGN KEY (changed_by) REFERENCES public.teachers(id);

--
-- Name: score_audit_log score_audit_log_score_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.score_audit_log
    ADD CONSTRAINT score_audit_log_score_id_fkey FOREIGN KEY (score_id) REFERENCES public.scores(id);

--
-- Name: scores scores_enrollment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.scores
    ADD CONSTRAINT scores_enrollment_id_fkey FOREIGN KEY (enrollment_id) REFERENCES public.enrollments(id);

--
-- Name: scores scores_recorded_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.scores
    ADD CONSTRAINT scores_recorded_by_fkey FOREIGN KEY (recorded_by) REFERENCES public.teachers(id);

--
-- Name: site_content site_content_updated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.site_content
    ADD CONSTRAINT site_content_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES public.app_users(id);

--
-- Name: site_settings site_settings_updated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.site_settings
    ADD CONSTRAINT site_settings_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES public.app_users(id);

--
-- Name: staff_notifications staff_notifications_student_no_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.staff_notifications
    ADD CONSTRAINT staff_notifications_student_no_fkey FOREIGN KEY (student_no) REFERENCES public.students(student_no);

--
-- Name: staff_notifications staff_notifications_teacher_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.staff_notifications
    ADD CONSTRAINT staff_notifications_teacher_id_fkey FOREIGN KEY (teacher_id) REFERENCES public.teachers(id);

--
-- Name: status_change_attachments status_change_attachments_status_change_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.status_change_attachments
    ADD CONSTRAINT status_change_attachments_status_change_id_fkey FOREIGN KEY (status_change_id) REFERENCES public.student_status_changes(id) ON DELETE CASCADE;

--
-- Name: student_remarks student_remarks_enrollment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.student_remarks
    ADD CONSTRAINT student_remarks_enrollment_id_fkey FOREIGN KEY (enrollment_id) REFERENCES public.enrollments(id);

--
-- Name: student_remarks student_remarks_updated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.student_remarks
    ADD CONSTRAINT student_remarks_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES public.teachers(id);

--
-- Name: student_status_changes student_status_changes_changed_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.student_status_changes
    ADD CONSTRAINT student_status_changes_changed_by_fkey FOREIGN KEY (changed_by) REFERENCES public.app_users(id);

--
-- Name: student_status_changes student_status_changes_student_no_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.student_status_changes
    ADD CONSTRAINT student_status_changes_student_no_fkey FOREIGN KEY (student_no) REFERENCES public.students(student_no) ON DELETE CASCADE;

--
-- Name: students students_updated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.students
    ADD CONSTRAINT students_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES public.app_users(id);

--
-- Name: submission_window_audit_log submission_window_audit_log_changed_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.submission_window_audit_log
    ADD CONSTRAINT submission_window_audit_log_changed_by_fkey FOREIGN KEY (changed_by) REFERENCES public.app_users(id);

--
-- Name: submission_window_audit_log submission_window_audit_log_window_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.submission_window_audit_log
    ADD CONSTRAINT submission_window_audit_log_window_id_fkey FOREIGN KEY (window_id) REFERENCES public.submission_windows(id) ON DELETE SET NULL;

--
-- Name: submission_windows submission_windows_set_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.submission_windows
    ADD CONSTRAINT submission_windows_set_by_fkey FOREIGN KEY (set_by) REFERENCES public.app_users(id);

--
-- Name: substitute_assignments substitute_assignments_class_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.substitute_assignments
    ADD CONSTRAINT substitute_assignments_class_id_fkey FOREIGN KEY (class_id) REFERENCES public.classes(id);

--
-- Name: substitute_assignments substitute_assignments_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.substitute_assignments
    ADD CONSTRAINT substitute_assignments_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.app_users(id);

--
-- Name: substitute_assignments substitute_assignments_original_teacher_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.substitute_assignments
    ADD CONSTRAINT substitute_assignments_original_teacher_id_fkey FOREIGN KEY (original_teacher_id) REFERENCES public.teachers(id);

--
-- Name: substitute_assignments substitute_assignments_substitute_teacher_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.substitute_assignments
    ADD CONSTRAINT substitute_assignments_substitute_teacher_id_fkey FOREIGN KEY (substitute_teacher_id) REFERENCES public.teachers(id);

--
-- Name: teacher_appointment_letters teacher_appointment_letters_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.teacher_appointment_letters
    ADD CONSTRAINT teacher_appointment_letters_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.app_users(id);

--
-- Name: teacher_letter_settings teacher_letter_settings_updated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.teacher_letter_settings
    ADD CONSTRAINT teacher_letter_settings_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES public.app_users(id);

--
-- Name: teacher_login_settings teacher_login_settings_updated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.teacher_login_settings
    ADD CONSTRAINT teacher_login_settings_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES public.app_users(id);

--
-- Name: teacher_service_certificates teacher_service_certificates_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.teacher_service_certificates
    ADD CONSTRAINT teacher_service_certificates_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.app_users(id);

--
-- Name: teachers teachers_app_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.teachers
    ADD CONSTRAINT teachers_app_user_id_fkey FOREIGN KEY (app_user_id) REFERENCES public.app_users(id);

--
-- Name: utility_bills utility_bills_recorded_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.utility_bills
    ADD CONSTRAINT utility_bills_recorded_by_fkey FOREIGN KEY (recorded_by) REFERENCES public.app_users(id);
