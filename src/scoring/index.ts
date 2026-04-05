import type { RedfinListing } from '../poller/redfin.js';

// Amtrak Keystone stations
const AMTRAK_STATIONS = [
  { name: 'Ardmore', lat: 40.0087, lng: -75.2966 },
  { name: 'Paoli', lat: 40.0423, lng: -75.4852 },
  { name: 'Exton', lat: 40.0284, lng: -75.6213 },
  { name: 'Downingtown', lat: 40.0065, lng: -75.7035 },
];

// Narberth SEPTA station — proxy for walkability to Narberth town center
const NARBERTH_STATION = { lat: 40.0066, lng: -75.2661 };

// School district scoring — keyed on the district name returned by the Census geocoder.
// Falls back to city-based lookup when school_district is not yet enriched.
const DISTRICT_SCORES: Record<string, number> = {
  'Lower Merion School District':        20,
  'Radnor Township School District':     16,
  'Tredyffrin-Easttown School District': 13,
  'Haverford Township School District':  10,
  'Upper Merion Area School District':    9,
  'Great Valley School District':         8,
};

// City-based fallback (used before enrichment populates school_district)
const LOWER_MERION_CITIES = new Set([
  'narberth', 'wynnewood', 'ardmore', 'haverford', 'bryn mawr',
  'bala cynwyd', 'penn valley', 'merion station', 'gladwyne',
  'penn wynne', 'merion', 'cynwyd',
]);
const SECONDARY_CITIES = new Set(['wayne', 'berwyn', 'devon', 'strafford']);

const SFD_TYPES = new Set(['single family residential', 'single family']);
const TWIN_TYPES = new Set(['townhouse', 'twin', 'semi-detached']);

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) *
    Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}

export interface ScoreBreakdown {
  total: number;
  propertyType: number;
  schoolDistrict: number;
  walkability: number;
  price: number;
  sqft: number;
  lot: number;
  amtrak: number;
  beds: number;
  pricePerSqft: number;
  narberthBonus: number;
  domPenalty: number;
}

export function scoreListing(listing: RedfinListing): number {
  return scoreWithBreakdown(listing).total;
}

