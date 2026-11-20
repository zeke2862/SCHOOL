// Excel 讀寫（取代 SheetJS 的 xlsx 套件）。
// 為什麼換掉：xlsx 0.18.5 有「原型污染」與「ReDoS（正規表示式拖死）」兩個高風險公告，而且官方 npm 版本不再更新、沒有修補版。
// 專案本來就有 exceljs，所以這裡用 exceljs 做底層，只實作專案真的用到的那一小塊 SheetJS 介面
// （book_new／book_append_sheet／aoa_to_sheet／sheet_to_json(header:1)／read／write／writeFile／SSF.parse_date_code／encode_range），
// 呼叫端只要把 import('xlsx') 換成 import('@/lib/xlsxLite')，並在 read／write／writeFile 前面加 await（它們現在是非同步）。
//
// 與 SheetJS 行為對齊的地方（原本的匯入解析器都是照 SheetJS 的行為寫的，不能變）：
//  - 日期儲存格回傳「Excel 序號數字」（不是 Date 物件），解析器再用 SSF.parse_date_code 轉；
//  - 公式儲存格回傳「上次計算的結果值」；富文字、超連結儲存格回傳純文字；
//  - 合併儲存格只有左上角那格有值，其餘格是空的（exceljs 預設會把值複製到每一格，這裡跳過）；
//  - header:1 時每一列是陣列，範圍從工作表「有內容的範圍」左上角開始算；defval 會補滿空格。
// 都載入 exceljs 才用得到，所以 exceljs 一律用動態載入，不會增加一般頁面的載入量。

export type CellValue = string | number | boolean | Date | null | undefined;
type Aoa = CellValue[][];

export interface CellRange {
  s: { r: number; c: number };
  e: { r: number; c: number };
}

export type Range = CellRange;

export interface WorkSheet {
  /** 內部用：整張表的二維內容 */
  __aoa: Aoa;
  '!cols'?: { wch?: number }[];
  '!merges'?: CellRange[];
  '!autofilter'?: { ref: string };
  [key: string]: any;
}

export interface WorkBook {
  SheetNames: string[];
  Sheets: Record<string, WorkSheet>;
}

// ---------- 工具 ----------

function colName(c: number): string {
  let s = '';
  for (let n = c + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}
function encodeCell(a: { r: number; c: number }): string {
  return colName(a.c) + (a.r + 1);
}
function decodeCell(ref: string): { r: number; c: number } {
  const m = /^([A-Z]+)(\d+)$/.exec(ref.trim().toUpperCase());
  if (!m) throw new Error('不正確的儲存格位置：' + ref);
  let c = 0;
  for (const ch of m[1]) c = c * 26 + (ch.charCodeAt(0) - 64);
  return { r: Number(m[2]) - 1, c: c - 1 };
}

const EXCEL_EPOCH_MS = Date.UTC(1899, 11, 30);
const DAY_MS = 86400000;

/** Date → Excel 序號（exceljs 讀出的日期是用 UTC 表示儲存格上寫的日期時間，所以直接用 UTC 換算） */
function dateToSerial(d: Date): number {
  return (d.getTime() - EXCEL_EPOCH_MS) / DAY_MS;
}

/** 對應 SheetJS 的 SSF.parse_date_code：Excel 序號 → { y, m, d, H, M, S, D(星期) } */
export const SSF = {
  parse_date_code(v: number): { y: number; m: number; d: number; H: number; M: number; S: number; D: number; T: number; u: number } | null {
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) return null;
    const days = Math.floor(v);
    // 時間先四捨五入到毫秒再無條件捨去到秒（跟 SheetJS 一樣：23:59:59.9 仍算 23:59:59，不會進位到隔天）
    const secs = Math.floor(Math.round((v - days) * 86400000) / 1000);
    let y: number, m: number, d: number;
    if (days === 60) {
      // Excel 把 1900 年當成閏年（有 2/29），這個不存在的日子要特別處理
      y = 1900; m = 2; d = 29;
    } else {
      // 序號 1~59 是 1900/1/1~2/28；之後（≥61）因為 Excel 多算了一天，要往回補一天
      const base = days < 60 ? Date.UTC(1899, 11, 31) : EXCEL_EPOCH_MS;
      const dt = new Date(base + days * DAY_MS);
      y = dt.getUTCFullYear(); m = dt.getUTCMonth() + 1; d = dt.getUTCDate();
    }
    const dow = days === 0 ? 6 : (days - 1) % 7;
    return { y, m, d, H: Math.floor(secs / 3600), M: Math.floor((secs % 3600) / 60), S: secs % 60, D: dow, T: secs, u: 0 };
  },
};

// ---------- utils ----------

function aoa_to_sheet(aoa: unknown[][]): WorkSheet {
  return { __aoa: aoa.map((r) => [...(r as CellValue[])]) };
}

function book_new(): WorkBook {
  return { SheetNames: [], Sheets: {} };
}

function book_append_sheet(wb: WorkBook, ws: WorkSheet, name?: string): void {
  const n = (name ?? `Sheet${wb.SheetNames.length + 1}`).slice(0, 31);
  if (wb.Sheets[n]) throw new Error(`工作表名稱重複：${n}`);
  wb.SheetNames.push(n);
  wb.Sheets[n] = ws;
}

