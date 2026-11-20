// 內容安全政策（目前只記錄不攔截）。各項來源的原因：
// - script/style 需要 'unsafe-inline'：Next.js 會在頁面內嵌少量啟動腳本與樣式（要拿掉得改成每次請求產生 nonce，之後再評估）。
// - connect-src／img-src 含 *.supabase.co：資料庫、登入、檔案儲存都在 Supabase；wss 是即時連線。
// - challenges.cloudflare.com：登入頁的 Cloudflare Turnstile 驗證碼（有啟用才會載入）。
// - frame-src／img-src 含 blob:、data:：PDF 預覽（blob 網址內嵌）與頁面內產生的圖片。
const CSP_REPORT_ONLY = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' https://challenges.cloudflare.com",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https://*.supabase.co",
  "font-src 'self' data:",
  "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://api.pwnedpasswords.com",
  "frame-src 'self' blob: https://challenges.cloudflare.com",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'self'",
  'report-uri /api/csp-report',
].join('; ');

/** @type {import('next').NextConfig} */
const nextConfig = {
  // 1. 保留你本来的局域网与本地开发配置
  allowedDevOrigins: ['192.168.1.11', 'localhost:3000'],

  // 型別錯誤與 ESLint 問題會讓建置失敗，避免有問題的版本被部署上線
  //（2026-11 起：本機 tsc 已無錯誤，所以不再略過；CI 也會跑同樣的檢查）
  typescript: {
    ignoreBuildErrors: false,
  },
  eslint: {
    ignoreDuringBuilds: false,
  },

  // 排課工具是放在 public/ 的靜態 HTML，瀏覽器會自己快取；更新後使用者可能還在跑舊版。
  // 這裡要求每次都向伺服器確認有沒有新版。
  async headers() {
    return [
      // 全站安全標頭（資安檢測報告 #7）。
      // - X-Frame-Options 用 SAMEORIGIN 而不是 DENY：排課工具與 PDF 預覽會在「同網站」內嵌 iframe，DENY 會讓它們壞掉；
      //   SAMEORIGIN 一樣能擋掉別人的網站把我們的頁面嵌進去（點擊劫持）。
      // - CSP 先用 Report-Only：只記錄「如果強制會擋掉什麼」，不會真的擋，違規報告送到 /api/csp-report（看 Vercel 日誌搜尋 [csp]）。
      //   觀察一到兩週、確認沒有誤擋正常功能後，再把 Content-Security-Policy-Report-Only 改成 Content-Security-Policy。
      // - HSTS 不在這裡設：Vercel 對 vercel.app 與綁定的網域本來就會送。
      {
        source: '/:path*',
        headers: [
          { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()' },
          { key: 'Content-Security-Policy-Report-Only', value: CSP_REPORT_ONLY },
        ],
      },
      // 字型與圖片很少更動，讓瀏覽器快取一年，每個人只需要下載一次（之後換檔案請換檔名）
      {
        source: '/fonts/:path*',
        headers: [{ key: 'Cache-Control', value: 'public, max-age=31536000, immutable' }],
      },
      {
        source: '/images/:path*',
        headers: [{ key: 'Cache-Control', value: 'public, max-age=31536000, immutable' }],
      },
      // 遊戲面板插圖：快取 30 天（沒設成 immutable，之後若換圖檔，最久 30 天內大家會自動更新）
      {
        source: '/game/:path*',
        headers: [{ key: 'Cache-Control', value: 'public, max-age=2592000' }],
      },
      {
        source: '/scheduler/:path*',
        headers: [{ key: 'Cache-Control', value: 'no-cache, must-revalidate' }],
      },
    ];
  },
};

export default nextConfig;
