import ExcelJS from 'exceljs';
import { TimetableTemplate, fillTemplate } from '@/lib/timetableTemplate';

// ============================================================
// 列印課表 → Excel
// ------------------------------------------------------------
// 版面（字型、框線、列高欄寬、合併儲存格、A4 橫向）直接沿用學校原本的「課程表系統」Excel，
// 範本檔放在 public/templates/timetable-template.xlsx（是從原始 .xlsm 去掉巨集與公式後留下的四張版面）。
// 這裡只負責把資料填進去；每個班／每位教師各一張工作表，直接用 Excel 列印整本即可。
// ============================================================

export type CellText = { top: string; bottom: string } | null;
export type ClassPage = { label: string; homeroom: string; periodsFor: (weekday: number) => number; cell: (w: number, p: number) => CellText };
export type TeacherPage = { name: string; tag: string; cell: (w: number, p: number) => CellText };
export type AllRow = { name: string; classLabel: string; cell: (w: number, p: number) => CellText };
export type TermInfo = { year: number | string; term: string };

const SLOTS: { w: number; p: number }[] = [
  ...[1, 2, 3, 4, 5].flatMap((w) => [1, 2, 3].map((p) => ({ w, p }))),
  ...[1, 2, 3, 4, 5].map((p) => ({ w: 6, p })),
];

async function loadTemplateBook(): Promise<ExcelJS.Workbook> {
  const res = await fetch('/templates/timetable-template.xlsx');
  if (!res.ok) throw new Error('讀不到課表 Excel 版型檔（/templates/timetable-template.xlsx）');
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(await res.arrayBuffer());
  return wb;
}

function colNum(letters: string) {
  return letters.split('').reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0);
}
function parseRange(r: string) {
  const m = /^([A-Z]+)(\d+):([A-Z]+)(\d+)$/.exec(r)!;
  return { c1: colNum(m[1]), r1: Number(m[2]), c2: colNum(m[3]), r2: Number(m[4]) };
}
const clone = <T,>(v: T): T => (v === undefined || v === null ? v : JSON.parse(JSON.stringify(v)));

/** 把範本工作表的某個範圍（值＋格式＋合併＋列高欄寬）複製到新工作表；rowShift 是往下平移幾列 */
function copyRange(src: ExcelJS.Worksheet, dst: ExcelJS.Worksheet, rows: [number, number], cols: [number, number], rowShift = 0, withValues = true) {
  for (let c = cols[0]; c <= cols[1]; c++) {
    const w = src.getColumn(c).width;
    if (w && !dst.getColumn(c).width) dst.getColumn(c).width = w;
  }
  for (let r = rows[0]; r <= rows[1]; r++) {
    const sr = src.getRow(r);
    const dr = dst.getRow(r + rowShift);
    if (sr.height) dr.height = sr.height;
    for (let c = cols[0]; c <= cols[1]; c++) {
      const sc = sr.getCell(c);
      const dc = dr.getCell(c);
      dc.style = clone(sc.style);
      if (withValues) dc.value = clone(sc.value as any);
    }
  }
  for (const m of src.model.merges ?? []) {
    const g = parseRange(m);
    if (g.r1 >= rows[0] && g.r2 <= rows[1] && g.c1 >= cols[0] && g.c2 <= cols[1]) {
      dst.mergeCells(g.r1 + rowShift, g.c1, g.r2 + rowShift, g.c2);
    }
  }
}

function pageSetupLike(ws: ExcelJS.Worksheet, src: ExcelJS.Worksheet, area: string, fit: { width: number; height: number }) {
  ws.pageSetup = {
    ...clone(src.pageSetup),
    printArea: area,
    fitToPage: true,
    fitToWidth: fit.width,
    fitToHeight: fit.height,
    orientation: 'landscape',
    paperSize: 9,
    horizontalCentered: true,
  } as any;
  ws.views = [{ state: 'normal', zoomScale: 70 }];
}

function safeSheetName(name: string, used: Set<string>) {
  let base = name.replace(/[\\/?*[\]:]/g, '').slice(0, 28) || '課表';
  let n = base;
  for (let i = 2; used.has(n); i++) n = `${base}${i}`;
  used.add(n);
  return n;
}

function setText(cell: ExcelJS.Cell, text: string) {
  // 保留原本儲存格的字型／對齊，只換文字（原檔有些標題是多段字型的 rich text，取第一段字型）
  const v: any = cell.value;
  if (v && typeof v === 'object' && Array.isArray(v.richText) && v.richText.length) {
    cell.value = { richText: [{ ...v.richText[0], text }] } as any;
  } else {
    cell.value = text;
  }
}

function noteText(tpl: TimetableTemplate, t: TermInfo) {
  return `${fillTemplate(tpl.footerTitle, t.year, t.term)}\n\n${tpl.note}`;
}

/** 單頁（班級／教師）共用：清掉範本的示範資料，填入時間欄與備註 */
function fillCommonPage(ws: ExcelJS.Worksheet, tpl: TimetableTemplate, t: TermInfo) {
  for (let p = 1; p <= 3; p++) ws.getCell(3 + 2 * (p - 1), 1).value = tpl.weekdayTimes[p - 1];
  for (let p = 1; p <= 5; p++) ws.getCell(3 + 2 * (p - 1), 7).value = tpl.saturdayTimes[p - 1];
  ws.getCell(9, 1).value = noteText(tpl, t);
  // 清掉範本的示範資料（備註區 A9:F12 是合併儲存格，不能清到；那一格上面已經填好了）
  for (let r = 3; r <= 8; r++) for (let c = 2; c <= 6; c++) ws.getCell(r, c).value = null;
  for (let r = 3; r <= 12; r++) ws.getCell(r, 8).value = null;
}

