import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { flushOutbox, mailConfig } from '@/lib/outbox';
import { sendMail } from '@/lib/mailer';

export const dynamic = 'force-dynamic';

// 寄信設定頁用：看寄信是否設定好、佇列狀況，並可寄測試信、立即寄出待寄的信。
// 只有系統管理員 S／管理員 A、B 可以用；不會回傳任何密碼或金鑰。
async function requireAdmin(req: NextRequest) {
  const token = req.headers.get('authorization')?.replace('Bearer ', '');
  if (!token) return { error: NextResponse.json({ error: '未登入' }, { status: 401 }) };
  const { data: auth, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !auth.user) return { error: NextResponse.json({ error: '登入憑證無效' }, { status: 401 }) };
  const { data: u } = await supabaseAdmin.from('app_users').select('role').eq('id', auth.user.id).maybeSingle();
  if (!u || !['system_admin_s', 'admin_a', 'admin_b'].includes(u.role)) {
    return { error: NextResponse.json({ error: '只有管理員可以使用' }, { status: 403 }) };
  }
  return { user: auth.user };
}

export async function GET(req: NextRequest) {
  const a = await requireAdmin(req);
  if (a.error) return a.error;
  const { count: pending } = await supabaseAdmin.from('email_outbox').select('id', { count: 'exact', head: true }).is('sent_at', null);
  const { data: recent } = await supabaseAdmin
    .from('email_outbox')
    .select('id, to_user_id, subject, created_at, sent_at, error')
    .order('created_at', { ascending: false })
    .limit(30);
  const ids = Array.from(new Set((recent ?? []).map((r: any) => r.to_user_id)));
  const { data: names } = await supabaseAdmin.from('app_users').select('id, name').in('id', ids.length ? ids : ['00000000-0000-0000-0000-000000000000']);
  const nameById = new Map((names ?? []).map((n: any) => [n.id, n.name]));
  return NextResponse.json({
    config: mailConfig(),
    pending: pending ?? 0,
    recent: (recent ?? []).map((r: any) => ({ ...r, to_name: nameById.get(r.to_user_id) ?? '' })),
  });
}

export async function POST(req: NextRequest) {
  const a = await requireAdmin(req);
  if (a.error) return a.error;
  const { action } = (await req.json().catch(() => ({}))) as { action?: string };
  if (action === 'flush') {
    return NextResponse.json({ success: true, ...(await flushOutbox()) });
  }
  if (action === 'test') {
    const email = a.user!.email;
    if (!email) return NextResponse.json({ error: '你的帳號沒有信箱' }, { status: 400 });
    if (!mailConfig().configured) return NextResponse.json({ error: '尚未設定寄信（請先在 Vercel 設定 SMTP 或 RESEND_API_KEY 與 MAIL_FROM）' }, { status: 400 });
    const res = await sendMail(email, '【校務系統】測試信', '這是一封測試信。收到代表系統寄信設定正確。');
    if (!res.ok) return NextResponse.json({ error: res.error ?? '寄送失敗' }, { status: 500 });
    return NextResponse.json({ success: true, to: email });
  }
  return NextResponse.json({ error: '未知的動作' }, { status: 400 });
}
