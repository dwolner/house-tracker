# Fly.io Deployment

## Overview

Hosts the Fastify web server and SQLite database on a persistent Fly.io VM. The cron scheduler, poll, enrichment, and email notifications all run exactly as they do locally — no code changes required.

Free tier includes: 3 shared VMs, 3GB persistent storage, 160GB outbound transfer/month.

## Current State

| Step | Status |
|---|---|
| Dockerfile | ✅ Done (`Dockerfile` in project root) |
| DB_PATH env var | ✅ Done (`src/db/index.ts` reads `process.env.DB_PATH`) |
| flyctl installed | ❌ Run `brew install flyctl` |
| Authenticated | ❌ Run `fly auth login` |
| App created / fly.toml | ❌ Run `fly launch` |
| Persistent volume | ❌ Run `fly volumes create` |
| Secrets set | ❌ Run `fly secrets set` |
| Deployed | ❌ Run `fly deploy` |

## Steps to Deploy

### 1. Install and authenticate

```bash
brew install flyctl
fly auth login
```

### 2. Create the app (generates fly.toml)

```bash
cd /Users/danno/Documents/_devRoot/house-tracker
fly launch --name house-tracker --region ewr --no-deploy
```

- `ewr` = Newark, NJ (closest to Philadelphia)
- `--no-deploy` lets you configure before first deploy
- Accept the generated `fly.toml`; you'll edit it in the next step

### 3. Create a persistent volume for SQLite

```bash
fly volumes create house_tracker_data --size 1 --region ewr
```

### 4. Edit fly.toml

Add these sections (the `[env]` and `[[mounts]]` blocks may not be generated automatically):

```toml
[env]
  DB_PATH = "/data/listings.db"

[[mounts]]
  source = "house_tracker_data"
  destination = "/data"
```

Make sure the `[[services]]` or `[http_service]` section exposes port 3000.

### 5. Set secrets

```bash
fly secrets set \
  SMTP_USER="daniel.wolner@gmail.com" \
  SMTP_PASS="your-gmail-app-password" \
  NOTIFY_TO="daniel.wolner@gmail.com" \
  NOTIFY_SCORE_THRESHOLD="70" \
  POLL_SCHEDULE="0 7 * * *"
```

`SMTP_PASS` must be a Gmail App Password (not your account password). Generate one at https://myaccount.google.com/apppasswords.

Optional — only needed if defaults aren't right:
```bash
fly secrets set SMTP_HOST="smtp.gmail.com" SMTP_PORT="587"
```

### 6. Deploy

```bash
fly deploy
```

### 7. Migrate existing data (optional but recommended)

Carry over your local DB so history isn't lost:

```bash
fly ssh sftp shell
# In the sftp shell:
put data/listings.db /data/listings.db
```

### 8. Verify

```bash
fly logs            # watch startup logs
fly open            # open the dashboard in browser
```

## Ongoing Operations

```bash
# View live logs
fly logs

# SSH into the VM
fly ssh console

# Redeploy after code changes
fly deploy

# Trigger a manual poll via the dashboard
# Or: fly ssh console → node dist/poller/index.js
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

**Last Updated:** April 24, 2026
**Author:** Daniel Wolner
