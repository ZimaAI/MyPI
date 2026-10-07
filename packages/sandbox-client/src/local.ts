import * as fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { isUtf8 } from 'node:buffer';
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
import {
  cleanText,
  operate,
  restore,
  safePath,
  snapshot,
  snapshotRevision,
  writeSafe,
  readSafe,
  hash,
  MAX_OUTPUT,
  type Snapshot,
} from './engine.js';
import { templateFiles, withGitBaseline } from './templates.js';
import { sanitizeImportedSnapshot } from './import-policy.js';

interface StoredWorkspace {
  metadata: Workspace;
  root: string;
  createdAt: string;
  baseFiles?: Snapshot;
}
export interface LocalSandboxOptions {
  root: string;
  stateRoot?: string;
  explicitlyTrusted: true;
  managedWorkspaces?: boolean;
  globalManagedBytes?: number;
}
export class TrustedLocalSandbox implements SandboxPort {
  protected workspaces = new Map<string, StoredWorkspace>();
  protected processes = new Map<string, BackgroundProcess>();
  protected controllers = new Map<string, AbortController>();
  private backgroundJobs = new Map<string, Promise<void>>();
  private storageLocks = new Map<string, Promise<void>>();
  protected busy = new Set<string>();
  protected operationControllers = new Map<string, AbortController>();
  protected events = new EventEmitter();
  protected stateRoot: string;
  private loaded?: Promise<void>;
  constructor(protected options: LocalSandboxOptions) {
    if (options.explicitlyTrusted !== true)
      throw new SandboxError('NOT_AUTHORIZED', '本地执行必须明确授权 trusted-local');
    this.stateRoot = path.resolve(
      options.stateRoot ?? path.join(os.tmpdir(), `mypi-local-${process.pid}-${randomUUID()}`),
    );
    this.events.setMaxListeners(100);
  }
  protected async initialize(): Promise<void> {
    if (!this.loaded)
      this.loaded = (async () => {
        await fs.mkdir(this.stateRoot, { recursive: true, mode: 0o700 });
        try {
          const saved = JSON.parse(
            await fs.readFile(path.join(this.stateRoot, 'workspaces.json'), 'utf8'),
          ) as StoredWorkspace[];
          for (const workspace of saved) {
            workspace.createdAt ??= new Date().toISOString();
            this.workspaces.set(workspace.metadata.workspaceId, workspace);
          }
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        }
        try {
          const saved = JSON.parse(
            await fs.readFile(path.join(this.stateRoot, 'processes.json'), 'utf8'),
          ) as BackgroundProcess[];
          for (const item of saved) {
            if (item.status === 'running') {
              item.status = 'failed';
              item.logs.push({
                stream: 'stderr',
                text: '服务重启，执行已中断；不会自动重放',
                at: new Date().toISOString(),
              });
            }
            this.processes.set(item.processId, item);
          }
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        }
      })();
    await this.loaded;
  }
  private saveQueue = Promise.resolve();
  protected async persist(): Promise<void> {
    this.saveQueue = this.saveQueue
      .catch(() => {})
      .then(async () => {
        const file = path.join(this.stateRoot, 'workspaces.json');
        const temporary = file + '.tmp';
        await fs.writeFile(temporary, JSON.stringify([...this.workspaces.values()]), {
          mode: 0o600,
        });
        await fs.rename(temporary, file);
        const processFile = path.join(this.stateRoot, 'processes.json');
        await fs.writeFile(processFile + '.tmp', JSON.stringify([...this.processes.values()]), {
          mode: 0o600,
        });
        await fs.rename(processFile + '.tmp', processFile);
      });
    await this.saveQueue;
  }
  protected async own(request: WorkspaceRequest): Promise<StoredWorkspace> {
    await this.initialize();
    const value = this.workspaces.get(request.workspaceId);
    if (
      !value ||
      value.metadata.principalId !== request.principalId ||
      value.metadata.conversationId !== request.conversationId
    )
      throw new SandboxError('NOT_FOUND', '工作区不存在');
    return value;
  }
  protected async updateRevision(value: StoredWorkspace): Promise<Workspace> {
    value.metadata.revision = snapshotRevision(await snapshot(value.root));
    await this.persist();
    return { ...value.metadata };
  }
  protected async withStorageLock<T>(principalId: string, operation: () => Promise<T>): Promise<T> {
    const key = this.options.globalManagedBytes ? '\0global' : principalId;
    const previous = this.storageLocks.get(key) ?? Promise.resolve();
    let release!: () => void;
    const next = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.storageLocks.set(key, next);
    await previous;
    try {
      return await operation();
    } finally {
      release();
      if (this.storageLocks.get(key) === next) this.storageLocks.delete(key);
    }
  }
  protected async checkStorageQuota(
    principalId: string,
    incoming: Snapshot = {},
    replacingRoot?: string,
    copies = 1,
  ): Promise<void> {
    if (!this.options.managedWorkspaces) return;
    const snapshotBytes = (files: Snapshot) =>
      Object.values(files).reduce((sum, encoded) => sum + Buffer.byteLength(encoded, 'base64'), 0);
    const incomingBytes = copies * snapshotBytes(incoming);
    let principalBytes = incomingBytes;
    let globalBytes = incomingBytes;
    for (const value of this.workspaces.values()) {
      const bytes =
        (value.root === replacingRoot ? 0 : snapshotBytes(await snapshot(value.root))) +
        (value.baseFiles ? snapshotBytes(value.baseFiles) : 0);
      globalBytes += bytes;
      if (value.metadata.principalId === principalId) principalBytes += bytes;
    }
    for (const process of this.processes.values()) {
      const root = path.join(this.stateRoot, 'background', process.processId);
      if (root === replacingRoot) continue;
      try {
        const bytes = snapshotBytes(await snapshot(root));
        globalBytes += bytes;
        if (process.principalId === principalId) principalBytes += bytes;
      } catch (error) {
        if ((error as SandboxError).code !== 'NOT_FOUND') throw error;
      }
    }
    if (principalBytes > 256 * 1024 * 1024)
      throw new SandboxError('LIMIT_EXCEEDED', '该身份的工作区与副本总量超过 256 MiB');
    if (this.options.globalManagedBytes && globalBytes > this.options.globalManagedBytes)
      throw new SandboxError('LIMIT_EXCEEDED', '全站托管工作区存储已达上限');
  }
  async createWorkspace(request: Owner & { templateId?: string }): Promise<Workspace> {
    return this.withStorageLock(request.principalId, () => this.createWorkspaceUnlocked(request));
  }
  private async createWorkspaceUnlocked(
    request: Owner & { templateId?: string },
  ): Promise<Workspace> {
    await this.initialize();
    const existing = [...this.workspaces.values()].find(
      (value) =>
        value.metadata.principalId === request.principalId &&
        value.metadata.conversationId === request.conversationId &&
        !value.metadata.parentWorkspaceId,
    );
    if (existing) return this.updateRevision(existing);
    if (
      this.options.managedWorkspaces &&
      [...this.workspaces.values()].filter(
        (value) =>
          value.metadata.principalId === request.principalId && !value.metadata.parentWorkspaceId,
      ).length >= 50
    )
      throw new SandboxError('LIMIT_EXCEEDED', '该身份最多保留 50 个会话工作区');
    const workspaceId = randomUUID();
    const root = this.options.managedWorkspaces
      ? path.join(this.stateRoot, 'workspaces', workspaceId)
      : path.resolve(this.options.root);
    await fs.mkdir(root, { recursive: true, mode: 0o700 });
    if (this.options.managedWorkspaces) {
      let files: Snapshot;
      try {
        files = withGitBaseline(templateFiles(request.templateId));
      } catch {
        throw new SandboxError('INVALID_INPUT', '模板不存在');
      }
      await this.checkStorageQuota(request.principalId, files);
      await restore(root, files);
    }
    const metadata: Workspace = {
      ...request,
      workspaceId,
      templateId: request.templateId ?? 'javascript-starter',
      revision: snapshotRevision(await snapshot(root)),
      readOnly: false,
    };
    this.workspaces.set(workspaceId, { metadata, root, createdAt: new Date().toISOString() });
    await this.persist();
    return { ...metadata };
  }
  protected async runOperation(
    root: string,
    request: ExecuteRequest,
    signal?: AbortSignal,
    onOutput?: (stream: 'stdout' | 'stderr', text: string) => void,
  ): Promise<ToolResult> {
    return operate(root, request.operation, request.args, signal, onOutput);
  }
  async workspaceFiles(request: WorkspaceRequest): Promise<WorkspaceFile[]> {
    const value = await this.own(request);
    const files = await snapshot(value.root);
    return Object.entries(files)
      .filter(([name]) => !name.startsWith('.git/'))
      .map(([name, encoded]) => ({ path: name, bytes: Buffer.byteLength(encoded, 'base64') }));
  }
  async workspaceRead(request: WorkspaceRequest & { path: string }): Promise<WorkspaceFileContent> {
    const value = await this.own(request);
    const content = await readSafe(value.root, request.path);
    const binary = content.includes(0) || !isUtf8(content);
    return {
      path: request.path,
      content: binary ? '' : content.subarray(0, MAX_OUTPUT).toString('utf8'),
      version: hash(content),
      truncated: content.length > MAX_OUTPUT,
      binary,
    };
  }
  async importWorkspace(
    request: WorkspaceRequest & { files: Snapshot; expectedRevision?: string },
  ): Promise<Workspace> {
    return this.withStorageLock(request.principalId, async () => {
      const value = await this.own(request);
      if (
        !this.options.managedWorkspaces ||
        value.metadata.readOnly ||
        value.metadata.parentWorkspaceId
      )
        throw new SandboxError('NOT_AUTHORIZED', '只能导入到托管会话主工作区');
      if (
        this.busy.has(request.workspaceId) ||
        [...this.processes.values()].some(
          (item) => item.workspaceId === request.workspaceId && item.status === 'running',
        )
      )
        throw new SandboxError('CONFLICT', '工作区仍有运行中的操作');
      this.busy.add(request.workspaceId);
      try {
        const before = snapshotRevision(await snapshot(value.root));
        let pristine: string | undefined;
        try {
          pristine = snapshotRevision(withGitBaseline(templateFiles(value.metadata.templateId)));
        } catch {
          /* Previously imported workspaces always require an explicit revision. */
        }
        if (
          request.expectedRevision !== undefined &&
          !/^[a-f0-9]{64}$/.test(request.expectedRevision)
        )
          throw new SandboxError('INVALID_INPUT', '导入 revision 无效');
        if (request.expectedRevision ? before !== request.expectedRevision : before !== pristine)
          throw new SandboxError('CONFLICT', '工作区已修改，请刷新 revision 后确认导入');
        // Import is a content snapshot, not a repository clone; no original or fabricated Git metadata is retained.
        const { files } = sanitizeImportedSnapshot(request.files);
        await this.checkStorageQuota(request.principalId, files, value.root);
        await this.replaceFiles(value.root, files);
        value.metadata.templateId = 'imported';
        return await this.updateRevision(value);
      } finally {
        this.busy.delete(request.workspaceId);
        this.events.emit(`workspace:${request.workspaceId}`);
      }
    });
  }
  async execute(request: ExecuteRequest, signal?: AbortSignal): Promise<ToolResult> {
    const start = Date.now();
    try {
      const value = await this.own(request);
      if (!this.workspaces.has(request.workspaceId))
        throw new SandboxError('NOT_FOUND', '工作区已删除');
      if (
        (value.metadata.readOnly || request.readOnly) &&
        ['write', 'edit', 'bash'].includes(request.operation)
      )
        throw new SandboxError('NOT_AUTHORIZED', '只读任务不能使用写入或 Bash');
      if (this.busy.has(request.workspaceId))
        throw new SandboxError('CONFLICT', '工作区正在执行另一个操作');
      this.busy.add(request.workspaceId);
      const controller = new AbortController();
      this.operationControllers.set(request.workspaceId, controller);
      try {
        const args = { ...request.args };
        if (
          request.operation === 'bash' &&
          (typeof args.timeoutMs !== 'number' || args.timeoutMs > 60000)
        )
          args.timeoutMs = 30000;
        const result = await this.runOperation(
          value.root,
          { ...request, args },
          signal ? AbortSignal.any([signal, controller.signal]) : controller.signal,
        );
        await this.updateRevision(value);
        return result;
      } finally {
        this.busy.delete(request.workspaceId);
        this.operationControllers.delete(request.workspaceId);
        this.events.emit(`workspace:${request.workspaceId}`);
      }
    } catch (error) {
      return {
        ok: false,
        data: null,
        error: {
          code: error instanceof SandboxError ? error.code : 'EXECUTION_ERROR',
          message: error instanceof SandboxError ? error.message : '执行失败',
        },
        truncated: false,
        durationMs: Date.now() - start,
      };
    }
  }
  async forkWorkspace(
    request: WorkspaceRequest & { writeMode?: 'read-only' | 'isolated'; readOnly?: boolean },
  ): Promise<Workspace> {
    return this.withStorageLock(request.principalId, () => this.forkWorkspaceUnlocked(request));
  }
  private async forkWorkspaceUnlocked(
    request: WorkspaceRequest & { writeMode?: 'read-only' | 'isolated'; readOnly?: boolean },
  ): Promise<Workspace> {
    const parent = await this.own(request);
    const files = await snapshot(parent.root);
    const revision = snapshotRevision(files);
    if (
      [...this.workspaces.values()].filter(
        (value) =>
          value.metadata.principalId === request.principalId && value.metadata.parentWorkspaceId,
      ).length >= 100
    )
      throw new SandboxError('LIMIT_EXCEEDED', '该身份最多保留 100 个任务副本');
    await this.checkStorageQuota(request.principalId, files, undefined, 2);
    const workspaceId = randomUUID();
    const root = path.join(this.stateRoot, 'copies', workspaceId);
    await restore(root, files);
    const metadata: Workspace = {
      ...parent.metadata,
      workspaceId,
      revision,
      parentWorkspaceId: parent.metadata.workspaceId,
      baseRevision: revision,
      readOnly: request.readOnly ?? request.writeMode !== 'isolated',
    };
    this.workspaces.set(workspaceId, {
      metadata,
      root,
      baseFiles: files,
      createdAt: new Date().toISOString(),
    });
    await this.persist();
    return { ...metadata };
  }
  async diffWorkspace(request: WorkspaceRequest): Promise<WorkspaceDiff> {
    const child = await this.own(request);
    if (!child.metadata.parentWorkspaceId || !child.baseFiles)
      throw new SandboxError('INVALID_INPUT', '该工作区不是任务副本');
    const parent = await this.own({ ...request, workspaceId: child.metadata.parentWorkspaceId });
    const after = await snapshot(child.root);
    const currentRevision = snapshotRevision(await snapshot(parent.root));
    const files: WorkspaceDiff['files'] = [];
    const patches: string[] = [];
    for (const name of [
      ...new Set([...Object.keys(child.baseFiles), ...Object.keys(after)]),
    ].sort()) {
      const before = child.baseFiles[name],
        next = after[name];
      if (before === next) continue;
      const status = before === undefined ? 'added' : next === undefined ? 'deleted' : 'modified';
      files.push({ path: name, status });
      const oldLines =
        before === undefined
          ? []
          : Buffer.from(before, 'base64').toString().replace(/\n$/, '').split('\n');
      const newLines =
        next === undefined
          ? []
          : Buffer.from(next, 'base64').toString().replace(/\n$/, '').split('\n');
      patches.push(
        `diff --git a/${name} b/${name}\n--- ${before === undefined ? '/dev/null' : `a/${name}`}\n+++ ${next === undefined ? '/dev/null' : `b/${name}`}\n@@ -${oldLines.length ? 1 : 0},${oldLines.length} +${newLines.length ? 1 : 0},${newLines.length} @@\n${oldLines
          .map((line) => '-' + line)
          .concat(newLines.map((line) => '+' + line))
          .join('\n')}\n`,
      );
    }
    return {
      workspaceId: request.workspaceId,
      parentWorkspaceId: parent.metadata.workspaceId,
      baseRevision: child.metadata.baseRevision!,
      currentRevision,
      conflict: currentRevision !== child.metadata.baseRevision,
      patch: patches.join(''),
      files,
    };
  }
  protected async replaceFiles(root: string, files: Snapshot): Promise<void> {
    const current = await snapshot(root);
    const directories = new Set<string>();
    for (const name of Object.keys(current))
      if (!(name in files)) {
        await fs.unlink(await safePath(root, name));
        const parts = name.split('/');
        for (let length = 1; length < parts.length; length++)
          directories.add(parts.slice(0, length).join('/'));
      }
    // A removed directory may become a regular file in the incoming snapshot.
    // Only prune validated empty ancestors of removed files, never the workspace root.
    for (const name of [...directories].sort((a, b) => b.split('/').length - a.split('/').length)) {
      try {
        await fs.rmdir(await safePath(root, name));
      } catch (error) {
        if (!['ENOTEMPTY', 'EEXIST'].includes((error as NodeJS.ErrnoException).code ?? ''))
          throw error;
      }
    }
    for (const [name, encoded] of Object.entries(files))
      if (current[name] !== encoded) await writeSafe(root, name, Buffer.from(encoded, 'base64'));
  }
  protected async commitFiles(principalId: string, root: string, files: Snapshot): Promise<void> {
    await this.withStorageLock(principalId, async () => {
      await this.checkStorageQuota(principalId, files, root);
      await this.replaceFiles(root, files);
    });
  }
  async applyWorkspace(request: WorkspaceRequest & { baseRevision: string }): Promise<Workspace> {
    const child = await this.own(request);
    const diff = await this.diffWorkspace(request);
    if (child.metadata.readOnly) throw new SandboxError('NOT_AUTHORIZED', '只读任务不能应用变更');
    if (
      diff.conflict ||
      request.baseRevision !== diff.baseRevision ||
      this.busy.has(diff.parentWorkspaceId)
    )
      throw new SandboxError('CONFLICT', '主工作区已修改，未应用副本');
    const parent = await this.own({ ...request, workspaceId: diff.parentWorkspaceId });
    this.busy.add(diff.parentWorkspaceId);
    try {
      await this.commitFiles(request.principalId, parent.root, await snapshot(child.root));
      return await this.updateRevision(parent);
    } finally {
      this.busy.delete(diff.parentWorkspaceId);
      this.events.emit(`workspace:${diff.parentWorkspaceId}`);
    }
  }
  protected ownProcess(request: ProcessRequest): BackgroundProcess {
    const value = this.processes.get(request.processId);
    if (
      !value ||
      value.principalId !== request.principalId ||
      value.conversationId !== request.conversationId
    )
      throw new SandboxError('NOT_FOUND', '进程不存在');
    return value;
  }
  protected processCopy(value: BackgroundProcess, tailLines = 100): BackgroundProcess {
    return { ...value, logs: value.logs.slice(-tailLines).map((line) => ({ ...line })) };
  }
  async backgroundStart(request: BackgroundRequest): Promise<BackgroundProcess> {
    return this.withStorageLock(request.principalId, () => this.backgroundStartUnlocked(request));
  }
  private async backgroundStartUnlocked(request: BackgroundRequest): Promise<BackgroundProcess> {
    const value = await this.own(request);
    if (value.metadata.readOnly)
      throw new SandboxError('NOT_AUTHORIZED', '只读工作区不能运行后台进程');
    if (
      typeof request.command !== 'string' ||
      request.command.length > 16384 ||
      typeof request.title !== 'string' ||
      request.title.length > 200
    )
      throw new SandboxError('INVALID_INPUT', '后台进程参数无效');
    const ttl = request.ttlSeconds ?? 600;
    if (!Number.isInteger(ttl) || ttl < 1 || ttl > 600)
      throw new SandboxError('INVALID_INPUT', '后台 TTL 必须在 1–600 秒');
    if (
      [...this.processes.values()].filter(
        (p) => p.status === 'running' && p.principalId === request.principalId,
      ).length >= 2
    )
      throw new SandboxError('LIMIT_EXCEEDED', '后台进程并发已达上限');
    if (
      [...this.processes.values()].filter((p) => p.principalId === request.principalId).length >= 50
    )
      throw new SandboxError('LIMIT_EXCEEDED', '该身份最多保留 50 条后台执行记录');
    const processId = randomUUID();
    const controller = new AbortController();
    const files = await snapshot(value.root);
    const baseRevision = snapshotRevision(files);
    const root = path.join(this.stateRoot, 'background', processId);
    await this.checkStorageQuota(request.principalId, files);
    await restore(root, files);
    const item: BackgroundProcess = {
      ...request,
      processId,
      status: 'running',
      startedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + ttl * 1000).toISOString(),
      logs: [],
      truncated: false,
    };
    this.processes.set(processId, item);
    this.controllers.set(processId, controller);
    await this.persist();
    const timeout = setTimeout(() => {
      item.status = 'expired';
      controller.abort();
    }, ttl * 1000);
    const emit = () => this.events.emit(processId);
    const job = (async () => {
      try {
        const result = await this.runOperation(
          root,
          {
            ...request,
            operation: 'bash',
            args: { command: request.command, cwd: request.cwd ?? '.', timeoutMs: ttl * 1000 },
          },
          controller.signal,
          (stream, text) => {
            for (const line of cleanText(text).split('\n').filter(Boolean))
              item.logs.push({ stream, text: line.slice(0, 2048), at: new Date().toISOString() });
            while (
              item.logs.length > 200 ||
              item.logs.reduce((sum, line) => sum + line.text.length, 0) > 32768
            ) {
              item.logs.shift();
              item.truncated = true;
            }
            emit();
          },
        );
        if (item.status !== 'running') return;
        item.exitCode = (result.data as { exitCode?: number } | null)?.exitCode;
        if (!result.ok) {
          item.status = result.error?.code === 'TIMEOUT' ? 'expired' : 'failed';
          item.logs.push({
            stream: 'stderr',
            text: result.error?.message ?? '执行失败',
            at: new Date().toISOString(),
          });
        } else if (
          this.busy.has(request.workspaceId) ||
          snapshotRevision(await snapshot(value.root)) !== baseRevision
        )
          item.status = 'conflict';
        else {
          this.busy.add(request.workspaceId);
          try {
            await this.commitFiles(request.principalId, value.root, await snapshot(root));
            await this.updateRevision(value);
          } finally {
            this.busy.delete(request.workspaceId);
            this.events.emit(`workspace:${request.workspaceId}`);
          }
          item.status = item.exitCode === 0 ? 'completed' : 'failed';
        }
      } catch {
        if (item.status === 'running') item.status = 'failed';
      } finally {
        clearTimeout(timeout);
        this.controllers.delete(processId);
        await this.persist();
        this.backgroundJobs.delete(processId);
        emit();
      }
    })();
    this.backgroundJobs.set(processId, job);
    return this.processCopy(item);
  }
  async backgroundStatus(
    request: ProcessRequest & { tailLines?: number },
  ): Promise<BackgroundProcess> {
    return this.processCopy(
      this.ownProcess(request),
      Math.min(100, Math.max(1, request.tailLines ?? 100)),
    );
  }
  async backgroundList(
    request: Owner & { status?: BackgroundProcess['status'] },
  ): Promise<BackgroundProcess[]> {
    return [...this.processes.values()]
      .filter(
        (value) =>
          value.principalId === request.principalId &&
          value.conversationId === request.conversationId &&
          (!request.status || value.status === request.status),
      )
      .map((value) => this.processCopy(value));
  }
  async backgroundWatch(
    request: ProcessRequest & { event?: 'exit' | 'pattern'; pattern?: string; timeoutMs?: number },
    signal?: AbortSignal,
  ): Promise<BackgroundProcess> {
    const value = this.ownProcess(request);
    if (request.event === 'pattern' && (!request.pattern || request.pattern.length > 256))
      throw new SandboxError('INVALID_INPUT', '日志匹配文本必须为 1–256 字符');
    const done = () =>
      value.status !== 'running' ||
      (request.event === 'pattern' &&
        value.logs.some((line) => line.text.includes(request.pattern!)));
    if (done() || signal?.aborted) return this.processCopy(value);
    await new Promise<void>((resolve) => {
      const finish = () => {
        clearTimeout(timer);
        this.events.off(request.processId, listener);
        signal?.removeEventListener('abort', finish);
        resolve();
      };
      const listener = () => {
        if (done()) finish();
      };
      const timer = setTimeout(finish, Math.min(30000, Math.max(1, request.timeoutMs ?? 30000)));
      this.events.on(request.processId, listener);
      signal?.addEventListener('abort', finish, { once: true });
    });
    return this.processCopy(value);
  }
  async backgroundStop(request: ProcessRequest): Promise<BackgroundProcess> {
    const value = this.ownProcess(request);
    if (value.status === 'running') {
      value.status = 'cancelled';
      this.controllers.get(request.processId)?.abort();
      await this.backgroundJobs.get(request.processId);
      this.events.emit(request.processId);
    }
    return this.processCopy(value);
  }
  async releaseConversation(request: Owner): Promise<void> {
    for (const value of await this.backgroundList(request))
      if (value.status === 'running')
        await this.backgroundStop({ ...request, processId: value.processId });
  }
  private async removeManagedDirectory(directory: string): Promise<void> {
    const target = path.resolve(directory);
    const root = path.resolve(this.stateRoot);
    if (
      ![
        path.join(root, 'workspaces') + path.sep,
        path.join(root, 'copies') + path.sep,
        path.join(root, 'background') + path.sep,
      ].some((prefix) => target.startsWith(prefix))
    )
      throw new SandboxError('NOT_AUTHORIZED', '拒绝删除非托管目录');
    await fs.rm(target, { recursive: true, force: true });
  }
  async deleteConversation(request: Owner): Promise<void> {
    await this.initialize();
    await this.releaseConversation(request);
    const values = [...this.workspaces.values()].filter(
      (value) =>
        value.metadata.principalId === request.principalId &&
        value.metadata.conversationId === request.conversationId,
    );
    for (const value of values) {
      this.workspaces.delete(value.metadata.workspaceId);
      this.operationControllers.get(value.metadata.workspaceId)?.abort();
      if (this.busy.has(value.metadata.workspaceId))
        await new Promise<void>((resolve) =>
          this.events.once(`workspace:${value.metadata.workspaceId}`, resolve),
        );
      if (this.options.managedWorkspaces || value.metadata.parentWorkspaceId)
        await this.removeManagedDirectory(value.root);
    }
    for (const item of [...this.processes.values()])
      if (
        item.principalId === request.principalId &&
        item.conversationId === request.conversationId
      ) {
        await this.removeManagedDirectory(path.join(this.stateRoot, 'background', item.processId));
        this.processes.delete(item.processId);
      }
    await this.persist();
  }
  async sweepExpired(ttlHours = 24): Promise<{ deletedConversations: number }> {
    if (!Number.isFinite(ttlHours) || ttlHours < 0 || ttlHours > 720)
      throw new SandboxError('INVALID_INPUT', '保留期限无效');
    await this.initialize();
    if (!this.options.managedWorkspaces) return { deletedConversations: 0 };
    const cutoff = Date.now() - ttlHours * 3600000;
    const owners = new Map<string, Owner>();
    for (const value of this.workspaces.values())
      if (!value.metadata.parentWorkspaceId && Date.parse(value.createdAt) <= cutoff)
        owners.set(
          `${value.metadata.principalId}:${value.metadata.conversationId}`,
          value.metadata,
        );
    for (const owner of owners.values()) await this.deleteConversation(owner);
    return { deletedConversations: owners.size };
  }
  async shutdown(): Promise<void> {
    for (const controller of this.operationControllers.values()) controller.abort();
    await Promise.all(
      [...this.operationControllers.keys()].map((id) =>
        this.busy.has(id)
          ? new Promise<void>((resolve) => this.events.once(`workspace:${id}`, resolve))
          : Promise.resolve(),
      ),
    );
    for (const value of this.processes.values())
      if (value.status === 'running') await this.backgroundStop(value);
  }
  async health(): Promise<SandboxHealth> {
    return { ready: true, profile: 'trusted-local', publicExecutionEnabled: false };
  }
}
