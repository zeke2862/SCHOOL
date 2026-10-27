// ============================================================
// ⚠ 這個檔案是自動產生的，請不要手動修改。
// 來源：sql/01_schema.sql ＋ sql/02_constraints_indexes.sql
// 產生方式：python3 tools/gen-table-defs.py
// 用途：「四部門 Excel 一鍵下載／上傳」要知道每張資料表有哪些欄位、主鍵是什麼、
//       誰是父層（要先匯入）。資料庫結構有改動時，重新執行上面的指令即可。
// ============================================================

export type ColType = 'uuid' | 'text' | 'int' | 'num' | 'bool' | 'date' | 'ts' | 'json' | 'array' | 'bytes';
export type DeptKey = 'academic' | 'discipline' | 'general' | 'dev';
export type TableMode = 'normal' | 'export' | 'skip';

export type ColDef = { name: string; type: ColType; notNull: boolean; hasDefault: boolean };
export type TableDef = {
  table: string;
  sheet: string; // Excel 工作表名稱（最多 31 字）
  label: string; // 中文說明
  dept: DeptKey;
  mode: TableMode; // normal=可下載可上傳；export=只下載；skip=不放進 Excel
  order: number; // 外鍵排序：數字小的先匯入
  pk: string[];
  uniques: string[][];
  cols: ColDef[];
};

