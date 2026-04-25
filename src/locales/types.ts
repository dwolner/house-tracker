export interface Station {
  name: string;
  lat: number;
  lng: number;
}

export interface RedfinRegion {
  name: string;
  region_id: string;
  region_type: number;
  useJsonApi?: boolean; // true for markets where MARIS or other MLS restricts the CSV download API
}

export interface PropertyTypeConfig {
  weight: number;
  typeScores: Record<string, number>; // lowercase type → raw pts (0..weight)
}

export interface SchoolDistrictConfig {
  weight: number;
  districtScores: Record<string, number>; // Census district name → raw pts (0..weight)
  primaryCities: string[];                // city (lowercase) → full weight
  secondaryCities: string[];
  secondaryCityPoints: number;
  fallbackPoints: number;                 // for unrecognized districts
}

export interface WalkabilityConfig {
  weight: number; // (walk_score / 100) * weight
}

export interface PriceConfig {
  weight: number;
  excellent: number;  // price ≤ this → full weight
  good: number;       // price at this → weight/2
  max: number;        // price ≥ this → 0
}

export interface SqftConfig {
  weight: number;
  // sorted ascending; linear interpolation between breakpoints
  breakpoints: { sqft: number; points: number }[];
}

export interface LotConfig {
  weight: number;
  breakpoints: { acres: number; points: number }[];
}

export interface TransitConfig {
  weight: number;
  stations: Station[];
  excellentKm: number; // ≤ this → full weight
  goodKm: number;      // at this → weight/2
  maxKm: number;       // ≥ this → 0
}

export interface BedsConfig {
  weight: number;
  // sorted descending by minBeds; first match wins
  steps: { minBeds: number; points: number }[];
}

export interface PricePerSqftConfig {
  weight: number;
  excellentPpsf: number;
  maxPpsf: number;
}

export interface NeighborhoodBonusConfig {
  weight: number;
  city: string; // lowercase city name
  center: { lat: number; lng: number };
  innerKm: number;
  outerKm: number;
}

export interface ZipBonusConfig {
  weight: number;
  zips: string[]; // ZIP codes that earn full bonus points
}

export interface DomPenaltyConfig {
  weight: number; // max penalty pts — ramp shape is fixed: full at 120+ days, proportional below
}

export interface ScoringConfig {
  propertyType?: PropertyTypeConfig;
  schoolDistrict?: SchoolDistrictConfig;
  walkability?: WalkabilityConfig;
  price?: PriceConfig;
  sqft?: SqftConfig;
  lot?: LotConfig;
  transit?: TransitConfig;
  beds?: BedsConfig;
  pricePerSqft?: PricePerSqftConfig;
  neighborhoodBonus?: NeighborhoodBonusConfig;
  zipBonus?: ZipBonusConfig;
  domPenalty?: DomPenaltyConfig;
}

export interface LocaleConfig {
  id: string;
  name: string;
  state: string;    // expected state abbreviation — listings from other states are dropped (Redfin region IDs are not globally unique)
  regions: RedfinRegion[];
  minBeds: number;
  maxPrice: number;
  scoring: ScoringConfig;
  disableNotifications?: boolean; // suppress email alerts for this locale (e.g. new locales not yet fully configured)
}
