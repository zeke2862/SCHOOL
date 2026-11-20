import { NextRequest } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

// ⚠️ 只能在伺服器端（API route）使用。
export type Caller = {
  userId: string;
  email: string | null;
  role: string; // 有效角色（開發人員唯讀：opts.readOnly 才視同 system_admin_s，否則是 dev_readonly）。代理只代理一線教學工作，不影響這裡的角色
  isSD: boolean; // 系統管理員S 或 開發人員
  isA: boolean;
  hasAcademic: boolean;
};

export async function getCaller(req: NextRequest, opts?: { readOnly?: boolean }): Promise<Caller | { error: string; status: number }> {
  const token = req.headers.get('authorization')?.replace('Bearer ', '');
  if (!token) return { error: '未登入', status: 401 };
  const { data: auth, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !auth.user) return { error: '登入憑證無效', status: 401 };
  // 帳號資料與所屬部門互不相依，同時查（以前是 3 次依序往返：app_users → dev 部門 → 全部部門）。
  // 開發人員（dev）判斷直接用已查到的部門清單，規則與 withEffectiveRole 相同。
  const [{ data: profileRaw }, { data: depts }] = await Promise.all([
    supabaseAdmin.from('app_users').select('role, account_expires_at').eq('id', auth.user.id).maybeSingle(),
    supabaseAdmin.from('app_user_departments').select('department').eq('app_user_id', auth.user.id),
  ]);
  if (!profileRaw) return { error: '找不到帳號資料', status: 403 };
  if (profileRaw.account_expires_at && new Date(profileRaw.account_expires_at) <= new Date()) {
    return { error: '此帳號已到期', status: 403 };
  }
  const isDev = (depts ?? []).some((d: any) => d.department === 'dev');
  const profile =
    profileRaw.role !== 'system_admin_s' && isDev
      ? { ...profileRaw, role: opts?.readOnly ? 'system_admin_s' : 'dev_readonly' }
      : profileRaw;
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
