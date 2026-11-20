import type { VerifyResult } from './backupVerify';

// 系統健康評估規則（純函式，不連資料庫，有單元測試）。收集資料與寄信在 lib/health.ts。

export type Level = 'ok' | 'warning' | 'critical';
export type Alert = { level: 'warning' | 'critical'; key: string; message: string };

export type Snapshot = {
  db_bytes: number;
  conns: number;
  max_conns: number;
  storage_bytes: number;
  backup_storage_bytes: number;
  longest_query_seconds: number;
  cache_hit_ratio: number | null;
  slow_queries: { q: string; calls: number; mean_ms: number; max_ms: number }[];
};

export type HealthInput = {
  snapshot: Snapshot | null;
  pingMs: number | null; // 資料庫一次簡單查詢花的時間；null＝連不上
  latestBackup: { ageHours: number; totalRows: number } | null;
  previousBackupTotalRows: number | null;
  verify: VerifyResult | null;
  liveVsBackup: { table: string; backup: number; live: number }[];
  limits: { storageBytes: number; dbBytes: number };
};

const MB = 1024 * 1024;
export const DEFAULT_LIMITS = { storageBytes: 1024 * MB, dbBytes: 500 * MB }; // Supabase 免費方案：Storage 1 GB、資料庫 500 MB

const fmtMB = (b: number) => `${Math.round(b / MB)} MB`;

export function evaluateHealth(input: HealthInput): { status: Level; alerts: Alert[] } {
  const alerts: Alert[] = [];
  const add = (level: Alert['level'], key: string, message: string) => alerts.push({ level, key, message });

  if (input.pingMs === null || !input.snapshot) {
    add('critical', 'db_down', '連不上資料庫（或健康檢查查詢失敗），系統可能已經無法使用');
  } else {
    if (input.pingMs > 4000) add('critical', 'db_slow', `資料庫回應很慢（一次簡單查詢要 ${Math.round(input.pingMs)} 毫秒）`);
    else if (input.pingMs > 1500) add('warning', 'db_slow', `資料庫回應偏慢（一次簡單查詢要 ${Math.round(input.pingMs)} 毫秒）`);
  }

  const s = input.snapshot;
  if (s) {
    const connRatio = s.conns / Math.max(1, s.max_conns);
    if (connRatio >= 0.9) add('critical', 'connections', `資料庫連線數快滿了（${s.conns} / ${s.max_conns}），新的使用者可能連不上`);
    else if (connRatio >= 0.7) add('warning', 'connections', `資料庫連線數偏高（${s.conns} / ${s.max_conns}）`);

    const storeRatio = s.storage_bytes / input.limits.storageBytes;
    const storeMsg = `儲存空間已用 ${fmtMB(s.storage_bytes)} / ${fmtMB(input.limits.storageBytes)}（${Math.round(storeRatio * 100)}%），其中備份佔 ${fmtMB(s.backup_storage_bytes)}`;
    if (storeRatio >= 0.9) add('critical', 'storage', `${storeMsg}。滿了以後備份與檔案上傳都會失敗，請立即清理舊備份`);
    else if (storeRatio >= 0.7) add('warning', 'storage', `${storeMsg}。請清理舊備份或調整保留規則`);

    const dbRatio = s.db_bytes / input.limits.dbBytes;
    const dbMsg = `資料庫已用 ${fmtMB(s.db_bytes)} / ${fmtMB(input.limits.dbBytes)}（${Math.round(dbRatio * 100)}%）`;
    if (dbRatio >= 0.9) add('critical', 'db_size', `${dbMsg}。超過上限後資料庫會變成唯讀`);
    else if (dbRatio >= 0.7) add('warning', 'db_size', dbMsg);

    if (s.longest_query_seconds >= 60) add('warning', 'long_query', `有查詢已經執行 ${s.longest_query_seconds} 秒還沒結束`);

    // 慢查詢：pg_stat_statements 是累計值，所以門檻抓高一點，只在「平均超過 3 秒且已經被呼叫很多次」才提醒
    const bad = s.slow_queries.filter((q) => q.mean_ms >= 3000 && q.calls >= 30);
    if (bad.length > 0) add('warning', 'slow_queries', `有 ${bad.length} 種查詢平均超過 3 秒（最慢：${bad[0].q.slice(0, 60)}…，平均 ${bad[0].mean_ms} 毫秒、共 ${bad[0].calls} 次）`);
  }

  if (!input.latestBackup) {
    add('critical', 'backup_missing', '找不到任何備份紀錄');
  } else {
    // 每日備份在 18:00 UTC 開跑，檢查排在 19:00 UTC，正常情況最新備份不到 2 小時；放寬到 30／50 小時以容許偶爾一天沒做完
    if (input.latestBackup.ageHours > 50) add('critical', 'backup_stale', `最新一份備份已經是 ${Math.round(input.latestBackup.ageHours)} 小時前的（超過 2 天沒有新備份）`);
    else if (input.latestBackup.ageHours > 30) add('warning', 'backup_stale', `最新一份備份是 ${Math.round(input.latestBackup.ageHours)} 小時前的，今天的自動備份可能沒做完`);
    const prev = input.previousBackupTotalRows;
    if (prev && prev > 1000 && input.latestBackup.totalRows < prev * 0.8) {
      add('warning', 'backup_shrunk', `最新備份的資料量（${input.latestBackup.totalRows} 列）比前一份（${prev} 列）少了超過 20%，請確認是否有資料被大量刪除`);
    }
  }

  if (input.verify && !input.verify.ok) {
    add('critical', 'backup_verify', `最新備份驗證失敗：${input.verify.problems.slice(0, 3).join('；')}`);
  }

  const dropped = input.liveVsBackup.filter((t) => t.backup >= 50 && t.live < t.backup * 0.8);
  if (dropped.length > 0) {
    add('warning', 'data_drop', `目前資料量比最新備份少超過 20%：${dropped.map((t) => `${t.table}（備份 ${t.backup} → 現在 ${t.live}）`).join('、')}。若不是你們刻意刪除，請盡快檢查並考慮還原`);
  }

  const status: Level = alerts.some((a) => a.level === 'critical') ? 'critical' : alerts.length > 0 ? 'warning' : 'ok';
  return { status, alerts };
}

