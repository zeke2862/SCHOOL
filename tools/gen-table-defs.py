#!/usr/bin/env python3
"""
讀 sql/01_schema.sql ＋ sql/02_constraints_indexes.sql，產生 lib/deptTableDefs.ts
（四部門 Excel 一鍵下載／上傳要用的「資料表定義」）。

用法（在專案根目錄）：
    python3 tools/gen-table-defs.py
資料庫結構（新增資料表或欄位）有改動時，重新執行一次就會更新 lib/deptTableDefs.ts。
"""
import re, json, sys, os

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..')) if os.path.basename(os.path.dirname(os.path.abspath(__file__))) == 'tools' else os.getcwd()
if len(sys.argv) > 1:
    ROOT = sys.argv[1]

s1 = open(os.path.join(ROOT, 'sql/01_schema.sql'), encoding='utf-8').read()
s2 = open(os.path.join(ROOT, 'sql/02_constraints_indexes.sql'), encoding='utf-8').read()

# ---------- 部門與中文名稱 ----------
# dept: academic 教務 / discipline 訓導 / general 總務 / dev 開發人員
# mode: 'normal' 一般（可下載、可上傳）
#       'export' 只下載（上傳時略過；例如帳號要走邀請流程、稽核紀錄不該被改寫）
#       'skip'   不放進 Excel（二進位或超長 JSON，請用 JSON 備份）
META = {
    # ---- 教務 ----
    'academic_terms': ('academic', '學年學期主檔', 'normal'),
    'teachers': ('academic', '教師名單', 'normal'),
    'students': ('academic', '學生基本資料', 'normal'),
    'guardians': ('academic', '學生監護人／家長資料', 'normal'),
    'classes': ('academic', '班級與導師', 'normal'),
    'enrollments': ('academic', '學生編班（學籍／座號）', 'normal'),
    'student_status_changes': ('academic', '學籍狀態異動紀錄', 'normal'),
    'status_change_attachments': ('academic', '學籍異動佐證附件（檔案連結）', 'normal'),
    'student_remarks': ('academic', '學生評語', 'normal'),
    'grade_progression': ('academic', '年級升級對照表', 'normal'),
    'curriculum': ('academic', '科目與比重（節數）', 'normal'),
    'grading_rules': ('academic', '期中／期末／平時佔比', 'normal'),
    'score_adjustments': ('academic', '成績加扣分規則', 'normal'),
    'class_schedule': ('academic', '課表與任課教師', 'normal'),
    'period_config': ('academic', '每日節次設定', 'normal'),
    'locked_periods': ('academic', '共同科目時間鎖定', 'normal'),
    'substitute_assignments': ('academic', '代課安排', 'normal'),
    'scores': ('academic', '學生成績', 'normal'),
    'conduct_scores': ('academic', '操行成績（禮貌／衣著／服務／紀律）', 'normal'),
    'submission_windows': ('academic', '成績／出缺勤上傳時間與鎖定', 'normal'),
    'submission_window_audit_log': ('academic', '成績鎖定／解鎖稽核紀錄', 'export'),
    'score_audit_log': ('academic', '成績修改稽核紀錄', 'export'),
    'report_card_style': ('academic', '成績單樣式設定', 'normal'),
    'report_card_merge_template': ('academic', '成績單合併列印範本（檔案）', 'skip'),
    'report_card_xlsx_template': ('academic', '成績單 Excel 範本（檔案）', 'skip'),
    'exam_sessions': ('academic', '考試場次', 'normal'),
    'exam_rooms': ('academic', '考場', 'normal'),
    'exam_room_classes': ('academic', '考場應試班級', 'normal'),
    'exam_room_seats': ('academic', '考場座位分配人數', 'normal'),
    'exam_seat_students': ('academic', '考場座位學生', 'normal'),
    'exam_class_roster_status': ('academic', '各班考場名單送出狀態', 'normal'),
    'clubs': ('academic', '社團／才藝課', 'normal'),
    'club_members': ('academic', '社團成員', 'normal'),
    'club_attendance': ('academic', '社團點名', 'normal'),
    'club_scores': ('academic', '社團成績', 'normal'),
    'club_selection_windows': ('academic', '選社時間設定', 'normal'),
    'club_preferences': ('academic', '學生選社志願', 'normal'),
    'clock_shifts': ('academic', '打卡班別', 'normal'),
    'clock_holidays': ('academic', '打卡放假日', 'normal'),
    'clock_employee_map': ('academic', '打卡機代碼與教師對照', 'normal'),
    'clock_records': ('academic', '教職員打卡原始紀錄', 'normal'),
    'clock_day_overrides': ('academic', '補卡／當日更正', 'normal'),
    'clock_import_log': ('academic', '打卡匯入流水帳', 'export'),
    # ---- 訓導 ----
    'attendance': ('discipline', '學生出缺勤紀錄', 'normal'),
    'attendance_notifications': ('discipline', '出缺席示警通知決定紀錄', 'normal'),
    'attendance_alert_settings': ('discipline', '出缺席示警門檻設定', 'normal'),
    'attendance_score_display_settings': ('discipline', '出缺席分數顯示設定', 'normal'),
    'homeroom_attendance_assist_settings': ('discipline', '導師協助點名設定', 'normal'),
    'attendance_audit_log': ('discipline', '出缺勤修改稽核紀錄', 'export'),
    'conduct_events': ('discipline', '獎懲紀錄', 'normal'),
    'conduct_event_requests': ('discipline', '獎懲申請與分層審核', 'normal'),
    'conduct_point_defaults': ('discipline', '獎懲預設分數', 'normal'),
    'profile_edit_requests': ('discipline', '學生／家長資料修改申請', 'normal'),
    'correction_requests': ('discipline', '出缺勤／成績修正開放申請', 'normal'),
    # ---- 總務 ----
    'general_inventory_items': ('general', '庫存品項（校服／簿本／書庫）', 'normal'),
    'general_inventory_transactions': ('general', '庫存進出紀錄', 'normal'),
    'maintenance_tickets': ('general', '修繕登記', 'normal'),
    'utility_bills': ('general', '水電網路等費用', 'normal'),
    # ---- 開發人員 ----
    'app_users': ('dev', '登入帳號名單（信箱僅供參考）', 'export'),
    'portal_accounts': ('dev', '家長／學生登入帳號', 'export'),
    'account_audit_log': ('dev', '帳號異動紀錄', 'export'),
    'app_user_departments': ('dev', '部門職務指派', 'normal'),
    'app_user_module_overrides': ('dev', '帳號個別可見功能', 'normal'),
    'admin_module_categories': ('dev', '功能卡片分類', 'normal'),
    'admin_module_order': ('dev', '功能卡片排序', 'normal'),
    'governed_tables': ('dev', '受管資料表（送審規則）', 'normal'),
    'pending_changes': ('dev', '送審總覽（待核准申請；只供下載，上傳會觸發核准套用所以略過）', 'export'),
    'bulletin_posts': ('dev', '公佈欄貼文', 'normal'),
    'site_content': ('dev', '系統文字設定', 'normal'),
    'site_settings': ('dev', '站台設定', 'normal'),
    'portal_login_settings': ('dev', '家長入口登入設定', 'normal'),
    'password_policy_settings': ('dev', '密碼政策設定', 'normal'),
    'teacher_login_settings': ('dev', '教師登入首頁設定', 'normal'),
    'teacher_service_certificates': ('dev', '歷年教師資料（服務證明）', 'normal'),
    'teacher_appointment_letters': ('dev', '教師聘書', 'normal'),
    'teacher_letter_settings': ('dev', '聘書列印設定', 'normal'),
    'staff_notifications': ('dev', '教職員通知', 'normal'),
    'scheduler_backups': ('dev', '排課工具存檔（內容過大，請用 JSON 備份）', 'skip'),
    'backups': ('dev', '系統備份紀錄（請到備份與還原頁處理）', 'skip'),
}

