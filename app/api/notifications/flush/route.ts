import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { flushOutbox } from '@/lib/outbox';

export const dynamic = 'force-dynamic';

// 已登入的教職員一打開系統，前端就呼叫這支，把佇列裡還沒寄的通知信寄出去
// （信件內容與收件人都是資料庫產生的，這裡不能指定）。為了避免大家同時登入時重複處理，
// 同一個伺服器行程 30 秒內最多處理一次。
let lastRun = 0;

export async function POST(req: NextRequest) {
  const token = req.headers.get('authorization')?.replace('Bearer ', '');
  if (!token) return NextResponse.json({ error: '未登入' }, { status: 401 });
  const { data: auth, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !auth.user) return NextResponse.json({ error: '登入憑證無效' }, { status: 401 });
  const now = Date.now();
  if (now - lastRun < 30_000) return NextResponse.json({ success: true, throttled: true });
  lastRun = now;
  const result = await flushOutbox();
  return NextResponse.json({ success: true, ...result });
}
