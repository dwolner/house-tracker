import type { FastifyInstance } from 'fastify';
import { getDb, toggleStar, getOutcomesData, getSoldComps, getRentalEstimates, getRentcastUsage } from '../db/index.js';
import { LOCALES } from '../locales/index.js';

export function registerRoutes(app: FastifyInstance) {
  // All listings with optional filters
  app.get('/api/listings', (req) => {
    const q = req.query as Record<string, string>;
    const minScore = parseFloat(q.min_score ?? '0');
    const minBeds = parseInt(q.min_beds ?? '0', 10);
    const minPrice = parseInt(q.min_price ?? '0', 10);
    const maxPrice = parseInt(q.max_price ?? '9999999', 10);
    const city = q.city ?? '';
    const propType = q.prop_type ?? '';

    const includeInactive = q.include_inactive === 'true';

    let sql = `
      SELECT id, address, city, state, zip, price, price_at_first_seen, beds, baths,
             sqft, lot_sqft, year_built, walk_score, school_district, property_type, days_on_market,
             score, score_breakdown, url, first_seen_at, last_seen_at, status, status_label, starred,
             next_open_house_start, next_open_house_end, lat, lng, locale_id
      FROM listings
      WHERE score >= ?
        AND beds >= ?
        AND price >= ?
        AND price <= ?
        ${includeInactive ? '' : `AND status NOT IN ('inactive', '130')`}
    `;
    const params: (string | number)[] = [minScore, minBeds, minPrice, maxPrice];

    if (city) {
      sql += ` AND LOWER(city) = LOWER(?)`;
      params.push(city);
    }
    if (propType) {
      sql += ` AND LOWER(property_type) = LOWER(?)`;
      params.push(propType);
    }

    sql += ` ORDER BY score DESC`;
    return getDb().prepare(sql).all(...params);
  });

  // Price history for a single listing
  app.get('/api/listings/:id/history', (req) => {
    const { id } = req.params as { id: string };
    return getDb()
      .prepare(`SELECT price, recorded_at FROM price_history WHERE listing_id = ? ORDER BY recorded_at ASC`)
      .all(id);
  });

  // Inventory over time per area (from poll_log)
  app.get('/api/inventory', () => {
    return getDb()
      .prepare(`
        SELECT area, polled_at, listings_found
        FROM poll_log
        ORDER BY polled_at ASC
      `)
      .all();
  });

  // Summary stats — optional ?locale_id=main-line|san-diego to scope
  app.get('/api/stats', (req) => {
    const q = req.query as Record<string, string>;
    const localeId = q.locale_id;
    const db = getDb();
    const active = `status NOT IN ('inactive', '130')`;
    const lf = localeId ? ` AND locale_id = ?` : '';

    const g1 = (sql: string) => localeId ? db.prepare(sql + lf).get(localeId) : db.prepare(sql).get();
    const gN = (sql: string) => localeId ? db.prepare(sql + lf).all(localeId) : db.prepare(sql).all();

    const total = (g1(`SELECT COUNT(*) as n FROM listings WHERE ${active}`) as { n: number }).n;
    const avgScore = (g1(`SELECT AVG(score) as v FROM listings WHERE ${active}`) as { v: number | null }).v;
    const fresh = (g1(`SELECT COUNT(*) as n FROM listings WHERE ${active} AND days_on_market <= 7`) as { n: number }).n;
    const lastPoll = (db.prepare(`SELECT MAX(polled_at) as v FROM poll_log`).get() as { v: string | null }).v;
    const cities = gN(`SELECT DISTINCT LOWER(city) as city FROM listings WHERE ${active} ORDER BY city`) as { city: string }[];
    const propertyTypes = gN(`SELECT DISTINCT LOWER(property_type) as pt FROM listings WHERE ${active} AND property_type IS NOT NULL ORDER BY pt`) as { pt: string }[];
    const totalEver = localeId
      ? (db.prepare(`SELECT COUNT(*) as n FROM listings WHERE locale_id = ?`).get(localeId) as { n: number }).n
      : (db.prepare(`SELECT COUNT(*) as n FROM listings`).get() as { n: number }).n;
    return { total, avgScore, fresh, lastPoll, cities: cities.map(c => c.city), propertyTypes: propertyTypes.map(r => r.pt), totalEver };
  });

  // Send a test email using top listings already in DB
  app.post('/api/test-email', async () => {
    const { sendDigest, NOTIFY_SCORE_THRESHOLD } = await import('../notifications/email.js');
    const db = getDb();
    const listings = db.prepare(`
      SELECT id, address, city, state, zip, price, price_at_first_seen, beds, baths, sqft, lot_sqft,
             days_on_market, first_seen_at, score, score_breakdown, school_district, property_type, walk_score, url
      FROM listings ORDER BY score DESC LIMIT 5
    `).all() as import('../notifications/email.js').NotifyListing[];
    if (listings.length === 0) return { ok: false, error: 'no listings in DB' };
    await sendDigest(listings, []);
    return { ok: true, sent: listings.length, threshold: NOTIFY_SCORE_THRESHOLD };
  });

  // Star / unstar a listing
  app.post('/api/listings/:id/star', (req) => {
    const { id } = req.params as { id: string };
    return toggleStar(id);
  });

  // Pending outcomes — analytics data
  app.get('/api/outcomes', () => getOutcomesData());

  // Trend data: avg list price, sold price, and score per city per month
  app.get('/api/trends', () => {
    const db = getDb();
    const listPrice = db.prepare(`
      SELECT LOWER(city) as city, locale_id, strftime('%Y-%m', first_seen_at) as month,
             ROUND(AVG(price_at_first_seen)) as avg, COUNT(*) as count
      FROM listings WHERE price_at_first_seen > 0 AND first_seen_at IS NOT NULL
      GROUP BY city, locale_id, month ORDER BY month, city
    `).all();
    const soldPrice = db.prepare(`
      SELECT LOWER(city) as city, locale_id, strftime('%Y-%m', sold_at) as month,
             ROUND(AVG(sold_price)) as avg, COUNT(*) as count
      FROM listings WHERE sold_price IS NOT NULL AND sold_at IS NOT NULL
      GROUP BY city, locale_id, month ORDER BY month, city
    `).all();
    const score = db.prepare(`
      SELECT LOWER(city) as city, locale_id, strftime('%Y-%m', first_seen_at) as month,
             ROUND(AVG(score), 1) as avg, COUNT(*) as count
      FROM listings WHERE score IS NOT NULL AND first_seen_at IS NOT NULL
      GROUP BY city, locale_id, month ORDER BY month, city
    `).all();
    return { listPrice, soldPrice, score };
  });

  // Trigger a poll manually
  app.post('/api/poll', async () => {
    const { runPoll } = await import('../poller/index.js');
    runPoll().catch(console.error); // fire and forget
    return { status: 'polling started' };
  });

  // Investment config for a locale — returns {} if locale has no investmentConfig
  app.get('/api/locales/:id/investment', (req) => {
    const { id } = req.params as { id: string };
    const locale = LOCALES[id];
    if (!locale?.investmentConfig) return {};
    return { investmentConfig: locale.investmentConfig };
  });

  // Median sold $/sqft by city for the last 12 months (min 3 sales per city)
  app.get('/api/locales/:id/comps', (req) => {
    const { id } = req.params as { id: string };
    return { byCity: getSoldComps(id) };
  });

  // Cached RentCast estimates for all active listings in a locale
  app.get('/api/locales/:id/rent-estimates', (req) => {
    const { id } = req.params as { id: string };
    return { byListingId: getRentalEstimates(id) };
  });

  // RentCast usage tracking
  app.get('/api/rentcast/usage', () => {
    const usage = getRentcastUsage();
    return { ...usage, monthlyLimit: 50, dailyLimit: parseInt(process.env.RENTCAST_DAILY_LIMIT ?? '1', 10) };
  });

  // Live 30yr mortgage rate (from FRED, cached 7 days)
  app.get('/api/mortgage-rate', async () => {
    const { getCurrentMortgageRate } = await import('../enrichment/mortgage-rate.js');
    const rate = await getCurrentMortgageRate();
    return { rate, investmentRate: rate + 0.005, asOf: new Date().toISOString() };
  });

  // Trigger rent estimate refresh for a locale (admin / manual use)
  app.post('/api/locales/:id/rent-estimates/refresh', async (req) => {
    const { id } = req.params as { id: string };
    const { refreshRentEstimates } = await import('../enrichment/rent-estimate.js');
    const result = await refreshRentEstimates(id);
    return result;
  });

  // Trigger a full poll + digest manually
  app.post('/api/digest', async () => {
    const { runPoll } = await import('../poller/index.js');
    const { sendDigest, NOTIFY_SCORE_THRESHOLD } = await import('../notifications/email.js');
    const { getUnnotifiedChanges, markChangesNotified, getDb } = await import('../db/index.js');
    const { newHighScoreIds } = await runPoll();

    let newListings: import('../notifications/email.js').NotifyListing[] = [];
    if (newHighScoreIds.length > 0) {
      const placeholders = newHighScoreIds.map(() => '?').join(',');
      newListings = getDb().prepare(`
        SELECT id, address, city, state, zip, price, price_at_first_seen, beds, baths, sqft, lot_sqft,
               days_on_market, first_seen_at, score, score_breakdown, school_district, property_type, walk_score, url
        FROM listings WHERE id IN (${placeholders}) ORDER BY score DESC
      `).all(...newHighScoreIds) as import('../notifications/email.js').NotifyListing[];
    }

    const changes = getUnnotifiedChanges(NOTIFY_SCORE_THRESHOLD);

    if (newListings.length > 0 || changes.length > 0) {
      await sendDigest(newListings, changes);
      markChangesNotified(changes.map(c => c.change_id));
      return { status: 'digest sent', new_listings: newListings.length, changes: changes.length };
    }
    return { status: 'nothing to notify', new_listings: 0, changes: 0 };
  });
}
