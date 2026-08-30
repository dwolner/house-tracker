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
- `minBeds`, `maxPrice` — hard filter, enforced **client-side in the poller** as well as sent to
  Redfin. The JSON endpoint ignores both (see Redfin APIs Used), so the local check is what actually
  holds for JSON locales
- `allowedZips?` — drop listings outside these ZIPs even if Redfin returns them
- `uipt` — Redfin property type filter string (e.g. `'1,3,4'`)
- `scoring` — `ScoringConfig` (all fields optional; omitted factors score 0)
- `investmentConfig?` — optional investment analysis config (rent tables, financing assumptions)
- `disableNotifications?` — suppress email alerts for this locale

To add a locale: create `src/locales/{name}.ts`, export a `LocaleConfig`, add it to `LOCALES` in `index.ts`.

## Configured Locales

| Locale ID | Name | State | Regions |
|---|---|---|---|
| `main-line` | PA Main Line | PA | Narberth/Penn Valley, Ardmore, Bryn Mawr, Bala Cynwyd, Merion Station, Haverford, Wynnewood, Wayne, Berwyn, King of Prussia |
| `san-diego` | San Diego | CA | Bay Park/Loma Portal, Point Loma Heights, Kensington/Talmadge, Bay Ho, North Park, Mission Hills, Allied Gardens, Talmadge/Rolando, South Park/Golden Hill, Mission Valley, Point Loma, Downtown, Pacific Beach, La Jolla, UTC/University City |
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
    brief.ts         — AI brief generation (Claude Haiku 4.5) from stored listing_remarks
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
    email.ts         — Email digest: dark + light palette, buildPreviewHtml export; cards show neighborhood · school district row; listings grouped by locale then category (new/price drop), sorted by score desc
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
         fetchRegionRemarks()  — listingRemarks from the gis JSON API, keyed by MLS# (never throws)
         drop listings outside locale criteria (state, allowedZips, minBeds, maxPrice, minPrice)
         rentResolution = resolveRentOverride(l, rentalEstimates, locale)  — 3-tier rent
         scoreWithBreakdown(l, locale, rentResolution)  — 0–100 + per-factor breakdown + rentUsed/rentSource
         upsertListing({ ...l, locale_id: locale.id, score, breakdown })
         saveListingRemarks()  — store description for brief generation
         logPoll()
       fetchRecentlySold()  — mark sold listings (CSV only; the JSON variant returns [])
  └─ markStaleListingsInactive()  — 36h absence → inactive
  └─ pruneOldBreakdowns()         — remove score_breakdown after 6 months inactive
  └─ runEnrichment()              — backfill walk scores, school districts, then AI briefs
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

**Redfin's WAF blocks HTML listing pages from most datacenter IPs (HTTP 405 + AWS WAF CAPTCHA), but
leaves the `/stingray/api/*` JSON endpoints open.** Roughly 1 in 4 Fly egress IPs is clean — the app
ran for months on a clean one, then a Fly capacity outage recreated the machine onto a flagged IP and
brief generation broke. Everything below uses the JSON APIs for that reason; don't reintroduce HTML
scraping into a code path that has to work in production.

### Listing CSV
```
GET /stingray/api/gis-csv?region_id=13565&region_type=6&uipt=1,2,3&status=9&num_beds=3&max_price=2000000&num_homes=350&v=8
```
Returns CSV: `ADDRESS`, `CITY`, `PRICE`, `BEDS`, `BATHS`, `SQUARE FEET`, `LOT SIZE`, `YEAR BUILT`, `PROPERTY TYPE`, `DAYS ON MARKET`, `LATITUDE`, `LONGITUDE`, `MLS#`, `URL`, `STATUS`.

### Listing JSON (STL / MARIS MLS restricted regions)
```
GET /stingray/api/gis?region_id=9905&region_type=6&uipt=1,3,4&status=9&num_beds=3&max_price=500000&num_homes=350&v=8
```
Used when `region.useJsonApi: true`. Required for STL because MARIS MLS restricts Redfin's CSV
download (re-verified Aug 2026 — `gis-csv` returns headers and zero rows for every status).

⚠️ **This endpoint silently ignores query parameters the CSV endpoint honours.** It accepts them and
returns 200, so the failure is invisible:

| Param | CSV | JSON | Consequence when it was trusted |
|---|---|---|---|
| `num_beds` / `max_price` | honoured | **ignored** | 363 of 786 STL rows exceeded its $500k cap; 218 were under minBeds. Now enforced client-side in the poller. |
| `status` | honoured | **ignored** | `status=9`, `130`, `131` all return the same Active + Coming Soon set. |
| comma-separated `status` | n/a | rejected | `status=9,1,130` → `resultCode 101`, zero homes. Query one status at a time. |

