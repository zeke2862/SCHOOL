"""
把舊系統的完整備份 JSON（backup-*.json）合併匯入「現在的」Supabase 專案。
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


# ---------------- 現況 ----------------
cur_teachers = get_all('teachers', 'id,name,app_user_id')
cur_classes = get_all('classes', 'id,academic_year,department,grade_level,class_name,homeroom_teacher_id')
cur_students = {s['student_no'] for s in get_all('students', 'student_no')}
cur_enr = get_all('enrollments', 'id,student_no,class_id,term,seat_no')

# ---------------- 1. 教師：同名對到現有的，沒有的新增（不連結登入帳號） ----------------
tname = {t['name']: t['id'] for t in cur_teachers}
tmap = {}
new_teachers = []
for t in d['teachers']:
    if t['name'] in tname:
        tmap[t['id']] = tname[t['name']]
    else:
        tmap[t['id']] = t['id']
        new_teachers.append({'id': t['id'], 'name': t['name'], 'app_user_id': None})
        tname[t['name']] = t['id']
log['teachers 新增'] = post('teachers', new_teachers, 'id')
T = lambda x: tmap.get(x) if x else None

# ---------------- 2. 班級 ----------------
ckey = lambda c: (c['academic_year'], c['department'], c['grade_level'], c['class_name'])
cmap_existing = {ckey(c): c for c in cur_classes}
cmap = {}
new_classes, fill_homeroom = [], []
for c in d['classes']:
    ex = cmap_existing.get(ckey(c))
    if ex:
        cmap[c['id']] = ex['id']
        if not ex['homeroom_teacher_id'] and c.get('homeroom_teacher_id') and T(c['homeroom_teacher_id']):
            fill_homeroom.append((ex['id'], T(c['homeroom_teacher_id'])))
    else:
        cmap[c['id']] = c['id']
        new_classes.append({'id': c['id'], 'class_name': c['class_name'], 'academic_year': c['academic_year'], 'department': c['department'],
                            'grade_level': c['grade_level'], 'homeroom_teacher_id': T(c.get('homeroom_teacher_id'))})
log['classes 新增'] = post('classes', new_classes, 'id')
if APPLY:
    for cid, tid in fill_homeroom:
        requests.patch(f'{URL}/classes?id=eq.{cid}&homeroom_teacher_id=is.null', headers=dict(H, Prefer='return=minimal'), data=json.dumps({'homeroom_teacher_id': tid}), timeout=60)
log['classes 補導師'] = len(fill_homeroom)

# ---------------- 3. 學生 ----------------
SCOLS = ['student_no', 'name', 'gender', 'thai_name', 'dob', 'id_number', 'nationality', 'religion', 'blood_type', 'address', 'phone', 'photo_url',
         'previous_school', 'previous_school_grade', 'updated_at']
new_students = [keep(s, SCOLS) for s in d['students'] if s['student_no'] not in cur_students]
log['students 新增'] = post('students', new_students, 'student_no')
all_students = cur_students | {s['student_no'] for s in new_students}

# ---------------- 4. 編班 ----------------
ekey = lambda e: (e['student_no'], e['class_id'], e['term'])
cur_e = {ekey(e): e['id'] for e in cur_enr}
cur_seats = {(e['class_id'], e['term'], e['seat_no']) for e in cur_enr}
emap, new_enr = {}, []
for e in d['enrollments']:
    cid = cmap.get(e['class_id'])
    if not cid or e['student_no'] not in all_students:
        continue
    k = (e['student_no'], cid, e['term'])
    if k in cur_e:
        emap[e['id']] = cur_e[k]
    elif (cid, e['term'], e['seat_no']) in cur_seats:
        failed['enrollments'].append(('座號與現有編班衝突，略過', {'student_no': e['student_no'], 'seat_no': e['seat_no']}))
    else:
        emap[e['id']] = e['id']
        cur_seats.add((cid, e['term'], e['seat_no']))
        new_enr.append({'id': e['id'], 'student_no': e['student_no'], 'class_id': cid, 'term': e['term'], 'seat_no': e['seat_no'],
                        'is_current': e['is_current'], 'created_at': e['created_at']})
log['enrollments 新增'] = post('enrollments', new_enr, 'id')

# ---------------- 5. 成績、操行、評語 ----------------
scores = [{'id': s['id'], 'enrollment_id': emap[s['enrollment_id']], 'exam_type': s['exam_type'], 'subject': s['subject'], 'score': s['score'],
           'recorded_by': T(s.get('recorded_by')), 'updated_at': s['updated_at']} for s in d['scores'] if s['enrollment_id'] in emap]
log['scores 新增'] = post('scores', scores, 'enrollment_id,exam_type,subject', 2000)
cs = [dict(keep(x, ['politeness', 'dress', 'service', 'discipline', 'updated_at']), enrollment_id=emap[x['enrollment_id']], updated_by=T(x.get('updated_by')))
      for x in d['conduct_scores'] if x['enrollment_id'] in emap]
log['conduct_scores 新增'] = post('conduct_scores', cs, 'enrollment_id', 2000)
sr = [dict(keep(x, ['comment', 'updated_at']), enrollment_id=emap[x['enrollment_id']], updated_by=T(x.get('updated_by'))) for x in d['student_remarks'] if x['enrollment_id'] in emap]
log['student_remarks 新增'] = post('student_remarks', sr, 'enrollment_id')

# ---------------- 6. 出缺席：新系統只存「非出席」；「這節有點名」另存 roll call ----------------
PRESENT = '出席'
exc = [{'id': a['id'], 'student_no': a['student_no'], 'record_date': a['record_date'], 'period_no': a['period_no'], 'status': a['status'],
        'recorded_by': T(a.get('recorded_by')), 'updated_at': a['updated_at']}
       for a in d['attendance'] if a['status'] != PRESENT and a['student_no'] in all_students]
log['attendance(非出席) 新增'] = post('attendance', exc, 'student_no,record_date,period_no', 2000)
log['attendance 略過(出席列)'] = sum(1 for a in d['attendance'] if a['status'] == PRESENT)

# roll call：學生→班級（用該學期編班），每個(班級,日期,節次)一列
stu_cls = {}
for e in sorted(d['enrollments'], key=lambda e: (e['is_current'] is True, e['created_at'])):
    if cmap.get(e['class_id']):
        stu_cls[e['student_no']] = cmap[e['class_id']]
rc = {}
for a in d['attendance']:
    c = stu_cls.get(a['student_no'])
    if not c:
        continue
    k = (c, a['record_date'], a['period_no'])
    cur = rc.get(k)
    if not cur:
        rc[k] = {'class_id': c, 'record_date': a['record_date'], 'period_no': a['period_no'], 'recorded_by': T(a.get('recorded_by')),
                 'first_recorded_at': a['updated_at'], 'last_recorded_at': a['updated_at']}
    else:
        cur['first_recorded_at'] = min(cur['first_recorded_at'], a['updated_at'])
        cur['last_recorded_at'] = max(cur['last_recorded_at'], a['updated_at'])
        cur['recorded_by'] = cur['recorded_by'] or T(a.get('recorded_by'))
log['attendance_roll_calls 新增'] = post('attendance_roll_calls', list(rc.values()), 'class_id,record_date,period_no', 2000)

# ---------------- 7. 其他跟學生有關的紀錄 ----------------
log['attendance_notifications'] = post('attendance_notifications', [dict(keep(x, ['id', 'student_no', 'absence_count', 'threshold_snapshot', 'decision', 'note', 'created_at']), decided_by=T(x.get('decided_by')))
                                                                    for x in d['attendance_notifications'] if x['student_no'] in all_students], 'id')
log['conduct_events'] = post('conduct_events', [dict(keep(x, ['id', 'student_no', 'event_date', 'event_type', 'points', 'reason', 'created_at', 'count']), recorded_by=T(x.get('recorded_by')))
                                               for x in d['conduct_events'] if x['student_no'] in all_students], 'student_no,event_date,event_type')
log['guardians'] = post('guardians', [keep(x, ['id', 'student_no', 'relation', 'name', 'chinese_name', 'occupation', 'phone', 'email', 'address']) for x in d['guardians'] if x['student_no'] in all_students], 'id')
log['student_status_changes'] = post('student_status_changes', [dict(keep(x, ['id', 'student_no', 'status', 'effective_date', 'reason', 'created_at']), changed_by=None)
                                                                for x in d['student_status_changes'] if x['student_no'] in all_students], 'id')
log['profile_edit_requests'] = post('profile_edit_requests', [dict(keep(x, ['id', 'student_no', 'field_name', 'old_value', 'new_value', 'requested_at', 'status', 'reviewed_at', 'target_table', 'guardian_id']), requested_by=None, reviewed_by=None)
                                                              for x in d['profile_edit_requests'] if x['student_no'] in all_students], 'id')
log['staff_notifications'] = post('staff_notifications', [dict(keep(x, ['id', 'category', 'message', 'student_no', 'created_at', 'read_at']), teacher_id=T(x['teacher_id']))
                                                          for x in d['staff_notifications'] if T(x.get('teacher_id')) and (not x.get('student_no') or x['student_no'] in all_students)], 'id')
log['correction_requests'] = post('correction_requests', [dict(keep(x, ['id', 'data_type', 'record_id', 'reason', 'status', 'reviewed_at', 'created_at', 'scope', 'scope_ref', 'academic_year']), requested_by=T(x['requested_by']), reviewed_by=None)
                                                          for x in d['correction_requests'] if T(x.get('requested_by'))], 'id')

# ---------------- 8. 課程、成績規則、時段、截止日 ----------------
log['curriculum'] = post('curriculum', [keep(x, ['id', 'academic_year', 'term', 'grade_level', 'subject', 'weight', 'periods']) for x in d['curriculum']], 'academic_year,term,grade_level,subject')
log['grading_rules'] = post('grading_rules', [keep(x, ['academic_year', 'term', 'midterm_weight', 'final_weight', 'daily_weight']) for x in d['grading_rules']], 'academic_year,term')
log['conduct_point_defaults'] = post('conduct_point_defaults', [keep(x, ['item', 'points']) for x in d['conduct_point_defaults']], 'item')
log['submission_windows'] = post('submission_windows', [dict(keep(x, ['id', 'academic_year', 'term', 'data_type', 'scope', 'scope_ref', 'opens_at', 'closes_at', 'is_locked']), set_by=None) for x in d['submission_windows']],
                                 'academic_year,term,data_type,scope,scope_ref')
for x in d['period_config']:  # 兩個部分唯一索引，無法用 on_conflict，逐筆
    row = keep(x, ['scope', 'scope_ref', 'weekday', 'period_count'])
    if APPLY:
        r = requests.post(f'{URL}/period_config', headers=dict(H, Prefer='return=minimal'), data=json.dumps([row]), timeout=60)
        if r.status_code >= 300 and 'duplicate' not in r.text:
            failed['period_config'].append((r.text[:120], row))
log['period_config(逐筆嘗試)'] = len(d['period_config'])

# ---------------- 9. 課表：不匯入（現在系統已有重新上傳的上學期課表，備份裡的任課設定又有大量重複列） ----------------
log['class_schedule'] = '略過（現有課表優先）'

# ---------------- 10. 社團、代課 ----------------
log['clubs'] = post('clubs', [dict(keep(x, ['id', 'name', 'academic_year', 'term', 'external_teacher_name', 'capacity', 'period_no', 'description', 'is_active', 'created_at']), teacher_id=T(x.get('teacher_id')), created_by=None)
                              for x in d['clubs']], 'name,academic_year,term')
log['substitute_assignments'] = post('substitute_assignments', [dict(keep(x, ['id', 'academic_year', 'term', 'weekday', 'period_no', 'subject', 'substitute_date', 'reason', 'status']), class_id=cmap.get(x['class_id']),
                                                                      original_teacher_id=T(x['original_teacher_id']), substitute_teacher_id=T(x.get('substitute_teacher_id')), created_by=None)
                                                                 for x in d['substitute_assignments'] if cmap.get(x['class_id']) and T(x['original_teacher_id'])], 'id')

print('模式：', '【實際寫入】' if APPLY else '試算（沒有寫入任何資料）')
for k, v in log.items():
    print(f'  {k}: {v}')
if failed:
    print('\n失敗／略過的資料：')
    for t, items in failed.items():
        print(f'  {t}: {len(items)} 筆')
        for m, r in items[:5]:
            print('     ', m, r)
