# Investment Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Retune the STL locale for buy-and-hold investment property with per-listing cash flow and BRRRR upside analysis.

**Architecture:** Investment scoring weights live in the existing locale config; a new optional `investmentConfig` block adds rent/financial assumptions. A new `/api/locales/:id/comps` endpoint exposes median sold $/sqft by city from existing sold data. The client fetches this once and computes cash flow + BRRRR entirely in the browser.

**Tech Stack:** TypeScript, better-sqlite3, Fastify, vanilla JS frontend. Build: `pnpm build` (tsc). Dev: `pnpm dev` (tsx watch).

---

### Task 1: Make `uipt` configurable per locale

The STL locale needs `uipt: '1,3,4'` (SFR + townhouse + multi-family) instead of the global `'1,2,3'`. There are two internal fetch functions (CSV and JSON paths) and two exported wrappers for each — all need threading.

**Files:**
- Modify: `src/locales/types.ts`
- Modify: `src/poller/redfin.ts`
- Modify: `src/locales/st-louis.ts`
- Modify: `src/poller/index.ts`

- [ ] **Step 1: Add `uipt` to `LocaleConfig` in `src/locales/types.ts`**

Add one line to the `LocaleConfig` interface (after the `maxPrice` line):

```typescript
export interface LocaleConfig {
  id: string;
  name: string;
  state: string;
  regions: RedfinRegion[];
  minBeds: number;
  maxPrice: number;
  uipt?: string;          // ← add this line; defaults to '1,2,3' if absent
  scoring: ScoringConfig;
  disableNotifications?: boolean;
}
```

- [ ] **Step 2: Thread `uipt` through both internal fetch functions in `src/poller/redfin.ts`**

`fetchListingsByStatus` (CSV path, line ~69) — add `uipt` param and use it:

```typescript
async function fetchListingsByStatus(
  region_id: string,
  region_type: number,
  status: string,
  minBeds: number,
  maxPrice: number,
  uipt = '1,2,3',          // ← add with default
): Promise<RedfinListing[]> {
  const params = new URLSearchParams({
    al: '1',
    region_id,
    region_type: String(region_type),
    uipt,                   // ← use param instead of hardcoded '1,2,3'
    status,
    num_beds: String(minBeds),
    max_price: String(maxPrice),
    num_homes: '350',
    v: '8',
  });
```

`fetchListingsByStatusJson` (JSON path, line ~265) — same change:

```typescript
async function fetchListingsByStatusJson(
  region_id: string,
  region_type: number,
  status: string,
  minBeds: number,
  maxPrice: number,
  uipt = '1,2,3',          // ← add with default
): Promise<RedfinListing[]> {
  const params = new URLSearchParams({
    al: '1',
    region_id,
    region_type: String(region_type),
    uipt,                   // ← use param
    status,
    num_beds: String(minBeds),
    max_price: String(maxPrice),
    num_homes: '350',
    v: '8',
  });
```

- [ ] **Step 3: Thread `uipt` through the four exported functions in `src/poller/redfin.ts`**

```typescript
export async function fetchRecentlySold(
  region_id: string,
  region_type: number,
  minBeds: number,
  maxPrice: number,
  uipt = '1,2,3',
): Promise<RedfinListing[]> {
  return fetchListingsByStatus(region_id, region_type, '131', minBeds, maxPrice, uipt);
}

export async function fetchRegionListings(
  region_id: string,
  region_type: number,
  minBeds: number,
  maxPrice: number,
  uipt = '1,2,3',
): Promise<RedfinListing[]> {
  const [active, comingSoon, pending] = await Promise.all([
    fetchListingsByStatus(region_id, region_type, '9',   minBeds, maxPrice, uipt),
    fetchListingsByStatus(region_id, region_type, '1',   minBeds, maxPrice, uipt),
    fetchListingsByStatus(region_id, region_type, '130', minBeds, maxPrice, uipt),
  ]);
  const seen = new Map<string, RedfinListing>();
  for (const listing of [...comingSoon, ...pending, ...active]) {
    seen.set(listing.id, listing);
  }
  return [...seen.values()];
}

export async function fetchRecentlySoldJson(
  region_id: string,
  region_type: number,
  minBeds: number,
  maxPrice: number,
  uipt = '1,2,3',
): Promise<RedfinListing[]> {
  return fetchListingsByStatusJson(region_id, region_type, '131', minBeds, maxPrice, uipt);
}

export async function fetchRegionListingsJson(
  region_id: string,
  region_type: number,
  minBeds: number,
  maxPrice: number,
  uipt = '1,2,3',
): Promise<RedfinListing[]> {
  const [active, comingSoon, pending] = await Promise.all([
    fetchListingsByStatusJson(region_id, region_type, '9',   minBeds, maxPrice, uipt),
    fetchListingsByStatusJson(region_id, region_type, '1',   minBeds, maxPrice, uipt),
    fetchListingsByStatusJson(region_id, region_type, '130', minBeds, maxPrice, uipt),
  ]);
  const seen = new Map<string, RedfinListing>();
  for (const listing of [...comingSoon, ...pending, ...active]) {
    seen.set(listing.id, listing);
  }
  return [...seen.values()];
}
```

