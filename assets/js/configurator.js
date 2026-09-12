/* ==========================================================================
   Layered by Light — product configurator
   Builds the personalisation form from the product's `options` array in
   products.json. Add an option to the data file and it appears here — no
   changes to this file are needed.

   Supported option types: text | textarea | select | file
   Optional keys: required, maxLength, placeholder, help, accept,
                  choices[{value,label,priceDelta,image}] - an `image` on a
                  choice swaps the main product photo when it is selected,
                  maxLengthFrom {option, map} - character limit that follows
                  another option's value, e.g. a verse whose length depends on
                  the size chosen. Overrides maxLength while that option is set.
   ========================================================================== */
(function (global) {
  'use strict';

  var LBL = global.LBL;
  var MAX_PHOTO_BYTES = 5 * 1024 * 1024;
  var form, product, priceNode, errorSummary;

  function fieldHtml(opt) {
    var id = 'opt-' + opt.id;
    var req = opt.required ? ' <span class="field__req" aria-hidden="true">*</span>' : '';
    var hasLimit = opt.maxLength || opt.maxLengthFrom;
    var counter = hasLimit
      ? '<span class="field__count" data-count-for="' + opt.id + '">0/' + (opt.maxLength || '') + '</span>' : '';
    var help = opt.help ? '<p class="field__help">' + LBL.escapeHtml(opt.help) + '</p>' : '';
    var control = '';

    if (opt.type === 'select') {
      control = '<select id="' + id + '" name="' + opt.id + '" data-option-id="' + opt.id + '"' +
        (opt.required ? ' required' : '') + '>' +
        (opt.required ? '' : '<option value="">No preference</option>') +
        (opt.choices || []).map(function (c) {
          var extra = c.priceDelta ? ' (+' + LBL.money(c.priceDelta) + ')' : '';
          return '<option value="' + LBL.escapeHtml(c.value) + '" data-price-delta="' + (c.priceDelta || 0) + '"' +
                 (c.image ? ' data-image="' + LBL.escapeHtml(c.image) + '"' : '') + '>' +
                 LBL.escapeHtml(c.label) + extra + '</option>';
        }).join('') +
        '</select>';
    } else if (opt.type === 'textarea') {
      control = '<textarea id="' + id + '" name="' + opt.id + '" data-option-id="' + opt.id + '"' +
        (opt.maxLength && !opt.maxLengthFrom ? ' maxlength="' + opt.maxLength + '"' : '') +
        (opt.placeholder ? ' placeholder="' + LBL.escapeHtml(opt.placeholder) + '"' : '') +
        (opt.required ? ' required' : '') + '></textarea>';
    } else if (opt.type === 'file') {
      control = '<input type="file" id="' + id + '" name="' + opt.id + '" data-option-id="' + opt.id + '"' +
        (opt.accept ? ' accept="' + LBL.escapeHtml(opt.accept) + '"' : '') +
        (opt.required ? ' required' : '') + '>';
    } else {
      control = '<input type="text" id="' + id + '" name="' + opt.id + '" data-option-id="' + opt.id + '"' +
        (opt.maxLength && !opt.maxLengthFrom ? ' maxlength="' + opt.maxLength + '"' : '') +
        (opt.placeholder ? ' placeholder="' + LBL.escapeHtml(opt.placeholder) + '"' : '') +
        (opt.required ? ' required' : '') + '>';
    }

    return '<div class="field" data-field="' + opt.id + '">' +
      '<label class="field__label" for="' + id + '">' + counter + LBL.escapeHtml(opt.label) + req + '</label>' +
      control + help +
      '<p class="field__error" data-error-for="' + opt.id + '" hidden></p>' +
      '</div>';
  }

  function limitFor(opt) {
    if (opt.maxLengthFrom && form) {
      var ctrl = form.querySelector('[data-option-id="' + opt.maxLengthFrom.option + '"]');
      if (ctrl && opt.maxLengthFrom.map[ctrl.value] != null) {
        return Number(opt.maxLengthFrom.map[ctrl.value]);
      }
    }
    return opt.maxLength ? Number(opt.maxLength) : 0;
  }

  function currentPrice() {
    var total = Number(product.price);
    var selects = form.querySelectorAll('select[data-option-id]');
    for (var i = 0; i < selects.length; i++) {
      var chosen = selects[i].options[selects[i].selectedIndex];
      if (chosen) total += Number(chosen.getAttribute('data-price-delta') || 0);
    }
    return total;
  }

  // A choice can carry its own photo - picking it shows that version of the
  // piece, so the customer sees what they are actually ordering.
  function refreshImage() {
    var img = document.querySelector('[data-product-image]');
    if (!img || !form) return;
    var selects = form.querySelectorAll('select[data-option-id]');
    for (var i = 0; i < selects.length; i++) {
      var chosen = selects[i].options[selects[i].selectedIndex];
      var src = chosen && chosen.getAttribute('data-image');
      if (src) {
        var next = '../' + src;
        if (img.getAttribute('src') !== next) {
          img.setAttribute('src', next);
          img.setAttribute('alt', product.name + ' - ' + chosen.textContent);
        }
        return;
      }
    }
  }

  function refreshPrice() {
    if (priceNode) priceNode.textContent = LBL.money(currentPrice());
  }

  function refreshCounters() {
    (product.options || []).forEach(function (opt) {
      if (!opt.maxLength && !opt.maxLengthFrom) return;
      var input = form.querySelector('[data-option-id="' + opt.id + '"]');
      var counter = form.querySelector('[data-count-for="' + opt.id + '"]');
      if (!input || !counter) return;
      var limit = limitFor(opt);
      if (limit) input.setAttribute('maxlength', limit);
      var len = (input.value || '').length;
      counter.textContent = len + '/' + limit;
      counter.classList.toggle('is-full', limit && len >= limit);
      // Shrinking the limit can leave existing text over it - say so straight away.
      if (limit && len > limit) {
        showError(opt.id, 'That is ' + (len - limit) + ' characters too long for the size you have chosen.');
      } else if (input.classList.contains('is-invalid') && len <= limit) {
        showError(opt.id, '');
      }
    });
  }

  function showError(optId, message) {
    var node = form.querySelector('[data-error-for="' + optId + '"]');
    var input = form.querySelector('[data-option-id="' + optId + '"]');
    if (node) { node.textContent = message; node.hidden = !message; }
    if (input) input.classList.toggle('is-invalid', !!message);
  }

  function validate() {
    var ok = true, firstBad = null;
    (product.options || []).forEach(function (opt) {
      var input = form.querySelector('[data-option-id="' + opt.id + '"]');
      if (!input) return;
      var file = opt.type === 'file' && input.files && input.files.length ? input.files[0] : null;
      var value = opt.type === 'file' ? (file ? file.name : '') : input.value.trim();
      var message = '';
      var limit = limitFor(opt);
      if (opt.required && !value) message = 'Please fill this in.';
      else if (file && !/^image\//.test(file.type)) message = 'That is not an image. Please choose a photo.';
      else if (file && file.size > MAX_PHOTO_BYTES) message = 'That photo is larger than 5MB. Please choose a smaller one.';
      else if (limit && value.length > limit) message = 'Please keep this to ' + limit + ' characters.';
      showError(opt.id, message);
      if (message) { ok = false; firstBad = firstBad || input; }
    });
    if (firstBad) firstBad.focus();
    return ok;
  }

  function collectOptions() {
    return (product.options || []).map(function (opt) {
      var input = form.querySelector('[data-option-id="' + opt.id + '"]');
      if (!input) return null;
      var value, valueLabel;
      if (opt.type === 'file') {
        value = input.files && input.files.length ? input.files[0].name : '';
        valueLabel = value;
      } else if (opt.type === 'select') {
        value = input.value;
        var chosen = input.options[input.selectedIndex];
        valueLabel = chosen && value ? chosen.textContent : '';
      } else {
        value = input.value.trim();
        valueLabel = value;
      }
      if (!value) return null;
      return { id: opt.id, label: opt.label, type: opt.type, value: value, valueLabel: valueLabel };
    }).filter(Boolean);
  }

  function handleSubmit(event) {
    event.preventDefault();
    if (!validate()) {
      if (errorSummary) { errorSummary.hidden = false; }
      return;
    }
    if (errorSummary) errorSummary.hidden = true;

    var options = collectOptions();
    var button = form.querySelector('button[type="submit"]');
    var originalLabel = button.textContent;
    button.disabled = true;

    // Photos are stashed in IndexedDB and referenced by key, so they travel
    // with the order without having to squeeze into localStorage.
    var stores = options.map(function (o) {
      if (o.type !== 'file') return Promise.resolve();
      var input = form.querySelector('[data-option-id="' + o.id + '"]');
      var file = input && input.files && input.files[0];
      if (!file) return Promise.resolve();
      button.textContent = 'Adding your photo…';
      var key = 'f_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
      return LBL.files.readAsBase64(file).then(function (data) {
        return LBL.files.put(key, { name: file.name, mimeType: file.type, data: data });
      }).then(function (ok) {
        if (ok) o.fileKey = key;   // no key means checkout will ask for it again
      }).catch(function () { /* checkout falls back to asking */ });
    });

    Promise.all(stores).then(function () {
      LBL.basket.add({
        productId: product.id,
        name: product.name,
        slug: product.slug,
        leadTime: product.leadTime,
        price: currentPrice(),
        options: options
      });

      var done = document.querySelector('[data-added-confirm]');
      if (done) {
        done.hidden = false;
        done.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
      form.reset();
      refreshCounters();
      refreshPrice();
    }).then(function () {
      button.disabled = false;
      button.textContent = originalLabel;
    });
  }

  document.addEventListener('DOMContentLoaded', function () {
    var host = document.querySelector('[data-configurator]');
    if (!host || !LBL) return;

    product = LBL.productById(host.getAttribute('data-product-id'));
    if (!product) {
      host.innerHTML = '<p class="note note--warn">This product could not be loaded. Run <code>node scripts/build.js</code> after editing products.json.</p>';
      return;
    }

    host.innerHTML =
      '<form data-config-form novalidate>' +
        (product.options || []).map(fieldHtml).join('') +
        '<div class="panel">' +
          '<div class="price-row"><span>Your piece</span><span class="price-total" data-live-price>' + LBL.money(product.price) + '</span></div>' +
          '<p class="field__help">Delivery is confirmed with your payment instructions.</p>' +
          '<p class="field__error" data-error-summary hidden>Please check the highlighted fields above.</p>' +
          '<button type="submit" class="btn btn--primary btn--block mt-6">Add to order</button>' +
        '</div>' +
      '</form>' +
      '<div class="note mt-6" data-added-confirm hidden>' +
        'Added to your order. <a href="../order.html">Review your order and send it</a>, or keep browsing the shop.' +
      '</div>';

    form = host.querySelector('[data-config-form]');
    priceNode = host.querySelector('[data-live-price]');
    errorSummary = host.querySelector('[data-error-summary]');

    form.addEventListener('input', function () { refreshCounters(); refreshPrice(); });
    form.addEventListener('change', function () { refreshPrice(); refreshImage(); });
    form.addEventListener('submit', handleSubmit);

    refreshCounters();
    refreshPrice();
    refreshImage();
  });

}(window));
