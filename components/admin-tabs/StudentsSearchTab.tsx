'use client';

import { useEffect, useState } from 'react';
import { fetchAllPages, chunk } from '@/lib/supabasePaging';
import { supabase, getCurrentAppUser, isAdminInCurrentView } from '@/lib/supabaseClient';
import ErrorBanner from '@/components/ErrorBanner';
import { getHiddenStudentNos } from '@/lib/hiddenStudents';
import { useCaps } from '@/lib/useCaps';
import { resolveCurrentTerm, estimateTermStart } from '@/lib/academicTerm';

type ClassOption = { id: string; label: string; academic_year: number; grade_level: string; class_name: string };
type EnrolledStudent = {
  id: string;
  student_no: string;
  seat_no: number | null;
  term: string;
  students?: { name: string; gender: string | null };
  classes?: { id: string; academic_year: number; department: string; grade_level: string; class_name: string };
};

type StudentDetail = {
  student_no: string;
  name: string;
  gender: string | null;
  thai_name: string | null;
  dob: string | null;
  id_number: string | null;
  nationality: string | null;
  religion: string | null;
  blood_type: string | null;
  address: string | null;
  phone: string | null;
  previous_school: string | null;
  previous_school_grade: string | null;
  updated_at: string | null;
  updated_by: string | null;
};

const EDIT_FIELDS: { key: keyof StudentDetail; label: string }[] = [
  { key: 'name', label: '姓名' },
  { key: 'gender', label: '性別' },
  { key: 'thai_name', label: '泰文姓名' },
  { key: 'dob', label: '出生日期' },
  { key: 'id_number', label: '身分證/護照號碼' },
  { key: 'nationality', label: '國籍' },
  { key: 'religion', label: '宗教' },
  { key: 'blood_type', label: '血型' },
  { key: 'address', label: '地址' },
  { key: 'phone', label: '電話' },
  { key: 'previous_school', label: '原就讀學校' },
  { key: 'previous_school_grade', label: '原就讀年級' },
];

// 監護人資料（父親/母親/監護人，一個學生可以有多筆，來源同 guardians 表，
// 跟「新生入學登記」表單共用同一組欄位）。id 為 null 代表這筆是編輯畫面上
// 新增、還沒存進資料庫的監護人；儲存時依 id 有無決定要 insert 還是 update。
type GuardianForm = {
  id: string | null;
  relation: string;
  name: string;
  chinese_name: string;
  occupation: string;
  phone: string;
  email: string;
  address: string;
};

const emptyGuardianForm = (): GuardianForm => ({
  id: null,
  relation: '監護人',
  name: '',
  chinese_name: '',
  occupation: '',
  phone: '',
  email: '',
  address: '',
});

const ATTENDANCE_ISSUE_STATUSES = ['曠課', '遲到', '病假', '事假', '公假'] as const;

