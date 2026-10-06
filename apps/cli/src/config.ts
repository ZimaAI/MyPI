import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  AppError,
  type Mode,
  type ModelConfig,
  getProviderPreset,
  getModelPreset,
  approvedModelEndpoints,
  modelLimitError,
  MODEL_PROTOCOLS,
} from '../../../packages/contracts/src/index.ts';

export interface CliOptions {
  command:
    | 'interactive'
    | 'run'
    | 'sessions'
    | 'resume'
    | 'doctor'
    | 'bootstrap'
    | 'models'
    | 'help';
  text?: string;
  sessionId?: string;
  cwd: string;
  stateDir: string;
  mode?: Mode;
  json: boolean;
  trustProject: boolean;
  provider?: string;
  model?: string;
  baseUrl?: string;
  endpoint?: string;
}

export const usage = `MyPI — 独立 Coding Agent（默认 explicit）

用法:
  mypi [--cwd DIR] [--mode native|explicit]
  mypi run "任务内容" [--json]
  mypi sessions list
  mypi resume <session-id>
  mypi doctor
  mypi models [--provider TYPE] [--json]
  mypi admin bootstrap

选项:
  --cwd DIR             本机可信工作目录；工具以当前用户权限执行
  --mode MODE           native / explicit
  --provider TYPE       服务商 ID（mypi models 查看）或 openai-compatible / openai-responses
  --model ID            提供商模型 ID
  --base-url URL        本地配置的提供商地址
  --endpoint ID         服务商预设地域端点（mypi models 查看）
  --state-dir DIR       私有状态目录（默认 ~/.mypi）
  --trust-project       信任 .mypi/config.json 中的非敏感设置
  --json                JSONL 事件输出，诊断写 stderr
  --help                显示帮助

环境: MYPI_API_KEY, MYPI_MODEL, MYPI_PROVIDER, MYPI_BASE_URL, MYPI_ENDPOINT, MYPI_HOME
也支持服务商 API Key 环境变量；默认模型参数来自官方文档快照。
交互: /mode native|explicit /tasks /processes /cancel /new /quit
`;

export function parseArgs(args: string[], cwd = process.cwd()): CliOptions {
  const options: CliOptions = {
    command: 'interactive',
    cwd: resolve(cwd),
    stateDir: resolve(process.env.MYPI_HOME ?? join(homedir(), '.mypi')),
    json: false,
    trustProject: false,
  };
  const positional: string[] = [];
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === '--json') {
      options.json = true;
      continue;
    }
    if (arg === '--trust-project') {
      options.trustProject = true;
      continue;
    }
    if (arg === '--help' || arg === '-h') {
      options.command = 'help';
      continue;
    }
    if (arg.startsWith('--')) {
      const [key, inline] = arg.slice(2).split('=', 2);
      const value = inline ?? args[++index];
      if (!value || value.startsWith('--'))
        throw new AppError('CLI_ARGUMENT', `Missing value for --${key}`);
      switch (key) {
        case 'cwd':
          options.cwd = resolve(cwd, value);
          break;
        case 'state-dir':
          options.stateDir = resolve(cwd, value);
          break;
        case 'mode':
          if (value !== 'native' && value !== 'explicit')
            throw new AppError('CLI_ARGUMENT', 'mode must be native or explicit');
          options.mode = value;
          break;
        case 'provider':
          options.provider = value;
          break;
        case 'model':
          options.model = value;
          break;
        case 'base-url':
          options.baseUrl = value;
          break;
        case 'endpoint':
          options.endpoint = value;
          break;
        default:
          throw new AppError('CLI_ARGUMENT', `Unknown option --${key}`);
      }
    } else positional.push(arg);
  }
  if (options.command === 'help') return options;
  const [command, ...rest] = positional;
  if (!command) return options;
  if (command === 'run') {
    if (!rest.length) throw new AppError('CLI_ARGUMENT', 'run requires a prompt');
    options.command = 'run';
    options.text = rest.join(' ');
  } else if (command === 'sessions' && rest[0] === 'list' && rest.length === 1)
    options.command = 'sessions';
  else if (command === 'resume' && rest.length === 1) {
    options.command = 'resume';
    options.sessionId = rest[0];
  } else if (command === 'doctor' && !rest.length) options.command = 'doctor';
  else if (command === 'models' && !rest.length) options.command = 'models';
  else if (command === 'admin' && rest[0] === 'bootstrap' && rest.length === 1)
    options.command = 'bootstrap';
  else throw new AppError('CLI_ARGUMENT', `Unknown command: ${positional.join(' ')}`);
  return options;
}

