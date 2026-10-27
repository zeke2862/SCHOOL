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
