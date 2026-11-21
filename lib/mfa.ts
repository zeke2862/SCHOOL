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

/** 驗證 6 位數字碼，成功回傳 null，失敗回傳要顯示的錯誤 */
export async function verifyMfaCode(factorId: string, code: string): Promise<string | null> {
  const token = code.replace(/\D/g, '');
  if (token.length !== 6) return '請輸入驗證器 App 上的 6 位數字';
  const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId, code: token });
  if (error) return '驗證碼不正確或已過期，請看驗證器 App 目前顯示的最新數字再試一次';
  return null;
}
