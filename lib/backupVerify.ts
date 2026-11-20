import type { SupabaseClient } from '@supabase/supabase-js';

// ⚠️ 只能在伺服器端使用。
// 備份驗證（「還原演練」的自動化部分）：不寫入、不還原任何資料，只確認「這份備份真的可以拿來還原」：
//  1. 備份清單（manifest）與每一個分段檔都還在、而且是有效的 JSON；
//  2. 每張表實際的列數 = 備份當時記下的列數（少一個分段檔或檔案被截斷都會被發現）；
//  3. 最重要的幾張表（學生、教師、班級、選課）不是空的；
//  4. 資料彼此對得起來（選課的學生／班級都存在、成績的選課都存在、課表的教師都存在）——
//     備份是分頁撈出來的，如果撈到一半出錯，會出現「子表有、父表沒有」的孤兒資料。
// 真正把備份還原到「另一個資料庫」的完整演練步驟見 docs/備份還原演練與維運手冊.md。

const BUCKET = 'backup-uploads';
const CRITICAL_TABLES = ['students', 'teachers', 'classes', 'enrollments'];

export type VerifyResult = {
  ok: boolean;
  backupId: string | null;
  createdAt: string | null;
  ageHours: number | null;
  tablesChecked: number;
  totalRows: number;
  problems: string[];
  warnings: string[];
  durationMs: number;
};

/** 孤兒比例：超過 1% 算問題（備份是分頁撈的，撈的過程中剛好有人新增資料，可能出現極少量的孤兒，列為提醒就好） */
export const ORPHAN_PROBLEM_RATIO = 0.01;

type Keys = {
  students: Set<string>;
  classes: Set<string>;
  teachers: Set<string>;
  enrollments: Set<string>;
  enrollmentRefs: { student_no: string; class_id: string }[];
  scoreEnrollmentIds: string[];
  scheduleRefs: { teacher_id: string; class_id: string }[];
};

/** 純函式：依收集到的主鍵與參照，算出各種孤兒資料的數量（單元測試用） */
export function checkReferences(k: Keys): { label: string; orphans: number; total: number }[] {
  return [
    { label: '選課的學生不存在於學生表', total: k.enrollmentRefs.length, orphans: k.enrollmentRefs.filter((e) => !k.students.has(e.student_no)).length },
    { label: '選課的班級不存在於班級表', total: k.enrollmentRefs.length, orphans: k.enrollmentRefs.filter((e) => !k.classes.has(e.class_id)).length },
    { label: '成績的選課不存在於選課表', total: k.scoreEnrollmentIds.length, orphans: k.scoreEnrollmentIds.filter((id) => !k.enrollments.has(id)).length },
    { label: '課表的教師不存在於教師表', total: k.scheduleRefs.length, orphans: k.scheduleRefs.filter((s) => s.teacher_id && !k.teachers.has(s.teacher_id)).length },
    { label: '課表的班級不存在於班級表', total: k.scheduleRefs.length, orphans: k.scheduleRefs.filter((s) => s.class_id && !k.classes.has(s.class_id)).length },
  ];
}

async function downloadJson(admin: SupabaseClient, path: string): Promise<{ data: any; error: string | null }> {
  const { data, error } = await admin.storage.from(BUCKET).download(path);
  if (error || !data) return { data: null, error: `檔案遺失或讀取失敗：${path}` };
  try {
    return { data: JSON.parse(await data.text()), error: null };
  } catch {
    return { data: null, error: `檔案內容損毀（不是有效的 JSON）：${path}` };
  }
}

