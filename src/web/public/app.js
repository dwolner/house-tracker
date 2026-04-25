// === STATE ===
let allListings = [];
let activeLocale = localStorage.getItem('locale') ?? 'main-line';
let selectedAreas = new Set();
let rawInventoryData = [];
let rawTrendsData = null;
let inventoryChart = null;
let priceTrendChart = null;
let scoreTrendChart = null;
let outcomesChart = null;

// === LOCALE CONFIG ===

const SD_NEIGHBORHOODS = [
  { zip: '92110', name: 'Bay Park / Loma Portal',  color: '#4f8ef7' },
  { zip: '92107', name: 'Point Loma Heights',       color: '#22c55e' },
  { zip: '92116', name: 'Kensington / Talmadge',   color: '#a855f7' },
  { zip: '92117', name: 'Bay Ho',                   color: '#f97316' },
  { zip: '92104', name: 'North Park',               color: '#06b6d4' },
  { zip: '92103', name: 'Mission Hills',            color: '#eab308' },
  { zip: '92120', name: 'Allied Gardens',           color: '#ec4899' },
];

const SD_POLLING_REGIONS = {
  92110: { label: 'Bay Park / Loma Portal',  color: '#4f8ef7' },
  92107: { label: 'Point Loma Heights',       color: '#22c55e' },
  92116: { label: 'Kensington / Talmadge',   color: '#a855f7' },
  92117: { label: 'Bay Ho',                   color: '#f97316' },
  92104: { label: 'North Park',               color: '#06b6d4' },
  92103: { label: 'Mission Hills',            color: '#eab308' },
  92120: { label: 'Allied Gardens',           color: '#ec4899' },
};

const PA_NEIGHBORHOOD_COLORS = {
  'Narberth/Penn Valley': '#4f8ef7',
  Ardmore: '#22c55e',
  'Bryn Mawr': '#a855f7',
  'Bala Cynwyd': '#f97316',
  'Merion Station': '#06b6d4',
  Haverford: '#eab308',
  Wynnewood: '#ec4899',
  Wayne: '#14b8a6',
  Berwyn: '#f43f5e',
  'King of Prussia': '#8b5cf6',
};

const PA_POLLING_ZIPS = {
  19072: { label: 'Narberth/Penn Valley', color: PA_NEIGHBORHOOD_COLORS['Narberth/Penn Valley'] },
  19003: { label: 'Ardmore',              color: PA_NEIGHBORHOOD_COLORS['Ardmore'] },
  19010: { label: 'Bryn Mawr',           color: PA_NEIGHBORHOOD_COLORS['Bryn Mawr'] },
  19004: { label: 'Bala Cynwyd',         color: PA_NEIGHBORHOOD_COLORS['Bala Cynwyd'] },
  19066: { label: 'Merion Station',      color: PA_NEIGHBORHOOD_COLORS['Merion Station'] },
  19041: { label: 'Haverford',           color: PA_NEIGHBORHOOD_COLORS['Haverford'] },
  19096: { label: 'Wynnewood',           color: PA_NEIGHBORHOOD_COLORS['Wynnewood'] },
  19087: { label: 'Wayne',              color: PA_NEIGHBORHOOD_COLORS['Wayne'] },
  19312: { label: 'Berwyn',             color: PA_NEIGHBORHOOD_COLORS['Berwyn'] },
  19406: { label: 'King of Prussia',    color: PA_NEIGHBORHOOD_COLORS['King of Prussia'] },
};

const LOCALE_AREA_NAMES = {
  'main-line': new Set(['Narberth/Penn Valley','Ardmore','Bryn Mawr','Bala Cynwyd','Merion Station','Haverford','Wynnewood','Wayne','Berwyn','King of Prussia']),
  'san-diego': new Set(['Bay Park / Loma Portal','Point Loma Heights','Kensington / Talmadge','Bay Ho','North Park','Mission Hills','Allied Gardens']),
};

const LOCALE_LABELS = {
  'main-line': '— Main Line',
  'san-diego': '— San Diego',
};

// === INIT & LOCALE SWITCHING ===

async function init() {
  const [listingsRes, statsRes, inventoryRes, outcomesRes, trendsRes] = await Promise.all([
    fetch('/api/listings').then(r => r.json()),
    fetch(`/api/stats?locale_id=${activeLocale}`).then(r => r.json()),
    fetch('/api/inventory').then(r => r.json()),
    fetch('/api/outcomes').then(r => r.json()),
    fetch('/api/trends').then(r => r.json()),
  ]);

  allListings = listingsRes;
  rawInventoryData = inventoryRes;
  rawTrendsData = trendsRes;

  // Sync locale tab UI
  document.querySelectorAll('.locale-tab').forEach(t => {
    t.classList.toggle('active', t.dataset.locale === activeLocale);
  });
  document.getElementById('locale-label').textContent = LOCALE_LABELS[activeLocale] ?? '';

  renderStats(statsRes);
  renderAreaFilter(statsRes.cities);

  const localeListings = allListings.filter(l => l.locale_id === activeLocale);
  renderCards(localeListings);
  renderMap(localeListings).catch(() => {});
  renderInventoryChart(rawInventoryData);
  renderTrendCharts(rawTrendsData);
  renderOutcomes(outcomesRes);
}

