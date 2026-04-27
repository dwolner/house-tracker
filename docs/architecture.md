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
  locales/          — locale definitions and scoring config (see above)
  poller/
    redfin.ts       — Redfin CSV + JSON GIS API clients
    index.ts        — Poll orchestration (iterates LOCALES → regions, upserts listings, runs enrichment)
  enrichment/
    walk-score.ts   — Walk score enrichment (pulls from Redfin's internal API)
    rent-estimate.ts — RentCast rent estimate enrichment (beds+baths+sqft comps, cached in DB)
  scoring/
    index.ts        — Locale-aware weighted scoring engine (scoreWithBreakdown)
  db/
    index.ts        — SQLite schema, migrations, upsert logic, outcomes tracking, rent estimates
  web/
    server.ts       — Fastify server + node-cron scheduler
    routes.ts       — API routes
    public/
      index.html    — Static shell
      app.js        — Client JS (filters, sort, investment mode, score tooltip, map, charts)
      style.css     — CSS custom properties for light/dark theme
  index.ts          — Entry point
data/
  listings.db       — SQLite database (gitignored)
```

## Data Flow

```
pnpm poll
  └─ for each locale in LOCALES:
       for each region in locale.regions:
         fetchRegionListings() / fetchRegionListingsJson()  — Redfin CSV or JSON API
         drop listings where state ≠ locale.state
         scoreWithBreakdown(l, locale)  — 0–100 + per-factor breakdown
         upsertListing({ ...l, locale_id: locale.id, score, breakdown })
         logPoll()
       fetchRecentlySold() / fetchRecentlySoldJson()  — mark sold listings
  └─ markStaleListingsInactive()  — 36h absence → inactive
  └─ pruneOldBreakdowns()         — remove score_breakdown after 6 months inactive
  └─ runEnrichment()              — backfill walk scores
  └─ refreshRentEstimates('st-louis')  — fetch RentCast estimates for new/stale STL listings

pnpm enrich
  └─ getListingsMissingWalkScore()     — SELECT WHERE walk_score IS NULL
  └─ fetchWalkScoreFromRedfin()        — GET /stingray/api/home/details/neighborhoodStats/statsInfo
  └─ re-scoreWithBreakdown(l, locale)  — uses getLocale(locale_id) from DB row
  └─ updateListingWalkScore()

pnpm rent-estimate
  └─ refreshRentEstimates('st-louis')  — manual one-shot run of rent estimate enrichment

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
- 50 calls/month hard cap — checked before every run, zero calls made if hit
- `RENTCAST_DAILY_LIMIT` calls/day (default: 1) — raise temporarily for backfill, then revert
- `GET /api/rentcast/usage` returns `{ thisMonth, today, monthlyLimit, dailyLimit }`

**Rent source priority** in `computeUpside()`:
1. **Real estimate** (`rentcast`) — cached RentCast result for this exact listing
2. **Derived estimate** (`derived`) — median $/sqft from real comps with same bed count × this listing's sqft; requires ≥2 comps; improves automatically as more real estimates accumulate
3. **Static table** (`table`) — `rentByCity` city + bed count lookup; fallback when no comps available

Card label reflects source: **"comp rent"** (real), **"derived rent"** (interpolated), **"est. rent"** (static table). Tooltip shows range or comp count.

Sign up at [app.rentcast.io](https://app.rentcast.io/app) — free tier is 50 req/month. Keep `RENTCAST_API_KEY` only in fly.io secrets, not in local `.env`, to avoid double-counting against the monthly limit.

## Scoring Engine

`scoreWithBreakdown(listing, locale)` in `src/scoring/index.ts`. Takes a `RedfinListing` and a `LocaleConfig`; returns `ScoreBreakdown` with a total (0–100) and a per-factor record.

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
| `domPenalty` | `DomPenaltyConfig` | Subtracted after normalization; full at 120+ DOM |

### Scoring weights by locale

**Main Line:** Property type 20 / School district 20 / Walkability 12 / Price 12 / Sqft 8 / Lot 12 / Transit 8 / Beds 4 / Price/sqft 4 / Neighborhood bonus 6 / DOM penalty −10

**San Diego:** Property type 20 / Walkability 18 / Price 14 / Sqft 14 / Lot 12 / Beds 10 / Price/sqft 3 / ZIP bonus 12 / DOM penalty −10

**St. Louis:** Property type 18 / School district 12 / Walkability 10 / Price 20 / Sqft 8 / Lot 5 / Beds 8 / Price/sqft 15 / DOM bonus 8 / DOM penalty implicit

## Investment Mode (St. Louis)

When `investmentConfig` is present on a locale, the frontend runs `computeUpside(listing)` for each STL card and renders an investment row showing:

- **Cash flow** — monthly rent minus mortgage P&I, vacancy (8%), maintenance (8%), insurance, and property taxes
- **CoC** — cash-on-cash: annual cash flow ÷ total cash invested (25% down + reno estimate)
- **Cap rate** — NOI ÷ purchase price (financing-independent)
- **Break-even price** — max price at which monthly cash flow = 0
- **BRRRR analysis** — ARV from sold comps, forced equity, refi pull, full vs. partial BRRRR flag

Rent is sourced in priority order:
1. Cached RentCast estimate (`rental_estimates` table) — comp-based, accounts for beds/baths/sqft
2. Static `rentByCity` table in `investmentConfig` — city + bed count lookup

### `investmentConfig` fields

| Field | Description |
|---|---|
| `rentByCity` | `Record<city, Record<beds, monthlyRent>>` — static fallback rent table |
| `zipToCity` | Maps USPS zip → canonical city key (needed because STL returns "Saint Louis" for many suburbs) |
| `downPaymentPct` | e.g. `0.25` |
| `baseRate30yr` | Current 30yr fixed rate |
| `investmentRateAdder` | Premium over owner-occupied rate (typically +0.5%) |
| `vacancyRate` | Fraction of rent lost to vacancy (e.g. `0.08`) |
| `maintenanceRate` | Fraction of rent reserved for maintenance |
| `insuranceMonthly` | Fixed monthly insurance cost |
| `propertyTaxAnnualRate` | Annual tax as fraction of purchase price |
| `renoTiers` | Array of `{ maxYearBuilt, cost }` — reno estimate by age of property |
| `refinanceLtv` | LTV for BRRRR refi (e.g. `0.75`) |

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

rental_estimates (
  listing_id TEXT PRIMARY KEY,   -- FK → listings.id
  estimated_rent INTEGER,        -- monthly rent from RentCast
  rent_low INTEGER,              -- low end of RentCast range
  rent_high INTEGER,             -- high end of RentCast range
  source TEXT,                   -- 'rentcast'
  fetched_at TEXT                -- ISO timestamp; stale after 30 days
)
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
| `POST /api/digest` | Trigger an immediate poll + email digest |

## Commands

| Command | What it does |
|---|---|
| `pnpm dev` | Start web server with hot reload |
| `pnpm web` | Start web server (no reload) |
| `pnpm poll` | Fetch listings from all locales and upsert to DB |
| `pnpm enrich` | Backfill walk scores for listings missing them |
| `pnpm rent-estimate` | Fetch RentCast rent estimates for STL listings missing them |
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
| `NOTIFY_SCORE_THRESHOLD` | No | Min score for new listing email (default: 70) |
| `POLL_SCHEDULE` | No | Cron expression for auto-poll (default: `0 7 * * *`) |
| `DB_PATH` | No | SQLite file path (default: `data/listings.db`) |
| `RENTCAST_API_KEY` | No | RentCast API key for STL rent estimates (free tier: 50 req/mo) |

## Related Docs

- `src/scoring/index.ts` — full scoring implementation
- `src/locales/types.ts` — all config interfaces
- `docs/fly-deployment.md` — deploy to Fly.io
- `docs/superpowers/specs/2026-04-25-investment-mode-design.md` — investment mode design spec

---

**Last Updated:** April 27, 2026
**Author:** Daniel Wolner
