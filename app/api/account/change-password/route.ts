import { isWeakPassword } from '@/lib/weakPasswords';
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

// 教職員自己更改密碼：先輸入目前密碼確認身分（驗證方式同 update-email：直接呼叫 Supabase Auth 的
// 密碼登入端點看成功或失敗，不動任何 client 的 session），通過才更新成新密碼。
// 密碼本身不寫入任何紀錄。
export async function POST(req: NextRequest) {
  try {
    const { currentPassword, newPassword } = (await req.json()) as { currentPassword: string; newPassword: string };
    if (!currentPassword || !newPassword) {
      return NextResponse.json({ error: '請輸入目前密碼與新密碼' }, { status: 400 });
    }
    if (newPassword.length < 6) {
      return NextResponse.json({ error: '新密碼至少要6個字元' }, { status: 400 });
    }
    if (newPassword === currentPassword) {
      return NextResponse.json({ error: '新密碼不能和目前密碼相同' }, { status: 400 });
    }

    const token = req.headers.get('authorization')?.replace('Bearer ', '');
    if (!token) return NextResponse.json({ error: '未登入' }, { status: 401 });

    const { data: callerAuth, error: callerErr } = await supabaseAdmin.auth.getUser(token);
    if (callerErr || !callerAuth.user || !callerAuth.user.email) {
      return NextResponse.json({ error: '登入憑證無效' }, { status: 401 });
    }

    if (isWeakPassword(newPassword)) {
      return NextResponse.json({ error: '這組密碼太常見，請設定其他密碼' }, { status: 400 });
    }

    const verifyRes = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY! },
      body: JSON.stringify({ email: callerAuth.user.email, password: currentPassword }),
    });
    if (!verifyRes.ok) {
      return NextResponse.json({ error: '目前密碼不正確' }, { status: 403 });
    }

    const { error: updateErr } = await supabaseAdmin.auth.admin.updateUserById(callerAuth.user.id, { password: newPassword });
    if (updateErr) {
      return NextResponse.json({ error: '更改密碼失敗：' + updateErr.message }, { status: 500 });
    }
    // 自己改過密碼，就不需要再被要求「第一次登入改密碼」
    await supabaseAdmin.from('app_users').update({ must_change_password: false }).eq('id', callerAuth.user.id);
    // 異動紀錄（只記有改過，不記密碼）；寫入失敗不影響結果
    await supabaseAdmin
      .from('account_audit_log')
      .insert({ target_user_id: callerAuth.user.id, action: 'password_change', old_value: null, new_value: null, changed_by: callerAuth.user.id });

    return NextResponse.json({ success: true });
  } catch (e: any) {
    return NextResponse.json({ error: e.message ?? '未知錯誤' }, { status: 500 });
  }
}
