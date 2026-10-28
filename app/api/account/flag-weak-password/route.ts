import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

// 教職員用已知的預設密碼（見 lib/weakPasswords.ts）登入後，登入頁會呼叫這裡，
// 把自己的 app_users.must_change_password 設成 true，之後 app/(app)/layout.tsx 就會
// 把他擋在 /change-password，改完新密碼才能繼續使用。只能標記呼叫者自己。
export async function POST(req: NextRequest) {
  try {
    const token = req.headers.get('authorization')?.replace('Bearer ', '');
    if (!token) return NextResponse.json({ error: '未登入' }, { status: 401 });

    const { data: callerAuth, error: callerErr } = await supabaseAdmin.auth.getUser(token);
    if (callerErr || !callerAuth.user) return NextResponse.json({ error: '登入憑證無效' }, { status: 401 });

    const { error } = await supabaseAdmin.from('app_users').update({ must_change_password: true }).eq('id', callerAuth.user.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ success: true });
  } catch (e: any) {
    return NextResponse.json({ error: e.message ?? '未知錯誤' }, { status: 500 });
  }
}
