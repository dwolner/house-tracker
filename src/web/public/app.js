let allListings = [];
let inventoryChart = null;
let priceTrendChart = null;
let scoreTrendChart = null;
let outcomesChart = null;
let selectedCities = new Set();

async function init() {
  const [listingsRes, statsRes, inventoryRes, outcomesRes, trendsRes] = await Promise.all([
    fetch("/api/listings").then((r) => r.json()),
    fetch("/api/stats").then((r) => r.json()),
    fetch("/api/inventory").then((r) => r.json()),
    fetch("/api/outcomes").then((r) => r.json()),
    fetch("/api/trends").then((r) => r.json()),
  ]);

  allListings = listingsRes;

  document.getElementById("stat-total").textContent = statsRes.total;
  document.getElementById("stat-fresh").textContent = statsRes.fresh;
  document.getElementById("stat-poll").textContent = statsRes.lastPoll
    ? new Date(statsRes.lastPoll).toLocaleString()
    : "never";

  const cityWrap = document.getElementById("city-checks");
  cityWrap.innerHTML = "";
  statsRes.cities.forEach((city) => {
    const label = document.createElement("label");
    const cap = city.charAt(0).toUpperCase() + city.slice(1);
    const checked = selectedCities.has(city) ? "checked" : "";
    label.innerHTML = `<input type="checkbox" value="${city}" ${checked} onchange="toggleCity('${city}')" /> ${cap}`;
    cityWrap.appendChild(label);
  });

  renderCards(allListings);
  renderMap(allListings).catch(() => {});
  renderInventoryChart(inventoryRes);
  renderTrendCharts(trendsRes);
  renderOutcomes(outcomesRes);
}

function toggleCity(city) {
  if (selectedCities.has(city)) selectedCities.delete(city);
  else selectedCities.add(city);
  applyFilters();
}

function parseOpenHouseDate(dateStr) {
  if (!dateStr) return null;
  // Redfin format: "April-9-2026 04:00 PM" — normalize dashes to spaces in date part
  const normalized = dateStr.replace(/^(\w+)-(\d+)-(\d+)/, "$1 $2 $3");
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
  const day = now.getDay(); // 0=Sun, 6=Sat
  // Start of this Saturday
  const satOffset = day === 0 ? -1 : 6 - day;
  const sat = new Date(now);
  sat.setDate(now.getDate() + satOffset);
  sat.setHours(0, 0, 0, 0);
  // End of this Sunday
  const sun = new Date(sat);
  sun.setDate(sat.getDate() + 1);
  sun.setHours(23, 59, 59, 999);
  return d >= sat && d <= sun;
}

function applyFilters() {
  const minScore = parseFloat(document.getElementById("f-score").value);
  const minBeds = parseInt(document.getElementById("f-beds").value);
  const maxPrice = parseInt(document.getElementById("f-price").value);
  const propType = document.getElementById("f-type").value.toLowerCase();
  const openHouseOnly = document.getElementById("f-open-house").checked;

  const filtered = allListings.filter((l) => {
    if (l.score < minScore) return false;
    if (l.beds < minBeds) return false;
    if (l.price > maxPrice) return false;
    if (propType && l.property_type?.toLowerCase() !== propType) return false;
    if (selectedCities.size > 0 && !selectedCities.has(l.city.toLowerCase()))
      return false;
    if (openHouseOnly && !isUpcoming(l.next_open_house_start)) return false;
    return true;
  });

  if (openHouseOnly) {
    filtered.sort((a, b) => {
      const da = parseOpenHouseDate(a.next_open_house_start);
      const db = parseOpenHouseDate(b.next_open_house_start);
      return (da?.getTime() ?? Infinity) - (db?.getTime() ?? Infinity);
    });
  }

  renderCards(filtered);
  renderMap(filtered).catch(() => {});
  renderOutcomes(null);
}

function resetFilters() {
  document.getElementById("f-score").value = 0;
  document.getElementById("f-score-val").textContent = "0";
  document.getElementById("f-beds").value = "0";
  document.getElementById("f-price").value = "2000000";
  document.getElementById("f-type").value = "";
  document.getElementById("f-open-house").checked = false;
  selectedCities.clear();
  document
    .querySelectorAll("#city-checks input")
    .forEach((cb) => (cb.checked = false));
  renderCards(allListings);
  renderOutcomes(null);
}

