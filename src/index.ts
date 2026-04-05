import 'dotenv/config';
import { startServer } from './web/server.js';

startServer(3000).catch(err => {
  console.error('[server] fatal:', err);
  process.exit(1);
});
