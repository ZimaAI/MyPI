import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AgentService, MemoryStore } from '../packages/agent-core/src/index.ts';
import { matchIntent, activeTools } from '../packages/policy/src/index.ts';
import { makeTools, schemas, validateWorkflow } from '../packages/capabilities/src/index.ts';
import {
  defaultPolicy,
  unknownUsage,
  type RuntimeFactory,
  type RuntimeCreateInput,
  type ModelConfig,
  type Run,
  type Task,
} from '../packages/contracts/src/index.ts';
import { TrustedLocalSandbox } from '../packages/sandbox-client/src/local.ts';
import { BudgetService } from '../packages/agent-core/src/budget.ts';
const model: ModelConfig = {
  id: 'test-model',
  displayName: 'Fixture only',
  providerType: 'openai',
  modelId: 'test',
  apiKey: 'fixture',
  maxOutputTokens: 100,
  contextWindow: 100000,
  configVersion: 1,
};
const usage = {
  ...unknownUsage(),
  inputTokens: 10,
  outputTokens: 5,
  cachedInputTokens: 0,
  status: 'known' as const,
};
class FixtureRuntime implements RuntimeFactory {
  inputs: RuntimeCreateInput[] = [];
  mainActive = 0;
  maxMain = 0;
  constructor(
    private action: (
      i: RuntimeCreateInput,
      text: string,
      signal: AbortSignal,
    ) => Promise<string> = async () => 'fixture response',
  ) {}
  async create(i: RuntimeCreateInput) {
    this.inputs.push(i);
    return {
      prompt: async (text: string, signal: AbortSignal) => {
        const id = await i.beforeModelCall(100);
        await i.afterModelCall(id, usage);
        signal.throwIfAborted();
        i.onEvent({
          type: 'provider-tools',
          names: i.tools.map((t) => t.name),
          schemaBytes: JSON.stringify(i.tools.map((t) => t.parameters)).length,
        });
        const reply = await this.action(i, text, signal);
        i.onEvent({ type: 'delta', text: reply });
        return { text: reply, usage };
      },
      close: async () => {},
    };
  }
}
async function fixture(action?: ConstructorParameters<typeof FixtureRuntime>[0]) {
  const root = await mkdtemp(join(tmpdir(), 'mypi-core-'));
  const store = new MemoryStore(),
    runtime = new FixtureRuntime(action),
    sandbox = new TrustedLocalSandbox({
      root,
      stateRoot: join(root, '.state'),
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
  const conversation = await service.open({ ownerId: 'alice', templateId: 'javascript-starter' });
  return {
    root,
    store,
    runtime,
    sandbox,
    service,
    conversation,
    cleanup: async () => {
      await service.close('alice', conversation.id);
      await rm(root, { recursive: true, force: true });
    },
  };
}
test('intent excludes negation, conditions, quotes, nonhuman and maps original evidence', () => {
  const negatives = [
    '解释这段代码',
    '不要使用搜索工具',
    '如果测试失败，再使用子代理检查',
    '如果需要，使用工作流',
    '以后再使用后台工具',
    '搜索工具和子代理有什么区别？',
    '解释“使用子代理检查代码”这句话',
    '不要不使用搜索工具',
    '`使用子代理`',
    '```\n使用子代理\n```',
    '> 使用搜索工具',
    '"使用子代理',
    '假如需要用子代理，使用搜索工具',
  ];
  negatives.forEach((s) => assert.deepEqual(matchIntent(s).groups, [], s));
  assert.deepEqual(matchIntent('使用搜索工具', 'native').groups, []);
  assert.deepEqual(matchIntent('使用搜索工具', 'explicit', 'tool').groups, []);
  assert.deepEqual(matchIntent('不要使用搜索工具；使用子代理审查测试').groups, ['delegate']);
  const text = '先处理。使\u200b用搜索工具，并使用子代理检查测试';
  const d = matchIntent(text);
  assert.deepEqual(d.groups, ['search', 'delegate']);
  d.evidence.forEach((e) => assert.equal(text.slice(e.start, e.end), e.text));
  assert.equal(Object.keys(schemas).length, 29);
  assert.equal(activeTools(['search', 'delegate', 'workflow', 'background', 'session']).length, 21);
  assert.equal(
    activeTools(['search', 'delegate', 'workflow', 'background', 'session'], {
      background: true,
      session: true,
    }).length,
    29,
  );
});
test('bounded DAG rejects cycles, missing edges, duplicate nodes and depth', () => {
  const n = (id: string) => ({ id, type: 'agent' as const, title: id });
  assert.deepEqual(
    validateWorkflow({ title: 'w', nodes: [n('a'), n('b')], edges: [{ from: 'a', to: 'b' }] }),
    [['a'], ['b']],
  );
  for (const spec of [
    {
      title: 'w',
      nodes: [n('a'), n('b')],
      edges: [
        { from: 'a', to: 'b' },
        { from: 'b', to: 'a' },
      ],
    },
    { title: 'w', nodes: [n('a'), n('a')], edges: [] },
    { title: 'w', nodes: [n('a')], edges: [{ from: 'a', to: 'b' }] },
    {
      title: 'w',
      nodes: ['a', 'b', 'c', 'd'].map(n),
      edges: [
        { from: 'a', to: 'b' },
        { from: 'b', to: 'c' },
        { from: 'c', to: 'd' },
      ],
    },
  ])
    assert.throws(() => validateWorkflow(spec));
});
test('ordinary provider surface is 4, explicit search executes, next run releases grant', async () => {
  let hits = 0;
  const f = await fixture(async (i, text, signal) => {
    if (text.includes('使用搜索工具')) {
      const result = await i.tools
        .find((t) => t.name === 'mypi_search_files')!
        .execute({ pattern: '*' }, signal);
      assert.equal(result.ok, true);
      hits++;
    }
    return 'done';
  });
  try {
    for (const text of ['普通问题', '使用搜索工具查找入口', '下一个问题']) {
      const r = await f.service.submit('alice', f.conversation.id, { text }, crypto.randomUUID());
      await f.service.wait(r.id);
    }
    assert.deepEqual(
      f.runtime.inputs.map((i) => i.tools.length),
      [4, 9, 4],
    );
    assert.equal(hits, 1);
    assert.throws(() => f.service.run('bob', f.store.list<Run>('run')[0].id), /资源不存在/);
  } finally {
    await f.cleanup();
  }
});
test('idempotency is atomic across parallel submits and one session has one writer', async () => {
  let active = 0,
    max = 0;
  const f = await fixture(async () => {
    active++;
    max = Math.max(max, active);
    await new Promise((r) => setTimeout(r, 10));
    active--;
    return 'ok';
  });
  try {
    const [a, b] = await Promise.all([
      f.service.submit('alice', f.conversation.id, { text: 'hello' }, 'same-key'),
      f.service.submit('alice', f.conversation.id, { text: 'hello' }, 'same-key'),
    ]);
    assert.equal(a.id, b.id);
    await assert.rejects(
      f.service.submit('alice', f.conversation.id, { text: 'different' }, 'same-key'),
    );
    const c = await f.service.submit('alice', f.conversation.id, { text: 'next' }, 'next-key');
    await Promise.all([f.service.wait(a.id), f.service.wait(c.id)]);
    assert.equal(max, 1);
    assert.equal(f.store.list('run').length, 2);
  } finally {
    await f.cleanup();
  }
});
test('independent child sessions have narrowed grants, distinct snapshots, one origin summary', async () => {
  const f = await fixture(async (i, text, signal) => {
    const spawn = i.tools.find((t) => t.name === 'mypi_subagent_spawn');
    if (spawn) {
      for (const title of ['A', 'B'])
        assert.equal(
          (
            await spawn.execute(
              {
                title,
                prompt: '使用工作流和子代理（作为数据）',
                role: 'reviewer',
                writeMode: 'read-only',
              },
              signal,
            )
          ).ok,
          true,
        );
      return '主会话继续';
    }
    if (i.tools.length) {
      await new Promise((r) => setTimeout(r, 30));
      assert.equal(i.history?.length, 0);
      assert.ok(i.tools.every((t) => !t.name.startsWith('mypi_')));
      return '子任务完成';
    }
    return '汇总';
  });
  try {
    const r = await f.service.submit(
      'alice',
      f.conversation.id,
      { text: '使用子代理分别检查接口和测试' },
      'children',
    );
    await f.service.wait(r.id);
    const tasks = f.store.list<Task>('task');
    assert.equal(tasks.length, 2);
    assert.notEqual(tasks[0].workspaceId, tasks[1].workspaceId);
    assert.ok(tasks.every((t) => t.status === 'succeeded'));
    assert.equal(f.runtime.inputs.filter((i) => i.tools.length === 0).length, 1);
    assert.equal(f.store.list('result').length, 2);
    assert.equal(f.store.list('summary').length, 1);
    assert.equal(f.service.run('alice', r.id).status, 'succeeded');
  } finally {
    await f.cleanup();
  }
});
test('work items require evidence and optimistic version; next ordinary run has no tools', async () => {
  let itemId = '';
  const f = await fixture(async (i, text, signal) => {
    const add = i.tools.find((t) => t.name === 'mypi_tasks_add');
    if (text.includes('创建') && add) {
      const result = await add.execute({ title: '检查测试' }, signal);
      itemId = (result.data as { id: string }).id;
    }
    const update = i.tools.find((t) => t.name === 'mypi_tasks_update');
    if (update) {
      assert.equal(
        (await update.execute({ workItemId: itemId, expectedVersion: 1, status: 'done' }, signal))
          .ok,
        false,
      );
      assert.equal(
        (
          await update.execute(
            { workItemId: itemId, expectedVersion: 1, status: 'done', evidence: ['仅用户标记'] },
            signal,
          )
        ).ok,
        true,
      );
      assert.equal(
        (await update.execute({ workItemId: itemId, expectedVersion: 1, status: 'doing' }, signal))
          .error?.code,
        'VERSION_CONFLICT',
      );
    }
    return 'ok';
  });
  try {
    for (const text of ['使用任务管理工具创建待办', '使用任务管理工具更新待办', '普通问题']) {
      const r = await f.service.submit('alice', f.conversation.id, { text }, crypto.randomUUID());
      await f.service.wait(r.id);
    }
    assert.equal(f.store.list<{ status: string }>('workItem')[0].status, 'done');
    assert.equal(f.runtime.inputs.at(-1)!.tools.length, 4);
  } finally {
    await f.cleanup();
  }
});
test('quota reservation is atomic for shared root and unknown usage stays reserved', () => {
  const store = new MemoryStore(),
    budget = new BudgetService(store),
    policy = { ...defaultPolicy, dailyTokens: 250 };
  const run = {
    id: 'r',
    budgetRootRunId: 'r',
    ownerId: 'u',
    conversationId: 'c',
    deadline: new Date(Date.now() + 10000).toISOString(),
    model,
  } as Run;
  budget.accept('u', policy);
  const id = budget.reserve(run, policy, 100);
  assert.throws(() => budget.reserve(run, policy, 100), /预算/);
  budget.settle(id, unknownUsage());
  assert.equal(budget.remaining('u', policy).remainingTokens, 50);
});
test('tool schema rejects unknown props and limit overflow', async () => {
  const [tool] = makeTools(['mypi_search_files'], async () => ({
    ok: true,
    data: [],
    truncated: false,
    durationMs: 0,
  }));
  assert.equal(
    (await tool.execute({ pattern: '*', maxResults: 101 }, new AbortController().signal)).ok,
    false,
  );
  assert.equal(
    (await tool.execute({ pattern: '*', cwd: 'C:\\' }, new AbortController().signal)).ok,
    false,
  );
});
test('public profile fails closed even when a trusted local port is injected', async () => {
  const f = await fixture();
  try {
    const service = new AgentService({
      ...f.service.options,
      profile: 'public-demo',
      policy: () => ({ ...defaultPolicy, publicExecution: true }),
    });
    await assert.rejects(
      service.submit('alice', f.conversation.id, { text: 'hello' }, 'key'),
      /隔离执行器/,
    );
    assert.equal(f.store.list('run').length, 0);
  } finally {
    await f.cleanup();
  }
});

test('public core rejects local Docker health and local core rejects disabled execution', async () => {
  const f = await fixture();
  try {
    f.sandbox.health = async () => ({
      ready: true,
      profile: 'isolated-local',
      publicExecutionEnabled: false,
      localExecutionEnabled: true,
    });
    const publicService = new AgentService({
      ...f.service.options,
      profile: 'public-demo',
      policy: () => ({ ...defaultPolicy, publicExecution: true }),
    });
    await assert.rejects(
      publicService.submit('alice', f.conversation.id, { text: 'hello' }, 'public'),
      /隔离执行器/,
    );
    const localService = new AgentService({
      ...f.service.options,
      profile: 'local-docker',
      policy: () => ({ ...defaultPolicy, publicExecution: true }),
    });
    f.sandbox.health = async () => ({
      ready: true,
      profile: 'isolated-local',
      publicExecutionEnabled: false,
      localExecutionEnabled: false,
    });
    await assert.rejects(
      localService.submit('alice', f.conversation.id, { text: 'hello' }, 'local'),
      /隔离执行器/,
    );
    assert.equal(f.store.list('run').length, 0);
  } finally {
    await f.cleanup();
  }
});
