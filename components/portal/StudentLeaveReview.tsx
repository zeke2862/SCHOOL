'use client';

import { useEffect, useState } from 'react';
import { supabase, getCurrentAppUser, getCurrentTeacherId, isAdminInCurrentView } from '@/lib/supabaseClient';
import { getMyDepartments, hasDepartment } from '@/lib/departments';

// 家長幫學生請假的審核（導師看自己班的，教務／系統管理員看全部）。
// 按「核准」後，系統會依該班當天的上課節數，把病假／事假自動寫進出缺席表。
type Req = {
  id: string;
  student_no: string;
  student_name: string | null;
  class_id: string | null;
  class_label: string | null;
  leave_type: '病假' | '事假';
  start_date: string;
  end_date: string;
  period_from: number | null;
  period_to: number | null;
  reason: string | null;
  status: '待審核' | '已核准' | '已拒絕' | '已取消';
  requested_at: string;
  decided_at: string | null;
  decision_note: string | null;
  applied_periods: number | null;
};

const range = (r: Req) => `${r.start_date}${r.end_date !== r.start_date ? ' ～ ' + r.end_date : ''}　${r.period_from ? `第 ${r.period_from}～${r.period_to} 節` : '整天'}`;

export default function StudentLeaveReview() {
  const [rows, setRows] = useState<Req[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [showDone, setShowDone] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [batchBusy, setBatchBusy] = useState(false);

  async function load() {
    setLoading(true);
    setError('');
    const { data, error } = await supabase
      .from('student_leave_requests')
      .select('id, student_no, student_name, class_id, class_label, leave_type, start_date, end_date, period_from, period_to, reason, status, requested_at, decided_at, decision_note, applied_periods')
      .order('requested_at', { ascending: false })
      .limit(300);
    if (error) {
      setError('讀取失敗：' + error.message + '（請確認 sql/125_student_leave_requests.sql 已執行）');
      setLoading(false);
      return;
    }
    let list = (data ?? []) as Req[];
    // 管理員會繞過資料庫權限，所以在畫面上再過濾一次：非管理視角只看自己導的班
    const me = await getCurrentAppUser();
    const viewingAsTeacher = typeof window !== 'undefined' && sessionStorage.getItem('viewMode') === 'teacher';
    let seeAll = false;
    if (me) {
      seeAll = isAdminInCurrentView(me.role);
      if (!seeAll && !viewingAsTeacher) seeAll = hasDepartment(await getMyDepartments(me.id), 'academic');
    }
    if (!seeAll) {
      const tid = await getCurrentTeacherId();
      let mine = new Set<string>();
      if (tid) {
        const { data: cls } = await supabase.from('classes').select('id').eq('homeroom_teacher_id', tid);
        mine = new Set((cls ?? []).map((c: any) => c.id));
      }
      list = list.filter((r) => r.class_id && mine.has(r.class_id));
    }
    setRows(list);
    setSelected(new Set());
    setLoading(false);
  }
  useEffect(() => {
    load();
  }, []);

  async function decide(r: Req, approve: boolean) {
    let note: string | null = null;
    if (!approve) {
      note = prompt('拒絕原因（選填，家長在入口看得到）：') ?? null;
    } else if (!confirm(`核准 ${r.student_name ?? r.student_no} 的${r.leave_type}？\n${range(r)}\n核准後會直接寫進出缺席表。`)) {
      return;
    }
    setBusyId(r.id);
    const { data, error } = await supabase.rpc('decide_student_leave', { p_id: r.id, p_approve: approve, p_note: note });
    setBusyId(null);
    if (error) {
      alert('處理失敗：' + error.message);
      return;
    }
    if (approve) alert(`已核准，登記了 ${(data as any)?.periods ?? 0} 節${r.leave_type}。`);
    await load();
  }

  const pending = rows.filter((r) => r.status === '待審核');
  const allChecked = pending.length > 0 && pending.every((r) => selected.has(r.id));
  const toggleAll = () => setSelected(allChecked ? new Set() : new Set(pending.map((r) => r.id)));
  const toggleOne = (id: string) =>
    setSelected((prev) => {
      const n = new Set(prev);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });

  async function approveSelected() {
    const targets = pending.filter((r) => selected.has(r.id));
    if (!targets.length) return;
    if (!confirm(`確認核准勾選的 ${targets.length} 筆請假？\n核准後會直接寫進出缺席表。`)) return;
    setBatchBusy(true);
    const failed: string[] = [];
    for (const r of targets) {
      const { error } = await supabase.rpc('decide_student_leave', { p_id: r.id, p_approve: true, p_note: null });
      if (error) failed.push(`${r.student_name ?? r.student_no}：${error.message}`);
    }
    setBatchBusy(false);
    await load();
    if (failed.length) alert(`已核准 ${targets.length - failed.length} 筆，以下 ${failed.length} 筆失敗：\n` + failed.join('\n'));
  }

  const done = rows.filter((r) => r.status !== '待審核');
  const th: React.CSSProperties = { textAlign: 'left', padding: 8, fontSize: 13 };

  return (
    <div style={{ maxWidth: 980, margin: '0 auto', padding: 24 }}>
      <h1 style={{ marginBottom: 4 }}>學生請假申請</h1>
      <p style={{ fontSize: 13, color: '#666', marginBottom: 14, lineHeight: 1.7 }}>
        家長在入口幫學生請假後，申請會送到這裡。按「核准」，系統會依該班當天的上課節數，把病假／事假<b>直接寫進出缺席表</b>（會覆蓋原本的曠課、遲到；已是公假的節次不會被改）。
        不同意請按「拒絕」，可以寫原因給家長看。
      </p>
      {error && <p style={{ color: '#A32D2D', fontSize: 13 }}>{error}</p>}
      {loading && <p style={{ fontSize: 13, color: '#999' }}>載入中…</p>}
      {!loading && pending.length === 0 && !error && <p style={{ fontSize: 14, color: '#3B6D11' }}>✅ 目前沒有待審核的請假。</p>}

      {pending.length > 0 && (
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', marginBottom: 8 }}>
          <label style={{ fontSize: 14, display: 'flex', gap: 6, alignItems: 'center', cursor: 'pointer' }}>
            <input type="checkbox" checked={allChecked} onChange={toggleAll} /> 全部勾選（{pending.length}）
          </label>
          <button
            disabled={batchBusy || selected.size === 0}
            onClick={approveSelected}
            style={{ padding: '6px 14px', background: selected.size ? '#2C2C2A' : '#bbb', color: '#fff', border: 'none', borderRadius: 6 }}
          >
            {batchBusy ? '處理中…' : `批次核准（${selected.size}）`}
          </button>
        </div>
      )}

      {pending.length > 0 && (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: '#f5f5f3' }}>
                <th style={th}>
                  <input type="checkbox" checked={allChecked} onChange={toggleAll} aria-label="全部勾選" />
                </th>
                <th style={th}>學生</th>
                <th style={th}>班級</th>
                <th style={th}>類別</th>
                <th style={th}>日期／節次</th>
                <th style={th}>原因</th>
                <th style={th}>申請時間</th>
                <th style={th}></th>
              </tr>
            </thead>
            <tbody>
              {pending.map((r) => (
                <tr key={r.id} style={{ borderTop: '1px solid #eee', verticalAlign: 'top', background: selected.has(r.id) ? '#FFF8E1' : undefined }}>
                  <td style={{ padding: 8 }}>
                    <input type="checkbox" checked={selected.has(r.id)} onChange={() => toggleOne(r.id)} aria-label={`勾選 ${r.student_name ?? r.student_no}`} />
                  </td>
                  <td style={{ padding: 8, fontSize: 14 }}>
                    <b>{r.student_name}</b>
                    <div style={{ fontSize: 12, color: '#888' }}>學號 {r.student_no}</div>
                  </td>
                  <td style={{ padding: 8, fontSize: 14 }}>{r.class_label}</td>
                  <td style={{ padding: 8, fontSize: 14, fontWeight: 700 }}>{r.leave_type}</td>
                  <td style={{ padding: 8, fontSize: 14 }}>{range(r)}</td>
                  <td style={{ padding: 8, fontSize: 13, color: '#555' }}>{r.reason ?? ''}</td>
                  <td style={{ padding: 8, fontSize: 12, color: '#888' }}>{new Date(r.requested_at).toLocaleString('zh-TW', { hour12: false })}</td>
                  <td style={{ padding: 8, whiteSpace: 'nowrap' }}>
                    <button disabled={busyId === r.id} onClick={() => decide(r, true)} style={{ padding: '6px 14px', background: '#2C2C2A', color: '#fff', border: 'none', borderRadius: 6, marginRight: 6 }}>
                      核准
                    </button>
                    <button disabled={busyId === r.id} onClick={() => decide(r, false)} style={{ padding: '6px 14px', color: '#A32D2D' }}>
                      拒絕
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {done.length > 0 && (
        <div style={{ marginTop: 24 }}>
          <button onClick={() => setShowDone((v) => !v)} className="keep-size" style={{ fontSize: 13, background: 'none', border: 'none', color: '#2C6E9E', cursor: 'pointer', padding: 0 }}>
            {showDone ? '▾' : '▸'} 已處理的請假（{done.length}）
          </button>
          {showDone && (
            <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 8, fontSize: 13 }}>
              <tbody>
                {done.map((r) => (
                  <tr key={r.id} style={{ borderTop: '1px solid #eee' }}>
                    <td style={{ padding: 6 }}>{r.student_name}（{r.class_label}）</td>
                    <td style={{ padding: 6 }}>{r.leave_type}</td>
                    <td style={{ padding: 6 }}>{range(r)}</td>
                    <td style={{ padding: 6, color: r.status === '已核准' ? '#3B6D11' : r.status === '已拒絕' ? '#A32D2D' : '#999' }}>
                      {r.status}
                      {r.status === '已核准' && r.applied_periods != null ? `（${r.applied_periods} 節）` : ''}
                    </td>
                    <td style={{ padding: 6, color: '#888' }}>{r.decision_note ?? ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}
