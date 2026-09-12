/**
 * Layered by Light — order receiver
 * ============================================================================
 * Receives orders from the website, writes each one as a row in a Google
 * Sheet, emails you, and emails the customer their confirmation.
 *
 * ---------------------------------------------------------------------------
 * SETUP  (about 10 minutes, once)
 * ---------------------------------------------------------------------------
 * 1. Go to sheets.new to create a spreadsheet. Name it "Layered by Light
 *    Orders". You do NOT need to add any headers - this script creates them.
 *
 *    Payment screenshots are saved to a Google Drive folder named in
 *    DRIVE_FOLDER below, created automatically on the first order. The sheet
 *    links to each one.
 *
 * 2. In that sheet: Extensions > Apps Script. Delete whatever is in the
 *    editor and paste this entire file in. Click the save icon.
 *
 * 3. Change OWNER_EMAIL below to your real email address.
 *
 * 4. Click Deploy > New deployment.
 *      - Click the gear next to "Select type" and choose "Web app"
 *      - Description:     Layered by Light orders
 *      - Execute as:      Me
 *      - Who has access:  Anyone          <-- this matters, see note below
 *    Click Deploy.
 *
 * 5. Google will ask you to authorise it. Click "Review permissions", pick
 *    your account, then on the "Google hasn't verified this app" screen click
 *    "Advanced" > "Go to Layered by Light orders (unsafe)". This warning is
 *    normal for your own scripts - you are authorising code you just pasted
 *    in yourself. It needs permission to edit the sheet and send email as you.
 *
 * 6. Copy the Web app URL it gives you. It ends in /exec.
 *
 * 7. Open data/products.json in the website folder and paste that URL as
 *    "orderEndpoint" inside "shop". Then run:  node scripts/build.js
 *
 * 8. Place a test order on the site and check the sheet and your inbox.
 *
 * "Who has access: Anyone" means anyone with the URL can send data to this
 * script. That is what lets your website submit orders. It cannot read your
 * sheet or your email - it can only add rows and trigger the emails below.
 *
 * ---------------------------------------------------------------------------
 * IF YOU EDIT THIS SCRIPT LATER
 * ---------------------------------------------------------------------------
 * Deploy > Manage deployments > pencil icon > Version: New version > Deploy.
 * If you create a whole new deployment instead, the URL changes and you must
 * update products.json again.
 */

// ---------------------------------------------------------------------------
// SETTINGS - change these
// ---------------------------------------------------------------------------
// Where new orders are sent. For more than one recipient, separate them with
// commas - every address listed gets the full order email:
//   var OWNER_EMAIL = 'jl.alias919@gmail.com, someone.else@gmail.com';
var OWNER_EMAIL = 'jl.alias919@gmail.com';
var SHOP_NAME   = 'Layered by Light';
var SHEET_NAME  = 'Orders';
var DRIVE_FOLDER = 'Layered by Light payments';   // payment screenshots and customer photos are filed here

// Bump this whenever the script changes. Open the /exec URL in a browser and
// this is what it reports, so you can always tell which version is actually
// deployed - saving is not the same as deploying.
var SCRIPT_VERSION = '2026-09-13 clickable image links';

// ---------------------------------------------------------------------------

