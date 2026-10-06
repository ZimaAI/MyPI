# 实施与最终本地验证

## 2026-10-06：国内外模型服务预设

通过服务商官方文档核对并新增 16 家服务商、18 个端点和 33 个文字/工具调用模型。目录、完整规格和来源见 [模型服务配置](../model-providers.md)。Gateway、CLI 和管理页共享预设；新配置自动填充协议、模型、上下文/输出预算与思考模式。未知独立输出上限保持未知，既有配置的协议、预算、凭据和关闭思考状态不会因升级自动改写。

适配覆盖 OpenAI Responses、Chat Completions、Anthropic Messages 和 Gemini Developer API。为私有 SDK provider 注册显式兼容参数，补齐 Google `/v1beta`、Kimi K3 输出字段、MiniMax 国内端点与思考字段，以及 Tencent TokenHub。连接测试使用受预算限制的思考请求，空文本不能判为成功；旧配置改名不自动切换协议/思考，CLI 换服务商不继承其他服务商的私有密钥。

新增测试验证各服务商真实 SDK 的路径、鉴权、工具声明、流式结算，以及 DeepSeek/Kimi/GLM/腾讯工具轮次中思考和工具结果的续传。后台测试覆盖默认草稿、端点匹配、参数上限、凭据地域和连接测试失效；浏览器覆盖预设切换、未知规格、保留编辑、失败重试、恢复默认和移动布局。桌面 1440×900、手机 390×844 截图经实际查看，见 [桌面预设](screenshots/model-presets-desktop.png) 与 [手机预设](screenshots/model-presets-mobile.png)。

`pnpm format` 和最终 `pnpm verify` 均退出 0：格式、依赖边界、TypeScript、**82/82 自动测试**及生产构建通过；原始记录见 [模型适配验证](model-providers-verification.txt)。一次与镜像构建并发的 CLI 补测曾触发原有 20 秒进程超时，保留[该次输出](model-provider-cli-timeout.txt)；停止并发构建后，最终完整校验中的 CLI 实际执行/恢复测试通过，未放宽测试超时。

最终完整 Playwright 套件 **6/6 通过，0 failed/skipped/flaky**，见 [原始报告](playwright-results.json)。中间轮次保留[并发构建期间的工作区创建等待超时](model-provider-browser-timeout.json)和[Windows 截图写入错误](model-provider-browser-screenshot-error.json)；后者的业务断言均已通过，移开旧截图、串行重新生成后整套通过。测试断言和超时设置保持原值。

更新前已在现有容器数据卷中创建 SQLite 一致性备份 `/data/backups/before-model-presets-20261006`，保留 `.env.docker` 与 `mypi_state`。没有真实付费服务商凭据；网络请求由本地 HTTP fixture 响应，不能据此声明账号实测连通。专用主机隔离验收仍未执行，公开执行开关保持关闭。

## 2026-09-23：初始实施记录

2026-09-23，Windows x64、Node.js 24.16.0、pnpm 11.5.0。按后端先行顺序完成 SDK/CLI、Core/五组能力、SQLite/Gateway/Broker，再接 React 工作台与管理后台；新增 P1 同样先实现服务端行为再接界面。已有 Git 初始历史保留。

## 实际执行结果

| 命令 | 最终结果 |
|---|---|
| `pnpm verify` | 退出 0；依赖边界、Prettier 格式、TypeScript、74/74 自动测试、Vite 生产构建全部通过；0 fail/skip/todo。原始输出见 [verification.txt](verification.txt)。 |
| `pnpm exec playwright test` | 5/5 通过，0 failed/skipped/flaky；本轮开始时间 `2026-09-23T03:15:43.512Z`。见 [原始报告](playwright-results.json)。 |
| `node scripts/smoke-startup.mjs` | 真正 Gateway/Worker/Broker 启动、Cookie/CSRF、跨进程模板文件、关闭执行时 503、IPC 退出与锁/端口清理全部通过。见 [启动记录](startup.md)。 |
| `pnpm exec tsc -p deployment/tsconfig.sandbox.json` | 独立执行器编译通过。 |
| `node docs/MyPI/tests/rules.test.cjs` | 原型 90/90 用例通过。保留原型 CommonJS 包边界，避免根 ESM 配置改变旧测试行为。 |
| `python docs/MyPI/tests/validate_contracts.py` | 13 项原始契约结构检查通过，含 OpenAPI 引用、JSON Schema 与 SQLite 外键负例。仅验证原设计草案，不声称与实际存储 DDL 完全一致。 |

浏览器五条流程覆盖：管理员模型测试/默认模型/密钥不回显/额度/封禁/审计，规则草稿/326例候选验证/发布/实时试验/回滚，游客流式搜索与刷新恢复，两个独立子任务及自动汇总，移动抽屉/IME/无横向溢出，以及确认 ZIP 覆盖/配置剥离/文本和二进制预览。已检查桌面和手机截图，见 [截图目录](screenshots/)。管理员表单精确标签及欢迎页初始滚动问题在最终复测前修复。

本机 Playwright 自带 Chromium 安装未完成，最终测试显式使用已存在的 Chromium headless shell（通过 `PLAYWRIGHT_CHROMIUM_EXECUTABLE` 环境变量指定）。CI 使用标准 `playwright install --with-deps chromium`。没有把未完成的浏览器下载记作通过。

## 证据范围

- 真实 Pi SDK 经回环 HTTP Provider 序列化工具 schema、执行文件工具、进行 retry/compaction/取消。普通 → 显式搜索 → 后续普通请求的实际工具数为 `[4,9,9,4]`；没有生产 Mock fallback。
- 316 条识别回归，187 个负例未触发，各组回归 precision/recall/F1 均为 1。样本由开发过程编写并包含原型用例；不是独立人工标注保留集，不作开放语言泛化声明。
- 1,000 组前端重复/乱序/重连投影及 1,000 组 SQLite inbox/outbox 故障恢复通过；并发共享预算、取消等待 settled、旧任务与新请求竞争、不可变配置快照均有回归。
- 导入 6 项单测与 2 项真正 Gateway → Worker RPC 集成通过；GitHub 下载使用注入 DNS/HTTP fixture。详细范围见 [导入验收](import-verification.md)。
- 规则、会话保留、删除、备份、SDK 与隔离实现分别见 [验收追踪](acceptance.md)、[维护验证](maintenance-verification.md)、[SDK记录](sdk-cli.md)、[隔离记录](sandbox-verification.md) 和 [契约差异](implemented-contracts.md)。

最终依赖锁文件 SHA-256：`6ae4a5c06ffa8f785ae5cba945ec37c03287d3caabd5a5334e8941961b5c82ff`。前端规范为根目录 [design.md](../../design.md)，后续开发由根 `AGENTS.md` 约束先读规范、后做修改。

## 环境未执行项目

当前 Docker 环境缺少要求的 rootless/runsc；专用主机的 CPU/内存/PID/网络/元数据/宿主秘密隔离和强杀恢复验收尚未运行。付费模型连通、独立人工标注集、成本/冷热缓存/并行收益比较、生产 HTTPS/Nginx、真实 GitHub 联网导入和 GitHub 托管 CI 均未宣称完成。公开执行与导入默认关闭，部署步骤见 [deployment/README.md](../../deployment/README.md)。
