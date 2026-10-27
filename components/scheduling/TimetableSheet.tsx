'use client';

import { TimetableTemplate, fillTemplate } from '@/lib/timetableTemplate';

// ============================================================
// 課表預覽：跟下載的 Excel（public/templates/timetable-template.xlsx 的「各班課表」「各教師課表」）
// 用同一套版面做出來，讓人一眼看到的就是印出來的樣子：
//   * 欄寬 24／14.6×5／17.6／17.6、列高（班級列 58、星期列 50、每節「科目 55＋老師 35」）都照 Excel 換算成像素
//   * 字型華文仿宋，字級照 Excel（標題 25、星期 16、時間 18／20、科目 22 粗體、老師 20…）
//   * 左上「星期／上課時間」、週一到週五三節在左、週六五節在右、左下方是合併的說明備註、外框粗線
// 1 Excel 欄寬單位 ≈ 7px + 5px；1pt = 1.333px。
// ============================================================

export type SheetCell = { top: string; bottom: string } | null;

const FONT = '"STFangsong","FangSong","华文仿宋","DFKai-SB","標楷體","Microsoft JhengHei","PingFang TC",serif';
const px = (pt: number) => Math.round(pt * 1.3333);
const colPx = (w: number) => Math.round(w * 7 + 5);
const W = { A: colPx(24), B: colPx(14.625), G: colPx(17.625), H: colPx(17.625) };
const CN = ['', '一', '二', '三', '四', '五', '六'];

const thin = '1px solid #000';
const thick = '3px solid #000';

function cellStyle(o: { size: number; bold?: boolean; h?: number; align?: 'left' | 'center' | 'right'; border?: React.CSSProperties; pre?: boolean; bg?: string }): React.CSSProperties {
  return {
    fontFamily: FONT,
    fontSize: px(o.size),
    fontWeight: o.bold ? 700 : 400,
    height: o.h ? px(o.h) : undefined,
    textAlign: o.align ?? 'center',
    verticalAlign: 'middle',
    whiteSpace: o.pre ? 'pre-line' : 'nowrap',
    overflow: 'hidden',
    lineHeight: 1.15,
    padding: '0 2px',
    background: o.bg,
    borderTop: thin,
    borderLeft: thin,
    borderRight: thin,
    borderBottom: thin,
    ...(o.border ?? {}),
  };
}

