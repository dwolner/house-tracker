# Relisting Detection & Cross-Listing History

**Date:** 2026-05-22
**Status:** Approved

## Problem

Sellers routinely relist a property under a new Redfin ID to reset the days-on-market counter, creating a false "fresh listing" impression. The system currently detects relisting only via AI-generated brief text (keyword matching for "relisted"), which conflates relisting with flips and misses the structural linkage needed to compute true DOM and full price history.

## Goal

- Detect relisting structurally (same address, new listing ID, prior listing inactive)
- Show true cumulative time on market and full price trajectory across all appearances
- Badge and score listings that exploit the DOM reset trick
- Separate the RELISTING badge from the FLIP badge

---

## Design

### 1. Data Model

Add two columns to the `listings` table:

| Column | Type | Description |
|--------|------|-------------|
| `prior_listing_id` | `TEXT REFERENCES listings(id)` | ID of the immediately preceding inactive listing at the same address |
| `prior_list_price` | `INTEGER` | `price_at_first_seen` of the prior listing — stored at link time to avoid runtime DB lookups during scoring |

**Chain structure:** `prior_listing_id` forms a linked list. To reconstruct full history, walk: `new → new.prior_listing_id → prior.prior_listing_id → ...`. In practice chains will be 2–3 deep.

**Derived values (computed on read, not stored):**
- **True DOM:** sum of `days_on_market` across all chained listings + gap days between each delisting and relisting
- **Price trajectory:** price history entries from `price_history` across all linked listing IDs

**Migration:** Added via the existing `PRAGMA table_info` migration pattern in `getDb()`.

---

### 2. Detection Logic

In `upsertListing()`, after confirming `isNew = true` (before the INSERT), run:

```sql
SELECT id, price_at_first_seen, days_on_market, last_seen_at
FROM listings
WHERE LOWER(TRIM(address)) = LOWER(TRIM(?))
  AND status = 'inactive'
  AND id != ?
ORDER BY last_seen_at DESC
LIMIT 1
```

Match key: **address only** (case-insensitive, trimmed).

If a match is found:
1. Set `prior_listing_id` and `prior_list_price` on the INSERT
2. Log a `relisted` entry in `change_log`:
   - `old_value` = prior listing's `price_at_first_seen`
   - `new_value` = new listing's price
3. `getUnnotifiedChanges()` includes `relisted` alongside `price_drop` and `now_active`

---

### 3. Badge & Scoring

#### New `↺ RELISTING` badge

Fires structurally when `prior_listing_id IS NOT NULL`. No text matching.

- **Email:** `email.ts` `getEmailBadges()`
- **Web:** `app.js` card rendering
- **Style:** amber warning — `bg: '#713f12'`, `fg: '#fef08a'` (matches FLIP)

#### FLIP badge cleanup

Narrow `FLIP_KEYWORDS` in both `email.ts` and `scoring/index.ts`:

**Before:**
```
/\bflip\b|flipped|markup|relisted.{0,20}\$|purchased.{0,30}relisted/i
```

**After:**
```
/\bflip\b|flipped|markup/i
```

The `relisted` patterns are removed — relisting is now structural. A listing that is both a flip and a relisting (e.g., 4982 Ensign St) will correctly show both badges.

#### `relistingPenalty` score factor

Added to locale config for all three locales (`main-line`, `san-diego`, `st-louis`). Tiered by whether the seller adjusted price:

| Condition | Penalty |
|-----------|---------|
| Relisted at same or higher price | `-8` pts |
| Relisted at lower price (`listing.price < listing.prior_list_price`) | `-4` pts |

Rationale: same-or-higher is a cynical DOM reset with no concession; lower price indicates market feedback was heard. Neither is disqualifying — the property may still be worth it — but both warrant flagging.

The factor appears in the `factors` map as `relistingPenalty` and is visible in the score breakdown chip UI.

---

### 4. UI / History Display

Brief and history are **independent** — each renders only if the relevant data is present. Both live inside a single expandable per card.

#### Collapsed card

Shows whatever compact indicators are available (independently):
- `brief_short` if the brief has been generated
- History indicator if `prior_listing_id` is set: `↺ 32d true DOM · was $1,299,998`
- True DOM replaces the displayed DOM figure: `32d ↑ (relisted)` instead of `1d ↑`

#### Expanded section

Renders whichever sections are present:

1. **Brief** (if `brief_full` exists): existing bullet list, unchanged
2. **History** (if `prior_listing_id` is set): prior listing period, price trajectory across all appearances

Example history section:
```
↺ Previously listed Apr 23 – May 19 (29 days) at $1,299,998
   Price cuts: $1,299,998 → $1,299,990 → $1,298,900
   True time on market: 32 days total
```

#### Data sourcing

Prior listing data (`prior_listing_id`, `prior_list_price`, prior DOM, prior dates) is included in the main `/api/listings` response — no separate history endpoint. The web layer renders from what's already in the payload. Price history entries for the prior listing are included in the response via a join on `price_history` at query time.

---

## Real-World Validation: 4982 Ensign St

| | Old listing (`PTP2602886`) | New listing (next poll) |
|---|---|---|
| First seen | Apr 23, 2026 | ~May 21, 2026 |
| Went inactive | May 19, 2026 | — |
| DOM | 29 days | 1 day (displayed) |
| Price at first seen | $1,299,998 | $1,298,799 |
| `prior_listing_id` | — | `PTP2602886` |
| True DOM | — | **32 days** |
| Badge | `↑ FLIP` | `↑ FLIP` + `↺ RELISTING` |
| Penalty | flip | flip + relisting (-4 pts, price lowered) |

---

## Files Affected

| File | Change |
|------|--------|
| `src/db/index.ts` | Migration for `prior_listing_id` + `prior_list_price`; relisting detection in `upsertListing()`; `relisted` in `getUnnotifiedChanges()`; prior price history join in listing query |
| `src/scoring/index.ts` | `relistingPenalty` factor; narrow `FLIP_KEYWORDS` regex |
| `src/notifications/email.ts` | `↺ RELISTING` badge; narrow `FLIP_KEYWORDS` regex |
| `src/web/routes.ts` | Add `prior_listing_id`, `prior_list_price`, prior DOM/dates to listing response |
| `src/web/public/app.js` | `↺ RELISTING` badge; history strip in expandable; true DOM display |
| `src/locales/*.ts` | `relistingPenalty` weight in all three locale configs |
