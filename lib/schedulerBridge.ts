import { supabase } from './supabaseClient';
import { resolveClassId, resolveTeacherByName, upsertTeacherAssignment } from './bulkHandlers';
import { departmentForGrade } from './gradeMapping';
import { parseSchoolGrid } from './schedulerGridParse';

// ============================================================
// 排課系統橋接工具
// ------------------------------------------------------------
// 「排課系統」(app/(app)/admin/scheduling/scheduler-tool.html，原始檔：
// scheduler_v0729-6小學星期六顯示.html) 是一個完全獨立、資料存在瀏覽器
// localStorage 的排課小工具，年級／班級清單寫死在它自己的原始碼(GRADES 陣列)裡。
//
// 這個檔案的用途：把校務行政系統裡「科目與比重設定」「班級與導師設定」
// 「任課教師設定」既有的資料，轉成排課系統「匯入教師」「年級設定→一鍵匯入全校」
// 兩個分頁看得懂的貼上格式，avoid逐筆手動重打。
//
// 因為班級名稱是用「字串猜測」對應過去的（例如校務系統存的是「忠」，排課系統
// 認得的是「一年忠」），猜不出來或猜錯的地方都會列在 warnings 裡，
// 請管理者在貼到排課系統之前，肉眼確認一次再貼上。
// ============================================================

// 校務系統「年級」欄位 → 排課系統「年級名稱」欄位 的對照表
//
// 【2026-08 年級文字統一】校務系統的「初一/初二/初三」「高一/高二/高三」跟排課系統原本
// 就是同一套文字，不需要再轉換過去（以前這裡誤寫成「初中一」「高中一」這種帶「中」字的
// 版本，跟 lib/gradeMapping.ts 對不上，已改成一致），保留這個對照表只是讓「校務系統欄位」
// 跟「排課系統欄位」在語意上還是分開兩個獨立清單，日後如果其中一邊的文字要單獨調整還是
// 可以只改這裡，不用去動另一邊。
export const GRADE_LEVEL_TO_SCHEDULER: Record<string, string> = {
  '幼甲': '幼甲',
  '幼乙': '幼乙',
  '1年': '一年級',
  '2年': '二年級',
  '3年': '三年級',
  '4年': '四年級',
  '5年': '五年級',
  '6年': '六年級',
  '初一': '初一',
  '初二': '初二',
  '初三': '初三',
  '高一': '高一',
  '高二': '高二',
  '高三': '高三',
};

// 對照排課系統原始碼(GRADES 陣列)裡目前寫死的班級清單，用來猜測班級名稱。
// 學校日後如果調整班級名稱／新增班級，這裡跟排課系統原始碼（public/scheduler/scheduler-tool.html
// 的 GRADES 陣列）都要一起改，兩邊班級清單必須完全一致，否則會出現「找不到對應年級」的錯誤。
//
// 【2026-08 修正】依「校務系統完整資料快照」現況，高一/高二/高三目前都各自只有一個「忠」班，
// 這裡原本寫的是 ['高一']／['高二']／['高三']（把年級名稱當成班級名稱，沒有加班級字），
// 跟校務系統「年級=高一、班級名稱=忠」兜出來的「高一忠」對不起來，才會出現
// 「高一忠: 找不到對應年級」「高二忠: 找不到對應年級」「高三忠: 找不到對應年級」的錯誤，已修正。
export const SCHEDULER_CLASSES: Record<string, string[]> = {
  '幼甲': ['幼甲忠', '幼甲孝', '幼甲仁', '幼甲愛'],
  '幼乙': ['幼乙忠', '幼乙孝', '幼乙仁', '幼乙愛'],
  '一年級': ['一年忠', '一年孝', '一年仁', '一年愛'],
  '二年級': ['二年忠', '二年孝', '二年仁'],
  '三年級': ['三年忠', '三年孝', '三年仁', '三年愛'],
  '四年級': ['四年忠', '四年孝', '四年仁'],
  '五年級': ['五年忠', '五年孝'],
  '六年級': ['六年忠', '六年孝'],
  '初一': ['初一忠', '初一孝'],
  '初二': ['初二忠', '初二孝'],
  '初三': ['初三忠'],
  '高一': ['高一忠'],
  '高二': ['高二忠'],
  '高三': ['高三忠'],
};

export function guessSchedulerClassLabel(schedulerGrade: string, className: string): { label: string; guessed: boolean } {
  const list = SCHEDULER_CLASSES[schedulerGrade] ?? [];
  const normalized = className.trim().replace(/班$/, '');
  const found = list.find((c) => c.endsWith(normalized));
  if (found) return { label: found, guessed: false };
  return { label: schedulerGrade + normalized, guessed: true };
}

