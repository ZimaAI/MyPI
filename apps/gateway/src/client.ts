import { request as httpRequest } from 'node:http';
import type { GatewayServices } from './services.js';
import { StoreError } from '@mypi/storage-sqlite';

/** Private bounded JSON RPC; Unix domain socket/named pipe or an explicit loopback address. */
export class WorkerClient implements GatewayServices {
  constructor(
    readonly endpoint: string,
    readonly token: string,
  ) {
    if (token.length < 32) throw new Error('MYPI_WORKER_TOKEN must contain at least 32 characters');
    if (endpoint.startsWith('http:')) {
      const url = new URL(endpoint);
      if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname))
        throw new Error('Worker HTTP transport must use loopback');
    }
  }
  private rpc<T = any>(method: string, args: unknown[]): Promise<T> {
    return new Promise((resolve, reject) => {
      const payload = JSON.stringify({ version: 1, commandId: crypto.randomUUID(), method, args });
      if (Buffer.byteLength(payload) > (method === 'importProject' ? 15 * 1024 * 1024 : 262144)) {
        reject(new StoreError('PAYLOAD_TOO_LARGE', 'Worker command is too large', 413));
        return;
      }
      const target = this.endpoint.startsWith('http:') ? new URL('/rpc', this.endpoint) : undefined;
      const request = httpRequest(
        {
          ...(target
            ? { hostname: target.hostname, port: target.port, path: target.pathname }
            : { socketPath: this.endpoint, path: '/rpc' }),
          method: 'POST',
          headers: {
            authorization: `Bearer ${this.token}`,
            'content-type': 'application/json',
            'content-length': Buffer.byteLength(payload),
          },
          timeout: 60000,
        },
        (response) => {
          const chunks: Buffer[] = [];
          let size = 0;
          response.on('data', (chunk: Buffer) => {
            size += chunk.length;
            if (size > 4194304) {
              request.destroy();
              reject(new StoreError('PAYLOAD_TOO_LARGE', 'Worker response is too large', 413));
              return;
            }
            chunks.push(chunk);
          });
          response.on('end', () => {
            try {
              const result = JSON.parse(Buffer.concat(chunks).toString('utf8'));
              if ((response.statusCode ?? 500) >= 400) {
                reject(
                  new StoreError(
                    result.error?.code ?? 'SERVICE_PAUSED',
                    result.error?.message ?? 'Worker request failed',
                    response.statusCode,
                  ),
                );
                return;
              }
              resolve(result.data);
            } catch {
              reject(new StoreError('SERVICE_PAUSED', 'Invalid worker response', 503));
            }
          });
        },
      );
      request.on('timeout', () => request.destroy(new Error('timeout')));
      request.on('error', () =>
        reject(new StoreError('SERVICE_PAUSED', 'The agent worker is unavailable', 503)),
      );
      request.end(payload);
    });
  }
  createConversation: NonNullable<GatewayServices['createConversation']> = (...args) =>
    this.rpc('createConversation', args);
  submit: GatewayServices['submit'] = (...args) => this.rpc('submit', args);
  cancel: GatewayServices['cancel'] = (...args) => this.rpc('cancel', args);
  cancelTask: NonNullable<GatewayServices['cancelTask']> = (...args) =>
    this.rpc('cancelTask', args);
  importProject: NonNullable<GatewayServices['importProject']> = (...args) =>
    this.rpc('importProject', args);
  workspace: NonNullable<GatewayServices['workspace']> = (...args) => this.rpc('workspace', args);
  file: NonNullable<GatewayServices['file']> = (...args) => this.rpc('file', args);
  artifact: NonNullable<GatewayServices['artifact']> = async (...args) => {
    const result = await this.rpc('artifact', args);
    return {
      ...result,
      content:
        result.encoding === 'base64' ? Buffer.from(result.content, 'base64') : result.content,
    };
  };
  testModel: NonNullable<GatewayServices['testModel']> = (...args) => this.rpc('testModel', args);
  ruleTest: NonNullable<GatewayServices['ruleTest']> = (...args) => this.rpc('ruleTest', args);
  ready: NonNullable<GatewayServices['ready']> = () => this.rpc('ready', []);
  deleteConversation: NonNullable<GatewayServices['deleteConversation']> = (...args) =>
    this.rpc('deleteConversation', args);
  archiveConversation: NonNullable<GatewayServices['archiveConversation']> = (...args) =>
    this.rpc('archiveConversation', args);
  processes: NonNullable<GatewayServices['processes']> = (...args) => this.rpc('processes', args);
  stopProcess: NonNullable<GatewayServices['stopProcess']> = (...args) =>
    this.rpc('stopProcess', args);
  applyPatch: NonNullable<GatewayServices['applyPatch']> = (...args) =>
    this.rpc('applyPatch', args);
  exportFile: NonNullable<GatewayServices['exportFile']> = (...args) =>
    this.rpc('exportFile', args);
}
