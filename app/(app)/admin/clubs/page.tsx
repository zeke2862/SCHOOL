'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { resolveCurrentTerm } from '@/lib/academicTerm';
import { classSortKey, compareByClassThenSeat, hasCurrentEnrollment } from '@/lib/clubOrder';
import { useDepartmentPermissions } from '@/lib/useDepartmentPermissions';
import { hasDepartment } from '@/lib/departments';
import ClassClubListPrint from '@/components/rollbook/ClassClubListPrint';
import LocationPicker from '@/components/clubs/LocationPicker';
import { classLocationLabel } from '@/lib/clubOrder';

type Club = {
  id: string;
  name: string;
  academic_year: number;
  term: string;
  teacher_id: string | null;
  external_teacher_name: string | null;
  capacity: number | null;
  period_no: number | null;
  description: string | null;
  is_active: boolean;
};
type TeacherOption = { id: string; name: string };
type MemberRow = { id: string; student_no: string; status: string; name: string; class_label: string; seat_no: number | null; sort_key: number };
type SelectionWindow = {
  id: string;
  academic_year: number;
  term: string;
  method: '志願序_第一志願優先' | '志願序_隨機亂數' | '即時搶選';
  max_choices: number | null;
  opens_at: string;
  closes_at: string | null;
  is_finalized: boolean;
  finalized_at: string | null;
};

const METHOD_LABELS: Record<SelectionWindow['method'], string> = {
  志願序_第一志願優先: '志願序抽籤（第一志願優先法）',
  志願序_隨機亂數: '志願序抽籤（隨機亂數法）',
  即時搶選: '即時搶選（先搶先贏）',
};