export type BridgeResult = { text: string; warnings: string[] };

/** 產生「年級設定 → 一鍵匯入全校」分頁要貼的文字（年級名稱單獨一行，下面每行「科目 節數」） */
export async function buildCurriculumImportText(academicYear: number, term: string): Promise<BridgeResult> {
  const warnings: string[] = [];
  const { data, error } = await supabase
    .from('curriculum')
    .select('grade_level, subject, periods')
    .eq('academic_year', academicYear)
    .eq('term', term);

  if (error) return { text: '', warnings: ['讀取「科目與比重設定」失敗：' + error.message] };

  const byGrade: Record<string, { subject: string; periods: number | null }[]> = {};
  for (const row of (data ?? []) as any[]) {
    const schedulerGrade = GRADE_LEVEL_TO_SCHEDULER[row.grade_level];
    if (!schedulerGrade) {
      warnings.push(`年級「${row.grade_level}」在對照表中找不到對應的排課系統年級，已略過（科目：${row.subject}）`);
      continue;
    }
    if (!byGrade[schedulerGrade]) byGrade[schedulerGrade] = [];
    byGrade[schedulerGrade].push({ subject: row.subject, periods: row.periods });
  }

  const blocks: string[] = [];
  for (const gradeName of Object.keys(byGrade)) {
    const lines: string[] = [];
    for (const s of byGrade[gradeName]) {
      if (s.periods == null) {
        warnings.push(`${gradeName}／${s.subject} 尚未設定節數，已略過此科目`);
        continue;
      }
      lines.push(`${s.subject} ${s.periods}`);
    }
    if (lines.length) blocks.push([gradeName, ...lines].join('\n'));
  }
  return { text: blocks.join('\n\n'), warnings };
}

/** 產生「匯入教師」分頁要貼的文字（每兩行一組：班級+科目／導師+各科老師） */
export async function buildTeacherImportText(academicYear: number, term: string): Promise<BridgeResult> {
  const warnings: string[] = [];

  const { data: classes, error: classErr } = await supabase
    .from('classes')
    .select('id, grade_level, class_name, teachers(name)')
    .eq('academic_year', academicYear);
  if (classErr || !classes) return { text: '', warnings: ['讀取「班級與導師設定」失敗：' + (classErr?.message ?? '未知錯誤')] };

  const { data: scheduleRows, error: schedErr } = await supabase
    .from('class_schedule')
    .select('class_id, subject, teachers(name)')
    .eq('academic_year', academicYear)
    .eq('term', term);
  if (schedErr) warnings.push('讀取「任課教師設定」失敗：' + schedErr.message);

  const byClass: Record<string, { subject: string; teacherName: string }[]> = {};
  for (const row of (scheduleRows ?? []) as any[]) {
    const teacherName = row.teachers?.name;
    if (!teacherName) continue;
    if (!byClass[row.class_id]) byClass[row.class_id] = [];
    if (!byClass[row.class_id].some((r) => r.subject === row.subject)) {
      byClass[row.class_id].push({ subject: row.subject, teacherName });
    }
  }

  const blocks: string[] = [];
  for (const cls of classes as any[]) {
    const schedulerGrade = GRADE_LEVEL_TO_SCHEDULER[cls.grade_level];
    if (!schedulerGrade) {
      warnings.push(`班級「${cls.grade_level}${cls.class_name}」找不到對應的排課系統年級，已略過`);
      continue;
    }
    const { label, guessed } = guessSchedulerClassLabel(schedulerGrade, cls.class_name);
    if (guessed) warnings.push(`班級「${cls.grade_level}${cls.class_name}」自動猜測對應到「${label}」，貼上前請確認是否正確`);

    const assignments = byClass[cls.id] ?? [];
    if (!assignments.length) {
      warnings.push(`「${label}」目前沒有任課教師設定資料，已略過`);
      continue;
    }
    const homeroom = cls.teachers?.name ?? '';
    const row1 = [label, ...assignments.map((a) => a.subject)].join('\t');
    const row2 = [homeroom, ...assignments.map((a) => a.teacherName)].join('\t');
    blocks.push(row1 + '\n' + row2);
  }
  return { text: blocks.join('\n'), warnings };
}

// ============================================================
// 反向匯入：排課系統匯出的 Excel →（班級與導師、科目節數、課表）寫回 Supabase
// ------------------------------------------------------------
// 只依賴排課系統匯出檔裡固定會有的兩張工作表：
//   「全校總課表(輸入)」：每班兩列一組（科目列＋老師列），是課表與導師資料的來源。
//   「匯入的年級&科目&節數」：年級名稱單獨一行、下面每行「科目 節數」，是科目節數的來源。
// 排課系統沒有「科目比重（weight）」的概念，所以比重一律先寫 0，
// 需要再到「成績相關設定及查詢」第一分頁手動補上正確比重。
// ============================================================

