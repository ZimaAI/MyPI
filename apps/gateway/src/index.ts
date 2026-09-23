import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import cookie from '@fastify/cookie';
import { randomBytes, randomUUID } from 'node:crypto';
import { SqliteStore, StoreError, type Stored } from '@mypi/storage-sqlite';
import { defaultPolicy, terminalRun, type Conversation, type Policy } from '@mypi/contracts';
import {
  approvedEndpoints,
  csrfToken,
  effectivePolicy,
  hashPassword,
  ModelRepository,
  scrub,
  SecretBox,
  sha256,
  verifyPassword,
  type StoredModel,
} from './security.js';
import type { GatewayServices } from './services.js';
import { readActiveRules } from '@mypi/policy';
import { AgentEntityStore } from '../../../packages/storage-sqlite/src/entity-store.ts';
import { registerRuleRoutes } from './rules.js';
export { ModelRepository, SecretBox, effectivePolicy, hashPassword } from './security.js';
export type { GatewayServices } from './services.js';

interface Principal {
  id: string;
  kind: 'guest' | 'admin';
  displayId: string;
  status: 'active' | 'banned' | 'deleted';
  passwordHash?: string;
  username?: string;
  lastSeenAt: string;
  bannedUntil?: string;
}
interface AuthSession {
  principalId: string;
  tokenHash: string;
  csrfHash: string;
  expiresAt: string;
  revoked: boolean;
}
interface AuthContext {
  principal: Stored<Principal>;
  session: Stored<AuthSession>;
  token: string;
}
export interface GatewayOptions {
  store: SqliteStore;
  services: GatewayServices;
  origin: string;
  masterKey: string;
  cookieSecret: string;
  secureCookies?: boolean;
  publicProfile?: boolean;
  importsEnabled?: boolean;
  logger?: boolean;
  eventPollMs?: number;
}
const timestamp = () => new Date().toISOString();
const string = (minLength = 1, maxLength = 100) => ({ type: 'string', minLength, maxLength });
const integer = (minimum = 0, maximum = 10000000) => ({ type: 'integer', minimum, maximum });
const boolean = { type: 'boolean' };
const mode = { type: 'string', enum: ['native', 'explicit'] };
const object = (properties: Record<string, any>, required: string[] = []) => ({
  type: 'object',
  properties,
  required,
  additionalProperties: false,
});
const reasonSchema = string(3, 500);
const idParams = object({ id: string(1, 128) }, ['id']);
const invalid = (message: string) => new StoreError('INVALID_INPUT', message, 400);
const unavailable = () =>
  new StoreError('SANDBOX_UNAVAILABLE', 'The isolated execution service is unavailable', 503);
const publicConversation = (row: Stored<Conversation>, store: SqliteStore) => ({
  id: row.id,
  title: row.data.title,
  mode: row.data.mode,
  status: row.data.status,
  version: row.version,
  createdAt: row.createdAt,
  lastSequence: store.lastSequence(row.id),
});

export { createAdmin } from '@mypi/storage-sqlite';

