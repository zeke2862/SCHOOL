// /api/admin/* 的雙重驗證判斷（給 middleware.ts 用；獨立成純函式方便單元測試）。
// 規則與原因見 middleware.ts。回傳 true＝要擋下（403）。

function jwtAal(token: string): string | null {
  try {
    const payload = token.split('.')[1];
    if (!payload) return null;
    const b64 = payload.replace(/-/g, '+').replace(/_/g, '/');
    const json = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
    return (JSON.parse(json) as { aal?: string }).aal ?? null;
  } catch {
    return null;
  }
}

export const MFA_BLOCK_MESSAGE = '此帳號已啟用雙重驗證，請重新登入並輸入驗證器上的 6 位數字後再操作';

export async function shouldBlockForMfa(authorization: string | null, supabaseUrl: string, anonKey: string): Promise<boolean> {
  const token = authorization?.replace(/^Bearer\s+/i, '');
  if (!token) return false; // 沒帶憑證：各 API 自己會回 401
  if (jwtAal(token) === 'aal2') return false; // 已通過第二步

  try {
    const res = await fetch(`${supabaseUrl}/auth/v1/user`, {
      headers: { apikey: anonKey, Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(4000),
      cache: 'no-store',
    });
    if (!res.ok) return false;
    const user = (await res.json()) as { factors?: { status?: string }[] | null };
    return !!user.factors?.some((f) => f.status === 'verified');
  } catch {
    return false; // 連不上就放行（不能因為外部服務問題讓管理功能整個不能用），由 API 本身的驗證把關
  }
}