- [ ] **Step 4: Pass `locale.uipt` at the four call sites in `src/poller/index.ts`**

Lines 17–19 (active listings):
```typescript
const listings = await (region.useJsonApi
  ? fetchRegionListingsJson(region.region_id, region.region_type, locale.minBeds, locale.maxPrice, locale.uipt ?? '1,2,3')
  : fetchRegionListings(region.region_id, region.region_type, locale.minBeds, locale.maxPrice, locale.uipt ?? '1,2,3'));
```

Lines 49–51 (sold listings):
```typescript
const sold = await (region.useJsonApi
  ? fetchRecentlySoldJson(region.region_id, region.region_type, locale.minBeds, locale.maxPrice, locale.uipt ?? '1,2,3')
  : fetchRecentlySold(region.region_id, region.region_type, locale.minBeds, locale.maxPrice, locale.uipt ?? '1,2,3'));
```

- [ ] **Step 5: Add `uipt` to `st-louis.ts`**

Add one line inside `stLouisLocale`, after `maxPrice`:
```typescript
maxPrice: 950_000,   // ← this line will change in Task 3; leave it for now
uipt: '1,3,4',      // ← add: SFR (1), townhouse (3), multi-family (4)
```

Note: Redfin's JSON API maps `uiPropertyType: 4` → `'multi-family'` (already in `UI_PROPERTY_TYPE` map at line 189 of `redfin.ts`).

- [ ] **Step 6: Build and verify**

```bash
pnpm build
```

Expected: no TypeScript errors. If there are type errors in the poller call sites, confirm the function signatures in redfin.ts match what's being called.

- [ ] **Step 7: Commit**

```bash
git add src/locales/types.ts src/poller/redfin.ts src/locales/st-louis.ts src/poller/index.ts
git commit -m "feat: make uipt configurable per locale; set STL to 1,3,4 for multi-family"
```

---

### Task 2: Add `domBonus` scoring type and engine support

The STL locale will switch from `domPenalty` (subtracts for high DOM) to `domBonus` (adds for high DOM). The new config and engine logic is purely additive — other locales keeping `domPenalty` are unaffected.

**Files:**
- Modify: `src/locales/types.ts`
- Modify: `src/scoring/index.ts`

- [ ] **Step 1: Add `DomBonusConfig` interface and `domBonus` field to `ScoringConfig` in `src/locales/types.ts`**

After the existing `DomPenaltyConfig` interface (around line 83):

```typescript
export interface DomBonusConfig {
  weight: number; // max bonus pts — ramp: 0 at 0–30d, 0→4 at 30–60d, 4→weight at 60–120d, weight at 120d+
}
```

In `ScoringConfig`, add after `domPenalty?`:

```typescript
domBonus?: DomBonusConfig;
```

- [ ] **Step 2: Handle `domBonus` as an additive factor in `src/scoring/index.ts`**

After the `zipBonus` block (around line 148) and before the `domPenalty` block, add:

```typescript
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
```

The `addFactor` call adds `domBonus` to both `rawPositive` and `maxPositive`, so it's treated as a normal positive factor — not a penalty subtraction.

- [ ] **Step 3: Build and verify**

```bash
pnpm build
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/locales/types.ts src/scoring/index.ts
git commit -m "feat: add domBonus scoring factor for investment DOM signal"
```

---

### Task 3: Update STL scoring weights

Replace all primary-homebuying weights with investment-tuned values, remove `zipBonus`, swap `domPenalty` → `domBonus`, and lower `maxPrice` to $250K.

