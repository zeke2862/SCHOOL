import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { withEffectiveRole } from '@/lib/effectiveRole';
import { generateOneTimePassword, validateNewPassword } from '@/lib/weakPasswords';
import { pwnedCount, PWNED_MESSAGE } from '@/lib/pwnedPassword';

type UserRole = 'system_admin_s' | 'admin_a' | 'admin_b' | 'homeroom_teacher' | 'subject_teacher';

const ROLE_LEVEL: Record<UserRole, number> = {
  system_admin_s: 4,
  admin_a: 3,
  admin_b: 2,
  homeroom_teacher: 1,
  subject_teacher: 1,
};

// 高權限管理者協助重製密碼：只能重製「階層低於自己」的帳號密碼，並留下異動紀錄（不記錄實際密碼內容）。
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as { targetUserId: string; newPassword?: string; generate?: boolean };
    const { targetUserId } = body;
    // generate=true：由系統產生一次性密碼（隨機、不會外洩過），對方第一次登入一定要自己改掉；回傳給管理者轉交一次
    const generated = body.generate === true;
    const newPassword = generated ? generateOneTimePassword() : body.newPassword;
    if (!targetUserId || !newPassword) {
      return NextResponse.json({ error: '缺少必要欄位' }, { status: 400 });
    }
    if (!generated) {
      const weakReason = validateNewPassword(newPassword);
      if (weakReason) {
        return NextResponse.json({ error: weakReason }, { status: 400 });
      }
      if ((await pwnedCount(newPassword)) > 0) {
        return NextResponse.json({ error: PWNED_MESSAGE }, { status: 400 });
      }
    }

    const authHeader = req.headers.get('authorization');
    const token = authHeader?.replace('Bearer ', '');
    if (!token) {
      return NextResponse.json({ error: '未登入' }, { status: 401 });
    }

    const { data: callerAuth, error: callerAuthErr } = await supabaseAdmin.auth.getUser(token);
    if (callerAuthErr || !callerAuth.user) {
      return NextResponse.json({ error: '登入憑證無效' }, { status: 401 });
    }

    const { data: callerProfileRaw, error: callerProfileErr } = await supabaseAdmin
      .from('app_users')
      .select('role')
      .eq('id', callerAuth.user.id)
      .single();
    const callerProfile = await withEffectiveRole(callerProfileRaw, callerAuth.user.id);
    if (callerProfileErr || !callerProfile) {
      return NextResponse.json({ error: '找不到呼叫者角色資料' }, { status: 403 });
    }

    const { data: targetProfile, error: targetErr } = await supabaseAdmin
      .from('app_users')
      .select('role')
      .eq('id', targetUserId)
      .single();
    if (targetErr || !targetProfile) {
      return NextResponse.json({ error: '找不到目標帳號' }, { status: 404 });
    }

    if (targetProfile.role === 'system_admin_s') {
      return NextResponse.json({ error: '系統管理員S帳號不可用此功能重設密碼' }, { status: 403 });
    }
    const callerLevel = ROLE_LEVEL[callerProfile.role as UserRole] ?? 0;
    const targetLevel = ROLE_LEVEL[targetProfile.role as UserRole] ?? 0;
    if (callerLevel <= targetLevel) {
      return NextResponse.json({ error: '沒有權限重設此帳號的密碼（只能重設階層低於自己的帳號）' }, { status: 403 });
    }

    const { error: updateErr } = await supabaseAdmin.auth.admin.updateUserById(targetUserId, { password: newPassword });
    if (updateErr) {
      return NextResponse.json({ error: '重設密碼失敗：' + updateErr.message }, { status: 500 });
    }

    // 一次性密碼：對方第一次用它登入時，一定要被導去自己改密碼（見 app/(app)/layout.tsx）
    if (generated) {
      await supabaseAdmin.from('app_users').update({ must_change_password: true }).eq('id', targetUserId);
    }

    const { error: logErr } = await supabaseAdmin.from('account_audit_log').insert({
      target_user_id: targetUserId,
      action: 'password_reset',
      old_value: null,
      new_value: '（已由管理者協助重製，實際密碼不留存於紀錄）',
      changed_by: callerAuth.user.id,
    });
    const extra = generated ? { oneTimePassword: newPassword } : {};
    if (logErr) {
      return NextResponse.json({ success: true, ...extra, logWarning: '密碼已重設，但寫入異動紀錄失敗：' + logErr.message });
    }

    return NextResponse.json({ success: true, ...extra });
  } catch (e: any) {
    return NextResponse.json({ error: e.message ?? '未知錯誤' }, { status: 500 });
  }
}
