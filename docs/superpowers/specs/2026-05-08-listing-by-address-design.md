# Listing Lookup by Address Endpoint

**Date:** 2026-05-08

## Overview

Add `GET /api/listings/by-address?q=<address>` to look up a single listing from the existing DB using fuzzy address matching. Primarily for scoring inspection but returns all listing data.

## Endpoint

```
GET /api/listings/by-address?q=<address>
```

**Success (200):** Full listing row with `score_breakdown` parsed from JSON and a `match_score` field.

**Not found (404):** `{ "error": "not found" }` — returned when no listing scores at least 1 matching token.

## Matching Algorithm

1. Load all listings from the DB (full rows).
2. Normalize query and each listing's `address + " " + city + " " + state` to lowercase, split on non-alphanumeric characters into tokens.
3. Score = number of query tokens found in the listing's token set.
4. Return the listing with the highest score, breaking ties by `score DESC`.
5. If the best match scores 0, return 404.

## Response Shape

All columns from the `Listing` interface, plus:
- `score_breakdown`: parsed from JSON string to object (type `ScoreBreakdown`)
- `match_score`: number of query tokens that matched (for debugging)

## Implementation

- Single new route in `src/web/routes.ts`
- No schema changes
- No new dependencies
- Matching logic is inline in the route handler (small enough to not warrant extraction)
