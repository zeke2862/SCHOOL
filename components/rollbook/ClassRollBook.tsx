'use client';

import { Fragment, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { resolveCurrentTerm } from '@/lib/academicTerm';

type ClassRow = { id: string; department: string; grade_level: string; class_name: string; homeroom_teacher_id: string | null };
type Student = { seat_no: number; student_no: string; name: string; gender: string | null };
type Mode = 'term' | 'week';

const DEPT_ORDER = ['幼兒園', '國小', '國中', '高中'];
const GRADE_ORDER = ['幼乙', '幼甲', '1年', '2年', '3年', '4年', '5年', '6年', '初一', '初二', '初三', '高一', '高二', '高三'];
const CLASS_ORDER = ['忠', '孝', '仁', '愛'];
const WEEKDAY_LABELS = ['一', '二', '三', '四', '五', '六'];
const WEEKS_PER_PAGE = 2;
const MIN_ROWS = 0;

const classLabel = (c: ClassRow) => `${c.grade_level}${c.class_name}班`;

function sortClasses(list: ClassRow[]) {
  const idx = (arr: string[], v: string) => {
    const i = arr.indexOf(v);
    return i === -1 ? 99 : i;
  };
  return [...list].sort(
    (a, b) =>
      idx(DEPT_ORDER, a.department) - idx(DEPT_ORDER, b.department) ||
      idx(GRADE_ORDER, a.grade_level) - idx(GRADE_ORDER, b.grade_level) ||
      idx(CLASS_ORDER, a.class_name) - idx(CLASS_ORDER, b.class_name)
  );
}

function parseDate(s: string) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

// 從開學日那週的星期一，排到期末考結束那一週；每週只列星期一到星期六
function buildWeeks(startStr: string, endStr: string): Date[][] {
  const start = parseDate(startStr);
  const end = parseDate(endStr);
  const first = new Date(start);
  first.setDate(first.getDate() - ((first.getDay() + 6) % 7));
  const weeks: Date[][] = [];
  for (let monday = new Date(first); monday <= end; monday.setDate(monday.getDate() + 7)) {
    const days: Date[] = [];
    for (let i = 0; i < 6; i++) {
      const d = new Date(monday);
      d.setDate(monday.getDate() + i);
      days.push(d);
    }
    weeks.push(days);
  }
  return weeks;
}

const cell: React.CSSProperties = { border: '1px solid #333', padding: 0, textAlign: 'center', fontSize: 9, height: 17, lineHeight: '17px' };
const head: React.CSSProperties = { ...cell, background: '#f3f3f3', fontWeight: 600 };
// 整學期（橫式 A4）用較小的格子，讓兩週的每日每節都放得下
const cellS: React.CSSProperties = { ...cell, fontSize: 8, height: 13, lineHeight: '13px' };
const headS: React.CSSProperties = { ...cellS, background: '#f3f3f3', fontWeight: 600 };

function SheetHeader({ title, cls, teacher, subtitle }: { title: string; cls: string; teacher: string; subtitle: string }) {
  return (
    <div style={{ marginBottom: 4 }}>
      <div style={{ textAlign: 'center', fontSize: 14, fontWeight: 700 }}>{title}</div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, marginTop: 2 }}>
        <span>
          班級：<b>{cls}</b>　導師：<b>{teacher || '　　　'}</b>
        </span>
        <span>{subtitle}</span>
      </div>
      <div style={{ fontSize: 9, color: '#444' }}>符號：曠課10　遲到1　病假2　事假3　公假4　早退5（出席不必記號）</div>
    </div>
  );
}

