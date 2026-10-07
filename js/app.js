/**
 * Booklist — 應用程式主邏輯與狀態調度 (app.js)
 * 整合相機拍照、Canvas 壓縮、BarcodeDetector 零 Token 快路徑、五級查重與書櫃管理
 */

var App = (function() {
  var currentTab = 'home';
  var dailyCheckCount = 0;

  function init() {
    setupEventListeners();
    refreshBookshelf();
    updateConnectionStatus();

    // 載入今日查重計數
    var todayKey = 'check_count_' + new Date().toISOString().split('T')[0];
    dailyCheckCount = parseInt(localStorage.getItem(todayKey) || '0', 10);
    updateCheckCountDisplay();
  }

  function setupEventListeners() {
    // 拍照按鈕
    var cameraBtn = document.getElementById('btn-camera-trigger');
    var fileInput = document.getElementById('camera-file-input');

    if (cameraBtn && fileInput) {
      cameraBtn.addEventListener('click', function() {
        fileInput.click();
      });

      fileInput.addEventListener('change', handleImageCapture);
    }

    // 搜尋欄
    var searchInput = document.getElementById('main-search-input');
    if (searchInput) {
      searchInput.addEventListener('keypress', function(e) {
        if (e.key === 'Enter') {
          handleManualSearch(searchInput.value);
        }
      });
    }

    // 快捷格式晶片切換
    document.querySelectorAll('.chip-format').forEach(function(chip) {
      chip.addEventListener('click', function() {
        document.querySelectorAll('.chip-format').forEach(c => c.classList.remove('selected'));
        chip.classList.add('selected');
      });
    });

    // 快捷通路晶片切換
    document.querySelectorAll('.chip-channel').forEach(function(chip) {
      chip.addEventListener('click', function() {
        document.querySelectorAll('.chip-channel').forEach(c => c.classList.remove('selected'));
        chip.classList.add('selected');
      });
    });
  }

  /**
   * 喚起相機
   */
  function triggerCamera() {
    var fileInput = document.getElementById('camera-file-input');
    if (fileInput) fileInput.click();
  }

  /**
   * 處理相機拍照或圖檔選取
   */
  async function handleImageCapture(event) {
    var file = event.target.files && event.target.files[0];
    if (!file) return;

    showLoading('正在最佳化相片體積 (<500KB)...');

    try {
      // 1. 前端 Canvas 動態壓縮 (<500KB JPEG 0.8)
      var compressed = await ImageCompressor.compressImage(file);
      console.log('📸 壓縮完成: ' + compressed.original_size_kb + 'KB ➔ ' + compressed.size_kb + 'KB (' + compressed.width + 'x' + compressed.height + ')');

      // 2. 確定性條碼解析 (Deterministic Barcode First 零 Token 快路徑)
      showLoading('掃描書本條碼中 (BarcodeDetector)...');
      var tempImg = new Image();
      tempImg.src = compressed.dataUrl;
      await new Promise(r => { tempImg.onload = r; });

      var barcodeResult = await BarcodeScanner.detectBarcode(tempImg);

      if (barcodeResult && barcodeResult.success && barcodeResult.isbn) {
        console.log('⚡ [Fast-Path] 條碼解析成功 (0 Token):', barcodeResult.isbn);
        incrementCheckCount();
        showLoading('執行五級查重決策階梯 (ISBN 快路徑)...');

        var checkRes = await BooklistApi.sendRequest('DUPLICATE_CHECK', {
          isbn_13: barcodeResult.isbn,
          format: 'PHYSICAL'
        });

        hideLoading();
        DecisionUI.showDecisionCard({
          isbn_13: barcodeResult.isbn,
          title: 'ISBN: ' + barcodeResult.isbn,
          author: ''
        }, checkRes.data || {});
        return;
      }

      // 3. 無條碼或條碼模糊：降級調用 Gemini 2.5 Flash 視覺文字擷取
      console.log('🔍 條碼未命中，降級呼叫 Gemini 2.5 Flash 提取文字...');
      showLoading('Gemini 2.5 Flash 視覺文字擷取中...');

      var visionRes = await BooklistApi.sendRequest('VISION_EXTRACT', {
        image_base64: compressed.base64,
        mime_type: compressed.mime_type
      });

      if (!visionRes.success) {
        hideLoading();
        // 異常安全降級 (Invariant D2)
        DecisionUI.showDecisionCard({}, {
          decision: 'UNKNOWN',
          reasons: ['相片文字辨識失敗：' + (visionRes.error ? visionRes.error.message : '無有效資訊'), '⚠️ 請勿將此結果視為「未購買」！']
        });
        return;
      }

      var extracted = visionRes.data || {};
      console.log('📖 視覺擷取成果:', extracted);
      incrementCheckCount();

      // 4. 五級查重階梯
      showLoading('比對個人書庫與購買紀錄...');
      var dupRes = await BooklistApi.sendRequest('DUPLICATE_CHECK', {
        isbn_13: extracted.raw_isbn,
        title: extracted.raw_title,
        author: extracted.raw_author,
        format: 'PHYSICAL'
      });

      hideLoading();
      DecisionUI.showDecisionCard({
        title: extracted.raw_title,
        author: extracted.raw_author,
        publisher: extracted.raw_publisher,
        isbn_13: extracted.raw_isbn
      }, dupRes.data || {});

    } catch (err) {
      console.error('❌ 處理流程出錯:', err);
      hideLoading();
      DecisionUI.showDecisionCard({}, {
        decision: 'UNKNOWN',
        reasons: ['處理過程發生未預期錯誤：' + err.message, '⚠️ 請勿將此結果視為「未購買」！']
      });
    } finally {
      // 重置 input 以利連續拍攝同一書籍
      event.target.value = '';
    }
  }

  /**
   * 手動純文字搜尋查重
   */
  async function handleManualSearch(query) {
    if (!query || !query.trim()) return;
    var cleanQ = query.trim();

    showLoading('正在查重：「' + cleanQ + '」...');
    incrementCheckCount();

    try {
      var isIsbn = /^[0-9\-X]{9,17}$/i.test(cleanQ);
      var candidate = {};

      if (isIsbn) {
        candidate.isbn_13 = cleanQ.replace(/[^0-9X]/gi, '');
      } else {
        candidate.title = cleanQ;
      }
      candidate.format = 'PHYSICAL';

      var res = await BooklistApi.sendRequest('DUPLICATE_CHECK', candidate);
      hideLoading();

      DecisionUI.showDecisionCard(candidate, res.data || {});
    } catch (err) {
      hideLoading();
      DecisionUI.showDecisionCard({ title: cleanQ }, {
        decision: 'UNKNOWN',
        reasons: ['連線超時: ' + err.message, '⚠️ 請勿將此結果視為「未購買」！']
      });
    }
  }

  /**
   * 盲測套件：快速載入 TEST_CASES.md 中的案例
   */
  function runTestCase(caseId) {
    var cases = {
      'TC-01': { title: '原子習慣', author: 'James Clear', isbn_13: '9789861755261', format: 'PHYSICAL', desc: '已持有繁中實體' },
      'TC-02': { title: '被討厭的勇氣', author: '岸見一郎', format: 'PHYSICAL', desc: '封面文字無ISBN' },
      'TC-11': { title: '原子習慣', author: 'James Clear', isbn_13: '9789861755261', format: 'EBOOK', desc: '已有實體想買電子書' },
      'TC-14': { title: '投資最重要的事：全新增訂版', author: 'Howard Marks', format: 'PHYSICAL', desc: '增訂版改版書' },
      'TC-16': { title: '晶片戰爭', author: 'Chris Miller', isbn_13: '9789863988496', format: 'PHYSICAL', desc: '全新未購新書' },
      'TC-E1': { title: '窮查理的普通常識', author: 'Charles T. Munger', isbn_13: '9789869824248', format: 'PHYSICAL', desc: '歷史已轉售' },
      'TC-E4': { title: '模擬斷網超時', author: '', simulate_timeout: true, desc: 'Invariant D2 安全降級' }
    };

    var targetCase = cases[caseId];
    if (!targetCase) return;

    if (targetCase.simulate_timeout) {
      DecisionUI.showDecisionCard({ title: targetCase.title }, {
        decision: 'UNKNOWN',
        ownership_status: 'NOT_OWNED',
        match_type: 'ERROR_UNAVAILABLE',
        reasons: [
          '模擬網路逾時或辨識服務未回應',
          '⚠️ 遵守 Invariant D2：嚴禁預設為「未購買」，請核對實體書架！'
        ]
      });
      return;
    }

    showLoading('執行驗收案例 ' + caseId + ' (' + targetCase.title + ')...');
    setTimeout(async function() {
      var res = await BooklistApi.sendRequest('DUPLICATE_CHECK', targetCase);
      hideLoading();
      DecisionUI.showDecisionCard(targetCase, res.data || {});
    }, 300);
  }

  /**
   * 刷新書架列表
   */
  async function refreshBookshelf() {
    var listContainer = document.getElementById('bookshelf-list');
    var totalBadge = document.getElementById('stat-total-books');
    if (!listContainer) return;

    var books = await BooklistApi.loadMockBooks();
    if (totalBadge) totalBadge.textContent = books.length + ' 本';

    listContainer.innerHTML = '';
    if (books.length === 0) {
      listContainer.innerHTML = '<div style="text-align:center;padding:40px;color:var(--text-dim);">書庫中尚無書籍紀錄</div>';
      return;
    }

    books.forEach(function(b) {
      var card = document.createElement('div');
      card.className = 'bookshelf-card';
      var cover = b.cover_url || 'https://via.placeholder.com/58x84/1e293b/64748b?text=Book';
      var formatLabel = b.format === 'PHYSICAL' ? '📘 實體書' : (b.format === 'EBOOK' ? '📱 電子書' : '🎧 有聲書');

      card.innerHTML = [
        '<img class="bookshelf-cover" src="' + cover + '" alt="cover" loading="lazy">',
        '<div class="bookshelf-details">',
          '<div>',
            '<div class="bookshelf-title">' + (b.title || '無書名') + '</div>',
            '<div class="bookshelf-author">' + (b.author || '未知作者') + ' · ' + (b.publisher || '') + '</div>',
          '</div>',
          '<div class="bookshelf-footer">',
            '<span>' + formatLabel + ' · ' + (b.channel || '實體店') + '</span>',
            '<span class="bookshelf-price">$' + (b.price || 0) + '</span>',
          '</div>',
        '</div>'
      ].join('');

      card.addEventListener('click', function() {
        DecisionUI.showDecisionCard(b, {
          decision: b.status === 'ACTIVE' ? 'DO_NOT_BUY' : 'CONSIDER',
          ownership_status: b.status === 'ACTIVE' ? 'CURRENTLY_OWNED' : 'PREVIOUSLY_OWNED',
          reasons: [
            '已持有本書 (' + (b.isbn_13 ? 'ISBN: ' + b.isbn_13 : '無條碼') + ')',
            '購入日期：' + (b.purchase_date || '未記錄') + '，實付金額：$' + (b.price || 0),
            '存放位置：' + (b.location || '書架')
          ],
          matched_book: b
        });
      });

      listContainer.appendChild(card);
    });
  }

  /**
   * 標籤分頁切換
   */
  function switchTab(tabId) {
    currentTab = tabId;
    document.querySelectorAll('.view-panel').forEach(function(v) {
      v.classList.remove('active');
    });

    var targetView = document.getElementById('view-' + tabId);
    if (targetView) targetView.classList.add('active');

    document.querySelectorAll('.nav-item').forEach(function(nav) {
      nav.classList.toggle('active', nav.dataset.tab === tabId);
    });

    if (tabId === 'bookshelf') {
      refreshBookshelf();
    }
  }

  function incrementCheckCount() {
    dailyCheckCount++;
    var todayKey = 'check_count_' + new Date().toISOString().split('T')[0];
    localStorage.setItem(todayKey, dailyCheckCount.toString());
    updateCheckCountDisplay();
  }

  function updateCheckCountDisplay() {
    var badge = document.getElementById('stat-today-checks');
    if (badge) badge.textContent = dailyCheckCount + ' 次';
  }

  function updateConnectionStatus() {
    var statusEl = document.getElementById('header-status');
    var gasUrl = BooklistApi.getGasUrl();
    if (statusEl) {
      if (gasUrl) {
        statusEl.className = 'header-status-badge';
        statusEl.innerHTML = '<span class="status-dot"></span> 雲端連線';
      } else {
        statusEl.className = 'header-status-badge offline';
        statusEl.innerHTML = '<span class="status-dot"></span> 離線展示模式';
      }
    }
  }

  function openSettingsModal() {
    var modal = document.getElementById('settings-modal');
    document.getElementById('setting-gas-url').value = BooklistApi.getGasUrl();
    document.getElementById('setting-app-token').value = BooklistApi.getToken();
    modal.classList.add('active');
  }

  function closeSettingsModal() {
    document.getElementById('settings-modal').classList.remove('active');
  }

  function saveSettings() {
    var gasUrl = document.getElementById('setting-gas-url').value;
    var token = document.getElementById('setting-app-token').value;

    BooklistApi.setGasUrl(gasUrl);
    BooklistApi.setToken(token);

    updateConnectionStatus();
    closeSettingsModal();
    alert('✅ 設定已儲存！');
  }

  function showLoading(msg) {
    var loader = document.getElementById('app-loading');
    var text = document.getElementById('loading-message');
    if (text) text.textContent = msg || '處理中...';
    if (loader) loader.classList.add('active');
  }

  function hideLoading() {
    var loader = document.getElementById('app-loading');
    if (loader) loader.classList.remove('active');
  }

  return {
    init: init,
    triggerCamera: triggerCamera,
    switchTab: switchTab,
    runTestCase: runTestCase,
    openSettingsModal: openSettingsModal,
    closeSettingsModal: closeSettingsModal,
    saveSettings: saveSettings,
    refreshBookshelf: refreshBookshelf,
    showLoading: showLoading,
    hideLoading: hideLoading
  };
})();

// 當 DOM 就緒時啟動
document.addEventListener('DOMContentLoaded', App.init);
