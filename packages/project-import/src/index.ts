import { lookup } from 'node:dns/promises';
import { request as httpsRequest } from 'node:https';
import { isIP } from 'node:net';
import { crc32 } from 'node:zlib';
import * as yauzl from 'yauzl';
import type { Readable } from 'node:stream';
import { SandboxError } from '../../sandbox-client/src/types.js';
import type { Snapshot } from '../../sandbox-client/src/engine.js';
import {
  IMPORT_LIMITS,
  ImportPathSet,
  importPath,
  blockedImportPath,
} from '../../sandbox-client/src/import-policy.js';

export { IMPORT_LIMITS } from '../../sandbox-client/src/import-policy.js';
export interface ImportedProject {
  files: Snapshot;
  fileCount: number;
  totalBytes: number;
  source: { kind: 'zip' | 'github'; repository?: string; ref?: string };
  omittedPaths: string[];
}
export interface ImportOptions {
  signal?: AbortSignal;
}
export interface PublicAddress {
  address: string;
  family: number;
}
export interface FetchResponse {
  status: number;
  headers: Record<string, string | undefined>;
  body: Uint8Array;
}
export type ImportFetcher = (
  url: URL,
  options: { signal: AbortSignal; maxBytes: number; addresses: PublicAddress[] },
) => Promise<FetchResponse>;
export interface ProjectImporterOptions {
  enabled?: boolean;
  fetcher?: ImportFetcher;
  resolveDns?: (hostname: string) => Promise<PublicAddress[]>;
}
function fail(code: string, message: string): never {
  throw new SandboxError(code, message);
}

