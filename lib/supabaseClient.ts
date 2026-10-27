import { createClient } from '@supabase/supabase-js';

// 環境變數需在 .env.local 設定：
//   NEXT_PUBLIC_SUPABASE_URL
//   NEXT_PUBLIC_SUPABASE_ANON_KEY
export const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

export type UserRole =
  | 'system_admin_s'
  | 'admin_a'
  | 'admin_b'
  | 'homeroom_teacher'
  | 'subject_teacher';

export const ROLE_LABEL: Record<UserRole, string> = {
  system_admin_s: '系統管理員S',
  admin_a: '系統管理員A',
  admin_b: '管理員B',
  homeroom_teacher: '班級導師',
  subject_teacher: '任課教師',
};

export const ADMIN_ROLES: UserRole[] = ['system_admin_s', 'admin_a', 'admin_b'];

/**
 * 判斷「目前這個畫面該不該當作管理員」：跟只看 role 的差別是，管理員帳號用「身分切換」切到
 * 教師視角時（sessionStorage.viewMode==='teacher'），這裡一律回傳 false。
 * 各分頁/元件裡原本各自寫「ADMIN_ROLES.includes(appUser.role)」的地方都應該改呼叫這支，
 * 不然管理員切成教師視角後，各分頁裡「刪除設定」「編輯任一班成績」「編輯學生名單」這類管理員
 * 專屬功能還是會照舊角色繼續顯示出來，「身分切換」形同虛設。
 */
export function isAdminInCurrentView(role: string | null | undefined): boolean {
  if (!role || !ADMIN_ROLES.includes(role as UserRole)) return false;
  if (typeof window !== 'undefined' && sessionStorage.getItem('viewMode') === 'teacher') return false;
  return true;
}

// ---------------------------------------------------------------
// 【身分統一出口】所有「我是誰、能做什麼」都從資料庫的 my_effective_identity() 一次取得
// （sql/109）：帳號角色、部門職務、導師/任課/社團資格、是否正在代理別人、臨時帳號是否到期。
// 代理期間（acting）回傳的 role / departments / teacher_id 已經是「代理後」的有效身分，
// 所以大部分頁面只要照舊呼叫 getCurrentAppUser() 就會自動跟著代理身分走。
// ---------------------------------------------------------------
export type DepartmentName = 'dev' | 'academic' | 'discipline' | 'general';
export type MyIdentity = {
  uid: string; // 登入者本人
  name: string;
  realRole: UserRole;
  role: UserRole; // 有效角色（開發人員部門視同 system_admin_s）；代理期間角色與部門仍是本人的，只有導師班／任課科目換成被代理者
  departments: { department: DepartmentName; level: 'lead' | 'staff' }[];
  teacherId: string | null;
  isHomeroom: boolean;
  isTeaching: boolean;
  isClubTeacher: boolean;
  isTemporary: boolean;
  accountExpiresAt: string | null;
  expired: boolean;
  acting: { principalId: string; principalName: string; endAt: string } | null;
  actingOptions: { principalId: string; principalName: string; endAt: string }[];
};

async function fetchMyIdentity(): Promise<MyIdentity | null> {
  const { data: authData } = await supabase.auth.getUser();
  if (!authData.user) return null;
  const { data, error } = await supabase.rpc('my_effective_identity');
  if (error || !data) {
    // sql/109 尚未執行（或暫時失敗）：退回舊做法，只看帳號本身的角色與部門
    const { data: row } = await supabase.from('app_users').select('id, name, role').eq('id', authData.user.id).single();
    if (!row) return null;
    const { data: deptRows } = await supabase.from('app_user_departments').select('department, level').eq('app_user_id', authData.user.id);
    const departments = (deptRows ?? []) as MyIdentity['departments'];
    const isDev = departments.some((d) => d.department === 'dev');
    const { data: t } = await supabase.from('teachers').select('id').eq('app_user_id', authData.user.id).maybeSingle();
    const teacherId = t?.id ?? null;
    return {
      uid: authData.user.id,
      name: row.name,
      realRole: row.role as UserRole,
      role: (isDev ? 'system_admin_s' : row.role) as UserRole,
      departments,
      teacherId,
      isHomeroom: await getHasTeachingAssignment(teacherId),
      isTeaching: await getHasTeachingAssignment(teacherId),
      isClubTeacher: false,
      isTemporary: false,
      accountExpiresAt: null,
      expired: false,
      acting: null,
      actingOptions: [],
    };
  }
  const d = data as any;
  const departments = (d.departments ?? []) as MyIdentity['departments'];
  const isDev = departments.some((x) => x.department === 'dev');
  const rawRole = d.role as UserRole | null;
  return {
    uid: d.uid,
    name: d.name,
    realRole: d.real_role as UserRole,
    role: (isDev || rawRole === 'system_admin_s' ? 'system_admin_s' : rawRole ?? (d.real_role as UserRole)) as UserRole,
    departments,
    teacherId: d.teacher_id ?? null,
    isHomeroom: !!d.is_homeroom,
    isTeaching: !!d.is_teaching,
    isClubTeacher: !!d.is_club_teacher,
    isTemporary: !!d.is_temporary,
    accountExpiresAt: d.account_expires_at ?? null,
    expired: !!d.expired,
    acting: d.acting ? { principalId: d.acting.principal_id, principalName: d.acting.principal_name, endAt: d.acting.end_at } : null,
    actingOptions: (d.acting_options ?? []).map((o: any) => ({ principalId: o.principal_id, principalName: o.principal_name, endAt: o.end_at })),
  };
}

