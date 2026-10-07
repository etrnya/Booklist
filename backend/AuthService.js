/**
 * Booklist — 認證服務 (AuthService.js)
 * 嚴格遵循無 URL 洩漏原則與加鹽雜湊 (Salted SHA-256) 驗證
 */

var AuthService = (function() {
  /**
   * 驗證前端傳入之私人 App Token
   * @param {string} token - 前端傳入之原始 Token
   * @return {boolean} 是否驗證通過
   */
  function validateToken(token) {
    if (!token || typeof token !== 'string') {
      return false;
    }

    var props = PropertiesService.getScriptProperties();
    var storedHash = props.getProperty('BOOKLIST_APP_TOKEN_HASH');
    var salt = props.getProperty('BOOKLIST_TOKEN_SALT');

    // 若尚未初始化金鑰，且處於開發初次設置狀態，允許安全警示
    if (!storedHash || !salt) {
      Logger.log('⚠️ [AuthService] 尚未配置 BOOKLIST_APP_TOKEN_HASH 或 BOOKLIST_TOKEN_SALT，拒絕存取。');
      return false;
    }

    var computedHash = hashToken(token.trim(), salt);
    return computedHash === storedHash.trim();
  }

  /**
   * 計算加鹽 SHA-256 雜湊
   * @param {string} token
   * @param {string} salt
   * @return {string} 十六進位雜湊字串
   */
  function hashToken(token, salt) {
    var raw = token + ':' + salt;
    var digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, raw, Utilities.Charset.UTF_8);
    var hash = '';
    for (var i = 0; i < digest.length; i++) {
      var byteVal = digest[i];
      if (byteVal < 0) byteVal += 256;
      var byteHex = byteVal.toString(16);
      if (byteHex.length === 1) byteHex = '0' + byteHex;
      hash += byteHex;
    }
    return hash;
  }

  /**
   * 輔助設定工具：用於開發者一次性初始化 Token 與 Salt (需在 GAS 編輯器手動執行)
   * 嚴格禁止自 Web 請求暴露！
   */
  function setupInitialToken(plainToken) {
    var salt = Utilities.getUuid();
    var hash = hashToken(plainToken, salt);
    var props = PropertiesService.getScriptProperties();
    props.setProperty('BOOKLIST_TOKEN_SALT', salt);
    props.setProperty('BOOKLIST_APP_TOKEN_HASH', hash);
    Logger.log('✅ Token 初始化完成！請將 Token 儲存在安全處：' + plainToken);
  }

  return {
    validateToken: validateToken,
    hashToken: hashToken,
    setupInitialToken: setupInitialToken
  };
})();
