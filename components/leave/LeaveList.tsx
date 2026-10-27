'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import type { TeacherOption } from './LeaveForm';

type Row = {
  id: string;
  substitute_date: string;
  weekday: number;
  period_no: number;
  subject: string;
  status: string;
  reason: string | null;
  leave_type: string | null;
  original_teacher_id: string;
  substitute_teacher_id: string | null;
  term: string;
  academic_year: number;
  classes: { grade_level: string; class_name: string } | null;
};

const SELECT =
  'id, substitute_date, weekday, period_no, subject, status, reason, leave_type, original_teacher_id, substitute_teacher_id, term, academic_year, classes(grade_level, class_name)';
const today = () => new Date().toISOString().slice(0, 10);

function Badge({ s }: { s: string }) {
  const color = s === '待安排' ? '#A36A00' : s === '已取消' ? '#999' : '#3B6D11';
  return <span style={{ color, fontWeight: 'bold' }}>{s}</span>;
}

/** 老師自己的請假紀錄（可取消還沒發生的） */
export function MyLeaveList({ teacherId, teacherNames, refreshKey }: { teacherId: string; teacherNames: Record<string, string>; refreshKey: number }) {
  const [rows, setRows] = useState<Row[]>([]);
  const [error, setError] = useState('');
  async function load() {
    const { data, error } = await supabase.from('substitute_assignments').select(SELECT).eq('original_teacher_id', teacherId).order('substitute_date', { ascending: false }).limit(100);
    if (error) setError(error.message);
    else setRows((data ?? []) as any);
  }
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [teacherId, refreshKey]);

  async function cancel(r: Row) {
    if (!confirm(`取消 ${r.substitute_date} 第${r.period_no}節的請假？`)) return;
    const { error } = await supabase.from('substitute_assignments').update({ status: '已取消', cancelled_at: new Date().toISOString() }).eq('id', r.id);
    if (error) alert('取消失敗：' + error.message);
    await load();
  }

  return (
    <div>
      {error && <p style={{ fontSize: 12, color: '#A32D2D' }}>讀取失敗：{error}（請確認 sql/110_leave_and_substitute.sql 是否已執行）</p>}
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
        <thead>
          <tr style={{ borderBottom: '1px solid #ddd', textAlign: 'left' }}>
            {['日期', '節次', '班級／科目', '假別', '代課老師', '狀態', ''].map((h) => (
              <th key={h} style={{ padding: 8 }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} style={{ borderBottom: '1px solid #f0f0f0', color: r.status === '已取消' ? '#aaa' : undefined }}>
              <td style={{ padding: 8 }}>{r.substitute_date}</td>
              <td style={{ padding: 8 }}>第{r.period_no}節</td>
              <td style={{ padding: 8 }}>{r.classes ? `${r.classes.grade_level}${r.classes.class_name}` : ''}／{r.subject}</td>
              <td style={{ padding: 8 }}>{r.leave_type ?? '—'}</td>
              <td style={{ padding: 8 }}>{r.substitute_teacher_id ? teacherNames[r.substitute_teacher_id] ?? '—' : '尚未安排'}</td>
              <td style={{ padding: 8 }}><Badge s={r.status} /></td>
              <td style={{ padding: 8 }}>
                {(r.status === '待安排' || r.status === '已排定') && r.substitute_date >= today() && (
                  <button onClick={() => cancel(r)} style={{ fontSize: 12, padding: '3px 10px' }}>取消請假</button>
                )}
              </td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr><td colSpan={7} style={{ padding: 16, color: '#999', textAlign: 'center' }}>還沒有請假紀錄</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

/** 教務處：老師已請假、但還沒指定代課老師的節次，在這裡補上代課人選 */
export function PendingLeavePanel({ term, teachers, onChanged, refreshKey }: { term: { academic_year: number; term: string } | null; teachers: TeacherOption[]; onChanged: () => void; refreshKey: number }) {
  const [rows, setRows] = useState<Row[]>([]);
  const [opts, setOpts] = useState<Record<string, TeacherOption[]>>({});
  const [pick, setPick] = useState<Record<string, string>>({});
  const names = Object.fromEntries(teachers.map((t) => [t.id, t.name]));

  async function load() {
    const { data } = await supabase.from('substitute_assignments').select(SELECT).eq('status', '待安排').gte('substitute_date', today()).order('substitute_date').limit(200);
    setRows((data ?? []) as any);
  }
  useEffect(() => {
    load();
  }, [refreshKey]);

  async function loadOpts(r: Row) {
    const { data } = await supabase.rpc('available_substitute_teachers', {
      p_academic_year: r.academic_year,
      p_term: r.term,
      p_weekday: r.weekday,
      p_period_no: r.period_no,
      p_date: r.substitute_date,
    });
    setOpts((o) => ({ ...o, [r.id]: (data ?? []).map((x: any) => ({ id: x.teacher_id, name: x.teacher_name })).filter((t: TeacherOption) => t.id !== r.original_teacher_id) }));
  }
  useEffect(() => {
    rows.forEach((r) => loadOpts(r));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows.map((r) => r.id).join(',')]);

  async function assign(r: Row) {
    const sub = pick[r.id];
    if (!sub) return alert('請先選代課老師');
    const { error } = await supabase.from('substitute_assignments').update({ substitute_teacher_id: sub, status: '已排定' }).eq('id', r.id);
    if (error) return alert('安排失敗：' + error.message);
    await load();
    onChanged();
  }

  if (!term) return null;
  if (rows.length === 0) return <p style={{ fontSize: 12, color: '#999' }}>目前沒有等待安排代課老師的請假。</p>;
  return (
    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
      <thead>
        <tr style={{ borderBottom: '1px solid #ddd', textAlign: 'left' }}>
          {['日期', '節次', '班級／科目', '請假老師', '假別／事由', '安排代課老師', ''].map((h) => (
            <th key={h} style={{ padding: 8 }}>{h}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.id} style={{ borderBottom: '1px solid #f0f0f0' }}>
            <td style={{ padding: 8 }}>{r.substitute_date}</td>
            <td style={{ padding: 8 }}>第{r.period_no}節</td>
            <td style={{ padding: 8 }}>{r.classes ? `${r.classes.grade_level}${r.classes.class_name}` : ''}／{r.subject}</td>
            <td style={{ padding: 8 }}>{names[r.original_teacher_id] ?? '—'}</td>
            <td style={{ padding: 8 }}>{[r.leave_type, r.reason].filter(Boolean).join('／') || '—'}</td>
            <td style={{ padding: 8 }}>
              <select value={pick[r.id] ?? ''} onChange={(e) => setPick((p) => ({ ...p, [r.id]: e.target.value }))} style={{ padding: 5, minWidth: 150 }}>
                <option value="">{opts[r.id] ? (opts[r.id].length ? '選空堂老師' : '查不到空堂老師') : '查詢中…'}</option>
                {(opts[r.id] ?? []).map((t) => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
            </td>
            <td style={{ padding: 8 }}>
              <button onClick={() => assign(r)} style={{ fontSize: 12, padding: '3px 10px' }}>安排</button>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