// --- Formatting helpers ---

function fmt(n) {
  return n != null ? n.toLocaleString() : "—";
}

function photoUrl(id) {
  if (!id || !id.startsWith("PAMC")) return null;
  return `https://ssl.cdn-redfin.com/photo/235/mbpaddedwide/${id.slice(-3)}/genMid.${id}_0.jpg`;
}

function fmtAcres(sqft) {
  if (sqft == null) return "—";
  const ac = sqft / 43560;
  return ac < 0.1 ? sqft.toLocaleString() + " sqft" : ac.toFixed(2) + " ac";
}

function scoreClass(s) {
  if (s >= 80) return "score-hi";
  if (s >= 60) return "score-mid";
  return "score-lo";
}

function domLabel(dom) {
  if (dom == null) return "";
  if (dom > 120) return `<span class="dom-warn">(⚠ ${dom} d)</span>`;
  if (dom > 30) return `<span class="dom-mild">(~${dom} d)</span>`;
  return `<span class="dom-ok">(${dom} d)</span>`;
}

function priceChange(l) {
  if (!l.price_at_first_seen || l.price_at_first_seen === l.price) return "";
  const diff = l.price - l.price_at_first_seen;
  const sign = diff < 0 ? "▼" : "▲";
  const color = diff < 0 ? "var(--green)" : "var(--red)";
  return `<span style="font-size:11px;color:${color};margin-left:6px">${sign} $${Math.abs(diff).toLocaleString()}</span>`;
}

// --- Score breakdown bars ---

const BREAKDOWN_KEYS = [
  { key: "propertyType", label: "Type", max: 20 },
  { key: "schoolDistrict", label: "School", max: 20 },
  { key: "walkability", label: "Walk", max: 12 },
  { key: "price", label: "Price", max: 12 },
  { key: "sqft", label: "Sqft", max: 8 },
  { key: "lot", label: "Lot", max: 12 },
  { key: "amtrak", label: "Train", max: 8 },
  { key: "beds", label: "Beds", max: 4 },
  { key: "pricePerSqft", label: "$/sqft", max: 4 },
  { key: "narberthBonus", label: "Narb+", max: 6, cls: "bonus" },
  { key: "domPenalty", label: "DOM−", max: 10, cls: "penalty" },
];

function scoreBars(breakdown) {
  if (!breakdown) return "";
  const chips = BREAKDOWN_KEYS.map(({ key, label, max, cls }) => {
    const val = breakdown[key] ?? 0;
    const normalized = Math.round((val / max) * 100);
    let chipCls;
    if (val === 0) chipCls = "zero";
    else if (cls === "penalty") chipCls = "penalty";
    else if (cls === "bonus") chipCls = "bonus";
    else if (normalized >= 70) chipCls = "";
    else if (normalized >= 40) chipCls = "mid";
    else chipCls = "lo";

    const display = normalized;

    return `<div class="chip" title="${label}: ${val.toFixed(1)} / ${max}">
      <div class="chip-val ${chipCls}">${display}</div>
      <div class="chip-lbl">${label}</div>
    </div>`;
  }).join("");
  return `<div class="breakdown">
    <div class="breakdown-title">Score breakdown</div>
    <div class="breakdown-chips">${chips}</div>
  </div>`;
}

// --- Open house badge ---

function openHouseBadge(l) {
  if (!l.next_open_house_start) return "";
  const start = parseOpenHouseDate(l.next_open_house_start);
  const end = parseOpenHouseDate(l.next_open_house_end);
  if (!start || start < startOfToday()) return "";

  const opts = { weekday: "short", month: "short", day: "numeric" };
  const timeOpts = { hour: "numeric", minute: "2-digit" };
  const dateStr = start.toLocaleDateString(undefined, opts);
  const startTime = start.toLocaleTimeString(undefined, timeOpts);
  const endTime = end
    ? " – " + end.toLocaleTimeString(undefined, timeOpts)
    : "";
  const weekend = isThisWeekend(l.next_open_house_start);

  return `<div class="open-house-badge${weekend ? " open-house-soon" : ""}">
    <div class="oh-header"><span class="oh-icon">🏡</span> Open House</div>
    <div class="oh-when">${dateStr} · ${startTime}${endTime}</div>
  </div>`;
}

