# House Tracker — Architecture

## Overview

A personal tool for tracking new real estate listings across multiple locales. It polls Redfin for active listings across all configured regions, scores each against locale-specific weighted preferences, stores results in SQLite, and displays them in a local web dashboard.

## Locale System

Each locale lives in `src/locales/` and implements `LocaleConfig`:

```
src/locales/
  types.ts        — all config interfaces (LocaleConfig, ScoringConfig, etc.)
  index.ts        — LOCALES registry (Record<string, LocaleConfig>) + getLocale(id)
  main-line.ts    — PA Main Line definition
  san-diego.ts    — San Diego definition
```

**`LocaleConfig`** fields:
- `id` — unique key (used in DB as `locale_id`)
- `name` — display name
- `state` — expected state abbreviation (listings from other states are dropped at poll time)
- `regions` — array of `RedfinRegion` (`name`, `region_id`, `region_type`)
- `minBeds`, `maxPrice` — hard filter applied before DB insert
- `scoring` — `ScoringConfig` (all fields optional; omitted factors score 0)

To add a locale: create `src/locales/{name}.ts`, export a `LocaleConfig`, add it to `LOCALES` in `index.ts`.

## Configured Locales

| Locale ID | Name | State | Regions |
|---|---|---|---|
| `main-line` | PA Main Line | PA | Narberth/Penn Valley, Ardmore, Bryn Mawr, Bala Cynwyd, Merion Station, Haverford, Wynnewood, Wayne, Berwyn, King of Prussia |
| `san-diego` | San Diego | CA | Bay Park/Loma Portal, Point Loma Heights, Kensington/Talmadge, Bay Ho, North Park, Mission Hills, Allied Gardens |

## Components

```
src/
  locales/          — locale definitions and scoring config (see above)
  poller/
    redfin.ts       — Redfin CSV API client
    index.ts        — Poll orchestration (iterates LOCALES → regions, upserts listings)
  enrichment/
    walk-score.ts   — Walk score enrichment (pulls from Redfin's internal API)
  scoring/
    index.ts        — Locale-aware weighted scoring engine (scoreWithBreakdown)
  db/
    index.ts        — SQLite schema, migrations, upsert logic, outcomes tracking
  web/
    server.ts       — Fastify server + node-cron scheduler
    routes.ts       — API routes (/api/listings, /api/stats, /api/inventory, /api/poll)
    public/
      index.html    — Static shell
      app.js        — Client JS (filters, score breakdown chips, inventory chart, map)
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
         fetchRegionListings()     — GET /stingray/api/gis-csv (Redfin)
         drop listings where state ≠ locale.state
         scoreWithBreakdown(l, locale)  — 0–100 + per-factor breakdown
         upsertListing({ ...l, locale_id: locale.id, score, breakdown })
         logPoll()

pnpm enrich
  └─ getListingsMissingWalkScore()     — SELECT WHERE walk_score IS NULL
  └─ fetchWalkScoreFromRedfin()        — GET /stingray/api/home/details/neighborhoodStats/statsInfo
  └─ re-scoreWithBreakdown(l, locale)  — uses getLocale(locale_id) from DB row
  └─ updateListingWalkScore()

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

Walk score is **not** included in the CSV.

### Walk Score (internal, no auth required)
```
GET /stingray/api/home/details/neighborhoodStats/statsInfo?propertyId={id}&accessLevel=1
```
- `propertyId` from listing URL: `.../home/12345678` → `12345678`
- Response prefixed with `{}&&` — strip first 4 chars before `JSON.parse()`
- Walk score at `payload.walkScoreInfo.walkScoreData.walkScore.value`

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
| `price` | `PriceConfig` | Piecewise linear: excellent → full, good → half, max → 0 |
| `sqft` | `SqftConfig` | Linear interpolation across sorted breakpoints |
| `lot` | `LotConfig` | Linear interpolation across sorted breakpoints (acres) |
| `transit` | `TransitConfig` | Haversine distance to nearest station |
| `beds` | `BedsConfig` | Descending step function; first match wins |
| `pricePerSqft` | `PricePerSqftConfig` | Piecewise linear on $/sqft |
| `neighborhoodBonus` | `NeighborhoodBonusConfig` | Distance from center; city-gated |
| `zipBonus` | `ZipBonusConfig` | Full bonus for listed ZIP codes |
| `domPenalty` | `DomPenaltyConfig` | Subtracted after normalization; full at 120+ DOM |

### Main Line scoring weights
Property type 20 / School district 20 / Walkability 12 / Price 12 / Sqft 8 / Lot 12 / Transit 8 / Beds 4 / Price/sqft 4 / Neighborhood bonus 6 / DOM penalty −10

### San Diego scoring weights
Property type 20 / Walkability 18 / Price 14 / Sqft 14 / Lot 12 / Beds 10 / Price/sqft 3 / ZIP bonus 12 / DOM penalty −10 (no school district or transit factors)

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
  status TEXT,
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
  status_label TEXT,
  school_district TEXT,          -- from Census geocoder enrichment
  locale_id TEXT                 -- e.g. 'main-line', 'san-diego'
)

price_history (listing_id, price, recorded_at)
poll_log (polled_at, area, listings_found, new_listings)
listing_changes (listing_id, change_type, old_value, new_value, changed_at, notified)
```

`locale_id` defaults to `'main-line'` for rows inserted before multi-locale support was added.

## API Routes

| Route | Description |
|---|---|
| `GET /api/listings` | Active listings; supports `?locale_id=` filter |
| `GET /api/stats` | Summary stats; supports `?locale_id=` filter |
| `GET /api/inventory` | Inventory trends over time; supports `?locale_id=` filter |
| `POST /api/poll` | Trigger an immediate poll |

## Commands

| Command | What it does |
|---|---|
| `pnpm dev` | Start web server with hot reload |
| `pnpm web` | Start web server (no reload) |
| `pnpm poll` | Fetch listings from all locales and upsert to DB |
| `pnpm enrich` | Backfill walk scores for listings missing them |
| `pnpm build` | Compile TypeScript to `dist/` |
| `pnpm start` | Run compiled output |

## Related Docs

- `src/scoring/index.ts` — full scoring implementation
- `src/locales/types.ts` — all config interfaces
- `docs/fly-deployment.md` — deploy to Fly.io

---

**Last Updated:** April 24, 2026
**Author:** Daniel Wolner
