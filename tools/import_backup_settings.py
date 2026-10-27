"""
【第二支】把舊備份裡的系統設定、公佈欄、教師資料、庫存補匯入（先跑 import_backup.py）。
原則：只新增、不刪除、不覆蓋現有資料；對不上的欄位（登入帳號、*_by）一律清成空值。
用法： python import_backup.py <備份檔> [--apply]      （不加 --apply 只做試算，不寫入）
"""
import json, sys, time, collections, io
import requests

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
BACKUP = sys.argv[1]
APPLY = '--apply' in sys.argv
import os
ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..') + '/'

env = {}
for l in open(ROOT + '.env.local', encoding='utf8'):
    l = l.strip()
    if '=' in l and not l.startswith('#'):
        k, v = l.split('=', 1)
        env[k] = v
URL = env['NEXT_PUBLIC_SUPABASE_URL'].rstrip('/') + '/rest/v1'
KEY = env['SUPABASE_SERVICE_ROLE_KEY']
H = {'apikey': KEY, 'Authorization': 'Bearer ' + KEY, 'Content-Type': 'application/json'}

d = json.load(open(BACKUP, encoding='utf8'))
log = collections.OrderedDict()
failed = collections.defaultdict(list)


def get_all(table, select='*', extra=''):
    out, off = [], 0
    while True:
        r = requests.get(f'{URL}/{table}?select={select}{extra}&limit=1000&offset={off}', headers=H, timeout=120)
        r.raise_for_status()
        rows = r.json()
        out += rows
        if len(rows) < 1000:
            return out
        off += 1000


def post(table, rows, on_conflict=None, size=1000):
    """分批寫入；遇到重複就略過。整批失敗時退回逐筆，找出是哪幾筆有問題。回傳實際送出的筆數。"""
    if not rows:
        return 0
    if not APPLY:
        return len(rows)
    params = '?on_conflict=' + on_conflict if on_conflict else ''
    hdr = dict(H, Prefer='resolution=ignore-duplicates,return=minimal' if on_conflict else 'return=minimal')
    sent = 0
    for i in range(0, len(rows), size):
        part = rows[i:i + size]
        r = requests.post(f'{URL}/{table}{params}', headers=hdr, data=json.dumps(part, ensure_ascii=False).encode('utf8'), timeout=300)
        if r.status_code < 300:
            sent += len(part)
            continue
        for row in part:  # 逐筆
            r1 = requests.post(f'{URL}/{table}{params}', headers=hdr, data=json.dumps([row], ensure_ascii=False).encode('utf8'), timeout=60)
            if r1.status_code < 300:
                sent += 1
            else:
                failed[table].append((r1.text[:160], {k: row.get(k) for k in list(row)[:4]}))
    return sent


def keep(row, cols, nulls=(), maps=None):
    """只留下現在資料表有的欄位；nulls 的欄位清成 None；maps = {欄位: 對照表函式}"""
    o = {c: row.get(c) for c in cols if c in row}
    for c in nulls:
        if c in o:
            o[c] = None
    for c, f in (maps or {}).items():
        if c in o:
            o[c] = f(o[c])
    return o



def count(table):
    return len(get_all(table, '*'))


def singleton(table, cols):
    """只有一列的設定表：現有有資料就更新那一列，沒有就新增。回傳 1/0"""
    rows = d.get(table) or []
    if not rows:
        return 0
    vals = keep(rows[0], cols, nulls=('updated_by',))
    cur = get_all(table, '*')
    if not APPLY:
        return 1
    if cur:
        pk = 'id' if 'id' in cur[0] else None
        r = requests.patch(f"{URL}/{table}?{pk}=eq.{cur[0][pk]}", headers=dict(H, Prefer='return=minimal'), data=json.dumps(vals, ensure_ascii=False).encode('utf8'), timeout=60)
    else:
        r = requests.post(f"{URL}/{table}", headers=dict(H, Prefer='return=minimal'), data=json.dumps([vals], ensure_ascii=False).encode('utf8'), timeout=60)
    if r.status_code >= 300:
        failed[table].append((r.text[:160], {}))
        return 0
    return 1


