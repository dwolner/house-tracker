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
    .prepare('SELECT id, price, status, walk_score, school_district FROM listings WHERE id = ?')
    .get(listing.id) as { id: string; price: number; status: string; walk_score: number | null; school_district: string | null } | undefined;

  if (!existing) {
    db.prepare(`
      INSERT INTO listings (id, address, city, state, zip, price, beds, baths, sqft, lot_sqft,
        year_built, walk_score, property_type, lat, lng, url, status, days_on_market,
        score, score_breakdown, next_open_house_start, next_open_house_end,
        first_seen_at, last_seen_at, price_at_first_seen)
      VALUES (@id, @address, @city, @state, @zip, @price, @beds, @baths, @sqft, @lot_sqft,
        @year_built, @walk_score, @property_type, @lat, @lng, @url, @status, @days_on_market,
        @score, @score_breakdown, @next_open_house_start, @next_open_house_end,
        @first_seen_at, @last_seen_at, @price_at_first_seen)
    `).run({
      ...listing,
      score_breakdown,
      first_seen_at: now,
      last_seen_at: now,
      price_at_first_seen: listing.price,
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

  db.prepare(`
    UPDATE listings SET price = @price, status = @status, days_on_market = @days_on_market,
      score = @score, score_breakdown = @score_breakdown, property_type = @property_type,
      next_open_house_start = @next_open_house_start, next_open_house_end = @next_open_house_end,
      last_seen_at = @last_seen_at
    WHERE id = @id
  `).run({
    id: listing.id,
    price: listing.price,
    status: listing.status,
    days_on_market: listing.days_on_market,
    score: finalScore,
    score_breakdown: finalBreakdown,
    property_type: listing.property_type,
    next_open_house_start: listing.next_open_house_start ?? null,
    next_open_house_end: listing.next_open_house_end ?? null,
    last_seen_at: now,
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
    .prepare(`UPDATE listings SET status = 'inactive' WHERE state = 'PA' AND status IN ('9', '1') AND last_seen_at < ?`)
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
  beds: number;
  baths: number;
  sqft: number | null;
  score: number;
  school_district: string | null;
  url: string | null;
}

export function getUnnotifiedChanges(): ChangeWithListing[] {
  return getDb().prepare(`
    SELECT c.id as change_id, c.change_type, c.old_value, c.new_value, c.changed_at,
           l.id, l.address, l.city, l.zip, l.price, l.beds, l.baths, l.sqft,
           l.score, l.school_district, l.url
    FROM change_log c
    JOIN listings l ON l.id = c.listing_id
    WHERE c.notified = 0
    ORDER BY c.changed_at ASC
  `).all() as ChangeWithListing[];
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

export function logPoll(area: string, listingsFound: number, newListings: number): void {
  getDb()
    .prepare('INSERT INTO poll_log (polled_at, area, listings_found, new_listings) VALUES (?, ?, ?, ?)')
    .run(new Date().toISOString(), area, listingsFound, newListings);
}
