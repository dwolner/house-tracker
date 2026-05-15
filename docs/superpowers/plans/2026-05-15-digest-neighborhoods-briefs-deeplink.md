# Digest: Neighborhoods, Briefs, and Deep-Link Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add missing neighborhood names, show AI brief headlines in digest cards, and deep-link email cards to the house-tracker web app with auto-scroll + highlight.

**Architecture:** Three independent changes to two files — `src/notifications/email.ts` (ZIP map, brief rendering, CTA buttons) and `src/web/public/app.js` (card `data-id` attribute, URL param parsing, highlight animation). The `NotifyListing` interface and four SELECT queries must also be updated to carry `brief_short`.

**Tech Stack:** TypeScript (email/server), vanilla JS (frontend), SQLite via better-sqlite3, node-cron + nodemailer.

---

## File Map

| File | Change |
|------|--------|
| `src/notifications/email.ts` | Add 6 ZIP entries; add `brief_short` to `NotifyListing`; render `brief_short` in `buildCard`; replace single CTA with two buttons |
| `src/web/server.ts` | Add `brief_short` to SELECT query (line ~28) |
| `src/web/routes.ts` | Add `brief_short` to three SELECT queries (lines ~121, ~146, ~307) |
| `src/web/public/app.js` | Add `data-id` to card root; add deep-link init after `renderCards`; inject highlight CSS |

---

## Task 1: Add Missing Neighborhood ZIPs

**Files:**
- Modify: `src/notifications/email.ts:68-88`

- [ ] **Step 1: Edit `NEIGHBORHOOD_BY_ZIP` in `src/notifications/email.ts`**

Find the block ending at line 88 (`'19406': 'King of Prussia',`) and add the six missing entries:

```typescript
const NEIGHBORHOOD_BY_ZIP: Record<string, string> = {
  // San Diego
  '92110': 'Bay Park / Loma Portal',
  '92107': 'Point Loma Heights',
  '92116': 'Kensington / Talmadge',
  '92117': 'Bay Ho',
  '92104': 'North Park',
  '92103': 'Mission Hills',
  '92120': 'Allied Gardens',
  '92115': 'Rolando / College Area',    // ← new
  // Main Line PA
  '19072': 'Narberth/Penn Valley',
  '19003': 'Ardmore',
  '19010': 'Bryn Mawr',
  '19004': 'Bala Cynwyd',
  '19066': 'Merion Station',
  '19041': 'Haverford',
  '19096': 'Wynnewood',
  '19087': 'Wayne',
  '19312': 'Berwyn',
  '19406': 'King of Prussia',
  '19083': 'Havertown',                 // ← new
  '19301': 'Paoli',                     // ← new
  '19333': 'Devon',                     // ← new
  '19355': 'Malvern',                   // ← new
  '19428': 'Conshohocken',              // ← new
};
```

- [ ] **Step 2: Verify with email preview**

Open `http://localhost:3000/email-preview?locale=san-diego` and `http://localhost:3000/email-preview?locale=main-line` in the browser. Confirm listings in those locales now show a neighborhood on every card (accent-colored meta line below the city/zip).

- [ ] **Step 3: Commit**

```bash
git add src/notifications/email.ts
git commit -m "feat: add missing neighborhood ZIP mappings for SD and Main Line PA"
```

---

## Task 2: Add `brief_short` to `NotifyListing` and SELECT Queries

**Files:**
- Modify: `src/notifications/email.ts:10-30` (interface)
- Modify: `src/web/server.ts:26-30` (SELECT)
- Modify: `src/web/routes.ts:120-128` (email-preview SELECT)
- Modify: `src/web/routes.ts:145-149` (test-email SELECT)
- Modify: `src/web/routes.ts:306-310` (/api/digest SELECT)

- [ ] **Step 1: Add `brief_short` to `NotifyListing` interface in `src/notifications/email.ts`**

The current interface ends with `url: string | null;` around line 30. Add one field:

```typescript
export interface NotifyListing {
  id: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  price: number;
  price_at_first_seen: number | null;
  beds: number;
  baths: number;
  sqft: number | null;
  lot_sqft: number | null;
  days_on_market: number | null;
  first_seen_at: string | null;
  score: number;
  score_breakdown: string | null;
  school_district: string | null;
  property_type: string | null;
  walk_score: number | null;
  url: string | null;
  brief_short: string | null;           // ← new
}
```

- [ ] **Step 2: Add `brief_short` to SELECT in `src/web/server.ts`**

Find the query around line 26-30 and add `brief_short` to the column list:

