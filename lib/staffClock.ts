// ============================================================
// 教職員打卡：共用邏輯（前端頁面與 /api/clock/import 都會用）
// ------------------------------------------------------------
// ⚠️ 這個檔案不可以 import 任何 Node 專用或 Supabase 前端套件，
//    伺服器 API 與瀏覽器都會載入它。
//
// 打卡機匯出檔格式（泰文 Windows-874 編碼、逗號分隔，共 9 欄）：
//   0 Depart（公司）  1 ชื่อ（名字）  2 รหัสที่เครื่อง（機器人員代碼）
//   3 วัน/เวลา（日期時間，DD/MM/YYYY HH:mm）  4 เข้า/ออก（永遠是 C/In）
//   5 หมายเลขเครื่อง（機器編號）  6 รหัสพนักงาน（員工代碼，空白）
//   7 บันทึกโดย（FP＝指紋、FACE＝人臉）  8 บัตร（卡號，空白）
// 因為表頭是泰文、編碼不是 UTF-8，欄位一律用「位置」判讀，不靠表頭文字。
// ============================================================

export const CLOCK_TZ_OFFSET_MIN = 7 * 60; // 泰國 UTC+7，不實施日光節約時間

// ---------------- 型別 ----------------
export type ClockShift = {
  id: string;
  name: string;
  start_time: string; // 'HH:MM:SS'
  end_time: string;
  late_grace_min: number;
  early_grace_min: number;
  work_days: number[]; // ISO：1=週一 … 7=週日
  window_before_min: number;
  window_after_min: number;
  active: boolean;
  sort_order: number;
};

export type ClockEmployee = {
  device_code: number;
  device_name: string;
  display_name: string | null;
  teacher_id: string | null;
  shift_ids: string[];
  active: boolean;
  note: string | null;
  /** 彈性打卡：上班時間前有打卡、下班時間後有打卡，就算有上下班（正常） */
  flexible_punch?: boolean;
};

export type ClockRecord = {
  id: string;
  device_code: number;
  punched_at: string;
  punch_date: string;
  method: string | null;
  source: string;
  voided: boolean;
  voided_reason: string | null;
  note: string | null;
};

export type ClockOverride = {
  id: string;
  device_code: number;
  punch_date: string;
  status: '正常' | '請假' | '公出' | '休假';
  note: string | null;
};

export type ClockHoliday = { holiday_date: string; name: string };

/** 特殊時段設定（clock_special_periods）。exam_week 沒有日期，由成績收件時段推算。 */
export type ClockSpecialPeriod = {
  id: string;
  name: string;
  kind: 'fixed' | 'exam_week';
  date_from: string | null;
  date_to: string | null;
  shift_ids: string[]; // 空＝所有班別
  start_time: string | null; // null＝維持原班別時間
  end_time: string | null;
  active: boolean;
  note: string | null;
};

/** 已展開成實際日期的特殊時段（考試週也已換算成日期） */
export type EffectivePeriod = { name: string; from: string; to: string; shift_ids: string[]; start_time: string | null; end_time: string | null };

/** 某天落在特殊時段內：把適用班別的上下班時間換掉，班別名稱加註時段名稱（多個時段重疊時取第一個） */
export function applyPeriods(shifts: ClockShift[], date: string, periods: EffectivePeriod[]): ClockShift[] {
  const p = periods.find((x) => x.from <= date && date <= x.to);
  if (!p) return shifts;
  return shifts.map((s) =>
    p.shift_ids.length && !p.shift_ids.includes(s.id)
      ? s
      : { ...s, name: `${s.name}（${p.name}）`, start_time: p.start_time ?? s.start_time, end_time: p.end_time ?? s.end_time }
  );
}

export type ClockRowInput = {
  device_code: number;
  device_name: string;
  punched_at: string; // ISO，帶 +07:00
  punch_date: string; // YYYY-MM-DD（泰國當地日期）
  direction: string | null;
  machine_no: number;
  method: string | null;
};

// ---------------- CSV 解碼與解析 ----------------

/** 先試 UTF-8（嚴格），失敗就當作泰文 Windows-874。表頭以外的欄位都是 ASCII，就算 windows-874 不支援也不影響資料。 */
export function decodeClockCsvBytes(bytes: Uint8Array): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^\uFEFF/, '');
  } catch {
    // 不是合法 UTF-8
  }
  try {
    return new TextDecoder('windows-874').decode(bytes);
  } catch {
    return new TextDecoder('latin1').decode(bytes);
  }
}

