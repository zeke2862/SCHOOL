'use client';

import { useEffect, useState } from 'react';
import { supabase, getCurrentTeacherId } from '@/lib/supabaseClient';
import { useDepartmentPermissions } from '@/lib/useDepartmentPermissions';
import { hasDepartment } from '@/lib/departments';
import ErrorBanner from '@/components/ErrorBanner';

// 學生資料變更通知（sql/107）
// 家長／學生在入口修改基本資料後「直接生效、不用審核」，這頁只負責讓相關的人知道、按「已閱讀」：
// - 導師：看到自己導師班學生的所有變更，按「已閱讀」。
// - 教務處：只看到改「姓名／泰文姓名／出生日期／身分證號」這幾項（會影響學籍文件），按「教務已閱讀」。
// - 舊版留下來、還在「待審核」的申請（107 之前送出的），仍可在下方核准／駁回。
type ChangeRow = {
  id: string;
  student_no: string;
  field_name: string;
  target_table: string;
  old_value: string | null;
  new_value: string;
  requested_at: string;
  status: string;
  notify_academic: boolean;
  homeroom_read_at: string | null;
  academic_read_at: string | null;
  students?: { name: string } | null;
};

const FIELD_LABEL: Record<string, string> = {
  name: '姓名',
  gender: '性別',
  thai_name: '泰文姓名',
  dob: '出生日期',
  id_number: '身分證／護照號碼',
  nationality: '國籍',
  religion: '宗教',
  blood_type: '血型',
  address: '地址',
  phone: '電話',
  previous_school: '原就讀學校',
  previous_school_grade: '原就讀年級',
  chinese_name: '中文姓名',
  email: 'Email',
  occupation: '職業',
};

