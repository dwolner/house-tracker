import fetch from 'node-fetch';

export interface RedfinListing {
  id: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  price: number;
  beds: number;
  baths: number;
  sqft: number | null;
  lot_sqft: number | null;
  year_built: number | null;
  walk_score: number | null;       // not in CSV — populated by enrichment
  school_district: string | null;  // not in CSV — populated by enrichment
  property_type: string | null;
  lat: number;
  lng: number;
  url: string | null;
  status: string;                  // normalised to '9' | '1' | '130' | '131'
  status_label: string;            // raw label from Redfin CSV ("Contingent", "Pending", etc.)
  days_on_market: number | null;
  next_open_house_start: string | null;
  next_open_house_end: string | null;
  sold_date: string | null;        // ISO date from "SOLD DATE" column, only in sold feed
}

const REDFIN_BASE = 'https://www.redfin.com';
const HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
  Referer: 'https://www.redfin.com/',
};

// Normalize Redfin STATUS column values to our internal codes.
// The CSV returns text ("Active", "Contingent", etc.) OR numeric strings ("9", "130", etc.)
// depending on the endpoint/region. We normalise to numeric for consistent DB storage.
export function normalizeStatus(raw: string): string {
  const s = raw.trim().toLowerCase();
  if (s === 'active' || s === '9') return '9';
  if (s === 'coming soon' || s === '1') return '1';
  if (s === 'pending' || s === 'contingent' || s === 'under contract' || s === '130') return '130';
  if (s === 'sold' || s === '131') return '131';
  return raw; // pass through anything unrecognised
}

// Redfin date format: "April-9-2026" or "4/9/2026" — normalize to ISO YYYY-MM-DD
function parseRedfinDate(val: string | undefined): string | null {
  if (!val || val.trim() === '') return null;
  // Dash format: "April-9-2026"
  const dashNorm = val.replace(/^(\w+)-(\d+)-(\d{4})$/, '$1 $2 $3');
  const d = new Date(dashNorm);
  if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  // Slash format: "4/9/2026"
  const slash = new Date(val);
  if (!isNaN(slash.getTime())) return slash.toISOString().slice(0, 10);
  return null;
}

function parseNum(val: string | undefined): number | null {
  if (!val || val === '' || val === 'null') return null;
  const n = parseFloat(val.replace(/,/g, ''));
  return isNaN(n) ? null : n;
}

async function fetchListingsByStatus(
  region_id: string,
  region_type: number,
  status: string,
  minBeds: number,
  maxPrice: number,
): Promise<RedfinListing[]> {
  const params = new URLSearchParams({
    al: '1',
    region_id,
    region_type: String(region_type),
    uipt: '1,2,3', // single family, condo, townhouse
    status,
    num_beds: String(minBeds),
    max_price: String(maxPrice),
    num_homes: '350',
    v: '8',
  });

  const res = await fetch(`${REDFIN_BASE}/stingray/api/gis-csv?${params}`, { headers: HEADERS });

  if (!res.ok) throw new Error(`Redfin ${res.status} for region ${region_id}`);

  const text = await res.text();
  const lines = text
    .trim()
    .split('\n')
    .filter(l => l.trim() && !l.includes('MLS rules'));

  if (lines.length < 2) return [];

  const rawHeaders = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''));

  // The URL column has a very long header — match by prefix
  const urlColIdx = rawHeaders.findIndex(h => h.startsWith('URL'));

  const col = (name: string) => rawHeaders.indexOf(name);

  return lines.slice(1).flatMap(line => {
    const cols = parseCSVLine(line);
    const get = (idx: number) => cols[idx]?.replace(/^"|"$/g, '').trim() ?? '';

    const price = parseNum(get(col('PRICE')));
    const lat = parseNum(get(col('LATITUDE')));
    const lng = parseNum(get(col('LONGITUDE')));
    const mlsId = get(col('MLS#'));

    // Skip rows missing critical fields
    if (!price || !lat || !lng || !mlsId) return [];

    const urlPath = get(urlColIdx);
    const url = urlPath.startsWith('http') ? urlPath : `${REDFIN_BASE}${urlPath}`;

    return [
      {
        id: mlsId,
        address: get(col('ADDRESS')),
        city: get(col('CITY')),
        state: get(col('STATE OR PROVINCE')),
        zip: get(col('ZIP OR POSTAL CODE')),
        price,
        beds: parseNum(get(col('BEDS'))) ?? 0,
        baths: parseNum(get(col('BATHS'))) ?? 0,
        sqft: parseNum(get(col('SQUARE FEET'))),
        lot_sqft: parseNum(get(col('LOT SIZE'))),
        year_built: parseNum(get(col('YEAR BUILT'))),
        walk_score: null,
        school_district: null,
        property_type: get(col('PROPERTY TYPE')) || null,
        lat,
        lng,
        url,
        status: normalizeStatus(get(col('STATUS'))),
        status_label: get(col('STATUS')),
        days_on_market: parseNum(get(col('DAYS ON MARKET'))),
        next_open_house_start: get(col('NEXT OPEN HOUSE START TIME')) || null,
        next_open_house_end: get(col('NEXT OPEN HOUSE END TIME')) || null,
        sold_date: parseRedfinDate(get(col('SOLD DATE'))),
      } satisfies RedfinListing,
    ];
  });
}

// Fetch recently sold listings for a region — separate from active pipeline.
// The PRICE column in the sold feed is the sale price (what the home actually closed at).
export async function fetchRecentlySold(
  region_id: string,
  region_type: number,
  minBeds: number,
  maxPrice: number,
): Promise<RedfinListing[]> {
  return fetchListingsByStatus(region_id, region_type, '131', minBeds, maxPrice);
}

export async function fetchRegionListings(
  region_id: string,
  region_type: number,
  minBeds: number,
  maxPrice: number,
): Promise<RedfinListing[]> {
  const [active, comingSoon, pending] = await Promise.all([
    fetchListingsByStatus(region_id, region_type, '9',   minBeds, maxPrice),
    fetchListingsByStatus(region_id, region_type, '1',   minBeds, maxPrice),
    fetchListingsByStatus(region_id, region_type, '130', minBeds, maxPrice),
  ]);

  // Deduplicate by MLS# — priority: active > pending > coming soon
  const seen = new Map<string, RedfinListing>();
  for (const listing of [...comingSoon, ...pending, ...active]) {
    seen.set(listing.id, listing);
  }
  return [...seen.values()];
}

function parseCSVLine(line: string): string[] {
  const cols: string[] = [];
  let cur = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (ch === ',' && !inQuotes) {
      cols.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  cols.push(cur);
  return cols;
}
