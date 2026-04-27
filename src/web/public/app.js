// === STATE ===
let allListings = [];
let activeLocale = localStorage.getItem("locale") ?? "main-line";
let selectedAreas = new Set();
let rawInventoryData = [];
let rawTrendsData = null;
let inventoryChart = null;
let priceTrendChart = null;
let scoreTrendChart = null;
let outcomesChart = null;
let investmentConfig = null;
let stlComps = {};

// === LOCALE CONFIG ===

const SD_NEIGHBORHOODS = [
  { zip: "92110", name: "Bay Park / Loma Portal", color: "#4f8ef7" },
  { zip: "92107", name: "Point Loma Heights", color: "#22c55e" },
  { zip: "92116", name: "Kensington / Talmadge", color: "#a855f7" },
  { zip: "92117", name: "Bay Ho", color: "#f97316" },
  { zip: "92104", name: "North Park", color: "#06b6d4" },
  { zip: "92103", name: "Mission Hills", color: "#eab308" },
  { zip: "92120", name: "Allied Gardens", color: "#ec4899" },
];

const SD_POLLING_REGIONS = {
  92110: { label: "Bay Park / Loma Portal", color: "#4f8ef7" },
  92107: { label: "Point Loma Heights", color: "#22c55e" },
  92116: { label: "Kensington / Talmadge", color: "#a855f7" },
  92117: { label: "Bay Ho", color: "#f97316" },
  92104: { label: "North Park", color: "#06b6d4" },
  92103: { label: "Mission Hills", color: "#eab308" },
  92120: { label: "Allied Gardens", color: "#ec4899" },
};

