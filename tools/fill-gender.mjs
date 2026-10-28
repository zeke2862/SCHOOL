// 依學號規則補填 students.gender（預設 dry-run，只輸出清單；加 --apply 才寫入）
//   node tools/fill-gender.mjs <輸出資料夾> [--apply]
// 規則：
//   6 碼學號：第 3 碼 1＝男、2＝女。
//   3～4 碼舊學號：看「上學期」各班座號順序（就是舊名單：舊男生 → 6 碼男生 → 舊女生 → 6 碼女生）。
//     排在班上所有 6 碼學號之前、且後面接的是 6 碼男生 → 男；
//     前面已出現過 6 碼學號、且後面沒有再接 6 碼男生 → 女；其他情況不猜，列為「無法判斷」。
//   已有性別的不覆蓋；與推斷不同的列為「衝突」。--apply 時先把原值備份成 JSON。
import fs from 'node:fs';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';

const outDir = process.argv[2];
const apply = process.argv.includes('--apply');
if (!outDir) throw new Error('用法：node tools/fill-gender.mjs <輸出資料夾> [--apply]');

const env = Object.fromEntries(
  fs.readFileSync('.env.local', 'utf8').split(/\r?\n/).filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()])
);
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

async function all(table, cols, filter = (q) => q) {
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await filter(db.from(table).select(cols)).order('id').range(from, from + 999);
    if (error) throw error;
    rows.push(...data);
    if (data.length < 1000) return rows;
  }
}

const students = [];
for (let from = 0; ; from += 1000) {
  const { data, error } = await db.from('students').select('student_no, name, gender').order('student_no').range(from, from + 999);
  if (error) throw error;
  students.push(...data);
  if (data.length < 1000) break;
}
const enrolls = await all('enrollments', 'id, student_no, class_id, seat_no, term, is_current', (q) => q.in('term', ['上學期', '下學期']));
const classes = await all('classes', 'id, academic_year, grade_level, class_name');
const classLabel = Object.fromEntries(classes.map((c) => [c.id, `${c.grade_level}${c.class_name}`]));

const d3 = (no) => (/^\d{6}$/.test(no) ? no[2] : null);
const byClass = new Map();
for (const e of enrolls.filter((e) => e.term === '上學期')) {
  if (!byClass.has(e.class_id)) byClass.set(e.class_id, []);
  byClass.get(e.class_id).push(e);
}
const oldInfer = new Map();
for (const [cid, list] of byClass) {
  list.sort((a, b) => (a.seat_no ?? 0) - (b.seat_no ?? 0));
  list.forEach((e, i) => {
    if (d3(e.student_no)) return;
    const sixBefore = list.slice(0, i).some((x) => d3(x.student_no));
    const next6 = list.slice(i + 1).find((x) => d3(x.student_no));
    const nextD = next6 ? d3(next6.student_no) : null;
    let g = null, reason = '位置無法判斷（班上 6 碼學號之前沒有 6 碼男生可對照）';
    if (!list.some((x) => d3(x.student_no))) reason = '班上沒有 6 碼學號可對照';
    else if (!sixBefore && nextD === '1') { g = '男'; reason = '舊名單：排在 6 碼男生之前'; }
    else if (sixBefore && nextD !== '1') { g = '女'; reason = '舊名單：排在 6 碼學號之後'; }
    oldInfer.set(e.student_no, { g, reason, cls: classLabel[cid], seat: e.seat_no });
  });
}
const curClass = new Map(enrolls.filter((e) => e.is_current).map((e) => [e.student_no, `${classLabel[e.class_id]} ${e.seat_no ?? ''}號`]));

const rows = students.map((s) => {
  let g = null, reason, ref = '';
  const d = d3(s.student_no);
  if (d) {
    g = d === '1' ? '男' : d === '2' ? '女' : null;
    reason = g ? '6 碼學號第 3 碼' : '6 碼學號第 3 碼不是 1／2';
  } else if (oldInfer.has(s.student_no)) {
    const o = oldInfer.get(s.student_no);
    ({ g, reason } = o);
    ref = `上學期 ${o.cls} ${o.seat}號`;
  } else reason = '上學期沒有學籍（沒有舊名單可參考）';
  const cur = s.gender ?? '';
  const status = !g ? '無法判斷' : !cur ? '將填入' : cur === g ? '已有且一致（不動）' : '衝突（不動）';
  return { status, student_no: s.student_no, name: s.name, current_class: curClass.get(s.student_no) ?? '', current_gender: cur, proposed: g ?? '', reason, ref };
});

const order = { '衝突（不動）': 0, '無法判斷': 1, '將填入': 2, '已有且一致（不動）': 3 };
rows.sort((a, b) => order[a.status] - order[b.status] || a.current_class.localeCompare(b.current_class, 'zh') || a.student_no.localeCompare(b.student_no));
const head = ['狀態', '學號', '姓名', '目前班級座號', '目前性別', '將填入', '依據', '參考舊名單位置'];
const esc = (v) => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
fs.mkdirSync(outDir, { recursive: true });
const csvPath = path.join(outDir, 'gender-fill-dry-run.csv');
fs.writeFileSync(csvPath, '﻿' + [head, ...rows.map((r) => [r.status, r.student_no, r.name, r.current_class, r.current_gender, r.proposed, r.reason, r.ref])].map((r) => r.map(esc).join(',')).join('\r\n'));
const count = rows.reduce((m, r) => ((m[r.status] = (m[r.status] ?? 0) + 1), m), {});
console.log('清單：', csvPath);
console.log(count);
console.log('將填入：男', rows.filter((r) => r.status === '將填入' && r.proposed === '男').length, '／女', rows.filter((r) => r.status === '將填入' && r.proposed === '女').length);

if (apply) {
  const todo = rows.filter((r) => r.status === '將填入');
  const backupPath = path.join(outDir, `gender-backup-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  fs.writeFileSync(backupPath, JSON.stringify(students.map((s) => ({ student_no: s.student_no, gender: s.gender })), null, 1));
  console.log('已備份原值：', backupPath);
  let n = 0;
  for (const g of ['男', '女']) {
    const nos = todo.filter((r) => r.proposed === g).map((r) => r.student_no);
    for (let i = 0; i < nos.length; i += 200) {
      // 只更新目前仍是空白的，避免覆蓋執行期間有人剛填好的值
      const { data, error } = await db.from('students').update({ gender: g }).in('student_no', nos.slice(i, i + 200)).is('gender', null).select('student_no');
      if (error) throw error;
      n += data.length;
    }
  }
  console.log('已寫入', n, '筆');
}