function toLocalInputValue(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// 依開學日算出選社時間：開學日當天 07:00 開放，開學後第 7 天 17:00 截止（教務處可再手動微調）
function windowFromStart(startDate: string): { opens_at: string; closes_at: string } {
  const [y, m, d] = startDate.split('-').map(Number);
  const pad = (n: number) => String(n).padStart(2, '0');
  const fmt = (dt: Date, hh: number) => `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}T${pad(hh)}:00`;
  const open = new Date(y, m - 1, d);
  const close = new Date(y, m - 1, d + 7);
  return { opens_at: fmt(open, 7), closes_at: fmt(close, 17) };
}

// 社團／才藝課管理（教務處後台）：建立社團＋手動指派名單，加上依原始需求文件實作的
// 「選社設定」（志願序電腦抽籤兩種邏輯／即時搶選），詳見 sql/54clubs_module.sql 開頭說明。
export default function AdminClubsPage() {
  const perms = useDepartmentPermissions();
  // 教務處承辦人（不限主管）都能看到並管理所有社團，資料庫端 admin_manage_clubs 本來就放行教務部門
  const canManage = perms.isSystemAdmin || hasDepartment(perms.myDepartments, 'academic');

  const [clubs, setClubs] = useState<Club[]>([]);
  const [teachers, setTeachers] = useState<TeacherOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedClubId, setSelectedClubId] = useState<string>('');
  const [term, setTerm] = useState<{ academic_year: number; term: string } | null>(null);

  const [form, setForm] = useState({
    name: '',
    teacher_id: '',
    external_teacher_name: '',
    capacity: '',
    period_no: '',
    location: '',
    description: '',
  });
  // 授課位置：可選班級教室，或選「其它」自行輸入。欄位由 sql/147 新增，
  // 還沒執行前讀不到，就當作都沒設定，不影響其他功能。
  const [locationOptions, setLocationOptions] = useState<string[]>([]);
  const [locationByClub, setLocationByClub] = useState<Record<string, string>>({});
  const [locDraft, setLocDraft] = useState('');
  const [locationMsg, setLocationMsg] = useState<string | null>(null);

  const [members, setMembers] = useState<MemberRow[]>([]);
  const [newStudentNo, setNewStudentNo] = useState('');
  const [memberError, setMemberError] = useState<string | null>(null);

  const [selectionWindow, setSelectionWindow] = useState<SelectionWindow | null>(null);
  const [windowForm, setWindowForm] = useState<{ method: SelectionWindow['method']; max_choices: string; opens_at: string; closes_at: string }>({
    method: '志願序_第一志願優先',
    max_choices: '5',
    opens_at: '',
    closes_at: '',
  });
  const [windowMsg, setWindowMsg] = useState<string | null>(null);
  const [runningLottery, setRunningLottery] = useState(false);
  const [termStart, setTermStart] = useState<string | null>(null);
  const [hiddenMembers, setHiddenMembers] = useState(0);
  const [printClasses, setPrintClasses] = useState<{ auto: boolean } | null>(null);

  useEffect(() => {
    (async () => {
      const t = await resolveCurrentTerm();
      if (!t) {
        setError('尚未設定目前生效的學年學期，請先到「學年學期中央管理主檔」設定。');
        setLoading(false);
        return;
      }
      setTerm(t);
      const [{ data: clubRows, error: clubErr }, { data: teacherRows }, { data: windowRow }] = await Promise.all([
        supabase
          .from('clubs')
          .select('id, name, academic_year, term, teacher_id, external_teacher_name, capacity, period_no, description, is_active')
          .eq('academic_year', t.academic_year)
          .eq('term', t.term)
          .order('name'),
        supabase.from('teachers').select('id, name').order('name'),
        supabase.from('club_selection_windows').select('*').eq('academic_year', t.academic_year).eq('term', t.term).maybeSingle(),
      ]);
      if (clubErr) {
        setError('讀取社團清單失敗：' + clubErr.message);
      } else {
        setClubs((clubRows ?? []) as Club[]);
      }
      setTeachers((teacherRows ?? []) as TeacherOption[]);
      const { data: clsRows } = await supabase.from('classes').select('id, department, grade_level, class_name').eq('academic_year', t.academic_year);
      setLocationOptions(
        Array.from(new Set((clsRows ?? []).sort((a: any, b: any) => classSortKey(a.department, a.grade_level, a.class_name) - classSortKey(b.department, b.grade_level, b.class_name)).map((c: any) => classLocationLabel(c))))
      );
      const { data: locRows, error: locErr } = await supabase.from('clubs').select('id, location').eq('academic_year', t.academic_year).eq('term', t.term);
      if (!locErr) setLocationByClub(Object.fromEntries((locRows ?? []).map((r: any) => [r.id, r.location ?? ''])));
      // 本學期開學日：選社時間依它帶入（上、下學期各自一筆設定，換學期後這裡就會跟著新學期的開學日）
      const { data: termRow } = await supabase.from('academic_terms').select('term_start_date').eq('academic_year', t.academic_year).eq('term', t.term).maybeSingle();
      const start: string | null = termRow?.term_start_date ?? null;
      setTermStart(start);
      if (!windowRow && start) {
        setWindowForm((f) => ({ ...f, ...windowFromStart(start) }));
      }
      if (windowRow) {
        setSelectionWindow(windowRow as SelectionWindow);
        setWindowForm({
          method: windowRow.method,
          max_choices: windowRow.max_choices ? String(windowRow.max_choices) : '5',
          opens_at: toLocalInputValue(windowRow.opens_at),
          closes_at: toLocalInputValue(windowRow.closes_at),
        });
      }
      setLoading(false);
    })();
  }, []);

  async function loadMembers(clubId: string) {
    setMemberError(null);
    const { data: memberRows, error: memberErr } = await supabase
      .from('club_members')
      .select('id, student_no, status, students(name, enrollments(seat_no, term, is_current, classes(department, grade_level, class_name, academic_year)))')
      .eq('club_id', clubId)
      .order('student_no');
    if (memberErr) {
      setMemberError('讀取社團名單失敗：' + memberErr.message);
      return;
    }
    const activeRows = (memberRows ?? []).filter((r: any) => hasCurrentEnrollment(r.students?.enrollments, term));
    setHiddenMembers((memberRows ?? []).length - activeRows.length);
    const rows: MemberRow[] = activeRows.map((r: any) => {
      // club_members 和 enrollments 之間沒有直接外鍵，所以從 students 底下展開 enrollments
      const raw = r.students?.enrollments;
      const enrollmentList = Array.isArray(raw) ? raw : raw ? [raw] : [];
      const currentEnrollment = term
        ? enrollmentList.find((e: any) => e?.is_current && e?.term === term.term && e?.classes?.academic_year === term.academic_year) ??
          enrollmentList.find((e: any) => e?.term === term.term && e?.classes?.academic_year === term.academic_year) ??
          null
        : enrollmentList.find((e: any) => e?.is_current) ?? enrollmentList[0] ?? null;
      return {
        id: r.id,
        student_no: r.student_no,
        status: r.status,
        name: r.students?.name ?? r.student_no,
        sort_key: classSortKey(currentEnrollment?.classes?.department, currentEnrollment?.classes?.grade_level, currentEnrollment?.classes?.class_name),
        class_label: currentEnrollment ? `${currentEnrollment.classes?.grade_level ?? ''}${currentEnrollment.classes?.class_name ?? ''}` : '（查無現行學籍）',
        seat_no: currentEnrollment?.seat_no ?? null,
      };
    });
    rows.sort((a, b) => (a.status === b.status ? 0 : a.status === '在社' ? -1 : 1) || compareByClassThenSeat(a, b));
    setMembers(rows);
  }

  useEffect(() => {
    if (selectedClubId) loadMembers(selectedClubId);
    else setMembers([]);
  }, [selectedClubId]);

  async function createClub() {
    setError(null);
    if (!form.name.trim()) {
      setError('請輸入社團名稱');
      return;
    }
    if (!term) {
      setError('尚未設定目前生效的學年學期');
      return;
    }
    const { data, error: insErr } = await supabase
      .from('clubs')
      .insert({
        name: form.name.trim(),
        academic_year: term.academic_year,
        term: term.term,
        teacher_id: form.teacher_id || null,
        external_teacher_name: form.external_teacher_name.trim() || null,
        capacity: form.capacity ? Number(form.capacity) : null,
        period_no: form.period_no ? Number(form.period_no) : null,
        description: form.description.trim() || null,
        ...(form.location.trim() ? { location: form.location.trim() } : {}),
      })
      .select()
      .single();
    if (insErr) {
      setError('建立社團失敗：' + insErr.message + '（同一學期社團名稱不能重複）');
      return;
    }
    setClubs((prev) => [...prev, data as Club].sort((a, b) => a.name.localeCompare(b.name)));
    if (form.location.trim()) setLocationByClub((prev) => ({ ...prev, [(data as Club).id]: form.location.trim() }));
    setForm({ name: '', teacher_id: '', external_teacher_name: '', capacity: '', period_no: '', location: '', description: '' });
  }

  async function saveLocation(clubId: string, value: string) {
    setLocationMsg(null);
    const v = value.trim();
    const { error: updErr } = await supabase.from('clubs').update({ location: v || null }).eq('id', clubId);
    if (updErr) {
      setLocationMsg('儲存授課位置失敗：' + updErr.message + '（若提示欄位不存在，請先執行 sql/147_club_location.sql）');
      return;
    }
    setLocationByClub((prev) => ({ ...prev, [clubId]: v }));
    setLocationMsg('授課位置已儲存');
  }

  // 選了別的社團，授課位置的編輯草稿跟著換成該社團目前的值
  useEffect(() => {
    setLocDraft(selectedClubId ? locationByClub[selectedClubId] ?? '' : '');
    setLocationMsg(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedClubId]);

  async function addMember() {
    if (!selectedClubId || !newStudentNo.trim()) return;
    setMemberError(null);
    const studentNo = newStudentNo.trim();

    const { data: studentRow } = await supabase.from('students').select('student_no').eq('student_no', studentNo).maybeSingle();
    if (!studentRow) {
      setMemberError(`查無學號 ${studentNo} 的學生資料，請確認學號是否正確`);
      return;
    }
    const club = clubs.find((c) => c.id === selectedClubId);
    if (club?.capacity != null) {
      const activeCount = members.filter((m) => m.status === '在社').length;
      if (activeCount >= club.capacity) {
        setMemberError(`「${club.name}」目前在社人數已達名額上限（${club.capacity} 人），如需超收請先調整名額設定`);
        return;
      }
    }
    const { error: insErr } = await supabase.from('club_members').insert({ club_id: selectedClubId, student_no: studentNo });
    if (insErr) {
      setMemberError(
        insErr.message.includes('一人只能參加一個社團')
          ? insErr.message
          : '加入名單失敗：' + insErr.message + '（可能這位學生已經在名單裡了）'
      );
      return;
    }
    setNewStudentNo('');
    loadMembers(selectedClubId);
  }

  async function toggleMemberStatus(member: MemberRow) {
    const nextStatus = member.status === '在社' ? '退社' : '在社';
    const { error: updErr } = await supabase.from('club_members').update({ status: nextStatus }).eq('id', member.id);
    if (updErr) {
      setMemberError('更新失敗：' + updErr.message);
      return;
    }
    loadMembers(selectedClubId);
  }

  async function saveSelectionWindow() {
    setWindowMsg(null);
    if (!term) return;
    if (!windowForm.opens_at) {
      setWindowMsg('請設定開放時間');
      return;
    }
    const payload = {
      academic_year: term.academic_year,
      term: term.term,
      method: windowForm.method,
      max_choices: windowForm.method === '即時搶選' ? null : windowForm.max_choices ? Number(windowForm.max_choices) : null,
      opens_at: new Date(windowForm.opens_at).toISOString(),
      closes_at: windowForm.closes_at ? new Date(windowForm.closes_at).toISOString() : null,
    };
    const { data, error: upsertErr } = await supabase.from('club_selection_windows').upsert(payload, { onConflict: 'academic_year,term' }).select().single();
    if (upsertErr) {
      setWindowMsg('儲存失敗：' + upsertErr.message);
      return;
    }
    setSelectionWindow(data as SelectionWindow);
    setWindowMsg('選社設定已儲存');
  }

  async function runLottery() {
    if (!term || !selectionWindow) return;
    if (!confirm('執行電腦抽籤會清空目前所有社團名單，改用學生填的志願序重新分發一次，確定要執行嗎？')) return;
    setRunningLottery(true);
    setWindowMsg(null);
    const fn = selectionWindow.method === '志願序_第一志願優先' ? 'run_club_lottery_priority' : 'run_club_lottery_random_number';
    const { error: rpcErr } = await supabase.rpc(fn, { p_academic_year: term.academic_year, p_term: term.term });
    if (rpcErr) {
      setWindowMsg('抽籤執行失敗：' + rpcErr.message);
    } else {
      setWindowMsg('電腦抽籤已完成，社團名單已依志願序重新分發');
      setSelectionWindow({ ...selectionWindow, is_finalized: true, finalized_at: new Date().toISOString() });
      const { data: clubRows } = await supabase
        .from('clubs')
        .select('id, name, academic_year, term, teacher_id, external_teacher_name, capacity, period_no, description, is_active')
        .eq('academic_year', term.academic_year)
        .eq('term', term.term)
        .order('name');
      setClubs((clubRows ?? []) as Club[]);
      if (selectedClubId) loadMembers(selectedClubId);
    }
    setRunningLottery(false);
  }

  if (loading) return <main style={{ padding: 24 }}>載入中…</main>;

  if (!canManage) {
    return (
      <main style={{ maxWidth: 720, margin: '0 auto', padding: 24 }}>
        <h1 style={{ fontSize: 16 }}>社團／才藝課管理</h1>
        <p style={{ fontSize: 13, color: 'var(--sub)' }}>此頁僅開放教務部門主管或系統管理員操作。</p>
      </main>
    );
  }

  if (printClasses && term) {
    return <ClassClubListPrint term={term} autoPrint={printClasses.auto} onClose={() => setPrintClasses(null)} />;
  }

  // 已存在的設定若開放時間早於本學期開學日，多半是沿用上學期的舊設定，提醒教務處更新
  const windowStale = !!(termStart && selectionWindow && new Date(selectionWindow.opens_at) < new Date(`${termStart}T00:00:00`));

  return (
    <main style={{ maxWidth: 960, margin: '0 auto', padding: 24 }}>
      <h1 style={{ fontSize: 16, marginBottom: 4 }}>社團／才藝課管理</h1>
      <p style={{ fontSize: 12, color: 'var(--sub)', marginBottom: 16 }}>
        建立社團、指派指導老師、設定選社方式。學生選好社／電腦抽籤分發完成後，社團老師可到「社團點名冊」「社團成績輸入」操作自己社團的學生。
      </p>
      {error && <p style={{ fontSize: 13, color: '#A32D2D', marginBottom: 12 }}>{error}</p>}

      <section style={{ border: '1px solid var(--line)', borderRadius: 8, padding: 16, marginBottom: 24 }}>
        <h2 style={{ fontSize: 14, marginBottom: 12 }}>新增社團</h2>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
          <label style={{ fontSize: 12 }}>
            社團名稱
            <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} style={{ width: '100%', padding: 6, marginTop: 4 }} placeholder="例如：吉他社" />
          </label>
          <label style={{ fontSize: 12 }}>
            名額上限（選填）
            <input value={form.capacity} onChange={(e) => setForm({ ...form, capacity: e.target.value })} style={{ width: '100%', padding: 6, marginTop: 4 }} placeholder="不填代表不限" />
          </label>
          <label style={{ fontSize: 12 }}>
            指導老師（校內教師）
            <select value={form.teacher_id} onChange={(e) => setForm({ ...form, teacher_id: e.target.value })} style={{ width: '100%', padding: 6, marginTop: 4 }}>
              <option value="">（未指派／外聘老師）</option>
              {teachers.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </label>
          <label style={{ fontSize: 12 }}>
            外聘老師姓名（若無校內帳號）
            <input value={form.external_teacher_name} onChange={(e) => setForm({ ...form, external_teacher_name: e.target.value })} style={{ width: '100%', padding: 6, marginTop: 4 }} placeholder="僅作紀錄，尚未支援外聘登入" />
          </label>
          <label style={{ fontSize: 12 }}>
            固定上課節次（選填）
            <input
              value={form.period_no}
              onChange={(e) => setForm({ ...form, period_no: e.target.value })}
              style={{ width: '100%', padding: 6, marginTop: 4 }}
              placeholder="例如：8（第8節）；有填才會同步進全校出缺席總表"
            />
          </label>
          <label style={{ fontSize: 12 }}>
            授課位置（選班級教室，或選「其它」自行輸入）
            <div style={{ marginTop: 4 }}>
              <LocationPicker value={form.location} options={locationOptions} onChange={(v) => setForm({ ...form, location: v })} />
            </div>
          </label>
        </div>
        <label style={{ fontSize: 12, display: 'block', marginBottom: 12 }}>
          社團簡介（選填）
          <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} style={{ width: '100%', padding: 6, marginTop: 4 }} rows={2} />
        </label>
        <button onClick={createClub} style={{ padding: '8px 16px' }}>
          建立社團
        </button>
      </section>

      <section style={{ border: '1px solid var(--line)', borderRadius: 8, padding: 16, marginBottom: 24 }}>
        <h2 style={{ fontSize: 14, marginBottom: 4 }}>選社設定</h2>
        <p style={{ fontSize: 12, color: 'var(--sub)', marginBottom: 12 }}>
          設定這學期用哪一種方式決定學生進哪個社團。志願序類方法設定好開放時間後，學生會在「家長/學生查詢入口」看到選社頁面填志願，
          教務處確認截止後再回來這裡按「執行電腦抽籤」；即時搶選則是學生自己在開放時間內登入搶名額，不用另外按抽籤。
        </p>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
          <label style={{ fontSize: 12 }}>
            選社方式
            <select
              value={windowForm.method}
              onChange={(e) => setWindowForm({ ...windowForm, method: e.target.value as SelectionWindow['method'] })}
              style={{ width: '100%', padding: 6, marginTop: 4 }}
            >
              {Object.entries(METHOD_LABELS).map(([k, label]) => (
                <option key={k} value={k}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          {windowForm.method !== '即時搶選' && (
            <label style={{ fontSize: 12 }}>
              最多可填幾個志願
              <input value={windowForm.max_choices} onChange={(e) => setWindowForm({ ...windowForm, max_choices: e.target.value })} style={{ width: '100%', padding: 6, marginTop: 4 }} />
            </label>
          )}
          <label style={{ fontSize: 12 }}>
            開放時間
            <input type="datetime-local" value={windowForm.opens_at} onChange={(e) => setWindowForm({ ...windowForm, opens_at: e.target.value })} style={{ width: '100%', padding: 6, marginTop: 4 }} />
          </label>
          <label style={{ fontSize: 12 }}>
            截止時間（選填，留空＝不設限）
            <input type="datetime-local" value={windowForm.closes_at} onChange={(e) => setWindowForm({ ...windowForm, closes_at: e.target.value })} style={{ width: '100%', padding: 6, marginTop: 4 }} />
          </label>
        </div>
        <p style={{ fontSize: 12, color: 'var(--sub)', marginBottom: 8 }}>
          {term?.academic_year} 學年 {term?.term}　開學日：{termStart ?? '尚未設定（請到學年學期管理填寫）'}。上學期、下學期各有自己的一筆選社設定，換學期後請再設定一次。
        </p>
        {windowStale && (
          <p style={{ fontSize: 12, color: '#B26A00', marginBottom: 8 }}>
            目前儲存的開放時間（{new Date(selectionWindow!.opens_at).toLocaleString('zh-TW')}）早於本學期開學日，可能是沿用舊學期的設定，建議按「依開學日帶入時間」後再儲存。
          </p>
        )}
        {windowMsg && <p style={{ fontSize: 13, color: windowMsg.includes('失敗') ? '#A32D2D' : '#2D7A3A', marginBottom: 12 }}>{windowMsg}</p>}
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <button onClick={() => termStart && setWindowForm({ ...windowForm, ...windowFromStart(termStart) })} disabled={!termStart} style={{ padding: '8px 16px' }} title="開學日 07:00 開放，開學後第 7 天 17:00 截止">
            依開學日帶入時間
          </button>
          <button onClick={saveSelectionWindow} style={{ padding: '8px 16px' }}>
            儲存選社設定
          </button>
          {selectionWindow && selectionWindow.method !== '即時搶選' && (
            <button onClick={runLottery} disabled={runningLottery} style={{ padding: '8px 16px', fontWeight: 600 }}>
              {runningLottery ? '執行中…' : '執行電腦抽籤'}
            </button>
          )}
        </div>
        {selectionWindow?.is_finalized && (
          <p style={{ fontSize: 12, color: 'var(--sub)', marginTop: 8 }}>
            已於 {selectionWindow.finalized_at ? new Date(selectionWindow.finalized_at).toLocaleString('zh-TW') : ''} 執行過抽籤，各社團名單可到下方「社團名單管理」查看與微調。
          </p>
        )}
      </section>

      <section style={{ border: '1px solid var(--line)', borderRadius: 8, padding: 16, marginBottom: 24 }}>
        <h2 style={{ fontSize: 14, marginBottom: 4 }}>列印各班社團名單</h2>
        <p style={{ fontSize: 12, color: 'var(--sub)', marginBottom: 12 }}>
          每班一張 A4，列出全班學生（依座號）參加的社團與指導老師，可交給導師核對。可先選部別／班級，或直接一鍵列印全校所有班級。
        </p>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <button onClick={() => setPrintClasses({ auto: true })} style={{ padding: '8px 16px', fontWeight: 600 }}>
            一鍵列印全部班級
          </button>
          <button onClick={() => setPrintClasses({ auto: false })} style={{ padding: '8px 16px' }}>
            選擇班級後列印
          </button>
        </div>
      </section>

      <section style={{ border: '1px solid var(--line)', borderRadius: 8, padding: 16 }}>
        <h2 style={{ fontSize: 14, marginBottom: 12 }}>社團名單管理</h2>
        <select value={selectedClubId} onChange={(e) => setSelectedClubId(e.target.value)} style={{ padding: 8, marginBottom: 16, width: '100%', maxWidth: 320 }}>
          <option value="">請選擇社團</option>
          {clubs.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
              {c.teacher_id ? ` － ${teachers.find((t) => t.id === c.teacher_id)?.name ?? ''}` : c.external_teacher_name ? ` － ${c.external_teacher_name}（外聘）` : ' － 尚未指派老師'}
            </option>
          ))}
        </select>

        {selectedClubId && (
          <>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 12, fontSize: 12 }}>
              <span>授課位置：</span>
              <span key={selectedClubId} style={{ display: 'inline-block', minWidth: 200 }}>
                <LocationPicker value={locDraft} options={locationOptions} onChange={setLocDraft} />
              </span>
              <button onClick={() => saveLocation(selectedClubId, locDraft)} style={{ padding: '6px 14px' }}>
                儲存
              </button>
              {locationMsg && <span style={{ color: locationMsg.includes('失敗') ? '#A32D2D' : '#2D7A3A' }}>{locationMsg}</span>}
            </div>
            {memberError && <p style={{ fontSize: 13, color: '#A32D2D', marginBottom: 12 }}>{memberError}</p>}
            {hiddenMembers > 0 && (
              <p style={{ fontSize: 12, color: 'var(--sub)', marginBottom: 8 }}>
                另有 {hiddenMembers} 位休學／退學（無現行學籍）的學生未列入名單，復學後會自動回來。
              </p>
            )}
            <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
              <input value={newStudentNo} onChange={(e) => setNewStudentNo(e.target.value)} placeholder="輸入學號加入社團" style={{ padding: 6, flex: 1, maxWidth: 240 }} />
              <button onClick={addMember} style={{ padding: '6px 16px' }}>
                加入
              </button>
            </div>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr>
                  <th style={{ textAlign: 'left', padding: 6 }}>學號</th>
                  <th style={{ textAlign: 'left', padding: 6 }}>原班級</th>
                  <th style={{ textAlign: 'left', padding: 6 }}>原座號</th>
                  <th style={{ textAlign: 'left', padding: 6 }}>姓名</th>
                  <th style={{ textAlign: 'left', padding: 6 }}>狀態</th>
                  <th style={{ padding: 6 }}></th>
                </tr>
              </thead>
              <tbody>
                {members.map((m) => (
                  <tr key={m.id} style={{ borderTop: '1px solid var(--line)' }}>
                    <td style={{ padding: 6 }}>{m.student_no}</td>
                    <td style={{ padding: 6 }}>{m.class_label}</td>
                    <td style={{ padding: 6 }}>{m.seat_no ?? '－'}</td>
                    <td style={{ padding: 6 }}>{m.name}</td>
                    <td style={{ padding: 6 }}>{m.status}</td>
                    <td style={{ padding: 6 }}>
                      <button onClick={() => toggleMemberStatus(m)} style={{ padding: '2px 10px', fontSize: 12 }}>
                        {m.status === '在社' ? '設為退社' : '恢復在社'}
                      </button>
                    </td>
                  </tr>
                ))}
                {members.length === 0 && (
                  <tr>
                    <td colSpan={6} style={{ padding: 12, textAlign: 'center', color: 'var(--sub)' }}>
                      目前還沒有學生加入這個社團
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </>
        )}
      </section>
    </main>
  );
}
