"""
把「帳號.xlsx」(姓名, 電子郵件, 角色, 初始密碼) 批次建立成可登入的帳號（作法與 app/api/admin/invite-user 相同）：
  1. 用管理員權限建立登入帳號（信箱視為已驗證，不寄信）
  2. 寫入 app_users（姓名、角色）
  3. 連結同名的教師資料；找不到任何相近的才新建一筆
密碼從環境變數 ACCOUNT_PASSWORD 讀取（不寫在檔案裡）。
用法：  python import_accounts.py 帳號.json [--apply] [--skip 姓名,姓名]
        （帳號.json 由 node 先把 xlsx 轉成 [[姓名,信箱,角色],...]）
"""
import json, os, sys, io, unicodedata, requests

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
APPLY = '--apply' in sys.argv
skip = set()
if '--skip' in sys.argv:
    skip = set(sys.argv[sys.argv.index('--skip') + 1].split(','))
ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..') + '/'
env = {}
for l in open(ROOT + '.env.local', encoding='utf8'):
    l = l.strip()
    if '=' in l and not l.startswith('#'):
        k, v = l.split('=', 1)
        env[k] = v
BASE = env['NEXT_PUBLIC_SUPABASE_URL'].rstrip('/')
KEY = env['SUPABASE_SERVICE_ROLE_KEY']
H = {'apikey': KEY, 'Authorization': 'Bearer ' + KEY, 'Content-Type': 'application/json'}
PASSWORD = os.environ.get('ACCOUNT_PASSWORD', '')
rows = json.load(open(sys.argv[1], encoding='utf8'))
TEACHER_ROLES = {'homeroom_teacher', 'subject_teacher'}


# 名單上的異體字／簡體字與教師資料裡的寫法不同（確認是同一人）
VARIANT = {'鄭娱智': '鄭娛智', '馬赛玉': '馬賽玉'}


def norm(s):
    return ''.join(unicodedata.normalize('NFKC', VARIANT.get(s, s) or '').split()).lower()


def rest(method, path, headers=None, **kw):
    return requests.request(method, BASE + path, headers=headers or H, timeout=60, **kw)


teachers = rest('GET', '/rest/v1/teachers?select=id,name,app_user_id&limit=2000').json()
unlinked = [t for t in teachers if not t['app_user_id']]
existing_users = {u['name'] for u in rest('GET', '/rest/v1/app_users?select=name&limit=2000').json()}
force = rest('GET', '/rest/v1/password_policy_settings?select=force_change_on_first_login&limit=1').json()
must_change = bool(force and force[0]['force_change_on_first_login'])

sheet_emails = {e.lower() for _, e, *_ in rows}
app_ids = {u['id'] for u in rest('GET', '/rest/v1/app_users?select=id&limit=2000').json()}
orphans = [u for u in rest('GET', '/auth/v1/admin/users?per_page=1000').json().get('users', []) if (u.get('email') or '').lower() in sheet_emails and u['id'] not in app_ids]
if orphans:
    print('發現', len(orphans), '個名單上信箱的孤兒登入帳號（沒有 app_users），', '重建' if APPLY else '將重建')
    if APPLY:
        for u in orphans:
            rest('DELETE', f"/auth/v1/admin/users/{u['id']}")

plan, report = [], {'建立': 0, '連結教師': 0, '新建教師': 0, '略過': [], '失敗': [], '需人工確認教師': []}
for name, email, role, *_ in rows:
    if name in skip:
        report['略過'].append(f'{name}（依指示略過）')
        continue
    exact = [t for t in unlinked if norm(t['name']) == norm(name)]
    fuzzy = [t for t in unlinked if len(norm(name)) >= 2 and len(norm(t['name'])) >= 2 and (norm(t['name']) in norm(name) or norm(name) in norm(t['name']))]
    plan.append((name, email, role, exact, fuzzy))

print('模式：', '【實際建立】' if APPLY else '試算（沒有建立任何帳號）', '／要建立', len(plan), '位')
for name, email, role, exact, fuzzy in plan:
    tag = '連結同名教師' if exact else ('連結相近教師：' + fuzzy[0]['name'] if len(fuzzy) == 1 else ('相近教師需人工確認：' + '、'.join(t['name'] for t in fuzzy) if fuzzy else '新建教師資料'))
    print(f'  {name:<14} {role:<18} {tag}')
if not APPLY:
    sys.exit(0)
if len(PASSWORD) < 6:
    sys.exit('環境變數 ACCOUNT_PASSWORD 未設定或少於 6 碼')

for name, email, role, exact, fuzzy in plan:
    r = rest('POST', '/auth/v1/admin/users', data=json.dumps({'email': email, 'password': PASSWORD, 'email_confirm': True}))
    if r.status_code >= 300:
        report['失敗'].append(f'{name}：建立登入帳號失敗 {r.status_code} {r.text[:80]}')
        continue
    uid = r.json()['id']
    r2 = rest('POST', '/rest/v1/app_users', headers=dict(H, Prefer='return=minimal'), data=json.dumps({'id': uid, 'name': name, 'role': role, 'must_change_password': must_change}))
    if r2.status_code >= 300:
        rest('DELETE', f'/auth/v1/admin/users/{uid}')  # 復原，避免孤兒登入帳號
        report['失敗'].append(f'{name}：寫入 app_users 失敗，已復原 {r2.text[:80]}')
        continue
    report['建立'] += 1
    if exact or len(fuzzy) == 1:
        t = (exact or fuzzy)[0]
        rest('PATCH', f"/rest/v1/teachers?id=eq.{t['id']}", headers=dict(H, Prefer='return=minimal'), data=json.dumps({'app_user_id': uid}))
        unlinked.remove(t)
        report['連結教師'] += 1
    elif fuzzy:
        report['需人工確認教師'].append(f"{name} ↔ {'、'.join(t['name'] for t in fuzzy)}")
    elif role in TEACHER_ROLES:
        rest('POST', '/rest/v1/teachers', headers=dict(H, Prefer='return=minimal'), data=json.dumps({'name': name.strip(), 'app_user_id': uid}))
        report['新建教師'] += 1

print('\n結果：')
for k, v in report.items():
    print(f'  {k}: {v if not isinstance(v, list) else (len(v), v)}')
