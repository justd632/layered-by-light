/* ==========================================================================
   Layered by Light — order page
   Renders the basket, validates buyer details, posts the order to the
   Google Apps Script receiver, and confirms.

   The endpoint lives in data/products.json under shop.orderEndpoint.
   See scripts/google-apps-script.gs for how to create it.

   If the endpoint is missing or the send fails, the customer is given an
   email button instead and THE BASKET IS KEPT, so an order is never lost.
   ========================================================================== */
(function (global) {
  'use strict';

  var LBL = global.LBL;
  var shop = (LBL && LBL.data && LBL.data.shop) || {};
  var ENDPOINT = shop.orderEndpoint || '';

  var submitting = false;

  function orderReference() {
    var d = new Date();
    var stamp = String(d.getFullYear()).slice(2) +
      String(d.getMonth() + 1).padStart(2, '0') +
      String(d.getDate()).padStart(2, '0');
    return 'LBL-' + stamp + '-' + Math.random().toString(36).slice(2, 6).toUpperCase();
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

  /* --- payload ----------------------------------------------------------- */

  function buildOrder(form, ref, items) {
    return {
      reference: ref,
      placedAt: new Date().toISOString(),
      customer: {
        name: form.buyerName.value.trim(),
        email: form.buyerEmail.value.trim(),
        phone: form.buyerPhone.value.trim()
      },
      delivery: {
        method: form.deliveryMethod.value,
        address: form.deliveryMethod.value === 'delivery' ? form.address.value.trim() : '',
        neededBy: form.neededBy.value || '',
        isGift: form.isGift.value === 'yes'
      },
      notes: form.notes.value.trim(),
      items: items.map(function (l) {
        return {
          name: l.name, price: l.price, leadTime: l.leadTime,
          options: (l.options || []).map(function (o) {
            return { label: o.label, value: o.valueLabel || o.value, type: o.type };
          })
        };
      }),
      subtotal: LBL.basket.total(),
      photosExpected: items.some(function (l) {
        return (l.options || []).some(function (o) { return o.type === 'file'; });
      })
    };
  }

  function summaryText(order) {
    var out = ['ORDER ' + order.reference, shop.name || 'Layered by Light', '', 'CUSTOMER'];
    out.push('Name: ' + order.customer.name);
    out.push('Email: ' + order.customer.email);
    out.push('Phone: ' + order.customer.phone);
    out.push('Delivery: ' + (order.delivery.method === 'delivery' ? 'Deliver to address' : 'Self-collection'));
    if (order.delivery.address) out.push('Address: ' + order.delivery.address);
    if (order.delivery.neededBy) out.push('Needed by: ' + order.delivery.neededBy);
    out.push('Gift: ' + (order.delivery.isGift ? 'Yes - send directly to recipient' : 'No'));
    if (order.notes) out.push('Notes: ' + order.notes);
    out.push('', 'PIECES');
    order.items.forEach(function (item, i) {
      out.push((i + 1) + '. ' + item.name + ' - $' + Number(item.price).toFixed(2));
      item.options.forEach(function (o) { out.push('   ' + o.label + ': ' + o.value); });
    });
    out.push('', 'SUBTOTAL: $' + Number(order.subtotal).toFixed(2) + ' (delivery not included)');
    return out.join('\n');
  }

  /* --- result screens ---------------------------------------------------- */

  function hideForm() {
    var main = document.querySelector('.split');
    if (main) main.hidden = true;
  }

  function summaryDetails(text) {
    return '<details><summary class="small muted">View your full order details</summary>' +
      '<textarea rows="14" readonly style="margin-top: var(--sp-3);">' + LBL.escapeHtml(text) + '</textarea>' +
      '</details>';
  }

  function showSent(order, text) {
    hideForm();
    var host = document.querySelector('[data-order-success]');
    host.hidden = false;
    host.innerHTML = '' +
      '<div class="panel stack">' +
        '<p class="badge">Order ' + LBL.escapeHtml(order.reference) + '</p>' +
        '<h2>Thank you — we have your order</h2>' +
        '<p class="muted">A copy is on its way to <strong>' + LBL.escapeHtml(order.customer.email) + '</strong>. ' +
          'If it does not arrive within a few minutes, check your spam folder.</p>' +
        '<h3>What happens next</h3>' +
        '<ol class="steps">' +
          '<li><div><h3>We confirm and send payment details</h3><p class="muted small">You will get PayNow instructions and the delivery cost.</p></div></li>' +
          '<li><div><h3>We send you a proof</h3><p class="muted small">A mock-up of your piece. Nothing is printed until you approve it.</p></div></li>' +
          '<li><div><h3>We make it and post it</h3><p class="muted small">Made in ' + LBL.escapeHtml(order.items[0].leadTime || 'a few working days') + ' from the day you approve.</p></div></li>' +
        '</ol>' +
        (order.photosExpected
          ? '<p class="note note--warn"><strong>One thing left to do:</strong> your order includes a photo. ' +
            'Reply to your confirmation email with the photo attached, and we will take it from there.</p>'
          : '') +
        summaryDetails(text) +
        '<p><a class="btn btn--ghost" href="shop.html">Back to the shop</a></p>' +
      '</div>';
    host.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function showFallback(order, text, reason) {
    hideForm();
    var host = document.querySelector('[data-order-success]');
    var mailto = 'mailto:' + (shop.email || '') +
      '?subject=' + encodeURIComponent('Order ' + order.reference) +
      '&body=' + encodeURIComponent(text);

    host.hidden = false;
    host.innerHTML = '' +
      '<div class="panel stack">' +
        '<p class="badge">Order ' + LBL.escapeHtml(order.reference) + '</p>' +
        '<h2>Almost there — one more tap</h2>' +
        '<p class="note note--warn">We could not submit your order automatically' +
          (reason ? ' (' + LBL.escapeHtml(reason) + ')' : '') +
          '. Nothing is lost — send it to us with the button below and we will pick it up from there.</p>' +
        '<p><a class="btn btn--primary" href="' + mailto + '">Send my order by email</a></p>' +
        summaryDetails(text) +
        '<p class="field__help">Your order is still saved in this browser, so you can also try again later.</p>' +
        '<p><button type="button" class="btn btn--ghost" data-retry>Try submitting again</button></p>' +
      '</div>';

    var retry = host.querySelector('[data-retry]');
    if (retry) retry.addEventListener('click', function () { global.location.reload(); });
    host.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  /* --- submit ------------------------------------------------------------ */

  function handleSubmit(event) {
    event.preventDefault();
    if (submitting) return;

    var form = event.target;
    var errNode = document.querySelector('[data-order-error]');
    var button = form.querySelector('button[type="submit"]');

    if (!validateForm(form)) {
      if (errNode) { errNode.textContent = 'Please check the highlighted fields.'; errNode.hidden = false; }
      return;
    }
    if (errNode) errNode.hidden = true;

    var items = LBL.basket.read();
    if (!items.length) return;

    var order = buildOrder(form, orderReference(), items);
    var text = summaryText(order);

    if (!ENDPOINT) {
      showFallback(order, text, 'ordering is not connected yet');
      return;
    }

    submitting = true;
    var original = button.textContent;
    button.disabled = true;
    button.textContent = 'Sending your order…';

    // Sent as a plain string body so the browser uses text/plain and skips the
    // CORS preflight, which Apps Script web apps do not answer.
    fetch(ENDPOINT, { method: 'POST', body: JSON.stringify(order), redirect: 'follow' })
      .then(function (res) {
        if (!res.ok) throw new Error('server responded ' + res.status);
        // The order reached the script; clearing is now safe.
        LBL.basket.clear();
        showSent(order, text);
      })
      .catch(function (err) {
        showFallback(order, text, 'connection problem');
        if (global.console) global.console.error('Order submission failed:', err);
      })
      .then(function () {
        submitting = false;
        button.disabled = false;
        button.textContent = original;
      });
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