const WEEKDAY_LABEL_TO_NUM: Record<string, number> = { '一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6 };

const SCHEDULER_TO_GRADE_LEVEL: Record<string, string> = Object.fromEntries(
  Object.entries(GRADE_LEVEL_TO_SCHEDULER).map(([gradeLevel, schedulerName]) => [schedulerName, gradeLevel])
);
// 舊檔案（還寫「幼甲班」「幼乙班」）也要讀得進來
SCHEDULER_TO_GRADE_LEVEL['幼甲班'] = '幼甲';
SCHEDULER_TO_GRADE_LEVEL['幼乙班'] = '幼乙';

// 幼兒園的班級／年級名稱不加「班」字（幼乙忠、幼甲）。舊檔案裡寫「幼乙忠班」「幼乙班」的，進來時轉成新寫法。
export function canonSchedulerName(n: string): string {
  const t = (n ?? '').trim();
  return t.startsWith('幼') && t.endsWith('班') ? t.slice(0, -1) : t;
}

function findSchedulerGradeOfClass(className: string): string | null {
  const name = canonSchedulerName(className);
  for (const [grade, classes] of Object.entries(SCHEDULER_CLASSES)) {
    if (classes.includes(name)) return grade;
  }
  return null;
}

// 把排課系統的班級標籤（例如「一年忠」「幼甲忠班」「高一」）去掉年級字首/「班」字尾，
// 還原成校務系統慣用的班級名稱（例如「忠」）。只有一班的年級（高一/高二/高三）去掉字首後
// 會變空字串，這種情況就直接用完整標籤當班級名稱。
function classNameWithoutGradePrefix(schedulerGrade: string, className: string): string {
  const prefix = schedulerGrade.replace(/班$/, '').replace(/級$/, '');
  let rest = className;
  if (rest.startsWith(prefix)) rest = rest.slice(prefix.length);
  rest = rest.replace(/班$/, '');
  return rest || className;
}

export type ScheduleImportResult = {
  classesUpserted: number;
  curriculumUpserted: number;
  scheduleUpserted: number;
  warnings: string[];
};

// ============================================================
// 直接存檔：排課工具「存檔到校務系統」按鈕送出的專案資料 → 直接寫回 Supabase
// ------------------------------------------------------------
// 跟 importScheduleExcel 做的事完全一樣（班級/課表/科目節數），差別只是資料來源
// 不是解析Excel，而是排課工具本身的 S 物件（跟「備份專案」JSON是同一份格式），
// 這樣使用者在排課工具裡按一次「存檔到校務系統」就好，不用先匯出Excel再回頭上傳。
// ============================================================

const SLOT_RE = /週(.)-(\d+)/;

// ============================================================
// 【2026-10 加速】批次寫入工具
// ------------------------------------------------------------
// 原本「存檔到校務系統」「匯入教師直接存進校務系統」是每位老師、每個科目、每一節課
// 都個別查一次、寫一次資料庫，全校 30 多班要來回上千次（約 1～2 分鐘），
// 排課工具只等 15 秒就判定「沒有收到校務系統的回應」。
// 改成：老師名單、班級名單一次全部讀進來；要新增/更新的資料整理好後整批寫入，
// 整個存檔只需要幾十次往返（數秒內完成）。批次寫入失敗時才退回逐筆寫入，
// 以便在提醒清單裡指出是哪一筆有問題。
// ============================================================

function chunkArray<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/** 一次讀入全部教師，建立「姓名（不分大小寫）→ id」對照；名單裡找不到的老師一次批次新增 */
async function makeTeacherLookup(names: string[], warnings: string[]): Promise<(name: string) => string | null> {
  const map = new Map<string, string>();
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from('teachers').select('id, name').order('id').range(from, from + 999);
    if (error) throw new Error('讀取教師名單失敗：' + error.message);
    for (const r of (data ?? []) as any[]) {
      const k = String(r.name ?? '').trim().toLowerCase();
      if (k && !map.has(k)) map.set(k, r.id);
    }
    if (!data || data.length < 1000) break;
  }
  const missing = new Map<string, string>();
  for (const n of names) {
    const clean = (n ?? '').trim();
    if (clean && !map.has(clean.toLowerCase()) && !missing.has(clean.toLowerCase())) missing.set(clean.toLowerCase(), clean);
  }
  if (missing.size) {
    const { data, error } = await supabase
      .from('teachers')
      .insert([...missing.values()].map((name) => ({ name })))
      .select('id, name');
    if (!error && data) {
      for (const r of data as any[]) map.set(String(r.name).trim().toLowerCase(), r.id);
    } else {
      for (const n of missing.values()) {
        try {
          const id = await resolveTeacherByName(n);
          if (id) map.set(n.toLowerCase(), id);
        } catch (err: any) {
          warnings.push(`建立教師「${n}」失敗：${err.message}`);
        }
      }
    }
  }
  return (name: string) => map.get((name ?? '').trim().toLowerCase()) ?? null;
}

