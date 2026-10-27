import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { withEffectiveRole } from '@/lib/effectiveRole';

// 核准/駁回「家長修改基本資料」的申請。核准時同一個請求內完成兩件事：
// 1) 真的把新值寫進 students 表  2) 把申請狀態標記為已核准，並記下核准時間
// 兩件事包在同一支API裡，是為了避免「改了資料但沒留下核准紀錄」或反過來的不一致狀況。
export async function POST(req: NextRequest) {
  const { requestId, decision } = (await req.json()) as { requestId: string; decision: '核准' | '駁回' };

  const authHeader = req.headers.get('authorization');
  const token = authHeader?.replace('Bearer ', '');
  if (!token) return NextResponse.json({ error: '未登入' }, { status: 401 });

  const { data: callerAuth } = await supabaseAdmin.auth.getUser(token);
  if (!callerAuth.user) return NextResponse.json({ error: '登入憑證無效' }, { status: 401 });

  const { data: callerProfileRaw } = await supabaseAdmin.from('app_users').select('role').eq('id', callerAuth.user.id).single();
    const callerProfile = await withEffectiveRole(callerProfileRaw, callerAuth.user.id);
  const { data: callerTeacher } = await supabaseAdmin.from('teachers').select('id').eq('app_user_id', callerAuth.user.id).maybeSingle();
  // 審核單依部門權責切割：家長／學生改基本資料屬教務（學籍資料）業務，只有教務處成員與系統管理員S（含開發人員）
  // 可以核准任一班的申請；其他部門的管理員（訓導、總務）不能。導師仍只能核准自己導師班學生的申請。
  const { data: acadRows } = await supabaseAdmin
    .from('app_user_departments')
    .select('department')
    .eq('app_user_id', callerAuth.user.id)
    .eq('department', 'academic')
    .limit(1);
  const isAdmin = !!callerProfile && (callerProfile.role === 'system_admin_s' || (acadRows ?? []).length > 0);

  const { data: request } = await supabaseAdmin
    .from('profile_edit_requests')
    .select('id, student_no, field_name, new_value, status, target_table, guardian_id')
    .eq('id', requestId)
    .single();

  if (!request) return NextResponse.json({ error: '找不到這筆申請' }, { status: 404 });
  if (request.status !== '待審核') return NextResponse.json({ error: '這筆申請已經處理過了' }, { status: 400 });

  if (!isAdmin) {
    // 非管理員只能核准「自己現任導師班級」學生的申請
    const { data: isHomeroom } = await supabaseAdmin
      .from('enrollments')
      .select('id, classes!inner(homeroom_teacher_id)')
      .eq('student_no', request.student_no)
      .eq('classes.homeroom_teacher_id', callerTeacher?.id ?? '00000000-0000-0000-0000-000000000000')
      .maybeSingle();
    if (!isHomeroom) {
      return NextResponse.json({ error: '你不是這位學生的導師，沒有權限審核' }, { status: 403 });
    }
  }

  if (decision === '核准') {
    if (request.target_table === 'guardians' && request.guardian_id) {
      // 監護人資料修改：更新 guardians 表指定的那一筆
      const { error: updateGuardianErr } = await supabaseAdmin
        .from('guardians')
        .update({ [request.field_name]: request.new_value })
        .eq('id', request.guardian_id);
      if (updateGuardianErr) {
        return NextResponse.json({ error: '更新監護人資料失敗：' + updateGuardianErr.message }, { status: 500 });
      }
    } else {
      const { error: updateStudentErr } = await supabaseAdmin
        .from('students')
        .update({ [request.field_name]: request.new_value })
        .eq('student_no', request.student_no);
      if (updateStudentErr) {
        return NextResponse.json({ error: '更新學生資料失敗：' + updateStudentErr.message }, { status: 500 });
      }
    }
  }

  const { error: reviewErr } = await supabaseAdmin
    .from('profile_edit_requests')
    .update({ status: decision, reviewed_by: callerAuth.user.id, reviewed_at: new Date().toISOString() })
    .eq('id', requestId);

  if (reviewErr) return NextResponse.json({ error: '記錄審核結果失敗：' + reviewErr.message }, { status: 500 });

  return NextResponse.json({ success: true });
}
