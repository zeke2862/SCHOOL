競賽 SQL 本機驗證（免費、不連雲端）：用 PGlite（WebAssembly 版 Postgres）載入 stubs.sql 模擬校務系統的基礎表，
再執行 sql/142、sql/143，並用模擬學生/教師/訪客/匿名身分測試 RLS 與報名、公布、修正流程。
執行：
  npm i --no-save @electric-sql/pglite
  node tools/competition-sql-test/run.mjs
注意：stubs.sql 是簡化的假表，只用來測試競賽功能；它不能取代在正式資料庫上的最後確認。

真實 Supabase 測試（e2e-cloud.mjs）：
  只能對「測試專案」執行（腳本內有保護）。需先在該專案套用 142、143 與最小版校務資料表、建立 8 個測試帳號。
  SUPA_URL=... SUPA_ANON=... TEST_PW=... node tools/competition-sql-test/e2e-cloud.mjs
  限制：拿不到測試專案的 service role 金鑰，所以 app/api 底下需要管理員金鑰的 API（訪客帳號、外校匯入、公開頁連結）沒有實測。

三支管理 API 的測試（api-cloud.mjs）：
  node tools/competition-sql-test/fake-supabase.mjs        # 本機假 Supabase（埠 54321，不含 RLS/觸發器）
  用以下環境變數啟動 next dev -p 3100：
    NEXT_PUBLIC_SUPABASE_URL=http://localhost:54321 NEXT_PUBLIC_SUPABASE_ANON_KEY=fake-anon SUPABASE_SERVICE_ROLE_KEY=fake-service-key
  BASE=http://localhost:3100 SUPA_URL=http://localhost:54321 SUPA_ANON=fake-anon TEST_PW='fake-pw-123' node tools/competition-sql-test/api-cloud.mjs
  每次執行前要重啟假後端（它記得上次建立的帳號）。
