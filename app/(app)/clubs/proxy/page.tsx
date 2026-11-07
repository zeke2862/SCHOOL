'use client';

import { useEffect, useMemo, useState } from 'react';
import { supabase, getCurrentTeacherId } from '@/lib/supabaseClient';
import { resolveCurrentTerm } from '@/lib/academicTerm';
import { useCaps } from '@/lib/useCaps';
import { classSortKey } from '@/lib/clubOrder';

type ClassRow = { id: string; department: string; grade_level: string; class_name: string };
type StudentRow = { student_no: string; name: string; seat_no: number };
type ClubOption = { id: string; name: string; capacity: number | null; description: string | null };
type SelectionWindow = {
  academic_year: number;
  term: string;
  method: '志願序_第一志願優先' | '志願序_隨機亂數' | '即時搶選';
  max_choices: number | null;
  opens_at: string;
  closes_at: string | null;
  is_finalized: boolean;
};
type RpcResult = { ok: boolean; message: string };

const METHOD_LABEL: Record<string, string> = {
  志願序_第一志願優先: '志願序抽籤（第一志願優先法）',
  志願序_隨機亂數: '志願序抽籤（隨機亂數法）',
  即時搶選: '即時搶選（先搶先贏）',
};

// 導師代填選社：國小學生沒有個人帳號，由班導師依學生／家長的意願，在這裡替全班填志願序或報名即時搶選。
// 教務處、系統管理員可以選任何班級補登（不受開放時間限制，但抽籤完成後仍不能改）。
// 資料能不能寫入由資料庫函式（proxy_*，見 sql/145）把關：導師只能寫自己班的國小學生。
export default function ClubProxyPage() {
  const { caps } = useCaps();
  const isAdmin = !!caps && (caps.academic || caps.sd);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [term, setTerm] = useState<{ academic_year: number; term: string } | null>(null);
  const [win, setWin] = useState<SelectionWindow | null>(null);
  const [classes, setClasses] = useState<ClassRow[]>([]);
  const [classId, setClassId] = useState('');
  const [clubs, setClubs] = useState<ClubOption[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [students, setStudents] = useState<StudentRow[]>([]);
  const [saved, setSaved] = useState<Record<string, string[]>>({});     // 資料庫裡的志願
  const [choices, setChoices] = useState<Record<string, string[]>>({}); // 畫面上編輯中的志願
  const [member, setMember] = useState<Record<string, string>>({});     // 學號 → 已入社的 club_id
  const [pick, setPick] = useState<Record<string, string>>({});         // 即時搶選：每位學生下拉選中的社團
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);

  const maxChoices = Math.min(win?.max_choices ?? 5, 10);
  const isRanking = !!win && win.method.startsWith('志願序_');

  // 目前能不能操作：教務處只要「還沒抽籤」；導師另外要在開放時間內
  const canEdit = useMemo(() => {
    if (!win || win.is_finalized) return false;
    if (isAdmin) return true;
    const now = new Date();
    if (now < new Date(win.opens_at)) return false;
    if (win.closes_at && now > new Date(win.closes_at)) return false;
    return true;
  }, [win, isAdmin]);

  const blockedReason = useMemo(() => {
    if (!win) return '教務處尚未開放這學期的選社作業。';
    if (win.is_finalized) return isRanking ? '電腦抽籤已經執行完畢，志願不能再修改，如需調整請洽教務處。' : '選社已結束。';
    if (canEdit) return null;
    const now = new Date();
    if (now < new Date(win.opens_at)) return `還沒到開放時間（${new Date(win.opens_at).toLocaleString('zh-TW')} 開始）。`;
    return '填寫時間已經截止，如需補登請洽教務處。';
  }, [win, canEdit, isRanking]);

  // 第一次載入：學期、選社設定、社團清單、可代填的班級
  useEffect(() => {
    (async () => {
      const t = await resolveCurrentTerm();
      if (!t) {
        setError('學校尚未設定目前學年學期');
        setLoading(false);
        return;
      }
      setTerm(t);
      const [{ data: w }, { data: clubRows }, { data: classRows, error: clsErr }] = await Promise.all([
        supabase.from('club_selection_windows').select('academic_year, term, method, max_choices, opens_at, closes_at, is_finalized').eq('academic_year', t.academic_year).eq('term', t.term).maybeSingle(),
        supabase.from('clubs').select('id, name, capacity, description').eq('academic_year', t.academic_year).eq('term', t.term).eq('is_active', true).order('name'),
        supabase.from('classes').select('id, department, grade_level, class_name, homeroom_teacher_id').eq('academic_year', t.academic_year),
      ]);
      if (clsErr) {
        setError('讀取班級失敗：' + clsErr.message);
        setLoading(false);
        return;
      }
      setWin((w as SelectionWindow) ?? null);
      setClubs((clubRows ?? []) as ClubOption[]);
      const teacherId = await getCurrentTeacherId();
      let list = (classRows ?? []) as (ClassRow & { homeroom_teacher_id: string | null })[];
      // 導師只列自己帶的國小班；教務處（caps 載入後才知道）在下面的 effect 再放寬
      list = list.filter((c) => c.homeroom_teacher_id === teacherId && c.department === '國小');
      setClasses(list);
      setClassId(list[0]?.id ?? '');
      setLoading(false);
    })();
  }, []);

  // 教務處／系統管理員：列出全校所有班級
  useEffect(() => {
    if (!isAdmin || !term) return;
    (async () => {
      const { data } = await supabase.from('classes').select('id, department, grade_level, class_name').eq('academic_year', term.academic_year);
      const list = ((data ?? []) as ClassRow[]).sort(
        (a, b) => classSortKey(a.department, a.grade_level, a.class_name) - classSortKey(b.department, b.grade_level, b.class_name)
      );
      setClasses(list);
      setClassId((cur) => (cur && list.some((c) => c.id === cur) ? cur : list.find((c) => c.department === '國小')?.id ?? list[0]?.id ?? ''));
    })();
  }, [isAdmin, term]);

  async function loadClass(cid: string) {
    if (!term || !cid) return;
    setBusy(true);
    setMsg(null);
    const { data: enr, error: enrErr } = await supabase
      .from('enrollments')
      .select('student_no, seat_no, students(name)')
      .eq('class_id', cid)
      .eq('term', term.term)
      .eq('is_current', true)
      .order('seat_no');
    if (enrErr) {
      setError('讀取學生名單失敗：' + enrErr.message);
      setBusy(false);
      return;
    }
    const rows: StudentRow[] = (enr ?? []).map((r: any) => ({
      student_no: r.student_no,
      name: (Array.isArray(r.students) ? r.students[0]?.name : r.students?.name) ?? r.student_no,
      seat_no: r.seat_no,
    }));
    setStudents(rows);
    const nos = rows.map((r) => r.student_no);

    const savedMap: Record<string, string[]> = {};
    const memberMap: Record<string, string> = {};
    if (nos.length > 0) {
      const { data: prefs } = await supabase
        .from('club_preferences')
        .select('student_no, club_id, choice_rank')
        .eq('academic_year', term.academic_year)
        .eq('term', term.term)
        .in('student_no', nos)
        .order('choice_rank');
      (prefs ?? []).forEach((p: any) => {
        const arr = (savedMap[p.student_no] ??= []);
        arr[p.choice_rank - 1] = p.club_id;
      });
      const { data: mems } = await supabase.from('club_members').select('student_no, club_id, status, clubs(academic_year, term)').in('student_no', nos).eq('status', '在社');
      (mems ?? []).forEach((m: any) => {
        const c = Array.isArray(m.clubs) ? m.clubs[0] : m.clubs;
        if (c?.academic_year === term.academic_year && c?.term === term.term) memberMap[m.student_no] = m.club_id;
      });
    }
    const edit: Record<string, string[]> = {};
    nos.forEach((no) => {
      const base = new Array(maxChoices).fill('');
      (savedMap[no] ?? []).forEach((id, i) => {
        if (id && i < maxChoices) base[i] = id;
      });
      edit[no] = base;
    });
    setSaved(savedMap);
    setChoices(edit);
    setMember(memberMap);
    setPick({});

    const { data: countRows } = await supabase.rpc('club_member_counts', { p_academic_year: term.academic_year, p_term: term.term });
    const cm: Record<string, number> = {};
    (countRows ?? []).forEach((r: any) => (cm[r.club_id] = Number(r.current_count)));
    setCounts(cm);
    setBusy(false);
  }

  useEffect(() => {
    if (classId && term && win !== undefined) loadClass(classId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [classId, term, win?.method, win?.max_choices]);

  const clubName = (id: string | undefined) => clubs.find((c) => c.id === id)?.name ?? '';
  const norm = (arr: string[] | undefined) => (arr ?? []).filter(Boolean).join('|');
  const isDirty = (no: string) => norm(choices[no]) !== norm(saved[no]);
  const dirtyNos = students.filter((s) => isDirty(s.student_no)).map((s) => s.student_no);
  const filledCount = students.filter((s) => norm(choices[s.student_no]) !== '' || member[s.student_no]).length;

  function setChoice(no: string, idx: number, clubId: string) {
    setChoices((prev) => {
      const next = [...(prev[no] ?? new Array(maxChoices).fill(''))];
      next[idx] = clubId;
      return { ...prev, [no]: next };
    });
  }

  function copyFromAbove(i: number) {
    if (i === 0) return;
    const src = choices[students[i - 1].student_no] ?? [];
    setChoices((prev) => ({ ...prev, [students[i].student_no]: [...src] }));
  }

  async function saveAll() {
    if (!term || dirtyNos.length === 0) return;
    // 先在畫面上檢查，有問題的學生不送出，免得整批失敗
    for (const no of dirtyNos) {
      const picked = (choices[no] ?? []).filter(Boolean);
      if (new Set(picked).size !== picked.length) {
        const s = students.find((x) => x.student_no === no);
        setMsg({ text: `${s?.seat_no ?? ''}號 ${s?.name ?? no} 的志願有重複選到同一個社團，請修正後再儲存`, ok: false });
        return;
      }
    }
    setBusy(true);
    setMsg(null);
    const failed: string[] = [];
    let okCount = 0;
    for (const no of dirtyNos) {
      // 依順序送出：中間留空的志願要往前補，避免志願序出現缺號
      const ids = (choices[no] ?? []).filter(Boolean);
      const { data, error: rpcErr } = await supabase.rpc('proxy_save_club_preferences', {
        p_student_no: no,
        p_year: term.academic_year,
        p_term: term.term,
        p_club_ids: ids,
      });
      const r = data as RpcResult | null;
      if (rpcErr || !r?.ok) {
        const s = students.find((x) => x.student_no === no);
        failed.push(`${s?.seat_no ?? ''}號 ${s?.name ?? no}：${rpcErr?.message ?? r?.message ?? '未知錯誤'}`);
      } else {
        okCount++;
      }
    }
    await loadClass(classId);
    setMsg(
      failed.length === 0
        ? { text: `已儲存 ${okCount} 位學生的志願`, ok: true }
        : { text: `已儲存 ${okCount} 位；${failed.length} 位失敗：\n${failed.join('\n')}`, ok: false }
    );
    setBusy(false);
  }

  async function joinFor(no: string) {
    const clubId = pick[no];
    if (!clubId) return;
    setBusy(true);
    setMsg(null);
    const { data, error: rpcErr } = await supabase.rpc('proxy_join_club_first_come', { p_student_no: no, p_club_id: clubId });
    const r = data as RpcResult | null;
    await loadClass(classId);
    setMsg({ text: rpcErr ? '報名失敗：' + rpcErr.message : r?.message ?? '', ok: !rpcErr && !!r?.ok });
    setBusy(false);
  }

  async function leaveFor(no: string) {
    if (!term) return;
    const s = students.find((x) => x.student_no === no);
    if (!window.confirm(`確定取消 ${s?.seat_no ?? ''}號 ${s?.name ?? no} 的社團報名嗎？`)) return;
    setBusy(true);
    setMsg(null);
    const { data, error: rpcErr } = await supabase.rpc('proxy_leave_club_first_come', { p_student_no: no, p_year: term.academic_year, p_term: term.term });
    const r = data as RpcResult | null;
    await loadClass(classId);
    setMsg({ text: rpcErr ? '取消失敗：' + rpcErr.message : r?.message ?? '', ok: !rpcErr && !!r?.ok });
    setBusy(false);
  }

  if (loading) return <main style={{ padding: 24 }}>載入中…</main>;
  if (error) return <main style={{ padding: 24, color: '#A32D2D', fontSize: 13 }}>{error}</main>;

  const th: React.CSSProperties = { textAlign: 'left', padding: '6px 8px', fontSize: 12, borderBottom: '1px solid var(--line)', whiteSpace: 'nowrap' };
  const td: React.CSSProperties = { padding: '6px 8px', fontSize: 13, borderBottom: '1px solid var(--line)', verticalAlign: 'middle' };

  return (
    <main style={{ maxWidth: 1000, margin: '0 auto', padding: 24 }}>
      <h1 style={{ fontSize: 16, marginBottom: 4 }}>班級選社代填（國小）</h1>
      <p style={{ fontSize: 12, color: 'var(--sub)', marginBottom: 12 }}>
        國小學生沒有個人帳號，請依學生與家長的意願，由導師在這裡代為填寫。每一次儲存都會留下紀錄（誰、何時、替誰填）。
      </p>

      {!win && <p style={{ fontSize: 13, color: 'var(--sub)' }}>教務處尚未開放這學期的選社作業，請稍後再回來。</p>}

      {win && (
        <p style={{ fontSize: 12, color: 'var(--sub)', marginBottom: 12 }}>
          {term?.academic_year} 學年 {term?.term}選社方式：<b>{METHOD_LABEL[win.method]}</b>
          {`，開放 ${new Date(win.opens_at).toLocaleString('zh-TW')}`}
          {win.closes_at && ` ～ ${new Date(win.closes_at).toLocaleString('zh-TW')}`}
        </p>
      )}

      {classes.length === 0 ? (
        <p style={{ fontSize: 13, color: 'var(--sub)' }}>目前沒有您帶的國小班級，不需要使用這個功能。</p>
      ) : (
        <>
          <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', marginBottom: 12 }}>
            <label style={{ fontSize: 12 }}>
              班級
              <select value={classId} onChange={(e) => setClassId(e.target.value)} style={{ marginLeft: 6, padding: 6 }}>
                {classes.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.department !== '國小' ? c.department : ''}
                    {c.grade_level}
                    {c.class_name}
                  </option>
                ))}
              </select>
            </label>
            <span style={{ fontSize: 12, color: filledCount === students.length ? '#2D7A3A' : '#B26A00' }}>
              已填 {filledCount} / {students.length} 人
            </span>
          </div>

          {blockedReason && <p style={{ fontSize: 13, color: '#B26A00', marginBottom: 12 }}>{blockedReason}</p>}
          {msg && <p style={{ fontSize: 13, color: msg.ok ? '#2D7A3A' : '#A32D2D', marginBottom: 12, whiteSpace: 'pre-line' }}>{msg.text}</p>}

          {win && isRanking && (
            <>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ borderCollapse: 'collapse', width: '100%' }}>
                  <thead>
                    <tr>
                      <th style={th}>座號</th>
                      <th style={th}>姓名</th>
                      {Array.from({ length: maxChoices }, (_, i) => (
                        <th key={i} style={th}>志願 {i + 1}</th>
                      ))}
                      <th style={th}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {students.map((s, i) => {
                      const empty = norm(choices[s.student_no]) === '';
                      return (
                        <tr key={s.student_no} style={{ background: isDirty(s.student_no) ? 'var(--tint, #FFF8E1)' : empty ? 'rgba(178,106,0,0.06)' : undefined }}>
                          <td style={td}>{s.seat_no}</td>
                          <td style={{ ...td, whiteSpace: 'nowrap' }}>{s.name}</td>
                          {Array.from({ length: maxChoices }, (_, idx) => (
                            <td key={idx} style={td}>
                              <select
                                value={choices[s.student_no]?.[idx] ?? ''}
                                disabled={!canEdit || busy}
                                onChange={(e) => setChoice(s.student_no, idx, e.target.value)}
                                style={{ padding: 4, maxWidth: 150 }}
                              >
                                <option value="">（不填）</option>
                                {clubs.map((c) => (
                                  <option key={c.id} value={c.id}>
                                    {c.name}
                                    {c.capacity != null ? `（${c.capacity}）` : ''}
                                  </option>
                                ))}
                              </select>
                            </td>
                          ))}
                          <td style={td}>
                            <button type="button" onClick={() => copyFromAbove(i)} disabled={!canEdit || busy || i === 0} title="把上一位同學的志願複製過來" style={{ padding: '2px 8px', fontSize: 12 }}>
                              同上
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div style={{ marginTop: 12, display: 'flex', gap: 12, alignItems: 'center' }}>
                <button onClick={saveAll} disabled={!canEdit || busy || dirtyNos.length === 0} style={{ padding: '8px 20px' }}>
                  {busy ? '處理中…' : `儲存全班（${dirtyNos.length} 位有變更）`}
                </button>
                <span style={{ fontSize: 12, color: 'var(--sub)' }}>括號內為社團名額；底色淡黃＝尚未儲存、淡橘＝還沒填。志願可以不用填滿。</span>
              </div>
            </>
          )}

          {win && !isRanking && (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ borderCollapse: 'collapse', width: '100%' }}>
                <thead>
                  <tr>
                    <th style={th}>座號</th>
                    <th style={th}>姓名</th>
                    <th style={th}>目前社團</th>
                    <th style={th}>代為報名</th>
                  </tr>
                </thead>
                <tbody>
                  {students.map((s) => {
                    const joined = member[s.student_no];
                    return (
                      <tr key={s.student_no}>
                        <td style={td}>{s.seat_no}</td>
                        <td style={{ ...td, whiteSpace: 'nowrap' }}>{s.name}</td>
                        <td style={td}>{joined ? <span style={{ color: '#2D7A3A' }}>{clubName(joined) || '（已入社）'}</span> : <span style={{ color: 'var(--sub)' }}>尚未報名</span>}</td>
                        <td style={td}>
                          {joined ? (
                            <button onClick={() => leaveFor(s.student_no)} disabled={!canEdit || busy} style={{ padding: '4px 12px', fontSize: 12 }}>
                              取消報名
                            </button>
                          ) : (
                            <span style={{ display: 'inline-flex', gap: 6 }}>
                              <select value={pick[s.student_no] ?? ''} disabled={!canEdit || busy} onChange={(e) => setPick((p) => ({ ...p, [s.student_no]: e.target.value }))} style={{ padding: 4 }}>
                                <option value="">選擇社團…</option>
                                {clubs.map((c) => {
                                  const full = c.capacity != null && (counts[c.id] ?? 0) >= c.capacity;
                                  return (
                                    <option key={c.id} value={c.id} disabled={full}>
                                      {c.name}（{counts[c.id] ?? 0}/{c.capacity ?? '不限'}）{full ? ' 額滿' : ''}
                                    </option>
                                  );
                                })}
                              </select>
                              <button onClick={() => joinFor(s.student_no)} disabled={!canEdit || busy || !pick[s.student_no]} style={{ padding: '4px 12px', fontSize: 12 }}>
                                報名
                              </button>
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <p style={{ fontSize: 12, color: 'var(--sub)', marginTop: 8 }}>即時搶選是先報名先贏，額滿的社團無法再選；填錯可在開放時間內按「取消報名」更正。</p>
            </div>
          )}
        </>
      )}
    </main>
  );
}
