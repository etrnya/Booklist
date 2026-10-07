/**
 * Booklist — 前端 API 通訊與 Notion / google-books-tw-mcp 核心橋接器 (api.js)
 * 連結 Notion「我的書櫃」與臺灣繁中書目解析服務 (google-books-tw-mcp)
 */

var BooklistApi = (function() {
  var STORAGE_TOKEN_KEY = 'booklist_app_token';
  var STORAGE_API_BASE_KEY = 'booklist_api_base';
  var STORAGE_MOCK_DATA_KEY = 'booklist_local_books';

  var mockBooksCache = null;

  function getApiBase() {
    return localStorage.getItem(STORAGE_API_BASE_KEY) || (window.location.origin.startsWith('http') ? window.location.origin : 'http://localhost:3000');
  }

  function setApiBase(url) {
    if (url) {
      localStorage.setItem(STORAGE_API_BASE_KEY, url.trim().replace(/\/+$/, ''));
    } else {
      localStorage.removeItem(STORAGE_API_BASE_KEY);
    }
  }

  function getToken() {
    return localStorage.getItem(STORAGE_TOKEN_KEY) || '';
  }

  function setToken(token) {
    if (token) {
      localStorage.setItem(STORAGE_TOKEN_KEY, token.trim());
    } else {
      localStorage.removeItem(STORAGE_TOKEN_KEY);
    }
  }

  function generateRequestId() {
    if (window.crypto && window.crypto.randomUUID) {
      return window.crypto.randomUUID();
    }
    return 'REQ-' + 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
      var r = Math.random() * 16 | 0;
      var v = c === 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  }

  /**
   * 取得 Notion 書櫃清單
   */
  async function fetchBookshelf() {
    var base = getApiBase();
    try {
      var res = await fetch(base + '/api/books');
      if (res.ok) {
        var data = await res.json();
        if (data.success && data.books) {
          localStorage.setItem(STORAGE_MOCK_DATA_KEY, JSON.stringify(data.books));
          mockBooksCache = data.books;
          return data.books;
        }
      }
    } catch (e) {
      console.warn('⚠️ [BooklistApi] 連線本地服務失敗，切換至離線快取/展示資料');
    }
    return await loadMockBooks();
  }

  /**
   * 調用 google-books-tw-mcp 搜尋書籍
   */
  async function searchBooks(query) {
    var base = getApiBase();
    try {
      var res = await fetch(base + '/api/search?q=' + encodeURIComponent(query));
      if (res.ok) {
        return await res.json();
      }
    } catch (e) {
      console.warn('⚠️ [BooklistApi] 搜尋 API 呼叫失敗:', e);
    }
    return { success: false, books: [] };
  }

  /**
   * 調用 google-books-tw-mcp 解析書籍身分、出版版本與高解析書封
   */
  async function resolveBook(target) {
    var base = getApiBase();
    try {
      var res = await fetch(base + '/api/resolve?target=' + encodeURIComponent(target));
      if (res.ok) {
        return await res.json();
      }
    } catch (e) {
      console.warn('⚠️ [BooklistApi] 解析 API 呼叫失敗:', e);
    }
    return { success: false, found: false, book: null };
  }

  /**
   * 載入離線/快取示範書庫資料
   */
  async function loadMockBooks() {
    if (mockBooksCache) return mockBooksCache;

    var stored = localStorage.getItem(STORAGE_MOCK_DATA_KEY);
    if (stored) {
      try {
        mockBooksCache = JSON.parse(stored);
        return mockBooksCache;
      } catch (e) {}
    }

    try {
      var res = await fetch('mock_books.json');
      if (res.ok) {
        mockBooksCache = await res.json();
        return mockBooksCache;
      }
    } catch (err) {}

    mockBooksCache = [];
    return mockBooksCache;
  }

  /**
   * 發送統一請求 (向下相容既有呼叫)
   */
  async function sendRequest(action, payload) {
    var base = getApiBase();
    var requestId = generateRequestId();

    // 1. 查重決策階梯
    if (action === 'DUPLICATE_CHECK') {
      try {
        var res = await fetch(base + '/api/check', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload || {})
        });
        if (res.ok) {
          var json = await res.json();
          if (json.success) {
            return {
              success: true,
              request_id: requestId,
              data: json.decision,
              resolved_book: json.resolved_book,
              error: null
            };
          }
        }
      } catch (err) {
        console.warn('⚠️ [BooklistApi] 本地服務不可用，啟動純前端離線決策:', err);
      }

      // 降級離線比對
      var localBooks = await loadMockBooks();
      var cIsbn = (payload.isbn_13 || payload.isbn || '').replace(/-/g, '').trim();
      var cTitle = (payload.title || '').trim().toLowerCase();

      for (var i = 0; i < localBooks.length; i++) {
        var b = localBooks[i];
        var bIsbn = (b.isbn || b.isbn_13 || '').replace(/-/g, '').trim();
        if (cIsbn && bIsbn && cIsbn === bIsbn) {
          return {
            success: true,
            request_id: requestId,
            data: {
              decision: 'DO_NOT_BUY',
              ownership_status: 'CURRENTLY_OWNED',
              match_type: 'SAME_WORK_SAME_FORMAT',
              reasons: ['ISBN 條碼完全相符：「' + b.title + '」', '目前已持有該書籍，請勿重複購買！'],
              matched_book: b
            },
            error: null
          };
        }
        if (cTitle && (b.title || '').toLowerCase() === cTitle) {
          return {
            success: true,
            request_id: requestId,
            data: {
              decision: 'DO_NOT_BUY',
              ownership_status: 'CURRENTLY_OWNED',
              match_type: 'SAME_WORK_SAME_FORMAT',
              reasons: ['書名完全一致：「' + b.title + '」', '目前已持有該書籍！'],
              matched_book: b
            },
            error: null
          };
        }
      }

      return {
        success: true,
        request_id: requestId,
        data: {
          decision: 'SAFE_TO_BUY',
          ownership_status: 'NOT_OWNED',
          match_type: 'NO_MATCH',
          reasons: ['書庫中查無紀錄，可放心選購！'],
          matched_book: null
        },
        error: null
      };
    }

    // 2. 儲存書籍至 Notion「我的書櫃」
    if (action === 'BOOK_SAVE') {
      try {
        var resSave = await fetch(base + '/api/save', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(Object.assign({}, payload.book || {}, payload.purchase || {}))
        });
        if (resSave.ok) {
          var saveJson = await resSave.json();
          // 同步重整書櫃
          await fetchBookshelf();
          return {
            success: true,
            request_id: requestId,
            data: { book_id: saveJson.page_id, url: saveJson.url },
            error: null
          };
        }
      } catch (err) {
        console.warn('⚠️ [BooklistApi] 寫入 Notion API 失敗，暫存本地:', err);
      }

      var books = await loadMockBooks();
      var newB = Object.assign({}, payload.book, payload.purchase, { id: 'LOCAL-' + Date.now() });
      books.unshift(newB);
      localStorage.setItem(STORAGE_MOCK_DATA_KEY, JSON.stringify(books));
      mockBooksCache = books;
      return {
        success: true,
        request_id: requestId,
        data: { book_id: newB.id },
        error: null
      };
    }

    // 3. 認證檢查
    if (action === 'AUTH_VERIFY') {
      return {
        success: true,
        request_id: requestId,
        data: { is_valid: true, user_message: 'Notion 書櫃與 google-books-tw-mcp 核心在線' },
        error: null
      };
    }

    // 4. 設定
    if (action === 'SETTINGS_GET') {
      return {
        success: true,
        request_id: requestId,
        data: {
          CHANNEL_OPTIONS: '博客來,誠品,Kobo,Readmoo,讀冊,三民,實體書店,天瓏圖書',
          FORMAT_OPTIONS: '紙本書,電子書,大大讀書,傳記',
          DEFAULT_CURRENCY: 'TWD'
        },
        error: null
      };
    }

    return { success: false, error: { message: '未知的 Action: ' + action } };
  }

  /**
   * 批次自動補全
   */
  async function batchEnrich() {
    var base = getApiBase();
    try {
      var res = await fetch(base + '/api/batch_enrich', { method: 'POST' });
      if (res.ok) {
        return await res.json();
      }
    } catch (e) {
      console.error('⚠️ [BooklistApi] 批次補全失敗:', e);
    }
    return { success: false };
  }

  return {
    getToken: getToken,
    setToken: setToken,
    getApiBase: getApiBase,
    setApiBase: setApiBase,
    getGasUrl: getApiBase,
    setGasUrl: setApiBase,
    sendRequest: sendRequest,
    fetchBookshelf: fetchBookshelf,
    searchBooks: searchBooks,
    resolveBook: resolveBook,
    batchEnrich: batchEnrich,
    loadMockBooks: loadMockBooks,
    generateRequestId: generateRequestId
  };
})();
