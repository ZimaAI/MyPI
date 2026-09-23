import { relativePath, type Snapshot } from './engine.js';
import { SandboxError } from './types.js';

export const IMPORT_LIMITS = {
  compressedBytes: 10 * 1024 * 1024,
  expandedBytes: 32 * 1024 * 1024,
  entries: 2000,
  fileBytes: 2 * 1024 * 1024,
  ratio: 100,
  deadlineMs: 30000,
} as const;
export function importPath(value: string): string {
  const normalized = value.normalize('NFKC');
  if (
    !normalized ||
    normalized.length > 1024 ||
    normalized.split('/').some((part) => part === '.' || part === '..')
  )
    throw new SandboxError('INVALID_INPUT', '导入路径无效');
  return relativePath(normalized);
}
export function blockedImportPath(name: string): boolean {
  const parts = name.toLowerCase().split('/');
  return (
    parts.some((part) =>
      [
        '.git',
        '.pi',
        '.mypi',
        '.agents',
        '.codex',
        '.claude',
        'node_modules',
        '.next',
        'dist',
      ].includes(part),
    ) || ['.gitmodules', '.mcp.json', 'mcp.json'].includes(parts.at(-1)!)
  );
}
/** Models case-insensitive filesystems even when the importer itself runs on Linux. */
export class ImportPathSet {
  private paths = new Map<string, { name: string; directory: boolean; explicit: boolean }>();
  add(name: string, directory = false): void {
    const parts = name.split('/');
    for (let index = 1; index <= parts.length; index++) {
      const full = parts.slice(0, index).join('/'),
        key = full.toLowerCase(),
        isFinal = index === parts.length;
      const prior = this.paths.get(key),
        isDirectory = !isFinal || directory;
      if (
        prior &&
        (prior.name !== full || prior.directory !== isDirectory || (isFinal && prior.explicit))
      )
        throw new SandboxError('INVALID_INPUT', '导入包含重复、大小写冲突或文件目录冲突');
      this.paths.set(key, {
        name: full,
        directory: isDirectory,
        explicit: isFinal || (prior?.explicit ?? false),
      });
    }
  }
}
export function sanitizeImportedSnapshot(input: Snapshot): {
  files: Snapshot;
  omittedPaths: string[];
  totalBytes: number;
} {
  if (
    !input ||
    typeof input !== 'object' ||
    Array.isArray(input) ||
    Object.keys(input).length > IMPORT_LIMITS.entries
  )
    throw new SandboxError('LIMIT_EXCEEDED', '导入条目超过 2000');
  const files: Snapshot = Object.create(null);
  const omittedPaths: string[] = [];
  const paths = new ImportPathSet();
  let totalBytes = 0;
  for (const [rawName, encoded] of Object.entries(input)) {
    const name = importPath(rawName);
    paths.add(name);
    if (
      typeof encoded !== 'string' ||
      encoded.length % 4 !== 0 ||
      !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded) ||
      Buffer.from(encoded, 'base64').toString('base64') !== encoded
    )
      throw new SandboxError('INVALID_INPUT', '导入文件编码无效');
    const bytes = Buffer.byteLength(encoded, 'base64');
    totalBytes += bytes;
    if (bytes > IMPORT_LIMITS.fileBytes || totalBytes > IMPORT_LIMITS.expandedBytes)
      throw new SandboxError('LIMIT_EXCEEDED', '导入超过 2 MiB 单文件或 32 MiB 展开上限');
    if (blockedImportPath(name)) omittedPaths.push(name);
    else files[name] = encoded;
  }
  if (!Object.keys(files).length) throw new SandboxError('INVALID_INPUT', '导入项目没有允许的文件');
  return { files, omittedPaths, totalBytes };
}
