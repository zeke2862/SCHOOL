import PizZip from 'pizzip';
import { TABLE_DEFS, type TableDef, type ColDef, type DeptKey } from './deptTableDefs';
import { COLUMN_LABELS } from './deptColumnLabels';

// 上傳時改用唯一限制（不用編號）比對的資料表
const PREFER_UNIQUE_TABLES = new Set(['attendance_roll_calls']);

// ============================================================
// 四部門（教務／總務／訓導／開發人員）Excel 一鍵下載、一鍵上傳 的核心邏輯（瀏覽器端）
// ------------------------------------------------------------
// 設計重點（用最簡單的話說）：
// 1. 一個部門 = 一個 Excel 檔，裡面「一張資料表 = 一個分頁」，分頁名稱就是資料表名稱，
//    第 1 列是欄位名稱。所以下載下來改一改、再原封不動上傳回來，就能整批更新。
// 2. 上傳是「新增＋更新」：有 id（或學號等主鍵）的列 → 更新那一筆；沒有 id 的新列 → 新增。
//    Excel 裡沒有的資料不會被刪掉（刪除請在系統畫面做，避免一個手滑就清掉全校資料）。
// 3. 灰色「〔參考〕」開頭的欄位（學生姓名、班級名稱…）只是方便閱讀，上傳時自動忽略。
// 4. 下載、上傳都透過 /api/admin/dept-excel（伺服器端，只有系統管理員S／開發人員能用），
//    所以連被權限隱藏的資料（例如休學學生）也能完整匯出。
// ============================================================

export const DEPTS: DeptKey[] = ['academic', 'general', 'discipline', 'dev'];
export const DEPT_LABEL: Record<DeptKey, string> = { academic: '教務', general: '總務', discipline: '訓導', dev: '開發人員' };
export const DEPT_FILE_TAG: Record<DeptKey, string> = {
  academic: '1-academic',
  general: '2-general',
  discipline: '3-discipline',
  dev: '4-dev',
};
const DEPT_HINT: Record<DeptKey, string> = {
  academic: '學生／班級／教師、課表、成績、考試分班、社團、教職員打卡',
  general: '庫存（校服／簿本／書庫）、修繕、水電網路費用',
  discipline: '學生出缺勤、示警通知、獎懲與審核、資料修改申請',
  dev: '帳號與部門職務、功能卡片、送審、公佈欄、系統設定、聘書與教師歷年資料',
};

const REF_PREFIX = '〔參考〕';
const ROWS_PER_SHEET = 100000; // 單一分頁最多幾列（超過會自動接續到 __2、__3 …）
const MAX_CELL = 32000; // Excel 單一儲存格上限約 32767 字
const TOO_LONG_PREFIX = '⚠內容過長，Excel放不下，請改用JSON備份還原｜';
const SKIP_SHEETS = new Set(['說明', '欄位說明']);
const PAGE_LIMIT = 5000;

export const ALL_DEFS = TABLE_DEFS;
const DEF_BY_TABLE = new Map(TABLE_DEFS.map((d) => [d.table, d]));
export function defsOfDept(dept: DeptKey): TableDef[] {
  return TABLE_DEFS.filter((d) => d.dept === dept && d.mode !== 'skip').sort((a, b) => a.table.localeCompare(b.table));
}