function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQuote = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuote) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else inQuote = false;
      } else cur += ch;
    } else if (ch === '"') inQuote = true;
    else if (ch === ',') {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

const DATETIME_RE = /^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})/;

/** 把一份打卡機 CSV 文字轉成資料列；表頭、格式不對的列只計入 invalid，不會讓整批失敗。同一分鐘同一人的重複列會合併。 */
export function parseClockCsvText(text: string): { rows: ClockRowInput[]; invalid: number } {
  const rows: ClockRowInput[] = [];
  const seen = new Set<string>();
  let invalid = 0;
  let headerSkipped = false;

  for (const rawLine of text.split(/\r?\n/)) {
    if (!rawLine.trim()) continue;
    const c = parseCsvLine(rawLine);
    const m = DATETIME_RE.exec(c[3] ?? '');
    const code = Number((c[2] ?? '').replace(/[^\d]/g, ''));
    if (!m || !/^\d+$/.test((c[2] ?? '').trim()) || !Number.isFinite(code)) {
      // 第一列通常是表頭（欄位名稱），不算錯誤
      if (!headerSkipped && rows.length === 0) {
        headerSkipped = true;
        continue;
      }
      invalid++;
      continue;
    }
    let [, dd, mm, yyyy] = m;
    let year = Number(yyyy);
    if (year > 2400) year -= 543; // 萬一匯出成佛曆
    const day = Number(dd);
    const month = Number(mm);
    const hh = Number(m[4]);
    const mi = Number(m[5]);
    if (month < 1 || month > 12 || day < 1 || day > 31 || hh > 23 || mi > 59) {
      invalid++;
      continue;
    }
    const pad = (n: number, w = 2) => String(n).padStart(w, '0');
    const punchDate = `${pad(year, 4)}-${pad(month)}-${pad(day)}`;
    const punchedAt = `${punchDate}T${pad(hh)}:${pad(mi)}:00+07:00`;
    const machineNo = Number((c[5] ?? '').replace(/[^\d]/g, '')) || 0;
    const key = `${code}|${punchedAt}|${machineNo}`;
    if (seen.has(key)) continue; // 同一分鐘重複列（機器常見），合併
    seen.add(key);
    rows.push({
      device_code: code,
      device_name: (c[1] ?? '').trim() || String(code),
      punched_at: punchedAt,
      punch_date: punchDate,
      direction: (c[4] ?? '').trim() || null,
      machine_no: machineNo,
      method: (c[7] ?? '').trim().toUpperCase() || null,
    });
  }
  return { rows, invalid };
}

// ---------------- 時間小工具 ----------------

export const WEEKDAY_LABEL = ['', '一', '二', '三', '四', '五', '六', '日']; // 以 ISO 星期當索引

export function pad2(n: number) {
  return String(n).padStart(2, '0');
}

/** 'HH:MM[:SS]' → 當天第幾分鐘 */
export function timeToMin(t: string): number {
  const [h, m] = t.split(':');
  return Number(h) * 60 + Number(m);
}

export function minToHHMM(min: number): string {
  const m = ((min % 1440) + 1440) % 1440;
  return `${pad2(Math.floor(m / 60))}:${pad2(m % 60)}`;
}

/** ISO 時間 → 泰國當地「日期＋當天第幾分鐘」 */
export function toBangkok(iso: string): { date: string; minutes: number } {
  const t = new Date(iso).getTime() + CLOCK_TZ_OFFSET_MIN * 60000;
  const d = new Date(t);
  return {
    date: `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`,
    minutes: d.getUTCHours() * 60 + d.getUTCMinutes(),
  };
}

export function bangkokNow(): { date: string; minutes: number } {
  return toBangkok(new Date().toISOString());
}

/** YYYY-MM-DD → ISO 星期（1=週一…7=週日） */
export function isoWeekday(date: string): number {
  const [y, m, d] = date.split('-').map(Number);
  const js = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0=週日
  return js === 0 ? 7 : js;
}

export function addDays(date: string, n: number): string {
  const [y, m, d] = date.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return `${t.getUTCFullYear()}-${pad2(t.getUTCMonth() + 1)}-${pad2(t.getUTCDate())}`;
}

