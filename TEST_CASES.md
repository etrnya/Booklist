# 🧪 Booklist 驗收測試案例集 (Test Cases Specification) v1.0.2

> 本測試案例集作為 Booklist 開發完成後的正式驗收基準（Ground Truth）。  
> 驗收原則：**拒絕單純代碼編譯通過，必須通過實體圖書盲測與邊界極限測試**。

---

## 1. 實體圖書 20 本現場盲測矩陣 (Real-World Acceptance Suite)

| 編號 | 測試書名 | 模擬情境 | 傳入特徵 | 預期判定階梯 | 預期決策 (`decision`) | 預期觀察類型 (`match_type`) | 預期持有狀態 (`ownership_status`) | 驗收核心檢核點 |
| :---: | :--- | :--- | :--- | :---: | :---: | :---: | :---: | :--- |
| **TC-01** | 《原子習慣》 | 已持有繁中實體初版 | ISBN: `9789861755261` | Level 1 | 🔴 `DO_NOT_BUY` | `SAME_ISBN` | `CURRENTLY_OWNED` | ISBN 完全一致，1 秒內 fast-path 阻擋 |
| **TC-02** | 《被討厭的勇氣》 | 已持有繁中實體書 | 封面拍照 (無 ISBN) | Level 2 | 🔴 `DO_NOT_BUY` | `TITLE_AUTHOR_EXACT` | `CURRENTLY_OWNED` | 封面文字提取後書名作者同繁中同形式阻擋 |
| **TC-03** | 《快思慢想》 | 已持有繁中實體書 | ISBN: `9789863200871` | Level 1 | 🔴 `DO_NOT_BUY` | `SAME_ISBN` | `CURRENTLY_OWNED` | 顯示既有購買通路與日期 |
| **TC-04** | 《致富心態》 | 已持有繁中實體書 | ISBN: `9789865250041` | Level 1 | 🔴 `DO_NOT_BUY` | `SAME_ISBN` | `CURRENTLY_OWNED` | 決策卡片標題醒目大字提醒 |
| **TC-05** | 《原則：生活和工作》 | 已持有繁中實體書 | 封面拍照 | Level 2 | 🔴 `DO_NOT_BUY` | `TITLE_AUTHOR_EXACT` | `CURRENTLY_OWNED` | 繁體書名作者一致性比對 |
| **TC-06** | 《富爸爸，窮爸爸》 | 已持有繁中實體書 | ISBN: `9789869762809` | Level 1 | 🔴 `DO_NOT_BUY` | `SAME_ISBN` | `CURRENTLY_OWNED` | 命中既有實體版本 |
| **TC-07** | 《蛤蟆先生去看心理師》 | 已持有繁中實體書 | 封面拍照 | Level 2 | 🔴 `DO_NOT_BUY` | `TITLE_AUTHOR_EXACT` | `CURRENTLY_OWNED` | 正常提取作者 Robert de Board |
| **TC-08** | 《人類大歷史》 | 已持有繁中實體書 | ISBN: `9789863205449` | Level 1 | 🔴 `DO_NOT_BUY` | `SAME_ISBN` | `CURRENTLY_OWNED` | 精確 ISBN-13 比對 |
| **TC-09** | 《高勝算決策》 | 已持有繁中實體書 | ISBN: `9789862725351` | Level 1 | 🔴 `DO_NOT_BUY` | `SAME_ISBN` | `CURRENTLY_OWNED` | 標示購買價格與書架位置 |
| **TC-10** | 《無限賽局》 | 已持有繁中實體書 | 封面拍照 | Level 2 | 🔴 `DO_NOT_BUY` | `TITLE_AUTHOR_EXACT` | `CURRENTLY_OWNED` | 快速比對完成 |
| **TC-11** | 《原子習慣》 (Kobo版) | 已有實體，想買電子書 | 書名同，欲購 `EBOOK` | Level 3 | 🟡 `CONSIDER` | `TITLE_AUTHOR_EXACT` | `OWNED_OTHER_FORMAT` | **提示已持有實體版，尚未持有電子版** |
| **TC-12** | 《致富心態》 (Readmoo) | 已有實體，想買電子書 | 書名同，欲購 `EBOOK` | Level 3 | 🟡 `CONSIDER` | `TITLE_AUTHOR_EXACT` | `OWNED_OTHER_FORMAT` | **不武斷一刀切阻擋**，提供決策參考 |
| **TC-13** | 《被討厭的勇氣》 (Kindle)| 已有實體，想買電子書 | 書名同，欲購 `EBOOK` | Level 3 | 🟡 `CONSIDER` | `TITLE_AUTHOR_EXACT` | `OWNED_OTHER_FORMAT` | 顯示「形式互補」建議 |
| **TC-14** | 《投資最重要的事：全新增訂版》 | 原藏有舊版，書店見增訂版 | 書名含增訂版，ISBN不同 | Level 4 | 🟡 `CONSIDER` | `FUZZY_TITLE_AUTHOR` | `SUSPECTED` | **Invariant D1**：絕不得輸出 DO_NOT_BUY |
| **TC-15** | 《思考的藝術：52個非受迫性思考錯誤》 | 原藏有舊版，書店見紀念版 | 副標題微調，ISBN不同 | Level 4 | 🟡 `CONSIDER` | `FUZZY_TITLE_AUTHOR` | `SUSPECTED` | 提示主標題相似 (92%)，請確認內容 |
| **TC-16** | 《晶片戰爭》 | 全新未持有書籍 | ISBN: `9789863988496` | Level 5 | 🟢 `SAFE_TO_BUY` | `NO_MATCH` | `NOT_OWNED` | 自動載入 Google Books 官方封面與中繼資料 |
| **TC-17** | 《晶片島上的光芒》 | 全新未持有書籍 | 封面拍照 | Level 5 | 🟢 `SAFE_TO_BUY` | `NO_MATCH` | `NOT_OWNED` | 正確辨識書名作者，標記可放心購買 |
| **TC-18** | 《埃隆·馬斯克傳》 | 全新未持有書籍 | ISBN: `9789865259983` | Level 5 | 🟢 `SAFE_TO_BUY` | `NO_MATCH` | `NOT_OWNED` | 帶出快捷登記購買按鈕 |
| **TC-19** | 《生之奧義》 | 全新未持有書籍 | 封面拍照 | Level 5 | 🟢 `SAFE_TO_BUY` | `NO_MATCH` | `NOT_OWNED` | 正確引導進入快速登記表單 |
| **TC-20** | 《智慧型資產配置》 | 全新未持有書籍 | ISBN: `9789869824248` | Level 5 | 🟢 `SAFE_TO_BUY` | `NO_MATCH` | `NOT_OWNED` | 10 秒內顯示可放心購買卡片 |

