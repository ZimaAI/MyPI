import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import * as fs from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { SqliteStore } from '../packages/storage-sqlite/src/index.ts';
import { TrustedLocalSandbox } from '../packages/sandbox-client/src/index.ts';
import { createWorkerServices } from '../apps/worker/src/service.ts';
import { createWorkerServer } from '../apps/worker/src/server.ts';
import { createGateway } from '../apps/gateway/src/index.ts';
import { WorkerClient } from '../apps/gateway/src/client.ts';
import { makeZip } from './helpers/zip.ts';

async function fixture(workerEnabled = false, gatewayEnabled = false) {
  const root = await fs.mkdtemp(join(tmpdir(), 'mypi-import-api-')),
    store = new SqliteStore(join(root, 'db.sqlite')),
    masterKey = randomBytes(32).toString('base64');
  const sandbox = new TrustedLocalSandbox({
    root,
    stateRoot: join(root, 'sandbox'),
    managedWorkspaces: true,
    explicitlyTrusted: true,
  });
  const worker = createWorkerServices({
    store,
    sandbox,
    importsEnabled: workerEnabled,
    masterKey,
    runtime: {
      create: async () => {
        throw new Error('Import must never execute a model or project');
      },
    },
  });
  const token = 'private-import-worker-token-'.repeat(2),
    server = createWorkerServer(worker, token);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const client = new WorkerClient(`http://127.0.0.1:${address.port}`, token),
    origin = 'http://localhost:3000';
  const app = await createGateway({
    store,
    services: client,
    origin,
    masterKey,
    cookieSecret: 'c'.repeat(32),
    importsEnabled: gatewayEnabled,
  });
  type Auth = { cookie: string; csrf: string; ownerId: string };
  const request = (
    method: 'GET' | 'POST' | 'DELETE',
    url: string,
    auth?: Auth,
    payload?: unknown,
    key = randomUUID(),
    csrf = true,
  ) =>
    app.inject({
      method,
      url,
      headers: {
        origin,
        'idempotency-key': key,
        ...(auth ? { cookie: auth.cookie, ...(csrf ? { 'x-csrf-token': auth.csrf } : {}) } : {}),
      },
      ...(payload === undefined ? {} : { payload: payload as any }),
    });
  const guest = async (): Promise<Auth> => {
    const response = await request('POST', '/api/v1/guest-sessions', undefined, {});
    assert.equal(response.statusCode, 201);
    return {
      cookie: `${response.cookies[0]!.name}=${response.cookies[0]!.value}`,
      csrf: response.json().csrfToken,
      ownerId: response.json().principalId,
    };
  };
  const conversation = async (auth: Auth) => {
    const response = await request('POST', '/api/v1/conversations', auth, {
      mode: 'explicit',
      templateId: 'javascript-starter',
    });
    assert.equal(response.statusCode, 201, response.body);
    const id = response.json().id as string,
      workspace = await request('GET', `/api/v1/conversations/${id}/workspace`, auth);
    assert.equal(workspace.statusCode, 200, workspace.body);
    return { id, revision: workspace.json().revision as string };
  };
  const close = async () => {
    await worker.shutdownImports();
    await app.close();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await sandbox.shutdown();
    store.close();
    const absolute = resolve(root);
    assert.ok(
      absolute.startsWith(resolve(tmpdir()) + sep) &&
        absolute.split(sep).at(-1)!.startsWith('mypi-import-api-'),
    );
    await fs.rm(absolute, { recursive: true, force: true });
  };
  return { root, store, sandbox, worker, client, request, guest, conversation, close };
}

test('Gateway and private Worker independently require the import deployment switch', async () => {
  for (const [workerEnabled, gatewayEnabled] of [
    [true, false],
    [false, true],
  ]) {
    const f = await fixture(workerEnabled, gatewayEnabled);
    try {
      const auth = await f.guest(),
        conversation = await f.conversation(auth),
        archiveBase64 = makeZip([{ name: 'a.txt', content: 'data' }]).toString('base64');
      const response = await f.request(
        'POST',
        `/api/v1/conversations/${conversation.id}/import`,
        auth,
        { kind: 'zip', archiveBase64, expectedRevision: conversation.revision },
      );
      assert.equal(response.statusCode, 503, response.body);
      assert.equal(response.json().code, 'FEATURE_DISABLED');
      assert.equal(
        (
          await f.request(
            'GET',
            `/api/v1/conversations/${conversation.id}/file?path=README.md`,
            auth,
          )
        ).statusCode,
        200,
      );
    } finally {
      await f.close();
    }
  }
});

