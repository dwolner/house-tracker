# Fly.io Deployment

## Overview

Hosts the Fastify web server and SQLite database on a persistent Fly.io VM. The cron scheduler, poll, enrichment, and email notifications all run exactly as they do locally — no code changes required.

Free tier includes: 3 shared VMs, 3GB persistent storage, 160GB outbound transfer/month.

## Current Deployment

App: `house-tracker-kgg27w` · Live at `https://house-tracker-kgg27w.fly.dev`
Region: `lax` · Machine: `d8d2162a233378` (shared-cpu-1x, 256MB)

| Component | Status |
|---|---|
| Dockerfile | ✅ Multi-stage Node 20 build |
| Persistent volume | ✅ `/data` — survives deploys and restarts |
| Secrets | ✅ SMTP, NOTIFY_*, POLL_SCHEDULE, RENTCAST_API_KEY |
| Daily cron | ✅ Runs at 7am UTC via `node-cron` inside the server process |
| `auto_stop_machines = 'off'` | ✅ Always-on (no cold starts) |

## Ongoing Operations

```bash
# Deploy code changes
fly deploy

# Sync local DB to Fly.io (preserves rentcast_usage, rental_estimates, all history)
pnpm push-db

# View live logs
fly logs

# SSH into the VM
fly ssh console

# Verify DB counts on Fly.io
fly ssh console -a house-tracker-kgg27w -C 'node -e "
  const db = require(\"/app/node_modules/better-sqlite3\")(\"/data/listings.db\");
  console.log(\"listings:\", db.prepare(\"SELECT COUNT(*) as n FROM listings\").get().n);
  console.log(\"rental_estimates:\", db.prepare(\"SELECT COUNT(*) as n FROM rental_estimates\").get().n);
  console.log(\"rentcast_usage:\", db.prepare(\"SELECT COUNT(*) as n FROM rentcast_usage\").get().n);
"'
```

### Updating secrets

```bash
fly secrets set RENTCAST_API_KEY="your-key"
fly secrets set SMTP_PASS="new-app-password"
```

### How DB sync works (`pnpm push-db`)

1. Checkpoints WAL (`PRAGMA wal_checkpoint(TRUNCATE)`) on local DB
2. `db.backup()` creates a clean copy at `/tmp/listings_push.db`
3. Uploads to `/data/listings_restore.db` via `fly sftp shell`
4. Kills PID 1 to restart the machine
5. On startup, `src/index.ts` detects `listings_restore.db`, renames it to `listings.db`, and opens it

This approach is safe under WAL mode — no corruption from in-flight writes.

## Initial Setup (for reference)

If you ever need to re-create from scratch:

```bash
fly launch --name house-tracker --region lax --no-deploy
fly volumes create data --size 1 --region lax
fly secrets set \
  SMTP_HOST="smtp.gmail.com" SMTP_PORT="587" \
  SMTP_USER="daniel.wolner@gmail.com" \
  SMTP_PASS="your-gmail-app-password" \
  NOTIFY_TO="daniel.wolner@gmail.com" \
  NOTIFY_SCORE_THRESHOLD="70" \
  POLL_SCHEDULE="0 7 * * *" \
  RENTCAST_API_KEY="your-rentcast-key"
fly deploy
pnpm push-db  # carry over local DB history
```

## How It Works on Fly

| Component | Behavior |
|---|---|
| Web server | Always-on Fastify process on port 3000 |
| SQLite | Stored at `/data/listings.db` on the persistent volume — survives deploys |
| Daily poll | `node-cron` fires at 7am (per `POLL_SCHEDULE`) inside the server process |
| Email | Sent after each poll run if new listings or changes meet threshold |
| Dashboard | Accessible at `https://house-tracker.fly.dev` |

## Cost

Free as long as you stay within [Fly's free allowances](https://fly.io/docs/about/pricing/). A single `shared-cpu-1x` VM with 256MB RAM is sufficient.

## Related Docs

- [architecture.md](architecture.md)
- [roadmap.md](roadmap.md)

**Last Updated:** April 29, 2026
**Author:** Daniel Wolner
