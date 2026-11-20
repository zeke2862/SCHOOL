import { NextRequest, NextResponse } from 'next/server';

// 接收瀏覽器送來的「內容安全政策」違規報告（目前政策是 Report-Only，不會真的擋，只回報）。
// 只把精簡後的內容寫到伺服器日誌（Vercel → Logs 搜尋「[csp]」），不存資料庫、不回傳任何東西。
// 不需要登入（瀏覽器回報時不帶憑證）；內容大小限制，避免被拿來灌日誌。
export async function POST(req: NextRequest) {
  try {
    const text = (await req.text()).slice(0, 4000);
    const json = JSON.parse(text);
    const r = json['csp-report'] ?? json;
    console.warn(
      '[csp]',
      JSON.stringify({
        directive: r['effective-directive'] ?? r['violated-directive'],
        blocked: String(r['blocked-uri'] ?? '').slice(0, 200),
        page: String(r['document-uri'] ?? '').slice(0, 200),
        source: String(r['source-file'] ?? '').slice(0, 200),
      })
    );
  } catch {
    // 格式不對就忽略
  }
  return new NextResponse(null, { status: 204 });
}
