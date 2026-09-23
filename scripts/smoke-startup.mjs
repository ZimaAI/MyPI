import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, access, rm } from 'node:fs/promises';
import { createServer, connect } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as pause } from 'node:timers/promises';

const repository = resolve(fileURLToPath(new URL('..', import.meta.url)));
const temporary = await mkdtemp(join(tmpdir(), 'mypi-startup-smoke-'));
assert(
  temporary.startsWith(resolve(tmpdir()) + sep),
  'Temporary data must remain inside the system temporary directory',
);
const holders = await Promise.all(
  Array.from({ length: 3 }, async () => {
    const server = createServer();
    await new Promise((accept, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', accept);
    });
    return server;
  }),
);
const ports = holders.map((server) => server.address().port);
await Promise.all(holders.map((server) => new Promise((accept) => server.close(accept))));
const [gatewayPort, workerPort, brokerPort] = ports;
const origin = `http://127.0.0.1:${gatewayPort}`;
const env = {
  ...process.env,
  MYPI_PROFILE: 'local',
  MYPI_HOST: '127.0.0.1',
  MYPI_PORT: String(gatewayPort),
  MYPI_ORIGIN: origin,
  MYPI_DATA_DIR: join(temporary, 'server'),
  MYPI_BROKER_STATE: join(temporary, 'broker'),
  MYPI_WORKER_URL: `http://127.0.0.1:${workerPort}`,
  MYPI_WORKER_PORT: String(workerPort),
  MYPI_BROKER_URL: `http://127.0.0.1:${brokerPort}`,
  MYPI_BROKER_PORT: String(brokerPort),
  MYPI_MASTER_KEY: randomBytes(32).toString('base64'),
  MYPI_COOKIE_SECRET: randomBytes(32).toString('base64url'),
  MYPI_WORKER_TOKEN: randomBytes(32).toString('base64url'),
  MYPI_BROKER_TOKEN: randomBytes(32).toString('base64url'),
  PUBLIC_EXECUTION_ENABLED: 'false',
  MYPI_ENABLE_IMPORTS: 'false',
  MYPI_SANDBOX_RUNTIME: 'runsc',
  MYPI_SANDBOX_IMAGE: '',
};
for (const key of [
  'MYPI_WORKER_SOCKET',
  'MYPI_BROKER_SOCKET',
  'MYPI_API_KEY',
  'MYPI_MODEL',
  'MYPI_PROVIDER',
  'MYPI_BASE_URL',
])
  delete env[key];
const launcher = spawn(process.execPath, ['scripts/dev.mjs'], {
  cwd: repository,
  env,
  windowsHide: true,
  stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
});
let logs = '',
  exit;
launcher.stdout.on('data', (chunk) => {
  logs = (logs + chunk).slice(-16000);
});
launcher.stderr.on('data', (chunk) => {
  logs = (logs + chunk).slice(-16000);
});
launcher.once('error', (error) => {
  logs += `\n${error.message}`;
});
const stopped = new Promise((accept) =>
  launcher.once('exit', (code, signal) => {
    exit = { code, signal };
    accept(exit);
  }),
);
const listening = (port) =>
  new Promise((accept) => {
    const socket = connect({ host: '127.0.0.1', port });
    socket.setTimeout(500);
    socket.once('connect', () => {
      socket.destroy();
      accept(true);
    });
    socket.once('error', () => {
      socket.destroy();
      accept(false);
    });
    socket.once('timeout', () => {
      socket.destroy();
      accept(false);
    });
  });