# ---------- 解析欄位 ----------
def map_type(raw: str, arr: bool):
    r = raw.lower()
    if arr:
        return 'array'
    if r.startswith('uuid'): return 'uuid'
    if r in ('text', 'character', 'varchar') or r.startswith('character'): return 'text'
    if r in ('integer', 'bigint', 'smallint'): return 'int'
    if r.startswith('numeric') or r in ('double', 'real'): return 'num'
    if r == 'boolean': return 'bool'
    if r == 'date': return 'date'
    if r.startswith('timestamp'): return 'ts'
    if r in ('jsonb', 'json'): return 'json'
    if r == 'bytea': return 'bytes'
    return 'text'  # enum、time 等一律當文字

tables = {}
for name, body in re.findall(r'CREATE TABLE public\.(\w+) \((.*?)\n\);', s1, flags=re.S):
    cols = []
    for line in body.split('\n'):
        l = line.strip().rstrip(',')
        if not l or l.startswith('--') or l.upper().startswith(('CONSTRAINT', 'PRIMARY', 'UNIQUE', 'FOREIGN', 'CHECK')):
            continue
        parts = l.split()
        cname = parts[0].strip('"')
        t = parts[1]
        if t in ('timestamp', 'time', 'double'):
            t = t  # 'timestamp with time zone' -> 第一個字就夠判斷
        arr = t.endswith('[]')
        t = t.replace('[]', '')
        up = l.upper()
        cols.append({
            'name': cname,
            'type': map_type(re.sub(r'\(.*', '', t), arr),
            'notNull': 'NOT NULL' in up,
            'hasDefault': ' DEFAULT ' in up,
        })
    tables[name] = {'cols': cols, 'pk': [], 'uniques': [], 'refs': set()}

