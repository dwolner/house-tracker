# House Tracker Roadmap

## Up Next

### Deploy
- **Fly.io deployment** — get polling running 24/7 without the laptop
  - `fly launch`, volume creation, secrets, `fly deploy`
  - See `docs/fly-deployment.md` for exact steps

### Intelligence
- **Starred listing weighting** — use starred listings as a preference signal
  - Extract feature vector from starred set (city, sqft range, price range, school district)
  - Tag new listings "similar to your favorites" in dashboard and email
  - Long term: re-weight scoring factors based on starred listing characteristics

### Analytics
- **Historical stats panel** — sold comps and market trends using inactive listings
  - Median list price by city over time
  - Average days on market trends
  - Score distribution of what actually sold vs. what lingered

### Dashboard
- **Price history sparkline** — small inline chart per card showing price over time
  - `price_history` table already populated; needs a Chart.js sparkline per listing card

## Completed

- [x] Redfin polling — active + coming soon, multiple Main Line regions
- [x] Walk score enrichment — via Redfin internal neighborhood stats API
- [x] School district enrichment — via US Census geocoder (lat/lng → district name)
- [x] Scoring model — 100-point weighted scale (property type, school, walkability, price, sqft, lot, Amtrak, beds, $/sqft, Narberth bonus, DOM penalty)
- [x] Web dashboard — cards, sidebar filters, dark mode, photos, score breakdown chips
- [x] Star / favorite listings — persisted in DB, visible on cards
- [x] Daily cron scheduling — `node-cron` inside server process, configurable via `POLL_SCHEDULE`
- [x] New listing email — dark-themed card-style digest, only for listings above score threshold
- [x] Price drop / status change email — batched daily digest from cron, not manual polls
- [x] Inactive listing detection — listings not seen in 36h marked inactive; score_breakdown pruned after 6 months
- [x] Open house mode — badge on cards, sidebar filter, sorts by soonest date
- [x] Pending/under contract tracking — status=130 polled, active→pending transition recorded with `pending_at` + `pending_price`
- [x] Sold tracking — status=131 polled each region, `sold_at` + `sold_price` recorded for tracked listings
- [x] Outcomes analytics — Inventory tab shows pending count, sold count, median DOM, list→pending Δ, list→sale Δ, scatter chart (DOM vs price %), full table
- [x] Score → outcome correlation — scatter chart (DOM vs list/sale price %) in Inventory tab
- [x] Map view — Leaflet, score-colored markers, zip code boundaries from Census TIGER, legend
- [x] View switcher — sidebar tabs for Listings / Map / Inventory
- [x] King of Prussia added — region 7530, Upper Merion SD scored at 9
- [x] Multi-locale support — `LocaleConfig` system with per-locale regions, hard filters, and fully configurable scoring weights; `locale_id` stored on every listing; API routes accept `?locale_id=` filter
- [x] San Diego locale — 7 neighborhoods (Bay Park, Point Loma Heights, Kensington, Bay Ho, North Park, Mission Hills, Allied Gardens); ZIP bonus replaces school district; transit factor omitted; tuned price/sqft breakpoints for SD market
- [x] Dockerfile — multi-stage Node 20 Alpine build
- [x] DB_PATH env var — `src/db/index.ts` reads `process.env.DB_PATH`, falls back to local `data/`
- [x] Fly.io deployment guide — `docs/fly-deployment.md`

**Last Updated:** April 24, 2026
**Author:** Daniel Wolner