```typescript
newListings = getDb().prepare(`
  SELECT id, address, city, state, zip, price, price_at_first_seen, beds, baths, sqft, lot_sqft,
         days_on_market, score, score_breakdown, school_district, property_type, walk_score, url,
         brief_short
  FROM listings WHERE id IN (${placeholders}) AND superseded_by IS NULL AND score >= ? ORDER BY score DESC
`).all(...newHighScoreIds, NOTIFY_SCORE_THRESHOLD) as NotifyListing[];
```

- [ ] **Step 3: Add `brief_short` to email-preview SELECT in `src/web/routes.ts`**

Find the query around line 120-128 (the `/email-preview` route) and add `brief_short`:

```typescript
const listings = db.prepare(`
  SELECT id, address, city, state, zip, price, price_at_first_seen, beds, baths, sqft, lot_sqft,
         days_on_market, first_seen_at, score, score_breakdown, school_district, property_type, walk_score, url,
         brief_short
  FROM listings
  WHERE status NOT IN ('inactive', '130') AND score >= ? AND superseded_by IS NULL
    AND first_seen_at >= datetime('now', '-' || ? || ' days')
    ${localeSql}
  ORDER BY first_seen_at DESC
`).all(...params) as import('../notifications/email.js').NotifyListing[];
```

- [ ] **Step 4: Add `brief_short` to test-email SELECT in `src/web/routes.ts`**

Find the query around line 145-149 (the `/api/test-email` route) and add `brief_short`:

```typescript
const listings = db.prepare(`
  SELECT id, address, city, state, zip, price, price_at_first_seen, beds, baths, sqft, lot_sqft,
         days_on_market, first_seen_at, score, score_breakdown, school_district, property_type, walk_score, url,
         brief_short
  FROM listings WHERE superseded_by IS NULL ORDER BY score DESC LIMIT 5
`).all() as import('../notifications/email.js').NotifyListing[];
```

- [ ] **Step 5: Add `brief_short` to /api/digest SELECT in `src/web/routes.ts`**

Find the query around line 306-310 (the `/api/digest` route) and add `brief_short`:

```typescript
newListings = getDb().prepare(`
  SELECT id, address, city, state, zip, price, price_at_first_seen, beds, baths, sqft, lot_sqft,
         days_on_market, first_seen_at, score, score_breakdown, school_district, property_type, walk_score, url,
         brief_short
  FROM listings WHERE id IN (${placeholders}) AND superseded_by IS NULL AND score >= ? ORDER BY score DESC
`).all(...newHighScoreIds, NOTIFY_SCORE_THRESHOLD) as import('../notifications/email.js').NotifyListing[];
```

- [ ] **Step 6: Verify TypeScript compiles**

```bash
cd /Users/danno/Documents/_devRoot/house-tracker && pnpm tsc --noEmit
```

Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/notifications/email.ts src/web/server.ts src/web/routes.ts
git commit -m "feat: add brief_short to NotifyListing interface and all digest SELECT queries"
```

---

## Task 3: Render `brief_short` and Replace CTA in Email Cards

**Files:**
- Modify: `src/notifications/email.ts:279-285` (`buildCard` footer section)

- [ ] **Step 1: Add `brief_short` blurb and replace CTA in `buildCard`**

Find the footer section of `buildCard` (around lines 279-285). It currently looks like:

```typescript
        <!-- Score chips -->
        ${scoreChipsHtml(l, P)}

        <!-- Footer: CTA -->
        <div style="margin-top:14px">
          ${l.url ? `<a href="${l.url}" style="display:block;width:100%;background:${P.accent};color:#fff;text-decoration:none;border-radius:5px;padding:8px 0;font-size:12px;font-weight:600;letter-spacing:.03em;text-align:center;box-sizing:border-box">View on Redfin →</a>` : ''}
        </div>
```

Replace it with:

```typescript
        <!-- Score chips -->
        ${scoreChipsHtml(l, P)}

        <!-- AI brief headline -->
        ${l.brief_short ? `<div style="margin-top:12px;font-size:11px;font-style:italic;color:${P.muted};line-height:1.5">${l.brief_short}</div>` : ''}

        <!-- Footer: CTAs -->
        <div style="margin-top:14px;display:flex;gap:8px">
          <a href="https://house-tracker-kgg27w.fly.dev/?id=${l.id}" target="_blank" rel="noopener" style="flex:1;background:${P.accent};color:#fff;text-decoration:none;border-radius:5px;padding:8px 0;font-size:12px;font-weight:600;letter-spacing:.03em;text-align:center;box-sizing:border-box;display:block">View on House Tracker →</a>
          ${l.url ? `<a href="${l.url}" target="_blank" rel="noopener" style="flex:1;background:transparent;color:${P.muted};text-decoration:none;border-radius:5px;padding:8px 0;font-size:12px;font-weight:600;letter-spacing:.03em;text-align:center;box-sizing:border-box;display:block;border:1px solid ${P.border}">View on Redfin →</a>` : ''}
        </div>
