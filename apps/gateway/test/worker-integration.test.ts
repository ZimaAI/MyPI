import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createGateway } from '../src/index.js';
import { WorkerClient } from '../src/client.js';
import { createWorkerServices } from '../../worker/src/service.js';
import { createWorkerServer } from '../../worker/src/server.js';
import { SqliteStore } from '@mypi/storage-sqlite';
import { SecretBox } from '../../../packages/storage-sqlite/src/security.js';
import { TrustedLocalSandbox } from '../../../packages/sandbox-client/src/local.js';
import { defaultPolicy, unknownUsage, type RuntimeFactory } from '@mypi/contracts';

test('Gateway -> authenticated Worker RPC -> Core -> SQLite completes and restores a real tool run', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'mypi-http-')),
    db = join(dir, 'mypi.sqlite'),
    store = new SqliteStore(db),
    workerStore = new SqliteStore(db);
  const masterKey = Buffer.alloc(32, 5).toString('base64'),
    token = 'worker-integration-token-with-32-characters',
    origin = 'http://localhost:3000';
  const toolsSeen: string[][] = [];
  const runtime: RuntimeFactory = {
    async create(input) {
      return {
        async prompt(_text, signal) {
          const reservation = await input.beforeModelCall(100);
          toolsSeen.push(input.tools.map((t) => t.name));
          const tool = input.tools.find((t) => t.name === 'mypi_search_files');
          if (tool) {
            const output = await tool.execute({ pattern: '*' }, signal);
            assert.equal(output.ok, true);
          }
          const usage = {
            ...unknownUsage(),
            inputTokens: 5,
            outputTokens: 3,
            status: 'known' as const,
          };
          await input.afterModelCall(reservation, usage);
          input.onEvent({ type: 'delta', text: 'Integration complete' });
          return { text: 'Integration complete', usage };
        },
        async close() {},
      };
    },
  };
  const sandbox = new TrustedLocalSandbox({
    root: join(dir, 'workspaces'),
    stateRoot: join(dir, 'sandbox-state'),
    managedWorkspaces: true,
    explicitlyTrusted: true,
  });
  const worker = createWorkerServices({
    store: workerStore,
    runtime,
    sandbox,
    masterKey,
    profile: 'trusted-local',
  });
  const server = createWorkerServer(worker, token);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as { port: number },
    client = new WorkerClient(`http://127.0.0.1:${address.port}`, token);
  const gateway = await createGateway({
    store,
    services: client,
    origin,
    masterKey,
    cookieSecret: 'integration-cookie-secret-with-at-least-32-characters',
  });
  try {
    store.put('policy', 'current', { ...defaultPolicy, publicExecution: true });
    store.put('model', 'test-model', {
      id: 'test-model',
      displayName: 'Fixture model',
      providerType: 'openai',
      modelId: 'fixture',
      approvedEndpointId: 'openai',
      encryptedKey: new SecretBox(masterKey).encrypt('fixture-key'),
      enabled: true,
      publicSelectable: true,
      defaultForGuests: true,
      maxOutputTokens: 100,
      contextWindow: 100000,
      configVersion: 1,
    });
    const bootstrap = await gateway.inject({
        method: 'POST',
        url: '/api/v1/guest-sessions',
        headers: { origin },
        payload: {},
      }),
      identity = bootstrap.json();
    const cookie = bootstrap.cookies[0].name + '=' + bootstrap.cookies[0].value;
    const headers = {
      origin,
      cookie,
      'x-csrf-token': identity.csrfToken,
      'idempotency-key': crypto.randomUUID(),
    };
    const created = await gateway.inject({
      method: 'POST',
      url: '/api/v1/conversations',
      headers,
      payload: { title: 'Integration', mode: 'explicit' },
    });
    assert.equal(created.statusCode, 201, created.body);
    const id = created.json().id;
    const workspace = await gateway.inject({
      url: `/api/v1/conversations/${id}/workspace`,
      headers: { cookie },
    });
    assert.equal(workspace.statusCode, 200, workspace.body);
    assert.deepEqual(workspace.json().files, []);
    const replay = await gateway.inject({
      method: 'POST',
      url: '/api/v1/conversations',
      headers,
      payload: { title: 'Integration', mode: 'explicit' },
    });
    assert.equal(replay.statusCode, 201, replay.body);
    assert.equal(replay.json().id, id);
    const accepted = await gateway.inject({
      method: 'POST',
      url: `/api/v1/conversations/${id}/runs`,
      headers: { ...headers, 'idempotency-key': crypto.randomUUID() },
      payload: { text: '使用搜索工具查找文件', mode: 'explicit' },
    });
    assert.equal(accepted.statusCode, 202, accepted.body);
    await worker.core.wait(accepted.json().runId);
    const run = await gateway.inject({
      url: `/api/v1/runs/${accepted.json().runId}`,
      headers: { cookie },
    });
    assert.equal(run.json().status, 'succeeded', run.body);
    assert.ok(!run.body.includes('fixture-key'));
    const snapshot = await gateway.inject({
      url: `/api/v1/conversations/${id}`,
      headers: { cookie },
    });
    assert.equal(snapshot.json().messages.at(-1).text, 'Integration complete');
    assert.ok(snapshot.json().lastSequence > 0);
    assert.equal(toolsSeen[0].length, 9);
    assert.equal(store.quota('principal', identity.principalId)?.tokensUsed, 8);
    assert.equal(
      (await gateway.inject({ url: `/api/v1/conversations/${id}/workspace`, headers: { cookie } }))
        .statusCode,
      200,
    );
    const rule = await client.ruleTest({ text: '不要使用搜索工具', mode: 'explicit' });
    assert.deepEqual(rule.groups, []);
    const denied = new WorkerClient(
      `http://127.0.0.1:${address.port}`,
      'incorrect-worker-token-with-at-least-32',
    );
    await assert.rejects(denied.ready());
    const deletion = await gateway.inject({
      method: 'DELETE',
      url: `/api/v1/conversations/${id}`,
      headers,
    });
    assert.equal(deletion.statusCode, 202, deletion.body);
    assert.equal(
      (await gateway.inject({ url: `/api/v1/conversations/${id}`, headers: { cookie } }))
        .statusCode,
      404,
    );
  } finally {
    await gateway.close();
    await worker.core.revoke();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    store.close();
    workerStore.close();
    await rm(dir, { recursive: true, force: true });
  }
});
