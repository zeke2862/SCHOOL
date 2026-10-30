import { supabase } from '@/lib/supabaseClient';
import {
  ClockEmployee,
  ClockHoliday,
  ClockOverride,
  ClockRecord,
  ClockShift,
  ClockSpecialPeriod,
  DaySummary,
  EffectivePeriod,
  addDays,
  applyPeriods,
  bangkokNow,
  summarizeDay,
} from '@/lib/staffClock';

const PAGE = 1000; // PostgREST 預設單次上限 1000 列，一律分頁撈取避免被悄悄截斷

async function fetchAll<T>(build: (from: number, to: number) => PromiseLike<{ data: any[] | null; error: any }>): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as T[];
    out.push(...rows);
    if (rows.length < PAGE) break;
  }
  return out;
}

export async function loadShifts(): Promise<ClockShift[]> {
  const { data, error } = await supabase.from('clock_shifts').select('*').order('sort_order').order('start_time');
  if (error) throw new Error('讀取班別失敗：' + error.message);
  return (data ?? []) as ClockShift[];
}

export async function loadHolidays(from: string, to: string): Promise<ClockHoliday[]> {
  const { data, error } = await supabase.from('clock_holidays').select('holiday_date, name').gte('holiday_date', from).lte('holiday_date', to);
  if (error) throw new Error('讀取放假日失敗：' + error.message);
  return (data ?? []) as ClockHoliday[];
}

/** 某天排班的在職人員有 80% 以上沒打卡，就自動當放假日（sql/126；函式還沒建立時回傳空的，不影響其他功能） */
export const AUTO_HOLIDAY_RATIO = 0.8;

export async function loadAutoHolidays(from: string, to: string): Promise<ClockHoliday[]> {
  const { data, error } = await supabase.rpc('clock_auto_holidays', { p_from: from, p_to: to, p_ratio: AUTO_HOLIDAY_RATIO });
  if (error) return [];
  return ((data ?? []) as { day: string; scheduled: number; punched: number }[]).map((r) => ({
    holiday_date: r.day,
    name: `自動判定放假（${r.scheduled} 人只有 ${r.punched} 人打卡）`,
  }));
}

export async function loadSpecialPeriods(): Promise<ClockSpecialPeriod[]> {
  const { data, error } = await supabase.from('clock_special_periods').select('*').order('kind').order('date_from', { ascending: false });
  if (error) return []; // sql/127 還沒執行時當作沒有特殊時段
  return (data ?? []) as ClockSpecialPeriod[];
}

export type ExamWeek = { academic_year: number; term: string; exam: string; from: string; to: string };

/** 考試週：成績收件時段（全校）期中考／期末考的開放日當第一天，往後算一週 */
export async function loadExamWeeks(): Promise<ExamWeek[]> {
  const { data, error } = await supabase.rpc('clock_exam_weeks');
  if (error) return [];
  return ((data ?? []) as { academic_year: number; term: string; exam: string; first_day: string }[]).map((r) => ({
    academic_year: r.academic_year,
    term: r.term,
    exam: r.exam,
    from: r.first_day,
    to: addDays(r.first_day, 6),
  }));
}

/** 把啟用中的特殊時段展開成實際日期（考試週套到每一次考試），只留跟 [from, to] 有重疊的 */
export function expandPeriods(periods: ClockSpecialPeriod[], exams: ExamWeek[], from: string, to: string): EffectivePeriod[] {
  const out: EffectivePeriod[] = [];
  for (const p of periods) {
    if (!p.active) continue;
    const base = { shift_ids: p.shift_ids ?? [], start_time: p.start_time, end_time: p.end_time };
    if (p.kind === 'exam_week') {
      for (const e of exams) out.push({ ...base, name: `${e.exam}週`, from: e.from, to: e.to });
    } else if (p.date_from && p.date_to) {
      out.push({ ...base, name: p.name, from: p.date_from, to: p.date_to });
    }
  }
  return out.filter((p) => p.from <= to && p.to >= from);
}

/**
 * 計算出勤用的行事曆：
 * - 放假日＝手動設定 ＋ 自動判定（同一天以手動設定為準）；落在特殊時段內的日子不自動判定放假（例如考試週只有少數人來，也不能整天當放假）
 * - 特殊時段＝固定日期的時段 ＋ 考試週
 */
export async function loadClockCalendar(from: string, to: string): Promise<{ holidays: ClockHoliday[]; periods: EffectivePeriod[] }> {
  const [manual, auto, sp, exams] = await Promise.all([loadHolidays(from, to), loadAutoHolidays(from, to), loadSpecialPeriods(), loadExamWeeks()]);
  const periods = expandPeriods(sp, exams, from, to);
  const set = new Set(manual.map((h) => h.holiday_date));
  const inPeriod = (d: string) => periods.some((p) => p.from <= d && d <= p.to);
  return { holidays: [...manual, ...auto.filter((h) => !set.has(h.holiday_date) && !inPeriod(h.holiday_date))], periods };
}

export type ClockTerm = { key: string; label: string; academicYear: number; from: string; to: string; isCurrent: boolean };

