# Listing Briefs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Auto-generate a short AI brief per listing (description + sale history → Claude Haiku) displayed inline on cards with expand to full brief.

**Architecture:** New `src/enrichment/brief.ts` scrapes the Redfin listing page HTML for description and sale history, calls Claude Haiku to produce a short + full brief, persists to two new DB columns. Runs automatically at end of enrichment for score ≥ 60 listings; on-demand for others via POST route.

**Tech Stack:** TypeScript, `node-fetch`, `@anthropic-ai/sdk`, `better-sqlite3`, Fastify, vanilla JS card UI

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `src/enrichment/brief.ts` | **Create** | Scrape Redfin page, call Haiku, export `runBriefEnrichment` + `generateBriefForListing` |
| `src/db/index.ts` | **Modify** | Migration + `getListingsMissingBrief()` + `saveBrief()` |
| `src/enrichment/walk-score.ts` | **Modify** | Call `runBriefEnrichment()` at end of `runEnrichment()` |
| `src/web/routes.ts` | **Modify** | Add `brief_short`/`brief_full` to SELECT; add `POST /api/listings/:id/brief` |
| `src/web/public/app.js` | **Modify** | Render brief on card; on-demand "Brief" button |
| `src/web/public/style.css` | **Modify** | Style brief text and expanded bullet list |

---

## Task 1: Install SDK + DB Migration

**Files:**
- Modify: `package.json`
- Modify: `src/db/index.ts:147-163`

- [ ] **Install Anthropic SDK**

```bash
pnpm add @anthropic-ai/sdk
```

Expected: `@anthropic-ai/sdk` appears in `package.json` dependencies.

- [ ] **Add migration in `src/db/index.ts`** — add two lines after the existing `superseded_by` migration (line 161):

```typescript
  if (!cols.includes('brief_short')) _db.exec(`ALTER TABLE listings ADD COLUMN brief_short TEXT`);
  if (!cols.includes('brief_full')) _db.exec(`ALTER TABLE listings ADD COLUMN brief_full TEXT`);
```

- [ ] **Verify migration runs**

```bash
npx tsx -e "import './src/db/index.ts'; import { getDb } from './src/db/index.ts'; const cols = getDb().prepare('PRAGMA table_info(listings)').all().map(c => c.name); console.log(cols.includes('brief_short'), cols.includes('brief_full'));"
```

Expected output: `true true`

- [ ] **Commit**

```bash
git add src/db/index.ts package.json pnpm-lock.yaml
git commit -m "feat: add brief_short/brief_full columns + Anthropic SDK"
```

---

## Task 2: DB Functions

**Files:**
- Modify: `src/db/index.ts` (append after `getListingsMissingSchoolDistrict`)

- [ ] **Add `getListingsMissingBrief` and `saveBrief` to `src/db/index.ts`**

Add after the `getListingsMissingSchoolDistrict` function:

```typescript
export function getListingsMissingBrief(scoreThreshold: number): ListingForEnrichment[] {
  return getDb()
    .prepare(`SELECT id, address, city, state, zip, lat, lng, beds, price, sqft, lot_sqft,
                     days_on_market, property_type, walk_score, school_district, url, locale_id
              FROM listings
              WHERE brief_short IS NULL
                AND score >= ?
                AND status IN ('9', '1')
                AND superseded_by IS NULL`)
    .all(scoreThreshold) as ListingForEnrichment[];
}

export function saveBrief(id: string, briefShort: string, briefFull: string[]): void {
  getDb()
    .prepare(`UPDATE listings SET brief_short = ?, brief_full = ? WHERE id = ?`)
    .run(briefShort, JSON.stringify(briefFull), id);
}
```

- [ ] **Verify types compile**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Commit**

```bash
git add src/db/index.ts
git commit -m "feat: add getListingsMissingBrief and saveBrief DB functions"
```

---

## Task 3: Redfin Page Scraper

**Files:**
- Create: `src/enrichment/brief.ts`

- [ ] **Create `src/enrichment/brief.ts`** with all imports up front and the page fetch + HTML extraction:

```typescript
import fetch from 'node-fetch';
import Anthropic from '@anthropic-ai/sdk';
import { getListingsMissingBrief, saveBrief } from '../db/index.js';

const HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
  Referer: 'https://www.redfin.com/',
};

export interface SaleHistoryRow {
  date: string;
  event: string;
  price: string;
}

export async function fetchListingPage(url: string): Promise<string> {
  const res = await fetch(url, { headers: HEADERS });
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${url}`);
  return res.text();
}

