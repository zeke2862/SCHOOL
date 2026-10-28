/** 學號比較：純數字學號依數值由小到大（762 排在 1003 前面），非數字學號再依文字。座號依學號排時一律用這個。 */
export function compareStudentNo(a: string, b: string): number {
  const na = /^\d+$/.test(a);
  const nb = /^\d+$/.test(b);
  if (na && nb) {
    const x = a.replace(/^0+(?=\d)/, '');
    const y = b.replace(/^0+(?=\d)/, '');
    if (x.length !== y.length) return x.length < y.length ? -1 : 1;
    if (x !== y) return x < y ? -1 : 1;
    return a.localeCompare(b);
  }
  if (na !== nb) return na ? -1 : 1;
  return a.localeCompare(b);
}

/** 重排座號的方式：依學號；或先男生、再女生（性別空白的排最後），同性別內依學號。 */
export type SeatOrder = 'student_no' | 'gender';
export const SEAT_ORDER_OPTIONS: { value: SeatOrder; label: string }[] = [
  { value: 'student_no', label: '依學號' },
  { value: 'gender', label: '先男女、再學號（男生在前）' },
];

/** 性別排序：男 0、女 1（「女生」這種寫法也算女生）、其他／空白 2；要和 sql/122 的 seat_gender_rank 一致 */
export function genderRank(g: string | null | undefined): number {
  const s = (g ?? '').trim();
  return s.startsWith('男') ? 0 : s.startsWith('女') ? 1 : 2;
}

export function compareForSeat(order: SeatOrder, a: { student_no: string; gender?: string | null }, b: { student_no: string; gender?: string | null }): number {
  if (order === 'gender') {
    const d = genderRank(a.gender || genderFromStudentNo(a.student_no)) - genderRank(b.gender || genderFromStudentNo(b.student_no));
    if (d) return d;
  }
  return compareStudentNo(a.student_no, b.student_no);
}

/** 依學號判定性別：6 碼學號第 3 碼 1＝男、2＝女；其他（舊的 3～4 碼學號等）無法判定，回傳 null。要和 sql/123 的 gender_from_student_no 一致 */
export function genderFromStudentNo(studentNo: string | null | undefined): '男' | '女' | null {
  const s = (studentNo ?? '').trim();
  if (!/^\d{6}$/.test(s)) return null;
  return s[2] === '1' ? '男' : s[2] === '2' ? '女' : null;
}
