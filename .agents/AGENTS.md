# Booklist — 專案專屬 AI 開發規則 (Project-level Agent Rules) v1.0.2

> 本檔依全域 AGENTS.md 第 6 條建立。進入本專案時，AI 助理必須嚴格遵守以下架構與安全約束。

---

## 1. 字典先行與實體模型約束
- 所有變數命名、資料表欄位、API 請求參數必須 100% 嚴格對齊 [GLOSSARY.md](file:///C:/Users/etrny/.gemini/antigravity/scratch/Booklist/GLOSSARY.md)。
- 貫徹 **「標準書目版本 (`Books` = Canonical Book Edition) ≠ 購買持有實體 (`Purchases` = Purchase Instance)」** 的一對多關聯模型：
  - `Books` 表代表可被 ISBN 或 Google Books 唯一辨識之書目出版版本，非抽象作品。
  - `Purchases` 表代表使用者實際發生之購買交易與載具持有。

---

## 2. 核心架構邊界 (Architecture Boundaries)
1. **極簡無伺服器原則**：
   - 手機前端 (RWD HTML) ➔ Google Apps Script (GAS Web App) ➔ Gemini 2.5 Flash + Google Books API ➔ Google Sheet。
   - 禁止引入額外伺服器或 SQL 資料庫；Google Sheet 即為資料庫。
2. **Deterministic-First 職責分離原則**：
   - **條碼優先機器解析**：手機端優先使用 `BarcodeDetector` API（或 ZXing 輕量庫）進行確定性零 Token 解碼；解碼失敗才降級至 Gemini Vision。
   - **Gemini Vision 僅負責「視覺文字擷取」**（提取書名、作者、封面 ISBN），嚴禁憑空編造資料庫元資料。
   - **Google Books API 僅作為「Metadata Enrichment（豐富化）」**：核心查重路徑直接以 ISBN 查 Sheet，不把 Google Books 作為查重決策的前置阻塞依賴。
   - **查重引擎負責「五級階梯判定」**（match_type 記錄觀察事實，decision 輸出行動建議）。
   - **使用者負責「最終事實核簽」**（確認形式、價格後寫入）。

---

## 3. 安全與防重不變性 (Security & Invariants)
- **B1 (排他鎖、雙表一致性與冪等重試 Check-Lock-Recheck-Idempotency-Write-Verify)**：
  - 儲存請求必須自前端攜帶 UUID v4 的 `request_id`。
  - GAS 取得排他鎖 `LockService.getScriptLock()`（最多等待 10 秒）。
  - **冪等性檢驗**：若 `Purchases` 表已存在該 `request_id`，直接回傳歷史成功結果（`IDEMPOTENCY_REPLAY`），防止連點或網路重試產生重複購買。
  - **鎖內二次查重**：確認無並行重複。
  - **一致性寫入與補償回滾 (Compensating Rollback)**：依序寫入 `Books` 與 `Purchases`。若 Purchase 寫入失敗，立即清理剛建立之孤兒 Book 並回傳 `WRITE_FAILED`。
  - 確保在 `finally` 區塊釋放鎖。
- **B2 (持有狀態客觀化)**：
  - 系統嚴格只把 `Purchases.status === 'ACTIVE'` 視為目前持有 (`CURRENTLY_OWNED`)。
  - 若歷史紀錄已標示為 `SOLD`、`GIFTED` 或 `DISCARDED`，標記為 `PREVIOUSLY_OWNED`，不直接武斷阻擋購買。
- **B3 (私人存取權杖與機密邊界)**：
  - **嚴禁使用 URL Query Token (`?token=xxx`)**。
  - 首次開啟時由前端輸入 App Token，驗證成功後存於手機 `localStorage`。
  - **邊界隔離**：機密資訊（`GEMINI_API_KEY`, `GOOGLE_BOOKS_API_KEY`, `BOOKLIST_APP_TOKEN_HASH`, `BOOKLIST_TOKEN_SALT`, `SPREADSHEET_ID`）全部儲存於 GAS `ScriptProperties`；Google Sheet 的 `Settings` 工作表**嚴禁存放任何機密金鑰或 Hash**，僅存放非機密之選單字典。
  - 驗證失敗回傳標準 JSON `{ success: false, error: { code: "AUTH_FAILED" } }`。
- **D1 (模糊比對安全護欄 Invariant D1)**：
  - 任何 `FUZZY_TITLE_AUTHOR` 或改版疑慮，**永遠不得直接產生 `DO_NOT_BUY`**，只能產生 `CONSIDER`。
- **D2 (離線與服務異常安全降級 Invariant D2)**：
  - 當遇到網路超時、Gemini 逾時或外部 API 無法回應時，系統必須輸出 `UNKNOWN` / `SERVICE_UNAVAILABLE`，介面必須醒目提示：「⚠️ 暫時無法完成查重，請勿將此結果視為『未購買』！」。嚴禁預設降級為 `SAFE_TO_BUY`。
- **B4 (資料來源追溯 Provenance)**：
  - 寫入的每一筆資料必須記錄來源出處 (Provenance JSON)。

---

## 4. 產品非目標護欄 (Strict Non-Goals)
為維持「買書前 10 秒查重」的極致聚焦與工具屬性，V1 **嚴禁**新增以下功能：
- ❌ 閱讀進度追蹤與劃線
- ❌ 書評、心得筆記與星級打分
- ❌ 社群分享或好友借閱
- ❌ 推薦書籍演算法
- ❌ AI 閱讀重點摘要
- ❌ OCR 全書內文擷取
- ❌ 多使用者權限系統
- ❌ 外部電商訂單自動同步爬蟲

---

## 5. 模型相容性與即時探查門禁 (Model Compatibility & Dynamic Discovery Gate)
1. **嚴禁盲目硬編碼過期或退役舊模型**：在提供「選擇 AI 模型」或配置 Gemini API 時，AI 助理**必須主動聯網/查核當前時間點官方支援之主力模型**（2026 年以 `gemini-3.8-flash`、`gemini-3.6-flash`、`gemini-3.5-flash-lite` 為標準支援），不可使用已除役或受限之歷史模型。
2. **強制提供動態探查與備援**：介面與 API 層必須實作 `models.list` 動態查詢端點，提供「🔄 線上同步此 Key 可用模型」按鈕，讓不同權限與不同國別的 API Key 能動態載入其實際具備 `generateContent` 權限之模型清單。

---

## 6. 隱私沙盒與個人書庫隔離 (Static Privacy Sandbox Invariant)
1. **公開展示與個人私密隔離**：靜態託管平台（如 GitHub Pages）上，預設之 `mock_books.json` 必須僅包含大眾示範書目，嚴禁將個人真實歷史購書清單 commit 至公開 Git 倉庫。
2. **純本地離線個人沙盒**：個人的購書數據僅能儲存於使用者本機 `localStorage`，並提供安全之本機 JSON 匯入、匯出備份與一鍵還原展示功能，確保他人開啟網頁時絕無法窺探站長個人的真實購書隱私。