Because `status` is ignored:
- `fetchRegionListingsJson` issues **one** request, not one per status — three were identical.
- `fetchRecentlySoldJson` returns `[]`. Asking for `131` returned live listings and fed them to
  `markListingSold()`; that was harmless only because the query refuses rows with status `'9'`/`'1'`.
- **JSON-API locales cannot detect sold or pending listings.** Those listings drop out of the feed
  and are marked inactive by `markStaleListingsInactive()` after 36h. This is a data-source limit,
  not something to fix in code.

The JSON payload does carry one thing CSV lacks: `listingRemarks` (see AI Briefs).

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

## Type System

Three distinct listing types, each with a clear scope:

```ts
// src/poller/redfin.ts — only fields that come from the Redfin CSV/JSON API
interface RedfinListing { id, address, city, state, zip, price, beds, baths, sqft,
  lot_sqft, year_built, property_type, lat, lng, url, status, status_label,
  days_on_market, next_open_house_start, next_open_house_end, sold_date }

// src/scoring/index.ts — RedfinListing + enrichment fields the scorer reads
interface ScoringInput extends RedfinListing {
  walk_score: number | null;
  school_district: string | null;
  brief_short: string | null;
  brief_full: string | null;
}

// src/scoring/index.ts — passed as 4th arg to scoreWithBreakdown; never on any listing type
interface RelistingContext {
  prior_listing_id: string | null;
  prior_list_price: number | null;
}
```

`scoreWithBreakdown(listing: ScoringInput, locale, rentResolution?, context?: RelistingContext)` — the context carries relisting info so it never pollutes listing types. All enrichment paths (walk score, school district, rescore, poller) construct a `ScoringInput` explicitly and pass context separately when available.

## Scoring Engine

`scoreWithBreakdown` in `src/scoring/index.ts`. Returns `ScoreBreakdown`:

```ts
interface ScoreBreakdown {
  total: number;
  factors: Record<string, { pts: number; max: number }>;
  rentUsed?: number;      // actual rent used in investmentScore (stored in DB)
  rentSource?: 'rentcast' | 'derived' | 'table';
}
```

The score is normalized: raw positive points are summed, divided by the sum of all positive weights, then multiplied by 100. Penalties are subtracted after normalization. `yearBuiltBonus` is added after the percentage so it doesn't inflate the denominator.

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
| `baths` | `BathsConfig` | Descending step function; first match wins |
| `pricePerSqft` | `PricePerSqftConfig` | Piecewise linear on $/sqft |
| `neighborhoodBonus` | `NeighborhoodBonusConfig` | Distance from center; city-gated |
| `zipBonus` | `ZipBonusConfig` | Full bonus for listed ZIP codes |
| `domBonus` | `DomBonusConfig` | Bonus for high-DOM listings (motivated seller signal) |
| `investmentScore` | `InvestmentScoreConfig` | Composite: 40% cash flow + 35% cap rate + 25% CoC; 0 if rent unknown |
| `domPenalty` | `DomPenaltyConfig` | Subtracted after normalization; full at 120+ DOM |
| `yearBuiltPenalty` | `YearBuiltPenaltyConfig` | Graded penalty for pre-1980 construction |
| `yearBuiltBonus` | `YearBuiltBonusConfig` | Additive bonus for newer construction; does not inflate denominator |
| `zipPenalty` | `ZipPenaltyConfig` | Flat penalty for specific ZIPs (e.g. SDSU-adjacent rental market) |
| `multiUnitPenalty` | `MultiUnitPenaltyConfig` | Flat penalty when brief text matches multi-unit keywords |
| `flipPenalty` | `FlipPenaltyConfig` | Flat penalty when brief text matches flip language (`flip`, `flipped`, `markup`) |
| `relistingPenalty` | `RelistingPenaltyConfig` | Tiered: `weight` pts when relisted at same/higher price; `reducedWeight` when price lowered |
| `bathBedRatioPenalty` | `BathBedRatioPenaltyConfig` | Flat penalty when beds ≥ minBeds but baths < minBaths |
| `sqftFloorPenalty` | `SqftFloorPenaltyConfig` | Flat penalty when sqft < minSqft |

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

