import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import type { ScoreBreakdown } from '../scoring/index.js';
import { scoreWithBreakdown } from '../scoring/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = process.env.DB_PATH ?? path.join(__dirname, '../../data/listings.db');

export interface Listing {
  id: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  price: number;
  beds: number;
  baths: number;
  sqft: number | null;
  lot_sqft: number | null;
  year_built: number | null;
  walk_score: number | null;
  school_district: string | null;
  property_type: string | null;
  lat: number;
  lng: number;
  url: string | null;
  status: string;
  status_label: string | null;
  days_on_market: number | null;
  score: number | null;
  score_breakdown: string | null; // JSON-serialised ScoreBreakdown
  starred: number;
  next_open_house_start: string | null;
  next_open_house_end: string | null;
  first_seen_at: string;
  last_seen_at: string;
  price_at_first_seen: number;
}

let _db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (_db) return _db;

  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  _db = new Database(DB_PATH);
  _db.pragma('journal_mode = WAL');

  _db.exec(`
    CREATE TABLE IF NOT EXISTS listings (
      id TEXT PRIMARY KEY,
      address TEXT NOT NULL,
      city TEXT NOT NULL,
      state TEXT NOT NULL,
      zip TEXT NOT NULL,
      price INTEGER NOT NULL,
      beds INTEGER NOT NULL,
      baths REAL NOT NULL,
      sqft INTEGER,
      lot_sqft INTEGER,
      year_built INTEGER,
      walk_score INTEGER,
      property_type TEXT,
      lat REAL NOT NULL,
      lng REAL NOT NULL,
      url TEXT NOT NULL,
      status TEXT NOT NULL,
      days_on_market INTEGER,
      score REAL,
      score_breakdown TEXT,
      first_seen_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL,
      price_at_first_seen INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS price_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      listing_id TEXT NOT NULL,
      price INTEGER NOT NULL,
      recorded_at TEXT NOT NULL,
      FOREIGN KEY (listing_id) REFERENCES listings(id)
    );

    CREATE TABLE IF NOT EXISTS change_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      listing_id TEXT NOT NULL,
      change_type TEXT NOT NULL,
      old_value TEXT,
      new_value TEXT,
      changed_at TEXT NOT NULL,
      notified INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS poll_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      polled_at TEXT NOT NULL,
      area TEXT NOT NULL,
      listings_found INTEGER NOT NULL,
      new_listings INTEGER NOT NULL
    );
  `);

  // Migrations
  const cols = (_db.prepare(`PRAGMA table_info(listings)`).all() as { name: string }[]).map(c => c.name);
  if (!cols.includes('property_type')) _db.exec(`ALTER TABLE listings ADD COLUMN property_type TEXT`);
  if (!cols.includes('score_breakdown')) _db.exec(`ALTER TABLE listings ADD COLUMN score_breakdown TEXT`);
  if (!cols.includes('school_district')) _db.exec(`ALTER TABLE listings ADD COLUMN school_district TEXT`);
  if (!cols.includes('starred')) _db.exec(`ALTER TABLE listings ADD COLUMN starred INTEGER NOT NULL DEFAULT 0`);
  if (!cols.includes('next_open_house_start')) _db.exec(`ALTER TABLE listings ADD COLUMN next_open_house_start TEXT`);
  if (!cols.includes('next_open_house_end')) _db.exec(`ALTER TABLE listings ADD COLUMN next_open_house_end TEXT`);
  if (!cols.includes('pending_at')) _db.exec(`ALTER TABLE listings ADD COLUMN pending_at TEXT`);
  if (!cols.includes('pending_price')) _db.exec(`ALTER TABLE listings ADD COLUMN pending_price INTEGER`);
  if (!cols.includes('sold_at')) _db.exec(`ALTER TABLE listings ADD COLUMN sold_at TEXT`);
  if (!cols.includes('sold_price')) _db.exec(`ALTER TABLE listings ADD COLUMN sold_price INTEGER`);
  if (!cols.includes('status_label')) _db.exec(`ALTER TABLE listings ADD COLUMN status_label TEXT`);

  return _db;
}

