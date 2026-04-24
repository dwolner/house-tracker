# House Tracker

A personal home search tracker supporting multiple locales (PA Main Line, San Diego). Polls Redfin for new listings, scores them against locale-specific preferences, and surfaces the best matches in a dashboard.

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
| DOM penalty | Subtracted from total; full penalty at 120+ DOM |

### Locale-specific factors

| Factor | Locale | Notes |
|--------|--------|-------|
| School district | Main Line | Lower Merion = 20pts; named districts get partial credit |
| Transit (Amtrak) | Main Line | Distance to ARD/PAO/EXT/DOW stations |
| Neighborhood bonus | Main Line | Narberth listings near SEPTA station get up to +6 pts |
| ZIP bonus | San Diego | Full bonus for 92110 (Bay Park) and 92107 (Point Loma Heights) |

### Hard filters (per locale, applied before DB insert)

**Main Line:** beds < 3, price > $2,000,000, blank address, 0 beds
**San Diego:** beds < 3, price > $2,500,000, blank address, 0 beds

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
```

---

## Project Structure

```
house-tracker/
├── src/
│   ├── locales/
│   │   ├── types.ts        # LocaleConfig and all sub-config interfaces
│   │   ├── index.ts        # LOCALES registry + getLocale()
│   │   ├── main-line.ts    # PA Main Line locale definition
│   │   └── san-diego.ts    # San Diego locale definition
│   ├── poller/
│   │   ├── redfin.ts       # Redfin CSV API client
│   │   └── index.ts        # Poll orchestration (iterates all locale regions)
│   ├── scoring/
│   │   └── index.ts        # Locale-aware weighted scoring engine
│   ├── db/
│   │   └── index.ts        # SQLite schema, upsert, poll log, outcomes tracking
│   ├── enrichment/
│   │   └── walk-score.ts   # Walk score enrichment via Redfin internal API
│   ├── notifications/
│   │   └── email.ts        # Daily email digest (new listings + changes)
│   └── web/
│       ├── server.ts       # Fastify server + cron scheduling
│       ├── routes.ts       # API routes (/api/listings, /api/stats, /api/inventory)
│       └── public/         # Static dashboard (HTML/JS/CSS)
├── data/
│   └── listings.db         # SQLite database (gitignored)
├── docs/
│   ├── architecture.md
│   ├── roadmap.md
│   └── fly-deployment.md
└── package.json
```

---

**Last Updated:** April 24, 2026
