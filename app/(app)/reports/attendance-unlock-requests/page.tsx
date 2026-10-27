'use client';

import { useEffect, useState } from 'react';
import { supabase, getCurrentAppUser } from '@/lib/supabaseClient';
import { useDepartmentPermissions } from '@/lib/useDepartmentPermissions';
import { hasDepartment, isDepartmentLead } from '@/lib/departments';
import ErrorBanner from '@/components/ErrorBanner';

type BatchRow = {
  id: string;
  requested_by: string;
  class_id: string;
  date_from: string;
  date_to: string;
  reason: string;
  student_count: number;
  cell_count: number;
  teacher_recent_count: number;
  needs_supervisor: boolean;
  needs_supervisor_reason: string | null;
  after_settlement: boolean;
  status: string;
  handler_by: string | null;
  handler_note: string | null;
  supervisor_note: string | null;
  created_at: string;
};
type BatchItem = { batch_id: string; student_no: string; record_date: string; period_no: number; old_status: string; new_status: string };

type RequestRow = {
  id: string;
  requested_by: string;
  scope: string | null;
  scope_ref: string | null;
  record_id: string | null;
  reason: string | null;
  status: string;
  created_at: string;
};

// 出缺勤修正／開放申請審核：
// 【2026-08-26 修正】原本這頁只顯示「整班/整週鎖定」時送出的開放申請
// （scope 不是空值的那種），完全沒有顯示導師在單一格「補登超過範圍」時
// 送出的個別修正申請（record_id 有值、scope 是空值的那種）——這種申請
// 送出後會直接存進資料庫（沒有錯誤），但整個系統找不到任何畫面可以審核
// 它，等於卡死在「待審核」狀態永遠沒有人看得到、也永遠不會生效，導師
// 會感覺像是「送出後沒有真的送出去」。
// 修正：拿掉原本 `.not('scope','is',null)` 的篩選，兩種類型的申請都撈出來，
// 畫面上用 scope 是否有值來分開顯示「範圍開放申請」跟「單筆補登修正申請」，
// 審核邏輯本來就已經只在 `scope` 有值時才會去解鎖 submission_windows
// （單筆修正申請不需要這一步——核准後 has_approved_correction() 這個資料庫
// 函式會直接生效，讓導師能重新編輯那一筆紀錄，不需要額外的動作）。
export default function AttendanceUnlockRequestsPage() {
  const perms = useDepartmentPermissions();
  // 出缺勤屬訓導處業務：訓導處成員（承辦／主任）、系統管理員S、開發人員可進入；其他部門看不到。
  const [realRole, setRealRole] = useState<string | null>(null);
  const isDiscipline = perms.isSystemAdmin || hasDepartment(perms.myDepartments, 'discipline');
  // 管理員A：角色 admin_a，且屬訓導處或沒有掛部門（校長／副校長等），負責「結算後」修正的批示
  const isStageA =
    perms.isSystemAdmin ||
    (realRole === 'admin_a' && (hasDepartment(perms.myDepartments, 'discipline') || perms.myDepartments.length === 0));
  const isAdmin = !perms.loading && (isDiscipline || isStageA);
  const isLead = perms.isSystemAdmin || isDepartmentLead(perms.myDepartments, 'discipline');
  const [batches, setBatches] = useState<BatchRow[]>([]);
  const [batchItems, setBatchItems] = useState<Record<string, BatchItem[]>>({});
  const [studentNames, setStudentNames] = useState<Record<string, string>>({});
  const [batchNotes, setBatchNotes] = useState<Record<string, string>>({});
  const [myUserId, setMyUserId] = useState<string | null>(null);
  const [requests, setRequests] = useState<RequestRow[]>([]);
  const [teacherNames, setTeacherNames] = useState<Record<string, string>>({});
  const [classLabels, setClassLabels] = useState<Record<string, string>>({});
  const [recordLabels, setRecordLabels] = useState<Record<string, string>>({});
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function load() {
    const appUser = await getCurrentAppUser();
    if (!appUser) return;
    setMyUserId(appUser.id);
    setRealRole((appUser as any).realRole ?? appUser.role);

    // 整週／當天修正申請（導師送出 → 訓導承辦審核 → 超過門檻再由訓導主任批示）
    const { data: bData, error: bErr } = await supabase
      .from('attendance_correction_batches')
      .select('*')
      .in('status', ['待承辦審核', '待長官批示', '待A批示', '待S批示'])
      .order('created_at');
    if (!bErr) {
      const bRows = (bData ?? []) as BatchRow[];
      setBatches(bRows);
      const ids = bRows.map((b) => b.id);
      if (ids.length > 0) {
        const { data: iData } = await supabase.from('attendance_correction_items').select('*').in('batch_id', ids);
        const grouped: Record<string, BatchItem[]> = {};
        ((iData ?? []) as BatchItem[]).forEach((it) => {
          (grouped[it.batch_id] ??= []).push(it);
        });
        setBatchItems(grouped);
        const nos = Array.from(new Set(((iData ?? []) as BatchItem[]).map((it) => it.student_no)));
        if (nos.length > 0) {
          const { data: sRows } = await supabase.from('students').select('student_no, name').in('student_no', nos);
          const m: Record<string, string> = {};
          (sRows ?? []).forEach((st: any) => (m[st.student_no] = st.name));
          setStudentNames(m);
        }
        const tIds = Array.from(new Set(bRows.map((b) => b.requested_by)));
        const { data: tRows } = await supabase.from('teachers').select('id, name').in('id', tIds);
        setTeacherNames((prev) => {
          const m = { ...prev };
          (tRows ?? []).forEach((t: any) => (m[t.id] = t.name));
          return m;
        });
        const cIds = Array.from(new Set(bRows.map((b) => b.class_id)));
        const { data: cRows } = await supabase.from('classes').select('id, academic_year, grade_level, class_name').in('id', cIds);
        setClassLabels((prev) => {
          const m = { ...prev };
          (cRows ?? []).forEach((c: any) => (m[c.id] = `${c.academic_year} ${c.grade_level}${c.class_name}`));
          return m;
        });
      }
    } else {
      setLoadError('讀取修正申請失敗：' + bErr.message);
    }

    const { data, error } = await supabase
      .from('correction_requests')
      .select('id, requested_by, scope, scope_ref, record_id, reason, status, created_at')
      .eq('data_type', '出缺勤')
      .eq('status', '待審核')
      .order('created_at');
    if (error) {
      setLoadError('讀取申請清單失敗：' + error.message);
      return;
    }
    const rows = (data ?? []) as RequestRow[];
    setRequests(rows);

    const teacherIds = Array.from(new Set(rows.map((r) => r.requested_by)));
    if (teacherIds.length > 0) {
      const { data: teacherRows } = await supabase.from('teachers').select('id, name').in('id', teacherIds);
      const map: Record<string, string> = {};
      (teacherRows ?? []).forEach((t: any) => (map[t.id] = t.name));
      setTeacherNames(map);
    }

    const classIds = Array.from(new Set(rows.filter((r) => r.scope === '班級' && r.scope_ref).map((r) => r.scope_ref as string)));
    if (classIds.length > 0) {
      const { data: classRows } = await supabase.from('classes').select('id, academic_year, grade_level, class_name').in('id', classIds);
      const map: Record<string, string> = {};
      (classRows ?? []).forEach((c: any) => (map[c.id] = `${c.academic_year} ${c.grade_level}${c.class_name}`));
      setClassLabels(map);
    }

    // 單筆修正申請：record_id 指向 attendance.id，撈出對應的學生/日期/節次，
    // 讓審核畫面能顯示「哪個學生、哪一天、第幾節」，而不是只有一串 record_id。
    const recordIds = Array.from(new Set(rows.filter((r) => r.record_id).map((r) => r.record_id as string)));
    if (recordIds.length > 0) {
      const { data: attRows } = await supabase
        .from('attendance')
        .select('id, student_no, record_date, period_no')
        .in('id', recordIds);
      const studentNos = Array.from(new Set((attRows ?? []).map((a: any) => a.student_no)));
      const { data: studentRows } = studentNos.length
        ? await supabase.from('students').select('student_no, name').in('student_no', studentNos)
        : { data: [] as any[] };
      const nameMap: Record<string, string> = {};
      (studentRows ?? []).forEach((s: any) => (nameMap[s.student_no] = s.name));
      const map: Record<string, string> = {};
      (attRows ?? []).forEach((a: any) => {
        map[a.id] = `${nameMap[a.student_no] ?? a.student_no}　${a.record_date}　第${a.period_no}節`;
      });
      setRecordLabels(map);
    }
  }

  useEffect(() => {
    getCurrentAppUser().then((u) => setRealRole(u ? ((u as any).realRole ?? u.role) : null));
  }, []);

  useEffect(() => {
    if (!perms.loading && isAdmin) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [perms.loading, isAdmin]);

  async function handleBatchDecision(b: BatchRow, decision: '同意' | '不同意' | '送S') {
    const note = (batchNotes[b.id] ?? '').trim();
    if (decision === '不同意' && !note) {
      alert('不同意時請填寫原因');
      return;
    }
    setBusyId(b.id);
    const { error } = await supabase.rpc('review_attendance_correction', {
      p_batch_id: b.id,
      p_decision: decision,
      p_note: note || null,
    });
    setBusyId(null);
    if (error) {
      alert('處理失敗：' + error.message);
      return;
    }
    load();
  }

  function scopeLabel(r: RequestRow) {
    if (r.record_id) return recordLabels[r.record_id] ?? `單筆紀錄（${r.record_id}）`;
    if (r.scope === '班級') return classLabels[r.scope_ref ?? ''] ?? `班級（${r.scope_ref}）`;
    if (r.scope === '部別') return `部別：${r.scope_ref}`;
    return '全校';
  }

  async function handleDecision(r: RequestRow, decision: '核准' | '駁回') {
    setBusyId(r.id);
    const appUser = await getCurrentAppUser();
    if (!appUser) {
      setBusyId(null);
      return;
    }

    if (decision === '核准' && r.scope) {
      // 核准：直接把對應範圍的出缺勤鎖定解除，導師才能再次登錄。
      // 這裡沿用既有做法（不查 academic_year/term，跟「學生出缺席登錄」頁面查詢鎖定狀態的方式一致）。
      const { error: unlockErr } = await supabase
        .from('submission_windows')
        .update({ is_locked: false })
        .eq('data_type', '出缺勤')
        .eq('scope', r.scope)
        .eq('scope_ref', r.scope_ref);
      if (unlockErr) {
        alert('解鎖失敗：' + unlockErr.message);
        setBusyId(null);
        return;
      }
    }

    const { error } = await supabase
      .from('correction_requests')
      .update({ status: decision, reviewed_by: appUser.id, reviewed_at: new Date().toISOString() })
      .eq('id', r.id);
    setBusyId(null);
    if (error) {
      alert('處理失敗：' + error.message);
      return;
    }
    load();
  }

  if (!isAdmin) {
    return (
      <main style={{ maxWidth: 560, margin: '0 auto', padding: 24 }}>
        <h1 style={{ fontSize: 16, marginBottom: 4 }}>出缺勤修正／開放申請審核</h1>
        <p style={{ fontSize: 13, color: '#999' }}>
          {perms.loading ? '載入中…' : '出缺勤屬訓導處業務，本頁僅提供訓導處成員／系統管理員S／開發人員使用。'}
        </p>
      </main>
    );
  }

  return (
    <main style={{ maxWidth: 720, margin: '0 auto', padding: 24 }}>
      <h1 style={{ fontSize: 16, marginBottom: 4 }}>出缺勤修正／開放申請審核</h1>
      <p style={{ fontSize: 12, color: '#666', marginBottom: 16 }}>
        導師在「學生出缺席登錄（一週）」頁面送出的兩種申請都會列在這裡：整班/整週鎖定時的「申請開放」（核准後解除該範圍鎖定），
        以及單一格「補登超過範圍」時針對某一筆紀錄送出的修正申請（核准後導師就能重新編輯那一筆紀錄，不影響其他紀錄）。
      </p>
      <ErrorBanner message={loadError} />

      <h2 style={{ fontSize: 14, margin: '8px 0' }}>整週／當天出缺席修正申請</h2>
      <p style={{ fontSize: 12, color: '#666', marginBottom: 8 }}>
        流程：導師送出 → 訓導處承辦人審核 →（人數太多或該教師申請太頻繁時）再由訓導主任批示；
        出缺席「已結算（鎖定）」後的修正，承辦同意後一律送管理員A批示，A 可再決定是否送管理員S。門檻可在「出缺席相關設定」調整。
      </p>
      {batches.length === 0 && <p style={{ fontSize: 13, color: '#666', marginBottom: 16 }}>目前沒有待處理的修正申請。</p>}
      {batches.map((b) => {
        const items = batchItems[b.id] ?? [];
        const byStudent: Record<string, BatchItem[]> = {};
        items.forEach((it) => (byStudent[it.student_no] ??= []).push(it));
        const waitingSupervisor = b.status !== '待承辦審核';
        const notHandler = !(b.handler_by === myUserId && !perms.isSystemAdmin);
        const canAct =
          b.status === '待承辦審核'
            ? isDiscipline
            : b.status === '待長官批示'
              ? isLead && notHandler
              : b.status === '待A批示'
                ? isStageA && notHandler
                : perms.isSystemAdmin;
        return (
          <div key={b.id} style={{ padding: 12, border: waitingSupervisor ? '2px solid #D9A400' : '1px solid #eee', borderRadius: 8, marginBottom: 8 }}>
            <p style={{ fontSize: 13 }}>
              <b>{teacherNames[b.requested_by] ?? '教師'}</b> 申請修正 {classLabels[b.class_id] ?? ''}：
              {b.date_from === b.date_to ? b.date_from : `${b.date_from} ～ ${b.date_to}`}，共 {b.student_count} 位學生、{b.cell_count} 節
              <span style={{ marginLeft: 8, fontSize: 11, padding: '1px 6px', borderRadius: 4, background: waitingSupervisor ? '#FFF6D9' : '#F5F5F3' }}>
                {b.status}
              </span>
            </p>
            <p style={{ fontSize: 13, color: '#666' }}>理由：{b.reason}</p>
            {b.needs_supervisor && (
              <p style={{ fontSize: 12, color: '#A36A2D' }}>
                ⚠ {b.after_settlement ? '需管理員A批示' : '需長官批示'}：{b.needs_supervisor_reason}
              </p>
            )}
            {waitingSupervisor && b.handler_note && <p style={{ fontSize: 12, color: '#666' }}>承辦意見：{b.handler_note}</p>}
            <ul style={{ fontSize: 12, margin: '6px 0', paddingLeft: 18 }}>
              {Object.entries(byStudent).map(([no, list]) => (
                <li key={no}>
                  {studentNames[no] ?? no}：
                  {list
                    .sort((x, y) => (x.record_date + x.period_no).localeCompare(y.record_date + y.period_no))
                    .map((it) => `${it.record_date.slice(5)} 第${it.period_no}節 ${it.old_status}→${it.new_status}`)
                    .join('；')}
                </li>
              ))}
            </ul>
            {canAct ? (
              <>
                <input
                  placeholder={waitingSupervisor ? '批示意見（不同意時必填）' : '承辦意見（不同意時必填）'}
                  value={batchNotes[b.id] ?? ''}
                  onChange={(e) => setBatchNotes((prev) => ({ ...prev, [b.id]: e.target.value }))}
                  style={{ width: '100%', padding: 6, boxSizing: 'border-box', marginBottom: 6 }}
                />
                <div style={{ display: 'flex', gap: 8 }}>
                  <button
                    onClick={() => handleBatchDecision(b, '同意')}
                    disabled={busyId === b.id}
                    style={{ padding: '4px 12px', background: '#3B6D11', color: '#fff', border: 'none', borderRadius: 6 }}
                  >
                    {waitingSupervisor
                      ? '批准'
                      : b.after_settlement
                        ? '同意並送管理員A批示'
                        : b.needs_supervisor
                          ? '同意並送長官批示'
                          : '同意並套用'}
                  </button>
                  {b.status === '待A批示' && (
                    <button
                      onClick={() => handleBatchDecision(b, '送S')}
                      disabled={busyId === b.id}
                      style={{ padding: '4px 12px', background: '#fff', color: '#2C2C2A', border: '1px solid #2C2C2A', borderRadius: 6 }}
                    >
                      送管理員S決定
                    </button>
                  )}
                  <button
                    onClick={() => handleBatchDecision(b, '不同意')}
                    disabled={busyId === b.id}
                    style={{ padding: '4px 12px', background: '#A32D2D', color: '#fff', border: 'none', borderRadius: 6 }}
                  >
                    不同意
                  </button>
                </div>
              </>
            ) : (
              <p style={{ fontSize: 12, color: '#999' }}>
                {b.status === '待長官批示'
                  ? '此申請等待訓導主任批示（承辦人與批示者不能是同一人）。'
                  : b.status === '待A批示'
                    ? '此申請等待管理員A批示（承辦人與批示者不能是同一人）。'
                    : b.status === '待S批示'
                      ? '此申請等待管理員S批示。'
                      : '此申請等待訓導處承辦人審核。'}
              </p>
            )}
          </div>
        );
      })}

      <h2 style={{ fontSize: 14, margin: '20px 0 8px' }}>單格補登／範圍開放申請（舊流程）</h2>
      {requests.length === 0 && <p style={{ fontSize: 13, color: '#666' }}>目前沒有待審核的申請。</p>}

      {requests.map((r) => (
        <div key={r.id} style={{ padding: 12, border: '1px solid #eee', borderRadius: 8, marginBottom: 8 }}>
          <p style={{ fontSize: 13 }}>
            {teacherNames[r.requested_by] ?? r.requested_by} 申請{r.record_id ? '修正' : '開放'}：{scopeLabel(r)}
          </p>
          {r.reason && <p style={{ fontSize: 13, color: '#666' }}>原因：{r.reason}</p>}
          <p style={{ fontSize: 12, color: '#999' }}>{new Date(r.created_at).toLocaleString('zh-TW')}</p>
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <button
              onClick={() => handleDecision(r, '核准')}
              disabled={busyId === r.id}
              style={{ padding: '4px 12px', background: '#3B6D11', color: '#fff', border: 'none', borderRadius: 6 }}
            >
              {r.record_id ? '核准' : '核准並解鎖'}
            </button>
            <button
              onClick={() => handleDecision(r, '駁回')}
              disabled={busyId === r.id}
              style={{ padding: '4px 12px', background: '#A32D2D', color: '#fff', border: 'none', borderRadius: 6 }}
            >
              駁回
            </button>
          </div>
        </div>
      ))}
    </main>
  );
}
