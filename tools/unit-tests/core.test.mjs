// 核心規則單元測試（不連資料庫）：node --experimental-strip-types tools/unit-tests/core.test.mjs
// 這幾條規則一改錯，座號、部別、出缺勤代碼就會全校一起錯，所以先鎖住現在的正確行為。
import assert from 'node:assert/strict';
import { compareStudentNo, compareForSeat, genderFromStudentNo, genderRank } from '../../lib/studentNoSort.ts';
import { sha1Upper, countInRange } from '../../lib/pwnedPassword.ts';
import { CHEST_FOOD, chestOpened, openChest } from '../../lib/gameChest.ts';
import ExcelJS from 'exceljs';
import * as X from '../../lib/xlsxLite.ts';
import { clientIp } from '../../lib/clientIp.ts';
import { fetchAbsenceCounts } from '../../lib/absenceCounts.ts';
import { shouldBlockForMfa } from '../../lib/mfaGate.ts';
import { validateNewPassword, generateOneTimePassword, isWeakPassword, MIN_PASSWORD_LENGTH } from '../../lib/weakPasswords.ts';
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

t('RPG 寶箱：開出飼料、一天只能開一次、不動星星與經驗值', () => {
  const p = { xp: 100, stars: 50, streak: 2, last_day: '2026-11-20', claimed_day: '2026-11-20', claimed: ['rc:a:1'], buildings: {}, extras: { food: 5, water: 3, fert: 1, active: null, pets: {}, plots: [null, null], dex: [] } };
  assert.equal(chestOpened(p), false);
  const o = openChest(p);
  assert.equal(o.extras.food, 5 + CHEST_FOOD);
  assert.equal(o.stars, 50);
  assert.equal(o.xp, 100);
  assert.ok(o.claimed.includes('chest') && o.claimed.includes('rc:a:1'));
  assert.equal(chestOpened(o), true);
  assert.equal(openChest(o), o, '已開過：原封不動，不會重複領飼料');
  assert.equal(p.extras.food, 5, '不會改到原本的資料');
});

t('來源 IP：取 x-forwarded-for 第一段，沒有就用 x-real-ip，再沒有是 unknown', () => {
  const h = (o) => ({ get: (k) => o[k] ?? null });
  assert.equal(clientIp(h({ 'x-forwarded-for': '1.2.3.4, 10.0.0.1' })), '1.2.3.4');
  assert.equal(clientIp(h({ 'x-forwarded-for': ' 5.6.7.8 ' })), '5.6.7.8');
  assert.equal(clientIp(h({ 'x-real-ip': '9.9.9.9' })), '9.9.9.9');
  assert.equal(clientIp(h({})), 'unknown');
  assert.equal(clientIp(h({ 'x-forwarded-for': 'x'.repeat(200) })).length, 64, '過長的值會被截斷');
});

t('Excel 讀寫（取代 xlsx 套件）：寫出再讀回、欄寬、合併、多個分頁順序', async () => {
  const wb = X.utils.book_new();
  const ws = X.utils.aoa_to_sheet([['標題', null, null], [1, 'b', true], ['', 3.5, undefined]]);
  ws['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 2 } }];
  ws['!cols'] = [{ wch: 20 }];
  X.utils.book_append_sheet(wb, ws, '資料');
  wb.SheetNames.unshift('前面');
  wb.Sheets['前面'] = X.utils.aoa_to_sheet([['最前']]);
  const buf = await X.write(wb, { bookType: 'xlsx', type: 'array' });
  assert.ok(buf instanceof ArrayBuffer);
  const back = await X.read(buf, { type: 'array' });
  assert.deepEqual(back.SheetNames, ['前面', '資料']);
  assert.deepEqual(X.utils.sheet_to_json(back.Sheets['資料'], { header: 1, defval: null }), [['標題', null, null], [1, 'b', true], ['', 3.5, null]]);
  assert.throws(() => X.utils.book_append_sheet(wb, ws, '資料'), /重複/, '工作表名稱重複要報錯');
});
t('Excel 讀取：日期是序號、公式取計算結果（含 0）、合併格只有左上角有值、略過空白列', async () => {
  const w = new ExcelJS.Workbook();
  const s = w.addWorksheet('測');
  s.getCell('A1').value = new Date(Date.UTC(2026, 10, 20, 13, 45, 30));
  s.getCell('B1').value = { formula: 'A1*0', result: 0 };
  s.getCell('C1').value = { richText: [{ text: '富' }, { text: '文字' }] };
  s.getCell('A3').value = '合併';
  s.mergeCells('A3:C3');
  s.getCell('A5').value = '最後';
  const back = await X.read(new Uint8Array(await w.xlsx.writeBuffer()));
  const rows = X.utils.sheet_to_json(back.Sheets['測'], { header: 1, defval: null });
  assert.equal(typeof rows[0][0], 'number');
  const p = X.SSF.parse_date_code(rows[0][0]);
  assert.deepEqual([p.y, p.m, p.d, p.H, p.M, p.S], [2026, 11, 20, 13, 45, 30]);
  assert.equal(rows[0][1], 0, '公式結果 0 不能變成空白');
  assert.equal(rows[0][2], '富文字');
  assert.deepEqual(rows[2], ['合併', null, null], '合併格的其餘格要是空的');
  assert.equal(X.utils.sheet_to_json(back.Sheets['測'], { header: 1, blankrows: false }).length, 3, '略過空白列');
});
t('Excel 日期碼：幾個已知日期與 23:59:59 不進位', () => {
  const f = (v) => { const p = X.SSF.parse_date_code(v); return [p.y, p.m, p.d, p.H, p.M, p.S].join('-'); };
  assert.equal(f(1), '1900-1-1-0-0-0');
  assert.equal(f(25569), '1970-1-1-0-0-0');
  assert.equal(f(45000), '2023-3-15-0-0-0');
  assert.equal(f(46346.99999999), '2026-11-20-23-59-59');
  assert.equal(X.SSF.parse_date_code(-1), null);
});

t('缺課節數批次查詢：只呼叫一次 RPC、去重、字串數字轉成數字、查不到視為 0', async () => {
  const calls = [];
  const fake = { rpc: async (name, args) => { calls.push([name, args]); return { data: [{ student_no: 'A', absence_periods: '7' }, { student_no: 'B', absence_periods: 0 }], error: null }; } };
  const m = await fetchAbsenceCounts(fake, ['A', 'B', 'A', 'C', '']);
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], 'student_absence_periods');
  assert.deepEqual(calls[0][1], { p_student_nos: ['A', 'B', 'C'] });
  assert.equal(m.get('A'), 7);
  assert.equal(m.get('B'), 0);
  assert.equal(m.get('C') ?? 0, 0);
});
t('缺課節數批次查詢：沒有學生就不查；出錯時回空結果而不是丟例外', async () => {
  let called = 0;
  const empty = await fetchAbsenceCounts({ rpc: async () => { called++; return { data: [], error: null }; } }, []);
  assert.equal(empty.size, 0);
  assert.equal(called, 0);
  const failed = await fetchAbsenceCounts({ rpc: async () => ({ data: null, error: { message: 'x' } }) }, ['A']);
  assert.equal(failed.size, 0);
});

