# 📚 Booklist — 智慧購書決策查重與個人書籍資產管理系統

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Version](https://img.shields.io/badge/Version-v1.0.2-blue.svg)](https://github.com/etrnya/Booklist)
[![Mobile PWA](https://img.shields.io/badge/Platform-Mobile%20PWA%20%2F%20RWD-green.svg)](https://etrnya.github.io/Booklist/)
[![Database](https://img.shields.io/badge/Database-Notion%20Bookshelf-black.svg)](https://notion.so)
[![Resolver](https://img.shields.io/badge/Resolver-google--books--tw--mcp%20v1.2.0-blue.svg)](https://github.com/etrnya/google-books-tw-mcp)
[![Target](https://img.shields.io/badge/Target-Taiwan%20Traditional%20Chinese-orange.svg)](https://github.com/etrnya/Booklist)

> 💡 **核心一句話定位**：**「Booklist：在你掏錢買書前，用 10 秒確認『我是不是已經有了？』並將購書資產自動同步至 Notion 我的書櫃！」**

---

## 🎯 痛點與核心願景 (Problem Statement)

愛書人在書店實體選購、逛二手書店或滑線上電商時，常面臨記憶模糊困境：「這本書我到底買過了沒有？」
- **重複購買同一本書**：買回家才發現書架上早有一模一樣的實體書，浪費金錢與收納空間。
- **重複跨媒介購買**：明明已經買了電子書，逛書店時又順手買了實體版；或是想收電子書，卻忘記是否已持有實體版。
- **買書現場時間極限**：在書店現場若手動輸入書名、ISBN 超過 1 分鐘就會放棄。系統必須在 **10 秒內** 給出明確「買 / 不買 / 考慮」決策。
- **手動記錄書庫繁瑣**：在 Notion 手動建書、找封面與填寫出版社極為費時。

```text
想買書 ➔ 📸 拍照或書名 ➔ google-books-tw-mcp 解析臺灣書目與高解析書封 ➔ 五級查重階梯 (比對 Notion) ➔ 10秒決策 (買/不買/考慮) ➔ 一鍵自動匯入 Notion 我的書櫃
```

---

## 🏛️ 系統整體架構 (System Architecture)

以 **Notion「我的書櫃」** 為單一真實資料來源 (Single Source of Truth)，並整合專用繁中書目解析服務 **`google-books-tw-mcp`**：

```text
               📱 行動裝置 / 桌面瀏覽器 (PWA / RWD)
                         │ (http://localhost:3000)
        ┌────────────────┴────────────────┐
        ▼ (情境 A: 📸 拍照或掃描條碼)     ▼ (情境 B: 🔎 輸入書名 / ISBN)
     📸 拍這本書查重 (封面或條碼皆可)     🔎 輸入書名 / 作者 / ISBN
        └────────────────┬────────────────┘
                         │
                         ▼
        ┌────────────────────────────────────────────────────────┐
        │             Booklist Local Server (server.py)          │
        │  • /api/search  : 搜尋臺灣繁體出版品清單               │
        │  • /api/resolve : 一站式解析出版版本與高解析書封       │
        │  • /api/check   : 五級決策階梯評估 (比對 Notion 書櫃) │
        │  • /api/save    : 自動將新書、封面與中繼資料寫入 Notion│
        │  • /api/batch_enrich : 一鍵掃描補全 Notion 現有書籍   │
        └───────────────┬────────────────────────┬───────────────┘
                        │                        │
                        ▼                        ▼
        ┌───────────────────────────────┐ ┌─────────────────────────┐
        │     google-books-tw-mcp       │ │    Notion「我的書櫃」   │
        │ (Taiwan Book Metadata Resolver│ │  (Database ID: 45ff2f17)│
        │  • ISBN-10/13 Checksum 驗證   │ │  • Name (書名)          │
        │  • Google Books 繁中精確提取  │ │  • 書封 (檔案與 Page 封面)
        │  • 臺灣三民/天瓏 CDN 書封備援 │ │  • ISBN, 作者, 出版社   │
        │  • 結構化 Fact Layer 輸出)    │ │  • 形式, 狀態, 購買日期 │
        └───────────────────────────────┘ └─────────────────────────┘
```

---

## ✨ 六大核心亮點與工程守護 (Core Features)

### 1. 🚦 五級查重決策階梯 (Five-Tier Decision Ladder)
查重系統的核心產出不僅是相似度，而是具備行動指引的 **四態決策建議** 與 **結構化比對理由**：
- 🔴 **`DO_NOT_BUY` (不建議購買)**：
  - **Level 1**：ISBN 完全相符且持有中。
  - **Level 2**：正書名與作者相符，且持有相同媒介形式（如實體書 vs 實體書）。
- 🟡 **`CONSIDER` (請審慎考慮)**：
  - **Level 3**：書名作者完全相符，但持有不同媒介形式（如已持實體版，想買隨身電子版）。
  - **Level 4**：主標題相似度 $\ge 85\%$、作者相同，ISBN 不同（疑似增訂版、紀念版，守門規則 Invariant D1）。
  - **歷史交易**：曾買過但標記為已售出、已贈送（`PREVIOUSLY_OWNED`）。
- 🟢 **`SAFE_TO_BUY` (可放心購買)**：
  - **Level 5**：書庫中查無紀錄，一鍵帶入快速入庫表單。
- ⚪ **`UNKNOWN` (異常安全降級)**：
  - 網路中斷或服務逾時，介面給予強烈警示：「⚠️ 請勿將此結果視為未購買！」（守門規則 Invariant D2）。

### 2. ⚡ 條碼優先機器解析 (Deterministic Barcode First 0 Token 快路徑)
- 手機拍下照片後，前端優先呼叫瀏覽器原生 `BarcodeDetector` API（或輕量 ZXing 模組）。
- 若成功解析出 EAN-13 (ISBN)，直接帶入查重，**跳過 Gemini Vision 呼叫**，達成 **0 Token 耗損與 100ms 極速反應**。

### 3. 🖼️ 前端圖片動態壓縮 (Canvas Compression)
- 利用 HTML5 Canvas，將相機照片長邊等比例縮放至最高 `1200px`，JPEG 品質 `0.8`。
- 上傳體積控制在 **500KB 以內**，大幅節省行動網路流量與 GAS 傳輸延遲。

### 4. 🔒 排他鎖保護的雙表一致性寫入 (Lock-Protected Write with Compensating Rollback)
- **排他鎖保障**：GAS 調用 `LockService.getScriptLock()`（最多等待 10 秒）。
- **請求冪等性防重 (Idempotency Key)**：前端每筆請求攜帶 UUID v4 `request_id`，若已入庫則直接重播歷史成功資料，杜絕重複扣款/入庫。
- **補償性回滾**：依序寫入 `Books` 與 `Purchases`，若 Purchase 寫入失敗，立即清理剛建立之孤兒 Book 並回傳 `WRITE_FAILED`。

### 5. 🛡️ 憑證衛生與加鹽雜湊認證 (Zero-Leak Credential Hygiene)
- 嚴格恪守「憑證不入聊天、不入程式碼、不入 Git」。
- **嚴禁使用 URL Query Token (`?token=xxx`)**。
- 首次開啟輸入私人 Token，以加鹽雜湊 (Salted SHA-256) 與 `ScriptProperties` 對比，安全儲存於手機 `localStorage`。

### 6. 🧪 20 本實體圖書盲測矩陣 (Real-World Acceptance Suite)
- 內建包含《原子習慣》、《被討厭的勇氣》、《快思慢想》、《致富心態》、《晶片戰爭》等 20 本實體圖書測試案例，直接在瀏覽器點擊即可體驗五級決策。

---

## 🚀 部署與使用指南 (Deployment Guide)

### 步驟 1：前端 PWA 部署 (GitHub Pages)
1. Fork 或 Clone 本專案庫：
   ```bash
   git clone https://github.com/etrnya/Booklist.git
   ```
2. 在 GitHub 專案庫中開啟 **Settings ➔ Pages**，將 Source 設為 `main` 分支的 `/ (root)`。
3. 即可在手機瀏覽器開啟：`https://<username>.github.io/Booklist/`（支援加入手機主畫面 PWA）。

### 步驟 2：後端 Google Apps Script 部署
1. 建立一個新的 [Google 試算表](https://sheets.new)，將名稱命名為 `Booklist-Database`。
2. 點擊試算表選單 **擴充功能 ➔ Apps Script**。
3. 將本專案 `backend/` 資料夾下的所有檔案內容複製貼入 GAS 編輯器：
   - `Code.js`
   - `AuthService.js`
   - `DecisionLadder.js`
   - `StorageManager.js`
   - `VisionService.js`
   - `MetadataService.js`
   - `DatabaseInitializer.js`
   - `appsscript.json` (專案資訊清單)
4. 前往 **專案設定 ➔ 指令碼屬性 (Script Properties)**，新增以下機密變數：
   - `SPREADSHEET_ID`：你的 Google 試算表 ID。
   - `GEMINI_API_KEY`：Google AI Studio Gemini API 金鑰。
   - `GOOGLE_BOOKS_API_KEY`：Google Cloud Books API 金鑰。
   - `BOOKLIST_APP_TOKEN_HASH`：你的私人 Token 加鹽雜湊值。
   - `BOOKLIST_TOKEN_SALT`：隨機字串安全鹽值。
5. 在 GAS 編輯器中選擇並執行 `DatabaseInitializer.initDatabase()` 函式，自動在試算表生成 `Books`、`Purchases` 與 `Settings` 工作表及欄位。
6. 點擊右上角 **部署 ➔ 新部署 ➔ 網頁應用程式 (Web App)**：
   - 執行身分：`我 (User deploying)`
   - 誰可以存取：`所有人 (Anyone)`
7. 複製產生的 Web App URL，回到手機前端的 **⚙️ 系統設定** 貼入 URL 與私人 Token，即刻享有完整雲端查重服務！

---

## 📂 專案檔案結構 (Project Structure)

```text
Booklist/
├── .agents/
│   └── AGENTS.md                  # AI 專屬防坑規範與架構邊界
├── backend/                       # Google Apps Script 無伺服器後端
│   ├── Code.js                    # GAS 主入口 (Web App 路由器、Actions 分發)
│   ├── AuthService.js             # 加鹽雜湊 (Salted SHA-256) 私人權杖認證
│   ├── DecisionLadder.js          # 五級查重決策階梯核心引擎 (Levenshtein + 狀態矩陣)
│   ├── StorageManager.js          # 排他鎖 (ScriptLock)、雙表寫入、補償回滾與冪等防重
│   ├── VisionService.js           # Gemini 2.5 Flash 視覺文字擷取
│   ├── MetadataService.js         # Google Books 官方元資料檢索與高解析封面解析
│   ├── DatabaseInitializer.js     # Sheet 自動建立與表頭初始化腳本
│   └── appsscript.json            # GAS 專案配置檔
├── css/
│   └── style.css                  # Mobile-First 深色玻璃擬態設計系統
├── js/
│   ├── app.js                     # 前端應用控制器、拍照事件、搜尋與狀態調度
│   ├── barcode.js                 # 條碼優先機器解析 (BarcodeDetector 0 Token 快路徑)
│   ├── compressor.js              # Canvas 照片動態壓縮模組 (<500KB JPEG 0.8)
│   ├── api.js                     # 通訊封裝、UUID 冪等識別碼與離線模擬器
│   └── decision_ui.js             # 四態查重決策卡片與快速入庫表單動態渲染
├── mock_books.json                # 20 本驗收實體書盲測基準資料 (Ground Truth)
├── index.html                     # 行動端 Single-Page Application (PWA)
├── API_CONTRACT.md                # 前後端通信協定規範
├── DATA_SCHEMA.md                 # 試算表關聯架構與欄位規範
├── GLOSSARY.md                    # 字典先行核心術語定義
├── PRD.md                         # 產品需求規格書 v1.0.2 (規格凍結版)
├── TEST_CASES.md                  # 20 本實體圖書盲測驗收案例集
├── MCP_INTEGRATION_SPEC.md        # Taiwan Book Metadata Resolver 對接規格書
├── LICENSE                        # MIT 開源授權條款
└── README.md                      # 本文件
```

---

## 📄 授權條款 (License)

本專案採用 [MIT License](LICENSE) 授權釋出，歡迎社群自由使用、改作與貢獻！
