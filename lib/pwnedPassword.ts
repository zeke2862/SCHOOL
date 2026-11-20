import { createHash } from 'node:crypto';

// 外洩密碼檢查（Supabase 內建的「Leaked password protection」要 Pro 方案，這裡用同一份資料來源自己做）。
// 資料來源：Have I Been Pwned 的 Pwned Passwords 公開服務，採 k-anonymity 查法——
// 只把密碼 SHA-1 雜湊的「前 5 個字元」送出去，對方回傳所有同樣開頭的雜湊尾碼，比對在我們這邊完成。
// 所以密碼本身、完整雜湊、帳號資料都不會離開伺服器。
// 服務連不上（逾時、對方當機）就當作沒查到，不能因為外部服務問題讓人改不了密碼。

export function sha1Upper(password: string): string {
  return createHash('sha1').update(password, 'utf8').digest('hex').toUpperCase();
}

/** 解析 range 回應（每行「雜湊尾碼:出現次數」），回傳目標尾碼的出現次數；沒有就是 0。padding 補的假資料次數是 0，不算 */
export function countInRange(body: string, suffix: string): number {
  for (const line of body.split(/\r?\n/)) {
    const [s, n] = line.trim().split(':');
    if (s && s.toUpperCase() === suffix) return Math.max(0, parseInt(n ?? '0', 10) || 0);
  }
  return 0;
}

/** 這個密碼在外洩資料中出現過幾次（0＝沒出現，或查詢失敗） */
export async function pwnedCount(password: string, timeoutMs = 3000): Promise<number> {
  try {
    const hash = sha1Upper(password);
    const res = await fetch(`https://api.pwnedpasswords.com/range/${hash.slice(0, 5)}`, {
      headers: { 'Add-Padding': 'true' },
      signal: AbortSignal.timeout(timeoutMs),
      cache: 'no-store',
    });
    if (!res.ok) return 0;
    return countInRange(await res.text(), hash.slice(5));
  } catch {
    return 0;
  }
}

export const PWNED_MESSAGE = '這組密碼曾出現在外洩的帳號資料中，不安全，請設定其他密碼';
