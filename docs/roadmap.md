# House Tracker Roadmap

## Up Next

### Preference Learning

- **Interactive scoring calibration** — surface listings across the score spectrum and learn from your reactions
  - Dedicated calibration view: shows a curated set of low/medium/high scored listings side by side
  - For each listing: thumbs up/down + optional freetext reason ("too small", "love the neighborhood", "price is too high")
  - Reactions stored in a `listing_feedback` table (`listing_id`, `rating`, `reason`, `created_at`)
  - Analysis layer: compares feature vectors of liked vs. disliked listings to surface weight mismatches
    - e.g. "You liked 3 listings under 1,800 sqft — sqft weight may be too aggressive"
    - e.g. "You disliked 4 listings with walk score > 80 — walkability may be overweighted for your use case"
  - Scoring adjustment suggestions: proposed weight deltas shown as a diff, applied with one click
  - Long term: auto-apply learned weights per locale, track score drift over time

### Intelligence

- **Starred listing weighting** — use starred listings as a preference signal
  - Extract feature vector from starred set (city, sqft range, price range, school district)
  - Tag new listings "similar to your favorites" in dashboard and email
  - Can share the feedback table with the calibration system above

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
- [x] Open house mode — badge in card footer, sidebar filter, sorts by soonest date; tip-box tooltip shows day/time
- [x] Pending/under contract tracking — status=130 polled, active→pending transition recorded with `pending_at` + `pending_price`
- [x] Sold tracking — status=131 polled each region, `sold_at` + `sold_price` recorded for tracked listings
- [x] Outcomes analytics — Inventory tab shows pending count, sold count, median DOM, list→pending Δ, list→sale Δ, scatter chart (DOM vs price %), full table
- [x] Score → outcome correlation — scatter chart (DOM vs list/sale price %) in Inventory tab
- [x] Map view — Leaflet, score-colored markers, zip code boundaries from Census TIGER, legend
- [x] View switcher — sidebar tabs for Listings / Map / Inventory
- [x] King of Prussia added — region 7530, Upper Merion SD scored at 9
- [x] Multi-locale support — `LocaleConfig` system with per-locale regions, hard filters, and fully configurable scoring weights; `locale_id` stored on every listing; API routes accept `?locale_id=` filter
- [x] San Diego locale — 7 neighborhoods (Bay Park, Point Loma Heights, Kensington, Bay Ho, North Park, Mission Hills, Allied Gardens); ZIP bonus replaces school district; transit factor omitted; tuned price/sqft breakpoints for SD market
- [x] Dockerfile — npm-based, multi-stage Node 20 build; static assets copied separately
- [x] DB_PATH env var — `src/db/index.ts` reads `process.env.DB_PATH`, falls back to local `data/`
- [x] Fly.io deployment — live at `house-tracker-kgg27w.fly.dev`; persistent volume, all secrets deployed, daily cron running
- [x] St. Louis locale — 12 suburbs (Kirkwood, Glendale, Webster Groves, Rock Hill, Maplewood, Richmond Heights, Ladue, Clayton, Shrewsbury, Des Peres, Sunset Hills, Crestwood); investment-tuned scoring (price/sqft dominant, lot de-weighted, DOM bonus for motivated sellers); `useJsonApi: true` routes to Redfin's JSON GIS endpoint to bypass MARIS MLS CSV restriction
- [x] Investment mode (STL) — `computeUpside()` computes cash flow, CoC return, cap rate, break-even price, and BRRRR analysis per listing; driven by per-city rent table and locale `investmentConfig`; investment rows rendered on STL cards with color-coded cash flow and tooltips on all terms
- [x] STL sold comps — `getSoldComps()` computes median $/sqft from the last 12 months of sold listings per city (min 3 sales); powers BRRRR ARV estimate
- [x] Rent estimates via RentCast — `src/enrichment/rent-estimate.ts` fetches comp-based rent estimates (beds + baths + sqft); cached in `rental_estimates` (30-day TTL); hard limits: 50 calls/30-day period and 1/day (`RENTCAST_DAILY_LIMIT`) enforced via `rentcast_usage` table; card label and tooltip reflect source
- [x] RentCast 3-tier rent priority — `resolveRentOverride`: (1) direct RentCast estimate for this listing, (2) premium-ratio derived: `median(RentCast[comp]/table[comp]) × table[thisListing]` normalizes geographic noise across neighborhoods, (3) static `rentByCity` table fallback; requires ≥1 comp for derived
- [x] `rentUsed`/`rentSource` in score_breakdown — written at score time so UI reads from there; eliminates frontend/backend divergence on which rent was used
- [x] RentCast billing period tracking — `getRentcastUsage` derives 30-day period start from `MIN(called_at)`; auto-rolls every 30 days; no manual config needed
- [x] Round-robin ZIP selection — `getListingsNeedingRentEstimate` uses `ROW_NUMBER() OVER (PARTITION BY zip)` CTE so N daily calls always cover N different ZIPs, ordered by least-covered first
- [x] `pnpm rescore [locale]` — standalone script to re-score all listings with current FRED rate + latest RentCast data without running a full poll
- [x] Investment sort options (STL) — sidebar sort control (score / cash flow / cap rate); only visible on STL locale; resets on locale switch
- [x] Dynamic property type filter — populated from live data per locale via `/api/stats`; replaces hardcoded options
- [x] Address search filter — free-text search across address, city, and zip
- [x] Score badge tooltip — hovering the score circle shows a compact bar breakdown of each scoring factor, normalized to 0–100, color-coded by performance tier
- [x] Card UI overhaul — lot size abbreviation (ac/k sf/sf); DOM directional signals (↑/↓); property type pill overlaid on photo (top-right, blurred background); neighborhood + school district merged to one dim line; open house moved to card footer as green action button; photo gradient overlay; listed date removed (DOM only shown)
- [x] Global tip-box tooltip system — single fixed-position `#tip-box` div that escapes `overflow:hidden` card clipping; supports plain text (`data-tip`) and rich HTML (`data-tip-id` + JS map)
- [x] Mobile nav improvements — `env(safe-area-inset-bottom)` padding for iOS Safari; Filters slide-in panel with overlay on mobile
- [x] Price filter default per locale — STL defaults to $500K max; resets correctly on locale switch
- [x] `investmentScore` scoring factor — composite 0–weight factor inside `scoreWithBreakdown`: 40% cash flow + 35% cap rate + 25% CoC; zero if rent unknown; stored in `score_breakdown.factors` alongside other factors
- [x] STL scoring calibration (Apr 2026) — `rentByCity` updated from actual RentCast AVM data per city/bed tier; walkability 10→6; `capRateGood` 5%→3%, `capRateExcellent` 8%→6%; `domBonus` 8→4
- [x] SD scoring rebalance — `pricePerSqft` weight 3→10 (now a primary differentiator); `zipBonus` removed; `domPenalty` 10→6
- [x] Main Line `domPenalty` 10→6 (consistent across locales)
- [x] FRED mortgage rate at startup — `getCurrentMortgageRate()` seeded non-blocking on server start so first web request has a live rate
- [x] Email redesign — light theme palette (`LIGHT`) alongside dark; card layout: price+score in same header row, type pill above card, DOM inline with score badge; `buildPreviewHtml` export; `GET /email-preview?locale=&n=&theme=` route for browser preview

---

**Last Updated:** April 29, 2026
**Author:** Daniel Wolner
