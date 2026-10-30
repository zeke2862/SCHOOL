'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';

// 導師在點名單（出缺勤登錄）申請學生「休學／轉學／轉班」。
// 流程：選類別 → 勾選本班同學（可批次，每位各填原因，預設「搬家到曼谷」）→ 送出，
// 教務處在「審核中心 › 學籍異動申請」同意後，系統立刻更新班級名單（見 sql/128_student_status_requests.sql）。
const TYPES = ['休學', '轉學', '轉班'] as const;
type ReqType = (typeof TYPES)[number];
const DEFAULT_REASON = '搬家到曼谷';

type StudentRow = { student_no: string; seat_no: number; name: string };
type ClassOption = { id: string; label: string };
type MyReq = {
  id: string;
  request_type: string;
  student_name: string | null;
  student_no: string;
  target_class_label: string | null;
  reason: string | null;
  status: string;
  requested_at: string;
  decision_note: string | null;
};

const STATUS_COLOR: Record<string, string> = { 待審核: '#A36A2D', 已核准: '#3B6D11', 已駁回: '#A32D2D', 已取消: '#999' };

export default function StatusChangeRequestPanel({ classId, classLabel, onClose }: { classId: string; classLabel: string; onClose: () => void }) {
  const [type, setType] = useState<ReqType | null>(null);
  const [students, setStudents] = useState<StudentRow[]>([]);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [targetClassId, setTargetClassId] = useState('');
  const [classOptions, setClassOptions] = useState<ClassOption[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [myReqs, setMyReqs] = useState<MyReq[]>([]);

  async function loadReqs() {
    const { data } = await supabase
      .from('student_status_requests')
      .select('id, request_type, student_name, student_no, target_class_label, reason, status, requested_at, decision_note')
      .eq('class_id', classId)
      .order('requested_at', { ascending: false })
      .limit(30);
    setMyReqs((data ?? []) as MyReq[]);
  }

  async function loadStudents() {
    const { data } = await supabase
      .from('enrollments')
      .select('student_no, seat_no, students(name)')
      .eq('class_id', classId)
      .eq('is_current', true)
      .order('seat_no');
    setStudents(((data ?? []) as any[]).map((e) => ({ student_no: e.student_no, seat_no: e.seat_no, name: e.students?.name ?? e.student_no })));
  }

  useEffect(() => {
    loadStudents();
    loadReqs();
    (async () => {
      const { data: me } = await supabase.from('classes').select('academic_year').eq('id', classId).maybeSingle();
      let q = supabase.from('classes').select('id, academic_year, grade_level, class_name').order('grade_level').order('class_name');
      if (me?.academic_year != null) q = q.eq('academic_year', me.academic_year);
      const { data } = await q;
      setClassOptions((data ?? []).filter((c: any) => c.id !== classId).map((c: any) => ({ id: c.id, label: `${c.academic_year} ${c.grade_level}${c.class_name}` })));
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [classId]);

  // 已經有待審核申請的學生不能再勾
  const pendingNos = new Set(myReqs.filter((r) => r.status === '待審核').map((r) => r.student_no));
  const selectable = students.filter((s) => !pendingNos.has(s.student_no));
  const allChecked = selectable.length > 0 && selectable.every((s) => checked.has(s.student_no));

  function toggle(no: string) {
    setChecked((prev) => {
      const n = new Set(prev);
      n.has(no) ? n.delete(no) : n.add(no);
      return n;
    });
  }

  async function submit() {
    setError('');
    if (!type) return setError('請先選擇休學、轉學或轉班');
    const picked = students.filter((s) => checked.has(s.student_no));
    if (picked.length === 0) return setError('請至少勾選一位學生');
    if (type === '轉班' && !targetClassId) return setError('轉班請選擇轉入的班級');
    const items = picked.map((s) => ({ student_no: s.student_no, reason: (reasons[s.student_no] ?? DEFAULT_REASON).trim() }));
    const noReason = picked.find((s, i) => !items[i].reason);
    if (noReason) return setError(`${noReason.name} 尚未填寫原因`);
    const names = picked.map((s) => `${s.seat_no} ${s.name}`).join('、');
    const dest = type === '轉班' ? `轉入 ${classOptions.find((c) => c.id === targetClassId)?.label ?? ''}` : '';
    if (!confirm(`確認送出「${type}」申請${dest ? '（' + dest + '）' : ''}？\n${names}\n\n教務處同意後，名單會立刻更新。`)) return;

    setBusy(true);
    const { error: err } = await supabase.rpc('submit_student_status_requests', {
      p_type: type,
      p_items: items,
      p_target_class: type === '轉班' ? targetClassId : null,
    });
    setBusy(false);
    if (err) return setError('送出失敗：' + err.message);
    alert(`已送出 ${picked.length} 位學生的${type}申請，等待教務處審核。`);
    setChecked(new Set());
    setReasons({});
    setType(null);
    loadReqs();
  }

  async function cancel(id: string) {
    if (!confirm('確定撤回這筆申請？')) return;
    const { error: err } = await supabase.rpc('cancel_student_status_request', { p_id: id });
    if (err) return alert('撤回失敗：' + err.message);
    loadReqs();
  }

  const btn = (active: boolean): React.CSSProperties => ({
    flex: 1,
    padding: '10px 0',
    borderRadius: 8,
    border: active ? '1px solid #2C2C2A' : '1px solid #ccc',
    background: active ? '#2C2C2A' : '#fff',
    color: active ? '#fff' : '#2C2C2A',
    fontSize: 15,
  });

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)', zIndex: 60, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
      <div style={{ background: '#fff', width: '100%', maxWidth: 460, maxHeight: '92vh', overflowY: 'auto', borderRadius: '12px 12px 0 0', padding: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <h2 style={{ fontSize: 16 }}>學籍異動申請（{classLabel}）</h2>
          <button onClick={onClose} style={{ border: 'none', background: 'none', fontSize: 20 }} aria-label="關閉">
            ✕
          </button>
        </div>

        <p style={{ fontSize: 12, color: '#666', marginBottom: 8 }}>① 選擇類別</p>
        <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
          {TYPES.map((t) => (
            <button key={t} onClick={() => setType(t)} style={btn(type === t)}>
              {t}
            </button>
          ))}
        </div>

        {type === '轉班' && (
          <select value={targetClassId} onChange={(e) => setTargetClassId(e.target.value)} style={{ width: '100%', padding: 8, marginBottom: 12 }}>
            <option value="">選擇轉入的班級</option>
            {classOptions.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </select>
        )}

        {type && (
          <>
            <p style={{ fontSize: 12, color: '#666', marginBottom: 4 }}>② 勾選本班同學並填寫原因（可批次勾選）</p>
            <label style={{ fontSize: 13, display: 'flex', gap: 6, alignItems: 'center', padding: '6px 0' }}>
              <input
                type="checkbox"
                checked={allChecked}
                onChange={() => setChecked(allChecked ? new Set() : new Set(selectable.map((s) => s.student_no)))}
              />
              全選（{selectable.length}）
            </label>
            {students.map((s) => {
              const pending = pendingNos.has(s.student_no);
              const on = checked.has(s.student_no);
              return (
                <div key={s.student_no} style={{ padding: '8px 0', borderBottom: '1px solid #eee', opacity: pending ? 0.5 : 1 }}>
                  <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 15 }}>
                    <input type="checkbox" disabled={pending} checked={on} onChange={() => toggle(s.student_no)} />
                    <span style={{ color: '#999', width: 24 }}>{s.seat_no}</span>
                    {s.name}
                    {pending && <span style={{ fontSize: 12, color: '#A36A2D' }}>（已有待審申請）</span>}
                  </label>
                  {on && (
                    <input
                      value={reasons[s.student_no] ?? DEFAULT_REASON}
                      onChange={(e) => setReasons((prev) => ({ ...prev, [s.student_no]: e.target.value }))}
                      placeholder="原因"
                      style={{ marginTop: 6, width: '100%', padding: 8, borderRadius: 6, border: '1px solid #ccc' }}
                    />
                  )}
                </div>
              );
            })}
            {students.length === 0 && <p style={{ fontSize: 13, color: '#999' }}>本班目前沒有在學學生。</p>}

            {error && <p style={{ fontSize: 13, color: '#A32D2D', marginTop: 8 }}>{error}</p>}
            <button
              onClick={submit}
              disabled={busy || checked.size === 0}
              style={{ width: '100%', marginTop: 12, padding: 12, borderRadius: 8, background: '#2C2C2A', color: '#fff', border: 'none', opacity: busy || checked.size === 0 ? 0.5 : 1 }}
            >
              {busy ? '送出中…' : `③ 送出${checked.size ? `（${checked.size} 位）` : ''}`}
            </button>
          </>
        )}

        {myReqs.length > 0 && (
          <div style={{ marginTop: 20, paddingTop: 12, borderTop: '1px solid #eee' }}>
            <p style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>本班申請紀錄</p>
            {myReqs.map((r) => (
              <div key={r.id} style={{ fontSize: 13, padding: '6px 0', borderBottom: '1px solid #f3f3f3' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                  <span>
                    {r.student_name ?? r.student_no}・{r.request_type}
                    {r.target_class_label ? `→${r.target_class_label}` : ''}
                  </span>
                  <span style={{ color: STATUS_COLOR[r.status] ?? '#666' }}>
                    {r.status}
                    {r.status === '待審核' && (
                      <button onClick={() => cancel(r.id)} style={{ marginLeft: 8, fontSize: 12, border: 'none', background: 'none', textDecoration: 'underline', color: '#666' }}>
                        撤回
                      </button>
                    )}
                  </span>
                </div>
                <div style={{ color: '#888' }}>
                  {r.reason}
                  {r.decision_note ? `　教務處：${r.decision_note}` : ''}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
