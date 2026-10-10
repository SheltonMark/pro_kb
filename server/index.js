import { resolve } from 'node:path';
import { chmodSync } from 'node:fs';
import { createStore } from './store.js';
import { createApp } from './http.js';

const host = process.env.HOST || '127.0.0.1';
const port = Number(process.env.PORT || 4173);
if (!Number.isInteger(port) || port < 1 || port > 65535)
  throw new Error('PORT must be an integer between 1 and 65535.');
const password = process.env.SITE_PASSWORD || '';
const cookieSecure = ['1', 'true'].includes((process.env.COOKIE_SECURE || '').toLowerCase());
const dataDir = resolve(process.env.DATA_DIR || 'data');
const filename = resolve(dataDir, 'workspace.sqlite');
const store = createStore({ filename, seed: true });
if (process.platform !== 'win32') chmodSync(filename, 0o600);
const server = createApp({ store, password, cookieSecure });
let stopping = false;
function stop() {
  if (stopping) return;
  stopping = true;
  server.close(() => {
    store.close();
    process.exitCode = 0;
  });
  server.closeIdleConnections();
}
server.on('error', (error) => {
  console.error(error.message);
  store.close();
  process.exitCode = 1;
});
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
server.listen(port, host, () => {
  console.log(`Pro KB is listening on http://${host}:${port}`);
  console.log(`Data directory: ${dataDir}`);
  console.log(`Password protection: ${password ? 'enabled' : 'disabled (public workspace)'}`);
});
