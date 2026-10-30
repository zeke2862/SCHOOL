import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { withEffectiveRole } from '@/lib/effectiveRole';

// 教務處同意／駁回導師送出的「休學／轉學／轉班」申請。
// 資料庫部分（寫入學籍狀態或換班、入口帳號標記停權、通知導師）由 apply_student_status_request 在同一個交易完成；
// 這支 API 再把對應的家長／學生本人登入帳號封鎖，讓他們立刻無法登入。
// 權限：教務處成員、管理員A、系統管理員S（含開發人員）。
export async function POST(req: NextRequest) {
  const { requestId, approve, note } = (await req.json()) as { requestId: string; approve: boolean; note?: string };
  if (!requestId || typeof approve !== 'boolean') return NextResponse.json({ error: '缺少參數' }, { status: 400 });

  const token = req.headers.get('authorization')?.replace('Bearer ', '');
  if (!token) return NextResponse.json({ error: '未登入' }, { status: 401 });
  const { data: callerAuth } = await supabaseAdmin.auth.getUser(token);
  if (!callerAuth.user) return NextResponse.json({ error: '登入憑證無效' }, { status: 401 });

  const { data: profileRaw } = await supabaseAdmin.from('app_users').select('role, name').eq('id', callerAuth.user.id).maybeSingle();
  if (!profileRaw) return NextResponse.json({ error: '找不到帳號資料' }, { status: 403 });
  const profile = await withEffectiveRole(profileRaw, callerAuth.user.id);
  const { data: acadRows } = await supabaseAdmin
    .from('app_user_departments')
    .select('department')
    .eq('app_user_id', callerAuth.user.id)
    .eq('department', 'academic')
    .limit(1);
  const allowed = profile.role === 'system_admin_s' || profile.role === 'admin_a' || (acadRows ?? []).length > 0;
  if (!allowed) return NextResponse.json({ error: '只有教務處、管理員A、系統管理員S 可以處理學籍異動申請' }, { status: 403 });

  const { data, error } = await supabaseAdmin.rpc('apply_student_status_request', {
    p_id: requestId,
    p_approve: approve,
    p_note: note ?? null,
    p_decider: callerAuth.user.id,
    p_decider_name: profileRaw.name ?? null,
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  const result = data as { auth_user_ids?: string[] } | null;
  const banFailed: string[] = [];
  for (const uid of result?.auth_user_ids ?? []) {
    const { error: banErr } = await supabaseAdmin.auth.admin.updateUserById(uid, { ban_duration: '876000h' });
    if (banErr) banFailed.push(uid);
  }
  // 封鎖失敗不回滾：入口帳號已在資料庫標記停權（is_linked_parent 等判斷會直接擋掉資料），只提醒管理員
  return NextResponse.json({ ok: true, ...(result ?? {}), banFailed });
}
