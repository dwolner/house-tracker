import type { FastifyInstance } from 'fastify';
import { getDb, toggleStar, getOutcomesData, getSoldComps, getRentalEstimates, getRentcastUsage, supersedeListings, getDuplicateCandidates } from '../db/index.js';
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
      SELECT l.id, l.address, l.city, l.state, l.zip, l.price, l.price_at_first_seen, l.beds, l.baths,
             l.sqft, l.lot_sqft, l.year_built, l.walk_score, l.school_district, l.property_type, l.days_on_market,
             l.score, l.score_breakdown, l.url, l.first_seen_at, l.last_seen_at, l.status, l.status_label, l.starred,
             l.next_open_house_start, l.next_open_house_end, l.lat, l.lng, l.locale_id,
             l.brief_short, l.brief_full,
             l.prior_listing_id, l.prior_list_price,
             p.days_on_market AS prior_days_on_market,
             p.last_seen_at   AS prior_last_seen_at
      FROM listings l
      LEFT JOIN listings p ON p.id = l.prior_listing_id
      WHERE l.score >= ?
        AND l.beds >= ?
        AND l.price >= ?
        AND l.price <= ?
        AND l.superseded_by IS NULL
        ${includeInactive ? '' : `AND l.status NOT IN ('inactive', '130')`}
    `;
    const params: (string | number)[] = [minScore, minBeds, minPrice, maxPrice];

    if (city) {
      sql += ` AND LOWER(l.city) = LOWER(?)`;
      params.push(city);
    }
    if (propType) {
      sql += ` AND LOWER(l.property_type) = LOWER(?)`;
      params.push(propType);
    }

    sql += ` ORDER BY l.score DESC`;
    return getDb().prepare(sql).all(...params);
  });

  // Price history for a single listing — walks prior_listing_id chain
  app.get('/api/listings/:id/history', (req) => {
    const { id } = req.params as { id: string };
    const db = getDb();

    // Walk the prior_listing_id chain to collect all linked listing IDs
    const ids: string[] = [id];
    let cursor = id;
    for (let i = 0; i < 5; i++) { // max 5 hops — safeguard against loops
      const row = db
        .prepare(`SELECT prior_listing_id FROM listings WHERE id = ?`)
        .get(cursor) as { prior_listing_id: string | null } | undefined;
      if (!row?.prior_listing_id) break;
      ids.push(row.prior_listing_id);
      cursor = row.prior_listing_id;
    }

    // Fetch listing metadata + price history for each ID in the chain
    const appearances = ids.flatMap(listingId => {
      const meta = db
        .prepare(`SELECT id, first_seen_at, last_seen_at, days_on_market, price_at_first_seen, price FROM listings WHERE id = ?`)
        .get(listingId) as { id: string; first_seen_at: string; last_seen_at: string; days_on_market: number | null; price_at_first_seen: number; price: number } | undefined;
      if (!meta) return [];
      const prices = db
        .prepare(`SELECT price, recorded_at FROM price_history WHERE listing_id = ? ORDER BY recorded_at ASC`)
        .all(listingId) as { price: number; recorded_at: string }[];
      return [{ ...meta, prices }];
    });

    // Compute true cumulative DOM
    let trueDom = 0;
    for (let i = 0; i < appearances.length; i++) {
      const a = appearances[i];
      trueDom += a.days_on_market ?? 0;
      // Add gap days between prior listing going inactive and current listing appearing
      if (i < appearances.length - 1) {
        const gapMs = new Date(appearances[i].first_seen_at).getTime() - new Date(appearances[i + 1].last_seen_at).getTime();
        trueDom += Math.max(0, Math.round(gapMs / (1000 * 60 * 60 * 24)));
      }
    }

    return { appearances, trueDom };
  });

  // Generate AI brief on demand for a single listing
  app.post('/api/listings/:id/brief', async (req, reply) => {
    const { id } = req.params as { id: string };
    const row = getDb()
      .prepare(`SELECT url, address, city, price, beds, sqft, days_on_market FROM listings WHERE id = ?`)
      .get(id) as { url: string; address: string; city: string; price: number; beds: number; sqft: number | null; days_on_market: number | null } | undefined;

    if (!row) return reply.status(404).send({ error: 'not found' });

    const { generateBriefForListing } = await import('../enrichment/brief.js');
    try {
      const result = await generateBriefForListing(id, row.url, row.address, row.city, row.price, row.beds, row.sqft, row.days_on_market);
      return result;
    } catch (err) {
      console.error(`[brief] on-demand failed for ${id}:`, err);
      return reply.status(500).send({ error: 'brief generation failed' });
    }
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
    const active = `status NOT IN ('inactive', '130') AND superseded_by IS NULL`;
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

  // Preview email digest in browser — GET /email-preview?locale=san-diego&days=3&theme=dark
  app.get('/email-preview', async (req, reply) => {
    const q = req.query as Record<string, string>;
    const localeId = q.locale ?? '';
    const days = parseFloat(q.days ?? '1');
    const { buildPreviewHtml, NOTIFY_SCORE_THRESHOLD } = await import('../notifications/email.js');
    const { getUnnotifiedChanges } = await import('../db/index.js');
    const db = getDb();
    const localeSql = localeId ? `AND locale_id = ?` : '';
    const params: unknown[] = localeId
      ? [NOTIFY_SCORE_THRESHOLD, days, localeId]
      : [NOTIFY_SCORE_THRESHOLD, days];
    const listings = db.prepare(`
      SELECT id, address, city, state, zip, price, price_at_first_seen, beds, baths, sqft, lot_sqft,
             year_built, days_on_market, first_seen_at, score, score_breakdown, school_district, property_type, walk_score, url,
             brief_short, brief_full, lat, lng
      FROM listings
      WHERE status NOT IN ('inactive', '130') AND score >= ? AND superseded_by IS NULL
        AND first_seen_at >= datetime('now', '-' || ? || ' days')
        ${localeSql}
      ORDER BY first_seen_at DESC
    `).all(...params) as import('../notifications/email.js').NotifyListing[];
    const enabledLocaleIds = Object.values(LOCALES).filter(l => !l.disableNotifications).map(l => l.id);
    const allChanges = getUnnotifiedChanges(NOTIFY_SCORE_THRESHOLD, enabledLocaleIds);
    const changes = localeId
      ? allChanges.filter(c => {
          const row = db.prepare(`SELECT locale_id FROM listings WHERE id = ?`).get(c.id) as { locale_id: string } | undefined;
          return row?.locale_id === localeId;
        })
      : allChanges;
    const theme = q.theme === 'light' ? 'light' : 'dark';
    reply.type('text/html; charset=utf-8').send(buildPreviewHtml(listings, changes, theme));
  });

  // Send a test email using top listings already in DB
  app.post('/api/test-email', async () => {
    const { sendDigest, NOTIFY_SCORE_THRESHOLD } = await import('../notifications/email.js');
    const db = getDb();
    const listings = db.prepare(`
      SELECT id, address, city, state, zip, price, price_at_first_seen, beds, baths, sqft, lot_sqft,
             year_built, days_on_market, first_seen_at, score, score_breakdown, school_district, property_type, walk_score, url,
             brief_short, brief_full, lat, lng
      FROM listings WHERE superseded_by IS NULL ORDER BY score DESC LIMIT 5
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

  // Mark a listing as superseded by a newer re-listing
  app.post('/api/listings/:id/supersede', (req) => {
    const { id } = req.params as { id: string };
    const { superseded_by } = req.body as { superseded_by: string };
    if (!superseded_by) return { ok: false, error: 'superseded_by required' };
    supersedeListings(id, superseded_by);
    return { ok: true };
  });

  // Find active listings that look like duplicates (same zip/beds/baths/sqft)
  app.get('/api/listings/duplicate-candidates', () => getDuplicateCandidates());

  // Fuzzy address lookup — GET /api/listings/by-address?q=123+Main+St
  app.get('/api/listings/by-address', (req, reply) => {
    const q = req.query as Record<string, string>;
    const query = (q.q ?? '').trim();
    const queryTokens = query.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
    if (!queryTokens.length) {
      reply.status(400).send({ error: 'q is required' });
      return;
    }

    const listings = getDb()
      .prepare(`SELECT * FROM listings WHERE superseded_by IS NULL AND status NOT IN ('inactive', '130') ORDER BY score DESC`)
      .all() as import('../db/index.js').Listing[];

    let bestListing: import('../db/index.js').Listing | null = null;
    let bestMatchScore = 0;

    for (const listing of listings) {
      const targetTokens = new Set(
        `${listing.address} ${listing.city} ${listing.state}`
          .toLowerCase()
          .split(/[^a-z0-9]+/)
          .filter(Boolean),
      );
      let matchScore = 0;
      for (const token of queryTokens) {
        if (targetTokens.has(token)) matchScore++;
      }
      if (matchScore > bestMatchScore) {
        bestMatchScore = matchScore;
        bestListing = listing;
      }
    }

    if (!bestListing || bestMatchScore === 0) {
      reply.status(404).send({ error: 'not found' });
      return;
    }

    return {
      ...bestListing,
      score_breakdown: bestListing.score_breakdown
        ? JSON.parse(bestListing.score_breakdown)
        : null,
      match_score: bestMatchScore,
    };
  });

  // Pending outcomes — analytics data
  app.get('/api/outcomes', () => getOutcomesData());

  // Trend data: avg list price, sold price, and score per city per month
  app.get('/api/trends', () => {
    const db = getDb();
    const listPrice = db.prepare(`
      SELECT LOWER(city) as city, zip, locale_id, strftime('%Y-%m', first_seen_at) as month,
             ROUND(AVG(price_at_first_seen)) as avg, COUNT(*) as count
      FROM listings WHERE price_at_first_seen > 0 AND first_seen_at IS NOT NULL
      GROUP BY city, zip, locale_id, month ORDER BY month, city
    `).all();
    const soldPrice = db.prepare(`
      SELECT LOWER(city) as city, zip, locale_id, strftime('%Y-%m', sold_at) as month,
             ROUND(AVG(sold_price)) as avg, COUNT(*) as count
      FROM listings WHERE sold_price IS NOT NULL AND sold_at IS NOT NULL
      GROUP BY city, zip, locale_id, month ORDER BY month, city
    `).all();
    const score = db.prepare(`
      SELECT LOWER(city) as city, zip, locale_id, strftime('%Y-%m', first_seen_at) as month,
             ROUND(AVG(score), 1) as avg, COUNT(*) as count
      FROM listings WHERE score IS NOT NULL AND first_seen_at IS NOT NULL
      GROUP BY city, zip, locale_id, month ORDER BY month, city
    `).all();
    return { listPrice, soldPrice, score };
  });

  // Re-score all listings for a locale using current scoring config (GET or POST)
  const doRescore = async (localeId: string | undefined) => {
    const { scoreWithBreakdown } = await import('../scoring/index.js');
    const db = getDb();
    const baseSql = `SELECT id, address, city, state, zip, price, beds, baths, sqft, lot_sqft,
        year_built, walk_score, school_district, property_type, days_on_market, lat, lng,
        url, status, status_label, next_open_house_start, next_open_house_end, sold_date,
        locale_id, brief_short, brief_full, prior_listing_id, prior_list_price
      FROM listings WHERE superseded_by IS NULL`;
    const sql = localeId ? `${baseSql} AND locale_id = ?` : baseSql;
    type RescoreRow = Parameters<typeof scoreWithBreakdown>[0] & {
      locale_id: string; prior_listing_id: string | null; prior_list_price: number | null;
    };
    const rows = (localeId ? db.prepare(sql).all(localeId) : db.prepare(sql).all()) as RescoreRow[];
    const update = db.prepare(`UPDATE listings SET score = ?, score_breakdown = ? WHERE id = ?`);
    let updated = 0;
    for (const row of rows) {
      const locale = LOCALES[row.locale_id];
      if (!locale) continue;
      const breakdown = scoreWithBreakdown(row, locale, undefined, {
        prior_listing_id: row.prior_listing_id,
        prior_list_price: row.prior_list_price,
      });
      update.run(breakdown.total, JSON.stringify(breakdown), row.id);
      updated++;
    }
    return { ok: true, updated };
  };
  app.get('/api/rescore',  async (req) => doRescore((req.query as Record<string, string>).locale_id));
  app.post('/api/rescore', async (req) => doRescore((req.query as Record<string, string>).locale_id));

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
    const { getUnnotifiedChanges, markChangesNotified, sweepStaleChanges, getDb } = await import('../db/index.js');
    const { newHighScoreIds } = await runPoll();

    let newListings: import('../notifications/email.js').NotifyListing[] = [];
    if (newHighScoreIds.length > 0) {
      const placeholders = newHighScoreIds.map(() => '?').join(',');
      newListings = getDb().prepare(`
        SELECT id, address, city, state, zip, price, price_at_first_seen, beds, baths, sqft, lot_sqft,
               year_built, days_on_market, first_seen_at, score, score_breakdown, school_district, property_type, walk_score, url,
               brief_short, brief_full, lat, lng
        FROM listings WHERE id IN (${placeholders}) AND superseded_by IS NULL AND score >= ? ORDER BY score DESC
      `).all(...newHighScoreIds, NOTIFY_SCORE_THRESHOLD) as import('../notifications/email.js').NotifyListing[];
    }

    const enabledLocaleIds2 = Object.values(LOCALES).filter(l => !l.disableNotifications).map(l => l.id);
    const changes = getUnnotifiedChanges(NOTIFY_SCORE_THRESHOLD, enabledLocaleIds2);

    sweepStaleChanges();
    if (newListings.length > 0 || changes.length > 0) {
      await sendDigest(newListings, changes);
      markChangesNotified(changes.map(c => c.change_id));
      return { status: 'digest sent', new_listings: newListings.length, changes: changes.length };
    }
    return { status: 'nothing to notify', new_listings: 0, changes: 0 };
  });
}
