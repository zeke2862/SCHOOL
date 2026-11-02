import { supabase } from './supabaseClient';
import { listServiceCertRows } from './teacherLetters';

// 開發人員區「聘書」→「比對報表」：歷年教師資料（聘書）跟帳號管理（app_users）、
// 教師名單（teachers）、班級導師（classes.homeroom_teacher_id）之間沒有任何關聯欄位，
// 只能用「姓名」比對。這裡只讀不寫，列出兩邊對不起來的地方給管理者人工確認。

export type CompareIssueKind =
  | '在職但無帳號'
  | '離職但帳號仍在'
  | '有教師帳號但聘書查無'
  | '導師不在聘書'
  | '導師已離職'
  | '聘書姓名重複';

export type CompareIssue = {
  kind: CompareIssueKind;
  name: string;
  detail: string;
};

export type CompareReport = {
  issues: CompareIssue[];
  counts: { certs: number; activeCerts: number; accounts: number; teachers: number; homerooms: number };
  academicYear: number | null;
};

const ROLE_LABEL: Record<string, string> = {
  system_admin_s: '系統管理員S',
  admin_a: '管理員A',
  admin_b: '管理員B',
  homeroom_teacher: '導師',
  subject_teacher: '科任教師',
};

// 比對用：去掉所有空白（含全形），避免「王 小明」「王小明」被當成不同人
function norm(s: string | null | undefined): string {
  return (s ?? '').replace(/[\s　]+/g, '');
}

export async function buildTeacherLetterCompareReport(): Promise<CompareReport> {
  const [certs, usersRes, teachersRes, classesRes] = await Promise.all([
    listServiceCertRows(),
    supabase.from('app_users').select('id, name, role'),
    supabase.from('teachers').select('id, name, app_user_id'),
    supabase.from('classes').select('class_name, academic_year, homeroom_teacher_id'),
  ]);
  const err = usersRes.error ?? teachersRes.error ?? classesRes.error;
  if (err) throw new Error(err.message);

  const users = (usersRes.data ?? []) as { id: string; name: string; role: string }[];
  const teachers = (teachersRes.data ?? []) as { id: string; name: string; app_user_id: string | null }[];
  const classes = (classesRes.data ?? []) as { class_name: string; academic_year: number; homeroom_teacher_id: string | null }[];

  const issues: CompareIssue[] = [];

  // 聘書姓名重複（聘書端本來就用姓名當鍵，同名會對到第一筆）
  const certByName = new Map<string, typeof certs>();
  for (const c of certs) {
    const k = norm(c.name);
    certByName.set(k, [...(certByName.get(k) ?? []), c]);
  }
  for (const [, list] of certByName) {
    if (list.length > 1) {
      issues.push({ kind: '聘書姓名重複', name: list[0].name, detail: `歷年教師資料有 ${list.length} 筆同名（序號 ${list.map((c) => c.seq_no ?? '-').join('、')}）` });
    }
  }

  const activeCerts = certs.filter((c) => !c.resigned);
  const activeNames = new Set(activeCerts.map((c) => norm(c.name)));
  const resignedNames = new Set(certs.filter((c) => c.resigned).map((c) => norm(c.name)));
  const userNames = new Set(users.map((u) => norm(u.name)));
  const teacherNames = new Set(teachers.map((t) => norm(t.name)));

  // 1. 聘書在職，但帳號與教師名單都找不到
  for (const c of activeCerts) {
    const k = norm(c.name);
    if (!userNames.has(k) && !teacherNames.has(k)) {
      issues.push({ kind: '在職但無帳號', name: c.name, detail: `${c.department ?? ''}${c.title ?? ''}｜帳號管理與教師名單都查無此姓名` });
    }
  }

  // 2. 聘書已離職，但帳號仍在（且沒有同名在職者）
  for (const u of users) {
    const k = norm(u.name);
    if (resignedNames.has(k) && !activeNames.has(k)) {
      issues.push({ kind: '離職但帳號仍在', name: u.name, detail: `聘書已勾選離職，帳號角色：${ROLE_LABEL[u.role] ?? u.role}` });
    }
  }

  // 3. 教師帳號（導師／科任）聘書查無
  const allCertNames = new Set(certs.map((c) => norm(c.name)));
  for (const u of users) {
    if ((u.role === 'homeroom_teacher' || u.role === 'subject_teacher') && !allCertNames.has(norm(u.name))) {
      issues.push({ kind: '有教師帳號但聘書查無', name: u.name, detail: `帳號角色：${ROLE_LABEL[u.role]}｜歷年教師資料沒有這個姓名` });
    }
  }

  // 4. 現行學年班級導師：不在聘書或已離職
  const academicYear = classes.length ? Math.max(...classes.map((c) => c.academic_year)) : null;
  const teacherById = new Map(teachers.map((t) => [t.id, t]));
  const homeroomClasses = new Map<string, string[]>(); // 姓名 → 班級
  for (const cl of classes) {
    if (cl.academic_year !== academicYear || !cl.homeroom_teacher_id) continue;
    const t = teacherById.get(cl.homeroom_teacher_id);
    if (!t) continue;
    homeroomClasses.set(t.name, [...(homeroomClasses.get(t.name) ?? []), cl.class_name]);
  }
  for (const [name, clsNames] of homeroomClasses) {
    const k = norm(name);
    const where = `${academicYear} 學年 ${clsNames.join('、')} 導師`;
    if (!allCertNames.has(k)) {
      issues.push({ kind: '導師不在聘書', name, detail: `${where}｜歷年教師資料查無此姓名` });
    } else if (!activeNames.has(k)) {
      issues.push({ kind: '導師已離職', name, detail: `${where}｜聘書卻已勾選離職` });
    }
  }

  return {
    issues,
    counts: { certs: certs.length, activeCerts: activeCerts.length, accounts: users.length, teachers: teachers.length, homerooms: homeroomClasses.size },
    academicYear,
  };
}
