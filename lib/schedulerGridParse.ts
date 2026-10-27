// ============================================================
// 學校「課程表系統」Excel（全校總課表(輸入)）→ 排課專案資料
// ------------------------------------------------------------
// 學校平常用的 Excel（華雲學校課程表系統 .xlsm）和排課工具匯出的 Excel，格式一樣：
//   「全校總課表(輸入)」每個班兩列：第一列＝科目，第二列＝老師（第一格是導師）；
//   欄位是 星期一～星期六 × 節次。
// 差別只在班級的寫法：
//   「 幼乙忠班」（前面有空白、結尾有「班」）、「一年級忠」「二年級孝」、「初中一忠」「高中一」
//   排課系統的寫法是「幼乙忠」「一年忠」「初一忠」「高一忠」，所以這裡先統一成排課系統的寫法。
// 沒有「匯入的年級&科目&節數」工作表也沒關係：每個年級每個科目的節數直接從課表裡數出來
// （同年級各班取最多的那個），這樣平常用的 Excel 可以直接上傳。
// 這支只做解析（不碰資料庫），回傳的結構跟排課工具「備份專案」同一格式，
// 可以交給 importScheduleFromProjectData／importTeacherAssignmentsFromProjectData 整批寫入。
// ============================================================

export type ParsedGrid = {
  data: {
    GRADES: { id: string; name: string; classes: string[]; subs: { n: string; c: number }[] }[];
    S: {
      teachers: Record<string, Record<string, Record<string, string>>>;
      homerooms: Record<string, string>;
      schedules: Record<string, { entries: { slot: string; sub: string; teacher: string }[]; slots: string[] }>;
    };
  };
  notes: string[];
  skipped: string[];
  classCount: number;
};

const WEEKDAY_NUM: Record<string, number> = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6 };
const WEEKDAY_NAME = ['', '一', '二', '三', '四', '五', '六'];

/** 把各種寫法的班級名稱統一成排課系統的寫法；不是班級（例如「副科老師1」）回傳 null */
export function canonClassLabel(raw: string, known: Record<string, string[]>): string | null {
  let t = String(raw ?? '').replace(/\s+/g, '');
  if (!t) return null;
  if (/^副科/.test(t)) return null;
  if (t.startsWith('幼') && t.endsWith('班')) t = t.slice(0, -1);
  t = t.replace(/^(一|二|三|四|五|六)年級/, '$1年');
  t = t.replace(/^初中/, '初').replace(/^高中/, '高');
  const has = (x: string) => Object.values(known).some((list) => list.includes(x));
  if (has(t)) return t;
  if (/^[初高][一二三]$/.test(t) && has(t + '忠')) return t + '忠'; // 高中一／高中二／高中三 只有一班（忠）
  return has(t) ? t : t; // 認不得的班級名稱原樣回傳，交給後面的流程回報「找不到所屬年級」
}

export function gradeOfLabel(label: string, known: Record<string, string[]>): string | null {
  for (const [grade, list] of Object.entries(known)) if (list.includes(label)) return grade;
  return null;
}

// Excel 公式算出來「沒有資料」的格子會是 0（例如沒有導師的班級），當成空白
const clean = (v: any) => {
  const t = v == null ? '' : String(v).trim();
  return t === '0' ? '' : t;
};

