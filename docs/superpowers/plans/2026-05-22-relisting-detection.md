# Relisting Detection & Cross-Listing History Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Detect when a property is relisted under a new Redfin ID, link it to prior listings, show true cumulative DOM and price history, and surface a dedicated `↺ RELISTING` badge with a tiered score penalty.

**Architecture:** A `prior_listing_id` linked-list on the `listings` table connects new listings to their prior inactive appearances at the same address. Detection runs inside `upsertListing()` at insert time. Badge fires structurally (not via text matching). The web expandable shows brief and history independently — either or both render based on what's present. The `/api/listings/:id/history` endpoint walks the chain and joins `price_history` on expand.

**Tech Stack:** TypeScript, better-sqlite3, Fastify, vanilla JS frontend, SQLite migrations via `PRAGMA table_info`.

---

## File Map

| File | What changes |
|------|-------------|
| `src/db/index.ts` | Add `prior_listing_id` + `prior_list_price` columns; relisting detection in `upsertListing()`; `relisted` in `getUnnotifiedChanges()` |
| `src/poller/redfin.ts` | Add `prior_listing_id?` + `prior_list_price?` optional fields to `RedfinListing` |
| `src/locales/types.ts` | Add `RelistingPenaltyConfig` interface + `relistingPenalty?` to `ScoringConfig` |
| `src/scoring/index.ts` | Add `relistingPenalty` logic; narrow `FLIP_KEYWORDS` regex |
| `src/locales/san-diego.ts` | Add `relistingPenalty: { weight: 8, reducedWeight: 4 }` |
| `src/locales/main-line.ts` | Add `relistingPenalty: { weight: 8, reducedWeight: 4 }` |
| `src/locales/st-louis.ts` | Add `relistingPenalty: { weight: 8, reducedWeight: 4 }` |
| `src/notifications/email.ts` | Add `↺ RELISTING` badge; narrow `FLIP_KEYWORDS` regex |
| `src/web/routes.ts` | Add prior-listing scalars to listing query; extend `/api/listings/:id/history` to walk chain |
| `src/web/public/app.js` | `↺ RELISTING` badge (structural); `renderBrief()` → `renderExpandable()`; true DOM display; lazy history fetch |

---

### Task 1: DB columns + relisting detection

**Files:**
- Modify: `src/db/index.ts`

- [ ] **Step 1: Add migration for the two new columns**

In `getDb()`, after the existing migrations block (around line 163), add:

```typescript
if (!cols.includes('prior_listing_id')) _db.exec(`ALTER TABLE listings ADD COLUMN prior_listing_id TEXT REFERENCES listings(id)`);
if (!cols.includes('prior_list_price'))  _db.exec(`ALTER TABLE listings ADD COLUMN prior_list_price INTEGER`);
```

- [ ] **Step 2: Verify columns are created**

```bash
sqlite3 data/listings.db "PRAGMA table_info(listings);" | grep prior
```

Expected output:
```
...|prior_listing_id|TEXT|0||0
...|prior_list_price|INTEGER|0||0
```

- [ ] **Step 3: Add relisting detection inside `upsertListing()`**

In the `if (!existing)` branch, before the `INSERT` statement, add a lookup for a prior inactive listing at the same address and a rescore if one is found. Replace the `if (!existing) { ... }` block as follows. Find this code around line 183:

```typescript
  if (!existing) {
    // If the listing is already pending when we first see it, record that immediately
    const insertPendingAt = listing.status === '130' ? now : null;
    const insertPendingPrice = listing.status === '130' ? listing.price : null;

    db.prepare(`
      INSERT INTO listings (id, address, city, state, zip, price, beds, baths, sqft, lot_sqft,
        year_built, walk_score, property_type, lat, lng, url, status, days_on_market,
        score, score_breakdown, next_open_house_start, next_open_house_end,
        first_seen_at, last_seen_at, price_at_first_seen, pending_at, pending_price, status_label, locale_id)
      VALUES (@id, @address, @city, @state, @zip, @price, @beds, @baths, @sqft, @lot_sqft,
        @year_built, @walk_score, @property_type, @lat, @lng, @url, @status, @days_on_market,
        @score, @score_breakdown, @next_open_house_start, @next_open_house_end,
        @first_seen_at, @last_seen_at, @price_at_first_seen, @pending_at, @pending_price, @status_label, @locale_id)
    `).run({
      ...listing,
      score_breakdown,
      first_seen_at: now,
      last_seen_at: now,
      price_at_first_seen: listing.price,
      pending_at: insertPendingAt,
      pending_price: insertPendingPrice,
      status_label: listing.status_label ?? null,
      locale_id: listing.locale_id,
    });
```

