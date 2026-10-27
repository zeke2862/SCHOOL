// Supabase 一次查詢最多只回傳 1000 筆（伺服器的 max-rows 上限，前端 .limit() 也改不了）。
// 資料超過 1000 筆時，畫面上看起來就是「剛好 1000」，其實是被截掉了。
// 要拿全部資料，就要分頁一直查到沒資料為止，這個函式幫忙做。
//
// 用法：const rows = await fetchAllPages((from, to) => supabase.from('t').select('...').order('id').range(from, to));
// 注意：排序一定要有「不會重複」的欄位（例如 id），否則分頁之間可能漏資料或重複。
export async function fetchAllPages<T = any>(
  build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
  pageSize = 1000
): Promise<{ data: T[]; error: string | null }> {
  const out: T[] = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await build(from, from + pageSize - 1);
    if (error) return { data: out, error: error.message };
    out.push(...(data ?? []));
    if (!data || data.length < pageSize) break;
  }
  return { data: out, error: null };
}

/** 把很長的清單切成小段（例如 .in('student_no', 一千多個學號') 網址太長會失敗） */
export function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}
