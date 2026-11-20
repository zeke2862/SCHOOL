import { supabase } from '@/lib/supabaseClient';

// 雙重驗證（MFA／TOTP，驗證器 App 的 6 位數字碼）。Supabase Auth 的 TOTP 在所有方案都免費。
// 資安檢測報告 #8：系統管理員 S、系統管理員 A 啟用雙重驗證。
//
// 運作方式：
// - 帳號登記過驗證器之後，登入時密碼通過還要再輸入 6 位數字碼，才算完整登入（AAL2）。
// - 登入頁、(app) 版面、/api/admin/* 的 middleware 都會檢查：登記過的人如果只有密碼登入（AAL1），一律不放行。
// - 沒登記過的人照舊（教師不強制）。系統管理員 S／A 登入後會被帶去設定頁；
//   想改成「沒設定就不准進」，把環境變數 NEXT_PUBLIC_MFA_REQUIRED 設成 1（見 app/(app)/layout.tsx）。

/** 需要雙重驗證的角色 */
export const MFA_ROLES = ['system_admin_s', 'admin_a'];

export type MfaStatus = {
  /** 已登記（驗證通過）的 TOTP 因子；沒有就是 null */
  factorId: string | null;
  /** 目前這個登入還沒做第二步，需要輸入驗證碼 */
  needsChallenge: boolean;
};

export async function getMfaStatus(): Promise<MfaStatus> {
  const [{ data: aal }, { data: factors }] = await Promise.all([
    supabase.auth.mfa.getAuthenticatorAssuranceLevel(),
    supabase.auth.mfa.listFactors(),
  ]);
  const verified = factors?.totp?.[0] ?? null; // listFactors 的 totp 只含已驗證的
  return {
    factorId: verified?.id ?? null,
    needsChallenge: !!aal && aal.nextLevel === 'aal2' && aal.currentLevel !== 'aal2',
  };
}

/**
 * 給 (app) 版面用的輕量檢查（只看本機已有的登入資料，不多打任何網路請求）：
 * 回傳 needsChallenge＝這個登入只做了密碼、帳號卻有登記驗證器；hasFactor＝帳號有登記驗證器。
 */
export async function getMfaStatusLocal(): Promise<{ needsChallenge: boolean; hasFactor: boolean }> {
  const [{ data: aal }, { data: sess }] = await Promise.all([
    supabase.auth.mfa.getAuthenticatorAssuranceLevel(),
    supabase.auth.getSession(),
  ]);
  const hasFactor = !!sess.session?.user?.factors?.some((f) => f.status === 'verified');
  return { needsChallenge: !!aal && aal.nextLevel === 'aal2' && aal.currentLevel !== 'aal2', hasFactor };
}

/** 驗證 6 位數字碼，成功回傳 null，失敗回傳要顯示的錯誤 */
export async function verifyMfaCode(factorId: string, code: string): Promise<string | null> {
  const token = code.replace(/\D/g, '');
  if (token.length !== 6) return '請輸入驗證器 App 上的 6 位數字';
  const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId, code: token });
  if (error) return '驗證碼不正確或已過期，請看驗證器 App 目前顯示的最新數字再試一次';
  return null;
}
