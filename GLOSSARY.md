# 📖 Booklist 專案術語字典 (Glossary) v1.0.2

> 本文件依據全域開發通則「字典先行 (Dictionary First)」原則建立，嚴格定義 Booklist（智慧購書決策與查重系統）專案之核心術語、領域模型實體、資料表欄位與變數命名規範。後續所有架構設計、PRD 規格書、GAS 後端與前端程式碼，必須 100% 對齊本字典。

---

## 1. 核心業務與決策術語 (Business & Decision Engine)

| 繁體中文術語 | 英文對照 (Term) | 代碼變數 / 識別碼 (Identifier) | 定義與語義解釋 |
| :--- | :--- | :--- | :--- |
| **購書決策狀態** | Purchase Decision | `purchase_decision` / `decision` | 查重後系統給予使用者的核心購書建議四態：<br>• `DO_NOT_BUY` (不建議購買)<br>• `CONSIDER` (審慎考慮/互補版本)<br>• `SAFE_TO_BUY` (可放心購買)<br>• `UNKNOWN` (系統無法完成查重，警示不得視為安全)。 |
| **持有狀態** | Ownership Status | `ownership_status` | 個人書庫對於該書目之持有客觀狀態（嚴格以 `Purchases.status === 'ACTIVE'` 判定持有）：<br>• `CURRENTLY_OWNED` (目前持有同版本)<br>• `OWNED_OTHER_FORMAT` (目前持有其他媒介形式)<br>• `PREVIOUSLY_OWNED` (曾經持有但已轉售/贈送/淘汰)<br>• `SUSPECTED` (疑似持有同書)<br>• `NOT_OWNED` (完全未持有)。 |
| **比對觀察類型** | Match Observation Type | `match_type` | 描述「系統客觀觀察到什麼」（而非主觀證明）：<br>• `SAME_ISBN` (ISBN 完全相符)<br>• `TITLE_AUTHOR_EXACT` (書名與作者完全相符)<br>• `TITLE_AUTHOR_LANG_DIFF` (書名作者相符但語言不同)<br>• `FUZZY_TITLE_AUTHOR` (主標題相似/疑似改版)<br>• `NO_MATCH` (完全無相符)<br>• `ERROR_UNAVAILABLE` (服務或網路異常)。 |
| **標準書目版本** | Canonical Book Edition | `canonical_edition` / `book_id` | **`Books` 表主體**：可被 ISBN 或 Google Books 唯一識別之標準出版版本（如：2019 年天下文化《原子習慣》中文初版）。 |
| **購買交易實體** | Purchase Instance | `purchase_instance` / `purchase_id` | **`Purchases` 表主體**：使用者實際發生的交易行為與持有載體（如：2024 年博客來實體書交易）。 |
| **冪等性識別碼** | Idempotency Key / Request ID | `request_id` | 前端每次發起儲存請求時產生之 UUID v4。後端儲存前檢驗是否重複，防止連點或逾時重試產生重複購買紀錄。 |
| **原生條碼解碼** | Deterministic Barcode Detection | `barcode_detector` | 優先利用瀏覽器原生 `BarcodeDetector` API（或 ZXing 輕量庫）進行毫秒級、零 Token 條碼解析；失敗時才降級呼叫 Gemini Vision。 |
| **元資料豐富化** | Metadata Enrichment | `metadata_enrichment` | Google Books API 僅作為事後補充封面與出版社中繼資料之「豐富化」外掛，核心查重路徑直接以 ISBN 查 Sheet，不阻塞決策。 |
| **排他鎖一致性寫入** | Lock-Protected Consistent Write | `consistent_write` | 利用 GAS `LockService` 實現之排他鎖，搭配雙表寫入校驗與補償回滾機制 (Compensating Rollback)。 |
| **端到端決策延遲** | End-to-End Decision Latency | `decision_latency` | 使用者點擊拍照 (T0) 到前端決策卡片顯示 (T6) 之全流程耗時（T6 - T0），目標 P50 < 3s, P95 < 6s。 |

---

## 2. 領域模型與資料表結構 (Domain Entities & Schema)

### 2.1 書籍主表 (`Books` - 代表標準書目版本 Canonical Edition)
記錄特定標準出版版本的中繼資訊（一版本一筆，以 ISBN / Google Books ID 為辨識核心）：
```typescript
interface Book {
  book_id: string;               // 系統唯一識別碼 (如: "BK-20261007-001")
  title: string;                 // 正書名 (如: "原子習慣")
  subtitle?: string;             // 副標題 (如: "細微改變帶來巨大成就的實證法則")
  author: string;                // 作者 (如: "James Clear")
  translator?: string;           // 譯者
  isbn_13?: string;              // 標準化 13 碼 ISBN (978...)
  isbn_10?: string;              // 標準化 10 碼 ISBN
  publisher?: string;            // 出版社 (如: "天下文化")
  publication_date?: string;     // 出版日期 (YYYY-MM-DD 或 YYYY-MM)
  language: string;              // 語言 (預設: "繁體中文")
  cover_url?: string;            // 封面圖網址 (Google Books 提供)
  google_books_id?: string;      // Google Books API Volume ID
  created_at: string;            // 建立時間戳 (ISO 8601)
  updated_at: string;            // 最後修改時間戳
}
```

