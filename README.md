# House Tracker

A personal home search tracker supporting multiple locales (PA Main Line, San Diego, St. Louis). Polls Redfin for new listings, scores them against locale-specific preferences, and surfaces the best matches in a dashboard. St. Louis includes investment analysis: cash flow, cap rate, CoC, and BRRRR projections powered by live RentCast rent estimates.

---

## What It Does

- Polls Redfin every day across all configured locale regions
- Scores each listing 0–100 based on locale-specific weighted preferences
- Tracks price history and days on market over time
- Alerts on high-scoring new listings via daily email digest
- Dashboard for browsing, comparing, and tracking inventory trends
- Tracks pending/sold outcomes and displays outcomes analytics

---

## Locales

The system supports multiple locales. Each locale defines its own regions, hard filters, and scoring model.

| Locale ID | Name | State | Regions |
|-----------|------|-------|---------|
| `main-line` | PA Main Line | PA | Narberth/Penn Valley, Ardmore, Bryn Mawr, Bala Cynwyd, Merion Station, Haverford, Wynnewood, Wayne, Berwyn, King of Prussia |
| `san-diego` | San Diego | CA | Bay Park/Loma Portal, Point Loma Heights, Kensington/Talmadge, Bay Ho, North Park, Mission Hills, Allied Gardens |
| `st-louis` | St. Louis Suburbs | MO | Kirkwood, Glendale, Webster Groves, Rock Hill, Maplewood, Richmond Heights, Ladue, Clayton, Shrewsbury, Des Peres, Sunset Hills, Crestwood |

Adding a new locale means creating a file in `src/locales/` and registering it in `src/locales/index.ts`.

---

## Scoring Model

Scores are computed per listing using the locale's `ScoringConfig`. Each factor is weighted independently; the total is normalized to 0–100.

### Shared factors (all locales)

| Factor | Notes |
|--------|-------|
| Property type | SFD scores highest; townhouse/twin partial; condo/other = 0 |
| Walkability | `walk_score / 100 × weight`; null → 0 |
| Price | Three-point linear fade: excellent → full, good → half, max → 0 |
| Sqft | Piecewise linear breakpoints; under floor = 0 |
| Lot size | Piecewise linear breakpoints by acreage |
| Beds | Step function; 4+ best |
| Price/sqft | Three-point linear fade; below excellent = full weight |
| DOM bonus | Bonus for high-DOM listings (motivated seller signal); 30–60d partial, 120d+ full |
| DOM penalty | Subtracted from total; full penalty at 120+ DOM |

### Locale-specific factors

| Factor | Locale | Notes |
|--------|--------|-------|
| School district | Main Line, STL | Lower Merion = full weight; named districts partial; city fallback |
| Transit (Amtrak) | Main Line | Haversine distance to ARD/PAO/EXT/DOW stations |
| Neighborhood bonus | Main Line | Narberth listings near SEPTA station |
| Investment score | St. Louis | 40% cash flow + 35% cap rate + 25% CoC; uses RentCast rent if available |

### Hard filters (per locale, applied before DB insert)

**Main Line:** beds < 3, price > $2,000,000
**San Diego:** beds < 3, price > $2,500,000
**St. Louis:** beds < 3, price > $500,000

Additionally, listings whose state doesn't match the locale's expected state are dropped (Redfin region IDs are not globally unique).

---

## Tech Stack

| Layer | Tool |
|-------|------|
| Runtime | Node.js 22, TypeScript, ESM |
| Package manager | pnpm |
| Database | SQLite via `better-sqlite3` |
| HTTP client | `node-fetch` |
| Scheduler | `node-cron` |
| Web server | Fastify |
| Deployment | Docker + Fly.io |

---

## Running Locally

```bash
pnpm install
pnpm poll         # run one poll immediately (all locales)
pnpm dev          # start dashboard + background polling
pnpm rescore      # re-score all listings with current mortgage rate + RentCast data
pnpm rent-estimate  # fetch RentCast rent estimates for STL listings
```

---

## Project Structure

```
house-tracker/
├── src/
│   ├── locales/
│   │   ├── types.ts         # LocaleConfig and all sub-config interfaces
│   │   ├── index.ts         # LOCALES registry + getLocale()
│   │   ├── main-line.ts     # PA Main Line locale definition
│   │   ├── san-diego.ts     # San Diego locale definition
│   │   └── st-louis.ts      # St. Louis locale definition (investment mode)
│   ├── poller/
│   │   ├── redfin.ts        # Redfin CSV + JSON GIS API clients
│   │   └── index.ts         # Poll orchestration (iterates all locale regions)
│   ├── scoring/
│   │   └── index.ts         # Locale-aware weighted scoring engine (scoreWithBreakdown)
│   ├── db/
│   │   └── index.ts         # SQLite schema, upsert, poll log, outcomes tracking
│   ├── rescore.ts           # Re-score all listings with current FRED rate + RentCast data
│   ├── enrichment/
│   │   ├── walk-score.ts    # Walk score enrichment via Redfin internal API
│   │   ├── rent-estimate.ts # RentCast rent estimates + 3-tier resolveRentOverride
│   │   └── mortgage-rate.ts # FRED 30yr mortgage rate (cached, 6.9% fallback)
│   ├── notifications/
│   │   └── email.ts         # Email digest: dark + light theme, /email-preview support
│   └── web/
│       ├── server.ts        # Fastify server + cron scheduling
│       ├── routes.ts        # API routes + /email-preview
│       └── public/          # Static dashboard (HTML/JS/CSS)
├── scripts/
│   ├── push-db.sh           # Checkpoint + upload local DB to Fly.io volume
│   └── clear-stale.sh       # Remove inactive listings older than threshold
├── data/
│   └── listings.db          # SQLite database (gitignored)
├── docs/
│   ├── architecture.md
│   ├── roadmap.md
│   └── fly-deployment.md
└── package.json
```

---

**Last Updated:** April 29, 2026
