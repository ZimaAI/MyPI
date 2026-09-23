import http from 'node:http';
import https from 'node:https';
import { randomUUID } from 'node:crypto';
import {
  SandboxError,
  type SandboxPort,
  type Owner,
  type Workspace,
  type WorkspaceRequest,
  type ExecuteRequest,
  type ToolResult,
  type BackgroundRequest,
  type ProcessRequest,
  type BackgroundProcess,
  type SandboxHealth,
  type WorkspaceDiff,
  type WorkspaceFile,
  type WorkspaceFileContent,
} from './types.js';

export interface BrokerClientOptions {
  socketPath?: string;
  baseUrl?: string;
  token: string;
}
export class BrokerSandboxClient implements SandboxPort {
  constructor(private options: BrokerClientOptions) {
    if (!options.token || options.token.length < 32)
      throw new SandboxError('INVALID_INPUT', 'Broker token 至少 32 字符');
    if (!options.socketPath) {
      const url = new URL(options.baseUrl ?? 'http://127.0.0.1:4102');
      if (
        !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) ||
        url.username ||
        url.password
      )
        throw new SandboxError('INVALID_INPUT', 'Broker 只能连接私有本地地址或 Unix socket');
    }
  }
  private request<T>(method: string, params: unknown, signal?: AbortSignal): Promise<T> {
    const requestId = randomUUID();
    const payload = JSON.stringify({ requestId, method, params });
    const base = new URL(this.options.baseUrl ?? 'http://127.0.0.1:4102');
    return new Promise<T>((resolve, reject) => {
      if (signal?.aborted) {
        reject(new SandboxError('CANCELLED', '执行已取消'));
        return;
      }
      const transport = base.protocol === 'https:' ? https : http;
      const req = transport.request(
        {
          hostname: base.hostname,
          port: base.port,
          socketPath: this.options.socketPath,
          path: '/rpc',
          method: 'POST',
          headers: {
            authorization: `Bearer ${this.options.token}`,
            'content-type': 'application/json',
            'content-length': Buffer.byteLength(payload),
          },
          timeout: method === 'execute' ? 70000 : 35000,
        },
        (res) => {
          const chunks: Buffer[] = [];
          let size = 0;
          res.on('data', (chunk: Buffer) => {
            size += chunk.length;
            if (size > 4 * 1024 * 1024)
              req.destroy(new SandboxError('LIMIT_EXCEEDED', 'Broker 响应过大'));
            else chunks.push(chunk);
          });
          res.on('end', () => {
            try {
              const result = JSON.parse(Buffer.concat(chunks).toString());
              if (res.statusCode !== 200 || result.error)
                reject(
                  new SandboxError(
                    result.error?.code ?? 'SANDBOX_UNAVAILABLE',
                    result.error?.message ?? '沙箱不可用',
                  ),
                );
              else resolve(result.data as T);
            } catch {
              reject(new SandboxError('SANDBOX_UNAVAILABLE', 'Broker 响应无效'));
            }
          });
        },
      );
      const abort = () => req.destroy(new SandboxError('CANCELLED', '执行已取消'));
      signal?.addEventListener('abort', abort, { once: true });
      req.once('close', () => signal?.removeEventListener('abort', abort));
      req.once('error', (error) =>
        reject(
          error instanceof SandboxError
            ? error
            : new SandboxError('SANDBOX_UNAVAILABLE', '隔离执行器不可用，未使用宿主执行'),
        ),
      );
      req.once('timeout', () => req.destroy(new SandboxError('TIMEOUT', 'Broker 请求超时')));
      req.end(payload);
    });
  }
  createWorkspace(request: Owner & { templateId?: string }): Promise<Workspace> {
    return this.request('createWorkspace', request);
  }
  workspaceFiles(request: WorkspaceRequest): Promise<WorkspaceFile[]> {
    return this.request('workspaceFiles', request);
  }
  workspaceRead(request: WorkspaceRequest & { path: string }): Promise<WorkspaceFileContent> {
    return this.request('workspaceRead', request);
  }
  importWorkspace(
    request: WorkspaceRequest & { files: Record<string, string>; expectedRevision?: string },
  ): Promise<Workspace> {
    return this.request('importWorkspace', request);
  }
  async execute(request: ExecuteRequest, signal?: AbortSignal): Promise<ToolResult> {
    const start = Date.now();
    try {
      return await this.request('execute', request, signal);
    } catch (error) {
      return {
        ok: false,
        data: null,
        error: {
          code: error instanceof SandboxError ? error.code : 'SANDBOX_UNAVAILABLE',
          message: error instanceof SandboxError ? error.message : '沙箱不可用',
        },
        truncated: false,
        durationMs: Date.now() - start,
      };
    }
  }
  forkWorkspace(
    request: WorkspaceRequest & { writeMode?: 'read-only' | 'isolated'; readOnly?: boolean },
  ): Promise<Workspace> {
    return this.request('forkWorkspace', request);
  }
  diffWorkspace(request: WorkspaceRequest): Promise<WorkspaceDiff> {
    return this.request('diffWorkspace', request);
  }
  applyWorkspace(request: WorkspaceRequest & { baseRevision: string }): Promise<Workspace> {
    return this.request('applyWorkspace', request);
  }
  backgroundStart(request: BackgroundRequest): Promise<BackgroundProcess> {
    return this.request('backgroundStart', request);
  }
  backgroundStatus(request: ProcessRequest & { tailLines?: number }): Promise<BackgroundProcess> {
    return this.request('backgroundStatus', request);
  }
  backgroundList(
    request: Owner & { status?: BackgroundProcess['status'] },
  ): Promise<BackgroundProcess[]> {
    return this.request('backgroundList', request);
  }
  backgroundWatch(
    request: ProcessRequest & { event?: 'exit' | 'pattern'; pattern?: string; timeoutMs?: number },
    signal?: AbortSignal,
  ): Promise<BackgroundProcess> {
    return this.request('backgroundWatch', request, signal);
  }
  backgroundStop(request: ProcessRequest): Promise<BackgroundProcess> {
    return this.request('backgroundStop', request);
  }
  releaseConversation(request: Owner): Promise<void> {
    return this.request('releaseConversation', request);
  }
  deleteConversation(request: Owner): Promise<void> {
    return this.request('deleteConversation', request);
  }
  sweepExpired(ttlHours = 24): Promise<{ deletedConversations: number }> {
    return this.request('sweepExpired', { ttlHours });
  }
  async health(): Promise<SandboxHealth> {
    try {
      return await this.request('health', {});
    } catch (error) {
      return {
        ready: false,
        profile: 'isolated',
        publicExecutionEnabled: false,
        reason: error instanceof Error ? error.message : '沙箱不可用',
      };
    }
  }
}
