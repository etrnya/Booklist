# 📑 Booklist × Google Books TW MCP 整合規格書 (Integration Spec) v1.0.0

> 本規格書定義 Booklist 系統如何將 `google-books-tw-mcp` 作為權威書目解析基礎設施（Metadata Resolver & Fact Layer）。  
> 確立「資料邊界」、「事實可信度 (Fact vs Assumption)」與「查重識別碼 (Identity Keys)」之對齊標準。

---

## 1. 架構定位：Resolver 而非單純 Wrapper

```text
       拍照條碼 / 輸入書名
               │
               ▼
   ┌───────────────────────┐
   │  Booklist Client      │
   └───────────┬───────────┘
               │ (呼叫 resolve_book)
               ▼
   ┌─────────────────────────────────────────────────────────┐
   │  google-books-tw-mcp (Taiwan Book Metadata Resolver)    │
   │  1. Normalization (清洗破折號、空格)                    │
   │  2. Validation (ISBN-10 / 13 校驗碼驗證與雙向轉換)      │
   │  3. Upstream Provider (Google Books API)                │
   │  4. Cover Resolver (https 升級、zoom=0 高清化)          │
   │  5. Confidence & Provenance (信心度評分與來源標註)      │
   └───────────────────────────┬─────────────────────────────┘
                               │ 回傳標準結構化 Fact
                               ▼
   ┌─────────────────────────────────────────────────────────┐
   │  Booklist 查重與決策核心                                │
   │  • Level 1: 精確比對 identity.isbn_13                   │
   │  • Level 2/3: 比對 work.title + work.authors + language │
   │  • Level 4: 模糊比對 work.title 主幹                    │
   │  • 寫入 Notion: 提取 edition 欄位與 cover.url           │
   └─────────────────────────────────────────────────────────┘
```

---

## 2. 事實層界定 (Fact Layer vs Candidate Fields)

為落實 COA-Parser 職責分離哲學，Booklist 對 MCP 回傳的欄位有不同層級的信任度：

| 欄位路徑 | 資料屬性 (Classification) | 信任度 | 系統行為約束 |
| :--- | :--- | :---: | :--- |
| `identity.isbn_13` | **權威事實 (Authoritative Fact)** | 100% | 經數學校驗碼驗證通過，作為 Level 1 查重絕對主鍵。 |
| `identity.isbn_10` | **權威事實 (Authoritative Fact)** | 100% | 經校驗碼驗證通過，作為雙向查重次要依據。 |
| `work.title` | **出版事實 (Bibliographic Fact)** | 95% | 官方登記之正書名，用於 Level 2/3 正規化比對。 |
| `work.authors` | **出版事實 (Bibliographic Fact)** | 95% | 官方作者名單，用於 Level 2/3 協同鑑別。 |
| `edition.publisher` | **版本資訊 (Edition Metadata)** | 90% | 臺灣出版社名稱，寫入 Notion `出版社` 屬性。 |
| `cover.url` | **呈現資源 (Display Asset)** | 90% | 高解析度書封圖，寫入 Notion `Page Cover` 與 `書封` 欄位。 |
| `source.confidence` | **統計推論 (Statistical Signal)** | N/A | 指引 Booklist 決策分流：<br>• `≥ 0.90`：高度可信，自動採納<br>• `0.70 ~ 0.89`：中度可信，提示使用者核對<br>• `< 0.70`：低度可信，要求人工手動確認 |

---

## 3. 查重所需之核心識別碼 (Identity Keys for Deduplication)

Booklist 查重引擎直接依賴 MCP 輸出的三組身分鍵：
1. **Edition Key (`identity.isbn_13`)**：
   - 全球出版版本唯一識別碼。若命中，100% 判定為同一出版版本（`SAME_EDITION` ➔ 🔴 `DO_NOT_BUY`）。
2. **Work Candidate Key (`work.title` + `work.authors` + `work.language`)**：
   - 創作本體候選。若書名、作者完全相符且語言同為繁中，判定為同一作品（依欲購形式分流 Level 2 或 Level 3）。
3. **Provider Key (`identity.google_books_id`)**：
   - 溯源輔助鍵，寫入 Notion 資料庫作為未來重新整理元資料之錨點。

---

## 4. MCP 工具介面調用規範

Booklist 後端對 MCP 的調用策略：
- **查重與補資料主路徑**：一律優先呼叫 `resolve_book(query_or_isbn)`，一次取得完整的 `identity`、`work`、`edition`、`cover` 與 `source`。
- **純文字關鍵字搜尋路徑**：當使用者手動打字搜尋時，呼叫 `search_books(query, search_type="title", language="zh-TW")`，以繁中過濾精確列表。
- **快速抓封面路徑**：呼叫 `get_book_cover(isbn_or_query)`。