async function switchLocale(locale) {
  activeLocale = locale;
  localStorage.setItem('locale', locale);
  selectedAreas.clear();
  switchView('listings');
  document.querySelector('aside').scrollTop = 0;

  document.querySelectorAll('.locale-tab').forEach(t => {
    t.classList.toggle('active', t.dataset.locale === locale);
  });
  document.getElementById('locale-label').textContent = LOCALE_LABELS[locale] ?? '';

  // Reset filter controls
  document.getElementById('f-score').value = 0;
  document.getElementById('f-score-val').textContent = '0';
  document.getElementById('f-beds').value = '0';
  document.getElementById('f-price').value = '9999999';
  document.getElementById('f-type').value = '';
  document.getElementById('f-open-house').checked = false;

  const statsRes = await fetch(`/api/stats?locale_id=${locale}`).then(r => r.json());
  renderStats(statsRes);
  renderAreaFilter(statsRes.cities);

  const localeListings = allListings.filter(l => l.locale_id === activeLocale);
  renderCards(localeListings);
  renderMap(localeListings).catch(() => {});
  if (rawInventoryData.length) renderInventoryChart(rawInventoryData);
  if (rawTrendsData) renderTrendCharts(rawTrendsData);
  renderOutcomes(null);
}

function renderStats(statsRes) {
  document.getElementById('stat-total').textContent = statsRes.total;
  document.getElementById('stat-fresh').textContent = statsRes.fresh;
  document.getElementById('stat-poll').textContent = statsRes.lastPoll
    ? new Date(statsRes.lastPoll).toLocaleString()
    : 'never';
}

function renderAreaFilter(cities) {
  const label = document.getElementById('area-filter-label');
  const wrap = document.getElementById('city-checks');
  wrap.innerHTML = '';

  if (activeLocale === 'san-diego') {
    label.textContent = 'Neighborhood';
    SD_NEIGHBORHOODS.forEach(({ zip, name }) => {
      const lbl = document.createElement('label');
      lbl.innerHTML = `<input type="checkbox" value="${zip}" onchange="toggleArea('${zip}')" /> ${name}`;
      wrap.appendChild(lbl);
    });
  } else {
    label.textContent = 'City';
    cities.forEach(city => {
      const cap = city.charAt(0).toUpperCase() + city.slice(1);
      const lbl = document.createElement('label');
      const checked = selectedAreas.has(city) ? 'checked' : '';
      lbl.innerHTML = `<input type="checkbox" value="${city}" ${checked} onchange="toggleArea('${city}')" /> ${cap}`;
      wrap.appendChild(lbl);
    });
  }
}

// === FILTERS ===

function toggleArea(value) {
  if (selectedAreas.has(value)) selectedAreas.delete(value);
  else selectedAreas.add(value);
  applyFilters();
}

function parseOpenHouseDate(dateStr) {
  if (!dateStr) return null;
  const normalized = dateStr.replace(/^(\w+)-(\d+)-(\d+)/, '$1 $2 $3');
  const d = new Date(normalized);
  return isNaN(d) ? null : d;
}

function startOfToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

function isUpcoming(dateStr) {
  const d = parseOpenHouseDate(dateStr);
  return d != null && d >= startOfToday();
}

function isThisWeekend(dateStr) {
  const d = parseOpenHouseDate(dateStr);
  if (!d) return false;
  const now = new Date();
  const day = now.getDay();
  const satOffset = day === 0 ? -1 : 6 - day;
  const sat = new Date(now);
  sat.setDate(now.getDate() + satOffset);
  sat.setHours(0, 0, 0, 0);
  const sun = new Date(sat);
  sun.setDate(sat.getDate() + 1);
  sun.setHours(23, 59, 59, 999);
  return d >= sat && d <= sun;
}

function applyFilters() {
  const minScore = parseFloat(document.getElementById('f-score').value);
  const minBeds = parseInt(document.getElementById('f-beds').value);
  const maxPrice = parseInt(document.getElementById('f-price').value);
  const propType = document.getElementById('f-type').value.toLowerCase();
  const openHouseOnly = document.getElementById('f-open-house').checked;

  const filtered = allListings.filter(l => {
    if (l.locale_id !== activeLocale) return false;
    if (l.score < minScore) return false;
    if (l.beds < minBeds) return false;
    if (l.price > maxPrice) return false;
    if (propType && l.property_type?.toLowerCase() !== propType) return false;
    if (selectedAreas.size > 0) {
      const key = activeLocale === 'san-diego' ? l.zip : l.city?.toLowerCase();
      if (!selectedAreas.has(key)) return false;
    }
    if (openHouseOnly && !isUpcoming(l.next_open_house_start)) return false;
    return true;
  });

  if (openHouseOnly) {
    filtered.sort((a, b) => {
      const da = parseOpenHouseDate(a.next_open_house_start);
      const db = parseOpenHouseDate(b.next_open_house_start);
      const dateDiff = (da?.getTime() ?? Infinity) - (db?.getTime() ?? Infinity);
      if (dateDiff !== 0) return dateDiff;
      return b.score - a.score;
    });
  }

  renderCards(filtered);
  renderMap(filtered).catch(() => {});
  renderOutcomes(null);
}

function resetFilters() {
  document.getElementById('f-score').value = 0;
  document.getElementById('f-score-val').textContent = '0';
  document.getElementById('f-beds').value = '0';
  document.getElementById('f-price').value = '9999999';
  document.getElementById('f-type').value = '';
  document.getElementById('f-open-house').checked = false;
  selectedAreas.clear();
  document.querySelectorAll('#city-checks input').forEach(cb => (cb.checked = false));
  const localeListings = allListings.filter(l => l.locale_id === activeLocale);
  renderCards(localeListings);
  renderOutcomes(null);
}

// === FORMATTING HELPERS ===

function fmt(n) {
  return n != null ? n.toLocaleString() : '—';
}

function photoUrl(id) {
  if (!id) return null;
  let region;
  if (id.startsWith('PAMC'))                             region = 235; // PA TREND MLS
  else if (id.startsWith('NDP') || id.startsWith('PTP')) region = 45;  // SD CRMLS
  else if (/^\d{9}$/.test(id))                           region = 48;  // SD SDMLS (Sandicor)
  else return null;
  return `https://ssl.cdn-redfin.com/photo/${region}/mbpaddedwide/${id.slice(-3)}/genMid.${id}_0.jpg`;
}

