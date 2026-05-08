# Listing Lookup by Address Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `GET /api/listings/by-address?q=<address>` that fuzzy-matches an address string against the DB and returns the single best-matching listing.

**Architecture:** Single new route in `src/web/routes.ts`. Load all listings from the DB ordered by score DESC, tokenize both the query and each listing's address+city+state, score by token overlap, return the best match with `score_breakdown` parsed to an object and a `match_score` field added. Return 404 if best match scores 0.

**Tech Stack:** Fastify, better-sqlite3 (sync), TypeScript

---

### Task 1: Add the route

**Files:**
- Modify: `src/web/routes.ts`

- [ ] **Step 1: Add the route to `registerRoutes` in `src/web/routes.ts`**

Add this block before the closing `}` of `registerRoutes`:

```typescript
  // Fuzzy address lookup — GET /api/listings/by-address?q=123+Main+St
  app.get('/api/listings/by-address', (req, reply) => {
    const q = req.query as Record<string, string>;
    const query = (q.q ?? '').trim();
    if (!query) {
      reply.status(400).send({ error: 'q is required' });
      return;
    }

    const queryTokens = query.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
    if (queryTokens.length === 0) {
      reply.status(400).send({ error: 'q is required' });
      return;
    }

    const listings = getDb()
      .prepare(`SELECT * FROM listings ORDER BY score DESC`)
      .all() as import('../db/index.js').Listing[];

    let bestListing: import('../db/index.js').Listing | null = null;
    let bestMatchScore = 0;

    for (const listing of listings) {
      const targetTokens = new Set(
        `${listing.address} ${listing.city} ${listing.state}`
          .toLowerCase()
          .split(/[^a-z0-9]+/)
          .filter(Boolean),
      );
      let matchScore = 0;
      for (const token of queryTokens) {
        if (targetTokens.has(token)) matchScore++;
      }
      if (matchScore > bestMatchScore) {
        bestMatchScore = matchScore;
        bestListing = listing;
      }
    }

    if (!bestListing || bestMatchScore === 0) {
      reply.status(404).send({ error: 'not found' });
      return;
    }

    return {
      ...bestListing,
      score_breakdown: bestListing.score_breakdown
        ? JSON.parse(bestListing.score_breakdown)
        : null,
      match_score: bestMatchScore,
    };
  });
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
pnpm build
```

Expected: exits 0, no errors.

- [ ] **Step 3: Start the dev server and test with curl**

```bash
pnpm dev
```

In a second terminal, run a known address from your DB (substitute a real address):

```bash
curl -s "http://localhost:3000/api/listings/by-address?q=123+Main+St+Wayne" | jq .
```

Expected: JSON object with all listing fields, `score_breakdown` as an object (not a string), and `match_score` as a number >= 1.

- [ ] **Step 4: Test the 404 case**

```bash
curl -s -o /dev/null -w "%{http_code}" "http://localhost:3000/api/listings/by-address?q=zzznomatchever"
```

Expected: `404`

- [ ] **Step 5: Test the 400 case**

```bash
curl -s -o /dev/null -w "%{http_code}" "http://localhost:3000/api/listings/by-address"
```

Expected: `400`

- [ ] **Step 6: Commit**

```bash
git add src/web/routes.ts
git commit -m "feat: add GET /api/listings/by-address fuzzy lookup endpoint"
```
