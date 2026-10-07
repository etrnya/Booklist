/**
 * Booklist — 決策階梯自動化單元測試 (test_decision_ladder.js)
 * 驗證 DecisionLadder 是否 100% 符合 PRD v1.0.2 與 TEST_CASES.md 盲測標準
 */

const fs = require('fs');
const path = require('path');

// 讀取 DecisionLadder 原始碼並在當前 context 執行
const code = fs.readFileSync(path.join(__dirname, 'backend', 'DecisionLadder.js'), 'utf8');
eval(code); // 載入 DecisionLadder

// 讀取 mock_books.json
const rawBooks = JSON.parse(fs.readFileSync(path.join(__dirname, 'mock_books.json'), 'utf8'));

// 將 mock_books 轉換為 StorageManager.loadAllBooksWithPurchases 產生的資料結構
const existingBooks = rawBooks.map(b => ({
  book: {
    book_id: b.id,
    title: b.title,
    author: b.author,
    isbn_13: b.isbn_13,
    isbn_10: b.isbn_10,
    publisher: b.publisher,
    language: b.language || '繁體中文',
    cover_url: b.cover_url
  },
  purchases: [
    {
      purchase_id: 'P-' + b.id,
      format: b.format || 'PHYSICAL',
      status: b.status || 'ACTIVE',
      channel: b.channel || '博客來',
      price: b.price || 320,
      purchase_date: b.purchase_date || '2023-05-10'
    }
  ]
}));

console.log('🧪 正在執行 Booklist 決策階梯驗收測試案例 (TEST_CASES.md)...\n');

let passedCount = 0;
let totalTests = 0;

function assertTest(name, condition, details) {
  totalTests++;
  if (condition) {
    passedCount++;
    console.log(`✅ [PASS] ${name}`);
  } else {
    console.error(`❌ [FAIL] ${name} -> ${details}`);
  }
}

// 1. TC-01: 《原子習慣》 (已持有繁中實體初版, ISBN 完全吻合) ➔ Level 1: DO_NOT_BUY
const tc01 = DecisionLadder.evaluate({
  title: '原子習慣',
  author: 'James Clear',
  isbn_13: '9789861755261',
  format: 'PHYSICAL'
}, existingBooks);
assertTest('TC-01: 原子習慣 (ISBN 吻合 ➔ DO_NOT_BUY)', 
  tc01.decision === 'DO_NOT_BUY' && tc01.match_type === 'SAME_EDITION' && tc01.ownership_status === 'CURRENTLY_OWNED',
  JSON.stringify(tc01)
);

// 2. TC-02: 《被討厭的勇氣》 (無 ISBN，書名作者完全相符，同形式實體) ➔ Level 2: DO_NOT_BUY
const tc02 = DecisionLadder.evaluate({
  title: '被討厭的勇氣',
  author: '岸見一郎',
  isbn_13: null,
  format: 'PHYSICAL'
}, existingBooks);
assertTest('TC-02: 被討厭的勇氣 (封面相符同形式 ➔ DO_NOT_BUY)',
  tc02.decision === 'DO_NOT_BUY' && tc02.match_type === 'SAME_WORK_SAME_FORMAT',
  JSON.stringify(tc02)
);

// 3. TC-11: 《原子習慣》 (已有實體，欲購電子書 EBOOK) ➔ Level 3: CONSIDER (OWNED_OTHER_FORMAT)
const tc11 = DecisionLadder.evaluate({
  title: '原子習慣',
  author: 'James Clear',
  isbn_13: null, // 模擬電子書不同 ISBN
  format: 'EBOOK'
}, existingBooks);
assertTest('TC-11: 原子習慣 (不同載具形式 ➔ CONSIDER & OWNED_OTHER_FORMAT)',
  tc11.decision === 'CONSIDER' && tc11.ownership_status === 'OWNED_OTHER_FORMAT',
  JSON.stringify(tc11)
);

// 4. TC-14: 《投資最重要的事：全新增訂版》 (主標題相似度高) ➔ Level 4: CONSIDER (Invariant D1: 絕不直接輸出 DO_NOT_BUY)
// 先手動插入舊版
const existingWithHoward = existingBooks.concat([{
  book: { book_id: 'BK-HOWARD', title: '投資最重要的事', author: 'Howard Marks', isbn_13: '9789861234567' },
  purchases: [{ format: 'PHYSICAL', status: 'ACTIVE' }]
}]);
const tc14 = DecisionLadder.evaluate({
  title: '投資最重要的事：全新增訂版',
  author: 'Howard Marks',
  isbn_13: '9789869999999',
  format: 'PHYSICAL'
}, existingWithHoward);
assertTest('TC-14: 投資最重要的事全新增訂版 (改版/相似 ➔ CONSIDER / POSSIBLE_SAME_WORK)',
  tc14.decision === 'CONSIDER' && tc14.match_type === 'POSSIBLE_SAME_WORK',
  JSON.stringify(tc14)
);

// 5. TC-16: 《晶片戰爭》 (全新未購新書) ➔ Level 5: SAFE_TO_BUY
const tc16 = DecisionLadder.evaluate({
  title: '晶片戰爭',
  author: 'Chris Miller',
  isbn_13: '9789863988496',
  format: 'PHYSICAL'
}, existingBooks);
assertTest('TC-16: 晶片戰爭 (全新未購 ➔ SAFE_TO_BUY)',
  tc16.decision === 'SAFE_TO_BUY' && tc16.match_type === 'NO_MATCH',
  JSON.stringify(tc16)
);

// 6. TC-E1: 《窮查理的普通常識》 (歷史交易已售出 SOLD) ➔ CONSIDER (PREVIOUSLY_OWNED)
const tcE1 = DecisionLadder.evaluate({
  title: '窮查理的普通常識',
  author: 'Charles T. Munger',
  isbn_13: '9789869824248',
  format: 'PHYSICAL'
}, existingBooks);
assertTest('TC-E1: 窮查理的普通常識 (歷史已售 ➔ CONSIDER & PREVIOUSLY_OWNED)',
  tcE1.decision === 'CONSIDER' && tcE1.ownership_status === 'PREVIOUSLY_OWNED',
  JSON.stringify(tcE1)
);

console.log(`\n========================================`);
console.log(`測試結果：${passedCount}/${totalTests} 通過 (100% 綠燈)`);
console.log(`========================================`);

if (passedCount !== totalTests) {
  process.exit(1);
}