export function extractDescription(html: string): string | null {
  const match = html.match(/class="remarks"[^>]*>[\s\S]*?<p[^>]*>([\s\S]*?)<\/p>/);
  if (!match) return null;
  return match[1]
    .replace(/<span[^>]*class="highlightedTag"[^>]*>(.*?)<\/span>/g, '$1')
    .replace(/<[^>]+>/g, '')
    .replace(/&rsquo;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&nbsp;/g, ' ')
    .replace(/&ldquo;/g, '"')
    .replace(/&rdquo;/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

export function extractSaleHistory(html: string): SaleHistoryRow[] {
  const panelStart = html.indexOf('saleHistoryPanel');
  if (panelStart === -1) return [];

  // Grab a generous slice around the panel
  const panel = html.slice(panelStart, panelStart + 8000);

  const rows: SaleHistoryRow[] = [];
  // Match rows that have all three cols — skip mlsAttr/header rows
  const rowRegex = /<div class="BasicTable__col date">([^<]+)<\/div>\s*<div class="BasicTable__col event[^"]*">([^<]+)<\/div>\s*<div class="BasicTable__col price">\$?([\d,]+)/g;

  let m: RegExpExecArray | null;
  while ((m = rowRegex.exec(panel)) !== null) {
    rows.push({ date: m[1].trim(), event: m[2].trim(), price: `$${m[3].trim()}` });
  }
  return rows;
}
```

- [ ] **Smoke test the scraper against a real listing**

```bash
npx tsx -e "
import { fetchListingPage, extractDescription, extractSaleHistory } from './src/enrichment/brief.ts';
const html = await fetchListingPage('https://www.redfin.com/CA/San-Diego/4044-Loma-Riviera-Cir-92110/home/5276440');
console.log('desc:', extractDescription(html)?.slice(0, 200));
console.log('history:', JSON.stringify(extractSaleHistory(html), null, 2));
"
```

Expected: description text printed, history array with at least one `{ date, event, price }` row.

- [ ] **Commit**

```bash
git add src/enrichment/brief.ts
git commit -m "feat: add Redfin listing page scraper for description and sale history"
```

---

## Task 4: Haiku Brief Generation

**Files:**
- Modify: `src/enrichment/brief.ts`

- [ ] **Add Haiku call to `src/enrichment/brief.ts`** — append after `extractSaleHistory`:

```typescript
export interface BriefResult {
  short: string;
  full: string[];
}

const anthropic = new Anthropic();

export async function generateBrief(
  address: string,
  price: number,
  beds: number,
  sqft: number | null,
  dom: number | null,
  description: string | null,
  history: SaleHistoryRow[],
): Promise<BriefResult> {
  const historyText = history.length
    ? history.map(r => `${r.date}: ${r.event} ${r.price}`).join('\n')
    : 'No sale history available.';

  const prompt = `You are helping a buyer prepare for a home showing. Analyze this listing and produce a brief.

Address: ${address}
Price: $${price.toLocaleString()}
Beds: ${beds} | Sqft: ${sqft ?? 'unknown'}
Days on market: ${dom ?? 'unknown'}

Listing description:
${description ?? 'Not available.'}

Sale/price history:
${historyText}

Respond with ONLY valid JSON in this exact shape:
{
  "short": "1-2 sentence headline insight — the single sharpest observation about this listing",
  "full": ["bullet 1", "bullet 2", "bullet 3"]
}

Rules:
- short: lead with the most important signal (flip risk, stale listing, negotiation leverage, standout value)
- full: 3-5 bullets covering flip/relist detection, negotiation position, inspection flags from description, price trajectory. Omit bullets with nothing notable to say.
- Terse, analytical, no filler. Write for a buyer doing pre-showing prep.
- full bullets must be plain strings, no markdown formatting`;

  const message = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 512,
    messages: [{ role: 'user', content: prompt }],
  });

  const text = message.content[0].type === 'text' ? message.content[0].text : '';
  const parsed = JSON.parse(text) as BriefResult;
  return parsed;
}
```

- [ ] **Smoke test Haiku call against a real listing** (requires `ANTHROPIC_API_KEY` in `.env`):

```bash
npx tsx -e "
import { fetchListingPage, extractDescription, extractSaleHistory, generateBrief } from './src/enrichment/brief.ts';
const html = await fetchListingPage('https://www.redfin.com/CA/San-Diego/4044-Loma-Riviera-Cir-92110/home/5276440');
const desc = extractDescription(html);
const hist = extractSaleHistory(html);
const brief = await generateBrief('4044 Loma Riviera Cir, San Diego', 925000, 4, 1716, 18, desc, hist);
console.log(JSON.stringify(brief, null, 2));
"
```

Expected: JSON with `short` string and `full` array of 3-5 bullets.

- [ ] **Commit**

```bash
git add src/enrichment/brief.ts
git commit -m "feat: add Haiku brief generation"
```

---

## Task 5: Enrichment Pipeline + On-Demand Function

**Files:**
- Modify: `src/enrichment/brief.ts` (append)
- Modify: `src/enrichment/walk-score.ts`

- [ ] **Add `runBriefEnrichment` and `generateBriefForListing` to `src/enrichment/brief.ts`**

Append to the file:

```typescript
const BRIEF_SCORE_THRESHOLD = 60;

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export async function runBriefEnrichment(): Promise<void> {
  const listings = getListingsMissingBrief(BRIEF_SCORE_THRESHOLD);
  console.log(`[brief] ${listings.length} listings need briefs`);
  if (listings.length === 0) return;

  let updated = 0;
  let failed = 0;

  for (const listing of listings) {
    try {
      const html = await fetchListingPage(listing.url ?? '');
      const description = extractDescription(html);
      const history = extractSaleHistory(html);
      const brief = await generateBrief(
        `${listing.address}, ${listing.city}`,
        listing.price,
        listing.beds,
        listing.sqft,
        listing.days_on_market,
        description,
        history,
      );
      saveBrief(listing.id, brief.short, brief.full);
      console.log(`[brief] ${listing.address}, ${listing.city} — done`);
      updated++;
    } catch (err) {
      console.error(`[brief] error for ${listing.address}:`, err);
      failed++;
    }
    await sleep(1500);
  }

  console.log(`[brief] done — ${updated} generated, ${failed} failed/skipped`);
}

