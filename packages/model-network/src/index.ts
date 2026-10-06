import { lookup } from 'node:dns/promises';
import { request as httpsRequest } from 'node:https';
import { isIP } from 'node:net';
import { Readable, Transform } from 'node:stream';

export interface ModelAddress {
  address: string;
  family: number;
}
export function isPublicModelAddress(address: string): boolean {
  if (isIP(address) === 4) {
    const [a, b, c] = address.split('.').map(Number);
    return !(
      a === 0 ||
      a === 10 ||
      a === 127 ||
      a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && (b === 168 || (b === 0 && [0, 2].includes(c)))) ||
      (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) ||
      (a === 203 && b === 0 && c === 113)
    );
  }
  if (isIP(address) === 6) {
    const [first, second] = address.toLowerCase().split(':');
    const a = parseInt(first, 16),
      b = parseInt(second || '0', 16);
    return (
      a >= 0x2000 &&
      a <= 0x3fff &&
      a !== 0x2002 &&
      !(a === 0x2001 && (b < 0x200 || b === 0xdb8)) &&
      !(a === 0x3fff && b < 0x1000)
    );
  }
  return false;
}

/** Administrator supplied web endpoints are public HTTPS base URLs, never credentials. */
export function normalizeModelBaseUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new Error('模型端点必须是完整的 HTTPS Base URL');
  }
  const host = url.hostname
    .replace(/^\[|\]$/g, '')
    .replace(/\.$/, '')
    .toLowerCase();
  if (
    value.length > 2048 ||
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    /[\\\s]/.test(value.trim()) ||
    (!host.includes('.') && !isIP(host)) ||
    /(?:^|\.)(localhost|local|internal|lan|home|test|invalid)$/.test(host) ||
    (isIP(host) && !isPublicModelAddress(host))
  )
    throw new Error('模型端点只支持公网 HTTPS 地址，不能包含凭据、查询参数或片段');
  if (/\/(?:chat\/completions|responses|messages)\/?$/.test(url.pathname))
    throw new Error('请填写 Base URL，不要包含 chat/completions、responses 或 messages 接口路径');
  url.hostname = isIP(host) === 6 ? `[${host}]` : host;
  return url.toString().replace(/\/+$/, '');
}

export interface ModelFetchOptions {
  resolveDns?: (hostname: string) => Promise<ModelAddress[]>;
  /** Trusted test seam only; never populated from stored model configuration. */
  request?: typeof httpsRequest;
  timeoutMs?: number;
  maxBytes?: number;
}

/** Per-session fetch: validate every DNS answer, pin it into TLS, never follow redirects.
 * The SDK's retries/tool continuations/compaction all use this same transport.
 */
export function createPublicModelFetch(
  baseUrl: string,
  options: ModelFetchOptions = {},
): typeof fetch {
  const base = new URL(normalizeModelBaseUrl(baseUrl));
  const resolveDns = options.resolveDns ?? ((host) => lookup(host, { all: true, verbatim: true }));
  const send = options.request ?? httpsRequest;
  const maxBytes = options.maxBytes ?? 32 * 1024 * 1024;
  return async (input, init) => {
    const request = new Request(input, init);
    const target = new URL(request.url);
    if (
      target.origin !== base.origin ||
      target.username ||
      target.password ||
      !target.pathname.startsWith(`${base.pathname.replace(/\/$/, '')}/`) ||
      request.method !== 'POST'
    )
      throw new Error('模型请求不能离开配置的端点或基础路径');
    const signal = AbortSignal.any([
      request.signal,
      AbortSignal.timeout(options.timeoutMs ?? 300000),
    ]);
    signal.throwIfAborted();
    const host = target.hostname.replace(/^\[|\]$/g, '');
    const addresses = await new Promise<ModelAddress[]>((resolve, reject) => {
      const abort = () => reject(signal.reason);
      signal.addEventListener('abort', abort, { once: true });
      const task = isIP(host)
        ? Promise.resolve([{ address: host, family: isIP(host) }])
        : resolveDns(host);
      task.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
    });
    signal.throwIfAborted();
    if (!addresses.length || addresses.some((item) => !isPublicModelAddress(item.address)))
      throw new Error('模型端点 DNS 必须全部解析到公网地址');
    const address = addresses.find((item) => item.family === 4) ?? addresses[0];
    const body = Buffer.from(await request.arrayBuffer());
    signal.throwIfAborted();
    const headers = Object.fromEntries(request.headers);
    // TLS host and framing belong to this endpoint, never to caller-supplied headers.
    for (const name of [
      'host',
      'connection',
      'transfer-encoding',
      'content-length',
      'proxy-authorization',
    ])
      delete headers[name];
    headers['accept-encoding'] = 'identity';
    headers['content-length'] = String(body.length);
    return new Promise<Response>((resolve, reject) => {
      const outgoing = send(
        target,
        {
          method: 'POST',
          headers,
          signal,
          agent: false,
          timeout: 30000,
          servername: isIP(host) ? undefined : host,
          rejectUnauthorized: true,
          lookup: ((
            _hostname: string,
            lookupOptions: { all?: boolean },
            callback: (...args: any[]) => void,
          ) => {
            if (lookupOptions.all) callback(null, [address]);
            else callback(null, address.address, address.family);
          }) as any,
        },
        (incoming) => {
          const status = incoming.statusCode ?? 502;
          if (status >= 300 && status < 400) {
            incoming.destroy();
            reject(new Error('模型端点不允许重定向，请填写最终 Base URL'));
            return;
          }
          if (
            Number(incoming.headers['content-length'] ?? 0) > maxBytes ||
            (incoming.headers['content-encoding'] &&
              incoming.headers['content-encoding'] !== 'identity')
          ) {
            incoming.destroy();
            reject(new Error('模型响应超过大小限制或使用了不支持的压缩'));
            return;
          }
          const responseHeaders = new Headers();
          for (const [name, value] of Object.entries(incoming.headers))
            if (value !== undefined)
              responseHeaders.set(name, Array.isArray(value) ? value.join(', ') : value);
          let received = 0;
          const bounded = new Transform({
            transform(chunk: Buffer, _encoding, callback) {
              received += chunk.length;
              callback(received > maxBytes ? new Error('模型响应超过大小限制') : null, chunk);
            },
          });
          incoming.on('error', (error) => bounded.destroy(error));
          bounded.on('close', () => incoming.destroy());
          incoming.pipe(bounded);
          if ([204, 205, 304].includes(status)) {
            incoming.destroy();
            bounded.destroy();
            resolve(new Response(null, { status, headers: responseHeaders }));
          } else
            resolve(
              new Response(Readable.toWeb(bounded) as ReadableStream<Uint8Array>, {
                status,
                headers: responseHeaders,
              }),
            );
        },
      );
      outgoing.on('timeout', () => outgoing.destroy(new Error('模型端点连接或响应超时')));
      outgoing.on('error', reject);
      outgoing.end(body);
    });
  };
}