**Files:**
- Modify: `src/locales/st-louis.ts`

- [ ] **Step 1: Replace the entire `scoring` block and update `maxPrice` in `src/locales/st-louis.ts`**

Change `maxPrice: 950_000` → `maxPrice: 250_000`.

Replace the entire `scoring: { ... }` block with:

```typescript
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
    weight: 20,
    excellent:   180_000,
    good:        220_000,
    max:         250_000,
  },
  sqft: {
    weight: 8,
    breakpoints: [
      { sqft: 0,     points: 0 },
      { sqft: 1_000, points: 0 },
      { sqft: 1_200, points: 2 },
      { sqft: 1_500, points: 5 },
      { sqft: 1_800, points: 7 },
      { sqft: 2_200, points: 8 },
      { sqft: 9_999, points: 8 },
    ],
  },
  // Lot size matters less for cash flow than it does for a primary residence.
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
      { minBeds: 3, points: 5 },
      { minBeds: 2, points: 2 },
    ],
  },
  // Price/sqft is the single best proxy for below-market deals in STL.
  // STL investment market: $120/sqft is excellent, $220/sqft is market ceiling.
  pricePerSqft: {
    weight: 15,
    excellentPpsf: 120,
    maxPpsf:       220,
  },
  // zipBonus removed — premium zip codes are the wrong signal for investment.
  // DOM bonus: high DOM signals motivated seller and negotiation room.
  domBonus: { weight: 8 },
},
// Positive weight denominator: 18+12+10+20+8+5+8+15+8 = 104
```

- [ ] **Step 2: Build and verify**

```bash
pnpm build
```

Expected: no TypeScript errors. If you see a complaint about `domPenalty` still being referenced, confirm the old `domPenalty` line was removed from the scoring block.

- [ ] **Step 3: Commit**

```bash
git add src/locales/st-louis.ts
git commit -m "feat: update STL locale to investment scoring weights"
```

---

### Task 4: Add `InvestmentConfig` types and populate STL config

**Files:**
- Modify: `src/locales/types.ts`
- Modify: `src/locales/st-louis.ts`

- [ ] **Step 1: Add `RenovationTier` and `InvestmentConfig` interfaces to `src/locales/types.ts`**

Add after the `LocaleConfig` interface:

```typescript
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

  // Renovation estimates by year_built — sorted ascending by maxYearBuilt
  renoTiers: RenovationTier[];

  // BRRRR refinance assumption
  refinanceLtv: number;            // e.g. 0.75
}
```

Add `investmentConfig?: InvestmentConfig` to `LocaleConfig` (after `disableNotifications`):

```typescript
export interface LocaleConfig {
  id: string;
  name: string;
  state: string;
  regions: RedfinRegion[];
  minBeds: number;
  maxPrice: number;
  uipt?: string;
  scoring: ScoringConfig;
  disableNotifications?: boolean;
  investmentConfig?: InvestmentConfig;  // ← add this
}
```

- [ ] **Step 2: Add `investmentConfig` block to `src/locales/st-louis.ts`**

