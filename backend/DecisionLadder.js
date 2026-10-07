/**
 * Booklist — 五級查重決策階梯核心引擎 (DecisionLadder.js)
 * 嚴格遵循 PRD v1.0.2 第 3 節與工程不變性 Invariant D1 & D2
 */

var DecisionLadder = (function() {
  /**
   * 清理與正規化字串 (去除標點符號、空格、轉小寫、全形轉半形)
   */
  function normalizeText(text) {
    if (!text) return '';
    var str = String(text).trim().toLowerCase();
    // 全形英數轉半形
    str = str.replace(/[\uff01-\uff5e]/g, function(ch) {
      return String.fromCharCode(ch.charCodeAt(0) - 0xfee0);
    });
    // 移除常見中英文標點符號與空白
    return str.replace(/[\s\-_:：·・,.!?;'"\(\)（）《》〈〉【】\[\]]/g, '');
  }

  /**
   * 提取主標題主幹 (剔除副標題與「全新增訂版」、「紀念版」等版本後綴)
   */
  function extractTitleRoot(title) {
    if (!title) return '';
    var clean = String(title).trim();
    // 切分副標題符號 (冒號、括弧、破折號)
    clean = clean.split(/[:：(（\[【\-—]/)[0];
    // 移除常見版本修飾語
    clean = clean.replace(/(全新)?(增訂|紀念|修訂|普及|珍藏|十週年|二十週年|20週年|大字|經典|新版|版)/gi, '');
    return normalizeText(clean);
  }

  /**
   * 計算兩字串的相似度 (整合主標題主幹比對與 Levenshtein Distance)
   */
  function calculateSimilarity(str1, str2) {
    var s1 = normalizeText(str1);
    var s2 = normalizeText(str2);
    if (!s1 && !s2) return 1.0;
    if (!s1 || !s2) return 0.0;
    if (s1 === s2) return 1.0;

    // 檢查主標題主幹 (Title Root) 是否一致或包含 (如: 投資最重要的事 vs 投資最重要的事：全新增訂版)
    var root1 = extractTitleRoot(str1);
    var root2 = extractTitleRoot(str2);
    if (root1 && root2 && root1.length >= 3 && root2.length >= 3) {
      if (root1 === root2) return 0.95;
      if (root1.indexOf(root2) !== -1 || root2.indexOf(root1) !== -1) return 0.92;
    }

    var longer = s1.length > s2.length ? s1 : s2;
    var shorter = s1.length > s2.length ? s2 : s1;
    var longerLength = longer.length;
    if (longerLength === 0) return 1.0;

    // 若短字串完全被長字串包含且佔比高
    if (longer.indexOf(shorter) !== -1 && shorter.length >= 4) {
      return Math.max(0.85, shorter.length / longerLength);
    }

    // 計算編輯距離
    var costs = [];
    for (var i = 0; i <= s1.length; i++) {
      var lastValue = i;
      for (var j = 0; j <= s2.length; j++) {
        if (i === 0) {
          costs[j] = j;
        } else if (j > 0) {
          var newValue = costs[j - 1];
          if (s1.charAt(i - 1) !== s2.charAt(j - 1)) {
            newValue = Math.min(Math.min(newValue, lastValue), costs[j]) + 1;
          }
          costs[j - 1] = lastValue;
          lastValue = newValue;
        }
      }
      if (i > 0) costs[s2.length] = lastValue;
    }

    var editDistance = costs[s2.length];
    return (longerLength - editDistance) / longerLength;
  }

  /**
   * 執行五級查重決策階梯
   * @param {Object} candidate - 欲查重之目標書籍 { isbn_13, isbn_10, title, author, language, format }
   * @param {Array<Object>} existingBooks - 書庫既有書目及購買實體清單 [{ book, purchases }]
   * @return {Object} 決策結果 { decision, ownership_status, match_type, reasons, matched_book }
   */
  function evaluate(candidate, existingBooks) {
    var cIsbn13 = candidate.isbn_13 ? String(candidate.isbn_13).replace(/[^0-9X]/gi, '') : '';
    var cIsbn10 = candidate.isbn_10 ? String(candidate.isbn_10).replace(/[^0-9X]/gi, '') : '';
    var cTitleNorm = normalizeText(candidate.title);
    var cAuthorNorm = normalizeText(candidate.author);
    var cFormat = candidate.format || 'PHYSICAL'; // 預設欲購實體

    var bestFuzzyMatch = null;
    var highestFuzzyScore = 0;

    for (var i = 0; i < existingBooks.length; i++) {
      var item = existingBooks[i];
      var book = item.book;
      var purchases = item.purchases || [];

      var bIsbn13 = book.isbn_13 ? String(book.isbn_13).replace(/[^0-9X]/gi, '') : '';
      var bIsbn10 = book.isbn_10 ? String(book.isbn_10).replace(/[^0-9X]/gi, '') : '';
      var bTitleNorm = normalizeText(book.title);
      var bAuthorNorm = normalizeText(book.author);

      // 檢查持有狀態：只有 status === 'ACTIVE' 算目前持有
      var activePurchases = purchases.filter(function(p) { return p.status === 'ACTIVE'; });
      var isCurrentlyOwned = activePurchases.length > 0;
      var hasSameFormatOwned = activePurchases.some(function(p) { return p.format === cFormat; });
      var otherFormatPurchases = activePurchases.filter(function(p) { return p.format !== cFormat; });

      // -------------------------------------------------------------
      // 【Level 1】ISBN 完全相符
      // -------------------------------------------------------------
      var isIsbnMatched = false;
      if (cIsbn13 && (cIsbn13 === bIsbn13 || cIsbn13 === bIsbn10)) isIsbnMatched = true;
      if (cIsbn10 && (cIsbn10 === bIsbn10 || cIsbn10 === bIsbn13)) isIsbnMatched = true;

      if (isIsbnMatched) {
        if (isCurrentlyOwned) {
          var pDetail = activePurchases[0];
          return {
            decision: 'DO_NOT_BUY',
            ownership_status: 'CURRENTLY_OWNED',
            match_type: 'SAME_EDITION',
            reasons: [
              'ISBN 條碼完全吻合 (' + (bIsbn13 || bIsbn10) + ')',
              '目前持有同版本書籍 (於 ' + (pDetail.purchase_date || '未知日期') + ' 在 ' + (pDetail.channel || '書店') + ' 購入)'
            ],
            matched_book: book,
            matched_purchase: pDetail
          };
        } else {
          // 歷史交易但目前非 ACTIVE (例如 SOLD, GIFTED, DISCARDED)
          var pastP = purchases[0] || {};
          return {
            decision: 'CONSIDER',
            ownership_status: 'PREVIOUSLY_OWNED',
            match_type: 'SAME_EDITION',
            reasons: [
              'ISBN 完全吻合，曾於 ' + (pastP.purchase_date || '') + ' 購入',
              '歷史紀錄已標示為「' + (pastP.status || '已售出') + '」，目前未持有實體'
            ],
            matched_book: book,
            matched_purchase: pastP
          };
        }
      }

      // -------------------------------------------------------------
      // 【Level 2 & Level 3】書名與作者相符
      // -------------------------------------------------------------
      var isExactTitleAuthor = (cTitleNorm && bTitleNorm && cTitleNorm === bTitleNorm) &&
                               (!cAuthorNorm || !bAuthorNorm || cAuthorNorm === bAuthorNorm || 
                                cAuthorNorm.indexOf(bAuthorNorm) !== -1 || bAuthorNorm.indexOf(cAuthorNorm) !== -1);

      if (isExactTitleAuthor) {
        if (!isCurrentlyOwned) {
          var pPast = purchases[0] || {};
          return {
            decision: 'CONSIDER',
            ownership_status: 'PREVIOUSLY_OWNED',
            match_type: 'SAME_WORK_SAME_FORMAT',
            reasons: [
              '書名與作者完全相符，曾於 ' + (pPast.purchase_date || '') + ' 購買',
              '歷史狀態為「' + (pPast.status || '已轉售') + '」，目前未持有'
            ],
            matched_book: book,
            matched_purchase: pPast
          };
        }

        // Level 2: 持有同媒介形式 (ACTIVE)
        if (hasSameFormatOwned) {
          var sameP = activePurchases.find(function(p) { return p.format === cFormat; });
          return {
            decision: 'DO_NOT_BUY',
            ownership_status: 'CURRENTLY_OWNED',
            match_type: 'SAME_WORK_SAME_FORMAT',
            reasons: [
              '正書名與主要作者完全一致',
              '目前已持有相同媒介形式 (' + (cFormat === 'PHYSICAL' ? '實體書' : '電子書') + ')'
            ],
            matched_book: book,
            matched_purchase: sameP
          };
        }

        // Level 3: 持有不同媒介形式 (ACTIVE)
        if (otherFormatPurchases.length > 0) {
          var diffP = otherFormatPurchases[0];
          return {
            decision: 'CONSIDER',
            ownership_status: 'OWNED_OTHER_FORMAT',
            match_type: 'SAME_WORK_DIFF_FORMAT',
            reasons: [
              '正書名與作者完全一致',
              '目前已持有 ' + (diffP.format === 'PHYSICAL' ? '實體版' : '電子版') + '，尚未持有欲購之 ' + (cFormat === 'PHYSICAL' ? '實體版' : '電子版')
            ],
            matched_book: book,
            matched_purchase: diffP
          };
        }
      }

      // -------------------------------------------------------------
      // 【Level 4 收集候選】主標題相似度比對 (作者相同或包含)
      // -------------------------------------------------------------
      if (cTitleNorm && bTitleNorm) {
        var score = calculateSimilarity(candidate.title, book.title);
        if (score >= 0.85 && score > highestFuzzyScore) {
          highestFuzzyScore = score;
          bestFuzzyMatch = {
            book: book,
            purchase: activePurchases[0] || purchases[0] || {},
            score: score
          };
        }
      }
    }

    // 檢查 Level 4 是否命中 (守門規則 Invariant D1: 永遠不得直接輸出 DO_NOT_BUY，只能輸出 CONSIDER)
    if (bestFuzzyMatch && highestFuzzyScore >= 0.85) {
      var pct = Math.round(highestFuzzyScore * 100);
      return {
        decision: 'CONSIDER',
        ownership_status: 'SUSPECTED',
        match_type: 'POSSIBLE_SAME_WORK',
        reasons: [
          '主標題高度相似 (' + pct + '%)：「' + bestFuzzyMatch.book.title + '」',
          'ISBN 條碼不同，疑似為增訂版、紀念版或改版書，請核對內文目錄'
        ],
        matched_book: bestFuzzyMatch.book,
        matched_purchase: bestFuzzyMatch.purchase
      };
    }

    // -------------------------------------------------------------
    // 【Level 5】完全無命中 ➔ 可放心購買
    // -------------------------------------------------------------
    return {
      decision: 'SAFE_TO_BUY',
      ownership_status: 'NOT_OWNED',
      match_type: 'NO_MATCH',
      reasons: [
        '書庫中查無此書紀錄',
        '確認未重複持有，可放心選購！'
      ],
      matched_book: null,
      matched_purchase: null
    };
  }

  return {
    evaluate: evaluate,
    calculateSimilarity: calculateSimilarity,
    normalizeText: normalizeText
  };
})();
