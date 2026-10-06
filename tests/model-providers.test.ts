import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request as httpRequest, type ServerResponse } from 'node:http';
import {
  providerPresets,
  getProviderPreset,
  approvedModelEndpoints,
  type ModelConfig,
  type ToolDefinition,
} from '../packages/contracts/src/index.ts';
import { PiRuntimeFactory } from '../packages/pi-adapter/src/index.ts';

function sse(res: ServerResponse, value: unknown, event?: string) {
  res.write(`${event ? `event: ${event}\n` : ''}data: ${JSON.stringify(value)}\n\n`);
}
function reply(res: ServerResponse, protocol: string, modelId: string) {
  res.writeHead(200, { 'content-type': 'text/event-stream' });
  if (protocol === 'anthropic-messages') {
    const emit = (type: string, fields: Record<string, unknown>) =>
      sse(res, { type, ...fields }, type);
    emit('message_start', {
      message: {
        id: 'msg_fixture',
        type: 'message',
        role: 'assistant',
        model: modelId,
        content: [],
        stop_reason: null,
        usage: { input_tokens: 12, output_tokens: 0 },
      },
    });
    emit('content_block_start', { index: 0, content_block: { type: 'text', text: '' } });
    emit('content_block_delta', { index: 0, delta: { type: 'text_delta', text: 'OK' } });
    emit('content_block_stop', { index: 0 });
    emit('message_delta', {
      delta: { stop_reason: 'end_turn', stop_sequence: null },
      usage: { output_tokens: 2 },
    });
    emit('message_stop', {});
  } else if (protocol === 'google-generative-ai') {
    sse(res, {
      candidates: [
        { index: 0, content: { role: 'model', parts: [{ text: 'OK' }] }, finishReason: 'STOP' },
      ],
      usageMetadata: { promptTokenCount: 12, candidatesTokenCount: 2, totalTokenCount: 14 },
      modelVersion: modelId,
    });
  } else if (protocol === 'openai-responses') {
    const item = {
      id: 'msg_fixture',
      type: 'message',
      role: 'assistant',
      status: 'completed',
      content: [{ type: 'output_text', text: 'OK', annotations: [] }],
    };
    sse(res, {
      type: 'response.output_item.added',
      output_index: 0,
      item: { ...item, content: [] },
    });
    sse(res, {
      type: 'response.content_part.added',
      item_id: item.id,
      output_index: 0,
      content_index: 0,
      part: { type: 'output_text', text: '', annotations: [] },
    });
    sse(res, {
      type: 'response.output_text.delta',
      item_id: item.id,
      output_index: 0,
      content_index: 0,
      delta: 'OK',
    });
    sse(res, { type: 'response.output_item.done', output_index: 0, item });
    sse(res, {
      type: 'response.completed',
      response: {
        id: 'resp_fixture',
        model: modelId,
        status: 'completed',
        output: [item],
        usage: { input_tokens: 12, output_tokens: 2, total_tokens: 14 },
      },
    });
  } else {
    sse(res, {
      id: 'fixture',
      choices: [{ index: 0, delta: { role: 'assistant', content: 'OK' }, finish_reason: null }],
    });
    sse(res, {
      id: 'fixture',
      choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
      usage: { prompt_tokens: 12, completion_tokens: 2, total_tokens: 14 },
    });
    res.write('data: [DONE]\n\n');
  }
  res.end();
}
const tool: ToolDefinition = {
  name: 'read',
  label: 'Read fixture',
  description: 'Read a fixture file',
  parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
  execute: async () => ({ ok: true, data: 'fixture file', truncated: false, durationMs: 0 }),
};