```

- [ ] **Step 2: Verify with email preview — brief and CTAs**

Open `http://localhost:3000/email-preview?locale=main-line` in the browser.

- Cards with a `brief_short` in the DB should show a small italic line above the CTA buttons.
- All cards should show two CTA buttons: "View on House Tracker →" (accent) and "View on Redfin →" (muted/bordered).
- Cards with no brief should show no gap — the brief section is absent.

To check if any listings have briefs in the DB, run:
```bash
cd /Users/danno/Documents/_devRoot/house-tracker && node -e "
  import('./src/db/index.js').then(({getDb}) => {
    const db = getDb();
    const rows = db.prepare('SELECT id, brief_short FROM listings WHERE brief_short IS NOT NULL LIMIT 5').all();
    console.log(rows);
  });
"
```

If no listings have briefs yet, the brief section being absent is correct behavior.

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd /Users/danno/Documents/_devRoot/house-tracker && pnpm tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/notifications/email.ts
git commit -m "feat: render brief_short in digest cards and add House Tracker deep-link CTA"
```

---

## Task 4: Add `data-id` + Deep-Link Scroll/Highlight to Web App

**Files:**
- Modify: `src/web/public/app.js:1225` (card root element)
- Modify: `src/web/public/app.js:1346` (end of `renderCards`)

- [ ] **Step 1: Add `data-id` to the card root `<div>` in `cardHtml`**

Find line ~1225 in `src/web/public/app.js`:

```javascript
  return `<div class="card${isPending ? " card-pending" : ""}">
```

Replace with:

```javascript
  return `<div class="card${isPending ? " card-pending" : ""}" data-id="${l.id}">
```

- [ ] **Step 2: Add deep-link init at the end of `renderCards`**

Find the end of `renderCards` around line 1346-1347:

```javascript
  wrap.innerHTML = parts.join("");
}
```

Replace with:

```javascript
  wrap.innerHTML = parts.join("");
  deepLinkScroll();
}
```

Then, add the `deepLinkScroll` function immediately after `renderCards` closes (around line 1348):

```javascript
function deepLinkScroll() {
  const params = new URLSearchParams(window.location.search);
  const targetId = params.get("id");
  if (!targetId) return;

  const card = document.querySelector(`[data-id="${targetId}"]`);
  if (!card) return;

  // Inject keyframe animation once
  if (!document.getElementById("ht-highlight-style")) {
    const style = document.createElement("style");
    style.id = "ht-highlight-style";
    style.textContent = `
      @keyframes ht-highlight-pulse {
        0%   { box-shadow: 0 0 0 3px rgba(196,145,58,0.8); }
        70%  { box-shadow: 0 0 0 8px rgba(196,145,58,0.2); }
        100% { box-shadow: 0 0 0 0 rgba(196,145,58,0); }
      }
      .ht-highlight {
        animation: ht-highlight-pulse 1.5s ease-out forwards;
      }
    `;
    document.head.appendChild(style);
  }

  card.scrollIntoView({ behavior: "smooth", block: "center" });
  card.classList.add("ht-highlight");
  setTimeout(() => card.classList.remove("ht-highlight"), 1600);
}
```

- [ ] **Step 3: Verify deep-link manually**

1. Start the server: `cd /Users/danno/Documents/_devRoot/house-tracker && pnpm dev` (or however the dev server starts).
2. Get any listing `id` from the app (visible in the URL when starring or from browser console: `allListings[0].id`).
3. Navigate to `http://localhost:3000/?id=<that-id>`.
4. Confirm: the page loads, scrolls smoothly to that card, and a gold glow pulse fades out after ~1.5s.
5. Navigate to `http://localhost:3000/` (no `?id`). Confirm: no scroll or animation.

- [ ] **Step 4: Commit**

```bash
git add src/web/public/app.js
git commit -m "feat: add data-id to cards and deep-link scroll+highlight on ?id= param"
```

---

## Self-Review Notes

- All four SELECT queries updated in Task 2 — covers all code paths that call `sendDigest`.
- `brief_short` rendering is conditional — no empty space when absent.
- `deepLinkScroll` is called at the end of `renderCards`, which is the single path that sets `wrap.innerHTML` — so it fires after every card render including filter changes. This is safe because it's a no-op when `?id` is absent.
- The CSS keyframe injection is guarded by `document.getElementById("ht-highlight-style")` so it only inserts once even if `renderCards` is called multiple times.
