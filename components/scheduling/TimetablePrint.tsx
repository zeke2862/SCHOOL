'use client';

import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { resolveCurrentTerm } from '@/lib/academicTerm';
import {
  buildAllTeachersWorkbook,
  buildClassesWorkbook,
  buildDutyWorkbook,
  buildTeachersWorkbook,
  downloadWorkbook,
} from '@/lib/timetableExcel';
import TimetableSheet from '@/components/scheduling/TimetableSheet';
import { DEFAULT_TEMPLATE, TimetableTemplate, fillTemplate, loadTemplate, saveTemplate } from '@/lib/timetableTemplate';

// ============================================================
// 列印課表：全校教師任課表／各教師課表／課表模板／各班課表／值日教師參考
// ------------------------------------------------------------
// 資料全部直接從資料庫的「班級課表」(class_schedule) 即時產生，不用再開 Excel 巨集。
// 無導師的班級不印；沒有任何課的教師不印。標題、備註、上課時間在「課表模板」分頁修改。
// ============================================================

type ClassRow = { id: string; department: string; grade_level: string; class_name: string; homeroom_teacher_id: string | null };
type TeacherRow = { id: string; name: string };
type Slot = { class_id: string; teacher_id: string; weekday: number; period_no: number; subject: string };

const WEEKDAYS = ['一', '二', '三', '四', '五', '六'];
const SLOTS: { weekday: number; period: number }[] = [
  ...[1, 2, 3, 4, 5].flatMap((w) => [1, 2, 3].map((p) => ({ weekday: w, period: p }))),
  ...[1, 2, 3, 4, 5].map((p) => ({ weekday: 6, period: p })),
];
const GRADE_ORDER = ['幼乙', '幼甲', '1年', '2年', '3年', '4年', '5年', '6年', '初一', '初二', '初三', '高一', '高二', '高三'];
const NAME_ORDER = ['忠', '孝', '仁', '愛'];
const CN = ['', '一', '二', '三', '四', '五', '六'];

function classLabel(c: ClassRow): string {
  const m = /^(\d)年$/.exec(c.grade_level);
  if (m) return `${CN[Number(m[1])]}年級${c.class_name}`;
  return `${c.grade_level}${c.class_name}`;
}
function classRank(c: ClassRow): [number, number, string] {
  const g = GRADE_ORDER.indexOf(c.grade_level);
  const n = NAME_ORDER.indexOf(c.class_name);
  return [g < 0 ? 99 : g, n < 0 ? 99 : n, c.class_name];
}

const CSS = `
.tt-page{page-break-after:always;break-after:page;padding:6mm 4mm;font-family:"Microsoft JhengHei","PingFang TC",sans-serif;color:#000;background:#fff}
.tt-page:last-child{page-break-after:auto;break-after:auto}
.tt-head{display:flex;justify-content:space-between;align-items:baseline;border-bottom:2px solid #000;padding-bottom:4px;margin-bottom:8px}
.tt-head h1{font-size:22px;margin:0;letter-spacing:3px}
.tt-head .who{font-size:18px;font-weight:bold}
.tt-row{display:flex;gap:10px;align-items:flex-start}
.tt-table{border-collapse:collapse;table-layout:fixed}
.tt-table th,.tt-table td{border:1px solid #000;text-align:center;vertical-align:middle;padding:2px;font-size:13px;overflow:hidden}
.tt-table th{background:#eee;font-weight:bold}
.tt-time{white-space:pre-line;font-size:11px;width:58px}
.tt-cell{height:78px}
.tt-cell .top{font-size:15px;font-weight:bold;line-height:1.3}
.tt-cell .bottom{font-size:11px;color:#333;margin-top:2px}
.tt-sat .tt-cell{height:47px}
.tt-sat .tt-cell .top{font-size:13px}
.tt-note{margin-top:8px;font-size:12px;white-space:pre-line;border:1px solid #000;padding:6px 8px}
.tt-note b{display:block;margin-bottom:3px;font-size:13px}
.tt-wide{border-collapse:collapse;width:100%;table-layout:fixed}
.tt-wide th,.tt-wide td{border:1px solid #000;text-align:center;padding:1px;font-size:10px;overflow:hidden}
.tt-wide th{background:#eee}
.tt-wide .nm{width:56px;font-weight:bold;font-size:11px}
.tt-wide .cl{font-size:9px;color:#333;line-height:1.1}
.tt-wide .sb{font-size:10px;font-weight:bold;line-height:1.2}
.tt-wide thead{display:table-header-group}
.tt-wide tr{page-break-inside:avoid}
.tt-wide .sep{border-top:2px solid #000}
.tt-duty td{vertical-align:top;font-size:11px;line-height:1.5}
.tt-duty .lab{width:44px;font-weight:bold;writing-mode:vertical-rl;letter-spacing:6px;font-size:14px}
`;

