/**
 * Booklist — 權威中繼資料檢索與高解析封面服務 (MetadataService.js)
 * 整合 Google Books API 並套用 Taiwan Book Metadata Resolver 規格
 */

var MetadataService = (function() {
  var GOOGLE_BOOKS_BASE = 'https://www.googleapis.com/books/v1/volumes';
  var API_KEY_NAME = 'GOOGLE_BOOKS_API_KEY';

  /**
   * 升級解析高畫質書封 URL
   */
  function resolveHighResCover(rawUrl) {
    if (!rawUrl) return null;
    var url = String(rawUrl).replace(/^http:\/\//i, 'https://');
    url = url.replace(/&zoom=\d+/g, '&zoom=0');
    url = url.replace(/&edge=curl/g, '');
    return url;
  }

  /**
   * 清理與解析 ISBN
   */
  function cleanIsbn(isbnStr) {
    if (!isbnStr) return '';
    return String(isbnStr).replace(/[^0-9X]/gi, '').toUpperCase();
  }

  /**
   * 透過 ISBN 或書名查詢 Google Books
   * @param {Object} queryParams - { isbn, title, author }
   * @return {Object} 标准中继资料对象
   */
  function fetchMetadata(queryParams) {
    var props = PropertiesService.getScriptProperties();
    var apiKey = props.getProperty(API_KEY_NAME);

    var isbn = cleanIsbn(queryParams.isbn);
    var title = queryParams.title ? String(queryParams.title).trim() : '';
    var author = queryParams.author ? String(queryParams.author).trim() : '';

    var apiQuery = '';
    if (isbn) {
      apiQuery = 'isbn:' + isbn;
    } else if (title) {
      apiQuery = 'intitle:' + encodeURIComponent(title);
      if (author) {
        apiQuery += '+inauthor:' + encodeURIComponent(author);
      }
    } else {
      return { success: false, error: 'INVALID_QUERY', message: '需提供 ISBN 或書名' };
    }

    var url = GOOGLE_BOOKS_BASE + '?q=' + apiQuery + '&maxResults=1&printType=books';
    if (apiKey) {
      url += '&key=' + apiKey;
    }

    try {
      var response = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
      if (response.getResponseCode() !== 200) {
        return {
          success: false,
          error: 'UPSTREAM_' + response.getResponseCode(),
          message: 'Google Books API 查詢失敗 (' + response.getResponseCode() + ')'
        };
      }

      var data = JSON.parse(response.getContentText());
      var items = data.items || [];
      if (items.length === 0) {
        return {
          success: true,
          found: false,
          book: null
        };
      }

      var vol = items[0].volumeInfo || {};
      var identifiers = vol.industryIdentifiers || [];
      var isbn13 = null;
      var isbn10 = null;

      for (var i = 0; i < identifiers.length; i++) {
        var idItem = identifiers[i];
        var idVal = cleanIsbn(idItem.identifier);
        if (idItem.type === 'ISBN_13' || idVal.length === 13) {
          isbn13 = idVal;
        } else if (idItem.type === 'ISBN_10' || idVal.length === 10) {
          isbn10 = idVal;
        }
      }

      var imgLinks = vol.imageLinks || {};
      var rawCover = imgLinks.extraLarge || imgLinks.large || imgLinks.medium || imgLinks.thumbnail || imgLinks.smallThumbnail || null;
      var highResCover = resolveHighResCover(rawCover);

      var authors = vol.authors || [];
      var authorStr = authors.join(', ');

      return {
        success: true,
        found: true,
        book: {
          google_books_id: items[0].id || null,
          title: vol.title || title,
          subtitle: vol.subtitle || '',
          author: authorStr || author,
          publisher: vol.publisher || '',
          publication_date: vol.publishedDate || '',
          language: vol.language === 'zh' ? '繁體中文' : (vol.language || '繁體中文'),
          isbn_13: isbn13 || isbn,
          isbn_10: isbn10 || null,
          page_count: vol.pageCount || null,
          cover_url: highResCover,
          description: vol.description ? (vol.description.slice(0, 300) + '...') : ''
        }
      };
    } catch (err) {
      return {
        success: false,
        error: 'FETCH_ERROR',
        message: err.message
      };
    }
  }

  return {
    fetchMetadata: fetchMetadata,
    resolveHighResCover: resolveHighResCover,
    cleanIsbn: cleanIsbn
  };
})();
