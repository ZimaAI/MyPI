import { join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { chmod, mkdir, open, unlink } from 'node:fs/promises';
import { SqliteStore } from '../../../packages/storage-sqlite/src/index.ts';
import { PiRuntimeFactory } from '../../../packages/pi-adapter/src/index.ts';
import { BrokerSandboxClient } from '../../../packages/sandbox-client/src/client.ts';
import { createWorkerServices } from './service.ts';
import { createWorkerServer } from './server.ts';
import { localDockerEnabled } from '../../../packages/sandbox-client/src/deployment.ts';
const localDocker = localDockerEnabled(process.env);
const stateDir = resolve(process.env.MYPI_DATA_DIR ?? join(homedir(), '.mypi'));
await mkdir(stateDir, { recursive: true, mode: 0o700 });
const lockPath = join(stateDir, 'worker.lock');
try {
  const lock = await open(lockPath, 'wx', 0o600);
  await lock.writeFile(String(process.pid));
  await lock.close();
} catch {
  throw new Error(
    'A Worker lock exists. Stop the other worker, or verify the recorded PID is no longer running before removing worker.lock. Multiple workers are unsupported.',
  );
}
let shutdownStarted = false;
const store = new SqliteStore(join(stateDir, 'mypi.sqlite'));
try {
  const sandbox = new BrokerSandboxClient({
    baseUrl: process.env.MYPI_BROKER_URL ?? 'http://127.0.0.1:4102',
    socketPath: process.env.MYPI_BROKER_SOCKET,
    token: process.env.MYPI_BROKER_TOKEN ?? '',
  });
  const runtimeStateDir = join(stateDir, 'private');
  const worker = createWorkerServices({
    profile: localDocker ? 'local-docker' : 'public-demo',
    store,
    runtime: new PiRuntimeFactory({ stateDir: runtimeStateDir }),
    runtimeStateDir,
    sandbox,
    importsEnabled: process.env.MYPI_ENABLE_IMPORTS === 'true',
    masterKey: process.env.MYPI_MASTER_KEY ?? '',
  });
  const server = createWorkerServer(worker, process.env.MYPI_WORKER_TOKEN ?? '');
  worker.core.recover();
  const cleanup = async () => {
    const result = await worker.maintenance.sweepExpired();
    if (result.deletedConversations || result.expiredPrincipals || result.failures)
      console.log(JSON.stringify({ service: 'worker', maintenance: result }));
  };
  await cleanup();
  const maintenanceTimer = setInterval(() => {
    void cleanup().catch(() => console.error('Worker retention cleanup failed; will retry'));
  }, 60000);
  maintenanceTimer.unref();
  const socket = process.env.MYPI_WORKER_SOCKET;
  if (socket) {
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(socket, resolve);
    });
    await chmod(socket, 0o600);
  } else
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(Number(process.env.MYPI_WORKER_PORT ?? 4101), '127.0.0.1', resolve);
    });
  console.log(
    `MyPI Worker listening on ${socket ?? '127.0.0.1:' + (process.env.MYPI_WORKER_PORT ?? 4101)}`,
  );
  const shutdown = async () => {
    if (shutdownStarted) return;
    shutdownStarted = true;
    clearInterval(maintenanceTimer);
    await worker.shutdownImports();
    await worker.maintenance.sweepExpired();
    await worker.core.revoke();
    server.close();
    store.close();
    await unlink(lockPath).catch(() => {});
    process.exit(0);
  };
  process.on('message', (message) => {
    if (message === 'mypi:shutdown') void shutdown();
  });
  process.once('SIGTERM', () => void shutdown());
  process.once('SIGINT', () => void shutdown());
} catch (error) {
  store.close();
  await unlink(lockPath).catch(() => {});
  throw error;
}
