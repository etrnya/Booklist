# 📡 Booklist API 介面規格協定 (API Contract) v1.0.2

> 本協定定義前端（手機 RWD HTML）與後端（Google Apps Script Web App）之間的所有通信資料結構。  
> 遵循 [GLOSSARY.md](file:///C:/Users/etrny/.gemini/antigravity/scratch/Booklist/GLOSSARY.md) 命名規範與 [PRD.md](file:///C:/Users/etrny/.gemini/antigravity/scratch/Booklist/PRD.md) 工程附錄。

---

## 1. 統一通信封裝 (Global Envelope Protocol)

所有向 GAS 發送之請求一律使用 `HTTP POST`，並夾帶 JSON 格式酬載 (Payload)。

### 1.1 請求通用標頭與欄位 (Request Envelope)
```typescript
interface BaseApiRequest {
  action: "AUTH_VERIFY" | "DUPLICATE_CHECK" | "VISION_EXTRACT" | "METADATA_FETCH" | "BOOK_SAVE" | "SETTINGS_GET";
  token: string;                 // 私人 App Token (存於手機 localStorage)
  request_id: string;            // 前端產生之 UUID v4 追蹤/冪等識別碼
}
```

### 1.2 回應通用封裝 (Response Envelope)
```typescript
interface ApiResponse<T> {
  success: boolean;
  request_id: string;            // Echo 請求之 request_id
  data: T | null;                // 成功時為泛型資料，失敗時為 null
  error: ApiError | null;        // 成功時為 null，失敗時為具體錯誤
}

interface ApiError {
  code: "AUTH_FAILED" 
      | "INVALID_REQUEST" 
      | "INVALID_ISBN" 
      | "BOOK_NOT_FOUND" 
      | "METADATA_UNAVAILABLE" 
      | "DUPLICATE_DETECTED" 
      | "UNKNOWN" 
      | "LOCK_TIMEOUT" 
      | "WRITE_FAILED" 
      | "IDEMPOTENCY_REPLAY";
  message: string;
}
```

---

## 2. API 介面詳情 (Endpoints & Actions)

### 2.1 權杖驗證 (`action: "AUTH_VERIFY"`)
用於手機初次使用輸入 Token 時的校驗。

#### Request
```json
{
  "action": "AUTH_VERIFY",
  "token": "bk_sec_9f8a123...",
  "request_id": "c7325048-2c09-42f7-876a-6536cf2877a2"
}
```

#### Response (Success)
```json
{
  "success": true,
  "request_id": "c7325048-2c09-42f7-876a-6536cf2877a2",
  "data": {
    "is_valid": true,
    "user_message": "授權成功"
  },
  "error": null
}
```

---

### 2.2 五級階梯查重 (`action: "DUPLICATE_CHECK"`)
核心查重路徑。若有 ISBN 則走極速匹配；若無 ISBN 則以正規化書名、作者、語言與欲購形式比對。

#### Request
```json
{
  "action": "DUPLICATE_CHECK",
  "token": "bk_sec_9f8a123...",
  "request_id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "payload": {
    "isbn_13": "9789861755261",
    "title": "原子習慣",
    "author": "James Clear",
    "language": "繁體中文",
    "format": "PHYSICAL"
  }
}
```

#### Response (Success — 命中同版本持有中)
```json
{
  "success": true,
  "request_id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "data": {
    "decision": "DO_NOT_BUY",
    "ownership_status": "CURRENTLY_OWNED",
    "match_type": "SAME_ISBN",
    "similarity_score": 1.0,
    "matched_book_id": "BK-20261007-001",
    "matched_book_title": "原子習慣",
    "matched_purchases": [
      {
        "purchase_date": "2025-08-12",
        "channel": "博客來",
        "format": "PHYSICAL",
        "price": 320,
        "status": "ACTIVE"
      }
    ],
    "reasons": [
      "ISBN-13 完全吻合 (9789861755261)",
      "目前已持有實體版 (博客來 $320)"
    ],
    "user_message": "您已買過此書，不建議重複購買！"
  },
  "error": null
}
```

---

### 2.3 視覺文字擷取 (`action: "VISION_EXTRACT"`)
當原生 `BarcodeDetector` 解析失敗或拍攝封面時呼叫。Gemini 2.5 Flash 僅擷取文字，不猜測元資料。

#### Request
```json
{
  "action": "VISION_EXTRACT",
  "token": "bk_sec_9f8a123...",
  "request_id": "b2c3d4e5-f6a7-8901-bcde-f12345678901",
  "payload": {
    "image_base64": "data:image/jpeg;base64,/9j/4AAQSkZJRg...",
    "mime_type": "image/jpeg"
  }
}
```

#### Response (Success)
```json
{
  "success": true,
  "request_id": "b2c3d4e5-f6a7-8901-bcde-f12345678901",
  "data": {
    "detected_isbn": "9789861755261",
    "raw_title": "原子習慣",
    "raw_author": "詹姆斯·克利爾",
    "raw_publisher": "方智",
    "confidence": 0.96
  },
  "error": null
}
```

---

### 2.4 權威元資料豐富化 (`action: "METADATA_FETCH"`)
查重完成後，非同步向 Google Books API 索取官方標準出版中繼資訊與高解析封面縮圖。

#### Request
```json
{
  "action": "METADATA_FETCH",
  "token": "bk_sec_9f8a123...",
  "request_id": "c3d4e5f6-a7b8-9012-cdef-123456789012",
  "payload": {
    "isbn": "9789861755261",
    "query": "原子習慣"
  }
}
```

#### Response (Success)
```json
{
  "success": true,
  "request_id": "c3d4e5f6-a7b8-9012-cdef-123456789012",
  "data": {
    "title": "原子習慣",
    "subtitle": "細微改變帶來巨大成就的實證法則",
    "author": "James Clear",
    "translator": "蔡世偉",
    "publisher": "方智",
    "publication_date": "2019-06-01",
    "isbn_13": "9789861755261",
    "isbn_10": "9861755269",
    "language": "繁體中文",
    "cover_url": "https://books.google.com/books/content?id=...",
    "google_books_id": "4u_wDwAAQBAJ"
  },
  "error": null
}
```

---

### 2.5 雙表一致性入庫 (`action: "BOOK_SAVE"`)
帶有排他鎖、二次查重、冪等性防重 (`request_id`) 與補償回滾機制的正式入庫。

#### Request
```json
{
  "action": "BOOK_SAVE",
  "token": "bk_sec_9f8a123...",
  "request_id": "d4e5f6a7-b8c9-0123-defa-234567890123",
  "payload": {
    "book": {
      "title": "原子習慣",
      "subtitle": "細微改變帶來巨大成就的實證法則",
      "author": "James Clear",
      "translator": "蔡世偉",
      "isbn_13": "9789861755261",
      "isbn_10": "9861755269",
      "publisher": "方智",
      "publication_date": "2019-06-01",
      "language": "繁體中文",
      "cover_url": "https://books.google.com/...",
      "google_books_id": "4u_wDwAAQBAJ"
    },
    "purchase": {
      "purchase_date": "2026-10-07",
      "channel": "博客來",
      "format": "PHYSICAL",
      "price": 320,
      "currency": "TWD",
      "status": "ACTIVE",
      "edition_note": "全新修訂版",
      "location": "客廳書架二層",
      "notes": "現場查重後確認購入",
      "provenance": "{\"meta_source\":\"GOOGLE_BOOKS\",\"price\":\"USER_INPUT\"}"
    }
  }
}
```

#### Response (Success)
```json
{
  "success": true,
  "request_id": "d4e5f6a7-b8c9-0123-defa-234567890123",
  "data": {
    "book_id": "BK-20261007-001",
    "purchase_id": "PC-20261007-001",
    "message": "入庫成功！"
  },
  "error": null
}
```

#### Response (Idempotency Replay — 重複請求回放)
```json
{
  "success": true,
  "request_id": "d4e5f6a7-b8c9-0123-defa-234567890123",
  "data": {
    "book_id": "BK-20261007-001",
    "purchase_id": "PC-20261007-001",
    "is_replay": true,
    "message": "請求已於稍早處理完成，避免重複寫入。"
  },
  "error": null
}
```

---

### 2.6 取得業務設定 (`action: "SETTINGS_GET"`)
前端初始化時讀取下拉選單字典。

#### Response (Success)
```json
{
  "success": true,
  "request_id": "e5f6a7b8-c9d0-1234-efab-345678901234",
  "data": {
    "channel_options": ["博客來", "誠品", "Kobo", "Readmoo", "讀冊", "三民", "實體書店", "二手書店"],
    "format_options": ["PHYSICAL", "EBOOK", "AUDIOBOOK"],
    "default_currency": "TWD",
    "similarity_threshold": 0.85
  },
  "error": null
}
```
