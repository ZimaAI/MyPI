import { createHash, randomUUID } from 'node:crypto';
import { AgentService } from '../../../packages/agent-core/src/index.ts';
import {
  AppError,
  type Conversation,
  type ModelConfig,
  type Mode,
  type Policy,
  type Run,
  type RuntimeFactory,
} from '../../../packages/contracts/src/index.ts';
import { SqliteStore } from '../../../packages/storage-sqlite/src/index.ts';
import {
  AgentEntityStore,
  SqliteBudget,
} from '../../../packages/storage-sqlite/src/entity-store.ts';
import {
  ModelRepository,
  SecretBox,
  effectivePolicy,
} from '../../../packages/storage-sqlite/src/security.ts';
import type { SandboxPort } from '../../../packages/sandbox-client/src/types.ts';
import { WORKSPACE_TEMPLATES } from '../../../packages/sandbox-client/src/templates.ts';
import { matchIntent, readActiveRules } from '../../../packages/policy/src/index.ts';
import { purgeRuntimeSessions } from '../../../packages/pi-adapter/src/index.ts';
import { createProjectImports } from './imports.ts';
import { authorizePrincipal, createMaintenance } from './maintenance.ts';
export interface WorkerOptions {
  store: SqliteStore;
  runtime: RuntimeFactory;
  sandbox: SandboxPort;
  masterKey: string;
  importsEnabled?: boolean;
  runtimeStateDir?: string;
  profile?: 'public-demo' | 'trusted-local' | 'local-docker';
  globalBudget?: { tokens: number; roots: number };
  resolveModel?: (id?: string) => ModelConfig;
}
export function createWorkerServices(options: WorkerOptions) {
  const { store, sandbox, runtime } = options,
    entities = new AgentEntityStore(store),
    models = new ModelRepository(store, new SecretBox(options.masterKey));
  const authorize = (ownerId: string) => authorizePrincipal(store, ownerId);
  const ownConversation = (ownerId: string, id: string) => {
    authorize(ownerId);
    const c = store.get<Conversation>('conversation', id, ownerId)?.data;
    if (!c || c.status === 'deleted' || c.status === 'deleting')
      throw new AppError('RESOURCE_NOT_FOUND', '会话不存在', 404);
    return c;
  };
  const core = new AgentService({
    store: entities,
    runtime,
    sandbox,
    resolveModel: options.resolveModel ?? ((id) => models.resolveModel(id)),
    policy: () => effectivePolicy(store),
    authorize,
    profile: options.profile ?? 'public-demo',
    budget: new SqliteBudget(store, options.globalBudget),
  });
  const imports = createProjectImports(store, sandbox, options.importsEnabled ?? false, authorize);
  const maintenance = createMaintenance({
    store,
    sandbox,
    closeConversation: async (ownerId, id) => {
      await imports.cancelImport(id);
      await core.close(ownerId, id);
    },
    purgeSdkSessions: options.runtimeStateDir
      ? (ids) => purgeRuntimeSessions(options.runtimeStateDir!, ids)
      : undefined,
  });
  const creating = new Map<string, Promise<Conversation>>();
  const createConversation = async (
    ownerId: string,
    input: { title?: string; mode: Mode; templateId: string },
    key: string,
  ) => {
    authorize(ownerId);
    if (!key || key.length > 128) throw new AppError('INVALID_INPUT', '无效幂等键');
    const id = `${ownerId}:${key}`,
      hash = createHash('sha256').update(JSON.stringify(input)).digest('hex');
    const existing = store.get<{ hash: string; conversationId: string }>(
      'conversation-request',
      id,
    );
    if (existing) {
      if (existing.data.hash !== hash)
        throw new AppError('IDEMPOTENCY_CONFLICT', '幂等请求内容不一致', 409);
      return ownConversation(ownerId, existing.data.conversationId);
    }
    if (creating.has(id)) {
      const c = await creating.get(id)!;
      const saved = store.get<{ hash: string }>('conversation-request', id)!;
      if (saved.data.hash !== hash)
        throw new AppError('IDEMPOTENCY_CONFLICT', '幂等请求内容不一致', 409);
      return c;
    }
    if (
      store.list('conversation', { ownerId }).filter((c) => c.data.status !== 'deleted').length >=
      50
    )
      throw new AppError('QUOTA_EXCEEDED', '会话数量已达上限', 429);
    const promise = (async () => {
      const c = await core.open({ ownerId, ...input });
      store.put('conversation-request', id, { hash, conversationId: c.id }, { ownerId });
      return c;
    })();
    creating.set(id, promise);
    try {
      return await promise;
    } finally {
      creating.delete(id);
    }
  };
  const services = {
    createConversation,
    importProject: imports.importProject,
    submit: async (
      ownerId: string,
      id: string,
      input: { text: string; mode: Mode; modelId?: string },
      key: string,
    ) => {
      authorize(ownerId);
      const run = await core.submit(ownerId, id, input, key);
      return {
        runId: run.id,
        id: run.id,
        conversationId: id,
        status: run.status,
        queuePosition: 0,
        effectiveMode: run.mode,
        configVersion: run.model.configVersion,
      };
    },
    cancel: (ownerId: string, id: string) => core.cancel(ownerId, id),
    cancelTask: async (ownerId: string, id: string) => {
      await core.cancelTask(ownerId, id);
      return entities.get('task', id);
    },
    workspace: async (ownerId: string, id: string) => {
      const c = ownConversation(ownerId, id);
      return {
        revision: (await sandbox.createWorkspace({ principalId: ownerId, conversationId: id }))
          .revision,
        files: await sandbox.workspaceFiles({
          principalId: ownerId,
          conversationId: id,
          workspaceId: c.workspaceId,
        }),
        patches: entities.list('patch', { ownerId, conversationId: id }),
        templates: WORKSPACE_TEMPLATES,
      };
    },
    file: async (ownerId: string, id: string, path: string) => {
      const c = ownConversation(ownerId, id);
      return sandbox.workspaceRead({
        principalId: ownerId,
        conversationId: id,
        workspaceId: c.workspaceId,
        path,
      });
    },
    artifact: async (ownerId: string, id: string) => {
      authorize(ownerId);
      const artifact = store.get<{ name: string; content: string; mime: string }>(
        'artifact',
        id,
        ownerId,
      );
      if (!artifact) throw new AppError('RESOURCE_NOT_FOUND', '产物不存在', 404);
      return artifact.data;
    },
    processes: async (ownerId: string, id: string) => {
      ownConversation(ownerId, id);
      return { items: await sandbox.backgroundList({ principalId: ownerId, conversationId: id }) };
    },
    stopProcess: async (ownerId: string, id: string, processId: string) => {
      ownConversation(ownerId, id);
      return sandbox.backgroundStop({ principalId: ownerId, conversationId: id, processId });
    },
    applyPatch: async (ownerId: string, id: string, taskId: string, baseRevision: string) => {
      const c = ownConversation(ownerId, id);
      const patch = store.get<{ workspaceId: string }>('patch', taskId, ownerId);
      if (!patch || patch.conversationId !== id)
        throw new AppError('RESOURCE_NOT_FOUND', '变更不存在', 404);
      const workspace = await sandbox.applyWorkspace({
        principalId: ownerId,
        conversationId: id,
        workspaceId: patch.data.workspaceId,
        baseRevision,
      });
      c.version++;
      store.put('conversation', id, c, { ownerId, conversationId: id });
      store.audit(ownerId, 'workspace.patch.applied', taskId, { baseRevision });
      return workspace;
    },
    exportFile: async (ownerId: string, id: string, path: string) => {
      const c = ownConversation(ownerId, id);
      const file = await sandbox.workspaceRead({
        principalId: ownerId,
        conversationId: id,
        workspaceId: c.workspaceId,
        path,
      });
      if (file.binary) throw new AppError('UNSUPPORTED_FILE', '二进制文件不支持文本导出', 415);
      if (file.truncated)
        throw new AppError('LIMIT_EXCEEDED', '文件超过当前文本导出上限，未生成不完整产物', 413);
      const content = file.content;
      const artifactId = randomUUID();
      const item = {
        id: artifactId,
        name: path.split('/').pop() ?? 'artifact.txt',
        content,
        mime: 'text/plain',
        sha256: createHash('sha256').update(content).digest('hex'),
      };
      store.put('artifact', artifactId, item, { ownerId, conversationId: id });
      return { artifactId, name: item.name };
    },
    testModel: async (model: ModelConfig) => {
      const testOutputTokens = Math.min(model.maxOutputTokens, model.reasoning ? 2048 : 32);
      const start = Date.now(),
        controller = new AbortController(),
        timer = setTimeout(() => controller.abort(), 30000),
        sessionId = `model-test:${randomUUID()}`;
      let session: Awaited<ReturnType<RuntimeFactory['create']>> | undefined;
      try {
        session = await runtime.create({
          sessionId,
          model: { ...model, maxOutputTokens: testOutputTokens },
          tools: [],
          onEvent: () => {},
          beforeModelCall: async (input = 1024) => {
            const bucket = store.ensureQuota('admin', 'model-tests', {
              tokens: 10000,
              roots: 100,
              calls: 100,
            });
            const id = randomUUID();
            store.reserveQuota(id, [bucket.id], input + testOutputTokens);
            return id;
          },
          afterModelCall: async (id, usage) =>
            store.settleQuota(
              id,
              usage.status === 'unknown'
                ? null
                : (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0),
            ),
        });
        const result = await session.prompt('Reply with exactly OK.', controller.signal);
        if (!result.text.trim())
          throw new AppError(
            'MODEL_TEST_EMPTY',
            '模型未返回可见文本，请检查输出预算和思考设置',
            502,
          );
        return {
          ok: true,
          latencyMs: Date.now() - start,
          usageKnown: result.usage.status !== 'unknown',
          errorCode: null,
          usage: result.usage,
        };
      } finally {
        clearTimeout(timer);
        await session?.close();
        if (options.runtimeStateDir)
          await purgeRuntimeSessions(options.runtimeStateDir, [sessionId]);
      }
    },
    ruleTest: async (input: { text: string; mode: Mode; simulatedSource?: string }) =>
      matchIntent(
        input.text,
        input.mode,
        input.simulatedSource ?? 'human',
        readActiveRules(entities),
      ),
    ready: async () => {
      const health = await sandbox.health();
      return {
        ready:
          health.ready &&
          (options.profile === 'local-docker'
            ? health.profile === 'isolated-local' && health.localExecutionEnabled === true
            : options.profile === 'trusted-local' || health.profile === 'isolated'),
        sandboxEnforced:
          health.ready && health.profile === 'isolated' && health.publicExecutionEnabled,
        profile: health.profile,
        publicExecutionEnabled: effectivePolicy(store).publicExecution,
        sandboxReason: health.reason,
      };
    },
    deleteConversation: async (ownerId: string, id: string) => {
      authorize(ownerId);
      await imports.cancelImport(id);
      return maintenance.deleteConversation(ownerId, id);
    },
    archiveConversation: async (ownerId: string, id: string) => {
      ownConversation(ownerId, id);
      await imports.cancelImport(id);
      await core.close(ownerId, id);
    },
  };
  return { core, services, store, maintenance, shutdownImports: imports.shutdown };
}