let failure;
try {
  const deadline = Date.now() + 60000;
  while (true) {
    if (exit) throw new Error(`Launcher exited during startup: ${JSON.stringify(exit)}`);
    if (await Promise.all(ports.map(listening)).then((values) => values.every(Boolean))) {
      const response = await fetch(`${origin}/health/live`).catch(() => null);
      if (response?.ok) {
        assert.deepEqual(await response.json(), { status: 'ok' });
        break;
      }
    }
    if (Date.now() > deadline) throw new Error('Services did not become live within 60 seconds');
    await pause(250);
  }
  const readiness = await fetch(`${origin}/health/ready`);
  assert.equal(readiness.status, 503);
  const guestResponse = await fetch(`${origin}/api/v1/guest-sessions`, {
    method: 'POST',
    headers: { origin, 'content-type': 'application/json' },
    body: '{}',
  });
  assert.equal(guestResponse.status, 201);
  const guest = await guestResponse.json(),
    cookie = guestResponse.headers
      .getSetCookie()
      .map((value) => value.split(';')[0])
      .join('; ');
  assert(guest.principalId && guest.csrfToken && cookie);
  const headers = {
    origin,
    cookie,
    'content-type': 'application/json',
    'x-csrf-token': guest.csrfToken,
  };
  const conversationResponse = await fetch(`${origin}/api/v1/conversations`, {
    method: 'POST',
    headers: { ...headers, 'idempotency-key': randomUUID() },
    body: JSON.stringify({
      title: 'Launcher smoke',
      mode: 'explicit',
      templateId: 'javascript-starter',
    }),
  });
  assert.equal(conversationResponse.status, 201, await conversationResponse.clone().text());
  const conversation = await conversationResponse.json();
  assert(conversation.id);
  const workspaceResponse = await fetch(
    `${origin}/api/v1/conversations/${conversation.id}/workspace`,
    { headers },
  );
  assert.equal(workspaceResponse.status, 200);
  const workspace = await workspaceResponse.json();
  assert(workspace.revision && workspace.files.length > 0);
  const filePath =
    workspace.files.find((item) => item.path.endsWith('.js'))?.path ?? workspace.files[0].path;
  const fileResponse = await fetch(
    `${origin}/api/v1/conversations/${conversation.id}/file?path=${encodeURIComponent(filePath)}`,
    { headers },
  );
  assert.equal(fileResponse.status, 200);
  const file = await fileResponse.json();
  assert.equal(typeof file.content, 'string');
  assert(file.content.length > 0);
  const runResponse = await fetch(`${origin}/api/v1/conversations/${conversation.id}/runs`, {
    method: 'POST',
    headers: { ...headers, 'idempotency-key': randomUUID() },
    body: JSON.stringify({ text: 'Explain this project', mode: 'explicit' }),
  });
  assert.equal(runResponse.status, 503);
  const run = await runResponse.json();
  assert.equal(run.code, 'SERVICE_PAUSED');
  await access(join(temporary, 'server', 'worker.lock'));
  console.log(
    JSON.stringify({
      checks: 'production launcher / real RPC / isolated broker metadata',
      ports,
      live: 200,
      readiness: 503,
      guest: 201,
      conversation: 201,
      workspace: 200,
      file: 200,
      templateFiles: workspace.files.length,
      run: { status: 503, code: run.code },
      publicExecutionEnabled: false,
    }),
  );
} catch (error) {
  failure = error;
} finally {
  if (launcher.connected) launcher.send('mypi:shutdown');
  const result = await Promise.race([stopped, pause(40000, null, { ref: false })]);
  if (!result) {
    launcher.kill('SIGKILL');
    failure ??= new Error('Launcher IPC shutdown exceeded 40 seconds');
  }
  const stillListening = [];
  for (const port of ports) if (await listening(port)) stillListening.push(port);
  const lockExists = await access(join(temporary, 'server', 'worker.lock')).then(
    () => true,
    () => false,
  );
  if (result?.code !== 0 || stillListening.length || lockExists)
    failure ??= new Error(
      `Shutdown failed: ${JSON.stringify({ result, stillListening, lockExists })}`,
    );
  console.log(
    JSON.stringify({
      shutdown: result,
      workerLockRemoved: !lockExists,
      allPortsClosed: !stillListening.length,
    }),
  );
  if (!stillListening.length) await rm(temporary, { recursive: true, force: true });
  if (failure) {
    console.error(logs);
    throw failure;
  }
}
