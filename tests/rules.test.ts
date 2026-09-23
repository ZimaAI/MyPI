import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  defaultRuleConfig,
  matchIntent,
  readActiveRules,
  validateRuleConfig,
} from '../packages/policy/src/index.ts';
import { SqliteStore, createAdmin } from '../packages/storage-sqlite/src/index.ts';
import { AgentEntityStore } from '../packages/storage-sqlite/src/entity-store.ts';
import { RuleRepository, evaluateRuleConfig } from '../apps/gateway/src/rules.ts';
import { createGateway, type GatewayServices } from '../apps/gateway/src/index.ts';
import { AgentService } from '../packages/agent-core/src/index.ts';
import { TrustedLocalSandbox } from '../packages/sandbox-client/src/index.ts';
import { unknownUsage, type ModelConfig } from '../packages/contracts/src/index.ts';

test('restricted literal configuration preserves canonical golden cases and every safety gate', () => {
  const config = defaultRuleConfig();
  assert.equal(evaluateRuleConfig(config).total, 316);
  config.groups.search.phrases = ['使用代码索引'];
  config.groups.workflow.enabled = false;
  const result = evaluateRuleConfig(config);
  assert.equal(result.ok, true, JSON.stringify(result.failures));
  assert.equal(result.total, 326);
  const rules = { version: 'configured-test', config };
  assert.deepEqual(matchIntent('使用代码索引', 'explicit', 'human', rules).groups, ['search']);
  assert.deepEqual(matchIntent('使用工作流', 'explicit', 'human', rules).groups, []);
  const unicodePrefix = 'İİ 使用代码索引';
  const evidence = matchIntent(unicodePrefix, 'explicit', 'human', rules).evidence[0];
  assert.equal(evidence.text, '使用代码索引');
  assert.equal(unicodePrefix.slice(evidence.start, evidence.end), evidence.text);
  for (const text of [
    '不要使用代码索引',
    '如果需要，使用代码索引',
    '“使用代码索引”',
    '```使用代码索引```',
  ])
    assert.deepEqual(matchIntent(text, 'explicit', 'human', rules).groups, []);
  for (const phrase of [
    '.*',
    '使用.*工具',
    'console.log(1)',
    '搜索工具',
    '使用工具;删除文件',
    'use ',
  ])
    assert.throws(() =>
      validateRuleConfig({
        ...config,
        groups: { ...config.groups, search: { enabled: true, phrases: [phrase] } },
      }),
    );
  assert.throws(() => validateRuleConfig({ ...config, script: 'evil' }));
  assert.throws(() =>
    validateRuleConfig({
      ...config,
      groups: {
        ...config.groups,
        search: { enabled: true, phrases: Array(13).fill('使用代码索引') },
      },
    }),
  );
  const conflicting = defaultRuleConfig();
  conflicting.groups.delegate.phrases = ['使用搜索工具'];
  assert.equal(evaluateRuleConfig(conflicting).ok, false);
});

test('draft validation, publication, audit and rollback are atomic and published rule versions cannot change', () => {
  const store = new SqliteStore(':memory:');
  const rules = new RuleRepository(store);
  try {
    const config = defaultRuleConfig();
    config.groups.search.enabled = false;
    let draft = rules.create(
      { label: 'limited', config, reason: 'disable search' },
      'admin',
      'request1',
    );
    assert.throws(
      () => rules.publish(draft.id, draft.version, 'publish untested', 'admin', 'request2'),
      /黄金集/,
    );
    const checked = rules.validate(draft.id, draft.version, 'admin', 'request3');
    draft = checked.draft;
    assert.equal(checked.ok, true);
    const publish = rules.publish(draft.id, draft.version, 'publish tested', 'admin', 'request4');
    assert.equal(rules.list().activeVersionId, publish.activeVersionId);
    assert.deepEqual(
      matchIntent('使用搜索工具', 'explicit', 'human', readActiveRules(new AgentEntityStore(store)))
        .groups,
      [],
    );
    assert.throws(
      () => store.put('ruleVersion', publish.activeVersionId, { config: defaultRuleConfig() }),
      /immutable rule version/,
    );
    assert.throws(
      () => store.delete('ruleVersion', publish.activeVersionId),
      /immutable rule version/,
    );
    rules.rollback('explicit-v1', 'restore builtin', 'admin', 'request5');
    assert.equal(rules.list().activeVersionId, 'explicit-v1');
    assert.deepEqual(
      matchIntent('使用搜索工具', 'explicit', 'human', readActiveRules(new AgentEntityStore(store)))
        .groups,
      ['search'],
    );
    draft = rules.update(
      draft.id,
      { expectedVersion: draft.version + 1, label: 'edited', reason: 'edit removes validation' },
      'admin',
      'request6',
    );
    assert.equal(draft.validation, undefined);
    assert.throws(
      () => rules.publish(draft.id, draft.version, 'must validate', 'admin', 'request7'),
      /黄金集/,
    );
    draft = rules.validate(draft.id, draft.version, 'admin', 'request8').draft;
    const oldAudit = store.audit.bind(store),
      before = rules.list().versions.length;
    store.audit = () => {
      throw new Error('controlled audit failure');
    };
    assert.throws(
      () => rules.publish(draft.id, draft.version, 'atomic publish', 'admin', 'request9'),
      /controlled/,
    );
    store.audit = oldAudit;
    assert.equal(rules.list().versions.length, before);
    assert.equal(rules.list().activeVersionId, 'explicit-v1');
    assert.ok(store.audits().some((row) => row.action === 'rules.published'));
    assert.ok(store.audits().some((row) => row.action === 'rules.rolled_back'));
  } finally {
    store.close();
  }
});

