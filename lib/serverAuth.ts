import { NextRequest } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { withEffectiveRole } from '@/lib/effectiveRole';

// ⚠️ 只能在伺服器端（API route）使用。
export type Caller = {
  userId: string;
  email: string | null;
  role: string; // 有效角色（開發人員部門視同 system_admin_s）。代理只代理一線教學工作，不影響這裡的角色
  isSD: boolean; // 系統管理員S 或 開發人員
  isA: boolean;
  hasAcademic: boolean;
};

export async function getCaller(req: NextRequest): Promise<Caller | { error: string; status: number }> {
  const token = req.headers.get('authorization')?.replace('Bearer ', '');
  if (!token) return { error: '未登入', status: 401 };
  const { data: auth, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !auth.user) return { error: '登入憑證無效', status: 401 };
  const { data: profileRaw } = await supabaseAdmin.from('app_users').select('role, account_expires_at').eq('id', auth.user.id).maybeSingle();
  if (!profileRaw) return { error: '找不到帳號資料', status: 403 };
  if (profileRaw.account_expires_at && new Date(profileRaw.account_expires_at) <= new Date()) {
    return { error: '此帳號已到期', status: 403 };
  }
  const profile = await withEffectiveRole(profileRaw, auth.user.id);
  const { data: depts } = await supabaseAdmin.from('app_user_departments').select('department');
  const hasAcademic = (depts ?? []).some((d: any) => d.department === 'academic');
  return {
    userId: auth.user.id,
    email: auth.user.email ?? null,
    role: profile.role,
    isSD: profile.role === 'system_admin_s',
    isA: profile.role === 'admin_a',
    hasAcademic,
  };
}
