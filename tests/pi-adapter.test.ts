import assert from 'node:assert/strict';
import { createServer, type ServerResponse } from 'node:http';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  PiRuntimeFactory,
  isolatedResourceLoader,
  PI_SDK_VERSION,
  purgeRuntimeSessions,
} from '../packages/pi-adapter/src/index.ts';
import type {
  ModelConfig,
  RuntimeCreateInput,
  RuntimeEvent,
  ToolDefinition,
  Usage,
} from '../packages/contracts/src/index.ts';

type RequestBody = {
  tools?: Array<{ function: { name: string } }>;
  messages: Array<{ role: string; content: unknown; tool_calls?: unknown[] }>;
};
const schema = {
  type: 'object',
  properties: { path: { type: 'string' } },
  required: ['path'],
  additionalProperties: false,
};
const makeTool = (
  name: string,
  execute: ToolDefinition['execute'] = async (args) => ({
    ok: true,
    data: args,
    truncated: false,
    durationMs: 1,
  }),
): ToolDefinition => ({
  name,
  label: name,
  description: `Test ${name} through the injected execution port`,
  parameters: schema,
  execute,
});
const base = ['read', 'write', 'edit', 'bash'];

async function provider(handler: (body: RequestBody, res: ServerResponse) => void) {
  const requests: RequestBody[] = [];
  const sockets = new Set<import('node:net').Socket>();
  const server = createServer(async (request, response) => {
    let body = '';
    for await (const chunk of request) body += chunk;
    const parsed = JSON.parse(body) as RequestBody;
    requests.push(parsed);
    handler(parsed, response);
  });
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as { port: number };
  const model: ModelConfig = {
    id: 'fixture',
    displayName: 'Loopback fixture',
    providerType: 'openai-compatible',
    modelId: 'fixture-model',
    apiKey: 'test-only-key',
    baseUrl: `http://127.0.0.1:${address.port}/v1`,
    maxOutputTokens: 256,
    contextWindow: 32000,
    configVersion: 1,
  };
  return {
    model,
    requests,
    close: async () => {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
function complete(
  res: ServerResponse,
  text = 'fixture response',
  toolNames: string[] = [],
  promptTokens = 12,
) {
  res.writeHead(200, { 'content-type': 'text/event-stream' });
  const chunk = (choices: unknown[], usage?: unknown) =>
    res.write(
      `data: ${JSON.stringify({ id: 'fixture', object: 'chat.completion.chunk', created: 1, model: 'fixture-model', choices, ...(usage ? { usage } : {}) })}\n\n`,
    );
  if (toolNames.length) {
    chunk([
      {
        index: 0,
        delta: {
          role: 'assistant',
          tool_calls: toolNames.map((name, index) => ({
            index,
            id: `call_${index}`,
            type: 'function',
            function: { name, arguments: JSON.stringify({ path: `${name}.txt` }) },
          })),
        },
        finish_reason: null,
      },
    ]);
    chunk([{ index: 0, delta: {}, finish_reason: 'tool_calls' }]);
  } else {
    chunk([{ index: 0, delta: { role: 'assistant', content: text }, finish_reason: null }]);
    chunk([{ index: 0, delta: {}, finish_reason: 'stop' }]);
  }
  chunk([], {
    prompt_tokens: promptTokens,
    completion_tokens: 6,
    total_tokens: promptTokens + 6,
    prompt_tokens_details: { cached_tokens: 2 },
  });
  res.end('data: [DONE]\n\n');
}
function input(
  model: ModelConfig,
  tools: ToolDefinition[],
  events: RuntimeEvent[] = [],
  settlements: Usage[] = [],
): RuntimeCreateInput {
  let reservations = 0;
  return {
    sessionId: crypto.randomUUID(),
    model,
    tools,
    onEvent: (event) => events.push(event),
    beforeModelCall: async () => String(++reservations),
    afterModelCall: async (_, usage) => {
      settlements.push(usage);
    },
  };
}

test('SDK is pinned and resource loader never discovers project extensions, settings or instructions', async () => {
  assert.equal(PI_SDK_VERSION, '0.87.1');
  const loader = isolatedResourceLoader();
  assert.deepEqual(loader.getAgentsFiles().agentsFiles, []);
  assert.deepEqual(loader.getExtensions().extensions, []);
  assert.deepEqual(loader.getSkills().skills, []);
  assert.deepEqual(loader.getPrompts().prompts, []);
  await loader.reload();
});

test('real Pi provider requests have exactly the granted schemas; independent sessions do not share history', async () => {
  const server = await provider((_, res) => complete(res));
  const events: RuntimeEvent[] = [];
  const settlements: Usage[] = [];
  const factory = new PiRuntimeFactory();
  const ordinary = await factory.create(
    input(
      server.model,
      base.map((name) => makeTool(name)),
      events,
      settlements,
    ),
  );
  const search = await factory.create(
    input(server.model, [...base.map((name) => makeTool(name)), makeTool('rg')]),
  );
  try {
    const result = await ordinary.prompt('private message alpha', new AbortController().signal);
    assert.equal(result.text, 'fixture response');
    assert.equal(result.usage.inputTokens, 12);
    await search.prompt('Use search now', new AbortController().signal);
    await ordinary.prompt('ordinary follow up', new AbortController().signal);
    assert.deepEqual(
      server.requests.map((request) => request.tools?.map((tool) => tool.function.name)),
      [base, [...base, 'rg'], base],
    );
    assert.ok(!JSON.stringify(server.requests[1].messages).includes('private message alpha'));
    assert.equal(events.filter((event) => event.type === 'provider-tools').length, 2);
    assert.equal(settlements.length, 2);
    assert.ok(settlements.every((usage) => usage.status === 'known'));
  } finally {
    await ordinary.close();
    await search.close();
    await server.close();
  }
});

test('all four native tool implementations are redirected to injected ports, stable until the SDK settles', async () => {
  const server = await provider((body, res) =>
    complete(res, 'done', body.messages.some((message) => message.role === 'tool') ? [] : base),
  );
  const calls: string[] = [];
  const events: RuntimeEvent[] = [];
  const settlements: Usage[] = [];
  const tools = base.map((name) =>
    makeTool(name, async (args, signal) => {
      assert.equal(signal.aborted, false);
      calls.push(name);
      return { ok: true, data: { source: 'injected-port', args }, truncated: false, durationMs: 1 };
    }),
  );
  const session = await new PiRuntimeFactory().create(
    input(server.model, tools, events, settlements),
  );
  try {
    const result = await session.prompt('Run all tools', new AbortController().signal);
    assert.deepEqual(calls, base);
    assert.equal(result.text, 'done');
    assert.equal(settlements.length, 2);
    assert.deepEqual(
      server.requests.map((body) => body.tools?.map((tool) => tool.function.name)),
      [base, base],
    );
    assert.equal(events.filter((event) => event.type === 'tool-end').length, 4);
    assert.equal(result.usage.outputTokens, 12);
  } finally {
    await session.close();
    await server.close();
  }
});

test('aborting waits for in-flight tool cancellation before prompt rejects and close settles', async () => {
  const server = await provider((_, res) => complete(res, '', ['bash']));
  let toolStarted: () => void = () => {};
  const started = new Promise<void>((resolve) => {
    toolStarted = resolve;
  });
  let cancelled = false;
  const session = await new PiRuntimeFactory().create(
    input(server.model, [
      makeTool('bash', async (_, signal) => {
        toolStarted();
        await new Promise<void>((resolve) =>
          signal.addEventListener(
            'abort',
            () => {
              cancelled = true;
              resolve();
            },
            { once: true },
          ),
        );
        return {
          ok: false,
          data: null,
          error: { code: 'CANCELLED', message: 'cancelled' },
          truncated: false,
          durationMs: 1,
        };
      }),
    ]),
  );
  try {
    const controller = new AbortController();
    const pending = session.prompt('Start command', controller.signal);
    await started;
    controller.abort();
    await assert.rejects(pending, { name: 'AbortError' });
    assert.equal(cancelled, true);
    await session.close();
  } finally {
    await session.close();
    await server.close();
  }
});

test('provider retry reserves every attempt and quota failure never reaches provider', async () => {
  let calls = 0;
  const server = await provider((_, res) => {
    calls++;
    if (calls === 1) {
      res.writeHead(503, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'temporary overloaded' } }));
    } else complete(res);
  });
  let reservations = 0;
  const settlements: Usage[] = [];
  const options = input(server.model, []);
  options.beforeModelCall = async () => String(++reservations);
  options.afterModelCall = async (_, usage) => {
    settlements.push(usage);
  };
  const session = await new PiRuntimeFactory().create(options);
  try {
    await session.prompt('retry', new AbortController().signal);
    assert.equal(calls, 2);
    assert.equal(reservations, 2);
    assert.equal(settlements.length, 2);
    assert.equal(settlements[0].status, 'unknown');
  } finally {
    await session.close();
  }
  const denied = await new PiRuntimeFactory().create({
    ...input(server.model, []),
    beforeModelCall: async () => {
      throw new Error('budget exhausted');
    },
  });
  try {
    await assert.rejects(denied.prompt('denied', new AbortController().signal), /budget exhausted/);
    assert.equal(calls, 2);
  } finally {
    await denied.close();
    await server.close();
  }
});

