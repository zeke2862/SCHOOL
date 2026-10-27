"""
匯入舊備份時 curriculum 用「重複就略過」，但現在系統裡的科目列（排課匯入建立的）比重全是 0，
備份裡真正的科目比重因此沒有進來 → 總分算不出來（家長入口、成績表都看不到）。
這支把備份裡的科目比重補回「現在比重為 0（或空）」的科目列；已經有非 0 比重的不動。
用法： python fix_curriculum_weights.py <備份檔> [--apply]      （不加 --apply 只試算）
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
k = lambda r: (r['academic_year'], r['term'], r['grade_level'], r['subject'])
bk = {k(r): r for r in d['curriculum']}
print('備份科目列：', len(bk), '；備份中比重>0：', sum(1 for r in bk.values() if (r.get('weight') or 0) > 0))

cur = []
off = 0
while True:
    rows = requests.get(f'{URL}/curriculum?select=id,academic_year,term,grade_level,subject,weight,periods&limit=1000&offset={off}', headers=H, timeout=60).json()
    cur += rows
    if len(rows) < 1000:
        break
    off += 1000
print('現在科目列：', len(cur), '；比重>0：', sum(1 for r in cur if float(r['weight'] or 0) > 0))

fixed = same = missing = 0
for r in cur:
    if float(r['weight'] or 0) > 0:
        continue
    src = bk.get(k(r))
    if not src:
        missing += 1
        continue
    w = float(src.get('weight') or 0)
    if w <= 0:
        same += 1
        continue
    if APPLY:
        res = requests.patch(f'{URL}/curriculum?id=eq.{r["id"]}', headers=dict(H, Prefer='return=minimal'), data=json.dumps({'weight': w}), timeout=60)
        if res.status_code >= 300:
            print('  失敗', r['subject'], res.text[:120])
            continue
    fixed += 1
print(f'{"已補回" if APPLY else "可補回"} {fixed} 列；備份本身就是 0 的 {same} 列；備份裡找不到的 {missing} 列')
