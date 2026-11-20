// 純函式（不連資料庫），方便單元測試
/** 從請求標頭取出來源 IP（Vercel 會覆寫 x-forwarded-for，第一段就是真正的來源）。取不到回傳 'unknown' */
export function clientIp(headers: { get(name: string): string | null }): string {
  const xff = headers.get('x-forwarded-for');
  const first = xff?.split(',')[0]?.trim();
  if (first) return first.slice(0, 64);
  const real = headers.get('x-real-ip')?.trim();
  return real ? real.slice(0, 64) : 'unknown';
}
