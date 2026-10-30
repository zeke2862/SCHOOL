import type { MyIdentity } from '@/lib/supabaseClient';

// ============================================================
// 「誰看得到什麼」的唯一對照表（身分 × 功能入口 × 分頁）
// ------------------------------------------------------------
// 以前判斷權限有三套寫法（只看角色／只看部門／首頁卡片自己一套），結果同一個人在不同頁
// 看到的東西不一致。現在全部集中在這一份：
//   - 首頁要顯示哪些入口  → hubVisibleTabs(hub, caps).length > 0
//   - 每個入口裡要顯示哪些分頁 → hubVisibleTabs(hub, caps)
//   - 沒權限的入口／分頁「根本不出現」，直接輸入網址也會被入口頁擋下。
// 這裡只管「畫面上看不看得到」；資料能不能真的讀寫，仍然由資料庫的權限政策（RLS）把關，
// 兩邊是雙保險：就算有人繞過畫面，資料庫那一關還是會擋。
// ============================================================

export type Caps = {
  ident: MyIdentity;
  /** 管理員正在「預覽教師畫面」（只有系統管理員S／開發人員可用，用來測試教師看到的樣子） */
  preview: boolean;
  /** 系統管理員S 或 開發人員部門 */
  sd: boolean;
  /** 管理員A */
  a: boolean;
  /** 管理員B */
  b: boolean;
  academic: boolean;
  discipline: boolean;
  general: boolean;
  devDept: boolean;
  academicLead: boolean;
  disciplineLead: boolean;
  anyLead: boolean;
  anyDept: boolean;
  /** 有導師班 */
  homeroom: boolean;
  /** 有排課（任課） */
  teaching: boolean;
  /** 有社團授課 */
  club: boolean;
  /** 導師或任課（教學現場的老師） */
  teacherLike: boolean;
  /** 臨時（外校支援）教師 */
  temporary: boolean;
};

/** 「預覽教師畫面」時要模擬哪一種老師（管理員自己不一定帶班或任課，不模擬就什麼入口都看不到） */
export type PreviewKind = 'homeroom' | 'teaching' | 'both' | 'club';
export const PREVIEW_KIND_LABEL: Record<PreviewKind, string> = {
  homeroom: '導師',
  teaching: '任課教師',
  both: '導師兼任課',
  club: '社團老師',
};
export function readPreviewKind(): PreviewKind {
  try {
    const v = typeof window !== 'undefined' ? sessionStorage.getItem('previewKind') : null;
    if (v === 'homeroom' || v === 'teaching' || v === 'both' || v === 'club') return v;
  } catch {}
  return 'both';
}

export function computeCaps(rawIdent: MyIdentity, previewTeacher = false, kind: PreviewKind = 'both'): Caps {
  const preview = previewTeacher && rawIdent.role === 'system_admin_s';
  // 預覽時依選的老師類型模擬導師／任課／社團資格；真正的角色與部門在下面一律歸零
  const ident: MyIdentity = preview
    ? {
        ...rawIdent,
        isHomeroom: kind === 'homeroom' || kind === 'both',
        isTeaching: kind === 'teaching' || kind === 'both',
        isClubTeacher: kind === 'club',
      }
    : rawIdent;
  const depts = preview ? [] : ident.departments;
  const has = (d: string) => depts.some((x) => x.department === d);
  const lead = (d: string) => depts.some((x) => x.department === d && x.level === 'lead');
  const sd = !preview && ident.role === 'system_admin_s';
  const a = !preview && ident.role === 'admin_a';
  const b = !preview && ident.role === 'admin_b';
  const academic = sd || a || has('academic');
  const discipline = sd || a || has('discipline');
  const general = sd || a || has('general');
  const devDept = sd || has('dev');
  return {
    ident,
    preview,
    sd,
    a,
    b,
    academic,
    discipline,
    general,
    devDept,
    academicLead: sd || a || lead('academic'),
    disciplineLead: sd || a || lead('discipline'),
    anyLead: depts.some((x) => x.level === 'lead'),
    anyDept: depts.length > 0,
    homeroom: ident.isHomeroom,
    teaching: ident.isTeaching,
    club: ident.isClubTeacher,
    teacherLike: ident.isHomeroom || ident.isTeaching,
    temporary: ident.isTemporary,
  };
}

export type TabDef = { key: string; label: string; show: (c: Caps) => boolean; hint?: string };
export type HubDef = {
  key: string;
  href: string;
  label: string;
  desc: string;
  /** teach＝首頁「教學作業」區；manage＝首頁「行政管理」區 */
  group: 'teach' | 'manage';
  tabs: TabDef[];
};

