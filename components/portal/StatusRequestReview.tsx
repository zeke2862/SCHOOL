'use client';

import { useEffect, useState } from 'react';
import { supabase, getCurrentAppUser, isAdminInCurrentView } from '@/lib/supabaseClient';
import { useDepartmentPermissions } from '@/lib/useDepartmentPermissions';
import { hasDepartment } from '@/lib/departments';

// 導師送出的學生「休學／轉學／轉班」申請：教務處（與管理員A、系統管理員S）在這裡同意或駁回。
// 同意後系統立刻更新班級名單：休學／轉學＝該生資料全面隱藏、家長／學生入口帳號停權；轉班＝換到新班、座號接在新班最後。
// 導師在這裡只能看自己班的申請進度。
type Req = {
  id: string;
  batch_id: string;
  request_type: '休學' | '轉學' | '轉班';
  student_no: string;
  student_name: string | null;
  class_label: string | null;
  seat_no: number | null;
  target_class_label: string | null;
  reason: string | null;
  status: '待審核' | '已核准' | '已駁回' | '已取消';
  requester_name: string | null;
  requested_at: string;
  decider_name: string | null;
  decided_at: string | null;
  decision_note: string | null;
};

const STATUS_COLOR: Record<string, string> = { 待審核: '#A36A2D', 已核准: '#3B6D11', 已駁回: '#A32D2D', 已取消: '#999' };

