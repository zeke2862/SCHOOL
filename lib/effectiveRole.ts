import { supabaseAdmin } from '@/lib/supabaseAdmin';

/**
 * 伺服器端（API route）專用：開發人員部門（dev）是「唯讀」身分——看得到全部資料，但不能寫入。
 * 帳號本身的 role 不是 system_admin_s 的開發人員：
 *  - 唯讀功能（下載、查詢、產生 PDF）：傳 { readOnly: true }，視同 system_admin_s 通過檢查；
 *  - 其餘（預設）：role 改成 'dev_readonly'，所有「需要管理員身分」的檢查都不會通過，等於不能寫。
 * 資料庫那邊對應的是 sql/140：is_system_admin() 仍含 dev（可讀），另有限制型政策擋掉 INSERT／UPDATE／DELETE。
 */
export async function withEffectiveRole<T extends { role: string } | null | undefined>(
  profile: T,
  userId: string,
  opts?: { readOnly?: boolean }
): Promise<T> {
  if (!profile || profile.role === 'system_admin_s') return profile;
  const { data } = await supabaseAdmin
    .from('app_user_departments')
    .select('department')
    .eq('app_user_id', userId)
    .eq('department', 'dev')
    .limit(1);
  if (data && data.length > 0) return { ...profile, role: opts?.readOnly ? 'system_admin_s' : 'dev_readonly' } as T;
  return profile;
}
