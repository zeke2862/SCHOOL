import { supabase } from '@/lib/supabaseClient';

// 「系統文字管理」涵蓋的文字 key，跟畫面上真正用到的地方一一對應：
//   hub_label.<入口>            ：首頁方形按鈕的名稱（例如「學籍與學生」）
//   hub_desc.<入口>             ：首頁方形按鈕的說明
//   tab_label.<入口>.<功能>      ：點進入口後，每個功能方形按鈕的名稱（以及上方「入口 › 功能」的位置列）
//   tab_hint.<入口>.<功能>       ：功能按鈕上的小字說明（沒有就不顯示）
//   extra_label.<代碼>          ：首頁最下面「其他」那排按鈕的名稱
//   page_hint.*                 ：成績登錄、出缺勤登錄、出席查詢頁裡的幾段說明文字
// 入口與功能的清單直接取自 lib/permissions.ts 的 HUBS，增減功能時這份清單自動跟著變，不用手動維護；
// 預設文字就是 HUBS 裡的原文，這裡只會儲存「被改過」的文字，沒改過的永遠跟著程式裡最新的原文走。
import { HUBS } from '@/lib/permissions';

const STATIC_CONTENT_DEFAULTS: Record<string, string> = {
  'page_hint.scores_entry': '批次上傳（格式同「成績、出缺輸入表」工作表）',
  'page_hint.attendance_mobile_legend': '顏色圖例',
  'page_hint.attendance_subject_view': '只會顯示您自己授課節次的出缺勤累計次數（累計至今），不包含同班其他科目/節次的紀錄。',
};

// 首頁「其他」那排按鈕（代碼 → 預設名稱）
export const EXTRA_BUTTONS: { id: string; href: string; label: string }[] = [
  { id: 'clock', href: '/clock', label: '教職員打卡' },
  { id: 'notifications', href: '/notifications', label: '通知' },
  { id: 'leave', href: '/leave', label: '請假' },
  { id: 'schedule-lookup', href: '/schedule-lookup', label: '課表查詢' },
  { id: 'proxy', href: '/account/proxy', label: '代理人設定' },
  { id: 'account', href: '/account', label: '帳號設定' },
];

export const hubLabelKey = (hub: string) => `hub_label.${hub}`;
export const hubDescKey = (hub: string) => `hub_desc.${hub}`;
export const tabLabelKey = (hub: string, tab: string) => `tab_label.${hub}.${tab}`;
export const tabHintKey = (hub: string, tab: string) => `tab_hint.${hub}.${tab}`;
export const extraLabelKey = (id: string) => `extra_label.${id}`;

export const MODULE_LABEL_KEY_PREFIX = 'module_label.';
export function moduleLabelKey(moduleKey: string): string {
  return MODULE_LABEL_KEY_PREFIX + moduleKey;
}

export const SITE_CONTENT_DEFAULTS: Record<string, string> = {
  ...STATIC_CONTENT_DEFAULTS,
  ...Object.fromEntries(HUBS.flatMap((h) => [[hubLabelKey(h.key), h.label], [hubDescKey(h.key), h.desc]])),
  ...Object.fromEntries(HUBS.flatMap((h) => h.tabs.flatMap((t) => [[tabLabelKey(h.key, t.key), t.label], [tabHintKey(h.key, t.key), t.hint ?? '']]))),
  ...Object.fromEntries(EXTRA_BUTTONS.map((e) => [extraLabelKey(e.id), e.label])),
};

// 同一個工作階段只讀一次，換頁不用重讀；系統管理員儲存後呼叫 clearSiteContentCache() 讓畫面讀到最新的
let siteContentCache: Promise<Record<string, string>> | null = null;
export function loadSiteContentCached(): Promise<Record<string, string>> {
  if (!siteContentCache) siteContentCache = getSiteContentMap();
  return siteContentCache;
}
export function clearSiteContentCache() {
  siteContentCache = null;
}

/** 讀取目前資料庫裡存的文字內容；沒有存過的 key 用上面 SITE_CONTENT_DEFAULTS 當預設值。
 * 資料庫尚未執行 sql/39site_content_settings_assets.sql、或個別 key 還沒被改過，都會安靜地退回預設值，不會壞掉。 */
export async function getSiteContentMap(): Promise<Record<string, string>> {
  const merged: Record<string, string> = { ...SITE_CONTENT_DEFAULTS };
  try {
    const { data, error } = await supabase.from('site_content').select('content_key, content_value');
    if (!error && data) {
      for (const row of data as { content_key: string; content_value: string }[]) {
        merged[row.content_key] = row.content_value;
      }
    }
  } catch {
    // sql/39site_content_settings_assets.sql 尚未執行：安靜地使用預設值即可
  }
  return merged;
}

/** 系統管理員S在「系統文字管理」頁按儲存時呼叫：只把「跟預設不一樣」的文字存進資料庫，
 * 改回預設的那一列直接刪掉（這樣之後程式裡的原文更新時，沒被改過的文字會自動跟著更新）。 */
export async function saveSiteContentMap(values: Record<string, string>): Promise<string | null> {
  const changed: { content_key: string; content_value: string }[] = [];
  const reset: string[] = [];
  for (const [content_key, content_value] of Object.entries(values)) {
    const def = SITE_CONTENT_DEFAULTS[content_key];
    if (def !== undefined && content_value === def) reset.push(content_key);
    else changed.push({ content_key, content_value });
  }
  if (changed.length) {
    const { error } = await supabase.from('site_content').upsert(changed, { onConflict: 'content_key' });
    if (error) return '儲存失敗：' + error.message;
  }
  if (reset.length) {
    const { error } = await supabase.from('site_content').delete().in('content_key', reset);
    if (error) return '儲存失敗：' + error.message;
  }
  clearSiteContentCache();
  return null;
}

/** 讀取單一全站設定值（例如背景音樂網址）；沒有設定過就回傳 null。 */
export async function getSiteSetting(key: string): Promise<string | null> {
  try {
    const { data, error } = await supabase.from('site_settings').select('setting_value').eq('setting_key', key).maybeSingle();
    if (error || !data) return null;
    return data.setting_value ?? null;
  } catch {
    return null;
  }
}

/** 系統管理員S寫入一個全站設定值。 */
export async function saveSiteSetting(key: string, value: string | null): Promise<string | null> {
  const { error } = await supabase.from('site_settings').upsert({ setting_key: key, setting_value: value }, { onConflict: 'setting_key' });
  if (error) return '儲存失敗：' + error.message;
  return null;
}
