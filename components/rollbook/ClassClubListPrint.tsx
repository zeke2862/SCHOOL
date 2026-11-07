'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { classSortKey } from '@/lib/clubOrder';

type ClassInfo = { id: string; department: string; grade_level: string; class_name: string; homeroom: string };
type StudentRow = { student_no: string; name: string; seat_no: number; club: string; teacher: string };

// supabase 單次最多回 1000 筆，名單超過就要分頁讀完
async function fetchAll<T>(build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>): Promise<T[]> {
  const out: T[] = [];
  const size = 1000;
  for (let from = 0; ; from += size) {
    const { data, error } = await build(from, from + size - 1);
    if (error) throw new Error(error.message);
    out.push(...(data ?? []));
    if (!data || data.length < size) break;
  }
  return out;
}

// 各班社團名單：每班一張 A4，列出全班學生（依座號）參加的社團與指導老師，給導師核對用。
// autoPrint＝true 時資料讀完就直接開啟列印視窗（一鍵列印全部班級）。
export default function ClassClubListPrint({
  term,
  autoPrint,
  onClose,
}: {
  term: { academic_year: number; term: string };
  autoPrint: boolean;
  onClose: () => void;
}) {
  const [classes, setClasses] = useState<ClassInfo[]>([]);
  const [byClass, setByClass] = useState<Record<string, StudentRow[]>>({});
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const printed = useRef(false);

  useEffect(() => {
    (async () => {
      try {
        const { data: clsRows, error: clsErr } = await supabase
          .from('classes')
          .select('id, department, grade_level, class_name, homeroom_teacher_id')
          .eq('academic_year', term.academic_year);
        if (clsErr) throw new Error(clsErr.message);
        // 老師姓名分開查（內嵌關聯在這個資料庫上不穩定，會讀成空白）
        const { data: teacherRows } = await supabase.from('teachers').select('id, name');
        const teacherName = new Map<string, string>((teacherRows ?? []).map((t: any) => [t.id, t.name]));
        const cls: ClassInfo[] = (clsRows ?? [])
          .map((c: any) => ({
            id: c.id,
            department: c.department,
            grade_level: c.grade_level,
            class_name: c.class_name,
            homeroom: (c.homeroom_teacher_id ? teacherName.get(c.homeroom_teacher_id) : '') ?? '',
          }))
          .sort((a, b) => classSortKey(a.department, a.grade_level, a.class_name) - classSortKey(b.department, b.grade_level, b.class_name));

        const enr = await fetchAll<any>((f, t) =>
          supabase.from('enrollments').select('student_no, seat_no, class_id, students(name)').eq('term', term.term).eq('is_current', true).order('student_no').range(f, t)
        );

        const { data: clubRows, error: clubErr } = await supabase
          .from('clubs')
          .select('id, name, teacher_id, external_teacher_name')
          .eq('academic_year', term.academic_year)
          .eq('term', term.term);
        if (clubErr) throw new Error(clubErr.message);
        const clubMap = new Map<string, { name: string; teacher: string }>();
        (clubRows ?? []).forEach((c: any) => {
          const tn = (c.teacher_id ? teacherName.get(c.teacher_id) : '') || c.external_teacher_name || '';
          clubMap.set(c.id, { name: c.name, teacher: tn });
        });

        const mem = await fetchAll<any>((f, t) =>
          supabase.from('club_members').select('student_no, club_id').eq('status', '在社').order('student_no').range(f, t)
        );
        const memberClub = new Map<string, { name: string; teacher: string }>();
        mem.forEach((m) => {
          const c = clubMap.get(m.club_id);
          if (c) memberClub.set(m.student_no, c); // 不在本學期的社團（舊學期）查不到，自然略過
        });

        const grouped: Record<string, StudentRow[]> = {};
        enr.forEach((e) => {
          const c = memberClub.get(e.student_no);
          (grouped[e.class_id] ??= []).push({
            student_no: e.student_no,
            name: (Array.isArray(e.students) ? e.students[0]?.name : e.students?.name) ?? e.student_no,
            seat_no: e.seat_no,
            club: c?.name ?? '',
            teacher: c?.teacher ?? '',
          });
        });
        Object.values(grouped).forEach((arr) => arr.sort((a, b) => a.seat_no - b.seat_no));

        const withStudents = cls.filter((c) => (grouped[c.id]?.length ?? 0) > 0);
        setClasses(withStudents);
        setByClass(grouped);
        setPicked(new Set(withStudents.map((c) => c.id)));
      } catch (e: any) {
        setErr('讀取失敗：' + (e?.message ?? e));
      }
      setLoading(false);
    })();
  }, [term.academic_year, term.term]);

  const selected = useMemo(() => classes.filter((c) => picked.has(c.id)), [classes, picked]);

  // 一鍵列印：資料讀完、畫面排好後自動開啟列印視窗（只開一次）
  useEffect(() => {
    if (!autoPrint || loading || err || printed.current || selected.length === 0) return;
    printed.current = true;
    const t = setTimeout(() => window.print(), 600);
    return () => clearTimeout(t);
  }, [autoPrint, loading, err, selected.length]);

  const depts = Array.from(new Set(classes.map((c) => c.department)));
  const label = (c: ClassInfo) => `${c.department === '國小' ? '' : c.department}${c.grade_level}${c.class_name}`;
  const title = (c: ClassInfo) => `華雲學校 佛曆 ${term.academic_year + 543} (${term.academic_year}) 學年度 ${term.term === '上學期' ? '上' : '下'} 學期　${label(c)}　社團名單`;

  function toggle(id: string) {
    setPicked((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }
  function toggleDept(d: string, on: boolean) {
    setPicked((prev) => {
      const next = new Set(prev);
      classes.filter((c) => c.department === d).forEach((c) => (on ? next.add(c.id) : next.delete(c.id)));
      return next;
    });
  }

  const totalStudents = selected.reduce((s, c) => s + (byClass[c.id]?.length ?? 0), 0);

  return (
    <main style={{ maxWidth: 1000, margin: '0 auto', padding: 16 }}>
      <style>{`
        @page { size: A4 portrait; margin: 0; }
        .ccl-sheet { background: #fff; box-sizing: border-box; position: relative; }
        @media screen {
          .ccl-sheet { width: 210mm; height: 297mm; padding: 10mm; margin: 0 auto 16px; border: 1px solid #ccc; box-shadow: 0 1px 6px rgba(0,0,0,0.12); overflow: hidden; display: flex; flex-direction: column; }
        }
        @media print {
          .no-print { display: none !important; }
          .ccl-sheet { page-break-after: always; break-after: page; margin: 0 !important; height: 296.5mm; padding: 10mm !important; box-sizing: border-box; overflow: hidden; display: flex; flex-direction: column; border: none !important; }
          .ccl-sheet:last-child { page-break-after: auto; break-after: auto; }
          main, .hub-content { padding: 0 !important; max-width: none !important; margin: 0 !important; }
          html { zoom: 1 !important; }
          body { background: #fff !important; }
        }
      `}</style>

      <div className="no-print">
        <h1 style={{ fontSize: 16, marginBottom: 4 }}>列印各班社團名單</h1>
        <p style={{ fontSize: 12, color: '#666', marginBottom: 12 }}>
          {term.academic_year} 學年 {term.term}。每班一張 A4。未參加任何社團的學生，社團欄會留白。
        </p>
        {err && <p style={{ fontSize: 13, color: '#A32D2D' }}>{err}</p>}
        {loading ? (
          <p style={{ fontSize: 13 }}>讀取全校名單中…</p>
        ) : (
          <>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 12 }}>
              {depts.map((d) => {
                const list = classes.filter((c) => c.department === d);
                const allOn = list.every((c) => picked.has(c.id));
                return (
                  <div key={d} style={{ fontSize: 13 }}>
                    <label style={{ fontWeight: 600, marginRight: 12 }}>
                      <input type="checkbox" checked={allOn} onChange={(e) => toggleDept(d, e.target.checked)} /> {d}
                    </label>
                    {list.map((c) => (
                      <label key={c.id} style={{ marginRight: 10, whiteSpace: 'nowrap' }}>
                        <input type="checkbox" checked={picked.has(c.id)} onChange={() => toggle(c.id)} /> {c.grade_level}
                        {c.class_name}
                      </label>
                    ))}
                  </div>
                );
              })}
            </div>
            <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 16 }}>
              <button type="button" onClick={() => window.print()} disabled={selected.length === 0} style={{ padding: '8px 24px', fontWeight: 600 }}>
                列印（{selected.length} 班、{totalStudents} 人）
              </button>
              <button type="button" onClick={onClose} style={{ padding: '8px 18px' }}>
                返回
              </button>
            </div>
          </>
        )}
      </div>

      {!loading &&
        selected.map((c) => {
          const list = byClass[c.id] ?? [];
          const joined = list.filter((s) => s.club).length;
          const rowMm = Math.min(9, Math.max(4.2, 232 / Math.max(list.length + 1, 1)));
          const fs = Math.round(Math.min(15, Math.max(9, rowMm * 3.78 * 0.55)));
          const cell: React.CSSProperties = { border: '1px solid #333', padding: '0 6px', fontSize: fs, whiteSpace: 'nowrap', overflow: 'hidden' };
          return (
            <div key={c.id} className="ccl-sheet">
              <div style={{ textAlign: 'center', fontSize: 18, fontWeight: 700, lineHeight: 1.3, marginBottom: 4 }}>{title(c)}</div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 6 }}>
                <span>導師：<b>{c.homeroom || '　　　'}</b></span>
                <span>全班 <b>{list.length}</b> 人　已參加社團 <b>{joined}</b> 人　未參加 <b>{list.length - joined}</b> 人</span>
              </div>
              <table style={{ borderCollapse: 'collapse', width: '100%', tableLayout: 'fixed' }}>
                <colgroup>
                  <col style={{ width: '12mm' }} />
                  <col style={{ width: '24mm' }} />
                  <col style={{ width: '40mm' }} />
                  <col />
                  <col style={{ width: '32mm' }} />
                </colgroup>
                <thead>
                  <tr style={{ background: '#f3f3f3' }}>
                    {['座號', '學號', '姓名', '社團', '指導老師'].map((h) => (
                      <th key={h} style={{ ...cell, height: `${rowMm}mm`, textAlign: 'center', fontWeight: 600 }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {list.map((s) => (
                    <tr key={s.student_no} style={{ height: `${rowMm}mm` }}>
                      <td style={{ ...cell, textAlign: 'center' }}>{s.seat_no}</td>
                      <td style={{ ...cell, textAlign: 'center' }}>{s.student_no}</td>
                      <td style={{ ...cell, fontWeight: 600 }}>{s.name}</td>
                      <td style={cell}>{s.club}</td>
                      <td style={cell}>{s.teacher}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        })}
    </main>
  );
}