function fmtAcres(sqft) {
  if (sqft == null) return '—';
  const ac = sqft / 43560;
  return ac < 0.1 ? sqft.toLocaleString() + ' sqft' : ac.toFixed(2) + ' ac';
}

function scoreClass(s) {
  if (s >= 80) return 'score-hi';
  if (s >= 60) return 'score-mid';
  return 'score-lo';
}

function domLabel(dom) {
  if (dom == null) return '';
  if (dom > 120) return `<span class="dom-warn">(⚠ ${dom} d)</span>`;
  if (dom > 30)  return `<span class="dom-mild">(~${dom} d)</span>`;
  return `<span class="dom-ok">(${dom} d)</span>`;
}

function priceChange(l) {
  if (!l.price_at_first_seen || l.price_at_first_seen === l.price) return '';
  const diff = l.price - l.price_at_first_seen;
  const sign = diff < 0 ? '▼' : '▲';
  const color = diff < 0 ? 'var(--green)' : 'var(--red)';
  return `<span style="font-size:11px;color:${color};margin-left:6px">${sign} $${Math.abs(diff).toLocaleString()}</span>`;
}

// === SCORE BREAKDOWN BARS ===

const FACTOR_LABELS = {
  propertyType:      'Type',
  schoolDistrict:    'School',
  walkability:       'Walk',
  price:             'Price',
  sqft:              'Sqft',
  lot:               'Lot',
  transit:           'Transit',
  beds:              'Beds',
  pricePerSqft:      '$/sqft',
  neighborhoodBonus: 'Local+',
  zipBonus:          'Zip+',
  domPenalty:        'DOM−',
  amtrak:            'Transit',
  narberthBonus:     'Local+',
};

const OLD_MAXES = {
  propertyType: 20, schoolDistrict: 20, walkability: 12, price: 12,
  sqft: 8, lot: 12, amtrak: 8, beds: 4, pricePerSqft: 4, narberthBonus: 6, domPenalty: 10,
};
const OLD_KEY_MAP = { amtrak: 'transit', narberthBonus: 'neighborhoodBonus' };

function parseBreakdown(raw) {
  if (!raw) return null;
  try {
    const bd = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (bd.factors) return bd;
    const factors = {};
    for (const [key, max] of Object.entries(OLD_MAXES)) {
      if (bd[key] != null) factors[OLD_KEY_MAP[key] ?? key] = { pts: bd[key], max };
    }
    return { total: bd.total, factors };
  } catch { return null; }
}

function scoreBars(raw) {
  const bd = parseBreakdown(raw);
  if (!bd) return '';
  const chips = Object.entries(bd.factors).map(([key, { pts, max }]) => {
    const pct = max > 0 ? pts / max : 0;
    const normalized = Math.round(pct * 100);
    const label = FACTOR_LABELS[key] ?? key;
    let chipCls;
    if (pts === 0) chipCls = 'zero';
    else if (key === 'domPenalty') chipCls = 'penalty';
    else if (key === 'neighborhoodBonus') chipCls = 'bonus';
    else if (normalized >= 70) chipCls = '';
    else if (normalized >= 40) chipCls = 'mid';
    else chipCls = 'lo';
    return `<div class="chip" title="${label}: ${pts.toFixed(1)} / ${max}">
      <div class="chip-val ${chipCls}">${normalized}</div>
      <div class="chip-lbl">${label}</div>
    </div>`;
  }).join('');
  return `<div class="breakdown">
    <div class="breakdown-title">Score breakdown</div>
    <div class="breakdown-chips">${chips}</div>
  </div>`;
}

// === OPEN HOUSE BADGE ===

function openHouseBadge(l) {
  if (!l.next_open_house_start) return '';
  const start = parseOpenHouseDate(l.next_open_house_start);
  const end = parseOpenHouseDate(l.next_open_house_end);
  if (!start || start < startOfToday()) return '';
  const opts = { weekday: 'short', month: 'short', day: 'numeric' };
  const timeOpts = { hour: 'numeric', minute: '2-digit' };
  const dateStr = start.toLocaleDateString(undefined, opts);
  const startTime = start.toLocaleTimeString(undefined, timeOpts);
  const endTime = end ? ' – ' + end.toLocaleTimeString(undefined, timeOpts) : '';
  const weekend = isThisWeekend(l.next_open_house_start);
  return `<div class="open-house-badge${weekend ? ' open-house-soon' : ''}">
    <div class="oh-header"><span class="oh-icon">🏡</span> Open House</div>
    <div class="oh-when">${dateStr} · ${startTime}${endTime}</div>
  </div>`;
}

// === PENDING OUTCOMES ===

let outcomesData = null;
let outcomesSort = { col: 'date', dir: -1 };
let outcomesPage = 0;
const OUTCOMES_PAGE_SIZE = 25;

