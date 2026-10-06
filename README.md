# MyPI

MyPI 是基于 Pi SDK 的 Coding Agent，提供独立 CLI、游客 Web 工作台和管理后台。CLI 与 Web 复用同一个 Agent Core；Web 代码执行经过独立 Worker 和 Execution Broker。项目使用 TypeScript、React、Fastify 与 SQLite，锁定 `@earendil-works/pi-coding-agent@0.87.1`。

默认使用 `explicit` 按需加载模式：每个用户请求都可使用 `read / write / edit / bash` 四个基础工具；只有当前用户明确请求搜索、委派、工作流、后台或会话能力时，才开放对应扩展工具。扩展授权随本次请求结束释放。`native` 模式始终仅开放四个基础工具。

本地功能、真实 SDK 接口、HTTP/SSE、持久化和浏览器流程有可重放测试。测试提供商运行在回环地址，不需要付费密钥。当前机器未完成 Linux rootless Docker + runsc 的实际隔离验收，**公开执行默认关闭**。具体完成范围和未运行项目见 [实施记录](docs/evidence/implementation.md) 与 [验收追踪](docs/evidence/acceptance.md)。

## 快速启动 Web 与管理后台

要求 Node.js **24 或更高版本**、pnpm **11.5.0**。请从仓库根目录执行：

```sh
pnpm install --frozen-lockfile
pnpm setup
pnpm build
pnpm cli admin bootstrap --state-dir .mypi/server
pnpm dev
```

