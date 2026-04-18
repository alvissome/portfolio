/**
 * Portfolio Dashboard — Daily Watchlist Price Alert Checker
 * Runs via GitHub Actions: cron "0 0 * * 1-5" (UTC midnight Mon-Fri = SGT 8AM Mon-Fri)
 *
 * Price tiers (per symbol):
 *   Tier 1: Yahoo Finance (direct — no proxy needed in Node.js / GitHub Actions)
 *   Tier 2: Twelve Data (fallback)
 *   Tier 3: Keep existing Firestore price (mark priceStale = true)
 *
 * After fetching:
 *   - Writes prices + priceMetadata back to Firestore watchlist rows
 *   - Auto-resets alertState for recovered symbols (price > support)
 *   - Fires breach alerts (with alertState suppression)
 *   - Writes lastDailySync metadata to Firestore
 *   - Sends meta-alert email if any symbol prices failed
 */

import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import fetch from 'node-fetch';

// ─── 1. Init Firebase Admin ────────────────────────────────────────────────

const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
initializeApp({
  credential: cert(serviceAccount),
  projectId: process.env.FIREBASE_PROJECT_ID,
});

const db = getFirestore();

// ─── 2. Helpers ───────────────────────────────────────────────────────────

function nowSGT() {
  return new Date().toLocaleString('en-SG', { timeZone: 'Asia/Singapore' });
}

function toTwelveDataSymbol(ticker) {
  if (ticker.endsWith('.SI')) return ticker.slice(0, -3) + ':SGX';
  if (ticker.endsWith('.HK')) return ticker.slice(0, -3) + ':HKEX';
  if (ticker.endsWith('.L'))  return ticker.slice(0, -2) + ':LSE';
  return ticker;
}

/**
 * Determine currency from ticker suffix.
 * .SI  → SGD  (no conversion)
 * .HK  → HKD  (convert: price × HKD_TO_SGD)
 * .L   → USD  (Yahoo returns CSPX.L in USD)
 * else → USD
 */
function getCurrencyForTicker(ticker) {
  if (ticker.endsWith('.SI')) return 'SGD';
  if (ticker.endsWith('.HK')) return 'HKD';
  if (ticker.endsWith('.L'))  return 'USD';
  return 'USD';
}

const HKD_TO_SGD = 0.174;  // hardcoded HKD/SGD conversion rate

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// ─── 3. Price fetching (3-tier) ────────────────────────────────────────────

/**
 * Tier 1: Yahoo Finance (direct — no proxy in GitHub Actions).
 * Returns { price, currency } or null on any failure.
 */
async function fetchYahooPrice(symbol) {
  const url =
    `https://query1.finance.yahoo.com/v8/finance/chart/` +
    `${encodeURIComponent(symbol)}` +
    `?interval=1d&range=5d`;

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0' },
      });

      if (res.status !== 200) {
        console.warn(`  ⚠️  Yahoo HTTP ${res.status} for ${symbol} (attempt ${attempt + 1})`);
        if (attempt === 0) { await sleep(2000); continue; }
        return null;
      }

      const data = await res.json();

      // Check for API-level errors
      if (data?.chart?.error) {
        console.warn(`  ⚠️  Yahoo chart error for ${symbol}: ${JSON.stringify(data.chart.error)}`);
        return null;
      }

      const result = data?.chart?.result;
      if (!result || result.length === 0) {
        console.warn(`  ⚠️  Yahoo empty result for ${symbol}`);
        return null;
      }

      const meta = result[0]?.meta;
      const price = meta?.regularMarketPrice || meta?.previousClose || null;
      const currency = meta?.currency ?? getCurrencyForTicker(symbol);

      if (price === null || price === undefined || isNaN(price) || price <= 0) {
        console.warn(`  ⚠️  Yahoo invalid price for ${symbol}: ${price}`);
        return null;
      }

      return { price, currency };
    } catch (e) {
      console.warn(`  ⚠️  Yahoo fetch error for ${symbol} (attempt ${attempt + 1}): ${e.message}`);
      if (attempt === 0) { await sleep(2000); continue; }
      return null;
    }
  }
  return null;
}

/**
 * Tier 2: Twelve Data (fallback only).
 * Returns { price } or null.
 */
