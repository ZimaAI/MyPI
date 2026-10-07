import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import * as fs from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { SqliteStore } from '../packages/storage-sqlite/src/index.ts';
import { TrustedLocalSandbox } from '../packages/sandbox-client/src/local.ts';
import { purgeRuntimeSessions } from '../packages/pi-adapter/src/index.ts';
import {
  createMaintenance,
  authorizePrincipal,
  GUEST_RETENTION_MS,
} from '../apps/worker/src/maintenance.ts';
import { createWorkerServices } from '../apps/worker/src/service.ts';
import { backupDatabase } from '../scripts/backup.ts';
import {
  unknownUsage,
  type Conversation,
  type RuntimeFactory,
} from '../packages/contracts/src/index.ts';

async function temporary() {
  return fs.mkdtemp(join(tmpdir(), 'mypi-maintenance-'));
}
async function cleanup(root: string) {
  const absolute = resolve(root);
  assert.ok(absolute.startsWith(resolve(tmpdir()) + sep));
  assert.match(absolute.split(sep).at(-1)!, /^mypi-maintenance-/);
  await fs.rm(absolute, { recursive: true, force: true });
}
function principal(store: SqliteStore, id: string) {
  store.put('principal', id, {
    id,
    kind: 'guest',
    status: 'active',
    displayId: '访客',
    lastSeenAt: new Date().toISOString(),
  });
}

