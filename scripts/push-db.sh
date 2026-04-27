#!/bin/bash
# Push local SQLite DB to fly.io
# Usage: ./scripts/push-db.sh
set -e

APP="house-tracker-kgg27w"
LOCAL_DB="data/listings.db"
REMOTE_DB="/data/listings.db"

echo "→ Uploading $LOCAL_DB to $APP:$REMOTE_DB"
fly sftp shell -a "$APP" <<EOF
put $LOCAL_DB $REMOTE_DB
EOF

echo "→ Restarting app process"
fly ssh console -a "$APP" -C "kill -HUP 1"

echo "✓ Done"
