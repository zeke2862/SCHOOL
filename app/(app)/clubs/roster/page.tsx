'use client';

import { useEffect, useState } from 'react';
import { supabase, getCurrentTeacherId } from '@/lib/supabaseClient';
import { useIsMobile } from '@/lib/useIsMobile';
import { resolveCurrentTerm } from '@/lib/academicTerm';
import { classSortKey, compareByClassThenSeat, hasCurrentEnrollment } from '@/lib/clubOrder';
import { canSeeAllClubs } from '@/lib/clubAccess';
import ClubRollBookPrint from '@/components/rollbook/ClubRollBookPrint';

type ClubOption = { id: string; name: string; teacher_name?: string; location?: string };
type MemberRow = { student_no: string; name: string; class_label: string; seat_no: number | null; sort_key: number };

const EXCEPTION_OPTIONS = ['曠課', '遲到', '病假', '事假', '公假'] as const;

function todayStr() {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// 才藝社團固定在星期六第五節上課，其他日期不開放點名，避免出缺勤記到錯的日子
const CLUB_WEEKDAY = 6;
function isClubDay(dateStr: string) {
  return new Date(`${dateStr}T00:00:00`).getDay() === CLUB_WEEKDAY;
}
function lastClubDay(dateStr: string) {
  const d = new Date(`${dateStr}T00:00:00`);
  d.setDate(d.getDate() - ((d.getDay() - CLUB_WEEKDAY + 7) % 7));
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// 社團點名冊：社團老師登入後只看得到自己指導的社團（跨班級/科系的學生名單），
// 依規格書 2.1，橫向顯示【學號】【原班級】【原座號】【姓名】，逐日點名。
export default function ClubRosterPage() {
  const isMobile = useIsMobile();
  const [clubs, setClubs] = useState<ClubOption[]>([]);
  const [selectedClubId, setSelectedClubId] = useState('');
  const [members, setMembers] = useState<MemberRow[]>([]);
  const [recordDate, setRecordDate] = useState(todayStr());
  const [statusMap, setStatusMap] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);
  const [noAssignment, setNoAssignment] = useState(false);
  const [summary, setSummary] = useState<{ date: string; total: number; absent: (MemberRow & { status: string })[] } | null>(null);
  const [term, setTerm] = useState<{ academic_year: number; term: string } | null>(null);
  const [printing, setPrinting] = useState(false);
  const [teacherName, setTeacherName] = useState('');

  useEffect(() => {
    (async () => {
      const teacherId = await getCurrentTeacherId();
      const seeAll = await canSeeAllClubs();
      if (!teacherId && !seeAll) {
        setNoAssignment(true);
        setLoading(false);
        return;
      }
      const t = await resolveCurrentTerm();
      setTerm(t);
      if (teacherId) {
        const { data: tn } = await supabase.from('teachers').select('name').eq('id', teacherId).maybeSingle();
        setTeacherName(tn?.name ?? '');
      }
      // 教務處人員看得到全部社團；其他老師只看自己指導的
      // 指導老師姓名分開查（內嵌關聯在這個資料庫上不穩定，會讀成空白）
      let q = supabase.from('clubs').select('id, name, teacher_id, external_teacher_name').eq('is_active', true);
      if (!seeAll) q = q.eq('teacher_id', teacherId as string);
      if (t) q = q.eq('academic_year', t.academic_year).eq('term', t.term);
      const { data, error: clubErr } = await q.order('name');
      if (clubErr) {
        setError('讀取社團資料失敗：' + clubErr.message);
        setLoading(false);
        return;
      }
      if (!data || data.length === 0) {
        setNoAssignment(true);
        setLoading(false);
        return;
      }
      // 授課位置（sql/147 新增的欄位）：分開查、查不到就當作沒設定，不影響點名冊本身
      const locByClub: Record<string, string> = {};
      const ids = (data as any[]).map((c) => c.id);
      const { data: locRows, error: locErr } = await supabase.from('clubs').select('id, location').in('id', ids);
      if (!locErr) (locRows ?? []).forEach((r: any) => r.location && (locByClub[r.id] = r.location));
      const teacherIds = Array.from(new Set((data as any[]).map((c) => c.teacher_id).filter(Boolean)));
      const teacherNameById = new Map<string, string>();
      if (teacherIds.length > 0) {
        const { data: tRows } = await supabase.from('teachers').select('id, name').in('id', teacherIds);
        (tRows ?? []).forEach((r: any) => teacherNameById.set(r.id, r.name));
      }
      setClubs(
        (data as any[]).map((c) => ({
          id: c.id,
          name: c.name,
          teacher_name: (c.teacher_id ? teacherNameById.get(c.teacher_id) : '') || c.external_teacher_name || '',
          // 沒有另外設定授課位置時，沿用社團名稱「-」後面的字（例如「弟子規-三孝」→「三孝」、「舞蹈-活動中心」→「活動中心」）
          location: locByClub[c.id] || (/-([^-]+)$/.exec(c.name)?.[1] ?? ''),
        }))
      );
      setSelectedClubId(data[0].id);
      setLoading(false);
    })();
  }, []);

  async function loadMembersAndAttendance(clubId: string, date: string) {
    setLoading(true);
    setError(null);
    setSaveMsg(null);
    const { data: memberRows, error: memberErr } = await supabase
      .from('club_members')
      .select('student_no, status, students(name, enrollments(seat_no, term, is_current, classes(department, grade_level, class_name, academic_year)))')
      .eq('club_id', clubId)
      .eq('status', '在社');
    if (memberErr) {
      setError('讀取社團名單失敗：' + memberErr.message);
      setLoading(false);
      return;
    }
    const rows: MemberRow[] = (memberRows ?? []).filter((r: any) => hasCurrentEnrollment(r.students?.enrollments, term)).map((r: any) => {
      // club_members 和 enrollments 之間沒有直接外鍵，所以從 students 底下展開 enrollments
      const raw = r.students?.enrollments;
      const enrollmentList = Array.isArray(raw) ? raw : raw ? [raw] : [];
      const currentEnrollment = term
        ? enrollmentList.find((e: any) => e?.is_current && e?.term === term.term && e?.classes?.academic_year === term.academic_year) ??
          enrollmentList.find((e: any) => e?.term === term.term && e?.classes?.academic_year === term.academic_year) ??
          null
        : enrollmentList.find((e: any) => e?.is_current) ?? enrollmentList[0] ?? null;
      return {
        student_no: r.student_no,
        name: r.students?.name ?? r.student_no,
        sort_key: classSortKey(currentEnrollment?.classes?.department, currentEnrollment?.classes?.grade_level, currentEnrollment?.classes?.class_name),
        class_label: currentEnrollment ? `${currentEnrollment.classes?.grade_level ?? ''}${currentEnrollment.classes?.class_name ?? ''}` : '－',
        seat_no: currentEnrollment?.seat_no ?? null,
      };
    });
    rows.sort((a, b) => compareByClassThenSeat(a, b));
    setMembers(rows);

    const studentNos = rows.map((r) => r.student_no);
    const { data: attRows } = await supabase
      .from('club_attendance')
      .select('student_no, status')
      .eq('club_id', clubId)
      .eq('record_date', date)
      .in('student_no', studentNos.length > 0 ? studentNos : ['__none__']);
    const map: Record<string, string> = {};
    rows.forEach((r) => (map[r.student_no] = '出席')); // 預設出席，符合規格書「出席（預設）」
    (attRows ?? []).forEach((r: any) => (map[r.student_no] = r.status));
    setStatusMap(map);
    setLoading(false);
  }

  useEffect(() => {
    if (selectedClubId) loadMembersAndAttendance(selectedClubId, recordDate);
  }, [selectedClubId, recordDate]);

  async function saveAttendance() {
    setSaving(true);
    setError(null);
    setSaveMsg(null);
    const teacherId = await getCurrentTeacherId();
    const rowsToUpsert = members.map((m) => ({
      club_id: selectedClubId,
      student_no: m.student_no,
      record_date: recordDate,
      status: statusMap[m.student_no] ?? '出席',
      recorded_by: teacherId,
    }));
    const { error: upsertErr } = await supabase.from('club_attendance').upsert(rowsToUpsert, { onConflict: 'club_id,student_no,record_date' });
    if (upsertErr) {
      setError('點名紀錄儲存失敗：' + upsertErr.message);
    } else {
      setSaveMsg(`已儲存 ${recordDate} 的點名紀錄（共 ${rowsToUpsert.length} 位學生）`);
      // 儲存成功後跳出確認視窗，讓老師看清楚誰沒有出席
      setSummary({
        date: recordDate,
        total: rowsToUpsert.length,
        absent: members
          .filter((m) => (statusMap[m.student_no] ?? '出席') !== '出席')
          .map((m) => ({ ...m, status: statusMap[m.student_no] })),
      });
    }
    setSaving(false);
  }

  if (noAssignment) {
    return (
      <main style={{ maxWidth: 720, margin: '0 auto', padding: 24 }}>
        <h1 style={{ fontSize: 16 }}>社團點名冊</h1>
        <p style={{ fontSize: 13, color: 'var(--sub)' }}>目前沒有指派給您的社團，如有需要請洽教務處。</p>
      </main>
    );
  }

  if (printing) {
    return (
      <ClubRollBookPrint
        clubName={clubs.find((c) => c.id === selectedClubId)?.name ?? ''}
        teacherName={clubs.find((c) => c.id === selectedClubId)?.teacher_name || teacherName}
        location={clubs.find((c) => c.id === selectedClubId)?.location}
        term={term}
        members={members}
        onClose={() => setPrinting(false)}
      />
    );
  }

  return (
    <main style={{ maxWidth: 800, margin: '0 auto', padding: isMobile ? '16px 12px' : 24 }}>
      <h1 style={{ fontSize: isMobile ? 18 : 16, marginBottom: 4 }}>社團點名冊</h1>
      <p style={{ fontSize: 12, color: 'var(--sub)', marginBottom: 16 }}>選擇社團與日期後，逐位學生點選出缺勤狀態，最後按「儲存點名」送出。</p>

      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
        {clubs.length > 1 && (
          <select value={selectedClubId} onChange={(e) => setSelectedClubId(e.target.value)} style={{ padding: 8 }}>
            {clubs.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        )}
        <input type="date" value={recordDate} onChange={(e) => setRecordDate(e.target.value)} style={{ padding: 8 }} />
        <button onClick={() => setPrinting(true)} disabled={loading || members.length === 0} style={{ padding: '8px 16px' }}>
          列印點名冊
        </button>
      </div>

      {error && <p style={{ fontSize: 13, color: '#A32D2D', marginBottom: 12 }}>{error}</p>}
      {saveMsg && <p style={{ fontSize: 13, color: '#2D7A3A', marginBottom: 12 }}>{saveMsg}</p>}

      {!isClubDay(recordDate) ? (
        <div style={{ fontSize: 13, color: '#A36A2D', background: '#FFF7EC', border: '1px solid #F0DCB8', borderRadius: 8, padding: '12px 14px' }}>
          <p style={{ marginBottom: 8 }}>{recordDate} 不是社團上課日（星期六第五節），不開放點名。</p>
          <button onClick={() => setRecordDate(lastClubDay(recordDate))} style={{ padding: '6px 14px' }}>
            跳到最近的星期六（{lastClubDay(recordDate)}）
          </button>
        </div>
      ) : loading ? (
        <p style={{ fontSize: 13, color: 'var(--sub)' }}>載入中…</p>
      ) : (
        <>
          <p style={{ fontSize: 13, color: 'var(--sub)', marginBottom: 6 }}>在社共 {members.length} 人</p>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, marginBottom: 16 }}>
            <thead>
              <tr>
                <th style={{ textAlign: 'left', padding: 6 }}>序號</th>
                <th style={{ textAlign: 'left', padding: 6 }}>學號</th>
                <th style={{ textAlign: 'left', padding: 6 }}>原班級</th>
                <th style={{ textAlign: 'left', padding: 6 }}>原座號</th>
                <th style={{ textAlign: 'left', padding: 6 }}>姓名</th>
                <th style={{ textAlign: 'left', padding: 6 }}>點名狀態</th>
              </tr>
            </thead>
            <tbody>
              {members.map((m, idx) => (
                <tr key={m.student_no} style={{ borderTop: '1px solid var(--line)' }}>
                  <td style={{ padding: 6 }}>{idx + 1}</td>
                  <td style={{ padding: 6 }}>{m.student_no}</td>
                  <td style={{ padding: 6 }}>{m.class_label}</td>
                  <td style={{ padding: 6 }}>{m.seat_no ?? '－'}</td>
                  <td style={{ padding: 6 }}>{m.name}</td>
                  <td style={{ padding: 6 }}>
                    {/* 比照當日出缺勤：橫排五個異常選項，沒選＝出席，再點一次已選的選項即取消 */}
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                      {EXCEPTION_OPTIONS.map((opt) => (
                        <button
                          key={opt}
                          type="button"
                          onClick={() =>
                            setStatusMap({ ...statusMap, [m.student_no]: (statusMap[m.student_no] ?? '出席') === opt ? '出席' : opt })
                          }
                          style={{
                            fontSize: 13,
                            padding: isMobile ? '8px 12px' : '4px 10px',
                            borderRadius: 6,
                            border: '1px solid var(--line-strong)',
                            background: (statusMap[m.student_no] ?? '出席') === opt ? '#EAF3DE' : 'var(--surface)',
                          }}
                        >
                          {opt}
                        </button>
                      ))}
                      {(statusMap[m.student_no] ?? '出席') === '出席' && <span style={{ fontSize: 12, color: '#3B6D11' }}>出席</span>}
                    </div>
                  </td>
                </tr>
              ))}
              {members.length === 0 && (
                <tr>
                  <td colSpan={6} style={{ padding: 12, textAlign: 'center', color: 'var(--sub)' }}>
                    這個社團目前沒有在社學生
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          <button onClick={saveAttendance} disabled={saving || members.length === 0} style={{ padding: '8px 20px' }}>
            {saving ? '儲存中…' : '儲存點名'}
          </button>
        </>
      )}

      {summary && (
        <div
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50 }}
        >
          <div style={{ background: 'var(--surface)', borderRadius: 8, padding: 24, width: '90%', maxWidth: 420, maxHeight: '80vh', overflowY: 'auto' }}>
            <h2 style={{ fontSize: 16, marginBottom: 8 }}>點名已儲存，請確認</h2>
            <p style={{ fontSize: 13, color: 'var(--sub)', marginBottom: 12 }}>
              {summary.date} 共 {summary.total} 人，出席 {summary.total - summary.absent.length} 人，未出席 {summary.absent.length} 人
            </p>
            {summary.absent.length === 0 ? (
              <p style={{ fontSize: 14, color: '#2D7A3A', marginBottom: 16 }}>全部出席。</p>
            ) : (
              <ul style={{ listStyle: 'none', padding: 0, margin: '0 0 16px', fontSize: 14 }}>
                {summary.absent.map((a) => (
                  <li key={a.student_no} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid var(--line)' }}>
                    <span>
                      {a.name}
                      <span style={{ color: 'var(--sub)', marginLeft: 6, fontSize: 12 }}>{a.class_label}</span>
                    </span>
                    <span style={{ color: '#A32D2D' }}>{a.status}</span>
                  </li>
                ))}
              </ul>
            )}
            <button onClick={() => setSummary(null)} style={{ width: '100%', padding: 10, borderRadius: 8, background: 'var(--primary)', color: '#fff', border: 'none' }}>
              確認
            </button>
          </div>
        </div>
      )}
    </main>
  );
}
