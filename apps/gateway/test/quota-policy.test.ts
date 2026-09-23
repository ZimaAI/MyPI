import test from 'node:test';
import assert from 'node:assert/strict';
import { createAdmin, SqliteStore } from '@mypi/storage-sqlite';
import { createGateway } from '../src/index.js';
const origin = 'http://localhost:3000';
async function fixture() {
  const store = new SqliteStore();
  const app = await createGateway({
    store,
    origin,
    masterKey: Buffer.alloc(32, 2).toString('base64'),
    cookieSecret: 'quota-regression-cookie-secret-at-least-32',
    services: {
      async submit() {
        throw Error('not used');
      },
      async cancel() {
        return {};
      },
    },
  });
  return {
    store,
    app,
    async close() {
      await app.close();
      store.close();
    },
  };
}
test('clearing cookies does not bypass IP bootstrap cap or replenish an existing principal', async () => {
  const f = await fixture();
  try {
    const first = await f.app.inject({
      method: 'POST',
      url: '/api/v1/guest-sessions',
      headers: { origin },
      payload: {},
    });
    assert.equal(first.statusCode, 201);
    const ownerId = first.json().principalId,
      cookie = first.cookies[0].name + '=' + first.cookies[0].value,
      bucket = f.store.quota('principal', ownerId)!;
    f.store.consumeRoot([bucket.id]);
    f.store.reserveQuota('spent', [bucket.id], 10);
    f.store.settleQuota('spent', 10);
    for (let i = 1; i < 20; i++)
      assert.equal(
        (
          await f.app.inject({
            method: 'POST',
            url: '/api/v1/guest-sessions',
            headers: { origin },
            payload: {},
          })
        ).statusCode,
        201,
      );
    const limited = await f.app.inject({
      method: 'POST',
      url: '/api/v1/guest-sessions',
      headers: { origin },
      payload: {},
    });
    assert.equal(limited.statusCode, 429);
    assert.equal(limited.json().code, 'RATE_LIMITED');
    const reused = await f.app.inject({
      method: 'POST',
      url: '/api/v1/guest-sessions',
      headers: { origin, cookie },
      payload: {},
    });
    assert.equal(reused.statusCode, 201);
    assert.equal(reused.json().principalId, ownerId);
    assert.equal(reused.json().reused, true);
    assert.equal(f.store.quota('principal', ownerId)!.rootsUsed, 1);
    assert.equal(f.store.quota('principal', ownerId)!.tokensUsed, 10);
  } finally {
    await f.close();
  }
});
test('published quota tightening updates existing buckets without discarding spending or reservations', async () => {
  const f = await fixture();
  try {
    await createAdmin(f.store, 'operator', 'long-enough-test-password');
    const login = await f.app.inject({
      method: 'POST',
      url: '/api/v1/admin/login',
      headers: { origin },
      payload: { username: 'operator', password: 'long-enough-test-password' },
    });
    const headers = {
      origin,
      cookie: login.cookies[0].name + '=' + login.cookies[0].value,
      'x-csrf-token': login.json().csrfToken,
    };
    const guest = await f.app.inject({
        method: 'POST',
        url: '/api/v1/guest-sessions',
        headers: { origin },
        payload: {},
      }),
      ownerId = guest.json().principalId,
      bucket = f.store.quota('principal', ownerId)!;
    f.store.consumeRoot([bucket.id]);
    f.store.consumeRoot([bucket.id]);
    f.store.reserveQuota('settled', [bucket.id], 20);
    f.store.settleQuota('settled', 20);
    f.store.reserveQuota('held', [bucket.id], 80);
    f.store.settleQuota('held', null);
    const root = f.store.ensureQuota('run', 'root', { tokens: 1000, roots: 1, calls: 12 }, 'run');
    f.store.reserveQuota('root1', [root.id], 1);
    f.store.settleQuota('root1', 1);
    f.store.reserveQuota('root2', [root.id], 1);
    f.store.settleQuota('root2', 1);
    const old = (await f.app.inject({ url: '/api/v1/admin/policy', headers })).json(),
      input = {
        ...old,
        dailyTokens: 50,
        dailyRootRuns: 1,
        maxModelCalls: 2,
        reason: 'tighten existing budget',
      };
    const published = await f.app.inject({
      method: 'PUT',
      url: '/api/v1/admin/policy',
      headers,
      payload: input,
    });
    assert.equal(published.statusCode, 200, published.body);
    const updated = f.store.quota('principal', ownerId)!;
    assert.equal(updated.tokenLimit, 50);
    assert.equal(updated.rootLimit, 1);
    assert.equal(updated.rootsUsed, 2);
    assert.equal(updated.tokensUsed, 20);
    assert.equal(updated.tokensReserved, 80);
    assert.throws(() => f.store.consumeRoot([bucket.id]), /quota exhausted/);
    assert.throws(() => f.store.reserveQuota('new', [bucket.id], 1), /budget exhausted/);
    assert.throws(() => f.store.reserveQuota('root3', [root.id], 1), /budget exhausted/);
    assert.equal(
      (f.store.db.prepare('SELECT COUNT(*) AS n FROM quota_adjustment').get() as any).n,
      1,
    );
    const repeated = await f.app.inject({
      method: 'PUT',
      url: '/api/v1/admin/policy',
      headers,
      payload: input,
    });
    assert.equal(repeated.statusCode, 409);
    assert.equal(
      (f.store.db.prepare('SELECT COUNT(*) AS n FROM quota_adjustment').get() as any).n,
      1,
    );
    const relaxed = await f.app.inject({
      method: 'PUT',
      url: '/api/v1/admin/policy',
      headers,
      payload: {
        ...input,
        version: published.json().version,
        dailyTokens: 200,
        maxModelCalls: 5,
        reason: 'future run increase',
      },
    });
    assert.equal(relaxed.statusCode, 200);
    assert.equal(f.store.quota('run', 'root', 'run')?.callLimit, 2);
  } finally {
    await f.close();
  }
});
