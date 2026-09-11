# Layered by Light

Handcrafted 3D-printed Christian keepsakes — made-to-order light boxes and bookmarks.

This is a plain static website. No build tools, no npm install, no framework.
You can open `index.html` in a browser by double-clicking it.

---

## Adding or changing a product

**Everything about your products lives in one file: `data/products.json`.**

1. Open `data/products.json` and add or edit a product.
2. Run the builder:
   ```
   node scripts/build.js
   ```
3. Done — the shop page, the homepage and the product's own page all update.

The builder checks your file first. If something is missing (no price, a
duplicate slug, a dropdown with no choices) it tells you what is wrong and
writes nothing, so you cannot accidentally break the live site.

### How product options work

Each product has an `options` array. Every entry becomes a field on that
product's page automatically — character counters, validation and pricing
included. You never have to touch the HTML.

| `type`     | What the customer sees                    | Useful keys |
|------------|-------------------------------------------|-------------|
| `text`     | Single-line box                           | `maxLength`, `placeholder`, `required` |
| `textarea` | Multi-line box                            | `maxLength`, `required` |
| `select`   | Dropdown                                  | `choices`, `required` |
| `file`     | Photo upload                              | `accept`, `required` |

Any `choices` entry can carry a `priceDelta`, which is added to the price when
selected. For example, an A4 size option with `"priceDelta": 18` shows as
"A4 (+$18.00)" and updates the live price as the customer chooses.

Use `maxLength` generously — it is what stops someone typing a 60-character
name that will not physically fit on the piece.

---

## Files

```
index.html              Homepage
shop.html               Catalogue, grouped by category
about.html              Your story  (placeholder text — rewrite this)
faq.html                Lead times, payment, proofs, returns  (placeholder — check every answer)
order.html              Basket, customer details, order submission

data/products.json      >>> THE FILE YOU EDIT <<<
data/products.js        Generated. Do not edit.
products/*.html         Generated. Do not edit.
templates/              Page template used by the builder
scripts/build.js        The builder
assets/css/style.css    All styling. Colours and fonts are at the very top.
assets/js/site.js       Basket, shared helpers
assets/js/configurator.js  Builds the personalisation form
assets/js/order.js      Order page and order summary
```

## Restyling the site

Open `assets/css/style.css`. Every colour, font and spacing value is defined in
the `:root` block at the top. Change them there and the whole site follows.
Nothing below that block hardcodes a colour.

---

## How an order currently reaches you

No payment is taken on the site. When a customer submits an order they get an
order reference (`LBL-260911-A4F2`) and a summary, with buttons to send it to
you by email or WhatsApp. You reply with PayNow instructions and a proof.

**Before going live, replace these placeholders:**

- `data/products.json` → `shop.email`, `shop.whatsapp`, `shop.paynowId`
- `about.html` → your real story
- `faq.html` → your real lead times, delivery rates and policies
- `assets/images/products/` → real product photography
- the email address in the footer of each page

**Photo uploads:** the site records the *filename* the customer chose and asks
them to send the photo with their order reference. Storing the actual file
needs a backend — worth adding once orders are steady.

To automate orders later, set `ORDER_ENDPOINT` at the top of
`assets/js/order.js` to a form-handler URL.

---

## Publishing

The site can be served as-is by GitHub Pages: repository **Settings → Pages →
Deploy from a branch → `main` / root**.
