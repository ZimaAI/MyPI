import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { once } from 'node:events';
import { TrustedLocalSandbox, BrokerSandboxClient } from '../packages/sandbox-client/src/index.js';
import { relativePath } from '../packages/sandbox-client/src/engine.js';
import { DockerSandbox, dockerArguments } from '../apps/execution-broker/src/docker.js';
import { createBrokerServer } from '../apps/execution-broker/src/server.js';
import { localDockerEnabled } from '../packages/sandbox-client/src/deployment.js';

test('local Docker opt-in rejects public profiles, public origins and mutable images', () => {
  const env = {
    MYPI_LOCAL_DOCKER_ENABLED: 'true',
    MYPI_PROFILE: 'local',
    MYPI_HOST: '127.0.0.1',
    MYPI_ORIGIN: 'http://localhost:3000',
    PUBLIC_EXECUTION_ENABLED: 'false',
  };
  assert.equal(localDockerEnabled(env), true);
  assert.equal(localDockerEnabled({}), false);
  for (const change of [
    { MYPI_PROFILE: 'public-demo' },
    { MYPI_HOST: '0.0.0.0' },
    { MYPI_ORIGIN: 'http://example.com' },
    { PUBLIC_EXECUTION_ENABLED: 'true' },
  ])
    assert.throws(() => localDockerEnabled({ ...env, ...change }));
  const options = {
    stateRoot: '.',
    image: `sha256:${'b'.repeat(64)}`,
    publicExecutionEnabled: false,
    localExecutionEnabled: true,
  };
  const args = dockerArguments(options, 'mypi-test');
  assert.equal(args[args.indexOf('--runtime') + 1], 'runc');
  assert.ok(args.includes('--network=none'));
  assert.ok(args.includes('--user=10001:10001'));
  assert.ok(args.includes('--memory=1024m'));
  assert.ok(!args.some((value) => /--mount|--volume|--privileged/.test(value)));
  assert.throws(() => dockerArguments({ ...options, publicExecutionEnabled: true }, 'mypi-test'));
  assert.throws(() =>
    dockerArguments(
      { ...options, localExecutionEnabled: false, publicExecutionEnabled: true },
      'mypi-test',
    ),
  );
  assert.throws(() => dockerArguments({ ...options, image: 'mypi-sandbox:local' }, 'mypi-test'));
});

test('low-resource public sandbox has bounded runsc limits and cannot mix with local mode', () => {
  const options = {
    stateRoot: '.',
    image: `sha256:${'a'.repeat(64)}`,
    publicExecutionEnabled: true,
    lowResourcePublic: true,
  };
  const args = dockerArguments(options, 'mypi-test');
  assert.equal(args[args.indexOf('--runtime') + 1], 'runsc');
  for (const flag of [
    '--network=none',
    '--read-only',
    '--cpus=0.5',
    '--memory=512m',
    '--memory-swap=512m',
    '--pids-limit=64',
  ])
    assert.ok(args.includes(flag), flag);
  assert.ok(args.some((arg) => arg.startsWith('--tmpfs=/workspace:') && arg.includes('size=128m')));
  assert.ok(!args.some((value) => /--mount|--volume|--privileged/.test(value)));
  assert.throws(() => dockerArguments({ ...options, image: 'mypi-sandbox:latest' }, 'mypi-test'));
  assert.throws(() =>
    dockerArguments(
      { ...options, localExecutionEnabled: true, image: `sha256:${'a'.repeat(64)}` },
      'mypi-test',
    ),
  );
});

