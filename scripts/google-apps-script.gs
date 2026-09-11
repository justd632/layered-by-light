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
var PAYNOW_NOTE = 'We will send you PayNow payment instructions shortly.';

// ---------------------------------------------------------------------------

function doPost(e) {
  try {
    var order = JSON.parse(e.postData.contents);
    appendOrderRow_(order);
    emailOwner_(order);
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
  'Received', 'Reference', 'Status', 'Name', 'Email', 'Phone',
  'Delivery', 'Address', 'Needed by', 'Gift', 'Photo to come',
  'Pieces', 'Subtotal (SGD)', 'Notes', 'Full order'
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
    sh.setColumnWidth(15, 420);   // Full order
    sh.setColumnWidth(8, 220);    // Address
  }
  return sh;
}

function appendOrderRow_(order) {
  var sh = sheet_();
  sh.appendRow([
    new Date(),
    order.reference,
    'New',
    order.customer.name,
    order.customer.email,
    order.customer.phone,
    order.delivery.method === 'delivery' ? 'Delivery' : 'Self-collection',
    order.delivery.address || '',
    order.delivery.neededBy || '',
    order.delivery.isGift ? 'Gift' : '',
    order.photosExpected ? 'YES' : '',
    order.items.length,
    Number(order.subtotal),
    order.notes || '',
    orderDetail_(order)
  ]);
  var row = sh.getLastRow();
  sh.getRange(row, 1, 1, HEADERS.length).setVerticalAlignment('top');
  sh.getRange(row, 15).setWrap(true);
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

function emailOwner_(order) {
  var body = [
    'New order ' + order.reference,
    '',
    'From:      ' + order.customer.name,
    'Email:     ' + order.customer.email,
    'Phone:     ' + order.customer.phone,
    'Delivery:  ' + (order.delivery.method === 'delivery' ? 'Deliver to address' : 'Self-collection'),
    order.delivery.address ? 'Address:   ' + order.delivery.address : '',
    order.delivery.neededBy ? 'Needed by: ' + order.delivery.neededBy : '',
    order.delivery.isGift ? 'GIFT - send directly to the recipient, no prices in the parcel.' : '',
    order.photosExpected ? 'PHOTO - customer has been asked to reply to their confirmation with it.' : '',
    order.notes ? 'Notes:     ' + order.notes : '',
    '',
    orderDetail_(order),
    '',
    'Subtotal: ' + money_(order.subtotal) + ' (delivery not included)',
    '',
    'Next: send payment instructions, then a proof before printing.'
  ].filter(function (l) { return l !== ''; }).join('\n');

  MailApp.sendEmail({
    to: OWNER_EMAIL,
    replyTo: order.customer.email,
    subject: '[' + SHOP_NAME + '] New order ' + order.reference + ' - ' +
             money_(order.subtotal) + ' - ' + order.customer.name,
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
    'Subtotal: ' + money_(order.subtotal) + ' (delivery not included)',
    '',
    'WHAT HAPPENS NEXT',
    '1. We confirm your order and send payment details. ' + PAYNOW_NOTE,
    '2. We send you a proof - a mock-up of your piece. Nothing is printed',
    '   until you approve it, so this is your chance to correct anything.',
    '3. Once you approve it, we make your piece and post it.',
    '',
    order.photosExpected
      ? 'ONE THING LEFT TO DO\nYour order includes a photo. Please reply to this email with the\nphoto attached. Bright, high-contrast pictures with a plain background\nwork best. We will tell you before printing if yours will not work.\n'
      : '',
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
    subject: 'Your ' + SHOP_NAME + ' order ' + order.reference,
    body: body
  });
}

// --- util ------------------------------------------------------------------

function jsonOut_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