export default function ProfileChangesPage() {
  const perms = useDepartmentPermissions();
  const isAcademic = perms.isSystemAdmin || hasDepartment(perms.myDepartments, 'academic');
  const [homeroomStudentNos, setHomeroomStudentNos] = useState<Set<string>>(new Set());
  const [rows, setRows] = useState<ChangeRow[]>([]);
  const [showRead, setShowRead] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    setLoadError(null);
    const tid = await getCurrentTeacherId();
    let mine = new Set<string>();
    if (tid) {
      const { data: cls } = await supabase.from('classes').select('id').eq('homeroom_teacher_id', tid);
      const ids = (cls ?? []).map((c: any) => c.id);
      if (ids.length > 0) {
        const { data: en } = await supabase.from('enrollments').select('student_no').in('class_id', ids).eq('is_current', true);
        mine = new Set((en ?? []).map((e: any) => e.student_no));
      }
    }
    setHomeroomStudentNos(mine);

    const { data, error } = await supabase
      .from('profile_edit_requests')
      .select(
        'id, student_no, field_name, target_table, old_value, new_value, requested_at, status, notify_academic, homeroom_read_at, academic_read_at, students(name)'
      )
      .order('requested_at', { ascending: false })
      .limit(300);
    if (error) {
      setLoadError('讀取資料變更紀錄失敗：' + error.message);
      return;
    }
    setRows((data ?? []) as any);
  }

  useEffect(() => {
    if (!perms.loading) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [perms.loading]);

  const homeroomRows = rows.filter((r) => r.status !== '待審核' && homeroomStudentNos.has(r.student_no));
  const academicRows = rows.filter((r) => r.status !== '待審核' && r.notify_academic);
  const legacyPending = rows.filter((r) => r.status === '待審核');

  async function markRead(ids: string[], as: 'homeroom' | 'academic') {
    if (ids.length === 0) return;
    setBusy(true);
    const { error } = await supabase.rpc('mark_profile_edits_read', { p_ids: ids, p_as: as });
    setBusy(false);
    if (error) {
      alert('標記失敗：' + error.message);
      return;
    }
    load();
  }

  async function handleLegacyDecision(requestId: string, decision: '核准' | '駁回') {
    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData.session?.access_token;
    if (!token) return alert('請重新登入');
    const res = await fetch('/api/portal/approve-edit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ requestId, decision }),
    });
    const body = await res.json();
    if (!res.ok) return alert(body.error ?? '處理失敗');
    load();
  }

  function label(r: ChangeRow) {
    return `${r.target_table === 'guardians' ? '監護人' : ''}${FIELD_LABEL[r.field_name] ?? r.field_name}`;
  }

  function renderList(list: ChangeRow[], as: 'homeroom' | 'academic') {
    const readKey = as === 'homeroom' ? 'homeroom_read_at' : 'academic_read_at';
    const unread = list.filter((r) => !r[readKey]);
    const visible = showRead ? list : unread;
    return (
      <>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 13 }}>
            未閱讀 <b>{unread.length}</b> 筆
          </span>
          {unread.length > 0 && (
            <button
              disabled={busy}
              onClick={() => markRead(unread.map((r) => r.id), as)}
              style={{ padding: '4px 12px', fontSize: 12, background: '#2C2C2A', color: '#fff', border: 'none', borderRadius: 6 }}
            >
              全部標為已閱讀
            </button>
          )}
        </div>
        {visible.length === 0 && <p style={{ fontSize: 13, color: '#999', marginBottom: 12 }}>沒有{showRead ? '' : '未閱讀的'}資料變更。</p>}
        {visible.map((r) => (
          <div
            key={r.id}
            style={{
              padding: 10,
              border: r[readKey] ? '1px solid #eee' : '1px solid #D9A400',
              background: r[readKey] ? '#fff' : '#FFFBEF',
              borderRadius: 8,
              marginBottom: 6,
            }}
          >
            <p style={{ fontSize: 13 }}>
              {r.students?.name ?? r.student_no}（{r.student_no}）— {label(r)}
              {r.notify_academic && (
                <span style={{ marginLeft: 6, fontSize: 11, padding: '1px 6px', background: '#FBEFE9', color: '#A36A2D', borderRadius: 4 }}>
                  學籍重要欄位
                </span>
              )}
            </p>
            <p style={{ fontSize: 13, color: '#666' }}>
              {r.old_value || '（空）'} → <b>{r.new_value || '（空）'}</b>
              <span style={{ marginLeft: 8, fontSize: 11, color: '#999' }}>{new Date(r.requested_at).toLocaleString('zh-TW')} 已生效</span>
            </p>
            {!r[readKey] ? (
              <button
                disabled={busy}
                onClick={() => markRead([r.id], as)}
                style={{ marginTop: 6, padding: '3px 10px', fontSize: 12, border: '1px solid #2C2C2A', background: '#fff', borderRadius: 6 }}
              >
                {as === 'homeroom' ? '已閱讀' : '教務已閱讀'}
              </button>
            ) : (
              <p style={{ fontSize: 11, color: '#3B6D11', marginTop: 4 }}>已閱讀（{new Date(r[readKey] as string).toLocaleDateString('zh-TW')}）</p>
            )}
          </div>
        ))}
      </>
    );
  }

  return (
    <main style={{ maxWidth: 640, margin: '0 auto', padding: 24 }}>
      <h1 style={{ fontSize: 16, marginBottom: 4 }}>學生資料變更通知</h1>
      <p style={{ fontSize: 12, color: '#666', marginBottom: 12 }}>
        家長／學生在入口修改的基本資料會「直接生效」，不需要審核；導師請閱讀後按「已閱讀」。
        改到姓名、泰文姓名、出生日期、身分證號時，教務處也會收到通知，請核對學籍文件。
      </p>
      <ErrorBanner message={loadError} />
      <label style={{ fontSize: 12, color: '#666', display: 'flex', gap: 4, alignItems: 'center', marginBottom: 12 }}>
        <input type="checkbox" checked={showRead} onChange={(e) => setShowRead(e.target.checked)} />
        也顯示已閱讀的紀錄
      </label>

      {homeroomStudentNos.size > 0 && (
        <section style={{ marginBottom: 24 }}>
          <h2 style={{ fontSize: 14, marginBottom: 8 }}>導師班學生</h2>
          {renderList(homeroomRows, 'homeroom')}
        </section>
      )}

      {isAcademic && (
        <section style={{ marginBottom: 24 }}>
          <h2 style={{ fontSize: 14, marginBottom: 8 }}>教務處：學籍重要欄位變更</h2>
          {renderList(academicRows, 'academic')}
        </section>
      )}

      {homeroomStudentNos.size === 0 && !isAcademic && !perms.loading && (
        <p style={{ fontSize: 13, color: '#999' }}>這頁提供導師與教務處使用。</p>
      )}

      {legacyPending.length > 0 && (
        <section>
          <h2 style={{ fontSize: 14, marginBottom: 8 }}>舊版留下的待審核申請（107 之前送出）</h2>
          {legacyPending.map((r) => (
            <div key={r.id} style={{ padding: 10, border: '1px solid #eee', borderRadius: 8, marginBottom: 6 }}>
              <p style={{ fontSize: 13 }}>
                {r.students?.name ?? r.student_no}（{r.student_no}）— {label(r)}：{r.old_value || '（空）'} → <b>{r.new_value}</b>
              </p>
              <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
                <button onClick={() => handleLegacyDecision(r.id, '核准')} style={{ padding: '3px 10px', background: '#3B6D11', color: '#fff', border: 'none', borderRadius: 6 }}>
                  核准
                </button>
                <button onClick={() => handleLegacyDecision(r.id, '駁回')} style={{ padding: '3px 10px', background: '#A32D2D', color: '#fff', border: 'none', borderRadius: 6 }}>
                  駁回
                </button>
              </div>
            </div>
          ))}
        </section>
      )}
    </main>
  );
}
