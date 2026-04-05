import type { FastifyInstance } from 'fastify';
import { getDb, toggleStar } from '../db/index.js';

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
             score, score_breakdown, url, first_seen_at, last_seen_at, status, starred,
             next_open_house_start, next_open_house_end, lat, lng
      FROM listings
      WHERE state = 'PA'
        AND score >= ?
        AND beds >= ?
        AND price >= ?
        AND price <= ?
        ${includeInactive ? '' : `AND status != 'inactive'`}
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

  // Summary stats
  app.get('/api/stats', () => {
    const db = getDb();
    const active = `state = 'PA' AND status != 'inactive'`;
    const total = (db.prepare(`SELECT COUNT(*) as n FROM listings WHERE ${active}`).get() as { n: number }).n;
    const avgScore = (db.prepare(`SELECT AVG(score) as v FROM listings WHERE ${active}`).get() as { v: number | null }).v;
    const fresh = (db.prepare(`SELECT COUNT(*) as n FROM listings WHERE ${active} AND days_on_market <= 7`).get() as { n: number }).n;
    const lastPoll = (db.prepare(`SELECT MAX(polled_at) as v FROM poll_log`).get() as { v: string | null }).v;
    const cities = db.prepare(`SELECT DISTINCT LOWER(city) as city FROM listings WHERE ${active} ORDER BY city`).all() as { city: string }[];
    const totalEver = (db.prepare(`SELECT COUNT(*) as n FROM listings WHERE state = 'PA'`).get() as { n: number }).n;
    return { total, avgScore, fresh, lastPoll, cities: cities.map(c => c.city), totalEver };
  });

  // Send a test email using top listings already in DB
  app.post('/api/test-email', async () => {
    const { sendNewListingsDigest, NOTIFY_SCORE_THRESHOLD } = await import('../notifications/email.js');
    const db = getDb();
    const listings = db.prepare(`
      SELECT id, address, city, zip, price, price_at_first_seen, beds, baths, sqft, lot_sqft,
             days_on_market, score, score_breakdown, school_district, property_type, walk_score, url
      FROM listings WHERE state = 'PA' ORDER BY score DESC LIMIT 5
    `).all() as Parameters<typeof sendNewListingsDigest>[0];
    if (listings.length === 0) return { ok: false, error: 'no listings in DB' };
    await sendNewListingsDigest(listings);
    return { ok: true, sent: listings.length, threshold: NOTIFY_SCORE_THRESHOLD };
  });

  // Star / unstar a listing
  app.post('/api/listings/:id/star', (req) => {
    const { id } = req.params as { id: string };
    return toggleStar(id);
  });

  // Trigger a poll manually
  app.post('/api/poll', async () => {
    const { runPoll } = await import('../poller/index.js');
    runPoll().catch(console.error); // fire and forget
    return { status: 'polling started' };
  });
}
