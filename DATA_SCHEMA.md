# 🗄️ Booklist 資料庫架構與表格規範 (Data Schema Specification) v1.0.2

> 本規範嚴格定義 Google Sheet 作為關聯資料庫之工作表結構、欄位型別、外鍵關聯與安全設定。  
> 遵循 [GLOSSARY.md](file:///C:/Users/etrny/.gemini/antigravity/scratch/Booklist/GLOSSARY.md) 與 [PRD.md](file:///C:/Users/etrny/.gemini/antigravity/scratch/Booklist/PRD.md)。

---

## 1. 資料庫實體與邊界劃分 (Entity & Storage Architecture)

系統由兩層儲存構成：
1. **Google Sheet 工作表**：公開承載結構化資料（`Books`、`Purchases`、`Settings`）。
2. **GAS Script Properties**：安全隔離託管所有敏感憑證與加密鹽值。

---

## 2. 工作表一：`Books` (標準書目版本檔 Canonical Edition)

記錄可被 ISBN 或 Google Books 唯一識別之標準出版版本。每一列代表一個具體出版版本。

| 欄位 (Col) | 標頭名稱 (Header) | 欄位代碼 (Field ID) | 資料型別 | 必填 | 格式與範例 | 說明與約束 |
| :---: | :--- | :--- | :---: | :---: | :--- | :--- |
| **A** | 書籍識別碼 | `book_id` | String | 是 | `BK-20261007-001` | 主鍵 (Primary Key)，格式 `BK-YYYYMMDD-序號` |
| **B** | 正書名 | `title` | String | 是 | `原子習慣` | 出版正式正書名 |
| **C** | 副標題 | `subtitle` | String | 否 | `細微改變帶來巨大成就的實證法則` | 完整副書名 |
| **D** | 作者 | `author` | String | 是 | `James Clear` | 主要作者，多位時以逗號分隔 |
| **E** | 譯者 | `translator` | String | 否 | `蔡世偉` | 主要譯者 |
| **F** | ISBN-13 | `isbn_13` | String | 否 | `9789861755261` | 標準化 13 碼無破折號數字字串 (唯一索引比對) |
| **G** | ISBN-10 | `isbn_10` | String | 否 | `9861755269` | 標準化 10 碼無破折號字串 |
| **H** | 出版社 | `publisher` | String | 否 | `方智` | 正式出版機構名稱 |
| **I** | 出版日期 | `publication_date` | String | 否 | `2019-06-01` | `YYYY-MM-DD` 或 `YYYY-MM` |
| **J** | 語言 | `language` | String | 是 | `繁體中文` | 預設 `繁體中文` |
| **K** | 封面圖網址 | `cover_url` | String | 否 | `https://books.google.com/...` | Google Books 提供之官方高解析封面網址 |
| **L** | Google Books ID | `google_books_id` | String | 否 | `4u_wDwAAQBAJ` | Google Books Volume ID |
| **M** | 建立時間 | `created_at` | Timestamp | 是 | `2026-10-07T12:00:00Z` | ISO 8601 時間戳 |
| **N** | 最後更新 | `updated_at` | Timestamp | 是 | `2026-10-07T12:00:00Z` | ISO 8601 時間戳 |

---

## 3. 工作表二：`Purchases` (購買交易與持有實體 Purchase Instance)

記錄每一次實際發生的交易與持有載具。一筆 `Books` 可關聯多筆 `Purchases`。

| 欄位 (Col) | 標頭名稱 (Header) | 欄位代碼 (Field ID) | 資料型別 | 必填 | 格式與範例 | 說明與約束 |
| :---: | :--- | :--- | :---: | :---: | :--- | :--- |
| **A** | 購買識別碼 | `purchase_id` | String | 是 | `PC-20261007-001` | 主鍵 (Primary Key)，格式 `PC-YYYYMMDD-序號` |
| **B** | 書籍版本識別碼 | `book_id` | String | 是 | `BK-20261007-001` | 外鍵 (Foreign Key)，必須存在於 `Books.book_id` |
| **C** | 請求冪等識別碼 | `request_id` | String | 是 | `c7325048-2c09-42f7-876a-...` | 前端 UUID v4，唯一約束，防重入庫守衛 |
| **D** | 購買日期 | `purchase_date` | Date | 是 | `2026-10-07` | 格式 `YYYY-MM-DD`，預設為寫入當天 |
| **E** | 購買通路 | `channel` | String | 是 | `博客來` | 下拉清單：`博客來`、`誠品`、`Kobo`、`實體書店` 等 |
| **F** | 書籍形式 | `format` | Enum | 是 | `PHYSICAL` | 枚舉：`PHYSICAL` (實體書)、`EBOOK` (電子書)、`AUDIOBOOK` (有聲書) |
| **G** | 實付金額 | `price` | Number | 是 | `320` | 數值型別，無千分號 |
| **H** | 幣別 | `currency` | String | 是 | `TWD` | 預設 `TWD` |
| **I** | 持有狀態 | `status` | Enum | 是 | `ACTIVE` | 枚舉：`ACTIVE` (持有中)、`SOLD` (已售)、`GIFTED` (已贈送)、`DISCARDED` (已淘汰)。**只有 ACTIVE 算目前持有** |
| **J** | 版本備註 | `edition_note` | String | 否 | `全新增訂版` | 具體版本或裝訂註記 |
| **K** | 存放位置/載具 | `location` | String | 否 | `客廳書架二層` | 實體擺放位置或電子書閱讀器裝置代號 |
| **L** | 備註說明 | `notes` | String | 否 | `雙11優惠購入` | 自由文字備註 |
| **M** | 資料來源血統 | `provenance` | String | 是 | `{"meta":"GOOGLE_BOOKS","price":"USER"}` | JSON 字串，標註中繼資料與價格來源出處 |
| **N** | 建立時間 | `created_at` | Timestamp | 是 | `2026-10-07T12:00:00Z` | ISO 8601 時間戳 |

---

## 4. 工作表三：`Settings` (業務字典設定表)

僅存放無資安疑慮之下拉選單字典與業務參數。**嚴禁存放 API Key 或 Token 雜湊值**。

| 欄位 (Col) | 標頭名稱 (Header) | 欄位代碼 (Field ID) | 範例值 | 說明 |
| :---: | :--- | :--- | :--- | :--- |
| **A** | 設定鍵值 | `key` | `CHANNEL_OPTIONS` | 參數鍵名 |
| **B** | 設定內容 | `value` | `博客來,誠品,Kobo,Readmoo,讀冊,三民,實體書店,二手書店` | 以逗號分隔之清單或數值 |
| **C** | 說明備註 | `description` | `前端購書通路下拉選項` | 說明文字 |

### 預設資料列 (Initial Seed Rows)
```csv
key,value,description
CHANNEL_OPTIONS,"博客來,誠品,Kobo,Readmoo,讀冊,三民,實體書店,二手書店","前端購書通路快捷選單"
FORMAT_OPTIONS,"PHYSICAL,EBOOK,AUDIOBOOK","書籍存在形式選項"
DEFAULT_CURRENCY,"TWD","預設記帳幣別"
SIMILARITY_THRESHOLD,"0.85","模糊比對提示門檻"
```

---

## 5. GAS Script Properties (機密金鑰環境變數)

透過 GAS 編輯器之 `專案設定 ➔ 指令碼屬性 (Script Properties)` 進行設定：

| 屬性名稱 (Key) | 範例值 | 說明 |
| :--- | :--- | :--- |
| `GEMINI_API_KEY` | `AIzaSyD-xxxxxxxxxxxxxx` | Google Gemini API 金鑰 (用於 Vision OCR) |
| `GOOGLE_BOOKS_API_KEY` | `AIzaSyB-yyyyyyyyyyyyyy` | Google Books API 檢索金鑰 |
| `BOOKLIST_APP_TOKEN_HASH` | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` | 私人 App Token 經 Salt 加鹽後的 SHA-256 雜湊字串 |
| `BOOKLIST_TOKEN_SALT` | `8f9c2d1e-random-salt-string` | 隨機安全鹽值 (Salt) |
| `SPREADSHEET_ID` | `1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms` | 綁定之 Google Sheet 試算表 ID |

---

## 6. 資料庫存取與查詢效能策略 (Performance & Access Patterns)

1. **查重快取 (In-Memory Map)**：
   - 查重請求進入後，GAS 一次性讀取 `Books` 表與 `Purchases` 表之有效欄位至記憶體，轉為 JavaScript Object / Map 進行記憶體中 O(1) 匹配，避免逐行發起 Google Sheet API 請求。
2. **唯一性排他鎖 (`LockService.getScriptLock`)**：
   - 入庫前取得 10 秒排他鎖，鎖內重新確認 ISBN 與 `request_id` 唯一性，避免並行並發重複寫入。
3. **原子追加寫入 (`appendRow`)**：
   - 寫入 `Books` 與 `Purchases` 採用 `sheet.appendRow()`，並於 Purchase 失敗時執行補償性刪除列 (Compensating Rollback)。