test('publishing and rollback affect future Core runs while accepted runs retain immutable rule evidence', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'mypi-rules-')),
    store = new SqliteStore(':memory:'),
    entities = new AgentEntityStore(store),
    rules = new RuleRepository(store);
  const sandbox = new TrustedLocalSandbox({
    root: dir,
    stateRoot: join(dir, '.private'),
    managedWorkspaces: true,
    explicitlyTrusted: true,
  });
  const model: ModelConfig = {
    id: 'fixture',
    displayName: 'fixture',
    providerType: 'openai',
    modelId: 'fixture',
    maxOutputTokens: 32,
    contextWindow: 32000,
    configVersion: 1,
  };
  const observed: string[][] = [];
  const core = new AgentService({
    store: entities,
    sandbox,
    profile: 'trusted-local',
    resolveModel: () => model,
    runtime: {
      create: async (input) => ({
        prompt: async () => {
          observed.push(input.tools.map((tool) => tool.name));
          return { text: 'fixture result', usage: unknownUsage() };
        },
        close: async () => {},
      }),
    },
  });
  const c = await core.open({ ownerId: 'alice' });
  try {
    const old = await core.submit('alice', c.id, { text: '使用搜索工具' }, 'old');
    await core.wait(old.id);
    const config = defaultRuleConfig();
    config.groups.search.enabled = false;
    const draft = rules.create(
        { label: 'search off', config, reason: 'disabled' },
        'admin',
        'create',
      ),
      checked = rules.validate(draft.id, draft.version, 'admin', 'check');
    const published = rules.publish(draft.id, checked.draft.version, 'publish', 'admin', 'publish');
    const current = await core.submit('alice', c.id, { text: '使用搜索工具' }, 'current');
    await core.wait(current.id);
    rules.rollback('explicit-v1', 'restore baseline', 'admin', 'rollback');
    const restored = await core.submit('alice', c.id, { text: '使用搜索工具' }, 'restored');
    await core.wait(restored.id);
    assert.deepEqual(
      observed.map((tools) => tools.length),
      [9, 4, 9],
    );
    assert.equal(core.run('alice', old.id).ruleVersion, 'explicit-v1');
    assert.equal(core.run('alice', current.id).ruleVersion, published.activeVersionId);
    assert.equal(core.run('alice', restored.id).ruleVersion, 'explicit-v1');
    assert.equal(core.run('alice', old.id).decision.evidence[0].text, '使用搜索工具');
  } finally {
    await core.close('alice', c.id);
    await sandbox.shutdown();
    store.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test('rule management endpoints require administrator CSRF and use validated optimistic drafts', async () => {
  const store = new SqliteStore(':memory:'),
    origin = 'http://localhost:3000';
  const app = await createGateway({
    store,
    services: {} as GatewayServices,
    origin,
    masterKey: Buffer.alloc(32, 7).toString('base64'),
    cookieSecret: 'x'.repeat(40),
  });
  try {
    assert.equal((await app.inject({ url: '/api/v1/admin/rules' })).statusCode, 401);
    await createAdmin(store, 'rules-admin', 'long rules test password');
    const login = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/login',
      headers: { origin },
      payload: { username: 'rules-admin', password: 'long rules test password' },
    });
    const headers = {
      origin,
      cookie: login.cookies[0].name + '=' + login.cookies[0].value,
      'x-csrf-token': login.json().csrfToken,
    };
    const config = defaultRuleConfig();
    config.groups.search.phrases = ['使用代码索引'];
    assert.equal(
      (
        await app.inject({
          method: 'POST',
          url: '/api/v1/admin/rules/drafts',
          headers: { origin, cookie: headers.cookie },
          payload: { label: 'safe', config, reason: 'test config' },
        })
      ).statusCode,
      403,
    );
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/rules/drafts',
      headers,
      payload: { label: 'safe', config, reason: 'test config' },
    });
    assert.equal(created.statusCode, 201, created.body);
    const draft = created.json();
    const validate = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/rules/drafts/${draft.id}/validate`,
      headers,
      payload: { expectedVersion: draft.version },
    });
    assert.equal(validate.json().ok, true, validate.body);
    const stale = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/rules/drafts/${draft.id}/publish`,
      headers,
      payload: { expectedVersion: draft.version, reason: 'publish stale' },
    });
    assert.equal(stale.statusCode, 409);
    const published = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/rules/drafts/${draft.id}/publish`,
      headers,
      payload: { expectedVersion: validate.json().draft.version, reason: 'publish checked' },
    });
    assert.equal(published.statusCode, 200, published.body);
    const rollback = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/rules/rollback',
      headers,
      payload: { versionId: 'explicit-v1', reason: 'restore builtin' },
    });
    assert.equal(rollback.json().activeVersionId, 'explicit-v1');
    const invalid = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/rules/drafts',
      headers,
      payload: { label: 'bad', config: { ...config, js: 'alert(1)' }, reason: 'reject script' },
    });
    assert.equal(invalid.statusCode, 400);
  } finally {
    await app.close();
    store.close();
  }
});

test('AC-20: snapshot cursor cannot overtake entities committed by a separate SQLite writer', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'mypi-snapshot-')),
    path = join(dir, 'test.sqlite'),
    store = new SqliteStore(path),
    writer = new SqliteStore(path),
    origin = 'http://localhost:3000';
  writer.db.exec('PRAGMA busy_timeout=0');
  const app = await createGateway({
    store,
    services: {} as GatewayServices,
    origin,
    masterKey: Buffer.alloc(32, 9).toString('base64'),
    cookieSecret: 'x'.repeat(40),
  });
  try {
    const guest = await app.inject({
        method: 'POST',
        url: '/api/v1/guest-sessions',
        headers: { origin },
        payload: {},
      }),
      owner = guest.json().principalId,
      cookie = guest.cookies[0].name + '=' + guest.cookies[0].value,
      id = randomUUID();
    store.put(
      'conversation',
      id,
      { id, ownerId: owner, status: 'active', title: 'snapshot', mode: 'explicit' },
      { ownerId: owner, conversationId: id },
    );
    const commit = () =>
      writer.transaction(() => {
        writer.put(
          'message',
          'm',
          { id: 'm', text: 'arrived after snapshot', role: 'assistant' },
          { ownerId: owner, conversationId: id },
        );
        writer.appendEvent(id, 'run', 'message.completed', {
          messageId: 'm',
          text: 'arrived after snapshot',
          role: 'assistant',
        });
      });
    const original = store.list.bind(store);
    let attempted = false,
      blocked = false;
    store.list = ((kind: string, options: any) => {
      const result = original(kind, options);
      if (kind === 'message' && !attempted) {
        attempted = true;
        try {
          commit();
        } catch (error) {
          assert.match(String(error), /locked/);
          blocked = true;
        }
      }
      return result;
    }) as typeof store.list;
    const snapshot = await app.inject({ url: `/api/v1/conversations/${id}`, headers: { cookie } });
    assert.equal(snapshot.statusCode, 200, snapshot.body);
    assert.equal(attempted, true);
    assert.equal(blocked, true);
    assert.equal(snapshot.json().lastSequence, 0);
    assert.deepEqual(snapshot.json().messages, []);
    commit();
    assert.equal(store.events(id, snapshot.json().lastSequence).length, 1);
    assert.equal(store.events(id, 0)[0].payload.messageId, 'm');
  } finally {
    await app.close();
    store.close();
    writer.close();
    await rm(dir, { recursive: true, force: true });
  }
});