export async function buildClassesWorkbook(pages: ClassPage[], tpl: TimetableTemplate, t: TermInfo): Promise<ExcelJS.Workbook> {
  const tplWb = await loadTemplateBook();
  const src = tplWb.getWorksheet('各班課表')!;
  const out = new ExcelJS.Workbook();
  const used = new Set<string>();
  for (const pg of pages) {
    const ws = out.addWorksheet(safeSheetName(pg.label, used));
    copyRange(src, ws, [1, 12], [1, 8]);
    fillCommonPage(ws, tpl, t);
    ws.getCell('C1').value = pg.label;
    setText(ws.getCell('D1'), `  ${tpl.classTitle}     `);
    ws.getCell('H1').value = pg.homeroom;
    for (const s of SLOTS) {
      const col = s.w === 6 ? 8 : 1 + s.w;
      const top = 3 + 2 * (s.p - 1);
      if (s.w <= 5 && s.p > pg.periodsFor(s.w)) {
        ws.getCell(top, col).value = tpl.dismissText;
        continue;
      }
      const c = pg.cell(s.w, s.p);
      ws.getCell(top, col).value = c?.top ?? null;
      ws.getCell(top + 1, col).value = c?.bottom ?? null;
    }
    pageSetupLike(ws, src, 'A1:H12', { width: 1, height: 1 });
  }
  return out;
}

export async function buildTeachersWorkbook(pages: TeacherPage[], tpl: TimetableTemplate, t: TermInfo): Promise<ExcelJS.Workbook> {
  const tplWb = await loadTemplateBook();
  const src = tplWb.getWorksheet('各教師課表')!;
  const out = new ExcelJS.Workbook();
  const used = new Set<string>();
  for (const pg of pages) {
    const ws = out.addWorksheet(safeSheetName(pg.name, used));
    copyRange(src, ws, [1, 12], [1, 8]);
    fillCommonPage(ws, tpl, t);
    setText(ws.getCell('B1'), `${tpl.teacherTitle}   `);
    ws.getCell('F1').value = pg.tag;
    ws.getCell('H1').value = pg.name;
    for (const s of SLOTS) {
      const col = s.w === 6 ? 8 : 1 + s.w;
      const top = 3 + 2 * (s.p - 1);
      const c = pg.cell(s.w, s.p);
      ws.getCell(top, col).value = c?.top || null;
      ws.getCell(top + 1, col).value = c ? c.bottom || null : tpl.freeText;
    }
    pageSetupLike(ws, src, 'A1:H12', { width: 1, height: 1 });
  }
  return out;
}

export async function buildAllTeachersWorkbook(rows: AllRow[], tpl: TimetableTemplate, t: TermInfo): Promise<ExcelJS.Workbook> {
  const tplWb = await loadTemplateBook();
  const src = tplWb.getWorksheet('全校教師任課表')!;
  const out = new ExcelJS.Workbook();
  const ws = out.addWorksheet('全校教師任課表');
  copyRange(src, ws, [1, 3], [1, 21]);
  ws.getCell('A1').value = fillTemplate(tpl.allTeachersTitle, t.year, t.term);
  rows.forEach((row, i) => {
    const r = 4 + 2 * i;
    copyRange(src, ws, [4, 5], [1, 21], r - 4, false);
    ws.getCell(r, 1).value = row.classLabel || null;
    ws.getCell(r + 1, 1).value = row.name;
    SLOTS.forEach((s, k) => {
      const c = row.cell(s.w, s.p);
      ws.getCell(r, 2 + k).value = c?.top || null;
      ws.getCell(r + 1, 2 + k).value = c?.bottom || null;
    });
  });
  const lastRow = 3 + 2 * rows.length;
  pageSetupLike(ws, src, `A1:U${lastRow}`, { width: 1, height: 0 });
  (ws.pageSetup as any).printTitlesRow = '1:3';
  return out;
}

export async function buildDutyWorkbook(namesBySlot: string[][], tpl: TimetableTemplate, t: TermInfo): Promise<ExcelJS.Workbook> {
  const tplWb = await loadTemplateBook();
  const src = tplWb.getWorksheet('值日教師參考')!;
  const out = new ExcelJS.Workbook();
  const ws = out.addWorksheet('值日教師參考');
  copyRange(src, ws, [1, 18], [1, 21]);
  ws.getCell('A1').value = tpl.dutyTitle;
  const need = Math.max(15, ...namesBySlot.map((n) => n.length));
  for (let r = 4; r < 4 + need; r++) {
    if (r > 18) {
      // 名單比範本預留的 15 列還長：多出來的列沿用最後一列的格式
      copyRange(src, ws, [18, 18], [2, 21], r - 18, false);
    }
    for (let k = 0; k < 20; k++) ws.getCell(r, 2 + k).value = namesBySlot[k]?.[r - 4] ?? null;
  }
  if (need > 15) {
    ws.unMergeCells('A4:A18');
    ws.mergeCells(4, 1, 3 + need, 1);
  }
  ws.pageSetup = { ...clone(src.pageSetup), fitToPage: true, fitToWidth: 1, fitToHeight: 1, orientation: 'landscape', paperSize: 8 } as any;
  ws.views = [{ state: 'normal', zoomScale: 60 }];
  void t;
  return out;
}

export async function downloadWorkbook(wb: ExcelJS.Workbook, filename: string) {
  const buf = await wb.xlsx.writeBuffer();
  const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