test(
  'all provider defaults stream through the real SDK with correct paths, auth, tools and output budgets',
  { timeout: 60000 },
  async () => {
    let active = providerPresets[0];
    const requests: Array<{ url: string; headers: Record<string, any>; body: any }> = [];
    const server = createServer(async (request, response) => {
      let raw = '';
      for await (const part of request) raw += part;
      requests.push({ url: request.url!, headers: request.headers, body: JSON.parse(raw) });
      reply(response, active.protocol, active.defaultModelId);
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const baseUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    try {
      for (const provider of providerPresets) {
        active = provider;
        const preset = provider.models.find((m) => m.id === provider.defaultModelId)!;
        const model: ModelConfig = {
          id: provider.id,
          displayName: preset.name,
          providerType: provider.id,
          protocol: provider.protocol,
          modelId: preset.id,
          baseUrl: `${baseUrl}${new URL(approvedModelEndpoints[provider.defaultEndpointId].baseUrl).pathname.replace(/\/$/, '')}`,
          apiKey: 'fixture-only-key',
          contextWindow: preset.defaultContextWindow,
          maxOutputTokens: 4096,
          reasoning: preset.reasoning,
          thinkingLevel: preset.thinkingLevel,
          configVersion: 1,
        };
        let reservations = 0,
          settlements = 0;
        const session = await new PiRuntimeFactory().create({
          sessionId: crypto.randomUUID(),
          model,
          tools: [tool],
          onEvent: () => {},
          beforeModelCall: async () => String(++reservations),
          afterModelCall: async (_, usage) => {
            settlements++;
            assert.equal(usage.outputTokens, 2);
          },
        });
        try {
          const response = await session.prompt('Reply OK.', new AbortController().signal);
          assert.equal(response.text, 'OK', provider.id);
          assert.equal(reservations, 1, provider.id);
          assert.equal(settlements, 1, provider.id);
          const req = requests.at(-1)!;
          const p = req.body;
          if (provider.protocol === 'openai-completions') {
            assert.equal(
              req.url,
              `${new URL(model.baseUrl!).pathname.replace(/\/$/, '')}/chat/completions`,
              provider.id,
            );
            assert.equal(req.headers.authorization, 'Bearer fixture-only-key');
            assert.equal(p.max_tokens ?? p.max_completion_tokens, 4096, provider.id);
            assert.deepEqual(
              p.tools.map((t: any) => t.function.name),
              ['read'],
            );
            assert.equal(p.store, undefined);
            assert.equal(p.messages[0].role, 'system');
            if (['dashscope', 'siliconflow', 'baidu'].includes(provider.id))
              assert.equal(p.enable_thinking, false);
            if (provider.id === 'deepseek') {
              assert.equal(p.thinking.type, 'enabled');
              assert.equal(p.reasoning_effort, 'low');
            }
            if (provider.id === 'moonshot') {
              assert.equal(p.thinking.type, 'enabled');
              assert.equal(p.reasoning_effort, 'low');
              assert.equal(p.max_completion_tokens, 4096);
              assert.equal(p.max_tokens, undefined);
            }
            if (provider.id === 'tencent') assert.equal(p.thinking.type, 'enabled');
            if (provider.id === 'mistral') assert.equal(p.reasoning_effort, 'none');
            if (provider.id === 'zhipu') assert.equal(p.reasoning_effort, 'low');
            if (provider.id === 'volcengine') assert.equal(p.thinking.type, 'disabled');
            if (provider.id === 'openrouter') assert.equal(p.reasoning.effort, 'low');
            if (['mistral', 'siliconflow'].includes(provider.id))
              assert.equal(p.stream_options, undefined);
          } else if (provider.protocol === 'openai-responses') {
            assert.equal(req.url, '/v1/responses');
            assert.equal(p.max_output_tokens, 4096);
            assert.equal(p.store, false);
            assert.equal(p.reasoning.effort, 'low');
            assert.deepEqual(
              p.tools.map((t: any) => t.name),
              ['read'],
            );
          } else if (provider.protocol === 'anthropic-messages') {
            assert.equal(
              new URL(req.url, baseUrl).pathname,
              `${new URL(model.baseUrl!).pathname.replace(/\/$/, '')}/v1/messages`,
            );
            assert.equal(req.headers['x-api-key'], 'fixture-only-key');
            assert.equal(p.max_tokens, 4096);
            assert.equal(p.thinking.type, 'adaptive');
            if (provider.id === 'minimax') {
              assert.equal(p.thinking.display, undefined);
              assert.equal(p.output_config, undefined);
            }
            assert.deepEqual(
              p.tools.map((t: any) => t.name),
              ['read'],
            );
          } else {
            assert.ok(
              req.url.startsWith(`/v1beta/models/${preset.id}:streamGenerateContent`),
              req.url,
            );
            assert.equal(req.headers['x-goog-api-key'], 'fixture-only-key');
            assert.equal(p.generationConfig.maxOutputTokens, 4096);
            assert.equal(p.generationConfig.thinkingConfig.thinkingLevel, 'LOW');
            assert.deepEqual(
              p.tools[0].functionDeclarations.map((t: any) => t.name),
              ['read'],
            );
          }
        } finally {
          await session.close();
        }
      }
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  },
);

test('Ark plan endpoint variants and custom public endpoints use all three real SDK transports', async () => {
  let protocol = 'openai-completions';
  const requests: any[] = [];
  const server = createServer(async (request, response) => {
    let raw = '';
    for await (const chunk of request) raw += chunk;
    requests.push({ path: request.url!, headers: request.headers, payload: JSON.parse(raw) });
    reply(response, protocol, 'ark-code-latest');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as { port: number }).port;
  try {
    for (const providerType of ['volcengine-agent-plan', 'volcengine-coding-plan', 'custom']) {
      for (const api of ['openai-completions', 'openai-responses', 'anthropic-messages'] as const) {
        protocol = api;
        const custom = providerType === 'custom';
        const prefix = custom
          ? '/custom/gateway'
          : providerType.includes('agent')
            ? '/api/plan'
            : '/api/coding';
        const path = `${prefix}${api === 'anthropic-messages' ? '' : '/v3'}`;
        let networkCalls = 0;
        const runtime = new PiRuntimeFactory({
          modelFetchOptions: {
            resolveDns: async () => [{ address: '8.8.8.8', family: 4 }],
            request: ((url: URL, options: any, callback: any) => {
              networkCalls++;
              assert.equal(url.origin, 'https://model.example.com');
              assert.equal(options.rejectUnauthorized, true);
              return httpRequest(
                `http://127.0.0.1:${port}${url.pathname}${url.search}`,
                {
                  method: options.method,
                  headers: options.headers,
                  signal: options.signal,
                  agent: false,
                },
                callback,
              );
            }) as any,
          },
        });
        const session = await runtime.create({
          sessionId: crypto.randomUUID(),
          tools: [tool],
          model: {
            id: `${providerType}-${api}`,
            displayName: providerType,
            providerType,
            protocol: api,
            modelId: custom ? 'customer-deployment' : 'ark-code-latest',
            apiKey: 'fixture-plan-custom-key',
            baseUrl: `${custom ? 'https://model.example.com' : `http://127.0.0.1:${port}`}${path}`,
            ...(custom ? { endpointPolicy: 'public' as const } : {}),
            maxOutputTokens: 4096,
            contextWindow: 32768,
            reasoning: !custom,
            thinkingLevel: custom ? 'off' : 'low',
            configVersion: 1,
          },
          onEvent: () => {},
          beforeModelCall: async () => crypto.randomUUID(),
          afterModelCall: async (_, usage) => {
            assert.equal(usage.outputTokens, 2);
          },
        });
        try {
          const result = await session.prompt('Reply OK.', new AbortController().signal);
          assert.equal(result.text, 'OK', `${providerType}/${api}`);
          assert.equal(networkCalls, custom ? 1 : 0);
          const req = requests.at(-1)!;
          assert.equal(req.payload.model, custom ? 'customer-deployment' : 'ark-code-latest');
          const operation =
            api === 'anthropic-messages'
              ? '/v1/messages'
              : api === 'openai-responses'
                ? '/responses'
                : '/chat/completions';
          assert.equal(new URL(req.path, 'https://model.example.com').pathname, path + operation);
          assert.equal(
            req.headers[api === 'anthropic-messages' ? 'x-api-key' : 'authorization'],
            api === 'anthropic-messages'
              ? 'fixture-plan-custom-key'
              : 'Bearer fixture-plan-custom-key',
          );
          assert.equal(
            req.payload.max_tokens ??
              req.payload.max_output_tokens ??
              req.payload.max_completion_tokens,
            4096,
          );
          if (!custom && api === 'openai-completions') {
            assert.equal(req.payload.thinking.type, 'enabled');
            assert.equal(req.payload.max_completion_tokens, 4096);
          }
          if (!custom && api === 'anthropic-messages') {
            assert.equal(req.payload.thinking.type, 'enabled');
            assert.ok(req.payload.thinking.budget_tokens < req.payload.max_tokens);
          }
        } finally {
          await session.close();
        }
      }
    }
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test('thinking tool calls replay reasoning and results without leaking tools or losing usage', async () => {
  const requests: any[] = [];
  let first = true;
  const server = createServer(async (request, response) => {
    let raw = '';
    for await (const part of request) raw += part;
    requests.push(JSON.parse(raw));
    if (!first) return reply(response, 'openai-completions', requests.at(-1).model);
    first = false;
    response.writeHead(200, { 'content-type': 'text/event-stream' });
    sse(response, {
      id: 'tool-turn',
      choices: [
        {
          index: 0,
          delta: {
            role: 'assistant',
            reasoning_content: 'Fixture reasoning for replay.',
            tool_calls: [
              {
                index: 0,
                id: 'fixture_read',
                type: 'function',
                function: { name: 'read', arguments: '{"path":"README.md"}' },
              },
            ],
          },
          finish_reason: null,
        },
      ],
    });
    sse(response, {
      id: 'tool-turn',
      choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }],
      usage: { prompt_tokens: 12, completion_tokens: 2, total_tokens: 14 },
    });
    response.end('data: [DONE]\n\n');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    for (const id of [
      'deepseek',
      'moonshot',
      'zhipu',
      'tencent',
      'volcengine-agent-plan',
      'volcengine-coding-plan',
    ]) {
      first = true;
      requests.length = 0;
      const provider = getProviderPreset(id)!,
        preset = provider.models[0];
      let calls = 0,
        settlements = 0;
      const session = await new PiRuntimeFactory().create({
        sessionId: crypto.randomUUID(),
        model: {
          id,
          providerType: id,
          modelId: preset.id,
          displayName: preset.name,
          protocol: provider.protocol,
          apiKey: 'fixture-key',
          baseUrl: `http://127.0.0.1:${(server.address() as { port: number }).port}/v1`,
          contextWindow: preset.defaultContextWindow,
          maxOutputTokens: 8192,
          reasoning: true,
          thinkingLevel: 'low',
          configVersion: 1,
        },
        tools: [
          {
            ...tool,
            execute: async () => {
              calls++;
              return { ok: true, data: 'fixture file', truncated: false, durationMs: 0 };
            },
          },
        ],
        onEvent: () => {},
        beforeModelCall: async () => crypto.randomUUID(),
        afterModelCall: async () => {
          settlements++;
        },
      });
      try {
        const result = await session.prompt('Read README.md.', new AbortController().signal);
        assert.equal(result.text, 'OK', id);
        assert.equal(result.usage.outputTokens, 4, id);
        assert.equal(calls, 1, id);
        assert.equal(settlements, 2, id);
        const second = requests[1];
        assert.equal(
          second.messages.find((m: any) => m.role === 'assistant').reasoning_content,
          'Fixture reasoning for replay.',
          id,
        );
        assert.match(second.messages.find((m: any) => m.role === 'tool').content, /fixture file/);
        assert.deepEqual(
          second.tools.map((t: any) => t.function.name),
          ['read'],
        );
      } finally {
        await session.close();
      }
    }
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
