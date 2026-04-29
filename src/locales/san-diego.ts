import type { LocaleConfig } from './types.js';

// region_type 2 = zip — IDs are Redfin internal zip region IDs (38XXX pattern for SD)
// Kensington+Talmadge share 92116; Bay Park+Loma Portal share 92110
export const sanDiegoLocale: LocaleConfig = {
  id: 'san-diego',
  name: 'San Diego',
  state: 'CA',
  regions: [
    { name: 'Bay Park / Loma Portal',   region_id: '38110', region_type: 2 },
    { name: 'Point Loma Heights',        region_id: '38107', region_type: 2 },
    { name: 'Kensington / Talmadge',     region_id: '38116', region_type: 2 },
    { name: 'Bay Ho',                    region_id: '38117', region_type: 2 },
    { name: 'North Park',                region_id: '38104', region_type: 2 },
    { name: 'Mission Hills',             region_id: '38103', region_type: 2 },
    { name: 'Allied Gardens',            region_id: '38120', region_type: 2 },
  ],
  minBeds: 3,
  maxPrice: 2_500_000,
  scoring: {
    propertyType: {
      weight: 20,
      typeScores: {
        'single family residential': 20,
        'single family': 20,
        'townhouse': 5,
        'twin': 5,
        'semi-detached': 5,
      },
    },
    // schoolDistrict omitted — all 9 neighborhoods are SDUSD, no differentiation possible
    walkability: { weight: 18 }, // Bay Park / PLH are walkable urban neighborhoods
    price: {
      weight: 14,
      // SD SFR market: $1.2M is a deal, $1.8M is normal, $2.5M is premium
      excellent: 1_200_000,
      good:      1_800_000,
      max:       2_500_000,
    },
    sqft: {
      weight: 14,
      // Strong reward for 1,800+ sqft — the target home size
      breakpoints: [
        { sqft: 0,       points: 0  },
        { sqft: 1_200,   points: 0  },
        { sqft: 1_400,   points: 3  },
        { sqft: 1_600,   points: 7  },
        { sqft: 1_800,   points: 12 },
        { sqft: 2_200,   points: 14 },
        { sqft: 3_000,   points: 14 },
      ],
    },
    lot: {
      weight: 12,
      // SD urban lots run 5,000–7,500 sqft (0.11–0.17 ac); 0.25+ ac is a standout yard
      breakpoints: [
        { acres: 0,    points: 0  },
        { acres: 0.08, points: 2  },
        { acres: 0.11, points: 5  },
        { acres: 0.15, points: 9  },
        { acres: 0.20, points: 11 },
        { acres: 0.25, points: 12 },
        { acres: 999,  points: 12 },
      ],
    },
    // No transit factor — SD commuter rail (Coaster) is limited and car is dominant
    beds: {
      weight: 10,
      steps: [
        { minBeds: 4, points: 10 }, // 4-bed target
        { minBeds: 3, points: 5  },
      ],
    },
    pricePerSqft: {
      weight: 10,
      // SD turnkey SFR runs $900–1,200/sqft; below $850 is competitive
      excellentPpsf: 800,
      maxPpsf:       1_300,
    },
    domPenalty: { weight: 6 },
  },
};
// Positive weight denominator: 20+18+14+14+12+10+10 = 98
