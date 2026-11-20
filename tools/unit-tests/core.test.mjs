// 核心規則單元測試（不連資料庫）：node --experimental-strip-types tools/unit-tests/core.test.mjs
// 這幾條規則一改錯，座號、部別、出缺勤代碼就會全校一起錯，所以先鎖住現在的正確行為。
import assert from 'node:assert/strict';
import { compareStudentNo, compareForSeat, genderFromStudentNo, genderRank } from '../../lib/studentNoSort.ts';
import { sha1Upper, countInRange } from '../../lib/pwnedPassword.ts';
import { cached, invalidateCache } from '../../lib/queryCacheCore.ts';
import { departmentForGrade, SPECIFIC_GRADE_LEVELS, ATTENDANCE_CODE_MAP } from '../../lib/gradeMapping.ts';

let n = 0;
const tests = [];
const t = (name, fn) => tests.push([name, fn]);

t('學號比較：純數字依數值（762 排在 1003 前面）', () => {
  assert.ok(compareStudentNo('762', '1003') < 0);
  assert.ok(compareStudentNo('1003', '762') > 0);
  assert.equal(compareStudentNo('112001', '112001'), 0);
});
t('學號比較：數字學號排在非數字學號前面', () => {
  assert.ok(compareStudentNo('9', 'A1') < 0);
  assert.ok(compareStudentNo('A1', '9') > 0);
});
t('學號排序結果穩定', () => {
  const sorted = ['1003', 'B2', '762', 'A1', '99'].sort(compareStudentNo);
  assert.deepEqual(sorted, ['99', '762', '1003', 'A1', 'B2']);
});
t('依學號判定性別：6 碼第 3 碼 1 男 2 女，其餘不判定', () => {
  assert.equal(genderFromStudentNo('111001'), '男');
  assert.equal(genderFromStudentNo('112001'), '女');
  assert.equal(genderFromStudentNo('113001'), null);
  assert.equal(genderFromStudentNo('762'), null);
  assert.equal(genderFromStudentNo(null), null);
  assert.equal(genderFromStudentNo(' 111001 '), '男');
});
t('性別排序：男 0、女 1（含「女生」寫法）、空白 2', () => {
  assert.equal(genderRank('男'), 0);
  assert.equal(genderRank('女生'), 1);
  assert.equal(genderRank(''), 2);
  assert.equal(genderRank(null), 2);
});
t('座號排序：先男後女，同性別內依學號；沒填性別時用學號判定', () => {
  const rows = [
    { student_no: '112001', gender: '女' },
    { student_no: '111002', gender: '男' },
    { student_no: '111001', gender: null }, // 由學號判定為男
    { student_no: '112002', gender: '女' },
  ];
  const byGender = [...rows].sort((a, b) => compareForSeat('gender', a, b)).map((r) => r.student_no);
  assert.deepEqual(byGender, ['111001', '111002', '112001', '112002']);
  const byNo = [...rows].sort((a, b) => compareForSeat('student_no', a, b)).map((r) => r.student_no);
  assert.deepEqual(byNo, ['111001', '111002', '112001', '112002']);
});
t('年級 → 部別對照', () => {
  assert.equal(departmentForGrade('幼甲'), '幼兒園');
  assert.equal(departmentForGrade('3年'), '國小');
  assert.equal(departmentForGrade(' 初二 '), '國中');
  assert.equal(departmentForGrade('高三'), '高中');
  assert.equal(departmentForGrade('初中一'), '其他'); // 舊寫法已淘汰，不能再被當成合法年級
});
t('具體年級清單：每一個都能對到部別', () => {
  for (const g of SPECIFIC_GRADE_LEVELS) {
    if (g === '幼兒園') continue; // 泛用欄位
    assert.notEqual(departmentForGrade(g), '其他', g);
  }
});
t('出缺勤代碼對照維持不變', () => {
  assert.deepEqual(ATTENDANCE_CODE_MAP, { 10: '曠課', 1: '遲到', 2: '病假', 3: '事假', 4: '公假' });
});
t('快取：同時多個請求只查一次，結果共用', async () => {
  invalidateCache();
  let calls = 0;
  const f = async () => { calls++; await new Promise((r) => setTimeout(r, 20)); return 'v'; };
  const rs = await Promise.all([cached('k', f, 1000), cached('k', f, 1000), cached('k', f, 1000)]);
  assert.deepEqual(rs, ['v', 'v', 'v']);
  assert.equal(calls, 1);
  await cached('k', f, 1000);
  assert.equal(calls, 1, '期限內不再重查');
});
t('快取：過期會重查、前綴清除只清符合的', async () => {
  invalidateCache();
  let a = 0, b = 0;
  await cached('term:a', async () => ++a, 5);
  await cached('other:b', async () => ++b, 60000);
  await new Promise((r) => setTimeout(r, 15));
  await cached('term:a', async () => ++a, 5);
  assert.equal(a, 2, '過期後重查');
  invalidateCache('term:');
  await cached('term:a', async () => ++a, 60000);
  await cached('other:b', async () => ++b, 60000);
  assert.equal(a, 3, '被清掉的重查');
  assert.equal(b, 1, '沒被清掉的維持原值');
});
t('快取：失敗不會被記住，下次會重新查', async () => {
  invalidateCache();
  let calls = 0;
  await assert.rejects(cached('e', async () => { calls++; throw new Error('boom'); }, 1000));
  const v = await cached('e', async () => { calls++; return 'ok'; }, 1000);
  assert.equal(v, 'ok');
  assert.equal(calls, 2);
});

t('外洩密碼檢查：SHA-1 與 range 回應解析', () => {
  assert.equal(sha1Upper('password'), '5BAA61E4C9B93F3F0682250B6CF8331B7EE68FD8');
  const body = ['0018A45C4D1DEF81644B54AB7F969B88D65:1', '1E4C9B93F3F0682250B6CF8331B7EE68FD8:3861493', 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA:0', ''].join(String.fromCharCode(13, 10));
  assert.equal(countInRange(body, '1E4C9B93F3F0682250B6CF8331B7EE68FD8'), 3861493);
  assert.equal(countInRange(body, 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'), 0, 'padding 假資料次數 0');
  assert.equal(countInRange(body, 'FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF'), 0, '沒出現');
  assert.equal(countInRange('', 'ABC'), 0);
});

// 依序執行；任何一項失敗就讓整個程序以非 0 結束（CI 才會擋下）
for (const [name, fn] of tests) {
  await fn();
  n++;
  console.log('PASS ', name);
}
if (n !== tests.length || n === 0) {
  console.error('測試數量不符，視為失敗');
  process.exit(1);
}
console.log(`\n${n} 項單元測試通過`);