function medianOf(arr) {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function getFilteredOutcomes() {
  if (!outcomesData) return [];
  const minScore = parseFloat(document.getElementById('f-score').value);
  const minBeds = parseInt(document.getElementById('f-beds').value);
  const maxPrice = parseInt(document.getElementById('f-price').value);
  const propType = document.getElementById('f-type').value.toLowerCase();

  return outcomesData.listings.filter(l => {
    // Infer locale from city (outcomes don't have locale_id)
    const isSD = l.city?.toLowerCase() === 'san diego';
    if (activeLocale === 'san-diego' && !isSD) return false;
    if (activeLocale === 'main-line' && isSD) return false;

    if ((l.score ?? 0) < minScore) return false;
    if ((l.beds ?? 0) < minBeds) return false;
    if ((l.price_at_first_seen || l.price || 0) > maxPrice) return false;
    if (propType && l.property_type?.toLowerCase() !== propType) return false;

    if (selectedAreas.size > 0) {
      const key = activeLocale === 'san-diego' ? l.zip : l.city?.toLowerCase();
      if (!selectedAreas.has(key)) return false;
    }
    return true;
  });
}

function computeOutcomesStats(listings) {
  return {
    pendingCount: listings.filter(l => l.pending_at != null).length,
    soldCount: listings.filter(l => l.sold_at != null).length,
    medianDom: medianOf(listings.map(l => l.days_on_market).filter(v => v != null)),
    medianListToPendingPct: medianOf(
      listings
        .filter(l => l.pending_price != null && l.price_at_first_seen > 0)
        .map(l => (l.pending_price - l.price_at_first_seen) / l.price_at_first_seen * 100),
    ),
    medianListToSoldPct: medianOf(
      listings
        .filter(l => l.sold_price != null && l.price_at_first_seen > 0)
        .map(l => (l.sold_price - l.price_at_first_seen) / l.price_at_first_seen * 100),
    ),
  };
}

function fmtPct(pct) {
  if (pct == null) return '—';
  return (pct >= 0 ? '+' : '') + pct.toFixed(1) + '%';
}

function pctColor(pct) {
  if (pct == null) return 'var(--muted)';
  if (pct < -0.5) return 'var(--green)';
  if (pct > 0.5) return 'var(--red)';
  return 'var(--muted)';
}

function sortOutcomes(col) {
  if (outcomesSort.col === col) outcomesSort.dir *= -1;
  else { outcomesSort.col = col; outcomesSort.dir = -1; }
  outcomesPage = 0;
  renderOutcomesTable();
}

function outcomesPageChange(delta) {
  if (!outcomesData) return;
  const total = getFilteredOutcomes().length;
  const maxPage = Math.ceil(total / OUTCOMES_PAGE_SIZE) - 1;
  outcomesPage = Math.max(0, Math.min(maxPage, outcomesPage + delta));
  renderOutcomesTable();
}

function getSortedOutcomes() {
  if (!outcomesData) return [];
  const { col, dir } = outcomesSort;
  return [...getFilteredOutcomes()].sort((a, b) => {
    let av, bv;
    if (col === 'date') {
      av = a.sold_at ?? a.pending_at ?? '';
      bv = b.sold_at ?? b.pending_at ?? '';
    } else if (col === 'dom') {
      av = a.days_on_market ?? -1;
      bv = b.days_on_market ?? -1;
    } else if (col === 'delta') {
      const ref = l => (l.sold_price ?? l.pending_price ?? 0);
      av = a.price_at_first_seen > 0 ? (ref(a) - a.price_at_first_seen) / a.price_at_first_seen : -99;
      bv = b.price_at_first_seen > 0 ? (ref(b) - b.price_at_first_seen) / b.price_at_first_seen : -99;
    } else if (col === 'list') {
      av = a.price_at_first_seen; bv = b.price_at_first_seen;
    } else if (col === 'sale') {
      av = a.sold_price ?? a.pending_price ?? 0;
      bv = b.sold_price ?? b.pending_price ?? 0;
    } else if (col === 'score') {
      av = a.score; bv = b.score;
    } else {
      av = 0; bv = 0;
    }
    if (av < bv) return -dir;
    if (av > bv) return dir;
    return 0;
  });
}

function renderOutcomesTable() {
  const sorted = getSortedOutcomes();
  const total = sorted.length;
  const maxPage = Math.max(0, Math.ceil(total / OUTCOMES_PAGE_SIZE) - 1);
  outcomesPage = Math.min(outcomesPage, maxPage);
  const page = sorted.slice(outcomesPage * OUTCOMES_PAGE_SIZE, (outcomesPage + 1) * OUTCOMES_PAGE_SIZE);

  const { col, dir } = outcomesSort;
  const arrow = d => d === -1 ? ' ↓' : ' ↑';
  const th = (label, key) =>
    `<th style="cursor:pointer;user-select:none" onclick="sortOutcomes('${key}')">${label}${col === key ? arrow(dir) : ''}</th>`;

  const rows = page.map(l => {
    const saleRef = l.sold_price ?? l.pending_price;
    const delta = saleRef != null && l.price_at_first_seen > 0
      ? (saleRef - l.price_at_first_seen) / l.price_at_first_seen * 100
      : null;
    const displayDate = l.sold_at
      ? new Date(l.sold_at).toLocaleDateString()
      : (l.pending_at ? new Date(l.pending_at).toLocaleDateString() : '—');
    const statusBadge = l.sold_at
      ? `<span class="pending-badge" style="background:#14532d;color:#86efac;border-color:#166534">Sold</span>`
      : `<span class="pending-badge">Pending</span>`;
    return `<tr>
      <td><a href="${l.url ?? '#'}" target="_blank" rel="noopener" style="color:var(--accent);text-decoration:none">${l.address}</a></td>
      <td>${l.city}</td>
      <td>$${fmt(l.price_at_first_seen)}</td>
      <td>${l.pending_price ? '$' + fmt(l.pending_price) : '—'}</td>
      <td>${l.sold_price ? '$' + fmt(l.sold_price) : '—'}</td>
      <td style="color:${pctColor(delta)};font-weight:600">${fmtPct(delta)}</td>
      <td>${l.days_on_market ?? '—'}</td>
      <td>${displayDate}</td>
      <td>${statusBadge}</td>
      <td>${Math.round(l.score)}</td>
    </tr>`;
  }).join('');

  const pagination = total > OUTCOMES_PAGE_SIZE ? `
    <div style="display:flex;align-items:center;gap:12px;margin-top:12px;font-size:12px;color:var(--muted)">
      <button class="reset-btn" style="width:auto;padding:5px 12px" onclick="outcomesPageChange(-1)" ${outcomesPage === 0 ? 'disabled' : ''}>← Prev</button>
      <span>${outcomesPage * OUTCOMES_PAGE_SIZE + 1}–${Math.min((outcomesPage + 1) * OUTCOMES_PAGE_SIZE, total)} of ${total}</span>
      <button class="reset-btn" style="width:auto;padding:5px 12px" onclick="outcomesPageChange(1)" ${outcomesPage >= maxPage ? 'disabled' : ''}>Next →</button>
    </div>` : '';

  document.getElementById('outcomes-list').innerHTML = `
    <table class="outcomes-table">
      <thead><tr>
        ${th('Address','addr')}${th('City','city')}${th('List Price','list')}
        <th>Pending Price</th>${th('Sale Price','sale')}${th('Δ vs List','delta')}
        ${th('DOM','dom')}${th('Date','date')}<th>Status</th>${th('Score','score')}
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>
    ${pagination}`;
}

function renderOutcomes(data) {
  if (data) outcomesData = data;
  if (!outcomesData) return;

  const listings = getFilteredOutcomes();
  const stats = computeOutcomesStats(listings);

  document.getElementById('outcomes-section').style.display = '';

  if (!listings || listings.length === 0) {
    document.getElementById('outcomes-stats').innerHTML = '';
    document.getElementById('outcomes-list').innerHTML = '<div class="empty">No pending or sold listings match the current filters.</div>';
    return;
  }

  document.getElementById('outcomes-stats').innerHTML = `
    <div class="outcome-stat">
      <div class="outcome-stat-val">${stats.pendingCount}</div>
      <div class="outcome-stat-lbl">Gone Pending</div>
    </div>
    <div class="outcome-stat">
      <div class="outcome-stat-val">${stats.soldCount}</div>
      <div class="outcome-stat-lbl">Sold</div>
    </div>
    <div class="outcome-stat">
      <div class="outcome-stat-val">${stats.medianDom != null ? Math.round(stats.medianDom) + 'd' : '—'}</div>
      <div class="outcome-stat-lbl">Median DOM</div>
    </div>
    <div class="outcome-stat">
      <div class="outcome-stat-val" style="color:${pctColor(stats.medianListToPendingPct)}">${fmtPct(stats.medianListToPendingPct)}</div>
      <div class="outcome-stat-lbl">List → Pending Δ</div>
    </div>
    <div class="outcome-stat">
      <div class="outcome-stat-val" style="color:${pctColor(stats.medianListToSoldPct)}">${fmtPct(stats.medianListToSoldPct)}</div>
      <div class="outcome-stat-lbl">List → Sale Δ</div>
    </div>`;

  const isDark = document.documentElement.classList.contains('dark');
  const gridColor = isDark ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.07)';
  const soldPoints = [];
  const pendingPoints = [];
  for (const l of listings) {
    if (l.days_on_market == null || l.price_at_first_seen <= 0) continue;
    if (l.sold_price != null) {
      const y = (l.sold_price - l.price_at_first_seen) / l.price_at_first_seen * 100;
      soldPoints.push({ x: l.days_on_market, y, label: l.address });
    } else if (l.pending_price != null) {
      const y = (l.pending_price - l.price_at_first_seen) / l.price_at_first_seen * 100;
      pendingPoints.push({ x: l.days_on_market, y, label: l.address });
    }
  }

  const ctx = document.getElementById('outcomes-chart').getContext('2d');
  if (outcomesChart) outcomesChart.destroy();
  outcomesChart = new Chart(ctx, {
    type: 'scatter',
    data: {
      datasets: [
        {
          label: 'Sold (list → sale price)',
          data: soldPoints,
          backgroundColor: soldPoints.map(p => p.y < -0.5 ? '#22c55e99' : p.y > 0.5 ? '#f8717199' : '#4f8ef799'),
          pointRadius: 7, pointHoverRadius: 9,
        },
        {
          label: 'Pending (list → asking price)',
          data: pendingPoints,
          backgroundColor: '#eab30899',
          pointRadius: 5, pointHoverRadius: 7,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { position: 'bottom', labels: { boxWidth: 10, font: { size: 11 } } },
        tooltip: { callbacks: { label: c => `${c.raw.label}: ${c.parsed.x}d, ${fmtPct(c.parsed.y)}` } },
      },
      scales: {
        x: { title: { display: true, text: 'Days on Market', font: { size: 10 } }, grid: { color: gridColor }, ticks: { font: { size: 10 } } },
        y: { title: { display: true, text: '% vs. List Price', font: { size: 10 } }, grid: { color: gridColor }, ticks: { font: { size: 10 }, callback: v => fmtPct(v) } },
      },
    },
  });

  renderOutcomesTable();
}

// === CARDS ===

function renderCards(listings) {
  const wrap = document.getElementById('cards');
  document.getElementById('results-count').textContent = listings.length + ' listings';

  if (listings.length === 0) {
    wrap.innerHTML = '<div class="empty">No listings match your filters.</div>';
    return;
  }

  wrap.innerHTML = listings.map(l => {
    const typeLabel = l.property_type
      ? l.property_type.replace('Single Family Residential', 'SFD')
      : '?';
    const isPending = l.status === '130' || l.status === 'Pending' || l.status === 'Contingent';
    const imgUrl = photoUrl(l.id);
    return `<div class="card${isPending ? ' card-pending' : ''}">
      ${imgUrl
        ? `<img class="card-photo" src="${imgUrl}" alt="${l.address}" onerror="this.outerHTML='<div class=\\'card-photo card-photo-placeholder\\'><span>🏠</span></div>'">`
        : `<div class="card-photo card-photo-placeholder"><span>🏠</span></div>`}
      <div class="card-header">
        <div>
          <div class="card-address">${l.address}${isPending ? ` <span class="pending-badge">${l.status_label || 'Pending'}</span>` : ''}</div>
          <div class="card-city">${l.city}, ${l.state ?? ''} ${l.zip}</div>
          ${l.school_district ? `<div class="card-sd">${l.school_district}</div>` : ''}
        </div>
        <div class="score-badge ${scoreClass(l.score)}">${Math.round(l.score)}</div>
      </div>
      <div style="display:flex;align-items:flex-start;gap:8px">
        <div style="flex:1;min-width:0">
          <div class="card-price">$${fmt(l.price)}${priceChange(l)}</div>
          <div class="card-price-sub">Listed ${l.first_seen_at ? new Date(l.first_seen_at).toLocaleDateString() : '—'}${l.days_on_market != null ? ' · ' + domLabel(l.days_on_market) : ''}</div>
        </div>
        ${openHouseBadge(l)}
      </div>
      <div class="card-stats">
        <div class="stat"><div class="stat-val">${l.beds} / ${l.baths}</div><div class="stat-lbl">Bed / Bth</div></div>
        <div class="stat"><div class="stat-val">${l.sqft ? fmt(l.sqft) : '—'}</div><div class="stat-lbl">Sq Ft</div></div>
        <div class="stat"><div class="stat-val">${fmtAcres(l.lot_sqft)}</div><div class="stat-lbl">Lot</div></div>
        <div class="stat"><div class="stat-val">${l.sqft ? '$' + Math.round(l.price / l.sqft) : '—'}</div><div class="stat-lbl">$/Sq Ft</div></div>
      </div>
      ${scoreBars(l.score_breakdown)}
      <div class="card-footer">
        <a class="redfin-link" href="${l.url}" target="_blank" rel="noopener">View on Redfin →</a>
        <span class="type-pill">${typeLabel}</span>
        <button class="star-btn${l.starred ? ' starred' : ''}" onclick="toggleStar('${l.id}', this)" title="Star this listing">${l.starred ? '★' : '☆'}</button>
      </div>
    </div>`;
  }).join('');
}

// === MAP ===

let listingMap = null;
let tileLayer = null;
let markerGroup = null;
let boundaryLayer = null;
let legendControl = null;
let mapLocale = null;
const boundaryCache = {};

const TILE_LIGHT = 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png';
const TILE_DARK  = 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png';
const TILE_ATTR  = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/">CARTO</a>';

const PA_MAP = { center: [40.03, -75.37], zoom: 12 };
const SD_MAP = { center: [32.745, -117.14], zoom: 12 };

function markerColor(score) {
  if (score >= 80) return '#22c55e';
  if (score >= 60) return '#eab308';
  return '#f87171';
}
function markerBorder(score) {
  if (score >= 80) return '#15803d';
  if (score >= 60) return '#a16207';
  return '#dc2626';
}
function scoreIcon(score) {
  const bg = markerColor(score);
  const border = markerBorder(score);
  return L.divIcon({
    className: '',
    html: `<div style="background:${bg};border:2px solid ${border};color:#fff;border-radius:50%;width:32px;height:32px;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;box-shadow:0 2px 6px rgba(0,0,0,.25)">${Math.round(score)}</div>`,
    iconSize: [32, 32], iconAnchor: [16, 16], popupAnchor: [0, -18],
  });
}

async function fetchZipBoundaries(locale) {
  if (boundaryCache[locale]) return boundaryCache[locale];
  const pollingRegions = locale === 'san-diego' ? SD_POLLING_REGIONS : PA_POLLING_ZIPS;
  const zips = Object.keys(pollingRegions).map(z => `'${z}'`).join(',');
  const params = new URLSearchParams({
    where: `ZCTA5 IN (${zips})`,
    outFields: 'ZCTA5',
    f: 'geojson',
    outSR: '4326',
  });
  const url = `https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/PUMA_TAD_TAZ_UGA_ZCTA/MapServer/1/query?${params}`;
  const res = await fetch(url);
  boundaryCache[locale] = await res.json();
  return boundaryCache[locale];
}

async function renderMap(listings) {
  const locale = activeLocale;
  const localeMapCfg = locale === 'san-diego' ? SD_MAP : PA_MAP;
  const pollingRegions = locale === 'san-diego' ? SD_POLLING_REGIONS : PA_POLLING_ZIPS;
  const isDark = document.documentElement.classList.contains('dark');
  const tileUrl = isDark ? TILE_DARK : TILE_LIGHT;

  if (!listingMap) {
    listingMap = L.map('listing-map', { zoomControl: true }).setView(localeMapCfg.center, localeMapCfg.zoom);
    tileLayer = L.tileLayer(tileUrl, { attribution: TILE_ATTR, maxZoom: 19 }).addTo(listingMap);
    markerGroup = L.layerGroup().addTo(listingMap);
  } else {
    tileLayer.setUrl(tileUrl);
    markerGroup.clearLayers();
  }

  // Re-center and redraw boundaries when locale changes
  if (mapLocale !== locale) {
    mapLocale = locale;
    listingMap.setView(localeMapCfg.center, localeMapCfg.zoom);
    if (boundaryLayer) { boundaryLayer.remove(); boundaryLayer = null; }
    if (legendControl) { legendControl.remove(); legendControl = null; }

    legendControl = L.control({ position: 'bottomright' });
    legendControl.onAdd = () => {
      const div = L.DomUtil.create('div', 'map-legend');
      div.innerHTML = '<div class="map-legend-title">Polling Areas</div>' +
        Object.entries(pollingRegions)
          .map(([, { label, color }]) => `<div class="map-legend-row"><span class="map-legend-dot" style="background:${color}"></span>${label}</div>`)
          .join('');
      return div;
    };
    legendControl.addTo(listingMap);

    fetchZipBoundaries(locale).then(geojson => {
      boundaryLayer = L.geoJSON(geojson, {
        style: feature => {
          const zip = feature.properties?.ZCTA5;
          const color = pollingRegions[zip]?.color ?? '#4f8ef7';
          return { color, weight: 2.5, opacity: 0.9, fillColor: color, fillOpacity: 0.12 };
        },
        onEachFeature: (feature, layer) => {
          const zip = feature.properties?.ZCTA5;
          const region = pollingRegions[zip];
          const label = region ? `${region.label} <span style="color:${region.color}">●</span> ${zip}` : zip;
          layer.bindTooltip(label, { sticky: true, className: 'zip-tooltip' });
        },
      }).addTo(listingMap);
    }).catch(() => {});
  }

  const valid = listings.filter(l => l.lat && l.lng);
  document.getElementById('map-count').textContent = valid.length + ' listings';

  valid.forEach(l => {
    const typeLabel = l.property_type ? l.property_type.replace('Single Family Residential', 'SFD') : '?';
    const oh = l.next_open_house_start
      ? `<div style="margin-top:6px;font-size:11px;color:#2563eb;font-weight:600">🏡 ${l.next_open_house_start}</div>`
      : '';
    const popup = `
      <div style="font-family:-apple-system,sans-serif;min-width:200px">
        <div style="font-weight:700;font-size:13px">${l.address}</div>
        <div style="color:#6b7280;font-size:11px;margin-bottom:6px">${l.city}, ${l.state ?? ''} ${l.zip}</div>
        <div style="font-size:15px;font-weight:700">$${fmt(l.price)}</div>
        <div style="font-size:11px;color:#6b7280;margin-top:2px">${l.beds}bd · ${l.baths}ba${l.sqft ? ' · ' + fmt(l.sqft) + ' sqft' : ''} · ${typeLabel}</div>
        ${oh}
        <div style="margin-top:8px">
          <a href="${l.url}" target="_blank" rel="noopener"
             style="background:#2563eb;color:#fff;text-decoration:none;border-radius:4px;padding:4px 10px;font-size:11px;font-weight:500">
            View on Redfin →
          </a>
        </div>
      </div>`;
    L.marker([l.lat, l.lng], { icon: scoreIcon(l.score) }).bindPopup(popup).addTo(markerGroup);
  });
}

function updateMapTiles() {
  if (!tileLayer) return;
  const isDark = document.documentElement.classList.contains('dark');
  tileLayer.setUrl(isDark ? TILE_DARK : TILE_LIGHT);
}

// === TREND CHARTS ===

const PA_CITY_COLORS = Object.fromEntries(
  Object.entries(PA_NEIGHBORHOOD_COLORS).map(([name, color]) => [name.toLowerCase(), color]),
);
PA_CITY_COLORS['narberth'] = PA_NEIGHBORHOOD_COLORS['Narberth/Penn Valley'];
PA_CITY_COLORS['penn valley'] = PA_NEIGHBORHOOD_COLORS['Narberth/Penn Valley'];

const SD_CITY_COLORS = { 'san diego': '#ef4444' };

function cityColor(city) {
  if (activeLocale === 'san-diego') return SD_CITY_COLORS[city] ?? '#6b7280';
  return PA_CITY_COLORS[city] ?? '#6b7280';
}

function renderTrendCharts(data) {
  const localeData = {
    listPrice: data.listPrice.filter(r => r.locale_id === activeLocale),
    soldPrice: data.soldPrice.filter(r => r.locale_id === activeLocale),
    score:     data.score.filter(r => r.locale_id === activeLocale),
  };

  const isDark = document.documentElement.classList.contains('dark');
  const gridColor = isDark ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.07)';

  const allMonths = [...new Set([
    ...localeData.listPrice.map(r => r.month),
    ...localeData.soldPrice.map(r => r.month),
  ])].sort();

  const listByCityMonth = {};
  localeData.listPrice.forEach(({ city, month, avg }) => { (listByCityMonth[city] ??= {})[month] = avg; });
  const soldByCityMonth = {};
  localeData.soldPrice.forEach(({ city, month, avg }) => { (soldByCityMonth[city] ??= {})[month] = avg; });

  const priceCities = [...new Set([...Object.keys(listByCityMonth), ...Object.keys(soldByCityMonth)])].sort();
  const priceDatasets = [];
  priceCities.forEach(city => {
    const color = cityColor(city);
    if (listByCityMonth[city]) {
      priceDatasets.push({
        label: city.charAt(0).toUpperCase() + city.slice(1) + ' (list)',
        data: allMonths.map(m => listByCityMonth[city]?.[m] ?? null),
        borderColor: color, backgroundColor: color + '20', borderWidth: 2, borderDash: [],
        tension: 0.3, spanGaps: true, pointRadius: 3,
      });
    }
    if (soldByCityMonth[city]) {
      priceDatasets.push({
        label: city.charAt(0).toUpperCase() + city.slice(1) + ' (sold)',
        data: allMonths.map(m => soldByCityMonth[city]?.[m] ?? null),
        borderColor: color, backgroundColor: 'transparent', borderWidth: 2, borderDash: [5, 4],
        tension: 0.3, spanGaps: true, pointRadius: 3, pointStyle: 'triangle',
      });
    }
  });

  const priceCtx = document.getElementById('price-trend-chart').getContext('2d');
  if (priceTrendChart) priceTrendChart.destroy();
  priceTrendChart = new Chart(priceCtx, {
    type: 'line',
    data: { labels: allMonths, datasets: priceDatasets },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { position: 'bottom', labels: { boxWidth: 10, font: { size: 11 } } },
        tooltip: { callbacks: { label: ctx => `${ctx.dataset.label}: $${(ctx.parsed.y / 1000).toFixed(0)}k` } },
      },
      scales: {
        x: { grid: { color: gridColor }, ticks: { font: { size: 10 } } },
        y: { grid: { color: gridColor }, ticks: { font: { size: 10 }, callback: v => `$${(v / 1000).toFixed(0)}k` } },
      },
    },
  });

  const scoreMonths = [...new Set(localeData.score.map(r => r.month))].sort();
  const scoreByCityMonth = {};
  localeData.score.forEach(({ city, month, avg }) => { (scoreByCityMonth[city] ??= {})[month] = avg; });
  const scoreCities = Object.keys(scoreByCityMonth).sort();

  const scoreDatasets = scoreCities.map(city => ({
    label: city.charAt(0).toUpperCase() + city.slice(1),
    data: scoreMonths.map(m => scoreByCityMonth[city]?.[m] ?? null),
    borderColor: cityColor(city), backgroundColor: cityColor(city) + '20',
    borderWidth: 2, tension: 0.3, spanGaps: true, pointRadius: 3,
  }));

  const scoreCtx = document.getElementById('score-trend-chart').getContext('2d');
  if (scoreTrendChart) scoreTrendChart.destroy();
  scoreTrendChart = new Chart(scoreCtx, {
    type: 'line',
    data: { labels: scoreMonths, datasets: scoreDatasets },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { position: 'bottom', labels: { boxWidth: 10, font: { size: 11 } } } },
      scales: {
        x: { grid: { color: gridColor }, ticks: { font: { size: 10 } } },
        y: { min: 0, max: 100, grid: { color: gridColor }, ticks: { font: { size: 10 } } },
      },
    },
  });
}