export function upsertListing(
  listing: Omit<Listing, 'first_seen_at' | 'last_seen_at' | 'price_at_first_seen' | 'score_breakdown' | 'starred'> & {
    score: number;
    breakdown: ScoreBreakdown;
  },
): { isNew: boolean } {
  const db = getDb();
  const now = new Date().toISOString();
  const score_breakdown = JSON.stringify(listing.breakdown);

  const existing = db
    .prepare('SELECT id, price, status, walk_score, school_district, pending_at FROM listings WHERE id = ?')
    .get(listing.id) as { id: string; price: number; status: string; walk_score: number | null; school_district: string | null; pending_at: string | null } | undefined;

  if (!existing) {
    // If the listing is already pending when we first see it, record that immediately
    const insertPendingAt = listing.status === '130' ? now : null;
    const insertPendingPrice = listing.status === '130' ? listing.price : null;

    db.prepare(`
      INSERT INTO listings (id, address, city, state, zip, price, beds, baths, sqft, lot_sqft,
        year_built, walk_score, property_type, lat, lng, url, status, days_on_market,
        score, score_breakdown, next_open_house_start, next_open_house_end,
        first_seen_at, last_seen_at, price_at_first_seen, pending_at, pending_price, status_label)
      VALUES (@id, @address, @city, @state, @zip, @price, @beds, @baths, @sqft, @lot_sqft,
        @year_built, @walk_score, @property_type, @lat, @lng, @url, @status, @days_on_market,
        @score, @score_breakdown, @next_open_house_start, @next_open_house_end,
        @first_seen_at, @last_seen_at, @price_at_first_seen, @pending_at, @pending_price, @status_label)
    `).run({
      ...listing,
      score_breakdown,
      first_seen_at: now,
      last_seen_at: now,
      price_at_first_seen: listing.price,
      pending_at: insertPendingAt,
      pending_price: insertPendingPrice,
      status_label: listing.status_label ?? null,
    });

    db.prepare('INSERT INTO price_history (listing_id, price, recorded_at) VALUES (?, ?, ?)').run(
      listing.id, listing.price, now,
    );
    return { isNew: true };
  }

  // If we already have a walk score from enrichment but the incoming listing has null
  // (Redfin CSV never includes walk score), re-score using the stored walk score
  // so enrichment results aren't overwritten on every poll.
  let finalScore = listing.score;
  let finalBreakdown = score_breakdown;
  const effectiveWalkScore = listing.walk_score ?? existing.walk_score ?? null;
  const effectiveDistrict = listing.school_district ?? existing.school_district ?? null;
  if (effectiveWalkScore !== listing.walk_score || effectiveDistrict !== listing.school_district) {
    const rescored = scoreWithBreakdown({ ...listing, walk_score: effectiveWalkScore, school_district: effectiveDistrict });
    finalScore = rescored.total;
    finalBreakdown = JSON.stringify(rescored);
  }

  const isNowPending = listing.status === '130';
  const wasActive = existing.status === '9' || existing.status === '1';
  const isPendingTransition = isNowPending && wasActive && existing.pending_at == null;

  db.prepare(`
    UPDATE listings SET price = @price, status = @status, status_label = @status_label,
      days_on_market = @days_on_market,
      score = @score, score_breakdown = @score_breakdown, property_type = @property_type,
      next_open_house_start = @next_open_house_start, next_open_house_end = @next_open_house_end,
      last_seen_at = @last_seen_at,
      pending_at   = CASE WHEN @setPending = 1 AND pending_at IS NULL THEN @now ELSE pending_at END,
      pending_price = CASE WHEN @setPending = 1 AND pending_price IS NULL THEN @price ELSE pending_price END
    WHERE id = @id
  `).run({
    id: listing.id,
    price: listing.price,
    status: listing.status,
    status_label: listing.status_label ?? null,
    days_on_market: listing.days_on_market,
    score: finalScore,
    score_breakdown: finalBreakdown,
    property_type: listing.property_type,
    next_open_house_start: listing.next_open_house_start ?? null,
    next_open_house_end: listing.next_open_house_end ?? null,
    last_seen_at: now,
    setPending: isPendingTransition ? 1 : 0,
    now,
  });

  if (existing.price !== listing.price) {
    db.prepare('INSERT INTO price_history (listing_id, price, recorded_at) VALUES (?, ?, ?)').run(
      listing.id, listing.price, now,
    );
    const changeType = listing.price < existing.price ? 'price_drop' : 'price_increase';
    db.prepare('INSERT INTO change_log (listing_id, change_type, old_value, new_value, changed_at) VALUES (?, ?, ?, ?, ?)').run(
      listing.id, changeType, String(existing.price), String(listing.price), now,
    );
  }

  // Coming soon → active is actionable — notify
  if (existing.status === '1' && listing.status === '9') {
    db.prepare('INSERT INTO change_log (listing_id, change_type, old_value, new_value, changed_at) VALUES (?, ?, ?, ?, ?)').run(
      listing.id, 'now_active', 'coming_soon', 'active', now,
    );
  }

  // Active/coming-soon → pending — record for outcomes analytics
  if (isPendingTransition) {
    db.prepare('INSERT INTO change_log (listing_id, change_type, old_value, new_value, changed_at) VALUES (?, ?, ?, ?, ?)').run(
      listing.id, 'now_pending', existing.status, '130', now,
    );
  }

  return { isNew: false };
}

