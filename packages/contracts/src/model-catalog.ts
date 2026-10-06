/** Curated text/tool-call API presets. No credentials or SDK dependencies.
 * Limits are a dated documentation snapshot, not an account availability check.
 * null means the service documentation did not establish a separate hard limit.
 */
export const MODEL_CATALOG_VERIFIED_AT = '2026-10-06';
export const MODEL_PROTOCOLS = [
  'openai-completions',
  'openai-responses',
  'anthropic-messages',
  'google-generative-ai',
] as const;
export type ModelProtocol = (typeof MODEL_PROTOCOLS)[number];
export type ModelThinkingLevel = 'off' | 'low' | 'medium' | 'high';
export const MODEL_CONFIG_LIMITS = { contextWindow: 2_000_000, maxOutputTokens: 524_288 };

export interface ModelPreset {
  id: string;
  name: string;
  contextWindow: number | null;
  maxInputTokens?: number;
  maxOutputTokens: number | null;
  defaultContextWindow: number;
  defaultOutputTokens: number;
  reasoning: boolean;
  thinkingLevel: ModelThinkingLevel;
  thinkingLevels: ModelThinkingLevel[];
  protocol?: ModelProtocol;
  preview?: boolean;
  notes?: string;
  sources: string[];
}
export interface ProviderEndpoint {
  id: string;
  name: string;
  baseUrl: string;
  protocols?: ModelProtocol[];
}
export interface ProviderPreset {
  id: string;
  name: string;
  region: 'domestic' | 'international' | 'custom';
  protocol: ModelProtocol;
  apiKeyEnv: string;
  defaultEndpointId: string;
  defaultModelId: string;
  endpoints: ProviderEndpoint[];
  models: ModelPreset[];
  sources: string[];
  notes?: string;
}

function model(
  id: string,
  name: string,
  contextWindow: number | null,
  maxOutputTokens: number | null,
  source: string,
  extra: Partial<ModelPreset> = {},
): ModelPreset {
  return {
    id,
    name,
    contextWindow,
    maxOutputTokens,
    defaultContextWindow: contextWindow ?? 32768,
    defaultOutputTokens: 8192,
    reasoning: true,
    thinkingLevel: 'low',
    thinkingLevels:
      extra.thinkingLevel === 'off' ? ['off', 'low', 'medium', 'high'] : ['low', 'medium', 'high'],
    sources: [source],
    ...extra,
  };
}
function provider(
  id: string,
  name: string,
  region: ProviderPreset['region'],
  protocol: ModelProtocol,
  apiKeyEnv: string,
  baseUrl: string,
  source: string,
  models: ModelPreset[],
  extra: Partial<ProviderPreset> = {},
): ProviderPreset {
  return {
    id,
    name,
    region,
    protocol,
    apiKeyEnv,
    defaultEndpointId: id,
    defaultModelId: models[0].id,
    endpoints: [{ id, name: '默认服务端点', baseUrl }],
    sources: [source],
    models,
    ...extra,
  };
}
const deepseekDocs = 'https://api-docs.deepseek.com/quick_start/pricing';
const qwenDocs = 'https://help.aliyun.com/zh/model-studio/text-generation-model';
const kimiDocs = 'https://platform.kimi.com/docs/models';
const minimaxDocs = 'https://platform.minimax.io/docs/api-reference/text-anthropic-api';
const arkDocs = 'https://docs.volcengine.com/docs/82379/1553576?lang=zh';
const tencentDocs = 'https://cloud.tencent.com/document/product/1823/132252';
const siliconDocs = 'https://docs.siliconflow.cn/docs/api/chat-completions-post';
const claudeDocs = 'https://platform.claude.com/docs/en/models/overview';
const groqDocs = 'https://console.groq.com/docs/models';
const routerDocs = 'https://openrouter.ai/api/v1/models';
const codingPlanDocs =
  'https://docs.volcengine.com/docs/ark/coding-plan-personal-plan-overview?lang=zh';
const agentPlanDocs = 'https://docs.volcengine.com/docs/ark/agent-plan-enterprise-opencode?lang=zh';

