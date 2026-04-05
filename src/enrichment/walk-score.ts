import fetch from 'node-fetch';
import {
  getListingsMissingWalkScore,
  getListingsMissingSchoolDistrict,
  updateListingWalkScore,
  updateListingSchoolDistrict,
} from '../db/index.js';
import { scoreWithBreakdown } from '../scoring/index.js';
import type { RedfinListing } from '../poller/redfin.js';

const REDFIN_BASE = 'https://www.redfin.com';
const HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  Accept: 'application/json, text/plain, */*',
  'Accept-Language': 'en-US,en;q=0.9',
  Referer: 'https://www.redfin.com/',
};

// Extract Redfin's internal numeric property ID from the listing URL
// URL format: /PA/Narberth/123-Main-St-19072/home/12345678
function extractPropertyId(url: string | undefined | null): string | null {
  if (!url) return null;
  const match = url.match(/\/home\/(\d+)/);
  return match ? match[1] : null;
}

interface WalkScoreData {
  walkScore?: { value?: number };
}

interface NeighborhoodStatsPayload {
  walkScoreInfo?: {
    walkScoreData?: WalkScoreData;
  };
}

async function fetchWalkScoreFromRedfin(propertyId: string): Promise<number | null> {
  const params = new URLSearchParams({ propertyId, accessLevel: '1' });
  const url = `${REDFIN_BASE}/stingray/api/home/details/neighborhoodStats/statsInfo?${params}`;

  const res = await fetch(url, { headers: HEADERS });
  if (!res.ok) {
    console.warn(`[enrich] HTTP ${res.status} for propertyId ${propertyId}`);
    return null;
  }

  const text = await res.text();
  // Redfin prefixes all Stingray JSON responses with "{}&&" — strip it
  const json = text.startsWith('{}&&') ? text.slice(4) : text;

  let data: { payload?: NeighborhoodStatsPayload };
  try {
    data = JSON.parse(json);
  } catch {
    console.warn(`[enrich] JSON parse error for propertyId ${propertyId}`);
    return null;
  }

  const value = data?.payload?.walkScoreInfo?.walkScoreData?.walkScore?.value;
  return typeof value === 'number' ? value : null;
}

async function fetchSchoolDistrict(lat: number, lng: number): Promise<string | null> {
  const params = new URLSearchParams({
    x: String(lng),
    y: String(lat),
    benchmark: 'Public_AR_Current',
    vintage: 'Current_Current',
    layers: 'Unified School Districts',
    format: 'json',
  });
  const res = await fetch(
    `https://geocoding.geo.census.gov/geocoder/geographies/coordinates?${params}`,
  );
  if (!res.ok) return null;
  const data = (await res.json()) as { result?: { geographies?: { 'Unified School Districts'?: { NAME?: string }[] } } };
  return data?.result?.geographies?.['Unified School Districts']?.[0]?.NAME ?? null;
}

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function runEnrichment(): Promise<void> {
  const listings = getListingsMissingWalkScore();
  console.log(`[enrich] ${listings.length} listings need walk score`);

  let updated = 0;
  let failed = 0;

  for (const listing of listings) {
    const propertyId = extractPropertyId(listing.url);
    if (!propertyId) {
      console.warn(`[enrich] could not extract propertyId from URL: ${listing.url}`);
      failed++;
      continue;
    }

    try {
      const walkScore = await fetchWalkScoreFromRedfin(propertyId);

      if (walkScore != null) {
        const asRedfinListing: RedfinListing = {
          ...listing,
          baths: 0,
          year_built: null,
          walk_score: walkScore,
          url: listing.url,
          status: '',
          next_open_house_start: null,
          next_open_house_end: null,
        };
        const breakdown = scoreWithBreakdown(asRedfinListing);
        updateListingWalkScore(listing.id, walkScore, breakdown.total, breakdown);
        console.log(
          `[enrich] ${listing.address}, ${listing.city} — walk: ${walkScore} — score: ${breakdown.total.toFixed(1)}`,
        );
        updated++;
      } else {
        failed++;
      }
    } catch (err) {
      console.error(`[enrich] error for ${listing.address}:`, err);
      failed++;
    }

    // Be polite — small delay between requests
    await sleep(500);
  }

  console.log(`[enrich] walk scores done — ${updated} updated, ${failed} failed/skipped`);

  // --- School district enrichment ---
  const sdListings = getListingsMissingSchoolDistrict();
  console.log(`[enrich] ${sdListings.length} listings need school district`);
  let sdUpdated = 0, sdFailed = 0;

  for (const listing of sdListings) {
    try {
      const district = await fetchSchoolDistrict(listing.lat, listing.lng);
      if (district) {
        const asRedfinListing: RedfinListing = {
          ...listing,
          baths: 0,
          year_built: null,
          walk_score: listing.walk_score,
          school_district: district,
          url: listing.url ?? '',
          status: '',
          next_open_house_start: null,
          next_open_house_end: null,
        };
        const breakdown = scoreWithBreakdown(asRedfinListing);
        updateListingSchoolDistrict(listing.id, district, breakdown.total, breakdown);
        console.log(`[enrich] ${listing.address}, ${listing.city} — district: ${district} — score: ${breakdown.total.toFixed(1)}`);
        sdUpdated++;
      } else {
        sdFailed++;
      }
    } catch (err) {
      console.error(`[enrich] school district error for ${listing.address}:`, err);
      sdFailed++;
    }
    await sleep(300);
  }

  console.log(`[enrich] school districts done — ${sdUpdated} updated, ${sdFailed} failed/skipped`);
}

export { runEnrichment };

const isMain =
  process.argv[1]?.endsWith('enrichment/walk-score.ts') ||
  process.argv[1]?.endsWith('enrichment/walk-score.js');
if (isMain) {
  runEnrichment().catch(err => {
    console.error('[enrich] fatal:', err);
    process.exit(1);
  });
}
