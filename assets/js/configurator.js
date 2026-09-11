/* ==========================================================================
   Layered by Light — product configurator
   Builds the personalisation form from the product's `options` array in
   products.json. Add an option to the data file and it appears here — no
   changes to this file are needed.

   Supported option types: text | textarea | select | file
   Optional keys: required, maxLength, placeholder, help, accept,
                  choices[{value,label,priceDelta}]
   ========================================================================== */
(function (global) {
  'use strict';

  var LBL = global.LBL;
  var form, product, priceNode, errorSummary;

  function fieldHtml(opt) {
    var id = 'opt-' + opt.id;
    var req = opt.required ? ' <span class="field__req" aria-hidden="true">*</span>' : '';
    var counter = opt.maxLength
      ? '<span class="field__count" data-count-for="' + opt.id + '">0/' + opt.maxLength + '</span>' : '';
    var help = opt.help ? '<p class="field__help">' + LBL.escapeHtml(opt.help) + '</p>' : '';
    var control = '';

    if (opt.type === 'select') {
      control = '<select id="' + id + '" name="' + opt.id + '" data-option-id="' + opt.id + '"' +
        (opt.required ? ' required' : '') + '>' +
        (opt.required ? '' : '<option value="">No preference</option>') +
        (opt.choices || []).map(function (c) {
          var extra = c.priceDelta ? ' (+' + LBL.money(c.priceDelta) + ')' : '';
          return '<option value="' + LBL.escapeHtml(c.value) + '" data-price-delta="' + (c.priceDelta || 0) + '">' +
                 LBL.escapeHtml(c.label) + extra + '</option>';
        }).join('') +
        '</select>';
    } else if (opt.type === 'textarea') {
      control = '<textarea id="' + id + '" name="' + opt.id + '" data-option-id="' + opt.id + '"' +
        (opt.maxLength ? ' maxlength="' + opt.maxLength + '"' : '') +
        (opt.placeholder ? ' placeholder="' + LBL.escapeHtml(opt.placeholder) + '"' : '') +
        (opt.required ? ' required' : '') + '></textarea>';
    } else if (opt.type === 'file') {
      control = '<input type="file" id="' + id + '" name="' + opt.id + '" data-option-id="' + opt.id + '"' +
        (opt.accept ? ' accept="' + LBL.escapeHtml(opt.accept) + '"' : '') +
        (opt.required ? ' required' : '') + '>';
    } else {
      control = '<input type="text" id="' + id + '" name="' + opt.id + '" data-option-id="' + opt.id + '"' +
        (opt.maxLength ? ' maxlength="' + opt.maxLength + '"' : '') +
        (opt.placeholder ? ' placeholder="' + LBL.escapeHtml(opt.placeholder) + '"' : '') +
        (opt.required ? ' required' : '') + '>';
    }

    return '<div class="field" data-field="' + opt.id + '">' +
      '<label class="field__label" for="' + id + '">' + counter + LBL.escapeHtml(opt.label) + req + '</label>' +
      control + help +
      '<p class="field__error" data-error-for="' + opt.id + '" hidden></p>' +
      '</div>';
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

  function refreshPrice() {
    if (priceNode) priceNode.textContent = LBL.money(currentPrice());
  }

  function refreshCounters() {
    (product.options || []).forEach(function (opt) {
      if (!opt.maxLength) return;
      var input = form.querySelector('[data-option-id="' + opt.id + '"]');
      var counter = form.querySelector('[data-count-for="' + opt.id + '"]');
      if (!input || !counter) return;
      var len = (input.value || '').length;
      counter.textContent = len + '/' + opt.maxLength;
      counter.classList.toggle('is-full', len >= opt.maxLength);
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
      var value = opt.type === 'file' ? (input.files && input.files.length ? input.files[0].name : '') : input.value.trim();
      var message = '';
      if (opt.required && !value) message = 'Please fill this in.';
      else if (opt.maxLength && value.length > opt.maxLength) message = 'Please keep this to ' + opt.maxLength + ' characters.';
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
        valueLabel = value ? value + ' (to be sent separately)' : '';
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

    LBL.basket.add({
      productId: product.id,
      name: product.name,
      slug: product.slug,
      leadTime: product.leadTime,
      price: currentPrice(),
      options: collectOptions()
    });

    var done = document.querySelector('[data-added-confirm]');
    if (done) {
      done.hidden = false;
      done.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
    form.reset();
    refreshCounters();
    refreshPrice();
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
    form.addEventListener('change', refreshPrice);
    form.addEventListener('submit', handleSubmit);

    refreshCounters();
    refreshPrice();
  });

}(window));
