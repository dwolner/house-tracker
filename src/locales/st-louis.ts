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
  maxPrice: 950_000,
  uipt: '1,3,4',
  scoring: {
    propertyType: {
      weight: 18,
      typeScores: {
        'single family residential': 18,
        'single family': 18,
        'townhouse': 5,
      },
    },
    // School district is the primary differentiator in the St. Louis market.
    // Ratings based on GreatSchools composite scores; all included cities are ≥ 6.
    schoolDistrict: {
      weight: 25,
      districtScores: {
        'Clayton School District':                25,
        'Ladue School District':                  22,
        'Kirkwood R-VII School District':         16,
        'Kirkwood School District':               16, // alternate name
        'Webster Groves School District':         16,
        'Lindbergh R-VIII School District':       14,
        'Lindbergh Schools':                      14, // alternate name
        'Parkway C-2 School District':            12,
        'Parkway School District':                12, // alternate name
        'Maplewood Richmond Heights School District': 8,
      },
      // Fallback city matching when school_district enrichment is unavailable.
      // Many USPS addresses show "Saint Louis" — trust district enrichment first.
      primaryCities: [
        'kirkwood', 'glendale',               // Kirkwood R-VII
        'webster groves', 'shrewsbury',        // Webster Groves SD
        'ladue',                               // Ladue SD
        'clayton',                             // Clayton SD
        'sunset hills', 'crestwood',           // Lindbergh
      ],
      secondaryCities: [
        'rock hill', 'des peres',             // also Kirkwood R-VII
        'maplewood', 'richmond heights',      // Maplewood RH SD
      ],
      secondaryCityPoints: 8,
      fallbackPoints: 5,
    },
    // STL suburbs are car-dependent; walkability matters less than in PA/CA
    walkability: { weight: 6 },
    // Market context (April 2026):
    //   Kirkwood/Webster: $400–600K median   Glendale: $500–700K
    //   Ladue: $900K–1.5M+                   Clayton: $600K–1M
    //   Maplewood/Crestwood: $300–450K
    price: {
      weight: 15,
      excellent:   450_000,
      good:        700_000,
      max:         950_000,
    },
    // Typical STL suburb SFR: 1,400–2,200 sqft; 2,500+ is standout
    sqft: {
      weight: 10,
      breakpoints: [
        { sqft: 0,     points: 0  },
        { sqft: 1_200, points: 0  },
        { sqft: 1_500, points: 3  },
        { sqft: 1_800, points: 6  },
        { sqft: 2_200, points: 9  },
        { sqft: 2_600, points: 10 },
      ],
    },
    // STL suburb lots: 6,000–12,000 sqft typical; 0.3+ acres is a standout yard
    lot: {
      weight: 10,
      breakpoints: [
        { acres: 0,    points: 0  },
        { acres: 0.10, points: 2  },
        { acres: 0.15, points: 5  },
        { acres: 0.20, points: 8  },
        { acres: 0.30, points: 10 },
        { acres: 999,  points: 10 },
      ],
    },
    beds: {
      weight: 6,
      steps: [
        { minBeds: 4, points: 6 },
        { minBeds: 3, points: 3 },
      ],
    },
    // STL SFR price/sqft: $200–350 is competitive; above $400 is premium
    pricePerSqft: {
      weight: 5,
      excellentPpsf: 200,
      maxPpsf:       400,
    },
    // Bonus for the core target zip codes (Kirkwood/Glendale and Webster Groves/Rock Hill)
    zipBonus: {
      weight: 8,
      zips: ['63122', '63119'],  // 63122=Kirkwood+Glendale, 63119=Webster Groves+Rock Hill+Shrewsbury
    },
    domPenalty: { weight: 10 },
  },
};
// Positive weight denominator: 18+25+6+15+10+10+6+5+8 = 103