At the end of `stLouisLocale`, before the closing `}`:

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
  propertyTaxAnnualRate: 0.018,  // MO: assessed @ 19% of FMV × ~9.5% county millage
  renoTiers: [
    { maxYearBuilt: 1959, cost: 40_000 },  // full light rehab: plumbing, electrical, kitchen/bath
    { maxYearBuilt: 1979, cost: 25_000 },  // kitchen/bath refresh, paint, flooring
    { maxYearBuilt: 1999, cost: 15_000 },  // cosmetic + some mechanical updates
    { maxYearBuilt: 9999, cost:  8_000 },  // paint, fixtures, carpet
  ],
  refinanceLtv: 0.75,
},
```

- [ ] **Step 3: Build and verify**

```bash
pnpm build
```

Expected: no TypeScript errors. The type system will validate that `rentByCity`, `renoTiers`, etc. match the interfaces.

- [ ] **Step 4: Commit**

```bash
git add src/locales/types.ts src/locales/st-louis.ts
git commit -m "feat: add InvestmentConfig type and STL rent/financial assumptions"
```

---

### Task 5: Comps DB query and API endpoints

Two new endpoints: one returns the investment config (so the client can read it), the other returns median sold $/sqft by city from the last 12 months.

**Files:**
- Modify: `src/db/index.ts`
- Modify: `src/web/routes.ts`

- [ ] **Step 1: Add `getSoldComps` to `src/db/index.ts`**

Add at the end of the file (after `logPoll`):

```typescript
export function getSoldComps(localeId: string): Record<string, { medianPpsf: number; sampleSize: number }> {
  const cutoff = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  const rows = getDb()
    .prepare(`
      SELECT LOWER(city) as city,
             CAST(sold_price AS REAL) / sqft as ppsf
      FROM listings
      WHERE locale_id = ?
        AND status = '131'
        AND sold_price > 0
        AND sqft > 0
        AND sold_at >= ?
      ORDER BY city, ppsf
    `)
    .all(localeId, cutoff) as { city: string; ppsf: number }[];

  // Group by city and compute median
  const byCityPpsf = new Map<string, number[]>();
  for (const row of rows) {
    if (!byCityPpsf.has(row.city)) byCityPpsf.set(row.city, []);
    byCityPpsf.get(row.city)!.push(row.ppsf);
  }

  const result: Record<string, { medianPpsf: number; sampleSize: number }> = {};
  for (const [city, values] of byCityPpsf) {
    if (values.length < 3) continue; // need at least 3 sales to be meaningful
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    const median = sorted.length % 2 === 0
      ? (sorted[mid - 1] + sorted[mid]) / 2
      : sorted[mid];
    result[city] = { medianPpsf: Math.round(median), sampleSize: values.length };
  }
  return result;
}
```

- [ ] **Step 2: Add two new routes in `src/web/routes.ts`**

First, add `getSoldComps` to the import at line 2:

```typescript
import { getDb, toggleStar, getOutcomesData, getSoldComps } from '../db/index.js';
```

Add a `LOCALES` import after the existing import:

```typescript
import { LOCALES } from '../locales/index.js';
```

Then add two new routes before the closing `}` of `registerRoutes`:

```typescript
// Investment config for a locale — returns {} if locale has no investmentConfig
app.get('/api/locales/:id/investment', (req) => {
  const { id } = req.params as { id: string };
  const locale = LOCALES[id];
  if (!locale?.investmentConfig) return {};
  return { investmentConfig: locale.investmentConfig };
});