export function parseSchoolGrid(rows: any[][], known: Record<string, string[]>, legacyCurriculum?: Record<string, Record<string, number>>): ParsedGrid {
  const notes: string[] = [];
  const skipped: string[] = [];
  const weekdayHeader = rows[1] ?? [];
  const periodHeader = rows[2] ?? [];

  // 欄位 → 星期（星期一 在第一格，後面兩格是空的，沿用前面的星期）；只吃到「星期六」那一組為止
  const colSlot: Record<number, string> = {};
  let lastWd: number | null = null;
  for (let c = 2; c < weekdayHeader.length; c++) {
    const lab = weekdayHeader[c];
    if (lab != null && String(lab).trim() !== '') lastWd = WEEKDAY_NUM[String(lab).replace('星期', '').trim()] ?? null;
    const p = Number(periodHeader[c]);
    if (lastWd && !Number.isNaN(p) && periodHeader[c] != null && periodHeader[c] !== '') colSlot[c] = `週${WEEKDAY_NAME[lastWd]}-${p}`;
  }

  const gradeClasses: Record<string, string[]> = {};
  const schedules: ParsedGrid['data']['S']['schedules'] = {};
  const homerooms: Record<string, string> = {};
  const teachers: Record<string, Record<string, Record<string, string>>> = {};
  const gradeId = (g: string) => 'g:' + g;
  const subjectCount: Record<string, Record<string, number>> = {}; // 年級 → 科目 → 該年級各班最多的節數

  let subTeacherRows = 0;
  for (let i = 3; i + 1 < rows.length; i += 2) {
    const subjectRow = rows[i];
    const teacherRow = rows[i + 1] ?? [];
    const rawName = subjectRow && subjectRow[1] != null ? String(subjectRow[1]) : '';
    if (!rawName.trim()) continue;
    const label = canonClassLabel(rawName, known);
    if (label == null) {
      subTeacherRows++;
      continue;
    }
    const grade = gradeOfLabel(label, known);
    const homeroom = clean(teacherRow[1]);
    const entries: { slot: string; sub: string; teacher: string }[] = [];
    const perSubTeacher: Record<string, Record<string, number>> = {};
    const perSub: Record<string, number> = {};
    for (const [cStr, slot] of Object.entries(colSlot)) {
      const c = Number(cStr);
      const sub = clean(subjectRow[c]);
      if (!sub || sub === '放學') continue;
      const teacher = clean(teacherRow[c]);
      if (!teacher) continue; // 沒有老師的格子（例如「全勤」）不算一堂課
      entries.push({ slot, sub, teacher });
      perSub[sub] = (perSub[sub] ?? 0) + 1;
      (perSubTeacher[sub] ||= {})[teacher] = (perSubTeacher[sub][teacher] ?? 0) + 1;
    }
    // 沒有導師、也完全沒有課的班（例如不存在的「五年級仁」「六年級愛」）：不是真的班，不建立
    if (!homeroom && entries.length === 0) {
      skipped.push(`${rawName.trim()}（沒有導師也沒有課，視為沒有這個班）`);
      continue;
    }
    if (!grade) {
      skipped.push(`班級「${rawName.trim()}」認不得是哪個年級（排課系統的班級是：幼乙忠、一年忠、初一孝、高一忠…）`);
      continue;
    }
    (gradeClasses[grade] ||= []).push(label);
    schedules[label] = { entries, slots: entries.map((e) => e.slot) };
    if (homeroom) homerooms[label] = homeroom;
    const tMap = ((teachers[gradeId(grade)] ||= {})[label] = {});
    for (const [sub, byT] of Object.entries(perSubTeacher)) {
      tMap[sub] = Object.entries(byT).sort((a, b) => b[1] - a[1])[0][0]; // 這個班這一科最常出現的老師
    }
    for (const [sub, n] of Object.entries(perSub)) {
      const g = (subjectCount[grade] ||= {});
      g[sub] = Math.max(g[sub] ?? 0, n);
    }
  }
  if (subTeacherRows) notes.push(`略過 ${subTeacherRows} 個「副科老師」列（那是教師視角，不是班級）。`);

  const GRADES = Object.keys(gradeClasses).map((g) => {
    const counts = { ...(subjectCount[g] ?? {}), ...(legacyCurriculum?.[g] ?? {}) };
    return { id: gradeId(g), name: g, classes: gradeClasses[g], subs: Object.entries(counts).map(([n, c]) => ({ n, c })) };
  });
  return { data: { GRADES, S: { teachers, homerooms, schedules } }, notes, skipped, classCount: Object.keys(schedules).length };
}