// --- Pending outcomes ---

let outcomesData = null;
let outcomesSort = { col: 'date', dir: -1 }; // -1 = desc
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
    if ((l.score ?? 0) < minScore) return false;
    if ((l.beds ?? 0) < minBeds) return false;
    if ((l.price_at_first_seen || l.price || 0) > maxPrice) return false;
    if (propType && l.property_type?.toLowerCase() !== propType) return false;
    if (selectedCities.size > 0 && !selectedCities.has(l.city?.toLowerCase())) return false;
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
  if (pct < -0.5) return 'var(--green)'; // under list = buyer wins
  if (pct > 0.5) return 'var(--red)';    // over list = competitive market
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
      av = a.price_at_first_seen;
      bv = b.price_at_first_seen;
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
        ${th('Address', 'addr')}${th('City', 'city')}${th('List Price', 'list')}
        <th>Pending Price</th>${th('Sale Price', 'sale')}${th('Δ vs List', 'delta')}
        ${th('DOM', 'dom')}${th('Date', 'date')}<th>Status</th>${th('Score', 'score')}
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

  // Scatter: DOM vs sale price delta (fall back to pending delta if not yet sold)
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
          pointRadius: 7,
          pointHoverRadius: 9,
        },
        {
          label: 'Pending (list → asking price)',
          data: pendingPoints,
          backgroundColor: '#eab30899',
          pointRadius: 5,
          pointHoverRadius: 7,
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

// --- Cards ---

function renderCards(listings) {
  const wrap = document.getElementById("cards");
  document.getElementById("results-count").textContent =
    listings.length + " listings";

  if (listings.length === 0) {
    wrap.innerHTML = '<div class="empty">No listings match your filters.</div>';
    return;
  }

  wrap.innerHTML = listings
    .map((l) => {
      const isNarberth = l.city.toLowerCase() === "narberth";
      const typeLabel = l.property_type
        ? l.property_type.replace("Single Family Residential", "SFD")
        : "?";
      const breakdown = l.score_breakdown
        ? JSON.parse(l.score_breakdown)
        : null;

      const isPending = l.status === '130' || l.status === 'Pending' || l.status === 'Contingent';
      const imgUrl = photoUrl(l.id);
      return `<div class="card${isPending ? ' card-pending' : ''}">
      ${
        imgUrl
          ? `<img class="card-photo" src="${imgUrl}" alt="${l.address}" onerror="this.outerHTML='<div class=\\'card-photo card-photo-placeholder\\'><span>🏠</span></div>'">`
          : `<div class="card-photo card-photo-placeholder"><span>🏠</span></div>`
      }
      <div class="card-header">
        <div>
          <div class="card-address">${l.address}${isNarberth ? ' <span class="narberth-badge">Narberth</span>' : ""}${isPending ? ` <span class="pending-badge">${l.status_label || 'Pending'}</span>` : ""}</div>
          <div class="card-city">${l.city}, PA ${l.zip}</div>
          ${l.school_district ? `<div class="card-sd">${l.school_district}</div>` : ""}
        </div>
        <div class="score-badge ${scoreClass(l.score)}">${Math.round(l.score)}</div>
      </div>
      <div style="display:flex;align-items:flex-start;gap:8px">
        <div style="flex:1;min-width:0">
          <div class="card-price">$${fmt(l.price)}${priceChange(l)}</div>
          <div class="card-price-sub">Listed ${l.first_seen_at ? new Date(l.first_seen_at).toLocaleDateString() : "—"}${l.days_on_market != null ? " · " + domLabel(l.days_on_market) : ""}</div>
        </div>
        ${openHouseBadge(l)}
      </div>
      <div class="card-stats">
        <div class="stat">
          <div class="stat-val">${l.beds} / ${l.baths}</div>
          <div class="stat-lbl">Bed / Bth</div>
        </div>
        <div class="stat">
          <div class="stat-val">${l.sqft ? fmt(l.sqft) : "—"}</div>
          <div class="stat-lbl">Sq Ft</div>
        </div>
        <div class="stat">
          <div class="stat-val">${fmtAcres(l.lot_sqft)}</div>
          <div class="stat-lbl">Lot</div>
        </div>
        <div class="stat">
          <div class="stat-val">${l.sqft ? "$" + Math.round(l.price / l.sqft) : "—"}</div>
          <div class="stat-lbl">$/Sq Ft</div>
        </div>
      </div>
      ${scoreBars(breakdown)}
      <div class="card-footer">
        <a class="redfin-link" href="${l.url}" target="_blank" rel="noopener">View on Redfin →</a>
        <span class="type-pill">${typeLabel}</span>
        <button class="star-btn${l.starred ? " starred" : ""}" onclick="toggleStar('${l.id}', this)" title="Star this listing">${l.starred ? "★" : "☆"}</button>
      </div>
    </div>`;
    })
    .join("");
}

// --- Map ---

let listingMap = null;
let tileLayer = null;
let markerGroup = null;

const TILE_LIGHT =
  "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png";
const TILE_DARK =
  "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png";
const TILE_ATTR =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/">CARTO</a>';

// Approximate center + zoom for the Main Line
const MAP_CENTER = [40.03, -75.37];
const MAP_ZOOM = 12;

// Neighborhood colors — keyed by the exact name used in TARGET_REGIONS / poll_log
const NEIGHBORHOOD_COLORS = {
  "Narberth/Penn Valley": "#4f8ef7",
  Ardmore: "#22c55e",
  "Bryn Mawr": "#a855f7",
  "Bala Cynwyd": "#f97316",
  "Merion Station": "#06b6d4",
  Haverford: "#eab308",
  Wynnewood: "#ec4899",
  Wayne: "#14b8a6",
  Berwyn: "#f43f5e",
  "King of Prussia": "#8b5cf6",
};

// Polling regions: zip code → { label, color }
const POLLING_ZIPS = {
  19072: {
    label: "Narberth/Penn Valley",
    color: NEIGHBORHOOD_COLORS["Narberth/Penn Valley"],
  },
  19003: { label: "Ardmore", color: NEIGHBORHOOD_COLORS["Ardmore"] },
  19010: { label: "Bryn Mawr", color: NEIGHBORHOOD_COLORS["Bryn Mawr"] },
  19004: { label: "Bala Cynwyd", color: NEIGHBORHOOD_COLORS["Bala Cynwyd"] },
  19066: {
    label: "Merion Station",
    color: NEIGHBORHOOD_COLORS["Merion Station"],
  },
  19041: { label: "Haverford", color: NEIGHBORHOOD_COLORS["Haverford"] },
  19096: { label: "Wynnewood", color: NEIGHBORHOOD_COLORS["Wynnewood"] },
  19087: { label: "Wayne", color: NEIGHBORHOOD_COLORS["Wayne"] },
  19312: { label: "Berwyn", color: NEIGHBORHOOD_COLORS["Berwyn"] },
  19406: {
    label: "King of Prussia",
    color: NEIGHBORHOOD_COLORS["King of Prussia"],
  },
};

let boundaryLayer = null;
let boundaryData = null;

async function fetchZipBoundaries() {
  if (boundaryData) return boundaryData;
  const zips = Object.keys(POLLING_ZIPS)
    .map((z) => `'${z}'`)
    .join(",");
  const params = new URLSearchParams({
    where: `ZCTA5 IN (${zips})`,
    outFields: "ZCTA5",
    f: "geojson",
    outSR: "4326",
  });
  const url = `https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/PUMA_TAD_TAZ_UGA_ZCTA/MapServer/1/query?${params}`;
  const res = await fetch(url);
  boundaryData = await res.json();
  return boundaryData;
}

function markerColor(score) {
  if (score >= 80) return "#22c55e";
  if (score >= 60) return "#eab308";
  return "#f87171";
}

function markerBorder(score) {
  if (score >= 80) return "#15803d";
  if (score >= 60) return "#a16207";
  return "#dc2626";
}

function scoreIcon(score) {
  const bg = markerColor(score);
  const border = markerBorder(score);
  const label = Math.round(score);
  return L.divIcon({
    className: "",
    html: `<div style="background:${bg};border:2px solid ${border};color:#fff;border-radius:50%;width:32px;height:32px;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;box-shadow:0 2px 6px rgba(0,0,0,.25)">${label}</div>`,
    iconSize: [32, 32],
    iconAnchor: [16, 16],
    popupAnchor: [0, -18],
  });
}

async function renderMap(listings) {
  const isDark = document.documentElement.classList.contains("dark");
  const tileUrl = isDark ? TILE_DARK : TILE_LIGHT;

  if (!listingMap) {
    listingMap = L.map("listing-map", { zoomControl: true }).setView(
      MAP_CENTER,
      MAP_ZOOM,
    );
    tileLayer = L.tileLayer(tileUrl, {
      attribution: TILE_ATTR,
      maxZoom: 19,
    }).addTo(listingMap);
    markerGroup = L.layerGroup().addTo(listingMap);
    // Legend
    const legend = L.control({ position: "bottomright" });
    legend.onAdd = () => {
      const div = L.DomUtil.create("div", "map-legend");
      div.innerHTML =
        '<div class="map-legend-title">Polling Areas</div>' +
        Object.entries(POLLING_ZIPS)
          .map(
            ([, { label, color }]) =>
              `<div class="map-legend-row"><span class="map-legend-dot" style="background:${color}"></span>${label}</div>`,
          )
          .join("");
      return div;
    };
    legend.addTo(listingMap);

    // Draw zip boundaries once
    fetchZipBoundaries()
      .then((geojson) => {
        boundaryLayer = L.geoJSON(geojson, {
          style: (feature) => {
            const zip = feature.properties?.ZCTA5;
            const color = POLLING_ZIPS[zip]?.color ?? "#4f8ef7";
            return {
              color,
              weight: 2.5,
              opacity: 0.9,
              fillColor: color,
              fillOpacity: 0.12,
            };
          },
          onEachFeature: (feature, layer) => {
            const zip = feature.properties?.ZCTA5;
            const region = POLLING_ZIPS[zip];
            const label = region
              ? `${region.label} <span style="color:${region.color}">●</span> ${zip}`
              : zip;
            layer.bindTooltip(label, {
              sticky: true,
              className: "zip-tooltip",
            });
          },
        }).addTo(listingMap);
      })
      .catch(() => {}); // silently skip if Census API is unavailable
  } else {
    tileLayer.setUrl(tileUrl);
    markerGroup.clearLayers();
  }

  const valid = listings.filter((l) => l.lat && l.lng);
  document.getElementById("map-count").textContent = valid.length + " listings";

  valid.forEach((l) => {
    const typeLabel = l.property_type
      ? l.property_type.replace("Single Family Residential", "SFD")
      : "?";
    const oh = l.next_open_house_start
      ? `<div style="margin-top:6px;font-size:11px;color:#2563eb;font-weight:600">🏡 ${l.next_open_house_start}</div>`
      : "";
    const popup = `
      <div style="font-family:-apple-system,sans-serif;min-width:200px">
        <div style="font-weight:700;font-size:13px">${l.address}</div>
        <div style="color:#6b7280;font-size:11px;margin-bottom:6px">${l.city}, PA ${l.zip}</div>
        <div style="font-size:15px;font-weight:700">$${fmt(l.price)}</div>
        <div style="font-size:11px;color:#6b7280;margin-top:2px">${l.beds}bd · ${l.baths}ba${l.sqft ? " · " + fmt(l.sqft) + " sqft" : ""} · ${typeLabel}</div>
        ${oh}
        <div style="margin-top:8px">
          <a href="${l.url}" target="_blank" rel="noopener"
             style="background:#2563eb;color:#fff;text-decoration:none;border-radius:4px;padding:4px 10px;font-size:11px;font-weight:500">
            View on Redfin →
          </a>
        </div>
      </div>`;
    L.marker([l.lat, l.lng], { icon: scoreIcon(l.score) })
      .bindPopup(popup)
      .addTo(markerGroup);
  });
}

function updateMapTiles() {
  if (!tileLayer) return;
  const isDark = document.documentElement.classList.contains("dark");
  tileLayer.setUrl(isDark ? TILE_DARK : TILE_LIGHT);
}

// --- Trend charts (price + score per neighborhood over time) ---

// Map lowercase city names (as stored in DB) to neighborhood colors
const CITY_COLORS = Object.fromEntries(
  Object.entries(NEIGHBORHOOD_COLORS).map(([name, color]) => [name.toLowerCase(), color]),
);
// Additional city aliases that may appear in DB but map to a neighborhood
CITY_COLORS["narberth"] = NEIGHBORHOOD_COLORS["Narberth/Penn Valley"];
CITY_COLORS["penn valley"] = NEIGHBORHOOD_COLORS["Narberth/Penn Valley"];

function renderTrendCharts(data) {
  const isDark = document.documentElement.classList.contains("dark");
  const gridColor = isDark ? "rgba(255,255,255,0.07)" : "rgba(0,0,0,0.07)";

  // Collect all unique months across list + sold price data
  const allMonths = [
    ...new Set([
      ...data.listPrice.map((r) => r.month),
      ...data.soldPrice.map((r) => r.month),
    ]),
  ].sort();

  // Group by city
  const listByCityMonth = {};
  data.listPrice.forEach(({ city, month, avg }) => {
    (listByCityMonth[city] ??= {})[month] = avg;
  });
  const soldByCityMonth = {};
  data.soldPrice.forEach(({ city, month, avg }) => {
    (soldByCityMonth[city] ??= {})[month] = avg;
  });

  const priceCities = [
    ...new Set([...Object.keys(listByCityMonth), ...Object.keys(soldByCityMonth)]),
  ].sort();

  const priceDatasets = [];
  priceCities.forEach((city) => {
    const color = CITY_COLORS[city] ?? "#6b7280";
    if (listByCityMonth[city]) {
      priceDatasets.push({
        label: city.charAt(0).toUpperCase() + city.slice(1) + " (list)",
        data: allMonths.map((m) => listByCityMonth[city]?.[m] ?? null),
        borderColor: color,
        backgroundColor: color + "20",
        borderWidth: 2,
        borderDash: [],
        tension: 0.3,
        spanGaps: true,
        pointRadius: 3,
      });
    }
    if (soldByCityMonth[city]) {
      priceDatasets.push({
        label: city.charAt(0).toUpperCase() + city.slice(1) + " (sold)",
        data: allMonths.map((m) => soldByCityMonth[city]?.[m] ?? null),
        borderColor: color,
        backgroundColor: "transparent",
        borderWidth: 2,
        borderDash: [5, 4],
        tension: 0.3,
        spanGaps: true,
        pointRadius: 3,
        pointStyle: "triangle",
      });
    }
  });

  const priceCtx = document.getElementById("price-trend-chart").getContext("2d");
  if (priceTrendChart) priceTrendChart.destroy();
  priceTrendChart = new Chart(priceCtx, {
    type: "line",
    data: { labels: allMonths, datasets: priceDatasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { position: "bottom", labels: { boxWidth: 10, font: { size: 11 } } },
        tooltip: {
          callbacks: {
            label: (ctx) =>
              `${ctx.dataset.label}: $${(ctx.parsed.y / 1000).toFixed(0)}k`,
          },
        },
      },
      scales: {
        x: { grid: { color: gridColor }, ticks: { font: { size: 10 } } },
        y: {
          grid: { color: gridColor },
          ticks: {
            font: { size: 10 },
            callback: (v) => `$${(v / 1000).toFixed(0)}k`,
          },
        },
      },
    },
  });

  // --- Score trend chart ---
  const scoreMonths = [...new Set(data.score.map((r) => r.month))].sort();
  const scoreByCityMonth = {};
  data.score.forEach(({ city, month, avg }) => {
    (scoreByCityMonth[city] ??= {})[month] = avg;
  });
  const scoreCities = Object.keys(scoreByCityMonth).sort();

  const scoreDatasets = scoreCities.map((city) => {
    const color = CITY_COLORS[city] ?? "#6b7280";
    return {
      label: city.charAt(0).toUpperCase() + city.slice(1),
      data: scoreMonths.map((m) => scoreByCityMonth[city]?.[m] ?? null),
      borderColor: color,
      backgroundColor: color + "20",
      borderWidth: 2,
      tension: 0.3,
      spanGaps: true,
      pointRadius: 3,
    };
  });

  const scoreCtx = document.getElementById("score-trend-chart").getContext("2d");
  if (scoreTrendChart) scoreTrendChart.destroy();
  scoreTrendChart = new Chart(scoreCtx, {
    type: "line",
    data: { labels: scoreMonths, datasets: scoreDatasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { position: "bottom", labels: { boxWidth: 10, font: { size: 11 } } },
      },
      scales: {
        x: { grid: { color: gridColor }, ticks: { font: { size: 10 } } },
        y: {
          min: 0,
          max: 100,
          grid: { color: gridColor },
          ticks: { font: { size: 10 } },
        },
      },
    },
  });
}