async function fetchTwelveDataPrice(symbol) {
  const apiKey = process.env.TWELVE_DATA_KEY;
  if (!apiKey) return null;

  const tdSym = toTwelveDataSymbol(symbol);
  const url = `https://api.twelvedata.com/price?symbol=${encodeURIComponent(tdSym)}&apikey=${apiKey}`;

  try {
    const res = await fetch(url);

    if (res.status === 429) {
      console.warn(`  ⚠️  Twelve Data 429 rate limit for ${symbol} — skipping fallback`);
      return null;
    }
    if (res.status === 401) {
      console.warn(`  ⚠️  Twelve Data 401 invalid key for ${symbol}`);
      return null;
    }
    if (!res.ok) {
      console.warn(`  ⚠️  Twelve Data HTTP ${res.status} for ${symbol}`);
      return null;
    }

    const data = await res.json();

    if (data?.status === 'error') {
      console.warn(`  ⚠️  Twelve Data error for ${symbol}: ${data.message}`);
      return null;
    }

    const price = parseFloat(data?.price);
    if (isNaN(price) || price <= 0) return null;

    return { price };
  } catch (e) {
    console.warn(`  ⚠️  Twelve Data fetch error for ${symbol}: ${e.message}`);
    return null;
  }
}

/**
 * Fetch price for one symbol using 3-tier fallback.
 * Returns { price, priceSource, priceCurrency, priceStale }.
 * priceStale=true means we fell to Tier 3 (existing Firestore price).
 */
async function fetchPriceForSymbol(symbol, existingClose) {
  // Tier 1: Yahoo Finance
  const yahooResult = await fetchYahooPrice(symbol);
  if (yahooResult !== null) {
    return {
      price: yahooResult.price,
      priceSource: 'yahoo',
      priceCurrency: yahooResult.currency ?? getCurrencyForTicker(symbol),
      priceStale: false,
    };
  }

  // Tier 2: Twelve Data
  const tdResult = await fetchTwelveDataPrice(symbol);
  if (tdResult !== null) {
    return {
      price: tdResult.price,
      priceSource: 'twelvedata',
      priceCurrency: getCurrencyForTicker(symbol),
      priceStale: false,
    };
  }

  // Tier 3: Keep existing Firestore price
  console.warn(`  ⚠️  All price sources failed for ${symbol} — using existing Firestore price`);
  return {
    price: existingClose ?? null,
    priceSource: 'stale',
    priceCurrency: getCurrencyForTicker(symbol),
    priceStale: true,
  };
}

// ─── 4. EmailJS alert sending ──────────────────────────────────────────────

async function sendAlertEmail(settings, templateParams) {
  const serviceId  = process.env.EMAILJS_SERVICE_ID;
  const templateId = process.env.EMAILJS_TEMPLATE_ID;
  const publicKey  = process.env.EMAILJS_PUBLIC_KEY;

  if (!serviceId || !templateId || !publicKey) {
    throw new Error('EmailJS credentials not configured');
  }

  const body = {
    service_id:      serviceId,
    template_id:     templateId,
    user_id:         publicKey,
    template_params: templateParams,
  };

  const res = await fetch('https://api.emailjs.com/api/v1.0/email/send', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`EmailJS ${res.status}: ${text}`);
  }
}

// ─── 5. Process a single user ──────────────────────────────────────────────