function sheet_to_json(ws: WorkSheet | undefined, opts: { header?: 1; defval?: any; raw?: boolean; blankrows?: boolean } = {}): any[][] {
  if (!ws) return [];
  const aoa = ws.__aoa;
  const hasDefval = opts.defval !== undefined;
  const width = aoa.reduce((w, r) => Math.max(w, r.length), 0);
  const out: any[][] = [];
  for (const row of aoa) {
    const blank = row.every((v) => v === null || v === undefined || v === '');
    // SheetJS：header:1 預設保留空白列；blankrows:false 才會略過
    if (blank && opts.blankrows === false) continue;
    if (hasDefval) {
      const r: any[] = new Array(width);
      for (let i = 0; i < width; i++) r[i] = row[i] === undefined || row[i] === null ? opts.defval : row[i];
      out.push(r);
    } else {
      out.push(row.map((v) => (v === null ? undefined : v)));
    }
  }
  return out;
}

function encode_range(r: CellRange): string {
  return `${encodeCell(r.s)}:${encodeCell(r.e)}`;
}

export const utils = { aoa_to_sheet, book_new, book_append_sheet, sheet_to_json, encode_range };

// ---------- 讀 ----------

function normalizeCell(v: any): CellValue {
  if (v === null || v === undefined) return undefined;
  if (v instanceof Date) return dateToSerial(v);
  if (typeof v === 'object') {
    if (Array.isArray(v.richText)) return v.richText.map((t: any) => t.text).join('');
    if ('formula' in v || 'sharedFormula' in v) return normalizeCell(v.result);
    if ('error' in v) return String(v.error);
    if ('text' in v) return typeof v.text === 'string' ? v.text : normalizeCell(v.text);
    if ('hyperlink' in v) return String(v.hyperlink);
    return undefined;
  }
  return v as CellValue;
}

/** 讀 .xlsx（非同步）。資料可以是 ArrayBuffer 或 Uint8Array */
export async function read(data: ArrayBuffer | Uint8Array, _opts?: { type?: 'array' }): Promise<WorkBook> {
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  const buf = data instanceof Uint8Array ? data : new Uint8Array(data);
  await wb.xlsx.load(buf as any);
  const out = book_new();
  for (const ws of wb.worksheets) {
    const dim = ws.dimensions as any;
    const aoa: Aoa = [];
    if (dim && Number.isFinite(dim.top) && Number.isFinite(dim.left)) {
      const { top, left, bottom, right } = dim as { top: number; left: number; bottom: number; right: number };
      for (let r = top; r <= bottom; r++) {
        const row: CellValue[] = new Array(right - left + 1);
        const src = ws.getRow(r);
        for (let c = left; c <= right; c++) {
          const cell = src.getCell(c);
          // 合併儲存格的其餘格：exceljs 會回傳左上角的值，SheetJS 是空的，這裡維持 SheetJS 的行為
          if (cell.isMerged && cell.master && cell.master.address !== cell.address) continue;
          // 公式儲存格：exceljs 的 cell.value 會把「結果是 0／空字串／false」的公式結果丟掉，
          // 改從 cell.model 取原始的計算結果（SheetJS 的行為是回傳這個值）
          row[c - left] = normalizeCell(cell.type === 6 ? (cell as any).model?.result : cell.value);
        }
        // 去掉列尾的空格，讓每列長度 = 最後一個有值的欄位（SheetJS 沒有 defval 時的行為）
        let len = row.length;
        while (len > 0 && (row[len - 1] === undefined || row[len - 1] === null)) len--;
        row.length = len;
        aoa.push(row);
      }
    }
    // 工作表名稱重複不可能發生（Excel 不允許），保險起見用 try
    try {
      book_append_sheet(out, { __aoa: aoa }, ws.name);
    } catch {
      /* ignore */
    }
  }
  return out;
}

// ---------- 寫 ----------

/** 寫 .xlsx（非同步），回傳 ArrayBuffer */
export async function write(wb: WorkBook, _opts?: { bookType?: 'xlsx'; type?: 'array' }): Promise<ArrayBuffer> {
  const ExcelJS = (await import('exceljs')).default;
  const book = new ExcelJS.Workbook();
  for (const name of wb.SheetNames) {
    const sheet = wb.Sheets[name];
    if (!sheet) continue;
    const ws = book.addWorksheet(name);
    sheet.__aoa.forEach((row, r) => {
      row.forEach((v, c) => {
        if (v === null || v === undefined) return;
        ws.getCell(r + 1, c + 1).value = v as any;
      });
    });
    (sheet['!cols'] ?? []).forEach((col, i) => {
      if (col?.wch) ws.getColumn(i + 1).width = col.wch;
    });
    for (const m of sheet['!merges'] ?? []) {
      try {
        ws.mergeCells(m.s.r + 1, m.s.c + 1, m.e.r + 1, m.e.c + 1);
      } catch {
        /* 重疊的合併範圍略過，不要讓整份檔案寫不出來 */
      }
    }
    const af = sheet['!autofilter']?.ref;
    if (af) {
      const [a, b] = af.split(':');
      const s = decodeCell(a);
      const e = decodeCell(b ?? a);
      ws.autoFilter = { from: { row: s.r + 1, column: s.c + 1 }, to: { row: e.r + 1, column: e.c + 1 } };
    }
  }
  const raw = (await book.xlsx.writeBuffer()) as unknown as Uint8Array;
  const u8 = raw instanceof Uint8Array ? raw : new Uint8Array(raw as ArrayBuffer);
  return u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength) as ArrayBuffer;
}

/** 寫檔並讓瀏覽器下載（只能在瀏覽器端用） */
export async function writeFile(wb: WorkBook, filename: string): Promise<void> {
  const buf = await write(wb);
  const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
