// 回復腳本測試：載入 142+143 → 放入資料 → 回復 → 確認乾淨 → 再套用 143 仍然成功
import { PGlite } from '@electric-sql/pglite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SQL = path.join(HERE, '..', '..', 'sql') + path.sep;
const rd = (f) => fs.readFileSync(f, 'utf8');
const db = new PGlite();
let pass = 0, fail = 0;
const ok = (n, c, x = '') => { c ? pass++ : fail++; console.log(`${c ? 'PASS' : 'FAIL'}  ${n}${c ? '' : '  ← ' + x}`); };
const one = async (q) => (await db.query(q)).rows[0];

await db.exec(rd(path.join(HERE, 'stubs.sql')));
await db.exec(rd(SQL + '142_competition_guest_role.sql'));
await db.exec(rd(SQL + '143_competitions.sql'));
await db.exec(`
  insert into app_users (id, name, role) values ('00000000-0000-0000-0000-0000000000c1','訪客','competition_guest'),('00000000-0000-0000-0000-0000000000b2','李','subject_teacher');
  insert into teachers (id, app_user_id, name) values ('10000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-0000000000b2','李');
  insert into comp_events (title, created_by) values ('回復測試','00000000-0000-0000-0000-0000000000b2');
  insert into staff_notifications (teacher_id, category, message) values ('10000000-0000-0000-0000-000000000002','賽事通知','x'),('10000000-0000-0000-0000-000000000002','審核通知','保留');
`);
ok('回復前：有 comp 資料表、函式與訪客限制政策', (await one(`select count(*)::int n from pg_class where relname like 'comp\\_%' and relkind='r'`)).n === 11
  && (await one(`select count(*)::int n from pg_policies where policyname='comp_guest_block'`)).n > 0);

await db.exec(rd(SQL + '143_competitions_rollback.sql'));
ok('回復後：沒有 comp 資料表', (await one(`select count(*)::int n from pg_class where relname like 'comp\\_%' and relkind='r'`)).n === 0);
ok('回復後：沒有 comp / trg_comp 函式', (await one(`select count(*)::int n from pg_proc where proname like 'comp\\_%' or proname like 'trg\\_comp\\_%'`)).n === 0);
ok('回復後：訪客限制政策全部移除', (await one(`select count(*)::int n from pg_policies where policyname like 'comp\\_%'`)).n === 0);
ok('回復後：「賽事通知」被刪除、其他通知保留', (await one(`select count(*)::int n from staff_notifications`)).n === 1);
let bad = false;
try { await db.exec(`insert into staff_notifications (teacher_id, category, message) values ('10000000-0000-0000-0000-000000000002','賽事通知','x')`); } catch { bad = true; }
ok('回復後：通知類別限制已還原（不能再寫賽事通知）', bad);
ok('回復後：既有資料表與資料沒有被動到', (await one(`select count(*)::int n from app_users`)).n === 2 && (await one(`select count(*)::int n from teachers`)).n === 1);

await db.exec(rd(SQL + '143_competitions_rollback.sql'));
ok('回復腳本可重複執行', true);
await db.exec(rd(SQL + '143_competitions.sql'));
ok('回復後可以重新套用 143', (await one(`select count(*)::int n from pg_class where relname like 'comp\\_%' and relkind='r'`)).n === 11);

console.log(`\n結果：${pass} 通過 / ${fail} 失敗`);
process.exit(fail ? 1 : 0);
