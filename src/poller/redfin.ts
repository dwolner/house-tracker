import fetch from 'node-fetch';

// Redfin region IDs verified against live data (redfin.com/city/{id}/PA/{name})
// region_type 6 = city, 5 = neighborhood
export const TARGET_REGIONS = [
  // Primary: Lower Merion SD
  { name: 'Narberth/Penn Valley', region_id: '13565', region_type: 6 },
  { name: 'Ardmore', region_id: '30811', region_type: 6 },
  { name: 'Bryn Mawr', region_id: '21717', region_type: 6 },
  { name: 'Bala Cynwyd', region_id: '36379', region_type: 6 },
  { name: 'Merion Station', region_id: '36339', region_type: 6 },
  // Lower Merion township areas — use internal zip-based region IDs (region_type 2)
  // IDs sourced from /zipcode/19041 and /zipcode/19096 page embeds
  { name: 'Haverford', region_id: '7344', region_type: 2 },
  { name: 'Wynnewood', region_id: '7388', region_type: 2 },
  // Secondary: outside Lower Merion SD
  { name: 'Wayne', region_id: '37906', region_type: 6 },
  { name: 'Berwyn', region_id: '31134', region_type: 6 },
  { name: 'King of Prussia', region_id: '7530', region_type: 2 },
];

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
  status: string;
  days_on_market: number | null;
  next_open_house_start: string | null;
  next_open_house_end: string | null;
}

const REDFIN_BASE = 'https://www.redfin.com';
const HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
  Referer: 'https://www.redfin.com/',
};

function parseNum(val: string | undefined): number | null {
  if (!val || val === '' || val === 'null') return null;
  const n = parseFloat(val.replace(/,/g, ''));
  return isNaN(n) ? null : n;
}

async function fetchListingsByStatus(
  region_id: string,
  region_type: number,
  status: string,
): Promise<RedfinListing[]> {
  const params = new URLSearchParams({
    al: '1',
    region_id,
    region_type: String(region_type),
    uipt: '1,2,3', // single family, condo, townhouse
    status,
    num_beds: '3',
    max_price: '2000000',
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
        status: get(col('STATUS')),
        days_on_market: parseNum(get(col('DAYS ON MARKET'))),
        next_open_house_start: get(col('NEXT OPEN HOUSE START TIME')) || null,
        next_open_house_end: get(col('NEXT OPEN HOUSE END TIME')) || null,
      } satisfies RedfinListing,
    ];
  });
}

export async function fetchRegionListings(
  region_id: string,
  region_type: number,
): Promise<RedfinListing[]> {
  const [active, comingSoon] = await Promise.all([
    fetchListingsByStatus(region_id, region_type, '9'), // active
    fetchListingsByStatus(region_id, region_type, '1'), // coming soon
  ]);

  // Deduplicate by MLS# — active takes precedence if a listing appears in both
  const seen = new Map<string, RedfinListing>();
  for (const listing of [...comingSoon, ...active]) {
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
