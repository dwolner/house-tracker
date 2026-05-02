# House Tracker — Architecture

## Overview

A personal tool for tracking new real estate listings across multiple locales. It polls Redfin for active listings across all configured regions, scores each against locale-specific weighted preferences, stores results in SQLite, and displays them in a local web dashboard.

## Locale System

Each locale lives in `src/locales/` and implements `LocaleConfig`:

```
src/locales/
  types.ts        — all config interfaces (LocaleConfig, ScoringConfig, InvestmentConfig, etc.)
  index.ts        — LOCALES registry (Record<string, LocaleConfig>) + getLocale(id)
  main-line.ts    — PA Main Line definition
  san-diego.ts    — San Diego definition
  st-louis.ts     — St. Louis suburbs definition (investment mode)
```

**`LocaleConfig`** fields:
- `id` — unique key (used in DB as `locale_id`)
- `name` — display name
- `state` — expected state abbreviation (listings from other states are dropped at poll time)
- `regions` — array of `RedfinRegion` (`name`, `region_id`, `region_type`, `useJsonApi?`)
- `minBeds`, `maxPrice` — hard filter applied before DB insert
- `uipt` — Redfin property type filter string (e.g. `'1,3,4'`)
- `scoring` — `ScoringConfig` (all fields optional; omitted factors score 0)
- `investmentConfig?` — optional investment analysis config (rent tables, financing assumptions)
- `disableNotifications?` — suppress email alerts for this locale

To add a locale: create `src/locales/{name}.ts`, export a `LocaleConfig`, add it to `LOCALES` in `index.ts`.

## Configured Locales

| Locale ID | Name | State | Regions |
|---|---|---|---|
| `main-line` | PA Main Line | PA | Narberth/Penn Valley, Ardmore, Bryn Mawr, Bala Cynwyd, Merion Station, Haverford, Wynnewood, Wayne, Berwyn, King of Prussia |
| `san-diego` | San Diego | CA | Bay Park/Loma Portal, Point Loma Heights, Kensington/Talmadge, Bay Ho, North Park, Mission Hills, Allied Gardens |
| `st-louis` | St. Louis Suburbs | MO | Kirkwood, Glendale, Webster Groves, Rock Hill, Maplewood, Richmond Heights, Ladue, Clayton, Shrewsbury, Des Peres, Sunset Hills, Crestwood |

## Components

```
src/
  locales/           — locale definitions and scoring config (see above)
  poller/
    redfin.ts        — Redfin CSV + JSON GIS API clients
    index.ts         — Poll orchestration (iterates LOCALES → regions, upserts listings, runs enrichment)
  enrichment/
    walk-score.ts    — Walk score enrichment (pulls from Redfin's internal API)
    rent-estimate.ts — RentCast rent estimates + resolveRentOverride (3-tier rent priority)
    mortgage-rate.ts — FRED 30yr fixed rate (cached in memory, 6.9% fallback)
  scoring/
    index.ts         — Locale-aware weighted scoring engine (scoreWithBreakdown)
  db/
    index.ts         — SQLite schema, migrations, upsert logic, outcomes tracking, rent estimates
  web/
    server.ts        — Fastify server + node-cron scheduler
    routes.ts        — API routes + /email-preview
    public/
      index.html     — Static shell
      app.js         — Client JS (filters, sort, investment mode, score tooltip, map, charts)
      style.css      — CSS custom properties for light/dark theme
  notifications/
    email.ts         — Email digest: dark + light palette, buildPreviewHtml export; cards show neighborhood · school district row; listings grouped by category (new/price drop) then locale
  rescore.ts         — Standalone rescore script (re-scores all listings, optional locale filter)
  index.ts           — Entry point (seeds FRED rate at startup)
scripts/
  push-db.sh         — Checkpoint WAL + upload local DB to Fly.io persistent volume
  clear-stale.sh     — Remove inactive listings older than threshold
data/
  listings.db        — SQLite database (gitignored)
```

## Data Flow

