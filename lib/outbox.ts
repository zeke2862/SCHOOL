import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { sendMail } from '@/lib/mailer';

// 系統網址：信裡附上連結用。可在 Vercel 設定 SITE_URL（例如 https://school-sigma-nine.vercel.app）；沒設就用 Vercel 的正式網址。
function siteUrl(): string {
  const u = process.env.SITE_URL || process.env.NEXT_PUBLIC_SITE_URL || (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : '');
  return u.replace(/\/$/, '');
}

// 寄信設定狀態（給管理頁顯示；不回傳任何密碼或金鑰）
export function mailConfig(): { configured: boolean; method: 'smtp' | 'resend' | null; from: string } {
  const from = process.env.MAIL_FROM || process.env.SMTP_USER || '';
  if (process.env.SMTP_HOST) return { configured: !!from, method: 'smtp', from };
  if (process.env.RESEND_API_KEY) return { configured: !!from, method: 'resend', from };
  return { configured: false, method: null, from };
}

const STALE_DAYS = 3;

// ⚠️ 只能在伺服器端使用。把 email_outbox 裡還沒寄的信寄出去（站內通知、代理人設定通知等）。
//  * 超過 STALE_DAYS 天還沒寄出的信（例如寄信還沒設定好時累積的舊通知）直接略過，不補寄，避免一次寄出一大堆過期的信。
//  * 寄信還沒設定好時不嘗試寄送，信件留在佇列。
export async function flushOutbox(limit = 50): Promise<{ sent: number; failed: number; skipped: number; notConfigured?: boolean }> {
  if (!mailConfig().configured) return { sent: 0, failed: 0, skipped: 0, notConfigured: true };
  const { data: rows } = await supabaseAdmin
    .from('email_outbox')
    .select('id, to_user_id, subject, body, created_at')
    .is('sent_at', null)
    .order('created_at', { ascending: true })
    .limit(limit);
  let sent = 0;
  let failed = 0;
  let skipped = 0;
  const staleBefore = Date.now() - STALE_DAYS * 86400000;
  const link = siteUrl();
  for (const r of rows ?? []) {
    if (new Date(r.created_at).getTime() < staleBefore) {
      skipped++;
      await supabaseAdmin.from('email_outbox').update({ sent_at: new Date().toISOString(), error: `超過 ${STALE_DAYS} 天未寄出，已略過` }).eq('id', r.id);
      continue;
    }
    const { data: u } = await supabaseAdmin.auth.admin.getUserById(r.to_user_id);
    const email = u?.user?.email;
    if (!email) {
      skipped++;
      await supabaseAdmin.from('email_outbox').update({ sent_at: new Date().toISOString(), error: '收件人沒有信箱' }).eq('id', r.id);
      continue;
    }
    const footer = `${link ? `\n\n系統網址：${link}` : ''}\n\n（此信由校務行政系統自動寄出，請勿直接回覆；不想收到信件通知，可到系統「帳號設定」關閉。）`;
    const res = await sendMail(email, r.subject, r.body + footer);
    if (res.ok) {
      sent++;
      await supabaseAdmin.from('email_outbox').update({ sent_at: new Date().toISOString(), error: null }).eq('id', r.id);
    } else {
      failed++;
      await supabaseAdmin.from('email_outbox').update({ error: res.error ?? '寄送失敗' }).eq('id', r.id);
    }
  }
  return { sent, failed, skipped };
}
