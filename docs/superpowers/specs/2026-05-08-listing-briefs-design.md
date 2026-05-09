# Listing Briefs — Design Spec

**Date:** 2026-05-08  
**Status:** Approved

## Overview

Auto-generate a short AI brief per listing by scraping the Redfin listing page for description and sale history, then calling Claude Haiku. Brief appears inline on the card with an expand for the full version.

---

## Data Fetching

**Source:** Redfin listing HTML page (the URL already stored in `listings.url`)  
**Method:** `node-fetch` with existing poller headers — confirmed 200 OK.  
**Blocked:** `/stingray/api/home/details/*` returns 403. Do not use.

**Extract from HTML:**

- **Description:** text content inside `.remarks` div (strip all HTML tags and `&rsquo;` etc.)
- **Sale history:** rows inside `saleHistoryPanel` — each row has `.BasicTable__col.date`, `.BasicTable__col.event`, `.BasicTable__col.price`. Parse with regex; skip header/MLS-attr rows.

---

## AI Generation

**Model:** `claude-haiku-4-5-20251001`  
**Prompt inputs:** address, price, beds/baths, sqft, DOM, listing description, sale history rows  
**Output format:** JSON `{ short: string, full: string[] }`

- `short`: 1–2 sentences. The single sharpest insight — flip risk, stale listing, unusual history, or standout value.
- `full`: 3–5 bullet strings. Cover: flip/relist detection, negotiation position, inspection flags implied by description, price history trajectory, anything else notable. Omit bullets with nothing to say.

**Prompt style:** Terse, analytical, no filler. Write for a buyer doing pre-showing prep.

---

## Database

Two new columns on `listings`:

```sql
ALTER TABLE listings ADD COLUMN brief_short TEXT;
ALTER TABLE listings ADD COLUMN brief_full TEXT;
```

`brief_full` stored as JSON array string. Presence of `brief_short` is the generated flag — no separate timestamp needed.

---

## Enrichment Pipeline

**File:** `src/enrichment/brief.ts`  
**Entry point:** `export async function runBriefEnrichment(): Promise<void>`

**Eligibility:** `score >= 60 AND brief_short IS NULL AND status IN ('9', '1')`  
**Rate limiting:** 1.5s delay between listing fetches (matches existing poller courtesy delay)  
**Called from:** `runEnrichment()` in `src/poller/index.ts`, after walk-score enrichment  
**Error handling:** Log and skip on fetch failure or Haiku error — don't block the enrichment pipeline

---

## On-Demand API

**Route:** `POST /api/listings/:id/brief`  
**Auth:** none (internal tool)  
**Behavior:** Runs the same fetch + Haiku logic regardless of score. Persists result. Returns `{ brief_short, brief_full }`.  
**Use case:** "Brief" button on cards with `score < 60` or any card missing a brief.

---

## UI

**Card — brief present:**
- `brief_short` renders as a small italic line below the meta line (neighborhood · school district)
- Clicking it toggles inline expansion showing `brief_full` as a bullet list
- No separate "expand" button — the short text itself is the click target

**Card — brief absent, score < 60:**
- Small "Brief" link in the card footer (next to the Redfin link)
- On click: POST to `/api/listings/:id/brief`, replace with rendered brief on success

**Card — brief absent, score ≥ 60:**
- No UI affordance — brief will appear after next enrichment run

**Styling:**
- `brief_short`: `font-style: italic; font-size: 12px; color: var(--text-dim); cursor: pointer;`
- `brief_full` bullets: small, left-aligned, `var(--text)`, shown in a `<ul>` with tight spacing
- Collapse on second click

---

## Scope Boundaries

- No brief for sold/inactive listings (`status = '131'` or inactive)
- No brief regeneration UI — once generated, it's static (stale data acceptable for this use case)
- No streaming — wait for full Haiku response before rendering
