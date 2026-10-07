/**
 * Booklist — 資料庫初始化與結構維護 (DatabaseInitializer.js)
 * 嚴格遵循 DATA_SCHEMA.md 自動建立 Books、Purchases 與 Settings 工作表及標頭
 */

var DatabaseInitializer = (function() {
  function initDatabase() {
    var ss = StorageManager.getSpreadsheet();

    // 1. 初始化 Books 工作表
    var booksSheet = ss.getSheetByName('Books');
    if (!booksSheet) {
      booksSheet = ss.insertSheet('Books');
    }
    if (booksSheet.getLastRow() === 0) {
      var bookHeaders = [
        '書籍識別碼 (book_id)',
        '正書名 (title)',
        '副標題 (subtitle)',
        '作者 (author)',
        '譯者 (translator)',
        'ISBN-13 (isbn_13)',
        'ISBN-10 (isbn_10)',
        '出版社 (publisher)',
        '出版日期 (publication_date)',
        '語言 (language)',
        '封面圖網址 (cover_url)',
        'Google Books ID (google_books_id)',
        '建立時間 (created_at)',
        '最後更新 (updated_at)'
      ];
      booksSheet.appendRow(bookHeaders);
      booksSheet.getRange(1, 1, 1, bookHeaders.length).setFontWeight('bold').setBackground('#E8F0FE');
      booksSheet.setFrozenRows(1);
    }

    // 2. 初始化 Purchases 工作表
    var purchasesSheet = ss.getSheetByName('Purchases');
    if (!purchasesSheet) {
      purchasesSheet = ss.insertSheet('Purchases');
    }
    if (purchasesSheet.getLastRow() === 0) {
      var purchaseHeaders = [
        '購買識別碼 (purchase_id)',
        '書籍版本識別碼 (book_id)',
        '請求冪等識別碼 (request_id)',
        '購買日期 (purchase_date)',
        '購買通路 (channel)',
        '書籍形式 (format)',
        '實付金額 (price)',
        '幣別 (currency)',
        '持有狀態 (status)',
        '版本備註 (edition_note)',
        '存放位置/載具 (location)',
        '備註說明 (notes)',
        '資料來源血統 (provenance)',
        '建立時間 (created_at)'
      ];
      purchasesSheet.appendRow(purchaseHeaders);
      purchasesSheet.getRange(1, 1, 1, purchaseHeaders.length).setFontWeight('bold').setBackground('#E6F4EA');
      purchasesSheet.setFrozenRows(1);
    }

    // 3. 初始化 Settings 工作表 (嚴禁存放金鑰)
    var settingsSheet = ss.getSheetByName('Settings');
    if (!settingsSheet) {
      settingsSheet = ss.insertSheet('Settings');
    }
    if (settingsSheet.getLastRow() === 0) {
      var settingsHeaders = ['設定鍵值 (key)', '設定內容 (value)', '說明備註 (description)'];
      settingsSheet.appendRow(settingsHeaders);
      settingsSheet.getRange(1, 1, 1, settingsHeaders.length).setFontWeight('bold').setBackground('#FEF7E0');
      settingsSheet.setFrozenRows(1);

      var defaultSettings = [
        ['CHANNEL_OPTIONS', '博客來,誠品,Kobo,Readmoo,讀冊,三民,實體書店,二手書店', '前端購書通路快捷選單'],
        ['FORMAT_OPTIONS', 'PHYSICAL,EBOOK,AUDIOBOOK', '書籍存在形式選項 (實體書/電子書/有聲書)'],
        ['DEFAULT_CURRENCY', 'TWD', '預設記帳幣別'],
        ['SIMILARITY_THRESHOLD', '0.85', '模糊比對提示門檻 (Invariant D1)']
      ];
      for (var s = 0; s < defaultSettings.length; s++) {
        settingsSheet.appendRow(defaultSettings[s]);
      }
    }

    Logger.log('🎉 [DatabaseInitializer] 試算表結構初始化成功！');
    return { success: true, message: '資料庫初始化完成' };
  }

  return {
    initDatabase: initDatabase
  };
})();
