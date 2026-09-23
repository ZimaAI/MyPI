import { DatabaseSync } from 'node:sqlite';
import { randomUUID, createHash } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { EventEmitter } from 'node:events';

export interface Stored<T = Record<string, unknown>> {
  id: string;
  ownerId?: string;
  conversationId?: string;
  version: number;
  createdAt: string;
  updatedAt: string;
  data: T;
}
export interface ListOptions {
  ownerId?: string;
  conversationId?: string;
  limit?: number;
  cursor?: string;
}
export interface PersistedEvent {
  schemaVersion: 1;
  eventId: string;
  sequence: number;
  type: string;
  conversationId: string;
  runId: string | null;
  taskId?: string;
  occurredAt: string;
  payload: any;
}
export interface QuotaLimits {
  tokens: number;
  roots: number;
  calls?: number;
}
export interface QuotaBucket {
  id: string;
  scope: string;
  scopeId: string;
  period: string;
  tokenLimit: number;
  tokensUsed: number;
  tokensReserved: number;
  rootLimit: number;
  rootsUsed: number;
  callLimit: number;
  callsUsed: number;
}
export class StoreError extends Error {
  constructor(
    public code: string,
    message: string,
    public statusCode = 409,
  ) {
    super(message);
  }
}
const now = () => new Date().toISOString();
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