type SubTab = 'all' | 'teachers' | 'template' | 'classes' | 'duty';
const SUBTABS: { key: SubTab; label: string }[] = [
  { key: 'all', label: '全校教師任課表' },
  { key: 'teachers', label: '各教師課表' },
  { key: 'template', label: '課表模板' },
  { key: 'classes', label: '各班課表' },
  { key: 'duty', label: '值日教師參考' },
];

export default function TimetablePrint() {
  const [tab, setTab] = useState<SubTab>('all');
  const [term, setTerm] = useState<{ academic_year: number; term: string } | null>(null);
  const [classes, setClasses] = useState<ClassRow[]>([]);
  const [teachers, setTeachers] = useState<TeacherRow[]>([]);
  const [slots, setSlots] = useState<Slot[]>([]);
  const [periodCfg, setPeriodCfg] = useState<Record<string, Record<number, number>>>({});
  const [tpl, setTpl] = useState<TimetableTemplate>(DEFAULT_TEMPLATE);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [pick, setPick] = useState('all');
  const [exporting, setExporting] = useState(false);

  async function load() {
    setLoading(true);
    setError('');
    const t = await resolveCurrentTerm();
    setTerm(t);
    if (!t) {
      setError('讀不到目前學期，請先到「學年學期管理」設定。');
      setLoading(false);
      return;
    }
    const [{ data: cls, error: e1 }, { data: tch }, { data: pc }, template] = await Promise.all([
      supabase.from('classes').select('id, department, grade_level, class_name, homeroom_teacher_id').eq('academic_year', t.academic_year),
      supabase.from('teachers').select('id, name').order('name'),
      supabase.from('period_config').select('scope, scope_ref, weekday, period_count'),
      loadTemplate(),
    ]);
    if (e1) setError('讀取班級失敗：' + e1.message);
    const rows: Slot[] = [];
    for (let from = 0; ; from += 1000) {
      const { data } = await supabase
        .from('class_schedule')
        .select('class_id, teacher_id, weekday, period_no, subject')
        .eq('academic_year', t.academic_year)
        .eq('term', t.term)
        .not('weekday', 'is', null)
        .not('period_no', 'is', null)
        .order('id')
        .range(from, from + 999);
      rows.push(...((data ?? []) as Slot[]));
      if (!data || data.length < 1000) break;
    }
    const cfg: Record<string, Record<number, number>> = {};
    (pc ?? []).forEach((r: any) => {
      const k = r.scope === '部別' ? r.scope_ref : '全校';
      (cfg[k] ||= {})[r.weekday] = r.period_count;
    });
    setClasses((cls ?? []) as ClassRow[]);
    setTeachers((tch ?? []) as TeacherRow[]);
    setSlots(rows);
    setPeriodCfg(cfg);
    setTpl(template);
    setLoading(false);
  }
  useEffect(() => {
    load();
  }, []);
  useEffect(() => setPick('all'), [tab]);

  const sortedClasses = useMemo(
    () => [...classes].sort((a, b) => {
      const x = classRank(a), y = classRank(b);
      return x[0] - y[0] || x[1] - y[1] || x[2].localeCompare(y[2], 'zh-Hant');
    }),
    [classes]
  );
  const classById = useMemo(() => new Map(classes.map((c) => [c.id, c])), [classes]);
  const teacherById = useMemo(() => new Map(teachers.map((t) => [t.id, t])), [teachers]);
  const bySlotClass = useMemo(() => {
    const m = new Map<string, Slot>();
    slots.forEach((s) => m.set(`${s.class_id}|${s.weekday}|${s.period_no}`, s));
    return m;
  }, [slots]);
  const byTeacher = useMemo(() => {
    const m = new Map<string, Map<string, Slot[]>>();
    slots.forEach((s) => {
      const tm = m.get(s.teacher_id) ?? new Map<string, Slot[]>();
      const k = `${s.weekday}|${s.period_no}`;
      tm.set(k, [...(tm.get(k) ?? []), s]);
      m.set(s.teacher_id, tm);
    });
    return m;
  }, [slots]);

  // 雜訊：欄位貼錯位時，科目名稱或班級名稱被當成「老師」存進了教師資料（例如「弟子規」「才藝」「一年忠」），
  // 還有測試帳號、測試班。這些不印、也不當成老師顯示。
  const subjectNames = useMemo(() => new Set(slots.map((s) => s.subject)), [slots]);
  const classLabelSet = useMemo(() => new Set(classes.map(classLabel)), [classes]);
  const isNoiseTeacher = (t: TeacherRow) =>
    t.name.startsWith('測試') || subjectNames.has(t.name) || classLabelSet.has(t.name) || /^[一二三四五六]年[忠孝仁愛]$/.test(t.name);
  const isTestClass = (c: ClassRow) => c.class_name.includes('測試');
  const realTeacher = (id: string | null | undefined) => {
    const t = id ? teacherById.get(id) : undefined;
    return t && !isNoiseTeacher(t) ? t : undefined;
  };

  // 教師排序：先照班級順序排導師，再排其他有課的老師（依姓名）
  const orderedTeachers = useMemo(() => {
    const seen = new Set<string>();
    const out: TeacherRow[] = [];
    sortedClasses.forEach((c) => {
      const t = realTeacher(c.homeroom_teacher_id);
      if (t && byTeacher.has(t.id) && !seen.has(t.id)) {
        seen.add(t.id);
        out.push(t);
      }
    });
    [...teachers]
      .filter((t) => byTeacher.has(t.id) && !seen.has(t.id) && !isNoiseTeacher(t))
      .sort((a, b) => a.name.localeCompare(b.name, 'zh-Hant'))
      .forEach((t) => out.push(t));
    return out;
  }, [sortedClasses, teachers, teacherById, byTeacher]);

  // 無導師的班級不印
  const printableClasses = useMemo(
    () => sortedClasses.filter((c) => !isTestClass(c) && realTeacher(c.homeroom_teacher_id) && slots.some((s) => s.class_id === c.id)),
    [sortedClasses, slots]
  );
  const skippedClasses = sortedClasses.filter((c) => !isTestClass(c) && !realTeacher(c.homeroom_teacher_id)).map(classLabel);

  const periodsFor = (dept: string, weekday: number) => periodCfg[dept]?.[weekday] ?? periodCfg['全校']?.[weekday] ?? (weekday === 6 ? 5 : 3);
  const title = (s: string) => fillTemplate(s, term?.academic_year ?? '', term?.term ?? '');

  const homeroomLabelOf = useMemo(() => {
    const m = new Map<string, string>();
    printableClasses.forEach((c) => {
      if (c.homeroom_teacher_id && !m.has(c.homeroom_teacher_id)) m.set(c.homeroom_teacher_id, classLabel(c));
    });
    return m;
  }, [printableClasses]);

  // 預覽：用跟下載的 Excel 同一套版面（TimetableSheet），所見即所印
  const sheetBox: React.CSSProperties = { margin: '0 0 28px', overflowX: 'auto' };
  const sheetCaption: React.CSSProperties = { fontSize: 12, color: '#888', margin: '0 0 6px' };

  const classPages = (list: ClassRow[]) =>
    list.map((c) => (
      <div key={c.id} style={sheetBox}>
        <div className="no-print" style={sheetCaption}>{classLabel(c)}（Excel 裡是一張工作表）</div>
        <TimetableSheet
          kind="class"
          tpl={tpl}
          term={term}
          title={classLabel(c)}
          person={realTeacher(c.homeroom_teacher_id)?.name ?? ''}
          periodsFor={(w) => periodsFor(c.department, w)}
          cell={(w, p) => {
            const x = bySlotClass.get(`${c.id}|${w}|${p}`);
            return x ? { top: x.subject, bottom: realTeacher(x.teacher_id)?.name ?? '' } : null;
          }}
        />
      </div>
    ));

  const teacherPages = (list: TeacherRow[]) => {
    let sub = 0;
    const tagOf = new Map<string, string>();
    orderedTeachers.forEach((t) => tagOf.set(t.id, homeroomLabelOf.get(t.id) ?? `副科老師${++sub}`));
    return list.map((t) => (
      <div key={t.id} style={sheetBox}>
        <div className="no-print" style={sheetCaption}>{t.name}（Excel 裡是一張工作表）</div>
        <TimetableSheet
          kind="teacher"
          tpl={tpl}
          term={term}
          title={tagOf.get(t.id) ?? ''}
          person={t.name}
          cell={(w, p) => {
            const ss = byTeacher.get(t.id)?.get(`${w}|${p}`);
            if (!ss) return null;
            return {
              top: ss.map((x) => classLabel(classById.get(x.class_id)!)).join('、'),
              bottom: Array.from(new Set(ss.map((x) => x.subject))).join('、'),
            };
          }}
        />
      </div>
    ));
  };

  const allTeachersPage = (
    <div className="tt-page">
      <div className="tt-head">
        <h1>{title(tpl.allTeachersTitle)}</h1>
      </div>
      <table className="tt-wide">
        <thead>
          <tr>
            <th className="nm" rowSpan={2}>教師</th>
            {[1, 2, 3, 4, 5].map((w) => (
              <th key={w} colSpan={3}>星期{WEEKDAYS[w - 1]}</th>
            ))}
            <th colSpan={5}>星期六</th>
          </tr>
          <tr>
            {SLOTS.map((s, i) => (
              <th key={i}>{s.period}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {orderedTeachers.map((t) => (
            <tr key={t.id} className="sep">
              <td className="nm">{t.name}</td>
              {SLOTS.map((s, i) => {
                const ss = byTeacher.get(t.id)?.get(`${s.weekday}|${s.period}`);
                return (
                  <td key={i}>
                    {ss && <div className="cl">{ss.map((x) => classLabel(classById.get(x.class_id)!)).join('、')}</div>}
                    {ss && <div className="sb">{Array.from(new Set(ss.map((x) => x.subject))).join('、')}</div>}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

  const dutyPage = (
    <div className="tt-page">
      <div className="tt-head">
        <h1>{tpl.dutyTitle}</h1>
        <span className="who">{title('{學年度}學年度 {學期}')}</span>
      </div>
      <table className="tt-wide tt-duty">
        <thead>
          <tr>
            <th className="lab" rowSpan={2} style={{ writingMode: 'horizontal-tb', letterSpacing: 0 }}>星期</th>
            {[1, 2, 3, 4, 5].map((w) => (
              <th key={w} colSpan={3}>星期{WEEKDAYS[w - 1]}</th>
            ))}
            <th colSpan={5}>星期六</th>
          </tr>
          <tr>
            {SLOTS.map((s, i) => (
              <th key={i}>第{s.period}節</th>
            ))}
          </tr>
        </thead>
        <tbody>
          <tr>
            <td className="lab">無課教師</td>
            {SLOTS.map((s, i) => (
              <td key={i}>
                {orderedTeachers
                  .filter((t) => !byTeacher.get(t.id)?.has(`${s.weekday}|${s.period}`))
                  .map((t) => (
                    <div key={t.id}>{t.name}</div>
                  ))}
              </td>
            ))}
          </tr>
        </tbody>
      </table>
    </div>
  );

  const pickedClasses = pick === 'all' ? printableClasses : printableClasses.filter((c) => c.id === pick);
  const pickedTeachers = pick === 'all' ? orderedTeachers : orderedTeachers.filter((t) => t.id === pick);

  // ---- 匯出 Excel（版面沿用原本的課程表系統 Excel，直接用 Excel 列印） ----
  const teacherCell = (id: string) => (w: number, p: number) => {
    const ss = byTeacher.get(id)?.get(`${w}|${p}`);
    if (!ss) return null;
    return {
      top: ss.map((x) => classLabel(classById.get(x.class_id)!)).join('、'),
      bottom: Array.from(new Set(ss.map((x) => x.subject))).join('、'),
    };
  };

  async function exportExcel() {
    if (!term) return;
    setExporting(true);
    try {
      const info = { year: term.academic_year, term: term.term };
      const stamp = `${term.academic_year}${term.term}`;
      if (tab === 'classes') {
        const wb = await buildClassesWorkbook(
          pickedClasses.map((c) => ({
            label: classLabel(c),
            homeroom: realTeacher(c.homeroom_teacher_id)?.name ?? '',
            periodsFor: (w: number) => periodsFor(c.department, w),
            cell: (w: number, p: number) => {
              const x = bySlotClass.get(`${c.id}|${w}|${p}`);
              return x ? { top: x.subject, bottom: realTeacher(x.teacher_id)?.name ?? '' } : null;
            },
          })),
          tpl,
          info
        );
        await downloadWorkbook(wb, `各班課表_${stamp}.xlsx`);
      } else if (tab === 'teachers') {
        let sub = 0;
        const tagOf = new Map<string, string>();
        orderedTeachers.forEach((t) => tagOf.set(t.id, homeroomLabelOf.get(t.id) ?? `副科老師${++sub}`));
        const wb = await buildTeachersWorkbook(
          pickedTeachers.map((t) => ({ name: t.name, tag: tagOf.get(t.id) ?? '', cell: teacherCell(t.id) })),
          tpl,
          info
        );
        await downloadWorkbook(wb, `各教師課表_${stamp}.xlsx`);
      } else if (tab === 'all') {
        const wb = await buildAllTeachersWorkbook(
          orderedTeachers.map((t) => ({ name: t.name, classLabel: homeroomLabelOf.get(t.id) ?? '', cell: teacherCell(t.id) })),
          tpl,
          info
        );
        await downloadWorkbook(wb, `全校教師任課表_${stamp}.xlsx`);
      } else if (tab === 'duty') {
        const names = SLOTS.map((s) => orderedTeachers.filter((t) => !byTeacher.get(t.id)?.has(`${s.weekday}|${s.period}`)).map((t) => t.name));
        const wb = await buildDutyWorkbook(names, tpl, info);
        await downloadWorkbook(wb, `值日教師參考_${stamp}.xlsx`);
      }
    } catch (e: any) {
      alert('產生 Excel 失敗：' + (e?.message ?? e));
    } finally {
      setExporting(false);
    }
  }

  // ---- 模板編輯 ----
  const [draft, setDraft] = useState<TimetableTemplate>(DEFAULT_TEMPLATE);
  const [saveMsg, setSaveMsg] = useState('');
  useEffect(() => setDraft(tpl), [tpl]);
  const setD = (patch: Partial<TimetableTemplate>) => setDraft((d) => ({ ...d, ...patch }));

  async function doSave() {
    setSaveMsg('儲存中…');
    const err = await saveTemplate(draft);
    if (err) setSaveMsg('❌ 儲存失敗：' + err + (/row-level|policy|permission/i.test(err) ? '（教務處要先執行 sql/111_timetable_template_policy.sql 才能修改）' : ''));
    else {
      setTpl(draft);
      setSaveMsg('✅ 已儲存，所有列印頁都會套用');
    }
  }

  const btn: React.CSSProperties = { padding: '6px 14px', fontSize: 13, cursor: 'pointer' };

  return (
    <div style={{ padding: '4px 12px 24px' }}>
      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', margin: '8px 0 10px' }}>
        {SUBTABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            style={{ ...btn, background: tab === t.key ? '#2C2C2A' : '#fff', color: tab === t.key ? '#fff' : '#2C2C2A', border: '1px solid #2C2C2A', borderRadius: 6 }}
          >
            {t.label}
          </button>
        ))}
        <span style={{ fontSize: 12, color: '#888', alignSelf: 'center', marginLeft: 8 }}>
          {term ? `${term.academic_year} 學年度 ${term.term}` : ''}
        </span>
      </div>

      {loading && <p style={{ fontSize: 13, color: '#999' }}>讀取課表中…</p>}
      {error && <p style={{ fontSize: 13, color: '#A32D2D' }}>{error}</p>}

      {!loading && tab !== 'template' && (
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginBottom: 12 }}>
          {tab === 'classes' && (
            <select value={pick} onChange={(e) => setPick(e.target.value)} style={{ padding: 6 }}>
              <option value="all">全部班級（{printableClasses.length} 班）</option>
              {printableClasses.map((c) => (
                <option key={c.id} value={c.id}>{classLabel(c)}</option>
              ))}
            </select>
          )}
          {tab === 'teachers' && (
            <select value={pick} onChange={(e) => setPick(e.target.value)} style={{ padding: 6 }}>
              <option value="all">全部教師（{orderedTeachers.length} 位）</option>
              {orderedTeachers.map((t) => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
          )}
          <button onClick={exportExcel} disabled={exporting} style={{ ...btn, background: '#1D6F42', color: '#fff', border: 'none', borderRadius: 6 }}>
            {exporting ? '產生中…' : `📊 下載 Excel${tab === 'classes' || tab === 'teachers' ? (pick === 'all' ? '（全部，一班／一人一張工作表）' : '（這一份）') : ''}`}
          </button>
          {tab === 'classes' && skippedClasses.length > 0 && (
            <span style={{ fontSize: 12, color: '#A36A00' }}>沒有導師、不列印的班級：{skippedClasses.join('、')}</span>
          )}
          <span style={{ fontSize: 11, color: '#999' }}>版面沿用原本的課程表系統（A4 橫向），下載後用 Excel 直接列印整本。下方是預覽。</span>
        </div>
      )}

      {!loading && (
        <>
          {tab === 'template' ? (
            <div style={{ maxWidth: 760 }}>
              <p style={{ fontSize: 12, color: '#666', marginBottom: 10 }}>
                這裡改的是課表上的文字：標題、課表下方的說明與備註、各節上課時間。標題與備註裡可以寫 <b>{'{學年度}'}</b>、<b>{'{學期}'}</b>，列印時會自動換成目前學期。
                儲存後「各班課表」「各教師課表」「全校教師任課表」「值日教師參考」都會套用。
              </p>
              {([
                ['classTitle', '各班課表標題'],
                ['teacherTitle', '各教師課表標題'],
                ['allTeachersTitle', '全校教師任課表標題'],
                ['dutyTitle', '值日教師參考標題'],
                ['footerTitle', '課表下方說明標題'],
                ['dismissText', '該部別沒有這節時顯示（例：放學）'],
                ['freeText', '教師沒課時顯示（例：空）'],
              ] as [keyof TimetableTemplate, string][]).map(([k, label]) => (
                <label key={k} style={{ display: 'block', fontSize: 13, marginBottom: 8 }}>
                  {label}
                  <input value={draft[k] as string} onChange={(e) => setD({ [k]: e.target.value } as any)} style={{ display: 'block', width: '100%', padding: 6, marginTop: 3 }} />
                </label>
              ))}
              <label style={{ display: 'block', fontSize: 13, marginBottom: 12 }}>
                課表下方備註（可多行）
                <textarea value={draft.note} onChange={(e) => setD({ note: e.target.value })} rows={4} style={{ display: 'block', width: '100%', padding: 6, marginTop: 3 }} />
              </label>
              <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', marginBottom: 12 }}>
                <div>
                  <div style={{ fontSize: 13, marginBottom: 4 }}>週一～週五 上課時間（第 1～3 節；可換行）</div>
                  {draft.weekdayTimes.map((v, i) => (
                    <textarea key={i} value={v} rows={2} onChange={(e) => setD({ weekdayTimes: draft.weekdayTimes.map((x, j) => (j === i ? e.target.value : x)) })} style={{ display: 'block', width: 170, padding: 4, marginBottom: 4 }} />
                  ))}
                </div>
                <div>
                  <div style={{ fontSize: 13, marginBottom: 4 }}>週六 上課時間（第 1～5 節）</div>
                  {draft.saturdayTimes.map((v, i) => (
                    <textarea key={i} value={v} rows={2} onChange={(e) => setD({ saturdayTimes: draft.saturdayTimes.map((x, j) => (j === i ? e.target.value : x)) })} style={{ display: 'block', width: 170, padding: 4, marginBottom: 4 }} />
                  ))}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <button onClick={doSave} style={{ ...btn, background: '#2C2C2A', color: '#fff', border: 'none', borderRadius: 6 }}>儲存模板</button>
                <button onClick={() => setDraft(DEFAULT_TEMPLATE)} style={btn}>還原成預設文字</button>
                <span style={{ fontSize: 12 }}>{saveMsg}</span>
              </div>
              <h3 style={{ fontSize: 13, margin: '20px 0 8px', color: '#555' }}>預覽（用第一個有導師的班級；尚未儲存的修改也會即時顯示）</h3>
              <PreviewBox draft={draft} term={term} cls={printableClasses[0]} />
            </div>
          ) : (
            <div style={{ border: '1px solid #ddd', borderRadius: 6, background: '#fafafa', padding: 8, overflowX: 'auto' }}>
              <style>{CSS}</style>
              <div>
                {tab === 'all' && allTeachersPage}
                {tab === 'duty' && dutyPage}
                {tab === 'classes' && (pickedClasses.length ? classPages(pickedClasses) : <p style={{ fontSize: 13, color: '#999' }}>沒有可列印的班級（需要有導師且有排課）。</p>)}
                {tab === 'teachers' && (pickedTeachers.length ? teacherPages(pickedTeachers) : <p style={{ fontSize: 13, color: '#999' }}>沒有排課的教師。</p>)}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// 模板預覽：用未儲存的草稿文字，示範一張班級課表（版面跟下載的 Excel 相同）
function PreviewBox({ draft, term, cls }: { draft: TimetableTemplate; term: { academic_year: number; term: string } | null; cls?: ClassRow }) {
  return (
    <div style={{ border: '1px solid #ddd', padding: 8, background: '#fff', overflowX: 'auto' }}>
      <TimetableSheet
        kind="class"
        tpl={draft}
        term={term}
        title={cls ? classLabel(cls) : '（班級）'}
        person="（導師）"
        periodsFor={() => 3}
        cell={() => ({ top: '科目', bottom: '教師' })}
      />
    </div>
  );
}
