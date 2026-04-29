import type { LocaleConfig } from './types.js';

// Region IDs verified against live data (redfin.com/city/{id}/PA/{name})
// region_type 6 = city, 2 = zip
export const mainLineLocale: LocaleConfig = {
  id: 'main-line',
  name: 'PA Main Line',
  state: 'PA',
  regions: [
    { name: 'Narberth/Penn Valley', region_id: '13565', region_type: 6 },
    { name: 'Ardmore',              region_id: '30811', region_type: 6 },
    { name: 'Bryn Mawr',           region_id: '21717', region_type: 6 },
    { name: 'Bala Cynwyd',         region_id: '36379', region_type: 6 },
    { name: 'Merion Station',      region_id: '36339', region_type: 6 },
    { name: 'Haverford',           region_id: '7344',  region_type: 2 },
    { name: 'Wynnewood',           region_id: '7388',  region_type: 2 },
    { name: 'Wayne',               region_id: '37906', region_type: 6 },
    { name: 'Berwyn',              region_id: '31134', region_type: 6 },
    { name: 'King of Prussia',     region_id: '7530',  region_type: 2 },
  ],
  minBeds: 3,
  maxPrice: 2_000_000,
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
    schoolDistrict: {
      weight: 20,
      districtScores: {
        'Lower Merion School District':        20,
        'Radnor Township School District':     16,
        'Tredyffrin-Easttown School District': 13,
        'Haverford Township School District':  10,
        'Upper Merion Area School District':    9,
        'Great Valley School District':         8,
      },
      primaryCities: [
        'narberth', 'wynnewood', 'ardmore', 'haverford', 'bryn mawr',
        'bala cynwyd', 'penn valley', 'merion station', 'gladwyne',
        'penn wynne', 'merion', 'cynwyd',
      ],
      secondaryCities: ['wayne', 'berwyn', 'devon', 'strafford'],
      secondaryCityPoints: 7,
      fallbackPoints: 3,
    },
    walkability: { weight: 12 },
    price: {
      weight: 12,
      excellent: 1_000_000,
      good:      1_500_000,
      max:       2_000_000,
    },
    sqft: {
      weight: 8,
      breakpoints: [
        { sqft: 0,     points: 0 },
        { sqft: 1_500, points: 0 },
        { sqft: 2_000, points: 4 },
        { sqft: 2_500, points: 8 }, // original code jumps to 8 at 2500+
      ],
    },
    lot: {
      weight: 12,
      breakpoints: [
        { acres: 0,   points: 0  },
        { acres: 0.1, points: 2  },
        { acres: 0.2, points: 6  },
        { acres: 0.4, points: 12 },
        { acres: 999, points: 12 },
      ],
    },
    transit: {
      weight: 8,
      stations: [
        { name: 'Ardmore',     lat: 40.0087, lng: -75.2966 },
        { name: 'Paoli',       lat: 40.0423, lng: -75.4852 },
        { name: 'Exton',       lat: 40.0284, lng: -75.6213 },
        { name: 'Downingtown', lat: 40.0065, lng: -75.7035 },
      ],
      excellentKm: 0.5,
      goodKm:      3,
      maxKm:       8,
    },
    beds: {
      weight: 4,
      steps: [
        { minBeds: 4, points: 4 },
        { minBeds: 3, points: 2 },
      ],
    },
    pricePerSqft: {
      weight: 4,
      excellentPpsf: 300,
      maxPpsf:       500,
    },
    neighborhoodBonus: {
      weight:  6,
      city:    'narberth',
      center:  { lat: 40.0066, lng: -75.2661 }, // SEPTA station proxy for town center
      innerKm: 0.4,
      outerKm: 1.2,
    },
    domPenalty: { weight: 6 },
  },
};