// 查詢學生：全校或依班級查詢目前在學學生名冊，可用學號/姓名關鍵字搜尋，也可以直接修正學生資料。
// 資料來源跟「既有學生快速建檔」「班級與導師設定」共用同一份 enrollments/students/classes，
// 只要建檔/編班有寫入成功，這裡就查得到，也可以用來快速確認批次上傳的結果對不對。
export default function StudentSearchPage() {
  const [classes, setClasses] = useState<ClassOption[]>([]);
  const [classId, setClassId] = useState('');
  const [keyword, setKeyword] = useState('');
  const [students, setStudents] = useState<EnrolledStudent[]>([]);
  const [attendanceSummary, setAttendanceSummary] = useState<Record<string, Record<string, number>>>({});
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const { caps } = useCaps();
  const canBatchMove = !!caps?.academic; // 批次調班只有教務（含教務主管、系統管理員）能用

  // 勾選學生 → 批次調班
  const [summaryRange, setSummaryRange] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [moveClassId, setMoveClassId] = useState('');
  const [reseat, setReseat] = useState(true);
  const [moving, setMoving] = useState(false);
  const [moveMsg, setMoveMsg] = useState('');
  // 非本班導師／非管理員：只能看監護人聯絡電話（不給看身分證、地址等個資，見 sql/83fix_roster_pii_exposure.sql）
  const [phones, setPhones] = useState<{ name: string; rows: { relation: string; name: string | null; phone: string | null }[] | null; error?: string } | null>(null);

  const [isAdmin, setIsAdmin] = useState(false);
  const [myAppUserId, setMyAppUserId] = useState<string | null>(null);
  const [myHomeroomClassIds, setMyHomeroomClassIds] = useState<Set<string>>(new Set());
  const [editorNames, setEditorNames] = useState<Record<string, string>>({});

  const [editingStudentNo, setEditingStudentNo] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<StudentDetail | null>(null);
  const [editError, setEditError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [guardianForms, setGuardianForms] = useState<GuardianForm[]>([]);
  const [removedGuardianIds, setRemovedGuardianIds] = useState<string[]>([]);
  const [guardiansLoading, setGuardiansLoading] = useState(false);

  async function loadMyPermissions() {
    const appUser = await getCurrentAppUser();
    if (!appUser) return;
    setMyAppUserId(appUser.id);
    setIsAdmin(isAdminInCurrentView(appUser.role));

    if (appUser.role === 'homeroom_teacher') {
      const { data: teacherRow } = await supabase.from('teachers').select('id').eq('app_user_id', appUser.id).maybeSingle();
      if (teacherRow) {
        const { data: myClasses } = await supabase.from('classes').select('id').eq('homeroom_teacher_id', teacherRow.id);
        setMyHomeroomClassIds(new Set((myClasses ?? []).map((c: any) => c.id)));
      }
    }
  }

  async function loadClasses() {
    const { data } = await supabase
      .from('classes')
      .select('id, academic_year, grade_level, class_name')
      .order('academic_year', { ascending: false })
      .order('grade_level');
    setClasses(
      (data ?? []).map((c: any) => ({
        id: c.id,
        label: `${c.academic_year} ${c.grade_level}${c.class_name}`,
        academic_year: c.academic_year,
        grade_level: c.grade_level,
        class_name: c.class_name,
      }))
    );
  }

  async function loadStudents() {
    setLoading(true);
    // 全校在籍學生超過 1000 人，一次查詢最多只會回 1000 筆，所以要分頁查完（排序加 id 才不會漏資料）
    const { data, error } = await fetchAllPages((from, to) => {
      let query = supabase
        .from('enrollments')
        .select(
          'id, student_no, seat_no, term, students(name, gender), classes(id, academic_year, department, grade_level, class_name)'
        )
        .eq('is_current', true)
        .order('seat_no')
        .order('id');
      if (classId) query = query.eq('class_id', classId);
      return query.range(from, to);
    });
    setLoadError(error ? '讀取學生名冊失敗：' + error : null);
    let rows = (data ?? []) as unknown as EnrolledStudent[];
    if (!isAdmin) {
      // 休學／轉學／退學的學生，只有管理者視角看得到（管理員切到教師視角預覽時，資料庫不會過濾，這裡補一層）
      const hidden = await getHiddenStudentNos(rows.map((r) => r.student_no));
      rows = rows.filter((r) => !hidden.has(r.student_no));
    }
    setStudents(rows);
    setSelectedIds(new Set());
    loadAttendanceSummary(rows.map((r) => r.student_no));
    setLoading(false);
  }

  // 出缺席狀況：統計目前顯示的每位學生已登錄的出缺勤次數（累計至今，不限學期範圍），
  // 只顯示「非出席」的幾種狀態，方便一眼看出哪些學生缺勤/請假偏多。
  async function loadAttendanceSummary(studentNos: string[]) {
    if (studentNos.length === 0) {
      setAttendanceSummary({});
      return;
    }
    // 只算「本學期」：學期起訖日取自「學年學期管理」（沒填起日就用預設的開學日），
    // 上一個學期的紀錄不會再算進來；沒有目前學期設定時才退回全部累計。
    let rangeStart: string | null = null;
    let rangeEnd: string | null = null;
    const cur = await resolveCurrentTerm();
    if (cur) {
      const { data: termRow } = await supabase
        .from('academic_terms')
        .select('term_start_date, term_end_date')
        .eq('academic_year', cur.academic_year)
        .eq('term', cur.term)
        .maybeSingle();
      rangeStart = termRow?.term_start_date ?? estimateTermStart(cur.academic_year, cur.term);
      rangeEnd = termRow?.term_end_date ?? null;
      setSummaryRange(`${cur.academic_year} ${cur.term}（${rangeStart}${rangeEnd ? ' ～ ' + rangeEnd : ' 起'}）`);
    }
    // 一次 .in() 放一千多個學號網址會太長，而且結果超過 1000 筆也會被截斷：學號分小段、每段再分頁
    const map: Record<string, Record<string, number>> = {};
    for (const part of chunk(studentNos, 100)) {
      const { data, error } = await fetchAllPages((from, to) => {
        let q = supabase.from('attendance').select('student_no, status').in('student_no', part);
        if (rangeStart) q = q.gte('record_date', rangeStart);
        if (rangeEnd) q = q.lte('record_date', rangeEnd);
        return q.order('id').range(from, to);
      });
      if (error) return; // 讀取失敗時不擋主要查詢流程，出缺席欄位就顯示空白
      (data ?? []).forEach((r: any) => {
        map[r.student_no] = map[r.student_no] ?? {};
        map[r.student_no][r.status] = (map[r.student_no][r.status] ?? 0) + 1;
      });
    }
    setAttendanceSummary(map);
  }

  useEffect(() => {
    loadMyPermissions();
    loadClasses();
  }, []);

  useEffect(() => {
    loadStudents();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [classId]);

  function canEdit(s: EnrolledStudent) {
    if (isAdmin) return true;
    if (s.classes && myHomeroomClassIds.has(s.classes.id)) return true;
    return false;
  }

  async function openEdit(studentNo: string) {
    setEditError(null);
    setEditingStudentNo(studentNo);
    setEditForm(null);
    setGuardianForms([]);
    setRemovedGuardianIds([]);
    const { data, error } = await supabase
      .from('students')
      .select(
        'student_no, name, gender, thai_name, dob, id_number, nationality, religion, blood_type, address, phone, previous_school, previous_school_grade, updated_at, updated_by'
      )
      .eq('student_no', studentNo)
      .single();
    if (error) {
      setEditError('讀取學生詳細資料失敗：' + error.message);
      return;
    }
    setEditForm(data as StudentDetail);

    if (data?.updated_by && !editorNames[data.updated_by]) {
      const { data: editorRow } = await supabase.from('app_users').select('name').eq('id', data.updated_by).maybeSingle();
      if (editorRow) setEditorNames((prev) => ({ ...prev, [data.updated_by as string]: editorRow.name }));
    }

    setGuardiansLoading(true);
    const { data: guardianRows, error: guardianErr } = await supabase
      .from('guardians')
      .select('id, relation, name, chinese_name, occupation, phone, email, address')
      .eq('student_no', studentNo);
    if (guardianErr) {
      setEditError((prev) => prev ?? '讀取監護人資料失敗：' + guardianErr.message);
    } else {
      setGuardianForms(
        (guardianRows ?? []).map((g: any) => ({
          id: g.id,
          relation: g.relation ?? '監護人',
          name: g.name ?? '',
          chinese_name: g.chinese_name ?? '',
          occupation: g.occupation ?? '',
          phone: g.phone ?? '',
          email: g.email ?? '',
          address: g.address ?? '',
        }))
      );
    }
    setGuardiansLoading(false);
  }

  function closeEdit() {
    setEditingStudentNo(null);
    setEditForm(null);
    setEditError(null);
    setGuardianForms([]);
    setRemovedGuardianIds([]);
  }

  function updateGuardianForm(index: number, patch: Partial<GuardianForm>) {
    setGuardianForms((prev) => prev.map((g, i) => (i === index ? { ...g, ...patch } : g)));
  }

  function addGuardianForm() {
    setGuardianForms((prev) => [...prev, emptyGuardianForm()]);
  }

  function removeGuardianForm(index: number) {
    setGuardianForms((prev) => {
      const g = prev[index];
      if (g.id) setRemovedGuardianIds((ids) => [...ids, g.id as string]);
      return prev.filter((_, i) => i !== index);
    });
  }

  async function handleSaveEdit(e: React.FormEvent) {
    e.preventDefault();
    if (!editForm || !myAppUserId) return;
    setSaving(true);
    setEditError(null);

    const payload: Record<string, any> = { updated_at: new Date().toISOString(), updated_by: myAppUserId };
    EDIT_FIELDS.forEach(({ key }) => {
      payload[key] = editForm[key] ?? null;
    });

    const { error } = await supabase.from('students').update(payload).eq('student_no', editForm.student_no);
    if (error) {
      setSaving(false);
      setEditError('儲存失敗：' + error.message + (error.message.includes('policy') ? '（您可能沒有修改這位學生的權限）' : ''));
      return;
    }

    // 監護人資料：刪除的先刪、既有的更新、沒有 id 的（畫面上新增的）才 insert；
    // 空白（沒填姓名）的新增列直接略過，不建立空記錄。
    if (removedGuardianIds.length > 0) {
      const { error: delErr } = await supabase.from('guardians').delete().in('id', removedGuardianIds);
      if (delErr) {
        setSaving(false);
        setEditError('監護人資料刪除失敗：' + delErr.message);
        return;
      }
    }
    for (const g of guardianForms) {
      const guardianPayload = {
        relation: g.relation,
        name: g.name || null,
        chinese_name: g.chinese_name || null,
        occupation: g.occupation || null,
        phone: g.phone || null,
        email: g.email || null,
        address: g.address || null,
      };
      if (g.id) {
        const { error: updErr } = await supabase.from('guardians').update(guardianPayload).eq('id', g.id);
        if (updErr) {
          setSaving(false);
          setEditError('監護人資料儲存失敗：' + updErr.message);
          return;
        }
      } else if (g.name.trim()) {
        const { error: insErr } = await supabase.from('guardians').insert({ student_no: editForm.student_no, ...guardianPayload });
        if (insErr) {
          setSaving(false);
          setEditError('監護人資料新增失敗：' + insErr.message);
          return;
        }
      }
    }

    setSaving(false);
    closeEdit();
    loadStudents();
  }

  async function showPhones(s: EnrolledStudent) {
    setPhones({ name: s.students?.name ?? s.student_no, rows: null });
    const { data, error } = await supabase.rpc('guardian_phones_for_roster', { p_student_no: s.student_no });
    if (error) setPhones({ name: s.students?.name ?? s.student_no, rows: [], error: error.message });
    else setPhones({ name: s.students?.name ?? s.student_no, rows: (data ?? []) as any });
  }

  // 重排某班某學期的座號（依學號由小到大 1、2、3…）；避開同班同學期「非現行」學籍佔用的座號。
  // 先全部改成大數字再改回來，避免中途座號重複撞到「同班同學期座號不可重複」的限制。
  async function renumberClass(cid: string, term: string) {
    const { data } = await supabase.from('enrollments').select('id, student_no, is_current, seat_no').eq('class_id', cid).eq('term', term).order('student_no').order('id');
    const all = (data ?? []) as { id: string; student_no: string; is_current: boolean; seat_no: number }[];
    const current = all.filter((r) => r.is_current);
    const used = new Set(all.filter((r) => !r.is_current).map((r) => r.seat_no));
    for (let i = 0; i < current.length; i++) {
      const { error } = await supabase.from('enrollments').update({ seat_no: 100000 + i }).eq('id', current[i].id);
      if (error) throw new Error(error.message);
    }
    let seat = 0;
    for (const r of current) {
      do seat++; while (used.has(seat));
      const { error } = await supabase.from('enrollments').update({ seat_no: seat }).eq('id', r.id);
      if (error) throw new Error(error.message);
    }
  }

  async function handleBatchMove() {
    const rows = students.filter((s) => selectedIds.has(s.id));
    const target = classes.find((c) => c.id === moveClassId);
    if (rows.length === 0 || !target) return;
    const terms = Array.from(new Set(rows.map((r) => r.term)));
    if (terms.length > 1) {
      alert('勾選的學生不是同一個學期的學籍，請分開處理。');
      return;
    }
    const term = terms[0];
    if (!confirm(`把 ${rows.length} 位學生調到「${target.label}」？${reseat ? '\n調完會把原班與新班的座號依學號重新排。' : '\n座號會接在新班現有座號後面。'}`)) return;
    setMoving(true);
    setMoveMsg('');
    try {
      const { data: existing } = await supabase.from('enrollments').select('seat_no').eq('class_id', moveClassId).eq('term', term);
      let seat = Math.max(0, ...((existing ?? []) as { seat_no: number }[]).map((e) => e.seat_no ?? 0));
      const sources = new Set<string>();
      for (const r of [...rows].sort((a, b) => a.student_no.localeCompare(b.student_no))) {
        if (r.classes?.id) sources.add(r.classes.id);
        seat++;
        const { error } = await supabase.from('enrollments').update({ class_id: moveClassId, seat_no: seat }).eq('id', r.id);
        if (error) throw new Error(`${r.students?.name ?? r.student_no}：${error.message}`);
      }
      if (reseat) {
        for (const cid of [moveClassId, ...Array.from(sources)]) if (cid) await renumberClass(cid, term);
      }
      setMoveMsg(`✅ 已把 ${rows.length} 位學生調到 ${target.label}${reseat ? '，座號已重排' : ''}。`);
      setSelectedIds(new Set());
      setMoveClassId('');
      await loadStudents();
    } catch (e: any) {
      setMoveMsg('❌ 調班失敗：' + (e?.message ?? e));
    } finally {
      setMoving(false);
    }
  }

  const keywordLower = keyword.trim().toLowerCase();
  const filtered = keywordLower
    ? students.filter(
        (s) => s.student_no.toLowerCase().includes(keywordLower) || (s.students?.name ?? '').toLowerCase().includes(keywordLower)
      )
    : students;

  return (
    <div style={{ maxWidth: 800, margin: '0 auto', padding: 24 }}>
      <h1 style={{ fontSize: 16, marginBottom: 4 }}>查詢學生（全校／各班級）</h1>
      <p style={{ fontSize: 12, color: '#666', marginBottom: 16 }}>
        查詢目前在學學生名冊（原本的「學生名冊」已併入這裡）：選「全部班級」看全校，或指定單一班級看座號／學號／姓名；也可以用學號/姓名關鍵字搜尋。
        本班導師與管理員可「修正資料」；其他教師只看得到監護人聯絡電話。教務可勾選學生後「批次調班」。
        「出缺席狀況」只計算<b>本學期</b>{summaryRange ? `（${summaryRange}）` : ''}的紀錄（曠課/遲到/病假/事假/公假），要看其他月份或過去學期的明細請到「學生出席紀錄查詢」頁面。
      </p>
      <ErrorBanner message={loadError} />

      <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
        <select value={classId} onChange={(e) => setClassId(e.target.value)} style={{ padding: 8, minWidth: 200 }}>
          <option value="">全部班級（全校）</option>
          {classes.map((c) => (
            <option key={c.id} value={c.id}>
              {c.label}
            </option>
          ))}
        </select>
        <input
          placeholder="搜尋學號或姓名"
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          style={{ padding: 8, flex: 1, minWidth: 160 }}
        />
      </div>

      <p style={{ fontSize: 12, color: '#999', marginBottom: 8 }}>
        {loading ? '查詢中…' : `共 ${filtered.length} 位學生`}
      </p>

      {canBatchMove && (
        <div style={{ border: '1px solid #e5e2da', background: '#faf9f6', borderRadius: 8, padding: '8px 12px', marginBottom: 10, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', fontSize: 13 }}>
          <span>
            已勾選 <b>{selectedIds.size}</b> 位
          </span>
          <select value={moveClassId} onChange={(e) => setMoveClassId(e.target.value)} style={{ padding: 6, minWidth: 180 }}>
            <option value="">調到哪個班…</option>
            {classes.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </select>
          <label style={{ fontSize: 12 }}>
            <input type="checkbox" checked={reseat} onChange={(e) => setReseat(e.target.checked)} /> 調完依學號重排兩班座號
          </label>
          <button onClick={handleBatchMove} disabled={moving || selectedIds.size === 0 || !moveClassId} style={{ padding: '6px 14px', fontSize: 13, cursor: 'pointer' }}>
            {moving ? '調班中…' : '批次調班'}
          </button>
          {moveMsg && <span style={{ fontSize: 12 }}>{moveMsg}</span>}
        </div>
      )}

      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
        <thead>
          <tr>
            {canBatchMove && (
              <th style={{ padding: 6, width: 28 }}>
                <input
                  type="checkbox"
                  checked={filtered.length > 0 && filtered.every((s) => selectedIds.has(s.id))}
                  onChange={(e) => setSelectedIds(e.target.checked ? new Set(filtered.map((s) => s.id)) : new Set())}
                />
              </th>
            )}
            <th style={{ textAlign: 'left', padding: 6 }}>學號</th>
            <th style={{ textAlign: 'left', padding: 6 }}>姓名</th>
            <th style={{ textAlign: 'left', padding: 6 }}>班級</th>
            <th style={{ textAlign: 'right', padding: 6 }}>座號</th>
            <th style={{ textAlign: 'left', padding: 6 }}>學期</th>
            <th style={{ textAlign: 'left', padding: 6 }}>出缺席狀況</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {filtered.map((s) => (
            <tr key={s.id} style={{ borderTop: '1px solid #eee' }}>
              {canBatchMove && (
                <td style={{ padding: 6 }}>
                  <input
                    type="checkbox"
                    checked={selectedIds.has(s.id)}
                    onChange={(e) =>
                      setSelectedIds((prev) => {
                        const next = new Set(prev);
                        if (e.target.checked) next.add(s.id);
                        else next.delete(s.id);
                        return next;
                      })
                    }
                  />
                </td>
              )}
              <td style={{ padding: 6 }}>{s.student_no}</td>
              <td style={{ padding: 6 }}>{s.students?.name ?? '—'}</td>
              <td style={{ padding: 6 }}>
                {s.classes ? `${s.classes.academic_year} ${s.classes.grade_level}${s.classes.class_name}` : '—'}
              </td>
              <td style={{ padding: 6, textAlign: 'right' }}>{s.seat_no ?? '—'}</td>
              <td style={{ padding: 6 }}>{s.term}</td>
              <td style={{ padding: 6, fontSize: 12, color: '#666' }}>
                {(() => {
                  const summary = attendanceSummary[s.student_no];
                  if (!summary) return '—';
                  const parts = ATTENDANCE_ISSUE_STATUSES.map((st) => [st, summary[st] ?? 0] as const).filter(([, n]) => n > 0);
                  return parts.length > 0 ? parts.map(([st, n]) => `${st}${n}`).join('　') : '全勤';
                })()}
              </td>
              <td style={{ padding: 6, textAlign: 'right' }}>
                {canEdit(s) ? (
                  <button onClick={() => openEdit(s.student_no)} style={{ fontSize: 12, padding: '2px 8px' }}>
                    修正資料
                  </button>
                ) : (
                  <button onClick={() => showPhones(s)} style={{ fontSize: 12, padding: '2px 8px' }}>
                    聯絡電話
                  </button>
                )}
              </td>
            </tr>
          ))}
          {!loading && filtered.length === 0 && (
            <tr>
              <td colSpan={canBatchMove ? 8 : 7} style={{ padding: 12, textAlign: 'center', color: '#999' }}>
                查無資料
              </td>
            </tr>
          )}
        </tbody>
      </table>

      {phones && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50 }} onClick={() => setPhones(null)}>
          <div style={{ background: '#fff', borderRadius: 8, padding: 20, width: 360, maxWidth: '92vw' }} onClick={(e) => e.stopPropagation()}>
            <h2 style={{ fontSize: 15, margin: '0 0 8px' }}>{phones.name}　監護人聯絡電話</h2>
            {phones.rows === null && <p style={{ fontSize: 13, color: '#999' }}>讀取中…</p>}
            {phones.error && <p style={{ fontSize: 13, color: '#A32D2D' }}>讀取失敗：{phones.error}</p>}
            {phones.rows && phones.rows.length === 0 && !phones.error && <p style={{ fontSize: 13, color: '#999' }}>沒有登記監護人電話。</p>}
            {phones.rows?.map((g, i) => (
              <p key={i} style={{ fontSize: 14, margin: '4px 0' }}>
                {g.relation}　{g.name ?? ''}　<b>{g.phone ?? '—'}</b>
              </p>
            ))}
            <button onClick={() => setPhones(null)} style={{ marginTop: 10, padding: '4px 14px' }}>關閉</button>
          </div>
        </div>
      )}

      {editingStudentNo && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.35)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 50,
          }}
          onClick={closeEdit}
        >
          <div
            style={{ background: '#fff', borderRadius: 8, padding: 24, width: 480, maxHeight: '85vh', overflowY: 'auto' }}
            onClick={(e) => e.stopPropagation()}
          >
            <h2 style={{ fontSize: 15, marginBottom: 4 }}>修正學生資料（學號：{editingStudentNo}）</h2>

            {!editForm && !editError && <p style={{ fontSize: 13, color: '#999' }}>載入中…</p>}
            <ErrorBanner message={editError} />

            {editForm && (
              <form onSubmit={handleSaveEdit}>
                <p style={{ fontSize: 12, color: '#999', marginBottom: 12 }}>
                  {editForm.updated_at
                    ? `上次修改：${new Date(editForm.updated_at).toLocaleString('zh-TW')}${
                        editForm.updated_by ? '，修改者：' + (editorNames[editForm.updated_by] ?? editForm.updated_by) : ''
                      }`
                    : '目前還沒有修改紀錄'}
                </p>
                {EDIT_FIELDS.map(({ key, label }) => (
                  <div key={key} style={{ marginBottom: 8 }}>
                    <label style={{ fontSize: 12, color: '#666', display: 'block', marginBottom: 2 }}>{label}</label>
                    <input
                      type={key === 'dob' ? 'date' : 'text'}
                      value={(editForm[key] as string) ?? ''}
                      onChange={(e) => setEditForm({ ...editForm, [key]: e.target.value })}
                      style={{ width: '100%', padding: 6, boxSizing: 'border-box' }}
                    />
                  </div>
                ))}

                <div style={{ marginTop: 16, paddingTop: 12, borderTop: '1px solid #eee' }}>
                  <h3 style={{ fontSize: 13, marginBottom: 8 }}>家長／監護人資料</h3>
                  <p style={{ fontSize: 11, color: '#999', marginBottom: 8 }}>
                    家長查詢入口登入用的手機號碼就是這裡登記的電話（任一位監護人皆可）。
                  </p>
                  {guardiansLoading && <p style={{ fontSize: 12, color: '#999' }}>載入中…</p>}
                  {!guardiansLoading && guardianForms.length === 0 && (
                    <p style={{ fontSize: 12, color: '#A32D2D', marginBottom: 8 }}>尚未登記任何監護人資料。</p>
                  )}
                  {guardianForms.map((g, i) => (
                    <div
                      key={g.id ?? `new-${i}`}
                      style={{ border: '1px solid #eee', borderRadius: 6, padding: 10, marginBottom: 10 }}
                    >
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                        <label style={{ fontSize: 11, color: '#666' }}>
                          關係
                          <select
                            value={g.relation}
                            onChange={(e) => updateGuardianForm(i, { relation: e.target.value })}
                            style={{ width: '100%', padding: 6, marginTop: 2, boxSizing: 'border-box' }}
                          >
                            <option value="父親">父親</option>
                            <option value="母親">母親</option>
                            <option value="監護人">監護人</option>
                          </select>
                        </label>
                        <label style={{ fontSize: 11, color: '#666' }}>
                          姓名
                          <input
                            value={g.name}
                            onChange={(e) => updateGuardianForm(i, { name: e.target.value })}
                            style={{ width: '100%', padding: 6, marginTop: 2, boxSizing: 'border-box' }}
                          />
                        </label>
                        <label style={{ fontSize: 11, color: '#666' }}>
                          中文姓名
                          <input
                            value={g.chinese_name}
                            onChange={(e) => updateGuardianForm(i, { chinese_name: e.target.value })}
                            style={{ width: '100%', padding: 6, marginTop: 2, boxSizing: 'border-box' }}
                          />
                        </label>
                        <label style={{ fontSize: 11, color: '#666' }}>
                          職業
                          <input
                            value={g.occupation}
                            onChange={(e) => updateGuardianForm(i, { occupation: e.target.value })}
                            style={{ width: '100%', padding: 6, marginTop: 2, boxSizing: 'border-box' }}
                          />
                        </label>
                        <label style={{ fontSize: 11, color: '#666' }}>
                          聯絡電話
                          <input
                            value={g.phone}
                            onChange={(e) => updateGuardianForm(i, { phone: e.target.value })}
                            style={{ width: '100%', padding: 6, marginTop: 2, boxSizing: 'border-box' }}
                          />
                        </label>
                        <label style={{ fontSize: 11, color: '#666' }}>
                          信箱
                          <input
                            type="email"
                            value={g.email}
                            onChange={(e) => updateGuardianForm(i, { email: e.target.value })}
                            style={{ width: '100%', padding: 6, marginTop: 2, boxSizing: 'border-box' }}
                          />
                        </label>
                        <label style={{ fontSize: 11, color: '#666', gridColumn: '1 / -1' }}>
                          地址
                          <input
                            value={g.address}
                            onChange={(e) => updateGuardianForm(i, { address: e.target.value })}
                            style={{ width: '100%', padding: 6, marginTop: 2, boxSizing: 'border-box' }}
                          />
                        </label>
                      </div>
                      <button
                        type="button"
                        onClick={() => removeGuardianForm(i)}
                        style={{ fontSize: 11, color: '#A32D2D', background: 'none', border: 'none', padding: 0, marginTop: 8, cursor: 'pointer' }}
                      >
                        移除這位監護人
                      </button>
                    </div>
                  ))}
                  <button type="button" onClick={addGuardianForm} style={{ fontSize: 12, padding: '4px 10px' }}>
                    ＋ 新增一位監護人
                  </button>
                </div>

                <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
                  <button
                    type="submit"
                    disabled={saving}
                    style={{ flex: 1, padding: 10, background: '#2C2C2A', color: '#fff', border: 'none', borderRadius: 6 }}
                  >
                    {saving ? '儲存中…' : '儲存'}
                  </button>
                  <button
                    type="button"
                    onClick={closeEdit}
                    style={{ flex: 1, padding: 10, background: '#eee', border: 'none', borderRadius: 6 }}
                  >
                    取消
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
