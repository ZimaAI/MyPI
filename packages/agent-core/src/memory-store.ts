import { randomUUID } from 'node:crypto';
import type { AgentEvent, EntityStore } from '../../contracts/src/index.ts';
export class MemoryStore implements EntityStore {
  private records = new Map<
    string,
    { entity: unknown; ownerId?: string; conversationId?: string }
  >();
  private log: AgentEvent[] = [];
  get<T>(kind: string, id: string): T | undefined {
    return structuredClone(this.records.get(`${kind}:${id}`)?.entity) as T | undefined;
  }
  list<T>(kind: string, filter: { ownerId?: string; conversationId?: string } = {}): T[] {
    return [...this.records.entries()]
      .filter(
        ([key, v]) =>
          key.startsWith(kind + ':') &&
          (!filter.ownerId || v.ownerId === filter.ownerId) &&
          (!filter.conversationId || v.conversationId === filter.conversationId),
      )
      .map(([, v]) => structuredClone(v.entity) as T);
  }
  put<T extends { id: string }>(
    kind: string,
    entity: T,
    ownerId?: string,
    conversationId?: string,
  ): T {
    this.records.set(`${kind}:${entity.id}`, {
      entity: structuredClone(entity),
      ownerId,
      conversationId,
    });
    return entity;
  }
  delete(kind: string, id: string) {
    this.records.delete(`${kind}:${id}`);
  }
  transaction<T>(fn: () => T): T {
    const before = structuredClone(this.records),
      log = structuredClone(this.log);
    try {
      return fn();
    } catch (e) {
      this.records = before;
      this.log = log;
      throw e;
    }
  }
  appendEvent(
    conversationId: string,
    runId: string | null,
    type: string,
    payload: Record<string, unknown>,
  ): AgentEvent {
    const sequence = this.log.filter((e) => e.conversationId === conversationId).length + 1;
    const e: AgentEvent = {
      schemaVersion: 1,
      eventId: randomUUID(),
      sequence,
      type,
      conversationId,
      runId,
      occurredAt: new Date().toISOString(),
      payload,
    };
    this.log.push(e);
    return e;
  }
  events(conversationId: string, after = 0) {
    return this.log.filter((e) => e.conversationId === conversationId && e.sequence > after);
  }
}
