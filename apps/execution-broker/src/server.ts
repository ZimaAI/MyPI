import http from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { DockerSandbox } from './docker.js';
import { localDockerEnabled } from '../../../packages/sandbox-client/src/deployment.ts';
import { SandboxError, type SandboxPort } from '../../../packages/sandbox-client/src/types.js';

const METHODS = new Set([
  'createWorkspace',
  'execute',
  'workspaceFiles',
  'workspaceRead',
  'importWorkspace',
  'forkWorkspace',
  'diffWorkspace',
  'applyWorkspace',
  'backgroundStart',
  'backgroundStatus',
  'backgroundList',
  'backgroundWatch',
  'backgroundStop',
  'releaseConversation',
  'deleteConversation',
  'sweepExpired',
  'health',
]);
export function createBrokerServer(sandbox: SandboxPort, token: string): http.Server {
  if (token.length < 32) throw new Error('MYPI_BROKER_TOKEN must contain at least 32 characters');
  return http.createServer(async (req, res) => {
    const respond = (status: number, data: unknown) => {
      if (!res.destroyed) {
        res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
        res.end(JSON.stringify(data));
      }
    };
    const actual = Buffer.from(req.headers.authorization ?? '');
    const expected = Buffer.from(`Bearer ${token}`);
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
      respond(401, { error: { code: 'NOT_AUTHORIZED', message: 'Broker 身份验证失败' } });
      return;
    }
    if (req.method !== 'POST' || req.url !== '/rpc') {
      respond(404, { error: { code: 'NOT_FOUND', message: '接口不存在' } });
      return;
    }
    const controller = new AbortController();
    res.once('close', () => {
      if (!res.writableEnded) controller.abort();
    });
    try {
      let bytes = 0;
      const chunks: Buffer[] = [];
      for await (const chunk of req) {
        bytes += chunk.length;
        if (bytes > 48 * 1024 * 1024) throw new SandboxError('LIMIT_EXCEEDED', '请求超过上限');
        chunks.push(Buffer.from(chunk));
      }
      const body = JSON.parse(Buffer.concat(chunks).toString());
      if (bytes > 3 * 1024 * 1024 && body.method !== 'importWorkspace')
        throw new SandboxError('LIMIT_EXCEEDED', '普通 Broker 请求超过上限');
      if (
        !body ||
        typeof body !== 'object' ||
        Object.keys(body).some((key) => !['requestId', 'method', 'params'].includes(key)) ||
        typeof body.requestId !== 'string' ||
        !METHODS.has(body.method) ||
        !body.params ||
        typeof body.params !== 'object' ||
        Array.isArray(body.params)
      )
        throw new SandboxError('INVALID_INPUT', '无效 Broker 请求');
      const params = body.params;
      if (
        !['health', 'sweepExpired'].includes(body.method) &&
        (!/^[a-zA-Z0-9_.:-]{1,128}$/.test(params.principalId) ||
          !/^[a-zA-Z0-9_.:-]{1,128}$/.test(params.conversationId))
      )
        throw new SandboxError('INVALID_INPUT', '无效请求身份');
      if (body.method === 'sweepExpired') {
        respond(200, { data: await sandbox.sweepExpired(params.ttlHours) });
        return;
      }
      const method = sandbox[body.method as keyof SandboxPort] as (
        params: never,
        signal?: AbortSignal,
      ) => Promise<unknown>;
      const data = await method.call(sandbox, params as never, controller.signal);
      respond(200, { data: data ?? null });
    } catch (error) {
      const code = error instanceof SandboxError ? error.code : 'INVALID_INPUT';
      respond(
        code === 'NOT_FOUND'
          ? 404
          : code === 'NOT_AUTHORIZED'
            ? 403
            : code === 'CONFLICT'
              ? 409
              : 400,
        {
          error: {
            code,
            message: error instanceof SandboxError ? error.message : 'Broker 请求失败',
          },
        },
      );
    }
  });
}
export async function startBroker(): Promise<void> {
  const localExecutionEnabled = localDockerEnabled(process.env);
  const token = process.env.MYPI_BROKER_TOKEN ?? '';
  const sandbox = new DockerSandbox({
    stateRoot: path.resolve(process.env.MYPI_BROKER_STATE ?? '.data/broker'),
    image: process.env.MYPI_SANDBOX_IMAGE ?? '',
    publicExecutionEnabled: process.env.PUBLIC_EXECUTION_ENABLED === 'true',
    localExecutionEnabled,
    lowResourcePublic: process.env.MYPI_PUBLIC_LOW_RESOURCE === 'true',
    runtime: process.env.MYPI_SANDBOX_RUNTIME ?? 'runsc',
  });
  if (process.env.PUBLIC_EXECUTION_ENABLED === 'true' || localExecutionEnabled) {
    const health = await sandbox.health();
    if (!health.ready) throw new Error(health.reason);
  }
  // A restart with execution disabled must still revoke leases created by the previous process.
  try {
    await sandbox.cleanupOrphans();
  } catch (error) {
    if (process.env.PUBLIC_EXECUTION_ENABLED === 'true' || localExecutionEnabled) throw error;
    console.error('Broker orphan cleanup unavailable; execution remains disabled');
  }
  const server = createBrokerServer(sandbox, token);
  const socket = process.env.MYPI_BROKER_SOCKET;
  await sandbox.sweepExpired();
  const sweeper = setInterval(() => {
    void sandbox.sweepExpired().catch(() => console.error('Broker retention cleanup failed'));
  }, 60000);
  sweeper.unref();
  if (socket) {
    await fs.mkdir(path.dirname(socket), { recursive: true, mode: 0o700 });
    // Do not unlink an existing socket: it may belong to a live broker.
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(socket, () => resolve());
    });
    if (process.platform !== 'win32') await fs.chmod(socket, 0o600);
  } else
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      const host = process.env.MYPI_BROKER_HOST ?? '127.0.0.1';
      if (
        !['127.0.0.1', '0.0.0.0'].includes(host) ||
        (host === '0.0.0.0' && process.env.MYPI_BROKER_PRIVATE_CONTAINER !== 'true')
      ) {
        reject(new Error('Invalid Broker listen host'));
        return;
      }
      server.listen(Number(process.env.MYPI_BROKER_PORT ?? 4102), host, () => resolve());
    });
  console.log(
    JSON.stringify({
      service: 'execution-broker',
      listening: socket ? 'unix-socket' : 'loopback',
      ...(await sandbox.health()),
    }),
  );
  let stopping = false;
  const stop = async () => {
    if (stopping) return;
    stopping = true;
    clearInterval(sweeper);
    server.close();
    await sandbox.shutdown();
    process.disconnect?.();
    process.exitCode = 0;
  };
  process.on('message', (message) => {
    if (message === 'mypi:shutdown') void stop();
  });
  process.once('SIGINT', () => void stop());
  process.once('SIGTERM', () => void stop());
}
