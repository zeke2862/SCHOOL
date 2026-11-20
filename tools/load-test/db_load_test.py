#!/usr/bin/env python3
"""
校務系統資料庫並發壓力測試（模擬全校 N 位導師同時使用）

為什麼測資料庫、不測網頁？
  這套系統前端直接用 Supabase（PostgREST + 權限政策 RLS）查資料，真正的瓶頸在資料庫。
  本腳本以「真實導師的身分」（SET LOCAL ROLE authenticated + JWT claims）執行和網頁一樣的查詢，
  所以會完整經過權限政策，不需要任何人的密碼或登入權杖。

安全設計：
  * 全程唯讀；「儲存點名」情境是在交易內寫入後 ROLLBACK，資料庫不留任何痕跡。
  * 分段升壓（預設 10 → 25 → 50 → 100 人），任何一段錯誤率或 p95 超標就自動停止。
  * 同時使用的資料庫連線數有上限（--pool，預設 20），不會把 max_connections(60) 吃光。
  * 請在「非上課時間」、最好對「測試用副本」執行。對正式站請加 --i-know-this-hits-production。

用法（PowerShell）：
  # 先在 .env.local 補上真正的連線字串（Supabase 後台 → Project Settings → Database → Connection string，
  # 建議用 Session pooler），格式 postgresql://postgres.xxxx:密碼@aws-0-xxx.pooler.supabase.com:5432/postgres
  python tools/load-test/db_load_test.py --stages 10,25,50,100 --duration 60 --think 5 --pool 20 --i-know-this-hits-production

  # 極限測試：沒有思考時間，大家同時按下「儲存」
  python tools/load-test/db_load_test.py --stages 25,50,100 --duration 30 --think 0 --burst-save --i-know-this-hits-production
"""
import argparse, os, random, statistics, sys, threading, time
from collections import defaultdict

try:
    import psycopg2
    from psycopg2.pool import ThreadedConnectionPool
except ImportError:
    sys.exit('需要 psycopg2：pip install psycopg2-binary')


