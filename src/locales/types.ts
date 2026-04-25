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
  excellent: number;   // price ≤ this → full weight
  good: number;        // price at this → weight/2 (unused when expDecayAbove is set)
  max: number;         // price ≥ this → 0
  expDecayAbove?: number; // when set, use exponential decay above this price instead of linear
  expDecayK?: number;     // steepness of exponential decay (higher = faster drop)
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

export interface DomBonusConfig {
  weight: number; // max bonus pts — ramp: 0 at 0–30d, 0→weight/2 at 30–60d, weight/2→weight at 60–120d, weight at 120d+
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
  domBonus?: DomBonusConfig;
}

export interface RenovationTier {
  maxYearBuilt: number;  // properties built up to (and including) this year fall in this tier
  cost: number;          // estimated light rehab cost in dollars
}

export interface InvestmentConfig {
  // Monthly rent estimates: city (lowercase) → bed count → $/month
  rentByCity: Record<string, Record<number, number>>;

  // Mortgage assumptions
  downPaymentPct: number;          // e.g. 0.25
  baseRate30yr: number;            // current 30yr conforming rate — update when market moves
  investmentRateAdder: number;     // premium over 30yr for investment loans, e.g. 0.005

  // Monthly expense ratios (applied to gross rent or purchase price)
  vacancyRate: number;             // fraction of gross rent, e.g. 0.08
  maintenanceRate: number;         // fraction of gross rent, e.g. 0.08
  insuranceMonthly: number;        // flat $/month
  propertyTaxAnnualRate: number;   // annual rate applied to purchase price (MO: ~0.018)

  // Renovation estimates by year_built — matched by first tier where year_built <= maxYearBuilt
  renoTiers: RenovationTier[];

  // BRRRR refinance assumption
  refinanceLtv: number;            // e.g. 0.75
}

export interface LocaleConfig {
  id: string;
  name: string;
  state: string;    // expected state abbreviation — listings from other states are dropped (Redfin region IDs are not globally unique)
  regions: RedfinRegion[];
  minBeds: number;
  maxPrice: number;
  uipt?: string;    // Redfin property types to include (e.g. '1,2,3'); defaults to '1,2,3' if absent
  scoring: ScoringConfig;
  disableNotifications?: boolean; // suppress email alerts for this locale (e.g. new locales not yet fully configured)
  investmentConfig?: InvestmentConfig;
}
