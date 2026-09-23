import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  AgentService,
  MemoryStore,
  type AgentServiceOptions,
} from '../packages/agent-core/src/index.ts';
import { TrustedLocalSandbox } from '../packages/sandbox-client/src/index.ts';
import { SqliteStore } from '../packages/storage-sqlite/src/index.ts';
import { SqliteBudget } from '../packages/storage-sqlite/src/entity-store.ts';
import {
  AppError,
  defaultPolicy,
  unknownUsage,
  type RuntimeCreateInput,
  type ModelConfig,
  type Task,
} from '../packages/contracts/src/index.ts';

const model: ModelConfig = {
  id: 'acceptance-fixture',
  displayName: 'Acceptance fixture',
  providerType: 'openai',
  modelId: 'fixture',
  apiKey: 'fixture-only',
  maxOutputTokens: 100,
  contextWindow: 32000,
  configVersion: 7,
};
const usage = {
  ...unknownUsage(),
  inputTokens: 10,
  outputTokens: 5,
  cachedInputTokens: 0,
  status: 'known' as const,
};
const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};
type Action = (input: RuntimeCreateInput, text: string, signal: AbortSignal) => Promise<string>;
async function fixture(action: Action, options: Partial<AgentServiceOptions> = {}) {
  const root = await mkdtemp(join(tmpdir(), 'mypi-acceptance-'));
  const store = new MemoryStore(),
    sandbox = new TrustedLocalSandbox({
      root,
      stateRoot: join(root, '.private'),
      explicitlyTrusted: true,
      managedWorkspaces: true,
    });
  const service = new AgentService({
    store,
    sandbox,
    resolveModel: () => model,
    profile: 'trusted-local',
    ...options,
    runtime: {
      create: async (input) => ({
        prompt: async (text, signal) => {
          const reservation = await input.beforeModelCall(100);
          await input.afterModelCall(reservation, usage);
          return { text: await action(input, text, signal), usage };
        },
        close: async () => {},
      }),
    },
  });
  const conversation = await service.open({ ownerId: 'alice' });
  return {
    store,
    service,
    sandbox,
    conversation,
    cleanup: async () => {
      await service.close('alice', conversation.id);
      await sandbox.shutdown();
      await rm(root, { recursive: true, force: true });
    },
  };
}

test(
  'AC-10: old task completion waits behind a new user request and summarizes only the origin run with no tools',
  { timeout: 10000 },
  async () => {
    const childRelease = deferred(),
      newStarted = deferred(),
      newRelease = deferred(),
      childEnded = deferred();
    const summaries: RuntimeCreateInput[] = [];
    const f = await fixture(async (input, text, signal) => {
      if (input.tools.some((tool) => tool.name === 'mypi_subagent_spawn')) {
        assert.equal(
          (
            await input.tools
              .find((tool) => tool.name === 'mypi_subagent_spawn')!
              .execute(
                {
                  title: 'old child',
                  prompt: 'old child data',
                  role: 'reviewer',
                  writeMode: 'read-only',
                },
                signal,
              )
          ).ok,
          true,
        );
        return 'main can continue';
      }
      if (text === 'new unrelated question') {
        newStarted.resolve();
        await newRelease.promise;
        return 'new answer';
      }
      if (!input.tools.length) {
        summaries.push(input);
        assert.match(text, /old child result/);
        assert.doesNotMatch(text, /new answer/);
        return 'old origin summary';
      }
      await childRelease.promise;
      return 'old child result';
    });
    f.service.events.on('event', (event) => {
      if (event.type === 'task.result.ready') childEnded.resolve();
    });
    try {
      const old = await f.service.submit(
        'alice',
        f.conversation.id,
        { text: '使用子代理检查旧问题' },
        'old',
      );
      const next = await f.service.submit(
        'alice',
        f.conversation.id,
        { text: 'new unrelated question' },
        'new',
      );
      await newStarted.promise;
      childRelease.resolve();
      await childEnded.promise;
      assert.equal(summaries.length, 0);
      assert.equal(f.service.run('alice', next.id).status, 'running');
      newRelease.resolve();
      await Promise.all([f.service.wait(old.id), f.service.wait(next.id)]);
      assert.equal(summaries.length, 1);
      assert.equal(summaries[0].sessionId, old.id + ':summary');
      const completed = f.store
        .events(f.conversation.id)
        .filter((event) => event.type === 'message.completed');
      assert.equal(completed.at(-1)!.runId, old.id);
      assert.equal(completed.at(-1)!.payload.originRunId, old.id);
      assert.equal(f.store.list('summary').length, 1);
      assert.equal(f.store.list('inbox').length, 1);
    } finally {
      childRelease.resolve();
      newRelease.resolve();
      await f.cleanup();
    }
  },
);

