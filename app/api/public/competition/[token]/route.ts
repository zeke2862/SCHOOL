import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';

// QR 公開成績頁的資料（不需登入）。
// 只用匿名金鑰呼叫資料庫函式 comp_public_view：函式只會回傳「承辦人已公布」的項目，
// 且不含學號、未公布項目與分數(除非承辦人開啟)。代碼不對、或公開頁沒開啟，一律回 404（不區分原因，避免被探測）。

const TOKEN_RE = /^[a-f0-9]{64}$/;
// ⚠️ 一定要明確指定 cache: 'no-store'：Next.js 會把伺服器端 fetch 的結果存進「資料快取」（含 POST），
// supabase-js 的 rpc 就是 POST。沒指定的話，第一次查到「找不到／尚未開啟」就會被快取住，
// 承辦人之後開啟公開頁、或發出修正公告，家長掃碼看到的仍然是舊結果。
const anon = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
  auth: { autoRefreshToken: false, persistSession: false },
  global: { fetch: (input: RequestInfo | URL, init?: RequestInit) => fetch(input, { ...init, cache: 'no-store' }) },
});

export async function GET(_req: NextRequest, { params }: { params: { token: string } }) {
  if (!TOKEN_RE.test(params.token)) return NextResponse.json({ error: '找不到' }, { status: 404 });
  const { data, error } = await anon.rpc('comp_public_view', { p_token: params.token });
  if (error) return NextResponse.json({ error: '暫時無法讀取' }, { status: 503 });
  if (!data) return NextResponse.json({ error: '找不到' }, { status: 404 });
  return NextResponse.json(data, {
    // 現場很多人同時掃 QR 碼：短暫快取，減輕資料庫負擔；修正公告約 20 秒內就會更新
    headers: { 'Cache-Control': 'public, s-maxage=20, stale-while-revalidate=60' },
  });
}