export async function createGateway(options: GatewayOptions): Promise<FastifyInstance> {
  const { store, services } = options;
  if (options.cookieSecret.length < 32)
    throw new Error('Cookie secret must contain at least 32 characters');
  const origin = new URL(options.origin).origin;
  if (options.publicProfile && (!options.secureCookies || !origin.startsWith('https://')))
    throw new Error('Public profile requires HTTPS and Secure cookies');
  const app = Fastify({
    logger: options.logger ?? false,
    bodyLimit: 32768,
    ajv: { customOptions: { removeAdditional: false } },
    trustProxy: false,
  });
  await app.register(cookie);
  const models = new ModelRepository(store, new SecretBox(options.masterKey));
  const guestCookie = options.secureCookies ? '__Host-mypi_guest' : 'mypi_guest';
  const adminCookie = options.secureCookies ? '__Host-mypi_admin' : 'mypi_admin';
  const cookieOptions = {
    path: '/',
    httpOnly: true,
    secure: !!options.secureCookies,
    sameSite: 'lax' as const,
    maxAge: 86400,
  };
  const authContexts = new WeakMap<FastifyRequest, AuthContext>();
  const streams = new Map<string, Set<() => void>>();
  if (!store.get('policy', 'current')) store.put('policy', 'current', { ...defaultPolicy });
  const policy = () => effectivePolicy(store);
  const quotas = (ownerId: string) =>
    store.ensureQuota('principal', ownerId, {
      tokens: policy().dailyTokens,
      roots: policy().dailyRootRuns,
    });
  const quotaView = (ownerId: string) => {
    const q = quotas(ownerId);
    return {
      dailyRootRuns: q.rootLimit,
      usedRootRuns: q.rootsUsed,
      dailyTokens: q.tokenLimit,
      usedTokens: q.tokensUsed,
      reservedTokens: q.tokensReserved,
      resetAt: new Date(new Date().setUTCHours(24, 0, 0, 0)).toISOString(),
    };
  };
  const principalView = (p: Stored<Principal>) => {
    const q = quotaView(p.id);
    return {
      id: p.id,
      displayId: p.data.displayId,
      status: p.data.status,
      usedRootRuns: q.usedRootRuns,
      usedTokens: q.usedTokens,
      dailyRootRuns: q.dailyRootRuns,
      dailyTokens: q.dailyTokens,
      lastSeenAt: p.data.lastSeenAt,
      version: p.version,
    };
  };
  const policyView = () => {
    const p = policy();
    return {
      version: p.version,
      publicExecutionEnabled: p.publicExecution,
      dailyRootRuns: p.dailyRootRuns,
      dailyTokens: p.dailyTokens,
      globalModelConcurrency: p.maxConcurrentModels,
      rootDeadlineSeconds: p.runTimeoutMs / 1000,
      allowedGroups: p.allowedGroups,
      maxModelCalls: p.maxModelCalls,
      maxUserConcurrentModels: p.maxUserConcurrentModels,
      maxChildren: p.maxChildren,
      processTtlSeconds: p.processTtlSeconds,
    };
  };
  function rate(key: string, limit: number, windowMs: number): void {
    store.transaction(() => {
      const period = Math.floor(Date.now() / windowMs),
        id = sha256(`${key}:${period}`),
        row = store.get<{ count: number }>('rate', id),
        count = (row?.data.count ?? 0) + 1;
      if (count > limit)
        throw new StoreError('RATE_LIMITED', 'Too many requests; try again later', 429);
      store.put('rate', id, { count, expiresAt: Date.now() + windowMs });
    });
  }
  function readAuth(request: FastifyRequest, kind: 'guest' | 'admin'): AuthContext | undefined {
    const token = request.cookies[kind === 'admin' ? adminCookie : guestCookie];
    if (!token) return;
    const session = store.get<AuthSession>('auth', sha256(token));
    if (!session || session.data.revoked || Date.parse(session.data.expiresAt) <= Date.now())
      return;
    let principal = store.get<Principal>('principal', session.data.principalId);
    if (!principal || principal.data.kind !== kind || principal.data.status === 'deleted') return;
    if (
      principal.data.status === 'banned' &&
      principal.data.bannedUntil &&
      Date.parse(principal.data.bannedUntil) <= Date.now()
    )
      principal = store.put('principal', principal.id, { ...principal.data, status: 'active' });
    if (Date.now() - Date.parse(principal.data.lastSeenAt) > 60000)
      principal = store.put('principal', principal.id, {
        ...principal.data,
        lastSeenAt: timestamp(),
      });
    return { principal, session, token };
  }
  function issueAuth(principal: Stored<Principal>): {
    token: string;
    csrf: string;
    expiresAt: string;
  } {
    const token = randomBytes(32).toString('base64url'),
      csrf = csrfToken(token, options.cookieSecret),
      expiresAt = new Date(Date.now() + 86400000).toISOString();
    store.put<AuthSession>(
      'auth',
      sha256(token),
      {
        principalId: principal.id,
        tokenHash: sha256(token),
        csrfHash: sha256(csrf),
        expiresAt,
        revoked: false,
      },
      { ownerId: principal.id },
    );
    return { token, csrf, expiresAt };
  }
  const auth = (request: FastifyRequest) => authContexts.get(request)!;
  const ownConversation = (ownerId: string, id: string) => {
    const row = store.get<Conversation>('conversation', id, ownerId);
    if (!row || row.data.status === 'deleted')
      throw new StoreError('RESOURCE_NOT_FOUND', 'Conversation not found', 404);
    return row;
  };
  const own = (kind: string, id: string, ownerId: string) => {
    const row = store.get(kind, id, ownerId);
    if (!row) throw new StoreError('RESOURCE_NOT_FOUND', 'Resource not found', 404);
    return row;
  };
  const key = (request: FastifyRequest) => {
    const value = request.headers['idempotency-key'];
    if (typeof value !== 'string' || value.length < 16 || value.length > 128)
      throw invalid('Idempotency-Key must contain 16 to 128 characters');
    return value;
  };
  const body = (request: FastifyRequest) => request.body as Record<string, any>;
  const params = (request: FastifyRequest) => request.params as { id: string };
  app.setErrorHandler((error, request, reply) => {
    const typed = error as any,
      status = typed.validation
        ? 400
        : typeof typed.statusCode === 'number'
          ? typed.statusCode
          : 500;
    const code = typed.validation
      ? 'INVALID_INPUT'
      : status === 413
        ? 'PAYLOAD_TOO_LARGE'
        : status === 500
          ? 'INTERNAL_ERROR'
          : (typed.code ?? 'INVALID_INPUT');
    reply.code(status).send({
      code,
      message:
        status === 500
          ? 'The request could not be completed'
          : typed.validation
            ? 'Request does not match the accepted schema'
            : typed.message,
      requestId: request.id,
      retryable: status === 503 || status === 429,
    });
  });
  app.addHook('onRequest', async (request, reply) => {
    reply.header('X-Content-Type-Options', 'nosniff').header('Referrer-Policy', 'no-referrer');
    if (!request.url.startsWith('/api/')) return;
    reply.header('Cache-Control', 'no-store');
    const writing = !['GET', 'HEAD', 'OPTIONS'].includes(request.method);
    if (writing && request.headers.origin !== origin)
      throw new StoreError('CSRF_FAILED', 'The request origin is not allowed', 403);
    const path = request.url.split('?')[0];
    if (path === '/api/v1/guest-sessions' || path === '/api/v1/admin/login') return;
    const context = readAuth(request, path?.startsWith('/api/v1/admin/') ? 'admin' : 'guest');
    if (!context) throw new StoreError('AUTH_REQUIRED', 'Authentication is required', 401);
    if (context.principal.data.status === 'banned')
      throw new StoreError('POLICY_DENIED', 'This visitor is suspended', 403);
    if (
      writing &&
      sha256(String(request.headers['x-csrf-token'] ?? '')) !== context.session.data.csrfHash
    )
      throw new StoreError('CSRF_FAILED', 'The CSRF token is invalid', 403);
    authContexts.set(request, context);
    if (writing) rate(`write:${context.principal.id}`, 120, 60000);
  });
  app.get('/health/live', async () => ({ status: 'ok' }));
  app.get('/health/ready', async (_request, reply) => {
    try {
      const state = services.ready
        ? await services.ready()
        : { ready: false, sandboxEnforced: false };
      if (!state.ready || (options.publicProfile && !state.sandboxEnforced))
        return reply.code(503).send({ ready: false });
      store.db.prepare('SELECT 1').get();
      if (policy().publicExecution) models.resolveModel();
      return {
        ready: true,
        sandboxEnforced: !!state.sandboxEnforced,
        publicExecutionEnabled: policy().publicExecution,
      };
    } catch {
      return reply.code(503).send({ ready: false });
    }
  });
  app.post('/api/v1/guest-sessions', { schema: { body: object({}) } }, async (request, reply) => {
    let context = readAuth(request, 'guest');
    if (context?.principal.data.status === 'banned')
      throw new StoreError('POLICY_DENIED', 'This visitor is suspended', 403);
    if (context)
      return reply.code(201).send({
        principalId: context.principal.id,
        expiresAt: context.session.data.expiresAt,
        csrfToken: csrfToken(context.token, options.cookieSecret),
        reused: true,
      });
    rate(`guest:${sha256(request.ip + options.cookieSecret)}`, 20, 3600000);
    rate('guest:global', 500, 3600000);
    const id = randomUUID(),
      principal = store.put<Principal>('principal', id, {
        id,
        kind: 'guest',
        status: 'active',
        displayId: `访客 ${id.slice(0, 8)}`,
        lastSeenAt: timestamp(),
      });
    quotas(id);
    const session = issueAuth(principal);
    reply.setCookie(guestCookie, session.token, cookieOptions);
    return reply.code(201).send({
      principalId: id,
      expiresAt: session.expiresAt,
      csrfToken: session.csrf,
      reused: false,
    });
  });
  app.get('/api/v1/me', async (request) => {
    const a = auth(request);
    return {
      principalId: a.principal.id,
      kind: a.principal.data.kind,
      expiresAt: a.session.data.expiresAt,
      quota: quotaView(a.principal.id),
      allowedModels: models.list(true).map((m) => ({
        id: m.id,
        displayName: m.displayName,
        enabled: m.enabled,
        maxOutputTokens: m.maxOutputTokens,
        defaultForGuests: m.defaultForGuests,
      })),
      publicExecutionEnabled: policy().publicExecution,
      importsEnabled: options.importsEnabled ?? false,
      intentRules: readActiveRules(new AgentEntityStore(store)),
      csrfToken: csrfToken(a.token, options.cookieSecret),
      profile: options.publicProfile ? 'public-demo' : 'local',
    };
  });
  app.get(
    '/api/v1/conversations',
    { schema: { querystring: object({ cursor: string(1, 128), limit: integer(1, 100) }) } },
    async (request) => {
      const query = request.query as { cursor?: string; limit?: number },
        rows = store
          .list<Conversation>('conversation', { ownerId: auth(request).principal.id, limit: 10000 })
          .filter((r) => r.data.status !== 'deleted')
          .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id));
      const start = query.cursor ? rows.findIndex((row) => row.id === query.cursor) + 1 : 0,
        selected = rows.slice(start, start + (query.limit ?? 20));
      return {
        items: selected.map((row) => publicConversation(row, store)),
        nextCursor: start + selected.length < rows.length ? (selected.at(-1)?.id ?? null) : null,
      };
    },
  );
  app.post(
    '/api/v1/conversations',
    {
      schema: {
        body: object(
          {
            title: string(0, 100),
            mode,
            templateId: { type: 'string', enum: ['javascript-starter', 'web-starter', 'empty'] },
          },
          ['mode', 'templateId'],
        ),
      },
    },
    async (request, reply) => {
      const ownerId = auth(request).principal.id,
        input = body(request);
      if (!services.createConversation) throw unavailable();
      if (
        store.list('conversation', { ownerId }).filter((r) => r.data.status !== 'deleted').length >=
        50
      )
        throw new StoreError('QUOTA_EXCEEDED', 'Conversation limit reached', 429);
      const result = await services.createConversation(ownerId, input as any, key(request));
      const row = store.get<Conversation>('conversation', result.id, ownerId);
      return reply.code(201).send(row ? publicConversation(row, store) : scrub(result));
    },
  );
  app.get('/api/v1/conversations/:id', { schema: { params: idParams } }, async (request) =>
    store.transaction(() => {
      const ownerId = auth(request).principal.id,
        id = params(request).id,
        row = ownConversation(ownerId, id);
      const list = (kind: string) =>
        store
          .list(kind, { ownerId, conversationId: id })
          .map((r) => scrub({ ...r.data, id: r.id }));
      const toolSurface =
        store
          .events(id, Math.max(0, store.lastSequence(id) - 1000))
          .findLast((event) => event.type === 'tool.surface.changed')?.payload ?? null;
      return {
        conversation: publicConversation(row, store),
        messages: list('message'),
        runs: list('run'),
        tasks: list('task'),
        workItems: list('workItem'),
        goals: list('goal'),
        processes: list('process'),
        toolSurface,
        lastSequence: store.lastSequence(id),
      };
    }),
  );
  app.patch(
    '/api/v1/conversations/:id',
    {
      schema: {
        params: idParams,
        body: object(
          { title: string(0, 100), mode, archived: boolean, expectedVersion: integer(1) },
          ['expectedVersion'],
        ),
      },
    },
    async (request) => {
      const old = ownConversation(auth(request).principal.id, params(request).id),
        input = body(request);
      if (input.archived === true && !services.archiveConversation) throw unavailable();
      const row = store.put(
        'conversation',
        old.id,
        {
          ...old.data,
          title: input.title ?? old.data.title,
          mode: input.mode ?? old.data.mode,
          status:
            input.archived === undefined ? old.data.status : input.archived ? 'archived' : 'active',
          version: old.version + 1,
          updatedAt: timestamp(),
        },
        { ownerId: old.ownerId, expectedVersion: input.expectedVersion },
      );
      if (input.archived === true) await services.archiveConversation!(old.ownerId!, old.id);
      return publicConversation(row, store);
    },
  );
  app.delete(
    '/api/v1/conversations/:id',
    { schema: { params: idParams } },
    async (request, reply) => {
      const ownerId = auth(request).principal.id,
        row = ownConversation(ownerId, params(request).id);
      store.put('conversation', row.id, { ...row.data, status: 'deleting' });
      const runs = store.list('run', { ownerId, conversationId: row.id });
      await Promise.all(runs.map((r) => services.cancel(ownerId, r.id)));
      if (services.deleteConversation) await services.deleteConversation(ownerId, row.id);
      store.transaction(() => {
        for (const kind of ['message', 'run', 'task', 'workItem', 'goal', 'process', 'artifact'])
          for (const item of store.list(kind, { ownerId, conversationId: row.id }))
            store.delete(kind, item.id, ownerId);
        store.db.prepare('DELETE FROM stream_event WHERE conversation_id=?').run(row.id);
        store.db.prepare('DELETE FROM outbox WHERE aggregate_id=?').run(row.id);
        const current = store.get('conversation', row.id);
        if (current?.data.status !== 'deleted')
          store.put('conversation', row.id, {
            id: row.id,
            ownerId,
            title: '已删除',
            status: 'deleted',
            createdAt: row.createdAt,
            updatedAt: timestamp(),
            version: (current?.version ?? row.version) + 1,
          });
      });
      for (const close of streams.get(ownerId) ?? []) close();
      return reply
        .code(202)
        .send({ resourceId: row.id, status: 'cancelled', resourcesCleanupPending: false });
    },
  );
  app.post(
    '/api/v1/conversations/:id/runs',
    {
      schema: {
        params: idParams,
        body: object({ text: string(1, 16384), mode, modelId: string(1, 128) }, ['text', 'mode']),
      },
    },
    async (request, reply) => {
      const ownerId = auth(request).principal.id,
        conversation = ownConversation(ownerId, params(request).id),
        input = body(request);
      if (conversation.data.status !== 'active')
        throw new StoreError('RUN_CONFLICT', 'This conversation is not active');
      if (!input.text.trim()) throw invalid('Text cannot be empty');
      if (Buffer.byteLength(input.text) > 16384)
        throw new StoreError('PAYLOAD_TOO_LARGE', 'Text must not exceed 16 KiB', 413);
      if (!policy().publicExecution)
        throw new StoreError('SERVICE_PAUSED', 'Execution is paused by the administrator', 503);
      models.resolveModel(input.modelId, true);
      const accepted = await services.submit(ownerId, conversation.id, input as any, key(request));
      return reply.code(202).send({
        runId: accepted.runId ?? accepted.id,
        conversationId: conversation.id,
        status: accepted.status === 'queued' ? 'queued' : 'accepted',
        queuePosition: accepted.queuePosition ?? 0,
        effectiveMode: input.mode,
        configVersion: accepted.model?.configVersion ?? accepted.configVersion ?? 1,
      });
    },
  );
  app.get('/api/v1/runs/:id', { schema: { params: idParams } }, async (request) =>
    scrub(own('run', params(request).id, auth(request).principal.id).data),
  );
  app.post('/api/v1/runs/:id/cancel', { schema: { params: idParams } }, async (request, reply) => {
    const ownerId = auth(request).principal.id,
      run = own('run', params(request).id, ownerId);
    const result = await services.cancel(ownerId, run.id);
    return reply.code(202).send(
      result ?? {
        resourceId: run.id,
        status: terminalRun(run.data.status) ? 'terminal' : 'cancelling',
        resourcesCleanupPending: !terminalRun(run.data.status),
      },
    );
  });
  app.get('/api/v1/conversations/:id/tasks', { schema: { params: idParams } }, async (request) => {
    const ownerId = auth(request).principal.id,
      id = params(request).id;
    ownConversation(ownerId, id);
    return { items: store.list('task', { ownerId, conversationId: id }).map((r) => scrub(r.data)) };
  });
  app.post('/api/v1/tasks/:id/cancel', { schema: { params: idParams } }, async (request, reply) => {
    const ownerId = auth(request).principal.id,
      id = params(request).id;
    own('task', id, ownerId);
    if (!services.cancelTask) throw unavailable();
    return reply.code(202).send(await services.cancelTask(ownerId, id));
  });
  app.get(
    '/api/v1/conversations/:id/workspace',
    { schema: { params: idParams } },
    async (request) => {
      const ownerId = auth(request).principal.id,
        id = params(request).id;
      ownConversation(ownerId, id);
      if (!services.workspace) throw unavailable();
      return services.workspace(ownerId, id);
    },
  );
  app.post(
    '/api/v1/conversations/:id/import',
    {
      bodyLimit: 15 * 1024 * 1024,
      schema: {
        params: idParams,
        body: {
          oneOf: [
            object(
              {
                kind: { const: 'zip' },
                archiveBase64: {
                  type: 'string',
                  minLength: 4,
                  maxLength: 13981016,
                  pattern: '^[A-Za-z0-9+/]+={0,2}$',
                },
                expectedRevision: string(1, 128),
              },
              ['kind', 'archiveBase64', 'expectedRevision'],
            ),
            object(
              {
                kind: { const: 'github' },
                url: string(20, 512),
                ref: string(1, 200),
                expectedRevision: string(1, 128),
              },
              ['kind', 'url', 'expectedRevision'],
            ),
          ],
        },
      },
    },
    async (request, reply) => {
      const ownerId = auth(request).principal.id,
        id = params(request).id;
      ownConversation(ownerId, id);
      if (!options.importsEnabled || !services.importProject)
        throw new StoreError('FEATURE_DISABLED', '项目导入尚未启用', 503);
      rate(`import:${ownerId}`, 10, 3600000);
      const result = await services.importProject(ownerId, id, body(request) as any, key(request));
      return reply.code(201).send(result);
    },
  );
  app.get(
    '/api/v1/conversations/:id/processes',
    { schema: { params: idParams } },
    async (request) => {
      const ownerId = auth(request).principal.id,
        id = params(request).id;
      ownConversation(ownerId, id);
      if (!services.processes) throw unavailable();
      return services.processes(ownerId, id);
    },
  );
  app.post(
    '/api/v1/conversations/:id/processes/:processId/stop',
    {
      schema: {
        params: object({ id: string(1, 128), processId: string(1, 128) }, ['id', 'processId']),
      },
    },
    async (request, reply) => {
      const ownerId = auth(request).principal.id,
        { id, processId } = request.params as any;
      ownConversation(ownerId, id);
      if (!services.stopProcess) throw unavailable();
      return reply.code(202).send(await services.stopProcess(ownerId, id, processId));
    },
  );
  app.post(
    '/api/v1/conversations/:id/patches/:taskId/apply',
    {
      schema: {
        params: object({ id: string(1, 128), taskId: string(1, 128) }, ['id', 'taskId']),
        body: object({ baseRevision: string(1, 128) }, ['baseRevision']),
      },
    },
    async (request) => {
      const ownerId = auth(request).principal.id,
        { id, taskId } = request.params as any;
      ownConversation(ownerId, id);
      if (!services.applyPatch) throw unavailable();
      return services.applyPatch(ownerId, id, taskId, body(request).baseRevision);
    },
  );
  app.post(
    '/api/v1/conversations/:id/artifacts',
    { schema: { params: idParams, body: object({ path: string(1, 512) }, ['path']) } },
    async (request, reply) => {
      const ownerId = auth(request).principal.id,
        id = params(request).id;
      ownConversation(ownerId, id);
      if (!services.exportFile) throw unavailable();
      return reply.code(201).send(await services.exportFile(ownerId, id, body(request).path));
    },
  );
  app.get(
    '/api/v1/conversations/:id/file',
    { schema: { params: idParams, querystring: object({ path: string(1, 512) }, ['path']) } },
    async (request) => {
      const ownerId = auth(request).principal.id,
        id = params(request).id,
        path = (request.query as any).path as string;
      ownConversation(ownerId, id);
      if (
        path.includes('\0') ||
        path.includes('\\') ||
        path.startsWith('/') ||
        /^[a-z]:/i.test(path) ||
        path.split('/').some((p) => p === '..' || p === '.')
      )
        throw invalid('Only workspace relative paths are accepted');
      if (!services.file) throw unavailable();
      return services.file(ownerId, id, path);
    },
  );
  app.get(
    '/api/v1/artifacts/:id/download',
    { schema: { params: idParams } },
    async (request, reply) => {
      const ownerId = auth(request).principal.id,
        id = params(request).id;
      own('artifact', id, ownerId);
      if (!services.artifact) throw unavailable();
      const artifact = await services.artifact(ownerId, id);
      return reply
        .header('Content-Security-Policy', "default-src 'none'; sandbox")
        .header(
          'Content-Disposition',
          `attachment; filename*=UTF-8''${encodeURIComponent(artifact.name)}`,
        )
        .type('application/octet-stream')
        .send(artifact.content);
    },
  );
  app.get(
    '/api/v1/conversations/:id/events',
    {
      schema: {
        params: idParams,
        querystring: object({ after: integer(0, Number.MAX_SAFE_INTEGER) }),
      },
    },
    async (request, reply) => {
      const ownerId = auth(request).principal.id,
        id = params(request).id;
      ownConversation(ownerId, id);
      let after = Number(request.headers['last-event-id'] ?? (request.query as any).after ?? 0);
      if (!Number.isSafeInteger(after) || after < 0) throw invalid('Invalid event cursor');
      if ((streams.get(ownerId)?.size ?? 0) >= 3)
        throw new StoreError('RATE_LIMITED', 'Too many event streams', 429);
      reply.hijack();
      reply.raw.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-store',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
        'X-Content-Type-Options': 'nosniff',
      });
      const write = (event: any) => {
        if (event.sequence <= after) return;
        if (reply.raw.writableLength > 1048576) {
          reply.raw.end();
          return;
        }
        reply.raw.write(
          `id: ${event.sequence}\nevent: ${event.type}\ndata: ${JSON.stringify(scrub(event))}\n\n`,
        );
        after = event.sequence;
      };
      const first = store.firstSequence(id),
        latest = store.lastSequence(id);
      if (after > latest || (first > 0 && after < first - 1)) {
        reply.raw.end(
          `event: stream.reset\ndata: ${JSON.stringify({ schemaVersion: 1, eventId: randomUUID(), sequence: latest, conversationId: id, runId: null, occurredAt: timestamp(), type: 'stream.reset', payload: { reason: 'expired_cursor', latestSequence: latest } })}\n\n`,
        );
        return;
      }
      let closed = false;
      const replay = () => {
        for (const event of store.events(id, after, 1000)) write(event);
      };
      const unsubscribe = store.subscribe(id, () => replay());
      const close = () => {
        if (closed) return;
        closed = true;
        clearInterval(poll);
        clearInterval(heartbeat);
        unsubscribe();
        streams.get(ownerId)?.delete(close);
        reply.raw.end();
      };
      // This is the bounded durable-event relay between separate DB connections, not Agent status polling.
      const poll = setInterval(replay, options.eventPollMs ?? 200);
      poll.unref();
      const heartbeat = setInterval(() => {
        const current = store.get<Principal>('principal', ownerId),
          session = store.get<AuthSession>('auth', auth(request).session.id);
        if (
          !current ||
          current.data.status !== 'active' ||
          !session ||
          session.data.revoked ||
          Date.parse(session.data.expiresAt) <= Date.now()
        ) {
          close();
          return;
        }
        reply.raw.write(': heartbeat\n\n');
      }, 15000);
      heartbeat.unref();
      if (!streams.has(ownerId)) streams.set(ownerId, new Set());
      streams.get(ownerId)!.add(close);
      reply.raw.on('close', close);
      replay();
      reply.raw.write(': connected\n\n');
    },
  );
  app.post(
    '/api/v1/admin/login',
    {
      schema: {
        body: object({ username: string(1, 100), password: string(1, 1024) }, [
          'username',
          'password',
        ]),
      },
    },
    async (request, reply) => {
      const input = body(request);
      rate(`login-ip:${sha256(request.ip + options.cookieSecret)}`, 10, 300000);
      rate(`login-user:${sha256(input.username)}`, 10, 300000);
      const p = store
        .list<Principal>('principal')
        .find((row) => row.data.kind === 'admin' && row.data.username === input.username);
      if (
        !p ||
        p.data.status !== 'active' ||
        !(await verifyPassword(input.password, p.data.passwordHash ?? ''))
      ) {
        store.audit(null, 'admin.login', 'unknown', {}, request.id, 'denied');
        throw new StoreError('AUTH_REQUIRED', 'Invalid username or password', 401);
      }
      const session = issueAuth(p);
      reply.setCookie(adminCookie, session.token, { ...cookieOptions, maxAge: 86400 });
      store.audit(p.id, 'admin.login', p.id, {}, request.id);
      return { principalId: p.id, csrfToken: session.csrf, expiresAt: session.expiresAt };
    },
  );
  app.post('/api/v1/admin/logout', async (request, reply) => {
    const a = auth(request);
    store.put('auth', a.session.id, { ...a.session.data, revoked: true });
    reply.clearCookie(adminCookie, cookieOptions);
    return reply.code(204).send();
  });
  app.get('/api/v1/admin/me', async (request) => {
    const a = auth(request);
    return {
      principalId: a.principal.id,
      csrfToken: csrfToken(a.token, options.cookieSecret),
      expiresAt: a.session.data.expiresAt,
      displayId: a.principal.data.displayId,
    };
  });
  app.get('/api/v1/admin/overview', async () => {
    const runs = store.list('run'),
      calls = store
        .list('modelCall')
        .filter((r) => r.createdAt.startsWith(timestamp().slice(0, 10)));
    return {
      activeVisitors: store
        .list<Principal>('principal')
        .filter((r) => r.data.kind === 'guest' && r.data.status === 'active').length,
      runningRoots: runs.filter((r) => !terminalRun(r.data.status)).length,
      modelCallsToday: calls.length,
      knownTokensToday: calls.reduce(
        (sum, r) =>
          sum +
          (r.data.usage?.inputTokens ?? r.data.inputTokens ?? 0) +
          (r.data.usage?.outputTokens ?? r.data.outputTokens ?? 0),
        0,
      ),
      unknownUsageCalls: calls.filter((r) => (r.data.usage?.status ?? r.data.status) === 'unknown')
        .length,
      publicExecutionEnabled: policy().publicExecution,
      asOf: timestamp(),
    };
  });
  app.get('/api/v1/admin/models', async () => ({
    items: models.list(),
    approvedEndpoints: Object.entries(approvedEndpoints).map(([id, ep]) => ({
      id,
      providerType: ep.providerType,
    })),
  }));
  const modelProperties = {
    displayName: string(1, 100),
    providerType: { type: 'string', enum: Object.keys(approvedEndpoints) },
    modelId: string(1, 200),
    approvedEndpointId: { type: 'string', enum: Object.keys(approvedEndpoints) },
    apiKey: string(0, 8192),
    enabled: boolean,
    publicSelectable: boolean,
    defaultForGuests: boolean,
    maxOutputTokens: integer(1, 16384),
    contextWindow: integer(1024, 2000000),
    inputPriceMicros: integer(0, 1000000000),
    outputPriceMicros: integer(0, 1000000000),
    currency: { type: 'string', enum: ['USD', 'CNY', 'EUR'] },
    expectedVersion: integer(1),
    reason: reasonSchema,
  };
  function saveModel(request: FastifyRequest, id: string, existing?: Stored<StoredModel>): any {
    const input = body(request),
      previous = existing?.data;
    if (existing && input.expectedVersion === undefined)
      throw invalid('expectedVersion is required');
    if (
      approvedEndpoints[input.approvedEndpointId ?? previous?.approvedEndpointId]?.providerType !==
      (input.providerType ?? previous?.providerType)
    )
      throw invalid('The endpoint does not match the provider');
    if (input.defaultForGuests && existing?.data.testedVersion !== existing?.version)
      throw invalid('Test this model successfully before making it the guest default');
    const data: StoredModel = {
      id,
      displayName: input.displayName ?? previous?.displayName,
      providerType: input.providerType ?? previous?.providerType,
      modelId: input.modelId ?? previous?.modelId,
      approvedEndpointId: input.approvedEndpointId ?? previous?.approvedEndpointId,
      enabled: input.enabled ?? previous?.enabled ?? false,
      publicSelectable: input.publicSelectable ?? previous?.publicSelectable ?? false,
      defaultForGuests: input.defaultForGuests ?? previous?.defaultForGuests ?? false,
      maxOutputTokens: input.maxOutputTokens ?? previous?.maxOutputTokens ?? 2048,
      contextWindow: input.contextWindow ?? previous?.contextWindow ?? 128000,
      configVersion: (existing?.version ?? 0) + 1,
      encryptedKey: previous?.encryptedKey,
      keyFingerprint: previous?.keyFingerprint,
      testedVersion: previous?.testedVersion,
      inputPriceMicros: input.inputPriceMicros ?? previous?.inputPriceMicros,
      outputPriceMicros: input.outputPriceMicros ?? previous?.outputPriceMicros,
      currency: input.currency ?? previous?.currency ?? 'USD',
    };
    if (input.apiKey) {
      data.encryptedKey = models.secrets.encrypt(input.apiKey);
      data.keyFingerprint = sha256(input.apiKey).slice(-8);
      data.testedVersion = undefined;
    }
    if (
      previous &&
      (data.providerType !== previous.providerType ||
        data.modelId !== previous.modelId ||
        data.approvedEndpointId !== previous.approvedEndpointId)
    )
      data.testedVersion = undefined;
    if (existing && data.testedVersion === existing.version)
      data.testedVersion = existing.version + 1;
    if (data.defaultForGuests && (!data.enabled || !data.publicSelectable || !data.encryptedKey))
      throw invalid('A guest default must be enabled, selectable, and have a credential');
    if (data.defaultForGuests && data.testedVersion === undefined)
      throw invalid(
        'The changed model must pass a connection test before it can be the guest default',
      );
    if (
      previous?.defaultForGuests &&
      (!data.enabled || !data.publicSelectable) &&
      policy().publicExecution
    )
      throw invalid('Choose another guest default or pause public execution first');
    return store.transaction(() => {
      if (data.defaultForGuests)
        for (const row of store.list<StoredModel>('model'))
          if (row.id !== id && row.data.defaultForGuests)
            store.put('model', row.id, {
              ...row.data,
              defaultForGuests: false,
              testedVersion:
                row.data.testedVersion === row.version ? row.version + 1 : row.data.testedVersion,
            });
      const row = store.put('model', id, data, {
        expectedVersion: existing ? input.expectedVersion : 0,
      });
      store.audit(
        auth(request).principal.id,
        existing ? 'model.updated' : 'model.created',
        id,
        {
          displayName: data.displayName,
          credentialChanged: !!input.apiKey,
          reason: input.reason ?? 'model configuration',
        },
        request.id,
      );
      return models.publicModel(row);
    });
  }
  app.post(
    '/api/v1/admin/models',
    {
      schema: {
        body: object(modelProperties, [
          'displayName',
          'providerType',
          'modelId',
          'approvedEndpointId',
          'enabled',
          'publicSelectable',
          'maxOutputTokens',
          'reason',
        ]),
      },
    },
    async (request, reply) => reply.code(201).send(saveModel(request, randomUUID())),
  );
  app.patch(
    '/api/v1/admin/models/:id',
    { schema: { params: idParams, body: object(modelProperties, ['expectedVersion', 'reason']) } },
    async (request) => {
      const old = store.get<StoredModel>('model', params(request).id);
      if (!old) throw new StoreError('RESOURCE_NOT_FOUND', 'Model not found', 404);
      return saveModel(request, old.id, old);
    },
  );
  app.post(
    '/api/v1/admin/models/:id/clear-key',
    {
      schema: {
        params: idParams,
        body: object({ expectedVersion: integer(1), reason: reasonSchema }, [
          'expectedVersion',
          'reason',
        ]),
      },
    },
    async (request) => {
      const old = store.get<StoredModel>('model', params(request).id);
      if (!old) throw new StoreError('RESOURCE_NOT_FOUND', 'Model not found', 404);
      if (old.data.defaultForGuests && policy().publicExecution)
        throw invalid('Pause public execution or choose another default before clearing this key');
      const row = store.transaction(() => {
        const saved = store.put(
          'model',
          old.id,
          {
            ...old.data,
            encryptedKey: undefined,
            keyFingerprint: undefined,
            testedVersion: undefined,
            enabled: false,
            defaultForGuests: false,
          },
          { expectedVersion: body(request).expectedVersion },
        );
        store.audit(
          auth(request).principal.id,
          'model.key.cleared',
          old.id,
          { reason: body(request).reason },
          request.id,
        );
        return saved;
      });
      return models.publicModel(row);
    },
  );
  app.post('/api/v1/admin/models/:id/test', { schema: { params: idParams } }, async (request) => {
    const id = params(request).id;
    if (!store.get('model', id)) throw new StoreError('RESOURCE_NOT_FOUND', 'Model not found', 404);
    if (!services.testModel)
      throw new StoreError('MODEL_UNAVAILABLE', 'Model test service is unavailable', 503);
    rate(`model-test:${auth(request).principal.id}`, 10, 3600000);
    const config = models.resolveModel(id, false),
      started = Date.now();
    let result;
    try {
      result = await services.testModel({ ...config, maxOutputTokens: 32 });
    } catch {
      result = {
        ok: false,
        latencyMs: Date.now() - started,
        usageKnown: false,
        errorCode: 'MODEL_UNAVAILABLE',
      };
    }
    const current = store.get<StoredModel>('model', id)!;
    if (result.ok && current.version === config.configVersion) {
      store.put(
        'model',
        id,
        { ...current.data, testedVersion: current.version + 1 },
        { expectedVersion: current.version },
      );
    }
    store.put('admin-model-call', randomUUID(), {
      modelId: id,
      actorId: auth(request).principal.id,
      result: scrub(result),
      createdAt: timestamp(),
    });
    store.audit(
      auth(request).principal.id,
      'model.test',
      id,
      { ok: result.ok },
      request.id,
      result.ok ? 'success' : 'failed',
    );
    return result;
  });
  app.get('/api/v1/admin/visitors', async () => ({
    items: store
      .list<Principal>('principal')
      .filter((r) => r.data.kind === 'guest')
      .map(principalView),
    nextCursor: null,
  }));
  app.patch(
    '/api/v1/admin/visitors/:id',
    {
      schema: {
        params: idParams,
        body: object(
          {
            status: { type: 'string', enum: ['active', 'banned'] },
            reason: reasonSchema,
            cancelActive: boolean,
            dailyRootRuns: integer(0, 1000),
            dailyTokens: integer(),
            expectedVersion: integer(1),
            expiresAt: string(10, 100),
          },
          ['status', 'reason', 'cancelActive', 'expectedVersion'],
        ),
      },
    },
    async (request) => {
      const id = params(request).id,
        input = body(request),
        old = store.get<Principal>('principal', id);
      if (!old || old.data.kind !== 'guest')
        throw new StoreError('RESOURCE_NOT_FOUND', 'Visitor not found', 404);
      if (input.expiresAt && !Number.isFinite(Date.parse(input.expiresAt)))
        throw invalid('Invalid ban expiry');
      const p = store.transaction(() => {
        const saved = store.put(
          'principal',
          id,
          { ...old.data, status: input.status, bannedUntil: input.expiresAt },
          { expectedVersion: input.expectedVersion },
        );
        const q = quotas(id);
        if (input.dailyRootRuns !== undefined || input.dailyTokens !== undefined)
          store.adjustQuota(
            q.id,
            auth(request).principal.id,
            (input.dailyTokens ?? q.tokenLimit) - q.tokenLimit,
            (input.dailyRootRuns ?? q.rootLimit) - q.rootLimit,
            input.reason,
            key(request),
          );
        store.audit(
          auth(request).principal.id,
          'visitor.updated',
          id,
          { status: input.status, reason: input.reason },
          request.id,
        );
        return saved;
      });
      if (input.status === 'banned') {
        for (const conv of store.list('conversation', { ownerId: id }))
          store.appendEvent(conv.id, null, 'policy.revoked', {
            version: policy().version,
            reason: input.reason,
            scope: 'principal',
          });
        for (const close of streams.get(id) ?? []) close();
        if (input.cancelActive)
          await Promise.all(
            store.list('run', { ownerId: id }).map((r) => services.cancel(id, r.id)),
          );
      }
      return principalView(p);
    },
  );
  app.get('/api/v1/admin/policy', async () => policyView());
  app.put(
    '/api/v1/admin/policy',
    {
      schema: {
        body: object(
          {
            version: integer(1),
            publicExecutionEnabled: boolean,
            dailyRootRuns: integer(0, 1000),
            dailyTokens: integer(),
            globalModelConcurrency: integer(1, 16),
            rootDeadlineSeconds: integer(10, 600),
            allowedGroups: {
              type: 'array',
              items: { type: 'string', enum: defaultPolicy.allowedGroups },
              maxItems: 5,
              uniqueItems: true,
            },
            maxModelCalls: integer(1, 100),
            maxUserConcurrentModels: integer(1, 8),
            maxChildren: integer(0, 8),
            processTtlSeconds: integer(1, 600),
            reason: reasonSchema,
          },
          [
            'version',
            'publicExecutionEnabled',
            'dailyRootRuns',
            'dailyTokens',
            'globalModelConcurrency',
            'rootDeadlineSeconds',
            'allowedGroups',
            'reason',
          ],
        ),
      },
    },
    async (request) => {
      const input = body(request),
        old = store.get<Policy>('policy', 'current')!;
      if (input.publicExecutionEnabled) {
        models.resolveModel();
        const ready = await services.ready?.();
        if (!ready?.ready || (options.publicProfile && !ready.sandboxEnforced)) throw unavailable();
      }
      store.transaction(() => {
        const config: Policy = {
          ...old.data,
          version: old.data.version + 1,
          publicExecution: input.publicExecutionEnabled,
          dailyRootRuns: input.dailyRootRuns,
          dailyTokens: input.dailyTokens,
          maxConcurrentModels: input.globalModelConcurrency,
          runTimeoutMs: input.rootDeadlineSeconds * 1000,
          allowedGroups: input.allowedGroups,
          maxModelCalls: input.maxModelCalls ?? old.data.maxModelCalls,
          maxUserConcurrentModels:
            input.maxUserConcurrentModels ?? old.data.maxUserConcurrentModels,
          maxChildren: input.maxChildren ?? old.data.maxChildren,
          processTtlSeconds: input.processTtlSeconds ?? old.data.processTtlSeconds,
        };
        if (input.version !== old.data.version)
          throw new StoreError('VERSION_CONFLICT', 'Policy version changed');
        store.put('policy', 'current', config, { expectedVersion: old.version });
        store.put('policy-version', String(config.version), config);
        const affectedQuotas = store.applyPolicyQuotaLimits(
          { tokens: config.dailyTokens, roots: config.dailyRootRuns, calls: config.maxModelCalls },
          auth(request).principal.id,
          input.reason,
          config.version,
        );
        store.audit(
          auth(request).principal.id,
          'policy.published',
          String(config.version),
          {
            reason: input.reason,
            affectedQuotas,
            dailyTokens: config.dailyTokens,
            dailyRootRuns: config.dailyRootRuns,
          },
          request.id,
        );
      });
      return policyView();
    },
  );
  registerRuleRoutes(app, store, (request) => auth(request).principal.id);
  app.post(
    '/api/v1/admin/rules/test',
    {
      schema: {
        body: object(
          {
            text: string(0, 16384),
            mode,
            simulatedSource: { type: 'string', enum: ['human', 'tool', 'task_result'] },
          },
          ['text', 'mode'],
        ),
      },
    },
    async (request) => {
      if (!services.ruleTest)
        throw new StoreError('SERVICE_PAUSED', 'Rule evaluation service is unavailable', 503);
      return services.ruleTest(body(request) as any);
    },
  );
  app.get('/api/v1/admin/executions', async () => ({
    items: ['run', 'task', 'process'].flatMap((kind) =>
      store.list(kind).map((row) => ({
        id: row.id,
        kind,
        status: row.data.status,
        ownerDisplayId:
          store.get<Principal>('principal', row.ownerId ?? '')?.data.displayId ?? 'unknown',
        ageSeconds: Math.max(0, Math.floor((Date.now() - Date.parse(row.createdAt)) / 1000)),
        conversationId: row.conversationId,
      })),
    ),
  }));
  app.get('/api/v1/admin/executions/:id', { schema: { params: idParams } }, async (request) => {
    const row = store.get('run', params(request).id);
    if (!row) throw new StoreError('RESOURCE_NOT_FOUND', 'Execution not found', 404);
    store.audit(auth(request).principal.id, 'execution.viewed', row.id, {}, request.id);
    return {
      run: scrub(row.data),
      events: store
        .events(row.conversationId ?? row.data.conversationId)
        .filter((e) => e.runId === row.id)
        .map(scrub),
      tasks: store
        .list('task', { conversationId: row.conversationId })
        .filter((r) => r.data.originRunId === row.id)
        .map((r) => scrub(r.data)),
    };
  });
  app.post(
    '/api/v1/admin/emergency-stop',
    {
      schema: {
        body: object({ reason: reasonSchema, cancelActive: boolean }, ['reason', 'cancelActive']),
      },
    },
    async (request, reply) => {
      const input = body(request),
        old = store.get<Policy>('policy', 'current')!,
        version = old.data.version + 1;
      store.transaction(() => {
        store.put('policy', 'current', { ...old.data, version, publicExecution: false });
        store.audit(
          auth(request).principal.id,
          'emergency-stop',
          'global',
          { reason: input.reason },
          request.id,
        );
        for (const conv of store.list('conversation'))
          store.appendEvent(conv.id, null, 'policy.revoked', {
            version,
            reason: input.reason,
            scope: 'global',
          });
      });
      const runs = store.list('run');
      if (input.cancelActive)
        await Promise.all(runs.map((r) => services.cancel(r.ownerId ?? r.data.ownerId, r.id)));
      return reply.code(202).send({
        publicExecutionEnabled: false,
        cancellationRequested: input.cancelActive ? runs.length : 0,
        policyVersion: version,
      });
    },
  );
  app.get('/api/v1/admin/audit', async () => ({
    items: store.audits().map((row) => ({
      ...row,
      actorDisplayId:
        store.get<Principal>('principal', row.actorId ?? '')?.data.displayId ?? 'system',
    })),
    nextCursor: null,
  }));
  app.get('/api/v1/admin/usage', async () => ({
    items: store.list('modelCall').map((row) => scrub(row.data)),
    adminCalls: store.list('admin-model-call').map((row) => row.data),
  }));
  const stopEvents = services.subscribeEvents?.((event) => store.notify(event));
  app.addHook('onClose', async () => {
    for (const ownerStreams of streams.values()) for (const close of ownerStreams) close();
    stopEvents?.();
  });
  return app;
}
