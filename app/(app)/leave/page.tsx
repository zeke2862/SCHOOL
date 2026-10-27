'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { resolveCurrentTerm } from '@/lib/academicTerm';
import LeaveForm, { TeacherOption } from '@/components/leave/LeaveForm';
import { MyLeaveList } from '@/components/leave/LeaveList';

// 老師自己請假：只能替自己的課請假，順便選那一節有空堂的老師代課（也可以先不選，由教務處安排）。
export default function LeavePage() {
  const [me, setMe] = useState<{ userId: string; teacherId: string | null; name: string } | null>(null);
  const [term, setTerm] = useState<{ academic_year: number; term: string } | null>(null);
  const [teachers, setTeachers] = useState<TeacherOption[]>([]);
  const [ready, setReady] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    (async () => {
      const { data: auth } = await supabase.auth.getUser();
      const uid = auth.user?.id;
      if (!uid) {
        setReady(true);
        return;
      }
      const [{ data: t }, { data: all }, cur] = await Promise.all([
        supabase.from('teachers').select('id, name').eq('app_user_id', uid).maybeSingle(),
        supabase.from('teachers').select('id, name').order('name'),
        resolveCurrentTerm(),
      ]);
      setMe({ userId: uid, teacherId: t?.id ?? null, name: t?.name ?? '' });
      setTeachers((all ?? []) as TeacherOption[]);
      setTerm(cur);
      setReady(true);
    })();
  }, []);

  if (!ready) return <p style={{ padding: 24, fontSize: 13, color: '#999' }}>載入中…</p>;
  if (!me) return <p style={{ padding: 24, fontSize: 13 }}>請先登入。</p>;
  if (!me.teacherId) {
    return (
      <main style={{ maxWidth: 560, margin: '0 auto', padding: 24 }}>
        <h1 style={{ fontSize: 16 }}>請假與代課</h1>
        <p style={{ fontSize: 13, color: '#999' }}>您的帳號沒有對應到教師資料，無法自己請假。臨時有事請洽教務處代為登記。</p>
      </main>
    );
  }

  return (
    <main style={{ maxWidth: 900, margin: '0 auto', padding: 24 }}>
      <h1 style={{ fontSize: 16, marginBottom: 4 }}>請假與代課</h1>
      <p style={{ fontSize: 12, color: '#666', marginBottom: 16, lineHeight: 1.7 }}>
        選好請假日期，系統會列出您當天的課；勾選要請假的節次，每一節旁邊可以直接選那一節「有空堂」的老師代課。
        不確定誰能代課也可以先不選，送出後狀態是「待安排」，教務處會再安排。只能替自己請假；臨時來不及登記，請洽教務處代為輸入。
        {term ? `（目前學期：${term.academic_year} ${term.term}）` : ''}
      </p>

      <section style={{ border: '1px solid #eee', borderRadius: 8, padding: 16, marginBottom: 24 }}>
        <h2 style={{ fontSize: 14, marginBottom: 12 }}>我要請假</h2>
        <LeaveForm mode="self" userId={me.userId} term={term} teachers={teachers.filter((t) => t.id === me.teacherId)} fixedTeacherId={me.teacherId} onDone={() => setRefreshKey((k) => k + 1)} />
      </section>

      <section>
        <h2 style={{ fontSize: 14, marginBottom: 12 }}>我的請假紀錄</h2>
        <MyLeaveList teacherId={me.teacherId} teacherNames={Object.fromEntries(teachers.map((t) => [t.id, t.name]))} refreshKey={refreshKey} />
      </section>
    </main>
  );
}