const anyStaff = (c: Caps) => c.teacherLike || c.anyDept || c.sd || c.a || c.b;

export const HUBS: HubDef[] = [
  {
    key: 'attendance',
    href: '/attendance',
    label: '出缺席',
    desc: '當天／一週登錄、紀錄查詢、任課班級查詢、全校總覽',
    group: 'teach',
    tabs: [
      { key: 'today', label: '當天', show: (c) => c.teacherLike || c.discipline },
      { key: 'week', label: '一週', show: (c) => c.teacherLike || c.discipline },
      { key: 'records', label: '紀錄查詢', show: (c) => c.homeroom || c.discipline },
      { key: 'subject', label: '任課班級出席查詢', show: (c) => c.teaching || c.discipline },
      { key: 'school', label: '全校總覽', show: (c) => c.discipline },
      { key: 'alert', label: '示警門檻設定', show: (c) => c.disciplineLead },
    ],
  },
  {
    key: 'grading',
    href: '/admin/grading',
    label: '成績',
    desc: '成績登錄、班級總表與排名、歷年成績、成績單',
    group: 'teach',
    tabs: [
      { key: 'entry', label: '學生成績登錄', show: (c) => c.teacherLike || c.academic },
      { key: 'school-rankings', label: '全校排行榜', show: (c) => c.teacherLike || c.academic },
      { key: 'conduct', label: '操行成績評分', show: (c) => c.homeroom || c.academic },
      { key: 'class-summary', label: '班級成績總表', show: (c) => c.homeroom || c.academic },
      { key: 'class-results', label: '班級成績結果與排名', show: (c) => c.homeroom || c.academic },
      { key: 'history', label: '歷年成績查詢', show: (c) => c.teacherLike || c.academic },
      { key: 'settings', label: '成績相關設定', show: (c) => c.academicLead },
      { key: 'windows', label: '成績上傳時間設定', show: (c) => c.academic || c.discipline },
      { key: 'batch-print', label: '批次列印成績單', show: (c) => c.academicLead },
      { key: 'report-card-style', label: '成績單樣式設定', show: (c) => c.academicLead },
      { key: 'report-card-merge-template', label: '成績單合併列印範本', show: (c) => c.academicLead },
      { key: 'report-card-xlsx-template', label: '成績單Excel範本', show: (c) => c.academicLead },
    ],
  },
  {
    key: 'registrar',
    href: '/admin/registrar',
    label: '學籍與學生',
    desc: '查詢學生（含名冊）、批次調班、學籍異動、升級作業、歸檔文件、家長帳號',
    group: 'teach',
    tabs: [
      { key: 'search', label: '查詢學生（全校／各班級）', show: (c) => anyStaff(c) },
      { key: 'new', label: '新生入學登記（完整版）', show: (c) => c.academic },
      { key: 'import', label: '既有學生快速建檔（精簡版）', show: (c) => c.academic },
      { key: 'status-change', label: '學籍狀態變更', show: (c) => c.academic },
      { key: 'transfer', label: '學期中轉班', show: (c) => c.academic },
      { key: 'promotion', label: '升級作業', show: (c) => c.academic },
      { key: 'grade-progression', label: '年級升級對照表設定', show: (c) => c.academic },
      { key: 'documents', label: '學生歸檔文件查詢', show: (c) => c.academic || c.devDept },
      { key: 'portal-accounts', label: '家長／學生登入帳號', show: (c) => c.academic || c.devDept },
    ],
  },
  {
    key: 'rewards',
    href: '/discipline',
    label: '獎懲',
    desc: '獎懲登記、查看獎懲紀錄',
    group: 'teach',
    tabs: [
      { key: 'register', label: '獎懲登記', show: (c) => c.teacherLike || c.discipline || c.academic },
      { key: 'history', label: '查看獎懲', show: (c) => c.teacherLike || c.discipline || c.academic },
    ],
  },
  {
    key: 'exam',
    href: '/exam',
    label: '考試分班',
    desc: '考場編排與發送（教務）、輸入考場名單（導師）',
    group: 'teach',
    tabs: [
      { key: 'rosters', label: '輸入考場名單', show: (c) => c.homeroom || c.academic },
      { key: 'seating', label: '考場編排與座位表', show: (c) => c.academic },
    ],
  },
  {
    key: 'clubs',
    href: '/clubs',
    label: '社團',
    desc: '社團點名冊、成績輸入、社團管理',
    group: 'teach',
    tabs: [
      { key: 'roster', label: '社團點名冊', show: (c) => c.club || c.academic },
      { key: 'grading', label: '社團成績輸入', show: (c) => c.club || c.academic },
      { key: 'admin', label: '社團管理與選社設定', show: (c) => c.academic },
    ],
  },
  {
    key: 'clock',
    href: '/clock',
    label: '教職員打卡',
    desc: '我的打卡紀錄、全校打卡管理',
    group: 'teach',
    tabs: [
      { key: 'mine', label: '我的打卡紀錄', show: (c) => anyStaff(c) },
      { key: 'manage', label: '打卡管理（全校）', show: (c) => c.academic },
    ],
  },
  {
    key: 'scheduling',
    href: '/admin/scheduling-hub',
    label: '排課與代課',
    desc: '排課工具、學校課表、代課安排、共同科目鎖定、課表查詢',
    group: 'manage',
    tabs: [{ key: 'hub', label: '排課與代課中心', show: (c) => c.academic }],
  },
  {
    key: 'review',
    href: '/review',
    label: '審核中心',
    desc: '出缺勤修正、成績結算後修正、資料變更通知、家長／學生帳號申請、學生請假申請、送審總覽、異動紀錄',
    group: 'manage',
    tabs: [
      { key: 'attendance', label: '出缺勤修正／開放申請', show: (c) => c.homeroom || c.discipline },
      { key: 'score', label: '成績結算後修正', show: (c) => c.teacherLike || c.academic },
      { key: 'profile', label: '學生資料變更通知', show: (c) => c.homeroom || c.academic },
      { key: 'portal-requests', label: '家長／學生帳號申請', show: (c) => c.homeroom || c.academic, hint: '核對手機後核准' },
      { key: 'student-leave', label: '學生請假申請', show: (c) => c.homeroom || c.academic, hint: '家長請假，核准後寫入出缺席' },
      { key: 'status-requests', label: '學籍異動申請', show: (c) => c.homeroom || c.academic || c.a || c.sd, hint: '休學／轉學／轉班，同意後立即更新名單' },
      { key: 'pending', label: '送審總覽', show: (c) => c.anyLead || c.a || c.sd },
      { key: 'audit', label: '成績／出缺勤修正紀錄', show: (c) => c.a || c.sd },
      { key: 'changes', label: '全系統異動紀錄', show: (c) => c.a || c.sd },
    ],
  },
  {
    key: 'general',
    href: '/general',
    label: '總務',
    desc: '修繕登記、書庫、校服與簿本庫存、水電網路費用',
    group: 'manage',
    tabs: [
      { key: 'maintenance', label: '修繕登記', show: (c) => anyStaff(c) },
      { key: 'library', label: '書庫登記表', show: (c) => c.general },
      { key: 'uniforms', label: '校服庫存販賣表', show: (c) => c.general },
      { key: 'notebooks', label: '簿本庫存販賣表', show: (c) => c.general },
      { key: 'utilities', label: '水電網路等費用', show: (c) => c.general },
    ],
  },
  {
    key: 'system',
    href: '/system',
    label: '系統管理',
    desc: '帳號、臨時教師、資料中心與備份、學年學期、公佈欄、系統文字',
    group: 'manage',
    tabs: [
      { key: 'accounts', label: '帳號管理', show: (c) => c.devDept },
      { key: 'temp-staff', label: '臨時教師（外校支援）', show: (c) => c.academic || c.devDept },
      { key: 'dev-tools', label: '資料中心與備份', show: (c) => c.devDept },
      { key: 'teacher-accounts', label: '教師資料檢查／合併', show: (c) => c.devDept },
      { key: 'class-accounts', label: '班級資料檢查／合併', show: (c) => c.devDept },
      { key: 'academic-terms', label: '學年學期管理', show: (c) => c.devDept },
      { key: 'teacher-desk', label: '教師代辦專區', show: (c) => c.academic || c.devDept },
      { key: 'bulletin', label: '公佈欄管理', show: (c) => c.devDept || c.sd || c.a || c.b, hint: '發布公告、設定顯示天數' },
      { key: 'site-content', label: '系統文字與背景音樂', show: (c) => c.sd },
      { key: 'email-settings', label: '寄信設定', show: (c) => c.devDept || c.sd || c.a, hint: '通知信狀態、寄測試信' },
    ],
  },
];

export function getHub(key: string): HubDef {
  const h = HUBS.find((x) => x.key === key);
  if (!h) throw new Error('unknown hub ' + key);
  return h;
}

export function hubVisibleTabs(hub: HubDef, caps: Caps): TabDef[] {
  return hub.tabs.filter((t) => t.show(caps));
}

export function visibleHubs(caps: Caps): HubDef[] {
  return HUBS.filter((h) => hubVisibleTabs(h, caps).length > 0);
}
