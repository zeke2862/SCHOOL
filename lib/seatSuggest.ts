import { supabase } from './supabaseClient';
import { estimateTermStart } from './academicTerm';

export type SeatSuggestion = { seat: number; note: string };
export type ReturnSeatSuggestion = { seat: number; max: number; oldSeat: number | null; started: boolean; note: string };

/**
 * 這個班級的這個學期「開學了沒」（今天 ≥ 開學日）。
 * 開學前座號排序還沒定案，復學生可以沿用原座號；開學後全班座號已經安排好，不能再插入，一律排在最後。
 * 學年學期設定沒填開學日時，用預設的估計日期。
 */
async function termHasStarted(classId: string, term: string): Promise<boolean> {
  const { data: cls } = await supabase.from('classes').select('academic_year').eq('id', classId).maybeSingle();
  if (!cls) return true; // 查不到就當作已開學（排最後比較安全，不會插入別人的號碼）
  const { data: t } = await supabase.from('academic_terms').select('term_start_date').eq('academic_year', cls.academic_year).eq('term', term).maybeSingle();
  const start = t?.term_start_date ?? estimateTermStart(cls.academic_year, term);
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const today = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  return today >= start;
}

/**
 * 復學座號建議：
 *  - 已開學 → 該班該學期「其他學生」目前用到的最後一號 ＋ 1（不插入、不沿用舊號；他換號後原號會釋出）
 *  - 還沒開學 → 有原座號就沿用原座號，沒有才排最後一號 ＋ 1
 * 最大座號包含休學者保留的座號，所以不會撞號。
 */
export async function suggestReturnSeat(classId: string, term: string, studentNo: string): Promise<ReturnSeatSuggestion | null> {
  if (!classId || !term) return null;
  const { data, error } = await supabase.from('enrollments').select('student_no, seat_no').eq('class_id', classId).eq('term', term);
  if (error) return null;
  const rows = (data ?? []) as { student_no: string; seat_no: number | null }[];
  const sn = studentNo.trim();
  const oldSeat = rows.find((r) => r.student_no === sn)?.seat_no ?? null;
  const max = rows.filter((r) => r.student_no !== sn).reduce((m, r) => Math.max(m, r.seat_no ?? 0), 0);
  const started = await termHasStarted(classId, term);
  if (!started && oldSeat != null) {
    return { seat: oldSeat, max, oldSeat, started, note: `還沒開學，座號排序尚未定案，沿用原座號 ${oldSeat}` };
  }
  return {
    seat: max + 1,
    max,
    oldSeat,
    started,
    note:
      `已開學，全班座號已安排好，不插入：本班目前使用到 ${max} 號（含休學保留的座號），建議新座號 ${max + 1}` +
      (oldSeat != null ? `；這位學生原座號 ${oldSeat}，換號後原號會釋出` : '；這位學生在本班本學期沒有舊座號'),
  };
}

/**
 * 建議座號（新生、轉學、舊生建檔用）：
 *  - 還沒開學，且這位學生在該班該學期本來就有座號 → 沿用原座號
 *  - 其他情況（含已開學）→ 該班該學期目前最大座號 ＋ 1（編在最後一號）
 * 包含休學學生保留的座號一起算，所以不會撞到。
 */
export async function suggestSeatNo(classId: string, term: string, studentNo?: string): Promise<SeatSuggestion | null> {
  if (!classId || !term) return null;
  const { data, error } = await supabase.from('enrollments').select('student_no, seat_no').eq('class_id', classId).eq('term', term);
  if (error) return null;
  const rows = (data ?? []) as { student_no: string; seat_no: number | null }[];
  const sn = studentNo?.trim();
  const mine = sn ? rows.find((r) => r.student_no === sn) : undefined;
  if (mine?.seat_no != null && !(await termHasStarted(classId, term))) {
    return { seat: mine.seat_no, note: `還沒開學，沿用這位學生在本班的原座號 ${mine.seat_no}` };
  }
  const max = rows.filter((r) => r.student_no !== sn).reduce((m, r) => Math.max(m, r.seat_no ?? 0), 0);
  return { seat: max + 1, note: `已自動帶入本班最後一號（目前最大座號 ${max}，可手動修改）` };
}
