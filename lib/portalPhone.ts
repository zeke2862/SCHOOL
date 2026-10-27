// 家長／學生入口：手機號碼與登入代碼的標準化（登入、申請帳號共用）。
// 泰國手機號碼沒有被限制開頭：06／08／09 開頭（或不打開頭的 0）、有沒有 +66／66 國碼都可以，
// 只要拿掉國碼與開頭的 0 之後剩下的數字一致就算同一支。
//
// 另外手機上很常見的輸入差異也一併處理：
//  * 全形數字（中文輸入法：０９９４…）、泰文數字（๐๙๙๔…）、阿拉伯文數字
//  * 空白、橫線、括號、點（0 99-407 5825、(099)4075825）
const DIGIT_MAPS: [number, number][] = [
  [0x0e50, 0x0e59], // 泰文數字 ๐-๙
  [0xff10, 0xff19], // 全形數字 ０-９
  [0x0660, 0x0669], // 阿拉伯-印度數字
  [0x06f0, 0x06f9], // 東阿拉伯-印度數字
];

export function toAsciiDigits(s: string): string {
  let out = '';
  for (const ch of s ?? '') {
    const cp = ch.codePointAt(0)!;
    const m = DIGIT_MAPS.find(([a, b]) => cp >= a && cp <= b);
    out += m ? String(cp - m[0]) : ch;
  }
  return out;
}

export function canonicalPhone(s: string): string {
  let d = toAsciiDigits(s).replace(/\D/g, '');
  if (d.startsWith('66') && d.length > 9) d = d.slice(2); // 去掉泰國國碼 66（+66 的 + 已被拿掉）
  if (d.startsWith('0')) d = d.slice(1); // 去掉開頭的 0（國內慣用打法）
  return d;
}

export function phonesMatch(a: string | null | undefined, b: string | null | undefined): boolean {
  const ca = canonicalPhone(a ?? '');
  const cb = canonicalPhone(b ?? '');
  if (ca.length < 8 || cb.length < 8) return false; // 太短的不算數，避免誤判
  return ca === cb;
}

/** 登入代碼：全形英數轉半形、去空白、轉大寫（ＨＹ０１２３ → HY0123） */
export function normalizeLoginCode(s: string): string {
  return toAsciiDigits((s ?? '').normalize('NFKC')).replace(/\s+/g, '').toUpperCase();
}
