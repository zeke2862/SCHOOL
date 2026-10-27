"""
匯入舊備份時，submission_windows（成績／出缺勤截止與鎖定）的班級層級設定 scope_ref 還是舊系統的班級 id，
對不到現在系統的班級，結果：期末考／平時分／總分在家長入口一直被視為「尚未鎖定」而不顯示。
這支把 scope_ref（班級層級）依「學年＋部別＋年級＋班別」對回現在的班級 id。
用法： python fix_window_class_ids.py <備份檔> [--apply]      （不加 --apply 只試算）
"""
import json, sys, io, os
import requests

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
BACKUP = sys.argv[1]
APPLY = '--apply' in sys.argv
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
key = lambda c: (c['academic_year'], c['department'], c['grade_level'], c['class_name'])
cur = requests.get(f'{URL}/classes?select=id,academic_year,department,grade_level,class_name&limit=1000', headers=H, timeout=60).json()
new_by_key = {key(c): c['id'] for c in cur}
cur_ids = {c['id'] for c in cur}
old_to_new = {c['id']: new_by_key[key(c)] for c in d['classes'] if key(c) in new_by_key}
print('舊→新 班級對照：', len(old_to_new), '/', len(d['classes']))


def fix(table, extra_filter):
    rows = requests.get(f'{URL}/{table}?select=*&{extra_filter}&limit=5000', headers=H, timeout=60).json()
    done = skipped = already = 0
    for r in rows:
        ref = r.get('scope_ref')
        if ref in cur_ids:
            already += 1
            continue
        new = old_to_new.get(ref)
        if not new:
            skipped += 1
            continue
        if APPLY:
            res = requests.patch(f'{URL}/{table}?id=eq.{r["id"]}', headers=dict(H, Prefer='return=minimal'), data=json.dumps({'scope_ref': new}), timeout=60)
            if res.status_code >= 300:
                print('  失敗', r['id'], res.text[:120])
                skipped += 1
                continue
        done += 1
    print(f'{table}: 已修正 {done}、本來就對 {already}、對不到略過 {skipped}（共 {len(rows)}）')


print('模式：', '【實際寫入】' if APPLY else '試算（沒有寫入）')
fix('submission_windows', 'scope=eq.%E7%8F%AD%E7%B4%9A')  # scope = 班級
fix('correction_requests', 'scope=eq.%E7%8F%AD%E7%B4%9A')