// --- Inventory chart ---

function renderInventoryChart(data) {
  if (!data.length) return;

  const areaData = {};
  data.forEach(({ area, polled_at, listings_found }) => {
    const day = polled_at.slice(0, 10);
    if (!areaData[area]) areaData[area] = {};
    areaData[area][day] = listings_found;
  });

  const allDays = [
    ...new Set(data.map((d) => d.polled_at.slice(0, 10))),
  ].sort();
  const areas = Object.keys(areaData);
  const isDark = document.documentElement.classList.contains("dark");
  const gridColor = isDark ? "rgba(255,255,255,0.07)" : "rgba(0,0,0,0.07)";

  const ctx = document.getElementById("inventory-chart").getContext("2d");
  if (inventoryChart) inventoryChart.destroy();

  inventoryChart = new Chart(ctx, {
    type: "line",
    data: {
      labels: allDays,
      datasets: areas.map((area) => {
        const color = NEIGHBORHOOD_COLORS[area] ?? "#6b7280";
        return {
          label: area,
          data: allDays.map((day) => areaData[area][day] ?? null),
          borderColor: color,
          backgroundColor: color + "20",
          tension: 0.3,
          spanGaps: true,
          pointRadius: 3,
        };
      }),
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          position: "bottom",
          labels: { boxWidth: 10, font: { size: 11 } },
        },
      },
      scales: {
        x: { grid: { color: gridColor }, ticks: { font: { size: 10 } } },
        y: {
          beginAtZero: true,
          grid: { color: gridColor },
          ticks: { font: { size: 10 } },
        },
      },
    },
  });
}

