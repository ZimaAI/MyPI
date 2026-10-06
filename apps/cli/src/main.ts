#!/usr/bin/env node
import { randomUUID } from 'node:crypto';
import { mkdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { pathToFileURL } from 'node:url';
import { AgentService } from '../../../packages/agent-core/src/index.ts';
import {
  PiRuntimeFactory,
  PI_SDK_PACKAGE,
  PI_SDK_VERSION,
} from '../../../packages/pi-adapter/src/index.ts';
import { TrustedLocalSandbox } from '../../../packages/sandbox-client/src/index.ts';
import { SqliteStore } from '../../../packages/storage-sqlite/src/index.ts';
import {
  AgentEntityStore,
  SqliteBudget,
} from '../../../packages/storage-sqlite/src/entity-store.ts';
import {
  AppError,
  defaultPolicy,
  providerPresets,
  customProviderPreset,
  MODEL_CATALOG_VERIFIED_AT,
  type AgentEvent,
  type Conversation,
  type Mode,
  type Run,
} from '../../../packages/contracts/src/index.ts';
import { loadConfig, parseArgs, usage } from './config.ts';

const OWNER = 'local-cli';
export function exitCode(run: Pick<Run, 'status'>): number {
  if (run.status === 'succeeded') return 0;
  if (run.status === 'cancelled') return 130;
  if (run.status === 'budget_exceeded') return 3;
  return 4;
}

function formatEvent(event: AgentEvent, json: boolean) {
  if (json) {
    process.stdout.write(JSON.stringify(event) + '\n');
    return;
  }
  const data = event.payload;
  if (event.type === 'message.delta') process.stdout.write(String(data.delta ?? ''));
  else if (event.type === 'message.completed') process.stdout.write('\n');
  else if (event.type === 'tool.surface.changed')
    process.stderr.write(
      `\n[${String(data.mode)} · 基础 ${String(data.baseCount)} / 扩展 ${String(data.extensionCount)}]\n`,
    );
  else if (event.type === 'tool.started')
    process.stderr.write(`↳ ${String(data.toolName)} ${String(data.argumentsPreview ?? '')}\n`);
  else if (event.type === 'tool.completed')
    process.stderr.write(`  ${data.ok ? '完成' : '失败'} ${String(data.durationMs ?? 0)} ms\n`);
  else if (event.type === 'task.state.changed')
    process.stderr.write(`[子任务 ${String(data.title ?? data.id)}: ${String(data.status)}]\n`);
  else if (event.type === 'error')
    process.stderr.write(`错误 [${String(data.code)}] ${String(data.message)}\n`);
  else if (event.type === 'run.completed') process.stderr.write(`[请求 ${String(data.status)}]\n`);
}

async function readSecret(prompt: string): Promise<string> {
  if (!process.stdin.isTTY) throw new AppError('CLI_INPUT', '管理员初始化需要交互终端以隐藏密码');
  process.stderr.write(prompt);
  const wasRaw = process.stdin.isRaw;
  process.stdin.setRawMode(true);
  process.stdin.resume();
  return await new Promise<string>((resolve, reject) => {
    let value = '';
    const cleanup = () => {
      process.stdin.off('data', onData);
      process.stdin.setRawMode(wasRaw);
      process.stdin.pause();
      process.stderr.write('\n');
    };
    const onData = (buffer: Buffer) => {
      for (const character of buffer.toString('utf8')) {
        if (character === '\r' || character === '\n') {
          cleanup();
          resolve(value);
          return;
        }
        if (character === '\u0003') {
          cleanup();
          reject(new AppError('CANCELLED', '已取消'));
          return;
        }
        if (character === '\u007f' || character === '\b') value = value.slice(0, -1);
        else if (character >= ' ') value += character;
      }
    };
    process.stdin.on('data', onData);
  });
}

export async function main(args = process.argv.slice(2)): Promise<number> {
  const options = parseArgs(args);
  if (options.command === 'help') {
    process.stdout.write(usage);
    return 0;
  }
  if (options.command === 'models') {
    const providers = [...providerPresets, customProviderPreset].filter(
      (provider) => !options.provider || provider.id === options.provider,
    );
    if (!providers.length) throw new AppError('CLI_ARGUMENT', 'Unknown catalog provider');
    process.stdout.write(
      JSON.stringify(
        { verifiedAt: MODEL_CATALOG_VERIFIED_AT, providers },
        null,
        options.json ? 0 : 2,
      ) + '\n',
    );
    return 0;
  }
  const config = await loadConfig(options);
  if (options.command === 'doctor') {
    const diagnostics = {
      node: process.version,
      nodeCompatible: Number(process.versions.node.split('.')[0]) >= 24,
      sdk: `${PI_SDK_PACKAGE}@${PI_SDK_VERSION}`,
      cwd: options.cwd,
      workspaceExists: await stat(options.cwd).then(
        (value) => value.isDirectory(),
        () => false,
      ),
      stateDir: options.stateDir,
      modelConfigured: !!config.model.apiKey && !!config.model.modelId,
      provider: config.model.providerType,
      model: config.model.modelId || null,
      mode: config.mode,
      executionProfile: 'trusted-local',
      gatewayRequired: false,
      resourceDiscovery: false,
    };
    process.stdout.write(JSON.stringify(diagnostics, null, options.json ? 0 : 2) + '\n');
    return diagnostics.nodeCompatible && diagnostics.workspaceExists && diagnostics.modelConfigured
      ? 0
      : 2;
  }
  await mkdir(options.stateDir, { recursive: true, mode: 0o700 });
  const sqlite = new SqliteStore(
    join(options.stateDir, options.command === 'bootstrap' ? 'mypi.sqlite' : 'cli.sqlite'),
  );
  const store = new AgentEntityStore(sqlite);
  if (options.command === 'bootstrap') {
    try {
      const terminal = createInterface({ input: process.stdin, output: process.stderr });
      const username = await new Promise<string>((resolve) =>
        terminal.question('管理员用户名: ', resolve),
      );
      terminal.close();
      const password = await readSecret('管理员密码（至少 12 个字符）: ');
      const repeat = await readSecret('再次输入密码: ');
      if (password !== repeat) throw new AppError('CLI_INPUT', '两次密码不一致');
      const { createAdmin } = await import('../../../packages/storage-sqlite/src/admin.ts');
      await createAdmin(sqlite, username.trim(), password);
      process.stderr.write(
        `管理员已创建；数据库 ${join(options.stateDir, 'mypi.sqlite')}。服务端 MYPI_DATA_DIR 应指向同一目录。\n`,
      );
      return 0;
    } finally {
      sqlite.close();
    }
  }
  if (options.command === 'sessions') {
    try {
      const sessions = store.list<Conversation>('conversation', { ownerId: OWNER });
      if (options.json)
        for (const session of sessions) process.stdout.write(JSON.stringify(session) + '\n');
      else
        for (const session of sessions)
          process.stdout.write(
            `${session.id}  ${session.mode}  ${session.status}  ${session.title}\n`,
          );
      return 0;
    } finally {
      sqlite.close();
    }
  }
  if (!config.model.apiKey || !config.model.modelId) {
    sqlite.close();
    throw new AppError(
      'CLI_CONFIG',
      '请设置 MYPI_API_KEY 和 MYPI_MODEL，或在 ~/.mypi/config.json 配置模型。',
    );
  }
  if (options.command === 'resume') {
    const metadata = store.get<{ id: string; cwd: string }>('cliSession', options.sessionId!);
    if (metadata) options.cwd = metadata.cwd;
  }
  if (!(await stat(options.cwd)).isDirectory()) {
    sqlite.close();
    throw new AppError('CLI_CONFIG', 'cwd 必须是目录');
  }
  process.stderr.write(
    `MyPI · trusted-local · ${options.cwd}\n工具将以当前用户权限操作此本机目录。模式 ${config.mode}，模型 ${config.model.modelId}。\n`,
  );
  const sandbox = new TrustedLocalSandbox({
    root: options.cwd,
    stateRoot: join(options.stateDir, 'local-executor'),
    explicitlyTrusted: true,
  });
  const agent = new AgentService({
    store,
    budget: new SqliteBudget(sqlite),
    runtime: new PiRuntimeFactory({ stateDir: join(options.stateDir, 'runtime') }),
    sandbox,
    resolveModel: () => config.model,
    profile: 'trusted-local',
    policy: () => ({ ...defaultPolicy, dailyRootRuns: 1000, dailyTokens: 5_000_000 }),
  });
  agent.recover();
  let conversation: Conversation;
  if (options.command === 'resume') {
    const stored = store.get<Conversation>('conversation', options.sessionId!);
    if (!stored || stored.ownerId !== OWNER || stored.status !== 'active') {
      sqlite.close();
      throw new AppError('RESOURCE_NOT_FOUND', '未找到可恢复的本机会话');
    }
    conversation = stored;
    if (!options.mode) config.mode = conversation.mode;
  } else {
    conversation = await agent.open({
      ownerId: OWNER,
      mode: config.mode,
      title: options.text?.slice(0, 50) ?? 'CLI 对话',
    });
    store.put('cliSession', { id: conversation.id, cwd: options.cwd }, OWNER);
  }
  process.stderr.write(`会话 ${conversation.id}\n`);
  const active = new Set<string>();
  const submissions = new Set<Promise<void>>();
  let exitRequested = false;
  let inputClosed = false;
  let interruptCount = 0;
  let reader: ReturnType<typeof createInterface> | undefined;
  const cancelActive = async () => {
    await Promise.all([...active].map((id) => agent.cancel(OWNER, id)));
  };
  const interrupt = () => {
    interruptCount++;
    if (active.size && interruptCount === 1) {
      process.stderr.write('\n正在取消请求，再次 Ctrl+C 退出。\n');
      void cancelActive();
    } else {
      exitRequested = true;
      reader?.close();
      void cancelActive();
    }
  };
  process.on('SIGINT', interrupt);
  const listener = (event: AgentEvent) => {
    if (event.conversationId === conversation.id) formatEvent(event, options.json);
  };
  agent.events.on('event', listener);
  const submit = async (text: string) => {
    const run = await agent.submit(
      OWNER,
      conversation.id,
      { text, mode: config.mode },
      randomUUID(),
    );
    active.add(run.id);
    interruptCount = 0;
    try {
      return (await agent.wait(run.id))!;
    } finally {
      active.delete(run.id);
    }
  };
  try {
    if (options.command === 'run') return exitCode(await submit(options.text!));
    reader = createInterface({
      input: process.stdin,
      output: process.stderr,
      terminal: !!process.stdin.isTTY,
    });
    reader.setPrompt('mypi › ');
    reader.prompt();
    let controls = Promise.resolve();
    const line = async (text: string) => {
      const value = text.trim();
      if (!value) return;
      if (value === '/quit') {
        exitRequested = true;
        reader?.close();
        return;
      }
      if (value === '/cancel') {
        await cancelActive();
        return;
      }
      if (value === '/tasks') {
        process.stdout.write(
          JSON.stringify(
            {
              tasks: agent.tasks(OWNER, conversation.id),
              workItems: store.list('workItem', {
                ownerId: OWNER,
                conversationId: conversation.id,
              }),
              goals: store.list('goal', { ownerId: OWNER, conversationId: conversation.id }),
            },
            null,
            2,
          ) + '\n',
        );
        return;
      }
      if (value === '/processes') {
        process.stdout.write(
          JSON.stringify(
            await sandbox.backgroundList({ principalId: OWNER, conversationId: conversation.id }),
            null,
            2,
          ) + '\n',
        );
        return;
      }
      if (value === '/new') {
        await cancelActive();
        await Promise.all([...submissions]);
        conversation = await agent.open({ ownerId: OWNER, mode: config.mode });
        store.put('cliSession', { id: conversation.id, cwd: options.cwd }, OWNER);
        process.stderr.write(`新会话 ${conversation.id}\n`);
        return;
      }
      if (value.startsWith('/mode ')) {
        const mode = value.slice(6).trim();
        if (mode !== 'native' && mode !== 'explicit')
          throw new AppError('CLI_ARGUMENT', '模式只能为 native 或 explicit');
        config.mode = mode as Mode;
        conversation.mode = config.mode;
        conversation.version++;
        store.put('conversation', conversation, OWNER);
        process.stderr.write(`模式 ${mode} 将用于下一条请求。\n`);
        return;
      }
      if (value.startsWith('/'))
        throw new AppError(
          'CLI_ARGUMENT',
          '未知命令。支持 /mode /tasks /processes /cancel /new /quit',
        );
      const pending = submit(value)
        .then(
          () => {},
          (error) => {
            process.stderr.write(
              `错误: ${error instanceof Error ? error.message : String(error)}\n`,
            );
          },
        )
        .finally(() => {
          submissions.delete(pending);
          if (!exitRequested && !inputClosed) reader?.prompt();
        });
      submissions.add(pending);
    };
    reader.on('line', (text) => {
      controls = controls
        .then(() => line(text))
        .catch((error) =>
          process.stderr.write(`错误: ${error instanceof Error ? error.message : String(error)}\n`),
        )
        .then(() => {
          if (!exitRequested && !inputClosed) reader?.prompt();
        });
    });
    reader.on('SIGINT', interrupt);
    await new Promise<void>((resolve) =>
      reader!.once('close', () => {
        inputClosed = true;
        resolve();
      }),
    );
    await controls;
    if (exitRequested) await cancelActive();
    await Promise.all([...submissions]);
    return interruptCount > 1 ? 130 : 0;
  } finally {
    process.off('SIGINT', interrupt);
    agent.events.off('event', listener);
    await cancelActive();
    await Promise.all([...submissions]);
    await sandbox.shutdown();
    sqlite.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then(
    (code) => {
      process.exitCode = code;
    },
    (error) => {
      process.stderr.write(`MyPI: ${error instanceof Error ? error.message : String(error)}\n`);
      process.exitCode =
        error instanceof AppError
          ? error.code === 'CANCELLED'
            ? 130
            : ['QUOTA_EXCEEDED', 'POLICY_DENIED', 'NOT_AUTHORIZED'].includes(error.code)
              ? 3
              : 2
          : 4;
    },
  );
}
