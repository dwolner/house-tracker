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

  const raw = message.content[0].type === 'text' ? message.content[0].text : '';
  // Strip markdown code fences if the model wraps JSON in ```json ... ```
  const text = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim();
  const parsed = JSON.parse(text) as BriefResult;
  return parsed;
}