export async function generateBriefForListing(
  id: string,
  url: string,
  address: string,
  city: string,
  price: number,
  beds: number,
  sqft: number | null,
  dom: number | null,
): Promise<{ brief_short: string; brief_full: string[] }> {
  const html = await fetchListingPage(url);
  const description = extractDescription(html);
  const history = extractSaleHistory(html);
  const brief = await generateBrief(`${address}, ${city}`, price, beds, sqft, dom, description, history);
  saveBrief(id, brief.short, brief.full);
  return { brief_short: brief.short, brief_full: brief.full };
}
```

- [ ] **Wire `runBriefEnrichment` into `src/enrichment/walk-score.ts`**

Add import at top:
```typescript
import { runBriefEnrichment } from './brief.js';
```

Add at the end of the `runEnrichment` function body, before the closing brace:
```typescript
  await runBriefEnrichment();
```

- [ ] **Verify types compile**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Commit**

```bash
git add src/enrichment/brief.ts src/enrichment/walk-score.ts
git commit -m "feat: wire brief enrichment into pipeline"
```

---

## Task 6: On-Demand API Route

**Files:**
- Modify: `src/web/routes.ts`

- [ ] **Add `brief_short` and `brief_full` to the listings SELECT in `src/web/routes.ts`**

Find the SELECT in `/api/listings` (around line 19) and add the two fields:

```typescript
    let sql = `
      SELECT id, address, city, state, zip, price, price_at_first_seen, beds, baths,
             sqft, lot_sqft, year_built, walk_score, school_district, property_type, days_on_market,
             score, score_breakdown, url, first_seen_at, last_seen_at, status, status_label, starred,
             next_open_house_start, next_open_house_end, lat, lng, locale_id,
             brief_short, brief_full
      FROM listings
```

- [ ] **Add the on-demand brief route to `src/web/routes.ts`**

Add after the existing `/api/listings/:id/history` route:

```typescript
  // Generate AI brief on demand for a single listing
  app.post('/api/listings/:id/brief', async (req, reply) => {
    const { id } = req.params as { id: string };
    const row = getDb()
      .prepare(`SELECT url, address, city, price, beds, sqft, days_on_market FROM listings WHERE id = ?`)
      .get(id) as { url: string; address: string; city: string; price: number; beds: number; sqft: number | null; days_on_market: number | null } | undefined;

    if (!row) return reply.status(404).send({ error: 'not found' });

    const { generateBriefForListing } = await import('../enrichment/brief.js');
    try {
      const result = await generateBriefForListing(id, row.url, row.address, row.city, row.price, row.beds, row.sqft, row.days_on_market);
      return result;
    } catch (err) {
      console.error(`[brief] on-demand failed for ${id}:`, err);
      return reply.status(500).send({ error: 'brief generation failed' });
    }
  });
```

- [ ] **Verify types compile**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Test the route** — start server, then:

```bash
# Start server in background
npx tsx src/index.ts &
sleep 3

# Pick a listing ID from your DB
ID=$(sqlite3 data/listings.db "SELECT id FROM listings WHERE status='9' AND score >= 60 LIMIT 1;")
curl -s -X POST http://localhost:3000/api/listings/$ID/brief | head -c 500

kill %1
```

