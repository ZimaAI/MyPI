import { randomUUID } from 'node:crypto';
import {
  AppError,
  type EntityStore,
  type Policy,
  type Run,
  type Usage,
} from '../../contracts/src/index.ts';
interface Bucket {
  id: string;
  roots: number;
  tokens: number;
  calls: number;
}
interface Reservation {
  id: string;
  bucketIds: string[];
  tokens: number;
  settled: boolean;
  usage?: Usage;
}
export class BudgetService {
  constructor(private store: EntityStore) {}
  private bucket(id: string): Bucket {
    return this.store.get<Bucket>('budget', id) ?? { id, roots: 0, tokens: 0, calls: 0 };
  }
  accept(ownerId: string, policy: Policy) {
    this.store.transaction(() => {
      const day = new Date().toISOString().slice(0, 10);
      for (const id of [`owner:${ownerId}:${day}`, `global:${day}`]) {
        const b = this.bucket(id),
          limit = id.startsWith('global') ? 1000 : policy.dailyRootRuns;
        if (b.roots >= limit) throw new AppError('QUOTA_EXCEEDED', '今日请求额度已用完', 429);
        b.roots++;
        this.store.put('budget', b);
      }
    });
  }
  reserve(run: Run, policy: Policy, inputUpperBound: number) {
    return this.store.transaction(() => {
      if (Date.now() >= Date.parse(run.deadline)) throw new AppError('TIMEOUT', '请求已超时', 408);
      const day = new Date().toISOString().slice(0, 10),
        ids = [`owner:${run.ownerId}:${day}`, `global:${day}`, `root:${run.budgetRootRunId}`];
      const tokens = Math.max(1, Math.ceil(inputUpperBound)) + run.model.maxOutputTokens;
      for (const id of ids) {
        const b = this.bucket(id);
        const limit = id.startsWith('global') ? 500000 : policy.dailyTokens;
        if (b.tokens + tokens > limit || (id.startsWith('root') && b.calls >= policy.maxModelCalls))
          throw new AppError('QUOTA_EXCEEDED', '请求树预算不足', 429);
        b.tokens += tokens;
        b.calls++;
        this.store.put('budget', b);
      }
      const r: Reservation = { id: randomUUID(), bucketIds: ids, tokens, settled: false };
      this.store.put('reservation', r, run.ownerId, run.conversationId);
      return r.id;
    });
  }
  settle(id: string, usage: Usage) {
    this.store.transaction(() => {
      const r = this.store.get<Reservation>('reservation', id);
      if (!r || r.settled) return;
      r.settled = true;
      r.usage = usage;
      const actual =
        usage.status !== 'unknown' && usage.inputTokens !== null && usage.outputTokens !== null
          ? usage.inputTokens + usage.outputTokens
          : null;
      if (actual !== null) {
        for (const bid of r.bucketIds) {
          const b = this.bucket(bid);
          b.tokens = Math.max(0, b.tokens - r.tokens + actual);
          this.store.put('budget', b);
        }
      }
      this.store.put('reservation', r);
    });
  }
  remaining(ownerId: string, p: Policy) {
    const b = this.bucket(`owner:${ownerId}:${new Date().toISOString().slice(0, 10)}`);
    return {
      remainingRootRuns: Math.max(0, p.dailyRootRuns - b.roots),
      remainingTokens: Math.max(0, p.dailyTokens - b.tokens),
      reservedTokens: b.tokens,
    };
  }
}
export class Semaphore {
  private active = 0;
  private queue: {
    resolve: (release: () => void) => void;
    reject: (e: unknown) => void;
    signal: AbortSignal;
    abort: () => void;
  }[] = [];
  constructor(private limit: number) {}
  setLimit(limit: number) {
    this.limit = Math.max(0, limit);
    this.drain();
  }
  async acquire(signal: AbortSignal): Promise<() => void> {
    signal.throwIfAborted();
    if (this.active < this.limit) {
      this.active++;
      return this.releaser();
    }
    return new Promise((resolve, reject) => {
      const item = {
        resolve,
        reject,
        signal,
        abort: () => {
          this.queue = this.queue.filter((x) => x !== item);
          reject(signal.reason);
        },
      };
      signal.addEventListener('abort', item.abort, { once: true });
      this.queue.push(item);
    });
  }
  private drain() {
    while (this.active < this.limit && this.queue.length) {
      const next = this.queue.shift()!;
      next.signal.removeEventListener('abort', next.abort);
      if (next.signal.aborted) {
        next.reject(next.signal.reason);
        continue;
      }
      this.active++;
      next.resolve(this.releaser());
    }
  }
  private releaser() {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.active--;
      this.drain();
    };
  }
}