// Median sold $/sqft by city for the last 12 months (min 3 sales per city)
app.get('/api/locales/:id/comps', (req) => {
  const { id } = req.params as { id: string };
  return { byCity: getSoldComps(id) };
});
```

- [ ] **Step 3: Build and verify**

```bash
pnpm build
```

Expected: no errors.

- [ ] **Step 4: Start the server and smoke-test the endpoints**

```bash
pnpm dev
```

In a second terminal:

```bash
curl http://localhost:3000/api/locales/st-louis/investment | head -c 200
curl http://localhost:3000/api/locales/st-louis/comps
```

First call should return a JSON object with `investmentConfig.downPaymentPct` etc.  
Second call returns `{"byCity":{}}` if no sold data yet (that's fine — comps populate over time as listings go sold).

- [ ] **Step 5: Commit**

```bash
git add src/db/index.ts src/web/routes.ts
git commit -m "feat: add /api/locales/:id/investment and /api/locales/:id/comps endpoints"
```

---

### Task 6: Client-side upside computation and card UI

Fetch investment config + comps on page load (STL only), compute cash flow + BRRRR per listing, render two new rows on each STL card.

**Files:**
- Modify: `src/web/public/app.js`
- Modify: `src/web/public/style.css`

- [ ] **Step 1: Add state variables to `src/web/public/app.js`**

At the top of the file, after the existing `let` declarations (around line 11):

```javascript
let investmentConfig = null;
let stlComps = {};
```

- [ ] **Step 2: Add investment config + comps fetch helper**

After the existing `init()` and before `switchLocale()`, add:

```javascript
async function fetchInvestmentData(locale) {
  if (locale !== 'st-louis') {
    investmentConfig = null;
    stlComps = {};
    return;
  }
  const [invRes, compsRes] = await Promise.all([
    fetch('/api/locales/st-louis/investment').then(r => r.json()),
    fetch('/api/locales/st-louis/comps').then(r => r.json()),
  ]);
  investmentConfig = invRes.investmentConfig ?? null;
  stlComps = compsRes.byCity ?? {};
}
```

- [ ] **Step 3: Call `fetchInvestmentData` in `init()`**

In the `init()` function, after the `await Promise.all([...])` block that fetches listings/stats/etc., add:

```javascript
await fetchInvestmentData(activeLocale);
```

This must be called before `renderCards(localeListings)` so investment data is available when cards render.

- [ ] **Step 4: Call `fetchInvestmentData` in `switchLocale()`**

In `switchLocale(locale)`, after the `Promise.all` that fetches stats and before `renderCards(localeListings)`, add:

```javascript
await fetchInvestmentData(locale);
```

- [ ] **Step 5: Add `computeUpside(l)` function to `src/web/public/app.js`**

Add after the `fmtAcres` function:

```javascript
function computeUpside(l) {
  if (!investmentConfig || l.locale_id !== 'st-louis') return null;
  const cfg = investmentConfig;

  // Rent lookup — clamp beds to available keys in the city's rent table
  const city = (l.city ?? '').toLowerCase().trim();
  const cityRents = cfg.rentByCity[city];
  if (!cityRents) return null;
  const availBeds = Object.keys(cityRents).map(Number).sort((a, b) => a - b);
  const clampedBeds = Math.max(availBeds[0], Math.min(availBeds[availBeds.length - 1], l.beds ?? 3));
  const rent = cityRents[clampedBeds] ?? 0;
  if (!rent) return null;

  // Mortgage P&I
  const loanAmount  = l.price * (1 - cfg.downPaymentPct);
  const monthlyRate = (cfg.baseRate30yr + cfg.investmentRateAdder) / 12;
  const mortgage    = loanAmount
    * (monthlyRate * Math.pow(1 + monthlyRate, 360))
    / (Math.pow(1 + monthlyRate, 360) - 1);

  // Monthly expenses
  const vacancy     = rent * cfg.vacancyRate;
  const maintenance = rent * cfg.maintenanceRate;
  const insurance   = cfg.insuranceMonthly;
  const taxes       = l.price * cfg.propertyTaxAnnualRate / 12;

  const netCashFlow = rent - mortgage - vacancy - maintenance - insurance - taxes;

  // Renovation estimate from year_built tier
  const yearBuilt = l.year_built ?? 9999;
  const renoTier  = cfg.renoTiers.find(t => yearBuilt <= t.maxYearBuilt);
  const reno      = renoTier?.cost ?? 8_000;

  const totalCashIn = l.price * cfg.downPaymentPct + reno;
  const coc = totalCashIn > 0 ? (netCashFlow * 12) / totalCashIn : 0;

  // BRRRR — only when sold comps exist for this city and sqft is known
  let brrrr = null;
  const comps = stlComps[city];
  if (comps && l.sqft) {
    const arv          = Math.round(comps.medianPpsf * l.sqft);
    const forcedEquity = arv - l.price - reno;
    const refinanceAmt = Math.round(arv * cfg.refinanceLtv);
    const originalLoan = Math.round(l.price * (1 - cfg.downPaymentPct));
    const cashBack     = refinanceAmt - originalLoan;
    const isFullBrrrr  = cashBack >= totalCashIn;
    brrrr = { arv, reno, forcedEquity, refinanceAmt, originalLoan, cashBack, totalCashIn, comps, isFullBrrrr };
  }

  return { rent, mortgage, netCashFlow, coc, reno, totalCashIn, brrrr };
}
```

- [ ] **Step 6: Add `renderInvestmentRows(l)` and `toggleBrrrr(el)` functions**

Add after `computeUpside`:

```javascript
function fmtK(n) {
  const abs = Math.abs(Math.round(n / 1000));
  return (n < 0 ? '-' : '') + '$' + abs + 'K';
}

