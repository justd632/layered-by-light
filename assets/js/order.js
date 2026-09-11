/* ==========================================================================
   Layered by Light — order page
   Renders the basket, validates buyer details, produces an order reference
   and a plain-text order summary.

   >>> TODO (Justin): ORDER_ENDPOINT is empty, so orders are not sent
   anywhere automatically yet. With it empty, the customer is given their
   order summary plus buttons to send it by email or WhatsApp — which is
   enough to take real orders from day one.
   When you are ready to automate it, set ORDER_ENDPOINT to a form handler
   URL (Formspree, Netlify Forms, or your own) and the same summary will be
   POSTed there instead.
   ========================================================================== */
(function (global) {
  'use strict';

  var ORDER_ENDPOINT = '';

  var LBL = global.LBL;
  var shop = (LBL && LBL.data && LBL.data.shop) || {};

  function orderReference() {
    var d = new Date();
    var stamp = String(d.getFullYear()).slice(2) +
      String(d.getMonth() + 1).padStart(2, '0') +
      String(d.getDate()).padStart(2, '0');
    var rand = Math.random().toString(36).slice(2, 6).toUpperCase();
    return 'LBL-' + stamp + '-' + rand;
  }

  /* --- basket rendering -------------------------------------------------- */

  function renderBasket() {
    var host = document.querySelector('[data-basket-list]');
    var totalBox = document.querySelector('[data-basket-total]');
    var formHost = document.querySelector('[data-order-form-host]');
    if (!host) return;

    var items = LBL.basket.read();

    if (!items.length) {
      host.innerHTML = '<div class="empty-state"><p>Your order is empty.</p>' +
        '<p><a class="btn btn--primary" href="shop.html">Browse the shop</a></p></div>';
      if (totalBox) totalBox.hidden = true;
      if (formHost) formHost.hidden = true;
      return;
    }

    if (totalBox) totalBox.hidden = false;
    if (formHost) formHost.hidden = false;

    host.innerHTML = items.map(function (line) {
      var specs = (line.options || []).map(function (o) {
        return '<div><dt>' + LBL.escapeHtml(o.label) + '</dt><dd>' + LBL.escapeHtml(o.valueLabel || o.value) + '</dd></div>';
      }).join('');
      return '' +
        '<div class="basket-item">' +
          '<div class="basket-item__head">' +
            '<strong>' + LBL.escapeHtml(line.name) + '</strong>' +
            '<span class="card__price">' + LBL.money(line.price) + '</span>' +
          '</div>' +
          (specs ? '<dl class="spec-list">' + specs + '</dl>' : '<p class="muted small">No personalisation</p>') +
          '<p class="muted small">Made in ' + LBL.escapeHtml(line.leadTime || '') + '</p>' +
          '<p><button type="button" class="link-danger" data-remove="' + line.lineId + '">Remove this piece</button></p>' +
        '</div>';
    }).join('');

    var totalNode = document.querySelector('[data-total]');
    if (totalNode) totalNode.textContent = LBL.money(LBL.basket.total());

    host.querySelectorAll('[data-remove]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        LBL.basket.remove(btn.getAttribute('data-remove'));
        renderBasket();
      });
    });
  }

  /* --- validation -------------------------------------------------------- */

  function setError(name, message) {
    var node = document.querySelector('[data-error-for="' + name + '"]');
    var input = document.querySelector('[name="' + name + '"]');
    if (node) { node.textContent = message; node.hidden = !message; }
    if (input) input.classList.toggle('is-invalid', !!message);
  }

  function validateForm(form) {
    var ok = true;
    var required = ['buyerName', 'buyerEmail', 'buyerPhone'];
    if (form.deliveryMethod.value === 'delivery') required.push('address');

    ['buyerName', 'buyerEmail', 'buyerPhone', 'address'].forEach(function (n) { setError(n, ''); });

    required.forEach(function (name) {
      var value = (form[name].value || '').trim();
      if (!value) { setError(name, 'Please fill this in.'); ok = false; }
      else if (name === 'buyerEmail' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
        setError(name, 'That email address does not look right.'); ok = false;
      }
    });
    return ok;
  }

  /* --- summary ----------------------------------------------------------- */

  function buildSummary(form, ref, items) {
    var lines = [];
    lines.push('ORDER ' + ref);
    lines.push('Layered by Light');
    lines.push('');
    lines.push('CUSTOMER');
    lines.push('Name: ' + form.buyerName.value.trim());
    lines.push('Email: ' + form.buyerEmail.value.trim());
    lines.push('Phone: ' + form.buyerPhone.value.trim());
    lines.push('Delivery: ' + (form.deliveryMethod.value === 'delivery' ? 'Deliver to address' : 'Self-collection'));
    if (form.deliveryMethod.value === 'delivery') lines.push('Address: ' + form.address.value.trim());
    if (form.neededBy.value) lines.push('Needed by: ' + form.neededBy.value);
    lines.push('Gift: ' + (form.isGift.value === 'yes' ? 'Yes - send directly to recipient' : 'No'));
    if (form.notes.value.trim()) lines.push('Notes: ' + form.notes.value.trim());
    lines.push('');
    lines.push('PIECES');
    items.forEach(function (line, i) {
      lines.push((i + 1) + '. ' + line.name + ' - ' + LBL.money(line.price));
      (line.options || []).forEach(function (o) {
        lines.push('   ' + o.label + ': ' + (o.valueLabel || o.value));
      });
    });
    lines.push('');
    lines.push('SUBTOTAL: ' + LBL.money(LBL.basket.total()) + ' (delivery not included)');
    return lines.join('\n');
  }

  function showSuccess(ref, summary, hasPhotos) {
    var host = document.querySelector('[data-order-success]');
    var main = document.querySelector('.split');
    if (main) main.hidden = true;

    var mailto = 'mailto:' + (shop.email || '') +
      '?subject=' + encodeURIComponent('Order ' + ref) +
      '&body=' + encodeURIComponent(summary);
    var wa = 'https://wa.me/' + String(shop.whatsapp || '').replace(/[^0-9]/g, '') +
      '?text=' + encodeURIComponent(summary);

    host.hidden = false;
    host.innerHTML = '' +
      '<div class="panel stack">' +
        '<p class="badge">Order ' + LBL.escapeHtml(ref) + '</p>' +
        '<h2>Almost there — send us your order</h2>' +
        '<p class="muted">Your order is not with us yet. Send the summary below using either button, and we will reply with your PayNow payment instructions and a proof of your piece.</p>' +
        (hasPhotos ? '<p class="note note--warn">Your order includes a photo. Please attach the photo file to your email or WhatsApp message, quoting ' + LBL.escapeHtml(ref) + '.</p>' : '') +
        '<p>' +
          '<a class="btn btn--primary" href="' + mailto + '">Send by email</a> ' +
          (shop.whatsapp ? '<a class="btn btn--ghost" href="' + wa + '" target="_blank" rel="noopener">Send by WhatsApp</a>' : '') +
        '</p>' +
        '<h3>Your order summary</h3>' +
        '<textarea rows="16" readonly data-summary-text>' + LBL.escapeHtml(summary) + '</textarea>' +
        '<button type="button" class="btn btn--ghost" data-copy>Copy summary</button>' +
        '<p class="field__help">Keep your order reference — quote it in any message to us.</p>' +
      '</div>';

    var copyBtn = host.querySelector('[data-copy]');
    copyBtn.addEventListener('click', function () {
      var ta = host.querySelector('[data-summary-text]');
      ta.select();
      try { document.execCommand('copy'); copyBtn.textContent = 'Copied'; }
      catch (err) { copyBtn.textContent = 'Press Cmd+C to copy'; }
    });

    host.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  /* --- submit ------------------------------------------------------------ */

  function handleSubmit(event) {
    event.preventDefault();
    var form = event.target;
    var errNode = document.querySelector('[data-order-error]');

    if (!validateForm(form)) {
      if (errNode) { errNode.textContent = 'Please check the highlighted fields.'; errNode.hidden = false; }
      return;
    }
    if (errNode) errNode.hidden = true;

    var items = LBL.basket.read();
    if (!items.length) return;

    var ref = orderReference();
    var summary = buildSummary(form, ref, items);
    var hasPhotos = items.some(function (l) {
      return (l.options || []).some(function (o) { return o.type === 'file'; });
    });

    if (ORDER_ENDPOINT) {
      fetch(ORDER_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reference: ref, summary: summary, items: items })
      }).catch(function () { /* fall through to manual send either way */ });
    }

    showSuccess(ref, summary, hasPhotos);
    LBL.basket.clear();
  }

  document.addEventListener('DOMContentLoaded', function () {
    if (!LBL) return;
    renderBasket();

    var form = document.querySelector('[data-order-form]');
    if (!form) return;

    var addressField = document.querySelector('[data-address-field]');
    form.deliveryMethod.addEventListener('change', function () {
      if (addressField) addressField.hidden = form.deliveryMethod.value !== 'delivery';
    });

    form.addEventListener('submit', handleSubmit);
  });

}(window));