export const TABLE_DEFS: TableDef[] = [
 {
  "table": "app_users",
  "sheet": "app_users",
  "label": "登入帳號名單（信箱僅供參考）",
  "dept": "dev",
  "mode": "export",
  "order": 0,
  "pk": [
   "id"
  ],
  "uniques": [],
  "cols": [
   {
    "name": "id",
    "type": "uuid",
    "notNull": true,
    "hasDefault": false
   },
   {
    "name": "name",
    "type": "text",
    "notNull": true,
    "hasDefault": false
   },
   {
    "name": "role",
    "type": "text",
    "notNull": true,
    "hasDefault": false
   },
   {
    "name": "created_at",
    "type": "ts",
    "notNull": true,
    "hasDefault": true
   },
   {
    "name": "must_change_password",
    "type": "bool",
    "notNull": true,
    "hasDefault": true
   }
  ]
 },
 {
  "table": "academic_terms",
  "sheet": "academic_terms",
  "label": "學年學期主檔",
  "dept": "academic",
  "mode": "normal",
  "order": 1,
  "pk": [
   "id"
  ],
  "uniques": [
   [
    "academic_year",
    "term"
   ]
  ],
  "cols": [
   {
    "name": "id",
    "type": "uuid",
    "notNull": true,
    "hasDefault": true
   },
   {
    "name": "academic_year",
    "type": "int",
    "notNull": true,
    "hasDefault": false
   },
   {
    "name": "term",
    "type": "text",
    "notNull": true,
    "hasDefault": false
   },
   {
    "name": "term_start_date",
    "type": "date",
    "notNull": false,
    "hasDefault": false
   },
   {
    "name": "term_end_date",
    "type": "date",
    "notNull": false,
    "hasDefault": false
   },
   {
    "name": "is_current",
    "type": "bool",
    "notNull": true,
    "hasDefault": true
   },
   {
    "name": "status",
    "type": "text",
    "notNull": true,
    "hasDefault": true
   },
   {
    "name": "created_by",
    "type": "uuid",
    "notNull": false,
    "hasDefault": false
   },
   {
    "name": "created_at",
    "type": "ts",
    "notNull": true,
    "hasDefault": true
   }
  ]
 },
 {
  "table": "account_audit_log",
  "sheet": "account_audit_log",
  "label": "帳號異動紀錄",
  "dept": "dev",
  "mode": "export",
  "order": 2,
  "pk": [
   "id"
  ],
  "uniques": [],
  "cols": [
   {
    "name": "id",
    "type": "uuid",
    "notNull": true,
    "hasDefault": true
   },
   {
    "name": "target_user_id",
    "type": "uuid",
    "notNull": true,
    "hasDefault": false
   },
   {
    "name": "action",
    "type": "text",
    "notNull": true,
    "hasDefault": false
   },
   {
    "name": "old_value",
    "type": "text",
    "notNull": false,
    "hasDefault": false
   },
   {
    "name": "new_value",
    "type": "text",
    "notNull": false,
    "hasDefault": false
   },
   {
    "name": "changed_by",
    "type": "uuid",
    "notNull": false,
    "hasDefault": false
   },
   {
    "name": "changed_at",
    "type": "ts",
    "notNull": true,
    "hasDefault": true
   }
  ]
 },
 {
  "table": "admin_module_categories",
  "sheet": "admin_module_categories",
  "label": "功能卡片分類",
  "dept": "dev",
  "mode": "normal",
  "order": 3,
  "pk": [
   "id"
  ],
  "uniques": [
   [
    "module_key",
    "category"
   ]
  ],
  "cols": [
   {
    "name": "module_key",
    "type": "text",
    "notNull": true,
    "hasDefault": false
   },
   {
    "name": "category",
    "type": "text",
    "notNull": true,
    "hasDefault": false
   },
   {
    "name": "updated_by",
    "type": "uuid",
    "notNull": false,
    "hasDefault": false
   },
   {
    "name": "updated_at",
    "type": "ts",
    "notNull": true,
    "hasDefault": true
   },
   {
    "name": "id",
    "type": "uuid",
    "notNull": true,
    "hasDefault": true
   }
  ]
 },
 {
  "table": "admin_module_order",
  "sheet": "admin_module_order",
  "label": "功能卡片排序",
  "dept": "dev",
  "mode": "normal",
  "order": 4,
  "pk": [
   "module_key"
  ],
  "uniques": [],
  "cols": [
   {
    "name": "module_key",
    "type": "text",
    "notNull": true,
    "hasDefault": false
   },
   {
    "name": "sort_order",
    "type": "int",
    "notNull": true,
    "hasDefault": false
   },
   {
    "name": "updated_by",
    "type": "uuid",
    "notNull": false,
    "hasDefault": false
   },
   {
    "name": "updated_at",
    "type": "ts",
    "notNull": true,
    "hasDefault": true
   }
  ]
 },
 {
  "table": "app_user_departments",
  "sheet": "app_user_departments",
  "label": "部門職務指派",
  "dept": "dev",
  "mode": "normal",
  "order": 5,
  "pk": [
   "id"
  ],
  "uniques": [
   [
    "app_user_id",
    "department"
   ]
  ],
  "cols": [
   {
    "name": "id",
    "type": "uuid",
    "notNull": true,
    "hasDefault": true
   },
   {
    "name": "app_user_id",
    "type": "uuid",
    "notNull": true,
    "hasDefault": false
   },
   {
    "name": "department",
    "type": "text",
    "notNull": true,
    "hasDefault": false
   },
   {
    "name": "level",
    "type": "text",
    "notNull": true,
    "hasDefault": true
   },
   {
    "name": "granted_by",
    "type": "uuid",
    "notNull": false,
    "hasDefault": false
   },
   {
    "name": "granted_at",
    "type": "ts",
    "notNull": true,
    "hasDefault": true
   }
  ]
 },
 {
  "table": "app_user_module_overrides",
  "sheet": "app_user_module_overrides",
  "label": "帳號個別可見功能",
  "dept": "dev",
  "mode": "normal",
  "order": 6,
  "pk": [
   "id"
  ],
  "uniques": [
   [
    "app_user_id",
    "module_key"
   ]
  ],
  "cols": [
   {
    "name": "id",
    "type": "uuid",
    "notNull": true,
    "hasDefault": true
   },
   {
    "name": "app_user_id",
    "type": "uuid",
    "notNull": true,
    "hasDefault": false
   },
   {
    "name": "module_key",
    "type": "text",
    "notNull": true,
    "hasDefault": false
   },
   {
    "name": "visible",
    "type": "bool",
    "notNull": true,
    "hasDefault": false
   },
   {
    "name": "updated_by",
    "type": "uuid",
    "notNull": false,
    "hasDefault": false
   },
   {
    "name": "updated_at",
    "type": "ts",
    "notNull": true,
    "hasDefault": true
   }
  ]
 },
 {
  "table": "students",
  "sheet": "students",
  "label": "學生基本資料",
  "dept": "academic",
  "mode": "normal",
  "order": 7,
  "pk": [
   "student_no"
  ],
  "uniques": [],
  "cols": [
   {
    "name": "student_no",
    "type": "text",
    "notNull": true,
    "hasDefault": false
   },
   {
    "name": "name",
    "type": "text",
    "notNull": true,
    "hasDefault": false
   },
   {
    "name": "gender",
    "type": "text",
    "notNull": false,
    "hasDefault": false
   },
   {
    "name": "thai_name",
    "type": "text",
    "notNull": false,
    "hasDefault": false
   },
   {
    "name": "dob",
    "type": "date",
    "notNull": false,
    "hasDefault": false
   },
   {
    "name": "id_number",
    "type": "text",
    "notNull": false,
    "hasDefault": false
   },
   {
    "name": "nationality",
    "type": "text",
    "notNull": false,
    "hasDefault": false
   },
   {
    "name": "religion",
    "type": "text",
    "notNull": false,
    "hasDefault": false
   },
   {
    "name": "blood_type",
    "type": "text",
    "notNull": false,
    "hasDefault": false
   },
   {
    "name": "address",
    "type": "text",
    "notNull": false,
    "hasDefault": false
   },
   {
    "name": "phone",
    "type": "text",
    "notNull": false,
    "hasDefault": false
   },
   {
    "name": "photo_url",
    "type": "text",
    "notNull": false,
    "hasDefault": false
   },
   {
    "name": "previous_school",
    "type": "text",
    "notNull": false,
    "hasDefault": false
   },
   {
    "name": "previous_school_grade",
    "type": "text",
    "notNull": false,
    "hasDefault": false
   },
   {
    "name": "updated_at",
    "type": "ts",
    "notNull": false,
    "hasDefault": false
   },
   {
    "name": "updated_by",
    "type": "uuid",
    "notNull": false,
    "hasDefault": false
   }
  ]
 },
 {
  "table": "teachers",
  "sheet": "teachers",
  "label": "教師名單",
  "dept": "academic",
  "mode": "normal",
  "order": 8,
  "pk": [
   "id"
  ],
  "uniques": [],
  "cols": [
   {
    "name": "id",
    "type": "uuid",
    "notNull": true,
    "hasDefault": true
   },
   {
    "name": "app_user_id",
    "type": "uuid",
    "notNull": false,
    "hasDefault": false
   },
   {
    "name": "name",
    "type": "text",
    "notNull": true,
    "hasDefault": false
   }
  ]
 },
 {
  "table": "attendance",
  "sheet": "attendance",
  "label": "學生出缺勤紀錄",
  "dept": "discipline",
  "mode": "normal",
  "order": 9,
  "pk": [
   "id"
  ],
  "uniques": [
   [
    "student_no",
    "record_date",
    "period_no"
   ]
  ],
  "cols": [
   {
    "name": "id",
    "type": "uuid",
    "notNull": true,
    "hasDefault": true
   },
   {
    "name": "student_no",
    "type": "text",
    "notNull": true,
    "hasDefault": false
   },
   {
    "name": "record_date",
    "type": "date",
    "notNull": true,
    "hasDefault": false
   },
   {
    "name": "period_no",
    "type": "int",
    "notNull": true,
    "hasDefault": false
   },
   {
    "name": "status",
    "type": "text",
    "notNull": true,
    "hasDefault": true
   },
   {
    "name": "recorded_by",
    "type": "uuid",
    "notNull": false,
    "hasDefault": false
   },
   {
    "name": "updated_at",
    "type": "ts",
    "notNull": true,
    "hasDefault": true
   }
  ]
 },
 {
  "table": "attendance_roll_calls",
  "sheet": "attendance_roll_calls",
  "label": "點名完成紀錄（每班每天每節一筆；有點名＋沒有非出席紀錄＝全員出席）",
  "dept": "discipline",
  "mode": "normal",
  "order": 9,
  "pk": [
   "id"
  ],
  "uniques": [
   [
    "class_id",
    "record_date",
    "period_no"
   ]
  ],
  "cols": [
   {
    "name": "id",
    "type": "uuid",
    "notNull": true,
    "hasDefault": true
   },
   {
    "name": "class_id",
    "type": "uuid",
    "notNull": true,
    "hasDefault": false
   },
   {
    "name": "record_date",
    "type": "date",
    "notNull": true,
    "hasDefault": false
   },
   {
    "name": "period_no",
    "type": "int",
    "notNull": true,
    "hasDefault": false
   },
   {
    "name": "recorded_by",
    "type": "uuid",
    "notNull": false,
    "hasDefault": false
   },
   {
    "name": "first_recorded_at",
    "type": "ts",
    "notNull": true,
    "hasDefault": true
   },
   {
    "name": "last_recorded_at",
    "type": "ts",
    "notNull": true,
    "hasDefault": true
   }
  ]
 },
 {
  "table": "attendance_alert_settings",
  "sheet": "attendance_alert_settings",
  "label": "出缺席示警門檻設定",
  "dept": "discipline",
  "mode": "normal",
  "order": 10,
  "pk": [
   "id"
  ],
  "uniques": [],
  "cols": [
   {
    "name": "id",
    "type": "int",
    "notNull": true,
    "hasDefault": true
   },
   {
    "name": "threshold_periods",
    "type": "int",
    "notNull": true,
    "hasDefault": true
   },
   {
    "name": "updated_by",
    "type": "uuid",
    "notNull": false,
    "hasDefault": false
   },
   {
    "name": "updated_at",
    "type": "ts",
    "notNull": true,
    "hasDefault": true
   },
   {
    "name": "exam_deduction_absence_threshold",
    "type": "int",
    "notNull": false,
    "hasDefault": false
   },
   {
    "name": "backfill_overdue_days",
    "type": "int",
    "notNull": true,
    "hasDefault": true
   }
  ]
 },
 {
  "table": "attendance_audit_log",
  "sheet": "attendance_audit_log",
  "label": "出缺勤修改稽核紀錄",
  "dept": "discipline",
  "mode": "export",
  "order": 11,
  "pk": [
   "id"
  ],
  "uniques": [],
  "cols": [
   {
    "name": "id",
    "type": "uuid",
    "notNull": true,
    "hasDefault": true
   },
   {
    "name": "attendance_id",
    "type": "uuid",
    "notNull": true,
    "hasDefault": false
   },
   {
    "name": "changed_by",
    "type": "uuid",
    "notNull": false,
    "hasDefault": false
   },
   {
    "name": "changed_at",
    "type": "ts",
    "notNull": true,
    "hasDefault": true
   },
   {
    "name": "old_value",
    "type": "text",
    "notNull": false,
    "hasDefault": false
   },
   {
    "name": "new_value",
    "type": "text",
    "notNull": false,
    "hasDefault": false
   }
  ]
 },
 {
  "table": "attendance_notifications",
  "sheet": "attendance_notifications",
  "label": "出缺席示警通知決定紀錄",
  "dept": "discipline",
  "mode": "normal",
  "order": 12,
  "pk": [
   "id"
  ],
  "uniques": [],
  "cols": [
   {
    "name": "id",
    "type": "uuid",
    "notNull": true,
    "hasDefault": true
   },
   {
    "name": "student_no",
    "type": "text",
    "notNull": true,
    "hasDefault": false
   },
   {
    "name": "absence_count",
    "type": "int",
    "notNull": true,
    "hasDefault": false
   },
   {
    "name": "threshold_snapshot",
    "type": "int",
    "notNull": true,
    "hasDefault": false
   },
   {
    "name": "decision",
    "type": "text",
    "notNull": true,
    "hasDefault": false
   },
   {
    "name": "note",
    "type": "text",
    "notNull": false,
    "hasDefault": false
   },
   {
    "name": "decided_by",
    "type": "uuid",
    "notNull": false,
    "hasDefault": false
   },
   {
    "name": "created_at",
    "type": "ts",
    "notNull": true,
    "hasDefault": true
   }
  ]
 },
 {
  "table": "attendance_score_display_settings",
  "sheet": "attendance_score_disp_settings",
  "label": "出缺席分數顯示設定",
  "dept": "discipline",
  "mode": "normal",
  "order": 13,
  "pk": [
   "id"
  ],
  "uniques": [],
  "cols": [
   {
    "name": "id",
    "type": "bool",
    "notNull": true,
    "hasDefault": true
   },
   {
    "name": "exclude_attendance_from_partial_scores",
    "type": "bool",
    "notNull": true,
    "hasDefault": true
   },
   {
    "name": "updated_by",
    "type": "uuid",
    "notNull": false,
    "hasDefault": false
   },
   {
    "name": "updated_at",
    "type": "ts",
    "notNull": true,
    "hasDefault": true
   }
  ]
 },
 {
  "table": "backups",
  "sheet": "backups",
  "label": "系統備份紀錄（請到備份與還原頁處理）",
  "dept": "dev",
  "mode": "skip",
  "order": 14,
  "pk": [
   "id"
  ],
  "uniques": [],
  "cols": [
   {
    "name": "id",
    "type": "uuid",
    "notNull": true,
    "hasDefault": true
   },
   {
    "name": "created_at",
    "type": "ts",
    "notNull": true,
    "hasDefault": true
   },
   {
    "name": "created_by",
    "type": "uuid",
    "notNull": false,
    "hasDefault": false
   },
   {
    "name": "kind",
    "type": "text",
    "notNull": true,
    "hasDefault": false
   },
   {
    "name": "tables",
    "type": "json",
    "notNull": false,
    "hasDefault": false
   },
   {
    "name": "table_counts",
    "type": "json",
    "notNull": true,
    "hasDefault": false
   },
   {
    "name": "restored_at",
    "type": "ts",
    "notNull": false,
    "hasDefault": false
   },
   {
    "name": "restored_by",
    "type": "uuid",
    "notNull": false,
    "hasDefault": false
   },
   {
    "name": "storage_path",
    "type": "text",
    "notNull": false,
    "hasDefault": false
   }
  ]
 },
 {
  "table": "bulletin_posts",
  "sheet": "bulletin_posts",
  "label": "公佈欄貼文",
  "dept": "dev",
  "mode": "normal",
  "order": 15,
  "pk": [
   "id"
  ],
  "uniques": [],
  "cols": [
   {
    "name": "id",
    "type": "uuid",
    "notNull": true,
    "hasDefault": true
   },
   {
    "name": "title",
    "type": "text",
    "notNull": true,
    "hasDefault": false
   },
   {
    "name": "thumbnail_url",
    "type": "text",
    "notNull": false,
    "hasDefault": false
   },
   {
    "name": "content",
    "type": "text",
    "notNull": true,
    "hasDefault": true
   },
   {
    "name": "is_published",
    "type": "bool",
    "notNull": true,
    "hasDefault": true
   },
   {
    "name": "published_at",
    "type": "ts",
    "notNull": false,
    "hasDefault": false
   },
   {
    "name": "created_by",
    "type": "uuid",
    "notNull": false,
    "hasDefault": false
   },
   {
    "name": "created_at",
    "type": "ts",
    "notNull": true,
    "hasDefault": true
   },
   {
    "name": "updated_at",
    "type": "ts",
    "notNull": true,
    "hasDefault": true
   }
  ]
 },
 {
  "table": "classes",
  "sheet": "classes",
  "label": "班級與導師",
  "dept": "academic",
  "mode": "normal",
  "order": 16,
  "pk": [
   "id"
  ],
  "uniques": [
   [
    "academic_year",
    "department",
    "grade_level",
    "class_name"
   ]
  ],
  "cols": [
   {
    "name": "id",
    "type": "uuid",
    "notNull": true,
    "hasDefault": true
   },
   {
    "name": "class_name",
    "type": "text",
    "notNull": true,
    "hasDefault": false
   },
   {
    "name": "academic_year",
    "type": "int",
    "notNull": true,
    "hasDefault": false
   },
   {
    "name": "department",
    "type": "text",
    "notNull": true,
    "hasDefault": false
   },
   {
    "name": "grade_level",
    "type": "text",
    "notNull": true,
    "hasDefault": false
   },
   {
    "name": "homeroom_teacher_id",
    "type": "uuid",
    "notNull": false,
    "hasDefault": false
   }
  ]
 },
 {
  "table": "class_schedule",
  "sheet": "class_schedule",
  "label": "課表與任課教師",
  "dept": "academic",
  "mode": "normal",
  "order": 17,
  "pk": [
   "id"
  ],
  "uniques": [
   [
    "class_id",
    "academic_year",
    "term",
    "weekday",
    "period_no"
   ]
  ],
  "cols": [
   {
    "name": "id",
    "type": "uuid",
    "notNull": true,
    "hasDefault": true
   },
   {
    "name": "class_id",
    "type": "uuid",
    "notNull": true,
    "hasDefault": false
   },
   {
    "name": "academic_year",
    "type": "int",
    "notNull": true,
    "hasDefault": false
   },
   {
    "name": "term",
    "type": "text",
    "notNull": true,
    "hasDefault": false
   },
   {
    "name": "weekday",
    "type": "int",
    "notNull": false,
    "hasDefault": false
   },
   {
    "name": "period_no",
    "type": "int",
    "notNull": false,
    "hasDefault": false
   },
   {
    "name": "subject",
    "type": "text",
    "notNull": true,
    "hasDefault": false
   },
   {
    "name": "teacher_id",
    "type": "uuid",
    "notNull": true,
    "hasDefault": false
   }
  ]
 },
 {
  "table": "clock_day_overrides",
  "sheet": "clock_day_overrides",
  "label": "補卡／當日更正",
  "dept": "academic",
  "mode": "normal",
  "order": 18,
  "pk": [
   "id"
  ],
  "uniques": [
   [
    "device_code",
    "punch_date"
   ]
  ],
  "cols": [
   {
    "name": "id",
    "type": "uuid",
    "notNull": true,
    "hasDefault": true
   },
   {
    "name": "device_code",
    "type": "int",
    "notNull": true,
    "hasDefault": false
   },
   {
    "name": "punch_date",
    "type": "date",
    "notNull": true,
    "hasDefault": false
   },
   {
    "name": "status",
    "type": "text",
    "notNull": true,
    "hasDefault": false
   },
   {
    "name": "note",
    "type": "text",
    "notNull": false,
    "hasDefault": false
   },
   {
    "name": "created_by",
    "type": "uuid",
    "notNull": false,
    "hasDefault": false
   },
   {
    "name": "created_at",
    "type": "ts",
    "notNull": true,
    "hasDefault": true
   }
  ]
 },
 {
  "table": "clock_employee_map",
  "sheet": "clock_employee_map",
  "label": "打卡機代碼與教師對照",
  "dept": "academic",
  "mode": "normal",
  "order": 19,
  "pk": [
   "device_code"
  ],
  "uniques": [],
  "cols": [
   {
    "name": "device_code",
    "type": "int",
    "notNull": true,
    "hasDefault": false
   },
   {
    "name": "device_name",
    "type": "text",
    "notNull": true,
    "hasDefault": false
   },
   {
    "name": "display_name",
    "type": "text",
    "notNull": false,
    "hasDefault": false
   },
   {
    "name": "teacher_id",
    "type": "uuid",
    "notNull": false,
    "hasDefault": false
   },
   {
    "name": "shift_ids",
    "type": "array",
    "notNull": true,
    "hasDefault": true
   },
   {
    "name": "active",
    "type": "bool",
    "notNull": true,
    "hasDefault": true
   },
   {
    "name": "note",
    "type": "text",
    "notNull": false,
    "hasDefault": false
   },
   {
    "name": "created_at",
    "type": "ts",
    "notNull": true,
    "hasDefault": true
   }
  ]
 },
 {
  "table": "clock_holidays",
  "sheet": "clock_holidays",
  "label": "打卡放假日",
  "dept": "academic",
  "mode": "normal",
  "order": 20,
  "pk": [
   "holiday_date"
  ],
  "uniques": [],
  "cols": [
   {
    "name": "holiday_date",
    "type": "date",
    "notNull": true,
    "hasDefault": false
   },
   {
    "name": "name",
    "type": "text",
    "notNull": true,
    "hasDefault": true
   },
   {
    "name": "created_at",
    "type": "ts",
    "notNull": true,
    "hasDefault": true
   }
  ]
 },
 {
  "table": "clock_import_log",
  "sheet": "clock_import_log",
  "label": "打卡匯入流水帳",
  "dept": "academic",
  "mode": "export",
  "order": 21,
  "pk": [
   "id"
  ],
  "uniques": [],
  "cols": [
   {
    "name": "id",
    "type": "uuid",
    "notNull": true,
    "hasDefault": true
   },
   {
    "name": "created_at",
    "type": "ts",
    "notNull": true,
    "hasDefault": true
   },
   {
    "name": "source",
    "type": "text",
    "notNull": true,
    "hasDefault": false
   },
   {
    "name": "file_name",
    "type": "text",
    "notNull": false,
    "hasDefault": false
   },
   {
    "name": "rows_received",
    "type": "int",
    "notNull": true,
    "hasDefault": true
   },
   {
    "name": "rows_inserted",
    "type": "int",
    "notNull": true,
    "hasDefault": true
   },
   {
    "name": "rows_duplicate",
    "type": "int",
    "notNull": true,
    "hasDefault": true
   },
   {
    "name": "rows_invalid",
    "type": "int",
    "notNull": true,
    "hasDefault": true
   },
   {
    "name": "new_codes",
    "type": "array",
    "notNull": true,
    "hasDefault": true
   },
   {
    "name": "first_punch",
    "type": "ts",
    "notNull": false,
    "hasDefault": false
   },
   {
    "name": "last_punch",
    "type": "ts",
    "notNull": false,
    "hasDefault": false
   },
   {
    "name": "created_by",
    "type": "uuid",
    "notNull": false,
    "hasDefault": false
   },
   {
    "name": "error",
    "type": "text",
    "notNull": false,
    "hasDefault": false
   }
  ]
 },
 {
  "table": "clock_records",
  "sheet": "clock_records",
  "label": "教職員打卡原始紀錄",
  "dept": "academic",
  "mode": "normal",
  "order": 22,
  "pk": [
   "id"
  ],
  "uniques": [
   [
    "device_code",
    "punched_at",
    "machine_no"
   ]
  ],
  "cols": [
   {
    "name": "id",
    "type": "uuid",
    "notNull": true,
    "hasDefault": true
   },
   {
    "name": "device_code",
    "type": "int",
    "notNull": true,
    "hasDefault": false
   },
   {
    "name": "device_name",
    "type": "text",
    "notNull": false,
    "hasDefault": false
   },
   {
    "name": "punched_at",
    "type": "ts",
    "notNull": true,
    "hasDefault": false
   },
   {
    "name": "punch_date",
    "type": "date",
    "notNull": true,
    "hasDefault": false
   },
   {
    "name": "direction",
    "type": "text",
    "notNull": false,
    "hasDefault": false
   },
   {
    "name": "machine_no",
    "type": "int",
    "notNull": true,
    "hasDefault": true
   },
   {
    "name": "method",
    "type": "text",
    "notNull": false,
    "hasDefault": false
   },
   {
    "name": "source",
    "type": "text",
    "notNull": true,
    "hasDefault": true
   },
   {
    "name": "voided",
    "type": "bool",
    "notNull": true,
    "hasDefault": true
   },
   {
    "name": "voided_reason",
    "type": "text",
    "notNull": false,
    "hasDefault": false
   },
   {
    "name": "voided_by",
    "type": "uuid",
    "notNull": false,
    "hasDefault": false
   },
   {
    "name": "voided_at",
    "type": "ts",
    "notNull": false,
    "hasDefault": false
   },
   {
    "name": "note",
    "type": "text",
    "notNull": false,
    "hasDefault": false
   },
   {
    "name": "created_by",
    "type": "uuid",
    "notNull": false,
    "hasDefault": false
   },
   {
    "name": "created_at",
    "type": "ts",
    "notNull": true,
    "hasDefault": true
   }
  ]
 },
 {
  "table": "clock_shifts",
  "sheet": "clock_shifts",
  "label": "打卡班別",
  "dept": "academic",
  "mode": "normal",
  "order": 23,
  "pk": [
   "id"
  ],
  "uniques": [],
  "cols": [
   {
    "name": "id",
    "type": "uuid",
    "notNull": true,
    "hasDefault": true
   },
   {
    "name": "name",
    "type": "text",
    "notNull": true,
    "hasDefault": false
   },
   {
    "name": "start_time",
    "type": "text",
    "notNull": true,
    "hasDefault": false
   },
   {
    "name": "end_time",
    "type": "text",
    "notNull": true,
    "hasDefault": false
   },
   {
    "name": "late_grace_min",
    "type": "int",
    "notNull": true,
    "hasDefault": true
   },
   {
    "name": "early_grace_min",
    "type": "int",
    "notNull": true,
    "hasDefault": true
   },
   {
    "name": "work_days",
    "type": "array",
    "notNull": true,
    "hasDefault": true
   },
   {
    "name": "window_before_min",
    "type": "int",
    "notNull": true,
    "hasDefault": true
   },
   {
    "name": "window_after_min",
    "type": "int",
    "notNull": true,
    "hasDefault": true
   },
   {
    "name": "active",
    "type": "bool",
    "notNull": true,
    "hasDefault": true
   },
   {
    "name": "sort_order",
    "type": "int",
    "notNull": true,
    "hasDefault": true
   },
   {
    "name": "created_at",
    "type": "ts",
    "notNull": true,
    "hasDefault": true
   }
  ]
 },
 {
  "table": "clubs",
  "sheet": "clubs",
  "label": "社團／才藝課",
  "dept": "academic",
  "mode": "normal",
  "order": 24,
  "pk": [
   "id"
  ],
  "uniques": [
   [
    "name",
    "academic_year",
    "term"
   ]
  ],
  "cols": [
   {
    "name": "id",
    "type": "uuid",
    "notNull": true,
    "hasDefault": true
   },
   {
    "name": "name",
    "type": "text",
    "notNull": true,
    "hasDefault": false
   },
   {
    "name": "academic_year",
    "type": "int",
    "notNull": true,
    "hasDefault": false
   },
   {
    "name": "term",
    "type": "text",
    "notNull": true,
    "hasDefault": false
   },
   {
    "name": "teacher_id",
    "type": "uuid",
    "notNull": false,
    "hasDefault": false
   },
   {
    "name": "external_teacher_name",
    "type": "text",
    "notNull": false,
    "hasDefault": false
   },
   {
    "name": "capacity",
    "type": "int",
    "notNull": false,
    "hasDefault": false
   },
   {
    "name": "period_no",
    "type": "int",
    "notNull": false,
    "hasDefault": false
   },
   {
    "name": "description",
    "type": "text",
    "notNull": false,
    "hasDefault": false
   },
   {
    "name": "is_active",
    "type": "bool",
    "notNull": true,
    "hasDefault": true
   },
   {
    "name": "created_by",
    "type": "uuid",
    "notNull": false,
    "hasDefault": false
   },
   {
    "name": "created_at",
    "type": "ts",
    "notNull": true,
    "hasDefault": true
   }
  ]
 },
 {
  "table": "club_attendance",
  "sheet": "club_attendance",
  "label": "社團點名",
  "dept": "academic",
  "mode": "normal",
  "order": 25,
  "pk": [
   "id"
  ],
  "uniques": [
   [
    "club_id",
    "student_no",
    "record_date"
   ]
  ],
  "cols": [
   {
    "name": "id",
    "type": "uuid",
    "notNull": true,
    "hasDefault": true
   },
   {
    "name": "club_id",
    "type": "uuid",
    "notNull": true,
    "hasDefault": false
   },
   {
    "name": "student_no",
    "type": "text",
    "notNull": true,
    "hasDefault": false
   },
   {
    "name": "record_date",
    "type": "date",
    "notNull": true,
    "hasDefault": false
   },
   {
    "name": "status",
    "type": "text",
    "notNull": true,
    "hasDefault": true
   },
   {
    "name": "recorded_by",
    "type": "uuid",
    "notNull": false,
    "hasDefault": false
   },
   {
    "name": "updated_at",
    "type": "ts",
    "notNull": true,
    "hasDefault": true
   }
  ]
 },
 {
  "table": "club_members",
  "sheet": "club_members",
  "label": "社團成員",
  "dept": "academic",
  "mode": "normal",
  "order": 26,
  "pk": [
   "id"
  ],
  "uniques": [
   [
    "club_id",
    "student_no"
   ]
  ],
  "cols": [
   {
    "name": "id",
    "type": "uuid",
    "notNull": true,
    "hasDefault": true
   },
   {
    "name": "club_id",
    "type": "uuid",
    "notNull": true,
    "hasDefault": false
   },
   {
    "name": "student_no",
    "type": "text",
    "notNull": true,
    "hasDefault": false
   },
   {
    "name": "status",
    "type": "text",
    "notNull": true,
    "hasDefault": true
   },
   {
    "name": "joined_at",
    "type": "ts",
    "notNull": true,
    "hasDefault": true
   }
  ]
 },
 {
  "table": "club_preferences",
  "sheet": "club_preferences",
  "label": "學生選社志願",
  "dept": "academic",
  "mode": "normal",
  "order": 27,
  "pk": [
   "id"
  ],
  "uniques": [
   [
    "academic_year",
    "term",
    "student_no",
    "choice_rank"
   ],
   [
    "academic_year",
    "term",
    "student_no",
    "club_id"
   ]
  ],
  "cols": [
   {
    "name": "id",
    "type": "uuid",
    "notNull": true,
    "hasDefault": true
   },
   {
    "name": "academic_year",
    "type": "int",
    "notNull": true,
    "hasDefault": false
   },
   {
    "name": "term",
    "type": "text",
    "notNull": true,
    "hasDefault": false
   },
   {
    "name": "student_no",
    "type": "text",
    "notNull": true,
    "hasDefault": false
   },
   {
    "name": "club_id",
    "type": "uuid",
    "notNull": true,
    "hasDefault": false
   },
   {
    "name": "choice_rank",
    "type": "int",
    "notNull": true,
    "hasDefault": false
   },
   {
    "name": "submitted_at",
    "type": "ts",
    "notNull": true,
    "hasDefault": true
   }
  ]
 },
 {
  "table": "club_scores",
  "sheet": "club_scores",
  "label": "社團成績",
  "dept": "academic",
  "mode": "normal",
  "order": 28,
  "pk": [
   "id"
  ],
  "uniques": [
   [
    "club_id",
    "student_no"
   ]
  ],
  "cols": [
   {
    "name": "id",
    "type": "uuid",
    "notNull": true,
    "hasDefault": true
   },
   {
    "name": "club_id",
    "type": "uuid",
    "notNull": true,
    "hasDefault": false
   },
   {
    "name": "student_no",
    "type": "text",
    "notNull": true,
    "hasDefault": false
   },
   {
    "name": "score_midterm",
    "type": "num",
    "notNull": false,
    "hasDefault": false
   },
   {
    "name": "score_final",
    "type": "num",
    "notNull": false,
    "hasDefault": false
   },
   {
    "name": "score_daily",
    "type": "num",
    "notNull": false,
    "hasDefault": false
   },
   {
    "name": "is_submitted",
    "type": "bool",
    "notNull": true,
    "hasDefault": true
   },
   {
    "name": "submitted_at",
    "type": "ts",
    "notNull": false,
    "hasDefault": false
   },
   {
    "name": "recorded_by",
    "type": "uuid",
    "notNull": false,
    "hasDefault": false
   },
   {
    "name": "updated_at",
    "type": "ts",
    "notNull": true,
    "hasDefault": true
   }
  ]
 },
 {
  "table": "club_selection_windows",
  "sheet": "club_selection_windows",
  "label": "選社時間設定",
  "dept": "academic",
  "mode": "normal",
  "order": 29,
  "pk": [
   "id"
  ],
  "uniques": [
   [
    "academic_year",
    "term"
   ]
  ],
  "cols": [
   {
    "name": "id",
    "type": "uuid",
    "notNull": true,
    "hasDefault": true
   },
   {
    "name": "academic_year",
    "type": "int",
    "notNull": true,
    "hasDefault": false
   },
   {
    "name": "term",
    "type": "text",
    "notNull": true,
    "hasDefault": false
   },
   {
    "name": "method",
    "type": "text",
    "notNull": true,
    "hasDefault": false
   },
   {
    "name": "max_choices",
    "type": "int",
    "notNull": false,
    "hasDefault": false
   },
   {
    "name": "opens_at",
    "type": "ts",
    "notNull": true,
    "hasDefault": false
   },
   {
    "name": "closes_at",
    "type": "ts",
    "notNull": false,
    "hasDefault": false
   },
   {
    "name": "is_finalized",
    "type": "bool",
    "notNull": true,
    "hasDefault": true
   },
   {
    "name": "finalized_at",
    "type": "ts",
    "notNull": false,
    "hasDefault": false
   },
   {
    "name": "created_by",
    "type": "uuid",
    "notNull": false,
    "hasDefault": false
   },
   {
    "name": "created_at",
    "type": "ts",
    "notNull": true,
    "hasDefault": true
   }
  ]
 },
 {
  "table": "conduct_events",
  "sheet": "conduct_events",
  "label": "獎懲紀錄",
  "dept": "discipline",
  "mode": "normal",
  "order": 30,
  "pk": [
   "id"
  ],
  "uniques": [
   [
    "student_no",
    "event_date",
    "event_type"
   ]
  ],
  "cols": [
   {
    "name": "id",
    "type": "uuid",
    "notNull": true,
    "hasDefault": true
   },
   {
    "name": "student_no",
    "type": "text",
    "notNull": true,
    "hasDefault": false
   },
   {
    "name": "event_date",
    "type": "date",
    "notNull": true,
    "hasDefault": false
   },
   {
    "name": "event_type",
    "type": "text",
    "notNull": true,
    "hasDefault": false
   },
   {
    "name": "points",
    "type": "num",
    "notNull": true,
    "hasDefault": false
   },
   {
    "name": "recorded_by",
    "type": "uuid",
    "notNull": false,
    "hasDefault": false
   },
   {
    "name": "reason",
    "type": "text",
    "notNull": false,
    "hasDefault": false
   },
   {
    "name": "created_at",
    "type": "ts",
    "notNull": true,
    "hasDefault": true
   },
   {
    "name": "count",
    "type": "int",
    "notNull": true,
    "hasDefault": true
   }
  ]
 },
 {
  "table": "conduct_event_requests",
  "sheet": "conduct_event_requests",
  "label": "獎懲申請與分層審核",
  "dept": "discipline",
  "mode": "normal",
  "order": 31,
  "pk": [
   "id"
  ],
  "uniques": [],
  "cols": [
   {
    "name": "id",
    "type": "uuid",
    "notNull": true,
    "hasDefault": true
   },
   {
    "name": "batch_id",
    "type": "uuid",
    "notNull": true,
    "hasDefault": false
   },
   {
    "name": "student_no",
    "type": "text",
    "notNull": true,
    "hasDefault": false
   },
   {
    "name": "event_date",
    "type": "date",
    "notNull": true,
    "hasDefault": false
   },
   {
    "name": "event_type",
    "type": "text",
    "notNull": true,
    "hasDefault": false
   },
   {
    "name": "count",
    "type": "int",
    "notNull": true,
    "hasDefault": false
   },
   {
    "name": "points",
    "type": "num",
    "notNull": true,
    "hasDefault": false
   },
   {
    "name": "reason",
    "type": "text",
    "notNull": true,
    "hasDefault": false
   },
   {
    "name": "requested_by",
    "type": "uuid",
    "notNull": true,
    "hasDefault": false
   },
   {
    "name": "requested_at",
    "type": "ts",
    "notNull": true,
    "hasDefault": true
   },
   {
    "name": "status",
    "type": "text",
    "notNull": true,
    "hasDefault": true
   },
   {
    "name": "b_decision",
    "type": "text",
    "notNull": false,
    "hasDefault": false
   },
   {
    "name": "b_by",
    "type": "uuid",
    "notNull": false,
    "hasDefault": false
   },
   {
    "name": "b_at",
    "type": "ts",
    "notNull": false,
    "hasDefault": false
   },
   {
    "name": "a_decision",
    "type": "text",
    "notNull": false,
    "hasDefault": false
   },
   {
    "name": "a_by",
    "type": "uuid",
    "notNull": false,
    "hasDefault": false
   },
   {
    "name": "a_at",
    "type": "ts",
    "notNull": false,
    "hasDefault": false
   },
   {
    "name": "s_decision",
    "type": "text",
    "notNull": false,
    "hasDefault": false
   },
   {
    "name": "s_by",
    "type": "uuid",
    "notNull": false,
    "hasDefault": false
   },
   {
    "name": "s_at",
    "type": "ts",
    "notNull": false,
    "hasDefault": false
   },
   {
    "name": "applied_at",
    "type": "ts",
    "notNull": false,
    "hasDefault": false
   },
   {
    "name": "conduct_event_id",
    "type": "uuid",
    "notNull": false,
    "hasDefault": false
   }
  ]
 },
 {
  "table": "conduct_point_defaults",
  "sheet": "conduct_point_defaults",
  "label": "獎懲預設分數",
  "dept": "discipline",
  "mode": "normal",
  "order": 32,
  "pk": [
   "item"
  ],
  "uniques": [],
  "cols": [
   {
    "name": "item",
    "type": "text",
    "notNull": true,
    "hasDefault": false
   },
   {
    "name": "points",
    "type": "num",
    "notNull": true,
    "hasDefault": false
   }
  ]
 },
 {
  "table": "enrollments",
  "sheet": "enrollments",
  "label": "學生編班（學籍／座號）",
  "dept": "academic",
  "mode": "normal",
  "order": 33,
  "pk": [
   "id"
  ],
  "uniques": [
   [
    "class_id",
    "term",
    "seat_no"
   ]
  ],
  "cols": [
   {
    "name": "id",
    "type": "uuid",
    "notNull": true,
    "hasDefault": true
   },
   {
    "name": "student_no",
    "type": "text",
    "notNull": true,
    "hasDefault": false
   },
   {
    "name": "class_id",
    "type": "uuid",
    "notNull": true,
    "hasDefault": false
   },
   {
    "name": "term",
    "type": "text",
    "notNull": true,
    "hasDefault": false
   },
   {
    "name": "seat_no",
    "type": "int",
    "notNull": true,
    "hasDefault": false
   },
   {
    "name": "is_current",
    "type": "bool",
    "notNull": true,
    "hasDefault": true
   },
   {
    "name": "created_at",
    "type": "ts",
    "notNull": true,
    "hasDefault": true
   }
  ]
 },
 {
  "table": "conduct_scores",
  "sheet": "conduct_scores",
  "label": "操行成績（禮貌／衣著／服務／紀律）",
  "dept": "academic",
  "mode": "normal",
  "order": 34,
  "pk": [
   "enrollment_id"
  ],
  "uniques": [],
  "cols": [
   {
    "name": "enrollment_id",
    "type": "uuid",
    "notNull": true,
    "hasDefault": false
   },
   {
    "name": "politeness",
    "type": "num",
    "notNull": false,
    "hasDefault": false
   },
   {
    "name": "dress",
    "type": "num",
    "notNull": false,
    "hasDefault": false
   },
   {
    "name": "service",
    "type": "num",
    "notNull": false,
    "hasDefault": false
   },
   {
    "name": "discipline",
    "type": "num",
    "notNull": false,
    "hasDefault": false
   },
   {
    "name": "updated_by",
    "type": "uuid",
    "notNull": false,
    "hasDefault": false
   },
   {
    "name": "updated_at",
    "type": "ts",
    "notNull": true,
    "hasDefault": true
   }
  ]
 },
 {
  "table": "correction_requests",
  "sheet": "correction_requests",
  "label": "出缺勤／成績修正開放申請",
  "dept": "discipline",
  "mode": "normal",
  "order": 35,
  "pk": [
   "id"
  ],
  "uniques": [],
  "cols": [
   {
    "name": "id",
    "type": "uuid",
    "notNull": true,
    "hasDefault": true
   },
   {
    "name": "requested_by",
    "type": "uuid",
    "notNull": true,
    "hasDefault": false
   },
   {
    "name": "data_type",
    "type": "text",
    "notNull": true,
    "hasDefault": false
   },
   {
    "name": "record_id",
    "type": "uuid",
    "notNull": false,
    "hasDefault": false
   },
   {
    "name": "reason",
    "type": "text",
    "notNull": false,
    "hasDefault": false
   },
   {
    "name": "status",
    "type": "text",
    "notNull": true,
    "hasDefault": true
   },
   {
    "name": "reviewed_by",
    "type": "uuid",
    "notNull": false,
    "hasDefault": false
   },
   {
    "name": "reviewed_at",
    "type": "ts",
    "notNull": false,
    "hasDefault": false
   },
   {
    "name": "created_at",
    "type": "ts",
    "notNull": true,
    "hasDefault": true
   },
   {
    "name": "scope",
    "type": "text",
    "notNull": false,
    "hasDefault": false
   },
   {
    "name": "scope_ref",
    "type": "text",
    "notNull": false,
    "hasDefault": false
   },
   {
    "name": "academic_year",
    "type": "int",
    "notNull": false,
    "hasDefault": false
   },
   {
    "name": "term",
    "type": "text",
    "notNull": false,
    "hasDefault": false
   }
  ]
 },
 {
  "table": "curriculum",
  "sheet": "curriculum",
  "label": "科目與比重（節數）",
  "dept": "academic",
  "mode": "normal",
  "order": 36,
  "pk": [
   "id"
  ],
  "uniques": [
   [
    "academic_year",
    "term",
    "grade_level",
    "subject"
   ]
  ],
  "cols": [
   {
    "name": "id",
    "type": "uuid",
    "notNull": true,
    "hasDefault": true
   },
   {
    "name": "academic_year",
    "type": "int",
    "notNull": true,
    "hasDefault": false
   },
   {
    "name": "term",
    "type": "text",
    "notNull": true,
    "hasDefault": false
   },
   {
    "name": "grade_level",
    "type": "text",
    "notNull": true,
    "hasDefault": false
   },
   {
    "name": "subject",
    "type": "text",
    "notNull": true,
    "hasDefault": false
   },
   {
    "name": "weight",
    "type": "num",
    "notNull": true,
    "hasDefault": false
   },
   {
    "name": "periods",
    "type": "int",
    "notNull": false,
    "hasDefault": false
   }
  ]
 },
 {
  "table": "exam_sessions",
  "sheet": "exam_sessions",
  "label": "考試場次",
  "dept": "academic",
  "mode": "normal",
  "order": 37,
  "pk": [
   "id"
  ],
  "uniques": [],
  "cols": [
   {
    "name": "id",
    "type": "uuid",
    "notNull": true,
    "hasDefault": true
   },
   {
    "name": "name",
    "type": "text",
    "notNull": true,
    "hasDefault": false
   },
   {
    "name": "academic_year",
    "type": "int",
    "notNull": true,
    "hasDefault": false
   },
   {
    "name": "term",
    "type": "text",
    "notNull": true,
    "hasDefault": false
   },
   {
    "name": "status",
    "type": "text",
    "notNull": true,
    "hasDefault": true
   },
   {
    "name": "created_by",
    "type": "uuid",
    "notNull": false,
    "hasDefault": false
   },
   {
    "name": "created_at",
    "type": "ts",
    "notNull": true,
    "hasDefault": true
   },
   {
    "name": "sent_at",
    "type": "ts",
    "notNull": false,
    "hasDefault": false
   },
   {
    "name": "excluded_class_ids",
    "type": "array",
    "notNull": true,
    "hasDefault": true
   }
  ]
 },
 {
  "table": "exam_class_roster_status",
  "sheet": "exam_class_roster_status",
  "label": "各班考場名單送出狀態",
  "dept": "academic",
  "mode": "normal",
  "order": 38,
  "pk": [
   "id"
  ],
  "uniques": [
   [
    "exam_session_id",
    "class_id"
   ]
  ],
  "cols": [
   {
    "name": "id",
    "type": "uuid",
    "notNull": true,
    "hasDefault": true
   },
   {
    "name": "exam_session_id",
    "type": "uuid",
    "notNull": true,
    "hasDefault": false
   },
   {
    "name": "class_id",
    "type": "uuid",
    "notNull": true,
    "hasDefault": false
   },
   {
    "name": "submitted",
    "type": "bool",
    "notNull": true,
    "hasDefault": true
   },
   {
    "name": "submitted_by",
    "type": "uuid",
    "notNull": false,
    "hasDefault": false
   },
   {
    "name": "submitted_at",
    "type": "ts",
    "notNull": false,
    "hasDefault": false
   }
  ]
 },
 {
  "table": "exam_rooms",
  "sheet": "exam_rooms",
  "label": "考場",
  "dept": "academic",
  "mode": "normal",
  "order": 39,
  "pk": [
   "id"
  ],
  "uniques": [
   [
    "exam_session_id",
    "room_name"
   ]
  ],
  "cols": [
   {
    "name": "id",
    "type": "uuid",
    "notNull": true,
    "hasDefault": true
   },
   {
    "name": "exam_session_id",
    "type": "uuid",
    "notNull": true,
    "hasDefault": false
   },
   {
    "name": "room_name",
    "type": "text",
    "notNull": true,
    "hasDefault": false
   },
   {
    "name": "seat_capacity",
    "type": "int",
    "notNull": true,
    "hasDefault": false
   },
   {
    "name": "grid_size",
    "type": "int",
    "notNull": true,
    "hasDefault": false
   },
   {
    "name": "confirmed",
    "type": "bool",
    "notNull": true,
    "hasDefault": true
   },
   {
    "name": "confirmed_at",
    "type": "ts",
    "notNull": false,
    "hasDefault": false
   }
  ]
 },
 {
  "table": "exam_room_classes",
  "sheet": "exam_room_classes",
  "label": "考場應試班級",
  "dept": "academic",
  "mode": "normal",
  "order": 40,
  "pk": [
   "id"
  ],
  "uniques": [
   [
    "exam_room_id",
    "class_id"
   ]
  ],
  "cols": [
   {
    "name": "id",
    "type": "uuid",
    "notNull": true,
    "hasDefault": true
   },
   {
    "name": "exam_room_id",
    "type": "uuid",
    "notNull": true,
    "hasDefault": false
   },
   {
    "name": "class_id",
    "type": "uuid",
    "notNull": true,
    "hasDefault": false
   },
   {
    "name": "allocated_count",
    "type": "int",
    "notNull": true,
    "hasDefault": true
   }
  ]
 },
 {
  "table": "exam_room_seats",
  "sheet": "exam_room_seats",
  "label": "考場座位分配人數",
  "dept": "academic",
  "mode": "normal",
  "order": 41,
  "pk": [
   "id"
  ],
  "uniques": [
   [
    "exam_room_id",
    "seat_no"
   ]
  ],
  "cols": [
   {
    "name": "id",
    "type": "uuid",
    "notNull": true,
    "hasDefault": true
   },
   {
    "name": "exam_room_id",
    "type": "uuid",
    "notNull": true,
    "hasDefault": false
   },
   {
    "name": "seat_no",
    "type": "int",
    "notNull": true,
    "hasDefault": false
   },
   {
    "name": "row_no",
    "type": "int",
    "notNull": true,
    "hasDefault": false
   },
   {
    "name": "col_no",
    "type": "int",
    "notNull": true,
    "hasDefault": false
   },
   {
    "name": "class_id",
    "type": "uuid",
    "notNull": false,
    "hasDefault": false
   }
  ]
 },
 {
  "table": "exam_seat_students",
  "sheet": "exam_seat_students",
  "label": "考場座位學生",
  "dept": "academic",
  "mode": "normal",
  "order": 42,
  "pk": [
   "exam_room_seat_id"
  ],
  "uniques": [],
  "cols": [
   {
    "name": "exam_room_seat_id",
    "type": "uuid",
    "notNull": true,
    "hasDefault": false
   },
   {
    "name": "student_no",
    "type": "text",
    "notNull": false,
    "hasDefault": false
   },
   {
    "name": "class_seat_no",
    "type": "int",
    "notNull": false,
    "hasDefault": false
   },
   {
    "name": "updated_by",
    "type": "uuid",
    "notNull": false,
    "hasDefault": false
   },
   {
    "name": "updated_at",
    "type": "ts",
    "notNull": true,
    "hasDefault": true
   }
  ]
 },
 {
  "table": "general_inventory_items",
  "sheet": "general_inventory_items",
  "label": "庫存品項（校服／簿本／書庫）",
  "dept": "general",
  "mode": "normal",
  "order": 43,
  "pk": [
   "id"
  ],
  "uniques": [],
  "cols": [
   {
    "name": "id",
    "type": "uuid",
    "notNull": true,
    "hasDefault": true
   },
   {
    "name": "category",
    "type": "text",
    "notNull": true,
    "hasDefault": false
   },
   {
    "name": "name",
    "type": "text",
    "notNull": true,
    "hasDefault": false
   },
   {
    "name": "spec",
    "type": "text",
    "notNull": false,
    "hasDefault": false
   },
   {
    "name": "unit",
    "type": "text",
    "notNull": true,
    "hasDefault": true
   },
   {
    "name": "unit_price",
    "type": "num",
    "notNull": false,
    "hasDefault": false
   },
   {
    "name": "quantity_on_hand",
    "type": "int",
    "notNull": true,
    "hasDefault": true
   },
   {
    "name": "note",
    "type": "text",
    "notNull": false,
    "hasDefault": false
   },
   {
    "name": "created_by",
    "type": "uuid",
    "notNull": false,
    "hasDefault": false
   },
   {
    "name": "created_at",
    "type": "ts",
    "notNull": true,
    "hasDefault": true
   },
   {
    "name": "low_stock_threshold",
    "type": "int",
    "notNull": true,
    "hasDefault": true
   }
  ]
 },
 {
  "table": "general_inventory_transactions",
  "sheet": "general_inventory_transactions",
  "label": "庫存進出紀錄",
  "dept": "general",
  "mode": "normal",
  "order": 44,
  "pk": [
   "id"
  ],
  "uniques": [],
  "cols": [
   {
    "name": "id",
    "type": "uuid",
    "notNull": true,
    "hasDefault": true
   },
   {
    "name": "item_id",
    "type": "uuid",
    "notNull": true,
    "hasDefault": false
   },
   {
    "name": "direction",
    "type": "text",
    "notNull": true,
    "hasDefault": false
   },
   {
    "name": "quantity",
    "type": "int",
    "notNull": true,
    "hasDefault": false
   },
   {
    "name": "unit_price_at_time",
    "type": "num",
    "notNull": false,
    "hasDefault": false
   },
   {
    "name": "counterparty",
    "type": "text",
    "notNull": false,
    "hasDefault": false
   },
   {
    "name": "note",
    "type": "text",
    "notNull": false,
    "hasDefault": false
   },
   {
    "name": "recorded_by",
    "type": "uuid",
    "notNull": false,
    "hasDefault": false
   },
   {
    "name": "recorded_at",
    "type": "ts",
    "notNull": true,
    "hasDefault": true
   }
  ]
 },
 {
  "table": "governed_tables",
  "sheet": "governed_tables",
  "label": "受管資料表（送審規則）",
  "dept": "dev",
  "mode": "normal",
  "order": 45,
  "pk": [
   "table_name"
  ],
  "uniques": [],
  "cols": [
   {
    "name": "table_name",
    "type": "text",
    "notNull": true,
    "hasDefault": false
   },
   {
    "name": "department",
    "type": "text",
    "notNull": true,
    "hasDefault": false
   },
   {
    "name": "description",
    "type": "text",
    "notNull": false,
    "hasDefault": false
   }
  ]
 },
 {
  "table": "grade_progression",
  "sheet": "grade_progression",
  "label": "年級升級對照表",
  "dept": "academic",
  "mode": "normal",
  "order": 46,
  "pk": [
   "department",
   "grade_level"
  ],
  "uniques": [],
  "cols": [
   {
    "name": "department",
    "type": "text",
    "notNull": true,
    "hasDefault": false
   },
   {
    "name": "grade_level",
    "type": "text",
    "notNull": true,
    "hasDefault": false
   },
   {
    "name": "next_department",
    "type": "text",
    "notNull": true,
    "hasDefault": false
   },
   {
    "name": "next_grade_level",
    "type": "text",
    "notNull": true,
    "hasDefault": false
   }
  ]
 },
 {
  "table": "grading_rules",
  "sheet": "grading_rules",
  "label": "期中／期末／平時佔比",
  "dept": "academic",
  "mode": "normal",
  "order": 47,
  "pk": [
   "academic_year",
   "term"
  ],
  "uniques": [],
  "cols": [
   {
    "name": "academic_year",
    "type": "int",
    "notNull": true,
    "hasDefault": false
   },
   {
    "name": "term",
    "type": "text",
    "notNull": true,
    "hasDefault": false
   },
   {
    "name": "midterm_weight",
    "type": "num",
    "notNull": true,
    "hasDefault": true
   },
   {
    "name": "final_weight",
    "type": "num",
    "notNull": true,
    "hasDefault": true
   },
   {
    "name": "daily_weight",
    "type": "num",
    "notNull": true,
    "hasDefault": true
   }
  ]
 },
 {
  "table": "guardians",
  "sheet": "guardians",
  "label": "學生監護人／家長資料",
  "dept": "academic",
  "mode": "normal",
  "order": 48,
  "pk": [
   "id"
  ],
  "uniques": [],
  "cols": [
   {
    "name": "id",
    "type": "uuid",
    "notNull": true,
    "hasDefault": true
   },
   {
    "name": "student_no",
    "type": "text",
    "notNull": true,
    "hasDefault": false
   },
   {
    "name": "relation",
    "type": "text",
    "notNull": true,
    "hasDefault": false
   },
   {
    "name": "name",
    "type": "text",
    "notNull": false,
    "hasDefault": false
   },
   {
    "name": "chinese_name",
    "type": "text",
    "notNull": false,
    "hasDefault": false
   },
   {
    "name": "occupation",
    "type": "text",
    "notNull": false,
    "hasDefault": false
   },
   {
    "name": "phone",
    "type": "text",
    "notNull": false,
    "hasDefault": false
   },
   {
    "name": "email",
    "type": "text",
    "notNull": false,
    "hasDefault": false
   },
   {
    "name": "address",
    "type": "text",
    "notNull": false,
    "hasDefault": false
   }
  ]
 },
 {
  "table": "homeroom_attendance_assist_settings",
  "sheet": "homeroom_att_assist_settings",
  "label": "導師協助點名設定",
  "dept": "discipline",
  "mode": "normal",
  "order": 49,
  "pk": [
   "id"
  ],
  "uniques": [],
  "cols": [
   {
    "name": "id",
    "type": "bool",
    "notNull": true,
    "hasDefault": true
   },
   {
    "name": "allow_present_to_leave",
    "type": "bool",
    "notNull": true,
    "hasDefault": true
   },
   {
    "name": "updated_by",
    "type": "uuid",
    "notNull": false,
    "hasDefault": false
   },
   {
    "name": "updated_at",
    "type": "ts",
    "notNull": true,
    "hasDefault": true
   }
  ]
 },
 {
  "table": "locked_periods",
  "sheet": "locked_periods",
  "label": "共同科目時間鎖定",
  "dept": "academic",
  "mode": "normal",
  "order": 50,
  "pk": [
   "id"
  ],
  "uniques": [
   [
    "academic_year",
    "term",
    "scope",
    "scope_ref",
    "weekday",
    "period_no"
   ]
  ],
  "cols": [
   {
    "name": "id",
    "type": "uuid",
    "notNull": true,
    "hasDefault": true
   },
   {
    "name": "academic_year",
    "type": "int",
    "notNull": true,
    "hasDefault": false
   },
   {
    "name": "term",
    "type": "text",
    "notNull": true,
    "hasDefault": false
   },
   {
    "name": "scope",
    "type": "text",
    "notNull": true,
    "hasDefault": false
   },
   {
    "name": "scope_ref",
    "type": "text",
    "notNull": false,
    "hasDefault": false
   },
   {
    "name": "weekday",
    "type": "int",
    "notNull": true,
    "hasDefault": false
   },
   {
    "name": "period_no",
    "type": "int",
    "notNull": true,
    "hasDefault": false
   },
   {
    "name": "subject",
    "type": "text",
    "notNull": true,
    "hasDefault": false
   },
   {
    "name": "note",
    "type": "text",
    "notNull": false,
    "hasDefault": false
   },
   {
    "name": "created_by",
    "type": "uuid",
    "notNull": false,
    "hasDefault": false
   },
   {
    "name": "created_at",
    "type": "ts",
    "notNull": true,
    "hasDefault": true
   }
  ]
 },
 {
  "table": "maintenance_tickets",
  "sheet": "maintenance_tickets",
  "label": "修繕登記",
  "dept": "general",
  "mode": "normal",
  "order": 51,
  "pk": [
   "id"
  ],
  "uniques": [],
  "cols": [
   {
    "name": "id",
    "type": "uuid",
    "notNull": true,
    "hasDefault": true
   },
   {
    "name": "location",
    "type": "text",
    "notNull": true,
    "hasDefault": false
   },
   {
    "name": "issue",
    "type": "text",
    "notNull": true,
    "hasDefault": false
   },
   {
    "name": "status",
    "type": "text",
    "notNull": true,
    "hasDefault": true
   },
   {
    "name": "reported_by",
    "type": "uuid",
    "notNull": false,
    "hasDefault": false
   },
   {
    "name": "assigned_to",
    "type": "text",
    "notNull": false,
    "hasDefault": false
   },
   {
    "name": "reported_at",
    "type": "ts",
    "notNull": true,
    "hasDefault": true
   },
   {
    "name": "resolved_at",
    "type": "ts",
    "notNull": false,
    "hasDefault": false
   },
   {
    "name": "note",
    "type": "text",
    "notNull": false,
    "hasDefault": false
   }
  ]
 },
 {
  "table": "password_policy_settings",
  "sheet": "password_policy_settings",
  "label": "密碼政策設定",
  "dept": "dev",
  "mode": "normal",
  "order": 52,
  "pk": [
   "id"
  ],
  "uniques": [],
  "cols": [
   {
    "name": "id",
    "type": "bool",
    "notNull": true,
    "hasDefault": true
   },
   {
    "name": "force_change_on_first_login",
    "type": "bool",
    "notNull": true,
    "hasDefault": true
   },
   {
    "name": "updated_by",
    "type": "uuid",
    "notNull": false,
    "hasDefault": false
   },
   {
    "name": "updated_at",
    "type": "ts",
    "notNull": true,
    "hasDefault": true
   }
  ]
 },
 {
  "table": "pending_changes",
  "sheet": "pending_changes",
  "label": "送審總覽（待核准申請；只供下載，上傳會觸發核准套用所以略過）",
  "dept": "dev",
  "mode": "export",
  "order": 53,
  "pk": [
   "id"
  ],
  "uniques": [],
  "cols": [
   {
    "name": "id",
    "type": "uuid",
    "notNull": true,
    "hasDefault": true
   },
   {
    "name": "department",
    "type": "text",
    "notNull": true,
    "hasDefault": false
   },
   {
    "name": "table_name",
    "type": "text",
    "notNull": true,
    "hasDefault": false
   },
   {
    "name": "operation",
    "type": "text",
    "notNull": true,
    "hasDefault": false
   },
   {
    "name": "record_key",
    "type": "text",
    "notNull": false,
    "hasDefault": false
   },
   {
    "name": "payload",
    "type": "json",
    "notNull": true,
    "hasDefault": true
   },
   {
    "name": "before_snapshot",
    "type": "json",
    "notNull": false,
    "hasDefault": false
   },
   {
    "name": "requested_by",
    "type": "uuid",
    "notNull": true,
    "hasDefault": false
   },
   {
    "name": "requested_at",
    "type": "ts",
    "notNull": true,
    "hasDefault": true
   },
   {
    "name": "status",
    "type": "text",
    "notNull": true,
    "hasDefault": true
   },
   {
    "name": "reviewed_by",
    "type": "uuid",
    "notNull": false,
    "hasDefault": false
   },
   {
    "name": "reviewed_at",
    "type": "ts",
    "notNull": false,
    "hasDefault": false
   },
   {
    "name": "review_note",
    "type": "text",
    "notNull": false,
    "hasDefault": false
   },
   {
    "name": "applied_at",
    "type": "ts",
    "notNull": false,
    "hasDefault": false
   }
  ]
 },
 {
  "table": "period_config",
  "sheet": "period_config",
  "label": "每日節次設定",
  "dept": "academic",
  "mode": "normal",
  "order": 54,
  "pk": [
   "id"
  ],
  "uniques": [],
  "cols": [
   {
    "name": "id",
    "type": "uuid",
    "notNull": true,
    "hasDefault": true
   },
   {
    "name": "scope",
    "type": "text",
    "notNull": true,
    "hasDefault": false
   },
   {
    "name": "scope_ref",
    "type": "text",
    "notNull": false,
    "hasDefault": false
   },
   {
    "name": "weekday",
    "type": "int",
    "notNull": true,
    "hasDefault": false
   },
   {
    "name": "period_count",
    "type": "int",
    "notNull": true,
    "hasDefault": false
   }
  ]
 },
 {
  "table": "portal_accounts",
  "sheet": "portal_accounts",
  "label": "家長／學生登入帳號",
  "dept": "dev",
  "mode": "export",
  "order": 55,
  "pk": [
   "id"
  ],
  "uniques": [
   [
    "login_code"
   ]
  ],
  "cols": [
   {
    "name": "id",
    "type": "uuid",
    "notNull": true,
    "hasDefault": true
   },
   {
    "name": "student_no",
    "type": "text",
    "notNull": true,
    "hasDefault": false
   },
   {
    "name": "login_code",
    "type": "text",
    "notNull": true,
    "hasDefault": false
   },
   {
    "name": "email",
    "type": "text",
    "notNull": false,
    "hasDefault": false
   },
   {
    "name": "relation",
    "type": "text",
    "notNull": true,
    "hasDefault": true
   },
   {
    "name": "auth_user_id",
    "type": "uuid",
    "notNull": false,
    "hasDefault": false
   },
   {
    "name": "created_by",
    "type": "uuid",
    "notNull": false,
    "hasDefault": false
   },
   {
    "name": "created_at",
    "type": "ts",
    "notNull": true,
    "hasDefault": true
   }
  ]
 },
 {
  "table": "portal_login_settings",
  "sheet": "portal_login_settings",
  "label": "家長入口登入設定",
  "dept": "dev",
  "mode": "normal",
  "order": 56,
  "pk": [
   "id"
  ],
  "uniques": [],
  "cols": [
   {
    "name": "id",
    "type": "bool",
    "notNull": true,
    "hasDefault": true
   },
   {
    "name": "email_verification_enabled",
    "type": "bool",
    "notNull": true,
    "hasDefault": true
   },
   {
    "name": "updated_by",
    "type": "uuid",
    "notNull": false,
    "hasDefault": false
   },
   {
    "name": "updated_at",
    "type": "ts",
    "notNull": true,
    "hasDefault": true
   }
  ]
 },
 {
  "table": "profile_edit_requests",
  "sheet": "profile_edit_requests",
  "label": "學生／家長資料修改申請",
  "dept": "discipline",
  "mode": "normal",
  "order": 57,
  "pk": [
   "id"
  ],
  "uniques": [],
  "cols": [
   {
    "name": "id",
    "type": "uuid",
    "notNull": true,
    "hasDefault": true
   },
   {
    "name": "student_no",
    "type": "text",
    "notNull": true,
    "hasDefault": false
   },
   {
    "name": "field_name",
    "type": "text",
    "notNull": true,
    "hasDefault": false
   },
   {
    "name": "old_value",
    "type": "text",
    "notNull": false,
    "hasDefault": false
   },
   {
    "name": "new_value",
    "type": "text",
    "notNull": true,
    "hasDefault": false
   },
   {
    "name": "requested_by",
    "type": "uuid",
    "notNull": false,
    "hasDefault": false
   },
   {
    "name": "requested_at",
    "type": "ts",
    "notNull": true,
    "hasDefault": true
   },
   {
    "name": "status",
    "type": "text",
    "notNull": true,
    "hasDefault": true
   },
   {
    "name": "reviewed_by",
    "type": "uuid",
    "notNull": false,
    "hasDefault": false
   },
   {
    "name": "reviewed_at",
    "type": "ts",
    "notNull": false,
    "hasDefault": false
   },
   {
    "name": "target_table",
    "type": "text",
    "notNull": true,
    "hasDefault": true
   },
   {
    "name": "guardian_id",
    "type": "uuid",
    "notNull": false,
    "hasDefault": false
   }
  ]
 },
 {
  "table": "report_card_merge_template",
  "sheet": "report_card_merge_template",
  "label": "成績單合併列印範本（檔案）",
  "dept": "academic",
  "mode": "skip",
  "order": 58,
  "pk": [
   "id"
  ],
  "uniques": [],
  "cols": [
   {
    "name": "id",
    "type": "uuid",
    "notNull": true,
    "hasDefault": true
   },
   {
    "name": "file_name",
    "type": "text",
    "notNull": true,
    "hasDefault": false
   },
   {
    "name": "file_data",
    "type": "bytes",
    "notNull": true,
    "hasDefault": false
   },
   {
    "name": "is_active",
    "type": "bool",
    "notNull": true,
    "hasDefault": true
   },
   {
    "name": "updated_by",
    "type": "uuid",
    "notNull": false,
    "hasDefault": false
   },
   {
    "name": "updated_at",
    "type": "ts",
    "notNull": true,
    "hasDefault": true
   }
  ]
 },
 {
  "table": "report_card_style",
  "sheet": "report_card_style",
  "label": "成績單樣式設定",
  "dept": "academic",
  "mode": "normal",
  "order": 59,
  "pk": [
   "id"
  ],
  "uniques": [],
  "cols": [
   {
    "name": "id",
    "type": "uuid",
    "notNull": true,
    "hasDefault": true
   },
   {
    "name": "name",
    "type": "text",
    "notNull": true,
    "hasDefault": true
   },
   {
    "name": "config",
    "type": "json",
    "notNull": true,
    "hasDefault": false
   },
   {
    "name": "is_active",
    "type": "bool",
    "notNull": true,
    "hasDefault": true
   },
   {
    "name": "updated_by",
    "type": "uuid",
    "notNull": false,
    "hasDefault": false
   },
   {
    "name": "updated_at",
    "type": "ts",
    "notNull": true,
    "hasDefault": true
   }
  ]
 },
 {
  "table": "report_card_xlsx_template",
  "sheet": "report_card_xlsx_template",
  "label": "成績單 Excel 範本（檔案）",
  "dept": "academic",
  "mode": "skip",
  "order": 60,
  "pk": [
   "id"
  ],
  "uniques": [],
  "cols": [
   {
    "name": "id",
    "type": "uuid",
    "notNull": true,
    "hasDefault": true
   },
   {
    "name": "file_name",
    "type": "text",
    "notNull": true,
    "hasDefault": false
   },
   {
    "name": "file_data",
    "type": "bytes",
    "notNull": true,
    "hasDefault": false
   },
   {
    "name": "is_active",
    "type": "bool",
    "notNull": true,
    "hasDefault": true
   },
   {
    "name": "updated_by",
    "type": "uuid",
    "notNull": false,
    "hasDefault": false
   },
   {
    "name": "updated_at",
    "type": "ts",
    "notNull": true,
    "hasDefault": true
   }
  ]
 },
 {
  "table": "scheduler_backups",
  "sheet": "scheduler_backups",
  "label": "排課工具存檔（內容過大，請用 JSON 備份）",
  "dept": "dev",
  "mode": "skip",
  "order": 61,
  "pk": [
   "id"
  ],
  "uniques": [],
  "cols": [
   {
    "name": "id",
    "type": "uuid",
    "notNull": true,
    "hasDefault": true
   },
   {
    "name": "academic_year",
    "type": "int",
    "notNull": true,
    "hasDefault": false
   },
   {
    "name": "term",
    "type": "text",
    "notNull": true,
    "hasDefault": false
   },
   {
    "name": "note",
    "type": "text",
    "notNull": false,
    "hasDefault": false
   },
   {
    "name": "data",
    "type": "json",
    "notNull": true,
    "hasDefault": false
   },
   {
    "name": "saved_at",
    "type": "ts",
    "notNull": true,
    "hasDefault": true
   },
   {
    "name": "saved_by",
    "type": "uuid",
    "notNull": false,
    "hasDefault": false
   }
  ]
 },
 {
  "table": "score_adjustments",
  "sheet": "score_adjustments",
  "label": "成績加扣分規則",
  "dept": "academic",
  "mode": "normal",
  "order": 62,
  "pk": [
   "id"
  ],
  "uniques": [],
  "cols": [
   {
    "name": "id",
    "type": "uuid",
    "notNull": true,
    "hasDefault": true
   },
   {
    "name": "academic_year",
    "type": "int",
    "notNull": true,
    "hasDefault": false
   },
   {
    "name": "term",
    "type": "text",
    "notNull": true,
    "hasDefault": false
   },
   {
    "name": "name",
    "type": "text",
    "notNull": true,
    "hasDefault": false
   },
   {
    "name": "points",
    "type": "num",
    "notNull": true,
    "hasDefault": false
   },
   {
    "name": "is_active",
    "type": "bool",
    "notNull": true,
    "hasDefault": true
   }
  ]
 },
 {
  "table": "scores",
  "sheet": "scores",
  "label": "學生成績",
  "dept": "academic",
  "mode": "normal",
  "order": 63,
  "pk": [
   "id"
  ],
  "uniques": [
   [
    "enrollment_id",
    "exam_type",
    "subject"
   ]
  ],
  "cols": [
   {
    "name": "id",
    "type": "uuid",
    "notNull": true,
    "hasDefault": true
   },
   {
    "name": "enrollment_id",
    "type": "uuid",
    "notNull": true,
    "hasDefault": false
   },
   {
    "name": "exam_type",
    "type": "text",
    "notNull": true,
    "hasDefault": false
   },
   {
    "name": "subject",
    "type": "text",
    "notNull": true,
    "hasDefault": false
   },
   {
    "name": "score",
    "type": "num",
    "notNull": false,
    "hasDefault": false
   },
   {
    "name": "recorded_by",
    "type": "uuid",
    "notNull": false,
    "hasDefault": false
   },
   {
    "name": "updated_at",
    "type": "ts",
    "notNull": true,
    "hasDefault": true
   }
  ]
 },
 {
  "table": "score_audit_log",
  "sheet": "score_audit_log",
  "label": "成績修改稽核紀錄",
  "dept": "academic",
  "mode": "export",
  "order": 64,
  "pk": [
   "id"
  ],
  "uniques": [],
  "cols": [
   {
    "name": "id",
    "type": "uuid",
    "notNull": true,
    "hasDefault": true
   },
   {
    "name": "score_id",
    "type": "uuid",
    "notNull": true,
    "hasDefault": false
   },
   {
    "name": "changed_by",
    "type": "uuid",
    "notNull": false,
    "hasDefault": false
   },
   {
    "name": "changed_at",
    "type": "ts",
    "notNull": true,
    "hasDefault": true
   },
   {
    "name": "old_value",
    "type": "text",
    "notNull": false,
    "hasDefault": false
   },
   {
    "name": "new_value",
    "type": "text",
    "notNull": false,
    "hasDefault": false
   }
  ]
 },
 {
  "table": "site_content",
  "sheet": "site_content",
  "label": "系統文字設定",
  "dept": "dev",
  "mode": "normal",
  "order": 65,
  "pk": [
   "content_key"
  ],
  "uniques": [],
  "cols": [
   {
    "name": "content_key",
    "type": "text",
    "notNull": true,
    "hasDefault": false
   },
   {
    "name": "content_value",
    "type": "text",
    "notNull": true,
    "hasDefault": false
   },
   {
    "name": "updated_by",
    "type": "uuid",
    "notNull": false,
    "hasDefault": false
   },
   {
    "name": "updated_at",
    "type": "ts",
    "notNull": true,
    "hasDefault": true
   }
  ]
 },
 {
  "table": "site_settings",
  "sheet": "site_settings",
  "label": "站台設定",
  "dept": "dev",
  "mode": "normal",
  "order": 66,
  "pk": [
   "setting_key"
  ],
  "uniques": [],
  "cols": [
   {
    "name": "setting_key",
    "type": "text",
    "notNull": true,
    "hasDefault": false
   },
   {
    "name": "setting_value",
    "type": "text",
    "notNull": false,
    "hasDefault": false
   },
   {
    "name": "updated_by",
    "type": "uuid",
    "notNull": false,
    "hasDefault": false
   },
   {
    "name": "updated_at",
    "type": "ts",
    "notNull": true,
    "hasDefault": true
   }
  ]
 },
 {
  "table": "staff_notifications",
  "sheet": "staff_notifications",
  "label": "教職員通知",
  "dept": "dev",
  "mode": "normal",
  "order": 67,
  "pk": [
   "id"
  ],
  "uniques": [],
  "cols": [
   {
    "name": "id",
    "type": "uuid",
    "notNull": true,
    "hasDefault": true
   },
   {
    "name": "teacher_id",
    "type": "uuid",
    "notNull": true,
    "hasDefault": false
   },
   {
    "name": "category",
    "type": "text",
    "notNull": true,
    "hasDefault": false
   },
   {
    "name": "message",
    "type": "text",
    "notNull": true,
    "hasDefault": false
   },
   {
    "name": "student_no",
    "type": "text",
    "notNull": false,
    "hasDefault": false
   },
   {
    "name": "created_at",
    "type": "ts",
    "notNull": true,
    "hasDefault": true
   },
   {
    "name": "read_at",
    "type": "ts",
    "notNull": false,
    "hasDefault": false
   }
  ]
 },
 {
  "table": "student_status_changes",
  "sheet": "student_status_changes",
  "label": "學籍狀態異動紀錄",
  "dept": "academic",
  "mode": "normal",
  "order": 68,
  "pk": [
   "id"
  ],
  "uniques": [],
  "cols": [
   {
    "name": "id",
    "type": "uuid",
    "notNull": true,
    "hasDefault": true
   },
   {
    "name": "student_no",
    "type": "text",
    "notNull": true,
    "hasDefault": false
   },
   {
    "name": "status",
    "type": "text",
    "notNull": true,
    "hasDefault": false
   },
   {
    "name": "effective_date",
    "type": "date",
    "notNull": true,
    "hasDefault": false
   },
   {
    "name": "reason",
    "type": "text",
    "notNull": false,
    "hasDefault": false
   },
   {
    "name": "changed_by",
    "type": "uuid",
    "notNull": false,
    "hasDefault": false
   },
   {
    "name": "created_at",
    "type": "ts",
    "notNull": true,
    "hasDefault": true
   }
  ]
 },
 {
  "table": "status_change_attachments",
  "sheet": "status_change_attachments",
  "label": "學籍異動佐證附件（檔案連結）",
  "dept": "academic",
  "mode": "normal",
  "order": 69,
  "pk": [
   "id"
  ],
  "uniques": [],
  "cols": [
   {
    "name": "id",
    "type": "uuid",
    "notNull": true,
    "hasDefault": true
   },
   {
    "name": "status_change_id",
    "type": "uuid",
    "notNull": true,
    "hasDefault": false
   },
   {
    "name": "file_url",
    "type": "text",
    "notNull": true,
    "hasDefault": false
   },
   {
    "name": "file_name",
    "type": "text",
    "notNull": false,
    "hasDefault": false
   },
   {
    "name": "uploaded_at",
    "type": "ts",
    "notNull": true,
    "hasDefault": true
   }
  ]
 },
 {
  "table": "student_remarks",
  "sheet": "student_remarks",
  "label": "學生評語",
  "dept": "academic",
  "mode": "normal",
  "order": 70,
  "pk": [
   "enrollment_id"
  ],
  "uniques": [],
  "cols": [
   {
    "name": "enrollment_id",
    "type": "uuid",
    "notNull": true,
    "hasDefault": false
   },
   {
    "name": "comment",
    "type": "text",
    "notNull": false,
    "hasDefault": false
   },
   {
    "name": "updated_by",
    "type": "uuid",
    "notNull": false,
    "hasDefault": false
   },
   {
    "name": "updated_at",
    "type": "ts",
    "notNull": true,
    "hasDefault": true
   }
  ]
 },
 {
  "table": "submission_windows",
  "sheet": "submission_windows",
  "label": "成績／出缺勤上傳時間與鎖定",
  "dept": "academic",
  "mode": "normal",
  "order": 71,
  "pk": [
   "id"
  ],
  "uniques": [
   [
    "academic_year",
    "term",
    "data_type",
    "scope",
    "scope_ref"
   ]
  ],
  "cols": [
   {
    "name": "id",
    "type": "uuid",
    "notNull": true,
    "hasDefault": true
   },
   {
    "name": "academic_year",
    "type": "int",
    "notNull": true,
    "hasDefault": false
   },
   {
    "name": "term",
    "type": "text",
    "notNull": true,
    "hasDefault": false
   },
   {
    "name": "data_type",
    "type": "text",
    "notNull": true,
    "hasDefault": false
   },
   {
    "name": "scope",
    "type": "text",
    "notNull": true,
    "hasDefault": false
   },
   {
    "name": "scope_ref",
    "type": "text",
    "notNull": false,
    "hasDefault": false
   },
   {
    "name": "opens_at",
    "type": "ts",
    "notNull": false,
    "hasDefault": false
   },
   {
    "name": "closes_at",
    "type": "ts",
    "notNull": false,
    "hasDefault": false
   },
   {
    "name": "is_locked",
    "type": "bool",
    "notNull": true,
    "hasDefault": true
   },
   {
    "name": "set_by",
    "type": "uuid",
    "notNull": false,
    "hasDefault": false
   }
  ]
 },
 {
  "table": "submission_window_audit_log",
  "sheet": "submission_window_audit_log",
  "label": "成績鎖定／解鎖稽核紀錄",
  "dept": "academic",
  "mode": "export",
  "order": 72,
  "pk": [
   "id"
  ],
  "uniques": [],
  "cols": [
   {
    "name": "id",
    "type": "uuid",
    "notNull": true,
    "hasDefault": true
   },
   {
    "name": "window_id",
    "type": "uuid",
    "notNull": false,
    "hasDefault": false
   },
   {
    "name": "academic_year",
    "type": "int",
    "notNull": true,
    "hasDefault": false
   },
   {
    "name": "term",
    "type": "text",
    "notNull": true,
    "hasDefault": false
   },
   {
    "name": "data_type",
    "type": "text",
    "notNull": true,
    "hasDefault": false
   },
   {
    "name": "scope",
    "type": "text",
    "notNull": true,
    "hasDefault": false
   },
   {
    "name": "scope_ref",
    "type": "text",
    "notNull": false,
    "hasDefault": false
   },
   {
    "name": "old_is_locked",
    "type": "bool",
    "notNull": true,
    "hasDefault": false
   },
   {
    "name": "new_is_locked",
    "type": "bool",
    "notNull": true,
    "hasDefault": false
   },
   {
    "name": "old_closes_at",
    "type": "ts",
    "notNull": false,
    "hasDefault": false
   },
   {
    "name": "new_closes_at",
    "type": "ts",
    "notNull": false,
    "hasDefault": false
   },
   {
    "name": "changed_by",
    "type": "uuid",
    "notNull": false,
    "hasDefault": false
   },
   {
    "name": "changed_at",
    "type": "ts",
    "notNull": true,
    "hasDefault": true
   },
   {
    "name": "reason",
    "type": "text",
    "notNull": false,
    "hasDefault": false
   }
  ]
 },
 {
  "table": "substitute_assignments",
  "sheet": "substitute_assignments",
  "label": "代課安排",
  "dept": "academic",
  "mode": "normal",
  "order": 73,
  "pk": [
   "id"
  ],
  "uniques": [
   [
    "class_id",
    "substitute_date",
    "period_no"
   ]
  ],
  "cols": [
   {
    "name": "id",
    "type": "uuid",
    "notNull": true,
    "hasDefault": true
   },
   {
    "name": "academic_year",
    "type": "int",
    "notNull": true,
    "hasDefault": false
   },
   {
    "name": "term",
    "type": "text",
    "notNull": true,
    "hasDefault": false
   },
   {
    "name": "class_id",
    "type": "uuid",
    "notNull": true,
    "hasDefault": false
   },
   {
    "name": "weekday",
    "type": "int",
    "notNull": true,
    "hasDefault": false
   },
   {
    "name": "period_no",
    "type": "int",
    "notNull": true,
    "hasDefault": false
   },
   {
    "name": "subject",
    "type": "text",
    "notNull": true,
    "hasDefault": false
   },
   {
    "name": "original_teacher_id",
    "type": "uuid",
    "notNull": true,
    "hasDefault": false
   },
   {
    "name": "substitute_teacher_id",
    "type": "uuid",
    "notNull": true,
    "hasDefault": false
   },
   {
    "name": "substitute_date",
    "type": "date",
    "notNull": true,
    "hasDefault": false
   },
   {
    "name": "reason",
    "type": "text",
    "notNull": false,
    "hasDefault": false
   },
   {
    "name": "status",
    "type": "text",
    "notNull": true,
    "hasDefault": true
   },
   {
    "name": "created_by",
    "type": "uuid",
    "notNull": false,
    "hasDefault": false
   },
   {
    "name": "created_at",
    "type": "ts",
    "notNull": true,
    "hasDefault": true
   }
  ]
 },
 {
  "table": "teacher_appointment_letters",
  "sheet": "teacher_appointment_letters",
  "label": "教師聘書",
  "dept": "dev",
  "mode": "normal",
  "order": 74,
  "pk": [
   "id"
  ],
  "uniques": [],
  "cols": [
   {
    "name": "id",
    "type": "uuid",
    "notNull": true,
    "hasDefault": true
   },
   {
    "name": "category",
    "type": "text",
    "notNull": true,
    "hasDefault": false
   },
   {
    "name": "seq_no",
    "type": "int",
    "notNull": false,
    "hasDefault": false
   },
   {
    "name": "name",
    "type": "text",
    "notNull": true,
    "hasDefault": false
   },
   {
    "name": "title",
    "type": "text",
    "notNull": false,
    "hasDefault": false
   },
   {
    "name": "gender",
    "type": "text",
    "notNull": false,
    "hasDefault": false
   },
   {
    "name": "term_no",
    "type": "int",
    "notNull": false,
    "hasDefault": false
   },
   {
    "name": "start_date",
    "type": "date",
    "notNull": false,
    "hasDefault": false
   },
   {
    "name": "end_date",
    "type": "date",
    "notNull": false,
    "hasDefault": false
   },
   {
    "name": "resigned",
    "type": "bool",
    "notNull": true,
    "hasDefault": true
   },
   {
    "name": "issued_date",
    "type": "date",
    "notNull": false,
    "hasDefault": false
   },
   {
    "name": "note",
    "type": "text",
    "notNull": false,
    "hasDefault": false
   },
   {
    "name": "created_by",
    "type": "uuid",
    "notNull": false,
    "hasDefault": false
   },
   {
    "name": "created_at",
    "type": "ts",
    "notNull": true,
    "hasDefault": true
   },
   {
    "name": "updated_at",
    "type": "ts",
    "notNull": true,
    "hasDefault": true
   }
  ]
 },
 {
  "table": "teacher_letter_settings",
  "sheet": "teacher_letter_settings",
  "label": "聘書列印設定",
  "dept": "dev",
  "mode": "normal",
  "order": 75,
  "pk": [
   "id"
  ],
  "uniques": [],
  "cols": [
   {
    "name": "id",
    "type": "int",
    "notNull": true,
    "hasDefault": true
   },
   {
    "name": "school_name_zh",
    "type": "text",
    "notNull": true,
    "hasDefault": true
   },
   {
    "name": "principal_name",
    "type": "text",
    "notNull": true,
    "hasDefault": true
   },
   {
    "name": "chairman_name",
    "type": "text",
    "notNull": true,
    "hasDefault": true
   },
   {
    "name": "phone",
    "type": "text",
    "notNull": true,
    "hasDefault": true
   },
   {
    "name": "address",
    "type": "text",
    "notNull": true,
    "hasDefault": true
   },
   {
    "name": "updated_by",
    "type": "uuid",
    "notNull": false,
    "hasDefault": false
   },
   {
    "name": "updated_at",
    "type": "ts",
    "notNull": true,
    "hasDefault": true
   }
  ]
 },
 {
  "table": "teacher_login_settings",
  "sheet": "teacher_login_settings",
  "label": "教師登入首頁設定",
  "dept": "dev",
  "mode": "normal",
  "order": 76,
  "pk": [
   "id"
  ],
  "uniques": [],
  "cols": [
   {
    "name": "id",
    "type": "bool",
    "notNull": true,
    "hasDefault": true
   },
   {
    "name": "home_path",
    "type": "text",
    "notNull": true,
    "hasDefault": true
   },
   {
    "name": "updated_by",
    "type": "uuid",
    "notNull": false,
    "hasDefault": false
   },
   {
    "name": "updated_at",
    "type": "ts",
    "notNull": true,
    "hasDefault": true
   }
  ]
 },
 {
  "table": "teacher_service_certificates",
  "sheet": "teacher_service_certificates",
  "label": "歷年教師資料（服務證明）",
  "dept": "dev",
  "mode": "normal",
  "order": 77,
  "pk": [
   "id"
  ],
  "uniques": [],
  "cols": [
   {
    "name": "id",
    "type": "uuid",
    "notNull": true,
    "hasDefault": true
   },
   {
    "name": "seq_no",
    "type": "int",
    "notNull": false,
    "hasDefault": false
   },
   {
    "name": "self_hired",
    "type": "bool",
    "notNull": true,
    "hasDefault": true
   },
   {
    "name": "resigned",
    "type": "bool",
    "notNull": true,
    "hasDefault": true
   },
   {
    "name": "name",
    "type": "text",
    "notNull": true,
    "hasDefault": false
   },
   {
    "name": "birth_date",
    "type": "date",
    "notNull": false,
    "hasDefault": false
   },
   {
    "name": "nationality",
    "type": "text",
    "notNull": false,
    "hasDefault": false
   },
   {
    "name": "gender",
    "type": "text",
    "notNull": false,
    "hasDefault": false
   },
   {
    "name": "department",
    "type": "text",
    "notNull": false,
    "hasDefault": false
   },
   {
    "name": "title",
    "type": "text",
    "notNull": false,
    "hasDefault": false
   },
   {
    "name": "start_date_1",
    "type": "date",
    "notNull": false,
    "hasDefault": false
   },
   {
    "name": "end_date_1",
    "type": "date",
    "notNull": false,
    "hasDefault": false
   },
   {
    "name": "start_date_2",
    "type": "date",
    "notNull": false,
    "hasDefault": false
   },
   {
    "name": "end_date_2",
    "type": "date",
    "notNull": false,
    "hasDefault": false
   },
   {
    "name": "start_date_3",
    "type": "date",
    "notNull": false,
    "hasDefault": false
   },
   {
    "name": "end_date_3",
    "type": "date",
    "notNull": false,
    "hasDefault": false
   },
   {
    "name": "note",
    "type": "text",
    "notNull": false,
    "hasDefault": false
   },
   {
    "name": "created_by",
    "type": "uuid",
    "notNull": false,
    "hasDefault": false
   },
   {
    "name": "created_at",
    "type": "ts",
    "notNull": true,
    "hasDefault": true
   },
   {
    "name": "updated_at",
    "type": "ts",
    "notNull": true,
    "hasDefault": true
   }
  ]
 },
 {
  "table": "utility_bills",
  "sheet": "utility_bills",
  "label": "水電網路等費用",
  "dept": "general",
  "mode": "normal",
  "order": 78,
  "pk": [
   "id"
  ],
  "uniques": [
   [
    "category",
    "billing_month"
   ]
  ],
  "cols": [
   {
    "name": "id",
    "type": "uuid",
    "notNull": true,
    "hasDefault": true
   },
   {
    "name": "category",
    "type": "text",
    "notNull": true,
    "hasDefault": false
   },
   {
    "name": "billing_month",
    "type": "date",
    "notNull": true,
    "hasDefault": false
   },
   {
    "name": "amount",
    "type": "num",
    "notNull": true,
    "hasDefault": false
   },
   {
    "name": "paid",
    "type": "bool",
    "notNull": true,
    "hasDefault": true
   },
   {
    "name": "paid_date",
    "type": "date",
    "notNull": false,
    "hasDefault": false
   },
   {
    "name": "note",
    "type": "text",
    "notNull": false,
    "hasDefault": false
   },
   {
    "name": "recorded_by",
    "type": "uuid",
    "notNull": false,
    "hasDefault": false
   },
   {
    "name": "created_at",
    "type": "ts",
    "notNull": true,
    "hasDefault": true
   }
  ]
 }
];