**BRRRR analysis** — ARV from median sold $/sqft (last 12 months, min 1 sale per city, `sold_price > 10000` sanity guard), forced equity, refi pull at `refinanceLtv`, full vs. partial BRRRR flag.

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
                                 -- normalizeStatus() maps Redfin labels; 'Pre On-Market' → '1'
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
  next_open_house_end TEXT,
  brief_short TEXT,              -- AI-generated one-liner (Claude Haiku)
  brief_full TEXT,               -- JSON array of bullet strings
  listing_remarks TEXT,          -- raw agent description from gis JSON (`listingRemarks`, capped 699 chars)
  superseded_by TEXT,            -- FK → listings.id for dedup chains
  prior_listing_id TEXT,         -- FK → listings.id — most-recent inactive listing at same address
  prior_list_price INTEGER       -- price_at_first_seen of prior_listing_id (stored to avoid join at score time)
)

price_history     (listing_id, price, recorded_at)
poll_log          (polled_at, area, listings_found, new_listings)
change_log        (listing_id, change_type, old_value, new_value, changed_at, notified)
  -- change_type values: price_drop, price_increase, now_active, now_pending, relisted, sold
  -- relisted: old_value=prior price_at_first_seen, new_value=new listing price
  -- sweepStaleChanges() marks unnotified rows older than 48h as seen (prevents burst after downtime)

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