export default function StatusRequestReview() {
  const perms = useDepartmentPermissions();
  const [isA, setIsA] = useState(false);
  useEffect(() => {
    getCurrentAppUser().then((me) => setIsA(!!me && me.role === 'admin_a' && isAdminInCurrentView(me.role)));
  }, []);
  const canDecide = perms.isSystemAdmin || hasDepartment(perms.myDepartments, 'academic') || isA;
  const [rows, setRows] = useState<Req[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [showDone, setShowDone] = useState(false);

  async function load() {
    setLoading(true);
    setError('');
    const { data, error: err } = await supabase
      .from('student_status_requests')
      .select('id, batch_id, request_type, student_no, student_name, class_label, seat_no, target_class_label, reason, status, requester_name, requested_at, decider_name, decided_at, decision_note')
      .order('requested_at', { ascending: false })
      .limit(500);
    if (err) setError('讀取失敗：' + err.message + '（請確認 sql/128_student_status_requests.sql 已執行）');
    setRows((data ?? []) as Req[]);
    setSelected(new Set());
    setLoading(false);
  }
  useEffect(() => {
    load();
  }, []);

  async function decide(targets: Req[], approve: boolean) {
    if (targets.length === 0) return;
    let note: string | null = null;
    if (approve) {
      const names = targets.map((r) => `${r.student_name ?? r.student_no}（${r.request_type}）`).join('、');
      const hasLeave = targets.some((r) => r.request_type !== '轉班');
      if (!confirm(`確認同意以下 ${targets.length} 筆申請？\n${names}\n\n同意後班級名單會立刻更新${hasLeave ? '，休學／轉學的學生資料將隱藏、相關帳號停權' : ''}。`)) return;
    } else {
      note = prompt('駁回原因（選填，會通知導師）：');
      if (note === null) return;
    }
    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData.session?.access_token;
    if (!token) return alert('請重新登入');

    setBusy(true);
    const failed: string[] = [];
    const banWarn: string[] = [];
    for (const r of targets) {
      const res = await fetch('/api/admin/student-status-requests/decide', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ requestId: r.id, approve, note }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) failed.push(`${r.student_name ?? r.student_no}：${body.error ?? '處理失敗'}`);
      else if (body.banFailed?.length) banWarn.push(r.student_name ?? r.student_no);
    }
    setBusy(false);
    await load();
    const msgs: string[] = [];
    if (failed.length) msgs.push(`${failed.length} 筆失敗：\n` + failed.join('\n'));
    if (banWarn.length) msgs.push(`${banWarn.join('、')} 的登入帳號封鎖失敗（資料庫已標記停權，資料已無法讀取），請稍後到 Supabase Auth 手動停用。`);
    if (msgs.length) alert(msgs.join('\n\n'));
  }

  const pending = rows.filter((r) => r.status === '待審核');
  const done = rows.filter((r) => r.status !== '待審核');
  const allChecked = pending.length > 0 && pending.every((r) => selected.has(r.id));
  const toggle = (id: string) =>
    setSelected((prev) => {
      const n = new Set(prev);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  const th: React.CSSProperties = { textAlign: 'left', padding: 8, fontSize: 13 };
  const td: React.CSSProperties = { padding: 8, fontSize: 13, borderTop: '1px solid #eee' };

  return (
    <div style={{ maxWidth: 980, margin: '0 auto', padding: 24 }}>
      <h1 style={{ marginBottom: 4 }}>學籍異動申請</h1>
      <p style={{ fontSize: 13, color: '#666', marginBottom: 14, lineHeight: 1.7 }}>
        導師在點名單送出的休學／轉學／轉班申請。{canDecide ? '按「同意」後系統立刻修正班級名單：' : '教務處同意後系統會立刻修正班級名單：'}
        <b>休學、轉學</b>＝該生所有資料隱藏（僅教務處、管理員A、S 可查閱）、家長／學生入口帳號停權，座號保留、其他同學號碼不變；
        <b>轉班</b>＝換到新班，座號接在新班最後一號。
      </p>
      {error && <p style={{ color: '#A32D2D', fontSize: 13 }}>{error}</p>}
      {loading && <p style={{ fontSize: 13, color: '#999' }}>載入中…</p>}
      {!loading && pending.length === 0 && !error && <p style={{ fontSize: 14, color: '#3B6D11' }}>✅ 目前沒有待審核的申請。</p>}

      {pending.length > 0 && (
        <>
          {canDecide && (
            <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', marginBottom: 8 }}>
              <label style={{ fontSize: 14, display: 'flex', gap: 6, alignItems: 'center', cursor: 'pointer' }}>
                <input type="checkbox" checked={allChecked} onChange={() => setSelected(allChecked ? new Set() : new Set(pending.map((r) => r.id)))} />
                全部勾選（{pending.length}）
              </label>
              <button
                disabled={busy || selected.size === 0}
                onClick={() => decide(pending.filter((r) => selected.has(r.id)), true)}
                style={{ padding: '6px 14px', background: '#2C2C2A', color: '#fff', border: 'none', borderRadius: 6, opacity: busy || selected.size === 0 ? 0.5 : 1 }}
              >
                {busy ? '處理中…' : `同意勾選的 ${selected.size} 筆`}
              </button>
              <button
                disabled={busy || selected.size === 0}
                onClick={() => decide(pending.filter((r) => selected.has(r.id)), false)}
                style={{ padding: '6px 14px', background: '#fff', border: '1px solid #A32D2D', color: '#A32D2D', borderRadius: 6, opacity: busy || selected.size === 0 ? 0.5 : 1 }}
              >
                駁回勾選的
              </button>
            </div>
          )}
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: '#fafafa' }}>
                {canDecide && <th style={th} />}
                <th style={th}>類別</th>
                <th style={th}>學生</th>
                <th style={th}>班級／座號</th>
                <th style={th}>原因</th>
                <th style={th}>申請導師</th>
                <th style={th}>送出時間</th>
                {canDecide && <th style={th}>處理</th>}
              </tr>
            </thead>
            <tbody>
              {pending.map((r) => (
                <tr key={r.id}>
                  {canDecide && (
                    <td style={td}>
                      <input type="checkbox" checked={selected.has(r.id)} onChange={() => toggle(r.id)} />
                    </td>
                  )}
                  <td style={td}>
                    <b>{r.request_type}</b>
                    {r.target_class_label ? <div style={{ color: '#666' }}>→ {r.target_class_label}</div> : null}
                  </td>
                  <td style={td}>
                    {r.student_name ?? r.student_no}
                    <div style={{ color: '#999' }}>{r.student_no}</div>
                  </td>
                  <td style={td}>
                    {r.class_label}
                    {r.seat_no != null ? `／${r.seat_no} 號` : ''}
                  </td>
                  <td style={td}>{r.reason}</td>
                  <td style={td}>{r.requester_name}</td>
                  <td style={td}>{new Date(r.requested_at).toLocaleString('zh-TW', { hour12: false })}</td>
                  {canDecide && (
                    <td style={{ ...td, whiteSpace: 'nowrap' }}>
                      <button disabled={busy} onClick={() => decide([r], true)} style={{ marginRight: 6, padding: '4px 10px' }}>
                        同意
                      </button>
                      <button disabled={busy} onClick={() => decide([r], false)} style={{ padding: '4px 10px' }}>
                        駁回
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      {done.length > 0 && (
        <div style={{ marginTop: 24 }}>
          <button onClick={() => setShowDone(!showDone)} style={{ fontSize: 13, border: 'none', background: 'none', textDecoration: 'underline', color: '#666' }}>
            {showDone ? '收起' : '顯示'}已處理紀錄（{done.length}）
          </button>
          {showDone && (
            <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 8 }}>
              <tbody>
                {done.map((r) => (
                  <tr key={r.id}>
                    <td style={td}>{r.request_type}{r.target_class_label ? `→${r.target_class_label}` : ''}</td>
                    <td style={td}>{r.student_name ?? r.student_no}（{r.class_label}）</td>
                    <td style={td}>{r.reason}</td>
                    <td style={{ ...td, color: STATUS_COLOR[r.status] }}>{r.status}</td>
                    <td style={td}>
                      {r.decider_name ?? ''} {r.decided_at ? new Date(r.decided_at).toLocaleDateString('zh-TW') : ''}
                      {r.decision_note ? `：${r.decision_note}` : ''}
                    </td>
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
