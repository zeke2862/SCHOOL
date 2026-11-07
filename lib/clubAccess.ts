import { getMyIdentity } from './supabaseClient';

/**
 * 能不能看到「所有社團」（點名冊、成績輸入的社團選單）：
 * 教務處人員（部門職務含 academic，不限主管）、系統管理員S、管理員A 可以。
 * 在「教師畫面」（sessionStorage.viewMode==='teacher'）下視同一般老師，只看到自己指導的社團。
 * 資料庫端 is_club_teacher() 本來就放行教務部門與系統管理員，這裡只是讓畫面也列出全部社團。
 */
export async function canSeeAllClubs(): Promise<boolean> {
  if (typeof window !== 'undefined' && sessionStorage.getItem('viewMode') === 'teacher') return false;
  const ident = await getMyIdentity();
  if (!ident) return false;
  return ['system_admin_s', 'admin_a'].includes(ident.role) || ident.departments.some((d) => d.department === 'academic');
}
