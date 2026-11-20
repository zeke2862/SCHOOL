// 共用的「短時間查詢快取」：很少變動、很多頁面都會用到的小資料（例如「目前學年學期」），
// 在同一個瀏覽器分頁裡一段時間內只查一次；同一時間多個元件一起要，也只會送出一個請求。
// 只存在記憶體（重新整理或換帳號就清空），不寫入 localStorage，不會留下別人的資料。
// 用法：const term = await cached('term:current', () => fetchTerm(), 60_000);
// 資料被修改後要立刻看到新的，呼叫 invalidateCache('term:')（前綴比對）。

type Entry<T = unknown> = { at: number; ttl: number; value?: T; pending?: Promise<T> };
const store = new Map<string, Entry>();

export async function cached<T>(key: string, fetcher: () => Promise<T>, ttlMs = 60_000): Promise<T> {
  const hit = store.get(key) as Entry<T> | undefined;
  const now = Date.now();
  if (hit) {
    if (hit.pending) return hit.pending; // 已經有人在查了，一起等同一份結果
    if (now - hit.at < hit.ttl) return hit.value as T;
  }
  const entry: Entry<T> = { at: now, ttl: ttlMs };
  const p = fetcher().then(
    (v) => {
      entry.value = v;
      entry.at = Date.now();
      entry.pending = undefined;
      return v;
    },
    (e) => {
      // 失敗不要留在快取裡，下次呼叫會重新查
      if (store.get(key) === entry) store.delete(key);
      throw e;
    },
  );
  entry.pending = p;
  store.set(key, entry);
  return p;
}

/** 清掉快取：不給前綴就全部清掉；給前綴就只清掉該開頭的項目 */
export function invalidateCache(prefix = '') {
  for (const k of Array.from(store.keys())) if (k.startsWith(prefix)) store.delete(k);
}
