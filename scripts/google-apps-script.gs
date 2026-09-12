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
var OWNER_EMAIL = 'CHANGE-ME@example.com';   // where new orders are sent
var SHOP_NAME   = 'Layered by Light';
var SHEET_NAME  = 'Orders';
var DRIVE_FOLDER = 'Layered by Light payments';   // payment screenshots are filed here

// ---------------------------------------------------------------------------

function doPost(e) {
  try {
    var order = JSON.parse(e.postData.contents);
    var proofUrl = '', photos = [];
    try {
      proofUrl = saveProof_(order);       // never lose an order over a bad image
    } catch (proofErr) {
      proofUrl = 'UPLOAD FAILED: ' + proofErr;
    }
    try {
      photos = savePhotos_(order);
    } catch (photoErr) {
      photos = [{ label: 'photo', name: '', url: 'UPLOAD FAILED: ' + photoErr }];
    }
    appendOrderRow_(order, proofUrl, photos.map(function (p) { return p.url; }));
    emailOwner_(order, proofUrl, photos);
    emailCustomer_(order);
    return jsonOut_({ ok: true, reference: order.reference });
  } catch (err) {
    // Still try to tell the owner something arrived and broke.
    try {
      MailApp.sendEmail(OWNER_EMAIL, '[' + SHOP_NAME + '] Order failed to record',
        'An order came in but could not be processed.\n\nError: ' + err +
        '\n\nRaw data:\n' + (e && e.postData ? e.postData.contents : '(none)'));
    } catch (ignored) {}
    return jsonOut_({ ok: false, error: String(err) });
  }
}

function doGet() {
  return jsonOut_({ ok: true, message: SHOP_NAME + ' order receiver is running.' });
}

// --- sheet -----------------------------------------------------------------

var HEADERS = [
  'Received', 'Reference', 'Status', 'Name', 'Email', 'Phone', 'Address',
  'Gift', 'Customer photos', 'Pieces',
  'Subtotal (SGD)', 'Shipping (SGD)', 'Total paid (SGD)',
  'PayNow ref', 'Payment screenshot', 'Notes', 'Full order'
];

function sheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(SHEET_NAME);
  if (!sh) sh = ss.insertSheet(SHEET_NAME);
  if (sh.getLastRow() === 0) {
    sh.appendRow(HEADERS);
    var header = sh.getRange(1, 1, 1, HEADERS.length);
    header.setFontWeight('bold').setBackground('#f2ece2');
    sh.setFrozenRows(1);
    sh.setColumnWidth(17, 420);   // Full order
    sh.setColumnWidth(7, 220);    // Address
  }
  return sh;
}

function appendOrderRow_(order, proofUrl, photoUrls) {
  var sh = sheet_();
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
    (photoUrls && photoUrls.length) ? photoUrls.join('\n') : '',
    order.items.length,
    Number(order.subtotal),
    Number(order.shipping),
    Number(order.total),
    payment.reference || '',
    proofUrl ? proofUrl : 'NOT ATTACHED',
    order.notes || '',
    orderDetail_(order)
  ]);
  var row = sh.getLastRow();
  sh.getRange(row, 1, 1, HEADERS.length).setVerticalAlignment('top');
  sh.getRange(row, 17).setWrap(true);
}

// --- payment screenshot ------------------------------------------------------

function folder_() {
  var it = DriveApp.getFoldersByName(DRIVE_FOLDER);
  return it.hasNext() ? it.next() : DriveApp.createFolder(DRIVE_FOLDER);
}

function saveImage_(file, filename) {
  if (!file || !file.data) return '';
  var ext = (file.name && file.name.indexOf('.') > -1)
    ? file.name.slice(file.name.lastIndexOf('.'))
    : '.png';
  var blob = Utilities.newBlob(
    Utilities.base64Decode(file.data),
    file.mimeType || 'image/png',
    filename + ext
  );
  var saved = folder_().createFile(blob);
  // Anyone with the link can view, so the links in your email open straight up.
  try {
    saved.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  } catch (ignored) {}
  return saved.getUrl();
}

function saveProof_(order) {
  return saveImage_(order.payment && order.payment.proof, order.reference + ' payment');
}

// Photos the customer uploaded for their pieces - lithophanes and the like.
function savePhotos_(order) {
  var photos = order.photos || [];
  return photos.map(function (photo, i) {
    var url = saveImage_(photo, order.reference + ' photo ' + (i + 1));
    return { label: (photo.item || '') + ' - ' + (photo.label || 'photo'), name: photo.name, url: url };
  });
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

function emailOwner_(order, proofUrl, photos) {
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
    to: OWNER_EMAIL,
    replyTo: order.customer.email,
    subject: '[' + SHOP_NAME + '] PAID order ' + order.reference + ' - ' +
             money_(order.total) + ' - ' + order.customer.name,
    body: body
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
    replyTo: OWNER_EMAIL,
    subject: 'Your ' + SHOP_NAME + ' order ' + order.reference + ' - payment received',
    body: body
  });
}

// --- util ------------------------------------------------------------------

function jsonOut_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
