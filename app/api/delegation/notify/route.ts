import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { flushOutbox } from '@/lib/outbox';

export const dynamic = 'force-dynamic';

// 設定／撤銷代理人之後，前端呼叫這支把「往上送的通知信」立刻寄出。
// 只需要是已登入的教職員；它只會寄 email_outbox 佇列裡已經由資料庫產生的信，不能指定收件人或內容。
export async function POST(req: NextRequest) {
  const token = req.headers.get('authorization')?.replace('Bearer ', '');
  if (!token) return NextResponse.json({ error: '未登入' }, { status: 401 });
  const { data: auth, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !auth.user) return NextResponse.json({ error: '登入憑證無效' }, { status: 401 });
  const result = await flushOutbox();
  return NextResponse.json({ success: true, ...result });
}
