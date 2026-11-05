# 文件資料夾

| 檔案 | 用途 |
|---|---|
| `校務行政系統操作說明.md` | **操作說明的原始檔**（所有版本都由它產生；要修改內容請改這份） |
| `校務行政系統操作說明.docx` | Word 版，可再編輯、列印 |
| `校務行政系統操作說明.pdf` | PDF 版，方便分發與手機閱讀 |
| `校務行政系統DM.pdf` | **DM 宣傳單**，A4 正反兩頁，可直接列印（含兩組 QR 碼） |
| `校務行政系統DM.html` | DM 的可編輯原始檔（用瀏覽器開啟、改文字、再列印成 PDF） |
| `校務行政系統DM.md` | DM 的文字版，方便貼到 LINE、Facebook 或公告 |

競賽活動的詳細步驟在專案根目錄的 `競賽系統操作說明.md`。

## 重新產生

修改內容後，在專案根目錄執行（需要 Python、Node.js 與 Windows 內建的 Microsoft Edge）：

```bash
pip install python-docx markdown
python -X utf8 tools/docs-build/md2docx.py docs/校務行政系統操作說明.md docs/校務行政系統操作說明.docx "全校教職員・家長・學生使用手冊"
python -X utf8 tools/docs-build/md2pdf.py docs/校務行政系統操作說明.md docs/校務行政系統操作說明.pdf "華雲學校 校務行政系統 操作說明" "全校教職員・家長・學生使用手冊"
python -X utf8 tools/docs-build/build_dm.py
```

DM 的網址預設是目前正式站；換網址時：`SITE_URL=https://新網址 python -X utf8 tools/docs-build/build_dm.py`（QR 碼會一起更新）。

## 注意

- 這些文件依系統 **2026 年 11 月**的版本整理。系統功能或畫面文字更新後，請同步修改 `校務行政系統操作說明.md` 並重新產生。
- 各文件裡的功能名稱，來自系統畫面上實際的按鈕與標題；描述的流程若與實際畫面不同，以系統畫面為準，並請回報修正。