const owner = { principalId: 'principal-a', conversationId: 'conversation-a' };
async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mypi-sandbox-test-'));
  const sandbox = new TrustedLocalSandbox({
    root,
    stateRoot: path.join(root, '.mypi'),
    explicitlyTrusted: true,
    managedWorkspaces: true,
  });
  const workspace = await sandbox.createWorkspace({ ...owner, templateId: 'javascript-starter' });
  return {
    sandbox,
    root,
    request: { ...owner, workspaceId: workspace.workspaceId, runId: 'run-a' },
    cleanup: async () => {
      await sandbox.shutdown();
      const resolved = path.resolve(root);
      assert.ok(resolved.startsWith(path.resolve(os.tmpdir()) + path.sep));
      assert.match(path.basename(resolved), /^mypi-sandbox-test-/);
      await fs.rm(resolved, { recursive: true, force: true });
    },
  };
}
test('native file tools, literal search, expected-version and owner checks', async () => {
  const f = await fixture();
  try {
    const read = await f.sandbox.execute({
      ...f.request,
      operation: 'read',
      args: { path: 'src/sum.js' },
    });
    assert.equal(read.ok, true);
    const version = (read.data as { version: string }).version;
    const write = await f.sandbox.execute({
      ...f.request,
      operation: 'write',
      args: { path: 'src/sum.js', content: 'hello needle\n', expectedVersion: version },
    });
    assert.equal(write.ok, true);
    const conflict = await f.sandbox.execute({
      ...f.request,
      operation: 'write',
      args: { path: 'src/sum.js', content: 'overwrite', expectedVersion: version },
    });
    assert.equal(conflict.error?.code, 'CONFLICT');
    const search = await f.sandbox.execute({
      ...f.request,
      operation: 'search_content',
      args: { query: 'needle', glob: '**/*.js' },
    });
    assert.equal((search.data as { matches: unknown[] }).matches.length, 1);
    const cross = await f.sandbox.execute({
      ...f.request,
      principalId: 'principal-b',
      operation: 'read',
      args: { path: 'src/sum.js' },
    });
    assert.equal(cross.error?.code, 'NOT_FOUND');
    const traversal = await f.sandbox.execute({
      ...f.request,
      operation: 'read',
      args: { path: '../secret' },
    });
    assert.equal(traversal.error?.code, 'INVALID_INPUT');
  } finally {
    await f.cleanup();
  }
});
test('file paths reject absolute, encoded, NTFS and traversal forms', () => {
  for (const value of [
    '../x',
    '/etc/passwd',
    'C:/secret',
    'x\\..\\y',
    '%2e%2e/x',
    'file:stream',
    'CON',
    'x/../y',
    'trailing.',
  ])
    assert.throws(() => relativePath(value));
  assert.equal(relativePath('./src/main.ts'), 'src/main.ts');
});
test('template Git baseline supports controlled log/diff/show and rejects flag refs', async () => {
  const f = await fixture();
  try {
    const log = await f.sandbox.execute({ ...f.request, operation: 'git_log', args: { limit: 5 } });
    assert.equal(log.ok, true);
    assert.match((log.data as { stdout: string }).stdout, /Initial workspace template/);
    const show = await f.sandbox.execute({
      ...f.request,
      operation: 'git_show',
      args: { ref: 'HEAD', path: 'src/sum.js' },
    });
    assert.equal((show.data as { exitCode: number }).exitCode, 0);
    await f.sandbox.execute({
      ...f.request,
      operation: 'edit',
      args: { path: 'src/sum.js', oldText: 'total + value', newText: 'total + Number(value)' },
    });
    const diff = await f.sandbox.execute({
      ...f.request,
      operation: 'git_diff',
      args: { base: 'HEAD', paths: ['src/sum.js'] },
    });
    assert.match((diff.data as { stdout: string }).stdout, /\+.*Number\(value\)/);
    assert.equal(
      (
        await f.sandbox.execute({
          ...f.request,
          operation: 'git_show',
          args: { ref: '--output=secret' },
        })
      ).error?.code,
      'INVALID_INPUT',
    );
  } finally {
    await f.cleanup();
  }
});
test('hard-linked files are denied before exposing data', async () => {
  const f = await fixture();
  try {
    const base = path.join(f.root, '.mypi', 'workspaces', f.request.workspaceId);
    await fs.link(path.join(base, 'README.md'), path.join(base, 'linked.md'));
    const result = await f.sandbox.execute({
      ...f.request,
      operation: 'read',
      args: { path: 'linked.md' },
    });
    assert.equal(result.error?.code, 'INVALID_INPUT');
    await fs.unlink(path.join(base, 'linked.md'));
  } finally {
    await f.cleanup();
  }
});
test('isolated copies retain base revision and cannot overwrite concurrent parent changes', async () => {
  const f = await fixture();
  try {
    const child = await f.sandbox.forkWorkspace({ ...f.request, writeMode: 'isolated' });
    assert.equal(
      (
        await f.sandbox.execute({
          ...f.request,
          workspaceId: child.workspaceId,
          operation: 'write',
          args: { path: 'new.txt', content: 'child' },
        })
      ).ok,
      true,
    );
    const diff = await f.sandbox.diffWorkspace({ ...f.request, workspaceId: child.workspaceId });
    assert.equal(diff.conflict, false);
    assert.match(diff.patch, /\+child/);
    await f.sandbox.execute({
      ...f.request,
      operation: 'write',
      args: { path: 'parent.txt', content: 'parent' },
    });
    await assert.rejects(
      f.sandbox.applyWorkspace({
        ...f.request,
        workspaceId: child.workspaceId,
        baseRevision: diff.baseRevision,
      }),
      { code: 'CONFLICT' },
    );
    const reader = await f.sandbox.forkWorkspace({ ...f.request, writeMode: 'read-only' });
    assert.equal(
      (
        await f.sandbox.execute({
          ...f.request,
          workspaceId: reader.workspaceId,
          operation: 'bash',
          args: { command: 'echo unsafe' },
        })
      ).error?.code,
      'NOT_AUTHORIZED',
    );
  } finally {
    await f.cleanup();
  }
});
test('copies apply when base revision matches', async () => {
  const f = await fixture();
  try {
    const child = await f.sandbox.forkWorkspace({ ...f.request, writeMode: 'isolated' });
    await f.sandbox.execute({
      ...f.request,
      workspaceId: child.workspaceId,
      operation: 'write',
      args: { path: 'new.txt', content: 'child' },
    });
    await f.sandbox.applyWorkspace({
      ...f.request,
      workspaceId: child.workspaceId,
      baseRevision: child.baseRevision!,
    });
    assert.equal(
      (await f.sandbox.execute({ ...f.request, operation: 'read', args: { path: 'new.txt' } })).ok,
      true,
    );
  } finally {
    await f.cleanup();
  }
});
test('background event watch, persisted result and explicit cancellation', async () => {
  const f = await fixture();
  try {
    const started = await f.sandbox.backgroundStart({
      ...f.request,
      title: 'offline tests',
      command: 'node --test',
      ttlSeconds: 10,
    });
    assert.equal(started.status, 'running');
    const terminal = await f.sandbox.backgroundWatch({
      ...owner,
      processId: started.processId,
      event: 'exit',
      timeoutMs: 10000,
    });
    assert.equal(terminal.status, 'completed');
    assert.equal(terminal.exitCode, 0);
    assert.ok(terminal.logs.length > 0);
    const slow = await f.sandbox.backgroundStart({
      ...f.request,
      title: 'cancellable',
      command: 'node -e "setTimeout(() => {}, 20000)"',
      ttlSeconds: 10,
    });
    assert.equal(
      (await f.sandbox.backgroundStop({ ...owner, processId: slow.processId })).status,
      'cancelled',
    );
  } finally {
    await f.cleanup();
  }
});
test('ordinary command cancellation reaches the process tree', async () => {
  const f = await fixture();
  try {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 300);
    const start = Date.now();
    const result = await f.sandbox.execute(
      {
        ...f.request,
        operation: 'bash',
        args: { command: 'node -e "setTimeout(() => {}, 20000)"' },
      },
      controller.signal,
    );
    assert.equal(result.error?.code, 'CANCELLED');
    assert.ok(
      Date.now() - start < 10000,
      'cancellation must terminate the child before its natural deadline',
    );
  } finally {
    await f.cleanup();
  }
});
test('broker IPC requires secret, restricts methods and preserves object ownership', async () => {
  const f = await fixture();
  const token = 'test-only-broker-token-of-32-characters';
  const server = createBrokerServer(f.sandbox, token);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const url = `http://127.0.0.1:${address.port}`;
  const client = new BrokerSandboxClient({ baseUrl: url, token });
  try {
    assert.equal(
      (await client.execute({ ...f.request, operation: 'read', args: { path: 'README.md' } })).ok,
      true,
    );
    assert.equal(
      (
        await client.execute({
          ...f.request,
          principalId: 'other',
          operation: 'read',
          args: { path: 'README.md' },
        })
      ).error?.code,
      'NOT_FOUND',
    );
    assert.equal((await fetch(`${url}/rpc`, { method: 'POST', body: '{}' })).status, 401);
    const unknown = await fetch(`${url}/rpc`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
      body: JSON.stringify({ requestId: 'test', method: 'runDocker', params: {} }),
    });
    assert.equal(unknown.status, 400);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await f.cleanup();
  }
});
test('disabled public executor fails closed, docker options fixed with no host mounts', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mypi-sandbox-test-'));
  const sandbox = new DockerSandbox({
    stateRoot: root,
    image: `example/mypi@sha256:${'a'.repeat(64)}`,
    publicExecutionEnabled: false,
  });
  try {
    const workspace = await sandbox.createWorkspace(owner);
    const health = await sandbox.health();
    assert.equal(health.ready, false);
    const files = await sandbox.workspaceFiles({ ...owner, workspaceId: workspace.workspaceId });
    assert.ok(files.some((file) => file.path === 'README.md'));
    assert.ok(!files.some((file) => file.path.startsWith('.git/')));
    assert.match(
      (
        await sandbox.workspaceRead({
          ...owner,
          workspaceId: workspace.workspaceId,
          path: 'README.md',
        })
      ).content,
      /MyPI/,
    );
    const result = await sandbox.execute({
      ...owner,
      workspaceId: workspace.workspaceId,
      runId: 'test',
      operation: 'bash',
      args: { command: 'echo MUST_NOT_RUN' },
    });
    assert.equal(result.error?.code, 'SANDBOX_UNAVAILABLE');
    const argv = dockerArguments(
      {
        stateRoot: root,
        image: `example/mypi@sha256:${'a'.repeat(64)}`,
        publicExecutionEnabled: true,
      },
      'mypi-test',
    );
    assert.ok(argv.includes('--network=none'));
    assert.ok(argv.includes('--read-only'));
    assert.ok(argv.includes('--memory-swap=1024m'));
    assert.ok(!argv.some((value) => value.includes('type=bind') || value.includes('docker.sock')));
    assert.throws(() =>
      dockerArguments(
        { stateRoot: root, image: 'anything:latest', publicExecutionEnabled: true },
        'mypi-test',
      ),
    );
  } finally {
    await sandbox.shutdown();
    const resolved = path.resolve(root);
    assert.ok(resolved.startsWith(path.resolve(os.tmpdir()) + path.sep));
    assert.match(path.basename(resolved), /^mypi-sandbox-test-/);
    await fs.rm(resolved, { recursive: true, force: true });
  }
});
test('retention removes managed roots, copies and prevents later access', async () => {
  const f = await fixture();
  try {
    const child = await f.sandbox.forkWorkspace({ ...f.request, writeMode: 'isolated' });
    assert.equal((await f.sandbox.sweepExpired(0)).deletedConversations, 1);
    await assert.rejects(f.sandbox.workspaceFiles(f.request), { code: 'NOT_FOUND' });
    await assert.rejects(fs.stat(path.join(f.root, '.mypi', 'workspaces', f.request.workspaceId)), {
      code: 'ENOENT',
    });
    await assert.rejects(fs.stat(path.join(f.root, '.mypi', 'copies', child.workspaceId)), {
      code: 'ENOENT',
    });
    await f.sandbox.deleteConversation(owner);
  } finally {
    await f.cleanup();
  }
});
test('deleting a trusted-local session preserves the original project', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mypi-sandbox-test-'));
  const sandbox = new TrustedLocalSandbox({
    root,
    stateRoot: path.join(root, '.mypi'),
    explicitlyTrusted: true,
  });
  try {
    await fs.writeFile(path.join(root, 'keep.txt'), 'user project');
    await sandbox.createWorkspace(owner);
    await sandbox.deleteConversation(owner);
    assert.equal(await fs.readFile(path.join(root, 'keep.txt'), 'utf8'), 'user project');
    assert.equal((await sandbox.sweepExpired(0)).deletedConversations, 0);
  } finally {
    await sandbox.shutdown();
    const resolved = path.resolve(root);
    assert.ok(resolved.startsWith(path.resolve(os.tmpdir()) + path.sep));
    assert.match(path.basename(resolved), /^mypi-sandbox-test-/);
    await fs.rm(resolved, { recursive: true, force: true });
  }
});