test(
  'AC-11: workflow runs independent nodes concurrently, sequences dependencies and skips descendants of a failed node',
  { timeout: 15000 },
  async () => {
    for (const fail of [false, true]) {
      const parallel = deferred();
      let active = 0,
        maxActive = 0,
        started = 0;
      const order: string[] = [];
      const f = await fixture(async (input, text, signal) => {
        const workflow = input.tools.find((tool) => tool.name === 'mypi_workflow_run');
        if (workflow) {
          const result = await workflow.execute(
            {
              title: 'acceptance DAG',
              failurePolicy: 'continue_independent',
              nodes: [
                { id: 'a', type: 'agent', title: 'A', prompt: 'A' },
                { id: 'b', type: 'agent', title: 'B', prompt: 'B' },
                { id: 'c', type: 'agent', title: 'C', prompt: 'C' },
                { id: 'd', type: 'aggregate', title: 'D' },
              ],
              edges: [
                { from: 'a', to: 'c' },
                { from: 'b', to: 'c' },
                { from: 'c', to: 'd' },
              ],
            },
            signal,
          );
          assert.equal(result.ok, true);
          return 'workflow launched';
        }
        if (!input.tools.length) return 'summary';
        const id = text[0];
        order.push('start ' + id);
        active++;
        maxActive = Math.max(maxActive, active);
        try {
          if (id === 'A' || id === 'B') {
            if (++started === 2) parallel.resolve();
            await parallel.promise;
          }
          if (fail && id === 'B') throw new Error('controlled node failure');
          if (id === 'C') assert.ok(order.includes('end A') && order.includes('end B'));
          order.push('end ' + id);
          return id + ' result';
        } finally {
          active--;
        }
      });
      try {
        const run = await f.service.submit(
          'alice',
          f.conversation.id,
          { text: '使用工作流处理依赖任务' },
          'workflow',
        );
        await f.service.wait(run.id);
        const result = f.store.list<{ status: string; states: Record<string, string> }>(
          'workflow',
        )[0];
        assert.equal(maxActive, 2);
        assert.deepEqual(
          result.states,
          fail
            ? { a: 'succeeded', b: 'failed', c: 'skipped', d: 'skipped' }
            : { a: 'succeeded', b: 'succeeded', c: 'succeeded', d: 'succeeded' },
        );
        assert.equal(result.status, fail ? 'failed' : 'succeeded');
        const count = f.store.list('task').length;
        f.service.recover();
        assert.equal(f.store.list('task').length, count);
      } finally {
        parallel.resolve();
        await f.cleanup();
      }
    }
  },
);

test(
  'AC-17: revocation blocks the next model request, and cancelling the origin settles the whole child tree',
  { timeout: 10000 },
  async () => {
    const childrenStarted = deferred(),
      nextCall = deferred(),
      blocked = deferred();
    let authorised = true,
      children = 0;
    const f = await fixture(
      async (input, _text, signal) => {
        const spawn = input.tools.find((tool) => tool.name === 'mypi_subagent_spawn');
        if (spawn) {
          for (const title of ['A', 'B'])
            assert.equal(
              (
                await spawn.execute(
                  { title, prompt: title, role: 'reviewer', writeMode: 'read-only' },
                  signal,
                )
              ).ok,
              true,
            );
          return 'children running';
        }
        if (!input.tools.length) return 'summary';
        if (++children === 2) childrenStarted.resolve();
        await nextCall.promise;
        await assert.rejects(
          input.beforeModelCall(100),
          (error) => (error as AppError).code === 'PRINCIPAL_BANNED',
        );
        blocked.resolve();
        await new Promise<void>((resolve) => {
          if (signal.aborted) resolve();
          else signal.addEventListener('abort', () => resolve(), { once: true });
        });
        signal.throwIfAborted();
        return 'unreachable';
      },
      {
        authorize: () => {
          if (!authorised) throw new AppError('PRINCIPAL_BANNED', '访客已封禁', 403);
        },
      },
    );
    try {
      const run = await f.service.submit(
        'alice',
        f.conversation.id,
        { text: '使用子代理检查接口与测试' },
        'revoke',
      );
      await childrenStarted.promise;
      authorised = false;
      nextCall.resolve();
      await blocked.promise;
      await f.service.revoke('alice');
      await f.service.wait(run.id);
      assert.equal(f.service.run('alice', run.id).status, 'cancelled');
      assert.ok(f.store.list<Task>('task').every((task) => task.status === 'cancelled'));
      assert.equal(f.store.list('modelCall').length, 3);
      await assert.rejects(
        f.service.submit('alice', f.conversation.id, { text: 'new call' }, 'banned'),
        /封禁/,
      );
    } finally {
      nextCall.resolve();
      await f.cleanup();
    }
  },
);