/** 'YYYY-MM' → { from, to, days } */
export function monthRange(ym: string): { from: string; to: string; dates: string[] } {
  const [y, m] = ym.split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const dates: string[] = [];
  for (let d = 1; d <= last; d++) dates.push(`${y}-${pad2(m)}-${pad2(d)}`);
  return { from: dates[0], to: dates[dates.length - 1], dates };
}

/** 任意起訖日（含）→ { from, to, dates } */
export function dateRange(from: string, to: string): { from: string; to: string; dates: string[] } {
  const dates: string[] = [];
  for (let d = from; d <= to && dates.length < 800; d = addDays(d, 1)) dates.push(d);
  return { from, to, dates };
}

export function shiftMonth(ym: string, delta: number): string {
  const [y, m] = ym.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${t.getUTCFullYear()}-${pad2(t.getUTCMonth() + 1)}`;
}

// ---------------- 每日判定 ----------------

export type DayStatus =
  | '正常'
  | '遲到'
  | '早退'
  | '遲到早退'
  | '漏打卡'
  | '缺勤'
  | '請假'
  | '公出'
  | '休假'
  | '尚未打卡'
  | '非排班日'
  | '非排班日出勤'
  | '未設班別';

export type DaySummary = {
  date: string;
  weekday: number;
  shift: ClockShift | null;
  shiftLabel: string; // 例如「平日晚班 17:00–20:30」
  punches: string[]; // 當天所有（未作廢）打卡 HH:mm
  inTime: string | null;
  outTime: string | null;
  workedMinutes: number | null;
  lateMinutes: number;
  earlyMinutes: number;
  status: DayStatus;
  note: string; // 補充說明（漏打哪一邊、更正備註、放假名稱…）
  expected: boolean; // 這天是否「應到」（計入應到天數）
};

/** 兩次打卡間隔小於這個分鐘數，視為同一次（重複刷） */
const MIN_SPAN_MIN = 20;

/**
 * 【2026-10-31（含）以前的紀錄採寬鬆判定】僅適用「下午／晚上上班」的班別（上班時間 12:00 以後，例如 17:00 開始的晚班）：
 *  1. 當天上班時間（17:00）之前有打卡，就算正常準時上班（提早到也算，不再因為不在打卡時段內判缺勤）。
 *  2. 前一天只打了上班卡、漏打下班卡，但隔天上班時間之前打過至少兩次卡（最早那次認定為前一天下班，另一次是隔天自己的上班卡），就視為前一天有打下班卡。
 * 這是過渡期的處理，之後的日子照原本的嚴格規則判定。
 */
export const LEGACY_RULE_UNTIL = '2026-10-31';
const LEGACY_MIN_SHIFT_START = 12 * 60;

/**
 * 【歷史特殊下班時間】過去學期的考試／報名週與突發事件，晚班的下班時間與平常不同。
 * 因為屬於過去的學期，不放進「特殊時段」設定（以免出現在現在學期的時間表），直接在判定裡處理，
 * 只影響晚班類（上班時間 12:00 以後）班別，星期六早班不受影響。
 */
const LEGACY_END_OVERRIDES: { from: string; to: string; end: string; why: string }[] = [
  { from: '2026-05-12', to: '2026-05-16', end: '19:00:00', why: '學期考試／報名週' },
  { from: '2026-07-13', to: '2026-07-17', end: '19:00:00', why: '學期考試／報名週' },
  { from: '2026-08-28', to: '2026-08-28', end: '19:30:00', why: '事故，全校提早放學' },
  { from: '2026-09-21', to: '2026-09-24', end: '19:00:00', why: '學期考試／報名週' },
];

/** 彈性打卡人員：凌晨這個時間（06:00）以前的打卡算「前一天的下班」，白天的打卡才算當天上班 */
const FLEX_PREV_DAY_CUTOFF_MIN = 6 * 60;

export function shiftLabel(s: ClockShift): string {
  return `${s.name} ${s.start_time.slice(0, 5)}–${s.end_time.slice(0, 5)}`;
}

/**
 * 判定某人某一天的出勤狀態。
 * records 只需傳「這個人這一天」的未作廢紀錄；shifts 傳「這個人掛的班別」。
 * today / nowMinutes 用來避免把「還沒到的日子／今天還沒下班」誤判成缺勤。
 */
export function summarizeDay(p: {
  date: string;
  records: ClockRecord[];
  shifts: ClockShift[];
  override?: ClockOverride | null;
  holiday?: ClockHoliday | null;
  today: string;
  nowMinutes: number;
  /** 隔天的未作廢打卡（寬鬆規則 2 用：前一天漏打下班卡時，看隔天上班前有沒有打卡） */
  nextDayRecords?: ClockRecord[];
  /** 彈性打卡人員（見 ClockEmployee.flexible_punch） */
  flexible?: boolean;
}): DaySummary {
  const { date, records, shifts, override, holiday, today, nowMinutes, nextDayRecords = [], flexible = false } = p;
  const weekday = isoWeekday(date);
  const activeShifts = shifts.filter((s) => s.active);
  let shift = activeShifts.find((s) => s.work_days.includes(weekday)) ?? null;
  const endOverride = shift && timeToMin(shift.start_time) >= LEGACY_MIN_SHIFT_START ? LEGACY_END_OVERRIDES.find((w) => w.from <= date && date <= w.to) : undefined;
  if (shift && endOverride) shift = { ...shift, end_time: endOverride.end };

  const punchMinutes = records
    .map((r) => toBangkok(r.punched_at).minutes)
    .sort((a, b) => a - b)
    .filter((v, i, arr) => i === 0 || v !== arr[i - 1]);
  const punches = punchMinutes.map(minToHHMM);

  const base: DaySummary = {
    date,
    weekday,
    shift,
    shiftLabel: shift ? shiftLabel(shift) : '',
    punches,
    inTime: null,
    outTime: null,
    workedMinutes: null,
    lateMinutes: 0,
    earlyMinutes: 0,
    status: '正常',
    note: '',
    expected: false,
  };

  // 彈性打卡人員：凌晨（06:00 前）的打卡屬於前一天的下班，不算當天
  const dayPunches = flexible ? punchMinutes.filter((m) => m >= FLEX_PREV_DAY_CUTOFF_MIN) : punchMinutes;

  // 取窗內打卡計算上下班（沒有班別時，用當天首末筆）
  let inMin: number | null = null;
  let outMin: number | null = null;
  let windowed = dayPunches;
  // 寬鬆規則只適用晚班類（上班時間 12:00 以後）且日期在 LEGACY_RULE_UNTIL 以前
  const legacy = !!shift && date <= LEGACY_RULE_UNTIL && timeToMin(shift.start_time) >= LEGACY_MIN_SHIFT_START;
  if (shift) {
    const start = timeToMin(shift.start_time);
    const end = timeToMin(shift.end_time);
    const from = legacy || flexible ? 0 : start - shift.window_before_min; // 寬鬆規則：上班前任何時間的打卡都算
    windowed = dayPunches.filter((m) => m >= from && m <= end + shift.window_after_min);
  }
  if (windowed.length >= 2 && windowed[windowed.length - 1] - windowed[0] >= MIN_SPAN_MIN) {
    inMin = windowed[0];
    outMin = windowed[windowed.length - 1];
  }
  const fillTimes = (s: DaySummary) => {
    if (inMin != null) s.inTime = minToHHMM(inMin);
    if (outMin != null) s.outTime = minToHHMM(outMin);
    if (inMin != null && outMin != null) s.workedMinutes = outMin - inMin;
  };

  // 1) 人工更正優先
  if (override) {
    fillTimes(base);
    base.status = override.status === '正常' ? '正常' : override.status;
    base.note = override.note ?? '';
    base.expected = override.status === '正常' || override.status === '公出';
    return base;
  }

  // 2) 全校放假日
  if (holiday) {
    fillTimes(base);
    base.status = '休假';
    base.note = holiday.name || '放假';
    return base;
  }

  // 3) 沒設班別
  if (shifts.length === 0 || activeShifts.length === 0) {
    fillTimes(base);
    if (windowed.length >= 2) {
      base.inTime = minToHHMM(windowed[0]);
      base.outTime = minToHHMM(windowed[windowed.length - 1]);
      base.workedMinutes = windowed[windowed.length - 1] - windowed[0];
    }
    base.status = '未設班別';
    base.note = punches.length ? '尚未指定班別，僅顯示打卡時間' : '';
    return base;
  }

  // 4) 今天不是這個人的上班日
  if (!shift) {
    base.status = punches.length ? '非排班日出勤' : '非排班日';
    if (punches.length >= 2) {
      base.inTime = punches[0];
      base.outTime = punches[punches.length - 1];
    }
    return base;
  }

  // 5) 正常上班日
  base.expected = true;
  const start = timeToMin(shift.start_time);
  const end = timeToMin(shift.end_time);
  const isFuture = date > today;
  const isToday = date === today;
  const dayOver = date < today || (isToday && nowMinutes > end + shift.window_after_min);

  if (isFuture) {
    base.expected = false;
    base.status = '尚未打卡';
    base.note = '';
    return base;
  }

  // 彈性打卡：上班時間（含）前有打卡、下班時間（含）後有打卡 → 算有上下班，不計遲到早退
  if (flexible) {
    const first = dayPunches[0];
    const last = dayPunches[dayPunches.length - 1];
    // 隔天凌晨（06:00 前）的打卡算這天的下班
    const nextEarly = nextDayRecords
      .map((r) => toBangkok(r.punched_at).minutes)
      .filter((m) => m < FLEX_PREV_DAY_CUTOFF_MIN)
      .sort((a, b) => b - a)[0];
    if (first != null && first <= start && (last >= end || nextEarly != null)) {
      const nextDay = !(last >= end);
      base.inTime = minToHHMM(first);
      base.outTime = nextDay ? minToHHMM(nextEarly!) + '（隔天）' : minToHHMM(last);
      base.workedMinutes = nextDay ? nextEarly! + 1440 - first : last - first;
      base.status = '正常';
      base.note = nextDay ? `彈性打卡；下班以隔天凌晨 ${minToHHMM(nextEarly!)} 的打卡認定` : '彈性打卡';
      return base;
    }
  }

  if (windowed.length === 0) {
    if (isToday && !dayOver) {
      base.status = '尚未打卡';
      return base;
    }
    base.status = '缺勤';
    base.note = punches.length ? '有打卡但不在上下班時段內' : '當天沒有任何打卡';
    return base;
  }

  if (inMin == null || outMin == null) {
    // 只有一次（或兩次間隔太近）：判斷比較像上班還是下班
    const only = windowed[0];
    const mid = (start + end) / 2;

    // 寬鬆規則 2：只有上班卡，但隔天上班前還有打過卡 → 視為有打下班
    if (legacy && !isToday && only <= mid) {
      // 隔天上班前要打過至少兩次：最早那次才算前一天的下班，後面那次是隔天自己的上班卡（不能拿上班卡當前一天下班）
      const nextBefore = nextDayRecords
        .map((r) => toBangkok(r.punched_at).minutes)
        .filter((m) => m < start)
        .sort((a, b) => a - b);
      const nextEarly = nextBefore.length >= 2 ? nextBefore[0] : undefined;
      if (nextEarly != null) {
        base.inTime = minToHHMM(only);
        base.outTime = minToHHMM(nextEarly) + '（隔天）';
        base.lateMinutes = Math.max(0, only - start);
        base.status = base.lateMinutes > shift.late_grace_min ? '遲到' : '正常';
        base.note = `下班卡以隔天 ${minToHHMM(nextEarly)} 的打卡認定` + (base.status === '遲到' ? `；遲到 ${base.lateMinutes} 分` : '');
        return base;
      }
    }
    if (isToday && !dayOver && only <= mid) {
      base.inTime = minToHHMM(only);
      base.lateMinutes = Math.max(0, only - start);
      base.status = base.lateMinutes > shift.late_grace_min ? '遲到' : '正常';
      base.note = '上班中（尚未下班打卡）';
      return base;
    }
    base.status = '漏打卡';
    if (only <= mid) {
      base.inTime = minToHHMM(only);
      base.lateMinutes = Math.max(0, only - start);
      base.note = '只有上班打卡，漏打下班卡';
    } else {
      base.outTime = minToHHMM(only);
      base.earlyMinutes = Math.max(0, end - only);
      base.note = '只有下班打卡，漏打上班卡';
    }
    return base;
  }

  base.inTime = minToHHMM(inMin);
  base.outTime = minToHHMM(outMin);
  base.workedMinutes = outMin - inMin;
  const late = Math.max(0, inMin - start);
  const early = Math.max(0, end - outMin);
  base.lateMinutes = late;
  base.earlyMinutes = early;
  const isLate = late > shift.late_grace_min;
  const isEarly = early > shift.early_grace_min;
  base.status = isLate && isEarly ? '遲到早退' : isLate ? '遲到' : isEarly ? '早退' : '正常';
  if (isLate) base.note = `遲到 ${late} 分`;
  if (isEarly) base.note = (base.note ? base.note + '、' : '') + `早退 ${early} 分`;
  return base;
}

// ---------------- 區間統計 ----------------

export type RangeStats = {
  expectedDays: number; // 應到天數（有班別、非放假、非請假/休假、不含未來）
  attendedDays: number; // 有出勤（正常/遲到/早退/遲到早退/漏打卡/公出/視為正常）
  normal: number;
  late: number; // 含遲到早退
  early: number; // 含遲到早退
  missing: number; // 漏打卡
  absent: number; // 缺勤
  leave: number; // 請假
  official: number; // 公出
  lateMinutes: number;
  earlyMinutes: number;
  workedMinutes: number;
};

export function summarizeRange(days: DaySummary[]): RangeStats {
  const s: RangeStats = {
    expectedDays: 0,
    attendedDays: 0,
    normal: 0,
    late: 0,
    early: 0,
    missing: 0,
    absent: 0,
    leave: 0,
    official: 0,
    lateMinutes: 0,
    earlyMinutes: 0,
    workedMinutes: 0,
  };
  for (const d of days) {
    if (d.status === '請假') s.leave++;
    if (d.status === '公出') s.official++;
    if (d.expected) s.expectedDays++;
    if (!d.expected && d.status !== '公出') {
      // 非應到日不計入出勤統計（但 workedMinutes 還是累計）
      if (d.workedMinutes) s.workedMinutes += d.workedMinutes;
      continue;
    }
    if (d.workedMinutes) s.workedMinutes += d.workedMinutes;
    switch (d.status) {
      case '正常':
        s.normal++;
        s.attendedDays++;
        break;
      case '遲到':
        s.late++;
        s.attendedDays++;
        s.lateMinutes += d.lateMinutes;
        break;
      case '早退':
        s.early++;
        s.attendedDays++;
        s.earlyMinutes += d.earlyMinutes;
        break;
      case '遲到早退':
        s.late++;
        s.early++;
        s.attendedDays++;
        s.lateMinutes += d.lateMinutes;
        s.earlyMinutes += d.earlyMinutes;
        break;
      case '漏打卡':
        s.missing++;
        s.attendedDays++;
        break;
      case '公出':
        s.attendedDays++;
        break;
      case '缺勤':
        s.absent++;
        break;
      default:
        break;
    }
  }
  return s;
}

export function fmtHours(min: number): string {
  if (!min) return '0';
  return `${Math.floor(min / 60)}小時${pad2(min % 60)}分`;
}

export const STATUS_COLOR: Record<DayStatus, { bg: string; fg: string }> = {
  正常: { bg: '#e8f5e9', fg: '#1b5e20' },
  遲到: { bg: '#fff3e0', fg: '#e65100' },
  早退: { bg: '#fff3e0', fg: '#e65100' },
  遲到早退: { bg: '#ffe0b2', fg: '#bf360c' },
  漏打卡: { bg: '#fff8e1', fg: '#b26a00' },
  缺勤: { bg: '#ffebee', fg: '#b71c1c' },
  請假: { bg: '#e3f2fd', fg: '#0d47a1' },
  公出: { bg: '#e3f2fd', fg: '#0d47a1' },
  休假: { bg: '#f3e5f5', fg: '#4a148c' },
  尚未打卡: { bg: '#f5f5f5', fg: '#777' },
  非排班日: { bg: '#fafafa', fg: '#aaa' },
  非排班日出勤: { bg: '#e0f2f1', fg: '#004d40' },
  未設班別: { bg: '#f5f5f5', fg: '#777' },
};

/** 顯示名稱：自訂名稱 ＞ 教師姓名 ＞ 打卡機名字 */
export function employeeLabel(e: ClockEmployee, teacherName?: string | null): string {
  return e.display_name || teacherName || e.device_name;
}
