import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createAdmin, SqliteStore, verifyPassword } from '../src/index.js';
import { SecretBox } from '../src/security.js';

test('versioned entities, ownership, transactions and idempotency survive reopen', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mypi-store-')),
    path = join(dir, 'database.sqlite');
  let store = new SqliteStore(path);
  try {
    store.put('conversation', 'c', { title: 'one' }, { ownerId: 'alice' });
    assert.equal(store.get('conversation', 'c', 'bob'), undefined);
    assert.throws(
      () => store.put('conversation', 'c', { title: 'two' }, { expectedVersion: 0 }),
      /refresh/,
    );
    assert.throws(
      () =>
        store.transaction(() => {
          store.put('conversation', 'rolled', { title: 'no' });
          throw Error('rollback');
        }),
      /rollback/,
    );
    assert.equal(store.get('conversation', 'rolled'), undefined);
    let calls = 0;
    assert.deepEqual(
      store.idempotent('alice', 'runs', 'key', { text: 'hi' }, () => ({ id: ++calls })),
      { id: 1 },
    );
    assert.deepEqual(
      store.idempotent('alice', 'runs', 'key', { text: 'hi' }, () => ({ id: ++calls })),
      { id: 1 },
    );
    assert.throws(
      () => store.idempotent('alice', 'runs', 'key', { text: 'different' }, () => ({})),
      /another request/,
    );
    store.close();
    store = new SqliteStore(path);
    assert.equal(store.get('conversation', 'c')?.data.title, 'one');
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
test('all quota buckets reserve atomically and unknown usage remains held', () => {
  const store = new SqliteStore();
  try {
    const a = store.ensureQuota('principal', 'a', { tokens: 100, roots: 2, calls: 3 }),
      global = store.ensureQuota('global', 'g', { tokens: 60, roots: 2 });
    store.reserveQuota('call1', [a.id, global.id], 50);
    assert.throws(() => store.reserveQuota('call2', [a.id, global.id], 20), /budget exhausted/);
    assert.equal(store.quota('principal', 'a')?.tokensReserved, 50);
    store.settleQuota('call1', null);
    assert.equal(store.quota('principal', 'a')?.tokensReserved, 50);
    store.settleQuota('call1', 30);
    store.settleQuota('call1', 30);
    assert.equal(store.quota('principal', 'a')?.tokensReserved, 0);
    assert.equal(store.quota('principal', 'a')?.tokensUsed, 30);
    store.consumeRoot([a.id, global.id]);
    store.consumeRoot([a.id, global.id]);
    assert.throws(() => store.consumeRoot([a.id, global.id]), /quota exhausted/);
    store.adjustQuota(a.id, 'admin', 50, 1, 'approved test quota', 'adjust1');
    store.adjustQuota(a.id, 'admin', 50, 1, 'approved test quota', 'adjust1');
    assert.equal(store.quota('principal', 'a')?.tokenLimit, 150);
    assert.equal(store.quota('principal', 'a')?.tokensUsed, 30);
  } finally {
    store.close();
  }
});
test('events/outbox commit together and no event is published from rolled-back transaction', () => {
  const store = new SqliteStore();
  try {
    const observed: number[] = [];
    store.subscribe('c', (e) => observed.push(e.sequence));
    store.appendEvent('c', 'r', 'run.accepted', { status: 'accepted' });
    assert.throws(
      () =>
        store.transaction(() => {
          store.appendEvent('c', 'r', 'error', {});
          throw Error('rollback');
        }),
      /rollback/,
    );
    store.appendEvent('c', 'r', 'run.completed', { status: 'succeeded' });
    assert.deepEqual(observed, [1, 2]);
    assert.equal(store.events('c', 1)[0].type, 'run.completed');
    assert.equal(store.pendingOutbox().length, 2);
    const id = store.pendingOutbox()[0].id;
    store.markOutbox(id);
    assert.equal(store.pendingOutbox().length, 1);
    store.audit(null, 'example', 'r');
    assert.throws(() => store.db.exec('DELETE FROM audit_event'), /immutable/);
  } finally {
    store.close();
  }
});
test('admin passwords and model keys never persist as plaintext', async () => {
  const store = new SqliteStore();
  try {
    const password = 'this is a secure admin passphrase';
    const id = await createAdmin(store, 'admin', password),
      encoded = store.get('principal', id)!.data.passwordHash;
    assert.equal(encoded.includes(password), false);
    assert.equal(await verifyPassword(password, encoded), true);
    assert.equal(await verifyPassword('wrong', encoded), false);
    const box = new SecretBox(Buffer.alloc(32, 7).toString('base64')),
      value = 'sk-private-test-credential',
      encrypted = box.encrypt(value);
    assert.equal(encrypted.includes(value), false);
    assert.equal(box.decrypt(encrypted), value);
    const pieces = encrypted.split('.');
    pieces[2] = Buffer.from('tampered').toString('base64url');
    assert.throws(() => box.decrypt(pieces.join('.')));
  } finally {
    store.close();
  }
});