/** 一次讀入該學年度全部班級；找不到的班級才個別建立 */
async function makeClassLookup(academicYear: number) {
  const map = new Map<string, { id: string; homeroom: string | null }>();
  const { data, error } = await supabase
    .from('classes')
    .select('id, department, grade_level, class_name, homeroom_teacher_id')
    .eq('academic_year', academicYear);
  if (error) throw new Error('讀取班級名單失敗：' + error.message);
  for (const r of (data ?? []) as any[]) {
    const key = `${r.department}|${r.grade_level}|${r.class_name}`;
    if (!map.has(key)) map.set(key, { id: r.id, homeroom: r.homeroom_teacher_id ?? null });
  }
  return async (gradeLevel: string, className: string) => {
    const key = `${departmentForGrade(gradeLevel)}|${gradeLevel}|${className}`;
    let v = map.get(key);
    if (!v) {
      const id = await resolveClassId(academicYear, gradeLevel, className);
      v = { id, homeroom: null };
      map.set(key, v);
    }
    return v;
  };
}

/** 導師設定：只更新有變動的班級，同一位導師的班級合併成一次更新 */
async function batchUpdateHomerooms(changes: { classId: string; teacherId: string; label: string }[], warnings: string[]) {
  const byTeacher = new Map<string, string[]>();
  for (const c of changes) {
    if (!byTeacher.has(c.teacherId)) byTeacher.set(c.teacherId, []);
    byTeacher.get(c.teacherId)!.push(c.classId);
  }
  for (const [teacherId, ids] of byTeacher) {
    const { error } = await supabase.from('classes').update({ homeroom_teacher_id: teacherId }).in('id', ids);
    if (error) {
      const labels = changes.filter((c) => c.teacherId === teacherId).map((c) => c.label).join('、');
      warnings.push(`設定導師失敗（${labels}）：${error.message}`);
    }
  }
}

/** 任課教師設定（weekday 為空的列）：跟 upsertTeacherAssignment 規則相同，但整批處理 */
async function batchUpsertTeacherAssignments(
  wanted: { classId: string; subject: string; teacherId: string; label: string }[],
  academicYear: number,
  term: string,
  warnings: string[]
): Promise<number> {
  const desired = new Map<string, { classId: string; subject: string; teacherId: string; label: string }>();
  for (const w of wanted) desired.set(`${w.classId}|${w.subject}`, w);
  const classIds = [...new Set([...desired.values()].map((w) => w.classId))];

  const existing = new Map<string, { id: string; teacher_id: string }[]>();
  for (const ids of chunkArray(classIds, 40)) {
    for (let from = 0; ; from += 1000) {
      const { data, error } = await supabase
        .from('class_schedule')
        .select('id, class_id, subject, teacher_id')
        .eq('academic_year', academicYear)
        .eq('term', term)
        .is('weekday', null)
        .in('class_id', ids)
        .order('id')
        .range(from, from + 999);
      if (error) throw new Error('讀取任課教師設定失敗：' + error.message);
      for (const r of (data ?? []) as any[]) {
        const k = `${r.class_id}|${r.subject}`;
        if (!existing.has(k)) existing.set(k, []);
        existing.get(k)!.push({ id: r.id, teacher_id: r.teacher_id });
      }
      if (!data || data.length < 1000) break;
    }
  }

  const inserts: any[] = [];
  const insertMeta: { classId: string; subject: string; teacherId: string; label: string }[] = [];
  const updates = new Map<string, string[]>();
  const deleteIds: string[] = [];
  for (const [k, w] of desired) {
    const rows = existing.get(k);
    if (rows && rows.length) {
      const same = rows.find((r) => r.teacher_id === w.teacherId) ?? rows[0];
      if (same.teacher_id !== w.teacherId) {
        if (!updates.has(w.teacherId)) updates.set(w.teacherId, []);
        updates.get(w.teacherId)!.push(same.id);
      }
      for (const r of rows) if (r.id !== same.id) deleteIds.push(r.id);
    } else {
      inserts.push({ class_id: w.classId, academic_year: academicYear, term, subject: w.subject, teacher_id: w.teacherId, weekday: null, period_no: null });
      insertMeta.push(w);
    }
  }

  let failed = 0;
  for (const [teacherId, ids] of updates) {
    for (const part of chunkArray(ids, 200)) {
      const { error } = await supabase.from('class_schedule').update({ teacher_id: teacherId }).in('id', part);
      if (error) {
        failed += part.length;
        warnings.push(`更新任課教師失敗：${error.message}`);
      }
    }
  }
  for (const part of chunkArray(deleteIds, 200)) {
    await supabase.from('class_schedule').delete().in('id', part);
  }
  for (let i = 0; i < inserts.length; i += 300) {
    const part = inserts.slice(i, i + 300);
    const { error } = await supabase.from('class_schedule').insert(part);
    if (error) {
      // 整批失敗時改逐筆寫入，找出是哪一筆有問題
      for (const w of insertMeta.slice(i, i + 300)) {
        try {
          await upsertTeacherAssignment(w.classId, academicYear, term, w.subject, w.teacherId);
        } catch (err: any) {
          failed++;
          warnings.push(`「${w.label}」${w.subject}任課教師寫入失敗：${err.message}`);
        }
      }
    }
  }
  return desired.size - failed;
}

