// node --experimental-strip-types tools/competition-sql-test/judge.test.mjs
import assert from 'node:assert/strict';
import { criterionMax, scoreFields, checkField, rowTotal, rawToVals, valsToRaw, TOTAL_KEY } from '../../lib/competitionJudge.ts';

let n = 0;
const t = (name, fn) => { fn(); n++; console.log('PASS ', name); };
const crit = [{ label: '音準', weight: '40%' }, { label: '節奏', weight: '30' }, { label: '台風', weight: '' }];

t('配分上限解析', () => {
  assert.equal(criterionMax({ label: 'a', weight: '40%' }), 40);
  assert.equal(criterionMax({ label: 'a', weight: '12.5分' }), 12.5);
  assert.equal(criterionMax({ label: 'a', weight: '' }), null);
});
t('欄位：無準則 → 單一總分欄', () => {
  assert.deepEqual(scoreFields([]), [{ key: TOTAL_KEY, label: '總分', max: 100 }]);
  const f = scoreFields(crit);
  assert.deepEqual(f.map((x) => x.max), [40, 30, 100]);
  assert.equal(f[0].label, '音準（40%）');
});
t('單格檢查', () => {
  assert.equal(checkField('', 10).value, null);
  assert.equal(checkField(' 8.5 ', 10).value, 8.5);
  assert.equal(checkField('11', 10).ok, false);
  assert.equal(checkField('-1', 10).ok, false);
  assert.equal(checkField('abc', 10).ok, false);
});
t('總分：填滿才有；缺一格只存草稿；超過上限回傳錯誤', () => {
  const f = scoreFields(crit);
  assert.equal(rowTotal(f, { 音準: '35', 節奏: '25', 台風: '90' }).total, 150);
  assert.equal(rowTotal(f, { 音準: '35', 節奏: '25' }).total, null);
  assert.equal(rowTotal(f, { 音準: '35', 節奏: '25' }).error, null);
  assert.match(rowTotal(f, { 音準: '41', 節奏: '25', 台風: '1' }).error, /最高 40/);
  assert.equal(rowTotal(f, undefined).total, null);
});
t('小數加總不產生浮點誤差', () => {
  const f = scoreFields([{ label: 'a', weight: '50' }, { label: 'b', weight: '50' }]);
  assert.equal(rowTotal(f, { a: '0.1', b: '0.2' }).total, 0.3);
});
t('raw 來回轉換', () => {
  const f = scoreFields(crit);
  const raw = valsToRaw(f, { 音準: '35', 節奏: '', 台風: '90' });
  assert.deepEqual(raw, { criteria: { 音準: 35, 台風: 90 } });
  assert.deepEqual(rawToVals(raw, null), { 音準: '35', 台風: '90' });
  assert.deepEqual(rawToVals({}, 88), { [TOTAL_KEY]: '88' });
  assert.deepEqual(rawToVals(null, null), {});
});
console.log(`\n${n} 項評審頁單元測試通過`);