/** One control-plane database; all write transactions are synchronous and bounded. */
export class SqliteStore {
  readonly db: DatabaseSync;
  private depth = 0;
  private notifications: PersistedEvent[] = [];
  private emitter = new EventEmitter();
  constructor(path = ':memory:') {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(path);
    this.db.exec(`PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS schema_migration(version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS entity(kind TEXT NOT NULL,id TEXT NOT NULL,owner_id TEXT,conversation_id TEXT,
        version INTEGER NOT NULL DEFAULT 1,data_json TEXT NOT NULL CHECK(json_valid(data_json)),created_at TEXT NOT NULL,updated_at TEXT NOT NULL,PRIMARY KEY(kind,id));
      CREATE INDEX IF NOT EXISTS idx_entity_owner ON entity(kind,owner_id,updated_at);
      CREATE INDEX IF NOT EXISTS idx_entity_conversation ON entity(kind,conversation_id,created_at);
      CREATE TABLE IF NOT EXISTS sequence(conversation_id TEXT PRIMARY KEY,last_sequence INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS stream_event(conversation_id TEXT NOT NULL,sequence INTEGER NOT NULL,event_id TEXT NOT NULL UNIQUE,
        run_id TEXT,type TEXT NOT NULL,payload_json TEXT NOT NULL,task_id TEXT,created_at TEXT NOT NULL,PRIMARY KEY(conversation_id,sequence));
      CREATE TABLE IF NOT EXISTS outbox(id TEXT PRIMARY KEY,topic TEXT NOT NULL,aggregate_id TEXT NOT NULL,dedup_key TEXT NOT NULL UNIQUE,
        payload_json TEXT NOT NULL,state TEXT NOT NULL DEFAULT 'pending',attempts INTEGER NOT NULL DEFAULT 0,created_at TEXT NOT NULL,published_at TEXT);
      CREATE TABLE IF NOT EXISTS idempotency(owner_id TEXT NOT NULL,route TEXT NOT NULL,key TEXT NOT NULL,request_hash TEXT NOT NULL,result_json TEXT NOT NULL,created_at TEXT NOT NULL,PRIMARY KEY(owner_id,route,key));
      CREATE TABLE IF NOT EXISTS quota_bucket(id TEXT PRIMARY KEY,scope TEXT NOT NULL,scope_id TEXT NOT NULL,period TEXT NOT NULL,
        token_limit INTEGER NOT NULL CHECK(token_limit>=0),tokens_used INTEGER NOT NULL DEFAULT 0 CHECK(tokens_used>=0),
        tokens_reserved INTEGER NOT NULL DEFAULT 0 CHECK(tokens_reserved>=0),root_limit INTEGER NOT NULL CHECK(root_limit>=0),roots_used INTEGER NOT NULL DEFAULT 0,
        call_limit INTEGER NOT NULL DEFAULT 0,calls_used INTEGER NOT NULL DEFAULT 0,UNIQUE(scope,scope_id,period));
      CREATE TABLE IF NOT EXISTS quota_reservation(id TEXT NOT NULL,bucket_id TEXT NOT NULL REFERENCES quota_bucket(id),tokens INTEGER NOT NULL,
        status TEXT NOT NULL,actual_tokens INTEGER,created_at TEXT NOT NULL,PRIMARY KEY(id,bucket_id));
      CREATE TABLE IF NOT EXISTS quota_adjustment(id TEXT PRIMARY KEY,bucket_id TEXT NOT NULL REFERENCES quota_bucket(id),actor_id TEXT NOT NULL,
        token_delta INTEGER NOT NULL,root_delta INTEGER NOT NULL,reason TEXT NOT NULL,idempotency_key TEXT NOT NULL UNIQUE,created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS audit_event(id TEXT PRIMARY KEY,actor_id TEXT,action TEXT NOT NULL,resource_id TEXT NOT NULL,
        request_id TEXT NOT NULL,summary_json TEXT NOT NULL,result TEXT NOT NULL,created_at TEXT NOT NULL);
      CREATE TRIGGER IF NOT EXISTS audit_no_update BEFORE UPDATE ON audit_event BEGIN SELECT RAISE(ABORT,'immutable audit'); END;
      CREATE TRIGGER IF NOT EXISTS audit_no_delete BEFORE DELETE ON audit_event BEGIN SELECT RAISE(ABORT,'immutable audit'); END;
      INSERT OR IGNORE INTO schema_migration(version,applied_at) VALUES(1,strftime('%Y-%m-%dT%H:%M:%fZ','now'));
    `);
    const version = this.db
      .prepare('SELECT MAX(version) AS version FROM schema_migration')
      .get() as { version: number };
    if (version.version !== 1) throw new Error('Unsupported database schema version');
    this.emitter.setMaxListeners(1000);
  }
  transaction<T>(fn: () => T): T {
    if (this.depth > 0) return fn();
    this.db.exec('BEGIN IMMEDIATE');
    this.depth++;
    let result: T;
    try {
      result = fn();
      if (result && typeof (result as any).then === 'function')
        throw new Error('Database transactions must be synchronous');
      this.db.exec('COMMIT');
      this.depth--;
    } catch (error) {
      this.db.exec('ROLLBACK');
      this.depth--;
      this.notifications = [];
      throw error;
    }
    const events = this.notifications.splice(0);
    for (const event of events) this.notify(event);
    return result;
  }
  put<T extends object>(
    kind: string,
    id: string,
    data: T,
    options: { ownerId?: string; conversationId?: string; expectedVersion?: number } = {},
  ): Stored<T> {
    return this.transaction(() => {
      const old = this.get<T>(kind, id);
      if (options.ownerId && old?.ownerId && old.ownerId !== options.ownerId)
        throw new StoreError('RESOURCE_NOT_FOUND', 'Resource not found', 404);
      if (options.expectedVersion !== undefined && options.expectedVersion !== (old?.version ?? 0))
        throw new StoreError('VERSION_CONFLICT', 'The resource changed; refresh before updating');
      const timestamp = now(),
        version = (old?.version ?? 0) + 1;
      this.db
        .prepare(
          `INSERT INTO entity(kind,id,owner_id,conversation_id,version,data_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)
        ON CONFLICT(kind,id) DO UPDATE SET owner_id=excluded.owner_id,conversation_id=excluded.conversation_id,version=excluded.version,data_json=excluded.data_json,updated_at=excluded.updated_at`,
        )
        .run(
          kind,
          id,
          options.ownerId ?? old?.ownerId ?? null,
          options.conversationId ?? old?.conversationId ?? null,
          version,
          JSON.stringify(data),
          old?.createdAt ?? timestamp,
          timestamp,
        );
      return this.get<T>(kind, id)!;
    });
  }
  get<T = Record<string, any>>(kind: string, id: string, ownerId?: string): Stored<T> | undefined {
    const row = this.db
      .prepare(`SELECT * FROM entity WHERE kind=? AND id=?${ownerId ? ' AND owner_id=?' : ''}`)
      .get(...(ownerId ? [kind, id, ownerId] : [kind, id]));
    return row ? this.entity<T>(row) : undefined;
  }
  list<T = Record<string, any>>(kind: string, options: ListOptions = {}): Stored<T>[] {
    const where = ['kind=?'],
      args: (string | number)[] = [kind];
    if (options.ownerId) {
      where.push('owner_id=?');
      args.push(options.ownerId);
    }
    if (options.conversationId) {
      where.push('conversation_id=?');
      args.push(options.conversationId);
    }
    if (options.cursor) {
      where.push('id>?');
      args.push(options.cursor);
    }
    args.push(Math.min(options.limit ?? 1000, 10000));
    return this.db
      .prepare(`SELECT * FROM entity WHERE ${where.join(' AND ')} ORDER BY created_at,id LIMIT ?`)
      .all(...args)
      .map((row) => this.entity<T>(row));
  }
  delete(kind: string, id: string, ownerId?: string): boolean {
    return (
      Number(
        this.db
          .prepare(`DELETE FROM entity WHERE kind=? AND id=?${ownerId ? ' AND owner_id=?' : ''}`)
          .run(...(ownerId ? [kind, id, ownerId] : [kind, id])).changes,
      ) > 0
    );
  }
  private entity<T>(row: any): Stored<T> {
    return {
      id: row.id,
      ownerId: row.owner_id ?? undefined,
      conversationId: row.conversation_id ?? undefined,
      version: row.version,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      data: JSON.parse(row.data_json),
    };
  }
  idempotent<T>(ownerId: string, route: string, key: string, body: unknown, create: () => T): T {
    return this.transaction(() => {
      const old = this.db
        .prepare('SELECT * FROM idempotency WHERE owner_id=? AND route=? AND key=?')
        .get(ownerId, route, key) as any;
      if (old) {
        if (old.request_hash !== hash(body))
          throw new StoreError(
            'IDEMPOTENCY_CONFLICT',
            'This idempotency key was used for another request',
          );
        return JSON.parse(old.result_json);
      }
      const result = create();
      this.db
        .prepare('INSERT INTO idempotency VALUES(?,?,?,?,?,?)')
        .run(ownerId, route, key, hash(body), JSON.stringify(result), now());
      return result;
    });
  }
  appendEvent(
    conversationId: string,
    runId: string | null,
    type: string,
    payload: unknown,
    taskId?: string,
  ): PersistedEvent {
    return this.transaction(() => {
      this.db
        .prepare(
          'INSERT INTO sequence VALUES(?,1) ON CONFLICT(conversation_id) DO UPDATE SET last_sequence=last_sequence+1',
        )
        .run(conversationId);
      const event: PersistedEvent = {
        schemaVersion: 1,
        eventId: randomUUID(),
        sequence: this.lastSequence(conversationId),
        type,
        conversationId,
        runId,
        occurredAt: now(),
        payload,
        ...(taskId ? { taskId } : {}),
      };
      this.db
        .prepare('INSERT INTO stream_event VALUES(?,?,?,?,?,?,?,?)')
        .run(
          conversationId,
          event.sequence,
          event.eventId,
          runId,
          type,
          JSON.stringify(payload),
          taskId ?? null,
          event.occurredAt,
        );
      this.db
        .prepare(
          'INSERT INTO outbox(id,topic,aggregate_id,dedup_key,payload_json,created_at) VALUES(?,?,?,?,?,?)',
        )
        .run(
          randomUUID(),
          'stream_event',
          conversationId,
          event.eventId,
          JSON.stringify(event),
          event.occurredAt,
        );
      this.notifications.push(event);
      return event;
    });
  }
  events(conversationId: string, after = 0, limit = 1000): PersistedEvent[] {
    return this.db
      .prepare(
        'SELECT * FROM stream_event WHERE conversation_id=? AND sequence>? ORDER BY sequence LIMIT ?',
      )
      .all(conversationId, after, limit)
      .map((r: any) => ({
        schemaVersion: 1,
        eventId: r.event_id,
        sequence: r.sequence,
        type: r.type,
        conversationId,
        runId: r.run_id,
        occurredAt: r.created_at,
        payload: JSON.parse(r.payload_json),
        ...(r.task_id ? { taskId: r.task_id } : {}),
      }));
  }
  lastSequence(conversationId: string): number {
    return (
      (
        this.db
          .prepare('SELECT last_sequence FROM sequence WHERE conversation_id=?')
          .get(conversationId) as any
      )?.last_sequence ?? 0
    );
  }
  firstSequence(conversationId: string): number {
    return (
      (
        this.db
          .prepare('SELECT MIN(sequence) AS sequence FROM stream_event WHERE conversation_id=?')
          .get(conversationId) as any
      )?.sequence ?? 0
    );
  }
  subscribe(conversationId: string, fn: (event: PersistedEvent) => void): () => void {
    this.emitter.on(conversationId, fn);
    return () => this.emitter.off(conversationId, fn);
  }
  /** Used by authenticated worker IPC notification; sequence dedup belongs to the subscriber. */
  notify(event: PersistedEvent): void {
    for (const listener of this.emitter.listeners(event.conversationId)) {
      // Notifications are advisory; committed events remain replayable in the durable outbox.
      try {
        listener(event);
      } catch {
        /* one disconnected consumer must not fail a committed write */
      }
    }
  }
  pendingOutbox(limit = 100): any[] {
    return this.db
      .prepare("SELECT * FROM outbox WHERE state='pending' ORDER BY created_at LIMIT ?")
      .all(limit)
      .map((r: any) => ({ ...r, payload: JSON.parse(r.payload_json) }));
  }
  markOutbox(id: string): void {
    this.db
      .prepare("UPDATE outbox SET state='published',published_at=?,attempts=attempts+1 WHERE id=?")
      .run(now(), id);
  }
  ensureQuota(
    scope: string,
    scopeId: string,
    limits: QuotaLimits,
    period = now().slice(0, 10),
  ): QuotaBucket {
    this.db
      .prepare(
        'INSERT OR IGNORE INTO quota_bucket(id,scope,scope_id,period,token_limit,root_limit,call_limit) VALUES(?,?,?,?,?,?,?)',
      )
      .run(randomUUID(), scope, scopeId, period, limits.tokens, limits.roots, limits.calls ?? 0);
    return this.quota(scope, scopeId, period)!;
  }
  quota(scope: string, scopeId: string, period = now().slice(0, 10)): QuotaBucket | undefined {
    const r = this.db
      .prepare('SELECT * FROM quota_bucket WHERE scope=? AND scope_id=? AND period=?')
      .get(scope, scopeId, period) as any;
    return r
      ? {
          id: r.id,
          scope: r.scope,
          scopeId: r.scope_id,
          period: r.period,
          tokenLimit: r.token_limit,
          tokensUsed: r.tokens_used,
          tokensReserved: r.tokens_reserved,
          rootLimit: r.root_limit,
          rootsUsed: r.roots_used,
          callLimit: r.call_limit,
          callsUsed: r.calls_used,
        }
      : undefined;
  }
  consumeRoot(bucketIds: string[]): void {
    this.transaction(() => {
      for (const id of bucketIds)
        if (
          !this.db
            .prepare(
              'UPDATE quota_bucket SET roots_used=roots_used+1 WHERE id=? AND roots_used<root_limit',
            )
            .run(id).changes
        )
          throw new StoreError('QUOTA_EXCEEDED', 'Daily request quota exhausted', 429);
    });
  }
  reserveQuota(reservationId: string, bucketIds: string[], tokens: number): void {
    if (!Number.isSafeInteger(tokens) || tokens < 0)
      throw new StoreError('INVALID_INPUT', 'Invalid token reservation', 400);
    this.transaction(() => {
      const existing = this.db
        .prepare('SELECT * FROM quota_reservation WHERE id=?')
        .all(reservationId) as any[];
      if (existing.length) {
        if (
          existing.length !== bucketIds.length ||
          existing.some((r) => r.tokens !== tokens || !bucketIds.includes(r.bucket_id))
        )
          throw new StoreError('IDEMPOTENCY_CONFLICT', 'Reservation changed');
        return;
      }
      for (const id of bucketIds) {
        if (
          !this.db
            .prepare(
              'UPDATE quota_bucket SET tokens_reserved=tokens_reserved+?,calls_used=calls_used+1 WHERE id=? AND tokens_used+tokens_reserved+?<=token_limit AND (call_limit=0 OR calls_used<call_limit)',
            )
            .run(tokens, id, tokens).changes
        )
          throw new StoreError('QUOTA_EXCEEDED', 'Model budget exhausted', 429);
        this.db
          .prepare('INSERT INTO quota_reservation VALUES(?,?,?,?,?,?)')
          .run(reservationId, id, tokens, 'reserved', null, now());
      }
    });
  }
  settleQuota(reservationId: string, actualTokens: number | null): void {
    if (actualTokens !== null && (!Number.isSafeInteger(actualTokens) || actualTokens < 0))
      throw new StoreError('INVALID_INPUT', 'Invalid token usage', 400);
    this.transaction(() => {
      const rows = this.db
        .prepare("SELECT * FROM quota_reservation WHERE id=? AND status IN ('reserved','unknown')")
        .all(reservationId) as any[];
      for (const row of rows) {
        if (actualTokens === null)
          this.db
            .prepare("UPDATE quota_reservation SET status='unknown' WHERE id=? AND bucket_id=?")
            .run(reservationId, row.bucket_id);
        else {
          this.db
            .prepare(
              'UPDATE quota_bucket SET tokens_reserved=tokens_reserved-?,tokens_used=tokens_used+? WHERE id=?',
            )
            .run(row.tokens, actualTokens, row.bucket_id);
          this.db
            .prepare(
              "UPDATE quota_reservation SET status='settled',actual_tokens=? WHERE id=? AND bucket_id=?",
            )
            .run(actualTokens, reservationId, row.bucket_id);
        }
      }
    });
  }
  adjustQuota(
    bucketId: string,
    actorId: string,
    tokenDelta: number,
    rootDelta: number,
    reason: string,
    key: string,
  ): void {
    this.transaction(() => {
      const existing = this.db
        .prepare('SELECT * FROM quota_adjustment WHERE idempotency_key=?')
        .get(key) as any;
      if (existing) {
        if (
          existing.bucket_id !== bucketId ||
          existing.token_delta !== tokenDelta ||
          existing.root_delta !== rootDelta
        )
          throw new StoreError('IDEMPOTENCY_CONFLICT', 'Quota adjustment changed');
        return;
      }
      if (
        !this.db
          .prepare(
            'UPDATE quota_bucket SET token_limit=token_limit+?,root_limit=root_limit+? WHERE id=? AND token_limit+?>=0 AND root_limit+?>=0',
          )
          .run(tokenDelta, rootDelta, bucketId, tokenDelta, rootDelta).changes
      )
        throw new StoreError('INVALID_INPUT', 'Quota limits must remain nonnegative', 400);
      this.db
        .prepare('INSERT INTO quota_adjustment VALUES(?,?,?,?,?,?,?,?)')
        .run(randomUUID(), bucketId, actorId, tokenDelta, rootDelta, reason, key, now());
    });
  }
  applyPolicyQuotaLimits(
    limits: { tokens: number; roots: number; calls: number },
    actorId: string,
    reason: string,
    policyVersion: number,
  ): number {
    return this.transaction(() => {
      const buckets = this.db
        .prepare(
          "SELECT id,token_limit,root_limit FROM quota_bucket WHERE scope='principal' AND period=?",
        )
        .all(now().slice(0, 10)) as { id: string; token_limit: number; root_limit: number }[];
      let changed = 0;
      for (const bucket of buckets) {
        const tokenDelta = limits.tokens - bucket.token_limit,
          rootDelta = limits.roots - bucket.root_limit;
        if (!tokenDelta && !rootDelta) continue;
        this.adjustQuota(
          bucket.id,
          actorId,
          tokenDelta,
          rootDelta,
          reason,
          `policy:${policyVersion}:${bucket.id}`,
        );
        changed++;
      }
      // Tightening applies to live trees; raising a future-run limit cannot expand an existing tree.
      this.db
        .prepare(
          "UPDATE quota_bucket SET call_limit=? WHERE scope='run' AND (call_limit>? OR call_limit=0)",
        )
        .run(limits.calls, limits.calls);
      return changed;
    });
  }
  audit(
    actorId: string | null,
    action: string,
    resourceId: string,
    summary: object = {},
    requestId: string = randomUUID(),
    result = 'success',
  ): void {
    this.db
      .prepare('INSERT INTO audit_event VALUES(?,?,?,?,?,?,?,?)')
      .run(
        randomUUID(),
        actorId,
        action,
        resourceId,
        requestId,
        JSON.stringify(summary),
        result,
        now(),
      );
  }
  audits(limit = 100): any[] {
    return this.db
      .prepare('SELECT * FROM audit_event ORDER BY created_at DESC LIMIT ?')
      .all(limit)
      .map((r: any) => ({
        id: r.id,
        actorId: r.actor_id,
        action: r.action,
        resourceId: r.resource_id,
        requestId: r.request_id,
        summary: JSON.parse(r.summary_json),
        result: r.result,
        occurredAt: r.created_at,
      }));
  }
  close(): void {
    this.emitter.removeAllListeners();
    this.db.close();
  }
}
export { createAdmin, hashPassword, verifyPassword } from './admin.js';