/** 學年學期設定（academic_terms）→ 打卡統計可選的學期，新的在前。起訖日沒填就用學校預設（上學期 5/1–9/30、下學期 10/20–隔年 3/31）。 */
export async function loadClockTerms(): Promise<ClockTerm[]> {
  const { data, error } = await supabase
    .from('academic_terms')
    .select('academic_year, term, term_start_date, term_end_date, is_current, status')
    .order('academic_year', { ascending: false });
  if (error) throw new Error('讀取學年學期失敗：' + error.message);
  const rows = (data ?? []) as { academic_year: number; term: string; term_start_date: string | null; term_end_date: string | null; is_current: boolean; status: string }[];
  const today = bangkokNow().date;
  const terms = rows.map((r) => {
    const second = r.term === '下學期';
    const from = r.term_start_date ?? (second ? `${r.academic_year}-10-20` : `${r.academic_year}-05-01`);
    const to = r.term_end_date ?? (second ? `${r.academic_year + 1}-03-31` : `${r.academic_year}-09-30`);
    return { key: `${r.academic_year}-${r.term}`, label: `${r.academic_year} ${r.term}`, academicYear: r.academic_year, from, to, isCurrent: r.is_current, status: r.status };
  });
  terms.sort((a, b) => b.from.localeCompare(a.from));
  // 目前學期：有人設定「目前生效」就用那筆；否則用「今天落在起訖日內」的；再不然用狀態「進行中」的
  const current = terms.find((t) => t.isCurrent) ?? terms.find((t) => t.from <= today && today <= t.to) ?? terms.find((t) => t.status === '進行中');
  return terms.map(({ status, ...t }) => ({ ...t, isCurrent: t.key === current?.key }));
}

export type ClockYear = { key: string; label: string; from: string; to: string; isCurrent: boolean };

/** 學年統計：同一學年度所有學期的最早開學日～最晚期末日 */
export function termsToYears(terms: ClockTerm[]): ClockYear[] {
  const by = new Map<number, ClockTerm[]>();
  for (const t of terms) by.set(t.academicYear, [...(by.get(t.academicYear) ?? []), t]);
  return Array.from(by.entries())
    .sort((a, b) => b[0] - a[0])
    .map(([y, ts]) => ({
      key: String(y),
      label: `${y} 學年度`,
      from: ts.map((t) => t.from).sort()[0],
      to: ts.map((t) => t.to).sort().reverse()[0],
      isCurrent: ts.some((t) => t.isCurrent),
    }));
}

export async function loadEmployees(): Promise<ClockEmployee[]> {
  const { data, error } = await supabase.from('clock_employee_map').select('*').order('device_code');
  if (error) throw new Error('讀取人員對照失敗：' + error.message);
  return (data ?? []) as ClockEmployee[];
}

/** 讀取區間內的打卡與更正。codes 有給就只撈這些人（一般教職員自己查自己時用），沒給就撈全部（管理權限）。 */
export async function loadClockRange(from: string, to: string, codes?: number[], lookahead = false) {
  // lookahead：多撈區間後一天的打卡，給「隔天上班前打卡視為前一天下班」的判定用（只供 buildDays，不要拿來列清單）
  const toQ = lookahead ? addDays(to, 1) : to;
  if (codes && codes.length === 0) return { records: [] as ClockRecord[], overrides: [] as ClockOverride[] };
  const records = await fetchAll<ClockRecord>((a, b) => {
    let q = supabase
      .from('clock_records')
      .select('id, device_code, punched_at, punch_date, method, source, voided, voided_reason, note')
      .gte('punch_date', from)
      .lte('punch_date', toQ)
      .order('punched_at')
      .range(a, b);
    if (codes) q = q.in('device_code', codes);
    return q;
  });
  const overrides = await fetchAll<ClockOverride>((a, b) => {
    let q = supabase
      .from('clock_day_overrides')
      .select('id, device_code, punch_date, status, note')
      .gte('punch_date', from)
      .lte('punch_date', to)
      .range(a, b);
    if (codes) q = q.in('device_code', codes);
    return q;
  });
  return { records, overrides };
}

export async function loadLastDataAt(): Promise<string | null> {
  const { data, error } = await supabase.rpc('clock_last_data_at');
  if (error) return null;
  return (data as string | null) ?? null;
}

/** 依區間內每天產生一個人的 DaySummary 清單 */
export function buildDays(p: {
  dates: string[];
  employee: ClockEmployee;
  shiftsById: Map<string, ClockShift>;
  records: ClockRecord[]; // 該員工、區間內全部（含作廢，函式內會濾掉）
  overrides: ClockOverride[];
  holidays: Map<string, ClockHoliday>;
  periods?: EffectivePeriod[]; // 特殊時段／考試週：期間內改用設定的上下班時間
}): DaySummary[] {
  const { dates, employee, shiftsById, records, overrides, holidays, periods = [] } = p;
  const myShifts = employee.shift_ids.map((id) => shiftsById.get(id)).filter(Boolean) as ClockShift[];
  const byDate = new Map<string, ClockRecord[]>();
  for (const r of records) {
    if (r.voided) continue;
    const arr = byDate.get(r.punch_date) ?? [];
    arr.push(r);
    byDate.set(r.punch_date, arr);
  }
  const ovByDate = new Map(overrides.map((o) => [o.punch_date, o]));
  const now = bangkokNow();
  return dates.map((date) =>
    summarizeDay({
      date,
      records: byDate.get(date) ?? [],
      nextDayRecords: byDate.get(addDays(date, 1)) ?? [],
      shifts: applyPeriods(myShifts, date, periods),
      override: ovByDate.get(date) ?? null,
      holiday: holidays.get(date) ?? null,
      today: now.date,
      nowMinutes: now.minutes,
    })
  );
}

export { addDays };