export interface ListingForEnrichment {
  id: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  lat: number;
  lng: number;
  beds: number;
  price: number;
  sqft: number | null;
  lot_sqft: number | null;
  days_on_market: number | null;
  property_type: string | null;
  walk_score: number | null;
  school_district: string | null;
  url: string | null;
}

export function getListingsMissingWalkScore(): ListingForEnrichment[] {
  return getDb()
    .prepare(`SELECT id, address, city, state, zip, lat, lng, beds, price, sqft, lot_sqft,
                     days_on_market, property_type, walk_score, school_district, url
              FROM listings WHERE walk_score IS NULL AND state = 'PA'`)
    .all() as ListingForEnrichment[];
}

export function getListingsMissingSchoolDistrict(): ListingForEnrichment[] {
  return getDb()
    .prepare(`SELECT id, address, city, state, zip, lat, lng, beds, price, sqft, lot_sqft,
                     days_on_market, property_type, walk_score, school_district, url
              FROM listings WHERE school_district IS NULL AND state = 'PA'`)
    .all() as ListingForEnrichment[];
}

export function updateListingSchoolDistrict(
  id: string,
  schoolDistrict: string,
  score: number,
  breakdown: ScoreBreakdown,
): void {
  getDb()
    .prepare(`UPDATE listings SET school_district = @schoolDistrict, score = @score,
                score_breakdown = @score_breakdown WHERE id = @id`)
    .run({ id, schoolDistrict, score, score_breakdown: JSON.stringify(breakdown) });
}

export function updateListingWalkScore(
  id: string,
  walkScore: number,
  score: number,
  breakdown: ScoreBreakdown,
): void {
  getDb()
    .prepare(`UPDATE listings SET walk_score = @walkScore, score = @score,
                score_breakdown = @score_breakdown WHERE id = @id`)
    .run({ id, walkScore, score, score_breakdown: JSON.stringify(breakdown) });
}

// Mark listings inactive if Redfin hasn't returned them in 36 hours.
// 36h gives a buffer over the 24h poll interval to absorb occasional API gaps.
// Returns the count of newly-inactive listings.
export function markStaleListingsInactive(): number {
  const cutoff = new Date(Date.now() - 36 * 60 * 60 * 1000).toISOString();
  const result = getDb()
    .prepare(`UPDATE listings SET status = 'inactive' WHERE state = 'PA' AND status IN ('9', '1', '130') AND last_seen_at < ?`)
    .run(cutoff);
  return result.changes;
}

// Slim down score_breakdown on inactive listings older than 6 months.
// The score column retains the numeric value for historical stats.
export function pruneOldBreakdowns(): number {
  const cutoff = new Date(Date.now() - 180 * 24 * 60 * 60 * 1000).toISOString();
  const result = getDb()
    .prepare(`UPDATE listings SET score_breakdown = NULL WHERE status = 'inactive' AND last_seen_at < ? AND score_breakdown IS NOT NULL`)
    .run(cutoff);
  return result.changes;
}

export interface ChangeWithListing {
  change_id: number;
  change_type: string;
  old_value: string | null;
  new_value: string | null;
  changed_at: string;
  id: string;
  address: string;
  city: string;
  zip: string;
  price: number;
  price_at_first_seen: number | null;
  beds: number;
  baths: number;
  sqft: number | null;
  lot_sqft: number | null;
  days_on_market: number | null;
  score: number;
  score_breakdown: string | null;
  school_district: string | null;
  property_type: string | null;
  walk_score: number | null;
  url: string | null;
}

export function getUnnotifiedChanges(minScore = 0): ChangeWithListing[] {
  return getDb().prepare(`
    SELECT c.id as change_id, c.change_type, c.old_value, c.new_value, c.changed_at,
           l.id, l.address, l.city, l.zip, l.price, l.price_at_first_seen,
           l.beds, l.baths, l.sqft, l.lot_sqft, l.days_on_market,
           l.score, l.score_breakdown, l.school_district, l.property_type, l.walk_score, l.url
    FROM change_log c
    JOIN listings l ON l.id = c.listing_id
    WHERE c.notified = 0
      AND c.change_type IN ('price_drop', 'price_increase', 'now_active')
      AND l.score >= ?
    ORDER BY c.changed_at ASC
  `).all(minScore) as ChangeWithListing[];
}

export function markChangesNotified(ids: number[]): void {
  if (ids.length === 0) return;
  const placeholders = ids.map(() => '?').join(',');
  getDb().prepare(`UPDATE change_log SET notified = 1 WHERE id IN (${placeholders})`).run(...ids);
}

