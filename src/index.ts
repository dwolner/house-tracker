import 'dotenv/config';
import { startServer } from './web/server.js';
import { setBaseRate } from './scoring/index.js';
import { getCurrentMortgageRate } from './enrichment/mortgage-rate.js';

// Seed the scoring module with the cached FRED rate (no network call if cache is fresh).
getCurrentMortgageRate().then(setBaseRate);

startServer(3000).catch(err => {
  console.error('[server] fatal:', err);
  process.exit(1);
});
