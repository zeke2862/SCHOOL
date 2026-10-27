import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

// ⚠️ 只能在伺服器端（API route）使用。
// 檢查呼叫者是不是「系統管理員S」或「開發人員（dev）部門」成員——
// 跟前端 /admin/dev-tools 頁的判斷規則一致（perms.isSystemAdmin || hasDepartment(dev)）。
export type DevAuthResult =
  | { ok: true; userId: string; role: string; email: string | null }
  | { ok: false; res: NextResponse };

export async function requireDevOrSystemAdmin(req: NextRequest): Promise<DevAuthResult> {
  const token = req.headers.get('authorization')?.replace('Bearer ', '');
  if (!token) return { ok: false, res: NextResponse.json({ error: '未登入' }, { status: 401 }) };

  const { data: auth, error: authErr } = await supabaseAdmin.auth.getUser(token);
  if (authErr || !auth.user) return { ok: false, res: NextResponse.json({ error: '登入憑證無效' }, { status: 401 }) };

  const { data: profile } = await supabaseAdmin.from('app_users').select('role').eq('id', auth.user.id).single();
  if (!profile) return { ok: false, res: NextResponse.json({ error: '找不到帳號資料' }, { status: 403 }) };

  if (profile.role === 'system_admin_s') {
    return { ok: true, userId: auth.user.id, role: profile.role, email: auth.user.email ?? null };
  }
  const { data: dept } = await supabaseAdmin
    .from('app_user_departments')
    .select('id')
    .eq('app_user_id', auth.user.id)
    .eq('department', 'dev')
    .limit(1);
  if (!dept || dept.length === 0) {
    return { ok: false, res: NextResponse.json({ error: '只有系統管理員S或開發人員部門可以使用這個功能' }, { status: 403 }) };
  }
  return { ok: true, userId: auth.user.id, role: profile.role, email: auth.user.email ?? null };
}