interface FileConfig {
  mode?: Mode;
  provider?: string;
  model?: string;
  baseUrl?: string;
  maxOutputTokens?: number;
  contextWindow?: number;
  apiKey?: string;
  endpoint?: string;
  protocol?: ModelConfig['protocol'];
  reasoning?: boolean;
  thinkingLevel?: ModelConfig['thinkingLevel'];
}
async function configFile(path: string, project = false): Promise<FileConfig> {
  let raw: string;
  try {
    raw = await readFile(path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {};
    throw error;
  }
  let config: FileConfig;
  try {
    config = JSON.parse(raw) as FileConfig;
  } catch {
    throw new AppError('CLI_CONFIG', `Invalid JSON in ${path}`);
  }
  if (!config || typeof config !== 'object' || Array.isArray(config))
    throw new AppError('CLI_CONFIG', `Expected an object in ${path}`);
  for (const key of Object.keys(config))
    if (
      ![
        'mode',
        'provider',
        'model',
        'baseUrl',
        'maxOutputTokens',
        'contextWindow',
        'endpoint',
        'protocol',
        'reasoning',
        'thinkingLevel',
        ...(project ? [] : ['apiKey']),
      ].includes(key)
    )
      throw new AppError('CLI_CONFIG', `Unsupported configuration field ${key} in ${path}`);
  if (config.mode !== undefined && config.mode !== 'native' && config.mode !== 'explicit')
    throw new AppError('CLI_CONFIG', `Invalid mode in ${path}`);
  for (const key of ['provider', 'model', 'baseUrl', 'apiKey', 'endpoint'] as const)
    if (config[key] !== undefined && typeof config[key] !== 'string')
      throw new AppError('CLI_CONFIG', `Invalid ${key} in ${path}`);
  if (config.protocol !== undefined && !MODEL_PROTOCOLS.includes(config.protocol))
    throw new AppError('CLI_CONFIG', `Invalid protocol in ${path}`);
  if (config.reasoning !== undefined && typeof config.reasoning !== 'boolean')
    throw new AppError('CLI_CONFIG', `Invalid reasoning in ${path}`);
  if (
    config.thinkingLevel !== undefined &&
    !['off', 'low', 'medium', 'high'].includes(config.thinkingLevel)
  )
    throw new AppError('CLI_CONFIG', `Invalid thinkingLevel in ${path}`);
  for (const key of ['maxOutputTokens', 'contextWindow'] as const)
    if (config[key] !== undefined && (!Number.isSafeInteger(config[key]) || config[key]! < 1))
      throw new AppError('CLI_CONFIG', `Invalid ${key} in ${path}`);
  return config;
}

export async function loadConfig(
  options: CliOptions,
  env: NodeJS.ProcessEnv = process.env,
): Promise<{ mode: Mode; model: ModelConfig }> {
  const user = await configFile(join(options.stateDir, 'config.json'));
  const project = options.trustProject
    ? await configFile(join(options.cwd, '.mypi', 'config.json'), true)
    : {};
  const merged = { ...user, ...project };
  const providerType =
    options.provider ?? env.MYPI_PROVIDER ?? merged.provider ?? 'openai-compatible';
  // Provider overrides must not carry another service's model, endpoint, budgets or private key.
  const config = {
    ...(!user.provider || user.provider === providerType ? user : {}),
    ...(!project.provider || project.provider === providerType ? project : {}),
  };
  const provider = getProviderPreset(providerType);
  const modelId = options.model ?? env.MYPI_MODEL ?? config.model ?? provider?.defaultModelId ?? '';
  const preset = getModelPreset(providerType, modelId);
  const endpointId =
    options.endpoint ?? env.MYPI_ENDPOINT ?? config.endpoint ?? provider?.defaultEndpointId;
  const endpoint = endpointId ? approvedModelEndpoints[endpointId] : undefined;
  if (endpointId && (!endpoint || endpoint.providerType !== providerType))
    throw new AppError('CLI_CONFIG', 'Endpoint does not match the provider');
  const contextWindow = config.contextWindow ?? preset?.defaultContextWindow ?? 32768;
  const maxOutputTokens = config.maxOutputTokens ?? preset?.defaultOutputTokens ?? 4096;
  const error = modelLimitError(providerType, modelId, contextWindow, maxOutputTokens);
  if (error) throw new AppError('CLI_CONFIG', error);
  const reasoning = config.reasoning ?? preset?.reasoning ?? false;
  const thinkingLevel = config.thinkingLevel ?? preset?.thinkingLevel ?? 'off';
  if (
    (!reasoning && thinkingLevel !== 'off') ||
    (preset && (reasoning !== preset.reasoning || !preset.thinkingLevels.includes(thinkingLevel)))
  )
    throw new AppError('CLI_CONFIG', 'Invalid thinking settings for the selected model');
  return {
    mode: options.mode ?? merged.mode ?? 'explicit',
    model: {
      id: 'cli-model',
      displayName: preset?.name ?? (modelId || 'Unconfigured model'),
      providerType,
      modelId,
      apiKey:
        env.MYPI_API_KEY ??
        (provider ? env[provider.apiKeyEnv] : undefined) ??
        (!user.provider || user.provider === providerType ? user.apiKey : undefined),
      baseUrl: options.baseUrl ?? env.MYPI_BASE_URL ?? config.baseUrl ?? endpoint?.baseUrl,
      protocol: config.protocol ?? preset?.protocol ?? provider?.protocol,
      reasoning,
      thinkingLevel,
      maxOutputTokens,
      contextWindow,
      configVersion: 1,
    },
  };
}
