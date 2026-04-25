# Personalized Scoring & Settings Panel

**Date:** 2026-04-24  
**Status:** Approved — ready for implementation planning

## Problem

Scoring weights are locale-wide and hardcoded. There is no way for two users sharing the app (e.g. owner + friend in a different city) to have different preferences. Notifications go to a single hardcoded `NOTIFY_TO` email.

## Goals

1. Client-side re-scoring so listings re-rank instantly as a user adjusts factor importance
2. Per-user, per-locale scoring multipliers stored server-side (keyed by email)
3. One daily digest email per user, aggregating all their subscribed locales
4. A "Settings" side panel in the UI — email on top, locale tabs, factor weight pickers

## Non-Goals

- Passwords / auth — email is the only identity
- UI for adding new locales (locale configs remain code for now)
- Editing price thresholds or breakpoints (weights only)

---

## Architecture

### Client-side scoring engine

Port `scoreWithBreakdown` from `src/scoring/index.ts` to a self-contained `src/web/public/scoring.js` static file.

On page load:
1. Fetch listings from `/api/listings` (all raw fields already present in response)
2. Fetch locale scoring config from `/api/locales/:id/scoring` (factor keys + default weights)
3. Check `localStorage` for `ht_email` and `ht_user_id` — if present, fetch user prefs from server and apply stored multipliers

On slider change:
- Multiply each factor's `defaultWeight × userMultiplier` to get `effectiveWeight`
- Re-run scoring for every listing in memory
- Re-sort and re-render — no server round-trip

### Data model

Two new SQLite tables (migrations added to `src/db/index.ts`):

```sql
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS user_locale_prefs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  locale_id TEXT NOT NULL,
  score_multipliers TEXT NOT NULL DEFAULT '{}', -- JSON: {schoolDistrict: 1.5, price: 1.0, ...}
  notify_threshold REAL NOT NULL DEFAULT 70,
  created_at TEXT NOT NULL,
  UNIQUE(user_id, locale_id)
);
```

`score_multipliers` keys match `ScoringConfig` factor names (`schoolDistrict`, `walkability`, `price`, `sqft`, `lot`, `transit`, `beds`, `pricePerSqft`, `neighborhoodBonus`, `zipBonus`, `domPenalty`). Missing keys default to `1.0×`.

### Multiplier model

- Range: 0–2× in 5 named steps
- Step mapping: Off=0, Low=0.5, Default=1.0, High=1.5, Max=2.0
- At scoring time: `effectiveWeight = localeDefaultWeight × userMultiplier`
- The locale's `score` column in DB remains the unmodified locale-default score; personalized scores are computed at render time (browser) and notification send time (server loop)

### New API endpoints

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/api/users` | Upsert by email → return `{id, email}` |
| `GET` | `/api/users/:id/prefs` | Return all `user_locale_prefs` rows for user |
| `PUT` | `/api/users/:id/prefs/:locale_id` | Upsert multipliers + notify_threshold for one locale |
| `GET` | `/api/locales/:id/scoring` | Return factor keys + default weights from locale config |

### localStorage keys

| Key | Value | Purpose |
|---|---|---|
| `ht_email` | string | Auto-fill email field on return visits |
| `ht_user_id` | number | Used for preference save/load API calls |

---

## Settings Panel UI

### Trigger
"Settings" button in the app header (replaces or sits alongside existing controls).

### Layout
Slides in from the right as an overlay. Full-width on mobile. ~280px wide on desktop, overlapping (not pushing) the listing view.

### Panel content (top to bottom)

**1. Notifications section**
- Label: "Notify me at"
- Email `<input>` — auto-filled from `localStorage.ht_email` on load
- On blur: save to `ht_email` in localStorage
- If email is new or changed: show "Save" button → `POST /api/users` → store returned `id` in `ht_user_id`

**2. Locale tabs**
- One tab per locale the user has a pref row for (initially all locales available in the app)
- Active tab determines which factor sliders render below
- `+ Add` tab: shows a list of available locales to subscribe to (calls `PUT /api/users/:id/prefs/:locale_id` with default multipliers to create the row)

**3. Factor weight pickers**
- One row per factor in the active locale's scoring config (fetched from `/api/locales/:id/scoring`)
- Each row: factor name + 5-step segmented control: **Off · Low · Default · High · Max**
- Default selection: **Default** (1.0×) for all factors on first open
- On change: immediately re-score and re-sort listings in the background (no save required — weights apply instantly)
- Weights auto-saved to server debounced 1s after last change (if user is logged in)

**4. Close button**
- Top-right ✕ — closes panel, listings remain at current personalized sort order

---

## Notifications

### Current behavior (unchanged as fallback)
`NOTIFY_TO` env var still works when no users are registered.

### New behavior (when users exist)
`sendDigest` refactored into a per-user loop:

```
for each user in users table:
  allMatches = []
  for each pref in user_locale_prefs where user_id = user.id:
    listings = active listings for pref.locale_id
    scored = listings.map(l => rescore(l, pref.score_multipliers, locale))
    matches = scored.filter(s => s >= pref.notify_threshold)
    allMatches.push(...matches)
  if allMatches.length > 0:
    send one email to user.email with all matches
```

`rescore()` reuses the same scoring logic as the client — multipliers applied to locale default weights, all raw fields already in DB.

Triggered once daily by the existing cron schedule (no change to scheduler).

---

## Files Changed

| File | Change |
|---|---|
| `src/db/index.ts` | Add `users` + `user_locale_prefs` tables, migration, CRUD helpers |
| `src/web/routes.ts` | Add 4 new API endpoints |
| `src/locales/index.ts` | Export scoring config shape for API consumption |
| `src/notifications/email.ts` | Refactor `sendDigest` for per-user loop |
| `src/web/public/scoring.js` | New — ported scoring engine for client-side use |
| `src/web/public/app.js` | Settings panel UI, client-side rescoring integration |
| `src/web/public/style.css` | Settings panel styles, slider/step-picker styles |

---

## Open Questions

None — all design decisions resolved.
