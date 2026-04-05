# House Tracker — Architecture

## Overview

A personal tool for tracking new real estate listings on the Philadelphia Main Line. It polls Redfin for active listings across 7 target areas, scores each against weighted preferences, stores results in SQLite, and displays them in a local web dashboard.

## Target Areas

| Region | Redfin region_id | District |
|---|---|---|
| Narberth / Penn Valley | 13565 | Lower Merion SD |
| Ardmore | 30811 | Lower Merion SD |
| Bryn Mawr | 21717 | Lower Merion SD |
| Bala Cynwyd | 36379 | Lower Merion SD |
| Merion Station | 36339 | Lower Merion SD |
| Haverford | 7344 (zip 19041, region_type 2) | Lower Merion SD |
| Wynnewood | 7388 (zip 19096, region_type 2) | Lower Merion SD |
| Wayne | 37906 | Wayne-Radnor SD |
| Berwyn | 31134 | Downingtown SD |

## Components

```
src/
  poller/
    redfin.ts       — Redfin CSV API client
    index.ts        — Poll orchestration (iterates regions, upserts listings)
  enrichment/
    walk-score.ts   — Walk score enrichment (pulls from Redfin's internal API)
  scoring/
    index.ts        — Weighted scoring model (0–100)
  db/
    index.ts        — SQLite schema, migrations, upsert logic
  web/
    server.ts       — Fastify server
    routes.ts       — API routes (/api/listings, /api/stats, /api/inventory, /api/poll)
    public/
      index.html    — Static shell (inline theme script prevents flash)
      app.js        — Client JS (filters, score breakdown chips, inventory chart)
      style.css     — CSS custom properties for light/dark theme
  index.ts          — Entry point
data/
  listings.db       — SQLite database (gitignored)
```

## Data Flow

```
pnpm poll
  └─ fetchRegionListings()   — GET /stingray/api/gis-csv (Redfin)
  └─ scoreWithBreakdown()    — compute 0–100 score + per-factor breakdown
  └─ upsertListing()         — INSERT or UPDATE listings table
  └─ logPoll()               — INSERT into poll_log

pnpm enrich
  └─ getListingsMissingWalkScore()     — SELECT WHERE walk_score IS NULL
  └─ fetchWalkScoreFromRedfin()        — GET /stingray/api/home/details/neighborhoodStats/statsInfo
  └─ scoreWithBreakdown()              — re-score with walk_score populated
  └─ updateListingWalkScore()          — UPDATE listings SET walk_score, score, score_breakdown

pnpm web  (or pnpm dev)
  └─ Fastify serves src/web/public/ as static files
  └─ API routes read from listings.db
```

## Redfin APIs Used

### Listing CSV
```
GET /stingray/api/gis-csv?region_id=13565&region_type=6&uipt=1,2,3&status=9&num_beds=3&max_price=2000000&num_homes=350&v=8
```
Returns CSV with headers: `ADDRESS`, `CITY`, `PRICE`, `BEDS`, `BATHS`, `SQUARE FEET`, `LOT SIZE`, `YEAR BUILT`, `PROPERTY TYPE`, `DAYS ON MARKET`, `LATITUDE`, `LONGITUDE`, `MLS#`, `URL (see …)`, `STATUS`.

Walk score is **not** included in the CSV.

### Walk Score (internal, no auth required)
```
GET /stingray/api/home/details/neighborhoodStats/statsInfo?propertyId={id}&accessLevel=1
```
- `propertyId` is extracted from the listing URL: `.../home/12345678` → `12345678`
- Response is prefixed with `{}&&` — strip first 4 chars before `JSON.parse()`
- Walk score lives at `payload.walkScoreInfo.walkScoreData.walkScore.value`

## Scoring Model

Scores are computed by `scoreWithBreakdown()` in `src/scoring/index.ts`. Each factor scores independently; the total is clamped 0–100.

| Factor | Max pts | Notes |
|---|---|---|
| Property type | 20 | SFD=20, twin/townhouse=6, other=0 |
| School district | 20 | Lower Merion cities=20, Wayne/Berwyn=8, other=0 |
| Walkability | 15 | `walk_score / 100 * 15`; null → 0 |
| Price | 15 | Full 15 at ≤$1M; fades to 0 at $2M |
| Sqft | 10 | 0 below 1,500 sqft; 10 at 2,500+ |
| Lot size | 15 | 0 below 0.1ac; full 15 at 0.4ac+ |
| Amtrak proximity | 10 | Distance to nearest Keystone station (ARD/PAO/EXT/DOW) |
| Beds | 5 | 4+=5, 3bd=3, else 0 |
| Narberth bonus | +8 | Only Narberth listings; distance to SEPTA station |
| DOM penalty | −10 | Applied only when days_on_market is known |

Unknown values (`null`) always score 0 — no arbitrary defaults.

**Amtrak stations:** Ardmore (40.0087, -75.2966), Paoli (40.0423, -75.4852), Exton (40.0284, -75.6213), Downingtown (40.0065, -75.7035).

**Narberth SEPTA proxy:** (40.0066, -75.2661) — used as a proxy for walkability to the Narberth town center.

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
  price_at_first_seen INTEGER
)

price_history (listing_id, price, recorded_at)
poll_log (polled_at, area, listings_found, new_listings)
```

## Commands

| Command | What it does |
|---|---|
| `pnpm dev` | Start web server with hot reload |
| `pnpm web` | Start web server (no reload) |
| `pnpm poll` | Fetch listings from Redfin and upsert to DB |
| `pnpm enrich` | Backfill walk scores from Redfin for listings missing them |
| `pnpm build` | Compile TypeScript to `dist/` |
| `pnpm start` | Run compiled output |

## Pending Features

- Scheduled polling (node-cron, every 6 hours)
- New listing alerts above score threshold
- Docker + Railway/Fly.io deployment

## Related Docs

- See `src/scoring/index.ts` for the full scoring implementation
- See `src/poller/redfin.ts` for Redfin CSV parsing details

---

**Last Updated:** April 3, 2026
**Author:** Daniel Wolner