async function processUser({ uid, ref, data }) {
  const watchlist = data.watchlist || [];
  const settings  = data.settings?.emailSettings || {};

  if (watchlist.length === 0) {
    console.log(`  User ${uid}: empty watchlist, skipping`);
    return;
  }

  // Collect all unique symbols (for price fetch + write-back)
  const allSymbols = [...new Set(watchlist.map(r => r.symbol).filter(Boolean))];
  console.log(`  User ${uid}: fetching prices for ${allSymbols.length} symbol(s): ${allSymbols.join(', ')}`);

  // ── 5a. Fetch prices for all symbols ─────────────────────────────────────

  const priceResults = {}; // symbol → { price, priceSource, priceCurrency, priceStale }
  const failedSymbols = [];

  for (const symbol of allSymbols) {
    // Find existing close from watchlist row (Tier 3 fallback)
    const existingRow = watchlist.find(r => r.symbol === symbol);
    const existingClose = existingRow?.close ?? null;

    const result = await fetchPriceForSymbol(symbol, existingClose);
    priceResults[symbol] = result;

    if (result.priceStale) {
      failedSymbols.push(symbol);
    }

    // Small delay between symbols (respect rate limits)
    await sleep(300);
  }

  const succeededCount = allSymbols.length - failedSymbols.length;
  const failedCount    = failedSymbols.length;
  const totalCount     = allSymbols.length;

  // ── 5b. Write prices + priceMetadata back to Firestore ───────────────────

  const priceTimestamp = new Date().toISOString();
  const updatedWatchlist = watchlist.map(row => {
    if (!row.symbol) return row;
    const result = priceResults[row.symbol];
    if (!result) return row;

    return {
      ...row,
      close:          result.price ?? row.close ?? null,
      priceSource:    result.priceSource,
      priceCurrency:  result.priceCurrency,
      priceTimestamp: priceTimestamp,
      priceStale:     result.priceStale,
    };
  });

  // ── 5c. Auto-reset alertState for recovered symbols ──────────────────────
  //   For ALL rows (not just alerted ones): if price > support → reset to "untriggered"

  const alertRows = updatedWatchlist.filter(row =>
    row.notifEnabled === true &&
    row.alertLevel &&
    row[row.alertLevel.toLowerCase()]
  );

  let finalWatchlist = updatedWatchlist.map(row => {
    if (!row.alertLevel || !row[row.alertLevel.toLowerCase()]) return row;
    const supportValue = parseFloat(row[row.alertLevel.toLowerCase()]);
    if (isNaN(supportValue) || supportValue <= 0) return row;

    const priceRes = priceResults[row.symbol];
    if (!priceRes || priceRes.priceStale || priceRes.price === null) return row;

    // Auto-reset: price recovered above support
    if (priceRes.price > supportValue && row.alertState === 'triggered') {
      console.log(`  ${row.symbol}: price ${priceRes.price} > support ${supportValue} — auto-resetting alertState`);
      return { ...row, alertState: 'untriggered' };
    }
    return row;
  });

  // ── 5d. Check alerts and fire breach emails ───────────────────────────────

  const now = Date.now();

  for (const row of alertRows) {
    const priceRes = priceResults[row.symbol];
    if (!priceRes) continue;

    // Guard: skip stale prices
    if (priceRes.priceStale || priceRes.priceSource === 'stale') {
      console.log(`  ${row.symbol}: price is stale — skipping alert check`);
      continue;
    }

    const closePrice   = priceRes.price;
    if (closePrice === null || closePrice === undefined) continue;

    const supportKey   = row.alertLevel.toLowerCase();
    const supportValue = parseFloat(row[supportKey]);
    if (isNaN(supportValue) || supportValue <= 0) continue;

    if (closePrice > supportValue) {
      console.log(`  ${row.symbol}: ${closePrice} > ${supportValue} (${row.alertLevel}) — no alert`);
      continue;
    }

    // Guard: alertState already triggered
    if (row.alertState === 'triggered') {
      console.log(`  ${row.symbol}: alertState=triggered — suppressing repeat alert`);
      continue;
    }

    // Guard: cooldown
    const cooldownMs = (row.alertCooldown || 24) * 3600000;
    const lastSent   = row.lastAlertSent || 0;
    if (now - lastSent < cooldownMs) {
      const remainHours = ((cooldownMs - (now - lastSent)) / 3600000).toFixed(1);
      console.log(`  ${row.symbol}: in cooldown (${remainHours}h remaining) — skipping`);
      continue;
    }

    // Send alert
    const toEmail      = row.alertEmail || settings?.globalAlertEmail || settings?.email || process.env.ALERT_EMAIL;
    const triggeredAt  = nowSGT();

    try {
      await sendAlertEmail(settings, {
        to_email:      toEmail,
        symbol:        row.symbol,
        name:          row.name || row.symbol,
        support_level: row.alertLevel,
        support_price: supportValue,
        current_price: closePrice,
        action:        row.action || '—',
        plan_notes:    row.notes || '—',
        dashboard_url: 'https://alvissome.github.io/portfolio/',
        triggered_at:  triggeredAt,
      });
      console.log(`  ✅ Alert sent: ${row.symbol} — price ${closePrice} ≤ ${row.alertLevel} (${supportValue})`);

      // Mark alertState = "triggered" and update lastAlertSent
      const idx = finalWatchlist.findIndex(w => w.id === row.id);
      if (idx >= 0) {
        finalWatchlist[idx] = {
          ...finalWatchlist[idx],
          alertState:    'triggered',
          lastAlertSent: now,
        };
      }
    } catch (e) {
      console.error(`  ❌ Alert failed: ${row.symbol} —`, e.message);
    }
  }

  // ── 5e. Write updated watchlist + lastDailySync to Firestore ─────────────

  const syncStatus =
    failedCount === 0 ? 'success' :
    succeededCount === 0 ? 'failed' :
    'partial';

  const lastDailySync = {
    runAt:          nowSGT(),
    status:         syncStatus,
    succeededCount,
    failedCount,
    failedSymbols,
    totalCount,
  };

  await ref.set({
    watchlist:      finalWatchlist,
    lastDailySync,
  }, { merge: true });

  console.log(`  User ${uid}: Firestore updated — ${succeededCount}/${totalCount} prices written, status=${syncStatus}`);
  if (failedSymbols.length > 0) {
    console.log(`  Failed symbols: ${failedSymbols.join(', ')}`);
  }

  // ── 5f. Meta-alert if any symbols failed ─────────────────────────────────

  if (failedCount > 0) {
    // Check meta-alert cooldown via a special "SYNC_META" key stored in lastDailySync
    const existingMeta = data.lastDailySync;
    const lastMetaAlert = existingMeta?.lastMetaAlertSent ?? 0;
    const metaCooldownMs = 24 * 3600000;

    if (now - lastMetaAlert < metaCooldownMs) {
      console.log(`  Meta-alert in cooldown — skipping sync failure notification`);
    } else {
      const toEmail    = settings?.globalAlertEmail || settings?.email || process.env.ALERT_EMAIL;
      const triggeredAt = nowSGT();

      try {
        await sendAlertEmail(settings, {
          to_email:      toEmail,
          symbol:        'SYNC ALERT',
          name:          'Daily Price Sync',
          support_level: 'N/A',
          support_price: 'N/A',
          current_price: 'N/A',
          action:        `Price sync ${syncStatus}`,
          plan_notes:
            `Failed symbols: ${failedSymbols.join(', ')}` +
            ` | Succeeded: ${succeededCount}/${totalCount}` +
            ` | Manual resync may be needed.`,
          dashboard_url: 'https://alvissome.github.io/portfolio/',
          triggered_at:  triggeredAt,
        });
        console.log(`  ✅ Meta-alert sent for sync ${syncStatus}`);

        // Update lastMetaAlertSent so we don't spam
        await ref.set({
          lastDailySync: { ...lastDailySync, lastMetaAlertSent: now },
        }, { merge: true });
      } catch (e) {
        console.error(`  ❌ Meta-alert failed:`, e.message);
      }
    }
  }
}

