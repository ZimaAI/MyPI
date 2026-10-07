import type { EntityStore, AgentEvent, Policy, Run, Usage } from '../../contracts/src/index.ts';
import { AppError } from '../../contracts/src/index.ts';
import { randomUUID } from 'node:crypto';
import { SqliteStore } from './index.ts';
export class AgentEntityStore implements EntityStore {
  constructor(readonly sqlite: SqliteStore) {}
  get<T>(kind: string, id: string): T | undefined {
    return this.sqlite.get<T>(kind, id)?.data;
  }
  list<T>(kind: string, filter?: { ownerId?: string; conversationId?: string }): T[] {
    return this.sqlite.list<T>(kind, { ...filter, limit: 10000 }).map((r) => r.data);
  }
  put<T extends { id: string }>(
    kind: string,
    entity: T,
    ownerId?: string,
    conversationId?: string,
  ): T {
    this.sqlite.put(kind, entity.id, entity, { ownerId, conversationId });
    return entity;
  }
  delete(kind: string, id: string) {
    this.sqlite.delete(kind, id);
  }
  transaction<T>(fn: () => T) {
    return this.sqlite.transaction(fn);
  }
  appendEvent(
    conversationId: string,
    runId: string | null,
    type: string,
    payload: Record<string, unknown>,
  ): AgentEvent {
    return this.sqlite.appendEvent(conversationId, runId, type, payload);
  }
  events(conversationId: string, after = 0) {
    return this.sqlite.events(conversationId, after, 10000);
  }
}
/** Uses the same quota ledger that administrators inspect and adjust. */
export class SqliteBudget {
  constructor(readonly store: SqliteStore) {}
  private buckets(ownerId: string, p: Policy) {
    return [
      this.store.ensureQuota('principal', ownerId, {
        tokens: p.dailyTokens,
        roots: p.dailyRootRuns,
      }),
      this.store.ensureQuota('global', 'global', { tokens: 500000, roots: 1000 }),
    ];
  }
  accept(ownerId: string, p: Policy) {
    this.store.transaction(() => this.store.consumeRoot(this.buckets(ownerId, p).map((b) => b.id)));
  }
  reserve(run: Run, p: Policy, inputUpperBound: number) {
    if (Date.now() >= Date.parse(run.deadline)) throw new AppError('TIMEOUT', '请求已超时', 408);
    return this.store.transaction(() => {
      const tokenUpper = Math.ceil(inputUpperBound) + run.model.maxOutputTokens;
      const buckets = this.buckets(run.ownerId, p);
      const root = this.store.ensureQuota(
        'run',
        run.budgetRootRunId,
        { tokens: p.dailyTokens, roots: 1, calls: p.maxModelCalls },
        'run',
      );
      const id = randomUUID();
      this.store.reserveQuota(id, [...buckets.map((b) => b.id), root.id], tokenUpper);
      return id;
    });
  }
  settle(id: string, usage: Usage) {
    this.store.settleQuota(
      id,
      usage.status !== 'unknown' && usage.inputTokens !== null && usage.outputTokens !== null
        ? usage.inputTokens + usage.outputTokens
        : null,
    );
  }
  remaining(ownerId: string, p: Policy) {
    const b = this.buckets(ownerId, p)[0];
    return {
      remainingRootRuns: Math.max(0, b.rootLimit - b.rootsUsed),
      remainingTokens: Math.max(0, b.tokenLimit - b.tokensUsed - b.tokensReserved),
      reservedTokens: b.tokensReserved,
    };
  }
}