```
pnpm poll
  └─ getCurrentMortgageRate()  — FRED 30yr rate (cached; fallback 6.9%)
  └─ for each locale in LOCALES:
       rentalEstimates = getRentalEstimatesWithSqft(locale.id)  — if investmentConfig present
       for each region in locale.regions:
         fetchRegionListings() / fetchRegionListingsJson()  — Redfin CSV or JSON API
         drop listings where state ≠ locale.state
         rentResolution = resolveRentOverride(l, rentalEstimates, locale)  — 3-tier rent
         scoreWithBreakdown(l, locale, rentResolution)  — 0–100 + per-factor breakdown + rentUsed/rentSource
         upsertListing({ ...l, locale_id: locale.id, score, breakdown })
         logPoll()
       fetchRecentlySold() / fetchRecentlySoldJson()  — mark sold listings
  └─ markStaleListingsInactive()  — 36h absence → inactive
  └─ pruneOldBreakdowns()         — remove score_breakdown after 6 months inactive
  └─ runEnrichment()              — backfill walk scores
  └─ for each locale with investmentConfig:
       refreshRentEstimates(locale.id)  — fetch RentCast estimates for new/stale listings (round-robin ZIP)

pnpm enrich
  └─ getListingsMissingWalkScore()     — SELECT WHERE walk_score IS NULL
  └─ fetchWalkScoreFromRedfin()        — GET /stingray/api/home/details/neighborhoodStats/statsInfo
  └─ re-scoreWithBreakdown(l, locale)  — uses getLocale(locale_id) from DB row
  └─ updateListingWalkScore()

pnpm rent-estimate
  └─ refreshRentEstimates('st-louis')  — manual one-shot run of rent estimate enrichment

pnpm rescore [locale]
  └─ fetches current FRED mortgage rate
  └─ for each scored listing (optional locale filter):
       resolveRentOverride(listing, estimates, locale)  — 3-tier rent resolution
       scoreWithBreakdown(listing, locale, rentResolution)
       UPDATE listings SET score, score_breakdown

pnpm web  (or pnpm dev)
  └─ Fastify serves src/web/public/
  └─ API routes read from listings.db
  └─ node-cron fires daily poll + email digest
```

## Redfin APIs Used

### Listing CSV
```
GET /stingray/api/gis-csv?region_id=13565&region_type=6&uipt=1,2,3&status=9&num_beds=3&max_price=2000000&num_homes=350&v=8
```
Returns CSV: `ADDRESS`, `CITY`, `PRICE`, `BEDS`, `BATHS`, `SQUARE FEET`, `LOT SIZE`, `YEAR BUILT`, `PROPERTY TYPE`, `DAYS ON MARKET`, `LATITUDE`, `LONGITUDE`, `MLS#`, `URL`, `STATUS`.

### Listing JSON (STL / MARIS MLS restricted regions)
```
GET /stingray/api/gis?region_id=9905&region_type=6&uipt=1,3,4&status=9&num_beds=3&max_price=500000&num_homes=350&v=8
```
Used when `region.useJsonApi: true`. Returns the same data as a JSON payload instead of CSV. Required for STL because MARIS MLS restricts Redfin's CSV download.

### Walk Score (internal, no auth required)
```
GET /stingray/api/home/details/neighborhoodStats/statsInfo?propertyId={id}&accessLevel=1
```
- `propertyId` from listing URL: `.../home/12345678` → `12345678`
- Response prefixed with `{}&&` — strip first 4 chars before `JSON.parse()`
- Walk score at `payload.walkScoreInfo.walkScoreData.walkScore.value`

## RentCast API

Used to get comp-based rent estimates for STL investment listings.

```
GET https://api.rentcast.io/v1/avm/rent/long-term
  ?address={address}&bedrooms={beds}&bathrooms={baths}&squareFeet={sqft}&propertyType=Single+Family
  X-Api-Key: {RENTCAST_API_KEY}
```

Returns `{ rent, rentRangeLow, rentRangeHigh }`. Results cached in `rental_estimates` table and only re-fetched after 30 days.

**Usage limits** — enforced in DB via `rentcast_usage` table (logged before each call):
- 50 calls/30-day period hard cap — period start derived from `MIN(called_at)` in `rentcast_usage`; auto-rolls every 30 days without config changes
- `RENTCAST_DAILY_LIMIT` calls/day (default: 1) — raise temporarily for backfill, then revert
- `GET /api/rentcast/usage` returns `{ thisMonth, today, monthlyLimit, dailyLimit }`

