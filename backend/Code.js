/**
 * Booklist — Google Apps Script 主程式與 Web App 路由器 (Code.js)
 * 嚴格遵循 API_CONTRACT.md 與 PRD v1.0.2 通信規格
 */

/**
 * 處理 GET 請求：提供手機 PWA 前端網頁或系統健康檢查
 */
function doGet(e) {
  var isApi = e && e.parameter && e.parameter.api === 'true';
  if (isApi) {
    var response = {
      success: true,
      service: 'Booklist GAS Backend',
      version: 'v1.0.2',
      status: 'HEALTHY',
      timestamp: new Date().toISOString()
    };
    return ContentService.createTextOutput(JSON.stringify(response))
      .setMimeType(ContentService.MimeType.JSON);
  }

  // 預設渲染行動端 HTML (若直接透過 GAS Web App URL 瀏覽)
  try {
    var html = HtmlService.createHtmlOutputFromFile('Index')
      .setTitle('Booklist 智慧購書決策查重')
      .addMetaTag('viewport', 'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover')
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
    return html;
  } catch (err) {
    return ContentService.createTextOutput('Booklist Backend Online. Use frontend PWA or POST API.')
      .setMimeType(ContentService.MimeType.TEXT);
  }
}

/**
 * 處理 POST 請求：核心 API 端點與操作分發
 */
function doPost(e) {
  var requestId = 'REQ-UNKNOWN';
  var action = '';

  try {
    if (!e || !e.postData || !e.postData.contents) {
      return makeErrorResponse('INVALID_REQUEST', '缺少請求內容 (postData is empty)', requestId);
    }

    var body;
    try {
      body = JSON.parse(e.postData.contents);
    } catch (parseErr) {
      return makeErrorResponse('INVALID_REQUEST', '無法解析 JSON 酬載', requestId);
    }

    action = body.action || '';
    requestId = body.request_id || ('REQ-' + Utilities.getUuid());
    var token = body.token || '';
    var payload = body.payload || {};

    // 1. 權杖校驗門禁 (B3 Invariant)
    if (action === 'AUTH_VERIFY') {
      var isValid = AuthService.validateToken(token);
      if (!isValid) {
        return makeErrorResponse('AUTH_FAILED', '私人 App Token 驗證失敗', requestId);
      }
      return makeSuccessResponse({
        is_valid: true,
        user_message: '授權驗證成功'
      }, requestId);
    }

    // 其他所有 action 必須先通過 Token 驗證
    if (!AuthService.validateToken(token)) {
      return makeErrorResponse('AUTH_FAILED', '未經授權之請求 (AUTH_FAILED)', requestId);
    }

    // 2. 路由分發 (Action Dispatcher)
    switch (action) {
      case 'DUPLICATE_CHECK':
        return handleDuplicateCheck(payload, requestId);

      case 'VISION_EXTRACT':
        return handleVisionExtract(payload, requestId);

      case 'METADATA_FETCH':
        return handleMetadataFetch(payload, requestId);

      case 'BOOK_SAVE':
        return handleBookSave(payload, requestId);

      case 'SETTINGS_GET':
        return handleSettingsGet(requestId);

      case 'INIT_DATABASE':
        var initResult = DatabaseInitializer.initDatabase();
        return makeSuccessResponse(initResult, requestId);

      default:
        return makeErrorResponse('INVALID_REQUEST', '未知之 action 操作: ' + action, requestId);
    }
  } catch (globalErr) {
    Logger.log('💥 [doPost Exception]: ' + globalErr.toString());
    return makeErrorResponse('UNKNOWN', globalErr.message || '伺服器未預期錯誤', requestId);
  }
}

// ============================================================================
// 各 Action 處理函式 (Action Handlers)
// ============================================================================

/**
 * 執行五級查重階梯
 */
function handleDuplicateCheck(candidate, requestId) {
  if (!candidate || (!candidate.isbn_13 && !candidate.isbn_10 && !candidate.title)) {
    return makeErrorResponse('INVALID_REQUEST', '查重需提供 ISBN 或正書名', requestId);
  }

  var allBooks = StorageManager.loadAllBooksWithPurchases();
  var evalResult = DecisionLadder.evaluate(candidate, allBooks);

  return makeSuccessResponse(evalResult, requestId);
}

/**
 * 呼叫 Gemini 2.5 Flash 擷取相片文字
 */
function handleVisionExtract(payload, requestId) {
  if (!payload || !payload.image_base64) {
    return makeErrorResponse('INVALID_REQUEST', '缺少 image_base64 圖片資料', requestId);
  }

  var visionRes = VisionService.extractBookInfoFromImage(payload.image_base64, payload.mime_type);
  if (!visionRes.success) {
    return makeErrorResponse(visionRes.error || 'VISION_ERROR', visionRes.message || '辨識失敗', requestId);
  }

  return makeSuccessResponse(visionRes.data, requestId);
}

/**
 * 查詢 Google Books 中繼資料
 */
function handleMetadataFetch(payload, requestId) {
  var metaRes = MetadataService.fetchMetadata(payload);
  if (!metaRes.success) {
    return makeErrorResponse(metaRes.error || 'METADATA_UNAVAILABLE', metaRes.message || '無法取得中繼資料', requestId);
  }

  return makeSuccessResponse(metaRes, requestId);
}

/**
 * 排他鎖雙表儲存入庫
 */
function handleBookSave(payload, requestId) {
  var bookData = payload.book || {};
  var purchaseData = payload.purchase || {};

  if (!bookData.title && !bookData.isbn_13) {
    return makeErrorResponse('INVALID_REQUEST', '儲存書籍必須具備書名或 ISBN', requestId);
  }

  try {
    var saveResult = StorageManager.saveBookAndPurchase(requestId, bookData, purchaseData);
    return makeSuccessResponse(saveResult, requestId);
  } catch (saveErr) {
    var errMsg = saveErr.message || '';
    if (errMsg.indexOf('LOCK_TIMEOUT') !== -1) {
      return makeErrorResponse('LOCK_TIMEOUT', errMsg, requestId);
    }
    return makeErrorResponse('WRITE_FAILED', errMsg, requestId);
  }
}

/**
 * 讀取 Settings 選單設定
 */
function handleSettingsGet(requestId) {
  var ss = StorageManager.getSpreadsheet();
  var sSheet = ss.getSheetByName('Settings');
  var settings = {};

  if (sSheet && sSheet.getLastRow() > 1) {
    var rows = sSheet.getDataRange().getValues();
    for (var i = 1; i < rows.length; i++) {
      var key = String(rows[i][0] || '').trim();
      var val = String(rows[i][1] || '').trim();
      if (key) {
        settings[key] = val;
      }
    }
  }

  return makeSuccessResponse(settings, requestId);
}

// ============================================================================
// 標準通訊封裝輔助函式 (Response Envelopes)
// ============================================================================

function makeSuccessResponse(data, requestId) {
  var envelope = {
    success: true,
    request_id: requestId,
    data: data,
    error: null
  };
  return ContentService.createTextOutput(JSON.stringify(envelope))
    .setMimeType(ContentService.MimeType.JSON);
}

function makeErrorResponse(code, message, requestId) {
  var envelope = {
    success: false,
    request_id: requestId,
    data: null,
    error: {
      code: code,
      message: message
    }
  };
  return ContentService.createTextOutput(JSON.stringify(envelope))
    .setMimeType(ContentService.MimeType.JSON);
}