export default function ClassRollBook() {
  const [classes, setClasses] = useState<ClassRow[]>([]);
  const [teachers, setTeachers] = useState<Record<string, string>>({});
  const [periodCfg, setPeriodCfg] = useState<Record<string, Record<number, number>>>({});
  const [term, setTerm] = useState<{ academic_year: number; term: string } | null>(null);
  const [dates, setDates] = useState<{ start: string; end: string } | null>(null);
  const [mode, setMode] = useState<Mode>('week');
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [students, setStudents] = useState<Record<string, Student[]>>({});
  const [loading, setLoading] = useState(true);
  const [building, setBuilding] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    (async () => {
      const t = await resolveCurrentTerm();
      setTerm(t);
      if (!t) {
        setError('讀不到目前學期，請先到「學年學期管理」設定。');
        setLoading(false);
        return;
      }
      const [{ data: cls, error: e1 }, { data: tch }, { data: pc }, { data: tr }] = await Promise.all([
        supabase.from('classes').select('id, department, grade_level, class_name, homeroom_teacher_id').eq('academic_year', t.academic_year),
        supabase.from('teachers').select('id, name'),
        supabase.from('period_config').select('scope, scope_ref, weekday, period_count'),
        supabase.from('academic_terms').select('term_start_date, term_end_date').eq('academic_year', t.academic_year).eq('term', t.term).maybeSingle(),
      ]);
      if (e1) setError('讀取班級失敗：' + e1.message);
      setClasses(sortClasses((cls ?? []) as ClassRow[]));
      setTeachers(Object.fromEntries((tch ?? []).map((x: any) => [x.id, x.name])));
      const cfg: Record<string, Record<number, number>> = {};
      (pc ?? []).forEach((r: any) => {
        const k = r.scope === '部別' ? r.scope_ref : '全校';
        (cfg[k] ||= {})[r.weekday] = r.period_count;
      });
      setPeriodCfg(cfg);
      if (tr?.term_start_date && tr?.term_end_date) setDates({ start: tr.term_start_date, end: tr.term_end_date });
      setLoading(false);
    })();
  }, []);

  const periodsFor = (dept: string, weekday: number) => periodCfg[dept]?.[weekday] ?? periodCfg['全校']?.[weekday] ?? (weekday === 6 ? 5 : 3);

  const pickedClasses = useMemo(() => classes.filter((c) => picked.has(c.id)), [classes, picked]);
  const weeks = useMemo(() => (dates ? buildWeeks(dates.start, dates.end) : []), [dates]);

  // 選了班級就去取名單（只取座號、學號、姓名）
  useEffect(() => {
    if (!term) return;
    const need = pickedClasses.filter((c) => !students[c.id]);
    if (need.length === 0) return;
    let active = true;
    setBuilding(true);
    (async () => {
      const results = await Promise.all(
        need.map(async (c) => {
          const { data, error: e } = await supabase.rpc('class_roll_book', { p_class_id: c.id, p_term: term.term });
          return [c.id, e ? null : ((data ?? []) as Student[]), e?.message] as const;
        })
      );
      if (!active) return;
      const next = { ...students };
      let err = '';
      results.forEach(([id, rows, msg]) => {
        if (rows) next[id] = rows;
        else err = '讀取名單失敗：' + msg;
      });
      setStudents(next);
      setError(err);
      setBuilding(false);
    })();
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pickedClasses, term]);

  function toggle(id: string) {
    setPicked((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }
  function toggleGroup(ids: string[]) {
    setPicked((prev) => {
      const n = new Set(prev);
      const all = ids.every((i) => n.has(i));
      ids.forEach((i) => (all ? n.delete(i) : n.add(i)));
      return n;
    });
  }

  const byDept = DEPT_ORDER.map((d) => ({ dept: d, list: classes.filter((c) => c.department === d) })).filter((g) => g.list.length > 0);
  const termTitle = term ? `華雲學校 佛曆 ${term.academic_year + 543} (${term.academic_year}) 學年度 ${term.term === '上學期' ? '上' : '下'} 學期　班級點名冊` : '班級點名冊';
  const ready = pickedClasses.length > 0 && pickedClasses.every((c) => students[c.id]);

  function renderWeekSheet(c: ClassRow) {
    const list = students[c.id] ?? [];
    const dayPeriods = WEEKDAY_LABELS.map((_, i) => Math.max(1, periodsFor(c.department, i + 1)));
    return (
      <div key={c.id} className="rollbook-sheet">
        <SheetHeader title={termTitle} cls={classLabel(c)} teacher={teachers[c.homeroom_teacher_id ?? ''] ?? ''} subtitle="一週點名表（日期請手寫）" />
        <table style={{ borderCollapse: 'collapse', width: '100%', tableLayout: 'fixed' }}>
          <thead>
            <tr>
              <th rowSpan={3} style={{ ...head, width: 24 }}>座號</th>
              <th rowSpan={3} style={{ ...head, width: 52 }}>學號</th>
              <th rowSpan={3} style={{ ...head, width: 64 }}>姓名</th>
              {WEEKDAY_LABELS.map((w, i) => (
                <th key={w} colSpan={dayPeriods[i]} style={head}>
                  星期{w}
                </th>
              ))}
            </tr>
            <tr>
              {WEEKDAY_LABELS.map((w, i) => (
                <th key={w} colSpan={dayPeriods[i]} style={{ ...head, fontWeight: 400, height: 17 }}>
                  　月　日
                </th>
              ))}
            </tr>
            <tr>
              {WEEKDAY_LABELS.map((w, i) =>
                Array.from({ length: dayPeriods[i] }, (_, p) => (
                  <th key={w + p} style={{ ...head, fontWeight: 400 }}>
                    {p + 1}
                  </th>
                ))
              )}
            </tr>
          </thead>
          <tbody>
            {list.map((s) => (
              <tr key={s.student_no}>
                <td style={cell}>{s.seat_no}</td>
                <td style={cell}>{s.student_no}</td>
                <td style={{ ...cell, textAlign: 'left', paddingLeft: 3, whiteSpace: 'nowrap', overflow: 'hidden' }}>{s.name}</td>
                {dayPeriods.map((n, i) => Array.from({ length: n }, (_, p) => <td key={i + '-' + p} style={cell}></td>))}
              </tr>
            ))}
            {list.length === 0 && (
              <tr>
                <td colSpan={3 + dayPeriods.reduce((a, b) => a + b, 0)} style={cell}>
                  這個班目前沒有在學學生
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    );
  }

  function renderTermSheets(c: ClassRow) {
    const list = students[c.id] ?? [];
    const dayPeriods = WEEKDAY_LABELS.map((_, i) => Math.max(1, periodsFor(c.department, i + 1)));
    const perWeek = dayPeriods.reduce((a, b) => a + b, 0);
    const pages: Date[][][] = [];
    for (let i = 0; i < weeks.length; i += WEEKS_PER_PAGE) pages.push(weeks.slice(i, i + WEEKS_PER_PAGE));
    return pages.map((pg, pi) => (
      <div key={c.id + '-' + pi} className="rollbook-sheet">
        <SheetHeader
          title={termTitle}
          cls={classLabel(c)}
          teacher={teachers[c.homeroom_teacher_id ?? ''] ?? ''}
          subtitle={`整學期點名表　第 ${pi + 1}／${pages.length} 頁（第 ${pi * WEEKS_PER_PAGE + 1}～${pi * WEEKS_PER_PAGE + pg.length} 週）`}
        />
        <table style={{ borderCollapse: 'collapse', width: '100%', tableLayout: 'fixed' }}>
          <thead>
            <tr>
              <th rowSpan={3} style={{ ...headS, width: 22 }}>座號</th>
              <th rowSpan={3} style={{ ...headS, width: 48 }}>學號</th>
              <th rowSpan={3} style={{ ...headS, width: 58 }}>姓名</th>
              {pg.map((w, wi) => (
                <th key={wi} colSpan={perWeek} style={headS}>
                  第 {pi * WEEKS_PER_PAGE + wi + 1} 週
                </th>
              ))}
            </tr>
            <tr>
              {pg.map((w, wi) =>
                w.map((d, di) => (
                  <th key={wi + '-' + di} colSpan={dayPeriods[di]} style={{ ...headS, fontWeight: 400 }}>
                    {d.getMonth() + 1}/{d.getDate()}（{WEEKDAY_LABELS[di]}）
                  </th>
                ))
              )}
            </tr>
            <tr>
              {pg.map((w, wi) =>
                w.map((d, di) => Array.from({ length: dayPeriods[di] }, (_, p) => (
                  <th key={wi + '-' + di + '-' + p} style={{ ...headS, fontWeight: 400 }}>
                    {p + 1}
                  </th>
                )))
              )}
            </tr>
          </thead>
          <tbody>
            {list.map((s) => (
              <tr key={s.student_no}>
                <td style={cellS}>{s.seat_no}</td>
                <td style={cellS}>{s.student_no}</td>
                <td style={{ ...cellS, textAlign: 'left', paddingLeft: 3, whiteSpace: 'nowrap', overflow: 'hidden' }}>{s.name}</td>
                {pg.map((w, wi) => w.map((d, di) => Array.from({ length: dayPeriods[di] }, (_, p) => <td key={wi + '-' + di + '-' + p} style={cellS}></td>)))}
              </tr>
            ))}
            {list.length === 0 && (
              <tr>
                <td colSpan={3 + pg.length * perWeek} style={cellS}>
                  這個班目前沒有在學學生
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    ));
  }

  if (loading) return <p style={{ padding: 24, fontSize: 13, color: '#999' }}>載入中…</p>;

  return (
    <main style={{ maxWidth: 1000, margin: '0 auto', padding: 16 }}>
      <style>{`
        @page { size: A4 ${mode === 'term' ? 'landscape' : 'portrait'}; margin: 8mm; }
        @media print {
          .no-print { display: none !important; }
          .rollbook-sheet { page-break-after: always; break-after: page; margin: 0 !important; }
          .rollbook-sheet:last-child { page-break-after: auto; break-after: auto; }
          body { background: #fff !important; }
        }
        .rollbook-sheet { background: #fff; padding: 8px; margin: 0 0 16px; border: 1px dashed #ccc; }
        @media print { .rollbook-sheet { border: none; padding: 0; } }
      `}</style>

      <div className="no-print">
        <h1 style={{ fontSize: 16, marginBottom: 4 }}>班級點名冊</h1>
        <p style={{ fontSize: 12, color: '#666', marginBottom: 12 }}>
          選好班級與列印方式後按「列印」。「一週」不印日期，節數依各部別的節次設定；「整學期」從開學日印到期末考結束（橫式），每頁 2 週，每天依節數分格，附日期。名單只含在學學生（休學、轉學不會出現）。
        </p>
        {error && <p style={{ fontSize: 13, color: '#A32D2D', marginBottom: 8 }}>{error}</p>}

        <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
          {(
            [
              ['week', '一週'],
              ['term', '整學期'],
            ] as const
          ).map(([k, label]) => (
            <button
              key={k}
              type="button"
              onClick={() => setMode(k)}
              style={{ padding: '6px 18px', borderRadius: 6, border: '1px solid #ccc', background: mode === k ? '#EAF3DE' : '#fff', fontWeight: mode === k ? 600 : 400 }}
            >
              {label}
            </button>
          ))}
          {mode === 'term' && (
            <span style={{ fontSize: 12, color: dates ? '#666' : '#A32D2D', alignSelf: 'center' }}>
              {dates ? `期間：${dates.start} ～ ${dates.end}（共 ${weeks.length} 週）` : '尚未設定本學期開學日／結束日，請洽教務處到「學年學期管理」填寫'}
            </span>
          )}
        </div>

        <div style={{ border: '1px solid #eee', borderRadius: 8, padding: 10, marginBottom: 12 }}>
          <div style={{ display: 'flex', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
            <button type="button" onClick={() => setPicked(new Set(classes.map((c) => c.id)))} style={{ padding: '4px 12px' }}>
              全選（全校 {classes.length} 班）
            </button>
            <button type="button" onClick={() => setPicked(new Set())} style={{ padding: '4px 12px' }}>
              全部取消
            </button>
          </div>
          {byDept.map((g) => (
            <div key={g.dept} style={{ marginBottom: 6 }}>
              <label style={{ fontSize: 13, fontWeight: 600, marginRight: 8 }}>
                <input type="checkbox" checked={g.list.every((c) => picked.has(c.id))} onChange={() => toggleGroup(g.list.map((c) => c.id))} /> {g.dept}
              </label>
              {g.list.map((c) => (
                <label key={c.id} style={{ fontSize: 13, marginRight: 12, whiteSpace: 'nowrap' }}>
                  <input type="checkbox" checked={picked.has(c.id)} onChange={() => toggle(c.id)} /> {classLabel(c)}
                </label>
              ))}
            </div>
          ))}
        </div>

        <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 16 }}>
          <button
            type="button"
            onClick={() => window.print()}
            disabled={!ready || building || (mode === 'term' && !dates)}
            style={{ padding: '8px 24px', fontWeight: 600 }}
          >
            列印{pickedClasses.length > 0 ? `（${pickedClasses.length} 班）` : ''}
          </button>
          {building && <span style={{ fontSize: 12, color: '#999' }}>讀取名單中…</span>}
          {pickedClasses.length === 0 && <span style={{ fontSize: 12, color: '#999' }}>請先勾選班級</span>}
        </div>
      </div>

      {ready && pickedClasses.map((c) => <Fragment key={c.id}>{mode === 'week' ? renderWeekSheet(c) : dates ? renderTermSheets(c) : null}</Fragment>)}
    </main>
  );
}