// --- Star toggle ---

async function toggleStar(id, btn) {
  const res = await fetch(`/api/listings/${id}/star`, { method: "POST" });
  const { starred } = await res.json();
  btn.textContent = starred ? "★" : "☆";
  btn.classList.toggle("starred", starred);
  const listing = allListings.find((l) => l.id === id);
  if (listing) listing.starred = starred ? 1 : 0;
}

// --- Poll trigger ---

async function triggerPoll() {
  const btn = document.getElementById("poll-btn");
  btn.disabled = true;
  btn.textContent = "Polling…";
  await fetch("/api/poll", { method: "POST" });
  setTimeout(async () => {
    await init();
    btn.disabled = false;
    btn.textContent = "Poll Now";
  }, 15000);
}

// --- View switching ---

function switchView(view) {
  ["listings", "map", "inventory"].forEach((v) => {
    document
      .getElementById(`view-${v}`)
      .classList.toggle("view-hidden", v !== view);
    document.getElementById(`tab-${v}`).classList.toggle("active", v === view);
  });
  document
    .getElementById("filters")
    .classList.toggle("view-hidden", view === "inventory");
  localStorage.setItem("view", view);
  if (view === "map" && listingMap) {
    setTimeout(() => listingMap.invalidateSize(), 0);
  }
}

// --- Dark mode ---

function toggleTheme() {
  const isDark = document.documentElement.classList.toggle("dark");
  localStorage.setItem("theme", isDark ? "dark" : "light");
  document.getElementById("theme-btn").textContent = isDark ? "☀️" : "🌙";
  updateMapTiles();
  if (inventoryChart) {
    const gridColor = isDark ? "rgba(255,255,255,0.07)" : "rgba(0,0,0,0.07)";
    inventoryChart.options.scales.x.grid = { color: gridColor };
    inventoryChart.options.scales.y.grid = { color: gridColor };
    inventoryChart.update();
  }
}

document.addEventListener("DOMContentLoaded", () => {
  const isDark = document.documentElement.classList.contains("dark");
  document.getElementById("theme-btn").textContent = isDark ? "☀️" : "🌙";
  const savedView = localStorage.getItem("view") ?? "listings";
  if (savedView !== "listings") switchView(savedView);
});

init();
