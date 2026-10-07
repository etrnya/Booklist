/**
 * Booklist — 查重決策卡片與快速入庫介面 (decision_ui.js)
 * 嚴格遵循 PRD v1.0.2 第 6.2 節四態決策卡片與快速登記流程
 */

var DecisionUI = (function() {
  var currentCandidate = null;
  var currentDecisionData = null;

  /**
   * 顯示全螢幕決策卡片
   */
  function showDecisionCard(candidate, resultData) {
    // 若後端 google-books-tw-mcp 已解析出標準 Fact Layer，優先繼承
    var rb = resultData.resolved_book;
    if (rb) {
      if (rb.work && rb.work.title) candidate.title = rb.work.title;
      if (rb.work && rb.work.authors && rb.work.authors.length) candidate.author = rb.work.authors.join(', ');
      if (rb.edition && rb.edition.publisher) candidate.publisher = rb.edition.publisher;
      if (rb.identity && rb.identity.isbn_13) candidate.isbn_13 = rb.identity.isbn_13;
      if (rb.cover && rb.cover.url) candidate.cover_url = rb.cover.url;
    }

    currentCandidate = candidate;
    currentDecisionData = resultData;

    var modal = document.getElementById('decision-modal');
    var banner = document.getElementById('decision-banner');
    var badge = document.getElementById('decision-badge');
    var title = document.getElementById('decision-title');
    var reasonsList = document.getElementById('decision-reasons-list');
    var actionsContainer = document.getElementById('decision-actions');

    // 書籍預覽元件
    var coverImg = document.getElementById('decision-book-cover');
    var bookTitle = document.getElementById('decision-book-title');
    var bookAuthor = document.getElementById('decision-book-author');
    var metaChips = document.getElementById('decision-meta-chips');

    var decision = resultData.decision || 'UNKNOWN';
    var matchedBook = resultData.matched_book || candidate;

    // 清除舊狀態樣式
    banner.className = 'decision-banner ' + decision;

    // 設定書籍預覽資料
    bookTitle.textContent = candidate.title || matchedBook.title || '未知書名';
    bookAuthor.textContent = candidate.author || matchedBook.author || '未知作者';
    coverImg.src = candidate.cover_url || matchedBook.cover_url || 'https://via.placeholder.com/72x104/1e293b/64748b?text=Book';

    metaChips.innerHTML = '';
    if (candidate.publisher || matchedBook.publisher) {
      metaChips.innerHTML += '<span class="meta-chip">' + (candidate.publisher || matchedBook.publisher) + '</span>';
    }
    if (candidate.isbn_13 || (matchedBook && matchedBook.isbn_13)) {
      metaChips.innerHTML += '<span class="meta-chip">ISBN: ' + (candidate.isbn_13 || matchedBook.isbn_13) + '</span>';
    }

    // 依四態渲染標題、徽章與行動按鈕
    reasonsList.innerHTML = '';
    var reasons = resultData.reasons || [];
    reasons.forEach(function(r) {
      var li = document.createElement('li');
      li.className = 'reason-item';
      li.innerHTML = '<span class="reason-bullet">•</span> <span>' + r + '</span>';
      reasonsList.appendChild(li);
    });

    actionsContainer.innerHTML = '';

    if (decision === 'DO_NOT_BUY') {
      badge.textContent = '🚫 不建議重複購買';
      title.textContent = '您已持有此書！';
      
      actionsContainer.innerHTML = [
        '<button class="btn-primary" onclick="DecisionUI.viewInBookshelf()">📚 查看已持有紀錄</button>',
        '<button class="btn-secondary" onclick="DecisionUI.closeModal()">關閉 / 查下一本</button>'
      ].join('');

    } else if (decision === 'CONSIDER') {
      badge.textContent = '⚠️ 請審慎考慮';
      title.textContent = '發現相似版本或載具互補';

      actionsContainer.innerHTML = [
        '<button class="btn-primary" onclick="DecisionUI.openQuickPurchaseModal()">🛒 仍要購買入庫</button>',
        '<button class="btn-secondary" onclick="DecisionUI.closeModal()">放棄購買 / 關閉</button>'
      ].join('');

    } else if (decision === 'SAFE_TO_BUY') {
      badge.textContent = '✅ 可放心購買';
      title.textContent = '書庫無此書，可安心選購！';

      actionsContainer.innerHTML = [
        '<button class="btn-primary" onclick="DecisionUI.openQuickPurchaseModal()">🛒 立即登記購入此書</button>',
        '<button class="btn-secondary" onclick="DecisionUI.closeModal()">繼續瀏覽 / 關閉</button>'
      ].join('');

    } else { // UNKNOWN 異常降級 (Invariant D2)
      badge.textContent = '⚪ 暫時無法完成查重';
      title.textContent = '查重服務未回應';

      actionsContainer.innerHTML = [
        '<button class="btn-primary" onclick="App.triggerCamera()">📸 重新拍攝查重</button>',
        '<button class="btn-secondary" onclick="DecisionUI.closeModal()">返回首頁</button>'
      ].join('');
    }

    modal.classList.add('active');
  }

  function closeModal() {
    var modal = document.getElementById('decision-modal');
    modal.classList.remove('active');
  }

  function viewInBookshelf() {
    closeModal();
    if (window.App && window.App.switchTab) {
      window.App.switchTab('bookshelf');
    }
  }

  /**
   * 開啟快速入庫表單
   */
  function openQuickPurchaseModal() {
    closeModal();
    var purchaseModal = document.getElementById('purchase-modal');
    var book = currentCandidate || {};

    document.getElementById('pf-book-title').textContent = book.title || '無書名';
    document.getElementById('pf-book-author').textContent = book.author || '無作者';
    document.getElementById('pf-price').value = '320';
    document.getElementById('pf-notes').value = '';

    purchaseModal.classList.add('active');
  }

  function closePurchaseModal() {
    var purchaseModal = document.getElementById('purchase-modal');
    purchaseModal.classList.remove('active');
  }

  /**
   * 提交快速入庫表單
   */
  async function submitPurchase() {
    var book = currentCandidate || {};
    var price = Number(document.getElementById('pf-price').value || 0);
    var notes = document.getElementById('pf-notes').value || '';
    
    // 取得選取之形式與通路
    var selectedFormat = document.querySelector('.chip-format.selected');
    var formatVal = selectedFormat ? selectedFormat.dataset.value : 'PHYSICAL';

    var selectedChannel = document.querySelector('.chip-channel.selected');
    var channelVal = selectedChannel ? selectedChannel.dataset.value : '博客來';

    var payload = {
      book: {
        title: book.title || '未命名書籍',
        subtitle: book.subtitle || '',
        author: book.author || '未知作者',
        isbn_13: book.isbn_13 || '',
        publisher: book.publisher || '',
        publication_date: book.publication_date || '',
        cover_url: book.cover_url || ''
      },
      purchase: {
        purchase_date: new Date().toISOString().split('T')[0],
        channel: channelVal,
        format: formatVal,
        price: price,
        currency: 'TWD',
        status: 'ACTIVE',
        notes: notes,
        provenance: { meta: 'GOOGLE_BOOKS_TW', input_by: 'USER' }
      }
    };

    if (window.App && window.App.showLoading) {
      window.App.showLoading('排他鎖雙表入庫中...');
    }

    try {
      var res = await BooklistApi.sendRequest('BOOK_SAVE', payload);
      if (res && res.success) {
        alert('🎉 購買已成功登記並寫入書庫！');
        closePurchaseModal();
        if (window.App && window.App.refreshBookshelf) {
          window.App.refreshBookshelf();
        }
      } else {
        alert('❌ 寫入失敗: ' + (res.error ? res.error.message : '未知錯誤'));
      }
    } catch (e) {
      alert('❌ 發生錯誤: ' + e.message);
    } finally {
      if (window.App && window.App.hideLoading) {
        window.App.hideLoading();
      }
    }
  }

  return {
    showDecisionCard: showDecisionCard,
    closeModal: closeModal,
    viewInBookshelf: viewInBookshelf,
    openQuickPurchaseModal: openQuickPurchaseModal,
    closePurchaseModal: closePurchaseModal,
    submitPurchase: submitPurchase
  };
})();
