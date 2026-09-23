import { createHash, randomUUID } from 'node:crypto';
import { AppError, terminalRun, type Conversation } from '../../../packages/contracts/src/index.ts';
import { ProjectImporter } from '../../../packages/project-import/src/index.ts';
import type { SandboxPort } from '../../../packages/sandbox-client/src/types.ts';
import type { SqliteStore } from '../../../packages/storage-sqlite/src/index.ts';

export type ProjectImportInput =
  | { kind: 'zip'; archiveBase64: string; expectedRevision: string }
  | { kind: 'github'; url: string; ref?: string; expectedRevision: string };
export function createProjectImports(
  store: SqliteStore,
  sandbox: SandboxPort,
  enabled: boolean,
  authorize: (ownerId: string) => void,
) {
  const importer = new ProjectImporter({ enabled });
  const active = new Map<
    string,
    { ownerId: string; controller: AbortController; promise: Promise<unknown> }
  >();
  // The single Worker never resumes an interrupted external download after a restart.
  store.transaction(() => {
    for (const row of store.list('project-import'))
      if (row.data.status === 'running')
        store.put('project-import', row.id, { ...row.data, status: 'failed' });
    for (const row of store.list<Conversation>('conversation'))
      if (row.data.status === 'importing')
        store.put('conversation', row.id, { ...row.data, status: 'active' });
  });
  async function importProject(
    ownerId: string,
    conversationId: string,
    input: ProjectImportInput,
    key: string,
  ) {
    authorize(ownerId);
    if (!enabled) throw new AppError('FEATURE_DISABLED', '项目导入尚未启用', 503);
    if (!key || key.length > 128) throw new AppError('INVALID_INPUT', '无效幂等键');
    const requestId = `${ownerId}:${conversationId}:${key}`,
      hash = createHash('sha256').update(JSON.stringify(input)).digest('hex');
    const previous = store.get<any>('project-import', requestId, ownerId);
    if (previous) {
      if (previous.data.hash !== hash)
        throw new AppError('IDEMPOTENCY_CONFLICT', '幂等请求内容不一致', 409);
      if (previous.data.status === 'completed') return previous.data.result;
      throw new AppError('IMPORT_CONFLICT', '该导入已开始或已失败，请刷新后重试', 409);
    }
    const c = store.get<Conversation>('conversation', conversationId, ownerId)?.data;
    if (!c || c.status === 'deleted' || c.status === 'deleting')
      throw new AppError('RESOURCE_NOT_FOUND', '会话不存在', 404);
    if (
      c.status !== 'active' ||
      [...active.values()].some((item) => item.ownerId === ownerId) ||
      store.list('run', { ownerId, conversationId }).some((r) => !terminalRun(r.data.status))
    )
      throw new AppError('RUN_CONFLICT', '请等待当前任务或导入结束', 409);
    if (
      (await sandbox.backgroundList({ principalId: ownerId, conversationId })).some(
        (p) => p.status === 'running',
      )
    )
      throw new AppError('RUN_CONFLICT', '请先停止后台进程', 409);
    // Recheck after the asynchronous process lookup, then claim the workspace before yielding.
    authorize(ownerId);
    const latest = store.get<Conversation>('conversation', conversationId, ownerId)!;
    if (
      latest.data.status !== 'active' ||
      [...active.values()].some((item) => item.ownerId === ownerId) ||
      store.list('run', { ownerId, conversationId }).some((r) => !terminalRun(r.data.status))
    )
      throw new AppError('RUN_CONFLICT', '会话状态已改变，请重试', 409);
    store.transaction(() => {
      store.put(
        'conversation',
        conversationId,
        { ...latest.data, status: 'importing' },
        { expectedVersion: latest.version },
      );
      store.put(
        'project-import',
        requestId,
        { id: randomUUID(), hash, status: 'running', kind: input.kind },
        { ownerId, conversationId },
      );
    });
    const controller = new AbortController();
    const promise = (async () => {
      try {
        const result =
          input.kind === 'zip'
            ? await importer.fromZip(Buffer.from(input.archiveBase64, 'base64'), {
                signal: controller.signal,
              })
            : await importer.fromGitHub(input.url, { ref: input.ref, signal: controller.signal });
        authorize(ownerId);
        controller.signal.throwIfAborted();
        const workspace = await sandbox.importWorkspace({
          principalId: ownerId,
          conversationId,
          workspaceId: c.workspaceId,
          files: result.files,
          expectedRevision: input.expectedRevision,
        });
        const summary = {
          workspaceId: workspace.workspaceId,
          revision: workspace.revision,
          fileCount: result.fileCount,
          totalBytes: result.totalBytes,
          source: result.source,
          omittedPaths: result.omittedPaths,
        };
        store.transaction(() => {
          store.put(
            'project-import',
            requestId,
            { hash, status: 'completed', result: summary },
            { ownerId, conversationId },
          );
          store.audit(ownerId, 'workspace.imported', conversationId, {
            kind: input.kind,
            fileCount: result.fileCount,
            totalBytes: result.totalBytes,
          });
        });
        return summary;
      } catch (error) {
        store.put(
          'project-import',
          requestId,
          { hash, status: 'failed' },
          { ownerId, conversationId },
        );
        const code = (error as any)?.code;
        throw error instanceof AppError
          ? error
          : new AppError(
              typeof code === 'string' ? code : 'IMPORT_FAILED',
              error instanceof Error ? error.message : '导入失败',
              code === 'CONFLICT' ? 409 : 400,
            );
      } finally {
        const current = store.get<Conversation>('conversation', conversationId, ownerId);
        if (current?.data.status === 'importing')
          store.put(
            'conversation',
            conversationId,
            { ...current.data, status: 'active', updatedAt: new Date().toISOString() },
            { expectedVersion: current.version },
          );
        active.delete(conversationId);
      }
    })();
    active.set(conversationId, { ownerId, controller, promise });
    return promise;
  }
  async function cancelImport(conversationId: string) {
    const job = active.get(conversationId);
    if (job) {
      job.controller.abort();
      await job.promise.catch(() => {});
    }
  }
  return {
    importProject,
    cancelImport,
    shutdown: () => Promise.all([...active.keys()].map(cancelImport)),
  };
}
