'use client';

import { useEffect, useState } from 'react';
import { supabase, getCurrentTeacherId } from '@/lib/supabaseClient';
import { useIsMobile } from '@/lib/useIsMobile';
import { resolveCurrentTerm } from '@/lib/academicTerm';
import { classSortKey, compareByClassThenSeat } from '@/lib/clubOrder';

type ClubOption = { id: string; name: string };
type ScoreRow = {
  student_no: string;
  name: string;
  class_label: string;
  seat_no: number | null;
  sort_key: number;
  score_midterm: number | null;
  score_final: number | null;
  score_daily: number | null;
  midterm_submitted: boolean;
  final_submitted: boolean;
  daily_submitted: boolean;
};
type ItemKey = 'midterm' | 'final' | 'daily';
const ITEMS: { key: ItemKey; label: string; scoreField: 'score_midterm' | 'score_final' | 'score_daily'; flagField: 'midterm_submitted' | 'final_submitted' | 'daily_submitted' }[] = [
  { key: 'midterm', label: '期中考', scoreField: 'score_midterm', flagField: 'midterm_submitted' },
  { key: 'final', label: '期末考', scoreField: 'score_final', flagField: 'final_submitted' },
  { key: 'daily', label: '平時分', scoreField: 'score_daily', flagField: 'daily_submitted' },
];
type Weights = { midterm_weight: number; final_weight: number; daily_weight: number };