export function scoreWithBreakdown(listing: RedfinListing): ScoreBreakdown {
  const city = listing.city.toLowerCase().trim();
  const propType = listing.property_type?.toLowerCase().trim() ?? '';

  // Factor weights sum to exactly 100 so a perfect score is genuinely rare.
  // Narberth bonus is additive on top (Narberth listings can exceed 100).

  // --- Property type (20 pts) ---
  let propertyType = 0;
  if (SFD_TYPES.has(propType)) {
    propertyType = 20;
  } else if (TWIN_TYPES.has(propType)) {
    propertyType = 5;
  }

  // --- School district (20 pts) ---
  // Use Census-enriched district name when available; fall back to city lookup.
  let schoolDistrict = 0;
  if (listing.school_district) {
    schoolDistrict = DISTRICT_SCORES[listing.school_district] ?? 3;
  } else if (LOWER_MERION_CITIES.has(city)) {
    schoolDistrict = 20;
  } else if (SECONDARY_CITIES.has(city)) {
    schoolDistrict = 7;
  }

  // --- Walkability (12 pts) ---
  const walkabilityKnown = listing.walk_score != null;
  const walkability = walkabilityKnown ? (listing.walk_score! / 100) * 12 : 0;

  // --- Price (12 pts) ---
  let price = 0;
  if (listing.price <= 1_000_000) {
    price = 12;
  } else if (listing.price <= 1_500_000) {
    price = 12 - ((listing.price - 1_000_000) / 500_000) * 6;
  } else if (listing.price <= 2_000_000) {
    price = 6 - ((listing.price - 1_500_000) / 500_000) * 6;
  }
  price = clamp(price, 0, 12);

  // --- Sqft (8 pts) — hard floor at 1,500 ---
  let sqft = 0;
  if (listing.sqft != null) {
    if (listing.sqft < 1_500) {
      sqft = 0;
    } else if (listing.sqft < 2_000) {
      sqft = clamp(((listing.sqft - 1_500) / 500) * 4, 0, 4);
    } else if (listing.sqft < 2_500) {
      sqft = clamp(4 + ((listing.sqft - 2_000) / 500) * 2, 4, 6);
    } else {
      sqft = 8;
    }
  }

  // --- Lot size (12 pts) ---
  let lot = 0;
  if (listing.lot_sqft != null) {
    const acres = listing.lot_sqft / 43_560;
    if (acres < 0.1) {
      lot = clamp((acres / 0.1) * 2, 0, 2);
    } else if (acres < 0.2) {
      lot = clamp(2 + ((acres - 0.1) / 0.1) * 4, 2, 6);
    } else if (acres < 0.4) {
      lot = clamp(6 + ((acres - 0.2) / 0.2) * 6, 6, 12);
    } else {
      lot = 12;
    }
  }

  // --- Amtrak proximity (8 pts) ---
  const minDistKm = Math.min(
    ...AMTRAK_STATIONS.map(s => haversineKm(listing.lat, listing.lng, s.lat, s.lng)),
  );
  let amtrak = 0;
  if (minDistKm <= 0.5) amtrak = 8;
  else if (minDistKm <= 3) amtrak = 8 - ((minDistKm - 0.5) / 2.5) * 4;
  else if (minDistKm <= 8) amtrak = 4 - ((minDistKm - 3) / 5) * 4;
  amtrak = clamp(amtrak, 0, 8);

  // --- Beds (4 pts) ---
  let beds = 0;
  if (listing.beds >= 4) beds = 4;
  else if (listing.beds === 3) beds = 2;

  // --- Price per sqft (4 pts) ---
  // ≤$300/sqft = full 4pts, fades to 0 at $500/sqft
  let pricePerSqft = 0;
  if (listing.sqft != null && listing.sqft > 0) {
    const ppsf = listing.price / listing.sqft;
    if (ppsf <= 300) {
      pricePerSqft = 4;
    } else if (ppsf <= 500) {
      pricePerSqft = clamp(4 - ((ppsf - 300) / 200) * 4, 0, 4);
    }
  }

  // --- Narberth town center bonus (up to +6 pts) ---
  // Only applies to Narberth listings. Distance to the SEPTA station
  // is a proxy for walkability to the town center (restaurants, shops).
  // <0.4km (~4 blocks) = full 6 pts, fades to 0 at 1.2km (~0.75 mi)
  let narberthBonus = 0;
  if (city === 'narberth') {
    const distToTownKm = haversineKm(listing.lat, listing.lng, NARBERTH_STATION.lat, NARBERTH_STATION.lng);
    if (distToTownKm <= 0.4) {
      narberthBonus = 6;
    } else if (distToTownKm <= 1.2) {
      narberthBonus = clamp(6 - ((distToTownKm - 0.4) / 0.8) * 6, 0, 6);
    }
  }

  // --- DOM penalty ---
  // Unknown DOM = no penalty (benefit of the doubt).
  // Applied last so it can drag down an otherwise strong score.
  let domPenalty = 0;
  if (listing.days_on_market != null) {
    const dom = listing.days_on_market;
    if (dom > 120) {
      domPenalty = 10;
    } else if (dom > 60) {
      domPenalty = clamp(((dom - 60) / 60) * 7, 0, 7);
    } else if (dom > 30) {
      domPenalty = clamp(((dom - 30) / 30) * 3, 0, 3);
    }
  }

  const total = clamp(
    propertyType + schoolDistrict + walkability + price + sqft + lot + amtrak + beds +
    pricePerSqft + narberthBonus - domPenalty,
    0,
    100,
  );

  return { total, propertyType, schoolDistrict, walkability, price, sqft, lot, amtrak, beds, pricePerSqft, narberthBonus, domPenalty };
}
