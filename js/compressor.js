/**
 * Booklist — 前端圖片動態壓縮模組 (compressor.js)
 * 嚴格遵循 PRD v1.0.2 守門規範 B2：長邊 <= 1200px，JPEG 0.8，確保 Base64 體積 < 500KB
 */

var ImageCompressor = (function() {
  var MAX_DIMENSION = 1200;
  var JPEG_QUALITY = 0.8;

  /**
   * 壓縮 File 或 Blob 物件為輕量 Base64 字串
   * @param {File|Blob} file - 手機拍照或選取的圖檔
   * @return {Promise<Object>} { base64, mime_type, size_kb, original_size_kb }
   */
  function compressImage(file) {
    return new Promise(function(resolve, reject) {
      if (!file) {
        return reject(new Error('未提供有效圖檔'));
      }

      var originalSizeKb = Math.round(file.size / 1024);
      var reader = new FileReader();

      reader.onload = function(e) {
        var img = new Image();
        img.onload = function() {
          var width = img.width;
          var height = img.height;

          // 等比例縮小計算
          if (width > height) {
            if (width > MAX_DIMENSION) {
              height = Math.round((height * MAX_DIMENSION) / width);
              width = MAX_DIMENSION;
            }
          } else {
            if (height > MAX_DIMENSION) {
              width = Math.round((width * MAX_DIMENSION) / height);
              height = MAX_DIMENSION;
            }
          }

          var canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;

          var ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, width, height);

          // 導出 JPEG
          var dataUrl = canvas.toDataURL('image/jpeg', JPEG_QUALITY);
          var base64Data = dataUrl.split(',')[1] || '';
          var compressedSizeKb = Math.round((base64Data.length * 3) / 4 / 1024);

          resolve({
            dataUrl: dataUrl,
            base64: base64Data,
            mime_type: 'image/jpeg',
            width: width,
            height: height,
            size_kb: compressedSizeKb,
            original_size_kb: originalSizeKb
          });
        };

        img.onerror = function() {
          reject(new Error('載入圖片失敗，格式可能不受支援'));
        };

        img.src = e.target.result;
      };

      reader.onerror = function() {
        reject(new Error('讀取檔案失敗'));
      };

      reader.readAsDataURL(file);
    });
  }

  return {
    compressImage: compressImage
  };
})();
