import 'dotenv/config';
import { fetchRegionListings, TARGET_REGIONS } from './redfin.js';
import { upsertListing, logPoll, getDb, markStaleListingsInactive, pruneOldBreakdowns } from '../db/index.js';
import { scoreWithBreakdown } from '../scoring/index.js';
import { runEnrichment } from '../enrichment/walk-score.js';
import { sendNewListingsDigest, NOTIFY_SCORE_THRESHOLD, type NotifyListing } from '../notifications/email.js';

export async function runPoll(): Promise<void> {
  console.log(`[poll] starting at ${new Date().toISOString()}`);

  const newHighScoreIds: string[] = [];

  for (const region of TARGET_REGIONS) {
    try {
      const listings = await fetchRegionListings(region.region_id, region.region_type);
      let newCount = 0;

      const valid = listings.filter(l => l.address.trim() !== '' && l.beds > 0);
      const filtered = listings.length - valid.length;
      if (filtered > 0) console.log(`[poll] ${region.name}: dropped ${filtered} listings (blank address or 0 beds)`);

      for (const listing of valid) {
        const breakdown = scoreWithBreakdown(listing);
        const { isNew } = upsertListing({ ...listing, score: breakdown.total, breakdown });

        if (isNew) {
          newCount++;
          console.log(`[poll] NEW listing: ${listing.address}, ${listing.city} — $${listing.price.toLocaleString()} — score: ${breakdown.total.toFixed(1)}`);
          if (breakdown.total >= NOTIFY_SCORE_THRESHOLD) {
            newHighScoreIds.push(listing.id);
          }
        }
      }

      logPoll(region.name, valid.length, newCount);
      console.log(`[poll] ${region.name}: ${listings.length} listings, ${newCount} new`);

      // Be polite to Redfin — small delay between regions
      await sleep(1500);
    } catch (err) {
      console.error(`[poll] error fetching ${region.name}:`, err);
    }
  }

  console.log(`[poll] done at ${new Date().toISOString()}`);

  const inactivated = markStaleListingsInactive();
  if (inactivated > 0) console.log(`[poll] marked ${inactivated} listing(s) as inactive (no longer on Redfin)`);

  const pruned = pruneOldBreakdowns();
  if (pruned > 0) console.log(`[poll] pruned score_breakdown from ${pruned} old inactive listing(s)`);

  await runEnrichment();

  if (newHighScoreIds.length > 0) {
    const db = getDb();
    const placeholders = newHighScoreIds.map(() => '?').join(',');
    const toNotify = db.prepare(`
      SELECT id, address, city, zip, price, price_at_first_seen, beds, baths, sqft, lot_sqft,
             days_on_market, score, score_breakdown, school_district, property_type, walk_score, url
      FROM listings WHERE id IN (${placeholders})
      ORDER BY score DESC
    `).all(...newHighScoreIds) as NotifyListing[];
    await sendNewListingsDigest(toNotify).catch(err => console.error('[notify] email error:', err));
  }
}

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Run directly: pnpm poll
// process.argv[1] check prevents auto-run when imported by the web server
const isMain = process.argv[1]?.endsWith('poller/index.ts') || process.argv[1]?.endsWith('poller/index.js');
if (isMain) {
  runPoll().catch(err => {
    console.error('[poll] fatal:', err);
    process.exit(1);
  });
}