function doPost(e) {
  try {
    var order = JSON.parse(e.postData.contents);
    var proofBlob = toBlob_(order.payment && order.payment.proof, order.reference + ' payment');
    var photoParts = (order.photos || []).map(function (ph, i) {
      return {
        item: ph.item, label: ph.label, name: ph.name,
        blob: toBlob_(ph, order.reference + ' photo ' + (i + 1))
      };
    });

    var proofUrl = fileInDrive_(proofBlob);
    var photos = photoParts.map(function (part) {
      return {
        item: part.item,
        label: (part.item || '') + ' - ' + (part.label || 'photo'),
        name: part.name,
        url: fileInDrive_(part.blob) || ATTACHED
      };
    });

    var attachments = [proofBlob].concat(photoParts.map(function (x) { return x.blob; }))
      .filter(function (b) { return b; });

    appendOrderRow_(order, proofUrl || (proofBlob ? ATTACHED : 'NOT ATTACHED'),
                    photos.map(function (p) { return p.url; }));
    writeItemRows_(order, photos);
    emailOwner_(order, proofUrl || (proofBlob ? ATTACHED : 'NOT ATTACHED'), photos, attachments);
    emailCustomer_(order);
    return jsonOut_({ ok: true, reference: order.reference });
  } catch (err) {
    // Still try to tell the owner something arrived and broke.
    try {
      MailApp.sendEmail(recipients_(), '[' + SHOP_NAME + '] Order failed to record',
        'An order came in but could not be processed.\n\nError: ' + err +
        '\n\nRaw data:\n' + (e && e.postData ? e.postData.contents : '(none)'));
    } catch (ignored) {}
    return jsonOut_({ ok: false, error: String(err) });
  }
}

function doGet() {
  return jsonOut_({
    ok: true,
    version: SCRIPT_VERSION,
    message: SHOP_NAME + ' order receiver is running.'
  });
}

// --- sheet -----------------------------------------------------------------

var HEADERS = [
  'Received', 'Reference', 'Status', 'Name', 'Email', 'Phone', 'Address',
  'Gift', 'Customer photos', 'Pieces',
  'Subtotal (SGD)', 'Shipping (SGD)', 'Total paid (SGD)',
  'PayNow ref', 'Payment screenshot', 'Notes', 'Full order'
];

function sheetWithHeaders_(name, headers) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(name) || ss.insertSheet(name);

  if (sh.getLastRow() === 0) {
    sh.appendRow(headers);
  } else {
    // Repair a header row left behind by an older version of this script,
    // otherwise values land under the wrong labels.
    var width = Math.max(sh.getLastColumn(), headers.length);
    var current = sh.getRange(1, 1, 1, width).getValues()[0];
    var matches = headers.every(function (h, i) { return current[i] === h; });
    if (!matches) sh.getRange(1, 1, 1, headers.length).setValues([headers]);
  }

  sh.getRange(1, 1, 1, headers.length).setFontWeight('bold').setBackground('#f2ece2');
  sh.setFrozenRows(1);
  return sh;
}

// Product sheets grow their own columns as new options appear, so each
// product keeps exactly the fields it actually has.
function ensureColumns_(sh, needed) {
  var last = sh.getLastColumn();
  var header = last ? sh.getRange(1, 1, 1, last).getValues()[0] : [];
  while (header.length && header[header.length - 1] === '') header.pop();

  var grew = false;
  needed.forEach(function (h) {
    if (header.indexOf(h) === -1) { header.push(h); grew = true; }
  });
  if (grew) {
    sh.getRange(1, 1, 1, header.length).setValues([header]);
    sh.getRange(1, 1, 1, header.length).setFontWeight('bold').setBackground('#f2ece2');
    sh.setFrozenRows(1);
  }
  return header;
}

function tabName_(productName) {
  // Sheet names cannot contain : \ / ? * [ ]
  return String(productName || 'Other').replace(/[:\\\/?*\[\]]/g, '-').slice(0, 90);
}

var ITEM_BASE = ['Received', 'Reference', 'Status', 'Customer', 'Phone', 'Price (SGD)', 'Photo'];