function renderInvestmentRows(l) {
  const up = computeUpside(l);
  if (!up) return '';

  const cfColor = up.netCashFlow >= 0 ? 'var(--green)' : 'var(--red)';
  const cfSign  = up.netCashFlow >= 0 ? '+' : '';
  const cocPct  = (up.coc * 100).toFixed(1);

  let brrrrHtml = '';
  if (up.brrrr) {
    const b = up.brrrr;
    const fullBadge = b.isFullBrrrr
      ? '<span class="brrrr-full-badge">Full BRRRR</span>'
      : '';
    brrrrHtml = `
      <div class="investment-brrrr" onclick="toggleBrrrr(this)">
        <div class="brrrr-summary">
          ▸ BRRRR &nbsp; ARV ${fmtK(b.arv)} · Reno ~${fmtK(b.reno)} · Equity ${fmtK(b.forcedEquity)} · Refi pull ${fmtK(b.cashBack)} ${fullBadge}
        </div>
        <div class="brrrr-detail">
          <div class="brrrr-row"><span>After-repair value</span><span>$${fmt(b.arv)}</span></div>
          <div class="brrrr-row brrrr-sub"><span>${b.comps.sampleSize} sold comps in ${l.city} @ $${b.comps.medianPpsf}/sqft</span></div>
          <div class="brrrr-row"><span>Reno estimate</span><span>~$${fmt(b.reno)}${l.year_built ? ' (built ' + l.year_built + ')' : ''}</span></div>
          <div class="brrrr-row"><span>Forced equity</span><span>$${fmt(b.forcedEquity)}</span></div>
          <div class="brrrr-row"><span>Refi @ ${(investmentConfig.refinanceLtv * 100).toFixed(0)}% LTV</span><span>$${fmt(b.refinanceAmt)}</span></div>
          <div class="brrrr-row"><span>Original loan</span><span>$${fmt(b.originalLoan)}</span></div>
          <div class="brrrr-row brrrr-highlight"><span>Cash back</span><span>$${fmt(b.cashBack)}</span></div>
          <div class="brrrr-row"><span>Total cash in</span><span>$${fmt(b.totalCashIn)} (${(investmentConfig.downPaymentPct * 100).toFixed(0)}% down + reno)</span></div>
        </div>
      </div>`;
  }

  return `
    <div class="investment-row">
      <span>Cash flow <strong style="color:${cfColor}">${cfSign}$${Math.round(Math.abs(up.netCashFlow))}/mo</strong></span>
      <span>CoC <strong>${cocPct}%</strong></span>
    </div>
    ${brrrrHtml}`;
}

function toggleBrrrr(el) {
  const detail  = el.querySelector('.brrrr-detail');
  const summary = el.querySelector('.brrrr-summary');
  const isOpen  = el.classList.contains('brrrr-open');
  el.classList.toggle('brrrr-open', !isOpen);
  detail.style.display  = isOpen ? 'none' : '';
  const arrow = summary.textContent.trim().startsWith('▸') ? '▾' : '▸';
  summary.textContent = summary.textContent.replace(/^[▸▾]/, arrow);
}
```

Note: `.brrrr-detail` starts hidden (controlled by CSS `display: none` — add in Step 8).

- [ ] **Step 7: Insert investment rows into card template in `renderCards()`**

In `renderCards`, find the line `${scoreBars(l.score_breakdown)}` (around line 715) and add `${renderInvestmentRows(l)}` immediately after it:

```javascript
      ${scoreBars(l.score_breakdown)}
      ${renderInvestmentRows(l)}
      <div class="card-footer">
```

- [ ] **Step 8: Update `FACTOR_LABELS` and `scoreBars` in `src/web/public/app.js`**

In `FACTOR_LABELS` (around line 328):
- Remove `zipBonus: 'Zip+'`
- Add `domBonus: 'DOM+'`

```javascript
const FACTOR_LABELS = {
  propertyType:      'Type',
  schoolDistrict:    'School',
  walkability:       'Walk',
  price:             'Price',
  sqft:              'Sqft',
  lot:               'Lot',
  transit:           'Transit',
  beds:              'Beds',
  pricePerSqft:      '$/sqft',
  neighborhoodBonus: 'Local+',
  domBonus:          'DOM+',    // ← add
  domPenalty:        'DOM−',    // ← keep for old data compatibility
  amtrak:            'Transit',
  narberthBonus:     'Local+',
};
```

In `scoreBars()` (around line 373), update the chip class assignment to treat `domBonus` as a bonus (same green styling as `neighborhoodBonus`):

```javascript
if (pts === 0) chipCls = 'zero';
else if (key === 'domPenalty') chipCls = 'penalty';
else if (key === 'neighborhoodBonus' || key === 'domBonus') chipCls = 'bonus';
else if (normalized >= 70) chipCls = '';
else if (normalized >= 40) chipCls = 'mid';
else chipCls = 'lo';
```

- [ ] **Step 9: Update `domLabel()` for investment mode**

In `domLabel()` (around line 311), high DOM should show as opportunity signal (green) when investment mode is active:

```javascript
function domLabel(dom) {
  if (dom == null) return '';
  if (investmentConfig) {
    // Investment mode: high DOM = motivated seller
    if (dom > 60) return `<span class="dom-ok">(${dom}d ↑)</span>`;
    return `<span class="dom-ok">(${dom}d)</span>`;
  }
  if (dom > 120) return `<span class="dom-warn">(⚠ ${dom} d)</span>`;
  if (dom > 30)  return `<span class="dom-mild">(~${dom} d)</span>`;
  return `<span class="dom-ok">(${dom} d)</span>`;
}
```

- [ ] **Step 10: Add investment styles to `src/web/public/style.css`**

Append at the end of the file:

```css
/* ── Investment upside rows ─────────────────────────── */

