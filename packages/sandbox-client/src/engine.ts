import { constants, type Stats } from 'node:fs';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { spawn, type ChildProcess } from 'node:child_process';
import { SandboxError, type SandboxOperation, type ToolResult } from './types.js';

export const MAX_OUTPUT = 16 * 1024;
export const MAX_FILE = 2 * 1024 * 1024;
export const MAX_WORKSPACE = 64 * 1024 * 1024;
export type Snapshot = Record<string, string>;
const fail = (code: string, message: string): never => {
  throw new SandboxError(code, message);
};
export function cleanText(value: string): string {
  return value
    .replace(/\x1b(?:\[[0-?]*[ -/]*[@-~]|\][^\x07]*(?:\x07|\x1b\\))/g, '')
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '');
}
export function relativePath(value: unknown, allowRoot = false): string {
  if (
    typeof value !== 'string' ||
    value.length > 1024 ||
    /[\x00-\x1f:%\\]/.test(value) ||
    path.isAbsolute(value) ||
    /^[a-z]:/i.test(value)
  )
    return fail('INVALID_INPUT', '必须提供工作区相对路径');
  const parts = value.split('/');
  if (
    parts.some((p) => p === '..' || (/[. ]$/.test(p) && p !== '.')) ||
    parts.some((p) => /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(p))
  )
    return fail('INVALID_INPUT', '不允许此路径');
  const normalized = parts.filter((p) => p && p !== '.').join('/');
  if (!normalized && !allowRoot) return fail('INVALID_INPUT', '路径不能为空');
  return normalized;
}
export async function safePath(
  root: string,
  value: unknown,
  options: { allowMissing?: boolean; allowRoot?: boolean } = {},
): Promise<string> {
  const relative = relativePath(value, options.allowRoot);
  const absoluteRoot = await fs.realpath(root);
  let current = absoluteRoot;
  for (const part of relative.split('/').filter(Boolean)) {
    current = path.join(current, part);
    let stat: Stats;
    try {
      stat = await fs.lstat(current);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT' && options.allowMissing) continue;
      throw new SandboxError('NOT_FOUND', '文件不存在');
    }
    if (
      stat.isSymbolicLink() ||
      (stat.isFile() && stat.nlink > 1) ||
      (!stat.isFile() && !stat.isDirectory())
    )
      return fail('INVALID_INPUT', '不允许链接或特殊文件');
  }
  if (current !== absoluteRoot && !current.startsWith(absoluteRoot + path.sep))
    return fail('INVALID_INPUT', '路径超出工作区');
  return current;
}
export async function readSafe(root: string, name: string): Promise<Buffer> {
  const target = await safePath(root, name);
  const file = await fs.open(target, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.nlink > 1) return fail('INVALID_INPUT', '不允许链接或特殊文件');
    if (stat.size > MAX_FILE) return fail('LIMIT_EXCEEDED', '文件超过 2 MiB');
    return await file.readFile();
  } finally {
    await file.close();
  }
}
export async function writeSafe(
  root: string,
  name: string,
  content: Buffer,
  expectedVersion?: string,
): Promise<string> {
  if (content.length > MAX_FILE) return fail('LIMIT_EXCEEDED', '文件超过 2 MiB');
  const target = await safePath(root, name, { allowMissing: true });
  if (expectedVersion !== undefined) {
    let old: Buffer;
    try {
      old = await readSafe(root, name);
    } catch (error) {
      if ((error as SandboxError).code !== 'NOT_FOUND') throw error;
      old = Buffer.alloc(0);
    }
    if (hash(old) !== expectedVersion) return fail('CONFLICT', '文件已修改，请重新读取');
  }
  await fs.mkdir(path.dirname(target), { recursive: true });
  await safePath(root, name, { allowMissing: true });
  const temporary = path.join(path.dirname(target), `.mypi-${randomUUID()}.tmp`);
  const file = await fs.open(temporary, 'wx', 0o600);
  try {
    await file.writeFile(content);
    await file.sync();
  } finally {
    await file.close();
  }
  try {
    await fs.rename(temporary, target);
  } catch (error) {
    await fs.rm(temporary, { force: true });
    throw error;
  }
  return hash(content);
}
export function hash(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}
export function snapshotRevision(files: Snapshot): string {
  return hash(JSON.stringify(Object.entries(files).sort(([a], [b]) => a.localeCompare(b))));
}
export async function snapshot(root: string): Promise<Snapshot> {
  const files: Snapshot = Object.create(null);
  let total = 0;
  let count = 0;
  async function visit(relative: string): Promise<void> {
    const directory = await safePath(root, relative, { allowRoot: true });
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      if (['node_modules', '.pi', '.mypi', '.next', 'dist'].includes(entry.name)) continue;
      const name = relative ? `${relative}/${entry.name}` : entry.name;
      if (entry.isSymbolicLink()) return fail('INVALID_INPUT', '工作区包含不允许的链接');
      if (entry.isDirectory()) await visit(name);
      else {
        if (++count > 10000) return fail('LIMIT_EXCEEDED', '工作区文件数超限');
        const content = await readSafe(root, name);
        total += content.length;
        if (total > MAX_WORKSPACE) return fail('LIMIT_EXCEEDED', '工作区内容超过 64 MiB');
        files[name] = content.toString('base64');
      }
    }
  }
  await visit('');
  return files;
}
export function validateSnapshot(files: Snapshot): void {
  if (
    !files ||
    typeof files !== 'object' ||
    Array.isArray(files) ||
    Object.keys(files).length > 10000
  )
    return fail('INVALID_INPUT', '无效工作区快照');
  let total = 0;
  for (const [name, encoded] of Object.entries(files)) {
    relativePath(name);
    if (typeof encoded !== 'string' || !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded))
      return fail('INVALID_INPUT', '无效文件编码');
    const size = Buffer.byteLength(encoded, 'base64');
    total += size;
    if (size > MAX_FILE || total > MAX_WORKSPACE) return fail('LIMIT_EXCEEDED', '工作区快照超限');
  }
}
export async function restore(root: string, files: Snapshot): Promise<void> {
  validateSnapshot(files);
  await fs.mkdir(root, { recursive: true });
  for (const [name, value] of Object.entries(files))
    await writeSafe(root, name, Buffer.from(value, 'base64'));
}
export interface CommandOptions {
  cwd: string;
  signal?: AbortSignal;
  timeoutMs?: number;
  onOutput?: (stream: 'stdout' | 'stderr', text: string) => void;
  env?: NodeJS.ProcessEnv;
}
export async function terminateTree(child: ChildProcess): Promise<void> {
  if (!child.pid) return;
  if (process.platform === 'win32') {
    await new Promise<void>((resolve) => {
      const killer = spawn('taskkill', ['/pid', String(child.pid), '/t', '/f'], {
        windowsHide: true,
        stdio: 'ignore',
      });
      killer.once('exit', () => resolve());
      killer.once('error', () => resolve());
    });
  } else {
    try {
      process.kill(-child.pid, 'SIGTERM');
    } catch {
      /* already reaped */
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
    try {
      process.kill(-child.pid, 'SIGKILL');
    } catch {
      /* already reaped */
    }
  }
}
export async function command(
  binary: string,
  argv: string[],
  options: CommandOptions,
): Promise<{ stdout: string; stderr: string; exitCode: number; truncated: boolean }> {
  if (options.signal?.aborted) return fail('CANCELLED', '执行已取消');
  const child = spawn(binary, argv, {
    cwd: options.cwd,
    env: options.env ?? process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
    detached: process.platform !== 'win32',
  });
  let stdout = '',
    stderr = '',
    truncated = false,
    timedOut = false,
    cancelled = false;
  for (const stream of ['stdout', 'stderr'] as const)
    child[stream]!.on('data', (chunk: Buffer) => {
      const text = cleanText(chunk.toString());
      options.onOutput?.(stream, text);
      const old = stream === 'stdout' ? stdout : stderr;
      const available = MAX_OUTPUT - Buffer.byteLength(old);
      if (Buffer.byteLength(text) > available) truncated = true;
      const next = old + Buffer.from(text).subarray(0, Math.max(0, available)).toString();
      if (stream === 'stdout') stdout = next;
      else stderr = next;
    });
  const abort = () => {
    cancelled = true;
    void terminateTree(child);
  };
  options.signal?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(() => {
    timedOut = true;
    void terminateTree(child);
  }, options.timeoutMs ?? 30000);
  try {
    const exitCode = await new Promise<number>((resolve, reject) => {
      child.once('error', reject);
      child.once('close', (code) => resolve(code ?? -1));
    });
    if (timedOut) return fail('TIMEOUT', '执行超时');
    if (cancelled) return fail('CANCELLED', '执行已取消');
    return { stdout, stderr, exitCode, truncated };
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', abort);
    await terminateTree(child);
  }
}
export function shellCommand(text: string): { binary: string; argv: string[] } {
  if (process.platform !== 'win32')
    return { binary: '/bin/bash', argv: ['--noprofile', '--norc', '-c', text] };
  // Taskkill alone has a child-creation race. A kill-on-close Job Object keeps every descendant in the lease.
  const windowsLease = `$ErrorActionPreference='Stop'; Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class MyPiProcessLease {
  [StructLayout(LayoutKind.Sequential)] struct Basic { public long p, j; public uint flags; public UIntPtr min, max; public uint active; public UIntPtr affinity; public uint priority, scheduling; }
  [StructLayout(LayoutKind.Sequential)] struct Io { public ulong r, w, o, rb, wb, ob; }
  [StructLayout(LayoutKind.Sequential)] struct Extended { public Basic basic; public Io io; public UIntPtr pm, jm, pp, pj; }
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern IntPtr CreateJobObject(IntPtr a, string name);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool SetInformationJobObject(IntPtr job, int type, IntPtr info, uint length);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);
  [DllImport("kernel32.dll")] static extern IntPtr GetCurrentProcess();
  static IntPtr lease;
  public static void Enter() {
    lease=CreateJobObject(IntPtr.Zero, null); var info=new Extended(); info.basic.flags=0x2000;
    int size=Marshal.SizeOf(info); IntPtr pointer=Marshal.AllocHGlobal(size);
    try { Marshal.StructureToPtr(info,pointer,false); if(lease==IntPtr.Zero || !SetInformationJobObject(lease,9,pointer,(uint)size) || !AssignProcessToJobObject(lease,GetCurrentProcess())) throw new InvalidOperationException("Cannot establish process lease"); }
    finally { Marshal.FreeHGlobal(pointer); }
  }
}
'@; [MyPiProcessLease]::Enter();\n`;
  return {
    binary: 'powershell.exe',
    argv: ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', windowsLease + text],
  };
}
const textArg = (
  args: Record<string, unknown>,
  key: string,
  fallback?: string,
  max = 16384,
): string => {
  const value = args[key] ?? fallback;
  if (typeof value !== 'string' || value.length > max)
    return fail('INVALID_INPUT', `无效参数 ${key}`);
  return value;
};
const numberArg = (
  args: Record<string, unknown>,
  key: string,
  fallback: number,
  max: number,
): number => {
  const value = args[key] ?? fallback;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > max)
    return fail('INVALID_INPUT', `无效参数 ${key}`);
  return value;
};
function globRegex(pattern: string): RegExp {
  if (pattern.length > 256) return fail('INVALID_INPUT', '搜索表达式过长');
  let out = '^';
  for (let i = 0; i < pattern.length; i++) {
    const char = pattern[i]!;
    if (char === '*' && pattern[i + 1] === '*') {
      out += '.*';
      i++;
      if (pattern[i + 1] === '/') {
        out = out.slice(0, -2) + '(?:.*/)?';
        i++;
      }
    } else if (char === '*') out += '[^/]*';
    else if (char === '?') out += '[^/]';
    else out += char.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(out + '$', 'i');
}
export async function operate(
  root: string,
  operation: SandboxOperation,
  args: Record<string, unknown>,
  signal?: AbortSignal,
  onOutput?: CommandOptions['onOutput'],
): Promise<ToolResult> {
  const start = Date.now();
  let truncated = false;
  try {
    if (signal?.aborted) return fail('CANCELLED', '执行已取消');
    let data: unknown;
    if (operation === 'read') {
      const name = textArg(args, 'path');
      const content = await readSafe(root, name);
      const lines = content.toString('utf8').split('\n');
      const offset = numberArg(args, 'offset', 1, 1000000) - 1;
      const limit = numberArg(args, 'limit', 500, 10000);
      const selected = lines.slice(offset, offset + limit).join('\n');
      truncated = Buffer.byteLength(selected) > MAX_OUTPUT || offset + limit < lines.length;
      data = {
        path: name,
        content: Buffer.from(selected).subarray(0, MAX_OUTPUT).toString(),
        version: hash(content),
        totalLines: lines.length,
      };
    } else if (operation === 'write' || operation === 'edit') {
      const name = textArg(args, 'path');
      let content = textArg(args, 'content', '', MAX_FILE);
      if (operation === 'edit') {
        const old = (await readSafe(root, name)).toString();
        const before = textArg(args, 'oldText');
        const after = textArg(args, 'newText');
        if (!before || old.split(before).length !== 2)
          return fail('CONFLICT', '待替换文本必须恰好出现一次');
        content = old.replace(before, after);
      }
      const version = await writeSafe(
        root,
        name,
        Buffer.from(content),
        args.expectedVersion as string | undefined,
      );
      data = { path: name, version, bytes: Buffer.byteLength(content) };
    } else if (operation === 'bash') {
      const cwd = await safePath(root, textArg(args, 'cwd', '.'), { allowRoot: true });
      const { binary, argv } = shellCommand(textArg(args, 'command'));
      data = await command(binary, argv, {
        cwd,
        signal,
        timeoutMs: numberArg(args, 'timeoutMs', 30000, 600000),
        onOutput,
      });
      truncated = (data as { truncated: boolean }).truncated;
    } else if (operation === 'search_files' || operation === 'search_content') {
      const base = relativePath(textArg(args, 'root', '.'), true);
      const files = await snapshot(await safePath(root, base, { allowRoot: true }));
      const max = numberArg(args, 'maxResults', 100, 100);
      const matches: unknown[] = [];
      const glob = globRegex(
        textArg(args, operation === 'search_files' ? 'pattern' : 'glob', '**/*', 256),
      );
      const query = operation === 'search_content' ? textArg(args, 'query', '', 256) : '';
      // Native RegExp has no deadline. Regex searches use bounded rg, never a JS regex on user data.
      if (args.regex === true) {
        const {
          stdout,
          stderr,
          exitCode,
          truncated: cut,
        } = await command(
          'rg',
          [
            '--json',
            '--max-count',
            String(max),
            '--glob',
            textArg(args, 'glob', '**/*', 256),
            '--',
            query,
            '.',
          ],
          { cwd: await safePath(root, base, { allowRoot: true }), signal, timeoutMs: 5000 },
        );
        if (exitCode > 1) return fail('INVALID_INPUT', stderr || '正则搜索失败');
        for (const line of stdout.split('\n')) {
          try {
            const event = JSON.parse(line);
            if (event.type === 'match' && matches.length < max)
              matches.push({
                file: event.data.path.text.replace(/^\.\//, ''),
                line: event.data.line_number,
                column: event.data.submatches[0]?.start + 1,
                snippet: event.data.lines.text.slice(0, 500),
              });
          } catch {
            /* output cut at limit */
          }
        }
        data = { matches };
        truncated = cut || matches.length >= max;
      } else {
        if (
          args.paths !== undefined &&
          (!Array.isArray(args.paths) ||
            args.paths.length > 100 ||
            args.paths.some((value) => typeof value !== 'string'))
        )
          return fail('INVALID_INPUT', 'paths 参数无效');
        const paths = (args.paths as string[] | undefined)?.map((value) => relativePath(value));
        for (const [name, encoded] of Object.entries(files)) {
          if (
            name.startsWith('.git/') ||
            !glob.test(name) ||
            (paths && !paths.some((p) => name === p || name.startsWith(p + '/')))
          )
            continue;
          if (operation === 'search_files')
            matches.push({ path: base ? `${base}/${name}` : name, type: 'file' });
          else {
            const lines = Buffer.from(encoded, 'base64').toString().split('\n');
            for (let i = 0; i < lines.length; i++) {
              const column = lines[i]!.indexOf(query);
              if (column >= 0)
                matches.push({
                  file: name,
                  line: i + 1,
                  column: column + 1,
                  snippet: lines[i]!.slice(Math.max(0, column - 80), column + 400),
                });
              if (matches.length >= max) break;
            }
          }
          if (matches.length >= max) {
            truncated = true;
            break;
          }
        }
        data = { matches };
      }
    } else if (['git_show', 'git_diff', 'git_log'].includes(operation)) {
      const ref = (key: string, fallback: string): string => {
        const value = textArg(args, key, fallback, 128);
        if (!/^[a-zA-Z0-9_./~^:@{}-]+$/.test(value) || value.startsWith('-'))
          return fail('INVALID_INPUT', 'Git ref 无效');
        return value;
      };
      const argv = [
        '-c',
        'core.hooksPath=/dev/null',
        '-c',
        'core.fsmonitor=false',
        '-c',
        'diff.external=',
        '-c',
        'core.pager=cat',
        '-c',
        'core.quotePath=false',
      ];
      if (operation === 'git_show')
        argv.push('show', '--no-ext-diff', '--no-textconv', '--format=medium', ref('ref', 'HEAD'));
      if (operation === 'git_diff') {
        argv.push('diff', '--no-ext-diff', '--no-textconv', ref('base', 'HEAD'));
        if (args.head) argv.push(ref('head', 'HEAD'));
      }
      if (operation === 'git_log')
        argv.push(
          'log',
          '--no-show-signature',
          `--max-count=${numberArg(args, 'limit', 20, 50)}`,
          '--format=%H%x09%an%x09%as%x09%s',
        );
      argv.push('--');
      const names = args.paths ?? (args.path ? [args.path] : []);
      if (!Array.isArray(names) || names.length > 100)
        return fail('INVALID_INPUT', 'Git paths 无效');
      for (const name of names) {
        const relative = relativePath(name);
        await safePath(root, relative, { allowMissing: true });
        argv.push(relative);
      }
      const result = await command('git', argv, {
        cwd: root,
        signal,
        timeoutMs: 10000,
        env: {
          ...process.env,
          GIT_CONFIG_NOSYSTEM: '1',
          GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null',
          GIT_TERMINAL_PROMPT: '0',
          GIT_OPTIONAL_LOCKS: '0',
          GIT_PAGER: 'cat',
        },
      });
      data = result;
      truncated = result.truncated;
    } else return fail('INVALID_INPUT', '不支持的工具操作');
    return { ok: true, data, truncated, durationMs: Date.now() - start };
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
