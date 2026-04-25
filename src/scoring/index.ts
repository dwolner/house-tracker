import type { RedfinListing } from '../poller/redfin.js';
import type { LocaleConfig } from '../locales/types.js';

export interface ScoreBreakdown {
  total: number;
  // Each value: { pts = raw points earned, max = weight for this factor }
  // domPenalty pts = amount subtracted (positive = penalty applied)
  factors: Record<string, { pts: number; max: number }>;
}

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

// Linear interpolation across sorted { floor, points } breakpoints
function interpolateBp(value: number, bp: { floor: number; points: number }[]): number {
  const sorted = [...bp].sort((a, b) => a.floor - b.floor);
  for (let i = sorted.length - 1; i >= 0; i--) {
    if (value >= sorted[i].floor) {
      if (i === sorted.length - 1) return sorted[i].points;
      const { floor: f0, points: p0 } = sorted[i];
      const { floor: f1, points: p1 } = sorted[i + 1];
      const t = (value - f0) / (f1 - f0);
      return p0 + t * (p1 - p0);
    }
  }
  return 0;
}

// Score piecewise-linear over three control points: excellent → weight, good → weight/2, max → 0
function scoreThreePt(value: number, excellent: number, good: number, max: number, weight: number): number {
  if (value <= excellent) return weight;
  if (value <= good) return weight - ((value - excellent) / (good - excellent)) * (weight / 2);
  if (value <= max) return (weight / 2) - ((value - good) / (max - good)) * (weight / 2);
  return 0;
}

export function scoreWithBreakdown(listing: RedfinListing, locale: LocaleConfig): ScoreBreakdown {
  const { scoring } = locale;
  const city = listing.city.toLowerCase().trim();
  const propType = listing.property_type?.toLowerCase().trim() ?? '';
  const factors: Record<string, { pts: number; max: number }> = {};

  let rawPositive = 0;
  let maxPositive = 0;

  function addFactor(key: string, pts: number, weight: number) {
    const clamped = clamp(pts, 0, weight);
    factors[key] = { pts: clamped, max: weight };
    rawPositive += clamped;
    maxPositive += weight;
  }

  if (scoring.propertyType) {
    const cfg = scoring.propertyType;
    addFactor('propertyType', cfg.typeScores[propType] ?? 0, cfg.weight);
  }

  if (scoring.schoolDistrict) {
    const cfg = scoring.schoolDistrict;
    let pts = 0;
    if (listing.school_district) {
      pts = cfg.districtScores[listing.school_district] ?? cfg.fallbackPoints;
    } else if (cfg.primaryCities.includes(city)) {
      pts = cfg.weight;
    } else if (cfg.secondaryCities.includes(city)) {
      pts = cfg.secondaryCityPoints;
    }
    addFactor('schoolDistrict', pts, cfg.weight);
  }

  if (scoring.walkability) {
    const pts = listing.walk_score != null ? (listing.walk_score / 100) * scoring.walkability.weight : 0;
    addFactor('walkability', pts, scoring.walkability.weight);
  }

  if (scoring.price) {
    const { weight, excellent, good, max } = scoring.price;
    addFactor('price', scoreThreePt(listing.price, excellent, good, max, weight), weight);
  }

  if (scoring.sqft) {
    const cfg = scoring.sqft;
    const pts = listing.sqft != null
      ? interpolateBp(listing.sqft, cfg.breakpoints.map(b => ({ floor: b.sqft, points: b.points })))
      : 0;
    addFactor('sqft', pts, cfg.weight);
  }

  if (scoring.lot) {
    const cfg = scoring.lot;
    const pts = listing.lot_sqft != null
      ? interpolateBp(listing.lot_sqft / 43_560, cfg.breakpoints.map(b => ({ floor: b.acres, points: b.points })))
      : 0;
    addFactor('lot', pts, cfg.weight);
  }

  if (scoring.transit) {
    const { weight, stations, excellentKm, goodKm, maxKm } = scoring.transit;
    const minDist = Math.min(
      ...stations.map(s => haversineKm(listing.lat, listing.lng, s.lat, s.lng)),
    );
    addFactor('transit', scoreThreePt(minDist, excellentKm, goodKm, maxKm, weight), weight);
  }

  if (scoring.beds) {
    const sorted = [...scoring.beds.steps].sort((a, b) => b.minBeds - a.minBeds);
    const pts = sorted.find(s => listing.beds >= s.minBeds)?.points ?? 0;
    addFactor('beds', pts, scoring.beds.weight);
  }

  if (scoring.pricePerSqft) {
    const { weight, excellentPpsf, maxPpsf } = scoring.pricePerSqft;
    let pts = 0;
    if (listing.sqft != null && listing.sqft > 0) {
      const ppsf = listing.price / listing.sqft;
      pts = ppsf <= excellentPpsf ? weight
          : ppsf <= maxPpsf ? weight - ((ppsf - excellentPpsf) / (maxPpsf - excellentPpsf)) * weight
          : 0;
    }
    addFactor('pricePerSqft', pts, weight);
  }

  if (scoring.neighborhoodBonus) {
    const { weight, city: bonusCity, center, innerKm, outerKm } = scoring.neighborhoodBonus;
    let pts = 0;
    if (city === bonusCity) {
      const dist = haversineKm(listing.lat, listing.lng, center.lat, center.lng);
      pts = scoreThreePt(dist, innerKm, (innerKm + outerKm) / 2, outerKm, weight);
    }
    addFactor('neighborhoodBonus', pts, weight);
  }

  if (scoring.zipBonus) {
    const { weight, zips } = scoring.zipBonus;
    const pts = zips.includes(listing.zip) ? weight : 0;
    addFactor('zipBonus', pts, weight);
  }

  if (scoring.domBonus && listing.days_on_market != null) {
    const { weight } = scoring.domBonus;
    const dom = listing.days_on_market;
    let pts = 0;
    if (dom >= 120) {
      pts = weight;
    } else if (dom > 60) {
      pts = 4 + ((dom - 60) / 60) * (weight - 4);
    } else if (dom > 30) {
      pts = ((dom - 30) / 30) * 4;
    }
    addFactor('domBonus', pts, weight);
  }

  // DOM penalty — subtracted from positive total; not counted in maxPositive
  let rawPenalty = 0;
  if (scoring.domPenalty && listing.days_on_market != null) {
    const { weight } = scoring.domPenalty;
    const dom = listing.days_on_market;
    if (dom > 120) {
      rawPenalty = weight;
    } else if (dom > 60) {
      rawPenalty = clamp(((dom - 60) / 60) * (weight * 0.7), 0, weight * 0.7);
    } else if (dom > 30) {
      rawPenalty = clamp(((dom - 30) / 30) * (weight * 0.3), 0, weight * 0.3);
    }
    factors['domPenalty'] = { pts: rawPenalty, max: weight };
  }

  const total = maxPositive === 0
    ? 0
    : clamp(((rawPositive - rawPenalty) / maxPositive) * 100, 0, 100);

  return { total, factors };
}

export function scoreListing(listing: RedfinListing, locale: LocaleConfig): number {
  return scoreWithBreakdown(listing, locale).total;
}
