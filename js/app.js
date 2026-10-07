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
      var extTitle = extracted.title || extracted.raw_title || '';
      var extAuthor = extracted.author || extracted.raw_author || '';
      var extIsbn = extracted.isbn || extracted.raw_isbn || '';

      console.log('📖 視覺擷取成果:', extracted);
      incrementCheckCount();

      // 4. 五級查重階梯
      showLoading('比對個人書庫與購買紀錄...');
      var dupRes = await BooklistApi.sendRequest('DUPLICATE_CHECK', {
        isbn_13: extIsbn,
        title: extTitle,
        author: extAuthor,
        format: 'PHYSICAL'
      });

      hideLoading();
      DecisionUI.showDecisionCard({
        title: extTitle,
        author: extAuthor,
        isbn_13: extIsbn
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
   * 刷新書架列表 (對齊 Notion 我的書櫃)
   */
  function renderFallbackCover(title) {
    var safeTitle = (title || '書本').substring(0, 6);
    return '<div class="bookshelf-cover-fallback">' +
      '<div class="fallback-icon">📖</div>' +
      '<div class="fallback-text">' + safeTitle + '</div>' +
    '</div>';
  }

  /**
   * 處理書封載入失敗事件 (平滑替換為純 CSS 精緻書卡)
   */
  function handleCoverError(imgEl) {
    if (!imgEl || !imgEl.parentNode) return;
    var title = imgEl.getAttribute('alt') || '書本';
    var safeTitle = title.substring(0, 6);
    var fallback = document.createElement('div');
    fallback.className = 'bookshelf-cover-fallback';
    fallback.innerHTML = '<div class="fallback-icon">📖</div><div class="fallback-text">' + safeTitle + '</div>';
    imgEl.parentNode.replaceChild(fallback, imgEl);
  }

  /**
   * 刷新書架列表 (依購買日期新到舊排序)
   */
  async function refreshBookshelf() {
    var listContainer = document.getElementById('bookshelf-list');
    var totalBadge = document.getElementById('stat-total-books');
    if (!listContainer) return;

    var books = await BooklistApi.fetchBookshelf();
    if (totalBadge) totalBadge.textContent = (books ? books.length : 0) + ' 本';

    listContainer.innerHTML = '';
    if (!books || books.length === 0) {
      listContainer.innerHTML = '<div style="text-align:center;padding:40px;color:var(--text-dim);">書櫃中尚無書籍紀錄</div>';
      return;
    }

    // 核心需求：依購買日期 / 建立日期新到舊 (降序，最新購買排在最前面)
    books.sort(function(a, b) {
      var dateA = a.purchased_at || a.created_at || a.date || a.order_date || '';
      var dateB = b.purchased_at || b.created_at || b.date || b.order_date || '';
      if (dateA && dateB) {
        var timeA = new Date(dateA).getTime();
        var timeB = new Date(dateB).getTime();
        if (!isNaN(timeA) && !isNaN(timeB)) {
          return timeB - timeA;
        }
      }
      if (dateB) return 1;
      if (dateA) return -1;
      return 0;
    });

    books.forEach(function(b) {
      var card = document.createElement('div');
      card.className = 'bookshelf-card';
      
      var coverSrc = b.cover || b.cover_url || '';
      var formatLabel = (b.format || '紙本書');
      var authors = Array.isArray(b.authors) && b.authors.length ? b.authors.join(', ') : (b.author || '未知作者');
      var safeTitle = b.title || '無書名';

      // 提取日期標籤 (YYYY-MM-DD)
      var rawDate = b.purchased_at || b.created_at || '';
      var dateLabel = '';
      if (rawDate) {
        var dMatch = rawDate.match(/^(\d{4}-\d{2}-\d{2})/);
        if (dMatch) dateLabel = ' · 📅 ' + dMatch[1];
      }

      // 封面渲染
      var coverHtml = '';
      if (coverSrc) {
        coverHtml = '<img class="bookshelf-cover" src="' + coverSrc + '" alt="' + safeTitle.replace(/"/g, '&quot;') + '" loading="lazy" onerror="App.handleCoverError(this)">';
      } else {
        coverHtml = renderFallbackCover(safeTitle);
      }

      card.innerHTML = [
        coverHtml,
        '<div class="bookshelf-details">',
          '<div>',
            '<div class="bookshelf-title" title="' + safeTitle.replace(/"/g, '&quot;') + '">' + safeTitle + '</div>',
            '<div class="bookshelf-author">' + authors + (b.publisher ? ' · ' + b.publisher : '') + '</div>',
          '</div>',
          '<div class="bookshelf-footer">',
            '<span>' + formatLabel + ' · ' + (b.status || '準備讀') + dateLabel + '</span>',
            '<span class="bookshelf-price">' + (b.isbn ? 'ISBN: ' + b.isbn : '') + '</span>',
          '</div>',
        '</div>'
      ].join('');

      card.addEventListener('click', function() {
        DecisionUI.showDecisionCard(b, {
          decision: 'DO_NOT_BUY',
          ownership_status: 'CURRENTLY_OWNED',
          reasons: [
            '已在書櫃中持有本書',
            (b.isbn ? 'ISBN：' + b.isbn : '書名完全對齊'),
            '形式：' + formatLabel + '，狀態：' + (b.status || '準備讀')
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
    var mode = BooklistApi.getVaultMode();
    if (statusEl) {
      statusEl.className = 'header-status-badge';
      if (mode === 'private') {
        statusEl.innerHTML = '<span class="status-dot" style="background:#10b981;"></span> 私人書庫已解鎖 (196 本)';
      } else {
        statusEl.innerHTML = '<span class="status-dot"></span> 公開展示模式 (示範書庫)';
      }
    }
  }

  async function triggerBatchEnrich() {
    if (!confirm('即將自動掃描 Notion 書庫中缺少書封或 ISBN 的書籍，並調用 google-books-tw-mcp 批次補全，是否開始？')) return;
    showLoading('批次補全進行中，請稍候...');
    var res = await BooklistApi.batchEnrich();
    hideLoading();
    if (res && res.success) {
      alert('🎉 批次補全完成！掃描 ' + res.scanned_total + ' 本，成功補全 ' + res.enriched_count + ' 本！');
      refreshBookshelf();
    } else {
      alert('❌ 批次補全未完成，請確認本地 server.py 正在運行。');
    }
  }

  function openSettingsModal() {
    var modal = document.getElementById('settings-modal');
    if (!modal) return;

    var keyInput = document.getElementById('setting-gemini-key');
    var modelSelect = document.getElementById('setting-ai-model');
    var notionKeyInput = document.getElementById('setting-notion-key');
    var notionDbInput = document.getElementById('setting-notion-db');
    var testStatus = document.getElementById('ai-test-status');
    var countEl = document.getElementById('setting-books-count');

    if (keyInput) keyInput.value = BooklistApi.getGeminiKey();
    if (modelSelect) modelSelect.value = BooklistApi.getSelectedModel();
    if (notionKeyInput) notionKeyInput.value = BooklistApi.getNotionKey();
    if (notionDbInput) notionDbInput.value = BooklistApi.getNotionDbId();
    if (testStatus) testStatus.innerHTML = '';

    // 1. 同步隱私模式 UI
    var hasCustom = BooklistApi.hasCustomBooks();
    var vaultBadge = document.getElementById('vault-mode-badge');
    var vaultDesc = document.getElementById('vault-mode-desc');
    var resetBtn = document.getElementById('btn-reset-vault');

    if (hasCustom) {
      if (vaultBadge) {
        vaultBadge.textContent = '私人解鎖模式 (自訂書庫)';
        vaultBadge.style.background = 'rgba(16, 185, 129, 0.2)';
        vaultBadge.style.color = '#10b981';
      }
      if (vaultDesc) {
        vaultDesc.textContent = '目前已載入您匯入的個人私人購書庫。此資料 100% 僅儲存在您本機瀏覽器，絕不上傳雲端。';
      }
      if (resetBtn) resetBtn.style.display = 'inline-block';
    } else {
      if (vaultBadge) {
        vaultBadge.textContent = '公開展示模式';
        vaultBadge.style.background = 'rgba(56, 189, 248, 0.2)';
        vaultBadge.style.color = '#38bdf8';
      }
      if (vaultDesc) {
        vaultDesc.textContent = '目前處於公開展示模式（載入公共示範書庫），他人開啟此網頁絕不會看見您的私人購書紀錄。';
      }
      if (resetBtn) resetBtn.style.display = 'none';
    }

    // 2. 更新顯示的書庫藏書量
    BooklistApi.loadMockBooks().then(function(books) {
      if (countEl && books) {
        countEl.textContent = '已收錄 ' + books.length + ' 本藏書 (支援 100% 離線查重)';
      }
    });

    modal.classList.add('active');
  }

  function closeSettingsModal() {
    var modal = document.getElementById('settings-modal');
    if (modal) modal.classList.remove('active');
  }

  function saveSettings() {
    var geminiKey = (document.getElementById('setting-gemini-key') || {}).value || '';
    var model = (document.getElementById('setting-ai-model') || {}).value || 'gemini-3.8-flash';
    var notionKey = (document.getElementById('setting-notion-key') || {}).value || '';
    var notionDb = (document.getElementById('setting-notion-db') || {}).value || '';

    BooklistApi.setGeminiKey(geminiKey);
    BooklistApi.setSelectedModel(model);
    BooklistApi.setNotionKey(notionKey);
    BooklistApi.setNotionDbId(notionDb);

    updateConnectionStatus();
    closeSettingsModal();
    alert('✅ 系統與 AI 設定已儲存成功！');
  }

  /**
   * 匯入個人書庫檔案 (JSON)
   */
  function importVaultFile(event) {
    var file = event.target.files && event.target.files[0];
    if (!file) return;

    var reader = new FileReader();
    reader.onload = function(e) {
      try {
        var parsed = JSON.parse(e.target.result);
        if (!Array.isArray(parsed)) {
          alert('❌ 檔案格式錯誤：JSON 頂層必須為書籍陣列！');
          return;
        }
        BooklistApi.saveCustomBooks(parsed);
        alert('🎉 成功匯入 ' + parsed.length + ' 本個人藏書！已安全存入本地私密沙盒。');
        openSettingsModal();
        refreshBookshelf();
        updateConnectionStatus();
      } catch (err) {
        alert('❌ 讀取 JSON 失敗: ' + err.message);
      } finally {
        event.target.value = '';
      }
    };
    reader.readAsText(file);
  }

  /**
   * 匯出備份目前書庫
   */
  async function exportVaultFile() {
    var books = await BooklistApi.loadMockBooks();
    var blob = new Blob([JSON.stringify(books, null, 2)], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = 'my_booklist_backup.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  /**
   * 還原為公開展示模式
   */
  function resetToPublicVault() {
    if (!confirm('確定要清除本地匯入的個人書庫，還原為公共示範模式嗎？\n（您隨時可以再次透過 JSON 匯入）')) return;
    BooklistApi.clearCustomBooks();
    alert('✅ 已重置！目前處於安全的公開展示模式。');
    openSettingsModal();
    refreshBookshelf();
    updateConnectionStatus();
  }

  /**
   * 切換 API Key 教學抽屜折疊
   */
  function toggleApiGuide() {
    var guide = document.getElementById('api-key-guide');
    if (!guide) return;
    guide.style.display = (guide.style.display === 'none' || !guide.style.display) ? 'block' : 'none';
  }

  /**
   * 切換 Notion 串接教學抽屜折疊
   */
  function toggleNotionGuide() {
    var guide = document.getElementById('notion-guide');
    if (!guide) return;
    guide.style.display = (guide.style.display === 'none' || !guide.style.display) ? 'block' : 'none';
  }

  /**
   * 線上同步目前 Gemini API Key 所支援的模型清單
   */
  async function syncAvailableModels() {
    var key = (document.getElementById('setting-gemini-key') || {}).value || BooklistApi.getGeminiKey();
    var selectEl = document.getElementById('setting-ai-model');
    var statusEl = document.getElementById('ai-test-status');

    if (!key.trim()) {
      alert('請先在下方輸入框貼上 Google Gemini API Key，再點擊同步！');
      return;
    }

    if (statusEl) statusEl.innerHTML = '<span style="color: var(--text-dim);">正在查詢此金鑰可用之官方模型...</span>';

    try {
      var models = await BooklistApi.fetchAvailableModels(key.trim());
      if (models && models.length > 0) {
        var currentVal = selectEl ? selectEl.value : '';
        if (selectEl) {
          selectEl.innerHTML = '';
          models.forEach(function(m) {
            var opt = document.createElement('option');
            opt.value = m.id;
            opt.textContent = m.displayName;
            if (m.id === currentVal || (m.id === 'gemini-3.8-flash' && !currentVal)) {
              opt.selected = true;
            }
            selectEl.appendChild(opt);
          });
        }
        if (statusEl) {
          statusEl.innerHTML = '<span style="color: #10b981; font-weight: 600;">✅ 已同步 ' + models.length + ' 個官方可用模型！</span>';
        }
      } else {
        if (statusEl) {
          statusEl.innerHTML = '<span style="color: #ef4444;">未找到支援 generateContent 的模型</span>';
        }
      }
    } catch (err) {
      if (statusEl) {
        statusEl.innerHTML = '<span style="color: #ef4444;">同步失敗: ' + err.message + '</span>';
      }
    }
  }

  async function testAiConnection() {
    var key = (document.getElementById('setting-gemini-key') || {}).value || '';
    var model = (document.getElementById('setting-ai-model') || {}).value || 'gemini-3.8-flash';
    var statusEl = document.getElementById('ai-test-status');
    var testBtn = document.getElementById('btn-test-ai');

    if (!key.trim()) {
      if (statusEl) statusEl.innerHTML = '<span style="color: #ef4444;">⚠️ 請先貼上 Gemini API Key</span>';
      return;
    }

    if (testBtn) {
      testBtn.disabled = true;
      testBtn.innerHTML = '<span>⏳</span> 測試連線中...';
    }
    if (statusEl) {
      statusEl.innerHTML = '<span style="color: var(--text-dim);">正在連線 Google AI 伺服器...</span>';
    }

    try {
      var result = await BooklistApi.testGeminiConnection(key, model);
      if (result.success) {
        if (result.is_fallback && result.model) {
          var modelSelect = document.getElementById('setting-ai-model');
          if (modelSelect) {
            // 若 option 不存在則補上
            var exists = Array.from(modelSelect.options).some(function(o) { return o.value === result.model; });
            if (!exists) {
              var newOpt = document.createElement('option');
              newOpt.value = result.model;
              newOpt.textContent = '⚡ ' + result.model + ' (自動切換備援)';
              modelSelect.appendChild(newOpt);
            }
            modelSelect.value = result.model;
          }
        }
        if (statusEl) {
          statusEl.innerHTML = '<span style="color: #10b981; font-weight: 600;">' + result.message + '</span>';
        }
      } else {
        if (statusEl) {
          statusEl.innerHTML = '<span style="color: #ef4444; font-size: 0.72rem; line-height: 1.3;">' + result.message + '</span>';
        }
      }
    } catch (err) {
      if (statusEl) {
        statusEl.innerHTML = '<span style="color: #ef4444;">🔴 測試失敗: ' + err.message + '</span>';
      }
    } finally {
      if (testBtn) {
        testBtn.disabled = false;
        testBtn.innerHTML = '<span>🧪</span> 測試 AI 連線';
      }
    }
  }

  function toggleKeyVisibility(inputId, btn) {
    var input = document.getElementById(inputId);
    if (!input) return;
    if (input.type === 'password') {
      input.type = 'text';
      if (btn) btn.textContent = '🙈';
    } else {
      input.type = 'password';
      if (btn) btn.textContent = '👁️';
    }
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
    importVaultFile: importVaultFile,
    exportVaultFile: exportVaultFile,
    resetToPublicVault: resetToPublicVault,
    toggleApiGuide: toggleApiGuide,
    toggleNotionGuide: toggleNotionGuide,
    syncAvailableModels: syncAvailableModels,
    testAiConnection: testAiConnection,
    toggleKeyVisibility: toggleKeyVisibility,
    refreshBookshelf: refreshBookshelf,
    handleCoverError: handleCoverError,
    showLoading: showLoading,
    hideLoading: hideLoading
  };
})();

// 當 DOM 就緒時啟動
document.addEventListener('DOMContentLoaded', App.init);