export async function importScheduleFromProjectData(data: any, academicYear: number, term: string): Promise<ScheduleImportResult> {
  const warnings: string[] = [];
  let classesUpserted = 0;
  let curriculumUpserted = 0;
  let scheduleUpserted = 0;

  const grades: any[] = data?.GRADES ?? [];
  const schedules: Record<string, any> = data?.S?.schedules ?? {};
  const homerooms: Record<string, string> = data?.S?.homerooms ?? {};

  // ---- 1. 科目節數：整批 upsert ----
  const curRows: any[] = [];
  for (const g of grades) {
    const gradeLevel = SCHEDULER_TO_GRADE_LEVEL[g.name];
    if (!gradeLevel) {
      warnings.push(`年級「${g.name}」找不到對應的校務系統年級代碼，已略過科目節數`);
      continue;
    }
    for (const s of g.subs ?? []) {
      if (!s?.n) continue;
      curRows.push({ academic_year: academicYear, term, grade_level: gradeLevel, subject: s.n, weight: 0, periods: s.c ?? null });
    }
  }
  const cur = await upsertCurriculumRows(curRows, academicYear, term, warnings);
  curriculumUpserted += cur.n;
  if (cur.inserted > 0) {
    warnings.push(`有 ${cur.inserted} 個新科目，比重（weight）先寫入為 0，請到「成績相關設定及查詢」第一分頁補上正確的比重（原有科目的比重不會被更動）。`);
  }

  // ---- 2. 老師、班級名單一次讀入 ----
  const allNames: string[] = [...Object.values(homerooms)];
  for (const cn of Object.keys(schedules)) for (const e of schedules[cn]?.entries ?? []) if (e?.teacher) allNames.push(e.teacher);
  const teacherId = await makeTeacherLookup(allNames, warnings);
  const classOf = await makeClassLookup(academicYear);

  const homeroomChanges: { classId: string; teacherId: string; label: string }[] = [];
  const schedRows: any[] = [];
  const schedLabels: string[] = [];
  for (const className of Object.keys(schedules)) {
    const schedulerGrade = findSchedulerGradeOfClass(className);
    if (!schedulerGrade) {
      warnings.push(`班級「${className}」在對照表中找不到所屬年級，已略過`);
      continue;
    }
    const gradeLevel = SCHEDULER_TO_GRADE_LEVEL[schedulerGrade];
    if (!gradeLevel) {
      warnings.push(`年級「${schedulerGrade}」找不到對應的校務系統年級代碼，已略過班級「${className}」`);
      continue;
    }
    let cls: { id: string; homeroom: string | null };
    try {
      cls = await classOf(gradeLevel, classNameWithoutGradePrefix(schedulerGrade, className));
      classesUpserted++;
    } catch (err: any) {
      warnings.push(`建立班級「${className}」失敗：${err.message}`);
      continue;
    }
    const hrId = homerooms[className] ? teacherId(homerooms[className]) : null;
    if (hrId && hrId !== cls.homeroom) homeroomChanges.push({ classId: cls.id, teacherId: hrId, label: className });

    for (const e of schedules[className]?.entries ?? []) {
      if (!e?.slot || !e?.sub || !e?.teacher) continue;
      const m = SLOT_RE.exec(e.slot);
      if (!m) continue;
      const weekday = WEEKDAY_LABEL_TO_NUM[m[1]];
      const periodNo = Number(m[2]);
      if (!weekday || Number.isNaN(periodNo)) continue;
      const tid = teacherId(e.teacher);
      if (!tid) continue;
      schedRows.push({ class_id: cls.id, academic_year: academicYear, term, weekday, period_no: periodNo, subject: e.sub, teacher_id: tid });
      schedLabels.push(`「${className}」週${m[1]}第${periodNo}節`);
    }
  }
  await batchUpdateHomerooms(homeroomChanges, warnings);

  // ---- 3. 課表時段：整批 upsert（每批 500 筆） ----
  for (let i = 0; i < schedRows.length; i += 500) {
    const part = schedRows.slice(i, i + 500);
    const { error } = await supabase.from('class_schedule').upsert(part, { onConflict: 'class_id,academic_year,term,weekday,period_no' });
    if (!error) {
      scheduleUpserted += part.length;
      continue;
    }
    for (let k = 0; k < part.length; k++) {
      const { error: e1 } = await supabase.from('class_schedule').upsert(part[k], { onConflict: 'class_id,academic_year,term,weekday,period_no' });
      if (e1) warnings.push(`${schedLabels[i + k]}寫入失敗：${e1.message}`);
      else scheduleUpserted++;
    }
  }

  return { classesUpserted, curriculumUpserted, scheduleUpserted, warnings };
}