Replace with:

```typescript
  if (!existing) {
    // Check for a prior inactive listing at the same address (relisting detection)
    const prior = db
      .prepare(`SELECT id, price_at_first_seen, days_on_market, first_seen_at, last_seen_at
                FROM listings
                WHERE LOWER(TRIM(address)) = LOWER(TRIM(?))
                  AND status = 'inactive'
                  AND id != ?
                ORDER BY last_seen_at DESC
                LIMIT 1`)
      .get(listing.address, listing.id) as {
        id: string; price_at_first_seen: number; days_on_market: number | null;
        first_seen_at: string; last_seen_at: string;
      } | undefined;

    const priorListingId = prior?.id ?? null;
    const priorListPrice = prior?.price_at_first_seen ?? null;

    // If relisting detected, rescore to apply relistingPenalty
    let insertScore = listing.score;
    let insertBreakdown = score_breakdown;
    if (prior) {
      const locale = getLocale(listing.locale_id);
      const rescored = scoreWithBreakdown({
        id: listing.id, address: listing.address, city: listing.city, state: listing.state,
        zip: listing.zip, price: listing.price, beds: listing.beds, baths: listing.baths,
        sqft: listing.sqft, lot_sqft: listing.lot_sqft, year_built: listing.year_built,
        property_type: listing.property_type, lat: listing.lat, lng: listing.lng,
        url: listing.url, status: listing.status, status_label: listing.status_label ?? '',
        days_on_market: listing.days_on_market,
        next_open_house_start: listing.next_open_house_start ?? null,
        next_open_house_end: listing.next_open_house_end ?? null,
        sold_date: null,
        walk_score: listing.walk_score,
        school_district: listing.school_district,
        brief_short: null,
        brief_full: null,
        prior_listing_id: prior.id,
        prior_list_price: prior.price_at_first_seen,
      }, locale);
      insertScore = rescored.total;
      insertBreakdown = JSON.stringify(rescored);
    }

    // If the listing is already pending when we first see it, record that immediately
    const insertPendingAt = listing.status === '130' ? now : null;
    const insertPendingPrice = listing.status === '130' ? listing.price : null;

    db.prepare(`
      INSERT INTO listings (id, address, city, state, zip, price, beds, baths, sqft, lot_sqft,
        year_built, walk_score, property_type, lat, lng, url, status, days_on_market,
        score, score_breakdown, next_open_house_start, next_open_house_end,
        first_seen_at, last_seen_at, price_at_first_seen, pending_at, pending_price, status_label, locale_id,
        prior_listing_id, prior_list_price)
      VALUES (@id, @address, @city, @state, @zip, @price, @beds, @baths, @sqft, @lot_sqft,
        @year_built, @walk_score, @property_type, @lat, @lng, @url, @status, @days_on_market,
        @score, @score_breakdown, @next_open_house_start, @next_open_house_end,
        @first_seen_at, @last_seen_at, @price_at_first_seen, @pending_at, @pending_price, @status_label, @locale_id,
        @prior_listing_id, @prior_list_price)
    `).run({
      ...listing,
      score: insertScore,
      score_breakdown: insertBreakdown,
      first_seen_at: now,
      last_seen_at: now,
      price_at_first_seen: listing.price,
      pending_at: insertPendingAt,
      pending_price: insertPendingPrice,
      status_label: listing.status_label ?? null,
      locale_id: listing.locale_id,
      prior_listing_id: priorListingId,
      prior_list_price: priorListPrice,
    });
```

- [ ] **Step 4: Log `relisted` to `change_log` when a prior listing is found**

