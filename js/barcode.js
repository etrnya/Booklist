/**
 * Booklist — 條碼優先機器解析模組 (barcode.js)
 * 嚴格遵循 PRD v1.0.2 補丁四 (Deterministic Barcode First)：
 * 手機端優先使用瀏覽器原生 BarcodeDetector 進行確定性 0 Token 條碼解碼
 */

var BarcodeScanner = (function() {
  /**
   * 檢查目前瀏覽器是否原生支援 BarcodeDetector
   */
  function isSupported() {
    return 'BarcodeDetector' in window;
  }

  /**
   * 嘗試從 <img> 或 <canvas> 元素中解碼條碼
   * @param {HTMLImageElement|HTMLCanvasElement|ImageBitmap} imageSource
   * @return {Promise<Object>} { success: boolean, isbn: string|null, format: string|null }
   */
  async function detectBarcode(imageSource) {
    if (!isSupported()) {
      return { success: false, reason: 'NOT_SUPPORTED' };
    }

    try {
      var formats = await window.BarcodeDetector.getSupportedFormats();
      var supportedFormats = ['ean_13', 'ean_8', 'upc_a', 'code_128'].filter(function(f) {
        return formats.indexOf(f) !== -1;
      });

      if (supportedFormats.length === 0) {
        return { success: false, reason: 'NO_EAN_FORMAT_SUPPORTED' };
      }

      var detector = new window.BarcodeDetector({ formats: supportedFormats });
      var barcodes = await detector.detect(imageSource);

      if (!barcodes || barcodes.length === 0) {
        return { success: false, reason: 'NO_BARCODE_FOUND' };
      }

      // 優先尋找 978 或 979 開頭之 EAN-13 (標準圖書 ISBN)
      for (var i = 0; i < barcodes.length; i++) {
        var rawVal = barcodes[i].rawValue ? barcodes[i].rawValue.replace(/[^0-9]/g, '') : '';
        if (rawVal.length === 13 && (rawVal.startsWith('978') || rawVal.startsWith('979'))) {
          return {
            success: true,
            isbn: rawVal,
            format: barcodes[i].format || 'ean_13'
          };
        }
      }

      // 次之取任一 10 碼或 13 碼純數字條碼
      for (var j = 0; j < barcodes.length; j++) {
        var cleanVal = barcodes[j].rawValue ? barcodes[j].rawValue.replace(/[^0-9]/g, '') : '';
        if (cleanVal.length === 13 || cleanVal.length === 10) {
          return {
            success: true,
            isbn: cleanVal,
            format: barcodes[j].format
          };
        }
      }

      return { success: false, reason: 'NO_VALID_ISBN_BARCODE' };
    } catch (err) {
      console.warn('⚠️ [BarcodeScanner] 解碼異常:', err);
      return { success: false, reason: 'DETECTION_ERROR', error: err.message };
    }
  }

  return {
    isSupported: isSupported,
    detectBarcode: detectBarcode
  };
})();
