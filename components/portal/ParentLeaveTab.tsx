'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';

// 家長幫學生請假：送出後由班導師審核，核准後系統會自動把病假／事假寫進出缺席表。
type Leave = {
  id: string;
  leave_type: '病假' | '事假';
  start_date: string;
  end_date: string;
  period_from: number | null;
  period_to: number | null;
  reason: string | null;
  status: '待審核' | '已核准' | '已拒絕' | '已取消';
  requested_at: string;
  decision_note: string | null;
};

const STATUS_COLOR: Record<string, string> = { 待審核: '#A36A2D', 已核准: '#3B6D11', 已拒絕: '#A32D2D', 已取消: '#999' };
const today = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);

export default function ParentLeaveTab({ studentNo, studentName, canRequest }: { studentNo: string; studentName: string; canRequest: boolean }) {
  const [rows, setRows] = useState<Leave[]>([]);
  const [loading, setLoading] = useState(true);
  const [type, setType] = useState<'病假' | '事假'>('病假');
  const [start, setStart] = useState(today());
  const [end, setEnd] = useState(today());
  const [partial, setPartial] = useState(false);
  const [pFrom, setPFrom] = useState(1);
  const [pTo, setPTo] = useState(1);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  async function load() {
    setLoading(true);
    const { data } = await supabase
      .from('student_leave_requests')
      .select('id, leave_type, start_date, end_date, period_from, period_to, reason, status, requested_at, decision_note')
      .eq('student_no', studentNo)
      .order('requested_at', { ascending: false })
      .limit(50);
    setRows((data ?? []) as Leave[]);
    setLoading(false);
  }
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [studentNo]);

  async function submit() {
    if (end < start) {
      alert('結束日不能早於開始日');
      return;
    }
    if (partial && pTo < pFrom) {
      alert('結束節次不能小於開始節次');
      return;
    }
    if (!confirm(`確認幫 ${studentName} 申請${type}？\n${start}${end !== start ? ' ～ ' + end : ''}${partial ? `（第 ${pFrom}～${pTo} 節）` : '（整天）'}\n導師同意後才會登記進出缺席表。`)) return;
    setBusy(true);
    const single = partial || start === end;
    const { error } = await supabase.rpc('submit_student_leave', {
      p_student_no: studentNo,
      p_type: type,
      p_start: start,
      p_end: single && partial ? start : end,
      p_period_from: partial ? pFrom : null,
      p_period_to: partial ? pTo : null,
      p_reason: reason,
    });
    setBusy(false);
    if (error) {
      alert('送出失敗：' + error.message);
      return;
    }
    alert('已送出，導師會收到通知。導師同意後會自動登記進出缺席表。');
    setReason('');
    await load();
  }

  async function cancel(id: string) {
    if (!confirm('確定撤回這筆請假？')) return;
    const { error } = await supabase.rpc('cancel_student_leave', { p_id: id });
    if (error) alert('撤回失敗：' + error.message);
    await load();
  }

  const input: React.CSSProperties = { padding: 6, fontSize: 14, border: '1px solid #ccc', borderRadius: 6 };

  return (
    <div>
      {canRequest ? (
        <section style={{ border: '1px solid #eee', borderRadius: 8, padding: 14, marginBottom: 20 }}>
          <h2 style={{ fontSize: 14, marginBottom: 10 }}>幫 {studentName} 請假</h2>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', marginBottom: 10 }}>
            <label style={{ fontSize: 13 }}>
              類別{' '}
              <select value={type} onChange={(e) => setType(e.target.value as '病假' | '事假')} style={input}>
                <option value="病假">病假</option>
                <option value="事假">事假</option>
              </select>
            </label>
            <label style={{ fontSize: 13 }}>
              從{' '}
              <input type="date" value={start} onChange={(e) => { setStart(e.target.value); if (partial || e.target.value > end) setEnd(e.target.value); }} style={input} />
            </label>
            <label style={{ fontSize: 13 }}>
              到{' '}
              <input type="date" value={end} min={start} disabled={partial} onChange={(e) => setEnd(e.target.value)} style={input} />
            </label>
          </div>
          <label style={{ fontSize: 13, display: 'flex', gap: 6, alignItems: 'center', marginBottom: 10 }}>
            <input type="checkbox" checked={partial} onChange={(e) => { setPartial(e.target.checked); if (e.target.checked) setEnd(start); }} />
            只請部分節次（只能選同一天；不勾就是整天）
          </label>
          {partial && (
            <div style={{ fontSize: 13, marginBottom: 10 }}>
              第{' '}
              <input type="number" min={1} max={12} value={pFrom} onChange={(e) => setPFrom(Number(e.target.value) || 1)} style={{ ...input, width: 60 }} /> 節 ～ 第{' '}
              <input type="number" min={1} max={12} value={pTo} onChange={(e) => setPTo(Number(e.target.value) || 1)} style={{ ...input, width: 60 }} /> 節
            </div>
          )}
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="請假原因（例如：發燒看醫生）"
            rows={2}
            style={{ ...input, width: '100%', boxSizing: 'border-box', marginBottom: 10 }}
          />
          <button
            type="button"
            disabled={busy}
            onClick={submit}
            style={{ padding: '8px 18px', background: '#2C2C2A', color: '#fff', border: 'none', borderRadius: 6, fontSize: 14, cursor: 'pointer' }}
          >
            {busy ? '送出中…' : '送出請假申請'}
          </button>
          <p style={{ fontSize: 11, color: '#999', marginTop: 8, lineHeight: 1.6 }}>
            送出後由班導師審核，同意後才會登記進出缺席表。只能補請最近 14 天內的假。
          </p>
        </section>
      ) : (
        <p style={{ fontSize: 13, color: '#666', marginBottom: 16 }}>請假申請需要由家長帳號送出；這裡可以查看請假紀錄。</p>
      )}

      <h2 style={{ fontSize: 14, marginBottom: 8 }}>請假紀錄</h2>
      {loading ? (
        <p style={{ fontSize: 13, color: '#999' }}>載入中…</p>
      ) : rows.length === 0 ? (
        <p style={{ fontSize: 13, color: '#666' }}>還沒有請假紀錄。</p>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr>
                <th style={{ textAlign: 'left', padding: 6 }}>日期</th>
                <th style={{ textAlign: 'left', padding: 6 }}>類別</th>
                <th style={{ textAlign: 'left', padding: 6 }}>原因</th>
                <th style={{ textAlign: 'left', padding: 6 }}>狀態</th>
                <th style={{ padding: 6 }}></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} style={{ borderTop: '1px solid #eee', verticalAlign: 'top' }}>
                  <td style={{ padding: 6 }}>
                    {r.start_date}
                    {r.end_date !== r.start_date ? ` ～ ${r.end_date}` : ''}
                    <div style={{ fontSize: 11, color: '#888' }}>{r.period_from ? `第 ${r.period_from}～${r.period_to} 節` : '整天'}</div>
                  </td>
                  <td style={{ padding: 6 }}>{r.leave_type}</td>
                  <td style={{ padding: 6 }}>{r.reason ?? ''}</td>
                  <td style={{ padding: 6, color: STATUS_COLOR[r.status], fontWeight: 700 }}>
                    {r.status}
                    {r.decision_note && <div style={{ fontSize: 11, fontWeight: 400, color: '#888' }}>{r.decision_note}</div>}
                  </td>
                  <td style={{ padding: 6 }}>
                    {r.status === '待審核' && canRequest && (
                      <button type="button" onClick={() => cancel(r.id)} style={{ fontSize: 12, padding: '2px 8px', cursor: 'pointer' }}>
                        撤回
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
