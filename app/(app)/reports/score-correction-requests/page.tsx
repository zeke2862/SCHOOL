'use client';

import { useEffect, useState } from 'react';
import { supabase, getCurrentAppUser } from '@/lib/supabaseClient';
import { useDepartmentPermissions } from '@/lib/useDepartmentPermissions';
import { hasDepartment } from '@/lib/departments';
import ErrorBanner from '@/components/ErrorBanner';

// 成績結算後修正申請審核（sql/107）
// 流程：教師／教務送出 → 教務處審核 → 管理員A（教務處或沒有掛部門的 admin_a）→（A 決定）管理員S
// 核准後系統自動把新分數寫回成績表；同一個人不能在同一筆申請上連審兩關。
type Batch = {
  id: string;
  requested_by: string;
  class_id: string;
  academic_year: number;
  term: string;
  subject: string;
  exam_type: string;
  reason: string;
  cell_count: number;
  status: string;
  handler_by: string | null;
  handler_note: string | null;
  a_by: string | null;
  a_note: string | null;
  created_at: string;
};
type Item = { batch_id: string; enrollment_id: string; old_score: number | null; new_score: number | null };

export default function ScoreCorrectionRequestsPage() {
  const perms = useDepartmentPermissions();
  const [realRole, setRealRole] = useState<string | null>(null);
  const [myUserId, setMyUserId] = useState<string | null>(null);
  const isAcademic = perms.isSystemAdmin || hasDepartment(perms.myDepartments, 'academic');
  const isStageA =
    perms.isSystemAdmin ||
    (realRole === 'admin_a' && (hasDepartment(perms.myDepartments, 'academic') || perms.myDepartments.length === 0));
  const allowed = !perms.loading && (isAcademic || isStageA);

  const [batches, setBatches] = useState<Batch[]>([]);
  const [items, setItems] = useState<Record<string, Item[]>>({});
  const [names, setNames] = useState<Record<string, string>>({});
  const [classLabels, setClassLabels] = useState<Record<string, string>>({});
  const [userNames, setUserNames] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    getCurrentAppUser().then((u) => {
      setRealRole(u ? ((u as any).realRole ?? u.role) : null);
      setMyUserId(u?.id ?? null);
    });
  }, []);

  async function load() {
    setLoadError(null);
    const { data, error } = await supabase
      .from('score_correction_batches')
      .select('*')
      .in('status', ['待教務審核', '待A批示', '待S批示'])
      .order('created_at');
    if (error) {
      setLoadError('讀取申請失敗：' + error.message);
      return;
    }
    const rows = (data ?? []) as Batch[];
    setBatches(rows);
    if (rows.length === 0) return;
    const ids = rows.map((b) => b.id);
    const { data: it } = await supabase.from('score_correction_items').select('*').in('batch_id', ids);
    const grouped: Record<string, Item[]> = {};
    ((it ?? []) as Item[]).forEach((x) => (grouped[x.batch_id] ??= []).push(x));
    setItems(grouped);

    const enrollIds = Array.from(new Set(((it ?? []) as Item[]).map((x) => x.enrollment_id)));
    if (enrollIds.length > 0) {
      const { data: en } = await supabase.from('enrollments').select('id, student_no, seat_no').in('id', enrollIds);
      const nos = (en ?? []).map((e: any) => e.student_no);
      const { data: st } = await supabase.from('students').select('student_no, name').in('student_no', nos.length ? nos : ['__none__']);
      const nameByNo = new Map((st ?? []).map((x: any) => [x.student_no, x.name]));
      const m: Record<string, string> = {};
      (en ?? []).forEach((e: any) => (m[e.id] = `${e.seat_no ?? ''} ${nameByNo.get(e.student_no) ?? e.student_no}`));
      setNames(m);
    }
    const cIds = Array.from(new Set(rows.map((b) => b.class_id)));
    const { data: cl } = await supabase.from('classes').select('id, academic_year, grade_level, class_name').in('id', cIds);
    const cm: Record<string, string> = {};
    (cl ?? []).forEach((c: any) => (cm[c.id] = `${c.academic_year} ${c.grade_level}${c.class_name}`));
    setClassLabels(cm);
    const uIds = Array.from(new Set(rows.map((b) => b.requested_by)));
    const { data: tr } = await supabase.from('teachers').select('app_user_id, name').in('app_user_id', uIds);
    const um: Record<string, string> = {};
    (tr ?? []).forEach((t: any) => (um[t.app_user_id] = t.name));
    setUserNames(um);
  }

  useEffect(() => {
    if (allowed) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allowed]);

  async function decide(b: Batch, decision: '同意' | '不同意' | '送S') {
    const note = (notes[b.id] ?? '').trim();
    if (decision === '不同意' && !note) return alert('不同意時請填寫原因');
    setBusyId(b.id);
    const { error } = await supabase.rpc('review_score_correction', { p_batch_id: b.id, p_decision: decision, p_note: note || null });
    setBusyId(null);
    if (error) return alert('處理失敗：' + error.message);
    load();
  }

  if (!allowed) {
    return (
      <main style={{ maxWidth: 560, margin: '0 auto', padding: 24 }}>
        <h1 style={{ fontSize: 16, marginBottom: 4 }}>成績結算後修正申請審核</h1>
        <p style={{ fontSize: 13, color: '#999' }}>{perms.loading ? '載入中…' : '本頁提供教務處、管理員A、系統管理員S使用。'}</p>
      </main>
    );
  }

  return (
    <main style={{ maxWidth: 760, margin: '0 auto', padding: 24 }}>
      <h1 style={{ fontSize: 16, marginBottom: 4 }}>成績結算後修正申請審核</h1>
      <p style={{ fontSize: 12, color: '#666', marginBottom: 16 }}>
        成績鎖定（結算）後要修改，流程是：教務處審核 → 管理員A批示 →（A 認為需要時）送管理員S。核准後系統自動寫回成績；同一個人不能連審兩關。
      </p>
      <ErrorBanner message={loadError} />
      {batches.length === 0 && <p style={{ fontSize: 13, color: '#666' }}>目前沒有待處理的成績修正申請。</p>}
      {batches.map((b) => {
        const notSameAsHandler = !(b.handler_by === myUserId && !perms.isSystemAdmin) && !(b.requested_by === myUserId && !perms.isSystemAdmin);
        const canAct =
          b.status === '待教務審核'
            ? isAcademic && !(b.requested_by === myUserId && !perms.isSystemAdmin)
            : b.status === '待A批示'
              ? isStageA && notSameAsHandler
              : perms.isSystemAdmin;
        return (
          <div key={b.id} style={{ padding: 12, border: b.status === '待教務審核' ? '1px solid #eee' : '2px solid #D9A400', borderRadius: 8, marginBottom: 10 }}>
            <p style={{ fontSize: 13 }}>
              <b>{userNames[b.requested_by] ?? '申請人'}</b>：{classLabels[b.class_id] ?? ''}　{b.subject}／{b.exam_type}（{b.academic_year} {b.term}），共 {b.cell_count} 位
              <span style={{ marginLeft: 8, fontSize: 11, padding: '1px 6px', borderRadius: 4, background: '#FFF6D9' }}>{b.status}</span>
            </p>
            <p style={{ fontSize: 13, color: '#666' }}>理由：{b.reason}</p>
            {b.handler_note && <p style={{ fontSize: 12, color: '#666' }}>教務意見：{b.handler_note}</p>}
            {b.a_note && <p style={{ fontSize: 12, color: '#666' }}>管理員A意見：{b.a_note}</p>}
            <table style={{ fontSize: 12, borderCollapse: 'collapse', margin: '6px 0' }}>
              <tbody>
                {(items[b.id] ?? []).map((it) => (
                  <tr key={it.enrollment_id} style={{ borderTop: '1px solid #eee' }}>
                    <td style={{ padding: '2px 8px' }}>{names[it.enrollment_id] ?? it.enrollment_id}</td>
                    <td style={{ padding: '2px 8px', color: '#999' }}>{it.old_score ?? '（空）'}</td>
                    <td style={{ padding: '2px 8px' }}>→</td>
                    <td style={{ padding: '2px 8px', fontWeight: 600 }}>{it.new_score ?? '（清除）'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {canAct ? (
              <>
                <input
                  placeholder="意見（不同意時必填）"
                  value={notes[b.id] ?? ''}
                  onChange={(e) => setNotes((p) => ({ ...p, [b.id]: e.target.value }))}
                  style={{ width: '100%', padding: 6, boxSizing: 'border-box', marginBottom: 6 }}
                />
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <button
                    disabled={busyId === b.id}
                    onClick={() => decide(b, '同意')}
                    style={{ padding: '4px 12px', background: '#3B6D11', color: '#fff', border: 'none', borderRadius: 6 }}
                  >
                    {b.status === '待教務審核' ? '同意並送管理員A' : '核准並寫回成績'}
                  </button>
                  {b.status === '待A批示' && (
                    <button
                      disabled={busyId === b.id}
                      onClick={() => decide(b, '送S')}
                      style={{ padding: '4px 12px', background: '#fff', color: '#2C2C2A', border: '1px solid #2C2C2A', borderRadius: 6 }}
                    >
                      送管理員S決定
                    </button>
                  )}
                  <button
                    disabled={busyId === b.id}
                    onClick={() => decide(b, '不同意')}
                    style={{ padding: '4px 12px', background: '#A32D2D', color: '#fff', border: 'none', borderRadius: 6 }}
                  >
                    不同意
                  </button>
                </div>
              </>
            ) : (
              <p style={{ fontSize: 12, color: '#999' }}>
                {b.status === '待教務審核' ? '等待教務處審核。' : b.status === '待A批示' ? '等待管理員A批示（不能與前一關同一人）。' : '等待管理員S批示。'}
              </p>
            )}
          </div>
        );
      })}
    </main>
  );
}
