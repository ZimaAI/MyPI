import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { parseArgs, loadConfig } from '../apps/cli/src/config.ts';

test('CLI arguments enforce the two modes and reject ambiguous command inputs', () => {
  assert.equal(parseArgs(['run', 'hello', '--mode', 'native', '--json']).mode, 'native');
  assert.equal(parseArgs(['--mode=explicit', 'run', 'hello']).text, 'hello');
  assert.throws(() => parseArgs(['--mode', 'adaptive']), /native or explicit/);
  assert.throws(() => parseArgs(['run']), /requires a prompt/);
  assert.throws(() => parseArgs(['--api-key', 'visible-in-process-list']), /Unknown option/);
});

test('project configuration is inert unless explicitly trusted and cannot provide secrets', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'mypi-cli-config-'));
  try {
    await mkdir(join(dir, '.mypi'));
    await writeFile(
      join(dir, 'config.json'),
      JSON.stringify({ model: 'user-model', apiKey: 'private-key', mode: 'native' }),
    );
    await writeFile(
      join(dir, '.mypi', 'config.json'),
      JSON.stringify({ model: 'project-model', mode: 'explicit' }),
    );
    const options = parseArgs(['--state-dir', dir], dir);
    assert.equal((await loadConfig(options, {})).model.modelId, 'user-model');
    assert.equal(
      (await loadConfig({ ...options, trustProject: true }, {})).model.modelId,
      'project-model',
    );
    assert.equal(
      (await loadConfig({ ...options, trustProject: true, model: 'flag-model' }, {})).model.modelId,
      'flag-model',
    );
    await writeFile(
      join(dir, '.mypi', 'config.json'),
      JSON.stringify({ apiKey: 'workspace-secret' }),
    );
    await assert.rejects(
      loadConfig({ ...options, trustProject: true }, {}),
      /Unsupported configuration field apiKey/,
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

function cli(
  args: string[],
  env: NodeJS.ProcessEnv,
  input?: string,
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolveResult, reject) => {
    const child = spawn(process.execPath, ['--import', 'tsx', 'apps/cli/src/main.ts', ...args], {
      cwd: resolve('.'),
      env: { ...process.env, ...env },
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let stdout = '',
      stderr = '';
    child.stdout.on('data', (value) => {
      stdout += value;
    });
    child.stderr.on('data', (value) => {
      stderr += value;
    });
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`CLI timed out: ${args.join(' ')}\n${stdout}\n${stderr}`));
    }, 20000);
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolveResult({ code, stdout, stderr });
    });
    child.stdin.end(input);
  });
}

test(
  'standalone CLI executes real Pi search, persists sessions, resumes with four tools, and never starts Gateway',
  { timeout: 60000 },
  async () => {
    const dir = await mkdtemp(join(tmpdir(), 'mypi-cli-e2e-'));
    const workspace = join(dir, 'project');
    const state = join(dir, 'private');
    await mkdir(workspace);
    await writeFile(join(workspace, 'entry.ts'), 'export const main = 1;');
    const requests: Array<{
      tools?: Array<{ function: { name: string } }>;
      messages: Array<{ role: string; content: unknown }>;
    }> = [];
    const server = createServer(async (req, res) => {
      let raw = '';
      for await (const part of req) raw += part;
      const body = JSON.parse(raw);
      requests.push(body);
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      const send = (choices: unknown[], usage?: unknown) =>
        res.write(
          `data: ${JSON.stringify({ id: 'fixture', object: 'chat.completion.chunk', created: 1, model: 'fixture', choices, ...(usage ? { usage } : {}) })}\n\n`,
        );
      const searching = body.tools.some(
        (tool: { function: { name: string } }) => tool.function.name === 'mypi_search_files',
      );
      if (searching && body.messages.at(-1).role !== 'tool') {
        send([
          {
            index: 0,
            delta: {
              role: 'assistant',
              tool_calls: [
                {
                  index: 0,
                  id: 'find_entry',
                  type: 'function',
                  function: {
                    name: 'mypi_search_files',
                    arguments: JSON.stringify({ pattern: '*.ts' }),
                  },
                },
              ],
            },
            finish_reason: null,
          },
        ]);
        send([{ index: 0, delta: {}, finish_reason: 'tool_calls' }]);
      } else {
        send([
          {
            index: 0,
            delta: { role: 'assistant', content: 'verified CLI response' },
            finish_reason: null,
          },
        ]);
        send([{ index: 0, delta: {}, finish_reason: 'stop' }]);
      }
      send([], { prompt_tokens: 20, completion_tokens: 8, total_tokens: 28 });
      res.end('data: [DONE]\n\n');
    });
    await new Promise<void>((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
    const port = (server.address() as { port: number }).port;
    const env = {
      MYPI_API_KEY: 'loopback-test-key',
      MYPI_MODEL: 'fixture',
      MYPI_BASE_URL: `http://127.0.0.1:${port}/v1`,
      MYPI_PROVIDER: 'openai-compatible',
      MYPI_HOME: state,
    };
    try {
      const result = await cli(['run', '使用搜索工具查找入口', '--cwd', workspace, '--json'], env);
      assert.equal(result.code, 0, result.stderr);
      const events = result.stdout
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line));
      assert.ok(events.some((event) => event.type === 'tool.completed' && event.payload.ok));
      assert.ok(
        events.some(
          (event) => event.type === 'run.completed' && event.payload.status === 'succeeded',
        ),
      );
      const tools = requests[0].tools!.map((tool) => tool.function.name);
      assert.equal(tools.length, 9);
      assert.ok(tools.includes('mypi_search_files'));
      const list = await cli(['sessions', 'list', '--json'], env);
      assert.equal(list.code, 0, list.stderr);
      const session = JSON.parse(list.stdout.trim());
      assert.equal(session.id, events[0].conversationId);
      const resumed = await cli(['resume', session.id, '--json'], env, '解释这个文件\n');
      assert.equal(resumed.code, 0, resumed.stderr);
      assert.deepEqual(
        new Set(requests.at(-1)!.tools!.map((tool) => tool.function.name)),
        new Set(['read', 'write', 'edit', 'bash']),
      );
      assert.ok(JSON.stringify(requests.at(-1)!.messages).includes('使用搜索工具查找入口'));
      assert.ok(!result.stdout.includes('loopback-test-key'));
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
      await rm(dir, { recursive: true, force: true });
    }
  },
);
