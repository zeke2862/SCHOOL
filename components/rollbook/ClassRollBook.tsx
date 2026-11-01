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

// A4 直式、邊界 8mm：可用高度 281mm。扣掉標題區與表頭後，剩下給學生列的高度（mm）
const ROWS_AREA_MM = 238;
const ROW_MAX_MM = 10;
const ROW_MIN_MM = 4.6;

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

// 同一天的節次格用虛線，換天用粗實線
const THICK = '2px solid #000';
const THIN = '1px solid #333';
const DASH = '1px dashed #777';

function SheetHeader({ title, cls, teacher, subtitle }: { title: string; cls: string; teacher: string; subtitle: string }) {
  return (
    <div style={{ marginBottom: 2 }}>
      <div style={{ textAlign: 'center', fontSize: 16, fontWeight: 700 }}>{title}</div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginTop: 2 }}>
        <span>
          班級：<b>{cls}</b>　導師：<b>{teacher || '　　　'}</b>
        </span>
        <span>{subtitle}</span>
      </div>
      <div style={{ fontSize: 11, color: '#333' }}>符號：曠課10　遲到1　病假2　事假3　公假4　早退5（出席不必記號）</div>
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

  // 一頁＝一個班的一週。days 有給就在每天的表頭印出日期（整學期），沒給就留「　月　日」讓老師手寫（一週）
  function renderSheet(c: ClassRow, key: string, days: Date[] | null, subtitle: string) {
    const list = students[c.id] ?? [];
    const dayPeriods = WEEKDAY_LABELS.map((_, i) => Math.max(1, periodsFor(c.department, i + 1)));
    const total = dayPeriods.reduce((a, b) => a + b, 0);
    const rowMm = Math.min(ROW_MAX_MM, Math.max(ROW_MIN_MM, ROWS_AREA_MM / Math.max(list.length, 1)));
    const hdrMm = 6;
    const thCommon = { border: THIN, background: '#f3f3f3', padding: 0, textAlign: 'center' as const, fontSize: 12, height: `${hdrMm}mm`, fontWeight: 600 };

    // 一天的第一格左邊用粗線，最右邊整張表的外框用粗線
    const dayStart: boolean[] = [];
    dayPeriods.forEach((n) => {
      for (let p = 0; p < n; p++) dayStart.push(p === 0);
    });
    const periodCell = (idx: number): React.CSSProperties => ({
      borderTop: THIN,
      borderBottom: THIN,
      borderLeft: dayStart[idx] ? THICK : DASH,
      borderRight: idx === total - 1 ? THICK : undefined,
      padding: 0,
    });

    return (
      <div key={key} className="rollbook-sheet">
        <SheetHeader title={termTitle} cls={classLabel(c)} teacher={teachers[c.homeroom_teacher_id ?? ''] ?? ''} subtitle={subtitle} />
        <table style={{ borderCollapse: 'collapse', width: '100%', tableLayout: 'fixed' }}>
          <colgroup>
            <col style={{ width: '9mm' }} />
            <col style={{ width: '17mm' }} />
            <col style={{ width: '27mm' }} />
            {Array.from({ length: total }, (_, i) => (
              <col key={i} />
            ))}
          </colgroup>
          <thead>
            <tr>
              <th rowSpan={3} style={thCommon}>座號</th>
              <th rowSpan={3} style={thCommon}>學號</th>
              <th rowSpan={3} style={thCommon}>姓名</th>
              {WEEKDAY_LABELS.map((w, i) => (
                <th key={w} colSpan={dayPeriods[i]} style={{ ...thCommon, borderLeft: THICK, borderRight: i === 5 ? THICK : undefined }}>
                  星期{w}
                </th>
              ))}
            </tr>
            <tr>
              {WEEKDAY_LABELS.map((w, i) => (
                <th key={w} colSpan={dayPeriods[i]} style={{ ...thCommon, fontWeight: 400, borderLeft: THICK, borderRight: i === 5 ? THICK : undefined }}>
                  {days ? `${days[i].getMonth() + 1}/${days[i].getDate()}` : '　月　日'}
                </th>
              ))}
            </tr>
            <tr>
              {(() => {
                let idx = 0;
                return dayPeriods.map((n, i) =>
                  Array.from({ length: n }, (_, p) => {
                    const myIdx = idx++;
                    return (
                      <th key={i + '-' + p} style={{ ...thCommon, fontWeight: 400, borderLeft: dayStart[myIdx] ? THICK : DASH, borderRight: myIdx === total - 1 ? THICK : undefined }}>
                        {p + 1}
                      </th>
                    );
                  })
                );
              })()}
            </tr>
          </thead>
          <tbody>
            {list.map((s) => (
              <tr key={s.student_no} style={{ height: `${rowMm}mm` }}>
                <td style={{ border: THIN, textAlign: 'center', fontSize: 12, padding: 0 }}>{s.seat_no}</td>
                <td style={{ border: THIN, textAlign: 'center', fontSize: 11, padding: 0 }}>{s.student_no}</td>
                <td style={{ border: THIN, textAlign: 'left', paddingLeft: 4, fontSize: 15, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden' }}>{s.name}</td>
                {Array.from({ length: total }, (_, i) => (
                  <td key={i} style={periodCell(i)}></td>
                ))}
              </tr>
            ))}
            {list.length === 0 && (
              <tr>
                <td colSpan={3 + total} style={{ border: THIN, textAlign: 'center', fontSize: 12, height: '10mm' }}>
                  這個班目前沒有在學學生
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    );
  }

  function renderClass(c: ClassRow) {
    if (mode === 'week') return renderSheet(c, c.id, null, '一週點名表（日期請手寫）');
    if (!dates) return null;
    const sheets = weeks.map((w, wi) => renderSheet(c, `${c.id}-${wi}`, w, `整學期點名表　第 ${wi + 1}／${weeks.length} 週`));
    // 雙面列印：每個班的頁數補成偶數，下一個班才會從新的一張紙正面開始
    if (sheets.length % 2 === 1) {
      sheets.push(
        <div key={`${c.id}-blank`} className="rollbook-sheet rollbook-blank">
          <span className="no-print" style={{ fontSize: 12, color: '#999' }}>
            （{classLabel(c)} 補一頁空白，讓雙面列印時下一個班從新的一張紙開始；列印時此頁是空白）
          </span>
        </div>
      );
    }
    return sheets;
  }

  if (loading) return <p style={{ padding: 24, fontSize: 13, color: '#999' }}>載入中…</p>;

  return (
    <main style={{ maxWidth: 1000, margin: '0 auto', padding: 16 }}>
      <style>{`
        @page { size: A4 portrait; margin: 8mm; }
        @media print {
          .no-print { display: none !important; }
          .rollbook-sheet { page-break-after: always; break-after: page; margin: 0 !important; height: 281mm; overflow: hidden; }
          .rollbook-sheet:last-child { page-break-after: auto; break-after: auto; }
          body { background: #fff !important; }
        }
        .rollbook-sheet { background: #fff; padding: 8px; margin: 0 0 16px; border: 1px dashed #ccc; box-sizing: border-box; }
        .rollbook-blank { min-height: 40px; }
        @media print { .rollbook-sheet { border: none; padding: 0; } }
      `}</style>

      <div className="no-print">
        <h1 style={{ fontSize: 16, marginBottom: 4 }}>班級點名冊</h1>
        <p style={{ fontSize: 12, color: '#666', marginBottom: 12 }}>
          選好班級與列印方式後按「列印」，A4 直式。「一週」不印日期；「整學期」從開學日印到期末考結束，一週一頁，每天印出日期，建議使用雙面列印（每班頁數會補成偶數）。節數依各部別的節次設定，名單只含在學學生（休學、轉學不會出現）。
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
              {dates ? `期間：${dates.start} ～ ${dates.end}（共 ${weeks.length} 週，每班約 ${weeks.length + (weeks.length % 2)} 頁）` : '尚未設定本學期開學日／結束日，請洽教務處到「學年學期管理」填寫'}
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

      {ready && pickedClasses.map((c) => <Fragment key={c.id}>{renderClass(c)}</Fragment>)}
    </main>
  );
}