// === INVENTORY CHART ===

function renderInventoryChart(data) {
  const validAreas = LOCALE_AREA_NAMES[activeLocale];
  const localeData = data.filter(d => validAreas?.has(d.area));
  if (!localeData.length) return;

  const areaData = {};
  localeData.forEach(({ area, polled_at, listings_found }) => {
    const day = polled_at.slice(0, 10);
    if (!areaData[area]) areaData[area] = {};
    areaData[area][day] = listings_found;
  });

  const allDays = [...new Set(localeData.map(d => d.polled_at.slice(0, 10)))].sort();
  const areas = Object.keys(areaData);
  const isDark = document.documentElement.classList.contains('dark');
  const gridColor = isDark ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.07)';

  const areaColor = area => {
    if (activeLocale === 'san-diego') {
      const nb = SD_NEIGHBORHOODS.find(n => n.name === area);
      return nb?.color ?? '#6b7280';
    }
    return PA_NEIGHBORHOOD_COLORS[area] ?? '#6b7280';
  };

  const ctx = document.getElementById('inventory-chart').getContext('2d');
  if (inventoryChart) inventoryChart.destroy();
  inventoryChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: allDays,
      datasets: areas.map(area => ({
        label: area,
        data: allDays.map(day => areaData[area][day] ?? null),
        borderColor: areaColor(area),
        backgroundColor: areaColor(area) + '20',
        tension: 0.3, spanGaps: true, pointRadius: 3,
      })),
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { position: 'bottom', labels: { boxWidth: 10, font: { size: 11 } } } },
      scales: {
        x: { grid: { color: gridColor }, ticks: { font: { size: 10 } } },
        y: { beginAtZero: true, grid: { color: gridColor }, ticks: { font: { size: 10 } } },
      },
    },
  });
}

