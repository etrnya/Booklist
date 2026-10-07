/**
 * Booklist — 前端 API 通訊與 Notion / google-books-tw-mcp 核心橋接器 (api.js)
 * 連結 Notion「我的書櫃」與臺灣繁中書目解析服務 (google-books-tw-mcp)
 */

var BooklistApi = (function() {
  var STORAGE_TOKEN_KEY = 'booklist_app_token';
  var STORAGE_API_BASE_KEY = 'booklist_api_base';
  var STORAGE_MOCK_DATA_KEY = 'booklist_local_books';
  var STORAGE_GEMINI_KEY = 'booklist_gemini_api_key';
  var STORAGE_AI_MODEL_KEY = 'booklist_ai_model';
  var STORAGE_NOTION_KEY = 'booklist_notion_key';
  var STORAGE_NOTION_DB_KEY = 'booklist_notion_db';

  var mockBooksCache = null;

  function getGeminiKey() {
    return localStorage.getItem(STORAGE_GEMINI_KEY) || '';
  }

  function setGeminiKey(key) {
    if (key) {
      localStorage.setItem(STORAGE_GEMINI_KEY, key.trim());
    } else {
      localStorage.removeItem(STORAGE_GEMINI_KEY);
    }
  }

  function getSelectedModel() {
    return localStorage.getItem(STORAGE_AI_MODEL_KEY) || 'gemini-2.5-flash';
  }

  function setSelectedModel(model) {
    if (model) {
      localStorage.setItem(STORAGE_AI_MODEL_KEY, model.trim());
    }
  }

  function getNotionKey() {
    return localStorage.getItem(STORAGE_NOTION_KEY) || '';
  }

  function setNotionKey(key) {
    if (key) {
      localStorage.setItem(STORAGE_NOTION_KEY, key.trim());
    } else {
      localStorage.removeItem(STORAGE_NOTION_KEY);
    }
  }

  function getNotionDbId() {
    return localStorage.getItem(STORAGE_NOTION_DB_KEY) || '45ff2f17-8ffe-4bf5-8d41-7fc0dfece19f';
  }

  function setNotionDbId(id) {
    if (id) {
      localStorage.setItem(STORAGE_NOTION_DB_KEY, id.trim());
    }
  }

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
   * 調用 google-books-tw-mcp 搜尋書籍 (具備前端客戶端備援)
   */
  async function searchBooks(query) {
    var base = getApiBase();
    if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
      try {
        var res = await fetch(base + '/api/search?q=' + encodeURIComponent(query));
        if (res.ok) {
          var data = await res.json();
          if (data && data.success && data.books && data.books.length > 0) {
            return data;
          }
        }
      } catch (e) {
        console.warn('⚠️ [BooklistApi] 本地搜尋 API 失敗，切換至前端直連解析:', e);
      }
    }

    // 前端直連 Google Books 公開端點 (支援 GitHub Pages 靜態運作)
    try {
      var gRes = await fetch('https://www.googleapis.com/books/v1/volumes?q=' + encodeURIComponent(query) + '&maxResults=5');
      if (gRes.ok) {
        var gData = await gRes.json();
        var items = gData.items || [];
        var books = items.map(function(item) {
          var vi = item.volumeInfo || {};
          var isbns = (vi.industryIdentifiers || []).map(function(id) { return id.identifier; });
          var isbn13 = isbns.find(function(i) { return i.length === 13; }) || isbns[0] || '';
          var cover = '';
          if (vi.imageLinks) {
            cover = (vi.imageLinks.thumbnail || vi.imageLinks.smallThumbnail || '').replace('http://', 'https://');
          }
          if (isbn13 && (!cover || cover.includes('zoom=1'))) {
            var lastDigit = isbn13.slice(-1);
            cover = 'https://p6.sanmin.com.tw/promote_images/' + lastDigit + '/' + isbn13 + '.jpg';
          }
          return {
            title: vi.title || query,
            authors: vi.authors || ['未知作者'],
            publisher: vi.publisher || '未知出版社',
            publishedDate: vi.publishedDate || '',
            description: vi.description || '',
            isbn: isbn13,
            isbn_13: isbn13,
            cover_url: cover,
            preview_link: vi.previewLink || ''
          };
        });
        return { success: true, count: books.length, books: books };
      }
    } catch (gErr) {
      console.warn('⚠️ [BooklistApi] 前端直連 Google Books 失敗:', gErr);
    }

    return { success: false, books: [] };
  }

  /**
   * 調用 google-books-tw-mcp 解析書籍身分、出版版本與高解析書封
   */
  async function resolveBook(target) {
    var base = getApiBase();
    if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
      try {
        var res = await fetch(base + '/api/resolve?target=' + encodeURIComponent(target));
        if (res.ok) {
          var data = await res.json();
          if (data && data.success && data.found) {
            return data;
          }
        }
      } catch (e) {
        console.warn('⚠️ [BooklistApi] 本地解析 API 失敗，切換至前端直連:', e);
      }
    }

    // 前端備援解析
    var s = await searchBooks(target);
    if (s.success && s.books && s.books.length > 0) {
      return { success: true, found: true, book: s.books[0] };
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

    // 3. 視覺辨識提取書名 (Vision OCR)
    if (action === 'VISION_EXTRACT') {
      var geminiKey = getGeminiKey();
      var model = getSelectedModel();

      if (!geminiKey) {
        return {
          success: false,
          error: { message: '尚未設定 Google Gemini API Key。請至「⚙️ 系統設定」輸入金鑰以啟用拍照辨識。' }
        };
      }

      try {
        var visionResult = await extractBookFromImage(payload.image_base64, payload.mime_type, geminiKey, model);
        if (visionResult && visionResult.title) {
          return {
            success: true,
            request_id: requestId,
            data: visionResult,
            error: null
          };
        }
      } catch (vErr) {
        return {
          success: false,
          error: { message: vErr.message || 'AI 視覺辨識失敗，請檢查金鑰或改用手動搜尋' }
        };
      }

      return {
        success: false,
        error: { message: '未能從相片辨識出清晰書名，請嘗試重新拍照或手動輸入' }
      };
    }

    // 4. 認證檢查
    if (action === 'AUTH_VERIFY') {
      return {
        success: true,
        request_id: requestId,
        data: { is_valid: true, user_message: 'Notion 書櫃與 google-books-tw-mcp 核心在線' },
        error: null
      };
    }

    // 5. 設定
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
   * 測試 Google Gemini API 連線
   */
  async function testGeminiConnection(apiKey, model) {
    var key = (apiKey || getGeminiKey() || '').trim();
    var m = (model || getSelectedModel() || 'gemini-2.5-flash').trim();

    if (!key) {
      return { success: false, message: '請先輸入 Gemini API Key' };
    }

    var startTime = performance.now();
    var url = 'https://generativelanguage.googleapis.com/v1beta/models/' + encodeURIComponent(m) + ':generateContent?key=' + encodeURIComponent(key);

    try {
      var res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{
            parts: [{ text: '請只回覆一個單詞：OK' }]
          }]
        })
      });

      var latency = Math.round(performance.now() - startTime);

      if (res.ok) {
        var data = await res.json();
        var reply = '';
        try {
          reply = data.candidates[0].content.parts[0].text.trim();
        } catch (e) {}
        return {
          success: true,
          latency: latency,
          model: m,
          message: '🟢 連線成功！模型響應正常 (' + latency + 'ms)'
        };
      } else {
        var errJson = await res.json().catch(function() { return {}; });
        var errDetail = (errJson.error && errJson.error.message) ? errJson.error.message : ('HTTP ' + res.status);
        return {
          success: false,
          latency: latency,
          message: '🔴 連線失敗：' + errDetail
        };
      }
    } catch (netErr) {
      return {
        success: false,
        message: '🔴 網路異常或跨域被阻擋：' + netErr.message
      };
    }
  }

  /**
   * 使用 Gemini 進行書籍封面視覺 OCR 與實體辨識
   */
  async function extractBookFromImage(imageBase64, mimeType, apiKey, model) {
    var key = apiKey || getGeminiKey();
    var m = model || getSelectedModel();

    if (!key) throw new Error('缺少 Gemini API Key');

    var url = 'https://generativelanguage.googleapis.com/v1beta/models/' + encodeURIComponent(m) + ':generateContent?key=' + encodeURIComponent(key);

    var promptText = '你是一位專業的繁體中文圖書採購辨識專家。請仔細分析這張書籍封面照片，辨識出：1. 正確書名（主標題，忽略出版社徽標）2. 作者姓名 3. 出版社 4. 若封面上有 ISBN 條碼或數字請一併提取。請嚴格只輸出 JSON，格式如下：{"title":"書名","author":"作者","publisher":"出版社","isbn":""}，不要輸出任何額外解釋文字。';

    var res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{
          parts: [
            { text: promptText },
            {
              inline_data: {
                mime_type: mimeType || 'image/jpeg',
                data: imageBase64
              }
            }
          ]
        }],
        generationConfig: {
          response_mime_type: 'application/json'
        }
      })
    });

    if (!res.ok) {
      var errData = await res.json().catch(function() { return {}; });
      throw new Error(errData.error && errData.error.message ? errData.error.message : ('HTTP ' + res.status));
    }

    var resultData = await res.json();
    var rawText = resultData.candidates[0].content.parts[0].text;
    
    // 清理可能的 markdown codeblock
    var cleaned = rawText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    return JSON.parse(cleaned);
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
    getGeminiKey: getGeminiKey,
    setGeminiKey: setGeminiKey,
    getSelectedModel: getSelectedModel,
    setSelectedModel: setSelectedModel,
    getNotionKey: getNotionKey,
    setNotionKey: setNotionKey,
    getNotionDbId: getNotionDbId,
    setNotionDbId: setNotionDbId,
    testGeminiConnection: testGeminiConnection,
    extractBookFromImage: extractBookFromImage,
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
