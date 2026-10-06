# 模型服务与默认配置

核对日期：**2026-10-06**。本目录覆盖 16 家服务商、18 个官方端点、33 个适合文字与工具调用的主要模型。它是可审阅的官方文档快照，账号实际开通范围仍以服务商和连接测试为准。未穷举所有历史模型、微调部署、嵌入、音视频或图像生成模型；Azure OpenAI、AWS Bedrock、Vertex AI 的云身份认证不在本轮 API Key 适配范围内。

## 使用方式

后台进入“模型管理 → 添加模型”，依次选择服务商、地域、官方模型预设，填写密钥并保存。先连接测试，再启用、允许游客选择及设置游客默认。草稿默认停用且不公开；不自动创建账户、填入密钥或修改旧模型。编辑已有模型保留自定义预算，“恢复预设参数”才重置参数。切换服务商或地域会清空未保存的密钥；已有密钥的配置切换端点时必须重新提供匹配凭据。

CLI 可直接使用服务商密钥环境变量与默认模型：

```powershell
# 密钥应事先配置在本机环境或忽略的 .env 中。
pnpm cli models --provider deepseek --json
pnpm cli doctor --provider deepseek
pnpm cli run "解释这个项目" --provider deepseek --cwd ./your-project
pnpm cli models --provider dashscope --json
pnpm cli doctor --provider dashscope --endpoint dashscope-intl
```

私有 `~/.mypi/config.json` 的最小配置为 `{"provider":"deepseek"}`。可增加 `model`、`endpoint`、`maxOutputTokens`、`contextWindow`、`protocol`、`reasoning`、`thinkingLevel`。参数优先级仍为 CLI 参数、环境、已显式信任的项目配置、私有配置、目录默认值；密钥优先级为 `MYPI_API_KEY`、服务商密钥环境变量、私有配置，项目配置禁止密钥。显式切换服务商时，不继承其他服务商的私有密钥和模型设置。`mypi models` 只输出公开目录，无需连接服务商或读取密钥。Web 仅接受白名单端点；可信 CLI 保留显式 `--base-url`。

管理员 API `GET /api/v1/admin/models` 返回已有配置及 `catalog.verifiedAt/providers`。经过登录和 CSRF 校验后，`POST /api/v1/admin/models` 可仅提交 `{"providerType":"deepseek","reason":"添加官方默认配置"}` 创建草稿；其余字段由同一目录补齐。模型/端点/协议/思考模式/Token 预算变化会使旧连接测试失效。

## 数值含义

- `contextWindow` / `maxInputTokens` / `maxOutputTokens` 是文档规格；未找到明确独立上限时用 `null`（界面“未知”），不是零或无限。聚合服务不会套用原厂的窗口。
- MyPI 的 `defaultOutputTokens` 统一为 **8192**，是本应用单次调用预算，不宣称是官方默认值或输出上限。上下文默认采用已核对窗口；未知时为 **32768**。百度和腾讯默认采用更小的输入上限。预算可调低。
- 本应用上下文预算范围为 1024–2000000；输出预算为 16–524288，并受已知官方上限和上下文预算共同约束。Kimi K3 官方输出参数上限大于 MyPI 上限，不能直接用作本应用默认预算。还需为输入、工具描述、历史和思考预留空间。
- Google 官方给出输入/输出两个上限；本目录用输入上限作保守总窗口预算，不将两者相加。百度国内 v2 的总窗口与国际版资料口径不同，使用国内模型目录，同时单列输入上限。
- `low/medium/high` 只在适配支持相应强度时显示；仅支持开关的服务显示“开启思考（模型默认）”。当前 Mistral Medium 3.5 仅使用 `reasoning_effort=none`，不启用其特殊分块思考输出。
- 价格随地区、缓存、输入长度和路由变化，本轮不填固定单价。未配置价格时费用保持未知；只有输入、输出价格、币种与版本完整时才估算费用。

## 协议差异

OpenAI 与 xAI 新预设使用 Responses；Anthropic 和 MiniMax 使用 Messages；Google 使用 Gemini Developer API；其余使用带服务商兼容设置的 Chat Completions。保留旧 OpenAI 已存配置的 Chat Completions 行为。

