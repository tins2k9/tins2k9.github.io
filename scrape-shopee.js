const fs = require("fs");
const path = require("path");
const https = require("https");

const OUTPUT_PATH = path.join(__dirname, "gpu-prices.json");

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
            resolve(null);
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
function pickBestListing(json, modelName) {
  const items = json?.items || [];
  const needle = modelName.toLowerCase();
  let best = null;

  for (const entry of items) {
    const item = entry.item_basic || entry.item || entry;
    if (!item?.name) continue;
    const name = item.name.toLowerCase();
    if (!name.includes(needle.replace(/\s+/g, " "))) continue;
    const rawPrice = item.price_min ?? item.price;
    if (!rawPrice) continue;
    const price = Math.round(rawPrice / 100000) * 1000;

    if (!best || price < best.price) {
      best = {
        price,
        url: `https://shopee.vn/product/${item.shopid}/${item.itemid}`,
      };
    }
  }
  return best;
}

const HISTORY_LIMIT = 14;

function loadExistingFeed() {
  try {
    return JSON.parse(fs.readFileSync(OUTPUT_PATH, "utf8"));
  } catch {
    return null;
  }
}

async function main() {
  const existing = loadExistingFeed();
  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  const prices = {};
  let matched = 0;

  for (const model of MODELS) {
    const json = await shopeeSearch(model);
    const listing = json && pickBestListing(json, model);
    if (listing) {
      const prevHistory =
        (existing && existing.prices && existing.prices[model] && existing.prices[model].history) || [];
      let history = prevHistory.slice();
      // one point per day: replace today's if we already ran once today,
      // otherwise append a new point.
      if (history.length && history[history.length - 1].date === today) {
        history[history.length - 1] = { date: today, price: listing.price };
      } else {
        history.push({ date: today, price: listing.price });
      }
      if (history.length > HISTORY_LIMIT) history = history.slice(history.length - HISTORY_LIMIT);

      prices[model] = { ...listing, history };
      matched++;
      console.log(`✓ ${model} -> ${listing.price.toLocaleString("vi-VN")}₫ (history: ${history.length}pt)`);
    } else if (existing && existing.prices && existing.prices[model]) {
      prices[model] = existing.prices[model];
      console.log(`✗ ${model} -> no match / blocked (kept previous data)`);
    } else {
      console.log(`✗ ${model} -> no match / blocked`);
    }
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
