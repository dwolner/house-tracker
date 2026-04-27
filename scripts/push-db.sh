#!/bin/bash
# Push local SQLite DB to fly.io
# Uploads as listings_restore.db; app swaps it in on next startup (same-volume rename, no WAL corruption).
# Usage: ./scripts/push-db.sh
set -e

APP="house-tracker-kgg27w"
LOCAL_DB="data/listings.db"
CLEAN_COPY="/tmp/listings_push.db"
REMOTE_RESTORE="/data/listings_restore.db"

echo "→ Creating clean backup (checkpointing WAL)"
node -e "
  const db = require('better-sqlite3')('$LOCAL_DB');
  db.pragma('wal_checkpoint(TRUNCATE)');
  db.backup('$CLEAN_COPY').then(() => {
    const src = require('better-sqlite3')('$CLEAN_COPY');
    const m = src.prepare('SELECT COUNT(*) as n FROM listings').get().n;
    const n = src.prepare('SELECT COUNT(*) as n FROM rental_estimates').get().n;
    console.log('  listings to push:', m);
    console.log('  rental_estimates to push:', n);
  });
"
sleep 2

echo "→ Removing any stale restore file on fly.io"
fly ssh console -a "$APP" -C 'sh -c "rm -f /data/listings_restore.db && echo ok"' 2>/dev/null || true

echo "→ Uploading to $APP:$REMOTE_RESTORE (persistent volume)"
fly sftp shell -a "$APP" <<EOF
put $CLEAN_COPY $REMOTE_RESTORE
EOF
rm "$CLEAN_COPY"

echo "→ Restarting app (restore will apply on startup)"
# Kill PID 1 to force a restart; fly.io will restart the machine
fly ssh console -a "$APP" -C 'sh -c "kill -TERM 1"' 2>/dev/null || true
sleep 5
# Trigger startup if machine auto-stopped
curl -s --max-time 10 "https://$APP.fly.dev/" > /dev/null 2>&1 || true

echo "→ Verifying (waiting for app to start)..."
sleep 15
fly ssh console -a "$APP" -C 'sh -c "node -e \"
const db = require(\\\"better-sqlite3\\\")(\\\"/data/listings.db\\\");
const m = db.prepare(\\\"SELECT COUNT(*) as n FROM listings\\\").get().n;
const n = db.prepare(\\\"SELECT COUNT(*) as n FROM rental_estimates\\\").get().n;
console.log(\\\"  listings on fly.io:\\\", m);
console.log(\\\"  rental_estimates on fly.io:\\\", n);
\""'

echo "✓ Done"
