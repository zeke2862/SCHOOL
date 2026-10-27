'use client';

import { useEffect, useMemo, useState } from 'react';
import { supabase, getCurrentTeacherId, getCurrentAppUser } from '@/lib/supabaseClient';
import { useDepartmentPermissions } from '@/lib/useDepartmentPermissions';
import { hasDepartment } from '@/lib/departments';
import { getHiddenStudentNos } from '@/lib/hiddenStudents';
import ErrorBanner from '@/components/ErrorBanner';

// 獎懲登記。【sql/107 起的新流程】本校所有教師都能送出敘獎／懲處，一律不直接生效：
//   一般教師送出 → 訓導處審核 → 管理員A →（A 決定）管理員S
//   訓導處（含 S／開發人員）自己送出 → 直接到管理員A →（A 決定）管理員S
// 「管理員A」＝角色 admin_a 且屬訓導處、或沒有掛部門（校長／副校長等）；同一個人不能連審兩關。
// 以下是舊版說明（審核層級已由上面規則取代）：
//
// 【敘獎】（嘉獎／小功／大功）——任何人（含訓導／管理員自己）送出後都不是直接生效，
// 而是先建立一筆申請，走「管理員B審核 →（小功／大功再送）管理員A審核 →
// （大功再送）管理員S審核」的分層審核，每一關都要「同意」，全部通過後系統才會
// 自動把這筆獎勵寫進學生正式的獎懲紀錄；任何一關「不同意」，這筆申請就變成
// 「已駁回」，不會出現在學生的紀錄裡。每位學生的敘獎類別（嘉獎/小功/大功）跟
// 次數（1-5次）分開選，原因是整批共用一個、填在下面。
// 其他教師一樣只能對自己有教過的班級送出申請（資料庫 sql/95 也有擋）。
//
// 【懲處】（警告／小過／大過）——【本輪修正】反映事項「補上教師『懲處』的規則
// （比照『敘獎』）」：訓導部門／系統管理員S 維持原本規則，送出後直接登記、
// 不用審核；其他教師現在也能對自己有教過的班級送出懲處申請，規則完全比照
// 敘獎的分層審核（管理員B→（小過/大過再送）管理員A→（大過再送）管理員S），
// 只是換成「警告=嘉獎那一級」「小過=小功那一級」「大過=大功那一級」（見
// sql/98 的說明）。UI 上敘獎／懲處兩種模式共用同一份「勾選＋類別＋次數」表格，
// 只是類別選單依模式換成 REWARD_TYPES 或 PUNISHMENT_TYPES。
//
// 管理員A／B／系統管理員S 打開這頁時，另外會看到「待我審核的敘獎/懲處申請」，
// 可以逐筆或全選後一次「同意」或「不同意」。

const REWARD_TYPES = ['嘉獎', '小功', '大功'] as const;
const PUNISHMENT_TYPES = ['大過', '小過', '警告'] as const;
const FALLBACK_POINTS: Record<string, number> = { 嘉獎: 1, 小功: 3, 大功: 9, 警告: -1, 小過: -3, 大過: -9 };
const COUNT_OPTIONS = [1, 2, 3, 4, 5];

type ClassOption = { id: string; label: string };
type StudentRow = { student_no: string; seat_no: number; name: string };
type RecentRow = { id: string; student_no: string; event_date: string; event_type: string; points: number; reason: string | null };
type ReviewRow = {
  id: string;
  student_no: string;
  event_date: string;
  event_type: string;
  count: number;
  points: number;
  reason: string;
  requested_by: string;
  requested_at: string;
  status: string;
};

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const STATUS_LABEL: Record<string, string> = { 待B審核: '待訓導處審核', 待A審核: '待管理員A審核', 待S審核: '待管理員S審核' };

