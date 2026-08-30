import fetch from 'node-fetch';
import Anthropic from '@anthropic-ai/sdk';
import { getListingsMissingBrief, saveBrief, logRedfinFetch, getRedfinFetchStats, getListingRemarks } from '../db/index.js';

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

export async function fetchListingPage(url: string, listingId = 'unknown'): Promise<string> {
  const res = await fetch(url, { headers: HEADERS });
  // Redfin's bot mitigation can return 202 with an empty body when rate-limiting a client —
  // that's a 2xx (res.ok is true) so it wouldn't otherwise be caught here.
  if (!res.ok || res.status !== 200) {
    logRedfinFetch(listingId, true, `HTTP ${res.status}`);
    throw new Error(`HTTP ${res.status} fetching ${url}`);
  }
  const text = await res.text();
  if (text.length < 10_000) {
    logRedfinFetch(listingId, true, `short response (${text.length}b)`);
    throw new Error(`Suspiciously short response (${text.length} bytes) fetching ${url} — likely blocked`);
  }
  logRedfinFetch(listingId, false, `${text.length}b`);
  return text;
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

  const panel = html.slice(panelStart, panelStart + 8000);

  const rows: SaleHistoryRow[] = [];
  const rowRegex = /<div class="BasicTable__col date">([^<]+)<\/div>\s*<div class="BasicTable__col event[^"]*">([^<]+)<\/div>\s*<div class="BasicTable__col price">\$?([\d,]+)/g;

  let m: RegExpExecArray | null;
  while ((m = rowRegex.exec(panel)) !== null) {
    rows.push({ date: m[1].trim(), event: m[2].trim(), price: `$${m[3].trim()}` });
  }
  return rows;
}

export interface BriefResult {
  short: string;
  full: string[];
}

/**
 * Redfin truncates `listingRemarks` at 699 chars, often mid-word. Handing that to the model makes
 * it report the truncation itself as a finding ("description ends mid-sentence — check what was
 * cut off"), which is noise about our data pipeline rather than about the house. Cut back to the
 * last complete sentence so the text simply reads as shorter.
 */
export function trimToCompleteSentence(text: string): string {
  const t = text.trim();
  if (/[.!?]["')\]]?$/.test(t)) return t; // already ends cleanly

  const lastStop = Math.max(t.lastIndexOf('. '), t.lastIndexOf('! '), t.lastIndexOf('? '));
  // Only trim when a sentence boundary exists and keeping it retains most of the text; otherwise
  // a remark with no punctuation would be gutted.
  if (lastStop > 0 && lastStop >= t.length * 0.4) return t.slice(0, lastStop + 1);
  return t;
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
  // Omit absent sections entirely rather than announcing them. Telling the model "no sale
  // history available" invites it to report that absence as a finding, which is noise — the
  // buyer wants analysis of what IS known, not an inventory of what we failed to fetch.
  const sections = [
    `Address: ${address}`,
    `Price: $${price.toLocaleString()}`,
    `Beds: ${beds} | Sqft: ${sqft ?? 'unknown'}`,
    `Days on market: ${dom ?? 'unknown'}`,
  ];
  if (description) sections.push(`\nListing description:\n${description}`);
  if (history.length) {
    sections.push(`\nSale/price history:\n${history.map(r => `${r.date}: ${r.event} ${r.price}`).join('\n')}`);
  }

  const prompt = `You are helping a buyer prepare for a home showing. Analyze this listing and produce a brief.

${sections.join('\n')}

Respond with ONLY valid JSON in this exact shape:
{
  "short": "1-2 sentence headline insight — the single sharpest observation about this listing",
  "full": ["bullet 1", "bullet 2", "bullet 3"]
}

Rules:
- short: lead with the most important signal (flip risk, stale listing, negotiation leverage, standout value)
- full: 3-5 bullets covering flip/relist detection, negotiation position, inspection flags from description, price trajectory. Omit bullets with nothing notable to say.
- Terse, analytical, no filler. Write for a buyer doing pre-showing prep.
- full bullets must be plain strings, no markdown formatting
- Analyze only what is given above. NEVER remark on information that is absent, partial, or
  truncated (missing description, missing sale history, text that seems cut off, "limited
  information"). Those are artifacts of our data pipeline, not facts about the property, and
  reporting them as findings is actively misleading. If something is not present, say nothing
  about it — write the brief from what IS there, even if that means fewer bullets.
- Price trajectory context: US home values rose ~40-60% from 2019-2024 due to market conditions alone. Do NOT cite appreciation in that range as evidence of renovations or unusual quality. Only flag price history if it shows flip patterns (bought and relisted within 1-2 years at a steep markup) or appreciation dramatically above 80%+ in a short window that suggests major improvement. General long-run appreciation is baseline, not signal.`;

  const message = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 512,
    messages: [{ role: 'user', content: prompt }],
  });

  const raw = message.content[0].type === 'text' ? message.content[0].text : '';
  // Strip markdown code fences if the model wraps JSON in ```json ... ```
  const text = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim();
  const parsed = JSON.parse(text) as BriefResult;
  return parsed;
}

