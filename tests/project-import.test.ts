import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeZip } from './helpers/zip.ts';
import { randomBytes } from 'node:crypto';
import * as fs from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { once } from 'node:events';
import {
  ProjectImporter,
  IMPORT_LIMITS,
  isPublicAddress,
  type ImportFetcher,
} from '../packages/project-import/src/index.ts';
import { TrustedLocalSandbox, BrokerSandboxClient } from '../packages/sandbox-client/src/index.ts';
import { createBrokerServer } from '../apps/execution-broker/src/server.ts';

const importer = () => new ProjectImporter({ enabled: true });
const publicDns = async () => [{ address: '140.82.112.3', family: 4 }];

test('ZIP import is disabled by default and strips workspace execution/Git metadata without running code', async () => {
  const bytes = makeZip([
    { name: 'src/main.js', content: 'console.log("data only");', deflate: true },
    { name: '.pi/settings.json', content: '{}' },
    { name: '.git/config', content: '[core]\n hooksPath=/host' },
    { name: '.git/hooks/post-checkout', content: 'echo MUST_NOT_EXECUTE' },
    { name: '.agents/skills/run/SKILL.md', content: 'execute hook' },
    { name: 'image.bin', content: Buffer.from([0, 255, 1]) },
  ]);
  await assert.rejects(new ProjectImporter().fromZip(bytes), { code: 'IMPORT_DISABLED' });
  const result = await importer().fromZip(bytes);
  assert.equal(result.fileCount, 2);
  assert.equal(
    Buffer.from(result.files['src/main.js']!, 'base64').toString(),
    'console.log("data only");',
  );
  assert.equal(result.omittedPaths.length, 4);
  assert.ok(!Object.keys(result.files).some((name) => name.startsWith('.git/')));
});

test('ZIP rejects traversal, absolute, encoded, NTFS, duplicate case and normalized aliases', async () => {
  for (const name of [
    '../escape',
    '/etc/passwd',
    'C:/secret',
    'x\\..\\secret',
    '%2e%2e/secret',
    'file:stream',
    'CON',
    'x/./file',
    'x/../file',
  ])
    await assert.rejects(importer().fromZip(makeZip([{ name, content: 'x' }])));
  for (const names of [
    ['a.txt', 'A.txt'],
    ['foo.ts', 'ｆｏｏ.ts'],
    ['a', 'a/b'],
    ['a/b', 'a'],
  ])
    await assert.rejects(
      importer().fromZip(makeZip(names.map((name) => ({ name, content: 'x' })))),
      { code: 'INVALID_INPUT' },
    );
});

test('ZIP rejects links, special metadata, corruption, zip bombs and bounded limits', async () => {
  const hardlink = Buffer.alloc(16);
  hardlink.writeUInt16LE(0x000d, 0);
  hardlink.writeUInt16LE(12, 2);
  for (const entry of [
    { name: 'link', content: '../host', mode: 0o120777 },
    { name: 'fifo', mode: 0o010644 },
    { name: 'hardlink', content: 'data', extra: hardlink },
    { name: 'badcrc', content: 'data', checksum: 1 },
  ])
    await assert.rejects(importer().fromZip(makeZip([entry])), { code: 'INVALID_INPUT' });
  await assert.rejects(
    importer().fromZip(makeZip([{ name: 'bomb', content: 'x'.repeat(20000), deflate: true }])),
    { code: 'LIMIT_EXCEEDED' },
  );
  await assert.rejects(importer().fromZip(Buffer.alloc(IMPORT_LIMITS.compressedBytes + 1)), {
    code: 'LIMIT_EXCEEDED',
  });
  await assert.rejects(
    importer().fromZip(
      makeZip([{ name: 'large', content: Buffer.alloc(IMPORT_LIMITS.fileBytes + 1) }]),
    ),
    { code: 'LIMIT_EXCEEDED' },
  );
  await assert.rejects(
    importer().fromZip(
      makeZip(Array.from({ length: 2001 }, (_, index) => ({ name: `${index}.txt` }))),
    ),
    { code: 'LIMIT_EXCEEDED' },
  );
  const block = randomBytes(65536),
    file = Buffer.concat(Array.from({ length: 32 }, () => block));
  await assert.rejects(
    importer().fromZip(
      makeZip(
        Array.from({ length: 17 }, (_, index) => ({
          name: `${index}.bin`,
          content: file,
          deflate: true,
        })),
      ),
    ),
    { code: 'LIMIT_EXCEEDED' },
  );
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    importer().fromZip(makeZip([{ name: 'ok', content: 'x' }]), { signal: controller.signal }),
    { code: 'CANCELLED' },
  );
});