// === STAR TOGGLE ===

async function toggleStar(id, btn) {
  const res = await fetch(`/api/listings/${id}/star`, { method: 'POST' });
  const { starred } = await res.json();
  btn.textContent = starred ? '★' : '☆';
  btn.classList.toggle('starred', starred);
  const listing = allListings.find(l => l.id === id);
  if (listing) listing.starred = starred ? 1 : 0;
}

// === POLL TRIGGER ===

async function triggerPoll() {
  const btn = document.getElementById('poll-btn');
  btn.disabled = true;
  btn.textContent = 'Polling…';
  await fetch('/api/poll', { method: 'POST' });
  setTimeout(async () => {
    await init();
    btn.disabled = false;
    btn.textContent = 'Poll Now';
  }, 15000);
}

// === VIEW SWITCHING ===

function switchView(view) {
  ['listings', 'map', 'inventory'].forEach(v => {
    document.getElementById(`view-${v}`).classList.toggle('view-hidden', v !== view);
    document.getElementById(`tab-${v}`).classList.toggle('active', v === view);
  });
  document.getElementById('filters').classList.toggle('view-hidden', view === 'inventory');
  document.querySelector('aside').scrollTop = 0;
  localStorage.setItem('view', view);
  if (view === 'map' && listingMap) {
    setTimeout(() => listingMap.invalidateSize(), 0);
  }
}

// === DARK MODE ===

function toggleTheme() {
  const isDark = document.documentElement.classList.toggle('dark');
  localStorage.setItem('theme', isDark ? 'dark' : 'light');
  document.getElementById('theme-btn').textContent = isDark ? '☀️' : '🌙';
  updateMapTiles();
  if (inventoryChart) {
    const gridColor = isDark ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.07)';
    inventoryChart.options.scales.x.grid = { color: gridColor };
    inventoryChart.options.scales.y.grid = { color: gridColor };
    inventoryChart.update();
  }
}

document.addEventListener('DOMContentLoaded', () => {
  const isDark = document.documentElement.classList.contains('dark');
  document.getElementById('theme-btn').textContent = isDark ? '☀️' : '🌙';
  const savedView = localStorage.getItem('view') ?? 'listings';
  if (savedView !== 'listings') switchView(savedView);
});

init();
