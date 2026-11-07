// 社團名單排序：先依部別（幼兒園、國小、國中、高中），再依年級，同年級依班別（忠、孝、仁、愛），最後依原班座號。
const DEPT_ORDER = ['幼兒園', '國小', '國中', '高中'];
const GRADE_ORDER = ['幼乙', '幼甲', '1年', '2年', '3年', '4年', '5年', '6年', '初一', '初二', '初三', '高一', '高二', '高三'];
const CLASS_ORDER = ['忠', '孝', '仁', '愛'];

const pos = (arr: string[], v: string | null | undefined) => {
  const i = v ? arr.indexOf(v) : -1;
  return i === -1 ? 99 : i;
};

/**
 * 這位學生在指定學期有沒有「現行學籍」。休學、退學、轉出的學生沒有現行學籍，
 * 社團名單／點名冊／成績表都不列出（名單序號自然往上補），資料庫裡的入社紀錄保留，復學後自動回來。
 * enrollments 傳 students 底下展開的 enrollments（單筆或陣列）。
 */
export function hasCurrentEnrollment(enrollments: any, term: { academic_year: number; term: string } | null): boolean {
  const list = Array.isArray(enrollments) ? enrollments : enrollments ? [enrollments] : [];
  return list.some((e: any) => e?.is_current && (!term || (e?.term === term.term && e?.classes?.academic_year === term.academic_year)));
}

/** 班級的排序值（越小越前面）；沒有現行學籍的人排最後 */
export function classSortKey(department?: string | null, grade?: string | null, className?: string | null): number {
  if (!department && !grade && !className) return 999999;
  return pos(DEPT_ORDER, department) * 10000 + pos(GRADE_ORDER, grade) * 100 + pos(CLASS_ORDER, className);
}

export function compareByClassThenSeat(a: { sort_key: number; seat_no: number | null }, b: { sort_key: number; seat_no: number | null }) {
  return a.sort_key - b.sort_key || (a.seat_no ?? 0) - (b.seat_no ?? 0);
}
