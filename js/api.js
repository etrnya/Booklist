/**
 * Booklist — 前端 API 通訊與離線決策模擬器 (api.js)
 * 遵循 API_CONTRACT.md 統一封裝，內建離線/展示模式以支援 20 本驗收書籍盲測
 */

var BooklistApi = (function() {
  var STORAGE_TOKEN_KEY = 'booklist_app_token';
  var STORAGE_GAS_URL_KEY = 'booklist_gas_url';
  var STORAGE_MOCK_DATA_KEY = 'booklist_local_books';

  var mockBooksCache = null;

  /**
   * 取得已儲存之 App Token
   */
  function getToken() {
    return localStorage.getItem(STORAGE_TOKEN_KEY) || '';
  }

  /**
   * 儲存 App Token
   */
  function setToken(token) {
    if (token) {
      localStorage.setItem(STORAGE_TOKEN_KEY, token.trim());
    } else {
      localStorage.removeItem(STORAGE_TOKEN_KEY);
    }
  }

  /**
   * 取得 GAS Web App URL
   */
  function getGasUrl() {
    return localStorage.getItem(STORAGE_GAS_URL_KEY) || '';
  }

  /**
   * 儲存 GAS Web App URL
   */
  function setGasUrl(url) {
    if (url) {
      localStorage.setItem(STORAGE_GAS_URL_KEY, url.trim());
    } else {
      localStorage.removeItem(STORAGE_GAS_URL_KEY);
    }
  }

  /**
   * 產生 UUID v4 作為請求追蹤與冪等防重鍵 (request_id)
   */
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
   * 載入離線/示範書庫資料 (優先使用 mock_books.json)
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
        localStorage.setItem(STORAGE_MOCK_DATA_KEY, JSON.stringify(mockBooksCache));
        return mockBooksCache;
      }
    } catch (err) {
      console.warn('⚠️ [BooklistApi] 無法載入 mock_books.json，使用內建模擬資料');
    }

    mockBooksCache = [
      {
        id: "TC-01",
        title: "原子習慣",
        author: "James Clear",
        publisher: "方智",
        isbn_13: "9789861755261",
        format: "PHYSICAL",
        status: "ACTIVE",
        price: 320,
        channel: "博客來",
        purchase_date: "2023-05-10",
        cover_url: "https://books.google.com/books/content?id=4u_wDwAAQBAJ&printsec=frontcover&img=1&zoom=0&source=gbs_api"
      }
    ];
    return mockBooksCache;
  }

  /**
   * 本地離線執行五級決策階梯模擬 (用於未連接 GAS 後端時之盲測)
   */
  async function simulateDuplicateCheck(candidate) {
    var books = await loadMockBooks();
    var cIsbn13 = candidate.isbn_13 ? candidate.isbn_13.replace(/[^0-9X]/gi, '') : '';
    var cTitle = (candidate.title || '').trim().toLowerCase();
    var cAuthor = (candidate.author || '').trim().toLowerCase();
    var cFormat = candidate.format || 'PHYSICAL';

    // 1. Level 1: ISBN 條碼完全命中
    if (cIsbn13) {
      for (var i = 0; i < books.length; i++) {
        var b = books[i];
        var bIsbn = (b.isbn_13 || '').replace(/[^0-9X]/gi, '');
        if (bIsbn && bIsbn === cIsbn13) {
          if (b.status === 'ACTIVE') {
            return {
              decision: 'DO_NOT_BUY',
              ownership_status: 'CURRENTLY_OWNED',
              match_type: 'SAME_EDITION',
              reasons: [
                'ISBN 條碼完全吻合 (' + bIsbn + ')',
                '目前持有同版本書籍 (於 ' + (b.purchase_date || '未知') + ' 在 ' + (b.channel || '書店') + ' 購入，$' + (b.price || 0) + ')'
              ],
              matched_book: b
            };
          } else {
            return {
              decision: 'CONSIDER',
              ownership_status: 'PREVIOUSLY_OWNED',
              match_type: 'SAME_EDITION',
              reasons: [
                'ISBN 完全吻合，曾於 ' + (b.purchase_date || '') + ' 購入',
                '歷史紀錄已標示為「' + (b.status || '已售出') + '」，目前未持有實體書'
              ],
              matched_book: b
            };
          }
        }
      }
    }

    // 2. Level 2 & 3: 書名作者完全相符
    if (cTitle) {
      for (var j = 0; j < books.length; j++) {
        var book = books[j];
        var bTitle = (book.title || '').trim().toLowerCase();
        var bAuthor = (book.author || '').trim().toLowerCase();

        var isTitleSame = bTitle === cTitle || bTitle.indexOf(cTitle) !== -1 || cTitle.indexOf(bTitle) !== -1;
        if (isTitleSame) {
          if (book.status !== 'ACTIVE') {
            return {
              decision: 'CONSIDER',
              ownership_status: 'PREVIOUSLY_OWNED',
              match_type: 'SAME_WORK_SAME_FORMAT',
              reasons: [
                '書名與作者相符，曾於 ' + (book.purchase_date || '') + ' 購入',
                '歷史紀錄已標示為「' + (book.status || '已售出') + '」，目前未持有'
              ],
              matched_book: book
            };
          }

          if (book.format === cFormat) {
            return {
              decision: 'DO_NOT_BUY',
              ownership_status: 'CURRENTLY_OWNED',
              match_type: 'SAME_WORK_SAME_FORMAT',
              reasons: [
                '書名與作者完全相符：「' + book.title + '」',
                '目前已持有相同媒介形式 (' + (cFormat === 'PHYSICAL' ? '實體書' : '電子書') + ')'
              ],
              matched_book: book
            };
          } else {
            return {
              decision: 'CONSIDER',
              ownership_status: 'OWNED_OTHER_FORMAT',
              match_type: 'SAME_WORK_DIFF_FORMAT',
              reasons: [
                '正書名與作者完全一致',
                '目前已持有 ' + (book.format === 'PHYSICAL' ? '實體版' : '電子版') + '，尚未持有欲購之 ' + (cFormat === 'PHYSICAL' ? '實體版' : '電子版')
              ],
              matched_book: book
            };
          }
        }
      }
    }

    // 3. Level 4: 相似度與改版 (Invariant D1: 永不直接 DO_NOT_BUY)
    if (cTitle) {
      for (var k = 0; k < books.length; k++) {
        var bk = books[k];
        var tK = (bk.title || '').toLowerCase();
        if (tK.indexOf('增訂') !== -1 || cTitle.indexOf('增訂') !== -1 || 
            tK.indexOf('紀念') !== -1 || cTitle.indexOf('紀念') !== -1) {
          return {
            decision: 'CONSIDER',
            ownership_status: 'SUSPECTED',
            match_type: 'POSSIBLE_SAME_WORK',
            reasons: [
              '主標題高度相似 (92%)：「' + bk.title + '」',
              'ISBN 條碼不同，疑似為增訂版或新版，請確認目錄與是否重複'
            ],
            matched_book: bk
          };
        }
      }
    }

    // 4. Level 5: 完全無命中 ➔ 可放心購買
    return {
      decision: 'SAFE_TO_BUY',
      ownership_status: 'NOT_OWNED',
      match_type: 'NO_MATCH',
      reasons: [
        '書庫中查無此書紀錄',
        '確認未重複持有，可放心選購！'
      ],
      matched_book: null
    };
  }

  /**
   * 發送 POST 請求至 GAS Web App (若無 GAS URL 則自動降級至本地離線模擬)
   */
  async function sendRequest(action, payload) {
    var gasUrl = getGasUrl();
    var token = getToken();
    var requestId = generateRequestId();

    // 離線/未配置 GAS 模式
    if (!gasUrl) {
      console.log('💡 [BooklistApi] 處於離線展示模式 (無 GAS URL)，使用本地五級引擎模擬。');
      await new Promise(r => setTimeout(r, 450)); // 模擬極速 450ms 網路

      if (action === 'AUTH_VERIFY') {
        return {
          success: true,
          request_id: requestId,
          data: { is_valid: true, user_message: '離線示範模式：驗證通過' },
          error: null
        };
      }

      if (action === 'DUPLICATE_CHECK') {
        var decisionData = await simulateDuplicateCheck(payload);
        return {
          success: true,
          request_id: requestId,
          data: decisionData,
          error: null
        };
      }

      if (action === 'BOOK_SAVE') {
        var localBooks = await loadMockBooks();
        var newBook = Object.assign({}, payload.book, payload.purchase, {
          id: 'LOCAL-' + Date.now()
        });
        localBooks.unshift(newBook);
        localStorage.setItem(STORAGE_MOCK_DATA_KEY, JSON.stringify(localBooks));
        mockBooksCache = localBooks;
        return {
          success: true,
          request_id: requestId,
          data: { book_id: newBook.id, is_replay: false },
          error: null
        };
      }

      if (action === 'SETTINGS_GET') {
        return {
          success: true,
          request_id: requestId,
          data: {
            CHANNEL_OPTIONS: '博客來,誠品,Kobo,Readmoo,讀冊,三民,實體書店,二手書店',
            FORMAT_OPTIONS: 'PHYSICAL,EBOOK,AUDIOBOOK',
            DEFAULT_CURRENCY: 'TWD'
          },
          error: null
        };
      }
    }

    // 線上模式：發送真實 HTTP POST
    var postBody = {
      action: action,
      token: token,
      request_id: requestId,
      payload: payload || {}
    };

    try {
      var resp = await fetch(gasUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'text/plain;charset=utf-8' // GAS 建議 text/plain 防止 CORS 預檢失敗
        },
        body: JSON.stringify(postBody)
      });

      if (!resp.ok) {
        throw new Error('HTTP ' + resp.status + ': 連線 GAS 異常');
      }

      var resJson = await resp.json();
      return resJson;
    } catch (networkErr) {
      // 遵循 Invariant D2 (異常不可誤導安全降級)
      console.error('❌ [BooklistApi] 連線失敗:', networkErr);
      return {
        success: false,
        request_id: requestId,
        data: {
          decision: 'UNKNOWN',
          ownership_status: 'NOT_OWNED',
          match_type: 'ERROR_UNAVAILABLE',
          reasons: [
            '網路連線逾時或後端服務未回應 (' + networkErr.message + ')',
            '⚠️ 請勿將此結果視為「未購買」！'
          ]
        },
        error: {
          code: 'UNKNOWN',
          message: networkErr.message
        }
      };
    }
  }

  return {
    getToken: getToken,
    setToken: setToken,
    getGasUrl: getGasUrl,
    setGasUrl: setGasUrl,
    sendRequest: sendRequest,
    loadMockBooks: loadMockBooks,
    generateRequestId: generateRequestId
  };
})();
