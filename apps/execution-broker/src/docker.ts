import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { TrustedLocalSandbox } from '../../../packages/sandbox-client/src/local.js';
import {
  snapshot,
  validateSnapshot,
  cleanText,
} from '../../../packages/sandbox-client/src/engine.js';
import {
  SandboxError,
  type ExecuteRequest,
  type ToolResult,
  type SandboxHealth,
} from '../../../packages/sandbox-client/src/types.js';

export interface DockerSandboxOptions {
  stateRoot: string;
  image: string;
  publicExecutionEnabled: boolean;
  localExecutionEnabled?: boolean;
  runtime?: string;
  dockerBinary?: string;
}
export function dockerArguments(options: DockerSandboxOptions, name: string): string[] {
  if (options.localExecutionEnabled && options.publicExecutionEnabled)
    throw new SandboxError('INVALID_INPUT', '本机与公网执行配置不能同时启用');
  if (
    !/^[a-zA-Z0-9][a-zA-Z0-9._/:-]*@sha256:[a-f0-9]{64}$/.test(options.image) &&
    !(options.localExecutionEnabled && /^sha256:[a-f0-9]{64}$/.test(options.image))
  )
    throw new SandboxError('SANDBOX_UNAVAILABLE', '沙箱镜像必须固定 sha256 digest');
  if (!/^[a-zA-Z0-9_-]+$/.test(options.runtime ?? 'runsc'))
    throw new SandboxError('INVALID_INPUT', '无效 runtime');
  return [
    'run',
    '--rm',
    '-i',
    '--pull=never',
    '--name',
    name,
    '--label',
    'mypi.sandbox=true',
    '--runtime',
    options.localExecutionEnabled ? 'runc' : (options.runtime ?? 'runsc'),
    '--network=none',
    '--read-only',
    '--user=10001:10001',
    '--cap-drop=ALL',
    '--security-opt=no-new-privileges:true',
    '--cpus=1',
    '--memory=1024m',
    '--memory-swap=1024m',
    '--pids-limit=128',
    '--ulimit=nofile=1024:1024',
    '--ulimit=fsize=2097152:2097152',
    '--tmpfs=/workspace:rw,nosuid,nodev,size=256m,mode=0700,uid=10001,gid=10001',
    '--tmpfs=/tmp:rw,nosuid,nodev,noexec,size=32m,mode=1777',
    '--shm-size=16m',
    '--workdir=/workspace',
    '--env=HOME=/tmp',
    '--env=PATH=/usr/local/bin:/usr/bin:/bin',
    '--stop-timeout=2',
    '--log-driver=none',
    options.image,
    'node',
    '/opt/mypi/apps/execution-broker/src/runner.js',
  ];
}
export class DockerSandbox extends TrustedLocalSandbox {
  private activeContainers = new Set<string>();
  private checked?: { at: number; health: SandboxHealth };
  constructor(private dockerOptions: DockerSandboxOptions) {
    super({
      root: dockerOptions.stateRoot,
      stateRoot: dockerOptions.stateRoot,
      explicitlyTrusted: true,
      managedWorkspaces: true,
    });
  }
  private docker(argv: string[], timeoutMs = 10000): Promise<string> {
    return new Promise((resolve, reject) => {
      const child = spawn(this.dockerOptions.dockerBinary ?? 'docker', argv, {
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      });
      let stdout = '';
      let size = 0;
      child.stdout.on('data', (chunk: Buffer) => {
        size += chunk.length;
        if (size > 1024 * 1024) child.kill();
        else stdout += chunk.toString();
      });
      child.stderr.resume();
      const timer = setTimeout(() => child.kill(), timeoutMs);
      child.once('error', () => {
        clearTimeout(timer);
        reject(new SandboxError('SANDBOX_UNAVAILABLE', 'Docker 不可用'));
      });
      child.once('close', (code) => {
        clearTimeout(timer);
        if (code === 0) resolve(stdout);
        else reject(new SandboxError('SANDBOX_UNAVAILABLE', '隔离运行时命令失败'));
      });
    });
  }
  override async health(): Promise<SandboxHealth> {
    if (!this.dockerOptions.publicExecutionEnabled && !this.dockerOptions.localExecutionEnabled)
      return {
        ready: false,
        profile: 'isolated',
        publicExecutionEnabled: false,
        reason: 'PUBLIC_EXECUTION_ENABLED=false；公开执行未开放',
      };
    if (this.checked && Date.now() - this.checked.at < 10000) return this.checked.health;
    let health: SandboxHealth;
    try {
      dockerArguments(this.dockerOptions, 'mypi-validation');
      const info = JSON.parse(await this.docker(['info', '--format', '{{json .}}']));
      if (
        info.OSType !== 'linux' ||
        (!this.dockerOptions.localExecutionEnabled &&
          !info.SecurityOptions?.some((item: string) => item.includes('rootless'))) ||
        !info.SecurityOptions?.some((item: string) => item.includes('seccomp')) ||
        String(info.CgroupVersion) !== '2' ||
        !info.CgroupDriver ||
        info.CgroupDriver === 'none'
      )
        throw new SandboxError(
          'SANDBOX_UNAVAILABLE',
          '需要 Linux rootless、seccomp 和有效 cgroup v2 限额',
        );
      const runtime = this.dockerOptions.localExecutionEnabled
        ? 'runc'
        : (this.dockerOptions.runtime ?? 'runsc');
      if (!info.Runtimes?.[runtime])
        throw new SandboxError('SANDBOX_UNAVAILABLE', '固定隔离 runtime 未安装');
      await this.docker(['image', 'inspect', this.dockerOptions.image]);
      health = {
        ready: true,
        profile: this.dockerOptions.localExecutionEnabled ? 'isolated-local' : 'isolated',
        publicExecutionEnabled: this.dockerOptions.publicExecutionEnabled,
        localExecutionEnabled: this.dockerOptions.localExecutionEnabled === true,
      };
    } catch (error) {
      health = {
        ready: false,
        profile: this.dockerOptions.localExecutionEnabled ? 'isolated-local' : 'isolated',
        publicExecutionEnabled: this.dockerOptions.publicExecutionEnabled,
        localExecutionEnabled: this.dockerOptions.localExecutionEnabled === true,
        reason: error instanceof SandboxError ? error.message : '沙箱配置检查失败',
      };
    }
    this.checked = { at: Date.now(), health };
    return health;
  }
  async cleanupOrphans(): Promise<void> {
    const ids = (await this.docker(['ps', '-aq', '--filter', 'label=mypi.sandbox=true']))
      .trim()
      .split(/\s+/)
      .filter((id) => /^[a-f0-9]{12,64}$/.test(id));
    for (const id of ids) await this.docker(['rm', '-f', id]);
  }
  private async removeContainer(name: string): Promise<void> {
    try {
      await this.docker(['rm', '-f', name]);
    } catch {
      /* --rm may have already removed it */
    }
  }
  override async shutdown(): Promise<void> {
    await super.shutdown();
    await Promise.all([...this.activeContainers].map((name) => this.removeContainer(name)));
  }
  protected override async runOperation(
    root: string,
    request: ExecuteRequest,
    signal?: AbortSignal,
    onOutput?: (stream: 'stdout' | 'stderr', text: string) => void,
  ): Promise<ToolResult> {
    const start = Date.now();
    const ready = await this.health();
    if (!ready.ready)
      throw new SandboxError('SANDBOX_UNAVAILABLE', ready.reason ?? '隔离执行器不可用');
    if (signal?.aborted) throw new SandboxError('CANCELLED', '执行已取消');
    const limit = this.dockerOptions.localExecutionEnabled ? 1 : 2;
    if (this.activeContainers.size >= limit)
      throw new SandboxError('LIMIT_EXCEEDED', `全局执行沙箱已达 ${limit} 个`);
    const name = `mypi-${randomUUID()}`;
    this.activeContainers.add(name);
    const timeoutMs =
      Math.min(
        600000,
        typeof request.args.timeoutMs === 'number' ? request.args.timeoutMs : 60000,
      ) + 5000;
    try {
      const files = await snapshot(root);
      const argv = dockerArguments(this.dockerOptions, name);
      const result = await new Promise<{ result: ToolResult; files: typeof files }>(
        (resolve, reject) => {
          const child = spawn(this.dockerOptions.dockerBinary ?? 'docker', argv, {
            stdio: ['pipe', 'pipe', 'pipe'],
            windowsHide: true,
          });
          let pending = '';
          let received = 0;
          let settled = false;
          let message: { result: ToolResult; files: typeof files } | undefined;
          const finish = (error?: Error) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            signal?.removeEventListener('abort', abort);
            if (error) reject(error);
            else if (message) resolve(message);
            else reject(new SandboxError('EXECUTION_ERROR', '沙箱未返回有效结果'));
          };
          const abort = () => {
            void this.removeContainer(name);
            child.kill();
            finish(new SandboxError('CANCELLED', '执行已取消'));
          };
          const timer = setTimeout(() => {
            void this.removeContainer(name);
            child.kill();
            finish(new SandboxError('TIMEOUT', '沙箱租约已到期'));
          }, timeoutMs);
          signal?.addEventListener('abort', abort, { once: true });
          child.stdout.on('data', (chunk: Buffer) => {
            received += chunk.length;
            if (received > 100 * 1024 * 1024) {
              child.kill();
              finish(new SandboxError('LIMIT_EXCEEDED', '沙箱输出超限'));
              return;
            }
            pending += chunk.toString();
            let end: number;
            while ((end = pending.indexOf('\n')) >= 0) {
              const line = pending.slice(0, end);
              pending = pending.slice(end + 1);
              try {
                const event = JSON.parse(line);
                if (
                  event.type === 'log' &&
                  ['stdout', 'stderr'].includes(event.stream) &&
                  typeof event.text === 'string'
                )
                  onOutput?.(event.stream, cleanText(event.text));
                else if (event.type === 'result') {
                  validateSnapshot(event.files);
                  message = event;
                }
              } catch {
                child.kill();
                finish(new SandboxError('EXECUTION_ERROR', '无效的沙箱响应'));
              }
            }
          });
          child.stderr.resume();
          child.stdin.on('error', () => {});
          child.once('error', () =>
            finish(new SandboxError('SANDBOX_UNAVAILABLE', '沙箱启动失败')),
          );
          child.once('close', (code) =>
            finish(code === 0 ? undefined : new SandboxError('EXECUTION_ERROR', '沙箱执行中断')),
          );
          child.stdin.end(
            JSON.stringify({ files, operation: request.operation, args: request.args }),
          );
        },
      );
      if (!request.readOnly) await this.commitFiles(request.principalId, root, result.files);
      return { ...result.result, durationMs: Date.now() - start };
    } finally {
      await this.removeContainer(name);
      this.activeContainers.delete(name);
    }
  }
}
