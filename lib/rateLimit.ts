import { supabaseAdmin } from '@/lib/supabaseAdmin';
export { clientIp } from '@/lib/clientIp';

// 嘗試次數限制（資料庫版，不需要 Redis 等額外服務；函式見 sql/158_rate_limit.sql）。
// 用法：先 rateLimitWait 看有沒有被擋，做完事情「失敗」才 rateLimitHit 記一次，成功就 rateLimitClear。
// 只記失敗，是為了不誤擋學校裡大家共用同一個網路出口、同時正常登入的人。
// 資料庫呼叫失敗時一律放行（寧可暫時少一層防護，也不要讓全校家長都登不進去）。

/** 還要等幾秒才能再試；0 表示沒有被擋。多個鍵一起查，取最長的 */
export async function rateLimitWait(rules: { key: string; max: number; windowSecs: number }[]): Promise<number> {
  try {
    const waits = await Promise.all(
      rules.map(async (r) => {
        const { data, error } = await supabaseAdmin.rpc('rate_limit_wait', { p_key: r.key, p_max: r.max, p_window_secs: r.windowSecs });
        return error ? 0 : Number(data) || 0;
      })
    );
    return Math.max(0, ...waits);
  } catch {
    return 0;
  }
}

/** 記一次失敗 */
export async function rateLimitHit(keys: string[], windowSecs: number): Promise<void> {
  await Promise.all(
    keys.map((k) =>
      Promise.resolve(supabaseAdmin.rpc('rate_limit_hit', { p_key: k, p_window_secs: windowSecs })).then(
        () => undefined,
        () => undefined
      )
    )
  );
}

/** 清掉某個鍵的失敗次數（登入成功時用） */
export async function rateLimitClear(key: string): Promise<void> {
  await Promise.resolve(supabaseAdmin.rpc('rate_limit_clear', { p_key: key })).then(
    () => undefined,
    () => undefined
  );
}

/** 「請 N 分鐘後再試」的提示文字 */
export function waitMessage(seconds: number): string {
  const mins = Math.max(1, Math.ceil(seconds / 60));
  return `嘗試次數過多，為了保護帳號安全，請 ${mins} 分鐘後再試。若一直無法登入，請洽班導師。`;
}
