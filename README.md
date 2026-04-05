# House Tracker

A personal home search tracker for the Philadelphia Main Line area. Polls Redfin for new listings, scores them against preferences, and surfaces the best matches in a dashboard.

---

## What It Does

- Polls Redfin every 6 hours across 7 target areas
- Scores each listing 0–100 based on weighted preferences
- Tracks price history and days on market over time
- Alerts on high-scoring new listings
- Dashboard for browsing, comparing, and tracking inventory trends

---

## Search Area

**Primary (Lower Merion School District):**
- Narberth / Penn Valley
- Ardmore
- Bryn Mawr
- Bala Cynwyd
- Merion Station

**Secondary (outside Lower Merion SD, penalized in score):**
- Wayne
- Berwyn

---

## Scoring Model

Each listing is scored 0–100. Higher is better.

| Factor | Max Pts | Notes |
|--------|---------|-------|
| Property type | 20 | SFD = 20, twin/townhouse = 6, condo = 0 |
| School district | 20 | Lower Merion = 20, secondary = 8, other = 0 |
| Walkability | 15 | Walk Score / 100 × 15 (defaults to 8 if unknown) |
| Price | 15 | <$1M = 15, $1–1.5M tapers to 8, $1.5–2M tapers to 3 |
| Sqft | 10 | Hard floor at 1,500 sqft; max at 2,500+ |
| Lot size | 15 | <0.1ac = ~0, 0.2ac = 8, 0.4ac+ = 15 |
| Amtrak proximity | 10 | Distance to nearest of ARD/PAO/EXT/DOW stations |
| Beds | 5 | ≥4bd = 5, 3bd = 3, <3bd = 0 (hard filter upstream) |
| Narberth bonus | +8 | Only Narberth listings close to town center/SEPTA station |
| DOM penalty | −10 | >30 DOM = small penalty, >60 = moderate, >120 = −10 |

**Hard filters (dropped before DB):**
- Beds < 3
- Price > $2,000,000
- Blank address
- 0 beds (Redfin data error)

**Key preferences:**
- Single family detached strongly preferred
- Minimum ~1,500 sqft (2,000+ preferred)
- Yard matters — 0.1ac is the practical floor
- Lower Merion SD is a strong preference
- Narberth is the top town; low inventory makes it a trigger area
- Amtrak access to Harrisburg for family visits (not daily commute)
- Budget: ~$1M target, up to $2M ceiling

---

## Build Plan

### ✅ Step 1 — Poller + Storage
Redfin CSV API client polling 7 regions every 6 hours. SQLite database stores listings, price history, and poll log. Scoring applied on ingest.

### 🔲 Step 2 — Dashboard (next)
Local web UI (Fastify) showing:
- Ranked listing cards with score breakdown
- Filters: min score, city, price range, beds
- Inventory trend chart per area over time
- Price history per listing
- Direct link to Redfin listing

### 🔲 Step 3 — Email / Notification Alerts
When a new listing scores above threshold (TBD, ~80), send an alert with listing details and score breakdown.

### 🔲 Step 4 — Deploy
Docker container deployed to Railway or Fly.io so the dashboard is accessible via URL. Wife access included.

### 🔲 Step 5 — Enrichment (stretch)
- Walk Score API to fill in real walkability data
- School district boundary verification via geo lookup
- Automated Redfin price history enrichment

---

## Tech Stack

| Layer | Tool |
|-------|------|
| Runtime | Node.js 22, TypeScript, ESM |
| Package manager | pnpm |
| Database | SQLite via `better-sqlite3` |
| HTTP client | `node-fetch` |
| Scheduler | `node-cron` (Step 3+) |
| Web server | Fastify (Step 2+) |
| Deployment | Docker + Railway/Fly.io (Step 4) |

---

## Running Locally

```bash
pnpm install
pnpm poll         # run one poll immediately
pnpm dev          # start the dashboard + background polling (Step 2+)
```

---

## Project Structure

```
house-tracker/
├── src/
│   ├── poller/
│   │   ├── redfin.ts       # Redfin CSV API client + region definitions
│   │   └── index.ts        # Poll orchestration
│   ├── scoring/
│   │   └── index.ts        # Weighted scoring model + breakdown
│   ├── db/
│   │   └── index.ts        # SQLite schema, upsert, poll log
│   ├── notifications/      # Step 3
│   └── web/                # Step 2
├── data/
│   └── listings.db         # SQLite database (gitignored)
├── README.md
└── package.json
```

---

**Last Updated:** April 3, 2026