const PA_NEIGHBORHOOD_COLORS = {
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

const PA_POLLING_ZIPS = {
  19072: {
    label: "Narberth/Penn Valley",
    color: PA_NEIGHBORHOOD_COLORS["Narberth/Penn Valley"],
  },
  19003: { label: "Ardmore", color: PA_NEIGHBORHOOD_COLORS["Ardmore"] },
  19010: { label: "Bryn Mawr", color: PA_NEIGHBORHOOD_COLORS["Bryn Mawr"] },
  19004: { label: "Bala Cynwyd", color: PA_NEIGHBORHOOD_COLORS["Bala Cynwyd"] },
  19066: {
    label: "Merion Station",
    color: PA_NEIGHBORHOOD_COLORS["Merion Station"],
  },
  19041: { label: "Haverford", color: PA_NEIGHBORHOOD_COLORS["Haverford"] },
  19096: { label: "Wynnewood", color: PA_NEIGHBORHOOD_COLORS["Wynnewood"] },
  19087: { label: "Wayne", color: PA_NEIGHBORHOOD_COLORS["Wayne"] },
  19312: { label: "Berwyn", color: PA_NEIGHBORHOOD_COLORS["Berwyn"] },
  19406: {
    label: "King of Prussia",
    color: PA_NEIGHBORHOOD_COLORS["King of Prussia"],
  },
};

const STL_NEIGHBORHOODS = [
  { zip: "63122", name: "Kirkwood / Glendale", color: "#4f8ef7" },
  { zip: "63119", name: "Webster Groves / Rock Hill", color: "#22c55e" },
  { zip: "63143", name: "Maplewood", color: "#a855f7" },
  { zip: "63117", name: "Richmond Heights", color: "#f97316" },
  { zip: "63124", name: "Ladue", color: "#06b6d4" },
  { zip: "63105", name: "Clayton", color: "#eab308" },
  { zip: "63131", name: "Des Peres", color: "#ec4899" },
  { zip: "63127", name: "Sunset Hills", color: "#14b8a6" },
  { zip: "63126", name: "Crestwood", color: "#f43f5e" },
];

const STL_POLLING_REGIONS = Object.fromEntries(
  STL_NEIGHBORHOODS.map(({ zip, name, color }) => [
    zip,
    { label: name, color },
  ]),
);

const LOCALE_AREA_NAMES = {
  "main-line": new Set([
    "Narberth/Penn Valley",
    "Ardmore",
    "Bryn Mawr",
    "Bala Cynwyd",
    "Merion Station",
    "Haverford",
    "Wynnewood",
    "Wayne",
    "Berwyn",
    "King of Prussia",
  ]),
  "san-diego": new Set([
    "Bay Park / Loma Portal",
    "Point Loma Heights",
    "Kensington / Talmadge",
    "Bay Ho",
    "North Park",
    "Mission Hills",
    "Allied Gardens",
  ]),
  "st-louis": new Set([
    "Kirkwood",
    "Glendale",
    "Webster Groves",
    "Rock Hill",
    "Maplewood",
    "Richmond Heights",
    "Ladue",
    "Clayton",
    "Shrewsbury",
    "Des Peres",
    "Sunset Hills",
    "Crestwood",
  ]),
};

const LOCALE_LABELS = {
  "main-line": "— Main Line",
  "san-diego": "— San Diego",
  "st-louis": "— St. Louis",
};

// === INIT & LOCALE SWITCHING ===

async function init() {
  const [listingsRes, statsRes, inventoryRes, outcomesRes, trendsRes] =
    await Promise.all([
      fetch("/api/listings").then((r) => r.json()),
      fetch(`/api/stats?locale_id=${activeLocale}`).then((r) => r.json()),
      fetch("/api/inventory").then((r) => r.json()),
      fetch("/api/outcomes").then((r) => r.json()),
      fetch("/api/trends").then((r) => r.json()),
    ]);

  allListings = listingsRes;
  rawInventoryData = inventoryRes;
  rawTrendsData = trendsRes;

  // Sync locale selector and price filter default
  document.querySelector(".locale-select").value = activeLocale;
  document.getElementById("locale-label").textContent =
    LOCALE_LABELS[activeLocale] ?? "";
  if (activeLocale === "st-louis")
    document.getElementById("f-price").value = "500000";

  renderStats(statsRes);
  renderTypeFilter(statsRes.propertyTypes ?? []);
  renderAreaFilter(statsRes.cities);

  const localeListings = allListings.filter(
    (l) => l.locale_id === activeLocale,
  );
  await fetchInvestmentData(activeLocale);
  renderCards(localeListings);
  renderMap(localeListings).catch(() => {});
  renderInventoryChart(rawInventoryData);
  renderTrendCharts(rawTrendsData);
  renderOutcomes(outcomesRes);
}

async function fetchInvestmentData(locale) {
  if (locale !== "st-louis") {
    investmentConfig = null;
    stlComps = {};
    return;
  }
  try {
    const [invRes, compsRes] = await Promise.all([
      fetch("/api/locales/st-louis/investment").then((r) => r.json()),
      fetch("/api/locales/st-louis/comps").then((r) => r.json()),
    ]);
    investmentConfig = invRes.investmentConfig ?? null;
    stlComps = compsRes.byCity ?? {};
  } catch {
    investmentConfig = null;
    stlComps = {};
  }
}

async function switchLocale(locale) {
  activeLocale = locale;
  localStorage.setItem("locale", locale);
  selectedAreas.clear();
  switchView("listings");
  document.querySelector("aside").scrollTop = 0;

  document.querySelector(".locale-select").value = locale;
  document.getElementById("locale-label").textContent =
    LOCALE_LABELS[locale] ?? "";

  // Reset filter controls
  document.getElementById("f-search").value = "";
  document.getElementById("f-score").value = 0;
  document.getElementById("f-score-val").textContent = "0";
  document.getElementById("f-beds").value = "0";
  document.getElementById("f-price").value =
    locale === "st-louis" ? "500000" : "9999999";
  document.getElementById("f-type").value = "";
  document.getElementById("f-open-house").checked = false;

  const statsRes = await fetch(`/api/stats?locale_id=${locale}`).then((r) =>
    r.json(),
  );
  renderStats(statsRes);
  renderTypeFilter(statsRes.propertyTypes ?? []);
  renderAreaFilter(statsRes.cities);

  const localeListings = allListings.filter(
    (l) => l.locale_id === activeLocale,
  );
  await fetchInvestmentData(locale);
  renderCards(localeListings);
  renderMap(localeListings).catch(() => {});
  if (rawInventoryData.length) renderInventoryChart(rawInventoryData);
  if (rawTrendsData) renderTrendCharts(rawTrendsData);
  renderOutcomes(null);
}

function renderStats(statsRes) {
  document.getElementById("stat-total").textContent = statsRes.total;
  document.getElementById("stat-fresh").textContent = statsRes.fresh;
  document.getElementById("stat-poll").textContent = statsRes.lastPoll
    ? new Date(statsRes.lastPoll).toLocaleString()
    : "never";
}

function renderTypeFilter(types) {
  const sel = document.getElementById("f-type");
  const current = sel.value;
  sel.innerHTML = '<option value="">All</option>';
  const labels = {
    "single family residential": "Single Family",
    "multi-family": "Multi-Family",
    townhouse: "Townhouse",
    condo: "Condo",
  };
  types.forEach((t) => {
    const opt = document.createElement("option");
    opt.value = t;
    opt.textContent = labels[t] ?? t.replace(/\b\w/g, (c) => c.toUpperCase());
    sel.appendChild(opt);
  });
  // Restore selection if still valid
  if ([...sel.options].some((o) => o.value === current)) sel.value = current;
}

function renderAreaFilter(cities) {
  const label = document.getElementById("area-filter-label");
  const wrap = document.getElementById("city-checks");
  wrap.innerHTML = "";

  if (activeLocale === "san-diego") {
    label.textContent = "Neighborhood";
    SD_NEIGHBORHOODS.forEach(({ zip, name }) => {
      const lbl = document.createElement("label");
      lbl.innerHTML = `<input type="checkbox" value="${zip}" onchange="toggleArea('${zip}')" /> ${name}`;
      wrap.appendChild(lbl);
    });
  } else if (activeLocale === "st-louis") {
    label.textContent = "Neighborhood";
    STL_NEIGHBORHOODS.forEach(({ zip, name }) => {
      const lbl = document.createElement("label");
      lbl.innerHTML = `<input type="checkbox" value="${zip}" onchange="toggleArea('${zip}')" /> ${name}`;
      wrap.appendChild(lbl);
    });
  } else {
    label.textContent = "City";
    cities.forEach((city) => {
      const cap = city.charAt(0).toUpperCase() + city.slice(1);
      const lbl = document.createElement("label");
      const checked = selectedAreas.has(city) ? "checked" : "";
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
  const minScore = parseFloat(document.getElementById("f-score").value);
  const minBeds = parseInt(document.getElementById("f-beds").value);
  const maxPrice = parseInt(document.getElementById("f-price").value);
  const propType = document.getElementById("f-type").value.toLowerCase();
  const openHouseOnly = document.getElementById("f-open-house").checked;
  const searchTerm = document
    .getElementById("f-search")
    .value.trim()
    .toLowerCase();

  const filtered = allListings.filter((l) => {
    if (l.locale_id !== activeLocale) return false;
    if (l.score < minScore) return false;
    if (l.beds < minBeds) return false;
    if (l.price > maxPrice) return false;
    if (propType && l.property_type?.toLowerCase() !== propType) return false;
    if (searchTerm) {
      const addr = l.address?.toLowerCase() ?? "";
      const city = l.city?.toLowerCase() ?? "";
      const zip = l.zip ?? "";
      if (
        !addr.includes(searchTerm) &&
        !city.includes(searchTerm) &&
        !zip.includes(searchTerm)
      )
        return false;
    }
    if (selectedAreas.size > 0) {
      const key =
        activeLocale === "san-diego" || activeLocale === "st-louis"
          ? l.zip
          : l.city?.toLowerCase();
      if (!selectedAreas.has(key)) return false;
    }
    if (openHouseOnly && !isUpcoming(l.next_open_house_start)) return false;
    return true;
  });

  if (openHouseOnly) {
    filtered.sort((a, b) => {
      const da = parseOpenHouseDate(a.next_open_house_start);
      const db = parseOpenHouseDate(b.next_open_house_start);
      const dateDiff =
        (da?.getTime() ?? Infinity) - (db?.getTime() ?? Infinity);
      if (dateDiff !== 0) return dateDiff;
      return b.score - a.score;
    });
  }

  renderCards(filtered);
  renderMap(filtered).catch(() => {});
  renderOutcomes(null);
}

function resetFilters() {
  document.getElementById("f-search").value = "";
  document.getElementById("f-score").value = 0;
  document.getElementById("f-score-val").textContent = "0";
  document.getElementById("f-beds").value = "0";
  document.getElementById("f-price").value =
    activeLocale === "st-louis" ? "500000" : "9999999";
  document.getElementById("f-type").value = "";
  document.getElementById("f-open-house").checked = false;
  selectedAreas.clear();
  document
    .querySelectorAll("#city-checks input")
    .forEach((cb) => (cb.checked = false));
  const localeListings = allListings.filter(
    (l) => l.locale_id === activeLocale,
  );
  renderCards(localeListings);
  renderOutcomes(null);
}

// === FORMATTING HELPERS ===

function fmt(n) {
  return n != null ? n.toLocaleString() : "—";
}

function photoUrl(id) {
  if (!id) return null;
  let region;
  if (id.startsWith("PAMC"))
    region = 235; // PA TREND MLS
  else if (id.startsWith("NDP") || id.startsWith("PTP"))
    region = 45; // SD CRMLS
  else if (/^\d{9}$/.test(id))
    region = 48; // SD SDMLS (Sandicor)
  else if (/^\d{8}$/.test(id))
    region = 156; // MARIS (St. Louis)
  else return null;
  return `https://ssl.cdn-redfin.com/photo/${region}/mbpaddedwide/${id.slice(-3)}/genMid.${id}_0.jpg`;
}

function fmtAcres(sqft) {
  if (sqft == null) return "—";
  const ac = sqft / 43560;
  if (ac >= 0.1) return ac.toFixed(2) + " ac";
  if (sqft >= 1000) return Math.round(sqft / 1000) + "k sf";
  return sqft + " sf";
}

function computeUpside(l) {
  if (!investmentConfig || l.locale_id !== "st-louis") return null;
  const cfg = investmentConfig;

  // Rent lookup — city match first, zip fallback for USPS aliases (e.g. "Saint Louis")
  const city = (l.city ?? "").toLowerCase().trim();
  const resolvedCity = cfg.rentByCity[city]
    ? city
    : (cfg.zipToCity?.[l.zip] ?? null);
  const cityRents = resolvedCity ? cfg.rentByCity[resolvedCity] : null;
  if (!cityRents) return null;
  const availBeds = Object.keys(cityRents)
    .map(Number)
    .sort((a, b) => a - b);
  const clampedBeds = Math.max(
    availBeds[0],
    Math.min(availBeds[availBeds.length - 1], l.beds ?? 3),
  );
  const rent = cityRents[clampedBeds] ?? 0;
  if (!rent) return null;

  // Mortgage P&I (30yr fixed)
  const loanAmount = l.price * (1 - cfg.downPaymentPct);
  const monthlyRate = (cfg.baseRate30yr + cfg.investmentRateAdder) / 12;
  const mortgage =
    (loanAmount * (monthlyRate * Math.pow(1 + monthlyRate, 360))) /
    (Math.pow(1 + monthlyRate, 360) - 1);

  // Monthly expenses
  const vacancy = rent * cfg.vacancyRate;
  const maintenance = rent * cfg.maintenanceRate;
  const insurance = cfg.insuranceMonthly;
  const taxes = (l.price * cfg.propertyTaxAnnualRate) / 12;

  const netCashFlow =
    rent - mortgage - vacancy - maintenance - insurance - taxes;

  // Renovation estimate from year_built tier
  const yearBuilt = l.year_built ?? 9999;
  const renoTier = cfg.renoTiers.find((t) => yearBuilt <= t.maxYearBuilt);
  const reno = renoTier?.cost ?? 8_000;

  const totalCashIn = l.price * cfg.downPaymentPct + reno;
  const coc = totalCashIn > 0 ? (netCashFlow * 12) / totalCashIn : 0;

  // Cap rate — NOI / price, financing-independent
  const noi =
    rent * 12 * (1 - cfg.vacancyRate - cfg.maintenanceRate) -
    cfg.insuranceMonthly * 12 -
    l.price * cfg.propertyTaxAnnualRate;
  const capRate = noi / l.price;

  // Break-even price — what price makes netCashFlow = 0
  // rent*(1 - vr - mr) - ins = P*((1-dp)*mortgageFactor + taxRate/12)
  const mortgageFactor =
    (monthlyRate * Math.pow(1 + monthlyRate, 360)) /
    (Math.pow(1 + monthlyRate, 360) - 1);
  const breakEvenPrice = Math.round(
    (rent * (1 - cfg.vacancyRate - cfg.maintenanceRate) -
      cfg.insuranceMonthly) /
      ((1 - cfg.downPaymentPct) * mortgageFactor +
        cfg.propertyTaxAnnualRate / 12),
  );

  // BRRRR — only when sold comps exist for this city and sqft is known
  let brrrr = null;
  const comps = stlComps[city];
  if (comps && l.sqft) {
    const arv = Math.round(comps.medianPpsf * l.sqft);
    const forcedEquity = arv - l.price - reno;
    const refinanceAmt = Math.round(arv * cfg.refinanceLtv);
    const originalLoan = Math.round(l.price * (1 - cfg.downPaymentPct));
    const cashBack = refinanceAmt - originalLoan;
    const isFullBrrrr = cashBack >= totalCashIn;
    brrrr = {
      arv,
      reno,
      forcedEquity,
      refinanceAmt,
      originalLoan,
      cashBack,
      totalCashIn,
      comps,
      isFullBrrrr,
    };
  }

  return {
    rent,
    mortgage,
    netCashFlow,
    coc,
    capRate,
    breakEvenPrice,
    reno,
    totalCashIn,
    brrrr,
  };
}

function fmtK(n) {
  const abs = Math.abs(Math.round(n / 1000));
  return (abs === 0 ? "" : n < 0 ? "-" : "") + "$" + abs + "K";
}

function fmtDollar(n) {
  return (n < 0 ? "-$" : "$") + fmt(Math.abs(Math.round(n)));
}

function renderInvestmentRows(l) {
  const up = computeUpside(l);
  if (!up) return "";

  const cfColor = up.netCashFlow >= 0 ? "var(--green)" : "var(--red)";
  const cfSign = up.netCashFlow >= 0 ? "+" : "-";
  const cocPct = (up.coc * 100).toFixed(1);
  const capPct = (up.capRate * 100).toFixed(1);

  let brrrrHtml = "";
  if (up.brrrr) {
    const b = up.brrrr;
    brrrrHtml = `
      <div class="investment-brrrr" onclick="toggleBrrrr(this)">
        <div class="brrrr-summary">
          <span class="brrrr-arrow" style="font-size: 1rem;">▸</span> <span class="tip ${b.isFullBrrrr ? "brrrr-full-badge" : ""}" data-tip="Buy, Rehab, Rent, Refinance, Repeat — a strategy to recover your down payment via a cash-out refi after adding value through renovation.">BRRRR ${b.isFullBrrrr ? "👍" : "👎"}</span> &nbsp; <span class="tip" data-tip="After-Repair Value: estimated market value after renovation, based on recent sold comps in this area.">ARV</span> ${fmtK(b.arv)} · Reno ~${fmtK(b.reno)} · <span class="tip" data-tip="Value created by buying below market and renovating: ARV minus purchase price minus reno cost.">Equity</span> ${fmtK(b.forcedEquity)} · <span class="tip" data-tip="Cash you'd receive from the refi after paying off the original loan. Positive means capital recovered.">Refi pull</span> ${fmtK(b.cashBack)}
        </div>
        <div class="brrrr-detail">
          <div class="brrrr-row"><span><span class="tip" data-tip="Estimated market value after renovation, based on median sold $/sqft from recent comps in this city.">After-repair value</span></span><span>$${fmt(b.arv)}</span></div>
          <div class="brrrr-row brrrr-sub"><span>${b.comps.sampleSize} sold comps in ${l.city} @ $${b.comps.medianPpsf}/sqft</span></div>
          <div class="brrrr-row"><span><span class="tip" data-tip="Estimated light rehab cost based on year built. Pre-1960: ~$40K, 1960–79: ~$25K, 1980–99: ~$15K, 2000+: ~$8K.">Reno estimate</span></span><span>~$${fmt(b.reno)}${l.year_built ? " (built " + l.year_built + ")" : ""}</span></div>
          <div class="brrrr-row"><span><span class="tip" data-tip="ARV minus purchase price minus reno cost. The equity you create through buying below market and improving the property.">Forced equity</span></span><span>${fmtDollar(b.forcedEquity)}</span></div>
          <div class="brrrr-row"><span><span class="tip" data-tip="How much a lender will loan after renovation, at ${(investmentConfig.refinanceLtv * 100).toFixed(0)}% of the ARV.">Refi @ ${(investmentConfig.refinanceLtv * 100).toFixed(0)}% LTV</span></span><span>$${fmt(b.refinanceAmt)}</span></div>
          <div class="brrrr-row"><span>Original loan</span><span>$${fmt(b.originalLoan)}</span></div>
          <div class="brrrr-row brrrr-highlight"><span><span class="tip" data-tip="Refi amount minus original loan. This is cash back in your pocket — capital you can redeploy into the next deal.">Cash back</span></span><span>${fmtDollar(b.cashBack)}</span></div>
          <div class="brrrr-row"><span><span class="tip" data-tip="Down payment plus reno cost — your total capital at risk before the refinance.">Total cash in</span></span><span>$${fmt(b.totalCashIn)} (${(investmentConfig.downPaymentPct * 100).toFixed(0)}% down + reno)</span></div>
        </div>
      </div>`;
  }

  const beColor =
    up.breakEvenPrice >= l.price ? "var(--green)" : "var(--text-dim)";
  return `
    <div class="investment-row">
      <span><span class="tip" data-tip="Monthly rent minus mortgage, vacancy, maintenance, insurance, and property taxes. Green = positive cash flow.">Cash flow</span> <strong style="color:${cfColor}">${cfSign}$${Math.round(Math.abs(up.netCashFlow))}/mo</strong></span>
      <span><span class="tip" data-tip="Cash-on-Cash: annual cash flow ÷ total cash invested (down payment + reno). Your cash yield on deployed capital.">CoC</span> <strong>${cocPct}%</strong></span>
      <span><span class="tip" data-tip="Cap Rate: Net Operating Income ÷ purchase price, with no mortgage factored in. The industry-standard way to compare properties regardless of financing. 5%+ is decent, 6%+ is good in STL.">Cap</span> <strong>${capPct}%</strong></span>
      <span><span class="tip" data-tip="The maximum price you could pay for this property and still break even on monthly cash flow, at current rates and estimated rents.">Break-even</span> <strong style="color:${beColor}">${fmtK(up.breakEvenPrice)}</strong></span>
      <span>est. rent <strong>${fmtK(up.rent)}/mo</strong></span>
    </div>
    ${brrrrHtml}`;
}

function toggleBrrrr(el) {
  const detail = el.querySelector(".brrrr-detail");
  const arrowSpan = el.querySelector(".brrrr-arrow");
  const isOpen = el.classList.contains("brrrr-open");
  el.classList.toggle("brrrr-open", !isOpen);
  detail.style.display = isOpen ? "none" : "";
  if (arrowSpan) arrowSpan.textContent = isOpen ? "▸" : "▾";
}

function scoreClass(s) {
  if (s >= 80) return "score-hi";
  if (s >= 60) return "score-mid";
  return "score-lo";
}

function domLabel(dom) {
  if (dom == null) return "";
  if (investmentConfig) {
    if (dom > 30) return `<span class="dom-ok">${dom}d ↑</span>`;
    return `<span class="dom-ok">${dom}d</span>`;
  }
  if (dom <= 7) return `<span class="dom-ok">${dom}d ↑</span>`;
  if (dom > 30) return `<span class="dom-ok">${dom}d ↓</span>`;
  return `<span class="dom-ok">${dom}d</span>`;
}

function priceChange(l) {
  if (!l.price_at_first_seen || l.price_at_first_seen === l.price) return "";
  const diff = l.price - l.price_at_first_seen;
  const sign = diff < 0 ? "▼" : "▲";
  const color = diff < 0 ? "var(--green)" : "var(--red)";
  return `<span style="font-size:16px;color:${color};margin-left:6px"><span style="font-size:10px;">${sign}</span> $${Math.abs(diff).toLocaleString()}</span>`;
}

// === SCORE BREAKDOWN BARS ===

const FACTOR_LABELS = {
  propertyType: "Type",
  schoolDistrict: "School",
  walkability: "Walk",
  price: "Price",
  sqft: "Sqft",
  lot: "Lot",
  transit: "Transit",
  beds: "Beds",
  pricePerSqft: "$/sqft",
  neighborhoodBonus: "Local+",
  domBonus: "DOM+",
  domPenalty: "DOM−",
  amtrak: "Transit",
  narberthBonus: "Local+",
};

const OLD_MAXES = {
  propertyType: 20,
  schoolDistrict: 20,
  walkability: 12,
  price: 12,
  sqft: 8,
  lot: 12,
  amtrak: 8,
  beds: 4,
  pricePerSqft: 4,
  narberthBonus: 6,
  domPenalty: 10,
};
const OLD_KEY_MAP = { amtrak: "transit", narberthBonus: "neighborhoodBonus" };

function parseBreakdown(raw) {
  if (!raw) return null;
  try {
    const bd = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (bd.factors) return bd;
    const factors = {};
    for (const [key, max] of Object.entries(OLD_MAXES)) {
      if (bd[key] != null)
        factors[OLD_KEY_MAP[key] ?? key] = { pts: bd[key], max };
    }
    return { total: bd.total, factors };
  } catch {
    return null;
  }
}

const scoreTipContent = {};

function buildScoreTip(bd) {
  const factors = Object.entries(bd.factors);
  const rows = factors.map(([key, { pts, max }]) => {
    const label = FACTOR_LABELS[key] ?? key;
    const pct = max > 0 ? Math.max(0, pts) / max : 0;
    const normalized = Math.round(pct * 100);
    const barColor =
      key === "domPenalty" && pts > 0
        ? "var(--red)"
        : pts === 0
          ? "var(--border)"
          : pct >= 0.7
            ? "var(--green)"
            : pct >= 0.4
              ? "var(--yellow)"
              : "var(--red)";
    return `<div style="display:flex;align-items:center;gap:7px;margin:3px 0">
      <span style="width:52px;flex-shrink:0;font-size:9px;color:var(--text-dim);letter-spacing:0.03em;text-transform:uppercase">${label}</span>
      <div style="flex:1;height:14px;background:var(--surface-2);border-radius:3px;overflow:hidden">
        <div style="width:max(${normalized}%,18px);height:100%;background:${barColor};border-radius:3px;display:flex;align-items:center;justify-content:flex-end;padding-right:4px;box-sizing:border-box">
          <span style="font-size:9px;font-weight:700;font-family:var(--font-data);color:#fff;text-shadow:0 0 3px rgba(0,0,0,0.5)">${normalized}</span>
        </div>
      </div>
    </div>`;
  });
  return `<div style="padding:2px 0;min-width:200px">${rows.join("")}</div>`;
}

function scoreBadge(l) {
  const score = Math.round(l.score);
  const cls = scoreClass(score);
  const bd = parseBreakdown(l.score_breakdown);
  if (bd && bd.factors && Object.keys(bd.factors).length > 0) {
    const tipId = `score-${l.id ?? l.zpid ?? Math.random()}`;
    scoreTipContent[tipId] = buildScoreTip(bd);
    return `<div class="score-badge ${cls}" data-tip-id="${tipId}" style="cursor:help">${score}</div>`;
  }
  return `<div class="score-badge ${cls}">${score}</div>`;
}

function scoreBars(raw) {
  const bd = parseBreakdown(raw);
  if (!bd) return "";
  const chips = Object.entries(bd.factors)
    .map(([key, { pts, max }]) => {
      const pct = max > 0 ? pts / max : 0;
      const normalized = Math.round(pct * 100);
      const label = FACTOR_LABELS[key] ?? key;
      let chipCls;
      if (pts === 0) chipCls = "zero";
      else if (key === "domPenalty") chipCls = "penalty";
      else if (key === "neighborhoodBonus" || key === "domBonus")
        chipCls = "bonus";
      else if (normalized >= 70) chipCls = "";
      else if (normalized >= 40) chipCls = "mid";
      else chipCls = "lo";
      return `<div class="chip" title="${label}: ${pts.toFixed(1)} / ${max}">
      <div class="chip-val ${chipCls}">${normalized}</div>
      <div class="chip-lbl">${label}</div>
    </div>`;
    })
    .join("");
  return `<div class="breakdown">
    <div class="breakdown-title">Score breakdown</div>
    <div class="breakdown-chips">${chips}</div>
  </div>`;
}

// === OPEN HOUSE ===

// Returns tooltip string for the tip-box, or null if no upcoming open house.
function openHouseTooltip(l) {
  if (!l.next_open_house_start) return null;
  const start = parseOpenHouseDate(l.next_open_house_start);
  const end = parseOpenHouseDate(l.next_open_house_end);
  if (!start || start < startOfToday()) return null;
  const opts = { weekday: "short", month: "short", day: "numeric" };
  const timeOpts = { hour: "numeric", minute: "2-digit" };
  const dateStr = start.toLocaleDateString(undefined, opts);
  const startTime = start.toLocaleTimeString(undefined, timeOpts);
  const endTime = end
    ? " – " + end.toLocaleTimeString(undefined, timeOpts)
    : "";
  const weekend = isThisWeekend(l.next_open_house_start);
  return `Open House${weekend ? " · This Weekend" : ""} · ${dateStr} · ${startTime}${endTime}`;
}

// === PENDING OUTCOMES ===

let outcomesData = null;
let outcomesSort = { col: "date", dir: -1 };
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
  const minScore = parseFloat(document.getElementById("f-score").value);
  const minBeds = parseInt(document.getElementById("f-beds").value);
  const maxPrice = parseInt(document.getElementById("f-price").value);
  const propType = document.getElementById("f-type").value.toLowerCase();

  return outcomesData.listings.filter((l) => {
    // outcomes have locale_id — use it when present, fall back to city-based heuristic
    if (l.locale_id) {
      if (l.locale_id !== activeLocale) return false;
    } else {
      const isSD = l.city?.toLowerCase() === "san diego";
      if (activeLocale === "san-diego" && !isSD) return false;
      if (activeLocale !== "san-diego" && isSD) return false;
    }

    if ((l.score ?? 0) < minScore) return false;
    if ((l.beds ?? 0) < minBeds) return false;
    if ((l.price_at_first_seen || l.price || 0) > maxPrice) return false;
    if (propType && l.property_type?.toLowerCase() !== propType) return false;

    if (selectedAreas.size > 0) {
      const key =
        activeLocale === "san-diego" || activeLocale === "st-louis"
          ? l.zip
          : l.city?.toLowerCase();
      if (!selectedAreas.has(key)) return false;
    }
    return true;
  });
}

function computeOutcomesStats(listings) {
  return {
    pendingCount: listings.filter((l) => l.pending_at != null).length,
    soldCount: listings.filter((l) => l.sold_at != null).length,
    medianDom: medianOf(
      listings.map((l) => l.days_on_market).filter((v) => v != null),
    ),
    medianListToPendingPct: medianOf(
      listings
        .filter((l) => l.pending_price != null && l.price_at_first_seen > 0)
        .map(
          (l) =>
            ((l.pending_price - l.price_at_first_seen) /
              l.price_at_first_seen) *
            100,
        ),
    ),
    medianListToSoldPct: medianOf(
      listings
        .filter((l) => l.sold_price != null && l.price_at_first_seen > 0)
        .map(
          (l) =>
            ((l.sold_price - l.price_at_first_seen) / l.price_at_first_seen) *
            100,
        ),
    ),
  };
}

function fmtPct(pct) {
  if (pct == null) return "—";
  return (pct >= 0 ? "+" : "") + pct.toFixed(1) + "%";
}

function pctColor(pct) {
  if (pct == null) return "var(--muted)";
  if (pct < -0.5) return "var(--green)";
  if (pct > 0.5) return "var(--red)";
  return "var(--muted)";
}

function sortOutcomes(col) {
  if (outcomesSort.col === col) outcomesSort.dir *= -1;
  else {
    outcomesSort.col = col;
    outcomesSort.dir = -1;
  }
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
    if (col === "date") {
      av = a.sold_at ?? a.pending_at ?? "";
      bv = b.sold_at ?? b.pending_at ?? "";
    } else if (col === "dom") {
      av = a.days_on_market ?? -1;
      bv = b.days_on_market ?? -1;
    } else if (col === "delta") {
      const ref = (l) => l.sold_price ?? l.pending_price ?? 0;
      av =
        a.price_at_first_seen > 0
          ? (ref(a) - a.price_at_first_seen) / a.price_at_first_seen
          : -99;
      bv =
        b.price_at_first_seen > 0
          ? (ref(b) - b.price_at_first_seen) / b.price_at_first_seen
          : -99;
    } else if (col === "list") {
      av = a.price_at_first_seen;
      bv = b.price_at_first_seen;
    } else if (col === "sale") {
      av = a.sold_price ?? a.pending_price ?? 0;
      bv = b.sold_price ?? b.pending_price ?? 0;
    } else if (col === "score") {
      av = a.score;
      bv = b.score;
    } else {
      av = 0;
      bv = 0;
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
  const page = sorted.slice(
    outcomesPage * OUTCOMES_PAGE_SIZE,
    (outcomesPage + 1) * OUTCOMES_PAGE_SIZE,
  );

  const { col, dir } = outcomesSort;
  const arrow = (d) => (d === -1 ? " ↓" : " ↑");
  const th = (label, key) =>
    `<th style="cursor:pointer;user-select:none" onclick="sortOutcomes('${key}')">${label}${col === key ? arrow(dir) : ""}</th>`;

  const rows = page
    .map((l) => {
      const saleRef = l.sold_price ?? l.pending_price;
      const delta =
        saleRef != null && l.price_at_first_seen > 0
          ? ((saleRef - l.price_at_first_seen) / l.price_at_first_seen) * 100
          : null;
      const displayDate = l.sold_at
        ? new Date(l.sold_at).toLocaleDateString()
        : l.pending_at
          ? new Date(l.pending_at).toLocaleDateString()
          : "—";
      const statusBadge = l.sold_at
        ? `<span class="pending-badge" style="background:#14532d;color:#86efac;border-color:#166534">Sold</span>`
        : `<span class="pending-badge">Pending</span>`;
      return `<tr>
      <td><a href="${l.url ?? "#"}" target="_blank" rel="noopener" style="color:var(--accent);text-decoration:none">${l.address}</a></td>
      <td>${l.city}</td>
      <td>$${fmt(l.price_at_first_seen)}</td>
      <td>${l.pending_price ? "$" + fmt(l.pending_price) : "—"}</td>
      <td>${l.sold_price ? "$" + fmt(l.sold_price) : "—"}</td>
      <td style="color:${pctColor(delta)};font-weight:600">${fmtPct(delta)}</td>
      <td>${l.days_on_market ?? "—"}</td>
      <td>${displayDate}</td>
      <td>${statusBadge}</td>
      <td>${Math.round(l.score)}</td>
    </tr>`;
    })
    .join("");

  const pagination =
    total > OUTCOMES_PAGE_SIZE
      ? `
    <div style="display:flex;align-items:center;gap:12px;margin-top:12px;font-size:12px;color:var(--muted)">
      <button class="reset-btn" style="width:auto;padding:5px 12px" onclick="outcomesPageChange(-1)" ${outcomesPage === 0 ? "disabled" : ""}>← Prev</button>
      <span>${outcomesPage * OUTCOMES_PAGE_SIZE + 1}–${Math.min((outcomesPage + 1) * OUTCOMES_PAGE_SIZE, total)} of ${total}</span>
      <button class="reset-btn" style="width:auto;padding:5px 12px" onclick="outcomesPageChange(1)" ${outcomesPage >= maxPage ? "disabled" : ""}>Next →</button>
    </div>`
      : "";

  document.getElementById("outcomes-list").innerHTML = `
    <table class="outcomes-table">
      <thead><tr>
        ${th("Address", "addr")}${th("City", "city")}${th("List Price", "list")}
        <th>Pending Price</th>${th("Sale Price", "sale")}${th("Δ vs List", "delta")}
        ${th("DOM", "dom")}${th("Date", "date")}<th>Status</th>${th("Score", "score")}
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

  document.getElementById("outcomes-section").style.display = "";

  if (!listings || listings.length === 0) {
    document.getElementById("outcomes-stats").innerHTML = "";
    document.getElementById("outcomes-list").innerHTML =
      '<div class="empty">No pending or sold listings match the current filters.</div>';
    return;
  }

  document.getElementById("outcomes-stats").innerHTML = `
    <div class="outcome-stat">
      <div class="outcome-stat-val">${stats.pendingCount}</div>
      <div class="outcome-stat-lbl">Gone Pending</div>
    </div>
    <div class="outcome-stat">
      <div class="outcome-stat-val">${stats.soldCount}</div>
      <div class="outcome-stat-lbl">Sold</div>
    </div>
    <div class="outcome-stat">
      <div class="outcome-stat-val">${stats.medianDom != null ? Math.round(stats.medianDom) + "d" : "—"}</div>
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

  const isDark = document.documentElement.classList.contains("dark");
  const gridColor = isDark ? "rgba(255,255,255,0.07)" : "rgba(0,0,0,0.07)";
  const soldPoints = [];
  const pendingPoints = [];
  for (const l of listings) {
    if (l.days_on_market == null || l.price_at_first_seen <= 0) continue;
    if (l.sold_price != null) {
      const y =
        ((l.sold_price - l.price_at_first_seen) / l.price_at_first_seen) * 100;
      soldPoints.push({ x: l.days_on_market, y, label: l.address });
    } else if (l.pending_price != null) {
      const y =
        ((l.pending_price - l.price_at_first_seen) / l.price_at_first_seen) *
        100;
      pendingPoints.push({ x: l.days_on_market, y, label: l.address });
    }
  }

  const ctx = document.getElementById("outcomes-chart").getContext("2d");
  if (outcomesChart) outcomesChart.destroy();
  outcomesChart = new Chart(ctx, {
    type: "scatter",
    data: {
      datasets: [
        {
          label: "Sold (list → sale price)",
          data: soldPoints,
          backgroundColor: soldPoints.map((p) =>
            p.y < -0.5 ? "#22c55e99" : p.y > 0.5 ? "#f8717199" : "#4f8ef799",
          ),
          pointRadius: 7,
          pointHoverRadius: 9,
        },
        {
          label: "Pending (list → asking price)",
          data: pendingPoints,
          backgroundColor: "#eab30899",
          pointRadius: 5,
          pointHoverRadius: 7,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          position: "bottom",
          labels: { boxWidth: 10, font: { size: 11 } },
        },
        tooltip: {
          callbacks: {
            label: (c) =>
              `${c.raw.label}: ${c.parsed.x}d, ${fmtPct(c.parsed.y)}`,
          },
        },
      },
      scales: {
        x: {
          title: { display: true, text: "Days on Market", font: { size: 10 } },
          grid: { color: gridColor },
          ticks: { font: { size: 10 } },
        },
        y: {
          title: {
            display: true,
            text: "% vs. List Price",
            font: { size: 10 },
          },
          grid: { color: gridColor },
          ticks: { font: { size: 10 }, callback: (v) => fmtPct(v) },
        },
      },
    },
  });

  renderOutcomesTable();
}

// === CARDS ===

function getNeighborhood(l) {
  if (activeLocale === "san-diego") {
    const nb = SD_NEIGHBORHOODS.find((n) => n.zip === l.zip);
    return nb?.name ?? null;
  }
  if (activeLocale === "st-louis") {
    const nb = STL_NEIGHBORHOODS.find((n) => n.zip === l.zip);
    return nb?.name ?? null;
  }
  return null;
}

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
      const typeLabel = l.property_type
        ? l.property_type
            .replace(/single family residential/i, "SFD")
            .replace(/single family/i, "SFD")
        : "?";
      const isPending =
        l.status === "130" ||
        l.status === "Pending" ||
        l.status === "Contingent";
      const imgUrl = photoUrl(l.id);
      const ohTip = openHouseTooltip(l);
      const neighborhood = getNeighborhood(l);
      const metaLine = [neighborhood, l.school_district]
        .filter(Boolean)
        .join(" · ");
      return `<div class="card${isPending ? " card-pending" : ""}">
      <div class="card-photo-wrap">
        ${
          imgUrl
            ? `<img class="card-photo" src="${imgUrl}" alt="${l.address}" onerror="this.outerHTML='<div class=\\'card-photo card-photo-placeholder\\'><span>🏠</span></div>'">`
            : `<div class="card-photo card-photo-placeholder"><span>🏠</span></div>`
        }
        <span class="type-pill type-pill-img">${typeLabel}</span>
      </div>
      <div class="card-header">
        <div>
          <div class="card-price">$${fmt(l.price)}${priceChange(l)}</div>
          <div class="card-address">${l.address}${isPending ? ` <span class="pending-badge">${l.status_label || "Pending"}</span>` : ""}</div>
          <div class="card-city">${l.city}, ${l.state ?? ""} ${l.zip}</div>
          ${metaLine ? `<div class="card-meta">${metaLine}</div>` : ""}
        </div>
        <div style="display:flex-col;justify-content: center;gap:6px;">
          ${scoreBadge(l)}
          ${l.days_on_market != null ? `<div class="card-price-sub">${domLabel(l.days_on_market)}</div>` : ""}
        </div>
      </div>
      <div class="card-stats">
        <div class="stat"><div class="stat-val">${l.beds} | ${l.baths}</div><div class="stat-lbl">Beds | Baths</div></div>
        <div class="stat"><div class="stat-val">${l.sqft ? fmt(l.sqft) : "—"}</div><div class="stat-lbl">Sq Ft</div></div>
        <div class="stat"><div class="stat-val">${fmtAcres(l.lot_sqft)}</div><div class="stat-lbl">Lot</div></div>
        <div class="stat"><div class="stat-val">${l.sqft ? "$" + Math.round(l.price / l.sqft) : "—"}</div><div class="stat-lbl">$/Sq Ft</div></div>
      </div>
      ${renderInvestmentRows(l)}
      <div class="card-footer">
        <a class="redfin-link" href="${l.url}" target="_blank" rel="noopener">View on Redfin →</a>
        ${ohTip ? `<span class="oh-action${isThisWeekend(l.next_open_house_start) ? " oh-soon" : ""}" data-tip="${ohTip}">🏠</span>` : ""}
        <button class="star-btn${l.starred ? " starred" : ""}" onclick="toggleStar('${l.id}', this)" title="Star this listing">${l.starred ? "★" : "☆"}</button>
      </div>
    </div>`;
    })
    .join("");
}

// === MAP ===

let listingMap = null;
let tileLayer = null;
let markerGroup = null;
let boundaryLayer = null;
let legendControl = null;
let mapLocale = null;
const boundaryCache = {};

const TILE_LIGHT =
  "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png";
const TILE_DARK =
  "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png";
const TILE_ATTR =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/">CARTO</a>';

const PA_MAP = { center: [40.03, -75.37], zoom: 12 };
const SD_MAP = { center: [32.745, -117.14], zoom: 12 };
const STL_MAP = { center: [38.575, -90.39], zoom: 12 };

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
  return L.divIcon({
    className: "",
    html: `<div style="background:${bg};border:2px solid ${border};color:#fff;border-radius:50%;width:32px;height:32px;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;box-shadow:0 2px 6px rgba(0,0,0,.25)">${Math.round(score)}</div>`,
    iconSize: [32, 32],
    iconAnchor: [16, 16],
    popupAnchor: [0, -18],
  });
}