适配负责正确的版本路径、输出参数、流式用量、思考开关与工具消息续传。Kimi K3 使用 `max_completion_tokens`；DeepSeek/Kimi/GLM/腾讯保留工具轮次的 `reasoning_content`；MiniMax 不发送仅适用于 Claude 的显示/强度字段。工具仍只来自 MyPI 本轮授权，不开启供应商托管搜索或代码执行。相关官方说明：[Kimi K3](https://platform.kimi.com/docs/guide/kimi-k3-quickstart)、[DeepSeek 思考与工具调用](https://api-docs.deepseek.com/guides/thinking_mode/)、[MiniMax Messages](https://platform.minimax.io/docs/api-reference/text-anthropic-api)、[TokenHub 协议](https://cloud.tencent.com/document/product/1823/135872)、[Mistral 思考模式](https://docs.mistral.ai/studio/conversations/reasoning)。

腾讯旧混元平台于 2026-09-30 停服，本目录使用 TokenHub 新端点及密钥；见[迁移公告](https://cloud.tencent.com/document/product/1729/131925)。MiniMax 国内端点采用[当前国内官方说明](https://platform.minimax.cn/docs/api-reference/text-anthropic-api)的 `api.minimax.cn`。阿里云北京/新加坡及 MiniMax 国内/国际的密钥和账户范围分别匹配；Coding Plan 专用端点不等同于本目录的通用按量服务。火山方舟可手动填入已部署的 `ep-` 标识及对应限制。

## 验证与维护

目录在 `packages/contracts/src/model-catalog.ts`，不依赖 SDK、不含密钥。所有 Pi SDK 代码位于 `packages/pi-adapter`。更新目录时同步核对模型 ID、地域、端点、规格和来源，再运行 `pnpm format`、`pnpm verify` 与模型管理浏览器测试。

本轮通过本地回环 HTTP 驱动真实 Pi SDK 验证四种协议和全部服务商默认请求，并测试思考工具调用的后续请求、预算、管理权限、密钥边界及桌面/移动表单。没有调用付费模型 API，也不宣称真实账号连通或模型质量验证。连接测试会发起有预算限制的真实请求；思考模型测试最多 2048 输出 Token，其他模型最多 32，并受配置上限约束；空回复和服务商错误均显示失败。

以下表格来自该目录；数字单位均为 Token。每行的来源链接可用于核对。

## 服务商端点

| 服务商 ID | 默认模型 | API Key 环境变量 | 端点（地域 ID） |
|---|---|---|---|
| [deepseek](https://api-docs.deepseek.com/quick_start/pricing) | `deepseek-flash` | `DEEPSEEK_API_KEY` | `https://api.deepseek.com`（deepseek） |
| [dashscope](https://help.aliyun.com/zh/model-studio/text-generation-model) | `qwen3.8-flash` | `DASHSCOPE_API_KEY` | `https://dashscope.aliyuncs.com/compatible-mode/v1`（dashscope）<br>`https://dashscope-intl.aliyuncs.com/compatible-mode/v1`（dashscope-intl） |
| [moonshot](https://platform.kimi.com/docs/get-api-key) | `kimi-k3` | `MOONSHOT_API_KEY` | `https://api.moonshot.cn/v1`（moonshot） |
| [zhipu](https://docs.bigmodel.cn/cn/api/introduction) | `glm-5.3` | `ZHIPU_API_KEY` | `https://open.bigmodel.cn/api/paas/v4`（zhipu） |
| [minimax](https://platform.minimax.io/docs/api-reference/text-anthropic-api) | `MiniMax-M3` | `MINIMAX_API_KEY` | `https://api.minimax.cn/anthropic`（minimax）<br>`https://api.minimax.io/anthropic`（minimax-intl） |
| [volcengine](https://docs.volcengine.com/docs/ark/chat-api?lang=zh) | `doubao-seed-2-1-pro-260915` | `ARK_API_KEY` | `https://ark.cn-beijing.volces.com/api/v3`（volcengine） |
| [baidu](https://cloud.baidu.com/doc/qianfan-api/s/Dmba8k71y) | `ernie-5.0` | `QIANFAN_API_KEY` | `https://qianfan.baidubce.com/v2`（baidu） |
| [tencent](https://cloud.tencent.com/document/product/1823/132252) | `hy3` | `TOKENHUB_API_KEY` | `https://tokenhub.tencentmaas.com/v1`（tencent） |
| [siliconflow](https://docs.siliconflow.cn/docs/api/chat-completions-post) | `deepseek-ai/DeepSeek-V4-Flash` | `SILICONFLOW_API_KEY` | `https://api.siliconflow.cn/v1`（siliconflow） |
| [openai](https://developers.openai.com/api/docs/models) | `gpt-6.1-sol` | `OPENAI_API_KEY` | `https://api.openai.com/v1`（openai） |
| [anthropic](https://platform.claude.com/docs/en/models/overview) | `claude-sonnet-5-5` | `ANTHROPIC_API_KEY` | `https://api.anthropic.com`（anthropic） |
| [google](https://ai.google.dev/gemini-api/docs/models) | `gemini-3.8-flash` | `GEMINI_API_KEY` | `https://generativelanguage.googleapis.com/v1beta`（google） |
| [xai](https://docs.x.ai/developers/quickstart) | `grok-4.7` | `XAI_API_KEY` | `https://api.x.ai/v1`（xai） |
| [mistral](https://docs.mistral.ai/api/endpoint/chat) | `mistral-medium-3-5` | `MISTRAL_API_KEY` | `https://api.mistral.ai/v1`（mistral） |
| [groq](https://console.groq.com/docs/openai) | `openai/gpt-oss-120b` | `GROQ_API_KEY` | `https://api.groq.com/openai/v1`（groq） |
| [openrouter](https://openrouter.ai/docs/quickstart) | `openai/gpt-6.1-sol` | `OPENROUTER_API_KEY` | `https://openrouter.ai/api/v1`（openrouter） |

## 官方模型规格与 MyPI 默认预算

| 服务商 | 模型 ID / 官方来源 | 官方窗口 | 独立输入上限 | 官方输出上限 | 默认上下文 / 输出预算 |
|---|---|---:|---:|---:|---:|
| deepseek | [deepseek-flash](https://api-docs.deepseek.com/quick_start/pricing) | 1,048,576 | 未单列 | 393,216 | 1,048,576 / 8,192 |
| deepseek | [deepseek-v4-pro](https://api-docs.deepseek.com/quick_start/pricing) | 1,048,576 | 未单列 | 393,216 | 1,048,576 / 8,192 |
| dashscope | [qwen3.8-flash](https://help.aliyun.com/zh/model-studio/qwen3-8-flash) | 1,000,000 | 983,616 | 131,072 | 1,000,000 / 8,192 |
| dashscope | [qwen3.8-max](https://help.aliyun.com/zh/model-studio/qwen3-8-max) | 1,000,000 | 983,616 | 131,072 | 1,000,000 / 8,192 |
| moonshot | [kimi-k3](https://platform.kimi.com/docs/guide/kimi-k3-quickstart) | 1,000,000 | 未单列 | 1,048,576 | 1,000,000 / 8,192 |
| moonshot | [kimi-k2.7-code](https://platform.kimi.com/docs/models) | 262,144 | 未单列 | 未知 | 262,144 / 8,192 |
| moonshot | [kimi-k2.7-code-highspeed](https://platform.kimi.com/docs/models) | 262,144 | 未单列 | 未知 | 262,144 / 8,192 |
| zhipu | [glm-5.3](https://docs.bigmodel.cn/cn/guide/models/text/glm-5.3) | 1,048,576 | 未单列 | 131,072 | 1,048,576 / 8,192 |
| minimax | [MiniMax-M3](https://platform.minimax.io/docs/api-reference/text-anthropic-api) | 1,000,000 | 未单列 | 未知 | 1,000,000 / 8,192 |
| minimax | [MiniMax-M2.7](https://platform.minimax.io/docs/api-reference/text-anthropic-api) | 204,800 | 未单列 | 未知 | 204,800 / 8,192 |
| minimax | [MiniMax-M2.7-highspeed](https://platform.minimax.io/docs/api-reference/text-anthropic-api) | 204,800 | 未单列 | 未知 | 204,800 / 8,192 |
| volcengine | [doubao-seed-2-1-pro-260915](https://docs.volcengine.com/docs/82379/1553576?lang=zh) | 1,048,576 | 未单列 | 262,144 | 1,048,576 / 8,192 |
| volcengine | [doubao-seed-2-1-lite-260915](https://docs.volcengine.com/docs/82379/1553576?lang=zh) | 1,048,576 | 未单列 | 未知 | 1,048,576 / 8,192 |
| baidu | [ernie-5.0](https://cloud.baidu.com/doc/qianfan-api/s/Dmba8k71y) | 248,832 | 121,856 | 65,536 | 121,856 / 8,192 |
| tencent | [hy3](https://cloud.tencent.com/document/product/1823/132252) | 262,144 | 196,608 | 131,072 | 196,608 / 8,192 |
| tencent | [hy4-preview](https://cloud.tencent.com/document/product/1823/132252)（预览） | 1,048,576 | 983,040 | 65,536 | 983,040 / 8,192 |
| siliconflow | [deepseek-ai/DeepSeek-V4-Flash](https://docs.siliconflow.cn/docs/api/chat-completions-post) | 未知 | 未单列 | 未知 | 32,768 / 8,192 |
| openai | [gpt-6.1-sol](https://developers.openai.com/api/docs/models/gpt-6.1-sol) | 1,050,000 | 未单列 | 128,000 | 1,050,000 / 8,192 |
| openai | [gpt-6-astra](https://developers.openai.com/api/docs/models/gpt-6-astra) | 1,050,000 | 未单列 | 128,000 | 1,050,000 / 8,192 |
| openai | [gpt-6-luna](https://developers.openai.com/api/docs/models/gpt-6-luna) | 1,050,000 | 未单列 | 128,000 | 1,050,000 / 8,192 |
| anthropic | [claude-sonnet-5-5](https://platform.claude.com/docs/en/models/overview) | 1,000,000 | 未单列 | 128,000 | 1,000,000 / 8,192 |
| anthropic | [claude-opus-5-5](https://platform.claude.com/docs/en/models/overview) | 1,000,000 | 未单列 | 128,000 | 1,000,000 / 8,192 |
| anthropic | [claude-fable-5-1](https://platform.claude.com/docs/en/models/overview) | 1,000,000 | 未单列 | 128,000 | 1,000,000 / 8,192 |
| anthropic | [claude-haiku-4-5-20251001](https://platform.claude.com/docs/en/models/overview) | 200,000 | 未单列 | 64,000 | 200,000 / 8,192 |
| google | [gemini-3.8-flash](https://ai.google.dev/gemini-api/docs/models/gemini-3.8-flash) | 1,048,576 | 1,048,576 | 65,536 | 1,048,576 / 8,192 |
| google | [gemini-3.5-flash-lite](https://ai.google.dev/gemini-api/docs/models/gemini-3.5-flash-lite) | 1,048,576 | 1,048,576 | 65,536 | 1,048,576 / 8,192 |
| xai | [grok-4.7](https://docs.x.ai/developers/models/grok-4.7) | 500,000 | 未单列 | 未知 | 500,000 / 8,192 |
| mistral | [mistral-medium-3-5](https://docs.mistral.ai/models/mistral-medium-3-5-26-04) | 262,144 | 未单列 | 未知 | 262,144 / 8,192 |
| mistral | [mistral-large-2512](https://docs.mistral.ai/models/mistral-large-3-25-12) | 262,144 | 未单列 | 未知 | 262,144 / 8,192 |
| groq | [openai/gpt-oss-120b](https://console.groq.com/docs/models) | 131,072 | 未单列 | 65,536 | 131,072 / 8,192 |
| groq | [openai/gpt-oss-20b](https://console.groq.com/docs/models) | 131,072 | 未单列 | 65,536 | 131,072 / 8,192 |
| openrouter | [openai/gpt-6.1-sol](https://openrouter.ai/api/v1/models) | 1,050,000 | 未单列 | 128,000 | 1,050,000 / 8,192 |
| openrouter | [anthropic/claude-sonnet-5.5](https://openrouter.ai/api/v1/models) | 1,000,000 | 未单列 | 128,000 | 1,000,000 / 8,192 |