// 科目節數：已存在的科目「只更新節數、保留原本的比重」；新科目才以比重 0 新增。
// （舊版每次存檔都把比重整批覆寫成 0，會把「成績相關設定」已經設好的比重洗掉，已修正）
async function upsertCurriculumRows(rows: any[], academicYear: number, term: string, warnings: string[]): Promise<{ n: number; inserted: number }> {
  let n = 0;
  let inserted = 0;
  const existing = new Map<string, { id: string; periods: number | null }>();
  const { data, error } = await supabase
    .from('curriculum')
    .select('id, grade_level, subject, periods')
    .eq('academic_year', academicYear)
    .eq('term', term);
  if (error) throw new Error('讀取科目節數失敗：' + error.message);
  for (const r of (data ?? []) as any[]) existing.set(`${r.grade_level}|${r.subject}`, { id: r.id, periods: r.periods });

  const seen = new Set<string>();
  const toInsert: any[] = [];
  const updByPeriods = new Map<string, string[]>();
  for (const r of rows) {
    const k = `${r.grade_level}|${r.subject}`;
    if (seen.has(k)) continue;
    seen.add(k);
    const ex = existing.get(k);
    if (!ex) {
      toInsert.push(r);
      continue;
    }
    if ((ex.periods ?? null) !== (r.periods ?? null)) {
      const pk = String(r.periods ?? 'null');
      if (!updByPeriods.has(pk)) updByPeriods.set(pk, []);
      updByPeriods.get(pk)!.push(ex.id);
    } else n++;
  }
  for (const [pk, ids] of updByPeriods) {
    const periods = pk === 'null' ? null : Number(pk);
    const { error: e1 } = await supabase.from('curriculum').update({ periods }).in('id', ids);
    if (e1) warnings.push(`更新科目節數失敗：${e1.message}`);
    else n += ids.length;
  }
  for (const part of chunkArray(toInsert, 300)) {
    const { error: e2 } = await supabase.from('curriculum').insert(part);
    if (!e2) {
      n += part.length;
      inserted += part.length;
      continue;
    }
    for (const r of part) {
      const { error: e3 } = await supabase.from('curriculum').insert(r);
      if (e3) warnings.push(`科目節數寫入失敗（${r.grade_level}／${r.subject}）：${e3.message}`);
      else {
        n++;
        inserted++;
      }
    }
  }
  return { n, inserted };
}

// ============================================================
// 只存「匯入教師 & 導師資料」／「全校科目節數匯入」這兩張，不用等整個排課流程做完
// ------------------------------------------------------------
// 背景（系統管理員S反映）：排課工具「匯入教師」「年級設定」這兩個分頁貼上資料後，
// 只會更新工具自己網頁裡的 S 變數——這個工具其實完全沒有任何持久化機制（連
// localStorage都沒用，純粹是分頁還開著時的記憶體），只要分頁被關掉、整理，
// 沒送出「💾 存檔到校務系統」的資料就直接消失，而「存檔到校務系統」原本的設計
// 是「整個學期課表都排完之後」才按一次的動作（有衝堂檢查擋著，沒排完課根本按不了）。
// 但任課教師／導師分配通常一學期只設定一次、之後很少變動，S 系統管理員與教務處
// 負責人都會希望「匯入教師」「一鍵匯入全校（科目節數）」這兩個分頁可以匯入後
// 立刻分別單獨存進資料庫，不用被綁在「排完課才能存檔」這個時間點上。
// 這兩支函式就是給這兩個分頁各自獨立、立即使用的版本，寫的資料表跟
// importScheduleFromProjectData 一致（curriculum／classes／class_schedule），
// 但不觸碰實際排課時段（weekday/period_no），也不需要先通過衝堂檢查。
// ============================================================

