import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

export const dynamic = 'force-dynamic';

// 教職員自己決定要不要收「通知信」（帳號設定頁）。只能改自己的設定。
async function caller(req: NextRequest) {
  const token = req.headers.get('authorization')?.replace('Bearer ', '');
  if (!token) return null;
  const { data, error } = await supabaseAdmin.auth.getUser(token);
  return error || !data.user ? null : data.user;
}

export async function GET(req: NextRequest) {
  const user = await caller(req);
  if (!user) return NextResponse.json({ error: '未登入' }, { status: 401 });
  const { data } = await supabaseAdmin.from('app_users').select('email_notifications').eq('id', user.id).maybeSingle();
  return NextResponse.json({ enabled: data?.email_notifications ?? true, isStaff: !!data });
}

export async function POST(req: NextRequest) {
  const user = await caller(req);
  if (!user) return NextResponse.json({ error: '未登入' }, { status: 401 });
  const { enabled } = (await req.json().catch(() => ({}))) as { enabled?: boolean };
  if (typeof enabled !== 'boolean') return NextResponse.json({ error: '參數錯誤' }, { status: 400 });
  const { error } = await supabaseAdmin.from('app_users').update({ email_notifications: enabled }).eq('id', user.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true, enabled });
}
