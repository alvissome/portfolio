/**
 * Portfolio Dashboard — Daily Watchlist Price Alert Checker
 * Runs via GitHub Actions: cron "0 22 * * 1-5" (UTC 10PM Mon-Fri = SGT 6AM Tue-Sat)
 *
 * Flow:
 *   1. Init Firebase Admin from service account secret
 *   2. Read all /users/{uid}/portfolio/data documents
 *   3. For each user, fetch watchlist alert prices from FMP API
 *   4. For each row with notifEnabled=true AND alertLevel set:
 *        if price <= supportValue AND cooldown passed → send email via EmailJS
 *        update lastAlertSent in Firestore
 */

import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import fetch from 'node-fetch';

// ─── 1. Init Firebase Admin ───────────────────────────────────────────────────

const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
initializeApp({
  credential: cert(serviceAccount),
  projectId: process.env.FIREBASE_PROJECT_ID,
});

const db = getFirestore();

// ─── 2. Read all users ────────────────────────────────────────────────────────

async function getAllUsers() {
  const usersSnap = await db.collection('users').get();
  const users = [];
  for (const userDoc of usersSnap.docs) {
    const uid = userDoc.id;
    // Each user has a single portfolio doc at /users/{uid}/portfolio/data
    const portfolioRef = db.collection('users').doc(uid).collection('portfolio').doc('data');
    const portfolioSnap = await portfolioRef.get();
    if (portfolioSnap.exists) {
      users.push({ uid, ref: portfolioRef, data: portfolioSnap.data() });
    }
  }
  return users;
}

// ─── 3. Fetch prices from FMP API ────────────────────────────────────────────

/**
 * Fetches quote for a single symbol from Financial Modeling Prep.
 * Returns { symbol, price } or null on error.
 */
async function fetchFMPPrice(symbol) {
  const apiKey = process.env.FMP_API_KEY;
  if (!apiKey) throw new Error('FMP_API_KEY not set');

  // FMP uses different format for some exchanges
  // SGX: D05.SI → D05.SI (FMP supports this)
  // HKEx: 0700.HK (FMP supports this)
  const url = `https://financialmodelingprep.com/api/v3/quote/${encodeURIComponent(symbol)}?apikey=${apiKey}`;
  try {
    const res = await fetch(url, { timeout: 10000 });
    if (!res.ok) {
      console.warn(`⚠️  FMP HTTP ${res.status} for ${symbol}`);
      return null;
    }
    const data = await res.json();
    if (!Array.isArray(data) || data.length === 0) {
      console.warn(`⚠️  FMP no data for ${symbol}`);
      return null;
    }
    return { symbol, price: data[0].price };
  } catch (e) {
    console.warn(`⚠️  FMP fetch error for ${symbol}: ${e.message}`);
    return null;
  }
}

/**
 * Batch fetch prices for an array of symbols.
 * Returns { [symbol]: price } map (only entries that succeeded).
 */
async function fetchPrices(symbols) {
  const unique = [...new Set(symbols)].filter(Boolean);
  const results = await Promise.all(unique.map(sym => fetchFMPPrice(sym)));
  const map = {};
  for (const r of results) {
    if (r && r.price !== undefined) map[r.symbol] = r.price;
  }
  return map;
}

// ─── 4. Send alert email via EmailJS ─────────────────────────────────────────

async function sendAlertEmail(settings, row, closePrice, supportValue) {
  const serviceId = process.env.EMAILJS_SERVICE_ID;
  const templateId = process.env.EMAILJS_TEMPLATE_ID;
  const publicKey = process.env.EMAILJS_PUBLIC_KEY;
  const fallbackEmail = process.env.ALERT_EMAIL;

  if (!serviceId || !templateId || !publicKey) {
    throw new Error('EmailJS credentials not configured (EMAILJS_SERVICE_ID / EMAILJS_TEMPLATE_ID / EMAILJS_PUBLIC_KEY)');
  }

  const toEmail = row.alertEmail || settings?.globalAlertEmail || settings?.email || fallbackEmail;
  if (!toEmail) throw new Error('No recipient email configured');

  const triggeredAt = new Date().toLocaleString('en-SG', { timeZone: 'Asia/Singapore' });

  const body = {
    service_id: serviceId,
    template_id: templateId,
    user_id: publicKey,
    template_params: {
      to_email: toEmail,
      symbol: row.symbol,
      name: row.name || row.symbol,
      support_level: row.alertLevel,
      support_price: supportValue,
      current_price: closePrice,
      action: row.action || '—',
      plan_notes: row.notes || '—',
      dashboard_url: 'https://alvissome.github.io/portfolio/',
      triggered_at: triggeredAt,
    },
  };

  const res = await fetch('https://api.emailjs.com/api/v1.0/email/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`EmailJS ${res.status}: ${text}`);
  }
}

