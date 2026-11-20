import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

export const dynamic = 'force-dynamic';

// 公開的「系統還活著嗎」檢查網址，給免費的外部監控服務（例如 UptimeRobot、Better Stack）每 5 分鐘打一次：
// 正常回 200，資料庫連不上或超過兩天沒有新備份回 503，監控服務就會寄信／推播通知你。
// 刻意只回「正常／有問題」與問題種類，不回任何數字、名稱或個資。
// 外部監控能涵蓋「整個網站掛掉」這種系統自己無法通知的情況（系統自己的每日檢查與寄信，網站掛了就跑不了）。
export async function GET() {
  const issues: string[] = [];
  try {
    const { data, error } = await supabaseAdmin.from('backups').select('created_at').order('created_at', { ascending: false }).limit(1);
    if (error) issues.push('database');
    else {
      const last = data?.[0]?.created_at;
      if (!last || Date.now() - new Date(last).getTime() > 50 * 3600 * 1000) issues.push('backup');
    }
  } catch {
    issues.push('database');
  }
  const ok = issues.length === 0;
  return NextResponse.json({ ok, issues }, { status: ok ? 200 : 503, headers: { 'Cache-Control': 'no-store' } });
}
