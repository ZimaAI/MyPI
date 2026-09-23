import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createGateway, createAdmin, type GatewayServices } from '../src/index.js';
import { SqliteStore } from '@mypi/storage-sqlite';
import { defaultPolicy } from '@mypi/contracts';
const origin = 'http://localhost:3000';
async function fixture() {
  const store = new SqliteStore();
  let submissions = 0;
  const services: GatewayServices = {
    async createConversation(ownerId, input, key) {
      return store.idempotent(ownerId, 'conversations', key, input, () => {
        const id = randomUUID(),
          data = {
            id,
            ownerId,
            workspaceId: randomUUID(),
            title: input.title ?? 'New',
            mode: input.mode,
            status: 'active',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            version: 1,
          };
        store.put('conversation', id, data, { ownerId, conversationId: id });
        return data;
      });
    },
    async submit(ownerId, conversationId, input, key) {
      return store.idempotent(ownerId, conversationId, key, input, () => {
        const id = randomUUID();
        submissions++;
        const run = {
          id,
          ownerId,
          conversationId,
          mode: input.mode,
          status: 'accepted',
          text: input.text,
          model: { apiKey: 'must-not-leak', configVersion: 1 },
          createdAt: new Date().toISOString(),
        };
        store.put('run', id, run, { ownerId, conversationId });
        store.appendEvent(conversationId, id, 'run.accepted', {
          status: 'accepted',
          effectiveMode: input.mode,
        });
        return run;
      });
    },
    async cancel(_ownerId, id) {
      return { resourceId: id, status: 'cancelled', resourcesCleanupPending: false };
    },
    async ready() {
      return { ready: true, sandboxEnforced: true };
    },
    async testModel() {
      return { ok: true, latencyMs: 1, usageKnown: true, errorCode: null };
    },
    async ruleTest(input) {
      return { groups: [], reasons: [input.simulatedSource ?? 'human'], ruleVersion: 'test' };
    },
    async file(_owner, _id, path) {
      return { path, content: 'safe', binary: false, truncated: false, revision: '1' };
    },
  };
  const app = await createGateway({
    store,
    services,
    origin,
    masterKey: Buffer.alloc(32, 3).toString('base64'),
    cookieSecret: 'long-cookie-secret-for-tests-1234567890',
    eventPollMs: 10,
  });
  const guest = async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/guest-sessions',
      headers: { origin },
      payload: {},
    });
    assert.equal(response.statusCode, 201);
    return {
      cookie: response.cookies[0].name + '=' + response.cookies[0].value,
      csrf: response.json().csrfToken,
      id: response.json().principalId,
    };
  };
  const write = (identity: { cookie: string; csrf: string }, key = randomUUID()) => ({
    origin,
    cookie: identity.cookie,
    'x-csrf-token': identity.csrf,
    'idempotency-key': key,
  });
  const admin = async () => {
    await createAdmin(store, 'operator', 'long-enough-test-password');
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/login',
      headers: { origin },
      payload: { username: 'operator', password: 'long-enough-test-password' },
    });
    assert.equal(response.statusCode, 200);
    return {
      cookie: response.cookies[0].name + '=' + response.cookies[0].value,
      csrf: response.json().csrfToken,
    };
  };
  return {
    app,
    store,
    guest,
    admin,
    write,
    submissions: () => submissions,
    async close() {
      await app.close();
      store.close();
    },
  };
}
test('guest identity is reused, CSRF and additional role fields are rejected, objects remain private', async () => {
  const f = await fixture();
  try {
    const alice = await f.guest(),
      bob = await f.guest();
    const reused = await f.app.inject({
      method: 'POST',
      url: '/api/v1/guest-sessions',
      headers: { origin, cookie: alice.cookie },
      payload: {},
    });
    assert.equal(reused.json().principalId, alice.id);
    assert.equal(reused.json().reused, true);
    const blocked = await f.app.inject({
      method: 'POST',
      url: '/api/v1/conversations',
      headers: { origin, cookie: alice.cookie },
      payload: { mode: 'explicit', templateId: 'empty' },
    });
    assert.equal(blocked.statusCode, 403);
    const forged = await f.app.inject({
      method: 'POST',
      url: '/api/v1/guest-sessions',
      headers: { origin },
      payload: { role: 'admin' },
    });
    assert.equal(forged.statusCode, 400);
    const create = await f.app.inject({
      method: 'POST',
      url: '/api/v1/conversations',
      headers: f.write(alice),
      payload: { mode: 'explicit', templateId: 'empty' },
    });
    assert.equal(create.statusCode, 201);
    const id = create.json().id;
    assert.equal(
      (await f.app.inject({ url: `/api/v1/conversations/${id}`, headers: { cookie: bob.cookie } }))
        .statusCode,
      404,
    );
    assert.equal(
      (
        await f.app.inject({
          url: `/api/v1/conversations/${id}/events`,
          headers: { cookie: bob.cookie },
        })
      ).statusCode,
      404,
    );
    assert.equal(
      (
        await f.app.inject({
          method: 'PATCH',
          url: `/api/v1/conversations/${id}`,
          headers: f.write(alice),
          payload: { title: 'wrong version', expectedVersion: 50 },
        })
      ).statusCode,
      409,
    );
    assert.equal(
      (
        await f.app.inject({
          url: `/api/v1/conversations/${id}/file?path=../secret`,
          headers: { cookie: alice.cookie },
        })
      ).statusCode,
      400,
    );
  } finally {
    await f.close();
  }
});
test('model keys are write-only, tested default gates execution, run submission is idempotent', async () => {
  const f = await fixture();
  try {
    const admin = await f.admin(),
      alice = await f.guest();
    const create = await f.app.inject({
      method: 'POST',
      url: '/api/v1/admin/models',
      headers: f.write(admin),
      payload: {
        displayName: 'Test model',
        providerType: 'openai',
        modelId: 'gpt-4.1-mini',
        approvedEndpointId: 'openai',
        apiKey: 'sk-super-secret-value',
        enabled: true,
        publicSelectable: true,
        maxOutputTokens: 2048,
        reason: 'integration test model',
      },
    });
    assert.equal(create.statusCode, 201, create.body);
    assert.ok(!create.body.includes('sk-super-secret-value'));
    let model = create.json();
    const early = await f.app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/models/${model.id}`,
      headers: f.write(admin),
      payload: {
        defaultForGuests: true,
        expectedVersion: model.version,
        reason: 'select default model',
      },
    });
    assert.equal(early.statusCode, 400);
    assert.equal(
      (
        await f.app.inject({
          method: 'POST',
          url: `/api/v1/admin/models/${model.id}/test`,
          headers: f.write(admin),
        })
      ).json().ok,
      true,
    );
    model = (
      await f.app.inject({ url: '/api/v1/admin/models', headers: { cookie: admin.cookie } })
    ).json().items[0];
    const update = await f.app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/models/${model.id}`,
      headers: f.write(admin),
      payload: {
        defaultForGuests: true,
        expectedVersion: model.version,
        reason: 'select tested model',
      },
    });
    assert.equal(update.statusCode, 200, update.body);
    f.store.put('policy', 'current', { ...defaultPolicy, publicExecution: true });
    const conversation = (
      await f.app.inject({
        method: 'POST',
        url: '/api/v1/conversations',
        headers: f.write(alice),
        payload: { mode: 'explicit', templateId: 'empty' },
      })
    ).json();
    const url = `/api/v1/conversations/${conversation.id}/runs`,
      headers = f.write(alice),
      payload = { text: 'Hello', mode: 'explicit' };
    const accepted = await f.app.inject({ method: 'POST', url, headers, payload }),
      again = await f.app.inject({ method: 'POST', url, headers, payload });
    assert.equal(accepted.statusCode, 202, accepted.body);
    assert.equal(accepted.json().runId, again.json().runId);
    assert.equal(f.submissions(), 1);
    const conflict = await f.app.inject({
      method: 'POST',
      url,
      headers,
      payload: { ...payload, text: 'different' },
    });
    assert.equal(conflict.statusCode, 409);
    const snapshot = await f.app.inject({
      url: `/api/v1/conversations/${conversation.id}`,
      headers: { cookie: alice.cookie },
    });
    assert.ok(!snapshot.body.includes('must-not-leak'));
    assert.ok(!snapshot.body.includes('apiKey'));
    const forbidden = await f.app.inject({
      method: 'POST',
      url,
      headers: f.write(alice),
      payload: { ...payload, source: 'tool' },
    });
    assert.equal(forbidden.statusCode, 400);
    const list = await f.app.inject({
      url: '/api/v1/admin/models',
      headers: { cookie: admin.cookie },
    });
    assert.ok(!list.body.includes('sk-super-secret-value'));
    assert.equal(
      (await f.app.inject({ url: '/api/v1/admin/models', headers: { cookie: alice.cookie } }))
        .statusCode,
      401,
    );
  } finally {
    await f.close();
  }
});
test('SSE resumes persisted events and emits reset for expired cursor', async () => {
  const f = await fixture();
  try {
    const identity = await f.guest(),
      conversation = (
        await f.app.inject({
          method: 'POST',
          url: '/api/v1/conversations',
          headers: f.write(identity),
          payload: { mode: 'explicit', templateId: 'empty' },
        })
      ).json();
    f.store.appendEvent(conversation.id, 'r', 'message.completed', {
      messageId: 'm',
      text: 'first',
      role: 'assistant',
    });
    f.store.appendEvent(conversation.id, 'r', 'run.completed', { status: 'succeeded' });
    await f.app.listen({ host: '127.0.0.1', port: 0 });
    const address = f.app.server.address() as { port: number };
    const abort = new AbortController();
    const response = await fetch(
      `http://127.0.0.1:${address.port}/api/v1/conversations/${conversation.id}/events`,
      { headers: { cookie: identity.cookie, 'last-event-id': '1' }, signal: abort.signal },
    );
    const reader = response.body!.getReader();
    const chunk = new TextDecoder().decode((await reader.read()).value);
    assert.match(chunk, /id: 2/);
    assert.doesNotMatch(chunk, /id: 1/);
    abort.abort();
    const reset = await f.app.inject({
      url: `/api/v1/conversations/${conversation.id}/events?after=999`,
      headers: { cookie: identity.cookie },
    });
    assert.match(reset.body, /stream.reset/);
  } finally {
    await f.close();
  }
});