test('Gateway -> private Worker -> managed workspace imports ZIP with CSRF, ownership, conflicts and deletion', async () => {
  const f = await fixture(true, true);
  try {
    const auth = await f.guest(),
      other = await f.guest(),
      conversation = await f.conversation(auth),
      url = `/api/v1/conversations/${conversation.id}/import`;
    const archiveBase64 = makeZip([
      { name: 'src/index.ts', content: 'export const imported = true;' },
      { name: '.pi/settings.json', content: '{}' },
      { name: 'asset.bin', content: Buffer.from([0, 255]) },
    ]).toString('base64');
    const input = { kind: 'zip', archiveBase64, expectedRevision: conversation.revision },
      key = randomUUID();
    assert.equal((await f.request('POST', url, auth, input, randomUUID(), false)).statusCode, 403);
    assert.equal((await f.request('POST', url, other, input)).statusCode, 404);
    const imported = await f.request('POST', url, auth, input, key);
    assert.equal(imported.statusCode, 201, imported.body);
    assert.equal(imported.json().fileCount, 2);
    assert.deepEqual(imported.json().omittedPaths, ['.pi/settings.json']);
    assert.notEqual(imported.json().revision, conversation.revision);
    const replay = await f.request('POST', url, auth, input, key);
    assert.equal(replay.statusCode, 201, replay.body);
    assert.deepEqual(replay.json(), imported.json());
    const stale = await f.request('POST', url, auth, input);
    assert.equal(stale.statusCode, 409, stale.body);
    const unsafe = await f.request('POST', url, auth, {
      kind: 'zip',
      archiveBase64: makeZip([{ name: '../escape', content: 'unsafe' }]).toString('base64'),
      expectedRevision: imported.json().revision,
    });
    assert.equal(unsafe.statusCode, 400, unsafe.body);
    const file = await f.request(
      'GET',
      `/api/v1/conversations/${conversation.id}/file?path=src/index.ts`,
      auth,
    );
    assert.equal(file.statusCode, 200, file.body);
    assert.equal(file.json().content, 'export const imported = true;');
    const binary = await f.request(
      'GET',
      `/api/v1/conversations/${conversation.id}/file?path=asset.bin`,
      auth,
    );
    assert.equal(binary.json().binary, true);
    assert.equal(binary.json().content, '');
    assert.equal(
      (
        await f.request('POST', `/api/v1/conversations/${conversation.id}/artifacts`, auth, {
          path: 'asset.bin',
        })
      ).statusCode,
      415,
    );
    assert.equal(
      (
        await f.request('POST', `/api/v1/conversations/${conversation.id}/artifacts`, auth, {
          path: 'src/index.ts',
        })
      ).statusCode,
      201,
    );
    assert.ok(
      f.store.list('project-import', { ownerId: auth.ownerId, conversationId: conversation.id })
        .length > 0,
    );
    const workspaceId = f.store.get<any>('conversation', conversation.id)!.data.workspaceId;
    const deleted = await f.request('DELETE', `/api/v1/conversations/${conversation.id}`, auth);
    assert.equal(deleted.statusCode, 202, deleted.body);
    assert.equal(deleted.json().resourcesCleanupPending, false);
    for (const kind of ['project-import', 'artifact', 'message', 'run'])
      assert.equal(
        f.store.list(kind, { ownerId: auth.ownerId, conversationId: conversation.id }).length,
        0,
        kind,
      );
    await assert.rejects(
      f.sandbox.workspaceFiles({
        principalId: auth.ownerId,
        conversationId: conversation.id,
        workspaceId,
      }),
      { code: 'NOT_FOUND' },
    );
    assert.equal(
      (await f.request('GET', `/api/v1/conversations/${conversation.id}/workspace`, auth))
        .statusCode,
      404,
    );
  } finally {
    await f.close();
  }
});
