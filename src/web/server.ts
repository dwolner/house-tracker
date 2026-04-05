import Fastify from 'fastify';
import staticPlugin from '@fastify/static';
import { fileURLToPath } from 'url';
import path from 'path';
import cron from 'node-cron';
import { registerRoutes } from './routes.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const POLL_SCHEDULE = process.env.POLL_SCHEDULE ?? '0 7 * * *'; // default: 7am daily

export async function startServer(port = 3000) {
  const app = Fastify({ logger: false });

  await app.register(staticPlugin, {
    root: path.join(__dirname, 'public'),
    prefix: '/',
  });

  registerRoutes(app);

  await app.listen({ port, host: '0.0.0.0' });
  console.log(`[web] dashboard running at http://localhost:${port}`);

  cron.schedule(POLL_SCHEDULE, async () => {
    console.log(`[cron] scheduled poll triggered at ${new Date().toISOString()}`);
    const { runPoll } = await import('../poller/index.js');
    const { sendChangesDigest } = await import('../notifications/email.js');
    const { getUnnotifiedChanges, markChangesNotified } = await import('../db/index.js');
    try {
      await runPoll();
      const changes = getUnnotifiedChanges();
      if (changes.length > 0) {
        await sendChangesDigest(changes);
        markChangesNotified(changes.map(c => c.change_id));
      } else {
        console.log('[cron] no listing changes to notify');
      }
    } catch (err) {
      console.error('[cron] error:', err);
    }
  });
  console.log(`[cron] daily poll scheduled (${POLL_SCHEDULE})`);
}
