import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { SqliteStore } from '../packages/storage-sqlite/src/index.ts';
import { SecretBox } from '../packages/storage-sqlite/src/security.ts';
import { TrustedLocalSandbox } from '../packages/sandbox-client/src/local.ts';
import { PiRuntimeFactory } from '../packages/pi-adapter/src/index.ts';
import { defaultPolicy } from '../packages/contracts/src/index.ts';
import { createWorkerServices } from '../apps/worker/src/service.ts';
import { createWorkerServer } from '../apps/worker/src/server.ts';
import { createGateway } from '../apps/gateway/src/index.ts';

test('real Pi SDK -> core -> SQLite -> Gateway: guest, model loop, files, replay, quotas, ownership', async () => {
  const root = await mkdtemp(join(tmpdir(), 'mypi-integration-'));
  const requests: any[] = [];
  const provider = createServer(async (req, res) => {
    let data = '';
    for await (const chunk of req) data += chunk;
    const body = JSON.parse(data);
    requests.push(body);
    const text = body.messages.filter((m: any) => m.role === 'user').at(-1)?.content ?? '';
    const toolResult = body.messages.at(-1)?.role === 'tool';
    const search = JSON.stringify(text).includes('使用搜索工具') && !toolResult;
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    const write = (choices: unknown[], usage?: unknown) =>
      res.write(
        `data: ${JSON.stringify({ id: 'fixture', object: 'chat.completion.chunk', model: 'fixture-model', created: 1, choices, usage })}\n\n`,
      );
    write([
      {
        index: 0,
        delta: search
          ? {
              role: 'assistant',
              tool_calls: [
                {
                  index: 0,
                  id: 'search1',
                  type: 'function',
                  function: {
                    name: 'mypi_search_files',
                    arguments: '{"pattern":"*","maxResults":20}',
                  },
                },
              ],
            }
          : { role: 'assistant', content: '实际 SDK 测试响应' },
        finish_reason: null,
      },
    ]);
    write([{ index: 0, delta: {}, finish_reason: search ? 'tool_calls' : 'stop' }]);
    write([], { prompt_tokens: 100, completion_tokens: 10, total_tokens: 110 });
    res.end('data: [DONE]\n\n');
  });
  await new Promise<void>((resolve) => provider.listen(0, '127.0.0.1', resolve));
  const masterKey = randomBytes(32).toString('base64'),
    store = new SqliteStore(join(root, 'db.sqlite'));
  store.put('policy', 'current', { ...defaultPolicy, publicExecution: true, dailyTokens: 500000 });
  store.put('model', 'fixture', {
    id: 'fixture',
    displayName: 'Loopback test fixture',
    providerType: 'openai',
    modelId: 'fixture-model',
    approvedEndpointId: 'openai',
    enabled: true,
    publicSelectable: true,
    defaultForGuests: true,
    encryptedKey: new SecretBox(masterKey).encrypt('fixture-only'),
    maxOutputTokens: 64,
    contextWindow: 32000,
    configVersion: 1,
  });
  const sandbox = new TrustedLocalSandbox({
    root,
    stateRoot: join(root, 'sandbox'),
    managedWorkspaces: true,
    explicitlyTrusted: true,
  });
  const worker = createWorkerServices({
    store,
    runtime: new PiRuntimeFactory({ stateDir: join(root, 'private') }),
    sandbox,
    masterKey,
    profile: 'trusted-local',
    resolveModel: () => ({
      id: 'fixture',
      displayName: 'Loopback fixture',
      providerType: 'openai-compatible',
      modelId: 'fixture-model',
      baseUrl: `http://127.0.0.1:${(provider.address() as { port: number }).port}/v1`,
      apiKey: 'fixture-only',
      maxOutputTokens: 64,
      contextWindow: 32000,
      configVersion: 1,
    }),
  });
  const origin = 'http://localhost:3000';
  const app = await createGateway({
    store,
    services: worker.services,
    origin,
    masterKey,
    cookieSecret: 'c'.repeat(32),
  });
  const request = async (
    method: 'GET' | 'POST' | 'PATCH',
    url: string,
    payload?: unknown,
    cookie?: string,
    csrf?: string,
    key = randomUUID(),
  ) =>
    app.inject({
      method,
      url,
      headers: {
        origin,
        ...(cookie ? { cookie } : {}),
        ...(csrf ? { 'x-csrf-token': csrf } : {}),
        'idempotency-key': key,
      },
      ...(payload !== undefined ? { payload: payload as any } : {}),
    });
  try {
    const guest = await request('POST', '/api/v1/guest-sessions', {});
    assert.equal(guest.statusCode, 201);
    const cookie = guest.cookies[0].name + '=' + guest.cookies[0].value,
      csrf = guest.json().csrfToken,
      ownerId = guest.json().principalId;
    const conv = await request(
      'POST',
      '/api/v1/conversations',
      { mode: 'explicit', templateId: 'javascript-starter' },
      cookie,
      csrf,
    );
    assert.equal(conv.statusCode, 201, conv.body);
    const id = conv.json().id;
    for (const text of ['普通问题', '使用搜索工具查找入口', '普通后续问题']) {
      const accepted = await request(
        'POST',
        `/api/v1/conversations/${id}/runs`,
        { text, mode: 'explicit' },
        cookie,
        csrf,
      );
      assert.equal(accepted.statusCode, 202, accepted.body);
      const runId = accepted.json().runId;
      await worker.core.wait(runId);
      const run = await request('GET', `/api/v1/runs/${runId}`, undefined, cookie);
      assert.equal(run.json().status, 'succeeded', run.body);
    }
    assert.deepEqual(
      requests.map((r) => r.tools.length),
      [4, 9, 9, 4],
    );
    const snapshot = await request('GET', `/api/v1/conversations/${id}`, undefined, cookie);
    assert.equal(snapshot.json().messages.length, 6);
    assert.ok(snapshot.json().lastSequence > 10);
    assert.ok(!snapshot.body.includes('fixture-only'));
    const events = store.events(id);
    assert.ok(events.some((e) => e.type === 'tool.completed' && e.payload.ok));
    const cursor = events[Math.floor(events.length / 2)].sequence;
    assert.ok(store.events(id, cursor).every((e) => e.sequence > cursor));
    assert.equal(store.quota('principal', ownerId)?.rootsUsed, 3);
    assert.equal(store.quota('principal', ownerId)?.tokensUsed, 440);
    assert.equal(store.quota('principal', ownerId)?.tokensReserved, 0);
    const other = await request('POST', '/api/v1/guest-sessions', {});
    const foreign = other.cookies[0].name + '=' + other.cookies[0].value;
    assert.equal(
      (await request('GET', `/api/v1/conversations/${id}`, undefined, foreign)).statusCode,
      404,
    );
    assert.equal(
      (
        await request(
          'POST',
          `/api/v1/conversations/${id}/runs`,
          { text: 'role spoof', mode: 'explicit', role: 'system' },
          cookie,
          csrf,
        )
      ).statusCode,
      400,
    );
    const file = await request(
      'GET',
      `/api/v1/conversations/${id}/file?path=README.md`,
      undefined,
      cookie,
    );
    assert.equal(file.statusCode, 200, file.body);
    assert.ok(file.body.includes('MyPI'));
    await worker.core.close(ownerId, id);
  } finally {
    await app.close();
    await sandbox.shutdown();
    store.close();
    provider.closeAllConnections();
    await new Promise<void>((resolve) => provider.close(() => resolve()));
    await rm(root, { recursive: true, force: true });
  }
});
test('worker private RPC rejects unauthenticated and unknown methods', async () => {
  const root = await mkdtemp(join(tmpdir(), 'mypi-rpc-'));
  const store = new SqliteStore(':memory:');
  const sandbox = new TrustedLocalSandbox({ root, explicitlyTrusted: true });
  const worker = createWorkerServices({
    store,
    sandbox,
    runtime: new PiRuntimeFactory(),
    masterKey: randomBytes(32).toString('base64'),
  });
  const server = createWorkerServer(worker, 'w'.repeat(32));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${(server.address() as { port: number }).port}/rpc`;
  try {
    assert.equal((await fetch(url, { method: 'POST', body: '{}' })).status, 401);
    assert.equal(
      (
        await fetch(url, {
          method: 'POST',
          headers: { authorization: 'Bearer ' + 'w'.repeat(32) },
          body: JSON.stringify({ method: '__proto__', args: [] }),
        })
      ).status,
      400,
    );
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    store.close();
    await rm(root, { recursive: true, force: true });
  }
});