// One row per PIECE, on a tab named after the product. This is the list you
// work from when making things: every car plate together, every lithophane
// together, each with only the options that product actually has.
function writeItemRows_(order, photos) {
  var when = new Date();

  // Photos arrive in the same order as the pieces that carry them, so take
  // them from a queue per product rather than assuming one each.
  var queue = {};
  (photos || []).forEach(function (ph) {
    (queue[ph.item] = queue[ph.item] || []).push(ph);
  });

  (order.items || []).forEach(function (item) {
    var labels = (item.options || []).map(function (o) { return o.label; });
    var sh = sheetWithHeaders_(tabName_(item.name), ITEM_BASE);
    var header = ensureColumns_(sh, ITEM_BASE.concat(labels));

    var photo = (queue[item.name] || []).shift();
    var values = {
      'Received': when,
      'Reference': order.reference,
      'Status': 'Paid - to verify',
      'Customer': order.customer.name,
      'Phone': order.customer.phone,
      'Price (SGD)': Number(item.price),
      'Photo': photo ? (linkCell_(photo.url, 'View photo') || photo.url) : ''
    };
    (item.options || []).forEach(function (o) { values[o.label] = o.value; });

    var row = header.map(function (h) { return values[h] != null ? values[h] : ''; });
    sh.appendRow(row);
    sh.getRange(sh.getLastRow(), 1, 1, header.length).setVerticalAlignment('top');
  });
}

// --- the master order row ----------------------------------------------------

function appendOrderRow_(order, proofUrl, photoUrls) {
  var sh = sheetWithHeaders_(SHEET_NAME, HEADERS);
  var payment = order.payment || {};
  sh.appendRow([
    new Date(),
    order.reference,
    'Paid - to verify',
    order.customer.name,
    order.customer.email,
    order.customer.phone,
    order.delivery.address || '',
    order.delivery.isGift ? 'Gift' : '',
    (photoUrls && photoUrls.length)
      ? (photoUrls.length === 1
          ? linkCell_(photoUrls[0], 'View photo')
          : photoUrls.join('\n'))
      : '',
    order.items.length,
    Number(order.subtotal),
    Number(order.shipping),
    Number(order.total),
    payment.reference || '',
    linkCell_(proofUrl, 'View payment') || 'NOT ATTACHED',
    order.notes || '',
    orderDetail_(order)
  ]);
  var row = sh.getLastRow();
  sh.getRange(row, 1, 1, HEADERS.length).setVerticalAlignment('top');
  sh.getRange(row, 17).setWrap(true);
  sh.setColumnWidth(17, 420);
  sh.setColumnWidth(7, 220);
}

// --- payment screenshots and customer photos ---------------------------------
//
// Images are ALWAYS attached to your order email, which needs no special
// permission. Filing them in Drive as well is a bonus: it gives you links in
// the sheet, but if Drive access has not been granted the order still lands
// with the pictures attached.

function toBlob_(file, filename) {
  if (!file || !file.data) return null;
  var ext = (file.name && file.name.indexOf('.') > -1)
    ? file.name.slice(file.name.lastIndexOf('.'))
    : '.png';
  try {
    return Utilities.newBlob(
      Utilities.base64Decode(file.data),
      file.mimeType || 'image/png',
      filename + ext
    );
  } catch (err) {
    return null;
  }
}

function folder_() {
  var it = DriveApp.getFoldersByName(DRIVE_FOLDER);
  return it.hasNext() ? it.next() : DriveApp.createFolder(DRIVE_FOLDER);
}

// Returns a link, or '' if Drive is unavailable. Never throws.
function fileInDrive_(blob) {
  if (!blob) return '';
  try {
    var saved = folder_().createFile(blob);
    try {
      saved.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    } catch (ignored) {}
    return saved.getUrl();
  } catch (err) {
    return '';
  }
}

var ATTACHED = 'Attached to your order email';

// A clickable cell, rather than a long raw URL filling the column.
function linkCell_(url, label) {
  if (!url) return '';
  if (url.indexOf('http') !== 0) return url;              // a status message
  return '=HYPERLINK("' + url + '","' + label + '")';
}

/**
 * RUN THIS ONCE FROM THE EDITOR to turn on Drive links.
 * Pick authoriseDrive in the function dropdown, press Run, and accept the
 * permission prompt. Then deploy a new version. Until you do, everything
 * still works - the images just arrive as email attachments only.
 */
function authoriseDrive() {
  var f = folder_();
  Logger.log('Drive access is working. Folder ready: ' + f.getName());
  return 'ok';
}

// --- text ------------------------------------------------------------------

