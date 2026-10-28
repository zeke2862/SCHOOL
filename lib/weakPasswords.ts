/** 已公開流傳的預設密碼：用這些密碼登入的教職員，下次進系統一定要改密碼，也不能再把密碼改成這些。 */
const WEAK_PASSWORDS = ['2026168', 'hy2026168'];

export function isWeakPassword(password: string): boolean {
  return WEAK_PASSWORDS.includes(password.trim().toLowerCase());
}