export type CurriculumImportResult = { curriculumUpserted: number; warnings: string[] };

export async function importCurriculumFromProjectData(data: any, academicYear: number, term: string): Promise<CurriculumImportResult> {
  const warnings: string[] = [];
  const grades: any[] = data?.GRADES ?? [];
  const rows: any[] = [];
  for (const g of grades) {
    const gradeLevel = SCHEDULER_TO_GRADE_LEVEL[g?.name];
    if (!gradeLevel) {
      warnings.push(`年級「${g?.name}」找不到對應的校務系統年級代碼，已略過科目節數`);
      continue;
    }
    for (const s of g.subs ?? []) {
      if (!s?.n) continue;
      rows.push({ academic_year: academicYear, term, grade_level: gradeLevel, subject: s.n, weight: 0, periods: s.c ?? null });
    }
  }
  const cur = await upsertCurriculumRows(rows, academicYear, term, warnings);
  if (cur.inserted > 0) {
    warnings.push(`有 ${cur.inserted} 個新科目，比重（weight）先寫入為 0，請到「成績相關設定及查詢」第一分頁補上正確的比重（原有科目的比重不會被更動）。`);
  }
  return { curriculumUpserted: cur.n, warnings };
}

export type TeacherAssignmentImportResult = { classesUpserted: number; assignmentsUpserted: number; warnings: string[] };

export async function importTeacherAssignmentsFromProjectData(
  data: any,
  academicYear: number,
  term: string
): Promise<TeacherAssignmentImportResult> {
  const warnings: string[] = [];
  let classesUpserted = 0;

  const grades: any[] = data?.GRADES ?? [];
  const teachers: Record<string, Record<string, Record<string, string>>> = data?.S?.teachers ?? {};
  const homerooms: Record<string, string> = data?.S?.homerooms ?? {};

  // 老師、班級名單一次讀入（取代逐筆查詢）
  const allNames: string[] = [...Object.values(homerooms)];
  for (const gid of Object.keys(teachers)) for (const cn of Object.keys(teachers[gid] ?? {})) allNames.push(...Object.values(teachers[gid][cn] ?? {}));
  const teacherId = await makeTeacherLookup(allNames, warnings);
  const classOf = await makeClassLookup(academicYear);

  const homeroomChanges: { classId: string; teacherId: string; label: string }[] = [];
  const wanted: { classId: string; subject: string; teacherId: string; label: string }[] = [];
  for (const g of grades) {
    const schedulerGrade = g?.name;
    const gradeLevel = SCHEDULER_TO_GRADE_LEVEL[schedulerGrade];
    if (!gradeLevel) {
      warnings.push(`年級「${schedulerGrade}」找不到對應的校務系統年級代碼，已略過`);
      continue;
    }
    for (const className of g.classes ?? []) {
      let cls: { id: string; homeroom: string | null };
      try {
        cls = await classOf(gradeLevel, classNameWithoutGradePrefix(schedulerGrade, className));
        classesUpserted++;
      } catch (err: any) {
        warnings.push(`建立班級「${className}」失敗：${err.message}`);
        continue;
      }
      const hrId = homerooms[className] ? teacherId(homerooms[className]) : null;
      if (hrId && hrId !== cls.homeroom) homeroomChanges.push({ classId: cls.id, teacherId: hrId, label: className });

      const tMap = (teachers[g.id] && teachers[g.id][className]) || {};
      for (const subject of Object.keys(tMap)) {
        const tid = tMap[subject] ? teacherId(tMap[subject]) : null;
        if (!tid) continue;
        wanted.push({ classId: cls.id, subject, teacherId: tid, label: className });
      }
    }
  }
  await batchUpdateHomerooms(homeroomChanges, warnings);
  const assignmentsUpserted = await batchUpsertTeacherAssignments(wanted, academicYear, term, warnings);
  return { classesUpserted, assignmentsUpserted, warnings };
}