function orderDetail_(order) {
  var lines = [];
  order.items.forEach(function (item, i) {
    lines.push((i + 1) + '. ' + item.name + ' - $' + Number(item.price).toFixed(2));
    (item.options || []).forEach(function (o) {
      lines.push('   ' + o.label + ': ' + o.value);
    });
  });
  return lines.join('\n');
}

function money_(n) { return '$' + Number(n).toFixed(2); }

// --- email -----------------------------------------------------------------

function emailOwner_(order, proofUrl, photos, attachments) {
  var payment = order.payment || {};
  var photoLines = (photos || []).length
    ? ['', 'CUSTOMER PHOTOS'].concat((photos || []).map(function (p) {
        return '  ' + p.label + ': ' + p.url;
      }))
    : [];
  var body = [
    'New PAID order ' + order.reference,
    '',
    'PAYMENT',
    'Amount:    ' + money_(order.total) +
      '  (subtotal ' + money_(order.subtotal) +
      ' + shipping ' + (order.shipping === 0 ? 'free' : money_(order.shipping)) + ')',
    'PayNow ref: ' + (payment.reference || '(none given)'),
    'Screenshot: ' + (proofUrl || 'NOT ATTACHED'),
    '',
    'VERIFY THIS AGAINST YOUR BANK BEFORE PRINTING.',
    '',
    'CUSTOMER',
    'From:     ' + order.customer.name,
    'Email:    ' + order.customer.email,
    'Phone:    ' + order.customer.phone,
    'Address:  ' + (order.delivery.address || ''),
    order.delivery.isGift ? 'GIFT - send directly to the recipient, no prices in the parcel.' : '',
    order.notes ? 'Notes:    ' + order.notes : '',
    ''
  ].concat(photoLines).concat([
    '',
    orderDetail_(order),
    '',
    'Next: confirm the payment landed, then send a proof before printing.'
  ]).filter(function (l) { return l !== ''; }).join('\n');

  MailApp.sendEmail({
    to: recipients_(),
    replyTo: order.customer.email,
    subject: '[' + SHOP_NAME + '] PAID order ' + order.reference + ' - ' +
             money_(order.total) + ' - ' + order.customer.name,
    body: body,
    attachments: attachments || []
  });
}

function emailCustomer_(order) {
  var body = [
    'Hi ' + order.customer.name.split(' ')[0] + ',',
    '',
    'Thank you for your order. Here is what we have, for your records.',
    '',
    'Order reference: ' + order.reference,
    '',
    orderDetail_(order),
    '',
    'Subtotal: ' + money_(order.subtotal),
    'Shipping: ' + (order.shipping === 0 ? 'Free' : money_(order.shipping)),
    'TOTAL PAID: ' + money_(order.total),
    'PayNow reference: ' + ((order.payment && order.payment.reference) || ''),
    '',
    'WHAT HAPPENS NEXT',
    '1. We check your payment against your reference number.',
    '2. We send you a proof - a mock-up of your piece. Nothing is printed',
    '   until you approve it, so this is your chance to correct anything.',
    '3. Once you approve it, we make your piece and post it.',
    '',
    'There is nothing more for you to do for now - we have everything we need,',
    'including any photo you uploaded.',
    '',
    'Please keep this email - quote your reference in any message to us.',
    '',
    'Every piece is made by hand after you order, which is why nothing is',
    'printed until you have seen it.',
    '',
    SHOP_NAME
  ].filter(function (l) { return l !== ''; }).join('\n');

  MailApp.sendEmail({
    to: order.customer.email,
    replyTo: replyAddress_(),
    subject: 'Your ' + SHOP_NAME + ' order ' + order.reference + ' - payment received',
    body: body
  });
}

// --- util ------------------------------------------------------------------

// Reply-To takes a single address, so customer replies go to the first one.
function replyAddress_() {
  return String(OWNER_EMAIL).split(',')[0].trim();
}

function recipients_() {
  return String(OWNER_EMAIL).split(',')
    .map(function (a) { return a.trim(); })
    .filter(function (a) { return a; })
    .join(',');
}

function jsonOut_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
