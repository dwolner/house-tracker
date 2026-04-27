/**
 * Rent estimate enrichment using RentCast API.
 *
 * Hard limits (enforced in DB, not just in memory):
 *   - 50 calls/month maximum — hard stop, never exceeded
 *   - RENTCAST_DAILY_LIMIT calls/day (default: 1)
 *     Set RENTCAST_DAILY_LIMIT=10 in .env temporarily during initial backfill/testing.
 *
 * Results cached in `rental_estimates` (refreshed after 30 days).
 * Every call is logged to `rentcast_usage` for accounting.
 *
 * Sign up (free): https://app.rentcast.io/app
 */

import 'dotenv/config';
import fetch from 'node-fetch';
import {
  getListingsNeedingRentEstimate,
  upsertRentalEstimate,
  logRentcastCall,
  getRentcastUsage,
  type Listing,
} from '../db/index.js';

const MONTHLY_HARD_LIMIT = 50;
const API_KEY   = process.env.RENTCAST_API_KEY;
const DAILY_CAP = parseInt(process.env.RENTCAST_DAILY_LIMIT ?? '1', 10);
const BASE      = 'https://api.rentcast.io/v1/avm/rent/long-term';

interface RentCastResponse {
  rent: number;
  rentRangeLow: number;
  rentRangeHigh: number;
}

async function fetchRentEstimate(l: Listing): Promise<{ rent: number; low: number; high: number } | null> {
  const params = new URLSearchParams({
    address: `${l.address}, ${l.city}, ${l.state} ${l.zip}`,
    bedrooms: String(l.beds),
    bathrooms: String(l.baths),
    ...(l.sqft ? { squareFeet: String(l.sqft) } : {}),
    propertyType: 'Single Family',
  });

  const res = await fetch(`${BASE}?${params}`, {
    headers: { 'X-Api-Key': API_KEY!, Accept: 'application/json' },
  });

  if (!res.ok) {
    console.warn(`[rent-estimate] RentCast ${res.status} for ${l.address}`);
    return null;
  }
  const data = await res.json() as RentCastResponse;
  if (!data.rent) return null;
  return {
    rent: Math.round(data.rent),
    low:  Math.round(data.rentRangeLow  ?? data.rent),
    high: Math.round(data.rentRangeHigh ?? data.rent),
  };
}

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

export async function refreshRentEstimates(localeId: string, maxAgeDays = 30): Promise<{ updated: number; skipped: number; limitHit: string | null }> {
  if (!API_KEY) {
    console.log('[rent-estimate] RENTCAST_API_KEY not set — skipping');
    return { updated: 0, skipped: 0, limitHit: null };
  }

  const usage = getRentcastUsage();
  console.log(`[rent-estimate] usage — this month: ${usage.thisMonth}/${MONTHLY_HARD_LIMIT}, today: ${usage.today}/${DAILY_CAP}`);

  if (usage.thisMonth >= MONTHLY_HARD_LIMIT) {
    console.warn(`[rent-estimate] MONTHLY LIMIT REACHED (${usage.thisMonth}/${MONTHLY_HARD_LIMIT}) — no calls will be made`);
    return { updated: 0, skipped: 0, limitHit: 'monthly' };
  }

  if (usage.today >= DAILY_CAP) {
    console.log(`[rent-estimate] daily limit reached (${usage.today}/${DAILY_CAP}) — set RENTCAST_DAILY_LIMIT to allow more`);
    return { updated: 0, skipped: 0, limitHit: 'daily' };
  }

  const listings = getListingsNeedingRentEstimate(localeId, maxAgeDays);
  const remainingMonth = MONTHLY_HARD_LIMIT - usage.thisMonth;
  const remainingDay   = DAILY_CAP - usage.today;
  const canFetch = Math.min(listings.length, remainingMonth, remainingDay);

  console.log(`[rent-estimate] ${listings.length} listings need estimates — will fetch ${canFetch} (month: ${remainingMonth} left, day: ${remainingDay} left)`);

  let updated = 0;
  let skipped = 0;

  for (let i = 0; i < canFetch; i++) {
    const l = listings[i];
    try {
      logRentcastCall(l.id); // log before the call so a crash never double-counts
      const result = await fetchRentEstimate(l);
      if (result) {
        upsertRentalEstimate({
          listing_id: l.id,
          estimated_rent: result.rent,
          rent_low:  result.low,
          rent_high: result.high,
          source: 'rentcast',
          fetched_at: new Date().toISOString(),
        });
        console.log(`[rent-estimate] ${l.address}: $${result.rent}/mo (${result.low}–${result.high})`);
        updated++;
      } else {
        skipped++;
      }
    } catch (err) {
      console.error(`[rent-estimate] error for ${l.address}:`, err);
      skipped++;
    }
    await sleep(1100); // stay well within free-tier rate limit (~1 req/sec)
  }

  const finalUsage = getRentcastUsage();
  console.log(`[rent-estimate] done — updated: ${updated}, skipped: ${skipped} | month total: ${finalUsage.thisMonth}/${MONTHLY_HARD_LIMIT}`);

  return { updated, skipped, limitHit: null };
}

// Run standalone: `pnpm rent-estimate`
if (process.argv[1]?.endsWith('rent-estimate.ts') || process.argv[1]?.endsWith('rent-estimate.js')) {
  refreshRentEstimates('st-louis').then(result => {
    if (result.limitHit === 'monthly') process.exit(2);
    if (result.limitHit === 'daily')   process.exit(3);
    process.exit(0);
  });
}