# 系統設定（單列）
log['teacher_letter_settings'] = singleton('teacher_letter_settings', ['school_name_zh', 'principal_name', 'chairman_name', 'phone', 'address', 'updated_at'])
log['portal_login_settings'] = singleton('portal_login_settings', ['email_verification_enabled', 'updated_at'])
log['password_policy_settings'] = singleton('password_policy_settings', ['force_change_on_first_login', 'updated_at'])
log['teacher_login_settings'] = singleton('teacher_login_settings', ['home_path', 'updated_at'])
log['attendance_score_display_settings'] = singleton('attendance_score_display_settings', ['exclude_attendance_from_partial_scores', 'updated_at'])
log['attendance_alert_settings'] = singleton('attendance_alert_settings', ['threshold_periods', 'exam_deduction_absence_threshold', 'backfill_overdue_days', 'updated_at'])

# 網站文字、設定值、模組排序與分類（現有有的不動，只補沒有的）
log['site_content'] = post('site_content', [dict(keep(x, ['content_key', 'content_value', 'updated_at']), updated_by=None) for x in d['site_content']], 'content_key')
log['site_settings'] = post('site_settings', [dict(keep(x, ['setting_key', 'setting_value', 'updated_at']), updated_by=None) for x in d['site_settings']], 'setting_key')
log['admin_module_order'] = post('admin_module_order', [dict(keep(x, ['module_key', 'sort_order', 'updated_at']), updated_by=None) for x in d['admin_module_order']], 'module_key')
log['admin_module_categories'] = post('admin_module_categories', [dict(keep(x, ['module_key', 'category', 'updated_at']), updated_by=None) for x in d['admin_module_categories']], 'module_key,category')

# 公佈欄
log['bulletin_posts'] = post('bulletin_posts', [dict(keep(x, ['id', 'title', 'thumbnail_url', 'content', 'is_published', 'published_at', 'created_at', 'updated_at']), created_by=None) for x in d['bulletin_posts']], 'id')

# 教師資料（服務證明、聘書）
CERT = ['id', 'seq_no', 'self_hired', 'resigned', 'name', 'birth_date', 'nationality', 'gender', 'department', 'title', 'start_date_1', 'end_date_1',
        'start_date_2', 'end_date_2', 'start_date_3', 'end_date_3', 'note', 'created_at', 'updated_at']
log['teacher_service_certificates'] = post('teacher_service_certificates', [dict(keep(x, CERT), created_by=None) for x in d['teacher_service_certificates']], 'id')
LET = ['id', 'category', 'seq_no', 'name', 'title', 'gender', 'term_no', 'start_date', 'end_date', 'resigned', 'issued_date', 'note', 'created_at', 'updated_at']
log['teacher_appointment_letters'] = post('teacher_appointment_letters', [dict(keep(x, LET), created_by=None) for x in d['teacher_appointment_letters']], 'id')

# 總務庫存（品項先、異動後；現有庫存量由資料庫觸發器依異動重算）
log['general_inventory_items'] = post('general_inventory_items', [dict(keep(x, ['id', 'category', 'name', 'spec', 'unit', 'unit_price', 'quantity_on_hand', 'note', 'created_at', 'low_stock_threshold']), created_by=None)
                                                                 for x in d['general_inventory_items']], 'id')
item_ids = {r['id'] for r in get_all('general_inventory_items', 'id')} if APPLY else {x['id'] for x in d['general_inventory_items']}
log['general_inventory_transactions'] = post('general_inventory_transactions', [dict(keep(x, ['id', 'item_id', 'direction', 'quantity', 'unit_price_at_time', 'counterparty', 'note', 'recorded_at']), recorded_by=None)
                                                                               for x in d['general_inventory_transactions'] if x['item_id'] in item_ids], 'id', 500)

# 成績上傳開關的修改紀錄（對不到的送審時段，window_id 清空）
win_ids = {r['id'] for r in get_all('submission_windows', 'id')}
log['submission_window_audit_log'] = post('submission_window_audit_log', [dict(keep(x, ['id', 'academic_year', 'term', 'data_type', 'scope', 'scope_ref', 'old_is_locked', 'new_is_locked', 'old_closes_at', 'new_closes_at', 'changed_at', 'reason']),
                                                                              window_id=x.get('window_id') if x.get('window_id') in win_ids else None, changed_by=None)
                                                          for x in d['submission_window_audit_log']], 'id')

print('模式：', '【實際寫入】' if APPLY else '試算（沒有寫入任何資料）')
for k, v in log.items():
    print(f'  {k}: {v}')
if failed:
    print('失敗／略過的資料：')
    for t, items in failed.items():
        print(f'  {t}: {len(items)} 筆')
        for m, r in items[:5]:
            print('     ', m, r)