test('GitHub import checks public metadata, redirect hosts and strips the archive root with fixture fetches', async () => {
  const visited: string[] = [],
    zip = makeZip([
      { name: 'acme-demo-hash/', mode: 0o40755 },
      { name: 'acme-demo-hash/src/a.ts', content: 'export const ok = true;' },
      { name: 'acme-demo-hash/.pi/settings.json', content: '{}' },
    ]);
  const fetcher: ImportFetcher = async (url, options) => {
    visited.push(url.href);
    assert.deepEqual(options.addresses, await publicDns());
    assert.equal(options.signal.aborted, false);
    if (url.pathname === '/repos/acme/demo')
      return {
        status: 200,
        headers: {},
        body: Buffer.from(
          JSON.stringify({ private: false, full_name: 'acme/demo', default_branch: 'main' }),
        ),
      };
    if (url.hostname === 'api.github.com')
      return {
        status: 302,
        headers: { location: 'https://codeload.github.com/acme/demo/legacy.zip/main' },
        body: Buffer.alloc(0),
      };
    return { status: 200, headers: {}, body: zip };
  };
  const result = await new ProjectImporter({
    enabled: true,
    fetcher,
    resolveDns: publicDns,
  }).fromGitHub('https://github.com/acme/demo.git');
  assert.deepEqual(Object.keys(result.files), ['src/a.ts']);
  assert.equal(result.source.kind, 'github');
  assert.equal(result.source.repository, 'https://github.com/acme/demo');
  assert.equal(result.source.ref, 'main');
  assert.equal(visited.length, 3);
});

test('GitHub import rejects private/mixed DNS, unsafe URLs/redirects, private repositories and oversized bodies', async () => {
  for (const address of [
    '127.0.0.1',
    '10.0.0.1',
    '169.254.169.254',
    '172.16.0.1',
    '192.168.1.1',
    '100.64.0.1',
    '::1',
    'fc00::1',
    'fe80::1',
    '::ffff:127.0.0.1',
    '2001:db8::1',
    '2002:7f00:1::',
  ])
    assert.equal(isPublicAddress(address), false, address);
  assert.equal(isPublicAddress('140.82.112.3'), true);
  assert.equal(isPublicAddress('2606:4700:4700::1111'), true);
  let requests = 0;
  const response: ImportFetcher = async () => {
    requests++;
    return { status: 200, headers: {}, body: Buffer.alloc(0) };
  };
  const invalid = new ProjectImporter({
    enabled: true,
    fetcher: response,
    resolveDns: async () => [...(await publicDns()), { address: '127.0.0.1', family: 4 }],
  });
  await assert.rejects(invalid.fromGitHub('https://github.com/acme/demo'), {
    code: 'INVALID_INPUT',
  });
  assert.equal(requests, 0);
  for (const url of [
    'http://github.com/acme/demo',
    'https://127.0.0.1/acme/demo',
    'https://github.com.evil.test/acme/demo',
    'https://user:pass@github.com/acme/demo',
    'https://github.com/acme/demo/tree/main',
    'https://github.com/acme/demo?token=x',
  ])
    await assert.rejects(invalid.fromGitHub(url), { code: 'INVALID_INPUT' });
  for (const location of [
    'https://127.0.0.1/secret',
    'http://codeload.github.com/acme/demo',
    'https://evil.test/archive',
    'https://user:pass@api.github.com/secret',
  ]) {
    const redirects = new ProjectImporter({
      enabled: true,
      resolveDns: publicDns,
      fetcher: async () => ({ status: 302, headers: { location }, body: Buffer.alloc(0) }),
    });
    await assert.rejects(redirects.fromGitHub('https://github.com/acme/demo'), {
      code: 'INVALID_INPUT',
    });
  }
  const privateRepository = new ProjectImporter({
    enabled: true,
    resolveDns: publicDns,
    fetcher: async () => ({
      status: 200,
      headers: {},
      body: Buffer.from('{"private":true,"full_name":"acme/demo"}'),
    }),
  });
  await assert.rejects(privateRepository.fromGitHub('https://github.com/acme/demo'), {
    code: 'NOT_AUTHORIZED',
  });
  const malformed = new ProjectImporter({
    enabled: true,
    resolveDns: publicDns,
    fetcher: async () => ({ status: 200, headers: {}, body: Buffer.from('null') }),
  });
  await assert.rejects(malformed.fromGitHub('https://github.com/acme/demo'), {
    code: 'NOT_AUTHORIZED',
  });
  const huge = new ProjectImporter({
    enabled: true,
    resolveDns: publicDns,
    fetcher: async () => ({ status: 200, headers: {}, body: Buffer.alloc(1024 * 1024 + 1) }),
  });
  await assert.rejects(huge.fromGitHub('https://github.com/acme/demo'), { code: 'LIMIT_EXCEEDED' });
});