for m in re.finditer(r'ALTER TABLE ONLY public\.(\w+)\s+ADD CONSTRAINT (\w+) PRIMARY KEY \(([^)]*)\);', s2):
    tables[m.group(1)]['pk'] = [c.strip() for c in m.group(3).split(',')]
for m in re.finditer(r'ALTER TABLE ONLY public\.(\w+)\s+ADD CONSTRAINT (\w+) UNIQUE \(([^)]*)\);', s2):
    tables[m.group(1)]['uniques'].append([c.strip() for c in m.group(3).split(',')])
for m in re.finditer(r'ALTER TABLE ONLY public\.(\w+)\s+ADD CONSTRAINT \w+ FOREIGN KEY \(([^)]*)\) REFERENCES public\.(\w+)\(', s2):
    child, parent = m.group(1), m.group(3)
    if child != parent:
        tables[child]['refs'].add(parent)

# ---------- 依外鍵排序（父層在前） ----------
order, seen, temp = [], set(), set()
def visit(n):
    if n in seen: return
    if n in temp: return  # 循環參照：略過
    temp.add(n)
    for p in sorted(tables[n]['refs']):
        if p in tables: visit(p)
    temp.discard(n)
    seen.add(n)
    order.append(n)
for n in sorted(tables):
    visit(n)
rank = {n: i for i, n in enumerate(order)}

# ---------- 工作表名稱（Excel 限 31 字） ----------
ALIAS = {
    'attendance_score_display_settings': 'attendance_score_disp_settings',
    'homeroom_attendance_assist_settings': 'homeroom_att_assist_settings',
}

missing = [n for n in tables if n not in META]
if missing:
    print('警告：這些資料表沒有放進 META（會被忽略）：', missing, file=sys.stderr)

out = []
for n in order:
    if n not in META: continue
    dept, label, mode = META[n]
    t = tables[n]
    sheet = ALIAS.get(n, n)
    assert len(sheet) <= 31, (n, sheet)
    out.append({
        'table': n,
        'sheet': sheet,
        'label': label,
        'dept': dept,
        'mode': mode,
        'order': rank[n],
        'pk': t['pk'],
        'uniques': t['uniques'],
        'cols': t['cols'],
    })

# ---------- 後續 SQL（106 之後）才新增、不在 01_schema.sql 裡的資料表 ----------
# 01_schema.sql 是原始安裝檔，之後新增的表寫在 sql/108 等增補檔；這裡手動補上定義，
# 放在「學生出缺勤紀錄」後面，下載／上傳時跟出缺勤一起處理。
EXTRA_DEFS = [
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
    "notNull": True,
    "hasDefault": True
   },
   {
    "name": "class_id",
    "type": "uuid",
    "notNull": True,
    "hasDefault": False
   },
   {
    "name": "record_date",
    "type": "date",
    "notNull": True,
    "hasDefault": False
   },
   {
    "name": "period_no",
    "type": "int",
    "notNull": True,
    "hasDefault": False
   },
   {
    "name": "recorded_by",
    "type": "uuid",
    "notNull": False,
    "hasDefault": False
   },
   {
    "name": "first_recorded_at",
    "type": "ts",
    "notNull": True,
    "hasDefault": True
   },
   {
    "name": "last_recorded_at",
    "type": "ts",
    "notNull": True,
    "hasDefault": True
   }
  ]
 }
]
for extra in EXTRA_DEFS:
    idx = next((i for i, d in enumerate(out) if d['table'] == 'attendance'), len(out) - 1)
    out.insert(idx + 1, extra)

ts = '''// ============================================================
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

export const TABLE_DEFS: TableDef[] = ''' + json.dumps(out, ensure_ascii=False, indent=1) + ''';
'''

dest = os.path.join(ROOT, 'lib/deptTableDefs.ts')
open(dest, 'w', encoding='utf-8').write(ts)
print('已寫入', dest, '共', len(out), '張資料表')