export function isPublicAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) {
    const octets = address.split('.').map(Number),
      a = octets[0]!,
      b = octets[1]!,
      c = octets[2]!;
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
  if (family === 6) {
    const [first, second] = address.toLowerCase().split(':');
    const a = parseInt(first ?? '', 16),
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
function validateGithubEndpoint(url: URL): void {
  if (
    url.protocol !== 'https:' ||
    !['api.github.com', 'codeload.github.com'].includes(url.hostname) ||
    url.username ||
    url.password ||
    (url.port && url.port !== '443') ||
    url.hash
  )
    fail('INVALID_INPUT', '仓库下载只能访问固定 GitHub HTTPS 端点');
}
function interrupted(signal: AbortSignal): void {
  if (signal.aborted)
    fail(signal.reason?.name === 'TimeoutError' ? 'TIMEOUT' : 'CANCELLED', '导入已超时或取消');
}
function cancellable<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  interrupted(signal);
  return new Promise<T>((resolve, reject) => {
    const abort = () =>
      reject(
        new SandboxError(
          signal.reason?.name === 'TimeoutError' ? 'TIMEOUT' : 'CANCELLED',
          '导入已超时或取消',
        ),
      );
    signal.addEventListener('abort', abort, { once: true });
    operation.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}
/** Pins the validated DNS answer in the TLS request. No ambient proxy, token, cookies or redirect following. */
export const boundedGithubFetch: ImportFetcher = (url, options) =>
  new Promise((resolve, reject) => {
    validateGithubEndpoint(url);
    interrupted(options.signal);
    const address = options.addresses.find((item) => item.family === 4) ?? options.addresses[0];
    if (!address || !isPublicAddress(address.address)) {
      reject(new SandboxError('INVALID_INPUT', 'GitHub DNS 地址不可用'));
      return;
    }
    const request = httpsRequest(
      url,
      {
        method: 'GET',
        agent: false,
        servername: url.hostname,
        rejectUnauthorized: true,
        signal: options.signal,
        timeout: 15000,
        headers: {
          accept: 'application/vnd.github+json',
          'user-agent': 'MyPI-Project-Importer/1.0',
          'x-github-api-version': '2022-11-28',
          'accept-encoding': 'identity',
        },
        lookup: ((
          _hostname: string,
          lookupOptions: { all?: boolean },
          callback: (...args: any[]) => void,
        ) => {
          if (lookupOptions.all)
            callback(null, [{ address: address.address, family: address.family }]);
          else callback(null, address.address, address.family);
        }) as any,
      },
      (response) => {
        const headers: Record<string, string | undefined> = {};
        for (const [key, value] of Object.entries(response.headers))
          headers[key.toLowerCase()] = Array.isArray(value) ? value[0] : value;
        if (Number(headers['content-length'] ?? 0) > options.maxBytes) {
          response.destroy();
          reject(new SandboxError('LIMIT_EXCEEDED', '仓库下载超过上限'));
          return;
        }
        const chunks: Buffer[] = [];
        let bytes = 0;
        response.on('data', (chunk: Buffer) => {
          bytes += chunk.length;
          if (bytes > options.maxBytes) {
            response.destroy();
            reject(new SandboxError('LIMIT_EXCEEDED', '仓库下载超过上限'));
          } else chunks.push(chunk);
        });
        response.once('error', () => reject(new SandboxError('NETWORK_ERROR', '仓库下载中断')));
        response.once('end', () =>
          resolve({ status: response.statusCode ?? 0, headers, body: Buffer.concat(chunks) }),
        );
      },
    );
    request.once('timeout', () => request.destroy(new SandboxError('TIMEOUT', '仓库连接超时')));
    request.once('error', (error) =>
      reject(
        error instanceof SandboxError
          ? error
          : new SandboxError(
              options.signal.aborted ? 'CANCELLED' : 'NETWORK_ERROR',
              '无法安全下载仓库',
            ),
      ),
    );
    request.end();
  });

export class ProjectImporter {
  private fetcher: ImportFetcher;
  private resolveDns: (hostname: string) => Promise<PublicAddress[]>;
  constructor(private options: ProjectImporterOptions = {}) {
    this.fetcher = options.fetcher ?? boundedGithubFetch;
    this.resolveDns =
      options.resolveDns ?? ((hostname) => lookup(hostname, { all: true, verbatim: true }));
  }
  private assertEnabled(): void {
    if (this.options.enabled !== true) fail('IMPORT_DISABLED', '项目导入尚未由部署者启用');
  }
  private signal(options: ImportOptions): AbortSignal {
    const deadline = AbortSignal.timeout(IMPORT_LIMITS.deadlineMs);
    return options.signal ? AbortSignal.any([options.signal, deadline]) : deadline;
  }
  async fromZip(bytes: Uint8Array, options: ImportOptions = {}): Promise<ImportedProject> {
    this.assertEnabled();
    return this.readZip(Buffer.from(bytes), this.signal(options), false);
  }
  private async readZip(
    bytes: Buffer,
    signal: AbortSignal,
    stripRoot: boolean,
  ): Promise<ImportedProject> {
    interrupted(signal);
    if (!bytes.length || bytes.length > IMPORT_LIMITS.compressedBytes)
      fail('LIMIT_EXCEEDED', 'ZIP 压缩内容必须在 10 MiB 以内');
    const zip = await new Promise<yauzl.ZipFile>((resolve, reject) =>
      yauzl.fromBuffer(
        bytes,
        {
          lazyEntries: true,
          autoClose: true,
          decodeStrings: true,
          validateEntrySizes: true,
          strictFileNames: true,
        },
        (error, archive) =>
          error ? reject(new SandboxError('INVALID_INPUT', 'ZIP 结构无效')) : resolve(archive),
      ),
    );
    if (zip.entryCount > IMPORT_LIMITS.entries) {
      zip.close();
      return fail('LIMIT_EXCEEDED', 'ZIP 条目超过 2000');
    }
    const rawFiles: Snapshot = Object.create(null);
    const omittedPaths: string[] = [];
    const paths = new ImportPathSet();
    let expandedBytes = 0,
      totalBytes = 0,
      entries = 0;
    let rootName: string | undefined;
    let active: Readable | undefined;
    return new Promise<ImportedProject>((resolve, reject) => {
      let settled = false;
      const finish = (error?: unknown) => {
        if (settled) return;
        settled = true;
        signal.removeEventListener('abort', abort);
        active?.destroy();
        zip.close();
        if (error)
          reject(
            error instanceof SandboxError
              ? error
              : new SandboxError('INVALID_INPUT', 'ZIP 文件无效或不完整'),
          );
        else if (!Object.keys(rawFiles).length)
          reject(new SandboxError('INVALID_INPUT', 'ZIP 没有允许导入的文件'));
        else
          resolve({
            files: rawFiles,
            fileCount: Object.keys(rawFiles).length,
            totalBytes,
            source: { kind: 'zip' },
            omittedPaths,
          });
      };
      const abort = () =>
        finish(
          new SandboxError(
            signal.reason?.name === 'TimeoutError' ? 'TIMEOUT' : 'CANCELLED',
            'ZIP 导入已超时或取消',
          ),
        );
      signal.addEventListener('abort', abort, { once: true });
      zip.once('error', finish);
      zip.once('end', () => finish());
      zip.on('entry', (entry: yauzl.Entry) => {
        void (async () => {
          interrupted(signal);
          if (++entries > IMPORT_LIMITS.entries) fail('LIMIT_EXCEEDED', 'ZIP 条目超过 2000');
          if (entry.generalPurposeBitFlag & 1 || ![0, 8].includes(entry.compressionMethod))
            fail('INVALID_INPUT', '不支持加密或特殊压缩 ZIP');
          const mode = (entry.externalFileAttributes >>> 16) & 0xf000;
          const directory = entry.fileName.endsWith('/');
          if (
            (mode && mode !== 0x8000 && mode !== 0x4000) ||
            (directory && mode === 0x8000) ||
            (!directory && mode === 0x4000) ||
            entry.externalFileAttributes & 0x400
          )
            fail('INVALID_INPUT', 'ZIP 不允许链接、设备或特殊文件');
          // Reject Unix link extensions, reparse/custom metadata and unknown formats. No archive metadata is restored.
          if (
            entry.extraFields.some(
              (field) => ![0x0001, 0x5455, 0x7875, 0x7075, 0x6375].includes(field.id),
            )
          )
            fail('INVALID_INPUT', 'ZIP 包含不支持的链接或扩展元数据');
          if (
            entry.uncompressedSize > IMPORT_LIMITS.fileBytes ||
            (directory && entry.uncompressedSize !== 0) ||
            entry.uncompressedSize > Math.max(1, entry.compressedSize) * IMPORT_LIMITS.ratio
          )
            fail('LIMIT_EXCEEDED', 'ZIP 文件大小或展开比例超限');
          expandedBytes += entry.uncompressedSize;
          if (
            expandedBytes > IMPORT_LIMITS.expandedBytes ||
            expandedBytes > bytes.length * IMPORT_LIMITS.ratio
          )
            fail('LIMIT_EXCEEDED', 'ZIP 展开内容超过 32 MiB 或允许比例');
          let name = importPath(directory ? entry.fileName.slice(0, -1) : entry.fileName);
          paths.add(name, directory);
          if (stripRoot) {
            const parts = name.split('/');
            rootName ??= parts[0];
            if (parts[0] !== rootName || (parts.length < 2 && !directory))
              fail('INVALID_INPUT', '仓库快照缺少唯一顶层目录');
            name = parts.slice(1).join('/');
          }
          if (directory || !name) {
            zip.readEntry();
            return;
          }
          if (blockedImportPath(name)) {
            omittedPaths.push(name);
            zip.readEntry();
            return;
          }
          const stream = await new Promise<Readable>((resolve, reject) =>
            zip.openReadStream(entry, (error, value) => (error ? reject(error) : resolve(value!))),
          );
          active = stream;
          const chunks: Buffer[] = [];
          let size = 0;
          let checksum = 0;
          for await (const chunk of stream) {
            interrupted(signal);
            const buffer = Buffer.from(chunk);
            size += buffer.length;
            if (size > IMPORT_LIMITS.fileBytes || totalBytes + size > IMPORT_LIMITS.expandedBytes)
              fail('LIMIT_EXCEEDED', 'ZIP 实际展开内容超限');
            checksum = crc32(buffer, checksum);
            chunks.push(buffer);
          }
          active = undefined;
          if (size !== entry.uncompressedSize || checksum !== entry.crc32)
            fail('INVALID_INPUT', 'ZIP 文件校验失败');
          totalBytes += size;
          rawFiles[name] = Buffer.concat(chunks).toString('base64');
          zip.readEntry();
        })().catch(finish);
      });
      zip.readEntry();
    });
  }
  private async download(url: URL, maxBytes: number, signal: AbortSignal): Promise<Uint8Array> {
    for (let redirects = 0; redirects <= 3; redirects++) {
      interrupted(signal);
      validateGithubEndpoint(url);
      const addresses = await cancellable(this.resolveDns(url.hostname), signal);
      if (
        !addresses.length ||
        addresses.some(
          (item) => !isPublicAddress(item.address) || item.family !== isIP(item.address),
        )
      )
        fail('INVALID_INPUT', 'GitHub DNS 解析包含非公网地址');
      const response = await cancellable(
        this.fetcher(url, { signal, maxBytes, addresses }),
        signal,
      );
      if (response.body.byteLength > maxBytes) fail('LIMIT_EXCEEDED', '仓库下载超过上限');
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        if (!response.headers.location || redirects === 3)
          fail('INVALID_INPUT', '仓库重定向无效或过多');
        url = new URL(response.headers.location, url);
        continue;
      }
      if (response.status !== 200) fail('NETWORK_ERROR', '公开仓库不可用或 GitHub 请求受限');
      return response.body;
    }
    return fail('INVALID_INPUT', '仓库重定向过多');
  }
  async fromGitHub(
    repository: string,
    options: ImportOptions & { ref?: string } = {},
  ): Promise<ImportedProject> {
    this.assertEnabled();
    let parsed: URL;
    try {
      parsed = new URL(repository);
    } catch {
      return fail('INVALID_INPUT', '必须提供 GitHub HTTPS 仓库地址');
    }
    if (
      parsed.protocol !== 'https:' ||
      parsed.hostname !== 'github.com' ||
      parsed.username ||
      parsed.password ||
      parsed.port ||
      parsed.search ||
      parsed.hash
    )
      fail('INVALID_INPUT', '仅支持 github.com 的公开 HTTPS 仓库');
    const match =
      /^\/([a-zA-Z0-9](?:[a-zA-Z0-9-]{0,38}))\/([a-zA-Z0-9_.-]{1,100}?)(?:\.git)?\/?$/.exec(
        parsed.pathname,
      );
    if (!match || ['.', '..'].includes(match[2]!))
      fail('INVALID_INPUT', '仓库地址应为 https://github.com/owner/repo');
    const owner = match[1]!,
      repo = match[2]!,
      signal = this.signal(options);
    const metadataBytes = await this.download(
      new URL(`https://api.github.com/repos/${owner}/${repo}`),
      1024 * 1024,
      signal,
    );
    let metadata: { private?: boolean; default_branch?: string; full_name?: string };
    try {
      metadata = JSON.parse(Buffer.from(metadataBytes).toString('utf8'));
    } catch {
      return fail('INVALID_INPUT', 'GitHub 仓库响应无效');
    }
    if (
      !metadata ||
      typeof metadata !== 'object' ||
      metadata.private !== false ||
      typeof metadata.full_name !== 'string' ||
      metadata.full_name.toLowerCase() !== `${owner}/${repo}`.toLowerCase()
    )
      fail('NOT_AUTHORIZED', '仅支持明确可验证的公共仓库');
    const ref = options.ref ?? metadata.default_branch;
    if (
      typeof ref !== 'string' ||
      !/^[a-zA-Z0-9][a-zA-Z0-9._/-]{0,127}$/.test(ref) ||
      ref.includes('..')
    )
      fail('INVALID_INPUT', 'Git 引用无效');
    const bytes = await this.download(
      new URL(`https://api.github.com/repos/${owner}/${repo}/zipball/${encodeURIComponent(ref)}`),
      IMPORT_LIMITS.compressedBytes,
      signal,
    );
    const result = await this.readZip(Buffer.from(bytes), signal, true);
    return {
      ...result,
      source: { kind: 'github', repository: `https://github.com/${owner}/${repo}`, ref },
    };
  }
}