const BRIEF_SCORE_THRESHOLD = 60;

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Spread requests out to avoid tripping Redfin's WAF on large backlogs. Tunable via env so a
// big backfill can be run slower without a code change (Redfin throttles after a short burst).
const BRIEF_FETCH_DELAY_MS = parseInt(process.env.BRIEF_FETCH_DELAY_MS ?? '4500', 10);
const MAX_CONSECUTIVE_BLOCKED = 3; // stop early once we're clearly blocked rather than burning through the whole queue

export async function runBriefEnrichment(): Promise<void> {
  const listings = getListingsMissingBrief(BRIEF_SCORE_THRESHOLD);
  console.log(`[brief] ${listings.length} listings need briefs`);
  if (listings.length === 0) return;

  if (getRedfinFetchStats().currentlyBlocked) {
    // Don't skip outright — that would mean we never notice when the block clears. Just cap
    // how many attempts we burn confirming we're still blocked (the circuit breaker below
    // handles this every run already; this just avoids logging a misleadingly large queue size).
    console.log('[brief] last 3 Redfin fetches were blocked — probing a few before giving up this run');
  }

  let updated = 0;
  let failed = 0;
  let consecutiveBlocked = 0;

  for (const listing of listings) {
    try {
      // Prefer the description captured from the JSON feed at poll time. It's truncated at 699
      // chars but needs no HTTP request here, so briefs keep working when the HTML listing pages
      // are WAF-blocked. Falling back to scraping only buys the untruncated text plus deep sale
      // history, so it isn't worth a request (or a circuit-breaker strike) when we already have
      // remarks — the sale history we care most about (relists, price cuts) is in our own DB.
      const stored = listing.listing_remarks?.trim();
      if (stored) {
        const brief = await generateBrief(
          `${listing.address}, ${listing.city}`,
          listing.price,
          listing.beds,
          listing.sqft,
          listing.days_on_market,
          trimToCompleteSentence(stored),
          [],
        );
        saveBrief(listing.id, brief.short, brief.full);
        console.log(`[brief] ${listing.address}, ${listing.city} — done (stored remarks)`);
        updated++;
        consecutiveBlocked = 0;
        continue;
      }

      const html = await fetchListingPage(listing.url ?? '', listing.id);
      const description = extractDescription(html);
      const history = extractSaleHistory(html);
      if (description === null && history.length === 0) {
        // Real Redfin listing pages virtually always have at least a description or sale
        // history — both missing usually means Redfin served a stripped/bot-check page
        // instead of the real one (seen under sustained sequential fetching), not that the
        // listing genuinely has neither. Skip rather than let the LLM write confident
        // analysis off blank input; it stays eligible (brief_short still NULL) for retry
        // on the next enrichment pass.
        console.log(`[brief] ${listing.address}, ${listing.city} — skipped (no description or history extracted, likely a blocked/stripped fetch)`);
        failed++;
        consecutiveBlocked++;
        if (consecutiveBlocked >= MAX_CONSECUTIVE_BLOCKED) {
          console.log(`[brief] ${consecutiveBlocked} consecutive blocked fetches — stopping early, remaining listings retry next pass`);
          break;
        }
        await sleep(BRIEF_FETCH_DELAY_MS);
        continue;
      }
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
      consecutiveBlocked = 0;
    } catch (err) {
      console.error(`[brief] error for ${listing.address}:`, err);
      failed++;
      consecutiveBlocked++;
      if (consecutiveBlocked >= MAX_CONSECUTIVE_BLOCKED) {
        console.log(`[brief] ${consecutiveBlocked} consecutive failures — stopping early, remaining listings retry next pass`);
        break;
      }
    }
    await sleep(BRIEF_FETCH_DELAY_MS);
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
  // Same remarks-first path as runBriefEnrichment: the HTML page is WAF-blocked from most
  // datacenter IPs, so scraping it makes this endpoint fail in production. Stored remarks are
  // captured at poll time and need no outbound request at all.
  const stored = getListingRemarks(id)?.trim();
  if (stored) {
    const brief = await generateBrief(
      `${address}, ${city}`, price, beds, sqft, dom, trimToCompleteSentence(stored), [],
    );
    saveBrief(id, brief.short, brief.full);
    return { brief_short: brief.short, brief_full: brief.full };
  }

  let html = await fetchListingPage(url, id);
  let description = extractDescription(html);
  let history = extractSaleHistory(html);
  if (description === null && history.length === 0) {
    // Likely a blocked/stripped fetch rather than a genuinely bare listing — one retry
    // is usually enough to get past a transient block (see runBriefEnrichment for the
    // same check in the bulk path).
    await sleep(2000);
    html = await fetchListingPage(url, id);
    description = extractDescription(html);
    history = extractSaleHistory(html);
    if (description === null && history.length === 0) {
      throw new Error('Could not extract description or sale history after retry — Redfin may be blocking this fetch');
    }
  }
  const brief = await generateBrief(`${address}, ${city}`, price, beds, sqft, dom, description, history);
  saveBrief(id, brief.short, brief.full);
  return { brief_short: brief.short, brief_full: brief.full };
}
