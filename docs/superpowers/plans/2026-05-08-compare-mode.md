# Compare Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add card compare mode — hover checkboxes on listing cards, a floating bar when cards are selected, and a full-screen overlay with selected cards + JSON download.

**Architecture:** Pure frontend — no backend changes. Three files modified: `index.html` (HTML structure), `style.css` (styles), `app.js` (state + logic). Extract card HTML generation into a `cardHtml(l)` helper to enable reuse in both `renderCards` and the overlay.

**Tech Stack:** Vanilla JS, HTML, CSS — no new dependencies.

---

### Task 1: Add HTML structure

**Files:**
- Modify: `src/web/public/index.html`

- [ ] **Step 1: Add compare bar and overlay HTML before `</body>`**

In `src/web/public/index.html`, add the following immediately before `<script src="/app.js"></script>` (line 219):

```html
    <!-- Compare floating bar -->
    <div id="compare-bar" style="display:none">
      <span id="compare-count"></span>
      <button class="compare-bar-btn" onclick="openCompareOverlay()">Compare</button>
      <button class="compare-bar-btn compare-bar-clear" onclick="clearCompare()">Clear</button>
    </div>

    <!-- Compare overlay -->
    <div id="compare-overlay" style="display:none">
      <div id="compare-overlay-backdrop" onclick="closeCompareOverlay()"></div>
      <div id="compare-overlay-inner">
        <div id="compare-overlay-header">
          <span id="compare-overlay-title"></span>
          <button class="compare-bar-btn" onclick="downloadCompareJson()">Download JSON</button>
          <button class="compare-bar-btn compare-bar-clear" onclick="closeCompareOverlay()">✕ Close</button>
        </div>
        <div class="cards" id="compare-cards"></div>
      </div>
    </div>
```

- [ ] **Step 2: Verify HTML is valid — open the app in a browser**

```bash
cd /path/to/house-tracker && pnpm dev
```

Open `http://localhost:3000` — page should load normally with no visible changes (both new divs are hidden). Open DevTools → Elements and confirm `#compare-bar` and `#compare-overlay` exist in the DOM.

- [ ] **Step 3: Commit**

```bash
git add src/web/public/index.html
git commit -m "feat: add compare bar and overlay HTML structure"
```

---

### Task 2: Add CSS styles

**Files:**
- Modify: `src/web/public/style.css`

- [ ] **Step 1: Add card checkbox styles**

Append to the end of `src/web/public/style.css`:

```css
/* ===== COMPARE MODE ===== */

.card-photo-wrap {
  position: relative;
}

.card-select-cb {
  position: absolute;
  top: 8px;
  left: 8px;
  z-index: 10;
  opacity: 0;
  transition: opacity 0.15s;
  cursor: pointer;
  background: rgba(0,0,0,0.45);
  border-radius: 4px;
  padding: 2px;
  display: flex;
  align-items: center;
}

.card:hover .card-select-cb {
  opacity: 1;
}

.card-select-cb.is-checked {
  opacity: 1;
}

.card-select-cb input[type="checkbox"] {
  width: 16px;
  height: 16px;
  cursor: pointer;
  accent-color: var(--accent);
  margin: 0;
}

/* ===== COMPARE BAR ===== */

#compare-bar {
  position: fixed;
  bottom: 72px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 900;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 999px;
  padding: 10px 20px;
  display: flex;
  align-items: center;
  gap: 12px;
  box-shadow: 0 4px 24px rgba(0,0,0,0.22);
  font-size: 13px;
  font-weight: 600;
  white-space: nowrap;
}

.compare-bar-btn {
  background: var(--accent);
  color: #fff;
  border: none;
  border-radius: 6px;
  padding: 6px 14px;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  font-family: var(--font-ui);
}

.compare-bar-btn:hover {
  opacity: 0.88;
}

.compare-bar-clear {
  background: var(--surface-2);
  color: var(--text);
  border: 1px solid var(--border);
}

/* ===== COMPARE OVERLAY ===== */

#compare-overlay {
  position: fixed;
  inset: 0;
  z-index: 1000;
  display: flex;
  align-items: flex-start;
  justify-content: center;
}

#compare-overlay-backdrop {
  position: absolute;
  inset: 0;
  background: rgba(0,0,0,0.6);
}

#compare-overlay-inner {
  position: relative;
  z-index: 1;
  background: var(--bg);
  width: 100%;
  height: 100%;
  overflow-y: auto;
  padding: 0 24px 40px;
}

#compare-overlay-header {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 14px 0;
  margin-bottom: 16px;
  position: sticky;
  top: 0;
  background: var(--bg);
  border-bottom: 1px solid var(--border);
  z-index: 10;
}

#compare-overlay-title {
  font-size: 15px;
  font-weight: 600;
  flex: 1;
}
```

- [ ] **Step 2: Verify styles load — check in browser**

With `pnpm dev` still running, hard-refresh `http://localhost:3000`. Open DevTools → Elements, find a `.card`, hover it — you won't see a checkbox yet (JS not wired yet), but no CSS errors should appear in the console.

- [ ] **Step 3: Commit**

```bash
git add src/web/public/style.css
git commit -m "feat: add compare mode CSS — card checkbox, floating bar, overlay"
```

---

### Task 3: Add JS logic

**Files:**
- Modify: `src/web/public/app.js`

This task:
1. Adds `selectedIds` to global state
2. Extracts `cardHtml(l)` from `renderCards` so both `renderCards` and the compare overlay can reuse it
3. Adds `toggleCompare`, `updateCompareBar`, `clearCompare`, `openCompareOverlay`, `closeCompareOverlay`, `downloadCompareJson`
4. Wires `clearCompare` into `switchLocale`

