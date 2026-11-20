import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { withEffectiveRole } from '@/lib/effectiveRole';

type UserRole = 'system_admin_s' | 'admin_a' | 'admin_b' | 'homeroom_teacher' | 'subject_teacher';

const ROLE_LEVEL: Record<UserRole, number> = {
  system_admin_s: 4,
  admin_a: 3,
  admin_b: 2,
  homeroom_teacher: 1,
  subject_teacher: 1,
};

// 協助重設某人的雙重驗證（手機遺失、換手機時）：移除對方已登記的驗證器，對方下次登入只需密碼，再自行重新設定。
// 規則同重設密碼：只能處理「階層低於自己」的帳號，並留下異動紀錄。
// 這支在 /api/admin/ 底下，middleware 會要求呼叫者本身已通過雙重驗證（如果他有登記的話）。
export async function POST(req: NextRequest) {
  try {
    const { targetUserId } = (await req.json()) as { targetUserId: string };
    if (!targetUserId) return NextResponse.json({ error: '缺少必要欄位' }, { status: 400 });

    const token = req.headers.get('authorization')?.replace('Bearer ', '');
    if (!token) return NextResponse.json({ error: '未登入' }, { status: 401 });
    const { data: callerAuth, error: callerAuthErr } = await supabaseAdmin.auth.getUser(token);
    if (callerAuthErr || !callerAuth.user) return NextResponse.json({ error: '登入憑證無效' }, { status: 401 });

    const { data: callerProfileRaw } = await supabaseAdmin.from('app_users').select('role').eq('id', callerAuth.user.id).single();
    const callerProfile = await withEffectiveRole(callerProfileRaw, callerAuth.user.id);
    if (!callerProfile) return NextResponse.json({ error: '找不到呼叫者角色資料' }, { status: 403 });

    const { data: targetProfile } = await supabaseAdmin.from('app_users').select('role').eq('id', targetUserId).single();
    if (!targetProfile) return NextResponse.json({ error: '找不到目標帳號' }, { status: 404 });

    const callerLevel = ROLE_LEVEL[callerProfile.role as UserRole] ?? 0;
    const targetLevel = ROLE_LEVEL[targetProfile.role as UserRole] ?? 0;
    if (callerLevel <= targetLevel) {
      return NextResponse.json({ error: '沒有權限重設此帳號的雙重驗證（只能處理階層低於自己的帳號）' }, { status: 403 });
    }

    const { data: list, error: listErr } = await supabaseAdmin.auth.admin.mfa.listFactors({ userId: targetUserId });
    if (listErr) return NextResponse.json({ error: '查詢失敗：' + listErr.message }, { status: 500 });
    const factors = list?.factors ?? [];
    if (factors.length === 0) return NextResponse.json({ error: '這個帳號沒有登記雙重驗證' }, { status: 404 });
    for (const f of factors) {
      const { error: delErr } = await supabaseAdmin.auth.admin.mfa.deleteFactor({ userId: targetUserId, id: f.id });
      if (delErr) return NextResponse.json({ error: '移除失敗：' + delErr.message }, { status: 500 });
    }

    const { error: logErr } = await supabaseAdmin.from('account_audit_log').insert({
      target_user_id: targetUserId,
      action: 'mfa_reset',
      old_value: null,
      new_value: '（已由管理者協助重設雙重驗證）',
      changed_by: callerAuth.user.id,
    });
    if (logErr) return NextResponse.json({ success: true, logWarning: '雙重驗證已重設，但寫入異動紀錄失敗：' + logErr.message });
    return NextResponse.json({ success: true });
  } catch (e: any) {
    return NextResponse.json({ error: e.message ?? '未知錯誤' }, { status: 500 });
  }
}