export async function verifyBackup(admin: SupabaseClient, backupId?: string): Promise<VerifyResult> {
  const started = Date.now();
  const result: VerifyResult = { ok: false, backupId: null, createdAt: null, ageHours: null, tablesChecked: 0, totalRows: 0, problems: [], warnings: [], durationMs: 0 };
  const finish = () => {
    result.ok = result.problems.length === 0;
    result.durationMs = Date.now() - started;
    return result;
  };

  let q = admin.from('backups').select('id, created_at, table_counts, storage_path').order('created_at', { ascending: false }).limit(1);
  if (backupId) q = admin.from('backups').select('id, created_at, table_counts, storage_path').eq('id', backupId).limit(1);
  const { data: rows, error } = await q;
  const row = rows?.[0];
  if (error || !row) {
    result.problems.push(error ? `讀取備份紀錄失敗：${error.message}` : '沒有任何備份紀錄');
    return finish();
  }
  result.backupId = row.id;
  result.createdAt = row.created_at;
  result.ageHours = Math.round(((Date.now() - new Date(row.created_at).getTime()) / 3600000) * 10) / 10;
  const counts = (row.table_counts ?? {}) as Record<string, number | null>;

  if (!row.storage_path) {
    result.warnings.push('這份備份的內容存在資料庫欄位（舊格式），不做分段檔驗證');
    return finish();
  }
  const manifest = await downloadJson(admin, row.storage_path);
  if (manifest.error) {
    result.problems.push(`備份清單：${manifest.error}`);
    return finish();
  }
  if (!manifest.data || manifest.data.format !== 'parts' || typeof manifest.data.parts !== 'object') {
    result.warnings.push('備份是單一檔案（舊格式），只確認檔案可讀取');
    return finish();
  }

  const keys: Keys = {
    students: new Set(),
    classes: new Set(),
    teachers: new Set(),
    enrollments: new Set(),
    enrollmentRefs: [],
    scoreEnrollmentIds: [],
    scheduleRefs: [],
  };
  const parts = manifest.data.parts as Record<string, string[] | null>;

  // 表清單以「備份清單」與「備份紀錄」兩邊出現過的為準（不依賴程式裡的表清單，以後新增資料表不用改這裡）
  const tableNames = Array.from(new Set([...Object.keys(parts), ...Object.keys(counts)]));
  // 同時最多讀 CONCURRENCY 張表的分段檔（備份約 50 個檔案，一個一個讀要一分鐘以上）
  const CONCURRENCY = 8;
  const checkTable = async (table: string) => {
    const paths = parts[table];
    if (paths === undefined) {
      // 清單裡沒有這張表：只有「備份當時根本沒這張表」才合理（counts 為 null 或沒有）
      if (counts[table] != null) result.problems.push(`${table}：備份紀錄說有 ${counts[table]} 列，但備份清單裡沒有這張表`);
      return;
    }
    if (paths === null) {
      if (counts[table] != null) result.problems.push(`${table}：備份清單標示略過，但備份紀錄說有 ${counts[table]} 列`);
      return;
    }
    let n = 0;
    for (const p of paths) {
      const part = await downloadJson(admin, p);
      if (part.error || !Array.isArray(part.data)) {
        result.problems.push(`${table}：${part.error ?? '分段檔不是陣列'}`);
        return;
      }
      n += part.data.length;
      for (const r of part.data) {
        if (table === 'students') keys.students.add(String(r.student_no));
        else if (table === 'classes') keys.classes.add(String(r.id));
        else if (table === 'teachers') keys.teachers.add(String(r.id));
        else if (table === 'enrollments') {
          keys.enrollments.add(String(r.id));
          keys.enrollmentRefs.push({ student_no: String(r.student_no), class_id: String(r.class_id) });
        } else if (table === 'scores') keys.scoreEnrollmentIds.push(String(r.enrollment_id));
        else if (table === 'class_schedule') keys.scheduleRefs.push({ teacher_id: r.teacher_id ? String(r.teacher_id) : '', class_id: r.class_id ? String(r.class_id) : '' });
      }
    }
    result.tablesChecked++;
    result.totalRows += n;
    if (counts[table] != null && counts[table] !== n) {
      result.problems.push(`${table}：備份紀錄 ${counts[table]} 列，實際讀到 ${n} 列（缺少或截斷）`);
    }
    if (CRITICAL_TABLES.includes(table) && n === 0) result.problems.push(`${table}：是空的（正常學校資料不可能是空的）`);
  };
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, tableNames.length) }, async () => {
      while (next < tableNames.length) await checkTable(tableNames[next++]);
    })
  );

  for (const c of checkReferences(keys)) {
    if (c.orphans === 0 || c.total === 0) continue;
    const ratio = c.orphans / c.total;
    const text = `${c.label}：${c.orphans} / ${c.total} 列`;
    if (ratio > ORPHAN_PROBLEM_RATIO) result.problems.push(text);
    else result.warnings.push(`${text}（比例很低，可能是備份進行中剛好有人新增資料）`);
  }
  return finish();
}
