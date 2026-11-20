import type { SupabaseClient } from '@supabase/supabase-js';
import { verifyBackup } from './backupVerify';
import { evaluateHealth, DEFAULT_LIMITS, type Alert, type Level, type Snapshot } from './healthEval';
import { previewPrune } from './backupRetention';
import { sendMail } from './mailer';
import { mailConfig } from './outbox';

// ⚠️ 只能在伺服器端使用。系統健康檢查（資安與效能檢測報告 第三級：監控與告警）。
// 每天排程跑一次（app/api/cron/expire-temp-accounts），管理者也可以在「開發人員區 → 系統健康檢查」按「立即檢查」。
// 評估規則集中在 evaluateHealth()（純函式，有單元測試）。

const MB = 1024 * 1024;
const KEY_TABLES = ['students', 'teachers', 'classes', 'enrollments', 'scores'];

export type HealthReport = {
  checkedAt: string;
  status: Level;
  alerts: Alert[];
  metrics: Record<string, any>;
};

/** 收集資料、評估、回傳報告（不寫紀錄、不寄信）。verify=true 時順便做最新備份的完整驗證（較慢，約 10～30 秒） */
export async function runHealthCheck(admin: SupabaseClient, opts: { verify: boolean }): Promise<HealthReport> {
  const t0 = Date.now();
  let pingMs: number | null = null;
  let snapshot: Snapshot | null = null;
  try {
    const { data, error } = await admin.rpc('admin_health_snapshot');
    if (!error && data) {
      pingMs = Date.now() - t0;
      snapshot = data as Snapshot;
    }
  } catch {
    /* 連不上就是 null */
  }

  const { data: backups } = await admin.from('backups').select('id, created_at, table_counts').order('created_at', { ascending: false }).limit(2);
  const total = (c: Record<string, number | null> | null) => Object.values(c ?? {}).reduce<number>((s, v) => s + (typeof v === 'number' ? v : 0), 0);
  const latest = backups?.[0] ?? null;
  const latestBackup = latest ? { ageHours: (Date.now() - new Date(latest.created_at).getTime()) / 3600000, totalRows: total(latest.table_counts) } : null;
  const previousBackupTotalRows = backups?.[1] ? total(backups[1].table_counts) : null;

  const liveVsBackup: { table: string; backup: number; live: number }[] = [];
  if (latest) {
    const counts = (latest.table_counts ?? {}) as Record<string, number | null>;
    for (const t of KEY_TABLES) {
      const b = counts[t];
      if (typeof b !== 'number') continue;
      const { count } = await admin.from(t).select('*', { count: 'exact', head: true });
      if (typeof count === 'number') liveVsBackup.push({ table: t, backup: b, live: count });
    }
  }

  const verify = opts.verify ? await verifyBackup(admin) : null;
  const limits = {
    storageBytes: (Number(process.env.STORAGE_LIMIT_MB) || 1024) * MB,
    dbBytes: (Number(process.env.DB_LIMIT_MB) || 500) * MB,
  };
  const { status, alerts } = evaluateHealth({ snapshot, pingMs, latestBackup, previousBackupTotalRows, verify, liveVsBackup, limits });

  let prune: { removeCount: number; freeMB: number } | null = null;
  try {
    const p = await previewPrune(admin);
    if (!p.error) prune = { removeCount: p.removeIds.length, freeMB: Math.round(p.removeBytes / MB) };
  } catch {
    /* 預覽失敗不影響檢查 */
  }

  return {
    checkedAt: new Date().toISOString(),
    status,
    alerts,
    metrics: { snapshot, pingMs, latestBackup, liveVsBackup, limits, prune, verify },
  };
}

/** 把檢查結果寫進 system_health_log，順便清掉 90 天前的紀錄 */
export async function logHealth(admin: SupabaseClient, source: 'cron' | 'manual', report: HealthReport, extra: Record<string, any> = {}) {
  await admin.from('system_health_log').insert({ source, status: report.status, alerts: report.alerts, metrics: { ...report.metrics, ...extra } });
  await admin.from('system_health_log').delete().lt('checked_at', new Date(Date.now() - 90 * 86400000).toISOString());
}

/**
 * 有問題時寄信給系統管理員 S（只有「問題種類變了」或「同樣問題已經超過 7 天沒提醒」才寄，避免每天重複轟炸）。
 * 寄信沒設定（沒有 SMTP_HOST／RESEND_API_KEY）時不寄，結果仍會留在紀錄與管理頁。
 */
export async function maybeEmailAlerts(admin: SupabaseClient, report: HealthReport): Promise<{ sent: number; reason: string }> {
  if (report.alerts.length === 0) return { sent: 0, reason: '沒有問題' };
  if (!mailConfig().configured) return { sent: 0, reason: '寄信尚未設定' };

  const { data: prev } = await admin.from('system_health_log').select('checked_at, alerts, metrics').order('checked_at', { ascending: false }).limit(30);
  const keyOf = (alerts: Alert[]) => alerts.map((a) => `${a.level}:${a.key}`).sort().join('|');
  const nowKey = keyOf(report.alerts);
  const lastEmailed = (prev ?? []).find((r: any) => r.metrics?.emailedAt);
  const sameAsLastEmailed = lastEmailed && keyOf(lastEmailed.alerts ?? []) === nowKey;
  const recentlyEmailed = lastEmailed && Date.now() - new Date(lastEmailed.metrics.emailedAt).getTime() < 7 * 86400000;
  if (sameAsLastEmailed && recentlyEmailed) return { sent: 0, reason: '同樣的問題最近已經寄過信' };

  const { data: admins } = await admin.from('app_users').select('id').eq('role', 'system_admin_s');
  const body =
    `校務行政系統健康檢查發現 ${report.alerts.length} 項問題（整體狀態：${report.status === 'critical' ? '嚴重' : '警告'}）：\n\n` +
    report.alerts.map((a) => `${a.level === 'critical' ? '【嚴重】' : '【警告】'}${a.message}`).join('\n') +
    `\n\n請登入系統 → 開發人員區 → 系統健康檢查 查看詳情與處理方式。\n（此信由系統自動寄出；同樣的問題最多每 7 天提醒一次。）`;
  let sent = 0;
  for (const a of admins ?? []) {
    const { data: u } = await admin.auth.admin.getUserById(a.id);
    const email = u?.user?.email;
    if (!email) continue;
    const r = await sendMail(email, `【校務系統警告】${report.alerts.length} 項系統問題`, body);
    if (r.ok) sent++;
  }
  return { sent, reason: sent > 0 ? '已寄出' : '寄信失敗' };
}
