import type { Snapshot } from './engine.js';
import { createHash } from 'node:crypto';
import { deflateSync } from 'node:zlib';
const encode = (files: Record<string, string>): Snapshot =>
  Object.fromEntries(
    Object.entries(files).map(([name, value]) => [name, Buffer.from(value).toString('base64')]),
  );
export const WORKSPACE_TEMPLATES = [
  {
    id: 'javascript-starter',
    name: 'JavaScript 工具库',
    description: '离线可运行的 Node.js 函数与单元测试',
  },
  { id: 'web-starter', name: '静态网页', description: 'HTML、CSS、JavaScript 页面模板' },
  { id: 'empty', name: '空白项目', description: '从 README 开始创建项目' },
] as const;
export function templateFiles(id = 'javascript-starter'): Snapshot {
  if (id === 'javascript-starter' || id === 'node-starter' || id === 'default')
    return encode({
      'README.md':
        '# MyPI JavaScript workspace\n\nRun `node --test` to execute the offline tests.\n',
      'package.json':
        '{"name":"mypi-workspace","private":true,"type":"module","scripts":{"test":"node --test"}}\n',
      'src/sum.js':
        'export function sum(values) { return values.reduce((total, value) => total + value, 0); }\n',
      'test/sum.test.js':
        "import { test } from 'node:test';\nimport assert from 'node:assert/strict';\nimport { sum } from '../src/sum.js';\ntest('sums values', () => assert.equal(sum([1, 2, 3]), 6));\n",
    });
  if (id === 'web-starter')
    return encode({
      'README.md': '# Static workspace\nFiles may be downloaded or viewed as text.\n',
      'index.html':
        '<!doctype html>\n<html lang="zh-CN"><meta charset="UTF-8"><title>MyPI</title><link rel="stylesheet" href="style.css"><h1>你好，MyPI</h1><script src="app.js"></script></html>\n',
      'style.css': 'body { max-width: 48rem; margin: 4rem auto; font-family: system-ui; }\n',
      'app.js': "console.log('MyPI workspace ready');\n",
    });
  if (id === 'empty') return encode({ 'README.md': '# MyPI workspace\n' });
  throw new Error('INVALID_TEMPLATE');
}
/** Creates a clean baseline repository without invoking host Git or loading any host config/hooks. */
export function withGitBaseline(files: Snapshot): Snapshot {
  const output = { ...files };
  function object(type: string, content: Buffer): string {
    const value = Buffer.concat([Buffer.from(`${type} ${content.length}\0`), content]);
    const oid = createHash('sha1').update(value).digest('hex');
    output[`.git/objects/${oid.slice(0, 2)}/${oid.slice(2)}`] =
      deflateSync(value).toString('base64');
    return oid;
  }
  function tree(prefix: string): string {
    const names = [
      ...new Set(
        Object.keys(files)
          .filter((name) => name.startsWith(prefix))
          .map((name) => name.slice(prefix.length).split('/')[0]!),
      ),
    ].sort();
    const entries = names.map((name) => {
      const content = files[prefix + name];
      const directory = content === undefined;
      const oid = directory
        ? tree(prefix + name + '/')
        : object('blob', Buffer.from(content, 'base64'));
      return Buffer.concat([
        Buffer.from(`${directory ? '40000' : '100644'} ${name}\0`),
        Buffer.from(oid, 'hex'),
      ]);
    });
    return object('tree', Buffer.concat(entries));
  }
  const root = tree('');
  const commit = object(
    'commit',
    Buffer.from(
      `tree ${root}\nauthor MyPI <workspace@mypi.local> 1750000000 +0000\ncommitter MyPI <workspace@mypi.local> 1750000000 +0000\n\nInitial workspace template\n`,
    ),
  );
  const names = Object.keys(files).sort();
  const header = Buffer.alloc(12);
  header.write('DIRC');
  header.writeUInt32BE(2, 4);
  header.writeUInt32BE(names.length, 8);
  const indexEntries = names.map((name) => {
    const nameBytes = Buffer.from(name);
    const entry = Buffer.alloc(Math.ceil((62 + nameBytes.length + 1) / 8) * 8);
    const content = Buffer.from(files[name]!, 'base64');
    entry.writeUInt32BE(0o100644, 24);
    entry.writeUInt32BE(content.length, 36);
    Buffer.from(object('blob', content), 'hex').copy(entry, 40);
    entry.writeUInt16BE(Math.min(nameBytes.length, 0xfff), 60);
    nameBytes.copy(entry, 62);
    return entry;
  });
  const indexBody = Buffer.concat([header, ...indexEntries]);
  output['.git/index'] = Buffer.concat([
    indexBody,
    createHash('sha1').update(indexBody).digest(),
  ]).toString('base64');
  Object.assign(
    output,
    encode({
      '.git/HEAD': 'ref: refs/heads/main\n',
      '.git/refs/heads/main': commit + '\n',
      '.git/config': '[core]\n\trepositoryformatversion = 0\n\tbare = false\n\tfilemode = false\n',
    }),
  );
  return output;
}
