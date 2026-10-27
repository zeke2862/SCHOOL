'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';

// 家長／學生帳號申請的審核（導師看自己班的，教務／系統管理員看全部）。
// 申請是家長或學生在登入頁輸入「HY＋學號（學生本人 HYS＋學號）」與手機號碼送出的；
// 導師對照手上的資料表確認這支手機確實是自己班學生／家長的，按「核准」，
// 系統會把這支手機寫進學籍資料（家長 → 監護人電話；學生本人 → 學生電話），申請人之後就能直接登入。
type Req = {
  id: string;
  student_no: string;
  login_code: string;
  relation: '家長' | '學生本人';
  phone: string;
  student_name: string | null;
  class_label: string | null;
  status: '待審核' | '已核准' | '已拒絕';
  requested_at: string;
  decided_at: string | null;
  decision_note: string | null;
};

export default function PortalRegistrationReview() {
  const [rows, setRows] = useState<Req[]>([]);
  const [onFile, setOnFile] = useState<Record<string, string[]>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [guardianRelation, setGuardianRelation] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [showDone, setShowDone] = useState(false);

  async function load() {
    setLoading(true);
    setError('');
    const { data, error } = await supabase
      .from('portal_registration_requests')
      .select('id, student_no, login_code, relation, phone, student_name, class_label, status, requested_at, decided_at, decision_note')
      .order('requested_at', { ascending: false })
      .limit(300);
    if (error) {
      setError('讀取失敗：' + error.message + '（請確認 sql/116_portal_registration.sql 已執行）');
      setLoading(false);
      return;
    }
    const list = (data ?? []) as Req[];
    setRows(list);
    // 學籍資料裡目前已經登記的電話，給導師對照（導師能看到自己班學生的資料；看不到就不顯示）
    const nos = Array.from(new Set(list.filter((r) => r.status === '待審核').map((r) => r.student_no)));
    const map: Record<string, string[]> = {};
    if (nos.length) {
      const [{ data: gs }, { data: ss }] = await Promise.all([
        supabase.from('guardians').select('student_no, relation, phone').in('student_no', nos),
        supabase.from('students').select('student_no, phone').in('student_no', nos),
      ]);
      (gs ?? []).forEach((g: any) => g.phone && (map[g.student_no] ||= []).push(`${g.relation}：${g.phone}`));
      (ss ?? []).forEach((s: any) => s.phone && (map[s.student_no] ||= []).push(`學生本人：${s.phone}`));
    }
    setOnFile(map);
    setLoading(false);
  }
  useEffect(() => {
    load();
  }, []);

  async function decide(r: Req, approve: boolean) {
    let note: string | null = null;
    if (!approve) {
      note = prompt('拒絕原因（選填，只留紀錄，不會通知申請人）：') ?? null;
    } else if (!confirm(`確認這支手機 ${r.phone} 確實是 ${r.student_name ?? r.student_no}（${r.class_label ?? ''}）${r.relation === '家長' ? '的家長' : '本人'}的？\n核准後會把它寫進學籍資料，申請人就能登入。`)) {
      return;
    }
    setBusyId(r.id);
    const { error } = await supabase.rpc('decide_portal_registration', {
      p_id: r.id,
      p_approve: approve,
      p_relation: guardianRelation[r.id] || '監護人',
      p_note: note,
    });
    setBusyId(null);
    if (error) {
      alert('處理失敗：' + error.message);
      return;
    }
    await load();
  }

  const pending = rows.filter((r) => r.status === '待審核');
  const done = rows.filter((r) => r.status !== '待審核');
  const th: React.CSSProperties = { textAlign: 'left', padding: 8, fontSize: 13 };

  return (
    <div style={{ maxWidth: 980, margin: '0 auto', padding: 24 }}>
      <h1 style={{ marginBottom: 4 }}>家長／學生帳號申請</h1>
      <p style={{ fontSize: 13, color: '#666', marginBottom: 14, lineHeight: 1.7 }}>
        家長或學生第一次用「HY＋學號」（學生本人 HYS＋學號）加手機號碼申請登入時，申請會送到這裡。
        請對照<b>手上的資料表</b>確認這支手機真的是自己班學生／家長的，再按「核准」；核准後手機號碼會自動記進學籍資料，申請人之後直接用代碼＋手機登入，不用學校再輸入。
        不確定或不是本班的人，請按「拒絕」。
      </p>
      {error && <p style={{ color: '#A32D2D', fontSize: 13 }}>{error}</p>}
      {loading && <p style={{ fontSize: 13, color: '#999' }}>載入中…</p>}

      {!loading && pending.length === 0 && !error && <p style={{ fontSize: 14, color: '#3B6D11' }}>✅ 目前沒有待審核的申請。</p>}

      {pending.length > 0 && (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: '#f5f5f3' }}>
                <th style={th}>學生</th>
                <th style={th}>班級</th>
                <th style={th}>申請身分</th>
                <th style={th}>申請的手機</th>
                <th style={th}>學籍資料原有的電話</th>
                <th style={th}>申請時間</th>
                <th style={th}></th>
              </tr>
            </thead>
            <tbody>
              {pending.map((r) => (
                <tr key={r.id} style={{ borderTop: '1px solid #eee', verticalAlign: 'top' }}>
                  <td style={{ padding: 8, fontSize: 14 }}>
                    <b>{r.student_name}</b>
                    <div style={{ fontSize: 12, color: '#888' }}>學號 {r.student_no}</div>
                  </td>
                  <td style={{ padding: 8, fontSize: 14 }}>{r.class_label}</td>
                  <td style={{ padding: 8, fontSize: 14 }}>
                    {r.relation}
                    {r.relation === '家長' && (
                      <select
                        value={guardianRelation[r.id] ?? '監護人'}
                        onChange={(e) => setGuardianRelation((p) => ({ ...p, [r.id]: e.target.value }))}
                        style={{ display: 'block', marginTop: 4, padding: 3, fontSize: 12 }}
                        title="核准後寫進監護人資料時的稱謂"
                      >
                        <option value="監護人">記為：監護人</option>
                        <option value="父親">記為：父親</option>
                        <option value="母親">記為：母親</option>
                      </select>
                    )}
                  </td>
                  <td style={{ padding: 8, fontSize: 15, fontWeight: 700 }}>{r.phone}</td>
                  <td style={{ padding: 8, fontSize: 12, color: '#666' }}>
                    {(onFile[r.student_no] ?? []).length ? (onFile[r.student_no] ?? []).map((t, i) => <div key={i}>{t}</div>) : '（沒有）'}
                  </td>
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
            {showDone ? '▾' : '▸'} 已處理的申請（{done.length}）
          </button>
          {showDone && (
            <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 8, fontSize: 13 }}>
              <tbody>
                {done.map((r) => (
                  <tr key={r.id} style={{ borderTop: '1px solid #eee' }}>
                    <td style={{ padding: 6 }}>{r.student_name}（{r.class_label}）</td>
                    <td style={{ padding: 6 }}>{r.relation}</td>
                    <td style={{ padding: 6 }}>{r.phone}</td>
                    <td style={{ padding: 6, color: r.status === '已核准' ? '#3B6D11' : '#A32D2D' }}>{r.status}</td>
                    <td style={{ padding: 6, color: '#888' }}>{r.decided_at ? new Date(r.decided_at).toLocaleDateString('zh-TW') : ''}</td>
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