function arkPlan(kind: 'agent' | 'coding'): ProviderPreset {
  const id = `volcengine-${kind}-plan`;
  const path = kind === 'agent' ? 'plan' : 'coding';
  const source = kind === 'agent' ? agentPlanDocs : codingPlanDocs;
  const models = [
    model('ark-code-latest', '控制台所选模型 · ark-code-latest', null, null, source, {
      thinkingLevels: ['low'],
      notes:
        '此别名跟随方舟控制台选定的模型或 Auto 路由；上下文和输出上限随目标变化。默认窗口 32768、输出 8192 是保守预算，请按实际模型调整。',
    }),
    ...(
      [
        ['doubao-seed-evolving', 'Doubao Seed Evolving', 1048576, 262144],
        ['doubao-seed-2.1-pro', 'Doubao Seed 2.1 Pro', 1048576, 262144],
        ['doubao-seed-2.1-lite', 'Doubao Seed 2.1 Lite', 1048576, 262144],
        ['doubao-seed-2.0-mini', 'Doubao Seed 2.0 Mini', 262144, 131072],
        ['minimax-m3', 'MiniMax M3', 1048576, 131072],
        ['glm-5.3', 'GLM 5.3', 1048576, 131072],
        ['glm-5.3-flash', 'GLM 5.3 Flash', 1048576, 131072],
        ['deepseek-v4.1-flash', 'DeepSeek V4.1 Flash', 1048576, 393216],
        ['deepseek-v4-flash', 'DeepSeek V4 Flash', 1048576, 393216],
        ['deepseek-v4-pro', 'DeepSeek V4 Pro', 1048576, 393216],
        ['kimi-k2.7-code', 'Kimi K2.7 Code', 262144, 32768],
        ['kimi-k2.8-preview', 'Kimi K2.8 Preview', 1048576, 1048576],
        ['kimi-k3', 'Kimi K3', 1048576, 131072],
      ] as const
    ).map(([modelId, name, context, output]) =>
      model(
        modelId,
        name,
        kind === 'agent' ? null : context,
        kind === 'agent' ? null : output,
        source,
        {
          // Agent Plan's integration snippets are configuration examples, not hard-limit specifications.
          ...(kind === 'agent'
            ? { defaultContextWindow: context === 1048576 ? 1024000 : 256000 }
            : {}),
          thinkingLevels: ['low'],
          preview: modelId.includes('preview'),
          notes:
            kind === 'agent'
              ? '窗口预算参考 Agent Plan 官方接入示例，不将示例参数标为硬上限；实际规格以账号套餐为准。使用套餐 Model Name，思考采用默认档位。'
              : '使用套餐 Model Name，不使用按量计费的日期版本 ID；可用性取决于套餐。思考由模型默认档位控制。',
        },
      ),
    ),
  ];
  return provider(
    id,
    `火山引擎 · ${kind === 'agent' ? 'Agent' : 'Coding'} Plan`,
    'domestic',
    'openai-completions',
    kind === 'agent' ? 'ARK_AGENT_PLAN_API_KEY' : 'ARK_CODING_PLAN_API_KEY',
    `https://ark.cn-beijing.volces.com/api/${path}/v3`,
    source,
    models,
    {
      endpoints: [
        {
          id,
          name: '北京 · OpenAI 兼容',
          baseUrl: `https://ark.cn-beijing.volces.com/api/${path}/v3`,
          protocols: ['openai-completions', 'openai-responses'],
        },
        {
          id: `${id}-anthropic`,
          name: '北京 · Anthropic 兼容',
          baseUrl: `https://ark.cn-beijing.volces.com/api/${path}`,
          protocols: ['anthropic-messages'],
        },
      ],
      notes:
        kind === 'agent'
          ? '使用 Agent Plan 专属 API Key，不能与 Coding Plan 或按量计费密钥混用。模型范围以账号套餐为准。'
          : '使用 Coding Plan 对应密钥及订阅额度，仅用于套餐允许的 AI 编程工具场景。普通 /api/v3 地址会按量计费。',
    },
  );
}

