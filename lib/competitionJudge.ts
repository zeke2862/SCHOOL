// 評審打分頁的純函式（有單元測試：tools/competition-sql-test/judge.test.mjs）
import type { Criterion } from './competitionScoring';

export const TOTAL_KEY = '__total';

/** 評分準則的配分上限：「40%」「40」「40分」→ 40；讀不出來 → null（此時上限預設 100） */
export function criterionMax(c: Criterion): number | null {
  const m = String(c.weight ?? '').match(/\d+(\.\d+)?/);
  return m ? Number(m[0]) : null;
}

/** 這個項目要輸入哪些欄位：有評分準則就逐項；沒有就只有一格「總分」 */
export function scoreFields(criteria: Criterion[]): { key: string; label: string; max: number }[] {
  if (!criteria.length) return [{ key: TOTAL_KEY, label: '總分', max: 100 }];
  return criteria.map((c) => ({ key: c.label, label: c.label + (c.weight ? `（${c.weight}）` : ''), max: criterionMax(c) ?? 100 }));
}

export type FieldCheck = { ok: boolean; value: number | null; error?: string };

export function checkField(text: string | undefined, max: number): FieldCheck {
  const t = (text ?? '').trim();
  if (t === '') return { ok: true, value: null };
  const n = Number(t);
  if (!Number.isFinite(n)) return { ok: false, value: null, error: '請輸入數字' };
  if (n < 0) return { ok: false, value: null, error: '不能是負數' };
  if (n > max) return { ok: false, value: null, error: `最高 ${max} 分` };
  return { ok: true, value: n };
}

/** 一位選手的各欄位 → 總分。全部欄位都填且合法才有總分，否則 null（只存草稿）。 */
export function rowTotal(fields: { key: string; max: number }[], vals: Record<string, string> | undefined): { total: number | null; error: string | null } {
  let sum = 0;
  let complete = true;
  for (const f of fields) {
    const c = checkField(vals?.[f.key], f.max);
    if (!c.ok) return { total: null, error: `${c.error}` };
    if (c.value === null) complete = false;
    else sum += c.value;
  }
  return { total: complete ? Math.round(sum * 100) / 100 : null, error: null };
}

/** 從資料庫存的 raw 還原成輸入框文字 */
export function rawToVals(raw: Record<string, any> | null | undefined, totalFallback: number | null): Record<string, string> {
  const out: Record<string, string> = {};
  const crit = raw?.criteria as Record<string, number | string> | undefined;
  if (crit) for (const [k, v] of Object.entries(crit)) out[k] = String(v);
  else if (totalFallback !== null && totalFallback !== undefined) out[TOTAL_KEY] = String(totalFallback);
  return out;
}

/** 輸入框文字 → 要存進資料庫的 raw */
export function valsToRaw(fields: { key: string }[], vals: Record<string, string>): Record<string, any> {
  const crit: Record<string, number> = {};
  for (const f of fields) {
    const t = (vals[f.key] ?? '').trim();
    if (t !== '' && Number.isFinite(Number(t))) crit[f.key] = Number(t);
  }
  return { criteria: crit };
}
