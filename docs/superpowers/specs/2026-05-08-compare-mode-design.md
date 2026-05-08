# Compare Mode Design

**Date:** 2026-05-08

## Overview

Add a compare mode to the listings card grid. Users select cards via hover-triggered checkboxes, a floating bar appears at the bottom of the screen, and clicking Compare opens a full-screen overlay showing only the selected cards plus a JSON download button.

## User Flow

1. Hover over any card → checkbox appears in top-left corner
2. Check a card → `selectedIds` Set grows, floating compare bar appears at bottom of screen
3. Check more cards
4. Click **Compare** in the floating bar → overlay opens showing selected cards
5. Click **Download JSON** → browser downloads selected listings as `.json`
6. Click **✕** or click backdrop → overlay closes (selection preserved)
7. Click **Clear** in floating bar → selection reset, bar hides

Switching locale or re-filtering clears selection naturally (cards re-render, checkboxes reset).

## State

Add to global state in `app.js`:

```js
let selectedIds = new Set();
```

No persistence — selection is ephemeral per session.

## Components

### Card checkbox (`app.js` → `renderCards`)

Each card gets a `<label class="card-select-cb">` injected in the top-left of `.card-photo-wrap`. Hidden by default, visible on `.card:hover` or when checked. Calls `toggleCompare(id)` on change.

### `toggleCompare(id)`

Adds/removes `id` from `selectedIds`, syncs checkbox checked state in DOM, calls `updateCompareBar()`.

### `updateCompareBar()`

Shows/hides `#compare-bar`. Updates the "N selected" count label.

### Floating bar (`#compare-bar`)

Fixed to bottom of viewport. Hidden when `selectedIds.size === 0`. Contains:
- "**N selected**" label
- **Compare** button → calls `openCompareOverlay()`
- **Clear** button → clears `selectedIds`, unchecks all checkboxes, hides bar

### `openCompareOverlay()`

Populates `#compare-overlay` with:
- Header: "Comparing N listings" + **✕** close button + **Download JSON** button
- Card grid: reuses existing card HTML (same `renderCards`-style map over selected listings from `allListings`)

### `downloadCompareJson()`

Gets selected listings from `allListings`, `JSON.stringify`s them, triggers blob download as `compare-listings.json`.

### Overlay (`#compare-overlay`)

Full-screen fixed overlay. Dark semi-transparent backdrop. Inner scrollable container with the card grid. Clicking the backdrop closes the overlay.

## HTML additions (`index.html`)

```html
<!-- Floating compare bar -->
<div id="compare-bar" style="display:none">
  <span id="compare-count"></span>
  <button onclick="openCompareOverlay()">Compare</button>
  <button onclick="clearCompare()">Clear</button>
</div>

<!-- Compare overlay -->
<div id="compare-overlay" style="display:none">
  <div id="compare-overlay-backdrop" onclick="closeCompareOverlay()"></div>
  <div id="compare-overlay-inner">
    <div id="compare-overlay-header">
      <span id="compare-overlay-title"></span>
      <button onclick="downloadCompareJson()">Download JSON</button>
      <button onclick="closeCompareOverlay()">✕</button>
    </div>
    <div id="compare-cards"></div>
  </div>
</div>
```

## CSS additions (`style.css`)

- `.card-select-cb` — absolute top-left of card photo area, hidden by default, shown on `.card:hover` and when `:checked`
- `#compare-bar` — fixed bottom bar, centered, styled consistently with existing buttons
- `#compare-overlay` — full-screen fixed, z-index above everything
- `#compare-overlay-backdrop` — full-screen dark semi-transparent layer
- `#compare-overlay-inner` — centered white/dark panel, max-width, scrollable

## No backend changes

Pure frontend — all data already in `allListings`.
