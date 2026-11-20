import type { SupabaseClient } from '@supabase/supabase-js';

// 備份保留規則（資安與效能檢測報告 第三級）。
// 每份備份都是「完整一份」，目前約 20 MB，每天一份；Supabase 免費方案的 Storage 只有 1 GB，
// 沒有任何清理的話約一個月後會滿——滿了不只備份失敗，學生照片等其他上傳也會失敗。
// 規則（以台北時間的日期計算，越新越密、越舊越疏）：
//   • 最近 DAILY_DAYS 天：每一份都留
//   • 之後每週留最新的一份，共 WEEKLY_WEEKS 週
//   • 再之後每月留最新的一份，共 MONTHLY_MONTHS 個月
//   • 最新的 MIN_KEEP 份一律保留；手動備份（kind='手動'）至少保留 MANUAL_DAYS 天
// 預設只「預覽」會刪哪些（見 lib/health.ts）；要真的刪，需設環境變數 BACKUP_PRUNE=1（每日排程自動清理），
// 或由系統管理員 S 在「開發人員區 → 系統健康檢查」按「立即清理」。

export const RETENTION = { DAILY_DAYS: 10, WEEKLY_WEEKS: 6, MONTHLY_MONTHS: 4, MIN_KEEP: 3, MANUAL_DAYS: 60 };

export type BackupRow = { id: string; kind: string; created_at: string; storage_path: string | null };

const TAIPEI_MS = 8 * 3600 * 1000;
const DAY_MS = 86400000;

/** 台北時間的「天序號」（自 1970-01-01 起算的第幾天） */
function dayIndex(ms: number): number {
  return Math.floor((ms + TAIPEI_MS) / DAY_MS);
}
/** 週序號（週一為一週的開始）；1970-01-01 是週四，所以位移 3 天 */
function weekIndex(ms: number): number {
  return Math.floor((dayIndex(ms) + 3) / 7);
}
/** 月序號（年*12+月，台北時間） */
function monthIndex(ms: number): number {
  const d = new Date(ms + TAIPEI_MS);
  return d.getUTCFullYear() * 12 + d.getUTCMonth();
}

/** 純函式：決定哪些備份保留、哪些可以刪（單元測試用） */
export function planRetention(rows: BackupRow[], now: number = Date.now(), policy = RETENTION): { keep: string[]; remove: string[] } {
  const sorted = [...rows].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  const keep = new Set<string>();
  const today = dayIndex(now);
  const thisWeek = weekIndex(now);
  const thisMonth = monthIndex(now);
  const weekSeen = new Set<number>();
  const monthSeen = new Set<number>();

  sorted.forEach((r, i) => {
    const t = new Date(r.created_at).getTime();
    const ageDays = today - dayIndex(t);
    if (i < policy.MIN_KEEP) keep.add(r.id);
    if (ageDays <= policy.DAILY_DAYS) keep.add(r.id); // 以台北日期算，<= 才能確保至少留滿 DAILY_DAYS 份（過了午夜邊界時不會少一份）
    if (r.kind === '手動' && ageDays < policy.MANUAL_DAYS) keep.add(r.id);
    // 因為是由新到舊走訪，每個週／月第一次遇到的就是該週／月最新的一份
    const w = weekIndex(t);
    if (!weekSeen.has(w)) {
      weekSeen.add(w);
      if (thisWeek - w < policy.WEEKLY_WEEKS + Math.ceil(policy.DAILY_DAYS / 7)) keep.add(r.id);
    }
    const m = monthIndex(t);
    if (!monthSeen.has(m)) {
      monthSeen.add(m);
      if (thisMonth - m < policy.MONTHLY_MONTHS) keep.add(r.id);
    }
  });
  return { keep: sorted.filter((r) => keep.has(r.id)).map((r) => r.id), remove: sorted.filter((r) => !keep.has(r.id)).map((r) => r.id) };
}

const BUCKET = 'backup-uploads';

/** 從備份的 storage_path（jobs/<jobId>/manifest.json）取出 jobId；格式不認得就回 null（那一份絕不自動刪） */
export function jobIdOf(path: string | null): string | null {
  const m = /^jobs\/([0-9A-Za-z-]+)\/manifest\.json$/.exec(path ?? '');
  return m ? m[1] : null;
}

/** 預覽：會刪幾份、約釋放多少 MB（不刪任何東西） */
export async function previewPrune(admin: SupabaseClient, now: number = Date.now()) {
  const { data: rows, error } = await admin.from('backups').select('id, kind, created_at, storage_path');
  if (error || !rows) return { error: error?.message ?? '讀取備份紀錄失敗', total: 0, removeIds: [] as string[], removeBytes: 0 };
  const plan = planRetention(rows as BackupRow[], now);
  const removable = (rows as BackupRow[]).filter((r) => plan.remove.includes(r.id) && jobIdOf(r.storage_path));
  let bytes = 0;
  for (const r of removable) {
    const { data: files } = await admin.storage.from(BUCKET).list(`jobs/${jobIdOf(r.storage_path)}`, { limit: 1000 });
    bytes += (files ?? []).reduce((s, f: any) => s + (Number(f.metadata?.size) || 0), 0);
  }
  return { error: null as string | null, total: rows.length, removeIds: removable.map((r) => r.id), removeBytes: bytes };
}

/** 真的刪：先刪儲存空間裡該份備份的所有檔案，成功才刪備份紀錄。回傳實際刪除的份數與釋放的位元組 */
export async function executePrune(admin: SupabaseClient, now: number = Date.now()) {
  const { data: rows, error } = await admin.from('backups').select('id, kind, created_at, storage_path');
  if (error || !rows) return { removed: 0, freedBytes: 0, errors: [error?.message ?? '讀取備份紀錄失敗'] };
  const plan = planRetention(rows as BackupRow[], now);
  const targets = (rows as BackupRow[]).filter((r) => plan.remove.includes(r.id) && jobIdOf(r.storage_path));
  let removed = 0;
  let freedBytes = 0;
  const errors: string[] = [];
  for (const r of targets) {
    const jobId = jobIdOf(r.storage_path)!;
    const { data: files, error: listErr } = await admin.storage.from(BUCKET).list(`jobs/${jobId}`, { limit: 1000 });
    if (listErr) {
      errors.push(`${jobId}：列出檔案失敗 ${listErr.message}`);
      continue;
    }
    const paths = (files ?? []).map((f: any) => `jobs/${jobId}/${f.name}`);
    if (paths.length > 0) {
      const { error: rmErr } = await admin.storage.from(BUCKET).remove(paths);
      if (rmErr) {
        errors.push(`${jobId}：刪除檔案失敗 ${rmErr.message}`);
        continue;
      }
    }
    const { error: delErr } = await admin.from('backups').delete().eq('id', r.id);
    if (delErr) {
      errors.push(`${jobId}：刪除備份紀錄失敗 ${delErr.message}`);
      continue;
    }
    removed++;
    freedBytes += (files ?? []).reduce((s, f: any) => s + (Number(f.metadata?.size) || 0), 0);
  }
  return { removed, freedBytes, errors };
}
