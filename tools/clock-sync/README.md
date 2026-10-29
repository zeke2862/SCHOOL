# 打卡機 CSV 每日自動同步

放在「存放打卡機匯出檔的那台 Windows 電腦」上，每天自動把新打卡資料送進校務系統。

## 一次性設定

1. 安裝 Node.js 18 以上（https://nodejs.org ，選 LTS）。
2. Vercel 專案 → Settings → Environment Variables 新增 `CLOCK_SYNC_TOKEN`，值自己編一串 30 字以上的亂碼，重新部署。
   （這不是 Supabase 金鑰，只用來讓這支程式有資格呼叫 `/api/clock/import`。）
3. 在 Supabase SQL Editor 執行 `sql/104staff_clock.sql`。
4. 複製本資料夾到那台電腦，把 `config.example.json` 複製成 `config.json`，填：
   - `apiBase`：校務系統網址（不要加結尾斜線）
   - `token`：和 `CLOCK_SYNC_TOKEN` 一模一樣
   - **直接連打卡機（建議）**：`device.ip`、`device.port`（4370）、`device.machineNo`（102），
     `device.commKey` 填打卡機的「通訊密碼」（數字；在機器 選單 → 通訊設定 → 通訊密碼，或 ZKTime 5 的設備設定裡）。
     這台電腦要跟打卡機在同一個網路（192.168.1.x）。
   - 或者讀匯出檔：把 `device` 整段刪掉，改填 `csvPath`（CSV 完整路徑；填資料夾會自動取最新的 `.csv`）
   - `config.json` 已列在 `.gitignore`，密碼與 token 不會被推上 GitHub。
5. 雙擊 `run-sync.bat` 測試（第一次會送整份檔案；也可先用 `node sync-clock.mjs --dry-run` 只檢查不送出）。
6. 成功後對 `install-windows-task.bat` 按右鍵「以系統管理員身分執行」，建立每天 21:30 的排程。
   到「工作排程器」→ 該工作 →「設定」勾選「如果錯過排定的開始時間，儘快執行工作」。

## 運作方式

- 每次只送「網站最新一筆打卡日期 − 3 天」之後的資料；伺服器依（機號、時間、機器編號）去重，重複送很安全。
- CSV 沒變動（大小與修改時間不變）就直接略過；`--force` 可強制重送。
- 結果在 `sync.log`；後台「教職員打卡管理 → 匯入與同步」也看得到每次匯入紀錄。
- 直接連機器時：只讀取，不清除、不修改機器上的資料（通訊程式在 `zk.mjs`）。每次讀全部紀錄，再只送最近幾天的部分。
  通訊密碼錯誤只會試一次就停，不會反覆嘗試。打卡機同一時間通常只接受一個連線，若 ZKTime 5 軟體正在連線，請錯開時間。
- 讀匯出檔時：打卡機軟體要「定期把資料匯出到 csvPath」，這支程式只負責讀檔與上傳。

## Mac / Linux

`crontab -e` 加一行：`30 21 * * * cd /路徑/clock-sync && node sync-clock.mjs >> cron.out 2>&1`
