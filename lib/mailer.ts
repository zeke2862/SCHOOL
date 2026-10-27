// ⚠️ 只能在伺服器端使用。寄通知信：
//  1. 有設定 SMTP_HOST（SMTP_PORT、SMTP_USER、SMTP_PASS、MAIL_FROM）→ 用 SMTP 寄（Gmail／學校信箱都可以）
//  2. 否則有設定 RESEND_API_KEY（＋MAIL_FROM）→ 用 Resend 寄
//  3. 都沒設定 → 不寄信，回傳 ok:false（系統內的站內通知仍然會送達，信件留在佇列等設定好再補寄）
export async function sendMail(to: string, subject: string, text: string): Promise<{ ok: boolean; error?: string }> {
  const from = process.env.MAIL_FROM || process.env.SMTP_USER || '';
  try {
    if (process.env.SMTP_HOST) {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const nodemailer = require('nodemailer');
      const transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: Number(process.env.SMTP_PORT || 465),
        secure: Number(process.env.SMTP_PORT || 465) === 465,
        auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
      });
      await transporter.sendMail({ from, to, subject, text });
      return { ok: true };
    }
    if (process.env.RESEND_API_KEY) {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from, to, subject, text }),
      });
      if (!res.ok) return { ok: false, error: `Resend ${res.status}: ${(await res.text()).slice(0, 200)}` };
      return { ok: true };
    }
    return { ok: false, error: '尚未設定寄信（SMTP_HOST 或 RESEND_API_KEY）' };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? String(e) };
  }
}
