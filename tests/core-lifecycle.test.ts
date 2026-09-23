import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AgentService, MemoryStore, BudgetService } from '../packages/agent-core/src/index.ts';
import { TrustedLocalSandbox } from '../packages/sandbox-client/src/index.ts';
import {
  defaultPolicy,
  unknownUsage,
  type RuntimeFactory,
  type RuntimeCreateInput,
  type ModelConfig,
  type Run,
} from '../packages/contracts/src/index.ts';

const model: ModelConfig = {
  id: 'lifecycle',
  displayName: 'Lifecycle fixture',
  providerType: 'openai',
  modelId: 'fixture',
  apiKey: 'fixture-only',
  maxOutputTokens: 100,
  contextWindow: 32000,
  configVersion: 1,
};
const usage = {
  ...unknownUsage(),
  inputTokens: 10,
  outputTokens: 5,
  cachedInputTokens: 2,
  status: 'known' as const,
};
const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};
async function fixture(runtime: RuntimeFactory) {
  const root = await mkdtemp(join(tmpdir(), 'mypi-lifecycle-'));
  const store = new MemoryStore();
  const sandbox = new TrustedLocalSandbox({
    root,
    stateRoot: join(root, '.private'),
    explicitlyTrusted: true,
    managedWorkspaces: true,
  });
  const service = new AgentService({
    store,
    runtime,
    sandbox,
    resolveModel: () => model,
    profile: 'trusted-local',
  });
  const conversation = await service.open({ ownerId: 'alice' });
  return {
    store,
    service,
    conversation,
    cleanup: async () => {
      await service.close('alice', conversation.id);
      await sandbox.shutdown();
      await rm(root, { recursive: true, force: true });
    },
  };
}

test(
  'cancellation publishes terminal only after provider settlement and runtime/tool cleanup',
  { timeout: 10000 },
  async () => {
    const entered = deferred(),
      allowCleanup = deferred();
    let cleaned = false;
    const f = await fixture({
      create: async (input) => ({
        prompt: async (_, signal) => {
          const reservation = await input.beforeModelCall(100);
          entered.resolve();
          await new Promise<void>((resolve) =>
            signal.addEventListener('abort', () => resolve(), { once: true }),
          );
          await allowCleanup.promise;
          await input.afterModelCall(reservation, unknownUsage());
          signal.throwIfAborted();
          return { text: 'unexpected', usage };
        },
        close: async () => {
          cleaned = true;
        },
      }),
    });
    try {
      const run = await f.service.submit('alice', f.conversation.id, { text: 'hello' }, 'cancel');
      await entered.promise;
      let terminal = false;
      f.service.events.on('event', (event) => {
        if (event.type === 'run.completed') {
          assert.equal(cleaned, true);
          terminal = true;
        }
      });
      let cancelResolved = false;
      const cancelled = f.service.cancel('alice', run.id).then(() => {
        cancelResolved = true;
      });
      await new Promise((resolve) => setImmediate(resolve));
      assert.equal(cancelResolved, false);
      assert.equal(terminal, false);
      assert.equal(f.service.run('alice', run.id).status, 'cancelling');
      allowCleanup.resolve();
      await cancelled;
      await f.service.wait(run.id);
      assert.equal(cleaned, true);
      assert.equal(terminal, true);
      assert.equal(f.service.run('alice', run.id).status, 'cancelled');
      assert.equal(f.service.run('alice', run.id).usage.status, 'unknown');
    } finally {
      allowCleanup.resolve();
      await f.cleanup();
    }
  },
);

test(
  'queued cancellation does not run its model or wait for the prior request',
  { timeout: 10000 },
  async () => {
    const entered = deferred(),
      release = deferred();
    let modelCalls = 0;
    const f = await fixture({
      create: async (input) => ({
        prompt: async () => {
          modelCalls++;
          const id = await input.beforeModelCall(100);
          entered.resolve();
          await release.promise;
          await input.afterModelCall(id, usage);
          return { text: 'ok', usage };
        },
        close: async () => {},
      }),
    });
    try {
      const first = await f.service.submit('alice', f.conversation.id, { text: 'first' }, 'first');
      await entered.promise;
      const queued = await f.service.submit(
        'alice',
        f.conversation.id,
        { text: 'second' },
        'second',
      );
      assert.equal((await f.service.cancel('alice', queued.id)).status, 'cancelled');
      assert.equal(modelCalls, 1);
      release.resolve();
      await f.service.wait(first.id);
      await f.service.wait(queued.id);
      assert.equal(modelCalls, 1);
    } finally {
      release.resolve();
      await f.cleanup();
    }
  },
);

