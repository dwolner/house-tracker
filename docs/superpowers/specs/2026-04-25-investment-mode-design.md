# Investment Mode — STL Locale

**Date:** 2026-04-25
**Status:** Approved — ready for implementation planning

## Problem

The STL locale scoring weights are tuned for primary-residence homebuying (school district dominant,
price ceiling at $950K, no multi-family, DOM treated as a negative signal). The user's next use
case is buy-and-hold / light BRRRR investment in St. Louis County suburbs. The scoring needs to
reflect investment priorities and each listing card needs projected cash flow and BRRRR potential.

## Strategy Context

- **Goal:** Buy-and-hold rental / light BRRRR, retirement-focused (appreciation + cash flow mix)
- **Price ceiling:** $250K
- **Target neighborhoods:** Kirkwood, Glendale, Webster Groves, Rock Hill, Maplewood, Richmond
  Heights, Brentwood, Des Peres, Shrewsbury, Crestwood, Sunset Hills — St. Louis County only
- **Property types:** SFR or small multi-family (duplex/triplex); no condos
- **School quality:** GreatSchools 6+ (still relevant for appreciation and exit strategy)
- **Condition:** Light rehab or turnkey
- **Management:** Self-managed initially
- **Loan:** Investment property loan (760 credit, ~0.5% above 30yr conforming rate, 25% down)

## Non-Goals

- City of St. Louis properties (county only — filter already enforced by region selection)
- Section 8 properties (no tooling change needed; this is a manual call at showing time)
- New locale or separate view — all changes go into the existing STL locale
- Auth / user system (out of scope here; covered by personalized scoring spec)

---

## Changes

### 1. Scoring weights — `src/locales/st-louis.ts`

`maxPrice` changes from `950_000` → `250_000` (also tightens Redfin poller filter).

| Factor | Current weight | Investment weight | Notes |
|---|---|---|---|
| `price` | 15, excellent $450K | **20**, excellent $180K, good $220K, max $250K | Lower = better cash flow |
| `pricePerSqft` | 5, excellent $200, max $400 | **15**, excellent $120, max $220 | Best proxy for below-market deals |
| `propertyType` | SFR=18, townhouse=5 | SFR=18, **multi-family=18**, townhouse=5 | Duplex/triplex competitive on cash flow |
| `schoolDistrict` | **25** | **12** | Matters for appreciation/exit; no longer dominant |
| `walkability` | 6 | **10** | Renters weight this; lower vacancy |
| `beds` | 6 | **8** | More beds → higher rent |
| `sqft` | 10 | **8** | Slight drop; size matters less than price/value |
| `lot` | 10 | **5** | Irrelevant to cash flow |
| `zipBonus` | weight 8, zips 63122/63119 | **removed** | Wrong signal — want overlooked areas |
| `domPenalty` | subtracts up to 10 | **flipped to domBonus** | High DOM = motivated seller |

**DOM bonus shape:** DOM 0–30 days → 0 pts. DOM 30–60 → ramp from 0 to 4 pts. DOM 60–120 →
ramp from 4 to 8 pts. DOM 120+ → 8 pts (full bonus).

**New `ScoringConfig` field:** `domBonus?: { weight: number }` — when present replaces `domPenalty`.
Bonus points are additive (counted in `maxPositive` and `rawPositive`), not a penalty subtraction.

**Positive weight denominator (new):** 20+12+10+18+8+5+8+8+15 = 104
_(price + schoolDistrict + walkability + propertyType + beds + lot + sqft + domBonus + pricePerSqft)_

### 2. Poller — `src/poller/redfin.ts`