test('expired guest cleanup removes bodies, events, inbox, patches, artifacts and selected SDK files while retaining minimal metering', async () => {
  const root = await temporary(),
    store = new SqliteStore(join(root, 'data.sqlite'));
  const sandbox = new TrustedLocalSandbox({
    root,
    stateRoot: join(root, 'broker'),
    managedWorkspaces: true,
    explicitlyTrusted: true,
  });
  const ownerId = 'expired-owner',
    id = 'expired-conversation';
  try {
    principal(store, ownerId);
    principal(store, 'other-owner');
    const workspace = await sandbox.createWorkspace({ principalId: ownerId, conversationId: id });
    const conversation: Conversation = {
      id,
      ownerId,
      workspaceId: workspace.workspaceId,
      title: 'sensitive title',
      mode: 'explicit',
      status: 'active',
      version: 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    store.put('conversation', id, conversation, { ownerId });
    store.put(
      'auth',
      'auth',
      {
        principalId: ownerId,
        tokenHash: 'secret hash',
        expiresAt: new Date(Date.now() + 1000).toISOString(),
      },
      { ownerId },
    );
    for (const kind of [
      'run',
      'task',
      'message',
      'workflow',
      'result',
      'inbox',
      'patch',
      'artifact',
      'workItem',
      'goal',
      'process',
    ])
      store.put(
        kind,
        `${kind}-one`,
        {
          id: `${kind}-one`,
          ownerId,
          conversationId: id,
          text: 'secret-body',
          prompt: 'secret-body',
        },
        { ownerId, conversationId: id },
      );
    store.put('summary', 'run-one', { status: 'delivered', text: 'secret-body' });
    store.put('idempotency', 'request-run', { runId: 'run-one', hash: 'hash' });
    store.put(
      'conversation-request',
      'request-conversation',
      { conversationId: id, hash: 'hash' },
      { ownerId },
    );
    store.put(
      'modelCall',
      'call',
      {
        id: 'call',
        rootRunId: 'run-one',
        status: 'settled',
        prompt: 'secret-body',
        usage: {
          status: 'known',
          inputTokens: 10,
          outputTokens: 5,
          costMicros: 12,
          currency: 'USD',
          priceVersion: 'v1',
          providerDebug: 'secret-body',
        },
      },
      { ownerId, conversationId: id },
    );
    store.appendEvent(id, 'run-one', 'message.delta', { text: 'secret-body' });
    store.audit(null, 'run.accepted', 'run-one', { modelId: 'safe-model' });
    const runtimeRoot = join(root, 'private');
    const sessions = join(runtimeRoot, 'sdk-sessions');
    await fs.mkdir(sessions, { recursive: true });
    const name = (value: string) =>
      `2026-09-23_${createHash('sha256').update(value).digest('hex')}.jsonl`;
    for (const value of ['run-one', 'run-one:summary', 'task-one', 'other-session'])
      await fs.writeFile(join(sessions, name(value)), 'secret-body');
    store.db
      .prepare("UPDATE entity SET created_at=? WHERE kind='principal' AND id=?")
      .run(new Date(Date.now() - GUEST_RETENTION_MS - 1).toISOString(), ownerId);
    assert.throws(() => authorizePrincipal(store, ownerId), { code: 'AUTH_EXPIRED' });
    let closeCount = 0;
    const maintenance = createMaintenance({
      store,
      sandbox,
      closeConversation: async (owner, conversationId) => {
        assert.equal(owner, ownerId);
        assert.equal(conversationId, id);
        closeCount++;
      },
      purgeSdkSessions: (ids) => purgeRuntimeSessions(runtimeRoot, ids),
    });
    const result = await maintenance.sweepExpired();
    assert.deepEqual(result, { expiredPrincipals: 1, deletedConversations: 1, failures: 0 });
    assert.equal(closeCount, 1);
    assert.equal(store.get('principal', ownerId)?.data.status, 'deleted');
    assert.equal(store.get('principal', 'other-owner')?.data.status, 'active');
    assert.equal(store.get('conversation', id)?.data.title, '已删除');
    assert.equal(store.get('conversation', id)?.data.workspaceId, '');
    assert.equal(store.get('auth', 'auth'), undefined);
    assert.equal(store.get('summary', 'run-one'), undefined);
    assert.equal(store.get('idempotency', 'request-run'), undefined);
    assert.equal(store.get('conversation-request', 'request-conversation'), undefined);
    for (const kind of [
      'run',
      'task',
      'message',
      'workflow',
      'result',
      'inbox',
      'patch',
      'artifact',
      'workItem',
      'goal',
      'process',
    ])
      assert.equal(store.list(kind, { conversationId: id }).length, 0);
    assert.equal(store.events(id).length, 0);
    assert.equal(store.pendingOutbox().length, 0);
    assert.deepEqual(store.get('modelCall', 'call')?.data.usage, {
      status: 'known',
      inputTokens: 10,
      outputTokens: 5,
      costMicros: 12,
      currency: 'USD',
      priceVersion: 'v1',
    });
    assert.ok(!JSON.stringify(store.get('modelCall', 'call')).includes('secret-body'));
    assert.ok(store.audits().some((audit) => audit.action === 'conversation.content.deleted'));
    assert.ok(!JSON.stringify(store.audits()).includes('secret-body'));
    assert.deepEqual(await fs.readdir(sessions), [name('other-session')]);
    await assert.rejects(
      sandbox.workspaceFiles({
        principalId: ownerId,
        conversationId: id,
        workspaceId: workspace.workspaceId,
      }),
      { code: 'NOT_FOUND' },
    );
    assert.deepEqual(await maintenance.sweepExpired(), {
      expiredPrincipals: 0,
      deletedConversations: 0,
      failures: 0,
    });
  } finally {
    await sandbox.shutdown();
    store.close();
    await cleanup(root);
  }
});

test('failed cleanup remains inaccessible and retries without losing deletion references', async () => {
  const store = new SqliteStore(':memory:');
  let attempts = 0;
  let closed = 0;
  principal(store, 'owner');
  store.put(
    'conversation',
    'c',
    {
      id: 'c',
      ownerId: 'owner',
      workspaceId: 'w',
      status: 'active',
      mode: 'explicit',
      title: 'private',
      createdAt: new Date().toISOString(),
    },
    { ownerId: 'owner' },
  );
  store.put('message', 'm', { text: 'body' }, { ownerId: 'owner', conversationId: 'c' });
  const maintenance = createMaintenance({
    store,
    closeConversation: async () => {
      closed++;
    },
    sandbox: {
      deleteConversation: async () => {
        if (++attempts === 1) throw new Error('broker offline');
      },
    },
  });
  try {
    await assert.rejects(maintenance.deleteConversation('owner', 'c'), /broker offline/);
    assert.equal(store.get('conversation', 'c')?.data.status, 'deleting');
    assert.ok(store.get('message', 'm'));
    assert.equal((await maintenance.sweepExpired()).deletedConversations, 1);
    assert.equal(closed, 2);
    assert.equal(store.get('message', 'm'), undefined);
    await maintenance.deleteConversation('owner', 'c');
    assert.equal(closed, 2);
    await assert.rejects(maintenance.deleteConversation('other', 'c'), {
      code: 'RESOURCE_NOT_FOUND',
    });
  } finally {
    store.close();
  }
});

test('worker archive preserves files, export rejects truncation, deletion purges content and expired read is denied', async () => {
  const root = await temporary(),
    store = new SqliteStore(':memory:');
  principal(store, 'owner');
  const sandbox = new TrustedLocalSandbox({
    root,
    stateRoot: join(root, 'broker'),
    managedWorkspaces: true,
    explicitlyTrusted: true,
  });
  const runtime: RuntimeFactory = {
    create: async () => {
      throw new Error('test runtime creation failed');
    },
  };
  const worker = createWorkerServices({
    store,
    sandbox,
    runtime,
    masterKey: randomBytes(32).toString('base64'),
  });
  try {
    const conversation = await worker.services.createConversation(
      'owner',
      { mode: 'explicit', templateId: 'javascript-starter' },
      'request-key-123456',
    );
    await sandbox.execute({
      principalId: 'owner',
      conversationId: conversation.id,
      workspaceId: conversation.workspaceId,
      runId: 'r',
      operation: 'write',
      args: { path: 'large.txt', content: 'a'.repeat(17000) },
    });
    await assert.rejects(worker.services.exportFile('owner', conversation.id, 'large.txt'), {
      code: 'LIMIT_EXCEEDED',
    });
    assert.equal(store.list('artifact').length, 0);
    const artifact = await worker.services.exportFile('owner', conversation.id, 'README.md');
    assert.match((await worker.services.artifact('owner', artifact.artifactId)).content, /MyPI/);
    await worker.services.archiveConversation('owner', conversation.id);
    assert.equal(store.get('conversation', conversation.id)?.data.status, 'archived');
    assert.ok((await worker.services.workspace('owner', conversation.id)).files.length);
    await worker.services.deleteConversation('owner', conversation.id);
    assert.equal(store.list('artifact').length, 0);
    assert.equal(store.get('conversation', conversation.id)?.data.status, 'deleted');
    store.db
      .prepare("UPDATE entity SET created_at=? WHERE kind='principal' AND id='owner'")
      .run(new Date(Date.now() - GUEST_RETENTION_MS - 1).toISOString());
    await assert.rejects(worker.services.workspace('owner', conversation.id), {
      code: 'AUTH_EXPIRED',
    });
    await assert.rejects(
      worker.services.testModel({
        id: 'x',
        modelId: 'x',
        providerType: 'openai',
        displayName: 'x',
        maxOutputTokens: 32,
        contextWindow: 1024,
        configVersion: 1,
      }),
      /test runtime creation failed/,
    );
  } finally {
    await sandbox.shutdown();
    store.close();
    await cleanup(root);
  }
});

test('model connection tests budget reasoning and reject an empty answer while closing the session', async () => {
  const root = await temporary(),
    store = new SqliteStore(':memory:');
  const sandbox = new TrustedLocalSandbox({
    root,
    stateRoot: join(root, 'broker'),
    managedWorkspaces: true,
    explicitlyTrusted: true,
  });
  const budgets: number[] = [];
  let text = 'OK',
    closed = 0;
  const runtime: RuntimeFactory = {
    create: async (input) => {
      budgets.push(input.model.maxOutputTokens);
      return {
        prompt: async () => ({ text, usage: unknownUsage() }),
        close: async () => {
          closed++;
        },
      };
    },
  };
  const worker = createWorkerServices({
    store,
    sandbox,
    runtime,
    masterKey: randomBytes(32).toString('base64'),
  });
  const model = {
    id: 'test',
    modelId: 'fixture',
    providerType: 'openai',
    displayName: 'Fixture',
    maxOutputTokens: 8192,
    contextWindow: 32768,
    configVersion: 1,
    reasoning: true,
  };
  try {
    assert.equal((await worker.services.testModel(model)).ok, true);
    assert.equal((await worker.services.testModel({ ...model, reasoning: false })).ok, true);
    text = '';
    await assert.rejects(worker.services.testModel({ ...model, maxOutputTokens: 512 }), {
      code: 'MODEL_TEST_EMPTY',
    });
    assert.deepEqual(budgets, [2048, 32, 512]);
    assert.equal(closed, 3);
  } finally {
    await sandbox.shutdown();
    store.close();
    await cleanup(root);
  }
});

test('SQLite backup captures WAL records, validates restore and rejects overwrite', async () => {
  const root = await temporary(),
    source = join(root, 'live.sqlite'),
    destination = join(root, 'backup');
  const store = new SqliteStore(source);
  try {
    const content = 'artifact from WAL';
    store.put(
      'artifact',
      'a',
      { name: 'a.txt', content, sha256: createHash('sha256').update(content).digest('hex') },
      { ownerId: 'owner', conversationId: 'conversation' },
    );
    store.ensureQuota('principal', 'owner', { tokens: 100, roots: 20 });
    const result = await backupDatabase(source, destination);
    assert.ok(result.pages > 0);
    assert.equal(result.sha256.length, 64);
    const restored = new DatabaseSync(join(destination, 'mypi.sqlite'), { readOnly: true });
    try {
      assert.equal(
        JSON.parse(
          String(
            restored.prepare("SELECT data_json FROM entity WHERE kind='artifact'").get()!.data_json,
          ),
        ).content,
        content,
      );
      assert.equal(
        (restored.prepare('PRAGMA integrity_check').get() as { integrity_check: string })
          .integrity_check,
        'ok',
      );
    } finally {
      restored.close();
    }
    const manifest = JSON.parse(await fs.readFile(join(destination, 'manifest.json'), 'utf8'));
    assert.equal(manifest.artifacts[0].storage, 'inline-in-sqlite');
    assert.equal(manifest.artifacts[0].bytes, Buffer.byteLength(content));
    assert.equal(manifest.database.sha256, result.sha256);
    await assert.rejects(backupDatabase(source, destination), { code: 'EEXIST' });
  } finally {
    store.close();
    await cleanup(root);
  }
});