.investment-row {
  display: flex;
  gap: 16px;
  padding: 8px 0 4px;
  border-top: 1px solid var(--border);
  font-size: 12px;
  color: var(--text);
}

.investment-brrrr {
  padding: 6px 0 4px;
  border-top: 1px solid var(--border);
  cursor: pointer;
}

.brrrr-summary {
  font-size: 11px;
  color: var(--muted);
  line-height: 1.5;
  user-select: none;
}

.investment-brrrr:hover .brrrr-summary {
  color: var(--text);
}

.brrrr-detail {
  display: none;
  margin-top: 8px;
  padding: 8px;
  background: var(--surface2, rgba(0,0,0,0.04));
  border-radius: 6px;
  gap: 3px;
  flex-direction: column;
}

.investment-brrrr.brrrr-open .brrrr-detail {
  display: flex;
}

.brrrr-row {
  display: flex;
  justify-content: space-between;
  font-size: 11px;
  padding: 2px 0;
  color: var(--text);
}

.brrrr-row.brrrr-sub {
  color: var(--muted);
  font-size: 10px;
}

.brrrr-row.brrrr-highlight {
  font-weight: 700;
  border-top: 1px solid var(--border);
  padding-top: 5px;
  margin-top: 3px;
}

.brrrr-full-badge {
  display: inline-block;
  background: var(--green, #22c55e);
  color: #fff;
  font-size: 9px;
  font-weight: 700;
  padding: 1px 5px;
  border-radius: 3px;
  margin-left: 4px;
  vertical-align: middle;
}
```

- [ ] **Step 11: Start dev server and visually verify**

```bash
pnpm dev
```

Open `http://localhost:3000` and switch to the St. Louis locale. Verify:

1. Listing cards show a "Cash flow +$XXX/mo  CoC X.X%" row (green if positive, red if negative)
2. Cards with sqft data show a BRRRR summary line
3. Clicking the BRRRR row expands the detail section
4. Score breakdown chips no longer show `Zip+`; high-DOM listings show `DOM+` in green
5. High-DOM listings show `(60d ↑)` label instead of a warning
6. Multi-family listings appear in the feed if any exist in the area (run a poll to populate)

If cash flow numbers look wrong, double-check `baseRate30yr` in `st-louis.ts` — it should reflect the current 30yr rate.

- [ ] **Step 12: Commit**

```bash
git add src/web/public/app.js src/web/public/style.css
git commit -m "feat: add cash flow and BRRRR upside analysis to STL listing cards"
```

---

## Self-Review Checklist

- [x] Spec coverage: uipt per-locale ✓ · domBonus ✓ · scoring weights ✓ · investmentConfig type ✓ · rent table ✓ · comps endpoint ✓ · cash flow math ✓ · BRRRR math ✓ · UI rows ✓ · Full BRRRR badge ✓
- [x] No placeholders or TBDs
- [x] Type names consistent: `InvestmentConfig`, `RenovationTier`, `DomBonusConfig` used the same in types.ts and st-louis.ts
- [x] `computeUpside` uses `cfg.renoTiers.find(t => yearBuilt <= t.maxYearBuilt)` — matches spec formula
- [x] `toggleBrrrr` uses `.brrrr-open` CSS class which matches the style rule `.investment-brrrr.brrrr-open .brrrr-detail { display: flex }`
- [x] `fetchInvestmentData` called before `renderCards` in both `init()` and `switchLocale()`
- [x] `getSoldComps` imported in routes.ts step matches the export name in db/index.ts
