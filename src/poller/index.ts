import 'dotenv/config';
import { fetchRegionListings, fetchRecentlySold, fetchRegionListingsJson, fetchRecentlySoldJson } from './redfin.js';
import { upsertListing, markListingSold, logPoll, markStaleListingsInactive, pruneOldBreakdowns } from '../db/index.js';
import { scoreWithBreakdown } from '../scoring/index.js';
import { runEnrichment } from '../enrichment/walk-score.js';
import { NOTIFY_SCORE_THRESHOLD } from '../notifications/email.js';
import { LOCALES } from '../locales/index.js';

export async function runPoll(): Promise<{ newHighScoreIds: string[] }> {
  console.log(`[poll] starting at ${new Date().toISOString()}`);

  const newHighScoreIds: string[] = [];

  for (const locale of Object.values(LOCALES)) {
    for (const region of locale.regions) {
      try {
        const listings = await (region.useJsonApi
          ? fetchRegionListingsJson(region.region_id, region.region_type, locale.minBeds, locale.maxPrice, locale.uipt ?? '1,2,3')
          : fetchRegionListings(region.region_id, region.region_type, locale.minBeds, locale.maxPrice, locale.uipt ?? '1,2,3'));
        let newCount = 0;

        const valid = listings.filter(l =>
          l.address.trim() !== '' &&
          l.beds > 0 &&
          l.state.toUpperCase() === locale.state.toUpperCase()
        );
        const filtered = listings.length - valid.length;
        if (filtered > 0) {
          console.log(`[poll] ${region.name}: dropped ${filtered} listings (blank address, 0 beds, or wrong state)`);
        }

        for (const listing of valid) {
          const breakdown = scoreWithBreakdown(listing, locale);
          const { isNew } = upsertListing({ ...listing, locale_id: locale.id, score: breakdown.total, breakdown });

          if (isNew) {
            newCount++;
            console.log(`[poll] NEW ${locale.name} / ${region.name}: ${listing.address}, ${listing.city} — $${listing.price.toLocaleString()} — score: ${breakdown.total.toFixed(1)}`);
            if (!locale.disableNotifications && breakdown.total >= NOTIFY_SCORE_THRESHOLD) {
              newHighScoreIds.push(listing.id);
            }
          }
        }

        logPoll(region.name, valid.length, newCount);
        console.log(`[poll] ${locale.name} / ${region.name}: ${listings.length} listings, ${newCount} new`);

        try {
          const sold = await (region.useJsonApi
            ? fetchRecentlySoldJson(region.region_id, region.region_type, locale.minBeds, locale.maxPrice, locale.uipt ?? '1,2,3')
            : fetchRecentlySold(region.region_id, region.region_type, locale.minBeds, locale.maxPrice, locale.uipt ?? '1,2,3'));
          let soldCount = 0;
          for (const s of sold) {
            if (markListingSold(s.id, s.price, s.sold_date, s.days_on_market)) soldCount++;
          }
          if (soldCount > 0) console.log(`[poll] ${region.name}: marked ${soldCount} listing(s) as sold`);
        } catch (err) {
          console.error(`[poll] error fetching sold listings for ${region.name}:`, err);
        }

        await sleep(1500);
      } catch (err) {
        console.error(`[poll] error fetching ${locale.name} / ${region.name}:`, err);
      }
    }
  }

  console.log(`[poll] done at ${new Date().toISOString()}`);

  const inactivated = markStaleListingsInactive();
  if (inactivated > 0) console.log(`[poll] marked ${inactivated} listing(s) as inactive`);

  const pruned = pruneOldBreakdowns();
  if (pruned > 0) console.log(`[poll] pruned score_breakdown from ${pruned} old inactive listing(s)`);

  await runEnrichment();

  return { newHighScoreIds };
}

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

const isMain = process.argv[1]?.endsWith('poller/index.ts') || process.argv[1]?.endsWith('poller/index.js');
if (isMain) {
  runPoll().catch(err => {
    console.error('[poll] fatal:', err);
    process.exit(1);
  });
}
