/**
 * Booklist — 資料儲存與鎖管理 (StorageManager.js)
 * 嚴格遵循排他鎖、雙表一致性 (Lock-Protected Write)、冪等性防重 (Idempotency Key) 與補償回滾
 */

var StorageManager = (function() {
  var SPREADSHEET_ID_KEY = 'SPREADSHEET_ID';

  function getSpreadsheet() {
    var props = PropertiesService.getScriptProperties();
    var sheetId = props.getProperty(SPREADSHEET_ID_KEY);
    if (!sheetId) {
      // 嘗試綁定當前啟動之試算表
      try {
        var active = SpreadsheetApp.getActiveSpreadsheet();
        if (active) return active;
      } catch (e) {}
      throw new Error('未配置 SPREADSHEET_ID 指令碼屬性！');
    }
    return SpreadsheetApp.openById(sheetId);
  }

  /**
   * 載入書庫全量資料至記憶體，建構查重物件模型
   * @return {Array<Object>} [{ book, purchases: [...] }]
   */
  function loadAllBooksWithPurchases() {
    var ss = getSpreadsheet();
    var booksSheet = ss.getSheetByName('Books');
    var purchasesSheet = ss.getSheetByName('Purchases');

    if (!booksSheet || !purchasesSheet) {
      return [];
    }

    var booksData = booksSheet.getDataRange().getValues();
    var purchasesData = purchasesSheet.getDataRange().getValues();

    if (booksData.length <= 1) return [];

    // 解析 Books 表頭
    var bookHeaders = booksData[0];
    var booksMap = {}; // book_id -> { book, purchases: [] }

    for (var r = 1; r < booksData.length; r++) {
      var row = booksData[r];
      var bookId = String(row[0] || '').trim();
      if (!bookId) continue;

      var bookObj = {
        book_id: bookId,
        title: String(row[1] || '').trim(),
        subtitle: String(row[2] || '').trim(),
        author: String(row[3] || '').trim(),
        translator: String(row[4] || '').trim(),
        isbn_13: String(row[5] || '').trim(),
        isbn_10: String(row[6] || '').trim(),
        publisher: String(row[7] || '').trim(),
        publication_date: String(row[8] || '').trim(),
        language: String(row[9] || '繁體中文').trim(),
        cover_url: String(row[10] || '').trim(),
        google_books_id: String(row[11] || '').trim(),
        created_at: row[12],
        updated_at: row[13]
      };

      booksMap[bookId] = {
        book: bookObj,
        purchases: []
      };
    }

    // 解析 Purchases 表頭並關聯至 Books
    if (purchasesData.length > 1) {
      for (var p = 1; p < purchasesData.length; p++) {
        var pRow = purchasesData[p];
        var pId = String(pRow[0] || '').trim();
        var fBookId = String(pRow[1] || '').trim();
        if (!pId || !fBookId) continue;

        var purchaseObj = {
          purchase_id: pId,
          book_id: fBookId,
          request_id: String(pRow[2] || '').trim(),
          purchase_date: pRow[3] instanceof Date ? Utilities.formatDate(pRow[3], 'Asia/Taipei', 'yyyy-MM-dd') : String(pRow[3] || ''),
          channel: String(pRow[4] || '').trim(),
          format: String(pRow[5] || 'PHYSICAL').trim(),
          price: Number(pRow[6] || 0),
          currency: String(pRow[7] || 'TWD').trim(),
          status: String(pRow[8] || 'ACTIVE').trim(),
          edition_note: String(pRow[9] || '').trim(),
          location: String(pRow[10] || '').trim(),
          notes: String(pRow[11] || '').trim(),
          provenance: String(pRow[12] || '{}').trim(),
          created_at: pRow[13]
        };

        if (booksMap[fBookId]) {
          booksMap[fBookId].purchases.push(purchaseObj);
        }
      }
    }

    var resultList = [];
    for (var k in booksMap) {
      resultList.push(booksMap[k]);
    }
    return resultList;
  }

  /**
   * 檢查 request_id 是否已經存在於 Purchases 表中 (冪等性校驗)
   */
  function findPurchaseByRequestId(requestId) {
    if (!requestId) return null;
    var ss = getSpreadsheet();
    var pSheet = ss.getSheetByName('Purchases');
    if (!pSheet) return null;

    var data = pSheet.getDataRange().getValues();
    if (data.length <= 1) return null;

    for (var i = 1; i < data.length; i++) {
      if (String(data[i][2]).trim() === requestId.trim()) {
        return {
          purchase_id: data[i][0],
          book_id: data[i][1],
          request_id: data[i][2]
        };
      }
    }
    return null;
  }

  /**
   * 排他鎖保護的雙表一致性寫入 (含補償回滾與冪等防重)
   */
  function saveBookAndPurchase(requestId, bookData, purchaseData) {
    var lock = LockService.getScriptLock();
    var lockAcquired = false;

    try {
      lockAcquired = lock.tryLock(10000); // 等待最多 10 秒
      if (!lockAcquired) {
        throw new Error('LOCK_TIMEOUT: 系統繁忙，未能取得排他鎖，請稍後再試。');
      }

      var ss = getSpreadsheet();
      var booksSheet = ss.getSheetByName('Books');
      var purchasesSheet = ss.getSheetByName('Purchases');

      if (!booksSheet || !purchasesSheet) {
        throw new Error('試算表缺少 Books 或 Purchases 工作表，請先執行初始化。');
      }

      // 1. 冪等性校驗：若 request_id 已存在，直接回傳歷史成功結果 (IDEMPOTENCY_REPLAY)
      var existingPurchase = findPurchaseByRequestId(requestId);
      if (existingPurchase) {
        Logger.log('🔁 [Idempotency] 偵測到重複 request_id: ' + requestId + '，觸發重播。');
        return {
          is_replay: true,
          book_id: existingPurchase.book_id,
          purchase_id: existingPurchase.purchase_id
        };
      }

      // 2. 尋找既有書目 (ISBN 或完全相符書名)
      var targetBookId = null;
      var isNewBookCreated = false;
      var booksRows = booksSheet.getDataRange().getValues();
      var nowIso = new Date().toISOString();

      var cleanIsbn13 = bookData.isbn_13 ? String(bookData.isbn_13).replace(/[^0-9X]/gi, '') : '';
      for (var b = 1; b < booksRows.length; b++) {
        var rowIsbn = String(booksRows[b][5] || '').replace(/[^0-9X]/gi, '');
        var rowTitle = String(booksRows[b][1] || '').trim();
        if (cleanIsbn13 && rowIsbn && cleanIsbn13 === rowIsbn) {
          targetBookId = booksRows[b][0];
          break;
        }
        if (rowTitle && bookData.title && rowTitle === String(bookData.title).trim()) {
          targetBookId = booksRows[b][0];
          break;
        }
      }

      var newlyAddedBookRowIndex = -1;

      // 若為新書，寫入 Books 表
      if (!targetBookId) {
        var datePrefix = Utilities.formatDate(new Date(), 'Asia/Taipei', 'yyyyMMdd');
        var seq = booksRows.length; // 序號
        targetBookId = 'BK-' + datePrefix + '-' + ('000' + seq).slice(-3);

        var newBookRow = [
          targetBookId,
          bookData.title || '',
          bookData.subtitle || '',
          bookData.author || '',
          bookData.translator || '',
          cleanIsbn13 || '',
          bookData.isbn_10 || '',
          bookData.publisher || '',
          bookData.publication_date || '',
          bookData.language || '繁體中文',
          bookData.cover_url || '',
          bookData.google_books_id || '',
          nowIso,
          nowIso
        ];

        booksSheet.appendRow(newBookRow);
        newlyAddedBookRowIndex = booksSheet.getLastRow();
        isNewBookCreated = true;
      }

      // 3. 寫入 Purchases 表
      var purchaseId = null;
      try {
        var pRows = purchasesSheet.getDataRange().getValues();
        var datePrefixP = Utilities.formatDate(new Date(), 'Asia/Taipei', 'yyyyMMdd');
        var seqP = pRows.length;
        purchaseId = 'PC-' + datePrefixP + '-' + ('000' + seqP).slice(-3);

        var purchaseDateStr = purchaseData.purchase_date || Utilities.formatDate(new Date(), 'Asia/Taipei', 'yyyy-MM-dd');

        var newPurchaseRow = [
          purchaseId,
          targetBookId,
          requestId,
          purchaseDateStr,
          purchaseData.channel || '博客來',
          purchaseData.format || 'PHYSICAL',
          Number(purchaseData.price || 0),
          purchaseData.currency || 'TWD',
          purchaseData.status || 'ACTIVE',
          purchaseData.edition_note || '',
          purchaseData.location || '',
          purchaseData.notes || '',
          typeof purchaseData.provenance === 'string' ? purchaseData.provenance : JSON.stringify(purchaseData.provenance || {}),
          nowIso
        ];

        purchasesSheet.appendRow(newPurchaseRow);
      } catch (pErr) {
        // 4. 補償性回滾：若為新書且 Purchase 失敗，將孤兒 Book 刪除以保一致性
        if (isNewBookCreated && newlyAddedBookRowIndex > 0) {
          Logger.log('⚠️ [Compensating Rollback] Purchases 寫入失敗，回滾清除孤兒書籍列: ' + newlyAddedBookRowIndex);
          booksSheet.deleteRow(newlyAddedBookRowIndex);
        }
        throw new Error('PURCHASE_WRITE_FAILED: ' + pErr.message);
      }

      return {
        is_replay: false,
        book_id: targetBookId,
        purchase_id: purchaseId
      };
    } finally {
      if (lockAcquired) {
        lock.releaseLock();
      }
    }
  }

  return {
    loadAllBooksWithPurchases: loadAllBooksWithPurchases,
    findPurchaseByRequestId: findPurchaseByRequestId,
    saveBookAndPurchase: saveBookAndPurchase,
    getSpreadsheet: getSpreadsheet
  };
})();