test('AC-18: run snapshots versions and batches ordered text without losing the final buffer', async () => {
  const policy = { ...defaultPolicy, version: 9 };
  const f = await fixture(
    async (input) => {
      for (let i = 0; i < 100; i++) input.onEvent({ type: 'delta', text: String(i % 10) });
      return '0123456789'.repeat(10);
    },
    { policy: () => policy },
  );
  try {
    const run = await f.service.submit('alice', f.conversation.id, { text: 'ordinary' }, 'trace');
    await f.service.wait(run.id);
    const stored = f.service.run('alice', run.id);
    assert.equal(stored.policyVersion, 9);
    assert.equal(stored.modelConfigVersion, 7);
    assert.equal(stored.ruleVersion, stored.decision.ruleVersion);
    policy.version = 10;
    assert.equal(stored.policySnapshot?.version, 9);
    const deltas = f.store
      .events(f.conversation.id)
      .filter((event) => event.type === 'message.delta');
    assert.equal(deltas.length, 1);
    assert.equal(deltas[0].payload.offset, 0);
    assert.equal(deltas[0].payload.delta, '0123456789'.repeat(10));
  } finally {
    await f.cleanup();
  }
});

test(
  'AC-17: a model waiting for a concurrency slot rechecks revocation before dispatch',
  { timeout: 10000 },
  async () => {
    const holding = deferred(),
      release = deferred();
    let authorised = true,
      secondDispatched = false;
    const f = await fixture(
      async (input, text, signal) => {
        const spawn = input.tools.find((tool) => tool.name === 'mypi_subagent_spawn');
        if (spawn) {
          await spawn.execute(
            { title: 'holder', prompt: 'holder', role: 'reviewer', writeMode: 'read-only' },
            signal,
          );
          await holding.promise;
          await spawn.execute(
            { title: 'waiter', prompt: 'waiter', role: 'reviewer', writeMode: 'read-only' },
            signal,
          );
          return 'spawned';
        }
        if (text === 'holder') {
          const id = await input.beforeModelCall(100);
          holding.resolve();
          await release.promise;
          await input.afterModelCall(id, usage);
          return 'holder done';
        }
        if (text === 'waiter') secondDispatched = true;
        return 'done';
      },
      {
        policy: () => ({ ...defaultPolicy, maxUserConcurrentModels: 1 }),
        authorize: () => {
          if (!authorised) throw new AppError('PRINCIPAL_BANNED', '访客已封禁', 403);
        },
      },
    );
    try {
      const run = await f.service.submit(
        'alice',
        f.conversation.id,
        { text: '使用子代理分别检查两个模块' },
        'queued-revoke',
      );
      await holding.promise;
      await new Promise<void>((resolve) => {
        const listener = () => {
          if (f.store.list<Task>('task').filter((task) => task.status === 'running').length === 2) {
            f.service.events.off('event', listener);
            resolve();
          }
        };
        f.service.events.on('event', listener);
        listener();
      });
      // Let the waiter finish its initial authorization and queue for the slot.
      await new Promise((resolve) => setImmediate(resolve));
      authorised = false;
      release.resolve();
      await f.service.wait(run.id);
      assert.equal(secondDispatched, false);
      assert.equal(f.store.list('modelCall').length, 3);
    } finally {
      release.resolve();
      await f.cleanup();
    }
  },
);

test(
  'AC-17: sibling model calls contend for one SQLite budget without overspending',
  { timeout: 10000 },
  async () => {
    const sqlite = new SqliteStore(':memory:'),
      holding = deferred(),
      release = deferred(),
      rejected = deferred();
    let rejectedDispatched = false;
    const f = await fixture(
      async (input, text, signal) => {
        const spawn = input.tools.find((tool) => tool.name === 'mypi_subagent_spawn');
        if (spawn) {
          await spawn.execute(
            { title: 'holder', prompt: 'holder', role: 'reviewer', writeMode: 'read-only' },
            signal,
          );
          await holding.promise;
          await spawn.execute(
            { title: 'limited', prompt: 'limited', role: 'reviewer', writeMode: 'read-only' },
            signal,
          );
          return 'spawned';
        }
        if (text === 'holder') {
          const id = await input.beforeModelCall(100);
          holding.resolve();
          await release.promise;
          await input.afterModelCall(id, usage);
          return 'done';
        }
        if (text === 'limited') rejectedDispatched = true;
        return 'summary';
      },
      { policy: () => ({ ...defaultPolicy, dailyTokens: 350 }), budget: new SqliteBudget(sqlite) },
    );
    f.service.events.on('event', (event) => {
      if (
        event.type === 'task.result.ready' &&
        f.store
          .list<Task>('task')
          .some((task) => task.title === 'limited' && task.status === 'failed')
      )
        rejected.resolve();
    });
    try {
      const run = await f.service.submit(
        'alice',
        f.conversation.id,
        { text: '使用子代理同时检查两个模块' },
        'quota',
      );
      await rejected.promise;
      const quota = sqlite.quota('principal', 'alice')!;
      assert.equal(quota.tokensReserved, 200);
      assert.equal(quota.tokensUsed, 30);
      assert.ok(quota.tokensUsed + quota.tokensReserved <= quota.tokenLimit);
      assert.equal(rejectedDispatched, false);
      release.resolve();
      await f.service.wait(run.id);
      assert.equal(f.store.list<Task>('task').filter((task) => task.status === 'failed').length, 1);
      assert.equal(sqlite.quota('principal', 'alice')!.tokensReserved, 0);
    } finally {
      release.resolve();
      await f.cleanup();
      sqlite.close();
    }
  },
);
