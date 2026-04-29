import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';
import { scoreWithBreakdown, setBaseRate } from './scoring/index.js';
import { getLocale, LOCALES } from './locales/index.js';
import { getCurrentMortgageRate } from './enrichment/mortgage-rate.js';
import { resolveRentOverride } from './enrichment/rent-estimate.js';
import type { RedfinListing } from './poller/redfin.js';
import type { RentalEstimateWithSqft } from './db/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = process.env.DB_PATH ?? path.join(__dirname, '../data/listings.db');

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');

const localeFilter = process.argv[2]; // optional: rescore only one locale
if (localeFilter && !LOCALES[localeFilter]) {
  console.error(`Unknown locale "${localeFilter}". Available: ${Object.keys(LOCALES).join(', ')}`);
  process.exit(1);
}

const rows = db.prepare(`
  SELECT id, address, city, state, zip, price, beds, baths, sqft, lot_sqft,
         year_built, walk_score, school_district, property_type, lat, lng,
         url, status, status_label, days_on_market, next_open_house_start,
         next_open_house_end, locale_id
  FROM listings
  WHERE score IS NOT NULL
    ${localeFilter ? 'AND locale_id = ?' : ''}
`).all(...(localeFilter ? [localeFilter] : [])) as (RedfinListing & { locale_id: string })[];

// Pre-fetch rental estimates with city/zip for premium-ratio derived rent
const estimatesWithSqft = db.prepare(`
  SELECT re.listing_id, re.estimated_rent, re.rent_low, re.rent_high, re.source, re.fetched_at,
         l.beds, l.sqft, l.zip, l.city
  FROM rental_estimates re
  JOIN listings l ON l.id = re.listing_id
  WHERE l.status NOT IN ('inactive', '130')
    ${localeFilter ? 'AND l.locale_id = ?' : ''}
`).all(...(localeFilter ? [localeFilter] : [])) as RentalEstimateWithSqft[];

const update = db.prepare(`
  UPDATE listings SET score = @score, score_breakdown = @score_breakdown WHERE id = @id
`);

setBaseRate(await getCurrentMortgageRate());

const rescoreAll = db.transaction(() => {
  let count = 0;
  for (const row of rows) {
    const locale = getLocale(row.locale_id);
    const rentResolution = locale.investmentConfig
      ? resolveRentOverride(row, estimatesWithSqft, locale)
      : undefined;
    const breakdown = scoreWithBreakdown(row, locale, rentResolution);
    update.run({ id: row.id, score: breakdown.total, score_breakdown: JSON.stringify(breakdown) });
    count++;
  }
  return count;
});

const count = rescoreAll();
console.log(`Rescored ${count} listings${localeFilter ? ` (${localeFilter})` : ''}.`);
