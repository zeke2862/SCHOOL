import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { flushOutbox } from '@/lib/outbox';

// 家長／學生「第一次申請帳號」：輸入登入代碼（HY＋學號；學生本人 HYS＋學號）與手機號碼，
// 系統不直接放行，而是建立一筆「待審核」的申請，通知那個班的導師；導師對照手上的資料表，
// 確認這支手機真的是自己班學生／家長的，才核准（見 sql/116_portal_registration.sql 的
// decide_portal_registration）。核准後手機會自動寫進學籍資料，之後就能用同一組代碼＋手機登入
// （登入驗證仍然是 app/api/portal/request-login）。

function canonicalPhone(s: string): string {
  let d = (s ?? '').replace(/\D/g, '');
  if (d.startsWith('66') && d.length > 9) d = d.slice(2);
  if (d.startsWith('0')) d = d.slice(1);
  return d;
}

export async function POST(req: NextRequest) {
  const { loginCode, phone } = (await req.json().catch(() => ({}))) as { loginCode?: string; phone?: string };
  if (!loginCode || !phone) return NextResponse.json({ error: '請輸入登入代碼與手機號碼' }, { status: 400 });

  const code = loginCode.trim().toUpperCase();
  let relation: '學生本人' | '家長';
  let rawStudentNo: string;
  if (code.startsWith('HYS')) {
    relation = '學生本人';
    rawStudentNo = code.slice(3);
  } else if (code.startsWith('HY')) {
    relation = '家長';
    rawStudentNo = code.slice(2);
  } else {
    return NextResponse.json({ error: '登入代碼格式不正確，請輸入 HY＋學號（學生本人是 HYS＋學號），例如 HY0123' }, { status: 400 });
  }
  if (!rawStudentNo) return NextResponse.json({ error: '登入代碼格式不正確，請輸入 HY＋學號（學生本人是 HYS＋學號）' }, { status: 400 });
  if (canonicalPhone(phone).length < 8) return NextResponse.json({ error: '手機號碼格式不正確，請重新輸入' }, { status: 400 });

  const { data: student } = await supabaseAdmin.from('students').select('student_no, name, phone').ilike('student_no', rawStudentNo).maybeSingle();
  if (!student) return NextResponse.json({ error: '查無這個學號，請確認登入代碼是否輸入正確' }, { status: 404 });

  const { data: enroll } = await supabaseAdmin
    .from('enrollments')
    .select('class_id, classes(grade_level, class_name, homeroom_teacher_id)')
    .eq('student_no', student.student_no)
    .eq('is_current', true)
    .limit(1)
    .maybeSingle();
  if (!enroll) return NextResponse.json({ error: '這位學生目前沒有在學的班級資料，請洽學校' }, { status: 403 });

  // 這支手機如果已經登記在學籍資料裡，直接登入就好，不用再申請
  const key = canonicalPhone(phone);
  let alreadyOnFile = false;
  if (relation === '學生本人') alreadyOnFile = canonicalPhone(student.phone ?? '') === key;
  else {
    const { data: gs } = await supabaseAdmin.from('guardians').select('phone').eq('student_no', student.student_no);
    alreadyOnFile = (gs ?? []).some((g: any) => canonicalPhone(g.phone ?? '') === key);
  }
  if (alreadyOnFile) {
    return NextResponse.json({ alreadyRegistered: true, message: '這支手機已經登記過了，請直接按「登入」。' });
  }

  // 防止被亂刷：同一個代碼 24 小時內最多 5 筆申請
  const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const { count } = await supabaseAdmin
    .from('portal_registration_requests')
    .select('id', { count: 'exact', head: true })
    .eq('login_code', code)
    .gte('requested_at', since);
  if ((count ?? 0) >= 5) return NextResponse.json({ error: '今天這個代碼已經送出太多次申請，請明天再試，或直接洽詢班導師。' }, { status: 429 });

  const cls: any = (enroll as any).classes;
  const classLabel = cls ? `${cls.grade_level}${cls.class_name}` : '';
  const { error } = await supabaseAdmin.from('portal_registration_requests').insert({
    student_no: student.student_no,
    login_code: code,
    relation,
    phone: phone.trim(),
    student_name: student.name,
    class_id: (enroll as any).class_id,
    class_label: classLabel,
  });
  if (error) {
    if ((error as any).code === '23505') {
      return NextResponse.json({ submitted: true, duplicate: true, message: '這支手機的申請已經送出了，正在等班導師核對，請稍候。' });
    }
    return NextResponse.json({ error: '送出申請失敗：' + error.message }, { status: 500 });
  }

  // 資料庫已經替班導師排好通知信，這裡立刻寄出（沒設定寄信或失敗都不影響申請送出）
  await flushOutbox(10).catch(() => {});

  return NextResponse.json({
    submitted: true,
    className: classLabel,
    hasHomeroom: !!cls?.homeroom_teacher_id,
    message: cls?.homeroom_teacher_id
      ? `申請已送給 ${classLabel} 的班導師。導師核對手機號碼後會核准，核准後請回到這個頁面，用同樣的代碼與手機號碼按「登入」。`
      : `申請已送出。${classLabel} 目前沒有登記導師，會由教務處審核；核准後請用同樣的代碼與手機號碼按「登入」。`,
  });
}
