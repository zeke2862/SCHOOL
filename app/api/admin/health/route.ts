import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { getCaller } from '@/lib/serverAuth';
import { runHealthCheck, logHealth } from '@/lib/health';
import { verifyBackup } from '@/lib/backupVerify';
import { previewPrune, executePrune } from '@/lib/backupRetention';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

// 系統健康檢查（開發人員區 → 系統健康檢查 用）。只有系統管理員 S（開發人員唯讀）可以呼叫；
// /api/admin/* 另外有雙重驗證 middleware 把關。
//   GET  → 最近的檢查紀錄＋現在即時的檢查結果（不含備份驗證，較快）
//   POST { action: 'check' }    → 立即檢查並記錄
//   POST { action: 'verify' }   → 驗證最新備份（讀回所有分段檔、比對列數與關聯）＋完整檢查並記錄
//   POST { action: 'prune-preview' } → 預覽依保留規則會刪哪些舊備份（不刪）
//   POST { action: 'prune' }    → 真的刪舊備份（只有系統管理員 S 本人，開發人員唯讀不行）
export async function GET(req: NextRequest) {
  const caller = await getCaller(req, { readOnly: true });
  if ('error' in caller) return NextResponse.json({ error: caller.error }, { status: caller.status });
  if (!caller.isSD) return NextResponse.json({ error: '只有系統管理員可以查看' }, { status: 403 });

  const [report, { data: history }] = await Promise.all([
    runHealthCheck(supabaseAdmin, { verify: false }),
    supabaseAdmin.from('system_health_log').select('id, checked_at, source, status, alerts, metrics').order('checked_at', { ascending: false }).limit(30),
  ]);
  // 最近一次有做備份驗證的結果（排程每天會做）
  const lastVerify = (history ?? []).find((h: any) => h.metrics?.verify)?.metrics?.verify ?? null;
  return NextResponse.json({ report, lastVerify, history: (history ?? []).map((h: any) => ({ id: h.id, checked_at: h.checked_at, source: h.source, status: h.status, alerts: h.alerts })) });
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as { action?: string };
  const action = body.action;
  const needsWrite = action === 'prune';
  const caller = await getCaller(req, { readOnly: !needsWrite });
  if ('error' in caller) return NextResponse.json({ error: caller.error }, { status: caller.status });
  if (!caller.isSD) return NextResponse.json({ error: needsWrite ? '只有系統管理員 S 可以清理備份' : '只有系統管理員可以使用' }, { status: 403 });

  try {
    if (action === 'check') {
      const report = await runHealthCheck(supabaseAdmin, { verify: false });
      await logHealth(supabaseAdmin, 'manual', report);
      return NextResponse.json({ report });
    }
    if (action === 'verify') {
      const report = await runHealthCheck(supabaseAdmin, { verify: true });
      await logHealth(supabaseAdmin, 'manual', report);
      return NextResponse.json({ report, verify: report.metrics.verify });
    }
    if (action === 'prune-preview') {
      const p = await previewPrune(supabaseAdmin);
      if (p.error) return NextResponse.json({ error: p.error }, { status: 500 });
      return NextResponse.json({ total: p.total, removeCount: p.removeIds.length, freeMB: Math.round(p.removeBytes / 1048576) });
    }
    if (action === 'prune') {
      // 安全檢查：最新一份備份必須驗證通過才清理，避免「新的壞了、舊的又被清掉」
      const v = await verifyBackup(supabaseAdmin);
      if (!v.ok || (v.ageHours ?? 999) > 36) {
        return NextResponse.json({ error: `最新備份沒有通過驗證或太舊，為了安全不清理舊備份。${v.problems.slice(0, 2).join('；')}` }, { status: 409 });
      }
      const r = await executePrune(supabaseAdmin);
      return NextResponse.json({ removed: r.removed, freedMB: Math.round(r.freedBytes / 1048576), errors: r.errors });
    }
    return NextResponse.json({ error: '未知的操作' }, { status: 400 });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? '未知錯誤' }, { status: 500 });
  }
}