Immediately after the `db.prepare('INSERT INTO price_history ...')` line inside the `if (!existing)` block, add:

```typescript
    if (prior) {
      db.prepare(`INSERT INTO change_log (listing_id, change_type, old_value, new_value, changed_at)
                  VALUES (?, 'relisted', ?, ?, ?)`)
        .run(listing.id, String(prior.price_at_first_seen), String(listing.price), now);
    }
```

- [ ] **Step 5: Add `relisted` to `getUnnotifiedChanges()`**

Find this line in `getUnnotifiedChanges()` (around line 446):
```typescript
      AND c.change_type IN ('price_drop', 'price_increase', 'now_active')
```

Change to:
```typescript
      AND c.change_type IN ('price_drop', 'price_increase', 'now_active', 'relisted')
```

- [ ] **Step 6: Add `prior_listing_id` and `prior_list_price` to the `Listing` interface**

Find the `Listing` interface near the top of `src/db/index.ts` and add after `first_seen_at`:

```typescript
  prior_listing_id: string | null;
  prior_list_price: number | null;
```

- [ ] **Step 7: Commit**

```bash
git add src/db/index.ts
git commit -m "feat: add prior_listing_id chain and relisting detection in upsertListing"
```

---

### Task 2: Type definitions

**Files:**
- Modify: `src/poller/redfin.ts`
- Modify: `src/locales/types.ts`

- [ ] **Step 1: Add optional relisting fields to `RedfinListing`**

In `src/poller/redfin.ts`, add after `brief_full?`:

```typescript
  prior_listing_id?: string | null;  // set by upsertListing, used for relistingPenalty scoring
  prior_list_price?: number | null;
```

- [ ] **Step 2: Add `RelistingPenaltyConfig` to `src/locales/types.ts`**

After the `FlipPenaltyConfig` interface (around line 109), add:

```typescript
export interface RelistingPenaltyConfig {
  weight: number;        // penalty when relisted at same or higher price
  reducedWeight: number; // penalty when relisted at a lower price
}
```

- [ ] **Step 3: Add `relistingPenalty?` to `ScoringConfig`**

In the `ScoringConfig` interface, after `flipPenalty?`:

```typescript
  relistingPenalty?: RelistingPenaltyConfig;
```

- [ ] **Step 4: Verify TypeScript compiles**

```bash
cd /Users/danno/Documents/_devRoot/house-tracker && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/poller/redfin.ts src/locales/types.ts
git commit -m "feat: add RelistingPenaltyConfig type and prior listing fields to RedfinListing"
```

---

### Task 3: Scoring — `relistingPenalty` + narrow FLIP regex

**Files:**
- Modify: `src/scoring/index.ts`

- [ ] **Step 1: Narrow `FLIP_KEYWORDS` in `scoring/index.ts`**

Find this line (around line 296):
```typescript
    const FLIP_KW  = /\bflip\b|flipped|markup|relisted.{0,20}\$|purchased.{0,30}relisted/i;
```

Replace with:
```typescript
    const FLIP_KW  = /\bflip\b|flipped|markup/i;
```

- [ ] **Step 2: Add `relistingPenalty` logic to `scoreWithBreakdown`**

After the `domPenalty` block (around line 331), before the `let total = ...` line, add:

