import { supabase } from './supabaseClient';
import { listServiceCertRows } from './teacherLetters';

// 開發人員區「聘書」→「比對報表」：以歷年教師資料的 app_user_id／teacher_id（對應帳號管理、
// 教師名單）為準逐一核對，只讀不寫。還沒對應的聘書資料會列為「未對應帳號」，
// 在「歷年教師資料」編輯、選好「對應帳號」即可消除。

export type CompareIssueKind =
  | '未對應帳號'
  | '離職但帳號仍在'
  | '不續聘待停用帳號'
  | '有教師帳號但聘書未對應'
  | '姓名不一致'
  | '導師不在聘書'
  | '導師已離職或不續聘';

export type CompareIssue = {
  kind: CompareIssueKind;
  name: string;
  detail: string;
};

export type CompareReport = {
  issues: CompareIssue[];
  counts: { certs: number; activeCerts: number; linked: number; accounts: number; teachers: number; homerooms: number };
  academicYear: number | null;
};

const ROLE_LABEL: Record<string, string> = {
  system_admin_s: '系統管理員S',
  admin_a: '管理員A',
  admin_b: '管理員B',
  homeroom_teacher: '導師',
  subject_teacher: '科任教師',
};

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

  const userById = new Map(users.map((u) => [u.id, u]));
  const certByUser = new Map(certs.filter((c) => c.app_user_id).map((c) => [c.app_user_id as string, c]));
  const certByTeacher = new Map(certs.filter((c) => c.teacher_id).map((c) => [c.teacher_id as string, c]));
  const isLeaving = (c: { resigned: boolean; renewal_status: string }) => c.resigned || c.renewal_status === '不續聘';

  const issues: CompareIssue[] = [];

  for (const c of certs) {
    const u = c.app_user_id ? userById.get(c.app_user_id) : undefined;
    if (!u) {
      // 已離職的人本來就不會有帳號，不列
      if (!c.resigned) {
        issues.push({ kind: '未對應帳號', name: c.name, detail: `${c.department ?? ''}${c.title ?? ''}｜聘用結果：${c.renewal_status}｜請在歷年教師資料選擇對應帳號` });
      }
      continue;
    }
    if (norm(u.name) !== norm(c.name)) {
      issues.push({ kind: '姓名不一致', name: c.name, detail: `聘書「${c.name}」／帳號管理「${u.name}」` });
    }
    if (c.resigned) {
      issues.push({ kind: '離職但帳號仍在', name: c.name, detail: `聘書已勾選離職，帳號角色：${ROLE_LABEL[u.role] ?? u.role}` });
    } else if (c.renewal_status === '不續聘') {
      issues.push({ kind: '不續聘待停用帳號', name: c.name, detail: `聘用結果為不續聘，聘期結束當天停用帳號｜帳號角色：${ROLE_LABEL[u.role] ?? u.role}` });
    }
  }

  // 教師帳號（導師／科任）沒有任何聘書資料指到它
  for (const u of users) {
    if ((u.role === 'homeroom_teacher' || u.role === 'subject_teacher') && !certByUser.has(u.id)) {
      issues.push({ kind: '有教師帳號但聘書未對應', name: u.name, detail: `帳號角色：${ROLE_LABEL[u.role]}｜沒有任何歷年教師資料對應到這個帳號` });
    }
  }

  // 現行學年班級導師
  const academicYear = classes.length ? Math.max(...classes.map((c) => c.academic_year)) : null;
  const teacherById = new Map(teachers.map((t) => [t.id, t]));
  const homeroomClasses = new Map<string, string[]>(); // teacher.id → 班級
  for (const cl of classes) {
    if (cl.academic_year !== academicYear || !cl.homeroom_teacher_id) continue;
    homeroomClasses.set(cl.homeroom_teacher_id, [...(homeroomClasses.get(cl.homeroom_teacher_id) ?? []), cl.class_name]);
  }
  for (const [tid, clsNames] of homeroomClasses) {
    const t = teacherById.get(tid);
    if (!t) continue;
    const where = `${academicYear} 學年 ${clsNames.join('、')} 導師`;
    const cert = certByTeacher.get(tid);
    if (!cert) {
      issues.push({ kind: '導師不在聘書', name: t.name, detail: `${where}｜沒有歷年教師資料對應到這位教師` });
    } else if (isLeaving(cert)) {
      issues.push({ kind: '導師已離職或不續聘', name: t.name, detail: `${where}｜聘書為${cert.resigned ? '離職' : '不續聘'}` });
    }
  }

  return {
    issues,
    counts: {
      certs: certs.length,
      activeCerts: certs.filter((c) => !c.resigned).length,
      linked: certs.filter((c) => c.app_user_id).length,
      accounts: users.length,
      teachers: teachers.length,
      homerooms: homeroomClasses.size,
    },
    academicYear,
  };
}