**Rent resolution — 3-tier priority** (`resolveRentOverride` in `rent-estimate.ts`):
1. **Direct** (`rentcast`) — cached RentCast AVM result for this exact listing
2. **Derived** (`derived`) — premium-ratio method: `median(RentCast[comp] / table[comp])` across same-bed comps × this listing's table rent; normalizes geographic noise (Kirkwood comps don't artificially inflate South City estimates); requires ≥1 comp
3. **Table** (`table`) — `rentByCity[city][beds]` static fallback

`rentUsed` and `rentSource` are stored in `score_breakdown` JSON at score time so the UI reads from there directly — no independent derivation in the frontend that could drift from the backend.

Card label reflects source: **"comp rent"** (direct), **"derived rent"** (premium-ratio), **"est. rent"** (static table). Tooltip shows range or comp count.

**ZIP diversity** — `getListingsNeedingRentEstimate` uses a CTE with `ROW_NUMBER() OVER (PARTITION BY zip)` so the first N results always come from N different ZIPs, ordered by least-covered ZIP first. Prevents all daily API calls going to the same neighborhood.

Sign up at [app.rentcast.io](https://app.rentcast.io/app) — free tier is 50 req/month. Keep `RENTCAST_API_KEY` only in fly.io secrets, not in local `.env`, to avoid double-counting against the monthly limit.

## Scoring Engine

`scoreWithBreakdown(listing, locale, rentResolution?)` in `src/scoring/index.ts`. Takes a `RedfinListing`, a `LocaleConfig`, and an optional `rentResolution` from `resolveRentOverride`; returns `ScoreBreakdown`:

```ts
interface ScoreBreakdown {
  total: number;
  factors: Record<string, { pts: number; max: number }>;
  rentUsed?: number;      // actual rent used in investmentScore (stored in DB)
  rentSource?: 'rentcast' | 'derived' | 'table';
}
```

The score is normalized: raw positive points are summed, divided by the sum of all positive weights, then multiplied by 100. DOM penalty is subtracted after normalization.

**Unknown values (`null`) always score 0 — no arbitrary defaults.**

### Factor descriptions

| Factor | Config type | Notes |
|---|---|---|
| `propertyType` | `PropertyTypeConfig` | Lookup by lowercase type string |
| `schoolDistrict` | `SchoolDistrictConfig` | Census district name lookup; city fallback |
| `walkability` | `WalkabilityConfig` | `(walk_score / 100) × weight` |
| `price` | `PriceConfig` | Piecewise linear: excellent → full, good → half, max → 0; optional exp decay |
| `sqft` | `SqftConfig` | Linear interpolation across sorted breakpoints |
| `lot` | `LotConfig` | Linear interpolation across sorted breakpoints (acres) |
| `transit` | `TransitConfig` | Haversine distance to nearest station |
| `beds` | `BedsConfig` | Descending step function; first match wins |
| `pricePerSqft` | `PricePerSqftConfig` | Piecewise linear on $/sqft |
| `neighborhoodBonus` | `NeighborhoodBonusConfig` | Distance from center; city-gated |
| `zipBonus` | `ZipBonusConfig` | Full bonus for listed ZIP codes |
| `domBonus` | `DomBonusConfig` | Bonus for high-DOM listings (motivated seller signal) |
| `investmentScore` | `InvestmentScoreConfig` | Composite: 40% cash flow + 35% cap rate + 25% CoC; 0 if rent unknown |
| `domPenalty` | `DomPenaltyConfig` | Subtracted after normalization; full at 120+ DOM |

### Scoring weights by locale

**Main Line:** Property type 20 / School district 20 / Walkability 12 / Price 12 / Sqft 8 / Lot 12 / Transit 8 / Beds 4 / Price/sqft 4 / Neighborhood bonus 6 / DOM penalty −6

**San Diego:** Property type 20 / Walkability 18 / Price 14 / Sqft 14 / Lot 12 / Beds 10 / Price/sqft 10 / DOM penalty −6

**St. Louis:** Property type 18 / School district 12 / Walkability 6 / Price 20 / Sqft 8 / Lot 5 / Beds 8 / Price/sqft 15 / DOM bonus 4 / Investment score 20

## Investment Mode (St. Louis)

When `investmentConfig` is present on a locale, both the scoring engine and the frontend run investment math per listing.

**Scoring (`investmentScore` factor):** computed inside `scoreWithBreakdown` using the resolved rent (from `resolveRentOverride`). Three sub-components, weighted within the factor:
- Cash flow (40%) — monthly rent minus mortgage P&I, vacancy, age-based maintenance (5–13%), insurance (0.5% of value/yr), property taxes
- Cap rate (35%) — NOI ÷ purchase price; piecewise between `capRateGood` and `capRateExcellent`
- CoC (25%) — annual cash flow ÷ (down payment + reno estimate); piecewise between `cocGood` and `cocExcellent`

**Mortgage rate** — live FRED 30yr fixed rate fetched at startup and poll time (falls back to 6.9%). Investment rate = base rate + `investmentRateAdder` (typically +0.5%).

**Maintenance rate** — derived from `year_built`: ≤1959 → 13%, ≤1979 → 10%, ≤1999 → 7%, newer → 5%.

**Frontend (`computeUpside`):** reads `score_breakdown.rentUsed` + `score_breakdown.rentSource` (written at score time) as the primary rent source — UI and backend always agree. Renders an investment row per card showing cash flow, CoC, cap rate, break-even price, and BRRRR analysis.

**BRRRR analysis** — ARV from median sold $/sqft (last 12 months, min 3 sales per city), forced equity, refi pull at `refinanceLtv`, full vs. partial BRRRR flag.

### `investmentConfig` fields

| Field | Description |
|---|---|
| `rentByCity` | `Record<city, Record<beds, monthlyRent>>` — calibrated from RentCast AVM data (Apr 2026) |
| `zipToCity` | Maps USPS zip → canonical city key (STL returns "Saint Louis" for many suburbs) |
| `taxRateByCity` | Per-city annual property tax as fraction of value; `taxRateFallback` used if city not listed |
| `downPaymentPct` | e.g. `0.25` |
| `investmentRateAdder` | Premium over live FRED 30yr rate (typically `0.005`) |
| `vacancyRate` | Fraction of rent lost to vacancy (e.g. `0.08`) |
| `renoTiers` | Array of `{ maxYearBuilt, costPerSqft, minCost }` — reno estimate by age + sqft |
| `refinanceLtv` | LTV for BRRRR refi (e.g. `0.75`) |
| `cashFlowExcellent` | Monthly cash flow ($/mo) at which `investmentScore` earns full cash-flow points |
| `capRateGood` / `capRateExcellent` | Cap rate thresholds for half / full cap-rate points |
| `cocGood` / `cocExcellent` | CoC thresholds for half / full CoC points |

## Database Schema

```sql
listings (
  id TEXT PRIMARY KEY,           -- MLS#
  address, city, state, zip,
  price INTEGER,
  beds INTEGER, baths REAL,
  sqft INTEGER, lot_sqft INTEGER,
  year_built INTEGER,
  walk_score INTEGER,            -- null until enriched
  property_type TEXT,
  lat REAL, lng REAL,
  url TEXT,
  status TEXT,                   -- '9'=active, '1'=coming soon, '130'=pending, '131'=sold, 'inactive'
  days_on_market INTEGER,
  score REAL,
  score_breakdown TEXT,          -- JSON: ScoreBreakdown
  first_seen_at TEXT,
  last_seen_at TEXT,
  price_at_first_seen INTEGER,
  pending_at TEXT,               -- set when status→pending
  pending_price INTEGER,
  sold_at TEXT,                  -- set when status→sold
  sold_price INTEGER,
  status_label TEXT,             -- raw label from Redfin ("Contingent", etc.)
  school_district TEXT,          -- from Census geocoder enrichment
  locale_id TEXT,                -- 'main-line', 'san-diego', 'st-louis'
  starred INTEGER DEFAULT 0,
  next_open_house_start TEXT,
  next_open_house_end TEXT
)

price_history     (listing_id, price, recorded_at)
poll_log          (polled_at, area, listings_found, new_listings)
change_log        (listing_id, change_type, old_value, new_value, changed_at, notified)
                  sweepStaleChanges() marks unnotified rows older than 48h as seen on each poll cycle
                  to prevent backlog bursts after downtime or rescores

rental_estimates (
  listing_id TEXT PRIMARY KEY,   -- FK → listings.id
  estimated_rent INTEGER,        -- monthly rent from RentCast
  rent_low INTEGER,              -- low end of RentCast range
  rent_high INTEGER,             -- high end of RentCast range
  source TEXT,                   -- 'rentcast'
  fetched_at TEXT                -- ISO timestamp; stale after 30 days
)

rentcast_usage (
  id INTEGER PRIMARY KEY,
  listing_id TEXT,               -- which listing triggered the call ('__untracked__' for manual)
  called_at TEXT                 -- ISO timestamp; used for 30-day billing period accounting
)
-- Period start = MIN(called_at); current period = floor((now - first) / 30d) * 30d
```

## API Routes

| Route | Description |
|---|---|
| `GET /api/listings` | Active listings; supports `?locale_id=`, `?min_score=`, `?city=`, `?prop_type=` filters |
| `GET /api/listings/:id/history` | Price history for a single listing |
| `GET /api/stats?locale_id=` | Summary stats (total, fresh, last poll, cities, property types) |
| `GET /api/inventory` | Inventory trends over time from `poll_log` |
| `GET /api/outcomes` | Pending/sold outcomes with DOM and price deltas |
| `GET /api/trends` | Price and score trends by city/month |
| `GET /api/locales/:id/investment` | Investment config for a locale |
| `GET /api/locales/:id/comps` | Median sold $/sqft by city (last 12 months, min 3 sales) |
| `GET /api/locales/:id/rent-estimates` | Cached RentCast rent estimates keyed by listing ID |
| `POST /api/locales/:id/rent-estimates/refresh` | Trigger a manual rent estimate refresh |
| `GET /email-preview?locale=&n=&theme=` | Render email digest HTML in browser (theme: dark/light) |
| `POST /api/digest` | Trigger an immediate poll + email digest |

## Commands

| Command | What it does |
|---|---|
| `pnpm dev` | Start web server with hot reload |
| `pnpm web` | Start web server (no reload) |
| `pnpm poll` | Fetch listings from all locales and upsert to DB |
| `pnpm enrich` | Backfill walk scores for listings missing them |
| `pnpm rent-estimate` | Fetch RentCast rent estimates for STL listings missing them |
| `pnpm rescore [locale]` | Re-score all (or one locale's) listings with current mortgage rate + RentCast data |
| `pnpm push-db` | Checkpoint local DB and upload to Fly.io persistent volume |
| `pnpm clear-stale` | Remove stale inactive listings from local DB |
| `pnpm build` | Compile TypeScript to `dist/` |
| `pnpm start` | Run compiled output |

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `SMTP_HOST` | Yes (email) | SMTP server hostname |
| `SMTP_PORT` | Yes (email) | SMTP port |
| `SMTP_USER` | Yes (email) | SMTP username |
| `SMTP_PASS` | Yes (email) | SMTP password / app password |
| `NOTIFY_TO` | Yes (email) | Comma-separated recipient list |
| `NOTIFY_SCORE_THRESHOLD` | No | Min score for new listing email (default: 75) |
| `POLL_SCHEDULE` | No | Cron expression for auto-poll (default: `0 7 * * *`) |
| `DB_PATH` | No | SQLite file path (default: `data/listings.db`) |
| `RENTCAST_API_KEY` | No | RentCast API key for STL rent estimates (free tier: 50 req/30-day period) |
| `RENTCAST_DAILY_LIMIT` | No | Max RentCast calls per day (default: 1; raise temporarily for backfill) |

## Related Docs

- `src/scoring/index.ts` — full scoring implementation
- `src/locales/types.ts` — all config interfaces
- `docs/fly-deployment.md` — deploy to Fly.io
- `docs/superpowers/specs/2026-04-25-investment-mode-design.md` — investment mode design spec

---

**Last Updated:** April 29, 2026
**Author:** Daniel Wolner
