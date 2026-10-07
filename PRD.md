# 📚 Booklist 產品需求規劃規格書 (Product Requirements Document) v1.0.2

> **專案代號**：Booklist (智慧購書決策查重與個人書籍資產管理系統)  
> **規格版本**：v1.0.2 (Final Engineering-Ready Spec — 規格凍結版)  
> **建立日期**：2026-10-07  
> **術語與實體標準**：嚴格遵循 [GLOSSARY.md](file:///C:/Users/etrny/.gemini/antigravity/scratch/Booklist/GLOSSARY.md) 與 [.agents/AGENTS.md](file:///C:/Users/etrny/.gemini/antigravity/scratch/Booklist/.agents/AGENTS.md)  
> **核心一句話定位**：**「Booklist：在你掏錢買書前，用 10 秒確認『我是不是已經有了？』」**  
> **核心架構原則**：**決策查重優先 (Duplicate-Check First)** × **職責分離 (COA-Parser Pattern)** × **標準版本/交易解耦 (Canonical Edition vs Purchase Instance)** × **排他鎖一致性寫入 (Lock-Protected Write with Compensating Rollback)**

---

## 1. 專案背景與核心定位 (Problem Statement)

### 1.1 使用者核心痛點
愛書人在書店實體選購、逛二手書店或滑線上電商時，經常面臨記憶模糊困境：「這本書我到底買過了沒有？」
- **重複購買同一本書**：買回家才發現書架上早有一模一樣的實體書，浪費金錢與收納空間。
- **重複跨媒介購買**：明明已經買了電子書，逛書店時又順手買了實體版；或是想收電子書，卻忘記是否已持有實體版。
- **買書現場極限時間壓力**：在書店現場若要手動打字輸入書名、ISBN、出版社，操作時間超過 1 分鐘，使用者會迅速放棄。系統必須在 **10 秒內** 給出明確「買 / 不買 / 考慮」決策。

### 1.2 產品定位與核心願景
**Booklist 是一套專為購書決策打造的極簡行動工具，在錯誤購買發生前精準介入：**
```text
想買書 ➔ 📸 單一拍照 ➔ 視覺文字提取 ➔ 權威元資料檢索 ➔ 五級查重階梯 ➔ 10秒決策 (買/不買/考慮/未知) ➔ 核簽入庫
```

### 1.3 產品非目標護欄 (Strict Non-Goals)
為確保系統極度聚焦於「買書前 10 秒防重複決策」，V1 **明確不做** 以下功能：
- ❌ **閱讀進度管理**：不記錄讀到第幾頁、閱讀計時或劃線筆記。
- ❌ **書評與評分**：不提供心得發表、星級評等或個人書評。
- ❌ **社群功能**：不支援好友追蹤、書籍借閱或書單分享。
- ❌ **推薦演算法**：不根據歷史書單推薦新書。
- ❌ **AI 摘要閱讀**：不生成全書章節大綱或導讀。
- ❌ **全書 OCR**：不掃描內文字句，僅擷取封面與條碼元資料。
- ❌ **複雜多帳號**：不做多使用者註冊登入與權限管理。
- ❌ **電商訂單爬蟲**：不自動同步博客來/Kobo 購物車。

---

## 2. 整體技術架構 (System Architecture)

系統完全摒棄肥大的伺服器架構，採用零主機費、極致輕量、隨開即用的無伺服器整合方案：

```text
               📱 行動裝置 (手機瀏覽器 PWA / RWD HTML)
                         │ (localStorage 自動夾帶 Token)
        ┌────────────────┴────────────────┐
        ▼ (情境 A: 唯一主入口 📸 拍照)   ▼ (情境 B: 次要 🔎 搜尋)
     📸 拍這本書查重 (封面或條碼皆可)     🔎 書名 / 作者 / ISBN
        └────────────────┬────────────────┘
                         │ (壓縮至 <500KB Base64 + app_token)
                         ▼
        ┌─────────────────────────────────────────────────┐
        │  Google Apps Script (GAS Web App 後端代理)      │
        │  • doGet()  : 提供手機前端 HTML 應用頁面        │
        │  • doPost() : Salted Hash 驗證 ➔ 辨識 ➔ 查重 ➔ 鎖入庫 │
        │  • Script Properties : 託管 API 金鑰與 Token Salt │
        └───────────────┬─────────────────┬───────────────┘
                        │                 │
            ┌───────────┴───┐         ┌───┴───────────┐
            ▼               ▼         ▼               ▼
      Gemini 2.5 Flash Google Books  五級決策階梯   Google Sheet
      (視覺文字擷取)  (權威元資料)  (決策+理由分析) (Books/Purchases)
```

### 2.1 資安與存取控制模型 (Private App Token)
針對 GAS Web App 公開部署之安全性，摒棄高風險之純匿名開放，採無 URL 洩漏之私人授權閘道：
1. **無 URL 洩漏原則 (No Query Token)**：
   - **嚴禁於 URL Query 帶入 Token（例如 `?token=xxx`）**，杜絕 Token 留在瀏覽器歷史紀錄、書籤、螢幕截圖、Referrer 或被不慎分享洩漏。
2. **首次授權與持久化流程**：
   - 使用者首次於手機瀏覽器開啟 Booklist 時，彈出輕量授權視窗：`🔐 請輸入您的私人 App Token`。
   - 前端發送驗證請求至 GAS 後端；GAS 透過加鹽雜湊 (Salted SHA-256) 與 `ScriptProperties` 中的雜湊值對比。
   - 驗證成功後，Token 儲存於手機 `localStorage`，後續所有操作自動帶入 POST Body。
3. **標準錯誤協定 (AUTH_FAILED)**：
   - 因 GAS Web App 無法自訂精細 HTTP Status Code，GAS 一律回傳標準 JSON：
     ```json
     {
       "success": false,
       "error": {
         "code": "AUTH_FAILED",
         "message": "Unauthorized: invalid or missing app token"
       }
     }
     ```
   - 前端收到 `AUTH_FAILED` 即清除 `localStorage` 並彈出重新授權對話框。
4. **金鑰完全隔離**：
   - Gemini API Key、Google Books API Key 與 Token Salt 嚴格封裝在 GAS `ScriptProperties`，前端無任何敏感憑證。

---

## 3. 核心靈魂：五級查重決策階梯 (Five-Tier Decision Ladder)

查重系統的核心產出不僅是相似度百分比，而是具備行動指引的 **決策建議四態 (`decision`)** 與 **結構化比對理由 (`reasons`)**：

```text
                                  傳入書籍資訊 (ISBN / 書名 / 作者)
                                                 │
                                                 ▼
        ┌─────────────────────────────────────────────────────────────────────────────────┐
        │ 【Level 1 — SAME EDITION】ISBN 完全相符                                         │
        │  比對標準化 ISBN-13 / ISBN-10                                                   │
        └────────────────────────────────────────┬────────────────────────────────────────┘
                                                 ├── [命中且持有中] ➔ 🔴 DO_NOT_BUY
                                                 ▼ [未命中]
        ┌─────────────────────────────────────────────────────────────────────────────────┐
        │ 【Level 2 — SAME WORK + SAME FORMAT】書名與作者相符 且 持有形式相同             │
        │  正規化去標點空格比對；確認已持有相同形式 (如實體書 vs 實體書)                  │
        └────────────────────────────────────────┬────────────────────────────────────────┘
                                                 ├── [命中且持有中] ➔ 🔴 DO_NOT_BUY
                                                 ▼ [未命中]
        ┌─────────────────────────────────────────────────────────────────────────────────┐
        │ 【Level 3 — SAME WORK + DIFFERENT FORMAT】書名與作者相符 但 持有形式不同        │
        │  正規化去標點空格比對；已持有實體書，但欲購電子書 (或反之)                      │
        └────────────────────────────────────────┬────────────────────────────────────────┘
                                                 ├── [命中且持有中] ➔ 🟡 CONSIDER
                                                 ▼ [未命中]
        ┌─────────────────────────────────────────────────────────────────────────────────┐
        │ 【Level 4 — POSSIBLE SAME WORK / DIFFERENT EDITION】主標題相似/疑似不同版本     │
        │  主標題相似度高、作者相同、ISBN 不同 (如「增訂版」、「紀念版」)                 │
        └────────────────────────────────────────┬────────────────────────────────────────┘
                                                 ├── [命中] ➔ 🟡 CONSIDER (守門規則 D1)
                                                 ▼ [未命中]
        ┌─────────────────────────────────────────────────────────────────────────────────┐
        │ 【Level 5 — NO MATCH】完全無命中                                                │
        └────────────────────────────────────────┬────────────────────────────────────────┘
                                                 └── 🟢 SAFE_TO_BUY
                                                 
        ┌─────────────────────────────────────────────────────────────────────────────────┐
        │ 【異常安全降級 — UNKNOWN】網路超時 / 服務無法回應 (守門規則 D2)                 │
        └─────────────────────────────────────────────────────────────────────────────────┘
                                                 └── ⚪ UNKNOWN (不可視為未購買)
```

### 3.1 決策矩陣與狀態定義

> **持有判斷鐵律**：系統**嚴格只將 `Purchases.status === 'ACTIVE'` 視為目前持有**。若歷史交易已標記為 `SOLD`、`GIFTED` 或 `DISCARDED`，持有狀態歸類為 `PREVIOUSLY_OWNED`，決策給予 `CONSIDER` 並附帶歷史紀錄說明。

| 階梯級別 | 判定條件 | 決策狀態 (`decision`) | 持有狀態 (`ownership_status`) | 比對類型 (`match_type`) | 結構化理由 (`reasons`) 範例 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Level 1** | ISBN-13 或 ISBN-10 完全相同，且持有中 | `DO_NOT_BUY` | `CURRENTLY_OWNED` | `SAME_EDITION` | `["ISBN 完全吻合", "目前持有同版本實體書"]` |
| **Level 2** | 正規化書名與作者相同，且持有同形式 (ACTIVE) | `DO_NOT_BUY` | `CURRENTLY_OWNED` | `SAME_WORK_SAME_FORMAT` | `["書名與作者完全一致", "已持有同媒介形式 (實體書)"]` |
| **Level 3** | 正規化書名與作者相同，但持有不同形式 (ACTIVE) | `CONSIDER` | `OWNED_OTHER_FORMAT` | `SAME_WORK_DIFF_FORMAT` | `["書名與作者完全一致", "目前已持有實體書，尚未持有電子版"]` |
| **歷史交易** | 書名或 ISBN 命中，但持有狀態非 ACTIVE | `CONSIDER` | `PREVIOUSLY_OWNED` | `SAME_EDITION` / `SAME_WORK_SAME_FORMAT` | `["曾於 2023/05 購買但標記已售出，目前未持有"]` |
| **Level 4** | 主標題高度相似、作者相同，ISBN 不同 | `CONSIDER` | `SUSPECTED` | `POSSIBLE_SAME_WORK` | `["書名主幹相似 (91%)", "作者相同", "ISBN不同，疑似為增訂版"]` |
| **Level 5** | 五級比對皆無任何相符記錄 | `SAFE_TO_BUY` | `NOT_OWNED` | `NO_MATCH` | `["書庫中無此書紀錄，可放心選購"]` |
| **異常降級** | 網路中斷、Gemini 或 Google Books 超時 | `UNKNOWN` | `NOT_OWNED` | `ERROR_UNAVAILABLE` | `["網路超時或辨識服務未回應，暫時無法完成查重"]` |

### 3.2 決策不變性守門規則 (Decision Invariants)
- **Invariant D1 (模糊比對安全護欄)**：
  **任何 `POSSIBLE_SAME_WORK`、`FUZZY_SIMILARITY` 或改版疑慮，永遠不得直接輸出 `DO_NOT_BUY`，只能輸出 `CONSIDER`。** AI 負責提示可能性，決策權歸還給使用者。
- **Invariant D2 (異常不可誤導安全降級)**：
  **當外部 API 逾時、連線中斷或服務異常時，系統必須輸出 `UNKNOWN`，嚴禁自動降級為 `SAFE_TO_BUY`。** 介面必須給予強烈警示：「⚠️ 暫時無法完成查重，請勿將此結果視為『未購買』！」。

---

## 4. 職責分離：COA-Parser 模式 (Extraction vs Authority)

延續實驗室檢驗報告 `COA-parser` 架構原則：**AI 負責提取事實文字，權威 API 負責中繼資料**。

| 處理階段 | 負責模組 | 執行任務與產出 |
| :--- | :--- | :--- |
| **1. 視覺文字擷取** | **Gemini 2.5 Flash** | 接收手機壓縮照片，自動判斷條碼或封面：提取 `raw_isbn` 或 `raw_title`、`raw_author`、`raw_publisher`。**嚴禁憑空編造元資料**。 |
| **2. 權威元資料檢索**| **Google Books API** | 優先以提取之 ISBN 查詢；若無 ISBN 則以書名+作者檢索。取得官方出版元資料：標準書名、副標題、作者列表、正式出版社、出版年月、官方 ISBN-13、高解析度封面縮圖 URL。 |
| **3. 五級查重階梯** | **GAS 查重引擎** | 執行階梯比對，結合 `Purchases.status` 與形式比對，輸出四態決策與理由。 |
| **4. 人工審計核簽**| **使用者 (人機迴圈)** | 檢視辨識成果與建議，確認/微調購買形式（實體/電子）、通路與價格，點擊入庫。 |
| **5. 排他一致寫入** | **GAS LockService** | 執行排他鎖保護之雙表寫入，具備補償回滾機制。 |

---

## 5. 資料模型設計：標準版本與交易實體解耦 (Canonical Edition vs Purchase Instance)

V1 堅持解決「我買過沒有」的核心痛點，不引入過度複雜的三張表（Work - Edition - Purchase），而是採用 **兩表精準解耦**：
- **`Books` = 標準書目版本 (Canonical Book Edition)**：可被 ISBN 或 Google Books 唯一識別的出版版本本體（一版本一列）。
- **`Purchases` = 購買交易與持有實體 (Purchase Instance)**：使用者每一次實際取得的載具、交易與持有狀態（一版本可有多筆購買）。

### 5.1 工作表一：`Books` (標準書目版本檔)
| 欄位名稱 (Header) | 欄位代碼 | 型別 | 說明與範例 |
| :--- | :--- | :--- | :--- |
| 書籍識別碼 | `book_id` | String | 唯一識別碼，格式：`BK-20261007-001` |
| 正書名 | `title` | String | 版本正式書名 (如: `原子習慣`) |
| 副標題 | `subtitle` | String | (選填) 如: `細微改變帶來巨大成就的實證法則` |
| 作者 | `author` | String | 如: `James Clear` |
| 譯者 | `translator` | String | (選填) 如: `蔡世偉` |
| ISBN-13 | `isbn_13` | String | 標準化 13 碼無符號字串，如: `9789861755261` |
| ISBN-10 | `isbn_10` | String | (選填) 標準化 10 碼無符號字串 |
| 出版社 | `publisher` | String | 如: `方智` |
| 出版日期 | `publication_date` | String | `2019-06-01` |
| 語言 | `language` | String | 預設 `繁體中文` |
| 封面圖片 | `cover_url` | String | Google Books 官方封面圖片網址 |
| Google Books ID | `google_books_id`| String | 如: `4u_wDwAAQBAJ` |
| 建立時間 | `created_at` | Timestamp | ISO 8601 時間戳 |

### 5.2 工作表二：`Purchases` (購買交易與持有紀錄檔)
| 欄位名稱 (Header) | 欄位代碼 | 型別 | 說明與範例 |
| :--- | :--- | :--- | :--- |
| 購買識別碼 | `purchase_id` | String | 唯一識別碼，格式：`PC-20261007-001` |
| 書籍版本識別碼 (外鍵) | `book_id` | String | 關聯至 `Books.book_id` |
| 購買日期 | `purchase_date` | Date | `2026-10-07` (預設今日) |
| 購買通路 | `channel` | String | 下拉標籤：`博客來`、`誠品`、`Kobo`、`Readmoo`、`實體書店` |
| 書籍形式 | `format` | Enum | `PHYSICAL` (實體書)、`EBOOK` (電子書)、`AUDIOBOOK` (有聲書) |
| 購買價格 | `price` | Number | 實付金額，如: `320` |
| 幣別 | `currency` | String | 預設 `TWD` |
| 持有狀態 | `status` | Enum | `ACTIVE` (持有中)、`SOLD` (已售)、`GIFTED` (已贈送)、`DISCARDED` (已淘汰) |
| 版本備註 | `edition_note` | String | (選填) 如: `全新增訂版`、`平裝初版` |
| 存放位置/載具 | `location` | String | (選填) 如: `客廳書架二層`、`Kobo Clara` |
| 備註說明 | `notes` | String | (選填) 如: `雙11特價購入` |
| 資料來源血統 | `provenance` | String | JSON 字串記錄資料來源 (`{"meta":"GOOGLE_BOOKS","price":"USER"}`) |
| 建立時間 | `created_at` | Timestamp | 系統自動產生 |

### 5.3 工作表三：`Settings` (系統字典與設定)
包含全域設定鍵值對：
- `BOOKLIST_APP_TOKEN_HASH`：安全 Token 雜湊 (Salted SHA-256)
- `BOOKLIST_TOKEN_SALT`：雜湊安全鹽值
- `CHANNEL_OPTIONS`：`博客來,誠品,Kobo,Readmoo,讀冊,三民,實體書店,二手書店`
- `FORMAT_OPTIONS`：`PHYSICAL,EBOOK,AUDIOBOOK`
- `DEFAULT_CURRENCY`：`TWD`
- `SIMILARITY_THRESHOLD`：`0.85`

---

## 6. 手機極簡使用者體驗與介面設計 (Mobile-First UX / UI)

本產品為高頻決策工具，而非展示型儀表板。介面極致聚焦於 **「掏出手機 ➔ 10 秒取得購買決策」**：

### 6.1 極簡工具首頁 (Focused Tool Home)
```text
┌──────────────────────────────────────┐
│ 📚 Booklist                          │
│                                      │
│ 🔎 輸入書名、作者或 ISBN...           │
│                                      │
│                                      │
│              ┌────────┐              │
│              │   📸   │              │
│              │拍書查重│              │
│              └────────┘              │
│       (唯一主入口，拍封面或條碼皆可) │
│                                      │
│                                      │
│ 🟢 今日查重 3 次  │ 📚 書庫 1,283 本 │
├──────────────────────────────────────┤
│ 🏠 首頁          ➕ 新增       📚 書庫 │
└──────────────────────────────────────┘
```
- **唯一核心主入口**：超大按鈕 **【 📸 拍這本書查重 】**。
  - 使用 `<input type="file" accept="image/*" capture="environment">` 直接喚起後置相機。
  - **自動分流**：Gemini 自動偵測相片內是否有條碼。有條碼優先提取 ISBN，無條碼提取書名作者。
  - 僅在照片模糊嚴重無法提取任何有效資訊時，才提示：「無法辨識，是否改拍條碼或手動搜尋？」。
- **快速搜尋欄**：支援手動輸入關鍵字或 ISBN 進行純文字快查。
- **次要統計摘要**：僅在底部弱化顯示「今日查重次數」與「書庫總量」，不干擾主流程。

### 6.2 查重決策卡片 (Decision-First Card)
拍攝上傳後，立即彈出全螢幕決策卡片：
- 🔴 **【不建議購買 DO_NOT_BUY】**（紅底粗體標題）：
  - 醒目標題：**🚫 您已持有此書！**
  - 比對理由：`• ISBN 完全相符`、`• 目前持有實體版 (2025/08/12 博客來 $320)`
  - 行動按鈕：`[ 查看書庫紀錄 ]`、`[ 關閉/重查 ]`
- 🟡 **【請審慎考慮 CONSIDER】**（黃底警示標題）：
  - 醒目標題：**⚠️ 發現相似版本或不同媒介形式**
  - 比對理由：
    - 狀況 A：`• 您已持有實體書，但尚未購買電子版` ➔ 提示若需隨身閱讀可考慮購買。
    - 狀況 B：`• 書名相似度 91%，作者相同，ISBN 不同，疑似為增訂版` ➔ 提示確認是否重複內容。
    - 狀況 C：`• 曾於 2023/05 購買但標記已售出，目前未持有` ➔ 提示曾買過但已不在書架上。
  - 行動按鈕：`[ 堅持購買入庫 ]`、`[ 放棄購買 ]`
- 🟢 **【可放心購買 SAFE_TO_BUY】**（綠底安心標題）：
  - 醒目標題：**✅ 書庫無此書，可放心選購！**
  - 官方書籍卡片：封面圖、正式書名、作者、出版社。
  - 快速登記按鈕：`[ 🛒 登記購入此書 ]`
- ⚪ **【無法完成查重 UNKNOWN】**（深灰底警示標題）：
  - 醒目標題：**⚠️ 暫時無法完成查重**
  - 比對理由：`• 網路連線逾時或辨識服務未回應`、`• 請勿將此結果視為「未購買」！`
  - 行動按鈕：`[ 重新拍攝 ]`、`[ 手動搜尋查重 ]`

### 6.3 快速登記表單 (Quick Purchase Form)
點擊登記後預填所有書籍資料，使用者僅需在手機上點按 3 個欄位即可完成：
1. `形式`：按鈕切換（`📘 實體書` / `📱 電子書`）。
2. `通路`：快捷 Chip（`博客來` / `誠品` / `Kobo` / `實體店`）。
3. `價格`：數字鍵盤填寫實付金額（如 `320`）。
4. 點擊 **【 💾 儲存並寫入書庫 】**。

---

## 7. 安全不變性守則 (Invariants & Protocols)

### 7.1 B1：排他鎖保護的雙表一致性寫入 (Lock-Protected Write with Compensating Rollback)
Google Sheet 無法提供 SQL 級別的資料庫 Transaction，為確保多請求並行時雙表資料一致性，儲存流程強制執行：
```text
取得 Script Lock (10秒等待) 
   ↓
鎖內完整五級查重 (防止並行寫入重複)
   ↓
寫入 Books (若既有書目已存在則複用 book_id)
   ↓
寫入 Purchases (以 book_id 建立交易關聯)
   ↓
[若寫入 Purchase 失敗] ➔ 補償回滾清除孤兒 Book ➔ 回傳 WRITE_FAILED
   ↓
兩表寫入成功 ➔ Release Lock
```
- **GAS 後端控制原型**：
```javascript
function saveBookWithPurchase(token, bookData, purchaseData) {
  validateToken(token); // 驗證失敗直接丟出 AUTH_FAILED
  const lock = LockService.getScriptLock();
  let createdBookId = null;
  let isNewBook = false;
  
  try {
    lock.waitLock(10000); // 最多等待 10 秒
    
    // 鎖內重新查重
    const recheckResult = executeDecisionLadder(bookData);
    if (recheckResult.decision === 'DO_NOT_BUY') {
      return { success: false, error: { code: 'DUPLICATE_DETECTED', message: '該書已存在於書庫中！' } };
    }
    
    // 步驟 1: 寫入或取得既有 Book
    const bookResult = getOrCreateBook(bookData);
    createdBookId = bookResult.book_id;
    isNewBook = bookResult.is_new;
    
    // 步驟 2: 寫入 Purchase
    try {
      insertPurchase(createdBookId, purchaseData);
    } catch (purchaseError) {
      // 補償性回滾：若為剛建立的新書，將孤兒 Book 刪除以保一致性
      if (isNewBook) {
        deleteBookRow(createdBookId);
      }
      throw new Error('PURCHASE_WRITE_FAILED');
    }
    
    return { success: true, data: { book_id: createdBookId } };
  } catch (err) {
    return { success: false, error: { code: 'WRITE_FAILED', message: err.message } };
  } finally {
    lock.releaseLock();
  }
}
```

### 7.2 B2：相機圖片前端壓縮與流量控制
- 手機原圖動態壓縮：利用前端 HTML5 Canvas，將照片長邊等比例縮放至最高 `1200px`，JPEG 品質設定為 `0.8`。
- 上傳體積目標：壓縮後 Base64 字串控制在 **500KB 以內**，大幅降低行動網路傳輸延遲與 GAS 記憶體消耗。

### 7.3 B3：資料血統記錄 (Provenance)
每筆儲存紀錄皆附加資料來源追溯資訊，例如：
`provenance: {"meta_source":"GOOGLE_BOOKS","ocr_confidence":0.95,"input_by":"USER"}`。

---

## 8. 開發藍圖與端到端驗收指標 (Roadmap & Acceptance Benchmarks)

### 8.1 端到端決策延遲指標 (End-to-End Decision Latency)
以使用者真實體驗為唯一評估基準，端到端時間拆解為：
```text
T0 (按下拍照) ➔ T1 (前端 Canvas 壓縮完成) ➔ T2 (GAS 接收請求) ➔ T3 (Gemini 文字擷取回傳) 
   ➔ T4 (Google Books 元資料回傳) ➔ T5 (Sheet 查重與決策產出) ➔ T6 (前端 Decision Card 顯示)
```
- **核心 KPI**：`Decision Latency = T6 - T0`。
- **驗收目標值**：在一般 4G/5G 行動網路下，**P50 < 3 秒，P95 < 6 秒**。

### 8.2 實體圖書實測驗收門檻 (Real-World Acceptance Test)
本系統之最終交付驗收條件**非單純代碼通過**，而是以 **20 本實體測試書籍在實體環境現場拍照驗證**：
1. **10 本已購同版本書**：100% 正確命中 Level 1，10 秒內顯示 🔴 `DO_NOT_BUY`。
2. **3 本已購實體但欲查電子書**：100% 正確命中 Level 3，顯示 🟡 `CONSIDER`（持有實體、無電子版）。
3. **2 本增訂版/副標題改版書**：100% 正確命中 Level 4，顯示 🟡 `CONSIDER`（不產生誤判一刀切）。
4. **5 本未購新書**：100% 正確命中 Level 5，顯示 🟢 `SAFE_TO_BUY` 並帶出官方封面與中繼資料。
5. **模擬斷網與超時**：正確安全降級至 ⚪ `UNKNOWN`，明確警示不得視為未購買。

---

## 9. 工程實作補丁附錄 (Engineering Addendum v1.0.2-ADDENDUM)

> 本附錄為工程實作前置補丁，收斂代碼開發之最後 6 個關鍵細節，由 AI 開發 Agent 嚴格執行：

### 9.1 補丁一：請求冪等性協議 (Idempotency Key Protocol)
- **問題防範**：防止使用者在網路延遲時重複點擊儲存，或後端已寫入 Sheet 但回傳逾時引發的前端重試，導致重複插入購買紀錄。
- **實作規範**：
  1. 前端在發起儲存請求時，使用標準 `crypto.randomUUID()` 產生 `request_id`。
  2. `Purchases` 表新增第 3 欄 `request_id`。
  3. GAS 在取得 `ScriptLock` 後，首先掃描 `Purchases.request_id`：
     - 若已存在該 `request_id`，直接回傳歷史成功資料與 `{ code: "IDEMPOTENCY_REPLAY" }`，不重複寫入。
     - 若不存在，才推進雙表一致性寫入流程。

### 9.2 補丁二：API 統一行包與標準錯誤碼 (Envelope & Error Protocol)
所有 GAS Web App 之 API 回應一律統一為以下結構：
```typescript
// 成功
{
  "success": true,
  "request_id": "REQ-...",
  "data": { ... },
  "error": null
}

// 失敗
{
  "success": false,
  "request_id": "REQ-...",
  "data": null,
  "error": {
    "code": "AUTH_FAILED" | "INVALID_REQUEST" | "INVALID_ISBN" | "BOOK_NOT_FOUND" | "METADATA_UNAVAILABLE" | "DUPLICATE_DETECTED" | "UNKNOWN" | "LOCK_TIMEOUT" | "WRITE_FAILED" | "IDEMPOTENCY_REPLAY",
    "message": "人類可讀之具體錯誤描述"
  }
}
```

### 9.3 補丁三：書名與作者之語言與形式分流矩陣 (Language & Format Matrix)
書名與作者完全相符僅能視為「高信心作品候選 (High-Confidence Work Candidate)」，必須結合語言與形式進行二階分流：
| 書名與作者 | 語言 (Language) | 持有形式 (Format) | 判定結果 (Decision) | 觀察類型 (Match Type) |
| :--- | :--- | :--- | :--- | :--- |
| 完全相同 | 相同 (如繁中 vs 繁中) | 相同形式 (ACTIVE) | 🔴 `DO_NOT_BUY` | `TITLE_AUTHOR_EXACT` |
| 完全相同 | 相同 (如繁中 vs 繁中) | 不同形式 (如實體 vs 電子) | 🟡 `CONSIDER` | `TITLE_AUTHOR_EXACT` |
| 完全相同 | 不同 (如英文原版 vs 中文譯本) | 任意形式 | 🟡 `CONSIDER` | `TITLE_AUTHOR_LANG_DIFF` |
| 主標題高相似度 (≥0.85) | 相同 | 任意形式 | 🟡 `CONSIDER` | `FUZZY_TITLE_AUTHOR` |

### 9.4 補丁四：條碼優先機器解析 (Deterministic Barcode First)
- **原則**：條碼是機器視覺可確定性解決的問題，嚴禁無差別呼叫 Gemini 浪費 Token 與增加延遲。
- **流程**：
  1. 手機拍下照片後，前端優先呼叫瀏覽器原生 `BarcodeDetector.detect()`（若不支援則使用輕量 ZXing 模組）。
  2. 若成功解出 EAN-13 (ISBN)，直接帶 ISBN 進入查重，**跳過 Gemini Vision 呼叫**。
  3. 僅在條碼解析失敗或拍封面無條碼時，才上傳圖片呼叫 Gemini 2.5 Flash 進行多模態文字擷取。

### 9.5 補丁五：Google Books 解耦為事後豐富化 (Metadata Enrichment)
- **原則**：核心查重路徑直接以 ISBN 查 Sheet，不把 Google Books 當作決策的前置阻塞依賴。
- **快路徑 (Fast-Path Decision)**：
  - 若已解出 ISBN，優先以 ISBN 查詢 Google Sheet。
  - 若命中既有藏書且目前持有中，**立即輸出 🔴 `DO_NOT_BUY` 決策**，耗時縮小至 1 秒內。
  - Google Books API 僅在判定為未持有或需補齊封面、官方中繼資料時非同步呼叫，作為「Metadata Enrichment」。

### 9.6 補丁六：機密與業務設定嚴格邊界隔離 (Secret Isolation)
- **GAS Script Properties**：專屬存放機密金鑰，嚴禁出現在任何 Sheet 中：
  - `GEMINI_API_KEY`、`GOOGLE_BOOKS_API_KEY`、`BOOKLIST_APP_TOKEN_HASH`、`BOOKLIST_TOKEN_SALT`、`SPREADSHEET_ID`。
- **Google Sheet `Settings` 工作表**：僅開放存放無資安疑慮之純業務字典：
  - `CHANNEL_OPTIONS`、`FORMAT_OPTIONS`、`DEFAULT_CURRENCY`、`SIMILARITY_THRESHOLD`。