/** Generic services have no invented model IDs, official sources or endpoints. */
export const customProviderPreset: ProviderPreset = {
  id: 'custom',
  name: '自定义模型服务',
  region: 'custom',
  protocol: 'openai-completions',
  apiKeyEnv: 'MYPI_API_KEY',
  defaultEndpointId: 'custom',
  defaultModelId: '',
  endpoints: [],
  models: [],
  sources: [],
  notes:
    '填写服务商提供的 HTTPS Base URL、模型 ID 和匹配协议；上下文和输出预算请按该服务的实际规格设置。',
};

export const providerPresets: ProviderPreset[] = [
  provider(
    'deepseek',
    'DeepSeek',
    'domestic',
    'openai-completions',
    'DEEPSEEK_API_KEY',
    'https://api.deepseek.com',
    deepseekDocs,
    [
      model('deepseek-flash', 'DeepSeek V4.1 Flash', 1048576, 393216, deepseekDocs),
      model('deepseek-v4-pro', 'DeepSeek V4 Pro', 1048576, 393216, deepseekDocs),
    ],
    { notes: '使用官方通用 API Key。输出预算包含思考内容；别名版本会随服务商更新。' },
  ),
  provider(
    'dashscope',
    '阿里云百炼 · 通义千问',
    'domestic',
    'openai-completions',
    'DASHSCOPE_API_KEY',
    'https://dashscope.aliyuncs.com/compatible-mode/v1',
    qwenDocs,
    [
      model(
        'qwen3.8-flash',
        'Qwen 3.8 Flash',
        1000000,
        131072,
        'https://help.aliyun.com/zh/model-studio/qwen3-8-flash',
        { maxInputTokens: 983616, thinkingLevel: 'off', thinkingLevels: ['off', 'low'] },
      ),
      model(
        'qwen3.8-max',
        'Qwen 3.8 Max',
        1000000,
        131072,
        'https://help.aliyun.com/zh/model-studio/qwen3-8-max',
        { maxInputTokens: 983616, thinkingLevel: 'off', thinkingLevels: ['off', 'low'] },
      ),
    ],
    {
      endpoints: [
        {
          id: 'dashscope',
          name: '中国内地 · 北京',
          baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
        },
        {
          id: 'dashscope-intl',
          name: '国际 · 新加坡',
          baseUrl: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1',
        },
      ],
      notes: '地域与 API Key 必须匹配。这里是按量付费通用 API，Coding Plan 专属密钥不适用。',
    },
  ),
  provider(
    'moonshot',
    'Moonshot · Kimi',
    'domestic',
    'openai-completions',
    'MOONSHOT_API_KEY',
    'https://api.moonshot.cn/v1',
    'https://platform.kimi.com/docs/get-api-key',
    [
      model(
        'kimi-k3',
        'Kimi K3',
        1000000,
        1048576,
        'https://platform.kimi.com/docs/guide/kimi-k3-quickstart',
        {
          thinkingLevels: ['low', 'high'],
          notes:
            '始终开启思考；使用 max_completion_tokens 限制思考与回答总量。实际输出还受剩余窗口和 MyPI 上限约束。',
        },
      ),
      model('kimi-k2.7-code', 'Kimi K2.7 Code', 262144, null, kimiDocs, {
        thinkingLevels: ['low'],
        notes: '必须开启思考；官方 max_tokens 默认 32768，不将默认值当作输出上限。',
      }),
      model('kimi-k2.7-code-highspeed', 'Kimi K2.7 Code Highspeed', 262144, null, kimiDocs, {
        thinkingLevels: ['low'],
      }),
    ],
    { notes: 'Kimi K2.5、K2 和 moonshot-v1 已下线；未明确公布的独立输出上限显示为未知。' },
  ),
  provider(
    'zhipu',
    '智谱 · GLM',
    'domestic',
    'openai-completions',
    'ZHIPU_API_KEY',
    'https://open.bigmodel.cn/api/paas/v4',
    'https://docs.bigmodel.cn/cn/api/introduction',
    [
      model(
        'glm-5.3',
        'GLM 5.3',
        1048576,
        131072,
        'https://docs.bigmodel.cn/cn/guide/models/text/glm-5.3',
        { thinkingLevels: ['low', 'high'], notes: '始终开启思考；预设使用 low 强度。' },
      ),
    ],
    { notes: '使用通用按量 API Key；GLM Coding Plan 使用不同的专属端点。' },
  ),
  provider(
    'minimax',
    'MiniMax',
    'domestic',
    'anthropic-messages',
    'MINIMAX_API_KEY',
    'https://api.minimax.cn/anthropic',
    minimaxDocs,
    [
      model('MiniMax-M3', 'MiniMax M3', 1000000, null, minimaxDocs, {
        thinkingLevels: ['off', 'low'],
      }),
      model('MiniMax-M2.7', 'MiniMax M2.7', 204800, null, minimaxDocs, { thinkingLevels: ['low'] }),
      model('MiniMax-M2.7-highspeed', 'MiniMax M2.7 Highspeed', 204800, null, minimaxDocs, {
        thinkingLevels: ['low'],
      }),
    ],
    {
      endpoints: [
        { id: 'minimax', name: '中国内地', baseUrl: 'https://api.minimax.cn/anthropic' },
        { id: 'minimax-intl', name: '国际', baseUrl: 'https://api.minimax.io/anthropic' },
      ],
      sources: [minimaxDocs, 'https://platform.minimax.cn/docs/api-reference/text-anthropic-api'],
      notes:
        '使用 Anthropic 兼容协议保留思考与工具调用内容。M3.1 Flash Preview 暂限专属套餐，未列入通用预设。',
    },
  ),
  provider(
    'volcengine',
    '火山方舟 · 豆包',
    'domestic',
    'openai-completions',
    'ARK_API_KEY',
    'https://ark.cn-beijing.volces.com/api/v3',
    'https://docs.volcengine.com/docs/ark/chat-api?lang=zh',
    [
      model('doubao-seed-2-1-pro-260915', 'Doubao Seed 2.1 Pro', 1048576, 262144, arkDocs, {
        thinkingLevel: 'off',
        thinkingLevels: ['off', 'low'],
      }),
      model('doubao-seed-2-1-lite-260915', 'Doubao Seed 2.1 Lite', 1048576, null, arkDocs, {
        thinkingLevel: 'off',
        thinkingLevels: ['off', 'low'],
      }),
    ],
    { notes: '需在方舟开通模型。专属部署可手动填写 ep- 接入点 ID，并按该部署填写限制。' },
  ),
  arkPlan('agent'),
  arkPlan('coding'),
  provider(
    'baidu',
    '百度千帆 · 文心',
    'domestic',
    'openai-completions',
    'QIANFAN_API_KEY',
    'https://qianfan.baidubce.com/v2',
    'https://cloud.baidu.com/doc/qianfan-api/s/Dmba8k71y',
    [
      model(
        'ernie-5.0',
        'ERNIE 5.0',
        248832,
        65536,
        'https://cloud.baidu.com/doc/qianfan-api/s/Dmba8k71y',
        {
          maxInputTokens: 121856,
          defaultContextWindow: 121856,
          thinkingLevel: 'off',
          thinkingLevels: ['off', 'low'],
          notes:
            '国内 v2 目录的总窗口为 248832，输入上限 121856；默认采用输入上限作保守窗口预算。回答上限 65536，思考加回答上限 126976。',
        },
      ),
    ],
    { notes: '使用千帆 v2 API Key；输入、输出与思考共享服务限制，以账号实际模型规格为准。' },
  ),
  provider(
    'tencent',
    '腾讯 TokenHub · 混元',
    'domestic',
    'openai-completions',
    'TOKENHUB_API_KEY',
    'https://tokenhub.tencentmaas.com/v1',
    tencentDocs,
    [
      model('hy3', '腾讯混元 Hy3', 262144, 131072, tencentDocs, {
        maxInputTokens: 196608,
        defaultContextWindow: 196608,
        thinkingLevels: ['off', 'low'],
      }),
      model('hy4-preview', '腾讯混元 Hy4 Preview', 1048576, 65536, tencentDocs, {
        maxInputTokens: 983040,
        defaultContextWindow: 983040,
        preview: true,
        thinkingLevels: ['off', 'low'],
      }),
    ],
    { notes: '旧混元平台已于 2026-09-30 停服。请使用 TokenHub 的新 API Key。' },
  ),
  provider(
    'siliconflow',
    '硅基流动 · SiliconFlow',
    'domestic',
    'openai-completions',
    'SILICONFLOW_API_KEY',
    'https://api.siliconflow.cn/v1',
    siliconDocs,
    [
      model(
        'deepseek-ai/DeepSeek-V4-Flash',
        'DeepSeek V4 Flash · SiliconFlow',
        null,
        null,
        siliconDocs,
        {
          thinkingLevel: 'off',
          thinkingLevels: ['off', 'low'],
          notes: '官方接口页未列部署上限；默认采用 32768 上下文预算，请按模型广场确认后调整。',
        },
      ),
    ],
    { notes: '聚合部署的窗口可能不同于原厂。未知限制不从原厂或其他平台推算。' },
  ),
  provider(
    'openai',
    'OpenAI',
    'international',
    'openai-responses',
    'OPENAI_API_KEY',
    'https://api.openai.com/v1',
    'https://developers.openai.com/api/docs/models',
    [
      model(
        'gpt-6.1-sol',
        'GPT 6.1 Sol',
        1050000,
        128000,
        'https://developers.openai.com/api/docs/models/gpt-6.1-sol',
      ),
      model(
        'gpt-6-astra',
        'GPT 6 Astra',
        1050000,
        128000,
        'https://developers.openai.com/api/docs/models/gpt-6-astra',
      ),
      model(
        'gpt-6-luna',
        'GPT 6 Luna',
        1050000,
        128000,
        'https://developers.openai.com/api/docs/models/gpt-6-luna',
      ),
    ],
    { notes: '新预设使用 Responses API。模型权限取决于 API 账号，ChatGPT 订阅不等于 API 额度。' },
  ),
  provider(
    'anthropic',
    'Anthropic · Claude',
    'international',
    'anthropic-messages',
    'ANTHROPIC_API_KEY',
    'https://api.anthropic.com',
    claudeDocs,
    [
      model('claude-sonnet-5-5', 'Claude Sonnet 5.5', 1000000, 128000, claudeDocs),
      model('claude-opus-5-5', 'Claude Opus 5.5', 1000000, 128000, claudeDocs),
      model('claude-fable-5-1', 'Claude Fable 5.1', 1000000, 128000, claudeDocs),
      model('claude-haiku-4-5-20251001', 'Claude Haiku 4.5', 200000, 64000, claudeDocs, {
        thinkingLevel: 'off',
      }),
    ],
  ),
  provider(
    'google',
    'Google · Gemini',
    'international',
    'google-generative-ai',
    'GEMINI_API_KEY',
    'https://generativelanguage.googleapis.com/v1beta',
    'https://ai.google.dev/gemini-api/docs/models',
    [
      model(
        'gemini-3.8-flash',
        'Gemini 3.8 Flash',
        1048576,
        65536,
        'https://ai.google.dev/gemini-api/docs/models/gemini-3.8-flash',
        { maxInputTokens: 1048576 },
      ),
      model(
        'gemini-3.5-flash-lite',
        'Gemini 3.5 Flash-Lite',
        1048576,
        65536,
        'https://ai.google.dev/gemini-api/docs/models/gemini-3.5-flash-lite',
        { maxInputTokens: 1048576 },
      ),
    ],
    {
      notes:
        '这里是 Gemini Developer API。官方标注的是输入上限；MyPI 用同一数值作保守的总窗口预算。',
    },
  ),
  provider(
    'xai',
    'xAI · Grok',
    'international',
    'openai-responses',
    'XAI_API_KEY',
    'https://api.x.ai/v1',
    'https://docs.x.ai/developers/quickstart',
    [model('grok-4.7', 'Grok 4.7', 500000, null, 'https://docs.x.ai/developers/models/grok-4.7')],
    { notes: '使用 Responses API；只授权 MyPI 本轮工具，不启用供应商托管搜索或执行工具。' },
  ),
  provider(
    'mistral',
    'Mistral AI',
    'international',
    'openai-completions',
    'MISTRAL_API_KEY',
    'https://api.mistral.ai/v1',
    'https://docs.mistral.ai/api/endpoint/chat',
    [
      model(
        'mistral-medium-3-5',
        'Mistral Medium 3.5',
        262144,
        null,
        'https://docs.mistral.ai/models/mistral-medium-3-5-26-04',
        {
          thinkingLevel: 'off',
          thinkingLevels: ['off'],
          notes: '当前适配使用 reasoning_effort=none；SDK 尚不支持 Mistral 的分块思考响应。',
        },
      ),
      model(
        'mistral-large-2512',
        'Mistral Large 3',
        262144,
        null,
        'https://docs.mistral.ai/models/mistral-large-3-25-12',
        { reasoning: false, thinkingLevel: 'off', thinkingLevels: ['off'] },
      ),
    ],
    { notes: '官方仅明确总窗口，输入与输出合计受此窗口约束。' },
  ),
  provider(
    'groq',
    'Groq',
    'international',
    'openai-completions',
    'GROQ_API_KEY',
    'https://api.groq.com/openai/v1',
    'https://console.groq.com/docs/openai',
    [
      model('openai/gpt-oss-120b', 'GPT OSS 120B · Groq', 131072, 65536, groqDocs),
      model('openai/gpt-oss-20b', 'GPT OSS 20B · Groq', 131072, 65536, groqDocs),
    ],
  ),
  provider(
    'openrouter',
    'OpenRouter',
    'international',
    'openai-completions',
    'OPENROUTER_API_KEY',
    'https://openrouter.ai/api/v1',
    'https://openrouter.ai/docs/quickstart',
    [
      model('openai/gpt-6.1-sol', 'GPT 6.1 Sol · OpenRouter', 1050000, 128000, routerDocs),
      model(
        'anthropic/claude-sonnet-5.5',
        'Claude Sonnet 5.5 · OpenRouter',
        1000000,
        128000,
        routerDocs,
      ),
    ],
    { notes: '聚合模型目录是核对日快照；路由提供商、实际可用性与价格由 OpenRouter 决定。' },
  ),
];