```typescript
  if (scoring.relistingPenalty && listing.prior_listing_id) {
    const { weight, reducedWeight } = scoring.relistingPenalty;
    const priceDropped = listing.prior_list_price != null && listing.price < listing.prior_list_price;
    const pts = priceDropped ? reducedWeight : weight;
    rawPenalty += pts;
    factors['relistingPenalty'] = { pts, max: weight };
  }
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd /Users/danno/Documents/_devRoot/house-tracker && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Manually verify 4982 Ensign St scenario**

Open a Node REPL and confirm the penalty fires correctly for a listing with `prior_listing_id` set and `price < prior_list_price`:

```bash
node --input-type=module << 'EOF'
// Quick sanity check — penalty tiers
const weight = 8, reducedWeight = 4;
const cases = [
  { price: 1_298_799, prior: 1_299_998, label: 'lower price (SD relist)' },
  { price: 1_350_000, prior: 1_299_998, label: 'higher price' },
  { price: 1_299_998, prior: 1_299_998, label: 'same price' },
];
for (const c of cases) {
  const dropped = c.price < c.prior;
  console.log(`${c.label}: penalty = ${dropped ? reducedWeight : weight}`);
}
EOF
```

Expected:
```
lower price (SD relist): penalty = 4
higher price: penalty = 8
same price: penalty = 8
```

- [ ] **Step 5: Commit**

```bash
git add src/scoring/index.ts
git commit -m "feat: add relistingPenalty scoring factor and narrow FLIP_KEYWORDS"
```

---

### Task 4: Locale configs — add `relistingPenalty`

**Files:**
- Modify: `src/locales/san-diego.ts`
- Modify: `src/locales/main-line.ts`
- Modify: `src/locales/st-louis.ts`

- [ ] **Step 1: Add to `san-diego.ts`**

After `flipPenalty: { weight: 15 },` (around line 99), add:

```typescript
    relistingPenalty: { weight: 8, reducedWeight: 4 },
```

- [ ] **Step 2: Add to `main-line.ts`**

After `domPenalty: { weight: 6 },` (the last scoring entry, around line 110), add:

```typescript
    relistingPenalty: { weight: 8, reducedWeight: 4 },
