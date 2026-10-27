import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { flushOutbox } from '@/lib/outbox';

export const dynamic = 'force-dynamic';

// 每日排程（vercel.json）：
//  1. 把到期的臨時（外校支援）帳號在登入系統裡停用（資料庫那邊到期當下權限就已經失效，這裡是再多一層：連登入都擋掉）
//  2. 補寄還沒寄出的通知信
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
  return NextResponse.json({ success: true, expiredTemps: expired?.length ?? 0, banned, mail });
}