t('新密碼強度：太短、已公開預設密碼、常見／重複／連續字元都擋下，正常密碼通過', () => {
  assert.equal(MIN_PASSWORD_LENGTH, 10);
  assert.ok(validateNewPassword('Abc12345'));            // 8 碼，太短
  assert.ok(validateNewPassword('hy2026168'));           // 已公開的預設密碼（也太短）
  assert.ok(validateNewPassword('1234567890'));          // 連續數字
  assert.ok(validateNewPassword('aaaaaaaaaaaa'));        // 同一字元
  assert.ok(validateNewPassword('abababababab'));        // 短片段重複
  assert.ok(validateNewPassword('Password123'));         // 常見密碼（不分大小寫）
  assert.ok(validateNewPassword('x'.repeat(73)));        // 太長
  assert.equal(validateNewPassword('Blue-Tiger-42-lamp'), null);
  assert.equal(validateNewPassword('7391846205'), null); // 10 碼數字但不是常見／連續，放行（外洩檢查另做）
  assert.ok(isWeakPassword('HY2026168'));
});
t('一次性密碼：16 碼、含大小寫與數字、不含易混淆字元、每次不同、自己能通過強度檢查', () => {
  const seen = new Set();
  for (let i = 0; i < 200; i++) {
    const p = generateOneTimePassword();
    assert.equal(p.length, 16);
    assert.match(p, /[a-z]/);
    assert.match(p, /[A-Z]/);
    assert.match(p, /[0-9]/);
    assert.doesNotMatch(p, /[0O1lI]/);
    assert.equal(validateNewPassword(p), null);
    seen.add(p);
  }
  assert.equal(seen.size, 200);
});

// ---- /api/admin/* 雙重驗證 middleware：用假的 Supabase Auth 回應測各種情況 ----
function jwt(aal) {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${b64({ alg: 'HS256' })}.${b64({ aal })}.sig`;
}
async function runMiddleware(headers, authUser) {
  const realFetch = globalThis.fetch;
  let authCalls = 0;
  globalThis.fetch = async () => {
    authCalls++;
    if (authUser === 'down') throw new Error('network');
    return new Response(JSON.stringify(authUser), { status: authUser ? 200 : 401 });
  };
  try {
    const blocked = await shouldBlockForMfa(headers.authorization ?? null, 'https://example.supabase.co', 'anon');
    return { blocked, authCalls };
  } finally {
    globalThis.fetch = realFetch;
  }
}
t('雙重驗證 middleware：沒帶憑證放行（由 API 回 401）、不打 Auth', async () => {
  const r = await runMiddleware({}, { factors: [{ status: 'verified' }] });
  assert.deepEqual(r, { blocked: false, authCalls: 0 });
});
t('雙重驗證 middleware：已通過第二步（aal2）放行、不打 Auth', async () => {
  const r = await runMiddleware({ authorization: `Bearer ${jwt('aal2')}` }, { factors: [{ status: 'verified' }] });
  assert.deepEqual(r, { blocked: false, authCalls: 0 });
});
t('雙重驗證 middleware：只通過密碼（aal1）但帳號有已驗證的驗證器 → 擋下 403', async () => {
  const r = await runMiddleware({ authorization: `Bearer ${jwt('aal1')}` }, { factors: [{ status: 'verified' }] });
  assert.deepEqual(r, { blocked: true, authCalls: 1 });
});
t('雙重驗證 middleware：aal1 且沒有驗證器／驗證器未完成登記 → 放行（一般教師不受影響）', async () => {
  assert.equal((await runMiddleware({ authorization: `Bearer ${jwt('aal1')}` }, { factors: [] })).blocked, false);
  assert.equal((await runMiddleware({ authorization: `Bearer ${jwt('aal1')}` }, { factors: [{ status: 'unverified' }] })).blocked, false);
  assert.equal((await runMiddleware({ authorization: `Bearer ${jwt('aal1')}` }, {})).blocked, false);
});
t('雙重驗證 middleware：憑證亂填、Auth 回 401 或連不上 → 放行（由各 API 自己驗證憑證）', async () => {
  assert.equal((await runMiddleware({ authorization: 'Bearer garbage' }, null)).blocked, false);
  assert.equal((await runMiddleware({ authorization: `Bearer ${jwt('aal1')}` }, 'down')).blocked, false);
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