def load_dsn():
    dsn = os.environ.get('DATABASE_URL', '')
    if not dsn:
        here = os.path.dirname(os.path.abspath(__file__))
        for p in (os.path.join(here, '..', '..', '.env.local'),):
            if os.path.exists(p):
                for line in open(p, encoding='utf-8', errors='ignore'):
                    if line.startswith('DATABASE_URL='):
                        dsn = line.split('=', 1)[1].strip().strip('"')
    if not dsn.startswith(('postgres://', 'postgresql://')):
        sys.exit('找不到有效的 DATABASE_URL（需以 postgresql:// 開頭）。請先設定連線字串。')
    return dsn


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--stages', default='10,25,50,100', help='各階段同時上線的虛擬教師數')
    ap.add_argument('--duration', type=int, default=60, help='每階段秒數')
    ap.add_argument('--think', type=float, default=5.0, help='每次操作間的思考時間（秒，隨機 0.5~1.5 倍）')
    ap.add_argument('--pool', type=int, default=20, help='同時使用的資料庫連線上限')
    ap.add_argument('--n1', type=int, default=0, help='模擬現行「每位學生各查一次缺課統計」的次數（現況每次儲存平均約 29 次）')
    ap.add_argument('--burst-save', action='store_true', help='每回合都做「儲存點名」（交易內寫入後回滾）')
    ap.add_argument('--abort-p95-ms', type=int, default=20000)
    ap.add_argument('--abort-err-rate', type=float, default=0.2)
    ap.add_argument('--i-know-this-hits-production', action='store_true')
    a = ap.parse_args()
    if not a.i_know_this_hits_production:
        sys.exit('為避免誤對正式站施壓，請加上 --i-know-this-hits-production 確認。')

    dsn = load_dsn()
    pool = ThreadedConnectionPool(1, a.pool, dsn, options='-c statement_timeout=15000')
    c = pool.getconn(); cur = c.cursor()
    cur.execute("""select t.app_user_id::text, t.id::text, c.id::text,
                          (select array_agg(student_no) from enrollments e where e.class_id=c.id and e.is_current)
                   from teachers t join classes c on c.homeroom_teacher_id=t.id
                   where t.app_user_id is not null""")
    teachers = cur.fetchall(); c.rollback(); pool.putconn(c)
    if not teachers:
        sys.exit('查不到導師資料')
    print(f'載入 {len(teachers)} 位導師作為模擬身分；連線池上限 {a.pool}')

    def one_round(conn, uid, tid, cid, sns, stats):
        cur = conn.cursor()
        def timed(name, sql, args=None):
            t0 = time.perf_counter()
            try:
                cur.execute(sql, args); cur.fetchall()
                stats[name].append((time.perf_counter() - t0) * 1000)
            except Exception as e:
                conn.rollback(); stats[name + '#ERR'].append(1)
                cur.execute('begin'); setup(cur, uid)
        def setup(cur, uid):
            cur.execute("set local role authenticated")
            cur.execute("select set_config('request.jwt.claims', json_build_object('sub',%s::text,'role','authenticated')::text, true)", (uid,))
        cur.execute('begin'); setup(cur, uid)
        timed('identity', 'select public.my_effective_identity()')
        timed('notif_poll', 'select id,category,created_at from staff_notifications where teacher_id=%s and read_at is null order by created_at desc limit 20', (tid,))
        timed('roster', "select e.id,e.seat_no,row_to_json(s) from enrollments e left join lateral (select name,gender from students s where s.student_no=e.student_no) s on true where e.class_id=%s and e.is_current order by e.seat_no", (cid,))
        timed('att_week', "select student_no,status from attendance where student_no = any(%s) and record_date between current_date-7 and current_date", (sns,))
        if a.burst_save:
            cur.execute('savepoint sp')
            t0 = time.perf_counter()
            try:
                cur.execute("""insert into attendance(student_no,record_date,period_no,status,recorded_by)
                               select student_no,current_date,1,'出席',%s from enrollments where class_id=%s and is_current
                               on conflict (student_no,record_date,period_no) do update set status=excluded.status,updated_at=now()""", (tid, cid))
                stats['save_class'].append((time.perf_counter() - t0) * 1000)
            except Exception:
                stats['save_class#ERR'].append(1)
            for s in random.sample(sns, min(a.n1, len(sns))):
                timed('absence_check', 'select absence_periods from student_absence_counts where student_no=%s', (s,))
        conn.rollback()  # 一律回滾：不留任何資料

    def vu(stop, stats, lock):
        while not stop.is_set():
            uid, tid, cid, sns = random.choice(teachers)
            local = defaultdict(list)
            t0 = time.perf_counter()
            conn = pool.getconn()          # 排隊等連線 = 現實中 PostgREST 連線池的情況
            wait = (time.perf_counter() - t0) * 1000
            try:
                one_round(conn, uid, tid, cid, sns or [], local)
            finally:
                try: conn.rollback()
                except Exception: pass
                pool.putconn(conn)
            local['pool_wait'].append(wait)
            local['round_total'].append((time.perf_counter() - t0) * 1000)
            with lock:
                for k, v in local.items(): stats[k].extend(v)
            if a.think > 0:
                time.sleep(a.think * random.uniform(0.5, 1.5))

    def pct(v, p):
        v = sorted(v); return v[min(len(v) - 1, int(len(v) * p))] if v else float('nan')

    for n in [int(x) for x in a.stages.split(',')]:
        stats, lock, stop = defaultdict(list), threading.Lock(), threading.Event()
        ths = [threading.Thread(target=vu, args=(stop, stats, lock), daemon=True) for _ in range(n)]
        t0 = time.time()
        for t in ths: t.start(); time.sleep(0.05)
        time.sleep(a.duration); stop.set()
        for t in ths: t.join(timeout=30)
        rounds = len(stats['round_total']); errs = sum(len(v) for k, v in stats.items() if k.endswith('#ERR'))
        print(f"\n=== {n} 位教師同時上線 / {time.time()-t0:.0f}s / 完成 {rounds} 回合 / 錯誤 {errs} ===")
        print(f"{'步驟':<14}{'次數':>7}{'p50 ms':>10}{'p95 ms':>10}{'max ms':>10}")
        for k in ['identity', 'notif_poll', 'roster', 'att_week', 'save_class', 'absence_check', 'pool_wait', 'round_total']:
            v = stats.get(k)
            if v: print(f'{k:<14}{len(v):>7}{statistics.median(v):>10.0f}{pct(v,0.95):>10.0f}{max(v):>10.0f}')
        p95 = pct(stats['round_total'], 0.95)
        if (rounds and errs / max(1, rounds) > a.abort_err_rate) or p95 > a.abort_p95_ms:
            print(f'!! 觸發保護機制（錯誤率或 p95 超標），停止更高人數的測試。這就是目前的承載上限。')
            break
    pool.closeall()


if __name__ == '__main__':
    main()
