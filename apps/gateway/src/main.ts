import { resolve, join } from 'node:path';
import { homedir } from 'node:os';
import { existsSync } from 'node:fs';
import staticFiles from '@fastify/static';
import { SqliteStore } from '@mypi/storage-sqlite';
import { createGateway } from './index.js';
import { WorkerClient } from './client.js';

const dataDir = resolve(process.env.MYPI_DATA_DIR ?? join(homedir(), '.mypi'));
const publicProfile = process.env.MYPI_PROFILE === 'public-demo';
const masterKey = process.env.MYPI_MASTER_KEY,
  cookieSecret = process.env.MYPI_COOKIE_SECRET,
  workerToken = process.env.MYPI_WORKER_TOKEN;
if (!masterKey || !cookieSecret || !workerToken)
  throw new Error(
    'Set MYPI_MASTER_KEY (32 base64 bytes), MYPI_COOKIE_SECRET and MYPI_WORKER_TOKEN (32+ characters) before starting Gateway',
  );
const host = process.env.MYPI_HOST ?? '127.0.0.1',
  port = Number(process.env.MYPI_PORT ?? 3000);
if (!publicProfile && !['127.0.0.1', 'localhost', '::1'].includes(host))
  throw new Error('Local profile can only listen on loopback');
const endpoint =
  process.env.MYPI_WORKER_SOCKET ?? process.env.MYPI_WORKER_URL ?? 'http://127.0.0.1:4101';
const store = new SqliteStore(join(dataDir, 'mypi.sqlite'));
const app = await createGateway({
  store,
  services: new WorkerClient(endpoint, workerToken),
  origin: process.env.MYPI_ORIGIN ?? `http://localhost:${port}`,
  masterKey,
  cookieSecret,
  secureCookies: publicProfile,
  publicProfile,
  importsEnabled: process.env.MYPI_ENABLE_IMPORTS === 'true',
  logger: true,
});
const webRoot = resolve(process.env.MYPI_WEB_ROOT ?? 'dist/web');
if (existsSync(webRoot)) {
  await app.register(staticFiles, { root: webRoot, prefix: '/' });
  app.setNotFoundHandler((request, reply) =>
    request.url.startsWith('/api/')
      ? reply.code(404).send({
          code: 'RESOURCE_NOT_FOUND',
          message: 'Route not found',
          requestId: request.id,
          retryable: false,
        })
      : reply.sendFile('index.html'),
  );
}
let stopping = false;
async function shutdown() {
  if (stopping) return;
  stopping = true;
  await app.close();
  store.close();
  process.disconnect?.();
}
process.on('message', (message) => {
  if (message === 'mypi:shutdown') void shutdown();
});
process.on('SIGINT', () => void shutdown());
process.on('SIGTERM', () => void shutdown());
await app.listen({ host, port });