export default function TimetableSheet(props: {
  kind: 'class' | 'teacher';
  tpl: TimetableTemplate;
  term: { academic_year: number; term: string } | null;
  /** class：班級名稱；teacher：標籤（導師班或「副科老師N」） */
  title: string;
  /** class：導師姓名；teacher：教師姓名 */
  person: string;
  /** class 才需要：某部別某天有幾節（超過的節次顯示「放學」） */
  periodsFor?: (weekday: number) => number;
  cell: (weekday: number, period: number) => SheetCell;
}) {
  const { kind, tpl, term, title, person, periodsFor, cell } = props;
  const isClass = kind === 'class';
  const note = `${fillTemplate(tpl.footerTitle, term?.academic_year ?? '', term?.term ?? '')}\n\n${tpl.note}`;

  const topSize = isClass ? 22 : 18; // 第一行（科目／班級）字級
  const botSize = isClass ? 20 : 18; // 第二行（老師／科目）字級
  const topBold = true;
  const botBold = false;

  // 一節 = 兩列：上列（科目或班級）、下列（老師或科目）
  const periodRows = (p: number, side: 'week' | 'sat') => {
    const days = side === 'week' ? [1, 2, 3, 4, 5] : [6];
    return days.map((w) => {
      if (isClass && w <= 5 && periodsFor && p > periodsFor(w)) {
        return { w, top: tpl.dismissText, bottom: '', dismiss: true };
      }
      const c = cell(w, p);
      return { w, top: c?.top ?? '', bottom: c ? c.bottom : isClass ? '' : tpl.freeText, dismiss: false };
    });
  };

  return (
    <table style={{ borderCollapse: 'collapse', tableLayout: 'fixed', width: W.A + 5 * W.B + W.G + W.H, background: '#fff', color: '#000', border: thick }}>
      <colgroup>
        <col style={{ width: W.A }} />
        {[1, 2, 3, 4, 5].map((i) => (
          <col key={i} style={{ width: W.B }} />
        ))}
        <col style={{ width: W.G }} />
        <col style={{ width: W.H }} />
      </colgroup>
      <tbody>
        {/* 第 1 列：標題 */}
        <tr style={{ height: px(isClass ? 58.35 : 57) }}>
          {isClass ? (
            <>
              <td colSpan={2} style={{ border: 'none' }} />
              <td style={{ ...cellStyle({ size: 25, bold: true, align: 'right' }), border: 'none' }}>{title}</td>
              <td colSpan={3} style={{ ...cellStyle({ size: 25, bold: true, align: 'left', pre: true }), border: 'none' }}>
                {tpl.classTitle}
              </td>
              <td style={{ ...cellStyle({ size: 26, bold: true, align: 'right' }), border: 'none' }}>導師:</td>
              <td style={{ ...cellStyle({ size: 26, bold: true, align: 'right' }), border: 'none' }}>{person}</td>
            </>
          ) : (
            <>
              <td style={{ border: 'none' }} />
              <td colSpan={4} style={{ ...cellStyle({ size: 36, bold: true }), border: 'none' }}>
                {tpl.teacherTitle}
              </td>
              <td style={{ ...cellStyle({ size: 26, bold: true }), border: 'none' }}>{title}</td>
              <td style={{ border: 'none' }} />
              <td style={{ ...cellStyle({ size: 26, bold: true }), border: 'none' }}>{person}</td>
            </>
          )}
        </tr>

        {/* 第 2 列：星期 */}
        <tr style={{ height: px(isClass ? 50.1 : 51.6) }}>
          <td style={cellStyle({ size: 16, bold: true, pre: true, align: 'left', border: { borderBottom: thick } })}>
            <div style={{ textAlign: 'right', paddingRight: 8 }}>星期</div>
            <div style={{ textAlign: 'left', paddingLeft: 8 }}>上課時間</div>
          </td>
          {[1, 2, 3, 4, 5].map((w) => (
            <td key={w} style={cellStyle({ size: 16, bold: true, border: { borderBottom: thick } })}>
              {CN[w]}
            </td>
          ))}
          <td colSpan={2} style={cellStyle({ size: 16, bold: true, border: { borderBottom: thick } })}>
            {CN[6]}
          </td>
        </tr>

        {/* 第 3～8 列：週一到週五的 3 節（每節兩列），右邊同列是週六第 1～3 節；9～12 列：備註 + 週六第 4、5 節 */}
        {[1, 2, 3, 4, 5].map((p) => {
          const sat = periodRows(p, 'sat')[0];
          const wk = p <= 3 ? periodRows(p, 'week') : null;
          const topRow = (
            <tr key={`t${p}`} style={{ height: px(55.35) }}>
              {wk ? (
                <>
                  <td rowSpan={2} style={cellStyle({ size: 18, pre: true, border: { borderLeft: thick } })}>
                    {tpl.weekdayTimes[p - 1]}
                  </td>
                  {wk.map((c) => (
                    <td key={c.w} rowSpan={c.dismiss ? 2 : 1} style={cellStyle({ size: topSize, bold: topBold })}>
                      {c.top}
                    </td>
                  ))}
                </>
              ) : p === 4 ? (
                <td
                  colSpan={6}
                  rowSpan={4}
                  style={cellStyle({ size: 26, bold: true, pre: true, border: { borderLeft: thick, borderBottom: thick, borderRight: thin } })}
                >
                  {note}
                </td>
              ) : null}
              <td rowSpan={2} style={cellStyle({ size: 20, pre: true })}>
                {tpl.saturdayTimes[p - 1]}
              </td>
              <td style={cellStyle({ size: topSize, bold: topBold, border: { borderRight: thick } })}>{sat.top}</td>
            </tr>
          );
          const botRow = (
            <tr key={`b${p}`} style={{ height: px(35.1) }}>
              {wk && wk.filter((c) => !c.dismiss).map((c) => (
                <td key={c.w} style={cellStyle({ size: botSize, bold: botBold })}>
                  {c.bottom}
                </td>
              ))}
              <td style={cellStyle({ size: botSize, bold: botBold, border: { borderRight: thick, borderBottom: p === 5 ? thick : thin } })}>{sat.bottom}</td>
            </tr>
          );
          return [topRow, botRow];
        })}
      </tbody>
    </table>
  );
}
