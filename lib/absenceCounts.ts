import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * 一次查多位學生本學期的缺課節數（事假＋病假＋曠課），用於點名儲存後判斷是否達到「缺課通知」門檻。
 *
 * 以前是對每位學生各查一次 student_absence_counts 檢視表（正式站佔資料庫總耗時約 65%），
 * 改成呼叫 student_absence_periods（sql/159）一次查完；權限規則與出缺勤讀取政策相同。
 * 查不到（或沒有權限看）的學生回 0，和舊寫法 `data?.absence_periods ?? 0` 一致。
 */
export async function fetchAbsenceCounts(supabase: SupabaseClient, studentNos: string[]): Promise<Map<string, number>> {
  const result = new Map<string, number>();
  const unique = Array.from(new Set(studentNos.filter(Boolean)));
  if (unique.length === 0) return result;
  const { data, error } = await supabase.rpc('student_absence_periods', { p_student_nos: unique });
  if (error || !data) return result;
  for (const row of data as { student_no: string; absence_periods: number | string | null }[]) {
    result.set(row.student_no, Number(row.absence_periods) || 0);
  }
  return result;
}