test('managed import enforces ownership, revision conflicts, metadata stripping and binary preview through Broker', async () => {
  const root = await fs.mkdtemp(join(tmpdir(), 'mypi-import-')),
    owner = { principalId: 'p', conversationId: 'c' };
  const sandbox = new TrustedLocalSandbox({
    root,
    stateRoot: join(root, 'state'),
    managedWorkspaces: true,
    explicitlyTrusted: true,
  });
  const token = 'import-broker-test-token-'.repeat(2),
    server = createBrokerServer(sandbox, token);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const client = new BrokerSandboxClient({ token, baseUrl: `http://127.0.0.1:${address.port}` });
  try {
    const workspace = await client.createWorkspace(owner),
      request = { ...owner, workspaceId: workspace.workspaceId };
    await assert.rejects(
      client.importWorkspace({
        ...request,
        principalId: 'other',
        files: { 'a.txt': Buffer.from('x').toString('base64') },
      }),
      { code: 'NOT_FOUND' },
    );
    const imported = await client.importWorkspace({
      ...request,
      files: {
        'a.txt': Buffer.from('imported').toString('base64'),
        '.pi/settings.json': Buffer.from('{}').toString('base64'),
        'image.bin': Buffer.from([0, 255]).toString('base64'),
      },
    });
    assert.equal(imported.templateId, 'imported');
    assert.deepEqual((await client.workspaceFiles(request)).map((file) => file.path).sort(), [
      'a.txt',
      'image.bin',
    ]);
    assert.equal((await client.workspaceRead({ ...request, path: 'image.bin' })).binary, true);
    await assert.rejects(
      client.importWorkspace({
        ...request,
        expectedRevision: workspace.revision,
        files: { 'b.txt': 'Yg==' },
      }),
      { code: 'CONFLICT' },
    );
    await assert.rejects(client.importWorkspace({ ...request, files: { 'b.txt': 'Yg==' } }), {
      code: 'CONFLICT',
    });
    const folder = await client.importWorkspace({
      ...request,
      expectedRevision: imported.revision,
      files: { 'src/file.txt': 'Yg==', 'dist/ignored.txt': 'Yw==' },
    });
    assert.deepEqual(
      (await client.workspaceFiles(request)).map((file) => file.path),
      ['src/file.txt'],
    );
    const flattened = await client.importWorkspace({
      ...request,
      expectedRevision: folder.revision,
      files: { src: 'ZmlsZQ==', ['__proto__']: 'eA==' },
    });
    assert.equal((await client.workspaceRead({ ...request, path: 'src' })).content, 'file');
    assert.ok((await client.workspaceFiles(request)).some((file) => file.path === '__proto__'));
    const next = await client.importWorkspace({
      ...request,
      expectedRevision: flattened.revision,
      files: {
        'a.bin': randomBytes(1600000).toString('base64'),
        'b.bin': randomBytes(1600000).toString('base64'),
      },
    });
    assert.notEqual(next.revision, imported.revision);
    const excessive = await fetch(`http://127.0.0.1:${address.port}/rpc`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
      body: JSON.stringify({
        requestId: 'test',
        method: 'health',
        params: { padding: 'x'.repeat(3 * 1024 * 1024) },
      }),
    });
    assert.equal(excessive.status, 400);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await sandbox.shutdown();
    const absolute = resolve(root);
    assert.ok(absolute.startsWith(resolve(tmpdir()) + sep));
    assert.match(absolute.split(sep).at(-1)!, /^mypi-import-/);
    await fs.rm(absolute, { recursive: true, force: true });
  }
});
