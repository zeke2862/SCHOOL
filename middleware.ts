import { NextRequest, NextResponse } from 'next/server';
import { MFA_BLOCK_MESSAGE, shouldBlockForMfa } from '@/lib/mfaGate';

// 管理 API（/api/admin/*：建立帳號、重設密碼、備份還原、刪除帳號…）的雙重驗證把關（資安檢測報告 #8）。
// 規則：呼叫者的帳號如果登記過雙重驗證，登入憑證就必須是「通過第二步」（aal2）的，否則一律擋下。
// 沒登記雙重驗證的帳號（一般教師）照舊，不受影響。
// 目的：就算有人只拿到某位管理員的密碼、直接用程式打這些 API，也沒辦法繞過第二步。
//
// 判斷方式（見 lib/mfaGate.ts）：憑證本身（JWT）帶有目前的驗證等級（aal）；只有 aal1 時才多問一次
// Supabase Auth「這個帳號有沒有已驗證的驗證器」。憑證是否有效不在這裡驗，由各 API 自己用 getUser 驗證；
// 查不到、連不上 Auth 都放行。
//
// 注意：這只保護 /api/admin/*。教師用瀏覽器直接對資料庫的讀寫仍由資料庫權限政策（RLS）把關，
// 雙重驗證對那一層是靠登入頁與 (app) 版面強制（見 app/(app)/layout.tsx）。

export const config = { matcher: ['/api/admin/:path*'] };

export async function middleware(req: NextRequest) {
  const block = await shouldBlockForMfa(
    req.headers.get('authorization'),
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
  if (block) return NextResponse.json({ error: MFA_BLOCK_MESSAGE }, { status: 403 });
  return NextResponse.next();
}