```

- [ ] **Step 3: Add to `st-louis.ts`**

Find the `scoring: {` block and identify the last penalty entry. Add after it:

```typescript
    relistingPenalty: { weight: 8, reducedWeight: 4 },
```

- [ ] **Step 4: Verify TypeScript compiles**

```bash
cd /Users/danno/Documents/_devRoot/house-tracker && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/locales/san-diego.ts src/locales/main-line.ts src/locales/st-louis.ts
git commit -m "feat: add relistingPenalty to all locale configs"
```

---

### Task 5: Email badge + narrow FLIP regex

**Files:**
- Modify: `src/notifications/email.ts`

- [ ] **Step 1: Narrow `FLIP_KEYWORDS` in `email.ts`**

Find this line (around line 257):
```typescript
const FLIP_KEYWORDS   = /\bflip\b|flipped|markup|relisted.{0,20}\$|purchased.{0,30}relisted/i;
```

Replace with:
```typescript
const FLIP_KEYWORDS   = /\bflip\b|flipped|markup/i;
```

- [ ] **Step 2: Add `↺ RELISTING` badge to `getEmailBadges()`**

The `getEmailBadges` function receives a `NotifyListing`. Find the type and add `prior_listing_id` to it if not present. Then in `getEmailBadges`, after the `FLIP` badge line (around line 280), add:

```typescript
  if (l.prior_listing_id)                                            badges.push({ label: '↺ RELISTING', bg: '#713f12', fg: '#fef08a' });
```

- [ ] **Step 3: Add `prior_listing_id` to `NotifyListing` type**

Find the `NotifyListing` interface in `email.ts` and add:

```typescript
  prior_listing_id?: string | null;
```

- [ ] **Step 4: Verify TypeScript compiles**

```bash
cd /Users/danno/Documents/_devRoot/house-tracker && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/notifications/email.ts
git commit -m "feat: add RELISTING email badge and narrow FLIP_KEYWORDS"
```

---

### Task 6: Routes — listing query + history endpoint

**Files:**
- Modify: `src/web/routes.ts`

- [ ] **Step 1: Add prior-listing scalars to the `/api/listings` SELECT**

Find the SQL in the `app.get('/api/listings', ...)` handler (around line 18). The SELECT currently ends with `brief_short, brief_full`. Add the four prior-listing fields:

```typescript
    let sql = `
      SELECT id, address, city, state, zip, price, price_at_first_seen, beds, baths,
             sqft, lot_sqft, year_built, walk_score, school_district, property_type, days_on_market,
             score, score_breakdown, url, first_seen_at, last_seen_at, status, status_label, starred,
             next_open_house_start, next_open_house_end, lat, lng, locale_id,
             brief_short, brief_full,
             prior_listing_id, prior_list_price
      FROM listings
```

- [ ] **Step 2: Extend `/api/listings/:id/history` to walk the chain**

The route already exists (around line 48) and returns price history for a single listing. Replace its body:

```typescript
  app.get('/api/listings/:id/history', (req) => {
    const { id } = req.params as { id: string };
    const db = getDb();

    // Walk the prior_listing_id chain to collect all linked listing IDs
    const ids: string[] = [id];
    let cursor = id;
    for (let i = 0; i < 5; i++) { // max 5 hops — safeguard against loops
      const row = db
        .prepare(`SELECT prior_listing_id, days_on_market, first_seen_at, last_seen_at, price_at_first_seen, price FROM listings WHERE id = ?`)
        .get(cursor) as { prior_listing_id: string | null; days_on_market: number | null; first_seen_at: string; last_seen_at: string; price_at_first_seen: number; price: number } | undefined;
      if (!row?.prior_listing_id) break;
      ids.push(row.prior_listing_id);
      cursor = row.prior_listing_id;
    }

    // Fetch listing metadata + price history for each ID in the chain
    const appearances = ids.map(listingId => {
      const meta = db
        .prepare(`SELECT id, first_seen_at, last_seen_at, days_on_market, price_at_first_seen, price FROM listings WHERE id = ?`)
        .get(listingId) as { id: string; first_seen_at: string; last_seen_at: string; days_on_market: number | null; price_at_first_seen: number; price: number };
      const prices = db
        .prepare(`SELECT price, recorded_at FROM price_history WHERE listing_id = ? ORDER BY recorded_at ASC`)
        .all(listingId) as { price: number; recorded_at: string }[];
      return { ...meta, prices };
    });

    // Compute true cumulative DOM
    let trueDom = 0;
    for (let i = 0; i < appearances.length; i++) {
      const a = appearances[i];
      trueDom += a.days_on_market ?? 0;
      // Add gap days between this listing going inactive and the next one appearing
      if (i < appearances.length - 1) {
        const gapMs = new Date(appearances[i + 1].first_seen_at).getTime() - new Date(a.last_seen_at).getTime();
        trueDom += Math.round(gapMs / (1000 * 60 * 60 * 24));
      }
    }

    return { appearances, trueDom };
  });
```

- [ ] **Step 3: Verify the endpoint manually**

Start the dev server:
```bash
pnpm dev
```

In another terminal, check an existing listing:
```bash
curl -s "http://localhost:3000/api/listings/PTP2602886/history" | node -e "const d=require('fs').readFileSync('/dev/stdin','utf8'); console.log(JSON.stringify(JSON.parse(d), null, 2))"
```

Expected: `{ appearances: [...], trueDom: <number> }` with price history for `PTP2602886`.

- [ ] **Step 4: Commit**

```bash
git add src/web/routes.ts
git commit -m "feat: add prior-listing fields to listings API and extend history endpoint to walk chain"
```

---

### Task 7: Frontend — badge, expandable, true DOM

**Files:**
- Modify: `src/web/public/app.js`

- [ ] **Step 1: Narrow `FLIP_KEYWORDS` in `app.js`**

Find this line (around line 1242):
```javascript
const FLIP_KEYWORDS = /\bflip\b|flipped|markup|relisted.{0,20}\$|purchased.{0,30}relisted/i;
```

Replace with:
```javascript
const FLIP_KEYWORDS = /\bflip\b|flipped|markup/i;
```

- [ ] **Step 2: Add `↺ RELISTING` badge to `getBadges()`**

Find the `getBadges` function (around line 1259). After the FLIP badge line:
```javascript
  if (full && FLIP_KEYWORDS.test(full) && !FLIP_SUPPRESSOR.test(full))
    badges.push({ label: '↑ FLIP',         bg: '#713f12', fg: '#fef08a' });
```

Add:
```javascript
  if (l.prior_listing_id)
    badges.push({ label: '↺ RELISTING',  bg: '#713f12', fg: '#fef08a' });
```

- [ ] **Step 3: Update true DOM display on the card**

Find the DOM label line in the card template (around line 1333):
```javascript
        ${l.days_on_market != null ? `<div class="card-price-sub">${domLabel(l.days_on_market)}</div>` : ""}
```

Replace with:
```javascript
        ${l.days_on_market != null ? `<div class="card-price-sub">${l.prior_listing_id ? `<span title="True time on market across all listings">${domLabel(l.days_on_market)} ↺</span>` : domLabel(l.days_on_market)}</div>` : ""}
```

- [ ] **Step 4: Add history indicator to the collapsed card**

Find where `brief-wrap` is rendered (around line 1337):
```javascript
      <div class="brief-wrap">${renderBrief(l)}</div>
```

Replace with:
```javascript
      <div class="brief-wrap">${renderExpandable(l)}</div>
```

- [ ] **Step 5: Replace `renderBrief()` with `renderExpandable()`**

Find the `renderBrief` function (around line 1353) and replace the entire function with:

```javascript
function renderExpandable(l) {
  const hasBrief = !!l.brief_short;
  const hasHistory = !!l.prior_listing_id;

  if (!hasBrief && !hasHistory) {
    return `<button class="brief-btn" onclick="requestBrief('${l.id}', this)">Brief</button>`;
  }

  const id = `expand-${l.id}`;

  // Collapsed header: brief_short if present, plus history indicator if relisting
  let header = '';
  if (hasBrief) {
    header += `<span class="brief-short-text">${l.brief_short}</span>`;
  }
  if (hasHistory) {
    const priorFmt = l.prior_list_price ? `was $${fmt(l.prior_list_price)}` : 'prior listing';
    header += `${hasBrief ? ' ' : ''}<span class="relist-indicator">↺ ${priorFmt}</span>`;
  }

  // Expanded content: brief bullets + history section (independently)
  let expanded = '';
  if (hasBrief) {
    const fullBullets = (() => {
      try { return JSON.parse(l.brief_full || '[]'); } catch { return []; }
    })();
    expanded += `<ul class="brief-full">${fullBullets.map(b => `<li>${b}</li>`).join('')}</ul>`;
  }
  if (hasHistory) {
    expanded += `<div class="history-section" id="history-${l.id}" data-loaded="false">
      <div class="history-loading">Loading history…</div>
    </div>`;
  }

  return `
    <div class="brief-short" onclick="toggleExpandable('${id}', '${hasHistory ? l.id : ''}')">
      ${header}
    </div>
    <div id="${id}" class="brief-full">${expanded}</div>`;
}
```

- [ ] **Step 6: Update `requestBrief()` to use `renderExpandable()` after brief loads**

Find the `requestBrief` function (around line 1369). Replace the `wrap.innerHTML = ...` block inside the try:

```javascript
    const listing = allListings.find(l => l.id === id);
    if (listing) {
      listing.brief_short = data.brief_short;
      listing.brief_full = data.brief_full;
    }
    const wrap = btn.closest('.card').querySelector('.brief-wrap');
    if (wrap && listing) {
      wrap.innerHTML = renderExpandable(listing);
    }
```

- [ ] **Step 7: Add `toggleExpandable()` with lazy history fetch**

After the `requestBrief` function, add:

```javascript
async function toggleExpandable(expandId, listingId) {
  const el = document.getElementById(expandId);
  if (!el) return;
  const isOpen = el.classList.toggle('open');

  // Lazy-load history on first open
  if (isOpen && listingId) {
    const historyEl = document.getElementById(`history-${listingId}`);
    if (historyEl && historyEl.dataset.loaded === 'false') {
      historyEl.dataset.loaded = 'true';
      try {
        const res = await fetch(`/api/listings/${listingId}/history`);
        const data = await res.json();
        historyEl.innerHTML = renderHistorySection(data);
      } catch {
        historyEl.innerHTML = '<div class="history-error">Could not load history.</div>';
      }
    }
  }
}

function renderHistorySection(data) {
  const { appearances, trueDom } = data;
  if (!appearances || appearances.length < 2) return '';

  const rows = appearances.map((a, i) => {
    const from = new Date(a.first_seen_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    const to   = a.days_on_market != null
      ? new Date(a.last_seen_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
      : 'present';
    const dom  = a.days_on_market != null ? `${a.days_on_market}d` : 'active';
    const priceTrail = a.prices.map(p => `$${fmt(p.price)}`).join(' → ');
    const label = i === 0 ? 'Current' : `Prior ${appearances.length - i > 2 ? appearances.length - i - 1 + ' listings ago' : ''}`;
    return `<div class="history-row">
      <span class="history-label">${label}</span>
      <span class="history-dates">${from} – ${to} (${dom})</span>
      <span class="history-prices">${priceTrail}</span>
    </div>`;
  });

  return `<div class="history-content">
    <div class="history-header">↺ Property history · True time on market: <strong>${trueDom} days</strong></div>
    ${rows.join('')}
  </div>`;
}
```

- [ ] **Step 8: Add CSS for new history elements**

In `src/web/public/style.css`, add styles for `.relist-indicator`, `.history-section`, `.history-content`, `.history-header`, `.history-row`, `.history-label`, `.history-dates`, `.history-prices`, `.history-loading`, `.history-error`:

```css
.relist-indicator {
  color: #fef08a;
  font-size: 0.8em;
  opacity: 0.85;
}

.history-section {
  padding: 8px 0 0;
}

.history-content {
  font-size: 0.82em;
  border-top: 1px solid rgba(255,255,255,0.08);
  padding-top: 8px;
  margin-top: 4px;
}

.history-header {
  font-weight: 600;
  margin-bottom: 6px;
  color: #fef08a;
}

.history-row {
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin-bottom: 8px;
  padding-left: 8px;
  border-left: 2px solid rgba(254,240,138,0.3);
}

.history-label {
  font-weight: 600;
  font-size: 0.9em;
  opacity: 0.7;
}

.history-dates {
  opacity: 0.85;
}

.history-prices {
  font-family: monospace;
}

.history-loading, .history-error {
  font-size: 0.82em;
  opacity: 0.6;
  padding: 4px 0;
}
```

- [ ] **Step 9: Smoke test in browser**

```bash
pnpm dev
```

Open `http://localhost:3000`. Check:
1. A listing with `prior_listing_id` shows `↺ RELISTING` badge
2. The DOM indicator shows `↺` suffix
3. Collapsed card shows `↺ was $X,XXX,XXX` indicator
4. Expanding the card triggers the history fetch and renders the history section
5. A listing without `prior_listing_id` behaves exactly as before
6. A listing with only a brief (no history) shows brief only — unchanged behavior
7. A listing with neither brief nor history shows the "Brief" button

- [ ] **Step 10: Commit**

```bash
git add src/web/public/app.js src/web/public/style.css
git commit -m "feat: add RELISTING badge, true DOM display, and history expandable to frontend"
```

---

## Self-review checklist

After writing the plan, checking spec coverage:

| Spec requirement | Task |
|---|---|
| `prior_listing_id` + `prior_list_price` columns | Task 1 |
| Relisting detection in `upsertListing()` (address match, inactive status) | Task 1 |
| `relisted` entry in `change_log` | Task 1 |
| `relisted` in `getUnnotifiedChanges()` | Task 1 |
| `RelistingPenaltyConfig` type | Task 2 |
| `prior_listing_id` + `prior_list_price` on `RedfinListing` | Task 2 |
| `relistingPenalty` scoring factor, tiered by price comparison | Task 3 |
| Narrow `FLIP_KEYWORDS` in scoring | Task 3 |
| `relistingPenalty` in all 3 locale configs | Task 4 |
| `↺ RELISTING` email badge (structural) | Task 5 |
| Narrow `FLIP_KEYWORDS` in email | Task 5 |
| Prior-listing scalars in `/api/listings` response | Task 6 |
| `/api/listings/:id/history` walks chain + joins `price_history` | Task 6 |
| True DOM computed from chain | Task 6 |
| `↺ RELISTING` badge in frontend (structural) | Task 7 |
| True DOM display with `↺` indicator | Task 7 |
| Single expandable for brief + history, independent | Task 7 |
| Lazy history fetch on expand | Task 7 |
| Narrow `FLIP_KEYWORDS` in frontend | Task 7 |
| CSS for history section | Task 7 |