// ─── 6. Read all users ─────────────────────────────────────────────────────

async function getAllUsers() {
  const usersSnap = await db.collection('users').get();
  const users = [];
  for (const userDoc of usersSnap.docs) {
    const uid = userDoc.id;
    const portfolioRef = db.collection('users').doc(uid).collection('portfolio').doc('data');
    const portfolioSnap = await portfolioRef.get();
    if (portfolioSnap.exists) {
      users.push({ uid, ref: portfolioRef, data: portfolioSnap.data() });
    }
  }
  return users;
}

// ─── 7. Main ───────────────────────────────────────────────────────────────

async function main() {
  console.log('=== Portfolio Dashboard Daily Alert Check ===');
  console.log(`Time: ${nowSGT()} SGT`);

  let users;
  try {
    users = await getAllUsers();
    console.log(`Found ${users.length} user(s)`);
  } catch (e) {
    console.error('❌ Failed to read Firestore users:', e.message);
    process.exit(1);
  }

  for (const user of users) {
    console.log(`\nProcessing user: ${user.uid}`);
    try {
      await processUser(user);
    } catch (e) {
      console.error(`❌ Error processing user ${user.uid}:`, e.message);
    }
  }

  console.log('\n=== Done ===');
}

main().catch(e => {
  console.error('❌ Fatal error:', e);
  process.exit(1);
});
