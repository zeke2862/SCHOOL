import { supabase } from './supabaseClient';

export type SeatSuggestion = { seat: number; note: string };

/**
 * 建議座號：
 *  - 這位學生在該班該學期本來就有座號（例如休學後復學）→ 沿用原座號，一樣不會插入別人的號碼
 *  - 其他情況 → 該班該學期目前最大座號 ＋ 1（編在最後一號）
 * 包含休學學生保留的座號一起算，所以不會撞到。
 */
export async function suggestSeatNo(classId: string, term: string, studentNo?: string): Promise<SeatSuggestion | null> {
  if (!classId || !term) return null;
  const { data, error } = await supabase.from('enrollments').select('student_no, seat_no').eq('class_id', classId).eq('term', term);
  if (error) return null;
  const rows = (data ?? []) as { student_no: string; seat_no: number | null }[];
  const sn = studentNo?.trim();
  const mine = sn ? rows.find((r) => r.student_no === sn) : undefined;
  if (mine?.seat_no != null) return { seat: mine.seat_no, note: `沿用這位學生在本班的原座號 ${mine.seat_no}` };
  const max = rows.reduce((m, r) => Math.max(m, r.seat_no ?? 0), 0);
  return { seat: max + 1, note: `已自動帶入本班最後一號（目前最大座號 ${max}，可手動修改）` };
}