1. `setup` 生成本机 `.env` 和随机密钥；已有 `.env` 会保留。密钥及运行数据不应提交 Git。
2. `admin bootstrap` 在交互终端中询问用户名及两次密码，密码至少 12 个字符且输入时不回显。系统没有默认管理员账号。该命令写入 `.mypi/server/mypi.sqlite`，必须与服务端 `MYPI_DATA_DIR` 指向同一目录。
3. `dev` 同时启动 Broker、Worker 和 Gateway。浏览器打开 [http://localhost:3000](http://localhost:3000)，管理后台位于 `/admin/login`。按 Ctrl+C 停止服务。
4. 登录管理后台，在“模型管理”选择服务商、服务端点与官方模型预设，或选择自定义服务，再填入对应 API Key。预设自动填写上下文和输出预算，官方规格和文档核对日期同时显示。保存后运行连接测试，再启用模型并设为游客默认。API Key 仅可写入或清除，不会返回浏览器；数据库使用主密钥加密保存。

内置 16 家国内外服务商的 18 类服务（含火山引擎 Agent Plan、Coding Plan）、22 个端点和 61 条文字/工具调用模型预设（2026-10-06 核对）。支持管理员填写自定义公网 HTTPS 模型端点及模型 ID，选择 Chat Completions、Responses 或 Anthropic Messages 协议。完整配置及官方来源见 [模型服务配置](docs/model-providers.md)。预设不包含密钥，也不会自动改写已有模型。

初始配置支持创建临时身份、模板会话、浏览文件和管理配置。模型调用及代码执行需要同时满足 Broker 隔离环境就绪与后台执行策略开启；仅添加模型不会开放执行。Windows 上可独立使用下述 CLI 完成可信本机任务。

`MYPI_ORIGIN` 必须与浏览器实际使用的协议、主机和端口完全一致。默认是 `http://localhost:3000`；若改用 `127.0.0.1` 或其他端口，请一起修改此值并重启。写操作使用 Cookie、Origin 与 CSRF 校验。

前端开发时，保持 `pnpm dev` 运行，再执行 `pnpm web`，访问 `http://localhost:5173`。Vite 默认把 `/api` 和 `/health` 代理到 3000 端口；改变 Gateway 地址时需同步修改 `apps/web/vite.config.ts`。正式构建由 Gateway 从 `dist/web` 提供。

### VS Code 调试

用 VS Code 打开仓库根目录。首次调试先执行 `pnpm install --frozen-lockfile` 和 `pnpm setup`；`.env` 由 setup 在本机生成，不提交到 Git。在“运行和调试”中选择 **MyPI: Full Stack** 并按 F5，可同时调试 Broker、Worker、Gateway 的 TypeScript 源码，并在 Vite 就绪后打开浏览器调试前端。浏览器地址为 `http://127.0.0.1:5173`，Vite 会将 API 请求代理到 Gateway。若只需单独调试一个服务，可选择对应的配置；**MyPI: CLI** 默认运行 `doctor`，可在 `.vscode/launch.json` 中修改 `args` 来调试其他 CLI 命令。不要在同一状态目录同时运行 `pnpm dev` 和 VS Code 的完整调试配置。

## 独立 CLI

CLI 不要求启动 Web、Gateway 或 Broker，也不要求管理员账号。它在指定目录中以当前系统用户权限执行工具；启动时会显示 `trusted-local` 和实际工作目录。请使用自己信任的项目目录。

在本机 `.env` 或终端环境变量中设置 `MYPI_PROVIDER`（例如 `deepseek`）和该服务商的密钥变量（例如 `DEEPSEEK_API_KEY`），即可使用默认模型、端点和预算。也可用 `MYPI_API_KEY`、`MYPI_MODEL`、`MYPI_BASE_URL` 覆盖；地域由 `MYPI_ENDPOINT` 或 `--endpoint` 选择。`pnpm cli models` 查看全部预设。通用 `openai-compatible` / `openai-responses` 仍支持手动模型与端点。仓库内的 `pnpm cli` 会读取 `.env`，不会从管理后台数据库获取 CLI 模型配置。

```sh
pnpm cli doctor
pnpm cli models --provider deepseek --json
pnpm cli --cwd ./your-project --mode explicit
pnpm cli run "请使用搜索工具查找入口文件" --cwd ./your-project
pnpm cli run "解释这个项目的结构" --cwd ./your-project --json
pnpm cli sessions list
pnpm cli resume <session-id>
pnpm cli --help
```

CLI 默认私有目录为 `~/.mypi`，可用 `--state-dir DIR` 或 `MYPI_HOME` 指定；会话数据库为 `cli.sqlite`。也可在该目录创建配置文件：

```json
{
  "provider": "deepseek",
  "model": "deepseek-flash",
  "mode": "explicit",
  "maxOutputTokens": 8192,
  "contextWindow": 1048576
}
```

私有配置文件还支持 `apiKey` 和 `baseUrl`；环境变量可覆盖模型、密钥和端点。`--trust-project` 才会读取项目的 `.mypi/config.json`，且该文件不能配置 API Key。运行时不会自动发现项目中的 Pi 扩展或 Skills。

交互命令：`/mode native`、`/mode explicit`、`/tasks`、`/processes`、`/cancel`、`/new`、`/quit`。第一次 Ctrl+C 取消当前请求，再次按下退出。`--json` 将事件 JSONL 写到标准输出，诊断写到标准错误。单次运行成功返回 0，配置错误返回 2，预算/权限拒绝返回 3，执行失败返回 4，取消返回 130。

## Web 工作流与后台

- **对话工作台**：游客无需注册；可选择 JavaScript、静态网页或空白模板，切换模式，查看触发证据、模型调用、工具结果和实时事件。刷新后从持久化快照与 SSE 游标恢复。
- **任务与文件**：查看并行子任务、结果、工作流、后台进程及产物；停止任务或进程；查看独立副本的 Diff，并在基线版本一致时明确应用变更。归档会话会停止执行并保留文件，删除会清理会话资源。
- **模型与游客管理**：加密模型配置、连接测试、默认模型、游客封禁、限额调整和操作审计。费用缺失保持未知，不虚构为零。
- **额度与规则**：发布版本化策略；新限额立即作用于当日已存在的额度桶，保留已用和预留数。规则支持五组开关、受限字面短语草稿、回归校验、发布及历史回滚；发布只影响之后接受的请求。具体配置见 [规则说明](packages/policy/README.md)。
- **项目导入**：将 `.env` 中 `MYPI_ENABLE_IMPORTS=true` 后重启，在会话“项目文件”中导入 ZIP 或公开 `https://github.com/owner/repo` 仓库。导入要求当前工作区没有进行中的请求，并确认替换工作区内容；有版本冲突时拒绝覆盖。压缩包最多 10 MiB、展开最多 32 MiB、2,000 个条目、单文件 2 MiB；不支持任意 Git 地址、私有仓库凭据、链接或压缩包中的自动执行配置。导入完成后仍需发送新请求才会调用模型或工具。

游客身份及临时会话默认保留 24 小时。清除 Cookie 会丢失对旧会话的访问凭据；同 IP 的身份创建有速率上限。Worker 与 Broker 在启动及每分钟执行保留清理；审计与必要计量记录按各自保留规则保存。

## 架构与目录

```text
浏览器 ── HTTP / SSE ── Gateway ── 私有 RPC ── Worker ── Agent Core ── Pi SDK
                          │                      │             │
                          └──── SQLite / WAL ────┘             └─ Sandbox Port
                                                                      │
独立 CLI ── Agent Core ── Pi SDK                         私有 RPC ── Broker
                └─ TrustedLocalSandbox                                └─ rootless / runsc 容器
```

| 位置 | 职责 |
|---|---|
| `apps/cli` | 独立终端入口、会话恢复、管理员初始化 |
| `apps/gateway` | HTTP/SSE、Cookie 身份、CSRF、管理 API 与静态前端 |
| `apps/worker` | Core 组装、模型调用、后台通知、导入协调与保留清理 |
| `apps/execution-broker` | 受限私有 RPC、隔离执行器和容器租约 |
| `apps/web` | React 工作台与管理后台 |
| `packages/agent-core` | Run/Task 生命周期、预算、授权、队列、结果归因 |
| `packages/pi-adapter` | 锁定版本的 Pi SDK 适配与私有 Session |
| `packages/policy`、`packages/capabilities` | 意图规则、能力定义与执行 |
| `packages/storage-sqlite` | SQLite、事务、事件/Outbox、额度账本和密钥存储 |
| `packages/sandbox-client`、`packages/project-import` | 执行 Port、工作区快照与受限 ZIP/GitHub 导入 |
| `packages/contracts` | 共享领域类型和接口 |
| `deployment`、`scripts` | 部署样例、初始化、启动与一致性备份 |

服务端采用**单 Gateway、单 Worker、单 Broker**。Worker 有状态目录锁；不要对同一状态目录启动多个 Worker。模型密钥和 SDK 历史位于私有状态，执行工作区只接收受限文件快照。前端后续开发以根目录 [design.md](design.md) 为准。原始需求和原型保留在 [docs/MyPI](docs/MyPI/README.md)，其中“设计基线/尚未实现”描述的是原始交付包；当前实现状态见根 [STATE.md](STATE.md)。

## 配置

`.env.example` 是本地配置说明，`pnpm setup` 会生成有效随机凭据。关键配置如下：

| 变量 | 默认生成值 / 用途 |
|---|---|
| `MYPI_PROFILE` | `local`；`public-demo` 启用生产 Secure Cookie |
| `MYPI_HOST`、`MYPI_PORT` | `127.0.0.1`、`3000`；本地模式只允许回环监听 |
| `MYPI_ORIGIN` | `http://localhost:3000`；允许写请求的精确 Origin |
| `MYPI_DATA_DIR` | `.mypi/server`；Gateway/Worker 共用数据库与私有历史 |
| `MYPI_BROKER_STATE` | `.mypi/broker`；Broker 的私有工作区状态 |
| `MYPI_MASTER_KEY` | 随机 32 字节 Base64；用于加解密服务端模型密钥，需独立备份 |
| `MYPI_COOKIE_SECRET` | Cookie/CSRF 密钥，至少 32 字符 |
| `MYPI_WORKER_TOKEN`、`MYPI_BROKER_TOKEN` | 两条私有 RPC 的独立认证密钥，至少 32 字符 |
| `MYPI_WORKER_URL`、`MYPI_WORKER_PORT` | `http://127.0.0.1:4101`、`4101` |
| `MYPI_BROKER_URL`、`MYPI_BROKER_PORT` | `http://127.0.0.1:4102`、`4102` |
| `MYPI_WORKER_SOCKET`、`MYPI_BROKER_SOCKET` | 可选私有 Unix Socket，设置后优先使用 |
| `PUBLIC_EXECUTION_ENABLED` | `false`；Broker 基础设施执行开关 |
| `MYPI_SANDBOX_RUNTIME`、`MYPI_SANDBOX_IMAGE` | `runsc` 与部署者提供的固定 `@sha256:...` 镜像 |
| `MYPI_ENABLE_IMPORTS` | `false`；Gateway/Worker 的项目导入开关 |
| `MYPI_WEB_ROOT` | 默认 `dist/web` |

可分别运行 `pnpm broker`、`pnpm worker`、`pnpm gateway`，它们均读取根 `.env`。私有 RPC 端口不应暴露到公网。存活检查为 `/health/live`，依赖就绪检查为 `/health/ready`；关闭执行或依赖未就绪时，页面仍可提供受限的浏览与配置功能。

## 生产隔离与备份

正式部署需 Linux、rootless Docker、有效的 cgroup v2 资源限额、seccomp 和已注册的 `runsc`。Broker 启动时检查这些前置条件及固定摘要的本地镜像；检查失败会拒绝执行。没有从 Web 降级为宿主机 Shell 的路径。默认容器无网络、无宿主目录挂载，以非 root 用户运行，并设置 CPU、内存、PID 和临时文件系统限制。

```sh
pnpm exec tsc -p deployment/tsconfig.sandbox.json
docker build -f deployment/Dockerfile.sandbox -t mypi-sandbox:1.0.0 .
```

将镜像发布到受控仓库并取得实际 `RepoDigest`，配置 `MYPI_SANDBOX_IMAGE=registry/name@sha256:...`。使用 [部署说明](deployment/README.md)、[生产变量样例](deployment/.env.example) 和 [Nginx 样例](deployment/nginx.conf) 配置 HTTPS；仅反向代理对外开放。独立执行主机的隔离验收通过后，再开启 Broker 环境变量和后台“公开执行”策略这两道开关。

一致性数据库备份示例（目标目录必须尚不存在）：

```sh
node --import tsx scripts/backup.ts --source .mypi/server/mypi.sqlite --out .mypi/backups/first-backup
```

备份包含 SQLite 中的模型密文、账本、审计和内联产物，并生成校验清单。完整恢复还需在暂停写入后备份 Broker 工作区和 SDK 私有文件；主加密密钥单独保存。详细恢复范围与保留策略见部署说明。

## 开发验证

```sh
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm exec tsc -p deployment/tsconfig.sandbox.json
node scripts/smoke-startup.mjs
pnpm exec playwright install chromium
pnpm test:e2e
```

`pnpm verify` 一次运行依赖边界与 Prettier 格式检查、类型检查、后端测试和前端构建；浏览器测试单独运行。Playwright 使用 4197 端口、临时数据库和测试专用模型提供商，不能与同端口的其他服务同时启动。测试管理员仅由该临时测试服务创建，生产没有默认账户。若已有受控 Chromium，可通过 `PLAYWRIGHT_CHROMIUM_EXECUTABLE` 指定可执行文件。

测试覆盖实际 SDK 请求、四个基础工具重定向、扩展授权释放、独立子 Session、取消与恢复、并发预算、Cookie/CSRF/属主鉴权、模型密钥不回显、规则发布回滚、SSE 补发和快照事务、ZIP/GitHub 限制及真实浏览器操作。自动化测试不会替代生产沙箱验收或真实模型质量与费用评测。

证据入口：

- [需求验收表](docs/evidence/acceptance.md) 与 [全量实施记录](docs/evidence/implementation.md)
- [SDK、CLI 与识别回归](docs/evidence/sdk-cli.md)
- [Gateway、SQLite 与预算](docs/evidence/gateway-storage.md)
- [执行器隔离验证](docs/evidence/sandbox-verification.md)
- [删除、保留期限与备份](docs/evidence/maintenance-verification.md)
- [实际入口启动与退出](docs/evidence/startup.md)
- [实现契约](docs/evidence/implemented-contracts.md)、[浏览器结果](docs/evidence/playwright-results.json) 与 [截图目录](docs/evidence/screenshots)

## 常见问题

- **页面提示执行未开启**：先配置可用模型；Web 还需要 Broker 的隔离环境与后台策略同时允许执行。本地可信任务可直接使用 CLI。
- **写操作出现 Origin/CSRF 错误**：核对浏览器地址与 `MYPI_ORIGIN`，更改配置后重启服务并重新登录。
- **Worker 提示锁已存在**：先确认记录的 PID 对应 Worker 已停止；只有确认没有活跃 Worker 后才能移除对应 `worker.lock`。不要删除运行中的锁。
- **模型连接失败**：核对服务类型、协议、模型 ID、端点及密钥；火山 Agent Plan 与 Coding Plan 使用各自专用地址及密钥。自定义 Web 端点须为公网 HTTPS Base URL，不能指向内网或重定向地址；Gemini 保留官方端点。连接测试会发出一次有预算上限的模型请求。
- **密钥解密失败**：检查服务端使用的 `MYPI_MASTER_KEY` 是否与写入密钥时一致。重新生成 `.env` 不能恢复旧密文，恢复备份时需原主密钥。