// 社團成績輸入頁：欄位比照現有其他科目（期中考／期末考／平時分），不是另外發明的評分方式。
// 老師可先「暫存」多次修改，正式送出後鎖定，系統會自動把這三項分數回寫進學期總成績的
// 「才藝」科目（見 sql/54clubs_module.sql），最終加權比重跟其他科目一樣，統一用教務處
// 「成績設定」（grading_rules）的全校期中/期末/平時比重去算，這裡不用也不能另外調整。
export default function ClubGradingPage() {
  const isMobile = useIsMobile();
  const [clubs, setClubs] = useState<ClubOption[]>([]);
  const [selectedClubId, setSelectedClubId] = useState('');
  const [weights, setWeights] = useState<Weights | null>(null);
  const [rows, setRows] = useState<ScoreRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);
  const [noAssignment, setNoAssignment] = useState(false);
  const [term, setTerm] = useState<{ academic_year: number; term: string } | null>(null);
  const [itemKey, setItemKey] = useState<ItemKey>('midterm');

  useEffect(() => {
    (async () => {
      const teacherId = await getCurrentTeacherId();
      if (!teacherId) {
        setNoAssignment(true);
        setLoading(false);
        return;
      }
      const t = await resolveCurrentTerm();
      setTerm(t);
      let q = supabase.from('clubs').select('id, name').eq('teacher_id', teacherId).eq('is_active', true);
      if (t) {
        q = q.eq('academic_year', t.academic_year).eq('term', t.term);
        const { data: ruleRow } = await supabase
          .from('grading_rules')
          .select('midterm_weight, final_weight, daily_weight')
          .eq('academic_year', t.academic_year)
          .eq('term', t.term)
          .maybeSingle();
        if (ruleRow) setWeights(ruleRow as Weights);
      }
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
      setClubs(data as ClubOption[]);
      setSelectedClubId(data[0].id);
      setLoading(false);
    })();
  }, []);

  async function loadClubData(clubId: string) {
    setLoading(true);
    setError(null);
    setSaveMsg(null);

    const { data: memberRows, error: memberErr } = await supabase
      .from('club_members')
      .select('student_no, students(name, enrollments(seat_no, term, is_current, classes(department, grade_level, class_name, academic_year)))')
      .eq('club_id', clubId)
      .eq('status', '在社');
    if (memberErr) {
      setError('讀取社團名單失敗：' + memberErr.message);
      setLoading(false);
      return;
    }

    const { data: scoreRows } = await supabase
      .from('club_scores')
      .select('student_no, score_midterm, score_final, score_daily, midterm_submitted, final_submitted, daily_submitted')
      .eq('club_id', clubId);
    const scoreMap = new Map((scoreRows ?? []).map((s: any) => [s.student_no, s]));

    const built: ScoreRow[] = (memberRows ?? []).map((r: any) => {
      // club_members 和 enrollments 之間沒有直接外鍵，所以從 students 底下展開 enrollments
      const raw = r.students?.enrollments;
      const enrollmentList = Array.isArray(raw) ? raw : raw ? [raw] : [];
      const currentEnrollment = term
        ? enrollmentList.find((e: any) => e?.is_current && e?.term === term.term && e?.classes?.academic_year === term.academic_year) ??
          enrollmentList.find((e: any) => e?.term === term.term && e?.classes?.academic_year === term.academic_year) ??
          null
        : enrollmentList.find((e: any) => e?.is_current) ?? enrollmentList[0] ?? null;
      const existing: any = scoreMap.get(r.student_no);
      return {
        student_no: r.student_no,
        name: r.students?.name ?? r.student_no,
        sort_key: classSortKey(currentEnrollment?.classes?.department, currentEnrollment?.classes?.grade_level, currentEnrollment?.classes?.class_name),
        class_label: currentEnrollment ? `${currentEnrollment.classes?.grade_level ?? ''}${currentEnrollment.classes?.class_name ?? ''}` : '－',
        seat_no: currentEnrollment?.seat_no ?? null,
        score_midterm: existing?.score_midterm ?? null,
        score_final: existing?.score_final ?? null,
        score_daily: existing?.score_daily ?? null,
        midterm_submitted: existing?.midterm_submitted ?? false,
        final_submitted: existing?.final_submitted ?? false,
        daily_submitted: existing?.daily_submitted ?? false,
      };
    });
    built.sort((a, b) => compareByClassThenSeat(a, b));
    setRows(built);
    setLoading(false);
  }

  useEffect(() => {
    if (selectedClubId) loadClubData(selectedClubId);
  }, [selectedClubId]);

  function updateScore(studentNo: string, field: 'score_midterm' | 'score_final' | 'score_daily', value: string) {
    const num = value === '' ? null : Math.max(0, Math.min(100, Number(value)));
    setRows((prev) => prev.map((r) => (r.student_no === studentNo ? { ...r, [field]: num } : r)));
  }

  // 期中考／期末考／平時分各自獨立：老師先選要輸入哪一項，「暫存」只存在社團成績表，
  // 「正式送出並鎖定」才把這一項回寫學期總成績的「才藝」科目；其他兩項不受影響。
  async function saveAll(submit: boolean) {
    setSaving(true);
    setError(null);
    setSaveMsg(null);
    const teacherId = await getCurrentTeacherId();
    const item = ITEMS.find((i) => i.key === itemKey)!;

    // 只處理這一項還沒鎖定的學生，已鎖定的不動
    const editableRows = rows.filter((r) => !r[item.flagField]);
    if (editableRows.length === 0) {
      setSaveMsg(`所有學生的${item.label}都已經正式送出鎖定，沒有可以更新的項目。`);
      setSaving(false);
      return;
    }

    if (submit) {
      const incomplete = editableRows.filter((r) => r[item.scoreField] === null);
      if (incomplete.length > 0) {
        setError(`「${incomplete.map((r) => r.name).join('、')}」還沒有輸入${item.label}，無法正式送出（還沒輸入完請先按「暫存」）`);
        setSaving(false);
        return;
      }
      if (!window.confirm(`確定要把全部 ${editableRows.length} 位學生的「${item.label}」正式送出並鎖定嗎？送出後會寫入學期總成績，要修改需請教務處解鎖。`)) {
        setSaving(false);
        return;
      }
    }

    const nowIso = new Date().toISOString();
    const upsertRows = editableRows.map((r) => ({
      club_id: selectedClubId,
      student_no: r.student_no,
      [item.scoreField]: r[item.scoreField],
      [item.flagField]: submit,
      ...(submit ? { submitted_at: nowIso } : {}),
      recorded_by: teacherId,
    }));
    const { error: upsertErr } = await supabase.from('club_scores').upsert(upsertRows, { onConflict: 'club_id,student_no' });
    if (upsertErr) {
      setError((submit ? '正式送出' : '暫存') + '失敗：' + upsertErr.message);
    } else {
      setSaveMsg(submit ? `${item.label}已正式送出並鎖定，分數已同步回寫學期總成績「才藝」科目` : `${item.label}已暫存，尚未正式送出`);
      loadClubData(selectedClubId);
    }
    setSaving(false);
  }

  if (noAssignment) {
    return (
      <main style={{ maxWidth: 720, margin: '0 auto', padding: 24 }}>
        <h1 style={{ fontSize: 16 }}>社團成績輸入</h1>
        <p style={{ fontSize: 13, color: 'var(--sub)' }}>目前沒有指派給您的社團，如有需要請洽教務處。</p>
      </main>
    );
  }

  const item = ITEMS.find((i) => i.key === itemKey)!;
  const lockedCount = rows.filter((r) => r[item.flagField]).length;
  const allLocked = rows.length > 0 && lockedCount === rows.length;

  return (
    <main style={{ maxWidth: 960, margin: '0 auto', padding: isMobile ? '16px 12px' : 24 }}>
      <h1 style={{ fontSize: isMobile ? 18 : 16, marginBottom: 4 }}>社團成績輸入</h1>
      <p style={{ fontSize: 12, color: 'var(--sub)', marginBottom: 4 }}>
        請先選擇要輸入的項目（期中考／期末考／平時分），三項各自獨立。還沒打完先按「暫存」；確認無誤再按「正式送出並鎖定」，這一項才會回寫進學期總成績的「才藝」科目，其他兩項不受影響。如需修改已鎖定的成績請洽教務處協助解鎖。
      </p>
      {weights && (
        <p style={{ fontSize: 12, color: 'var(--sub)', marginBottom: 16 }}>
          本學期加權比例（與其他科目相同，於教務處「成績設定」調整）：期中 {Math.round(weights.midterm_weight * 100)}% ／期末 {Math.round(weights.final_weight * 100)}% ／平時{' '}
          {Math.round(weights.daily_weight * 100)}%
        </p>
      )}

      {clubs.length > 1 && (
        <select value={selectedClubId} onChange={(e) => setSelectedClubId(e.target.value)} style={{ padding: 8, marginBottom: 16 }}>
          {clubs.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      )}

      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        {ITEMS.map((i) => {
          const done = rows.length > 0 && rows.every((r) => r[i.flagField]);
          return (
            <button
              key={i.key}
              type="button"
              onClick={() => {
                setItemKey(i.key);
                setSaveMsg(null);
                setError(null);
              }}
              style={{
                padding: isMobile ? '10px 16px' : '6px 16px',
                borderRadius: 6,
                border: '1px solid var(--line-strong)',
                background: itemKey === i.key ? '#EAF3DE' : 'var(--surface)',
                fontWeight: itemKey === i.key ? 600 : 400,
              }}
            >
              {i.label}
              {done ? '（已送出）' : ''}
            </button>
          );
        })}
      </div>

      {error && <p style={{ fontSize: 13, color: '#A32D2D', marginBottom: 12 }}>{error}</p>}
      {saveMsg && <p style={{ fontSize: 13, color: '#2D7A3A', marginBottom: 12 }}>{saveMsg}</p>}

      {loading ? (
        <p style={{ fontSize: 13, color: 'var(--sub)' }}>載入中…</p>
      ) : (
        <>
          <p style={{ fontSize: 13, color: 'var(--sub)', marginBottom: 6 }}>在社共 {rows.length} 人</p>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, marginBottom: 16, minWidth: 480 }}>
              <thead>
                <tr>
                  <th style={{ textAlign: 'left', padding: 6 }}>序號</th>
                  <th style={{ textAlign: 'left', padding: 6 }}>學號</th>
                  <th style={{ textAlign: 'left', padding: 6 }}>原班級</th>
                  <th style={{ textAlign: 'left', padding: 6 }}>姓名</th>
                  <th style={{ textAlign: 'right', padding: 6 }}>{item.label}</th>
                  <th style={{ textAlign: 'center', padding: 6 }}>狀態</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, idx) => {
                  const locked = r[item.flagField];
                  return (
                    <tr key={r.student_no} style={{ borderTop: '1px solid var(--line)' }}>
                      <td style={{ padding: 6 }}>{idx + 1}</td>
                      <td style={{ padding: 6 }}>{r.student_no}</td>
                      <td style={{ padding: 6 }}>{r.class_label}</td>
                      <td style={{ padding: 6 }}>{r.name}</td>
                      <td style={{ padding: 6, textAlign: 'right' }}>
                        <input
                          type="number"
                          min={0}
                          max={100}
                          disabled={locked}
                          value={r[item.scoreField] ?? ''}
                          onChange={(e) => updateScore(r.student_no, item.scoreField, e.target.value)}
                          style={{ width: 72, padding: 4, textAlign: 'right' }}
                        />
                      </td>
                      <td style={{ padding: 6, textAlign: 'center', color: locked ? '#2D7A3A' : 'var(--sub)' }}>{locked ? '已送出' : r[item.scoreField] === null ? '未輸入' : '暫存中'}</td>
                    </tr>
                  );
                })}
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={6} style={{ padding: 12, textAlign: 'center', color: 'var(--sub)' }}>
                      這個社團目前沒有在社學生
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <div style={{ display: 'flex', gap: 12 }}>
            <button onClick={() => saveAll(false)} disabled={saving || rows.length === 0 || allLocked} style={{ padding: '8px 20px' }}>
              暫存{item.label}
            </button>
            <button onClick={() => saveAll(true)} disabled={saving || rows.length === 0 || allLocked} style={{ padding: '8px 20px', fontWeight: 600 }}>
              正式送出{item.label}並鎖定
            </button>
          </div>
          {lockedCount > 0 && <p style={{ fontSize: 12, color: 'var(--sub)', marginTop: 8 }}>已送出的學生{item.label}會鎖定無法再自行修改，如需更正請洽教務處協助解鎖。</p>}
        </>
      )}
    </main>
  );
}
