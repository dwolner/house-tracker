import type { RedfinListing } from '../poller/redfin.js';
import type { LocaleConfig } from '../locales/types.js';

// Mortgage rate fed in by the poller at startup; falls back to a reasonable default.
let baseRate30yr = 0.069;
export function setBaseRate(rate: number): void { baseRate30yr = rate; }

export interface ScoreBreakdown {
  total: number;
  // Each value: { pts = raw points earned, max = weight for this factor }
  // domPenalty pts = amount subtracted (positive = penalty applied)
  factors: Record<string, { pts: number; max: number }>;
  rentUsed?: number;
  rentSource?: 'rentcast' | 'derived' | 'table';
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

export function scoreWithBreakdown(
  listing: RedfinListing,
  locale: LocaleConfig,
  rentResolution?: { rent: number; source: 'rentcast' | 'derived' },
): ScoreBreakdown {
  const { scoring } = locale;
  const city = listing.city.toLowerCase().trim();
  const propType = listing.property_type?.toLowerCase().trim() ?? '';
  const factors: Record<string, { pts: number; max: number }> = {};

  let rawPositive = 0;
  let maxPositive = 0;
  let rentUsed: number | undefined;
  let rentSource: 'rentcast' | 'derived' | 'table' | undefined;

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

  if (scoring.walkability && listing.walk_score != null) {
    const pts = (listing.walk_score / 100) * scoring.walkability.weight;
    addFactor('walkability', pts, scoring.walkability.weight);
  }

  if (scoring.price) {
    const { weight, excellent, good, max, expDecayAbove, expDecayK } = scoring.price;
    let pts: number;
    if (expDecayAbove !== undefined && expDecayK !== undefined && listing.price > expDecayAbove) {
      const range = max - expDecayAbove;
      pts = listing.price >= max ? 0 : weight * Math.exp(-expDecayK * (listing.price - expDecayAbove) / range);
    } else {
      pts = scoreThreePt(listing.price, excellent, good, max, weight);
    }
    addFactor('price', pts, weight);
  }

  if (scoring.sqft) {
    const cfg = scoring.sqft;
    if (listing.sqft != null) {
      const pts = interpolateBp(listing.sqft, cfg.breakpoints.map(b => ({ floor: b.sqft, points: b.points })));
      addFactor('sqft', pts, cfg.weight);
    }
  }

  if (scoring.lot) {
    const cfg = scoring.lot;
    if (listing.lot_sqft != null) {
      const pts = interpolateBp(listing.lot_sqft / 43_560, cfg.breakpoints.map(b => ({ floor: b.acres, points: b.points })));
      addFactor('lot', pts, cfg.weight);
    }
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

  if (scoring.pricePerSqft && listing.sqft != null && listing.sqft > 0) {
    const { weight, excellentPpsf, maxPpsf } = scoring.pricePerSqft;
    const ppsf = listing.price / listing.sqft;
    const pts = ppsf <= excellentPpsf ? weight
        : ppsf <= maxPpsf ? weight - ((ppsf - excellentPpsf) / (maxPpsf - excellentPpsf)) * weight
        : 0;
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
    const mid = weight * 0.5; // 60-day midpoint: half of max bonus
    let pts = 0;
    if (dom >= 120) {
      pts = weight;
    } else if (dom >= 60) {
      pts = mid + ((dom - 60) / 60) * (weight - mid);
    } else if (dom > 30) {
      pts = ((dom - 30) / 30) * mid;
    }
    addFactor('domBonus', pts, weight);
  }

  if (scoring.investmentScore && locale.investmentConfig) {
    const ic = locale.investmentConfig;
    const sc = scoring.investmentScore;

    const resolvedCity = ic.zipToCity?.[listing.zip] ?? city;
    const bedKey = Math.min(Math.max(listing.beds, 2), 4) as 2 | 3 | 4;
    const rentMap = ic.rentByCity[resolvedCity];
    const rent = rentResolution?.rent ?? rentMap?.[bedKey] ?? rentMap?.[3] ?? 0;
    rentUsed = rent || undefined;
    rentSource = rent > 0 ? (rentResolution?.source ?? 'table') : undefined;

    if (rent > 0) {
      const yearBuilt = listing.year_built ?? 1979;
      const maintenanceRate =
        yearBuilt <= 1959 ? 0.13 : yearBuilt <= 1979 ? 0.10 :
        yearBuilt <= 1999 ? 0.07 : 0.05;
      const taxRate = ic.taxRateByCity?.[resolvedCity] ?? ic.taxRateFallback ?? 0.018;

      const loanAmount = listing.price * (1 - ic.downPaymentPct);
      const monthlyRate = (baseRate30yr + ic.investmentRateAdder) / 12;
      const mortgage = loanAmount * (monthlyRate * (1 + monthlyRate) ** 360) / ((1 + monthlyRate) ** 360 - 1);

      const insuranceAnnual = listing.price * 0.005;
      const netCashFlow =
        rent
        - mortgage
        - rent * ic.vacancyRate
        - rent * maintenanceRate
        - insuranceAnnual / 12
        - (listing.price * taxRate) / 12;

      const noi =
        rent * 12 * (1 - ic.vacancyRate - maintenanceRate)
        - insuranceAnnual
        - listing.price * taxRate;
      const capRate = noi / listing.price;

      const sqftForReno = listing.sqft ?? 1400;
      const renoTier = ic.renoTiers.find(t => yearBuilt <= t.maxYearBuilt);
      const reno = renoTier
        ? Math.max(renoTier.minCost, Math.round(renoTier.costPerSqft * sqftForReno))
        : 8_000;
      const totalCashIn = listing.price * ic.downPaymentPct + reno;
      const coc = totalCashIn > 0 ? (netCashFlow * 12) / totalCashIn : 0;

      // Cash flow: 40% of weight — negative → 0, scales to cashFlowExcellent
      const cfMax = sc.weight * 0.4;
      const cfPts = netCashFlow <= 0 ? 0
        : netCashFlow >= sc.cashFlowExcellent ? cfMax
        : (netCashFlow / sc.cashFlowExcellent) * cfMax;

      // Cap rate: 35% of weight — piecewise between good and excellent
      const crMax = sc.weight * 0.35;
      const crPts = capRate <= 0 ? 0
        : capRate >= sc.capRateExcellent ? crMax
        : capRate >= sc.capRateGood
          ? crMax * 0.5 + ((capRate - sc.capRateGood) / (sc.capRateExcellent - sc.capRateGood)) * crMax * 0.5
          : (capRate / sc.capRateGood) * crMax * 0.5;

      // CoC: 25% of weight
      const cocMax = sc.weight * 0.25;
      const cocPts = coc <= 0 ? 0
        : coc >= sc.cocExcellent ? cocMax
        : coc >= sc.cocGood
          ? cocMax * 0.5 + ((coc - sc.cocGood) / (sc.cocExcellent - sc.cocGood)) * cocMax * 0.5
          : (coc / sc.cocGood) * cocMax * 0.5;

      addFactor('investmentScore', cfPts + crPts + cocPts, sc.weight);
    }
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

  return { total, factors, rentUsed, rentSource };
}

export function scoreListing(listing: RedfinListing, locale: LocaleConfig): number {
  return scoreWithBreakdown(listing, locale).total;
}
