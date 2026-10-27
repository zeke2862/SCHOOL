import { supabaseAdmin } from '@/lib/supabaseAdmin';

/**
 * 伺服器端（API route）專用：開發人員部門（dev）的成員，權限等同系統管理員S。
 * 帳號本身的 role 可能只是 admin_a／admin_b，這裡查 app_user_departments，
 * 只要身兼 dev 就把 role 當成 system_admin_s 回傳，其餘身分原樣回傳。
 * 資料庫那邊的 is_system_admin() 也是同樣規則（見 sql/106）。
 */
export async function withEffectiveRole<T extends { role: string } | null | undefined>(
  profile: T,
  userId: string
): Promise<T> {
  if (!profile || profile.role === 'system_admin_s') return profile;
  const { data } = await supabaseAdmin
    .from('app_user_departments')
    .select('department')
    .eq('app_user_id', userId)
    .eq('department', 'dev')
    .limit(1);
  if (data && data.length > 0) return { ...profile, role: 'system_admin_s' } as T;
  return profile;
}
