import { supabase } from './supabaseClient';
import { invalidateCache } from './queryCacheCore';

// 短時間查詢快取的對外入口（邏輯在 queryCacheCore.ts，那邊不連資料庫、可以單獨測試）。
// 用法：import { cached, invalidateCache } from '@/lib/queryCache';
export { cached, invalidateCache } from './queryCacheCore';

// 登入／登出／換帳號時一律清空，避免看到上一個人看得到的資料
if (typeof window !== 'undefined') {
  let lastUser: string | null | undefined;
  supabase.auth.onAuthStateChange((_event, session) => {
    const uid = session?.user?.id ?? null;
    if (lastUser !== undefined && uid !== lastUser) invalidateCache();
    lastUser = uid;
  });
}
