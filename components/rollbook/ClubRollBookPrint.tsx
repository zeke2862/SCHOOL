'use client';

import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { Dist, NameBox, BindMarks } from './ClassRollBook';

export type ClubPrintMember = { student_no: string; name: string; class_label: string; seat_no: number | null };

const THICK = '2px solid #000';
const THIN = '1px solid #333';
const DASH = '1px dashed #777';
const ROWS_AREA_MM = 244; // 與班級點名冊同一套算法：扣掉標題與表頭後給學生列的高度，實際高度由表格自動拉伸補滿
const ROW_MAX_MM = 16;
const ROW_MIN_MM = 3.4;
const ROW_BASE = 0.85;
const HDR_MM = 4;

function parseDate(s: string) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

// 學期內所有星期六（社團固定星期六上課）
function saturdays(startStr: string, endStr: string): Date[] {
  const end = parseDate(endStr);
  const d = parseDate(startStr);
  d.setDate(d.getDate() + ((6 - d.getDay() + 7) % 7));
  const out: Date[] = [];
  for (; d <= end; d.setDate(d.getDate() + 1 * 7)) out.push(new Date(d));
  return out;
}

// 社團點名冊列印：只有 1 張紙，正反兩面（正面前半學期、背面後半學期），規則比照班級點名冊
export default function ClubRollBookPrint({
  clubName,
  teacherName,
  location,
  term,
  members,
  onClose,
}: {
  clubName: string;
  teacherName: string;
  /** 授課位置（上課的班級教室），例如「國小 6年忠」；沒設定就留空白線 */
  location?: string;
  term: { academic_year: number; term: string } | null;
  members: ClubPrintMember[];
  onClose: () => void;
}) {
  const [dates, setDates] = useState<Date[] | null>(null);
  const [msg, setMsg] = useState('');
  const [bindMarks, setBindMarks] = useState(true);
  const [signRow, setSignRow] = useState(true);
  const [fontScale, setFontScale] = useState(1);

  useEffect(() => {
    (async () => {
      if (!term) {
        setMsg('讀不到目前學期，請先到「學年學期管理」設定。');
        return;
      }
      const { data } = await supabase
        .from('academic_terms')
        .select('term_start_date, term_end_date')
        .eq('academic_year', term.academic_year)
        .eq('term', term.term)
        .maybeSingle();
      if (!data?.term_start_date || !data?.term_end_date) {
        setMsg('這個學期還沒有設定開學日與結束日，無法排出星期六的日期欄。');
        return;
      }
      setDates(saturdays(data.term_start_date, data.term_end_date));
    })();
  }, [term]);

  const pages = useMemo(() => {
    if (!dates) return [];
    const half = Math.max(1, Math.ceil(dates.length / 2));
    return [dates.slice(0, half), dates.slice(half)];
  }, [dates]);

  const title = `華雲學校 佛曆 ${term ? term.academic_year + 543 : ''} (${term?.academic_year ?? ''}) 學年度 ${term?.term === '上學期' ? '上' : '下'} 學期　${clubName}課點名冊`;

  const list = members;
  const gapMm = signRow ? 6 : 0;
  const signMm = signRow ? 12 : 0;
  const rowMm = Math.min(ROW_MAX_MM, Math.max(ROW_MIN_MM, (ROWS_AREA_MM - signMm - gapMm) / Math.max(list.length, 1)));
  const fitMax = rowMm * 3.78 * 0.9;
  const nameSize = Math.round(Math.max(10, Math.min(fitMax, 40, Math.min(30, rowMm * 3.78 * 0.78) * fontScale)));
  const noSize = Math.round(Math.max(10, Math.min(fitMax, 26, Math.min(20, rowMm * 3.78 * 0.6) * fontScale)));
  const smallSize = Math.round(Math.min(16, Math.max(9, rowMm * 3.78 * 0.5)));
  const maxNoLen = Math.max(6, ...list.map((x) => String(x.student_no ?? '').length));
  const noColMm = Math.max(17, Math.ceil((maxNoLen * noSize * 0.62 + 8) / 3.78));
  const nameColMm = Math.max(22, Math.ceil((nameSize * 3 + 12) / 3.78));
  const thCommon = { border: THIN, background: '#f3f3f3', padding: 0, textAlign: 'center' as const, fontSize: 11, height: `${HDR_MM}mm`, fontWeight: 600 };

  function renderPage(pageDates: Date[], idx: number) {
    const cols = Math.max(pageDates.length, 1);
    return (
      <div key={idx} className="rollbook-sheet">
        {bindMarks && <BindMarks />}
        <div style={{ marginBottom: 2 }}>
          <div style={{ textAlign: 'center', fontSize: 22, fontWeight: 700, lineHeight: 1.2 }}>{title}</div>
          <div style={{ height: `${gapMm}mm` }}></div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', whiteSpace: 'nowrap', marginTop: 1, gap: 8 }}>
            <span style={{ fontSize: 15 }}>
              社團：<b>{clubName}</b>　授課位置：<b>{location || '　　　'}</b>　指導老師：<b>{teacherName || '　　　'}</b>　共 <b>{list.length}</b> 人
            </span>
            <span style={{ fontSize: 12, color: '#333' }}>符號：曠課10　遲到1　病假2　事假3　公假4　早退5</span>
            <span style={{ fontSize: 12 }}>{idx === 0 ? '正面' : '背面'}　星期六第五節</span>
          </div>
        </div>
        <div className="rollbook-tablewrap">
          <table style={{ borderCollapse: 'collapse', width: '100%', height: '100%', tableLayout: 'fixed' }}>
            <colgroup>
              <col style={{ width: '9mm' }} />
              <col style={{ width: '14mm' }} />
              <col style={{ width: `${noColMm}mm` }} />
              <col style={{ width: `${nameColMm}mm` }} />
              {Array.from({ length: cols }, (_, i) => (
                <col key={i} />
              ))}
            </colgroup>
            <thead>
              <tr>
                <th rowSpan={2} style={thCommon}><Dist text="序號" /></th>
                <th rowSpan={2} style={thCommon}><Dist text="原班級" /></th>
                <th rowSpan={2} style={thCommon}><Dist text="學號" /></th>
                <th rowSpan={2} style={thCommon}><Dist text="姓名" /></th>
                {pageDates.length === 0 ? (
                  <th style={thCommon}></th>
                ) : (
                  pageDates.map((d, i) => (
                    <th key={i} style={{ ...thCommon, borderLeft: i === 0 ? THICK : THIN, borderRight: i === cols - 1 ? THICK : undefined }}>
                      {d.getMonth() + 1}/{d.getDate()}
                    </th>
                  ))
                )}
              </tr>
              <tr>
                {pageDates.length === 0 ? (
                  <th style={thCommon}></th>
                ) : (
                  pageDates.map((_, i) => (
                    <th key={i} style={{ ...thCommon, fontWeight: 400, borderLeft: i === 0 ? THICK : THIN, borderRight: i === cols - 1 ? THICK : undefined }}>
                      第五節
                    </th>
                  ))
                )}
              </tr>
            </thead>
            <tbody>
              {list.map((s, i) => {
                const bb: React.CSSProperties = (i + 1) % 5 === 0 ? { borderBottom: THICK } : {};
                return (
                  <tr key={s.student_no} style={{ height: `${rowMm * ROW_BASE}mm` }}>
                    <td style={{ border: THIN, textAlign: 'center', fontSize: smallSize, padding: 0, ...bb }}>{i + 1}</td>
                    <td style={{ border: THIN, textAlign: 'center', fontSize: smallSize, padding: 0, whiteSpace: 'nowrap', ...bb }}>{s.class_label}</td>
                    <td style={{ border: THIN, textAlign: 'center', fontSize: noSize, fontWeight: 600, whiteSpace: 'nowrap', padding: 0, ...bb }}>{s.student_no}</td>
                    <td style={{ border: THIN, textAlign: 'center', padding: '0 6px', fontSize: nameSize, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', ...bb }}>
                      <NameBox text={s.name} size={nameSize} />
                    </td>
                    {Array.from({ length: cols }, (_, c) => (
                      <td
                        key={c}
                        style={{ borderTop: THIN, borderBottom: THIN, borderLeft: c === 0 ? THICK : DASH, borderRight: c === cols - 1 ? THICK : undefined, padding: 0, ...bb }}
                      ></td>
                    ))}
                  </tr>
                );
              })}
              {signRow && list.length > 0 && (
                <tr style={{ height: `${signMm * ROW_BASE}mm` }}>
                  <td colSpan={4} style={{ border: THIN, textAlign: 'center', fontSize: 20, fontWeight: 700, padding: '0 6px' }}>
                    <Dist text="指導教師簽名" />
                  </td>
                  {Array.from({ length: cols }, (_, c) => (
                    <td key={c} style={{ borderTop: THICK, borderBottom: THIN, borderLeft: c === 0 ? THICK : DASH, borderRight: c === cols - 1 ? THICK : undefined, padding: 0 }}></td>
                  ))}
                </tr>
              )}
              {list.length === 0 && (
                <tr>
                  <td colSpan={4 + cols} style={{ border: THIN, textAlign: 'center', fontSize: 12, height: '10mm' }}>
                    這個社團目前沒有在社學生
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  return (
    <main style={{ maxWidth: 1000, margin: '0 auto', padding: 16 }}>
      <style>{`
        @page { size: A4 portrait; margin: 0; }
        @media print {
          .no-print { display: none !important; }
          .rollbook-sheet { page-break-after: always; break-after: page; margin: 0 !important; height: 296.5mm; height: calc(100vh - 0.5mm); padding: 5mm !important; box-sizing: border-box; overflow: hidden; display: flex; flex-direction: column; }
          .rollbook-tablewrap { flex: 1; min-height: 0; }
          html { zoom: 1 !important; }
          main, .hub-content { padding: 0 !important; max-width: none !important; margin: 0 !important; }
          .rollbook-sheet:last-child { page-break-after: auto; break-after: auto; }
          body { background: #fff !important; }
          .rollbook-sheet { border: none !important; }
        }
        .rollbook-sheet { background: #fff; box-sizing: border-box; position: relative; }
        @media screen {
          .rollbook-sheet { width: 210mm; height: 297mm; padding: 5mm; margin: 0 auto 16px; border: 1px solid #ccc; box-shadow: 0 1px 6px rgba(0,0,0,0.12); overflow: hidden; display: flex; flex-direction: column; }
        }
        .rollbook-bind { position: absolute; left: 0; right: 0; top: 0.5mm; height: 4mm; pointer-events: none; z-index: 10; }
      `}</style>

      <div className="no-print">
        <h1 style={{ fontSize: 16, marginBottom: 4 }}>列印社團點名冊：{clubName}</h1>
        <p style={{ fontSize: 12, color: '#666', marginBottom: 12 }}>
          只印 1 張 A4，正反兩面：正面是前半學期、背面是後半學期的星期六。雙面列印請選「長邊翻轉」。
        </p>
        {msg && <p style={{ fontSize: 13, color: '#A32D2D', marginBottom: 8 }}>{msg}</p>}
        <label style={{ display: 'block', fontSize: 13, marginBottom: 6 }}>
          <input type="checkbox" checked={bindMarks} onChange={(e) => setBindMarks(e.target.checked)} /> 上方印 3 條橫向裝訂線提示
        </label>
        <label style={{ display: 'block', fontSize: 13, marginBottom: 6 }}>
          學號、姓名字體：
          <select value={fontScale} onChange={(e) => setFontScale(Number(e.target.value))} style={{ padding: 3, marginLeft: 4 }}>
            <option value={1}>標準</option>
            <option value={1.2}>放大 120%</option>
            <option value={1.4}>放大 140%</option>
            <option value={1.6}>放大 160%</option>
          </select>
          <span style={{ color: '#999', marginLeft: 8 }}>（受列高限制，人數多時放大有限；想再大可取消簽名欄）</span>
        </label>
        <label style={{ display: 'block', fontSize: 13, marginBottom: 10 }}>
          <input type="checkbox" checked={signRow} onChange={(e) => setSignRow(e.target.checked)} /> 在最後一號下面加印「指導教師簽名」欄
        </label>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 16 }}>
          <button type="button" onClick={() => window.print()} disabled={!dates} style={{ padding: '8px 24px', fontWeight: 600 }}>
            列印（1 張 A4 正反面）
          </button>
          <button type="button" onClick={onClose} style={{ padding: '8px 18px' }}>
            返回點名
          </button>
          {dates && <span style={{ fontSize: 12, color: '#666' }}>本學期共 {dates.length} 個星期六</span>}
        </div>
      </div>

      {dates && pages.map((p, i) => renderPage(p, i))}
    </main>
  );
}
