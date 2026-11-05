// 計分/排名單元測試：node --experimental-strip-types tools/competition-sql-test/scoring.test.mjs
import assert from 'node:assert/strict';
import { computeRanking, chessPoints, sumJudgeTotals, suggestAward, parseCriteria } from '../../lib/competitionScoring.ts';

let n = 0;
const t = (name, fn) => { fn(); n++; console.log('PASS ', name); };
const regs = ['a', 'b', 'c', 'd'].map((id) => ({ id }));
const J = (reg, judge, total) => ({ registration_id: reg, judge_user_id: judge, raw: {}, total });

t('象棋：勝3和1敗0', () => {
  assert.equal(chessPoints({ wins: '2', losses: '1', draws: '1' }), 7);
  assert.equal(chessPoints({ wins: '', losses: '', draws: '' }), null);
  assert.equal(chessPoints({ wins: '1' }), 3);
});
t('評審制：加總與並列名次 1,2,2,4', () => {
  const s = [J('a', 'j1', 90), J('a', 'j2', 80), J('b', 'j1', 85), J('b', 'j2', 84), J('c', 'j1', 70), J('c', 'j2', 80), J('d', 'j1', 10)];
  const r = computeRanking({ score_type: 'judge', config: {} }, regs, s);
  const by = Object.fromEntries(r.map((x) => [x.registration_id, x]));
  assert.equal(by.a.total, 170); assert.equal(by.a.rank, 1);
  assert.equal(by.b.rank, 2); assert.equal(by.c.rank, 3); assert.equal(by.d.rank, 4);
  const tie = computeRanking({ score_type: 'judge', config: {} }, regs.slice(0, 3), [J('a', 'j', 5), J('b', 'j', 5), J('c', 'j', 4)]);
  assert.deepEqual(tie.map((x) => x.rank), [1, 1, 3]);
});
t('評審制：去掉最高最低', () => {
  assert.equal(sumJudgeTotals([90, 80, 70, 100, 60], true), 240);
  assert.equal(sumJudgeTotals([90, 80], true), 170); // 不足 3 位不去除
  assert.equal(sumJudgeTotals([], false), null);
});
t('未輸入的選手不排名', () => {
  const r = computeRanking({ score_type: 'test', config: {} }, regs, [{ registration_id: 'a', judge_user_id: null, raw: { score: 88 }, total: null }]);
  assert.equal(r[0].rank, 1); assert.equal(r[1].rank, null); assert.equal(r[1].total, null);
});
t('紀錄制：秒數越小越好', () => {
  const s = [['a', 12.5], ['b', 11.9], ['c', 13]].map(([id, v]) => ({ registration_id: id, judge_user_id: null, raw: { value: v }, total: null }));
  const r = computeRanking({ score_type: 'record', config: { record_order: 'asc' } }, regs.slice(0, 3), s);
  assert.deepEqual(r.map((x) => x.rank), [2, 1, 3]);
});
t('投票制：票數多者名次前', () => {
  const r = computeRanking({ score_type: 'vote', config: {} }, regs.slice(0, 3), [], { a: 3, b: 7 });
  assert.deepEqual(r.map((x) => x.rank), [2, 1, 3]);
  assert.equal(r[2].total, 0);
});
t('獎項建議', () => {
  assert.equal(suggestAward(1), '第1名'); assert.equal(suggestAward(5), '佳作'); assert.equal(suggestAward(9), ''); assert.equal(suggestAward(null), '');
});
t('評分準則解析', () => {
  assert.deepEqual(parseCriteria('音準|40%\n台風 \n\n'), [{ label: '音準', weight: '40%' }, { label: '台風', weight: '' }]);
});
console.log(`\n${n} 項單元測試通過`);
