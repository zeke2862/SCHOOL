// 全校報表的固定排序：部別（幼兒乙、甲 → 國小一～六年級 → 中一～三 → 高一～三），同年級內班級依 忠、孝、仁、愛。
// 資料庫裡的年級寫法是 幼乙／幼甲／1年～6年／初一～初三／高一～高三，這裡全部列出，找不到的排最後。
const GRADE_ORDER = ['幼乙', '幼甲', '1年', '2年', '3年', '4年', '5年', '6年', '初一', '初二', '初三', '高一', '高二', '高三'];
const CLASS_ORDER = ['忠', '孝', '仁', '愛'];

export function gradeRank(gradeLevel: string): number {
  const i = GRADE_ORDER.indexOf(gradeLevel);
  return i === -1 ? GRADE_ORDER.length : i;
}

export function classRank(className: string): number {
  const i = CLASS_ORDER.findIndex((c) => className.includes(c));
  return i === -1 ? CLASS_ORDER.length : i;
}

export function compareGradeClass(a: { grade_level: string; class_name?: string }, b: { grade_level: string; class_name?: string }): number {
  return (
    gradeRank(a.grade_level) - gradeRank(b.grade_level) ||
    classRank(a.class_name ?? '') - classRank(b.class_name ?? '') ||
    a.grade_level.localeCompare(b.grade_level) ||
    (a.class_name ?? '').localeCompare(b.class_name ?? '')
  );
}