// ─── 5. Process a single user ────────────────────────────────────────────────

async function processUser({ uid, ref, data }) {
  const watchlist = data.watchlist || [];
  const settings = data.settings?.emailSettings || {};

  // Collect symbols that need price checking
  const alertRows = watchlist.filter(row =>
    row.notifEnabled === true &&
    row.alertLevel &&
    row[row.alertLevel.toLowerCase()] // has a value for that support level
  );

  if (alertRows.length === 0) {
    console.log(`  User ${uid}: no active alert rows, skipping`);
    return;
  }

  const symbols = [...new Set(alertRows.map(r => r.symbol).filter(Boolean))];
  console.log(`  User ${uid}: checking ${symbols.length} symbols: ${symbols.join(', ')}`);

  const prices = await fetchPrices(symbols);
  const now = Date.now();
  let updatedWatchlist = [...watchlist];
  let anyUpdated = false;

  for (const row of alertRows) {
    const closePrice = prices[row.symbol];
    if (closePrice === undefined) {
      console.warn(`  ⚠️  No price for ${row.symbol}, skipping`);
      continue;
    }

    const supportKey = row.alertLevel.toLowerCase(); // 's1', 's2', etc.
    const supportValue = parseFloat(row[supportKey]);
    if (isNaN(supportValue) || supportValue <= 0) continue;

    if (closePrice > supportValue) {
      console.log(`  ${row.symbol}: ${closePrice} > ${supportValue} (${row.alertLevel}) — no alert`);
      continue;
    }

    // Price is at or below support — check cooldown
    const cooldownMs = (row.alertCooldown || 24) * 3600000;
    const lastSent = row.lastAlertSent || 0;
    if (now - lastSent < cooldownMs) {
      const remainHours = ((cooldownMs - (now - lastSent)) / 3600000).toFixed(1);
      console.log(`  ${row.symbol}: in cooldown (${remainHours}h remaining), skipping`);
      continue;
    }

    // Send alert
    try {
      await sendAlertEmail(settings, row, closePrice, supportValue);
      console.log(`✅ Alert sent: ${row.symbol} — price ${closePrice} ≤ ${row.alertLevel} (${supportValue})`);

      // Update lastAlertSent in the watchlist array
      const idx = updatedWatchlist.findIndex(w => w.id === row.id);
      if (idx >= 0) {
        updatedWatchlist[idx] = { ...updatedWatchlist[idx], lastAlertSent: now };
        anyUpdated = true;
      }
    } catch (e) {
      console.error(`❌ Alert failed: ${row.symbol} —`, e.message);
    }
  }

  // Persist lastAlertSent updates back to Firestore
  if (anyUpdated) {
    await ref.set({ watchlist: updatedWatchlist }, { merge: true });
    console.log(`  User ${uid}: Firestore watchlist updated (lastAlertSent)`);
  }
}

// ─── 6. Main ─────────────────────────────────────────────────────────────────

async function main() {
  console.log('=== Portfolio Dashboard Daily Alert Check ===');
  console.log(`Time: ${new Date().toLocaleString('en-SG', { timeZone: 'Asia/Singapore' })} SGT`);

  if (!process.env.FMP_API_KEY) {
    console.error('❌ FMP_API_KEY not set — exiting');
    process.exit(1);
  }

  let users;
  try {
    users = await getAllUsers();
    console.log(`Found ${users.length} user(s)`);
  } catch (e) {
    console.error('❌ Failed to read Firestore users:', e.message);
    process.exit(1);
  }

  for (const user of users) {
    try {
      await processUser(user);
    } catch (e) {
      console.error(`❌ Error processing user ${user.uid}:`, e.message);
    }
  }

  console.log('=== Done ===');
}

main().catch(e => {
  console.error('❌ Fatal error:', e);
  process.exit(1);
});
