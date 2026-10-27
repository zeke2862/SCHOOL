import { createClient } from '@supabase/supabase-js';

// ⚠️ 這個檔案只能在伺服器端（API route）使用，絕對不能 import 進任何前端元件。
// SUPABASE_SERVICE_ROLE_KEY 不加 NEXT_PUBLIC_ 前綴，才不會被打包進前端程式碼。
// 沒設定 SUPABASE_SERVICE_ROLE_KEY 時，createClient 會在載入模組那一刻就丟出例外，
// API 整支變成沒有內容的 HTTP 500，畫面只看得到「伺服器沒有正常回應」。這裡改成先印出明確的錯誤，
// 並用占位值讓模組可以載入，這樣各 API 自己的 try/catch 才能回傳「Invalid API key」之類看得懂的訊息。
if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
  console.error('[supabaseAdmin] 環境變數 SUPABASE_SERVICE_ROLE_KEY 沒有設定，所有需要管理員金鑰的 API 都會失敗（請加到 .env.local 與 Vercel 環境變數）');
}
export const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || 'missing-service-role-key',
  { auth: { autoRefreshToken: false, persistSession: false } }
);
