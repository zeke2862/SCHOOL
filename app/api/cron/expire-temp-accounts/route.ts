import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { flushOutbox } from '@/lib/outbox';
import { runHealthCheck, logHealth, maybeEmailAlerts } from '@/lib/health';
import { executePrune } from '@/lib/backupRetention';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

// 每日排程（vercel.json，UTC 19:00，排在 18:00 的每日備份之後）：
//  1. 把到期的臨時（外校支援）帳號在登入系統裡停用（資料庫那邊到期當下權限就已經失效，這裡是再多一層：連登入都擋掉）
//  2. 補寄還沒寄出的通知信
//  3. 系統健康檢查：驗證最新備份能不能還原、檢查資料庫／儲存空間／連線數，有問題寄信給系統管理員 S 並寫入紀錄
//     （Vercel 免費方案的排程最多 2 個，所以併在這支，不另外開）
//  4. 舊備份清理：只有環境變數 BACKUP_PRUNE=1 才會真的刪（規則見 lib/backupRetention.ts），而且最新備份驗證通過才清；沒設定就只預覽
// 第 3、4 項任何一步失敗都不影響第 1、2 項。
export async function GET(req: NextRequest) {
  const expected = process.env.CRON_SECRET;
  if (!expected) return NextResponse.json({ error: '伺服器尚未設定 CRON_SECRET' }, { status: 500 });
  if (req.headers.get('authorization') !== `Bearer ${expected}`) return NextResponse.json({ error: '驗證失敗' }, { status: 401 });

  const { data: expired } = await supabaseAdmin
    .from('app_users')
    .select('id')
    .eq('is_temporary', true)
    .not('account_expires_at', 'is', null)
    .lte('account_expires_at', new Date().toISOString());
  let banned = 0;
  for (const u of expired ?? []) {
    const { error } = await supabaseAdmin.auth.admin.updateUserById(u.id, { ban_duration: '87600h' });
    if (!error) banned++;
  }
  const mail = await flushOutbox();

  let health: Record<string, unknown> = {};
  try {
    const report = await runHealthCheck(supabaseAdmin, { verify: true });
    let prune: Record<string, unknown> | null = null;
    const verify = report.metrics.verify as { ok?: boolean; ageHours?: number | null } | null;
    if (process.env.BACKUP_PRUNE === '1' && verify?.ok && (verify.ageHours ?? 999) <= 36) {
      const r = await executePrune(supabaseAdmin);
      prune = { removed: r.removed, freedMB: Math.round(r.freedBytes / 1048576), errors: r.errors };
    }
    const email = await maybeEmailAlerts(supabaseAdmin, report);
    await logHealth(supabaseAdmin, 'cron', report, { ...(email.sent > 0 ? { emailedAt: new Date().toISOString() } : {}), ...(prune ? { prunedRun: prune } : {}) });
    health = { status: report.status, alerts: report.alerts.length, email, prune };
    if (report.status !== 'ok') console.warn('[health]', JSON.stringify(report.alerts));
  } catch (e: any) {
    console.error('[cron/health] failed:', e);
    health = { error: e?.message ?? String(e) };
  }

  return NextResponse.json({ success: true, expiredTemps: expired?.length ?? 0, banned, mail, health });
}
