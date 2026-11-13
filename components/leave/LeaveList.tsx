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
  leave_group: string | null;
  original_teacher_id: string;
  substitute_teacher_id: string | null;
  term: string;
  academic_year: number;
  classes: { grade_level: string; class_name: string } | null;
};

const SELECT =
  'id, substitute_date, weekday, period_no, subject, status, reason, leave_type, leave_group, original_teacher_id, substitute_teacher_id, term, academic_year, classes(grade_level, class_name)';
const today = () => new Date().toISOString().slice(0, 10);

function Badge({ s }: { s: string }) {
  const color = s === '待安排' || s === '待核准' ? '#A36A00' : s === '已取消' ? '#999' : '#3B6D11';
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
          <tr style={{ borderBottom: '1px solid var(--line-strong)', textAlign: 'left' }}>
            {['日期', '節次', '班級／科目', '假別', '代課老師', '狀態', ''].map((h) => (
              <th key={h} style={{ padding: 8 }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} style={{ borderBottom: '1px solid var(--line)', color: r.status === '已取消' ? 'var(--sub)' : undefined }}>
              <td style={{ padding: 8 }}>{r.substitute_date}</td>
              <td style={{ padding: 8 }}>第{r.period_no}節</td>
              <td style={{ padding: 8 }}>{r.classes ? `${r.classes.grade_level}${r.classes.class_name}` : ''}／{r.subject}</td>
              <td style={{ padding: 8 }}>{r.leave_type ?? '—'}</td>
              <td style={{ padding: 8 }}>{r.substitute_teacher_id ? teacherNames[r.substitute_teacher_id] ?? '—' : '尚未安排'}</td>
              <td style={{ padding: 8 }}><Badge s={r.status} /></td>
              <td style={{ padding: 8 }}>
                {(r.status === '待核准' || r.status === '待安排' || r.status === '已排定') && r.substitute_date >= today() && (
                  <button onClick={() => cancel(r)} style={{ fontSize: 12, padding: '3px 10px' }}>取消請假</button>
                )}
              </td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr><td colSpan={7} style={{ padding: 16, color: 'var(--sub)', textAlign: 'center' }}>還沒有請假紀錄</td></tr>
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
  if (rows.length === 0) return <p style={{ fontSize: 12, color: 'var(--sub)' }}>目前沒有等待安排代課老師的請假。</p>;
  return (
    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
      <thead>
        <tr style={{ borderBottom: '1px solid var(--line-strong)', textAlign: 'left' }}>
          {['日期', '節次', '班級／科目', '請假老師', '假別／事由', '安排代課老師', ''].map((h) => (
            <th key={h} style={{ padding: 8 }}>{h}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.id} style={{ borderBottom: '1px solid var(--line)' }}>
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

/** 教務主任（教務處主管／系統管理員S）：老師自己送出的請假，在這裡同意或退回；同意後才通知代課老師 */
export function ApproveLeavePanel({ teachers, canDecide, onChanged, refreshKey }: { teachers: TeacherOption[]; canDecide: boolean; onChanged: () => void; refreshKey: number }) {
  const [rows, setRows] = useState<Row[]>([]);
  const [busy, setBusy] = useState(false);
  const names = Object.fromEntries(teachers.map((t) => [t.id, t.name]));

  async function load() {
    const { data } = await supabase.from('substitute_assignments').select(SELECT).eq('status', '待核准').order('substitute_date').limit(500);
    setRows((data ?? []) as any);
  }
  useEffect(() => {
    load();
  }, [refreshKey]);

  // 同一次請假（leave_group）合成一張卡片，一次同意或退回
  const groups = Object.values(
    rows.reduce<Record<string, Row[]>>((acc, r) => {
      (acc[r.leave_group ?? r.id] ??= []).push(r);
      return acc;
    }, {}),
  );

  async function decide(list: Row[], approve: boolean) {
    let note = '';
    if (!approve) {
      note = (prompt('退回原因（會通知請假老師）：') ?? '').trim();
      if (!note) return;
    } else if (!confirm(`同意 ${names[list[0].original_teacher_id] ?? ''} 老師共 ${list.length} 節的請假？同意後會通知請假老師與代課老師。`)) return;
    setBusy(true);
    const { error } = await supabase.rpc('decide_leave', { p_ids: list.map((r) => r.id), p_approve: approve, p_note: note || null });
    setBusy(false);
    if (error) return alert('處理失敗：' + error.message);
    supabase.auth.getSession().then(({ data }) => {
      const token = data.session?.access_token;
      if (token) fetch('/api/delegation/notify', { method: 'POST', headers: { Authorization: `Bearer ${token}` } }).catch(() => {});
    });
    await load();
    onChanged();
  }

  if (rows.length === 0) return <p style={{ fontSize: 12, color: 'var(--sub)' }}>目前沒有等待核准的請假。</p>;
  return (
    <div style={{ display: 'grid', gap: 10 }}>
      {groups.map((g) => {
        const first = g[0];
        const dates = Array.from(new Set(g.map((r) => r.substitute_date))).sort();
        return (
          <div key={first.leave_group ?? first.id} style={{ border: '1px solid var(--line)', borderRadius: 8, padding: 12, background: '#fffaf0' }}>
            <div style={{ fontSize: 13, marginBottom: 6 }}>
              <b>{names[first.original_teacher_id] ?? '—'}</b>　{first.leave_type ?? '請假'}　共 {g.length} 節　{dates[0]}
              {dates.length > 1 ? `～${dates[dates.length - 1]}` : ''}
              {first.reason ? `　事由：${first.reason}` : ''}
            </div>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, marginBottom: 8 }}>
              <tbody>
                {g.map((r) => (
                  <tr key={r.id} style={{ borderTop: '1px dashed var(--line)' }}>
                    <td style={{ padding: '3px 6px' }}>{r.substitute_date}</td>
                    <td style={{ padding: '3px 6px' }}>第{r.period_no}節</td>
                    <td style={{ padding: '3px 6px' }}>{r.classes ? `${r.classes.grade_level}${r.classes.class_name}` : ''}／{r.subject}</td>
                    <td style={{ padding: '3px 6px' }}>代課：{r.substitute_teacher_id ? names[r.substitute_teacher_id] ?? '—' : '尚未選'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {canDecide ? (
              <span style={{ display: 'flex', gap: 8 }}>
                <button disabled={busy} onClick={() => decide(g, true)} style={{ padding: '4px 14px', fontSize: 13 }}>同意</button>
                <button disabled={busy} onClick={() => decide(g, false)} style={{ padding: '4px 14px', fontSize: 13 }}>退回</button>
              </span>
            ) : (
              <span style={{ fontSize: 12, color: 'var(--sub)' }}>只有教務主任（教務處主管）可以同意或退回。</span>
            )}
          </div>
        );
      })}
    </div>
  );
}
