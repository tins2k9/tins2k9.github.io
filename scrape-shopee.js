/**
 * scrape-shopee.js
 * ------------------------------------------------------------
 * Queries Shopee VN's public search endpoint for each GPU model
 * known to DreamyFrame X, picks the lowest matching price, and
 * writes gpu-prices.json next to index.html. The site's own JS
 * (applyLivePrices) fetches that file and overlays live prices
 * on top of the reference numbers baked into the page.
 *
 * Run manually:   node scrape-shopee.js
 * Run on a cron:  see setup notes at the bottom of this file.
 *
 * IMPORTANT — read before relying on this in production:
 *  - This hits an *undocumented* Shopee endpoint, not an official
 *    API. Shopee can change or block it at any time without notice,
 *    and their Terms of Service generally prohibit automated
 *    scraping of the site. Keep request volume low (this script
 *    already spaces requests out) and treat this as a best-effort
 *    feed, not a guaranteed one.
 *  - If Shopee starts returning 403/empty results, it usually
 *    means they've flagged the request pattern (missing cookies,
 *    datacenter IP, etc.). At that point gpu-prices.json simply
 *    won't update and the site quietly falls back to the reference
 *    prices already in index.html — nothing breaks, it just goes
 *    stale.
 *  - Matching a search result to a GPU "model" is done by loose
 *    name matching. Bundles, used cards, and unrelated accessories
 *    can slip through — spot-check gpu-prices.json after a run.
 * ------------------------------------------------------------
 */

const fs = require("fs");
const path = require("path");
const https = require("https");

const OUTPUT_PATH = path.join(__dirname, "gpu-prices.json");

// Same model names as the `gpus` array in index.html.
// Add/remove entries here to control what gets searched for.
const MODELS = [
  "RTX 5090", "RTX 4090", "RTX 5080", "RTX 4080 SUPER", "RTX 4080",
  "RTX 5070 Ti", "RTX 5070", "RTX 4070 Ti SUPER", "RTX 4070 Ti",
  "RTX 4070 SUPER", "RTX 4070", "RTX 5060 Ti", "RTX 4060 Ti",
  "RTX 5060", "RTX 4060", "RTX 3060 Ti", "RTX 3060", "RTX 3050",
  "RX 7900 XTX", "RX 7900 XT", "RX 7900 GRE", "RX 9070 XT", "RX 9070",
  "RX 7800 XT", "RX 7700 XT", "RX 6750 XT", "RX 6700 XT", "RX 6600 XT",
  "Arc A770", "Arc A750", "Arc B580",
];

function shopeeSearch(keyword) {
  return new Promise((resolve) => {
    const query = encodeURIComponent(`${keyword} card man hinh`);
    const url =
      `https://shopee.vn/api/v4/search/search_items?by=relevancy&keyword=${query}` +
      `&limit=20&newest=0&order=desc&page_type=search&scenario=PAGE_GLOBAL_SEARCH&version=2`;

    const req = https.get(
      url,
      {
        headers: {
          // Mimicking a normal browser search request. Shopee may still
          // block this — see the caveats above.
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
          Accept: "application/json",
          Referer: `https://shopee.vn/search?keyword=${query}`,
          "X-Requested-With": "XMLHttpRequest",
        },
        timeout: 12000,
      },
      (res) => {
        let body = "";
        res.on("data", (chunk) => (body += chunk));
        res.on("end", () => {
          try {
            const json = JSON.parse(body);
            resolve(json);
          } catch {
            resolve(null); // blocked, HTML error page, or rate-limited
          }
        });
      }
    );
    req.on("error", () => resolve(null));
    req.on("timeout", () => {
      req.destroy();
      resolve(null);
    });
  });
}

// Pick the cheapest plausible listing for a model out of a search response.
function pickBestListing(json, modelName) {
  const items = json?.items || [];
  const needle = modelName.toLowerCase();
  let best = null;

  for (const entry of items) {
    const item = entry.item_basic || entry.item || entry;
    if (!item?.name) continue;
    const name = item.name.toLowerCase();
    if (!name.includes(needle.replace(/\s+/g, " "))) continue;

    // Shopee prices are in the item's currency subunit (x100000).
    const rawPrice = item.price_min ?? item.price;
    if (!rawPrice) continue;
    const price = Math.round(rawPrice / 100000) * 1000; // -> VND

    if (!best || price < best.price) {
      best = {
        price,
        url: `https://shopee.vn/product/${item.shopid}/${item.itemid}`,
      };
    }
  }
  return best;
}

async function main() {
  const prices = {};
  let matched = 0;

  for (const model of MODELS) {
    const json = await shopeeSearch(model);
    const listing = json && pickBestListing(json, model);
    if (listing) {
      prices[model] = listing;
      matched++;
      console.log(`✓ ${model} -> ${listing.price.toLocaleString("vi-VN")}₫`);
    } else {
      console.log(`✗ ${model} -> no match / blocked`);
    }
    // Be gentle — space requests out instead of hammering Shopee.
    await new Promise((r) => setTimeout(r, 1500));
  }

  const feed = {
    updatedAt: new Date().toISOString(),
    matched,
    total: MODELS.length,
    prices,
  };

  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(feed, null, 2));
  console.log(`\nWrote ${OUTPUT_PATH} (${matched}/${MODELS.length} matched)`);
}

main();

/**
 * ------------------------------------------------------------
 * Setup on cPanel:
 * 1. Upload scrape-shopee.js next to index.html and gpu-prices.json
 *    will be written into that same folder.
 * 2. In cPanel, open "Setup Node.js App", create an app pointing at
 *    this folder (or just use it as a one-off script if your host
 *    doesn't need a persistent app), then in its terminal run:
 *      npm init -y   (only needed once, no external deps required)
 * 3. In cPanel > Cron Jobs, add a job like:
 *      0 star/3 * * *  cd /home/USERNAME/public_html/dreamyframe && /usr/bin/node scrape-shopee.js >> scrape.log 2>&1
 *    (replace star/3 with the literal every-3-hours syntax your
 *    cron UI shows; runs every 3 hours)
 * 4. Check scrape.log after the first run to see match/block status.
 * ------------------------------------------------------------
 */
