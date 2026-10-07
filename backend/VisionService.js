/**
 * Booklist — 視覺文字擷取服務 (VisionService.js)
 * 呼叫 Gemini 2.5 Flash 僅進行事實文字擷取，嚴禁無中生有編造元資料
 */

var VisionService = (function() {
  var GEMINI_API_KEY_NAME = 'GEMINI_API_KEY';
  var GEMINI_ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent';

  /**
   * 呼叫 Gemini 2.5 Flash 分析照片
   * @param {string} imageBase64 - 壓縮後之 Base64 圖片字串 (不含 data:image/...;base64, 前綴)
   * @param {string} mimeType - 預設 image/jpeg
   * @return {Object} { raw_isbn, raw_title, raw_author, raw_publisher, confidence }
   */
  function extractBookInfoFromImage(imageBase64, mimeType) {
    var props = PropertiesService.getScriptProperties();
    var apiKey = props.getProperty(GEMINI_API_KEY_NAME);

    if (!apiKey) {
      Logger.log('⚠️ [VisionService] 未配置 GEMINI_API_KEY，降級處理。');
      return {
        success: false,
        error: 'MISSING_GEMINI_KEY',
        message: '未在後端配置 GEMINI_API_KEY'
      };
    }

    var cleanBase64 = imageBase64.replace(/^data:image\/\w+;base64,/, '');
    var mType = mimeType || 'image/jpeg';

    var prompt = [
      '你是一個臺灣繁體中文書籍專屬的視覺文字擷取引擎。請分析這張照片（封面、書脊或封底條碼）：',
      '1. 若畫面中有清晰條碼或 ISBN 字串，優先提取 13 碼或 10 碼數字（去除破折號）。',
      '2. 提取書籍正面正書名（title）。',
      '3. 提取書籍作者姓名（author）。',
      '4. 提取出版機構名稱（publisher）。',
      '嚴禁憑空編造！只提取照片中肉眼可辨識之事實文字。若欄位無法辨識請填 null。',
      '請嚴格回傳標準 JSON：',
      '{"isbn": "978986...", "title": "...", "author": "...", "publisher": "...", "confidence": 0.95}'
    ].join('\n');

    var requestBody = {
      contents: [{
        parts: [
          { text: prompt },
          {
            inline_data: {
              mime_type: mType,
              data: cleanBase64
            }
          }
        ]
      }],
      generationConfig: {
        response_mime_type: 'application/json',
        temperature: 0.1
      }
    };

    var options = {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify(requestBody),
      muteHttpExceptions: true
    };

    try {
      var response = UrlFetchApp.fetch(GEMINI_ENDPOINT + '?key=' + apiKey, options);
      var statusCode = response.getResponseCode();

      if (statusCode !== 200) {
        Logger.log('❌ Gemini API 錯誤 HTTP ' + statusCode + ': ' + response.getContentText());
        return {
          success: false,
          error: 'GEMINI_API_ERROR',
          message: 'Gemini 伺服器異常 (' + statusCode + ')'
        };
      }

      var resJson = JSON.parse(response.getContentText());
      var candidates = resJson.candidates || [];
      if (candidates.length === 0) {
        return { success: false, error: 'NO_RESPONSE', message: '未能辨識影像內容' };
      }

      var text = candidates[0].content.parts[0].text;
      var parsedData = JSON.parse(text);

      return {
        success: true,
        data: {
          raw_isbn: parsedData.isbn || null,
          raw_title: parsedData.title || null,
          raw_author: parsedData.author || null,
          raw_publisher: parsedData.publisher || null,
          confidence: Number(parsedData.confidence || 0.8)
        }
      };
    } catch (err) {
      Logger.log('❌ VisionService 異常: ' + err.message);
      return {
        success: false,
        error: 'VISION_EXCEPTION',
        message: err.message
      };
    }
  }

  return {
    extractBookInfoFromImage: extractBookInfoFromImage
  };
})();