test('workspace extensions cannot execute; SDK history is restored from private storage without previous grants', async () => {
  const temporary = await mkdtemp(join(tmpdir(), 'mypi-sdk-'));
  const workspace = join(temporary, 'workspace');
  const stateDir = join(temporary, 'private');
  await mkdir(join(workspace, '.pi', 'extensions'), { recursive: true });
  await writeFile(
    join(workspace, '.pi', 'extensions', 'evil.ts'),
    'throw new Error("UNTRUSTED_EXTENSION_LOADED");',
  );
  await writeFile(join(workspace, 'AGENTS.md'), 'MYPI_UNTRUSTED_PROJECT_SENTINEL');
  const server = await provider((_, res) => complete(res));
  const factory = new PiRuntimeFactory({ stateDir, cwd: workspace });
  const options = input(server.model, [...base.map((name) => makeTool(name)), makeTool('rg')]);
  const session = await factory.create(options);
  try {
    await session.prompt('remember durable history', new AbortController().signal);
  } finally {
    await session.close();
  }
  const restored = await factory.create({ ...options, tools: base.map((name) => makeTool(name)) });
  try {
    await restored.prompt('ordinary after resume', new AbortController().signal);
    assert.ok(JSON.stringify(server.requests[1]).includes('remember durable history'));
    assert.ok(!JSON.stringify(server.requests).includes('MYPI_UNTRUSTED_PROJECT_SENTINEL'));
    assert.deepEqual(
      server.requests[1].tools?.map((tool) => tool.function.name),
      base,
    );
  } finally {
    await restored.close();
    await server.close();
    assert.equal(await purgeRuntimeSessions(stateDir, [options.sessionId]), 1);
    assert.equal(await purgeRuntimeSessions(stateDir, [options.sessionId]), 0);
    await rm(temporary, { recursive: true, force: true });
  }
});

