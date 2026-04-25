import type { LocaleConfig } from './types.js';

// Region IDs verified from redfin.com/city/{id}/MO/{name} URLs (region_type 6 = city).
// MARIS MLS restricts Redfin's CSV download API for all of St. Louis County —
// useJsonApi: true routes to the /stingray/api/gis JSON endpoint instead.
//
// School district GreatSchools ratings (approximate, April 2026):
//   Clayton SD        ~9-10  — top-rated district in all of Missouri
//   Ladue SD          ~8-9   — Ladue city
//   Kirkwood R-VII    ~7-8   — Kirkwood, Glendale, Des Peres, Rock Hill
//   Webster Groves SD ~7-8   — Webster Groves, Shrewsbury
//   Lindbergh R-VIII  ~7-8   — Sunset Hills, Crestwood
//   Parkway C-2       ~6-7   — large west-county district
//   Maplewood RH SD   ~5-6   — Maplewood, Richmond Heights (improving)
//
// Note: USPS city for many STL-area addresses is "Saint Louis" not the
// municipality — school_district enrichment (via geocoding) is the primary
// district signal; primaryCities / secondaryCities serve as fallback only.
export const stLouisLocale: LocaleConfig = {
  id: 'st-louis',
  name: 'St. Louis Suburbs',
  state: 'MO',
  disableNotifications: true, // not wired into UI/users yet
  regions: [
    { name: 'Kirkwood',          region_id: '9905',  region_type: 6, useJsonApi: true },
    { name: 'Glendale',          region_id: '6983',  region_type: 6, useJsonApi: true },
    { name: 'Webster Groves',    region_id: '19712', region_type: 6, useJsonApi: true },
    { name: 'Rock Hill',         region_id: '16089', region_type: 6, useJsonApi: true },
    { name: 'Maplewood',         region_id: '11693', region_type: 6, useJsonApi: true },
    { name: 'Richmond Heights',  region_id: '15872', region_type: 6, useJsonApi: true },
    { name: 'Ladue',             region_id: '10092', region_type: 6, useJsonApi: true },
    { name: 'Clayton',           region_id: '3780',  region_type: 6, useJsonApi: true },
    { name: 'Shrewsbury',        region_id: '17338', region_type: 6, useJsonApi: true },
    { name: 'Des Peres',         region_id: '4968',  region_type: 6, useJsonApi: true },
    { name: 'Sunset Hills',      region_id: '18323', region_type: 6, useJsonApi: true },
    { name: 'Crestwood',         region_id: '4481',  region_type: 6, useJsonApi: true },
  ],
  minBeds: 3,
  maxPrice: 500_000,
  uipt: '1,3,4',
  scoring: {
    propertyType: {
      weight: 18,
      typeScores: {
        'single family residential': 18,
        'single family':             18,
        'multi-family':              18,  // duplex/triplex — on par with SFR for cash flow
        'townhouse':                  5,
      },
    },
    // School district still matters for appreciation and exit strategy — just not dominant.
    schoolDistrict: {
      weight: 12,
      districtScores: {
        'Clayton School District':                        12,
        'Ladue School District':                          10,
        'Kirkwood R-VII School District':                  8,
        'Kirkwood School District':                        8,
        'Webster Groves School District':                  8,
        'Lindbergh R-VIII School District':                7,
        'Lindbergh Schools':                               7,
        'Parkway C-2 School District':                     6,
        'Parkway School District':                         6,
        'Maplewood Richmond Heights School District':      4,
      },
      primaryCities: [
        'kirkwood', 'glendale',
        'webster groves', 'shrewsbury',
        'ladue',
        'clayton',
        'sunset hills', 'crestwood',
      ],
      secondaryCities: ['rock hill', 'des peres', 'maplewood', 'richmond heights'],
      secondaryCityPoints: 4,
      fallbackPoints: 2,
    },
    // Renters weight walkability more than owners — lower vacancy.
    walkability: { weight: 10 },
    // Investment price ceiling: $250K hard max.
    price: {
      weight:        20,
      excellent:    225_000,  // ≤$225K → full 20 pts
      good:         225_000,  // unused (expDecay takes over above excellent)
      max:          500_000,  // $500K → ~0 pts
      expDecayAbove: 225_000,
      expDecayK:     5,       // rapid falloff: $300K≈5pts, $400K≈1pt, $500K≈0pts
    },
    sqft: {
      weight: 8,
      breakpoints: [
        { sqft: 0,     points: 0 },
        { sqft: 800,   points: 2 },   // too small for reliable rent
        { sqft: 1_000, points: 5 },   // rentable 2BR/3BR
        { sqft: 1_200, points: 7 },   // investment sweet spot starts
        { sqft: 1_500, points: 8 },   // solid 3BR rental size
        { sqft: 9_999, points: 8 },
      ],
    },
    // Lot size matters less for cash flow than for a primary residence.
    lot: {
      weight: 5,
      breakpoints: [
        { acres: 0,    points: 0 },
        { acres: 0.10, points: 1 },
        { acres: 0.15, points: 3 },
        { acres: 0.20, points: 4 },
        { acres: 0.30, points: 5 },
        { acres: 999,  points: 5 },
      ],
    },
    beds: {
      weight: 8,
      steps: [
        { minBeds: 4, points: 8 },
        { minBeds: 3, points: 7 },  // 3BR is the investment sweet spot
        { minBeds: 2, points: 3 },
      ],
    },
    // Price/sqft is the single best proxy for below-market deals in STL.
    pricePerSqft: {
      weight: 15,
      excellentPpsf: 140,  // STL suburbs realistically run $140-200/sqft for investment
      maxPpsf:       220,
    },
    // zipBonus removed — premium zips are the wrong signal for investment.
    // DOM bonus: high DOM signals motivated seller and negotiation room.
    domBonus: { weight: 8 },
  },
  investmentConfig: {
    rentByCity: {
      'kirkwood':         { 2: 1100, 3: 1400, 4: 1700 },
      'glendale':         { 2: 1100, 3: 1400, 4: 1700 },
      'des peres':        { 2: 1100, 3: 1400, 4: 1700 },
      'webster groves':   { 2: 1050, 3: 1300, 4: 1600 },
      'rock hill':        { 2: 1050, 3: 1300, 4: 1600 },
      'shrewsbury':       { 2: 1050, 3: 1300, 4: 1600 },
      'maplewood':        { 2:  950, 3: 1150, 4: 1400 },
      'richmond heights': { 2:  950, 3: 1150, 4: 1400 },
      'brentwood':        { 2: 1000, 3: 1250, 4: 1500 },
      'crestwood':        { 2: 1000, 3: 1250, 4: 1500 },
      'sunset hills':     { 2: 1000, 3: 1250, 4: 1500 },
    },
    downPaymentPct: 0.25,
    baseRate30yr: 0.069,           // April 2026 — update when rates shift
    investmentRateAdder: 0.005,
    vacancyRate: 0.08,
    maintenanceRate: 0.08,
    insuranceMonthly: 125,
    propertyTaxAnnualRate: 0.018,  // MO: assessed @ 19% of FMV × ~9.5% county millage
    renoTiers: [
      { maxYearBuilt: 1959, cost: 40_000 },  // full light rehab: plumbing, electrical, kitchen/bath
      { maxYearBuilt: 1979, cost: 25_000 },  // kitchen/bath refresh, paint, flooring
      { maxYearBuilt: 1999, cost: 15_000 },  // cosmetic + some mechanical updates
      { maxYearBuilt: 9999, cost:  8_000 },  // paint, fixtures, carpet
    ],
    refinanceLtv: 0.75,
  },
};
// Positive weight denominator: 18+12+10+20+8+5+8+15+8 = 104
