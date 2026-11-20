/** 已公開流傳的預設密碼：用這些密碼登入的教職員，下次進系統一定要改密碼，也不能再把密碼改成這些。 */
const WEAK_PASSWORDS = ['2026168', 'hy2026168'];

export function isWeakPassword(password: string): boolean {
  return WEAK_PASSWORDS.includes(password.trim().toLowerCase());
}

// ---------- 新密碼強度規則（資安檢測報告 #8、#9）----------
// 新設定／重設的密碼一律要通過這裡（登入頁的忘記密碼、改密碼頁、管理員建立帳號、管理員重設密碼都用同一套），
// 另外伺服器端再查外洩密碼資料庫（lib/pwnedPassword.ts）。已經在用的舊密碼不受影響，下次改密碼才會套用。

/** 新密碼最短長度（原本是 6） */
export const MIN_PASSWORD_LENGTH = 10;

// 最常被猜到的密碼（長度 ≥ 10 的才有意義，較短的已被長度規則擋掉）。比對時一律轉小寫。
const COMMON_PASSWORDS = new Set([
  '1234567890', '0123456789', '0987654321', '9876543210', '1111111111', '0000000000', '1234512345', '1234567891',
  'password12', 'password123', 'password1234', 'passw0rd123', 'qwertyuiop', 'qwertyuiop1', 'qwerty1234', 'qwerty12345',
  'asdfghjkl1', 'asdfghjklz', 'zxcvbnm123', 'abcdefghij', 'abcd123456', 'abc1234567', 'abcde12345', 'iloveyou12', 'iloveyou123',
  'welcome123', 'welcome1234', 'admin12345', 'admin123456', 'administrator', 'teacher123', 'teacher1234', 'teacher12345',
  'school1234', 'school12345', 'school123456', 'student123', 'student1234', 'hy20261680', 'hy2026168!', 'hy20261681',
  'hyschool123', 'hyschool1234', 'taiwan1234', 'taiwan12345', 'changeme123', 'letmein1234', 'monkey1234', 'dragon1234',
]);

function allSameChar(pw: string): boolean {
  return pw.length > 0 && [...pw].every((c) => c === pw[0]);
}

/** 整串是連續遞增或遞減的數字／字母（如 1234567890、abcdefghij、9876543210） */
function isSequential(pw: string): boolean {
  if (pw.length < 2) return false;
  const codes = [...pw.toLowerCase()].map((c) => c.charCodeAt(0));
  let up = true;
  let down = true;
  for (let i = 1; i < codes.length; i++) {
    if (codes[i] !== codes[i - 1] + 1) up = false;
    if (codes[i] !== codes[i - 1] - 1) down = false;
  }
  return up || down;
}

/** 由一到三個字元重複拼成（如 1212121212、abababababab） */
function isShortRepeat(pw: string): boolean {
  for (let n = 1; n <= 3; n++) {
    if (pw.length >= n * 3 && pw.length % n === 0 && pw === pw.slice(0, n).repeat(pw.length / n)) return true;
  }
  return false;
}

/**
 * 檢查新密碼強度，通過回傳 null，不通過回傳要顯示給使用者的原因。
 * 只做不需要網路的檢查；外洩密碼檢查另在伺服器端做。
 */
export function validateNewPassword(password: string): string | null {
  if (password.length < MIN_PASSWORD_LENGTH) return `密碼至少要 ${MIN_PASSWORD_LENGTH} 個字元`;
  if (password.length > 72) return '密碼太長（上限 72 個字元）';
  if (isWeakPassword(password)) return '這組密碼太常見，請設定其他密碼';
  if (COMMON_PASSWORDS.has(password.trim().toLowerCase()) || allSameChar(password) || isSequential(password) || isShortRepeat(password)) {
    return '這組密碼太容易被猜到（常見密碼或重複／連續字元），請設定其他密碼';
  }
  return null;
}

/** 產生一次性初始密碼：16 碼，去掉容易看錯的字元（0 O 1 l I），保證含大小寫與數字。只能在有 crypto 的環境（伺服器或瀏覽器）呼叫 */
export function generateOneTimePassword(length = 16): string {
  const lower = 'abcdefghijkmnpqrstuvwxyz';
  const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const digits = '23456789';
  const all = lower + upper + digits;
  const pick = (set: string) => set[crypto.getRandomValues(new Uint32Array(1))[0] % set.length];
  const chars = [pick(lower), pick(upper), pick(digits)];
  while (chars.length < length) chars.push(pick(all));
  // 洗牌，避免固定「小寫、大寫、數字」開頭
  for (let i = chars.length - 1; i > 0; i--) {
    const j = crypto.getRandomValues(new Uint32Array(1))[0] % (i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join('');
}