test(
  'SDK automatic compaction remains inside prompt settlement and reserves its tool-free provider call',
  { timeout: 10000 },
  async () => {
    let calls = 0;
    const server = await provider((_, res) => {
      calls++;
      complete(
        res,
        calls === 1 ? 'Completed the current request' : 'Compacted history checkpoint',
        [],
        calls === 1 ? 30000 : 12,
      );
    });
    const settlements: Usage[] = [];
    const events: RuntimeEvent[] = [];
    const options = input(
      server.model,
      [...base.map((name) => makeTool(name)), makeTool('rg')],
      events,
      settlements,
    );
    options.history = Array.from({ length: 12 }, (_, index) => [
      {
        role: 'user' as const,
        text: `historical turn ${index}: ` + 'historical context '.repeat(2000),
      },
      { role: 'assistant' as const, text: `previous answer ${index}` },
    ]).flat();
    const session = await new PiRuntimeFactory().create(options);
    try {
      const result = await session.prompt('finish current request', new AbortController().signal);
      assert.ok(calls >= 2, 'The fixture must actually trigger SDK compaction');
      assert.equal(settlements.length, calls);
      assert.ok(
        server.requests.some((request) => (request.tools ?? []).length === 0),
        'Compaction must receive no execution tools',
      );
      for (const request of server.requests.filter((request) => (request.tools ?? []).length))
        assert.deepEqual(
          request.tools?.map((tool) => tool.function.name),
          [...base, 'rg'],
        );
      assert.equal(result.usage.outputTokens, 6 * calls);
    } finally {
      await session.close();
      await server.close();
    }
  },
);