let identityCache: { at: number; promise: Promise<MyIdentity | null> } | null = null;

/** 取得「目前有效的身分」（含代理狀態、部門、導師/任課資格）。30 秒內重複呼叫共用同一份結果。 */
export function getMyIdentity(): Promise<MyIdentity | null> {
  const now = Date.now();
  if (identityCache && now - identityCache.at < 30_000) return identityCache.promise;
  const promise = fetchMyIdentity();
  identityCache = { at: now, promise };
  promise.then((u) => {
    if (!u && identityCache?.promise === promise) identityCache = null;
  });
  return promise;
}

/** 開始／結束代理、切換身分之後要呼叫，讓畫面立刻讀到新的有效身分 */
export function resetIdentityCache() {
  identityCache = null;
  appUserCache = null;
}

async function fetchCurrentAppUser() {
  const { data: authData } = await supabase.auth.getUser();
  if (!authData.user) return null;
  const ident = await getMyIdentity();
  if (!ident) return null;
  // 臨時（外校支援）帳號到期：直接登出，不再放行
  if (ident.expired) {
    await supabase.auth.signOut();
    return null;
  }
  // 附上目前登入信箱：同一個人如果先前被建立過兩個不同帳號（例如導師帳號 + 後來另外建立的管理員帳號），
  // 光看名字容易誤以為是同一筆資料，附上信箱才看得出目前登入的到底是哪一個帳號。
  // 【代理期間】id 一律回傳「被代理人」的 id，這樣各頁面用 app_user_id 去查自己的教師資料/班級時，
  // 查到的就是被代理人的班級與科目；realId 永遠是登入者本人。role 是有效角色（開發人員部門視同系統管理員S），代理期間仍是本人的角色。
  return {
    id: ident.acting ? ident.acting.principalId : ident.uid,
    realId: ident.uid,
    name: ident.acting ? `${ident.name}（代理 ${ident.acting.principalName}）` : ident.name,
    role: ident.role,
    realRole: ident.realRole,
    acting: ident.acting,
    email: authData.user.email ?? null,
  };
}

// 【效能】一個頁面通常有好幾個元件（分頁、權限 hook…）各自呼叫 getCurrentAppUser()，
// 每次都要打一趟 Auth 伺服器＋一趟 app_users。這裡把同一時間的呼叫合併成一次，
// 並短暫快取 30 秒；登入/登出/換 token/改信箱等任何驗證狀態變化都會立刻清掉快取。
let appUserCache: { at: number; promise: ReturnType<typeof fetchCurrentAppUser> } | null = null;
if (typeof window !== 'undefined') {
  supabase.auth.onAuthStateChange(() => {
    appUserCache = null;
    identityCache = null;
  });
}

/** 取得目前登入使用者的角色資料，尚未登入回傳 null */
export function getCurrentAppUser() {
  const now = Date.now();
  if (appUserCache && now - appUserCache.at < 30_000) return appUserCache.promise;
  const promise = fetchCurrentAppUser();
  appUserCache = { at: now, promise };
  promise.then((u) => {
    if (!u && appUserCache?.promise === promise) appUserCache = null; // 沒登入/查詢失敗不要快取
  });
  return promise;
}

/**
 * 取得目前登入使用者對應的 teachers.id（如果這個帳號有連結教師資料的話）。
 * 【2026-08-11 新增】原本「通知」頁跟 TopNav 的未讀通知數都直接查
 * staff_notifications 全部欄位，沒有自己在前端過濾 teacher_id，變成完全依賴
 * RLS 政策幫忙擋——但 RLS 政策裡系統管理員／訓導部門本來就特意放寬可以看到
 * 「全部教師」的通知（用於審核/監督），結果這些帳號打開「通知」頁看到的就是
 * 全校所有人的通知混在一起，感覺像是「大家共用同一份」。改成前端明確查自己的
 * teacher_id、只抓屬於自己的通知，才會是「個人（相關人員）」專屬的提示。
 * 沒有連結教師資料的帳號（純管理帳號、沒有教師身分）回傳 null，代表沒有「屬於
 * 自己」的個人通知——如果之後要做「管理員審核用的全校通知總覽」，應該另外開一個
 * 獨立頁面，不要跟這裡的「個人通知」混在一起。
 */
export async function getCurrentTeacherId(): Promise<string | null> {
  const ident = await getMyIdentity();
  return ident?.teacherId ?? null;
}

/**
 * 這位老師目前是不是「真的有帶班/排課/社團」：用於首頁功能表自動隱藏
 * 「有 adminOnly:false 但沒有任何指派就打開也是空的」那幾個教學現場功能
 * （出缺席登錄、社團點名/成績——見 lib/adminModules.ts 的 requiresTeachingAssignment）。
 * 三種來源只要符合其中一種就算「有」：導師班（classes.homeroom_teacher_id）、
 * 排課（class_schedule.teacher_id）、社團授課（clubs.teacher_id）。
 */
export async function getHasTeachingAssignment(teacherId: string | null): Promise<boolean> {
  if (!teacherId) return false;
  const [homeroom, schedule, club] = await Promise.all([
    supabase.from('classes').select('id').eq('homeroom_teacher_id', teacherId).limit(1),
    supabase.from('class_schedule').select('id').eq('teacher_id', teacherId).limit(1),
    supabase.from('clubs').select('id').eq('teacher_id', teacherId).limit(1),
  ]);
  return (homeroom.data?.length ?? 0) > 0 || (schedule.data?.length ?? 0) > 0 || (club.data?.length ?? 0) > 0;
}
