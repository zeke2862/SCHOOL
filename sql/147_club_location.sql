-- 147：社團新增「授課位置」（文字欄位）
-- 建立社團時可從班級教室選一個，或選「其它」自行輸入（例如活動中心、操場）；
-- 社團點名冊列印時印在標題列。只新增一個可為空的文字欄位，不影響既有資料與其他功能。
-- 回復：alter table public.clubs drop column location;

alter table public.clubs add column if not exists location text;

-- 既有社團的授課位置本來就寫在名稱「-」後面（例如「弟子規-三孝」→「三孝」、「舞蹈-活動中心」→「活動中心」），
-- 依這個規則補進欄位；名稱沒有「-」的社團維持空白，之後可在後台指定。只補空白欄位，已設定的不會動。
update public.clubs
set location = substring(name from '-([^-]+)$')
where location is null
  and substring(name from '-([^-]+)$') is not null;
