import { createHash } from 'node:crypto';
import { AppError, type Conversation } from '../../../packages/contracts/src/index.ts';
import { SqliteStore, type Stored } from '../../../packages/storage-sqlite/src/index.ts';
import type { SandboxPort } from '../../../packages/sandbox-client/src/types.ts';

export const GUEST_RETENTION_MS = 24 * 60 * 60 * 1000;
interface Principal {
  id?: string;
  kind?: string;
  status: string;
  displayId?: string;
  lastSeenAt?: string;
}
export function guestExpired(principal: Stored<Principal>, at = Date.now()): boolean {
  return (
    principal.data.kind === 'guest' && Date.parse(principal.createdAt) + GUEST_RETENTION_MS <= at
  );
}
export function authorizePrincipal(store: SqliteStore, ownerId: string, at = Date.now()): void {
  const principal = store.get<Principal>('principal', ownerId);
  if (!principal || principal.data.status !== 'active')
    throw new AppError('POLICY_DENIED', '当前身份无法执行', 403);
  if (guestExpired(principal, at))
    throw new AppError('AUTH_EXPIRED', '游客身份已过期，请重新进入工作台', 401);
}
export interface MaintenanceOptions {
  store: SqliteStore;
  sandbox: Pick<SandboxPort, 'deleteConversation'>;
  closeConversation: (ownerId: string, conversationId: string) => Promise<void>;
  purgeSdkSessions?: (sessionIds: string[]) => Promise<number>;
  now?: () => number;
}
export interface CleanupResult {
  deletedConversations: number;
  expiredPrincipals: number;
  failures: number;
}