---

## 2. 邊界與極限安全測試 (Edge & Safety Invariant Cases)

### TC-E1：歷史已轉售/贈送書籍再次查詢 (`PREVIOUSLY_OWNED`)
- **前置條件**：書庫中存在《窮查理的普通常識》，但 `Purchases.status` 為 `SOLD` (已於二手書店售出)。
- **操作**：書店再次拍下《窮查理的普通常識》條碼查重。
- **預期結果**：
  - `decision`：🟡 `CONSIDER`（**不得誤判為 🔴 DO_NOT_BUY**）。
  - `ownership_status`：`PREVIOUSLY_OWNED`。
  - 理由列出：`"曾於 2024/01 購買但標記已售出，目前未持有實體書"`。

### TC-E2：冪等性重複入庫重試 (`IDEMPOTENCY_REPLAY`)
- **前置條件**：網路不穩，前端送出儲存請求 (`request_id: "REQ-12345"`)，後端成功寫入 Sheet，但 HTTP 回傳逾時引發前端自動重試。
- **操作**：以相同 `request_id: "REQ-12345"` 再次送出 `BOOK_SAVE`。
- **預期結果**：
  - 後端鎖內偵測到 `Purchases.request_id` 已存在。
  - 回傳 `{ success: true, data: { is_replay: true }, error: null }`。
  - **`Purchases` 表絕不產生第二筆重複紀錄**。

### TC-E3：雙開視窗並行入庫搶鎖 (`LOCK_PROTECTED_CONSISTENCY`)
- **前置條件**：使用者在手機開兩個瀏覽器分頁，同一秒點擊同一本書之「儲存入庫」。
- **操作**：兩筆並發請求同時抵達 GAS。
- **預期結果**：
  - 請求 A 取得 `ScriptLock`，完成寫入釋放鎖。
  - 請求 B 排隊取得鎖後，觸發鎖內二次查重，偵測到 A 剛寫入之 ISBN。
  - 請求 B 被攔截並回傳 `{ success: false, error: { code: "DUPLICATE_DETECTED" } }`。
  - 資料庫維持乾淨唯一性。

### TC-E4：離線與服務異常安全降級 (`INVARIANT_D2_UNKNOWN`)
- **前置條件**：處於地下室無收訊環境，或模擬 Gemini API 逾時 (Timeout)。
- **操作**：拍書查重。
- **預期結果**：
  - 系統回傳 `decision: "UNKNOWN"`，`error.code: "SERVICE_UNAVAILABLE"`。
  - 介面深灰底強烈警示：`"⚠️ 暫時無法完成查重，請勿將此結果視為『未購買』！"`。
  - **嚴禁自動降級為 🟢 SAFE_TO_BUY**。

### TC-E5：確定性條碼解析零 Token 驗證 (`BARCODE_DETECTOR_FAST_PATH`)
- **前置條件**：拍攝帶有清楚條碼之書籍封底。
- **操作**：前端執行圖片上傳查重。
- **預期結果**：
  - 瀏覽器原生 `BarcodeDetector` 在前端 100ms 內成功解析出 ISBN-13。
  - 請求直接攜帶 `isbn_13` 進入 `DUPLICATE_CHECK`，**完全不發起 `VISION_EXTRACT` 請求**。
  - Gemini API 調用次數為 0，Token 耗損為 0。

### TC-E6：未授權 Token 防護門禁 (`AUTH_FAILED`)
- **前置條件**：手機 `localStorage` 無 Token 或輸入錯誤 Token。
- **操作**：直接對 GAS Web App 發起 POST 請求。
- **預期結果**：
  - GAS 回傳 `{ success: false, error: { code: "AUTH_FAILED" } }`。
  - 前端清除無效 Token，鎖定介面並彈出 `🔐 請輸入您的私人 App Token`。
  - 後端絕不洩漏任何 Google Sheet 資料或執行外部 API 呼叫。