redfin_fetch_log (
  id INTEGER PRIMARY KEY,
  listing_id TEXT,
  fetched_at TEXT,               -- ISO timestamp
  blocked INTEGER DEFAULT 0,     -- 1 when Redfin refused (WAF captcha, rate limit, short body)
  detail TEXT                    -- status code or response size
)
-- Every HTML listing-page fetch, success or blocked. Surfaces WAF blocks that would
-- otherwise only appear later as missing/garbage briefs. See GET /api/redfin/usage.
```

## API Routes

| Route | Description |
|---|---|
| `GET /api/listings` | Active listings with `prior_listing_id`, `prior_list_price`, `prior_days_on_market`, `prior_last_seen_at` (via LEFT JOIN); supports `?locale_id=`, `?min_score=`, `?city=`, `?prop_type=` filters |
| `GET /api/listings/:id/history` | Walks `prior_listing_id` chain (up to 5 hops), returns `{ appearances: [...], trueDom }` where each appearance includes `prices[]` from `price_history` |
| `GET /api/stats?locale_id=` | Summary stats (total, fresh, last poll, cities, property types) |
| `GET /api/inventory` | Inventory trends over time from `poll_log` |
| `GET /api/outcomes` | Pending/sold outcomes with DOM and price deltas |
| `GET /api/trends` | Price and score trends by city+zip/month. SD and STL group by zip (neighborhoods share a city name); Main Line groups by city. Frontend maps zip → neighborhood label via `SD_POLLING_REGIONS` / `STL_POLLING_REGIONS`. |
| `GET /api/locales/:id/investment` | Investment config for a locale |
| `GET /api/locales/:id/comps` | Median sold $/sqft by city (last 12 months, min 3 sales) |
| `GET /api/locales/:id/rent-estimates` | Cached RentCast rent estimates keyed by listing ID |
| `GET /api/redfin/usage` | Redfin HTML-fetch health: `{ last1h, last24h, currentlyBlocked, recentBlocked[] }`. `currentlyBlocked` = last 3 fetches all blocked. |
| `POST /api/listings/:id/brief` | Generate a brief on demand ("Generate Brief" button). Uses stored `listing_remarks`; falls back to scraping only when a listing has none. |
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
| `ANTHROPIC_API_KEY` | Yes (briefs) | Claude API key — brief generation uses Haiku 4.5 |
| `BRIEF_FETCH_DELAY_MS` | No | Delay between brief HTML fallback fetches (default: 4500). Only affects the fallback path; remarks-backed briefs make no HTTP request. Raise for large backfills. |

## AI Briefs

Per-listing pre-showing analysis (`brief_short` one-liner + `brief_full` bullets), generated with
Claude Haiku 4.5 in `src/enrichment/brief.ts`.

**Source of the description — read this before changing it.** Briefs are built from
`listing_remarks`, harvested from the `gis` **JSON API** during the poll (`fetchRegionRemarks`, one
request per region). They are *not* scraped from the listing page. Redfin's WAF blocks HTML listing
pages from most datacenter IPs (HTTP 405 + AWS WAF captcha) while leaving `/stingray/api/*` open, so
a scraping-based brief path works locally and fails in production. Roughly 1 in 4 Fly egress IPs is
clean; the app ran on a clean one for months until a capacity outage recreated the machine onto a
flagged IP and briefs silently stopped generating.

| Path | Source | HTTP requests |
|---|---|---|
| Primary | stored `listing_remarks` | **none** |
| Fallback | HTML page scrape | 1/listing — only when a listing has no remarks |

Both `runBriefEnrichment()` (bulk) and `generateBriefForListing()` (the "Generate Brief" button) use
the same remarks-first path. The fallback exists because a few listings — mostly Coming Soon /
pre-market — aren't in the JSON feed yet; they pick up remarks once active.

**Guards, each of which exists because its absence caused a real bug:**

- **Truncation** — Redfin caps `listingRemarks` at 699 chars, usually mid-word. Handed that raw, the
  model reported the truncation as a property finding (*"description ends mid-sentence — check what
  was cut off"*). `trimToCompleteSentence()` cuts back to the last complete sentence.
- **Absent sections are omitted, never announced.** Telling the model "No sale history available"
  invites it to report that absence as a finding. The prompt also forbids commenting on missing,
  partial, or truncated data — those are pipeline artifacts, not facts about the house.
- **Blocked fetches never produce a brief.** A `202` with an empty body is a 2xx, so `res.ok` alone
  let empty HTML through and produced confident nonsense ("no description provided and no available
  sale history") for listings that had both. `fetchListingPage` now rejects non-200 and suspiciously
  short bodies, and a fetch yielding neither description nor history is skipped rather than sent to
  the model.
- **Queue order** — `getListingsMissingBrief` returns remarks-backed listings first. They need no
  HTTP request and always succeed, so the circuit breaker (3 consecutive failures) can only trip at
  the tail instead of aborting the run before any generatable brief is produced.

Sale history is only available via the HTML page, so remarks-backed briefs are generated with an
empty history array. Verified that this does not cause fabricated sale-history claims. The app
already surfaces relisting and price-drop signals structurally (`prior_listing_id`, true DOM,
RELISTING / PRICE DROP badges), so the brief is not the only place that information appears.

## Relisting Detection

Sellers relist properties under a new Redfin ID to reset the DOM clock. The system detects and links these structurally.

**Detection** — inside `upsertListing()` on `isNew = true`: queries for the most-recent `inactive` listing with the same address (`LOWER(TRIM(address))`), same `locale_id`, and `superseded_by IS NULL`. If found:
- Sets `prior_listing_id` and `prior_list_price` on the new listing's INSERT
- Rescores immediately via `scoreWithBreakdown` with `RelistingContext` so the penalty is applied at insert time (before enrichment rescores would otherwise overwrite it)
- Logs a `relisted` entry in `change_log` (`old_value = prior price_at_first_seen`, `new_value = new price`)

**Penalty** — `relistingPenalty` in `ScoringConfig`:
- Relisted at same or higher price → `weight` pts (full penalty — cynical DOM reset)
- Relisted at lower price → `reducedWeight` pts (partial — seller conceded to market)
- All three locales configured at `{ weight: 8, reducedWeight: 4 }`

**FLIP vs RELISTING** — `FLIP_KEYWORDS` (`/\bflip\b|flipped|markup/i`) detects explicit flip language in the brief. Relisting is structural and separate. A listing that is both (e.g. a flipped property that was relisted) correctly shows both badges and both penalties.

**True DOM** — `prior_days_on_market` and `prior_last_seen_at` are included in the `/api/listings` response via LEFT JOIN on the prior listing. The frontend computes: `prior DOM + gap days + current DOM`. Shown on the card with a `↺` marker and tooltip breakdown. Full chain history (for 3+ listing appearances) is available via `/api/listings/:id/history`.

**Email** — `relisted` change type handled in `changeBadgeHtml`: shows prior price, new price, and delta. DOM indicator annotated with `↺` when `prior_listing_id` is set.

## Icon System

All icons in `app.js` use inline Lucide SVG paths (MIT licensed). No CDN dependency — icons are embedded as a `ICONS` object at the top of `app.js`.

```js
function ico(name, size = 14)      // returns SVG string — for innerHTML
function icoAttr(name, size = 14)  // quotes encoded as &quot; — for HTML attribute values (e.g. onerror)
```

Email uses Unicode characters (not SVG) because most email clients don't support SVG.

## Related Docs

- `src/scoring/index.ts` — full scoring implementation
- `src/locales/types.ts` — all config interfaces
- `docs/fly-deployment.md` — deploy to Fly.io
- `docs/superpowers/specs/2026-04-25-investment-mode-design.md` — investment mode design spec

---

**Last Updated:** August 30, 2026
**Author:** Daniel Wolner