/** Removal is resumable: a failed executor/file cleanup leaves a deleting record for the next pass. */
export function createMaintenance(options: MaintenanceOptions) {
  const { store } = options;
  const currentTime = options.now ?? Date.now;
  const deleting = new Map<string, Promise<void>>();
  let sweep: Promise<CleanupResult> | undefined;
  async function removeConversation(ownerId: string, conversationId: string): Promise<void> {
    const existing = store.get<Conversation>('conversation', conversationId, ownerId);
    if (!existing) throw new AppError('RESOURCE_NOT_FOUND', '会话不存在', 404);
    if (existing.data.status === 'deleted') return;
    store.put(
      'conversation',
      conversationId,
      { ...existing.data, status: 'deleting' },
      { ownerId },
    );
    const runs = store.list('run', { ownerId, conversationId, limit: 10000 });
    const tasks = store.list('task', { ownerId, conversationId, limit: 10000 });
    const ids = new Set(runs.map((run) => run.id));
    const sessionIds = [
      ...runs.flatMap((run) => [run.id, `${run.id}:summary`]),
      ...tasks.map((task) => task.id),
    ];
    await options.closeConversation(ownerId, conversationId);
    // core.close archives; retain the deleting marker until every storage boundary has acknowledged cleanup.
    const current = store.get<Conversation>('conversation', conversationId, ownerId)!;
    store.put('conversation', conversationId, { ...current.data, status: 'deleting' }, { ownerId });
    await options.sandbox.deleteConversation({ principalId: ownerId, conversationId });
    await options.purgeSdkSessions?.(sessionIds);
    store.transaction(() => {
      const calls = store.list('modelCall', { ownerId, conversationId, limit: 10000 });
      for (const call of calls) {
        const data = call.data,
          usage = data.usage ?? {};
        store.put(
          'modelCall',
          call.id,
          {
            id: call.id,
            ownerId,
            conversationId,
            rootRunId: data.rootRunId,
            modelId: data.modelId,
            taskId: data.taskId,
            status: data.status,
            startedAt: data.startedAt,
            finishedAt: data.finishedAt,
            usage: Object.fromEntries(
              [
                'status',
                'inputTokens',
                'outputTokens',
                'cachedInputTokens',
                'costMicros',
                'currency',
                'priceVersion',
              ]
                .filter((key) => usage[key] !== undefined)
                .map((key) => [key, usage[key]]),
            ),
            contentDeletedAt: new Date(currentTime()).toISOString(),
          },
          { ownerId, conversationId },
        );
      }
      // Entity kinds are extensible. Conversation ownership, rather than a fragile fixed kind list, drives removal.
      store.db
        .prepare(
          "DELETE FROM entity WHERE conversation_id=? AND owner_id=? AND kind NOT IN ('modelCall','conversation')",
        )
        .run(conversationId, ownerId);
      for (const runId of ids) store.delete('summary', runId);
      for (const runId of ids)
        store.db
          .prepare(
            "DELETE FROM entity WHERE kind='idempotency' AND json_extract(data_json,'$.runId')=?",
          )
          .run(runId);
      store.db
        .prepare(
          "DELETE FROM entity WHERE kind='conversation-request' AND owner_id=? AND json_extract(data_json,'$.conversationId')=?",
        )
        .run(ownerId, conversationId);
      store.db.prepare('DELETE FROM stream_event WHERE conversation_id=?').run(conversationId);
      store.db.prepare('DELETE FROM outbox WHERE aggregate_id=?').run(conversationId);
      store.db.prepare('DELETE FROM sequence WHERE conversation_id=?').run(conversationId);
      store.db
        .prepare(
          'DELETE FROM idempotency WHERE owner_id=? AND (route LIKE ? OR result_json LIKE ?)',
        )
        .run(ownerId, `%${conversationId}%`, `%${conversationId}%`);
      store.put(
        'conversation',
        conversationId,
        {
          id: conversationId,
          ownerId,
          workspaceId: '',
          title: '已删除',
          mode: existing.data.mode,
          status: 'deleted',
          createdAt: existing.data.createdAt,
          updatedAt: new Date(currentTime()).toISOString(),
          version: (store.get('conversation', conversationId)?.version ?? existing.version) + 1,
        },
        { ownerId },
      );
      store.audit(null, 'conversation.content.deleted', conversationId, {
        ownerHash: createHash('sha256').update(ownerId).digest('hex').slice(0, 16),
        runs: runs.length,
        tasks: tasks.length,
        modelCallsRetained: calls.length,
      });
    });
  }
  function deleteConversation(ownerId: string, conversationId: string): Promise<void> {
    const key = `${ownerId}:${conversationId}`;
    const prior = deleting.get(key);
    if (prior) return prior;
    const pending = removeConversation(ownerId, conversationId).finally(() => deleting.delete(key));
    deleting.set(key, pending);
    return pending;
  }
  async function runSweep(): Promise<CleanupResult> {
    const at = currentTime();
    const result: CleanupResult = { deletedConversations: 0, expiredPrincipals: 0, failures: 0 };
    const cutoff = new Date(at - GUEST_RETENTION_MS).toISOString();
    const expired = store.db
      .prepare(
        "SELECT id FROM entity WHERE kind='principal' AND json_extract(data_json,'$.kind')='guest' AND json_extract(data_json,'$.status')!='deleted' AND created_at<=? ORDER BY created_at LIMIT 1000",
      )
      .all(cutoff)
      .map((row) => store.get<Principal>('principal', String(row.id))!);
    store.transaction(() => {
      for (const principal of expired) {
        if (principal.data.status !== 'deleted') {
          result.expiredPrincipals++;
          store.put('principal', principal.id, {
            id: principal.id,
            kind: 'guest',
            status: 'deleted',
            displayId: '已过期访客',
            lastSeenAt: principal.data.lastSeenAt,
            contentExpiredAt: new Date(at).toISOString(),
          });
        }
        store.db.prepare("DELETE FROM entity WHERE kind='auth' AND owner_id=?").run(principal.id);
      }
    });
    const conversations = store.db
      .prepare(
        `SELECT c.id FROM entity c LEFT JOIN entity p ON p.kind='principal' AND p.id=c.owner_id
      WHERE c.kind='conversation' AND json_extract(c.data_json,'$.status')!='deleted'
      AND (json_extract(c.data_json,'$.status')='deleting' OR (json_extract(p.data_json,'$.kind')='guest' AND (p.created_at<=? OR c.created_at<=?)))
      ORDER BY c.created_at LIMIT 1000`,
      )
      .all(cutoff, cutoff)
      .map((row) => store.get<Conversation>('conversation', String(row.id))!);
    for (const conversation of conversations) {
      try {
        await deleteConversation(
          conversation.ownerId ?? conversation.data.ownerId,
          conversation.id,
        );
        result.deletedConversations++;
      } catch {
        result.failures++;
        store.audit(
          null,
          'retention.cleanup.failed',
          conversation.id,
          { retryable: true },
          undefined,
          'failed',
        );
      }
    }
    store.transaction(() => {
      // Short-lived rate keys and expired auth material need no long-term retention.
      store.db
        .prepare(
          "DELETE FROM entity WHERE kind='rate' AND CAST(json_extract(data_json,'$.expiresAt') AS INTEGER)<?",
        )
        .run(at);
      store.db
        .prepare("DELETE FROM entity WHERE kind='auth' AND json_extract(data_json,'$.expiresAt')<?")
        .run(new Date(at).toISOString());
      // Cost records contain only metering metadata; immutable security audits keep their separate retention contract.
      store.db
        .prepare(
          "DELETE FROM entity WHERE kind IN ('modelCall','admin-model-call') AND created_at<?",
        )
        .run(new Date(at - 30 * GUEST_RETENTION_MS).toISOString());
    });
    return result;
  }
  function sweepExpired(): Promise<CleanupResult> {
    if (!sweep)
      sweep = runSweep().finally(() => {
        sweep = undefined;
      });
    return sweep;
  }
  return { deleteConversation, sweepExpired };
}