// ------------------------------------------------------------
// 伺服器 API
// ------------------------------------------------------------
async function api<T>(token: string, payload: Record<string, unknown>): Promise<T> {
  const res = await fetch('/api/admin/dept-excel', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const body = await res.json().catch(() => null);
  if (!res.ok || !body) {
    throw new Error(body?.error ?? `伺服器沒有回傳正常的內容（HTTP ${res.status}），請稍後再試一次`);
  }
  return body as T;
}

type Lookups = {
  studentName: Record<string, string>;
  classLabel: Record<string, string>;
  teacherName: Record<string, string>;
  userName: Record<string, string>;
  enrollmentLabel: Record<string, string>;
  clubName: Record<string, string>;
  emailById: Record<string, string>;
};

// ------------------------------------------------------------
// 〔參考〕欄位：依欄位名稱自動決定要附什麼（只用來閱讀，上傳時忽略）
// ------------------------------------------------------------
type RefSpec = { header: string; make: (row: any, lk: Lookups) => string | null };
const TEACHER_COLS: Record<string, string> = {
  teacher_id: '教師姓名',
  homeroom_teacher_id: '導師姓名',
  original_teacher_id: '原任課教師姓名',
  substitute_teacher_id: '代課教師姓名',
};
function refSpecsFor(def: TableDef): RefSpec[] {
  const names = new Set(def.cols.map((c) => c.name));
  const specs: RefSpec[] = [];
  if (def.table === 'students') return specs; // 學生表本身就有姓名
  if (names.has('student_no')) specs.push({ header: REF_PREFIX + '學生姓名', make: (r, lk) => lk.studentName[r.student_no] ?? null });
  if (names.has('enrollment_id')) specs.push({ header: REF_PREFIX + '學生／班級', make: (r, lk) => lk.enrollmentLabel[r.enrollment_id] ?? null });
  if (names.has('class_id') && def.table !== 'classes') specs.push({ header: REF_PREFIX + '班級', make: (r, lk) => lk.classLabel[r.class_id] ?? null });
  for (const [col, label] of Object.entries(TEACHER_COLS)) {
    if (names.has(col)) specs.push({ header: REF_PREFIX + label, make: (r, lk) => lk.teacherName[r[col]] ?? null });
  }
  if (names.has('club_id')) specs.push({ header: REF_PREFIX + '社團名稱', make: (r, lk) => lk.clubName[r.club_id] ?? null });
  if (names.has('app_user_id')) specs.push({ header: REF_PREFIX + '帳號姓名', make: (r, lk) => lk.userName[r.app_user_id] ?? null });
  if (names.has('target_user_id')) specs.push({ header: REF_PREFIX + '帳號姓名', make: (r, lk) => lk.userName[r.target_user_id] ?? null });
  if (def.table === 'app_users') specs.push({ header: REF_PREFIX + '登入信箱', make: (r, lk) => lk.emailById[r.id] ?? null });
  return specs;
}

// ------------------------------------------------------------
// 下載
// ------------------------------------------------------------
export type SheetSummary = { sheet: string; table: string; label: string; rows: number; note?: string };
export type DeptExportResult = { dept: DeptKey; fileName: string; data: Uint8Array; summary: SheetSummary[] };
export type ExportOptions = {
  token: string;
  onProgress?: (msg: string) => void;
};

function cellOf(col: ColDef, v: any): any {
  if (v === null || v === undefined) return null;
  let out: any;
  switch (col.type) {
    case 'bool':
      return !!v;
    case 'int':
    case 'num':
      return typeof v === 'number' ? v : Number(v);
    case 'json':
    case 'array':
      out = typeof v === 'string' ? v : JSON.stringify(v);
      break;
    default:
      out = String(v);
  }
  if (out.length > MAX_CELL) out = TOO_LONG_PREFIX + out.slice(0, 200);
  return out;
}

function pad2(n: number) {
  return (n < 10 ? '0' : '') + n;
}
function stamp(d = new Date()) {
  return `${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}`;
}
function niceTime(d = new Date()) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

async function fetchAllRows(
  token: string,
  def: TableDef,
  total: number,
  exceptionsOnly: boolean,
  onProgress?: (msg: string) => void
): Promise<any[]> {
  const rows: any[] = [];
  let offset = 0;
  while (offset < total) {
    const r = await api<{ rows: any[]; nextOffset: number }>(token, {
      action: 'page',
      table: def.table,
      offset,
      limit: PAGE_LIMIT,
      total,
      exceptionsOnly,
    });
    if (!r.rows.length) break;
    rows.push(...r.rows);
    offset = r.nextOffset;
    onProgress?.(`${def.label}（${def.table}）讀取中… ${rows.length}/${total}`);
  }
  return rows;
}

function colWidths(header: string[], sampleRows: any[][]) {
  return header.map((h, i) => {
    let w = h.length * 1.6 + 2;
    for (let r = 0; r < Math.min(sampleRows.length, 40); r++) {
      const v = sampleRows[r][i];
      if (v == null) continue;
      const len = String(v).length * (/[^\x00-\xff]/.test(String(v)) ? 1.8 : 1);
      if (len + 2 > w) w = len + 2;
    }
    return { wch: Math.max(8, Math.min(48, Math.round(w))) };
  });
}

/** 下載一個部門的 Excel。lookups 可以共用（一次下載四個部門時只查一次）。 */
export async function exportDepartment(dept: DeptKey, opts: ExportOptions, lookupsIn?: Lookups): Promise<DeptExportResult> {
  const XLSX = await import('xlsx');
  const { token, onProgress } = opts;
  const defs = defsOfDept(dept);
  const lookups = lookupsIn ?? (await api<Lookups>(token, { action: 'lookups' }));

  onProgress?.(`${DEPT_LABEL[dept]}：計算各資料表筆數…`);
  const { counts, exceptions } = await api<{ counts: Record<string, number | null>; exceptions: Record<string, number | null> }>(token, {
    action: 'count',
    tables: defs.map((d) => d.table),
  });

  const wb = XLSX.utils.book_new();
  const summary: SheetSummary[] = [];

  for (const def of defs) {
    const total = counts[def.table];
    if (total == null) {
      // 這張表在資料庫裡不存在（沒執行過對應的 SQL）或讀不到：標示出來，不讓整份失敗
      summary.push({ sheet: def.sheet, table: def.table, label: def.label, rows: 0, note: '讀取失敗或資料表不存在，已略過' });
      continue;
    }
    // 出缺勤：這份「部門 Excel」只放遲到／曠課／請假等例外紀錄（幾十萬列「出席」塞進單一 Excel 檔，
    // 試算結果連 6GB 記憶體都會爆掉）。要連「出席」也一起帶走，請用 exportAttendanceFull()（分多個檔案）。
    const exceptionsOnly = def.table === 'attendance';
    const expected = exceptionsOnly ? exceptions[def.table] ?? total : total;
    const rows = expected > 0 ? await fetchAllRows(token, def, expected, exceptionsOnly, onProgress) : [];

    const specs = rows.length > 120000 ? [] : refSpecsFor(def);
    const header = [...def.cols.map((c) => c.name), ...specs.map((s) => s.header)];
    const body: any[][] = rows.map((r) => [...def.cols.map((c) => cellOf(c, r[c.name])), ...specs.map((s) => s.make(r, lookups))]);

    // 超過 ROWS_PER_SHEET 列就拆成多個分頁
    const parts = Math.max(1, Math.ceil(body.length / ROWS_PER_SHEET));
    for (let p = 0; p < parts; p++) {
      const slice = body.slice(p * ROWS_PER_SHEET, (p + 1) * ROWS_PER_SHEET);
      const ws = XLSX.utils.aoa_to_sheet([header, ...slice]);
      ws['!cols'] = colWidths(header, slice);
      if (slice.length > 0) ws['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: slice.length, c: header.length - 1 } }) };
      const name = p === 0 ? def.sheet : `${def.sheet.slice(0, 27)}__${p + 1}`;
      XLSX.utils.book_append_sheet(wb, ws, name);
    }

    let note: string | undefined;
    if (exceptionsOnly)
      note = `只匯出遲到／曠課／請假等非出席紀錄（全部 ${total} 筆裡有 ${total - expected} 筆「出席」未匯出）。哪幾節已經點過名請看 attendance_roll_calls 分頁：有點名＋沒有非出席紀錄＝全員出席。上傳時要把某節改回「出席」，請在這個分頁明確寫一列「出席」。`;
    else if (def.mode === 'export') note = '只供下載查看，上傳時會自動略過';
    else if (parts > 1) note = `筆數太多，已拆成 ${parts} 個分頁`;
    summary.push({ sheet: def.sheet, table: def.table, label: def.label, rows: rows.length, note });
  }

  // ---- 說明、欄位說明（放在最前面） ----
  const infoSheet = XLSX.utils.aoa_to_sheet(buildInfoAoa(dept, summary));
  infoSheet['!cols'] = [{ wch: 34 }, { wch: 40 }, { wch: 10 }, { wch: 90 }];
  const colSheet = XLSX.utils.aoa_to_sheet(buildColumnGuideAoa(defs));
  colSheet['!cols'] = [{ wch: 34 }, { wch: 30 }, { wch: 40 }, { wch: 10 }, { wch: 8 }];
  wb.SheetNames.unshift('說明', '欄位說明');
  wb.Sheets['說明'] = infoSheet;
  wb.Sheets['欄位說明'] = colSheet;

  const out = XLSX.write(wb, { bookType: 'xlsx', type: 'array' }) as ArrayBuffer;
  return { dept, fileName: `school-data_${DEPT_FILE_TAG[dept]}_${stamp()}.xlsx`, data: new Uint8Array(out), summary };
}

function buildInfoAoa(dept: DeptKey, summary: SheetSummary[]): any[][] {
  const aoa: any[][] = [];
  aoa.push([`校務行政系統資料 Excel — ${DEPT_LABEL[dept]}`]);
  aoa.push([`範圍：${DEPT_HINT[dept]}`]);
  aoa.push([`匯出時間：${niceTime()}`]);
  aoa.push([]);
  aoa.push(['【怎麼使用】']);
  aoa.push(['1. 每個分頁 = 一張資料表。第 1 列是欄位名稱，請不要改「分頁名稱」和「第 1 列欄位名稱」。']);
  aoa.push(['2.「〔參考〕」開頭的欄位（學生姓名、班級名稱…）只是方便閱讀，上傳時會自動忽略，改了也不會影響資料。']);
  aoa.push(['3. 要修改：直接改儲存格。要新增：在最後面加一列（id 欄位留空，系統會自動產生）。']);
  aoa.push(['4. 上傳是「新增＋更新」，Excel 裡沒有的資料不會被刪掉；要刪除資料請在系統畫面刪除。']);
  aoa.push(['5. 日期請用 2026-10-23 這種寫法；是/否欄位請用 TRUE / FALSE；清單欄位（JSON）請保持原樣不要手改。']);
  aoa.push(['6. 標示「只供下載」的分頁（帳號、稽核紀錄等）上傳時會自動略過，這是刻意的保護。']);
  aoa.push(['7. 四個部門的 Excel 可以一次選好一起上傳，系統會自動依資料表之間的關係排好先後順序再寫入。']);
  aoa.push([]);
  aoa.push(['分頁名稱', '資料表中文名稱', '筆數', '備註']);
  for (const s of summary) aoa.push([s.sheet, s.label, s.rows, s.note ?? '']);
  return aoa;
}

function buildColumnGuideAoa(defs: TableDef[]): any[][] {
  const aoa: any[][] = [['分頁名稱', '欄位名稱', '中文說明', '型別', '必填']];
  const typeLabel: Record<string, string> = {
    uuid: '編號', text: '文字', int: '整數', num: '數字', bool: 'TRUE/FALSE', date: '日期', ts: '日期時間', json: 'JSON', array: '清單(JSON)', bytes: '檔案',
  };
  for (const d of defs) {
    for (const c of d.cols) {
      aoa.push([d.sheet, c.name, COLUMN_LABELS[c.name] ?? '', typeLabel[c.type] ?? c.type, c.notNull && !c.hasDefault ? '必填' : '']);
    }
  }
  return aoa;
}

/**
 * 完整出缺勤（連「出席」也全部匯出）：資料量太大，沒辦法放進單一個 Excel，
 * 所以每 100,000 列切成一個檔案（每個檔案裡都是標準的 attendance 分頁），最後一起打包成 ZIP。
 * 上傳時整個 ZIP 直接丟進去就可以（和四部門的 Excel 一樣會被認出來）。
 */
export async function exportAttendanceFull(opts: ExportOptions, lookupsIn?: Lookups): Promise<DeptExportResult[]> {
  const XLSX = await import('xlsx');
  const { token, onProgress } = opts;
  const def = DEF_BY_TABLE.get('attendance')!;
  const lookups = lookupsIn ?? (await api<Lookups>(token, { action: 'lookups' }));
  const { counts } = await api<{ counts: Record<string, number | null> }>(token, { action: 'count', tables: ['attendance'] });
  const total = counts['attendance'] ?? 0;
  const specs = refSpecsFor(def);
  const header = [...def.cols.map((c) => c.name), ...specs.map((s) => s.header)];
  const results: DeptExportResult[] = [];

  const flush = (rows: any[], part: number) => {
    const body = rows.map((r) => [...def.cols.map((c) => cellOf(c, r[c.name])), ...specs.map((s) => s.make(r, lookups))]);
    const ws = XLSX.utils.aoa_to_sheet([header, ...body]);
    ws['!cols'] = colWidths(header, body);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([[`校務行政系統資料 Excel — 訓導／完整出缺勤（含出席）第 ${part} 份`], [`匯出時間：${niceTime()}`], ['這份只有 attendance 一個分頁，可以和其他部門的 Excel 一起（或打包成 ZIP）上傳。']]), '說明');
    XLSX.utils.book_append_sheet(wb, ws, def.sheet);
    const out = XLSX.write(wb, { bookType: 'xlsx', type: 'array' }) as ArrayBuffer;
    results.push({
      dept: 'discipline',
      fileName: `school-data_3-discipline_attendance-full_part${pad2(part)}.xlsx`,
      data: new Uint8Array(out),
      summary: [{ sheet: def.sheet, table: def.table, label: def.label, rows: rows.length, note: `完整出缺勤第 ${part} 份` }],
    });
  };

  let offset = 0;
  let part = 1;
  let buf: any[] = [];
  while (offset < total) {
    const r = await api<{ rows: any[]; nextOffset: number }>(token, { action: 'page', table: 'attendance', offset, limit: PAGE_LIMIT, total });
    if (!r.rows.length) break;
    buf.push(...r.rows);
    offset = r.nextOffset;
    onProgress?.(`完整出缺勤讀取中… ${offset}/${total}`);
    while (buf.length >= ROWS_PER_SHEET) {
      onProgress?.(`完整出缺勤：產生第 ${part} 份 Excel…`);
      flush(buf.splice(0, ROWS_PER_SHEET), part++);
    }
  }
  if (buf.length) flush(buf, part);
  return results;
}

export async function exportDepartments(depts: DeptKey[], opts: ExportOptions): Promise<DeptExportResult[]> {
  opts.onProgress?.('準備對照表…');
  const lookups = await api<Lookups>(opts.token, { action: 'lookups' });
  const results: DeptExportResult[] = [];
  for (const d of depts) results.push(await exportDepartment(d, opts, lookups));
  return results;
}

/** 把多個 Excel 包成一個 ZIP（檔名一律用英文，避免開啟時亂碼） */
export function zipResults(results: DeptExportResult[]): Uint8Array {
  const zip = new PizZip();
  for (const r of results) zip.file(r.fileName, r.data);
  return zip.generate({ type: 'uint8array', compression: 'DEFLATE' });
}

export function saveBytes(bytes: Uint8Array, fileName: string, mime: string) {
  const blob = new Blob([bytes as unknown as BlobPart], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
export const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
export function zipFileName() {
  return `school-data_all-4-departments_${stamp()}.zip`;
}

// ------------------------------------------------------------
// 上傳：讀檔 → 檢查（不寫入）→ 確認後才寫入
// ------------------------------------------------------------
export type ParsedSheet = {
  table: string;
  sheet: string;
  label: string;
  dept: DeptKey;
  files: string[];
  /** 通過檢查、準備寫入的列（含來源位置，方便回報錯誤） */
  rows: { data: Record<string, any>; conflict: string | null; where: string }[];
  withKey: number;
  newRows: number;
  errors: string[];
  warnings: string[];
};
export type ImportPlan = {
  sheets: ParsedSheet[];
  ignored: { file: string; sheet: string; reason: string }[];
  fileCount: number;
  validRows: number;
  errorCount: number;
};

function isBlank(v: any) {
  return v === null || v === undefined || (typeof v === 'string' && v.trim() === '');
}

type Coerced = { ok: true; value: any; omit?: boolean } | { ok: false; msg: string };
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function coerce(XLSX: typeof import('xlsx'), col: ColDef, v: any): Coerced {
  if (isBlank(v)) {
    if (!col.notNull) return { ok: true, value: null };
    if (col.hasDefault) return { ok: true, value: undefined, omit: true };
    return { ok: false, msg: `必填欄位「${col.name}」是空白（學號、姓名這類識別欄位不能留空）` };
  }
  if (typeof v === 'string' && v.startsWith(TOO_LONG_PREFIX)) {
    return { ok: false, msg: `「${col.name}」內容太長，下載時 Excel 放不下，這一列請改用 JSON 備份還原（已略過，不會覆蓋原資料）` };
  }
  switch (col.type) {
    case 'uuid': {
      const s = String(v).trim();
      return UUID_RE.test(s) ? { ok: true, value: s.toLowerCase() } : { ok: false, msg: `「${col.name}」不是正確的編號格式：${s}` };
    }
    case 'text':
      return { ok: true, value: typeof v === 'string' ? v : String(v) };
    case 'int': {
      const n = typeof v === 'number' ? v : Number(String(v).trim());
      return Number.isInteger(n) ? { ok: true, value: n } : { ok: false, msg: `「${col.name}」必須是整數：${v}` };
    }
    case 'num': {
      const n = typeof v === 'number' ? v : Number(String(v).trim());
      return Number.isFinite(n) ? { ok: true, value: n } : { ok: false, msg: `「${col.name}」必須是數字：${v}` };
    }
    case 'bool': {
      if (typeof v === 'boolean') return { ok: true, value: v };
      const s = String(v).trim().toLowerCase();
      if (['true', '1', 'yes', 'y', '是', '✔', 'v'].includes(s)) return { ok: true, value: true };
      if (['false', '0', 'no', 'n', '否', ''].includes(s)) return { ok: true, value: false };
      return { ok: false, msg: `「${col.name}」要填 TRUE 或 FALSE：${v}` };
    }
    case 'date': {
      if (typeof v === 'number') {
        const p = XLSX.SSF.parse_date_code(v);
        if (!p) return { ok: false, msg: `「${col.name}」不是正確的日期：${v}` };
        return { ok: true, value: `${p.y}-${pad2(p.m)}-${pad2(p.d)}` };
      }
      const s = String(v).trim();
      const m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/.exec(s);
      if (!m) return { ok: false, msg: `「${col.name}」日期請用 2026-10-23 的寫法：${s}` };
      return { ok: true, value: `${m[1]}-${pad2(Number(m[2]))}-${pad2(Number(m[3]))}` };
    }
    case 'ts': {
      if (typeof v === 'number') {
        const p = XLSX.SSF.parse_date_code(v);
        if (!p) return { ok: false, msg: `「${col.name}」不是正確的日期時間：${v}` };
        return { ok: true, value: `${p.y}-${pad2(p.m)}-${pad2(p.d)}T${pad2(p.H)}:${pad2(p.M)}:${pad2(Math.floor(p.S))}` };
      }
      const s = String(v).trim();
      if (Number.isNaN(Date.parse(s.replace(' ', 'T')))) return { ok: false, msg: `「${col.name}」不是正確的日期時間：${s}` };
      return { ok: true, value: s };
    }
    case 'json': {
      if (typeof v !== 'string') return { ok: true, value: v };
      try {
        return { ok: true, value: JSON.parse(v) };
      } catch {
        return { ok: false, msg: `「${col.name}」不是正確的 JSON 格式（請保持原樣不要手改）` };
      }
    }
    case 'array': {
      const s = String(v).trim();
      try {
        const parsed = JSON.parse(s);
        if (Array.isArray(parsed)) return { ok: true, value: parsed };
      } catch {
        // 不是 JSON：容許「a,b,c」寫法
        if (!s.startsWith('[') && !s.startsWith('{')) return { ok: true, value: s.split(',').map((x) => x.trim()).filter(Boolean) };
      }
      return { ok: false, msg: `「${col.name}」必須是清單，例如 ["a","b"]：${s}` };
    }
    default:
      return { ok: false, msg: `「${col.name}」是檔案類欄位，不能從 Excel 上傳` };
  }
}

function findDefBySheetName(name: string): TableDef | null {
  const m = /^(.+)__(\d+)$/.exec(name);
  const base = m ? m[1] : name;
  const exact = TABLE_DEFS.find((d) => d.sheet === base || d.table === base);
  if (exact) return exact;
  if (m) {
    const byPrefix = TABLE_DEFS.filter((d) => d.sheet.startsWith(base));
    if (byPrefix.length === 1) return byPrefix[0];
  }
  return null;
}

async function readFileBuffers(files: File[]): Promise<{ name: string; buf: ArrayBuffer }[]> {
  const out: { name: string; buf: ArrayBuffer }[] = [];
  for (const f of files) {
    if (/\.zip$/i.test(f.name)) {
      const zip = new PizZip(await f.arrayBuffer());
      for (const entry of Object.values(zip.files)) {
        if (entry.dir || /^__MACOSX\//.test(entry.name) || !/\.xlsx$/i.test(entry.name)) continue;
        const u8 = entry.asUint8Array();
        const copy = new Uint8Array(u8.length);
        copy.set(u8);
        out.push({ name: `${f.name}／${entry.name.split('/').pop()}`, buf: copy.buffer });
      }
    } else {
      out.push({ name: f.name, buf: await f.arrayBuffer() });
    }
  }
  return out;
}

/** 讀取一個或多個 .xlsx（或包含 .xlsx 的 .zip），逐列檢查，但「不寫入」。 */
export async function parseWorkbookFiles(files: File[], onProgress?: (msg: string) => void): Promise<ImportPlan> {
  const XLSX = await import('xlsx');
  const inputs = await readFileBuffers(files);
  const byTable = new Map<string, ParsedSheet>();
  const ignored: ImportPlan['ignored'] = [];

  for (const input of inputs) {
    onProgress?.(`讀取 ${input.name}…`);
    const wb = XLSX.read(input.buf, { type: 'array' });
    for (const sheetName of wb.SheetNames) {
      if (SKIP_SHEETS.has(sheetName)) continue;
      const def = findDefBySheetName(sheetName);
      if (!def) {
        ignored.push({ file: input.name, sheet: sheetName, reason: '不是本系統認得的資料表分頁，已略過' });
        continue;
      }
      if (def.mode === 'export') {
        ignored.push({ file: input.name, sheet: sheetName, reason: `「${def.label}」只供下載查看，上傳時略過` });
        continue;
      }
      if (def.mode === 'skip') {
        ignored.push({ file: input.name, sheet: sheetName, reason: `「${def.label}」請用「備份與還原」處理` });
        continue;
      }
      const matrix = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { header: 1, defval: null, raw: true, blankrows: false }) as any[][];
      if (matrix.length === 0) continue;

      let ps = byTable.get(def.table);
      if (!ps) {
        ps = { table: def.table, sheet: def.sheet, label: def.label, dept: def.dept, files: [], rows: [], withKey: 0, newRows: 0, errors: [], warnings: [] };
        byTable.set(def.table, ps);
      }
      if (!ps.files.includes(input.name)) ps.files.push(input.name);

      const header = (matrix[0] ?? []).map((h) => (h == null ? '' : String(h).trim()));
      const colIdx = new Map<string, number>();
      const unknown: string[] = [];
      header.forEach((h, i) => {
        if (!h || h.startsWith(REF_PREFIX)) return;
        if (DEF_BY_TABLE.get(def.table)!.cols.some((c) => c.name === h)) colIdx.set(h, i);
        else unknown.push(h);
      });
      if (unknown.length) ps.warnings.push(`${sheetName}：有不認得的欄位已忽略（${unknown.slice(0, 8).join('、')}${unknown.length > 8 ? '…' : ''}）`);
      const missingPk = def.pk.filter((k) => !colIdx.has(k));
      const pkIsDefault = def.pk.every((k) => def.cols.find((c) => c.name === k)?.hasDefault);
      if (missingPk.length && !pkIsDefault) {
        ps.errors.push(`${sheetName}：找不到必要的主鍵欄位「${missingPk.join('、')}」，整個分頁略過`);
        continue;
      }

      const seen = new Map<string, number>();
      for (let r = 1; r < matrix.length; r++) {
        const line = matrix[r];
        if (!line || line.every(isBlank)) continue;
        const where = `${sheetName} 第${r + 1}列`;
        const data: Record<string, any> = {};
        let bad: string | null = null;
        for (const col of def.cols) {
          const idx = colIdx.get(col.name);
          if (idx === undefined) continue; // 這個欄位沒出現在 Excel：整欄不動（用資料庫預設值）
          const res = coerce(XLSX, col, line[idx]);
          if (!res.ok) {
            bad = (res as { ok: false; msg: string }).msg;
            break;
          }
          if (!(res as { omit?: boolean }).omit) data[col.name] = (res as { value: any }).value;
        }
        if (bad) {
          ps.errors.push(`${where}：${bad}`);
          continue;
        }
        // 決定這一列要「依主鍵更新」「依唯一限制更新」還是「直接新增」
        // 點名完成紀錄：上傳出缺勤時資料庫會自動先建立同一班同一節的紀錄（編號不同），
        // 所以一律用「班級＋日期＋節次」比對更新，不用編號，避免撞到唯一限制。
        if (PREFER_UNIQUE_TABLES.has(def.table)) delete data.id;
        const hasPk = def.pk.every((k) => data[k] !== undefined && data[k] !== null);
        let conflict: string | null = null;
        if (hasPk) conflict = def.pk.join(',');
        else {
          const u = def.uniques.find((cols) => cols.every((k) => data[k] !== undefined && data[k] !== null));
          if (u) conflict = u.join(',');
        }
        if (conflict) {
          const key = conflict + '|' + conflict.split(',').map((k) => String(data[k])).join('|');
          const prev = seen.get(key);
          if (prev !== undefined) {
            ps.warnings.push(`${where}：和前面第${prev}列的資料編號／唯一值重複，以這一列為準`);
            const i = ps.rows.findIndex((x) => x.where.endsWith(`第${prev}列`) && x.where.startsWith(sheetName));
            if (i >= 0) ps.rows.splice(i, 1);
          }
          seen.set(key, r + 1);
        }
        if (conflict === def.pk.join(',')) ps.withKey++;
        else if (!conflict) ps.newRows++;
        else ps.withKey++;
        ps.rows.push({ data, conflict, where });
      }
    }
  }

  const sheets = [...byTable.values()].sort((a, b) => DEF_BY_TABLE.get(a.table)!.order - DEF_BY_TABLE.get(b.table)!.order);
  return {
    sheets,
    ignored,
    fileCount: inputs.length,
    validRows: sheets.reduce((n, s) => n + s.rows.length, 0),
    errorCount: sheets.reduce((n, s) => n + s.errors.length, 0),
  };
}

export type ImportSheetResult = { table: string; sheet: string; label: string; attempted: number; ok: number; failed: number; errors: string[] };
export type ImportOptions = { token: string; onProgress?: (msg: string) => void };

function chunkRows<T extends { data: Record<string, any> }>(rows: T[], maxRows = 2000, maxBytes = 1_200_000): T[][] {
  const out: T[][] = [];
  let cur: T[] = [];
  let bytes = 0;
  for (const r of rows) {
    const size = JSON.stringify(r.data).length + 2;
    if (cur.length > 0 && (cur.length >= maxRows || bytes + size > maxBytes)) {
      out.push(cur);
      cur = [];
      bytes = 0;
    }
    cur.push(r);
    bytes += size;
  }
  if (cur.length) out.push(cur);
  return out;
}

async function importOneSheet(ps: ParsedSheet, opts: ImportOptions): Promise<ImportSheetResult> {
  const result: ImportSheetResult = { table: ps.table, sheet: ps.sheet, label: ps.label, attempted: ps.rows.length, ok: 0, failed: 0, errors: [...ps.errors] };
  // 依 onConflict 分組（同一組才能在同一次請求寫入）
  const groups = new Map<string, typeof ps.rows>();
  for (const r of ps.rows) {
    const key = r.conflict ?? '__insert__';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(r);
  }
  let done = 0;
  for (const [key, rows] of groups) {
    for (const chunk of chunkRows(rows)) {
      opts.onProgress?.(`${ps.label}（${ps.table}）寫入中… ${done}/${ps.rows.length}`);
      try {
        const r = await api<{ ok: number; errors: { index: number; message: string }[]; errorCount?: number }>(opts.token, {
          action: 'import',
          table: ps.table,
          onConflict: key === '__insert__' ? null : key,
          rows: chunk.map((c) => c.data),
        });
        result.ok += r.ok;
        const failedHere = r.errorCount ?? r.errors.length;
        result.failed += failedHere;
        for (const e of r.errors) result.errors.push(`${chunk[e.index]?.where ?? '?'}：${e.message}`);
        if ((r.errorCount ?? 0) > r.errors.length) result.errors.push(`…另外還有 ${(r.errorCount ?? 0) - r.errors.length} 列也失敗（原因相同或類似）`);
      } catch (e: any) {
        result.failed += chunk.length;
        result.errors.push(`${ps.sheet} 有 ${chunk.length} 列整批失敗：${e?.message ?? e}`);
      }
      done += chunk.length;
    }
  }
  return result;
}

/** 依資料表之間的關係順序，把檢查通過的資料寫進資料庫（新增＋更新，不刪除）。 */
export async function runImportPlan(plan: ImportPlan, opts: ImportOptions): Promise<ImportSheetResult[]> {
  const results: ImportSheetResult[] = [];
  for (const ps of plan.sheets) {
    results.push(await importOneSheet(ps, opts));
    // 庫存進出紀錄寫入後，資料庫會依流水帳自動重算「庫存數量」，這裡再把 Excel 上的庫存數量寫回一次，確保以 Excel 為準
    if (ps.table === 'general_inventory_transactions') {
      const items = plan.sheets.find((s) => s.table === 'general_inventory_items');
      if (items) results.push(await importOneSheet({ ...items, errors: [] }, opts));
    }
  }
  return results;
}

// ------------------------------------------------------------
// 上傳前先自動備份（呼叫既有的分段備份 API）
// ------------------------------------------------------------
export async function runBackupBeforeImport(token: string, onProgress?: (msg: string) => void): Promise<void> {
  const call = async (payload: Record<string, unknown>) => {
    const res = await fetch('/api/admin/backup/create', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const body = await res.json().catch(() => null);
    if (!res.ok || !body) throw new Error(body?.error ?? `備份失敗（HTTP ${res.status}）`);
    return body as { jobId: string; done: boolean; tableIdx: number; totalTables: number };
  };
  let p = await call({ action: 'start' });
  let failures = 0;
  while (!p.done) {
    onProgress?.(`上傳前自動備份中… ${p.tableIdx}/${p.totalTables} 張資料表`);
    try {
      p = await call({ action: 'step', jobId: p.jobId });
      failures = 0;
    } catch (e) {
      if (++failures >= 3) throw e;
      await new Promise((r) => setTimeout(r, 1500));
    }
  }
}
