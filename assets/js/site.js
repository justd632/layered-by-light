/* ==========================================================================
   Layered by Light — shared site behaviour
   Basket storage, money formatting, product card rendering, header count.
   Loaded on every page. Depends on data/products.js (window.LBL_PRODUCTS).
   ========================================================================== */
(function (global) {
  'use strict';

  var STORE_KEY = 'lbl-basket-v1';
  var memoryFallback = null; // used if localStorage is unavailable (private mode, file://)

  var data = global.LBL_PRODUCTS || { currency: 'SGD', shop: {}, categories: [], products: [] };

  /* --- helpers ---------------------------------------------------------- */

  function money(amount) {
    return '$' + Number(amount).toFixed(2);
  }

  function escapeHtml(str) {
    return String(str == null ? '' : str)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function productById(id) {
    for (var i = 0; i < data.products.length; i++) {
      if (data.products[i].id === id) return data.products[i];
    }
    return null;
  }

  function productUrl(product, fromRoot) {
    return (fromRoot ? '' : '') + 'products/' + product.slug + '.html';
  }

  /* --- basket ----------------------------------------------------------- */

  function readBasket() {
    if (memoryFallback) return memoryFallback;
    try {
      var raw = global.localStorage.getItem(STORE_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch (err) {
      memoryFallback = memoryFallback || [];
      return memoryFallback;
    }
  }

  function writeBasket(items) {
    try {
      global.localStorage.setItem(STORE_KEY, JSON.stringify(items));
    } catch (err) {
      memoryFallback = items; // storage blocked — keep it for this page at least
    }
    updateBasketCount();
  }

  function addToBasket(line) {
    var items = readBasket();
    line.lineId = 'L' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    items.push(line);
    writeBasket(items);
    return line.lineId;
  }

  function removeFromBasket(lineId) {
    writeBasket(readBasket().filter(function (l) { return l.lineId !== lineId; }));
  }

  function clearBasket() { writeBasket([]); clearFiles(); }

  function basketTotal() {
    return readBasket().reduce(function (sum, l) { return sum + Number(l.price || 0); }, 0);
  }

  function updateBasketCount() {
    var count = readBasket().length;
    var nodes = document.querySelectorAll('[data-basket-count]');
    for (var i = 0; i < nodes.length; i++) {
      nodes[i].textContent = String(count);
      nodes[i].hidden = count === 0;
    }
  }

  /* --- rendering -------------------------------------------------------- */

  function cardHtml(product, pathPrefix) {
    var prefix = pathPrefix || '';
    var img = product.images && product.images[0] ? prefix + product.images[0] : '';
    return '' +
      '<article class="card">' +
        '<a class="card__media" href="' + prefix + productUrl(product) + '">' +
          (img ? '<img src="' + escapeHtml(img) + '" alt="' + escapeHtml(product.name) + '" loading="lazy">' : '') +
        '</a>' +
        '<div class="card__body">' +
          '<h3 class="card__title"><a href="' + prefix + productUrl(product) + '">' + escapeHtml(product.name) + '</a></h3>' +
          '<p class="muted small">' + escapeHtml(product.shortDescription || '') + '</p>' +
          '<p class="card__price">From ' + money(product.price) + '</p>' +
          '<p class="small muted">Made in ' + escapeHtml(product.leadTime || '') + '</p>' +
          '<div class="card__foot"><a class="btn btn--primary btn--block" href="' + prefix + productUrl(product) + '">Personalise this</a></div>' +
        '</div>' +
      '</article>';
  }

  function renderFeatured() {
    var grid = document.querySelector('[data-featured-grid]');
    if (!grid) return;
    var featured = data.products.filter(function (p) { return p.featured; });
    if (!featured.length) featured = data.products.slice(0, 3);
    grid.innerHTML = featured.length
      ? featured.map(function (p) { return cardHtml(p); }).join('')
      : '<p class="muted">No products yet.</p>';
  }

  function renderCategorySections() {
    var host = document.querySelector('[data-category-sections]');
    if (!host) return;
    if (!data.products.length) {
      host.innerHTML = '<div class="empty-state"><p>No products yet.</p></div>';
      return;
    }
    host.innerHTML = data.categories.map(function (cat) {
      var inCat = data.products.filter(function (p) { return p.category === cat.id; });
      if (!inCat.length) return '';
      return '' +
        '<section class="mt-6">' +
          '<h2>' + escapeHtml(cat.name) + '</h2>' +
          '<p class="muted">' + escapeHtml(cat.description || '') + '</p>' +
          '<div class="grid grid--products mt-6">' + inCat.map(function (p) { return cardHtml(p); }).join('') + '</div>' +
        '</section>';
    }).join('');
  }

  /* --- uploaded files ----------------------------------------------------
     Customer photos are far too big for localStorage, so the basket stores a
     key and the file itself lives in IndexedDB until the order is sent.
     Every call degrades to null rather than throwing: a browser with storage
     blocked still gets a working basket, and checkout asks for the photo
     again instead of losing the order.
     ----------------------------------------------------------------------- */

  var DB_NAME = 'lbl-files', STORE = 'files';

  function openDb() {
    return new Promise(function (resolve, reject) {
      if (!global.indexedDB) return reject(new Error('no indexedDB'));
      var req = global.indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = function () {
        if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error); };
    });
  }

  function withStore(mode, fn) {
    return openDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(STORE, mode);
        var req = fn(tx.objectStore(STORE));
        tx.oncomplete = function () { resolve(req && req.result); };
        tx.onerror = function () { reject(tx.error); };
      });
    });
  }

  function putFile(key, value) {
    return withStore('readwrite', function (s) { return s.put(value, key); })
      .then(function () { return true; })
      .catch(function () { return false; });
  }

  function getFile(key) {
    return withStore('readonly', function (s) { return s.get(key); })
      .catch(function () { return null; });
  }

  function clearFiles() {
    return withStore('readwrite', function (s) { return s.clear(); }).catch(function () { return null; });
  }

  function readAsBase64(file) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () {
        var out = String(reader.result || '');
        resolve(out.slice(out.indexOf(',') + 1));
      };
      reader.onerror = function () { reject(new Error('could not read file')); };
      reader.readAsDataURL(file);
    });
  }

  /* --- expose ----------------------------------------------------------- */

  global.LBL = {
    data: data,
    money: money,
    escapeHtml: escapeHtml,
    productById: productById,
    productUrl: productUrl,
    cardHtml: cardHtml,
    basket: {
      read: readBasket, add: addToBasket, remove: removeFromBasket,
      clear: clearBasket, total: basketTotal, refreshCount: updateBasketCount
    },
    files: { put: putFile, get: getFile, clear: clearFiles, readAsBase64: readAsBase64 }
  };

  document.addEventListener('DOMContentLoaded', function () {
    updateBasketCount();
    renderFeatured();
    renderCategorySections();
  });

}(window));
