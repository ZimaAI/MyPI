/** Isolated browser fixture. Never imported by production launchers. */
import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import staticFiles from '@fastify/static';
import { SqliteStore } from '../../packages/storage-sqlite/src/index.ts';
import { createAdmin } from '../../packages/storage-sqlite/src/admin.ts';
import { SecretBox } from '../../packages/storage-sqlite/src/security.ts';
import { TrustedLocalSandbox } from '../../packages/sandbox-client/src/local.ts';
import { PiRuntimeFactory } from '../../packages/pi-adapter/src/index.ts';
import { defaultPolicy } from '../../packages/contracts/src/index.ts';
import { createWorkerServices } from '../../apps/worker/src/service.ts';
import { createGateway } from '../../apps/gateway/src/index.ts';
const root = await mkdtemp(join(tmpdir(), 'mypi-browser-')),
  store = new SqliteStore(join(root, 'browser.sqlite')),
  masterKey = randomBytes(32).toString('base64');
const provider = createServer(async (req, res) => {
  let input = '';
  for await (const chunk of req) input += chunk;
  const body = JSON.parse(input);
  const user = JSON.stringify(
    body.messages.filter((m: any) => m.role === 'user').at(-1)?.content ?? '',
  );
  const hadTool = body.messages.at(-1)?.role === 'tool';
  const names = (body.tools ?? []).map((t: any) => t.function.name);
  let calls: { name: string; args: unknown }[] = [];
  if (!hadTool && user.includes('使用搜索工具') && names.includes('mypi_search_files'))
    calls = [{ name: 'mypi_search_files', args: { pattern: '*', maxResults: 20 } }];
  if (!hadTool && user.includes('使用子代理') && names.includes('mypi_subagent_spawn'))
    calls = [
      {
        name: 'mypi_subagent_spawn',
        args: {
          title: '检查实现',
          prompt: '检查实现内容',
          role: 'reviewer',
          writeMode: 'read-only',
        },
      },
      {
        name: 'mypi_subagent_spawn',
        args: {
          title: '检查测试',
          prompt: '检查测试内容',
          role: 'reviewer',
          writeMode: 'read-only',
        },
      },
    ];
  res.writeHead(200, { 'content-type': 'text/event-stream' });
  const chunk = (choices: unknown[], usage?: unknown) =>
    res.write(
      `data: ${JSON.stringify({ id: 'browser-fixture', object: 'chat.completion.chunk', model: 'fixture', created: 1, choices, usage })}\n\n`,
    );
  if (calls.length) {
    chunk([
      {
        index: 0,
        delta: {
          role: 'assistant',
          tool_calls: calls.map((c, index) => ({
            index,
            id: `call_${index}`,
            type: 'function',
            function: { name: c.name, arguments: JSON.stringify(c.args) },
          })),
        },
        finish_reason: null,
      },
    ]);
    chunk([{ index: 0, delta: {}, finish_reason: 'tool_calls' }]);
  } else {
    const text = user.includes('恶意HTML')
      ? '内容仅作文本展示。\n\n<script>window.__mypiInjected=true</script>\n\n```html\n<img src=x onerror="window.__mypiInjected=true">\n```'
      : '已完成检查。\n\n这是 **浏览器验收提供商** 的确定性响应，经过真实 Pi SDK 与服务端执行链路。';
    for (const part of text.match(/.{1,12}/gs) ?? []) {
      chunk([{ index: 0, delta: { role: 'assistant', content: part }, finish_reason: null }]);
      await new Promise((r) => setTimeout(r, 12));
    }
    chunk([{ index: 0, delta: {}, finish_reason: 'stop' }]);
  }
  chunk([], { prompt_tokens: 40, completion_tokens: 20, total_tokens: 60 });
  res.end('data: [DONE]\n\n');
});
await new Promise<void>((r) => provider.listen(0, '127.0.0.1', r));
const model = {
  id: 'fixture',
  displayName: '验收模型 · Fixture',
  providerType: 'openai-compatible',
  modelId: 'fixture',
  apiKey: 'fixture-only',
  baseUrl: `http://127.0.0.1:${(provider.address() as { port: number }).port}/v1`,
  maxOutputTokens: 128,
  contextWindow: 32000,
  configVersion: 1,
};
store.put('policy', 'current', {
  ...defaultPolicy,
  publicExecution: true,
  dailyRootRuns: 100,
  dailyTokens: 500000,
});
store.put('model', 'fixture', {
  ...model,
  providerType: 'openai',
  approvedEndpointId: 'openai',
  apiKey: undefined,
  baseUrl: undefined,
  encryptedKey: new SecretBox(masterKey).encrypt('fixture-only'),
  enabled: true,
  publicSelectable: true,
  defaultForGuests: true,
  testedVersion: 1,
});
await createAdmin(store, 'admin', 'Mypi-E2E-Only-12345');
const sandbox = new TrustedLocalSandbox({
  root,
  stateRoot: join(root, 'sandbox'),
  managedWorkspaces: true,
  explicitlyTrusted: true,
});
const worker = createWorkerServices({
  store,
  runtime: new PiRuntimeFactory({ stateDir: join(root, 'sdk') }),
  sandbox,
  masterKey,
  importsEnabled: true,
  profile: 'trusted-local',
  resolveModel: () => model,
});
const services = {
  ...worker.services,
  testModel: async (config: any) =>
    worker.services.testModel({
      ...config,
      providerType: 'openai-compatible',
      protocol: 'openai-completions',
      reasoning: false,
      thinkingLevel: 'off',
      baseUrl: model.baseUrl,
      apiKey: 'fixture-only',
    }),
  ready: async () => ({ ready: true, sandboxEnforced: false }),
};
const app = await createGateway({
  store,
  services,
  masterKey,
  importsEnabled: true,
  cookieSecret: randomBytes(32).toString('hex'),
  origin: 'http://127.0.0.1:4197',
});
await app.register(staticFiles, { root: resolve('dist/web') });
app.setNotFoundHandler((request, reply) =>
  request.url.startsWith('/api/')
    ? reply.code(404).send({ code: 'NOT_FOUND' })
    : reply.sendFile('index.html'),
);
await app.listen({ port: 4197, host: '127.0.0.1' });
let closing = false;
async function shutdown() {
  if (closing) return;
  closing = true;
  await worker.core.revoke();
  await app.close();
  await sandbox.shutdown();
  store.close();
  provider.closeAllConnections();
  provider.close();
  await rm(root, { recursive: true, force: true });
  process.exit(0);
}
process.once('SIGINT', () => void shutdown());
process.once('SIGTERM', () => void shutdown());
