import { NextRequest, NextResponse } from 'next/server';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { supabaseAdmin as sharedAdmin } from '@/lib/supabaseAdmin';
import { getCaller, Caller } from '@/lib/serverAuth';

// ⚠️ 只能在伺服器端（API route）使用。
// 競賽 API 的共用工具：
//  * requireOrganizer：確認呼叫者是這場賽事的承辦人（或系統管理員S），回傳「以呼叫者身分」連線的 Supabase 用戶端。
//    資料寫入一律用這個用戶端（受 RLS 與資料庫觸發器約束），只有建立登入帳號這類 Auth 管理動作才用 supabaseAdmin。
//    好處：就算這裡的檢查有漏洞，資料庫仍會擋。

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (s: unknown): s is string => typeof s === 'string' && UUID_RE.test(s);

// 競賽 API 的資料庫呼叫一律用 cache: 'no-store'。Next.js 會把伺服器端 fetch 存進「資料快取」。
// 實測只觀察到「公開頁的 rpc 查詢」被快取（第一次回「找不到」之後怎麼開啟都一樣，見 app/api/public/competition）；
// 這裡的其他呼叫實測沒有被快取，但一律關掉快取，避免日後換環境（例如 Vercel）行為不同時出現難以察覺的舊資料。
const noStore = (input: RequestInfo | URL, init?: RequestInit) => fetch(input, { ...init, cache: 'no-store' });

export function userClient(token: string): SupabaseClient {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    global: { headers: { Authorization: `Bearer ${token}` }, fetch: noStore },
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

/** 競賽 API 專用的管理員連線（金鑰同 lib/supabaseAdmin，但一律不快取） */
export const supabaseAdmin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY || 'missing-service-role-key', {
  auth: { autoRefreshToken: false, persistSession: false },
  global: { fetch: noStore },
});
void sharedAdmin; // 保留 import：確保缺少金鑰時，共用模組仍會印出明確的錯誤訊息

export type OrganizerCtx = { caller: Caller; db: SupabaseClient; eventId: string };

export async function requireOrganizer(
  req: NextRequest,
  eventId: string,
  opts?: { readOnly?: boolean }
): Promise<OrganizerCtx | { err: NextResponse }> {
  if (!isUuid(eventId)) return { err: NextResponse.json({ error: '賽事代碼格式不正確' }, { status: 400 }) };
  const caller = await getCaller(req, { readOnly: opts?.readOnly });
  if ('error' in caller) return { err: NextResponse.json({ error: caller.error }, { status: caller.status }) };
  if (caller.role === 'competition_guest') {
    return { err: NextResponse.json({ error: '賽事訪客不能使用承辦人功能' }, { status: 403 }) };
  }
  const { data: ev } = await supabaseAdmin.from('comp_events').select('id').eq('id', eventId).maybeSingle();
  if (!ev) return { err: NextResponse.json({ error: '找不到這場賽事' }, { status: 404 }) };
  if (!caller.isSD) {
    const { data: org } = await supabaseAdmin
      .from('comp_organizers')
      .select('user_id')
      .eq('event_id', eventId)
      .eq('user_id', caller.userId)
      .maybeSingle();
    if (!org) return { err: NextResponse.json({ error: '只有這場賽事的承辦人可以執行這個動作' }, { status: 403 }) };
  }
  const token = req.headers.get('authorization')!.replace('Bearer ', '');
  return { caller, db: userClient(token), eventId };
}

// 以信箱找 Auth 使用者（Supabase 沒有直接用 email 查詢的 admin API，所以分頁找）
export async function findAuthUserIdByEmail(email: string): Promise<string | null> {
  const target = email.trim().toLowerCase();
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await supabaseAdmin.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw new Error(error.message);
    const users = data.users as { id: string; email?: string }[];
    const hit = users.find((u) => (u.email ?? '').toLowerCase() === target);
    if (hit) return hit.id;
    if (users.length < 1000) break;
  }
  return null;
}

// 到期日（含當天，泰國時間當天結束失效）。回傳 null 表示格式錯誤
export function parseExpiry(expiresOn: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(expiresOn)) return null;
  const d = new Date(`${expiresOn}T23:59:59+07:00`);
  return isNaN(d.getTime()) ? null : d;
}

export async function auditGuest(targetUserId: string, byUserId: string, note: string) {
  // account_audit_log.action 有檢查限制，只能用既有值；細節寫在 new_value
  await supabaseAdmin
    .from('account_audit_log')
    .insert({ target_user_id: targetUserId, action: 'role_change', old_value: null, new_value: `[賽事訪客] ${note}`, changed_by: byUserId });
}
