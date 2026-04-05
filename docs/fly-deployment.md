# Fly.io Deployment

## Overview

Hosts the Fastify web server and SQLite database on a persistent Fly.io VM. The cron scheduler, poll, enrichment, and email notifications all run exactly as they do locally — no code changes required.

Free tier includes: 3 shared VMs, 3GB persistent storage, 160GB outbound transfer/month.

## Prerequisites

```bash
# Install flyctl
brew install flyctl

# Authenticate
fly auth login
```

## Initial Setup

### 1. Add Dockerfile

Create `Dockerfile` in the project root:

```dockerfile
FROM node:20-alpine AS builder
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN corepack enable && pnpm install --frozen-lockfile
COPY . .
RUN pnpm build

FROM node:20-alpine
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile --prod
COPY --from=builder /app/dist ./dist
EXPOSE 3000
CMD ["node", "dist/index.js"]
```

### 2. Launch the app

```bash
fly launch --name house-tracker --region ewr --no-deploy
```

- `ewr` = Newark, NJ (closest to Philadelphia)
- `--no-deploy` lets you configure before first deploy

### 3. Create a persistent volume for SQLite

```bash
fly volumes create house_tracker_data --size 1 --region ewr
```

### 4. Mount the volume

Edit the generated `fly.toml` — add the mounts section and set the data path:

```toml
[env]
  DB_PATH = "/data/listings.db"

[[mounts]]
  source = "house_tracker_data"
  destination = "/data"
```

### 5. Update DB_PATH in code

The app currently hardcodes the DB path. Add support for the env var by updating `src/db/index.ts`:

```ts
const DB_PATH = process.env.DB_PATH ?? path.join(__dirname, '../../data/listings.db');
```

This way it uses `/data/listings.db` on Fly and the local `data/` folder during development.

### 6. Set secrets

```bash
fly secrets set \
  SMTP_USER="you@gmail.com" \
  SMTP_PASS="your-app-password" \
  NOTIFY_TO="you@gmail.com" \
  NOTIFY_SCORE_THRESHOLD="70" \
  POLL_SCHEDULE="0 7 * * *"
```

### 7. Deploy

```bash
fly deploy
```

### 8. Migrate existing data (optional)

If you want to carry over your local SQLite DB:

```bash
fly ssh sftp shell
# In the sftp shell:
put data/listings.db /data/listings.db
```

## Ongoing Operations

```bash
# View live logs
fly logs

# SSH into the VM
fly ssh console

# Redeploy after code changes
fly deploy

# Scale down to save resources (if needed)
fly scale count 1
```

## How It Works on Fly

| Component | Behavior |
|---|---|
| Web server | Always-on Fastify process on port 3000 |
| SQLite | Stored at `/data/listings.db` on the persistent volume — survives deploys |
| Daily poll | `node-cron` fires at 7am inside the server process |
| Email | Sent by the poller after each run if new listings meet threshold |
| Dashboard | Accessible at `https://house-tracker.fly.dev` |

## Cost

Free as long as you stay within [Fly's free allowances](https://fly.io/docs/about/pricing/). A single `shared-cpu-1x` VM with 256MB RAM is sufficient and uses ~1 of your 3 free VMs.

## Related Docs

- [architecture.md](architecture.md)

**Last Updated:** April 4, 2026
**Author:** Daniel Wolner
