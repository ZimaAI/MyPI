# 03 · 总体架构与技术设计

## 1. 架构决定

采用 **TypeScript 模块化单体 + 独立 Agent Worker + 隔离执行器**。前后端业务规模保持轻量，但不把不可信代码和凭据放在一个权限域。Pi SDK 是唯一主 Agent Loop，不在其外再套第二套 LangGraph/ReAct 编排。

建议实现栈：Node.js（满足锁定 Pi 版本要求）、TypeScript、pnpm workspace；Gateway 使用 Fastify；生产前端使用 React + Vite + TypeScript，状态请求用 TanStack Query、界面局部状态用轻量 store；SQLite WAL 存储 v1 元数据与事件；静态前端由 Nginx 提供；执行隔离选 rootless 容器并优先叠加经验证兼容的 gVisor。上述是 MyPI 设计选型，不表示全部组件已安装或集成。

React 用于真实项目；本包原型采用无外部依赖 HTML/CSS/JS，减少查看门槛，不应把 Mock 客户端当作生产权限实现。

## 2. 部署与信任边界

```text
不可信浏览器（游客 / 管理员）
        │ HTTPS + Cookie + CSRF
        ▼
Nginx：静态 Web、同源 /api、SSE 反向代理
        │
        ▼
Gateway：身份 / 会话 API / 模型管理 / 策略 / 审计 / SSE
        │ 带 principal、run、version 的私有 IPC
        ▼
Agent Worker（可信 Node 进程，SDK 历史和密钥不在工作区）
 ├─ MyPI Core：SessionActor / Intent / ToolSurface / Scheduler / Inbox
 ├─ PiAdapter：SDK Session / 事件 / 取消 / Provider 适配
 ├─ ModelCallPort：模型调用预留预算、调用、结算
 └─ SandboxPort ── 私有窄接口 ── Execution Broker
                                  │ 固定模板创建 / exec / cancel
                                  ▼
                       rootless + 加固沙箱（不可信代码）
                       /workspace 仅本用户项目，无密钥、无 docker.sock

SQLite / 私有会话存储 / 产物存储：只供可信服务访问
```

Gateway 和 Agent Worker 无 Docker socket；唯一持有 rootless 容器管理入口的是固定参数的 Broker。Broker 不接受客户端镜像名、任意挂载、HostNetwork、特权标志或任意 Docker 参数。沙箱内部不能访问 Broker 的 Unix Socket，也不能访问 Worker/Gateway 的私有 IPC。

单机不等于单进程。Worker 崩溃不会直接让 Gateway 无法响应健康检查；代码进程 OOM 不应拖垮会话控制面。

## 3. 包结构与依赖方向

```text
apps/
  cli/                  # mypi，独立终端入口
  gateway/              # 公共/管理员 HTTP，SSE，身份
  worker/               # Worker 启动，SessionActor 托管
  web/                  # React 聊天与后台
  execution-broker/     # 固定沙箱创建/执行/回收接口
packages/
  agent-core/           # MyPI 领域逻辑；不 import HTTP/React/ORM
  pi-adapter/           # 唯一依赖 pi-coding-agent 具体 API 的包
  capabilities/         # 5 组工具，执行依赖 Port
  policy/               # 权限、配额、安全 profile
  contracts/            # JSON Schema / TS 类型 / OpenAPI 生成
  storage-sqlite/       # Repository + 事务 + Outbox
  sandbox-client/       # 受限 IPC 客户端
  ui/                   # 视觉组件，不含业务权限
```

依赖：`cli / worker → agent-core → ports`；`pi-adapter / storage / sandbox-client` 实现 ports；`gateway → application services + contracts`；`web → contracts`。**agent-core 不得 import apps/gateway**。CI 用依赖图和静态路径规则检查。

## 4. 核心模块职责

| 模块 | 输入 | 输出 | 不承担 |
|---|---|---|---|
| IntentMatcher | 真实用户原始文本、规则版本 | grant proposal、理由 | 执行工具、调用模型 |
| ToolSurfaceController | Run grants、资源状态、策略 | 排序稳定的活跃工具集 | 解析任意文件中的授权 |
| SessionActor | 已鉴权命令、子结果通知 | 串行主 Loop、稳定状态 | 对 SDK 并发调用 prompt |
| PiAdapter | 会话参数、工具、受信消息 | 统一事件、最终完成 | Web Cookie 管理 |
| TaskScheduler | 子任务规格、共享预算 | 独立 SDK Session | 给子任务自动提权 |
| ResultInbox | 终态结果与接收者 | 去重投递和摘要请求 | 盲目复制整段子会话 |
| WorkspaceService | 主体身份、模板 | 私有项目与隔离副本 | 任意宿主路径访问 |
| SandboxBroker | 受限 server request | 有界执行、日志、清理 | 模型配置、前端会话 |
| QuotaService | 主体/Run/模型报价 | 预留、结算、撤销 | 信任客户端费用统计 |

## 5. 一次用户请求

1. Gateway 校验 Cookie、Origin/CSRF、请求大小、对象属主和模式；只接收 `text` 等白名单字段，拒绝客户端 role/system/developer/tools/cwd/provider URL。
2. 在事务中去重、检查并预留根请求配额、创建 Run、保存配置快照；返回 202 与 Run ID。
3. Worker 接收私有命令，SessionActor 排队；启动前从原始 human 文本判定能力，结合当前安全策略生成授权。
4. PiAdapter 在正确的请求边界投影工具；SDK 决定调用顺序与次数。每次工具执行再次校验权限，每次模型调用再次预留预算。
5. 工具通过 Broker 在沙箱运行，结构化事件先记录再向 SSE 发布；子任务由 Scheduler 在独立 Session 执行。
6. 最终 settled 后，主扩展工具面释放。无子任务时 Run 完成；有子任务时等待结果但释放主会话锁。
7. 子结果持久化入 Inbox，按原 Run 聚合；需要时在安全边界进行有预算、无工具的汇总调用，发布最终摘要。

## 6. CLI 与 Web 的复用

CLI 装配 `agent-core + pi-adapter + 本地存储 + 本地/沙箱执行 Port`；Web Worker 装配同一 core 与更严格的 policy 和 sandbox port。核心可以离线测试，不要求启动网站。CLI 的 `trusted-local` 需明示本机权限，Web 不存在这一可切换选项。

CLI 与 Web 可以各自拥有 Session，但 v1 不共享正在运行的同一个 SDK 实例；文件级历史导入属于显式恢复操作。这样不产生两个入口同时写一个会话的竞态。

## 7. 数据与事件一致性

v1 单 Worker 负责主会话所有权，SQLite 唯一数据库负责业务元数据与持久事件；不用 Redis 作为唯一事实源。IPC/EventEmitter 是低延迟通知，不承担断电持久化。Outbox 写库后再通知；重启扫描未投递条目。运行过程中不让主模型/前端按固定频率调用 status；基础设施健康检查和恢复扫描不属于 Agent 轮询。

SSE 按 Conversation 单调序号回放；同一流包括文本、工具、任务与完成事件。每 50~100 ms 或 1 KiB 合并文本增量后持久化再推送，控制写放大；终态绝不丢弃。消费者按 sequence 去重，事件过期时回到服务端快照。

## 8. 扩展边界

P2 才拆分多 Worker、PostgreSQL、分布式 lease 和事件总线。迁移前必须把单 Worker 假设显式化：禁止多副本无所有权协调启动。首版不搭 Kafka、Kubernetes 或全量可观测平台，只为展示能力引入它们会增加验收负担。