test(
  'root usage includes both child sessions and tool-free result summary and records their sources',
  { timeout: 10000 },
  async () => {
    const inputs: RuntimeCreateInput[] = [];
    const f = await fixture({
      create: async (input) => {
        inputs.push(input);
        return {
          prompt: async (_, signal) => {
            const id = await input.beforeModelCall(100);
            await input.afterModelCall(id, usage);
            const spawn = input.tools.find((tool) => tool.name === 'mypi_subagent_spawn');
            if (spawn)
              for (const title of ['a', 'b'])
                assert.equal(
                  (
                    await spawn.execute(
                      { title, prompt: 'review code', role: 'reviewer', writeMode: 'read-only' },
                      signal,
                    )
                  ).ok,
                  true,
                );
            return { text: input.tools.length ? 'work result' : 'summary', usage };
          },
          close: async () => {},
        };
      },
    });
    try {
      const run = await f.service.submit(
        'alice',
        f.conversation.id,
        { text: '使用子代理分别检查实现和测试' },
        'aggregate',
      );
      await f.service.wait(run.id);
      const result = f.service.run('alice', run.id);
      assert.equal(result.status, 'succeeded');
      assert.equal(inputs.length, 4);
      assert.equal(result.usage.inputTokens, 40);
      assert.equal(result.usage.outputTokens, 20);
      assert.equal(result.usage.cachedInputTokens, 8);
      const calls = f.store.list<{ source: string; executionRunId: string }>('modelCall');
      assert.equal(calls.filter((call) => call.source === 'task').length, 2);
      assert.equal(calls.filter((call) => call.source === 'task_result').length, 1);
      assert.ok(calls.every((call) => !!call.executionRunId));
    } finally {
      await f.cleanup();
    }
  },
);

test(
  'cancelling a running summary waits for its cleanup and cannot publish a late successful summary',
  { timeout: 10000 },
  async () => {
    const summaryStarted = deferred(),
      summaryCleanup = deferred();
    let summaryClosed = false;
    const f = await fixture({
      create: async (input) => ({
        prompt: async (_, signal) => {
          const reservation = await input.beforeModelCall(100);
          if (!input.tools.length) {
            summaryStarted.resolve();
            await new Promise<void>((resolve) =>
              signal.addEventListener('abort', () => resolve(), { once: true }),
            );
            await summaryCleanup.promise;
            await input.afterModelCall(reservation, unknownUsage());
            signal.throwIfAborted();
          } else {
            await input.afterModelCall(reservation, usage);
            const spawn = input.tools.find((tool) => tool.name === 'mypi_subagent_spawn');
            if (spawn)
              await spawn.execute(
                { title: 'child', prompt: 'review', role: 'reviewer', writeMode: 'read-only' },
                signal,
              );
          }
          return { text: 'response', usage };
        },
        close: async () => {
          if (!input.tools.length) summaryClosed = true;
        },
      }),
    });
    try {
      const run = await f.service.submit(
        'alice',
        f.conversation.id,
        { text: '使用子代理检查实现' },
        'summary-cancel',
      );
      await summaryStarted.promise;
      const cancelled = f.service.cancel('alice', run.id);
      await new Promise((resolve) => setImmediate(resolve));
      assert.equal(f.service.run('alice', run.id).status, 'cancelling');
      assert.equal(summaryClosed, false);
      summaryCleanup.resolve();
      await cancelled;
      assert.equal(summaryClosed, true);
      assert.equal(f.service.run('alice', run.id).status, 'cancelled');
      assert.equal(
        f.store
          .events(f.conversation.id)
          .filter(
            (event) => event.type === 'message.completed' && event.payload.originRunId === run.id,
          ).length,
        0,
      );
    } finally {
      summaryCleanup.resolve();
      await f.cleanup();
    }
  },
);

test('estimated prices still settle authoritative token counts', () => {
  const store = new MemoryStore(),
    budget = new BudgetService(store),
    policy = { ...defaultPolicy, dailyTokens: 1000 };
  const run = {
    id: 'root',
    budgetRootRunId: 'root',
    ownerId: 'alice',
    conversationId: 'conversation',
    deadline: new Date(Date.now() + 10000).toISOString(),
    model,
  } as Run;
  budget.accept('alice', policy);
  const reservation = budget.reserve(run, policy, 100);
  budget.settle(reservation, {
    ...usage,
    status: 'estimated',
    costMicros: 2,
    currency: 'USD',
    priceVersion: 'v1',
  });
  assert.equal(budget.remaining('alice', policy).remainingTokens, 985);
});
