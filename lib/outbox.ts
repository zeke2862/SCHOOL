import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { sendMail } from '@/lib/mailer';

// ⚠️ 只能在伺服器端使用。把 email_outbox 裡還沒寄的信寄出去（代理人設定通知等）。
export async function flushOutbox(limit = 50): Promise<{ sent: number; failed: number; skipped: number }> {
  const { data: rows } = await supabaseAdmin
    .from('email_outbox')
    .select('id, to_user_id, subject, body')
    .is('sent_at', null)
    .order('created_at', { ascending: true })
    .limit(limit);
  let sent = 0;
  let failed = 0;
  let skipped = 0;
  for (const r of rows ?? []) {
    const { data: u } = await supabaseAdmin.auth.admin.getUserById(r.to_user_id);
    const email = u?.user?.email;
    if (!email) {
      skipped++;
      await supabaseAdmin.from('email_outbox').update({ error: '收件人沒有信箱' }).eq('id', r.id);
      continue;
    }
    const res = await sendMail(email, r.subject, r.body + '\n\n（此信由校務行政系統自動寄出，請勿直接回覆）');
    if (res.ok) {
      sent++;
      await supabaseAdmin.from('email_outbox').update({ sent_at: new Date().toISOString(), error: null }).eq('id', r.id);
    } else {
      failed++;
      await supabaseAdmin.from('email_outbox').update({ error: res.error ?? '寄送失敗' }).eq('id', r.id);
      if (res.error?.includes('尚未設定寄信')) break; // 沒設定寄信就不用一封一封試
    }
  }
  return { sent, failed, skipped };
}