export const getProviderPreset = (id: string) =>
  id === 'custom' ? customProviderPreset : providerPresets.find((item) => item.id === id);
export const getModelPreset = (providerId: string, modelId: string) =>
  getProviderPreset(providerId)?.models.find((item) => item.id === modelId);
export const approvedModelEndpoints: Record<string, ProviderEndpoint & { providerType: string }> =
  Object.fromEntries(
    providerPresets.flatMap((item) =>
      item.endpoints.map((endpoint) => [endpoint.id, { ...endpoint, providerType: item.id }]),
    ),
  );

export const CUSTOM_MODEL_PROTOCOLS: ModelProtocol[] = [
  'openai-completions',
  'openai-responses',
  'anthropic-messages',
];
export function modelEndpointProtocols(providerId: string, endpointId: string): ModelProtocol[] {
  if (endpointId === 'custom') return providerId === 'google' ? [] : CUSTOM_MODEL_PROTOCOLS;
  const endpoint = approvedModelEndpoints[endpointId];
  if (!endpoint || endpoint.providerType !== providerId) return [];
  return (
    endpoint.protocols ??
    (providerId === 'openai'
      ? ['openai-responses', 'openai-completions']
      : [getProviderPreset(providerId)!.protocol])
  );
}

/** Returns an error for invalid application budgets, without claiming unknown official limits. */
export function modelLimitError(
  providerId: string,
  modelId: string,
  context: number,
  output: number,
): string | undefined {
  if (
    !Number.isSafeInteger(context) ||
    context < 1024 ||
    context > MODEL_CONFIG_LIMITS.contextWindow
  )
    return '上下文窗口必须是 1024 至 2000000 之间的整数';
  if (
    !Number.isSafeInteger(output) ||
    output < 16 ||
    output > MODEL_CONFIG_LIMITS.maxOutputTokens ||
    output > context
  )
    return '最大输出必须是至少 16 的整数，且不能超过上下文窗口或应用上限';
  const preset = getModelPreset(providerId, modelId);
  if (preset?.contextWindow && context > preset.contextWindow)
    return `上下文窗口不能超过已核对的官方上限 ${preset.contextWindow}`;
  if (preset?.maxOutputTokens && output > preset.maxOutputTokens)
    return `最大输出不能超过已核对的官方上限 ${preset.maxOutputTokens}`;
}