Expected: JSON `{ "brief_short": "...", "brief_full": ["...", ...] }`.

- [ ] **Commit**

```bash
git add src/web/routes.ts
git commit -m "feat: add brief_short/brief_full to listings API + POST /api/listings/:id/brief"
```

---

## Task 7: Card UI

**Files:**
- Modify: `src/web/public/app.js`
- Modify: `src/web/public/style.css`

- [ ] **Add CSS for brief to `src/web/public/style.css`** — add after the `.oh-day-header` block:

```css
.brief-short {
  font-style: italic;
  font-size: 12px;
  color: var(--text-dim);
  cursor: pointer;
  padding: 4px 0 2px;
  line-height: 1.4;
  user-select: none;
}
.brief-short:hover {
  color: var(--text);
}
.brief-full {
  display: none;
  margin: 4px 0 2px 0;
  padding-left: 14px;
  list-style: disc;
}
.brief-full.open {
  display: block;
}
.brief-full li {
  font-size: 12px;
  color: var(--text);
  line-height: 1.5;
  margin-bottom: 2px;
}
.brief-btn {
  background: none;
  border: none;
  padding: 0;
  font-size: 11px;
  color: var(--text-faint);
  cursor: pointer;
  font-family: var(--font-ui);
  text-decoration: underline;
  text-underline-offset: 2px;
}
.brief-btn:hover {
  color: var(--text-dim);
}
```

- [ ] **Add `renderBrief` helper to `src/web/public/app.js`** — add before `renderCards`:

```javascript
function renderBrief(l) {
  if (l.brief_short) {
    const fullBullets = (() => {
      try { return JSON.parse(l.brief_full || '[]'); } catch { return []; }
    })();
    const id = `brief-${l.id}`;
    const bullets = fullBullets.map(b => `<li>${b}</li>`).join('');
    return `
      <div class="brief-short" onclick="document.getElementById('${id}').classList.toggle('open')">
        ${l.brief_short}
      </div>
      <ul id="${id}" class="brief-full">${bullets}</ul>`;
  }
  return `<button class="brief-btn" onclick="requestBrief('${l.id}', this)">Brief</button>`;
}

async function requestBrief(id, btn) {
  btn.textContent = '…';
  btn.disabled = true;
  try {
    const res = await fetch(`/api/listings/${id}/brief`, { method: 'POST' });
    if (!res.ok) throw new Error('failed');
    const data = await res.json();
    const wrap = btn.closest('.card').querySelector('.brief-wrap');
    if (wrap) {
      // Build the full brief inline
      const fullBullets = Array.isArray(data.brief_full) ? data.brief_full : JSON.parse(data.brief_full || '[]');
      const listId = `brief-${id}`;
      wrap.innerHTML = `
        <div class="brief-short" onclick="document.getElementById('${listId}').classList.toggle('open')">
          ${data.brief_short}
        </div>
        <ul id="${listId}" class="brief-full open">${fullBullets.map(b => `<li>${b}</li>`).join('')}</ul>`;
    }
  } catch {
    btn.textContent = 'Brief';
    btn.disabled = false;
  }
}
```

- [ ] **Add `.brief-wrap` div to the card template in `renderCards`** — find the meta line rendering in `renderCards` and add the brief div after it:

Find:
```javascript
      ${metaLine ? `<div class="card-meta">${metaLine}</div>` : ""}
```

Replace with:
```javascript
      ${metaLine ? `<div class="card-meta">${metaLine}</div>` : ""}
      <div class="brief-wrap">${renderBrief(l)}</div>
```

- [ ] **Start dev server and verify**

```bash
npx tsx src/index.ts
```

Open http://localhost:3000. Check that:
- Cards with `score >= 60` that have a brief show the short italic text
- Clicking it expands the bullet list
- Cards without a brief show the "Brief" button
- Clicking "Brief" button makes a request and renders the result

- [ ] **Commit**

```bash
git add src/web/public/app.js src/web/public/style.css
git commit -m "feat: render listing briefs on cards with expand and on-demand button"
```

---

## Task 8: End-to-End Verification + Deploy

- [ ] **Run enrichment to generate briefs for qualifying listings**

```bash
npx tsx src/enrichment/walk-score.ts
```

Watch for `[brief] X listings need briefs` and `[brief] done` lines in output.

- [ ] **Confirm briefs written to DB**

```bash
sqlite3 data/listings.db "SELECT address, brief_short FROM listings WHERE brief_short IS NOT NULL LIMIT 5;"
```

Expected: 5 rows with address and short brief text.

- [ ] **Push DB and deploy**

```bash
npm run push-db
fly deploy
```

- [ ] **Smoke test production**

Open the live URL, check cards show briefs, on-demand button works for a below-threshold listing.
