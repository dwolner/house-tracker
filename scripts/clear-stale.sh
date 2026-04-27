#!/bin/bash
# Remove stale inactive listings from the local DB.
# Deletes listings that have been inactive for more than DAYS days (default: 90).
# Also cleans up orphaned rows in related tables.
# Usage: ./scripts/clear-stale.sh [days]
set -e

DB="data/listings.db"
DAYS="${1:-90}"
CUTOFF=$(date -v -${DAYS}d +%Y-%m-%d 2>/dev/null || date -d "-${DAYS} days" +%Y-%m-%d)

echo "→ Removing listings inactive since before $CUTOFF (>${DAYS} days ago)"

node -e "
const db = require('better-sqlite3')('$DB');
const cutoff = '$CUTOFF';

const stale = db.prepare(\`
  SELECT id FROM listings
  WHERE status = 'inactive'
    AND last_seen_at < ?
\`).all(cutoff);

console.log('  Found', stale.length, 'stale listings');
if (stale.length === 0) process.exit(0);

const ids = stale.map(r => r.id);
const placeholders = ids.map(() => '?').join(',');

const del = db.transaction(() => {
  const ph = ids.map(() => '?').join(',');
  db.prepare(\`DELETE FROM price_history     WHERE listing_id IN (\${ph})\`).run(...ids);
  db.prepare(\`DELETE FROM change_log        WHERE listing_id IN (\${ph})\`).run(...ids);
  db.prepare(\`DELETE FROM rental_estimates  WHERE listing_id IN (\${ph})\`).run(...ids);
  db.prepare(\`DELETE FROM rentcast_usage    WHERE listing_id IN (\${ph})\`).run(...ids);
  const result = db.prepare(\`DELETE FROM listings WHERE id IN (\${ph})\`).run(...ids);
  return result.changes;
});

const deleted = del();
console.log('  Deleted', deleted, 'listings and their related rows');
"

echo "✓ Done"
