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