### 2.2 購買紀錄表 (`Purchases` - 代表購買交易持有實體 Purchase Instance)
記錄使用者每一次的購買與持有載體（一書目版本可有多筆交易，含 `request_id` 冪等守衛）：
```typescript
interface Purchase {
  purchase_id: string;           // 購買流水號 (如: "PC-20261007-001")
  book_id: string;               // 關聯之書籍版本 ID (外鍵 Foreign Key)
  request_id: string;            // 冪等性請求識別碼 (UUID v4，唯一防重)
  purchase_date: string;         // 購買日期 (YYYY-MM-DD，預設今天)
  channel: string;               // 購買通路 (博客來、誠品、Kobo...)
  format: "PHYSICAL" | "EBOOK" | "AUDIOBOOK"; // 書籍形式
  price: number;                 // 實付購買金額
  currency: string;              // 幣別 (預設: "TWD")
  status: "ACTIVE" | "SOLD" | "GIFTED" | "DISCARDED"; // 持有狀態 (ACTIVE=目前持有，其餘為歷史紀錄)
  edition_note?: string;         // 版本備註 (如: "全新增訂版", "2023平裝初版")
  location?: string;             // 存放位置或載具 (如: "客廳書架二層", "Kobo Clara")
  notes?: string;                // 備註說明
  provenance: string;            // 來源出處 JSON ({"meta":"GOOGLE_BOOKS","price":"USER"})
  created_at: string;            // 記錄時間戳
}
```

### 2.3 系統設定表 (`Settings` Sheet) 與 `ScriptProperties` 邊界
- **`ScriptProperties`（專門保存機密金鑰與環境參數）**：
  - `GEMINI_API_KEY`：Google Gemini API 金鑰
  - `GOOGLE_BOOKS_API_KEY`：Google Books API 金鑰
  - `BOOKLIST_APP_TOKEN_HASH`：安全 Token 雜湊值 (Salted SHA-256)
  - `BOOKLIST_TOKEN_SALT`：安全鹽值 (Salt)
  - `SPREADSHEET_ID`：綁定之 Google Sheet 識別碼
- **`Settings` 工作表（僅保存非機密之業務字典與選單選項）**：
  - `CHANNEL_OPTIONS`：下拉選單項目（博客來, 誠品, Kobo, Readmoo, 實體書店...）
  - `FORMAT_OPTIONS`：形式選項（PHYSICAL, EBOOK, AUDIOBOOK）
  - `DEFAULT_CURRENCY`：預設幣別（TWD）
  - `SIMILARITY_THRESHOLD`：模糊警告門檻（0.85）

---

## 3. 查重決策輸出規格 (`DuplicateCheckResult`)

查重引擎輸出具備行動建議與結構化理由之物件：
```typescript
interface DuplicateCheckResult {
  decision: "DO_NOT_BUY" | "CONSIDER" | "SAFE_TO_BUY" | "UNKNOWN";
  ownership_status: "CURRENTLY_OWNED" | "OWNED_OTHER_FORMAT" | "PREVIOUSLY_OWNED" | "SUSPECTED" | "NOT_OWNED";
  match_type: "SAME_ISBN" | "TITLE_AUTHOR_EXACT" | "TITLE_AUTHOR_LANG_DIFF" | "FUZZY_TITLE_AUTHOR" | "NO_MATCH" | "ERROR_UNAVAILABLE";
  similarity_score?: number;     // 相似度分數 (0.0 ~ 1.0)
  matched_book_id?: string;      // 命中的既有書目版本 ID
  matched_book_title?: string;   // 命中的既有書籍書名
  matched_purchases: PurchaseSummary[]; // 既有購買明細（僅列出 status=ACTIVE 者，或標示 PREVIOUSLY_OWNED）
  reasons: string[];             // 具體理由文字陣列 (如: ["ISBN 完全相符", "目前已持有實體版"])
  user_message: string;          // UI 呈現之大字提示文字
}

interface PurchaseSummary {
  purchase_date: string;
  channel: string;
  format: "PHYSICAL" | "EBOOK" | "AUDIOBOOK";
  price: number;
  status: "ACTIVE" | "SOLD" | "GIFTED" | "DISCARDED";
}
```

---

## 4. API 統一 Envelope 與標準錯誤代碼

所有 GAS API 均強制封裝於統一行包 (Envelope) 中：

### 4.1 成功回應
```json
{
  "success": true,
  "request_id": "550e8400-e29b-41d4-a716-446655440000",
  "data": {},
  "error": null
}
```

### 4.2 失敗回應
```json
{
  "success": false,
  "request_id": "550e8400-e29b-41d4-a716-446655440000",
  "data": null,
  "error": {
    "code": "AUTH_FAILED",
    "message": "Unauthorized"
  }
}
```

### 4.3 標準錯誤碼清單 (Error Codes)
- `AUTH_FAILED`：App Token 無效或缺失
- `INVALID_REQUEST`：請求酬載格式錯誤或缺少必要欄位
- `INVALID_ISBN`：ISBN 校驗碼不合法
- `BOOK_NOT_FOUND`：查詢之書籍不存在
- `METADATA_UNAVAILABLE`：Google Books 或外部辨識服務無資料
- `DUPLICATE_DETECTED`：寫入前查重發現已持有
- `UNKNOWN`：服務異常或連線超時，無法完成查重
- `LOCK_TIMEOUT`：無法於 10 秒內獲取 ScriptLock
- `WRITE_FAILED`：寫入 Google Sheet 失敗並已回滾
- `IDEMPOTENCY_REPLAY`：重複提交，回傳歷史成功紀錄