export default function RewardsPage() {
  const perms = useDepartmentPermissions();
  const isFull = perms.isSystemAdmin || hasDepartment(perms.myDepartments, 'discipline');

  const [ready, setReady] = useState(false);
  const [realRole, setRealRole] = useState<string | null>(null);
  const [teacherId, setTeacherId] = useState<string | null>(null);
  const [classOptions, setClassOptions] = useState<ClassOption[]>([]);
  const [classId, setClassId] = useState<string | null>(null);
  const [students, setStudents] = useState<StudentRow[]>([]);

  const [mode, setMode] = useState<'reward' | 'punishment'>('reward');

  // 敘獎：每位學生獨立勾選是否納入這次批次、要登記哪一種、幾次
  const [rewardIncluded, setRewardIncluded] = useState<Record<string, boolean>>({});
  // 型別用 string 而不是 (typeof REWARD_TYPES)[number]：這個 state 現在敘獎／
  // 懲處兩種模式共用，值可能是 REWARD_TYPES 或 PUNISHMENT_TYPES 其中一種。
  const [rewardType, setRewardType] = useState<Record<string, string>>({});
  const [rewardCount, setRewardCount] = useState<Record<string, number>>({});

  const [eventDate, setEventDate] = useState(todayStr());
  const [reason, setReason] = useState('');
  const [pointDefaults, setPointDefaults] = useState<Record<string, number>>(FALLBACK_POINTS);
  const [recent, setRecent] = useState<RecentRow[]>([]);
  const [nameByNo, setNameByNo] = useState<Record<string, string>>({});
  const [loadError, setLoadError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [reviewRows, setReviewRows] = useState<ReviewRow[]>([]);
  const [reviewChecked, setReviewChecked] = useState<Record<string, boolean>>({});
  const [reviewBusy, setReviewBusy] = useState(false);
  const [reviewNameByNo, setReviewNameByNo] = useState<Record<string, string>>({});
  const [reviewRequesterByUid, setReviewRequesterByUid] = useState<Record<string, string>>({});

  // 我能審哪幾關：訓導處成員審第一關；管理員A（訓導處或沒有部門的 admin_a）審第二關；S／開發人員可審任何一關
  const canStageB = isFull;
  const canStageA =
    perms.isSystemAdmin ||
    (realRole === 'admin_a' && (hasDepartment(perms.myDepartments, 'discipline') || perms.myDepartments.length === 0));
  const canStageS = perms.isSystemAdmin;
  const myStatuses = [canStageB && '待B審核', canStageA && '待A審核', canStageS && '待S審核'].filter(Boolean) as string[];
  const myStage = myStatuses.length > 0 ? myStatuses.join(',') : null;

  useEffect(() => {
    if (perms.loading) return;
    (async () => {
      setLoadError(null);
      const appUser = await getCurrentAppUser();
      setRealRole((appUser as any)?.realRole ?? appUser?.role ?? null);
      const tid = await getCurrentTeacherId();
      setTeacherId(tid);

      const { data: defs } = await supabase.from('conduct_point_defaults').select('item, points');
      if (defs && defs.length > 0) {
        const map = { ...FALLBACK_POINTS };
        defs.forEach((d: any) => {
          if (d.item in map) map[d.item] = Number(d.points);
        });
        setPointDefaults(map);
      }

      let options: ClassOption[] = [];
      if (isFull) {
        const { data, error } = await supabase
          .from('classes')
          .select('id, academic_year, grade_level, class_name')
          .order('academic_year', { ascending: false })
          .order('grade_level')
          .order('class_name');
        if (error) setLoadError('讀取班級清單失敗：' + error.message);
        options = (data ?? []).map((c: any) => ({ id: c.id, label: `${c.academic_year} ${c.grade_level}${c.class_name}` }));
      } else if (tid) {
        const [{ data: homeroom }, { data: sched }] = await Promise.all([
          supabase.from('classes').select('id').eq('homeroom_teacher_id', tid),
          supabase.from('class_schedule').select('class_id').eq('teacher_id', tid),
        ]);
        const ids = Array.from(
          new Set([...(homeroom ?? []).map((r: any) => r.id), ...(sched ?? []).map((r: any) => r.class_id)].filter(Boolean))
        );
        if (ids.length > 0) {
          const { data, error } = await supabase
            .from('classes')
            .select('id, academic_year, grade_level, class_name')
            .in('id', ids)
            .order('academic_year', { ascending: false })
            .order('grade_level')
            .order('class_name');
          if (error) setLoadError('讀取班級清單失敗：' + error.message);
          options = (data ?? []).map((c: any) => ({ id: c.id, label: `${c.academic_year} ${c.grade_level}${c.class_name}` }));
        }
      }
      setClassOptions(options);
      setClassId(options[0]?.id ?? null);
      setReady(true);
    })();
  }, [perms.loading, isFull]);

  async function loadRecent(studentNos: string[]) {
    if (studentNos.length === 0) {
      setRecent([]);
      return;
    }
    const { data } = await supabase
      .from('conduct_events')
      .select('id, student_no, event_date, event_type, points, reason')
      .in('student_no', studentNos)
      .order('event_date', { ascending: false })
      .limit(30);
    setRecent((data ?? []) as RecentRow[]);
  }

  useEffect(() => {
    if (!classId) {
      setStudents([]);
      return;
    }
    (async () => {
      const { data: enrollRaw, error } = await supabase
        .from('enrollments')
        .select('seat_no, student_no')
        .eq('class_id', classId)
        .eq('is_current', true)
        .order('seat_no');
      if (error) {
        setLoadError('讀取學生名單失敗：' + error.message);
        return;
      }
      const hidden = isFull ? new Set<string>() : await getHiddenStudentNos((enrollRaw ?? []).map((r: any) => r.student_no));
      const enroll = (enrollRaw ?? []).filter((r: any) => !hidden.has(r.student_no));
      const nos = enroll.map((r: any) => r.student_no);
      const { data: studs } = await supabase
        .from('students')
        .select('student_no, name')
        .in('student_no', nos.length > 0 ? nos : ['__none__']);
      const names = new Map((studs ?? []).map((s: any) => [s.student_no, s.name]));
      const rows: StudentRow[] = enroll.map((r: any) => ({
        student_no: r.student_no,
        seat_no: r.seat_no,
        name: names.get(r.student_no) ?? '（找不到姓名）',
      }));
      setStudents(rows);
      setNameByNo((prev) => {
        const next = { ...prev };
        rows.forEach((s) => (next[s.student_no] = s.name));
        return next;
      });
      // 換班級時，重置逐列的暫存狀態，避免帶著上一班的勾選跑到新班級
      setRewardIncluded({});
      setRewardType({});
      setRewardCount({});
      loadRecent(nos);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [classId, isFull]);

  async function loadReviewQueue() {
    if (!myStage) {
      setReviewRows([]);
      return;
    }
    const { data, error } = await supabase
      .from('conduct_event_requests')
      .select('id, student_no, event_date, event_type, count, points, reason, requested_by, requested_at, status')
      .in('status', myStatuses)
      .order('requested_at', { ascending: true });
    if (error) {
      setLoadError('讀取待審核申請失敗：' + error.message);
      return;
    }
    const rows = (data ?? []) as ReviewRow[];
    setReviewRows(rows);
    setReviewChecked({});
    const nos = Array.from(new Set(rows.map((r) => r.student_no)));
    if (nos.length > 0) {
      const { data: studs } = await supabase.from('students').select('student_no, name').in('student_no', nos);
      const map: Record<string, string> = {};
      (studs ?? []).forEach((s: any) => (map[s.student_no] = s.name));
      setReviewNameByNo(map);
    }
    const uids = Array.from(new Set(rows.map((r) => r.requested_by)));
    if (uids.length > 0) {
      const { data: teacherRows } = await supabase.from('teachers').select('app_user_id, name').in('app_user_id', uids);
      const map: Record<string, string> = {};
      (teacherRows ?? []).forEach((t: any) => (map[t.app_user_id] = t.name));
      setReviewRequesterByUid(map);
    }
  }

  useEffect(() => {
    if (!ready) return;
    loadReviewQueue();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, myStage]);

  const rewardIncludedNos = useMemo(() => Object.keys(rewardIncluded).filter((no) => rewardIncluded[no]), [rewardIncluded]);
  const allRewardIncluded = useMemo(
    () => students.length > 0 && students.every((s) => rewardIncluded[s.student_no]),
    [students, rewardIncluded]
  );
  function toggleAllReward() {
    const next = !allRewardIncluded;
    setRewardIncluded(Object.fromEntries(students.map((s) => [s.student_no, next])));
  }

  // 【本輪修正】原本只有敘獎會走這條「送審」的路；現在教師登記懲處也要走一樣
  // 的流程（反映事項「補上教師『懲處』的規則，比照『敘獎』」），改成通用版本，
  // 用 kind 參數決定文案／預設類別，敘獎、懲處都共用同一份
  // rewardIncluded／rewardType／rewardCount 這幾個 state（兩種模式互斥，不會
  // 同時用到）。
  async function handleSubmitRequest(kind: '敘獎' | '懲處') {
    setMessage(null);
    const nos = rewardIncludedNos;
    if (nos.length === 0) return alert(`請先勾選要${kind}的學生。`);
    if (!reason.trim()) return alert('請填寫原因。');
    if (!teacherId && !isFull) return alert('找不到您的教師資料，無法送出申請。');

    const defaultType = kind === '敘獎' ? '嘉獎' : '警告';
    const rows = nos.map((student_no) => {
      const type = rewardType[student_no] ?? defaultType;
      const count = rewardCount[student_no] ?? 1;
      const unit = pointDefaults[type] ?? FALLBACK_POINTS[type];
      return { student_no, type, count, points: unit * count };
    });

    const summary = rows.map((r) => `${nameByNo[r.student_no] ?? r.student_no}：${r.type} × ${r.count}`).join('\n');
    const ok = window.confirm(
      `即將送出以下${kind}申請：\n\n${summary}\n\n原因：${reason.trim()}\n\n` +
        (isFull
          ? '送出後直接送管理員A審核（A 可再決定是否送管理員S），通過後才會正式記錄到學生資料，點選確認後無法自行撤回。'
          : '送出後先由訓導處審核，再送管理員A（A 可再決定是否送管理員S），通過後才會正式記錄到學生資料，點選確認後無法自行撤回。')
    );
    if (!ok) return;

    setBusy(true);
    const appUser = await getCurrentAppUser();
    if (!appUser) {
      setBusy(false);
      alert('請重新登入');
      return;
    }
    const batchId = crypto.randomUUID();
    const payload = rows.map((r) => ({
      batch_id: batchId,
      student_no: r.student_no,
      event_date: eventDate,
      event_type: r.type,
      count: r.count,
      points: r.points,
      reason: reason.trim(),
      requested_by: appUser.id,
    }));
    const { error } = await supabase.from('conduct_event_requests').insert(payload);
    setBusy(false);
    if (error) {
      alert('送出申請失敗：' + error.message);
      return;
    }
    setMessage(`已送出 ${rows.length} 位學生的${kind}申請，${isFull ? '待管理員A審核' : '待訓導處審核'}。`);
    setRewardIncluded({});
    setRewardType({});
    setRewardCount({});
    setReason('');
  }

  const reviewCheckedIds = Object.keys(reviewChecked).filter((id) => reviewChecked[id]);
  const allReviewChecked = reviewRows.length > 0 && reviewRows.every((r) => reviewChecked[r.id]);
  function toggleAllReview() {
    const next = !allReviewChecked;
    setReviewChecked(Object.fromEntries(reviewRows.map((r) => [r.id, next])));
  }

  async function handleReviewDecision(decision: '同意' | '不同意' | '送S') {
    if (reviewCheckedIds.length === 0) return alert('請先勾選要處理的學生。');
    if (decision === '送S' && reviewRows.some((r) => reviewChecked[r.id] && r.status !== '待A審核')) {
      return alert('「送管理員S」只能用在「待管理員A審核」的申請，請只勾選那一類。');
    }
    const ok = window.confirm(`確定對勾選的 ${reviewCheckedIds.length} 筆申請都選擇「${decision === '送S' ? '送管理員S決定' : decision}」？`);
    if (!ok) return;
    setReviewBusy(true);
    const failures: string[] = [];
    for (const id of reviewCheckedIds) {
      const { error } = await supabase.rpc('decide_conduct_event_request', { p_id: id, p_decision: decision });
      if (error) {
        const row = reviewRows.find((r) => r.id === id);
        failures.push(`${reviewNameByNo[row?.student_no ?? ''] ?? row?.student_no}：${error.message}`);
      }
    }
    setReviewBusy(false);
    if (failures.length > 0) {
      alert('部分申請處理失敗：\n' + failures.join('\n'));
    }
    loadReviewQueue();
    loadRecent(students.map((s) => s.student_no));
  }

  if (perms.loading || !ready) {
    return (
      <main style={{ maxWidth: 900, margin: '0 auto', padding: 24 }}>
        <p style={{ fontSize: 13, color: '#999' }}>載入中…</p>
      </main>
    );
  }

  return (
    <main style={{ maxWidth: 960, margin: '0 auto', padding: 24 }}>
      <h1 style={{ fontSize: 16, marginBottom: 4 }}>獎懲登記</h1>
      <p style={{ fontSize: 12, color: '#666', marginBottom: 16 }}>
        {isFull
          ? '訓導處：可對全校任何學生送出敘獎／懲處，送出後直接到管理員A審核（A 可再決定是否送管理員S），通過後才正式生效。'
          : '教師：可對自己有教過的班級送出敘獎／懲處，送出後先由訓導處審核，再送管理員A（A 可再決定是否送管理員S），通過後才正式記錄。'}
      </p>
      <ErrorBanner message={loadError} />
      {message && <p style={{ fontSize: 13, color: '#3B6D11', marginBottom: 12 }}>{message}</p>}

      {myStage && (
        <div style={{ border: '1px solid #E0C68A', background: '#FFFBEF', borderRadius: 8, padding: 16, marginBottom: 24 }}>
          <h2 style={{ fontSize: 14, marginBottom: 8 }}>
            待您審核的敘獎／懲處申請　
            <span style={{ fontWeight: 400, fontSize: 12, color: '#999' }}>共 {reviewRows.length} 筆</span>
          </h2>
          {reviewRows.length === 0 ? (
            <p style={{ fontSize: 13, color: '#999' }}>目前沒有待您審核的申請。</p>
          ) : (
            <>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, marginBottom: 10 }}>
                <thead>
                  <tr>
                    <th style={{ width: 36, padding: 6 }}>
                      <input type="checkbox" checked={allReviewChecked} onChange={toggleAllReview} title="全選" />
                    </th>
                    <th style={{ textAlign: 'left', padding: 6 }}>日期</th>
                    <th style={{ textAlign: 'left', padding: 6 }}>學生</th>
                    <th style={{ textAlign: 'left', padding: 6 }}>類別</th>
                    <th style={{ textAlign: 'right', padding: 6 }}>次數</th>
                    <th style={{ textAlign: 'right', padding: 6 }}>點數</th>
                    <th style={{ textAlign: 'left', padding: 6 }}>原因</th>
                    <th style={{ textAlign: 'left', padding: 6 }}>申請人</th>
                    <th style={{ textAlign: 'left', padding: 6 }}>關卡</th>
                  </tr>
                </thead>
                <tbody>
                  {reviewRows.map((r) => (
                    <tr key={r.id} style={{ borderTop: '1px solid #eee' }}>
                      <td style={{ padding: 6, textAlign: 'center' }}>
                        <input
                          type="checkbox"
                          checked={!!reviewChecked[r.id]}
                          onChange={() => setReviewChecked((prev) => ({ ...prev, [r.id]: !prev[r.id] }))}
                        />
                      </td>
                      <td style={{ padding: 6 }}>{r.event_date}</td>
                      <td style={{ padding: 6 }}>{reviewNameByNo[r.student_no] ?? r.student_no}</td>
                      <td style={{ padding: 6 }}>{r.event_type}</td>
                      <td style={{ padding: 6, textAlign: 'right' }}>{r.count}</td>
                      <td style={{ padding: 6, textAlign: 'right' }}>{r.points}</td>
                      <td style={{ padding: 6, color: '#666' }}>{r.reason}</td>
                      <td style={{ padding: 6 }}>{reviewRequesterByUid[r.requested_by] ?? '—'}</td>
                      <td style={{ padding: 6, fontSize: 12, color: '#A36A2D' }}>{STATUS_LABEL[r.status] ?? r.status}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  onClick={() => handleReviewDecision('同意')}
                  disabled={reviewBusy}
                  style={{ padding: '6px 16px', background: '#2C6D2C', color: '#fff', border: 'none', borderRadius: 6, fontSize: 13 }}
                >
                  同意勾選項目
                </button>
                {canStageA && reviewRows.some((r) => r.status === '待A審核') && (
                  <button
                    onClick={() => handleReviewDecision('送S')}
                    disabled={reviewBusy}
                    style={{ padding: '6px 16px', background: '#fff', color: '#2C2C2A', border: '1px solid #2C2C2A', borderRadius: 6, fontSize: 13 }}
                    title="管理員A：勾選的申請改送管理員S決定"
                  >
                    送管理員S決定
                  </button>
                )}
                <button
                  onClick={() => handleReviewDecision('不同意')}
                  disabled={reviewBusy}
                  style={{ padding: '6px 16px', background: '#fff', color: '#A32D2D', border: '1px solid #A32D2D', borderRadius: 6, fontSize: 13 }}
                >
                  不同意勾選項目
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {/* 【本輪修正】反映事項「補上教師『懲處』的規則（比照『敘獎』）」——這個
          切換原本只有訓導/管理員（isFull）看得到，一般教師現在也能送出懲處
          申請，所以兩種身分都要看得到這個切換。 */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <label style={{ fontSize: 13, display: 'flex', alignItems: 'center', gap: 4 }}>
          <input
            type="radio"
            checked={mode === 'reward'}
            onChange={() => {
              setMode('reward');
              setRewardIncluded({});
              setRewardType({});
              setRewardCount({});
            }}
          />
          敘獎（嘉獎／小功／大功）
        </label>
        <label style={{ fontSize: 13, display: 'flex', alignItems: 'center', gap: 4 }}>
          <input
            type="radio"
            checked={mode === 'punishment'}
            onChange={() => {
              setMode('punishment');
              setRewardIncluded({});
              setRewardType({});
              setRewardCount({});
            }}
          />
          懲處（警告／小過／大過）
        </label>
      </div>
      {mode === 'punishment' && (
        <p style={{ fontSize: 12, color: '#A36A2D', marginBottom: 12 }}>
          懲處跟敘獎一樣要走審核，全部通過後才會正式記錄到學生資料。
        </p>
      )}

      {classOptions.length === 0 ? (
        <p style={{ fontSize: 13, color: '#A36A2D' }}>目前沒有可登記的班級（教師需為導師或有排課的班級才能登記）。</p>
      ) : (
        <>
          <select
            value={classId ?? ''}
            onChange={(e) => setClassId(e.target.value)}
            style={{ padding: 8, marginBottom: 12, width: '100%', maxWidth: 320 }}
          >
            {classOptions.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </select>

          {/* 【本輪修正】敘獎／懲處現在共用同一份「勾選＋類別＋次數」表格，差別只在
              類別選單（typeOptions）跟送出時呼叫哪個 handler。 */}
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, marginBottom: 16 }}>
            <thead>
              <tr>
                <th style={{ width: 36, padding: 6 }}>
                  <input type="checkbox" checked={allRewardIncluded} onChange={toggleAllReward} title="全選／取消全選本班" />
                </th>
                <th style={{ textAlign: 'left', padding: 6 }}>座號</th>
                <th style={{ textAlign: 'left', padding: 6 }}>姓名</th>
                <th style={{ textAlign: 'left', padding: 6 }}>{mode === 'reward' ? '敘獎' : '懲處'}</th>
                <th style={{ textAlign: 'left', padding: 6 }}>次數</th>
              </tr>
            </thead>
            <tbody>
              {students.map((s) => {
                const typeOptions: readonly string[] = mode === 'reward' ? REWARD_TYPES : PUNISHMENT_TYPES;
                const defaultType = mode === 'reward' ? '嘉獎' : '警告';
                return (
                  <tr key={s.student_no} style={{ borderTop: '1px solid #eee' }}>
                    <td style={{ padding: 6, textAlign: 'center' }}>
                      <input
                        type="checkbox"
                        checked={!!rewardIncluded[s.student_no]}
                        onChange={() => setRewardIncluded((prev) => ({ ...prev, [s.student_no]: !prev[s.student_no] }))}
                      />
                    </td>
                    <td style={{ padding: 6 }}>{s.seat_no}</td>
                    <td style={{ padding: 6 }}>{s.name}</td>
                    <td style={{ padding: 6 }}>
                      <select
                        value={rewardType[s.student_no] ?? defaultType}
                        onChange={(e) => setRewardType((prev) => ({ ...prev, [s.student_no]: e.target.value }))}
                        style={{ padding: 4 }}
                      >
                        {typeOptions.map((t) => (
                          <option key={t} value={t}>
                            {t}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td style={{ padding: 6 }}>
                      <select
                        value={rewardCount[s.student_no] ?? 1}
                        onChange={(e) => setRewardCount((prev) => ({ ...prev, [s.student_no]: Number(e.target.value) }))}
                        style={{ padding: 4 }}
                      >
                        {COUNT_OPTIONS.map((n) => (
                          <option key={n} value={n}>
                            {n} 次
                          </option>
                        ))}
                      </select>
                    </td>
                  </tr>
                );
              })}
              {students.length === 0 && (
                <tr>
                  <td colSpan={5} style={{ padding: 12, textAlign: 'center', color: '#999' }}>
                    這個班級目前沒有在學學生
                  </td>
                </tr>
              )}
            </tbody>
          </table>

          <div style={{ borderTop: '1px solid #eee', paddingTop: 12, maxWidth: 520 }}>
            <p style={{ fontSize: 13, marginBottom: 8 }}>
              已勾選 <b>{rewardIncludedNos.length}</b> 位學生
            </p>
            <input type="date" value={eventDate} onChange={(e) => setEventDate(e.target.value)} style={{ padding: 8, marginBottom: 8 }} />
            <textarea
              placeholder="原因（必填，整批共用）"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              style={{ width: '100%', padding: 8, marginBottom: 8, display: 'block' }}
            />
            <button
              onClick={() => {
                if (mode === 'reward') handleSubmitRequest('敘獎');
                else handleSubmitRequest('懲處');
              }}
              disabled={busy}
              style={{ padding: '8px 18px', background: '#2C2C2A', color: '#fff', border: 'none', borderRadius: 6 }}
            >
              {busy ? '送出中…' : '批次送出申請'}
            </button>
          </div>

          {recent.length > 0 && (
            <div style={{ marginTop: 24 }}>
              <h2 style={{ fontSize: 14, marginBottom: 6 }}>本班最近已生效的獎懲紀錄</h2>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <tbody>
                  {recent.map((r) => (
                    <tr key={r.id} style={{ borderTop: '1px solid #eee' }}>
                      <td style={{ padding: 4 }}>{r.event_date}</td>
                      <td style={{ padding: 4 }}>{nameByNo[r.student_no] ?? r.student_no}</td>
                      <td style={{ padding: 4 }}>{r.event_type}</td>
                      <td style={{ padding: 4, color: '#666' }}>{r.reason ?? ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </main>
  );
}
