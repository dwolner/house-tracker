# Digest: Neighborhoods, AI Briefs, and Deep-Link Cards

**Date:** 2026-05-15
**Status:** Approved

## Overview

Three improvements to the HTML digest email and the house-tracker web app:

1. Fill in missing neighborhood names for ZIPs that currently render blank
2. Show `brief_short` (AI-generated headline insight) on cards that have one
3. Link each card to `https://house-tracker-kgg27w.fly.dev/?id=<id>` with auto-scroll and highlight on the web app

---

## 1. Missing Neighborhood ZIPs

**File:** `src/notifications/email.ts` — `NEIGHBORHOOD_BY_ZIP` map (lines ~68–88)

Add the following entries to cover all active search ZIPs that currently return null:

| ZIP | Neighborhood |
|-----|-------------|
| `92115` | Rolando / College Area |
| `19083` | Havertown |
| `19301` | Paoli |
| `19333` | Devon |
| `19355` | Malvern |
| `19428` | Conshohocken |

St. Louis ZIPs are excluded — that locale does not appear in the digest.

---

## 2. `brief_short` in Digest Cards

**File:** `src/notifications/email.ts` — `buildCard` function (lines ~213–290)

**Placement:** Below the score breakdown chips, above the CTA button row.

**Rendering rules:**
- Rendered only when `listing.brief_short` is a non-empty string
- Styled as small italic muted text (matches the palette's `muted` color)
- No label or prefix — the text stands alone
- When null/absent: section is omitted entirely, no blank space

**Data availability:** `brief_short` is already stored on the `NotifyListing` type via the database. Confirm the type includes `brief_short: string | null` before rendering.

---

## 3. Deep-Link Cards to House Tracker

### 3a. Email CTA — `src/notifications/email.ts`

Replace the single "View on Redfin →" button with two side-by-side CTA buttons:

- **Primary:** `View on House Tracker →` — links to `https://house-tracker-kgg27w.fly.dev/?id=<listing.id>`
- **Secondary:** `View on Redfin →` — existing `listing.url` (unchanged)

Both open in a new tab (`target="_blank" rel="noopener"`). Primary button uses the accent color; secondary uses muted styling.

### 3b. Frontend Deep-Link — `src/web/public/app.js`

On page load, after cards are rendered:

1. Parse `id` from `window.location.search` (`new URLSearchParams(...)`)
2. If present, find the DOM element with `data-id="<id>"` (or equivalent card identifier attribute — add `data-id` to card markup if not already present)
3. `scrollIntoView({ behavior: 'smooth', block: 'center' })`
4. Apply a brief CSS highlight: add a class that animates a border or box-shadow glow, remove it after ~1.5s

The highlight animation should use a CSS keyframe defined in the existing stylesheet or injected inline. It fades out so it doesn't persist as a permanent style change.

Cards must have `data-id` set on their root element. If not currently present, add it when cards are rendered.

---

## Data Flow

```
Digest email
  → card has brief_short? → render italic blurb
  → CTA: House Tracker link (/?id=<id>) + Redfin link
  
User clicks House Tracker link
  → app.js parses ?id
  → finds card by data-id
  → scrolls to it + flashes highlight
```

---

## Out of Scope

- `brief_full` (bullet list) in the digest — only `brief_short` for now
- Dedicated listing detail page
- St. Louis neighborhood names (locale excluded from digest)
- Backfilling briefs for listings that don't have one

---

## Files Changed

| File | Change |
|------|--------|
| `src/notifications/email.ts` | Add 6 ZIP entries, render `brief_short`, replace CTA with two buttons |
| `src/web/public/app.js` | Add `data-id` to cards, parse `?id` on load, scroll + highlight |