export function toggleStar(id: string): { starred: boolean } {
  const db = getDb();
  const row = db.prepare('SELECT starred FROM listings WHERE id = ?').get(id) as { starred: number } | undefined;
  if (!row) return { starred: false };
  const next = row.starred ? 0 : 1;
  db.prepare('UPDATE listings SET starred = ? WHERE id = ?').run(next, id);
  return { starred: next === 1 };
}

// Mark a listing as sold when it appears in the Redfin sold feed.
// Only updates listings already in the DB — we don't insert sold comps we never tracked.
// Returns true if the record was updated.
export function markListingSold(id: string, soldPrice: number, soldDate: string | null, dom: number | null): boolean {
  const now = new Date().toISOString();
  // Use Redfin's actual sold date if available; fall back to our detection timestamp
  const soldAt = soldDate ?? now;
  const result = getDb()
    .prepare(`
      UPDATE listings SET status = '131', sold_at = @soldAt, sold_price = @soldPrice,
        days_on_market = COALESCE(@dom, days_on_market), last_seen_at = @now
      WHERE id = @id AND sold_at IS NULL
    `)
    .run({ id, soldPrice, soldAt, dom, now });
  if (result.changes > 0) {
    getDb()
      .prepare(`INSERT INTO change_log (listing_id, change_type, old_value, new_value, changed_at) VALUES (?, ?, ?, ?, ?)`)
      .run(id, 'sold', null, String(soldPrice), now);
  }
  return result.changes > 0;
}

export interface Outcome {
  id: string;
  address: string;
  city: string;
  zip: string;
  price_at_first_seen: number;
  pending_price: number | null;
  pending_at: string | null;
  sold_price: number | null;
  sold_at: string | null;
  first_seen_at: string;
  days_on_market: number | null;
  score: number;
  school_district: string | null;
  property_type: string | null;
  beds: number;
  baths: number;
  sqft: number | null;
  url: string | null;
}

export interface OutcomesStats {
  pendingCount: number;
  soldCount: number;
  medianDom: number | null;
  medianListToPendingPct: number | null;  // price cut before going pending
  medianListToSoldPct: number | null;     // actual sale vs. original list price
  byCity: { city: string; count: number; medianDom: number | null }[];
}

export function getOutcomesData(): { listings: Outcome[]; stats: OutcomesStats } {
  const db = getDb();

  const listings = db.prepare(`
    SELECT id, address, city, zip, price_at_first_seen, pending_price, pending_at,
           sold_price, sold_at, first_seen_at, days_on_market, score, school_district,
           property_type, beds, baths, sqft, url
    FROM listings
    WHERE (pending_at IS NOT NULL OR sold_at IS NOT NULL)
      AND score >= 50
      AND LOWER(property_type) = 'single family residential'
    ORDER BY COALESCE(sold_at, pending_at) DESC
    LIMIT 200
  `).all() as Outcome[];

  if (listings.length === 0) {
    return {
      listings,
      stats: { pendingCount: 0, soldCount: 0, medianDom: null, medianListToPendingPct: null, medianListToSoldPct: null, byCity: [] },
    };
  }

  function median(nums: number[]): number | null {
    if (nums.length === 0) return null;
    const sorted = [...nums].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
  }

  const doms = listings.map(l => l.days_on_market).filter((d): d is number => d != null);

  const listToPending = listings
    .filter(l => l.pending_price != null && l.price_at_first_seen > 0)
    .map(l => ((l.pending_price! - l.price_at_first_seen) / l.price_at_first_seen) * 100);

  const listToSold = listings
    .filter(l => l.sold_price != null && l.price_at_first_seen > 0)
    .map(l => ((l.sold_price! - l.price_at_first_seen) / l.price_at_first_seen) * 100);

  const cityMap = new Map<string, number[]>();
  const cityCounts = new Map<string, number>();
  for (const l of listings) {
    const key = l.city.toLowerCase();
    cityCounts.set(key, (cityCounts.get(key) ?? 0) + 1);
    if (!cityMap.has(key)) cityMap.set(key, []);
    if (l.days_on_market != null) cityMap.get(key)!.push(l.days_on_market);
  }

  const byCity = [...cityCounts.entries()]
    .map(([city, count]) => ({ city, count, medianDom: median(cityMap.get(city) ?? []) }))
    .sort((a, b) => b.count - a.count);

  return {
    listings,
    stats: {
      pendingCount: listings.filter(l => l.pending_at != null).length,
      soldCount: listings.filter(l => l.sold_at != null).length,
      medianDom: median(doms),
      medianListToPendingPct: median(listToPending),
      medianListToSoldPct: median(listToSold),
      byCity,
    },
  };
}

export function logPoll(area: string, listingsFound: number, newListings: number): void {
  getDb()
    .prepare('INSERT INTO poll_log (polled_at, area, listings_found, new_listings) VALUES (?, ?, ?, ?)')
    .run(new Date().toISOString(), area, listingsFound, newListings);
}