async function fetchZipBoundaries(locale) {
  if (boundaryCache[locale]) return boundaryCache[locale];
  const pollingRegions =
    locale === "san-diego"
      ? SD_POLLING_REGIONS
      : locale === "st-louis"
        ? STL_POLLING_REGIONS
        : PA_POLLING_ZIPS;
  const zips = Object.keys(pollingRegions)
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
  boundaryCache[locale] = await res.json();
  return boundaryCache[locale];
}

async function renderMap(listings) {
  const locale = activeLocale;
  const localeMapCfg =
    locale === "san-diego" ? SD_MAP : locale === "st-louis" ? STL_MAP : PA_MAP;
  const pollingRegions =
    locale === "san-diego"
      ? SD_POLLING_REGIONS
      : locale === "st-louis"
        ? STL_POLLING_REGIONS
        : PA_POLLING_ZIPS;
  const isDark = document.documentElement.classList.contains("dark");
  const tileUrl = isDark ? TILE_DARK : TILE_LIGHT;

  if (!listingMap) {
    listingMap = L.map("listing-map", { zoomControl: true }).setView(
      localeMapCfg.center,
      localeMapCfg.zoom,
    );
    tileLayer = L.tileLayer(tileUrl, {
      attribution: TILE_ATTR,
      maxZoom: 19,
    }).addTo(listingMap);
    markerGroup = L.layerGroup().addTo(listingMap);
  } else {
    tileLayer.setUrl(tileUrl);
    markerGroup.clearLayers();
  }

  // Re-center and redraw boundaries when locale changes
  if (mapLocale !== locale) {
    mapLocale = locale;
    listingMap.setView(localeMapCfg.center, localeMapCfg.zoom);
    if (boundaryLayer) {
      boundaryLayer.remove();
      boundaryLayer = null;
    }
    if (legendControl) {
      legendControl.remove();
      legendControl = null;
    }

    legendControl = L.control({ position: "bottomright" });
    legendControl.onAdd = () => {
      const div = L.DomUtil.create("div", "map-legend");
      div.innerHTML =
        '<div class="map-legend-title">Polling Areas</div>' +
        Object.entries(pollingRegions)
          .map(
            ([, { label, color }]) =>
              `<div class="map-legend-row"><span class="map-legend-dot" style="background:${color}"></span>${label}</div>`,
          )
          .join("");
      return div;
    };
    legendControl.addTo(listingMap);

    fetchZipBoundaries(locale)
      .then((geojson) => {
        if (!geojson) return;
        boundaryLayer = L.geoJSON(geojson, {
          style: (feature) => {
            const zip = feature.properties?.ZCTA5;
            const color = pollingRegions[zip]?.color ?? "#4f8ef7";
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
            const region = pollingRegions[zip];
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
      .catch(() => {});
  }

  const valid = listings.filter((l) => l.lat && l.lng);
  document.getElementById("map-count").textContent = valid.length + " listings";

  valid.forEach((l) => {
    const typeLabel = l.property_type
      ? l.property_type
          .replace(/single family residential/i, "SFD")
          .replace(/single family/i, "SFD")
      : "?";
    const oh = l.next_open_house_start
      ? `<div style="margin-top:6px;font-size:11px;color:#2563eb;font-weight:600">🏡 ${l.next_open_house_start}</div>`
      : "";
    const popup = `
      <div style="font-family:-apple-system,sans-serif;min-width:200px">
        <div style="font-weight:700;font-size:13px">${l.address}</div>
        <div style="color:#6b7280;font-size:11px;margin-bottom:6px">${l.city}, ${l.state ?? ""} ${l.zip}</div>
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

// === TREND CHARTS ===

const PA_CITY_COLORS = Object.fromEntries(
  Object.entries(PA_NEIGHBORHOOD_COLORS).map(([name, color]) => [
    name.toLowerCase(),
    color,
  ]),
);
PA_CITY_COLORS["narberth"] = PA_NEIGHBORHOOD_COLORS["Narberth/Penn Valley"];
PA_CITY_COLORS["penn valley"] = PA_NEIGHBORHOOD_COLORS["Narberth/Penn Valley"];

const SD_CITY_COLORS = { "san diego": "#ef4444" };

const STL_CITY_COLORS = {
  "saint louis": "#4f8ef7", // most addresses show "Saint Louis" as USPS city
  kirkwood: "#4f8ef7",
  glendale: "#22c55e",
  "webster groves": "#a855f7",
  "rock hill": "#f97316",
  maplewood: "#06b6d4",
  "richmond heights": "#eab308",
  ladue: "#ec4899",
  clayton: "#14b8a6",
  shrewsbury: "#f43f5e",
  "des peres": "#8b5cf6",
  "sunset hills": "#84cc16",
  crestwood: "#fb923c",
};

function cityColor(city) {
  if (activeLocale === "san-diego") return SD_CITY_COLORS[city] ?? "#6b7280";
  if (activeLocale === "st-louis") return STL_CITY_COLORS[city] ?? "#6b7280";
  return PA_CITY_COLORS[city] ?? "#6b7280";
}

function renderTrendCharts(data) {
  const localeData = {
    listPrice: data.listPrice.filter((r) => r.locale_id === activeLocale),
    soldPrice: data.soldPrice.filter((r) => r.locale_id === activeLocale),
    score: data.score.filter((r) => r.locale_id === activeLocale),
  };

  const isDark = document.documentElement.classList.contains("dark");
  const gridColor = isDark ? "rgba(255,255,255,0.07)" : "rgba(0,0,0,0.07)";

  const allMonths = [
    ...new Set([
      ...localeData.listPrice.map((r) => r.month),
      ...localeData.soldPrice.map((r) => r.month),
    ]),
  ].sort();

  const listByCityMonth = {};
  localeData.listPrice.forEach(({ city, month, avg }) => {
    (listByCityMonth[city] ??= {})[month] = avg;
  });
  const soldByCityMonth = {};
  localeData.soldPrice.forEach(({ city, month, avg }) => {
    (soldByCityMonth[city] ??= {})[month] = avg;
  });

  const priceCities = [
    ...new Set([
      ...Object.keys(listByCityMonth),
      ...Object.keys(soldByCityMonth),
    ]),
  ].sort();
  const priceDatasets = [];
  priceCities.forEach((city) => {
    const color = cityColor(city);
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

  const priceCtx = document
    .getElementById("price-trend-chart")
    .getContext("2d");
  if (priceTrendChart) priceTrendChart.destroy();
  priceTrendChart = new Chart(priceCtx, {
    type: "line",
    data: { labels: allMonths, datasets: priceDatasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          position: "bottom",
          labels: { boxWidth: 10, font: { size: 11 } },
        },
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

  const scoreMonths = [...new Set(localeData.score.map((r) => r.month))].sort();
  const scoreByCityMonth = {};
  localeData.score.forEach(({ city, month, avg }) => {
    (scoreByCityMonth[city] ??= {})[month] = avg;
  });
  const scoreCities = Object.keys(scoreByCityMonth).sort();

  const scoreDatasets = scoreCities.map((city) => ({
    label: city.charAt(0).toUpperCase() + city.slice(1),
    data: scoreMonths.map((m) => scoreByCityMonth[city]?.[m] ?? null),
    borderColor: cityColor(city),
    backgroundColor: cityColor(city) + "20",
    borderWidth: 2,
    tension: 0.3,
    spanGaps: true,
    pointRadius: 3,
  }));

  const scoreCtx = document
    .getElementById("score-trend-chart")
    .getContext("2d");
  if (scoreTrendChart) scoreTrendChart.destroy();
  scoreTrendChart = new Chart(scoreCtx, {
    type: "line",
    data: { labels: scoreMonths, datasets: scoreDatasets },
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
          min: 0,
          max: 100,
          grid: { color: gridColor },
          ticks: { font: { size: 10 } },
        },
      },
    },
  });
}

// === INVENTORY CHART ===

function renderInventoryChart(data) {
  const validAreas = LOCALE_AREA_NAMES[activeLocale];
  const localeData = data.filter((d) => validAreas?.has(d.area));
  if (!localeData.length) return;

  const areaData = {};
  localeData.forEach(({ area, polled_at, listings_found }) => {
    const day = polled_at.slice(0, 10);
    if (!areaData[area]) areaData[area] = {};
    areaData[area][day] = listings_found;
  });

  const allDays = [
    ...new Set(localeData.map((d) => d.polled_at.slice(0, 10))),
  ].sort();
  const areas = Object.keys(areaData);
  const isDark = document.documentElement.classList.contains("dark");
  const gridColor = isDark ? "rgba(255,255,255,0.07)" : "rgba(0,0,0,0.07)";

  const areaColor = (area) => {
    if (activeLocale === "san-diego") {
      const nb = SD_NEIGHBORHOODS.find((n) => n.name === area);
      return nb?.color ?? "#6b7280";
    }
    if (activeLocale === "st-louis")
      return STL_CITY_COLORS[area.toLowerCase()] ?? "#6b7280";
    return PA_NEIGHBORHOOD_COLORS[area] ?? "#6b7280";
  };

  const ctx = document.getElementById("inventory-chart").getContext("2d");
  if (inventoryChart) inventoryChart.destroy();
  inventoryChart = new Chart(ctx, {
    type: "line",
    data: {
      labels: allDays,
      datasets: areas.map((area) => ({
        label: area,
        data: allDays.map((day) => areaData[area][day] ?? null),
        borderColor: areaColor(area),
        backgroundColor: areaColor(area) + "20",
        tension: 0.3,
        spanGaps: true,
        pointRadius: 3,
      })),
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

// === STAR TOGGLE ===

async function toggleStar(id, btn) {
  const res = await fetch(`/api/listings/${id}/star`, { method: "POST" });
  const { starred } = await res.json();
  btn.textContent = starred ? "★" : "☆";
  btn.classList.toggle("starred", starred);
  const listing = allListings.find((l) => l.id === id);
  if (listing) listing.starred = starred ? 1 : 0;
}

// === POLL TRIGGER ===

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

// === MOBILE FILTER DRAWER ===

function toggleFilters() {
  const aside = document.querySelector("aside");
  const overlay = document.getElementById("filter-overlay");
  const isOpen = aside.classList.contains("drawer-open");
  aside.classList.toggle("drawer-open", !isOpen);
  overlay.classList.toggle("active", !isOpen);
}

function closeFilters() {
  document.querySelector("aside").classList.remove("drawer-open");
  document.getElementById("filter-overlay").classList.remove("active");
}

// === VIEW SWITCHING ===

function switchView(view) {
  ["listings", "map", "inventory"].forEach((v) => {
    document
      .getElementById(`view-${v}`)
      .classList.toggle("view-hidden", v !== view);
    document.getElementById(`tab-${v}`).classList.toggle("active", v === view);
    const mnavBtn = document.getElementById(`mnav-${v}`);
    if (mnavBtn) mnavBtn.classList.toggle("active", v === view);
  });
  document
    .getElementById("filters")
    .classList.toggle("view-hidden", view === "inventory");
  document.querySelector("aside").scrollTop = 0;
  localStorage.setItem("view", view);
  closeFilters();
  if (view === "map" && listingMap) {
    setTimeout(() => listingMap.invalidateSize(), 0);
  }
}

// === DARK MODE ===

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
  if (savedView !== "listings") {
    switchView(savedView);
  } else {
    // Ensure mobile nav reflects initial state
    const mnavBtn = document.getElementById("mnav-listings");
    if (mnavBtn) mnavBtn.classList.add("active");
  }
});

init();

// ── Tooltip (fixed position — escapes overflow:hidden cards) ──
function showTip(el) {
  const tipBox = document.getElementById("tip-box");
  if (el.dataset.tipId) {
    const html = scoreTipContent[el.dataset.tipId];
    if (!html) return;
    tipBox.innerHTML = html;
  } else {
    tipBox.textContent = el.dataset.tip;
  }
  tipBox.style.display = "block";
  const rect = el.getBoundingClientRect();
  const tbRect = tipBox.getBoundingClientRect();
  let left = rect.left + rect.width / 2 - tbRect.width / 2;
  let top = rect.top + window.scrollY - tbRect.height - 8;
  left = Math.max(8, Math.min(left, window.innerWidth - tbRect.width - 8));
  tipBox.style.left = left + "px";
  tipBox.style.top = top + "px";
}
document.addEventListener("mouseover", (e) => {
  const el = e.target.closest("[data-tip],[data-tip-id]");
  if (el) showTip(el);
});
document.addEventListener("mouseout", (e) => {
  const tipBox = document.getElementById("tip-box");
  if (e.target.closest("[data-tip],[data-tip-id]"))
    tipBox.style.display = "none";
});
