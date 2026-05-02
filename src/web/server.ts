import Fastify from 'fastify';
import staticPlugin from '@fastify/static';
import { fileURLToPath } from 'url';
import path from 'path';
import cron from 'node-cron';
import { registerRoutes } from './routes.js';
import type { NotifyListing } from '../notifications/email.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const POLL_SCHEDULE = process.env.POLL_SCHEDULE ?? '0 7 * * *'; // default: 7am daily

async function runPollAndNotify(label: string): Promise<void> {
  const { runPoll } = await import('../poller/index.js');
  const { sendDigest, NOTIFY_SCORE_THRESHOLD } = await import('../notifications/email.js');
  const { getUnnotifiedChanges, markChangesNotified, sweepStaleChanges, getDb } = await import('../db/index.js');
  try {
    const { newHighScoreIds } = await runPoll();

    // Fetch full card data for new high-score listings
    let newListings: NotifyListing[] = [];
    if (newHighScoreIds.length > 0) {
      const placeholders = newHighScoreIds.map(() => '?').join(',');
      newListings = getDb().prepare(`
        SELECT id, address, city, zip, price, price_at_first_seen, beds, baths, sqft, lot_sqft,
               days_on_market, score, score_breakdown, school_district, property_type, walk_score, url
        FROM listings WHERE id IN (${placeholders}) ORDER BY score DESC
      `).all(...newHighScoreIds) as NotifyListing[];
    }

    const changes = getUnnotifiedChanges(NOTIFY_SCORE_THRESHOLD);

    sweepStaleChanges();
    if (newListings.length > 0 || changes.length > 0) {
      await sendDigest(newListings, changes);
      markChangesNotified(changes.map(c => c.change_id));
    } else {
      console.log(`[${label}] nothing to notify`);
    }
  } catch (err) {
    console.error(`[${label}] error:`, err);
  }
}

function todayLocal(): string {
  // YYYY-MM-DD in local time
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export async function startServer(port = 3000) {
  const app = Fastify({ logger: false });

  await app.register(staticPlugin, {
    root: path.join(__dirname, 'public'),
    prefix: '/',
  });

  registerRoutes(app);

  await app.listen({ port, host: '0.0.0.0' });
  console.log(`[web] dashboard running at http://localhost:${port}`);

  cron.schedule(POLL_SCHEDULE, () => {
    console.log(`[cron] scheduled poll triggered at ${new Date().toISOString()}`);
    runPollAndNotify('cron');
  });
  console.log(`[cron] daily poll scheduled (${POLL_SCHEDULE})`);

  // Fetch live mortgage rate on startup (cached 7 days in settings table)
  const { getCurrentMortgageRate } = await import('../enrichment/mortgage-rate.js');
  getCurrentMortgageRate().catch(e => console.warn('[startup] mortgage rate fetch failed:', e));
  // Refresh weekly (every Sunday at 8am)
  cron.schedule('0 8 * * 0', () => {
    import('../enrichment/mortgage-rate.js').then(m => m.getCurrentMortgageRate());
  });

  // Catch-up poll: if the server starts and today's poll hasn't run yet, run it now.
  // This handles the common case where the laptop was asleep at the scheduled time.
  const { getDb } = await import('../db/index.js');
  const today = todayLocal();
  const localMidnight = new Date();
  localMidnight.setHours(0, 0, 0, 0);
  const lastPollToday = getDb()
    .prepare(`SELECT id FROM poll_log WHERE polled_at >= ? LIMIT 1`)
    .get(localMidnight.toISOString()) as { id: number } | undefined;

  if (!lastPollToday) {
    console.log(`[startup] no poll recorded for ${today} — running catch-up poll in 5s`);
    setTimeout(() => runPollAndNotify('startup'), 5000);
  } else {
    console.log(`[startup] poll already ran today (${today}), skipping catch-up`);
  }
}