export async function importScheduleExcel(file: File, academicYear: number, term: string): Promise<ScheduleImportResult> {
  const XLSX = await import('xlsx');
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: 'array' });

  const gridSheet = wb.Sheets['全校總課表(輸入)'];
  if (!gridSheet) {
    return {
      classesUpserted: 0,
      curriculumUpserted: 0,
      scheduleUpserted: 0,
      warnings: ['找不到「全校總課表(輸入)」工作表，請確認上傳的是學校的課程表系統 Excel 或排課系統「匯出Excel」產生的檔案'],
    };
  }

  // 舊格式才有的「匯入的年級&科目&節數」工作表：有的話用它的節數；沒有也沒關係，節數直接從課表裡數
  const legacy: Record<string, Record<string, number>> = {};
  const curriculumSheet = wb.Sheets['匯入的年級&科目&節數'];
  if (curriculumSheet) {
    let currentGrade: string | null = null;
    for (const row of XLSX.utils.sheet_to_json(curriculumSheet, { header: 1, defval: null }) as any[][]) {
      const col0 = row[0] != null ? String(row[0]).trim() : '';
      if (!col0) continue;
      if (row[1] == null) {
        currentGrade = canonSchedulerName(col0);
        continue;
      }
      if (currentGrade && !Number.isNaN(Number(row[1]))) (legacy[currentGrade] ||= {})[col0] = Number(row[1]);
    }
  }

  const gridRows = XLSX.utils.sheet_to_json(gridSheet, { header: 1, defval: null }) as any[][];
  const parsed = parseSchoolGrid(gridRows, SCHEDULER_CLASSES, curriculumSheet ? legacy : undefined);
  const warnings: string[] = [...parsed.notes];
  for (const sk of parsed.skipped) warnings.push('略過：' + sk);
  if (parsed.classCount === 0) {
    warnings.push('沒有讀到任何班級課表，請確認「全校總課表(輸入)」的格式（第 2 列星期、第 3 列節數、第 4 列起每班兩列）。');
    return { classesUpserted: 0, curriculumUpserted: 0, scheduleUpserted: 0, warnings };
  }

  // 用跟「排課工具存檔到校務系統」同一套整批寫入：班級、導師、科目節數（保留原本的比重）、課表、任課教師設定
  const data = { ...parsed.data, S: { ...parsed.data.S, academicYear, term } };
  const sched = await importScheduleFromProjectData(data, academicYear, term);
  const assign = await importTeacherAssignmentsFromProjectData(data, academicYear, term);
  return {
    classesUpserted: sched.classesUpserted,
    curriculumUpserted: sched.curriculumUpserted,
    scheduleUpserted: sched.scheduleUpserted,
    warnings: [...warnings, ...sched.warnings, ...assign.warnings, `任課教師設定 ${assign.assignmentsUpserted} 筆已一併寫入。`],
  };
}

// ============================================================
// 把資料庫裡已經存好的「班級課表」讀回排課工具
// ------------------------------------------------------------
// 排課工具的資料只存在瀏覽器記憶體，重新整理就會清空；而「存檔到校務系統」「上傳課表 Excel」
// 寫進去的是 class_schedule（有星期、節次的列）。如果沒有任何「歷史存檔」可還原，
// 就改從 class_schedule 還原，這樣排好的課表不會因為重新開啟而消失。
// ============================================================
export type DbScheduleRow = { label: string; weekday: number; periodNo: number; subject: string; teacherName: string };

export async function buildScheduleFromDb(academicYear: number, term: string): Promise<{ rows: DbScheduleRow[]; warnings: string[] }> {
  const warnings: string[] = [];
  const { data: classes, error: cErr } = await supabase.from('classes').select('id, grade_level, class_name').eq('academic_year', academicYear);
  if (cErr || !classes) return { rows: [], warnings: ['讀取班級失敗：' + (cErr?.message ?? '未知錯誤')] };
  const labelOf = new Map<string, string>();
  for (const c of classes as any[]) {
    const schedulerGrade = GRADE_LEVEL_TO_SCHEDULER[c.grade_level];
    if (!schedulerGrade) continue;
    labelOf.set(c.id, guessSchedulerClassLabel(schedulerGrade, c.class_name).label);
  }
  const rows: DbScheduleRow[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from('class_schedule')
      .select('class_id, weekday, period_no, subject, teachers(name)')
      .eq('academic_year', academicYear)
      .eq('term', term)
      .not('weekday', 'is', null)
      .order('id')
      .range(from, from + 999);
    if (error) {
      warnings.push('讀取已存的課表失敗：' + error.message);
      break;
    }
    for (const r of (data ?? []) as any[]) {
      const label = labelOf.get(r.class_id);
      const teacherName = r.teachers?.name;
      if (!label || !teacherName || r.weekday == null || r.period_no == null) continue;
      rows.push({ label, weekday: r.weekday, periodNo: r.period_no, subject: r.subject, teacherName });
    }
    if (!data || data.length < 1000) break;
  }
  return { rows, warnings };
}