- [ ] **Step 1: Add `selectedIds` to global state**

In `src/web/public/app.js`, find the `// === STATE ===` block at the top (lines 1–14). Add `selectedIds` after line 14:

```js
let selectedIds = new Set();
```

The top of the file should now read:

```js
// === STATE ===
let allListings = [];
let activeLocale = localStorage.getItem("locale") ?? "main-line";
let selectedAreas = new Set();
let selectedIds = new Set();
// ... rest unchanged
```

- [ ] **Step 2: Extract `cardHtml(l)` from `renderCards`**

Currently `renderCards` (around line 1206) builds card HTML inline in a `.map()`. Extract the inner template into a standalone `cardHtml(l)` function, then call it from `renderCards`.

Replace the `renderCards` function with:

```js
function cardHtml(l) {
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
  const isSelected = selectedIds.has(l.id);
  return `<div class="card${isPending ? " card-pending" : ""}">
    <div class="card-photo-wrap">
      ${
        imgUrl
          ? `<img class="card-photo" src="${imgUrl}" alt="${l.address}" onerror="this.outerHTML='<div class=\\'card-photo card-photo-placeholder\\'><span>🏠</span></div>'">`
          : `<div class="card-photo card-photo-placeholder"><span>🏠</span></div>`
      }
      <label class="card-select-cb${isSelected ? " is-checked" : ""}" onclick="event.stopPropagation()">
        <input type="checkbox" onchange="toggleCompare('${l.id}', this)" ${isSelected ? "checked" : ""} />
      </label>
      <span class="type-pill type-pill-img">${typeLabel}</span>
    </div>
    <div class="card-header">
      <div>
        <div class="card-price">$${fmt(l.price)}${priceChange(l)}</div>
        <div class="card-address">${l.address}${isPending ? ` <span class="pending-badge">${l.status_label || "Pending"}</span>` : ""}</div>
        <div class="card-city">${l.city}, ${l.state ?? ""} ${l.zip}</div>
      </div>
      <div style="display:flex-col;justify-content: center;gap:6px;">
        ${scoreBadge(l)}
        ${l.days_on_market != null ? `<div class="card-price-sub">${domLabel(l.days_on_market)}</div>` : ""}
      </div>
    </div>
    ${metaLine ? `<div class="card-meta">${metaLine}</div>` : ""}
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
}

function renderCards(listings) {
  const wrap = document.getElementById("cards");
  document.getElementById("results-count").textContent =
    listings.length + " listings";

  if (listings.length === 0) {
    wrap.innerHTML = '<div class="empty">No listings match your filters.</div>';
    return;
  }

  wrap.innerHTML = listings.map(cardHtml).join("");
}
```

- [ ] **Step 3: Add compare functions**

Add the following block to `app.js` right after `renderCards` (before `// === MAP ===`):

```js
// === COMPARE MODE ===

function toggleCompare(id, checkbox) {
  if (checkbox.checked) {
    selectedIds.add(id);
    checkbox.closest('.card-select-cb').classList.add('is-checked');
  } else {
    selectedIds.delete(id);
    checkbox.closest('.card-select-cb').classList.remove('is-checked');
  }
  updateCompareBar();
}

function updateCompareBar() {
  const bar = document.getElementById('compare-bar');
  const countEl = document.getElementById('compare-count');
  if (selectedIds.size === 0) {
    bar.style.display = 'none';
  } else {
    bar.style.display = 'flex';
    countEl.textContent = `${selectedIds.size} selected`;
  }
}

function clearCompare() {
  selectedIds.clear();
  document.querySelectorAll('.card-select-cb').forEach(label => {
    label.classList.remove('is-checked');
    const cb = label.querySelector('input[type="checkbox"]');
    if (cb) cb.checked = false;
  });
  updateCompareBar();
}

function openCompareOverlay() {
  const selected = allListings.filter(l => selectedIds.has(l.id));
  document.getElementById('compare-overlay-title').textContent =
    `Comparing ${selected.length} listing${selected.length !== 1 ? 's' : ''}`;
  document.getElementById('compare-cards').innerHTML = selected.map(cardHtml).join('');
  document.getElementById('compare-overlay').style.display = 'flex';
  document.body.style.overflow = 'hidden';
}

function closeCompareOverlay() {
  document.getElementById('compare-overlay').style.display = 'none';
  document.body.style.overflow = '';
}

function downloadCompareJson() {
  const selected = allListings.filter(l => selectedIds.has(l.id));
  const blob = new Blob([JSON.stringify(selected, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'compare-listings.json';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
```

- [ ] **Step 4: Clear selection on locale switch**

In `switchLocale` (around line 201), add `clearCompare();` as the first line of the function body:

```js
async function switchLocale(locale) {
  clearCompare();           // ← add this line
  activeLocale = locale;
  // ... rest unchanged
```

- [ ] **Step 5: Manually verify in browser**

With `pnpm dev` running, open `http://localhost:3000`:

1. Hover over a card — a checkbox should appear in the top-left corner of the photo
2. Check 2–3 cards — floating bar appears at the bottom with "N selected"
3. Click **Compare** — overlay opens showing only checked cards
4. Click **Download JSON** — browser downloads `compare-listings.json` with the selected listing data
5. Click **✕ Close** — overlay closes
6. Click **Clear** in the floating bar — checkboxes reset, bar hides
7. Switch locale — selection clears automatically

- [ ] **Step 6: Commit**

```bash
git add src/web/public/app.js
git commit -m "feat: implement compare mode — checkbox selection, floating bar, overlay, JSON download"
```