Add `4` to the `uipt` parameter (Redfin's multi-family type code) alongside existing `1,3`
(SFR, townhouse). Drop `2` (condo) — not a target property type for investment.

Updated: `uipt: '1,3,4'`

The `property_type` field from Redfin for multi-family typically comes through as
`"Multi-Family (2-4 Unit)"` or `"Duplex"`. The `typeScores` map in the locale config
needs both keys mapped to 18.

### 3. New type: `InvestmentConfig` — `src/locales/types.ts`

```typescript
export interface RenovationTier {
  maxYearBuilt: number;  // properties built up to this year fall in this tier
  cost: number;          // estimated light rehab cost ($)
}

export interface InvestmentConfig {
  // Monthly rent estimates: city (lowercase) → bed count → $/month
  rentByCity: Record<string, Record<number, number>>;

  // Mortgage assumptions
  downPaymentPct: number;          // e.g. 0.25
  baseRate30yr: number;            // current 30yr conforming rate — update when market moves
  investmentRateAdder: number;     // premium over 30yr for investment loans, e.g. 0.005

  // Monthly expense assumptions
  vacancyRate: number;             // fraction of gross rent, e.g. 0.08
  maintenanceRate: number;         // fraction of gross rent, e.g. 0.08
  insuranceMonthly: number;        // flat $/month, e.g. 125
  propertyTaxAnnualRate: number;   // annual rate applied to purchase price (MO: ~0.018)

  // Renovation estimates by year_built
  renoTiers: RenovationTier[];     // matched by first tier where year_built <= maxYearBuilt

  // BRRRR refinance assumption
  refinanceLtv: number;            // e.g. 0.75
}
```

Added to `LocaleConfig`: `investmentConfig?: InvestmentConfig`

### 4. STL `investmentConfig` values — `src/locales/st-louis.ts`

```typescript
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
  propertyTaxAnnualRate: 0.018,  // MO residential: assessed @ 19% of FMV × ~9.5% county rate
  renoTiers: [
    { maxYearBuilt: 1959, cost: 40_000 },  // full light rehab
    { maxYearBuilt: 1979, cost: 25_000 },  // kitchen/bath refresh
    { maxYearBuilt: 1999, cost: 15_000 },  // cosmetic + some updates
    { maxYearBuilt: 9999, cost:  8_000 },  // paint/fixtures/carpet
  ],
  refinanceLtv: 0.75,
}
```

### 5. New API endpoint — `src/web/routes.ts`

```
GET /api/locales/:id/comps
```

Queries sold listings (`status = '131'`) from the last 12 months where `sqft > 0` and
`sold_price > 0`, grouped by `city`, computes median `sold_price / sqft` per city.

Response shape:
```json
{
  "byCity": {
    "kirkwood":       { "medianPpsf": 192, "sampleSize": 18 },
    "maplewood":      { "medianPpsf": 151, "sampleSize": 11 }
  }
}
```

Cities with fewer than 3 sold comps are omitted from the response. The client treats a missing
city as "no ARV data available" and hides the BRRRR row for those listings.

### 6. Client-side upside computation — `src/web/public/app.js`

On page load, fetch `/api/locales/st-louis/comps` once. Hold result in a module-level variable.

For each listing, compute:

```
// Rent — clamp beds to [min, max] of available keys in the city's rent table
const availableBeds = Object.keys(investmentConfig.rentByCity[city] ?? {}).map(Number).sort()
const clampedBeds   = availableBeds.length
  ? Math.max(availableBeds[0], Math.min(availableBeds[availableBeds.length - 1], beds))
  : 3
rent = investmentConfig.rentByCity[city]?.[clampedBeds] ?? 0

// Mortgage (P&I, 30yr)
loanAmount  = price × (1 − downPaymentPct)
monthlyRate = (baseRate30yr + investmentRateAdder) / 12
mortgage    = loanAmount × (monthlyRate × (1+monthlyRate)^360)
                         / ((1+monthlyRate)^360 − 1)

// Monthly expenses
vacancy     = rent × vacancyRate
maintenance = rent × maintenanceRate
insurance   = insuranceMonthly
taxes       = price × propertyTaxAnnualRate / 12

// Net cash flow
netCashFlow = rent − mortgage − vacancy − maintenance − insurance − taxes

// Cash-on-cash return (annualised)
renoEstimate = renoTiers.find(t => (yearBuilt ?? 9999) <= t.maxYearBuilt)?.cost ?? 8000
totalCashIn  = price × downPaymentPct + renoEstimate
coc          = (netCashFlow × 12) / totalCashIn

// BRRRR (only when comps exist and sqft is known)
if (comps[city] && sqft) {
  arv           = comps[city].medianPpsf × sqft
  forcedEquity  = arv − price − renoEstimate
  refinanceAmt  = arv × refinanceLtv
  originalLoan  = price × (1 − downPaymentPct)
  cashBack      = refinanceAmt − originalLoan
  isFullBrrrr   = cashBack >= totalCashIn
}
```

### 7. Listing card UI additions — `src/web/public/app.js` + `style.css`

Two new display rows on each card, always rendered when `investmentConfig` is present:

**Row 1 — Cash flow summary (always visible):**
```
Cash flow  +$247/mo   CoC 6.2%
```
Color: green if `netCashFlow >= 0`, red if negative.

**Row 2 — BRRRR summary (only when comps exist for city and sqft is non-null):**
```
▸ BRRRR   ARV $218K · Reno ~$25K · Forced equity $43K · Refi pull $31K
```
Clicking expands to full detail:
```
After-repair value    $218,000   (18 comps in Kirkwood @ $192/sqft)
Reno estimate         ~$25,000   (built 1972)
Forced equity         $43,000
Refi @ 75% LTV        $163,500
Original loan         $132,000
Cash back             $31,500
Total cash in         $57,000    (25% down + reno)
```
If `cashBack >= totalCashIn`: badge **Full BRRRR** in green next to the summary line.

---

## Files Changed

| File | Change |
|---|---|
| `src/locales/types.ts` | Add `RenovationTier`, `InvestmentConfig` interfaces; add `domBonus` to `ScoringConfig`; add `investmentConfig?` to `LocaleConfig` |
| `src/locales/st-louis.ts` | Update scoring weights, `maxPrice`, add multi-family type scores, remove `zipBonus`, flip `domPenalty` → `domBonus`, add `investmentConfig` block |
| `src/scoring/index.ts` | Handle `domBonus` as additive factor; remove `domPenalty` subtraction path when `domBonus` is configured |
| `src/poller/redfin.ts` | Update `uipt` from `'1,2,3'` → `'1,3,4'` |
| `src/web/routes.ts` | Add `GET /api/locales/:id/comps` endpoint |
| `src/web/public/app.js` | Fetch comps on load; compute cash flow + BRRRR per listing; render investment rows on cards |
| `src/web/public/style.css` | Styles for cash flow row, BRRRR row, expand/collapse, Full BRRRR badge |

---

## Open Questions

None — all design decisions resolved.
