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

// ---- 用「本機已有的登入資料」判斷雙重驗證狀態（不打任何網路請求）----
// 原本登入時呼叫 supabase.auth.mfa.listFactors()，它每次都會多打一次 Auth 伺服器（約 0.15～0.3 秒），
// 系統管理員 S／A 登入還會再打第二次，讓登入明顯變慢。其實登入回應與本機 session 裡的 user.factors
// 已經有驗證器清單，憑證裡的 aal 欄位也已經說明目前通過到哪一級，不需要再問伺服器。
type SessionLike = {
  access_token?: string;
  user?: { factors?: { id: string; status: string; factor_type?: string }[] | null } | null;
} | null | undefined;

export function mfaFromSession(session: SessionLike): { factorId: string | null; hasFactor: boolean; needsChallenge: boolean } {
  const verified = (session?.user?.factors ?? []).find((f) => f.status === 'verified' && (!f.factor_type || f.factor_type === 'totp'));
  const aal = session?.access_token ? jwtAal(session.access_token) : null;
  return { factorId: verified?.id ?? null, hasFactor: !!verified, needsChallenge: !!verified && aal !== 'aal2' };
}
