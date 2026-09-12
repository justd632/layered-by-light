/* ==========================================================================
   Layered by Light — order page (pay first, then confirm)

   Step 1  buyer details
   Step 2  PayNow QR, reference number and payment screenshot
   Submit  posts the order + screenshot to the Apps Script receiver

   Shipping comes from products.json: shop.shippingFee, shop.freeShippingFrom.
   Endpoint comes from products.json: shop.orderEndpoint.

   If the send fails AFTER the customer has paid, they are told clearly that
   their payment is safe, given an email fallback, and their basket is kept.
   ========================================================================== */
(function (global) {
  'use strict';

  var LBL = global.LBL;
  var shop = (LBL && LBL.data && LBL.data.shop) || {};
  var ENDPOINT = shop.orderEndpoint || '';
  var SHIPPING_FEE = Number(shop.shippingFee != null ? shop.shippingFee : 2);
  var FREE_FROM = Number(shop.freeShippingFrom != null ? shop.freeShippingFrom : 25);
  var MAX_PROOF_BYTES = 5 * 1024 * 1024;

  var submitting = false;
  var details = null;   // captured from step 1

  function orderReference() {
    var d = new Date();
    return 'LBL-' + String(d.getFullYear()).slice(2) +
      String(d.getMonth() + 1).padStart(2, '0') +
      String(d.getDate()).padStart(2, '0') + '-' +
      Math.random().toString(36).slice(2, 6).toUpperCase();
  }

  /* --- money ------------------------------------------------------------- */

  function subtotal() { return LBL.basket.total(); }
  function shipping() { return subtotal() >= FREE_FROM ? 0 : SHIPPING_FEE; }
  function grandTotal() { return subtotal() + shipping(); }

  function refreshTotals() {
    var sub = subtotal(), ship = shipping(), total = grandTotal();
    var set = function (sel, text) {
      var n = document.querySelector(sel);
      if (n) n.textContent = text;
    };
    set('[data-subtotal]', LBL.money(sub));
    set('[data-shipping]', ship === 0 ? 'Free' : LBL.money(ship));
    set('[data-total]', LBL.money(total));
    set('[data-pay-amount]', LBL.money(total));
    set('[data-pay-amount-inline]', LBL.money(total));

    var nudge = document.querySelector('[data-shipping-nudge]');
    if (nudge) {
      if (sub > 0 && sub < FREE_FROM) {
        nudge.innerHTML = 'Add ' + LBL.money(FREE_FROM - sub) +
          ' more and shipping is free. <a href="shop.html">Keep browsing</a>.';
        nudge.hidden = false;
      } else if (sub >= FREE_FROM) {
        nudge.textContent = 'Your order qualifies for free shipping.';
        nudge.hidden = false;
      } else {
        nudge.hidden = true;
      }
    }
  }

  /* --- basket ------------------------------------------------------------ */

  function renderBasket() {
    var host = document.querySelector('[data-basket-list]');
    var totalBox = document.querySelector('[data-basket-total]');
    var checkout = document.querySelector('[data-checkout]');
    if (!host) return;

    var items = LBL.basket.read();

    if (!items.length) {
      host.innerHTML = '<div class="empty-state"><p>Your order is empty.</p>' +
        '<p><a class="btn btn--primary" href="shop.html">Browse the shop</a></p></div>';
      if (totalBox) totalBox.hidden = true;
      var d = document.querySelector('[data-step-details]');
      var p = document.querySelector('[data-step-payment]');
      if (d) d.hidden = true;
      if (p) p.hidden = true;
      return;
    }

    if (totalBox) totalBox.hidden = false;
    if (checkout) checkout.hidden = false;

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

    host.querySelectorAll('[data-remove]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        LBL.basket.remove(btn.getAttribute('data-remove'));
        renderBasket();
        refreshTotals();
        showStep('details');   // amount changed, so send them back to re-confirm
      });
    });

    refreshTotals();
  }

  /* --- steps ------------------------------------------------------------- */

  function showStep(which) {
    var d = document.querySelector('[data-step-details]');
    var p = document.querySelector('[data-step-payment]');
    var label = document.querySelector('[data-step-label]');
    var intro = document.querySelector('[data-step-intro]');
    if (!d || !p) return;

    var onPayment = which === 'payment';
    d.hidden = onPayment;
    p.hidden = !onPayment;

    if (label) label.textContent = onPayment ? 'Step 2 of 2 — payment' : 'Step 1 of 2 — your details';
    if (intro) {
      intro.textContent = onPayment
        ? 'Pay the amount shown, then give us your reference number and a screenshot so we can match your payment to your order.'
        : 'Check your personalisation details carefully — pieces are printed exactly as written here. You will still see a proof before anything is made.';
    }
    if (onPayment) p.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  /* --- validation -------------------------------------------------------- */

  function setError(name, message) {
    var node = document.querySelector('[data-error-for="' + name + '"]');
    var input = document.querySelector('[name="' + name + '"]');
    if (node) { node.textContent = message; node.hidden = !message; }
    if (input) input.classList.toggle('is-invalid', !!message);
  }

  function validateDetails(form) {
    var ok = true;
    ['buyerName', 'buyerEmail', 'buyerPhone', 'address'].forEach(function (name) {
      setError(name, '');
      var value = (form[name].value || '').trim();
      if (!value) { setError(name, 'Please fill this in.'); ok = false; }
      else if (name === 'buyerEmail' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
        setError(name, 'That email address does not look right.'); ok = false;
      }
    });
    return ok;
  }

  function validatePayment(form) {
    var ok = true;
    setError('paynowRef', '');
    setError('paymentProof', '');

    if (!(form.paynowRef.value || '').trim()) {
      setError('paynowRef', 'Please enter the reference from your payment.'); ok = false;
    }
    var file = form.paymentProof.files && form.paymentProof.files[0];
    if (!file) {
      setError('paymentProof', 'Please attach a screenshot of your payment.'); ok = false;
    } else if (!/^image\//.test(file.type)) {
      setError('paymentProof', 'That is not an image. Please attach a screenshot.'); ok = false;
    } else if (file.size > MAX_PROOF_BYTES) {
      setError('paymentProof', 'That image is larger than 5MB. Please attach a smaller screenshot.'); ok = false;
    }
    return ok;
  }

  /* --- payload ----------------------------------------------------------- */

  function readFileAsBase64(file) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () {
        var result = String(reader.result || '');
        resolve(result.slice(result.indexOf(',') + 1));   // strip the data: prefix
      };
      reader.onerror = function () { reject(new Error('Could not read that file')); };
      reader.readAsDataURL(file);
    });
  }

  function buildOrder(ref, items, payment) {
    return {
      reference: ref,
      placedAt: new Date().toISOString(),
      customer: { name: details.name, email: details.email, phone: details.phone },
      delivery: { address: details.address, isGift: details.isGift },
      notes: details.notes,
      items: items.map(function (l) {
        return {
          name: l.name, price: l.price, leadTime: l.leadTime,
          options: (l.options || []).map(function (o) {
            return { label: o.label, value: o.valueLabel || o.value, type: o.type };
          })
        };
      }),
      subtotal: subtotal(),
      shipping: shipping(),
      total: grandTotal(),
      payment: payment,
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
    out.push('Address: ' + order.delivery.address);
    out.push('Gift: ' + (order.delivery.isGift ? 'Yes - send directly to recipient' : 'No'));
    if (order.notes) out.push('Notes: ' + order.notes);
    out.push('', 'PIECES');
    order.items.forEach(function (item, i) {
      out.push((i + 1) + '. ' + item.name + ' - $' + Number(item.price).toFixed(2));
      item.options.forEach(function (o) { out.push('   ' + o.label + ': ' + o.value); });
    });
    out.push('');
    out.push('Subtotal: $' + order.subtotal.toFixed(2));
    out.push('Shipping: ' + (order.shipping === 0 ? 'Free' : '$' + order.shipping.toFixed(2)));
    out.push('TOTAL PAID: $' + order.total.toFixed(2));
    out.push('PayNow reference: ' + order.payment.reference);
    return out.join('\n');
  }

  /* --- result screens ---------------------------------------------------- */

  function hideCheckout() {
    var c = document.querySelector('[data-checkout]');
    if (c) c.hidden = true;
  }

  function summaryDetails(text) {
    return '<details><summary class="small muted">View your full order details</summary>' +
      '<textarea rows="16" readonly style="margin-top: var(--sp-3);">' + LBL.escapeHtml(text) + '</textarea></details>';
  }

  function showSent(order, text) {
    hideCheckout();
    var host = document.querySelector('[data-order-success]');
    host.hidden = false;
    host.innerHTML = '' +
      '<div class="panel stack">' +
        '<p class="badge">Order ' + LBL.escapeHtml(order.reference) + '</p>' +
        '<h2>Thank you — payment received</h2>' +
        '<p class="muted">A copy is on its way to <strong>' + LBL.escapeHtml(order.customer.email) + '</strong>. ' +
          'If it has not arrived in a few minutes, check your spam folder.</p>' +
        '<h3>What happens next</h3>' +
        '<ol class="steps">' +
          '<li><div><h3>We check your payment</h3><p class="muted small">We match your reference against what we have received.</p></div></li>' +
          '<li><div><h3>We send you a proof</h3><p class="muted small">A mock-up of your piece. Nothing is printed until you approve it.</p></div></li>' +
          '<li><div><h3>We make it and post it</h3><p class="muted small">Made in ' +
            LBL.escapeHtml(order.items[0].leadTime || 'a few working days') + ' from the day you approve.</p></div></li>' +
        '</ol>' +
        (order.photosExpected
          ? '<p class="note note--warn"><strong>One thing left to do:</strong> your order includes a photo. ' +
            'Reply to your confirmation email with the photo attached and we will take it from there.</p>'
          : '') +
        summaryDetails(text) +
        '<p><a class="btn btn--ghost" href="shop.html">Back to the shop</a></p>' +
      '</div>';
    host.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function showFallback(order, text, reason) {
    hideCheckout();
    var host = document.querySelector('[data-order-success]');
    var mailto = 'mailto:' + (shop.email || '') +
      '?subject=' + encodeURIComponent('Order ' + order.reference) +
      '&body=' + encodeURIComponent(text);

    host.hidden = false;
    host.innerHTML = '' +
      '<div class="panel stack">' +
        '<p class="badge">Order ' + LBL.escapeHtml(order.reference) + '</p>' +
        '<h2>Your payment is safe — but we need one more step</h2>' +
        '<p class="note note--warn">We could not send your order details automatically' +
          (reason ? ' (' + LBL.escapeHtml(reason) + ')' : '') + '. ' +
          '<strong>Your payment has not been lost.</strong> Send us the details with the button below, ' +
          'attaching your payment screenshot, and we will match it up.</p>' +
        '<p><a class="btn btn--primary" href="' + mailto + '">Send my order by email</a></p>' +
        summaryDetails(text) +
        '<p class="field__help">Your order is still saved in this browser. Quote reference ' +
          LBL.escapeHtml(order.reference) + ' in any message to us.</p>' +
      '</div>';
    host.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  /* --- submit ------------------------------------------------------------ */

  function handlePaymentSubmit(event) {
    event.preventDefault();
    if (submitting) return;

    var form = event.target;
    var errNode = document.querySelector('[data-payment-error]');
    var button = form.querySelector('button[type="submit"]');

    if (!validatePayment(form)) {
      if (errNode) { errNode.textContent = 'Please check the highlighted fields.'; errNode.hidden = false; }
      return;
    }
    if (errNode) errNode.hidden = true;

    var items = LBL.basket.read();
    if (!items.length) return;

    submitting = true;
    var original = button.textContent;
    button.disabled = true;
    button.textContent = 'Sending your order…';

    var file = form.paymentProof.files[0];

    readFileAsBase64(file)
      .then(function (base64) {
        var order = buildOrder(orderReference(), items, {
          method: 'PayNow',
          reference: form.paynowRef.value.trim(),
          proof: { name: file.name, mimeType: file.type, data: base64 }
        });
        var text = summaryText(order);

        if (!ENDPOINT) {
          showFallback(order, text, 'ordering is not connected yet');
          return;
        }

        // Plain string body keeps this a simple request, which avoids the CORS
        // preflight that Apps Script web apps do not answer.
        return fetch(ENDPOINT, { method: 'POST', body: JSON.stringify(order), redirect: 'follow' })
          .then(function (res) {
            if (!res.ok) throw new Error('server responded ' + res.status);
            LBL.basket.clear();
            showSent(order, text);
          })
          .catch(function (err) {
            showFallback(order, text, 'connection problem');
            if (global.console) global.console.error('Order submission failed:', err);
          });
      })
      .catch(function (err) {
        if (errNode) {
          errNode.textContent = 'We could not read that screenshot. Please try another image.';
          errNode.hidden = false;
        }
        if (global.console) global.console.error(err);
      })
      .then(function () {
        submitting = false;
        button.disabled = false;
        button.textContent = original;
      });
  }

  /* --- init -------------------------------------------------------------- */

  document.addEventListener('DOMContentLoaded', function () {
    if (!LBL) return;
    renderBasket();

    var detailsForm = document.querySelector('[data-details-form]');
    var paymentForm = document.querySelector('[data-payment-form]');
    if (!detailsForm || !paymentForm) return;

    detailsForm.addEventListener('submit', function (event) {
      event.preventDefault();
      var errNode = document.querySelector('[data-details-error]');
      if (!validateDetails(detailsForm)) {
        if (errNode) { errNode.textContent = 'Please check the highlighted fields.'; errNode.hidden = false; }
        return;
      }
      if (errNode) errNode.hidden = true;

      details = {
        name: detailsForm.buyerName.value.trim(),
        email: detailsForm.buyerEmail.value.trim(),
        phone: detailsForm.buyerPhone.value.trim(),
        address: detailsForm.address.value.trim(),
        isGift: detailsForm.isGift.value === 'yes',
        notes: detailsForm.notes.value.trim()
      };
      refreshTotals();
      showStep('payment');
    });

    paymentForm.addEventListener('submit', handlePaymentSubmit);

    var back = document.querySelector('[data-back-to-details]');
    if (back) back.addEventListener('click', function () { showStep('details'); });
  });

}(window));
