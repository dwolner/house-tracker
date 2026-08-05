import type { LocaleConfig } from './types.js';

// region_type 2 = zip — IDs are Redfin internal zip region IDs (38XXX pattern for SD)
// Kensington+Talmadge share 92116; Bay Park+Loma Portal share 92110
// South Park+Golden Hill+Burlingame+Grant Hill share 92102 with less-family-oriented pockets
// further east (Chollas View/Mount Hope) — can't split the Redfin *polling* region finer than
// zip, but the `neighborhoods` split below at least labels listings correctly by lng
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
    { name: 'Talmadge / Rolando',         region_id: '38115', region_type: 2 },
    { name: 'South Park / Golden Hill',  region_id: '38102', region_type: 2 },
  ],
  minBeds: 3,
  maxPrice: 2_500_000,
  allowedZips: ['92110', '92107', '92116', '92117', '92104', '92103', '92120', '92115', '92102'],
  filterByNeighborhood: true,
  // Single source of truth for neighborhood display — sidebar filter, card/email labels,
  // map boundaries, and chart colors are all derived from this (see locales/neighborhoods.ts).
  neighborhoods: [
    { zip: '92110', name: 'Bay Park / Loma Portal', color: '#4f8ef7' },
    { zip: '92107', name: 'Point Loma Heights', color: '#22c55e' },
    {
      zip: '92116', name: 'Kensington / Talmadge', color: '#a855f7',
      splits: [{ when: [{ field: 'lng', op: '<', value: -117.130 }], name: 'University Heights' }],
    },
    {
      zip: '92117', name: 'Clairemont Mesa', color: '#f97316',
      splits: [{
        when: [{ field: 'lat', op: '<', value: 32.815 }, { field: 'lng', op: '<', value: -117.190 }],
        name: 'Bay Ho',
      }],
    },
    { zip: '92104', name: 'North Park', color: '#06b6d4' },
    {
      zip: '92103', name: 'Hillcrest', color: '#eab308',
      splits: [{ when: [{ field: 'lat', op: '>=', value: 32.752 }], name: 'Mission Hills' }],
    },
    {
      zip: '92120', name: 'Allied Gardens', color: '#ec4899',
      // lng > -117.073: eastern elevation = Del Cerro; western flats = Allied Gardens
      splits: [{ when: [{ field: 'lng', op: '>', value: -117.073 }], name: 'Del Cerro' }],
    },
    { zip: '92115', name: 'Rolando / College Area', color: '#84cc16' },
    {
      zip: '92102', name: 'South Park / Golden Hill', color: '#f43f5e',
      // I-805 cuts through this ZIP — listing lng clusters cleanly on either side (gap from
      // -117.122 to -117.107, the freeway corridor itself). East of it is Chollas View/Mount
      // Hope/Broadway Heights, a different market than South Park/Golden Hill/Grant Hill/Burlingame.
      splits: [{ when: [{ field: 'lng', op: '>', value: -117.115 }], name: 'Chollas View / Mount Hope' }],
    },
  ],
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
    // weight reduced 18→12: SD is car-dominant; walkability shouldn't outweigh space
    walkability: { weight: 12 },
    price: {
      weight: 14,
      // SD SFR market: $1.2M is a deal, $1.8M is normal, $2.5M is premium
      excellent: 1_200_000,
      good:      1_800_000,
      max:       2_500_000,
    },
    sqft: {
      weight: 18,
      // Baseline = current home (1,250sf) — no reward for failing to beat that.
      // 1,800+ is the target; full credit by 2,200.
      breakpoints: [
        { sqft: 0,       points: 0  },
        { sqft: 1_250,   points: 0  },
        { sqft: 1_500,   points: 6  },
        { sqft: 1_800,   points: 12 },
        { sqft: 2_200,   points: 18 },
        { sqft: 3_000,   points: 18 },
      ],
    },
    lot: {
      weight: 12,
      // SD urban lots run 5,000–7,500 sqft (0.11–0.17 ac); 0.25+ ac is a standout yard
      // defaultAcres: used for SFRs with missing lot data (assumes minimum urban lot)
      defaultAcres: 0.05, // unknown lot assumed pessimistically (0pts) rather than rewarded
      breakpoints: [
        { acres: 0,    points: 0  },
        { acres: 0.05, points: 0  }, // < 2,200 sqft = essentially no yard
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
        { minBeds: 5, points: 10 },
        { minBeds: 4, points: 9  }, // 4-bed target
        { minBeds: 3, points: 2  }, // have 3bd, want 4bd — strong preference
      ],
    },
    baths: {
      weight: 6,
      steps: [
        { minBaths: 3,   points: 6 },
        { minBaths: 2.5, points: 4 },
        { minBaths: 2,   points: 2 },
      ],
    },
    pricePerSqft: {
      weight: 10,
      // SD turnkey SFR runs $900–1,200/sqft; below $850 is competitive
      excellentPpsf: 800,
      maxPpsf:       1_300,
    },
    domPenalty: { weight: 6 },
    yearBuiltPenalty: { weight: 10 },
    // 92115 = Rolando/College Area (SDSU-adjacent — student rental market, not ideal for a family forever home)
    zipPenalty: { weight: 15, zips: ['92115'] },
    multiUnitPenalty: { weight: 25 },
    flipPenalty: { weight: 15 },
    // weight: relisted at same/higher price; reducedWeight: relisted lower (seller conceded)
    relistingPenalty: { weight: 8, reducedWeight: 4 },
    bathBedRatioPenalty: { weight: 8, minBeds: 4, minBaths: 2.5 },
    // Only penalize homes that aren't even bigger than our current 1,250sf house
    sqftFloorPenalty: { weight: 10, minSqft: 1250 },
    yearBuiltBonus: { weight: 5, minYear: 2000, excellent: 2015 },
  },
};
// Positive weight denominator: 20+12+14+18+12+10+6+10 = 102 (yearBuiltBonus is additive, not in denominator)
// Penalties (not in denominator): zipPenalty=15, multiUnitPenalty=25, flipPenalty=15, bathBedRatioPenalty=8, sqftFloorPenalty=10, relistingPenalty=8
