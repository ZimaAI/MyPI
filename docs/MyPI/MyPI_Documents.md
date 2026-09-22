# MyPI 完整文档合并版

v1.0-design · 2026-09-22

设计与交互原型交付；不包含真实后端。编辑请以独立源文件为准。


---

<!-- SOURCE: README.md -->

# MyPI · 产品规格与交互原型交付包

**版本：v1.0-design · 整理日期：2026-09-22 · 状态：设计基线，尚非后端成品。**

MyPI 是基于 Pi SDK 的独立 Coding Agent：本地可用 CLI，Web 通过 Gateway 调用同一核心；公开演示支持游客免注册，同时提供模型、身份、额度、工具规则和审计后台。

## 先打开什么

`MyPI_Documents.html` 是带目录的完整文档阅读版；`MyPI_Documents.md` 是合并文本版。两者由下列源文件生成，修改应以独立文档为准。

- `prototype/index.html`：可双击打开的离线交互原型。对话、模式切换、规则识别、并行任务、代码变更和后台均可演示。所有回复、运行记录、成本数据均为 Mock；不会连接模型或执行系统命令。
- `docs/01-product-requirements.md`：范围、需求编号、验收标准。
- `docs/03-architecture.md`：模块划分、控制面与执行面、CLI/Web 解耦。
- `docs/04-tool-loading.md`：最核心的显式加载语义与生命周期。
- `docs/07-security.md`：开放域名前必须完成的安全门槛。
- `IMPLEMENTATION_PROMPT.md`：交给 Codex 等编码工具的实现入口。

## 已确定的产品决策

1. 仅提供 `native` 和 `explicit` 两种工具模式，默认 `explicit`；不加入 Adaptive 或常驻工具加载器。
2. 原生工具固定为 `read / write / edit / bash`。普通用户请求不激活 MyPI 扩展工具；显式请求才按能力组开放。
3. MyPI 授权按 **用户请求 Run** 生效，不按整个会话单调累积；同一个请求内的多次模型调用保持稳定，结束后释放。
4. 工具可见性不是安全授权。四个原生工具在公开 Web 环境也必须走隔离执行器。
5. 子任务使用独立 Pi SDK Session，事件驱动回传；子上下文隔离、文件写入隔离与 OS 隔离分别实现。
6. CLI 不依赖 Web、Gateway、管理员账号或远程数据库。Gateway 是应用适配层，不是 Agent 内核的一部分。
7. 公网默认是有资源上限、无任意外网访问的模板工作区演示，不是匿名共享宿主机 Shell。

## 目录说明

| 目录 / 文件 | 用途 |
|---|---|
| `docs/00-reference-audit.md` | 上游核验、版本风险、借鉴与差异 |
| `docs/01-product-requirements.md` | 产品需求与非目标 |
| `docs/02-domain-and-state.md` | 领域模型、状态机、行为不变量 |
| `docs/03-architecture.md` | 架构与依赖方向 |
| `docs/04-tool-loading.md` | 显式识别、激活、卸载与权限 |
| `docs/05-capability-spec.md` | 五个能力组及 25 个扩展工具规格 |
| `docs/06-parallel-and-workflow.md` | 子任务、结果队列、DAG、并发写入 |
| `docs/07-security.md` | 游客访问、安全执行与防滥用 |
| `docs/08-api-and-events.md` | HTTP / SSE / 内部接口 |
| `docs/09-data-and-storage.md` | 数据模型、事务、一致性、保留期限 |
| `docs/10-frontend.md` | 页面、交互、状态与无障碍 |
| `docs/11-admin.md` | 模型、用户、策略、审计后台 |
| `docs/12-cli-and-sdk.md` | CLI 命令与 SDK 适配边界 |
| `docs/13-evaluation.md` | 加载准确性、成本、并行、可靠性评测 |
| `docs/14-deployment.md` | 轻量部署、环境变量、运维 |
| `docs/15-delivery-plan.md` | 后端先行的分阶段实施与验收 |
| `docs/16-acceptance.md` | 可执行验收场景与需求追踪 |
| `docs/17-decisions-and-risks.md` | ADR、取舍与未消除风险 |
| `docs/18-demo-and-resume.md` | 演示脚本及真实简历表述原则 |
| `design.md` | 统一视觉与组件设计规范 |
| `contracts/` | OpenAPI、事件类型、SQL 数据模型 |
| `prototype/` | 原型与纯函数规则样例 |
| `tests/` | 原型规则测试与浏览器冒烟测试 |
| `evidence/` | 本次实际检查结果，不代表后端验收 |
| `deployment/` | 配置样例与上线清单，不含假装可运行的后端镜像 |

## 使用方法

解压后直接打开 `prototype/index.html`，无需账号、依赖或 API Key。也可在交付包根目录执行：

```bash
python -m http.server 8765 --bind 127.0.0.1
# 浏览器打开 http://127.0.0.1:8765/prototype/index.html
node tests/rules.test.cjs
```

实现真实系统时必须从源码核验 Pi 版本并锁定依赖，不能把本文档中的拟定接口当作 Pi 官方导出。公开上线之前，`docs/07-security.md` 与 `docs/16-acceptance.md` 中的安全阻断项全部通过，否则保持本地访问或关闭公开执行。

## 证据边界

本包提供完整设计、契约草案和交互原型；不包含真实模型调用、Pi SDK 集成后端、有效管理员认证、部署完成的容器沙箱或生产优化数据。原型上的配额、在线状态、测试记录、费用与模型名称均为示例。具体实测范围见 `evidence/verification.md`。


---

<!-- SOURCE: docs/00-reference-audit.md -->

# 00 · 参考项目核验与适配策略

## 1. 核验范围

2026-09-22 读取用户指定的三个公开仓库及相关官方文档。以下属于网页/源码阅读结果，不等于克隆后运行验证。`main` 会继续变化；本次未取得可验证的 commit SHA，不编造 SHA，也不把分支文档等同于 npm 已发布版本。

| 编号 | 官方来源 | 本次核验用途 |
|---|---|---|
| S1 | https://github.com/earendil-works/pi | Pi 包体系与权限边界 |
| S2 | https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/sdk.md | SDK 创建会话、订阅、默认工具与资源加载 |
| S3 | https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/extensions.md | 生命周期钩子、工具激活与消息投递 |
| S4 | https://github.com/earendil-works/pi/blob/main/packages/coding-agent/package.json | 包名、版本字段和 Node 要求 |
| S5 | https://github.com/openpi-dev/openpi | 子任务、Web 与能力加载行为 |
| S6 | https://github.com/openpi-dev/openpi/blob/main/extensions/shared/tool-surface.ts | 五组映射、entry/deferred、会话级加载 |
| S7 | https://github.com/openpi-dev/openpi/blob/main/extensions/shared/capability-intent.ts | 意图识别模块入口 |
| S8 | https://github.com/openpi-dev/openpi/blob/main/extensions/capabilities/index.ts | 能力扩展入口 |
| S9 | https://github.com/openpi-dev/openpi/blob/main/extensions/subagents/index.ts | 子代理扩展入口 |
| S10 | https://github.com/bytedance/deer-flow/blob/main/docs/ARCHITECTURE.md | Harness/App 单向依赖、Gateway 与流式入口 |
| S11 | https://github.com/bytedance/deer-flow | 公开部署安全提示 |
| S12 | https://docs.docker.com/engine/security/rootless/ | rootless 容器边界 |
| S13 | https://gvisor.dev/docs/ | 强化隔离及兼容性取舍 |

## 2. 已核验的关键事实

**Pi。** S2 中默认工具为 `read, bash, edit, write`，但 SDK 还提供其他可选内置工具；“默认四个”不代表整个 Pi 只有四种工具。SDK 支持创建独立会话、订阅事件和自定义工具。S3 提供 `before_agent_start`、`setActiveTools()` 与自定义消息投递接口；其生命周期区分低层 `agent_end` 和最终 settled 边界。S1 明确 Pi 本身不构成文件、进程、网络和凭据的权限沙箱。

**OpenPI。** S6 明确 `search / delegate / workflow / background / session` 五组，具备 entry/deferred 两层展示条件；原实现按会话单调加载，并非每个用户请求结束就卸载。S5 描述子任务使用进程内独立 Pi SDK Session，完成后通知主会话；这是上下文隔离，不是 OS 安全隔离。

**DeerFlow。** S10 可借鉴的是“可发布 Harness 不反向依赖 App”“Gateway 统一入口”“流事件与沙箱职责分离”。MyPI 不复用其 Python/LangGraph 编排内核，也不照搬完整服务栈。

**版本观察。** S4 的 `main` 包文件显示 `@earendil-works/pi-coding-agent` 的版本字段为 `0.87.0`，Node 要求 `>=22.19.0`。这不是已核验的 npm 安装可用性结论。编码阶段需确定一个实际可安装版本、对应源代码 SHA、锁文件及兼容测试报告。

## 3. MyPI 有意与参考实现不同的地方

| 参考行为 | MyPI 决策 | 原因 |
|---|---|---|
| OpenPI 能力会话内单调加载 | 每个用户 Run 独立授权，结束后释放 | 满足普通回合 0 MyPI 工具 |
| OpenPI 另有 Adaptive | v1 不提供 | 用户本次只要求两种模式 |
| 裸能力名称可被视为选择 | v1 要求执行意图或明确命令 | 宁可少触发，不因讨论工具而开闸 |
| 原生 Bash 可访问启动进程权限范围 | 公网工具全部进入隔离执行器 | 匿名编码不能等于宿主机执行 |
| 会话消息历史与工作目录相邻的常见本地布局 | Web 私有会话存储与可执行工作区物理分离 | 防止代码读到凭据和其他会话 |
| 参考实现的完整工作流 DSL / Replay | v1 有界 JSON DAG；副作用不自动回放 | 控制实现范围及错误重试风险 |

## 4. 编码前必须完成的兼容性 Spike

创建两个独立 Session；验证输入来源记录和钩子先后顺序；注册一个测试工具但先不激活；在 `before_agent_start` 激活后观察真实 provider payload；完成后卸载；验证重试/压缩不会提前卸载；验证有工具调用时取消不会留下悬挂 ToolCall；验证私有 ResourceLoader 不发现用户工作区扩展；验证新建/切换会话后的订阅重新绑定。

结果写入 `evidence/pi-compatibility.md`，包含版本、SHA、命令、环境、日志和通过/失败项。失败时先修适配层，不在业务代码中散布兼容分支。

## 5. 开源复用约束

不整仓复制参考项目。核心逻辑自行实现，参考行为要标记为设计来源；实际复制代码时保留原文件署名及适用许可证通知，发布前核对锁定版本 LICENSE 和第三方依赖。不要把参考项目已有功能全部描述为个人原创。


---

<!-- SOURCE: docs/01-product-requirements.md -->

# 01 · 产品需求文档 PRD

## 1. 产品定位

MyPI 是面向个人开发者和求职演示访客的轻量 Coding Agent。日常编码保持 Pi 默认的四工具使用体验；只有用户明确提出搜索、委派、工作流、后台进程或任务管理需求时，才开放对应扩展工具。开发者可在终端使用，也可通过网页在服务器的隔离工作区内生成、修改和验证代码。

成功不是“接了一个聊天接口”，而是能解释并验证：工具为什么出现、子任务如何独立执行、结果如何可靠汇总、匿名请求如何被约束，以及 CLI 与 Web 如何共享内核。

## 2. 用户与场景

| 角色 | 目标 | 权限 |
|---|---|---|
| 公开游客 | 不注册即可体验编码、搜索和并行任务 | 自己的会话、模板工作区、受限模型与额度 |
| 本地 CLI 使用者 | 操作自己的项目并使用扩展能力 | 本机可信配置，启动时明确工作目录 |
| 管理员 | 管理模型、身份、策略和异常请求 | 后台独立认证；敏感操作审计 |

公开游客不是没有身份：首次访问时创建服务器签发的匿名 Principal 和 HttpOnly 会话 Cookie；不能访问其他游客的数据。清除 Cookie 后无法自动恢复旧记录。v1 不提供账号注册和跨设备找回。

典型场景：进入域名直接看到聊天工作台；选择模板；要求修复一个函数；明确“使用搜索工具查找鉴权入口”；明确“使用子代理分别检查实现和测试”；主 Agent 接着分析其他问题；任务完成以事件卡片出现；查看代码差异、测试输出并导出允许的产物。

## 3. 范围与需求编号

| ID | 需求 | 优先级 | 可观察验收 |
|---|---|---|---|
| FR-001 | 根路径直达对话页，自动建立游客身份 | P0 | 不展示注册拦截，首次请求返回匿名身份与策略 |
| FR-002 | 创建、查看、归档自己的会话 | P0 | 跨身份请求同一 ID 返回 404 |
| FR-003 | 流式文本、工具调用、任务状态、错误显示 | P0 | 刷新可恢复最终内容；断流可补发 |
| FR-004 | native / explicit 模式切换 | P0 | 新 Run 使用快照；进行中切换明确标记下轮生效 |
| FR-005 | 显式正则规则，排除否定、条件、引用与讨论 | P0 | 黄金集逐条判断，理由可查询 |
| FR-006 | 普通用户 Run 仅四个基础工具，0 MyPI 扩展 | P0 | 真实 provider tools 检查，不只看 UI |
| FR-007 | 五个能力组 | P0 | 每组至少一个真实闭环，完整工具契约见 05 |
| FR-008 | 独立 SDK Session 子任务，并发与取消 | P0 | 子任务不共享消息历史，主 Agent 不原地等待 |
| FR-009 | 事件通知与持久结果队列 | P0 | 重复/乱序/重连后不重复呈现或重复执行 |
| FR-010 | 有界 pipeline / parallel 工作流 | P0 | DAG 校验、任务预算、失败策略、节点结果 |
| FR-011 | 后台进程与日志、停止、到期回收 | P0 | 页面离开不失去清理，进程树可终止 |
| FR-012 | Session 工作项和目标管理 | P0 | 创建/更新有版本号，任务与实际执行状态分离 |
| FR-013 | 代码文件、差异、日志、产物查看 | P0 | 只允许当前工作区，不执行产物中的脚本 |
| FR-014 | 独立可交互 CLI | P0 | 不启动 Gateway 也可跑同一用例 |
| FR-015 | 模型配置、测试、默认模型、密钥更新 | P0 | 密钥仅写入不回显；模型版本快照可审计 |
| FR-016 | 游客管理、封禁、配额与全局熔断 | P0 | 封禁阻止新运行并可撤销在途执行权限 |
| FR-017 | 全链路审计、用量、错误、运行查阅 | P0 | 可按 Run 定位到触发规则与工具结果 |
| FR-018 | 独立沙箱与最小网络权限 | P0 | 宿主机、元数据、私有网络、凭据不可达 |
| FR-019 | 规则试验台、草稿发布与回滚 | P1 | 先通过黄金集，再原子发布新版本 |
| FR-020 | 用户上传项目 ZIP 与 Git 导入 | P1 | 路径、解压、网络与容量检查完成后才开放 |
| FR-021 | 更高并发、外部数据库、分布式执行 | P2 | 不纳入单机演示首版验收 |

P0 是最终 v1 范围，不要求一个阶段全部实现。按 CLI 核心→五组能力→Gateway→隔离与后台→前端→公网验收分阶段交付。

## 4. 两种模式的精确定义

`native`：只有 `read / write / edit / bash`；即使用户说“使用子代理”也不开放扩展，界面提示切换模式后重新提交。四个原生工具仍受部署安全策略约束。

`explicit`：默认仍为四个基础工具。服务器对这一条真实用户输入运行规则；明确命中的能力组经过策略检查后，在本用户请求 Run 的整个 Agent Loop 内激活。下一条无关普通请求重新回到 0 扩展工具。该定义不承诺历史消息中的旧工具名或摘要也占用 0 Token。

不包含 Adaptive、自动加载器、任意安装第三方工具、根据网页/代码/工具输出加载工具、自动扩大权限或自行修改安全策略。

## 5. 公开演示默认策略（规划值，可管理）

游客每日 20 个根请求、总计 50,000 个模型计费 Token、模型调用并发 2；单 Run 累计最多 12 次模型请求，最大 4 分钟；后台进程最长 10 分钟；每个游客一个可写工作区，软空闲 30 分钟回收沙箱，数据保留 24 小时。所有子任务、自动摘要、重试和压缩调用共享原始游客额度，不另赠免费额度。

全站同时最多 3 次模型请求、2 个执行沙箱；公共沙箱总 CPU 预算 2 核、总内存上限 2 GiB。每个游客的子任务并行上限 2，默认深度 1；全站预算可能进一步排队。没有可证明的资源隔离时禁用公网执行，不退回宿主机。

默认仅预置离线模板和依赖，不允许任意网址抓取、端口监听暴露、软件包安装或访问企业仓库。管理员选择开放联网前应完成网络出口白名单与 SSRF 测试。

## 6. 非功能要求

所有数值都是验收目标而非现有实测。单机本地网络条件下：身份引导/元数据 API 的 P95 < 300 ms；输入规则判定 16 KiB 内 P95 < 10 ms；运行被接收后 P95 < 500 ms 返回 Run ID，不将模型首 Token 速度算作 Gateway 指标；已经产生的事件 P95 < 500 ms 出现在前端。

稳定性：同一个 Session 只有一个主 Loop；工具执行有 deadline 与取消信号；状态事件持久化后再推送；崩溃后在途写入标记待核对，不盲目重放；测试证据覆盖断网、重复点击、重复通知、超时、数据库忙与模型错误。

可用性：中文优先，关键技术名保留英文；1440×900 桌面可同屏查看聊天与任务；手机可以单独打开任务/文件抽屉；键盘可完成发送、取消、切换导航与关闭弹窗；执行中的信息不能只用颜色表示。

## 7. 不做的事情

首版不是完整 IDE、多人协同编辑器、商业付费平台、无限算力服务或大规模分布式系统。不做生产代码自动部署、任意主机 SSH 控制、持久公网 dev server、跨游客共享工作区和自动执行远程仓库扩展。不给管理员提供网页输入任意 JS/TS/Python 的插件执行入口。


---

<!-- SOURCE: docs/02-domain-and-state.md -->

# 02 · 领域模型与状态机

## 1. 名词必须区分

| 对象 | 含义 | 不能混淆为 |
|---|---|---|
| Principal | 服务器识别的游客或管理员身份 | 客户端提交的 user_id |
| AuthSession | 浏览器 Cookie 对应的登录凭证 | Agent 的会话历史 |
| Conversation | 产品中的对话容器 | 一个模型 API 请求 |
| AgentSession | Pi SDK 实例及其私有历史 | 操作系统沙箱 |
| Run | 一个真实用户请求驱动的完整执行 | SDK 的一次 turn_end |
| ModelCall | 一次实际发往提供商的调用 | 一个用户问题 |
| Grant | 本 Run 获得的能力授权快照 | 全会话永久许可 |
| ToolSurface | 当前发送给模型的工具定义集合 | 最终执行权限 |
| Task | 一个受预算约束的子任务 | 一条 todo 工作项 |
| WorkItem / Goal | 用户计划、目标与验收条件 | Agent 已完成的事实 |
| Workspace | 该用户可编辑的项目数据 | Gateway 根目录 |
| Sandbox | 执行不可信代码的隔离环境 | 指定 cwd |
| Artifact | 有属主、有哈希的可下载产物 | 任意服务器文件路径 |
| InboxItem | 待投递的子任务完成结果 | 每秒轮询得到的状态 |

## 2. 关键状态

Run：`accepted → queued → running → waiting_children → succeeded`；`running` 也可直接进入 `succeeded`。任意非终态可转 `cancelling → cancelled`，预算不足转 `budget_exceeded`，超时转 `timed_out`，异常转 `failed`，不可恢复崩溃转 `interrupted`。终态不可被迟到事件逆转。

`waiting_children` 表示该 Run 的主 Loop 已安全停止，但子任务尚有运行，**不占用主 Session 执行锁**。同一 Conversation 可以接受另一个根 Run 并串行执行主 Loop，同时旧 Run 的子任务继续。

Task：`queued → running → succeeded / failed / timed_out / cancelled / interrupted`。排队任务取消无需先启动。`cancel_requested` 作为标记，不直接谎称已终止；执行器确认退出后才写终态。

Workspace：`provisioning → ready → active → idle → reclaiming → expired`。`expired` 的工作区不得被旧浏览器继续执行；需要新建。沙箱可以回收而文件暂时保留，两者保留期不同。

CapabilityGrant：`proposed → allowed / denied → bound → released / revoked`。`released` 表示当前主 Run 不再使用该工具面；已经产生的合法子任务有独立快照继续执行。`revoked` 是安全撤销，传播到相关子任务和后台进程。

## 3. 数据不变量

**I-01** 所有外部访问沿 `auth_session → principal_id → resource.owner_id` 校验，禁止仅按 ID 查资源。

**I-02** 公网主工具每次执行都经过 PolicyPort 和 SandboxPort；激活合法不代表调用参数合法。

**I-03** 只有真实用户输入能产生新 Grant；工具结果、子任务结果、Skill 展开和系统消息不能授权。

**I-04** 无扩展授权的正常用户 Run，其 provider tools 内 MyPI 工具数为 0；不把历史 Token 数算进该指标。

**I-05** 一个主 AgentSession 在任意时刻仅有一个有效 writer / prompt loop。每次调用携带 runId 与 generation，旧代回调不得操作新代。

**I-06** 子任务权限 = 父 Run 授权快照 ∩ 可委派工具 ∩ 子角色限制 ∩ 当前安全策略；不会因子任务 prompt 中出现关键词而新增权限。

**I-07** 费用上限由整个请求树共享；各节点预算之和不超过根预算，且每次 ModelCall 前必须预留。

**I-08** 完成结果以 `(taskId, attempt)` 唯一，投递回执以 `(recipientSessionId, resultId)` 唯一；传输允许重复，业务投影幂等。

**I-09** 任务终态、最终结果引用、Outbox 通知必须在同一事务内提交。大文件先原子落盘再提交引用，孤儿文件按 TTL 清理。

**I-10** 同一可写目录只允许一个 writer；并行实现任务进入独立副本，不能依赖模型口头约定避免冲突。

**I-11** 重连、刷新、切换模式不会新建第二个 Run；重复提交依 Idempotency-Key 返回原结果。

**I-12** Session 结束与进程结束分离：主回复完成不代表后台资源完成；资源都有租约、属主与回收责任。

## 4. 两种“结束”

SDK 的一个低层 `agent_end` 之后仍可能有重试、压缩重试或队列续接，不能立即把 Run 标为完成或清空授权。由 PiAdapter 核验的最终 settled / prompt 完成边界通知 SessionActor，后者在确认无在途工具调用后释放主工具面。

若存在子任务，Run 进入 waiting_children；主 Session 可继续处理用户的新问题。全部子任务结束后，按原 Run 标识聚合结果并投递一次摘要任务。关闭或归档会话时停止自动唤醒，但保留可查看的结果。

## 5. 并发与优先级

SessionActor 的队列优先级：强制撤销/取消 > 已接收的用户请求 > 结果汇总通知 > 非关键维护。实际模型流不中途重入；取消可通过 AbortSignal 旁路控制，结果在安全边界消费。v1 不支持在运行中无锁热替换工具面。用户新消息排队，有明确的“排队/取消当前”交互，不伪装成并发主对话。

## 6. 执行截止时间与后台租约

默认 root Run 的模型执行树上限 4 分钟，包括等待子代理和自动摘要。后台进程是显式创建的独立资源租约，默认最多 10 分钟；主 Run 可以在确认进程启动后完成，后台租约继续，且不自动延长原模型预算或唤醒模型。4 分钟不会被解释为允许长时间运行模型的 10 分钟。取消、封禁、会话关闭或紧急停止同时撤销仍存活的后台租约；已终态 Run 保留历史终态。

内部汇总 Run 用 `originRunId` 标记来源，并用 `budgetRootRunId` 指向原始 human 根 Run；费用、调用次数和 deadline 仍归原根预算，不能创建新根额度。人类根 Run 的 budgetRootRunId 指向自身。


---

<!-- SOURCE: docs/03-architecture.md -->

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


---

<!-- SOURCE: docs/04-tool-loading.md -->

# 04 · 显式按需加载详细设计

## 1. 核心合同

“0 常驻”定义为：**普通真实用户 Run 的实际模型请求 tools 集合中不存在 MyPI 扩展工具 schema**。扩展可以预注册在运行时；其可执行代码可以已加载到内存；历史里也可能有旧工具结果。这些不等于当前 tools schema 常驻，不能据此宣称总上下文开销为 0。

当前活跃集合：

```text
Surface(run) = fixedBaseTools
             ∪ { extensionTool | group ∈ run.grants
                                  ∧ tool registered by trusted owner
                                  ∧ resource gate satisfied
                                  ∧ deployment policy allows }
```

执行授权还要求：`principal active ∧ run generation valid ∧ lease valid ∧ parameter policy ∧ budget ∧ owner match`。任何一次调用都重新检查，而不是只在加载时检查。

## 2. 来源与生命周期

只在可信输入入口为用户提交创建 `HumanInputEnvelope {inputId, principalId, conversationId, rawText, source:human, receivedAt}`。服务器生成 source，客户端不能选择。CLI 也必须区分人类输入与自动 follow-up。保存未展开模板前的文本，不能仅对 `before_agent_start` 已展开后的 prompt 进行授权识别。

流程：输入入口/原始 input 钩子捕获 → 队列按 inputId 绑定 → Run 获取快照 → `before_agent_start` 应用已核验的判断 → 每次 provider 调用检查工具投影 → 最终 settled 后释放。钩子真实 API 以版本 Spike 为准。

一个用户 Run 可以包含多次模型调用、工具执行、自动重试和压缩。**不能在 SDK turn_end 或低层 agent_end 清空工具。** 下一条用户请求独立计算，不继承上一条 grant。后台结果的自动摘要运行 `source=task_result`，工具集为空，不参与匹配。

## 3. 确定性识别流水线

1. 输入上限 16 KiB；NFKC 归一化；去除零宽控制符；保存原文与归一化偏移映射，证据展示使用原文范围。
2. 识别并屏蔽 fenced code、行引用、行内代码和成对引号里的内容。代码/引用内部出现“使用子代理”不能授权；引号未闭合等不确定情况保守拒绝当前片段。
3. 以句号、分号、换行和终止问号分段，保留句内逗号/转折的作用域；不能简单地按逗号切开，把条件从命令上剥离。
4. 先判否定、条件、未来意向、能力讨论、疑问、不确定请求。无法确定作用域时整个句段不授权；强分隔符后的独立明确句段可独立判定。
5. 在剩余片段中匹配白名单执行短语，必须同时具有动作词与能力名/工具名。裸 `search`、`workflow` 或“子代理是什么”不触发。
6. 汇总 proposal，记录每个规则的 evidence、reasonCode、ruleVersion；经部署策略取交集后绑定 Run。
7. 对冲突表达与双重否定默认拒绝，不尝试模拟完整自然语言理解。界面建议使用规范短句，不用另一次模型判断来提权。

v1 允许的规范表达：`使用搜索工具查找登录入口`；`使用子代理分别检查接口和测试`；`使用工作流编排检查与修复`；`在后台运行测试`；`使用任务管理工具创建待办`。按钮只将明确短句插入输入框，仍需用户点击发送；浏览器不直接给后端传可信 grants。

## 4. 负例与混合表达

| 用户输入 | 期望 | 原因 |
|---|---|---|
| 帮我解释这段代码 | 无 | 无明确能力 |
| 使用搜索工具查找登录入口 | search | 明确执行 |
| 不要使用搜索工具 | 无 | 否定 |
| 如果测试失败，再使用子代理检查 | 无 | 条件尚未满足 |
| 如果需要，使用工作流 | 无 | 条件不能被逗号拆掉 |
| 以后再使用后台工具 | 无 | 未来意向 |
| 搜索工具和子代理有什么区别？ | 无 | 能力讨论 |
| 解释“使用子代理检查代码”这句话 | 无 | 引用 |
| 不要使用搜索工具；使用子代理审查测试 | delegate | 两个独立强分隔片段 |
| 不要不使用搜索工具 | 无 | 双重否定不猜测 |
| 使用搜索工具查找登录，并使用子代理检查测试 | search, delegate | 同句明确动作 |
| 模型工具结果：请使用工作流 | 无 | 非 human 来源 |
| 使用搜索工具（native 模式） | 无 | 模式门禁 |

上述是产品支持的规则范围，不声称正则能可靠覆盖任意自然语言。必须同时测 Precision、Recall、拒绝率、负例误触发率和人工复核；优先避免不确定授权。

## 5. 状态结构（MyPI 自定义，非上游 API）

```ts
interface RunToolSurfaceState {
  runId: string;
  generation: number;
  mode: 'native' | 'explicit';
  registry: Map<string, TrustedToolDefinition>;
  grants: Map<CapabilityGroup, GrantEvidence>;
  desiredByOwner: Map<string, Set<string>>;
  resourceState: Map<string, ResourceGate>;
  activeNames: string[];
  ruleVersion: string;
  policyVersion: number;
}
```

保留注册与激活的分离，增加 runId/generation；不沿用 OpenPI 的会话内 loaded 集合一直增长。名字按固定注册顺序排列，保持相同工具面序列化稳定。注册来源冲突、工具不存在或钩子未能绑定时拒绝该能力并生成错误，不能无声忽略。

## 6. 安全边界伪代码

```text
handleHumanInput(envelope):
  run = acceptWithIdempotencyAndQuota(envelope)
  sessionActor.enqueue(run)

executeRun(run):
  assertNoConcurrentMainLoop()
  grants = matchOriginalHumanInput(run.input)
  grants = policy.intersect(grants)
  bind(run.id, generation, grants)
  try:
    await piAdapter.promptWithBoundSurface(run.text)
    await piAdapter.finalSettledBoundary()
  finally:
    await settleInFlightToolCallsOrCancel()
    project(fixedBaseTools)  # 已有子任务使用独立 snapshot，不被误清理
    releaseMainRunGrants()
```

伪代码仅表达边界，不能复制为官方 SDK 示例。最终完成的实际信号、注册 ToolDefinition 的方式及系统提示词投影均须适配已锁版本。

## 7. 两层资源门禁

search：明确加载后开放 5 项；delegate：整组 6 项；workflow：整组 3 项；background：默认先开放 start，存在该会话已授权进程时追加 status/list/watch/stop；session：先开放 tasks_add/goal_create，存在资源时追加相应读改工具。

资源存在**不构成下一普通 Run 自动授权**。例如后台进程还在，用户下一句“解释这个错误”仍无 MyPI 工具；浏览器“停止任务”按钮可以调用经过鉴权的管理 API，不必让 LLM 拿到 stop schema。用户明确说“使用后台工具停止任务”时才在该 Run 展开对应管理工具。

## 8. 权限与可见性的诚实说明

native Bash 本来就可以做文件查找，因此“不激活结构化搜索工具”不是“禁止所有查找”。若用户明确禁止某种操作，需在任务遵循和部署策略中额外处理；不能声称隐藏工具能阻止 Bash 的所有等价行为。

避免绕过子任务/后台门禁：沙箱没有 MyPI 管理凭据、父进程 IPC、SDK 私有配置或模型 API Key；普通 bash 租约结束后清理整个执行 cgroup，不能借 `&` 留下无管控长期进程。资源隔离与网络限制必须真实生效。

## 9. 成本评测注意

Schema 变少可能减少某次请求的输入，但频繁变动工具集也可能影响缓存；系统提示词、旧工具调用历史和子任务额外调用仍有成本。记录实际 provider payload 摘要、工具 schema 字节、提供商 Token/缓存字段、费用与任务成功率；只对相同任务/模型/预算做公平比较，不预先写“降低 70%”。


---

<!-- SOURCE: docs/05-capability-spec.md -->

# 05 · 五个能力组与工具规格

## 1. 命名与通用合同

MyPI 工具使用 `mypi_` 前缀，避免覆盖原生工具或与其他扩展同名。共定义 25 个扩展工具。初次命中所有组且无任何资源时，entry 工具共 17 个；资源门禁全部展开后最多 25 个。四个基础工具在普通用户请求中另计；受限内部摘要是明确例外，全部工具为空。

所有 ID 由服务器生成并校验属主；path 必须是工作区相对路径；工具结果统一包含 `ok, data, error?, truncated, artifactId?, durationMs`，并转为 Pi 要求的 content/details 格式。文本返回默认上限 16 KiB，完整大结果私有落盘。错误包括 `NOT_AUTHORIZED / NOT_FOUND / INVALID_INPUT / LIMIT_EXCEEDED / TIMEOUT / CANCELLED / CONFLICT`。权限错误不给出其他用户资源是否存在。

输入 schema 必须有明确的长度、条目数、枚举、数字范围，禁止 `additionalProperties` 默认为无限制。调用 cancellation 信号贯穿文件、进程、子任务与模型请求。

## 2. search：结构化文件搜索与只读 Git

| 工具 | 关键输入 | 结果 / 限制 |
|---|---|---|
| mypi_search_files | pattern, root='.', maxResults≤100 | 相对路径、类型、是否截断 |
| mypi_search_content | query, paths?, glob?, regex=false, maxResults≤100 | file/line/column/snippet |
| mypi_git_show | ref, path? | 提交/文件摘要与产物引用 |
| mypi_git_diff | base, head?, paths? | 标准 patch、统计，限制输出 |
| mypi_git_log | path?, limit≤50 | commit、作者展示名、摘要 |

以结构化 argv 调用受控二进制，不拼 Shell。默认 literal 搜索；regex 开启时限定资源。Git 禁止外部 diff/textconv、禁止 hooks，使用受控配置与清理后的仓库；引用参数不能变成 flag。路径 realpath 检查和沙箱挂载同时使用；避免符号链接与检查后替换的竞态，安全打开方式需在执行器实现。

## 3. delegate：独立 SDK 子任务

| 工具 | 关键输入 | 行为 |
|---|---|---|
| mypi_subagent_spawn | title, prompt, role, writeMode, outputSchema? | 快速返回 taskId 与 queued/running，不等完成 |
| mypi_subagent_check | taskId | 一次快照，禁止高频自循环查询 |
| mypi_subagent_list | status?, limit≤20 | 当前会话任务摘要 |
| mypi_subagent_wait | taskIds≤4, timeoutMs≤30,000 | 事件 Promise 等待；不是轮询 |
| mypi_subagent_send | taskId, message | 在受控子会话安全边界排队，无并发 prompt |
| mypi_subagent_cancel | taskId | 请求取消并返回 cancelling / terminal |

允许角色 explorer/reviewer/implementer，但角色名不是权限。Web explorer/reviewer 默认只读快照，implementer 使用独立可写副本。子任务只能获得父 Run 可委派权限，默认不含 delegate/workflow/background/session，不能递归编排；可以继承已授权 search。用户只说“使用子代理”不自动授予 search 扩展，但子任务有按其角色限制的基础工具。

spawn 的任务请求携带根 budgetId、原始 grantId、workspace snapshot 与 generation。check/list 用于显式查看，不用于主 Agent 等待循环；只有用户要求“当前回复等全部结束”或机器端同步流程才使用 wait。

## 4. workflow：有界 JSON DAG

| 工具 | 输入 | 结果 |
|---|---|---|
| mypi_workflow_run | title, nodes, edges, failurePolicy | workflowId、节点初始状态 |
| mypi_workflow_status | workflowId | DAG 节点状态、结果引用、预算 |
| mypi_workflow_cancel | workflowId | 取消尚未开始及在途节点 |

节点类型 v1 仅 `agent`（独立 SDK Session）与 `aggregate`（确定性聚合）。单 workflow ≤6 节点、最大拓扑深度 3；并发不超过全局/用户预算。DAG 只接受 JSON，不执行用户提供的 JS 工作流代码。边传递有界结构化产物，不能把全部子历史拼接给下游。

Workflow 加载本身授权服务端有界调度节点，但不把 delegate 工具暴露给模型；内部节点调度不通过模型隐藏调用 subagent_spawn。节点权限只能收窄 workflow Run 的快照，禁止生成未授权工具。

`failurePolicy=stop` 为默认；`continue_independent` 允许无依赖分支完成，但下游依赖失败时标记 skipped。只读节点可按显式策略重试一次；写入节点默认不自动重试、不自动 Replay。

## 5. background：长期进程管理

| 工具 | 输入 | 行为 |
|---|---|---|
| mypi_bg_start | title, command, cwd='.', ttlSeconds≤600 | 返回 processId；无 stdin |
| mypi_bg_status | processId, tailLines≤100 | 状态、退出码、最新日志 |
| mypi_bg_list | status? | 自己当前会话的进程 |
| mypi_bg_watch | processId, event='exit'/'pattern', pattern?, timeoutMs≤30,000 | 基于日志/退出事件等待，不反复调用 status |
| mypi_bg_stop | processId | TERM→宽限→KILL 整个进程树/cgroup |

后台不是线程概念混用：这里是真正受控 OS 进程。日志有容量上限与轮转， stdout/stderr 保留来源，清洗 ANSI 控制序列。匹配 pattern 有长度和执行预算；默认字符串包含匹配，不接受高风险复杂正则。若 public profile 下普通代码启动 dev server，不提供公网端口；只可在受限预览通道访问明确端口，首版默认不启用。

资源存在后才开放 deferred 工具；该组下一 Run 仍需明确授权。会话关闭、封禁、超时和服务关停均触发清理。断开浏览器不会让 TTL 无限延长。后台租约可超出已完成主 Run 的生命周期；主 Run 的模型树截止时间不因此延长，详见 02 第 6 节。

## 6. session：工作项与目标

| 工具 | 输入 | 结果 |
|---|---|---|
| mypi_tasks_add | title, description?, acceptance? | workItemId，默认 todo |
| mypi_tasks_update | workItemId, expectedVersion, status?, evidence? | 新版本；冲突 409 |
| mypi_tasks_list | status?, limit≤50 | 工作项，不等于子任务 |
| mypi_goal_create | title, successCriteria≤10 | goalId，唯一 active goal 可选 |
| mypi_goal_get | goalId? | 当前目标与证据 |
| mypi_goal_update | goalId, expectedVersion, status?, evidence? | 版本化更新 |

todo/doing/done/blocked 描述计划。标记 done 需说明执行证据或明确“仅用户标记”；不能把计划里的“完成测试”渲染为测试已通过。Goal 不触发无期限自主循环，任何继续执行仍需已有 Run 授权和预算。

## 7. 基础工具适配

保留 read/write/edit/bash 四个名称及 Pi 预期使用方式，但公开 Web 部署的执行实现路由到 SandboxPort。不能一边把扩展沙箱化，一边让原生 bash/read 在 Worker 宿主机执行。差异结果应兼容标准 patch；写入需原子替换、预期文件版本与限额；Bash 无交互 stdin、单次默认 30 秒、公共上限 60 秒。

原生工具适配的实际 SDK 接入点须通过兼容 Spike 验证。若锁定版本不能安全重定向全部基础工具，公开 profile 不可启用，不允许回退成本地原生执行。


---

<!-- SOURCE: docs/06-parallel-and-workflow.md -->

# 06 · 子任务并行、事件回传与工作流

## 1. 主流程

```text
用户：使用子代理分别检查登录接口和测试，主会话继续解释架构。
主 Session → spawn A → 立即返回 taskA
           → spawn B → 立即返回 taskB
           → 继续其他分析 → 主 Loop settled
子 Session A ────────→ 完成 → 事务写 Task/Result/Outbox
子 Session B ───────────────→ 完成 → 事务写 Task/Result/Outbox
Outbox → 前端任务卡；ResultInbox → SessionActor（安全边界）
SessionActor → 批量汇总原 Run 结果 → 最终摘要
```

每个子任务创建新的 Pi SessionManager 和 SDK Session，不能共享主会话 messages 数组。传递的上下文只有任务描述、必要摘要、文件快照引用、输出约束与权限快照；不默认复制主会话全部历史。

## 2. 异步语义与主会话可继续

spawn 返回仅表示已接收，不能立即显示成功。异步任务可以在主 Loop 停止后继续；主 Agent 无其他事可做时结束当前输出，而不是 while(status!=done)。UI 始终可以取消原 Run 或子任务。

同一主会话不能真的同时执行两个 SDK prompt。所谓“主 Agent 可继续”是：子 Session 与主 Session 并行，主 Session 自己仍由 Actor 串行化。用户在主 Loop 忙时发消息会排队，不能直接重入 SDK。新用户 Run 不继承旧 Run 的扩展授权。

## 3. 子任务上下文与权限

默认角色策略：explorer/reviewer 仅只读副本；implementer 在独立项目副本写入。read/edit/bash 等具体调用权限通过角色和 Sandbox profile 控制，不能凭“reviewer”这个名字假定只读。

grant snapshot 在 spawn 时冻结，记录 parentRunId / rootRunId / policyVersion / allowedTools / writeScope / deadline / budgetId。后续用户普通问题的卸载不取消已合法启动的子任务；管理员封禁或紧急停止属于 revocation，立即传播到整棵执行树。

子任务不运行意图识别器，不因内部 prompt 包含“用子代理”而递归开放能力。默认 depth=1，workflow 节点由调度器控制而非节点模型递归发起。

## 4. 结果与 Inbox

结果记录：`resultId, taskId, attempt, originRunId, recipientSessionId, status, summary, evidence[], artifactIds[], usage, producedAt`。summary 默认 ≤4 KiB，evidence 有数量和单条长度上限。输出 schema 校验失败要明确 failed，不能以空结构假装成功。

原始日志和完整回复放私有产物，仅传有界摘要给主 Agent。子结果当作不可信数据展示，不提升为 system instruction。保存结构化完成结果，不展示不可取得的模型内部推理。

事务中将任务置终态、引用结果、插入 Outbox；通知丢失时由恢复扫描重发。客户端和主会话各自有消费游标/回执。保证 at-least-once 投递 + 幂等消费，不承诺分布式 exactly-once 模型调用。

## 5. 结果归属与自动汇总

以 `originRunId` 聚合，不将旧子任务误附到用户最新问题。子任务完成立即推送状态，无需等待模型。主会话忙时不强行插入旧结果；最终全部结束后，等待安全空闲边界，按原任务标签生成摘要。

自动摘要是一种受预算控制的内部 Run：`source=task_result`，tools=[]，不运行匹配器，不授予旧扩展。摘要只整理已产生证据，不继续写代码或启动任务。每个原 Run 最多一次自动最终摘要；批量合并同时到达的结果。如果预算不足，直接展示确定性结果列表，允许用户用新请求追问。

会话已归档、原 Run 已取消、用户已删除历史或已撤销权限时，不再自动唤醒主模型。结果可在允许的保留期内查看，不绕过安全撤销。

## 6. 并行写入与合并

v1 公开演示采用**独立文件副本/快照**，不让多个写任务共享同一可写目录。子任务结果为 patch + baseRevision，不直接覆盖主项目。主 Agent 或确定性合并服务在 workspace 写锁下确认 baseRevision 未变化，再应用 patch；冲突返回需要确认，不自动覆盖。

本地 Git 项目可以选择 worktree 优化，但 worktree 共享部分 Git 元数据，不当作安全边界。对于不可信公开代码，优先独立仓库/副本，禁用用户 Git hooks 与危险配置。写入快照内可执行测试，产物合并仍遵守版本检查。

## 7. Workflow 调度

服务端先验证节点 ID 唯一、边合法、无环、节点数/深度受限、总预算可分配；然后按就绪节点集合启动。每个 agent 节点是独立 SDK Session；aggregate 节点仅消费预期字段。依赖输出带 schemaVersion，不能直接 eval 或执行脚本。

调度算法：计算 indegree → 将 ready 节点入公平队列 → 竞争用户/全局并发许可 → 执行 → 事务记录终态 → 释放许可 → 激活后继。父 orchestrator 不占用模型并发槽位等待子任务，避免持有所有槽位形成死锁。

v1 不实现“恢复即自动重放所有节点”。重启后已完成只读结果可读取，未完成写入节点标 interrupted；用户显式恢复时新建 attempt，核对副作用与 baseRevision。

## 8. 取消与崩溃

取消顺序：写 cancel_requested → 撤销 lease → AbortSignal 取消模型请求 → Broker 终止进程树/cgroup → 有界等待 → 确认终态 → 清理副本与租约。无法立即确认终止时展示 cancelling，不伪装 cancelled。

Worker 崩溃后，Gateway 仍可显示最后快照与中断状态；Broker 根据 TTL 清理无主资源。启动时检查非终态 runs/tasks 和未消费 Outbox，执行保守恢复。提供商可能已计费但未回传 usage 的请求保持 usage_unknown 并保留预留额度，不能直接释放全部预算。

## 9. 必测竞态

子结果恰好在主 Loop 收尾到达；最后两个结果同时到达；重复回调；主会话已切换 generation；取消与完成同时提交；任务排队期间用户封禁；父请求预算耗尽而子节点准备调用；SQLite busy；结果落盘成功但数据库事务失败；SSE 已断开；进程 fork 后父进程退出。每种场景必须给出状态与清理证据。


---

<!-- SOURCE: docs/07-security.md -->

# 07 · 安全设计与匿名访问防滥用

## 1. 上线原则

允许匿名访问界面，不等于匿名无限执行。Pi 默认继承启动进程权限，独立 Session 不是 OS 沙箱（参考 00 的 S1/S2）。**公网安全执行是发布阻断项，而不是后续优化。** 无法证明隔离、限额和清理生效时，页面可展示离线原型或只读演示，但不能静默切回宿主机执行。

威胁主体包括恶意游客、自动化请求、伪造工具指令、恶意项目/依赖、被攻破的普通用户会话，以及误操作管理员。目标资产包括模型 API Key、宿主机文件、其他游客数据、服务可用性、预算和管理员凭证。

## 2. 匿名身份与管理员身份

游客首次通过 `POST /api/v1/guest-sessions` 获取服务器生成的随机 opaque token，服务器仅保存 hash，Cookie 使用 `__Host-mypi_guest`、HttpOnly、Secure、SameSite=Lax、Path=/，无 Domain。请求体不接受 principal_id 或角色。身份有效期 24 小时；清除 Cookie 后视为新访客，但设备/IP/全站额度不因此无限重置。

管理员走独立 `/admin/login` 和独立 Cookie，不用游客 ID 升级，不把 admin=true 放 localStorage。首次管理员通过服务器 CLI 创建，无默认密码；密码使用经审核的密码哈希库；登录有逐账号/IP 限流和失败退避，推荐部署层限制管理入口并开启第二因素。后台写操作检查 CSRF Token + 精确 Origin，重新确认敏感操作；修改模型凭据、提高配额、解禁或关闭安全开关必须审计。

前端输入不能选择 system/developer/tool 角色。服务端只将 `text` 当作用户消息；角色、session source、工具定义、模型地址、预算与文件根目录全部由服务器确定。不能把客户端发送的整段 history 原样交给 SDK。

## 3. 信任域与执行隔离

| 信任域 | 可持有 | 不可暴露给 |
|---|---|---|
| Gateway / Worker | 模型配置、短期凭据、私有会话与审计 | 可执行工作区、浏览器 |
| Broker | 固定模板启动权限、rootless runtime 管理入口 | 模型工具或游客 |
| 代码沙箱 | 单用户项目、预置工具链、受限临时文件 | 其他项目、控制面、宿主 home |
| 产物预览 | 被授权的静态产物 | 管理员 Cookie、主站 DOM |

基本沙箱条件：非 root；不挂载 docker.sock；禁止 host network / host pid / privileged / arbitrary devices；只读系统根目录；可写空间仅 workspace 和有大小上限的 tmp；移除 capabilities；启用 no-new-privileges、seccomp 和可用的强制访问策略；硬性 CPU、内存、pids、文件大小与磁盘额度；默认无外网。

rootless 降低 daemon/runtime 权限风险，gVisor 可提供额外隔离，但两者都不等于“绝对无法逃逸”（S12/S13）。在实际服务器上验证兼容性与 cgroup 限制。公开任意代码执行优先使用强化隔离或独立执行主机；普通容器不是唯一防线。

## 4. 文件与进程安全

工作区 ID 从属主查库解析，不接受 `/home/...` 绝对路径。拒绝目录穿越、编码绕过、符号链接逃逸、危险 hardlink 和归档链接；对于检查后替换竞态使用安全文件打开机制与最小挂载双重防御。下载时重新鉴权，不直接拼接用户 path 读盘。

Native read/write/edit/bash、search、子任务、workflow 和后台都必须经同一个执行边界；禁止只拦截新增工具而漏掉原生 Bash。普通 Bash 每次有独立执行租约和 cgroup，超时/完成后清理后代进程；后台进程只能由有授权的 BackgroundService 领取长期租约。

禁用自动加载工作区 `.pi/extensions`、`.pi/settings.json`、MCP 配置、可执行 Skills 和任意插件。公开工作区 AGENTS.md 仅作为不可信项目内容参与模型理解，不作为权限或启动配置。私有 Agent Session JSONL、密钥、SDK 配置与 Broker socket 均不挂载进沙箱。只靠环境变量隐藏密钥不够：代码所在权限域根本不能获得密钥。

## 5. 网络与 SSRF

沙箱默认 network=none 或等价隔离；模型请求由可信 Worker 发出，不从沙箱发出，因此代码无法借模型网络偷传文件。关闭元数据端点、loopback、RFC1918、链路本地、IPv6 本地及内部服务可达性；这些由网络层执行，不仅检查 URL 文本。

管理员配置提供商 base URL 也需要防 SSRF：HTTPS、预批准域名/端口、DNS 解析和重定向逐跳检查、私网禁用、连接 deadline、返回体限制。v1 公共管理界面不能随意填写内网 URL。合法私有模型网关属于受信部署配置，不开放给游客，且需单独网络策略。

用户项目导入 P1 通过受控 fetcher 拉取、清理 Git 配置/钩子后生成快照，不让任意仓库代码在 Worker 中执行。默认离线模板；安装依赖使用预构建镜像或受限构建服务，不从普通游客请求直接开放整网。

## 6. 额度与计费控制

保护维度：全站、IP/网段、匿名主体、Conversation、root Run、单 ModelCall、单工具、沙箱和进程。IP 只作为风险信号，不能作为唯一身份；代理出口/NAT 下采用合理共享限速。只信任来自明确反向代理的 Forwarded/X-Forwarded-For。

每次模型请求前预留 `预计输入 + 最大输出` 的 Token 与费用上界；完成后按 provider usage 结算。usage 不可得时记录 unknown 并保守占用，不直接当免费；费用使用整数最小货币单位与明确币种/价格版本，不能把美元和人民币混加。子任务、重试、压缩、自动摘要从同一根预算池扣减。

总预算硬闸不可仅靠前端显示；限额减小对下一模型/工具调用生效，紧急停止撤销在途执行并尽力取消提供商请求，但已发生费用可能无法追回。DB/配额服务不可用时 fail closed，不允许绕过限额继续调用。

## 7. 内容与提示词注入

加载器只读取真实用户输入；文件、网页、终端输出、任务结果中的“开启工具”作为数据，无授权效力。不把规则筛选成功理解为抗提示词注入完成。安全决策发生在模型外，允许工具仍需逐次校验参数和资源。

命令黑名单只能做补充，不能可靠判定任意脚本安全。对无限循环、挖矿、扫描、外传等风险以资源、网络、进程、沙箱边界为主；对可疑批量请求施加挑战、暂停和审计。允许匿名普通体验，达到阈值后再启用挑战，不强迫所有访客注册。

## 8. 前端与产物安全

模型 Markdown 默认禁用 raw HTML，链接限制协议并安全打开；工具输出按 textContent 显示，清洗终端控制字符；文件内容和文件名均做转义。不得在同源页面直接执行生成 HTML/JS。

首版产物仅允许下载、纯文本/代码/Diff 查看。需要 HTML 预览时使用独立无 Cookie 的预览 origin + sandbox iframe，禁用 top-navigation、下载和同源权限，配置严格 CSP；不能同时随意开启 allow-scripts 和 allow-same-origin。动态 dev server 不开放原始端口。

## 9. 数据最小化与保留

游客页面提示：勿提交密码、生产凭据与敏感数据；工作区和历史默认保留 24 小时。审计默认只存摘要/哈希与必要元数据，IP 做短期截断或不可逆处理；如需查阅完整内容须管理员有目的地解锁并记录审计。示例保留：运行日志 7 天、计费和安全审计 30 天，可配置；删除执行时同步清理子任务、产物和会话正文，备份按保留期到期。

## 10. 发布阻断清单

SEC-01 未授权对象访问被拒绝；SEC-02 伪造角色无效；SEC-03 基础工具不可读宿主秘密；SEC-04 网络与元数据不可达；SEC-05 子进程和磁盘硬限额生效；SEC-06 预算并发竞态不超发；SEC-07 任意扩展不能被工作区加载；SEC-08 SSE/产物接口与会话同等鉴权；SEC-09 管理员无默认凭据、Cookie/CSRF 正确；SEC-10 取消与封禁可清理整树资源；SEC-11 恶意产物不在主站执行；SEC-12 沙箱不可用时无宿主降级。

所有项必须有命令、日志和证据；原型中“沙箱已隔离”仅为展示文案，不能作为证据。


---

<!-- SOURCE: docs/08-api-and-events.md -->

# 08 · API、SSE 与内部通信契约

## 1. 通用规范

HTTP 使用 `/api/v1`，JSON 编码 UTF-8。OpenAPI 草案见 `contracts/openapi.yaml`。时间 ISO 8601 UTC，ID 为服务器生成 UUID，路径 ID 永远结合属主查询。分页 `cursor + limit`，默认 20、上限 100；错误包含 code/message/requestId/retryable/details，不回显密钥、SQL 和宿主路径。

所有写操作检查 Origin 和 CSRF（首次游客引导检查 Origin）；身份由 HttpOnly Cookie 推导。Cookie 中不塞模型配置。`Idempotency-Key` 用于创建 Run、创建工作流等有副作用的操作；以 `(principal, route, key)` 绑定 request body hash，同 key 不同 body 返回 409。

## 2. 主链路端点

| 方法 / 路径 | 用途 | 重要约束 |
|---|---|---|
| POST /guest-sessions | 创建/复用当前游客身份 | 不重复发放额度，签发 Cookie |
| GET /me | 身份、额度、允许模型、安全 profile | 不返回密钥/内部路径 |
| GET/POST /conversations | 列表/新建会话 | 模板由服务器白名单选择 |
| GET/PATCH/DELETE /conversations/{id} | 快照/改标题或模式/删除 | busy 时删除变清理任务，模式下 Run 生效 |
| POST /conversations/{id}/runs | 提交人类消息 | 只接收 text/modelId/mode；202 |
| GET /conversations/{id}/events | SSE + Last-Event-ID | Conversation 级有序，鉴权每次重连 |
| GET /runs/{id} | Run 最终或当前快照 | 不用于前端定时轮询 |
| POST /runs/{id}/cancel | 取消请求树 | 控制面操作不调用 LLM |
| GET /conversations/{id}/tasks | 获取子任务快照 | 前端恢复时一次请求 |
| POST /tasks/{id}/cancel | 取消单子任务 | 只有 owner/admin |
| GET /conversations/{id}/workspace | 文件树 | 有界条目、相对路径 |
| GET /conversations/{id}/file?path=... | 文本预览 | 路径校验、文件大小上限 |
| GET /artifacts/{id}/download | 下载产物 | 属主校验、Content-Disposition |
| GET/POST /admin/... | 管理能力 | 独立管理员身份，详见 11 |

v1 没有通用 `/exec`、任意路径 `/read`、任意 SQL 查询或 `/install-plugin` 公共端点。用户只通过 Agent 发起任务，控制面只暴露有界停止/读取接口。

## 3. 提交请求

```json
{
  "text": "使用搜索工具查找登录入口，并使用子代理检查相关测试",
  "modelId": "00000000-0000-4000-8000-000000000003",
  "mode": "explicit"
}
```

拒绝 `role, messages, cwd, tool_names, grants, provider_url, api_key, max_budget, source` 等未定义字段。模型选择必须属于管理员允许的列表；客户端声明模式不意味着可跳过安全 profile。

202 返回 `runId, conversationId, status, queuePosition, effectiveMode, configVersion`。同一幂等键返回同一 Run，不因 SSE 重连再次提交 prompt。两个浏览器标签同时提交时分别排队，依 SessionActor 顺序执行。

## 4. SSE Envelope

```text
id: 107
 event: tool.surface.changed
 data: {"schemaVersion":1,"eventId":"evt...","sequence":107,
        "conversationId":"...","runId":"...","occurredAt":"...",
        "payload":{"mode":"explicit","baseCount":4,"extensionCount":5,
                   "groups":["search"],"reason":"明确使用搜索工具"}}
```

实际 SSE 行不保留示例的缩进；每条事件以空行结束。前端按 sequence 去重，断线 `Last-Event-ID` 从最后已应用序号继续。每个 Conversation 事件序号单调递增，不要求跨会话全局排序。

事件类别：`run.accepted / queued / started / state.changed / completed`；`message.delta / message.completed`；`tool.surface.changed / tool.started / tool.output / tool.completed`；`task.created / state.changed / result.ready`；`workflow.updated`；`process.updated`；`artifact.created`；`quota.updated`；`policy.revoked`；`error`；`stream.reset`。完整数据结构见 `contracts/events.ts`。

## 5. 重连、丢包与背压

客户端首次获取 ConversationSnapshot，其中含 `lastSequence`；随后以该 cursor 订阅 SSE。服务端必须桥接快照与订阅之间的窗口，不漏掉中间事件。提供商文本 delta 合并后先持久化再推送。写队列拥塞时可丢弃可替代进度快照，不可丢弃 final/错误/取消；无法追上则主动断开让客户端恢复。

心跳使用 SSE comment，不污染业务序号。示例 heartbeat 15 秒、客户端指数退避到 30 秒；这不是任务状态轮询。事件保留已过期时发送 stream.reset 并关闭，客户端取最新快照恢复，不持续请求不存在的序号。访客封禁、Cookie 过期后终止连接且重新鉴权。

SSE 连接只读，所有变更用 POST/PATCH；不使用 GET 发起任务。公网禁用缓存与代理缓冲，限制每主体连接数（例如 3），代理/read timeout 大于 heartbeat。

## 6. 内部 Worker/Broker 契约

Gateway→Worker 用 Unix Socket + 本机文件权限验证服务身份。命令包含 `commandId, principalId, conversationId, runId, generation, policyVersion, deadline`，这些字段仅可信 Gateway 可写。命令去重、帧大小上限、协议版本与关闭处理必须实现。

Worker→Broker 不发送原始 Docker 参数；只能选择预定义 profileId 和 workspaceId，并调用 provision/exec/cancel/release。Broker 二次校验租约、Run 授权、命令长度、资源上限和路径。沙箱本身不能主动调用这条控制通道。

CLI 直接调用同样的 AgentService Port，不绕一圈启动 Gateway。契约类型属于 MyPI 自定义，不是 Pi SDK 原生 HTTP 协议。

## 7. 错误映射

400 INVALID_INPUT；401 AUTH_REQUIRED；403 POLICY_DENIED/CSRF_FAILED；404 RESOURCE_NOT_FOUND（含跨主体访问）；409 RUN_CONFLICT/VERSION_CONFLICT/IDEMPOTENCY_CONFLICT；413 PAYLOAD_TOO_LARGE；429 QUOTA_EXCEEDED/RATE_LIMITED；503 SANDBOX_UNAVAILABLE/MODEL_UNAVAILABLE/SERVICE_PAUSED。返回 retryAfter 仅用于安全可重试请求；副作用不确定时返回需要人工核对的状态。

## 8. 终态 Run 与资源租约

`POST /runs/{id}/cancel` 也可用于撤销该 Run 派生的仍存活后台租约。若 Run 已是终态，保留原终态，只取消存活资源并返回清理状态；重复请求幂等。UI 需区分“主请求已完成”与“仍有后台资源”，不把资源回收解释为逆转已完成结果。


---

<!-- SOURCE: docs/09-data-and-storage.md -->

# 09 · 数据模型、存储与一致性

## 1. 存储划分

SQLite WAL 保存身份、会话元信息、Run、工具决策、任务、预算、事件与审计。Pi 原生会话历史存放在 Worker 私有目录，作为 SDK 历史事实源；Web messages 是其事件投影，不由浏览器重新提交历史。工作区文件与产物独立保存，不能与 SDK auth/config 同目录挂载给代码。

`contracts/schema.sql` 是可执行的 SQLite 数据模型草案，已通过语法建表检查不等于完成 ORM/迁移实现。生产实现需增加升级迁移、回滚策略和压测。

## 2. 主要实体关系

```text
Principal 1─N AuthSession
Principal 1─N Conversation 1─N Run 1─N AgentTask 1─N TaskResult
                       │        │           └─N ResultInbox
                       │        ├─N ModelCall / CapabilityDecision / Artifact
                       │        └─N Workflow 1─N WorkflowNode
                       ├─1 Workspace
                       ├─N WorkItem / Goal / BackgroundProcess
                       └─N StreamEvent
Principal 1─N QuotaBucket 1─N QuotaReservation / QuotaAdjustment
所有关键变更 → Outbox + AuditEvent
```

子任务、工作流、后台进程和产物必须绑定 rootRunId 和 owner；便于整树取消、预算核算、归因与删除。只记录 parentTaskId 而不记录根归因容易漏算调用。

## 3. 重要字段

Conversation：mode、defaultModelId、status、ownerId、workspaceId、createdAt、lastSequence、version。
Run：inputId、idempotencyKey、requestHash、source、modeSnapshot、ruleVersion、policyVersion、modelConfigVersion、status、generation、deadline、budgetRootRunId、originRunId、errorCode。
CapabilityDecision：group、decision、reasonCode、原始文本证据范围、ruleVersion；为了隐私可仅保留短片段，不永久存整段 prompt 副本。
ModelCall：providerRequestId、rootRunId、taskId、attempt、tokens input/output/cache、currency、priceVersion、estimated/actual microCost、usageStatus；tokens 不凭空补齐。
ResultInbox：recipientSessionId、originRunId、resultId、status、claimedAt、deliveredAt、deliveryAttempt；唯一键防重复投递。
Artifact：sha256、MIME、size、relativeStorageKey、ownerId、scanStatus、expiresAt；外部只见 artifactId。

## 4. 事务边界

T1：检查幂等键/请求配额 + Run accepted + 用户消息元数据 + Outbox accepted。请求完全相同时复用 Run，不重复扣 root quota。

T2：ModelCall 前在单个短事务中检查全局/用户/Run budget 并预留上界；实际调用发生在事务外；完成后另一个事务结算。重试是新的 call attempt，不能覆盖原费用。

T3：Task 终态 + Result 引用 + Inbox + Outbox 同事务。结果文件先落临时文件→fsync/原子 rename→提交引用；失败残留按孤儿清单清理。

T4：管理员策略发布 + version + audit + outbox。同一事务发布配置快照；Run 使用快照，安全撤销可在调用时按最新禁止策略收窄。

T5：幂等取消标志 + revoke lease + Outbox，实际 kill 异步执行；确认退出后记录终态。不能在 DB 事务内等待进程退出。

## 5. SQLite 并发策略

v1 单 Worker 会话所有权，不开多个无协调 worker。数据库事务保持短，配置 busy_timeout；更新使用 expectedVersion；添加外键、唯一键和合理索引。不得在事务内等待模型、工具或用户。SSE 高频文本合并批量写入，限制日志体积。

quota 预留通过事务更新带条件的余额，不能“先查余额→异步调用→再扣”；两个并发子调用会超发。失败调用是否收费与是否有 usage 单独记录，不简单按 HTTP 状态判断。

## 6. 文件写入冲突

Workspace 保存 revision；主写操作携带 expectedRevision。并行子任务从 baseRevision 派生独立快照，返回 patch；应用 patch 在 workspace 写锁下验证 baseRevision。相同文件同时改动返回 conflict，保留两份 patch，不能静默最后写入覆盖。

文件索引不是授权系统：每次读文件/下载仍结合 owner/workspace/沙箱边界。绝不以 path 前缀判断代替安全打开与挂载隔离。

## 7. 恢复与删除

启动检查未终态 Run/Task/Process 与过期 lease；确认执行器实际状态后标 interrupted/cleanup_pending，不盲目复活。Outbox 可重发；Inbox 按唯一键去重；unknown usage 保守保留额度待结算。

删除 Conversation 先标 deleting、禁止新调用、取消整个资源树；清理文件、SDK 私有历史和产物后写 tombstone 并终止 SSE。审计保留必要去标识元信息，避免将已删除内容长期藏在 debug 日志中。

WAL 模式备份不能随意只复制主 db 文件；采用 SQLite 一致性备份接口或受控 checkpoint/停写快照，记录同批次产物清单。恢复演练包含数据库与文件快照是否一致。

## 8. 审计与内部汇总归因

Run 的 `budget_root_run_id` 为预算归属，人类根请求指向自身；内部汇总还必须设置 `origin_run_id`，不能因另建 Run 重领额度。`model_call.root_run_id` 始终保存预算根 Run，不保存汇总 Run ID；执行归属另用 `execution_run_id` 保存。Conversation 的 `default_model_id` 是当前默认配置，执行使用 Run 上的版本快照。

手动增加或减少配额写入 `quota_adjustment`，记录增量、管理员、理由与幂等键；更新 bucket 限额与追加流水同事务，不覆盖已消费数量。负向调整不得让已发放/预留记录消失，后续调用根据新限额拒绝。


---

<!-- SOURCE: docs/10-frontend.md -->

# 10 · 前端功能与交互设计

## 1. 页面信息架构

`/` 直接进入 ChatWorkspace；`/c/:conversationId` 恢复自己的会话；`/admin/login` 管理员登录；`/admin/overview` 概览；`/admin/models` 模型；`/admin/visitors` 游客；`/admin/policies` 额度与规则；`/admin/executions` 沙箱/任务；`/admin/audit` 审计。无营销首页拦截。

导航分为会话区与管理员区。游客在真实系统不能通过侧边栏直接进入后台；原型单独弹出“后台演示”提示后允许体验，不构成真实登录。

## 2. 桌面布局

左侧 216~232 px 会话栏；中间弹性聊天列，正文最大宽度 780 px；右侧 300~340 px 检查面板。页面总高 100dvh，聊天区内部滚动，输入框固定在中间列底部。头部显示会话标题、工作区、安全 profile、模式和模型。

首屏中间提供任务输入及三个示例：普通编码、显式搜索、并行检查。右侧默认展示“基础工具 4 / 扩展工具 0”和五组状态，访客无需阅读说明就能理解区别。

## 3. 对话

Composer 支持 Enter 发送、Shift+Enter 换行，IME composition 时不误发送。输入下方显示仅供预览的匹配结果：将激活 search，或“条件表达，不激活”；真实结果以服务器事件为准。

模式选择只有原生/按需；运行中修改只设置 nextRunMode，有提示不改变当前 Run。能力按钮插入可读命令短句，不在后台偷偷新增授权。没有模型配置、额度不足、服务暂停和沙箱不可用均给出明确的可恢复/不可恢复状态。

运行开始显示 accepted/queued/running；取消按钮等待服务端确认。流式文本与工具卡交错展示，工具参数默认折叠；不展示虚构的“模型内心思考”。完成时提供变更摘要、测试证据、产物入口与未完成事项。旧子任务返回显示对应原任务标题。

## 4. 右侧检查面板

- 运行轨迹：触发片段→能力批准/拒绝→工具开始/结束→预算变化；时间线不伪装精确思考过程。
- 并行任务：任务角色、状态、用时、上下文独立说明、结果和取消入口；排队不显示为运行。
- 文件变更：文件树、只读代码、标准 diff 与产物；原型包含本地示例文件，真实版从鉴权 API 读取。

任务面板依赖 SSE 驱动，不定时轮询。浏览器刷新先恢复快照再接续事件。用户手动刷新是一次状态查询；错误界面保留已获得内容，不清空整段对话。

## 5. 后台交互

概览区显示游客量、运行量、模型调用、预算和异常；必须区分“无数据”和“0”。模型表展示显示名、provider、modelId、可用状态、公开可选、最近测试结果；新增和编辑弹窗校验 URL/模型名，API Key 仅写入。

游客表可搜索、封禁、调整额度、查看其运行；敏感查阅留审计。策略页包括 daily requests、Tokens、并发、timeout、工具组允许列表、规则试验台与发布版本。执行页支持紧急停止，并显示影响范围确认框。

## 6. 状态矩阵

| 场景 | 用户看到 | 前端行为 |
|---|---|---|
| 未 bootstrap | 正在建立临时身份 | 禁止发送，有限重试 |
| 模型未配置 | 管理员尚未开启在线演示 | 保留示例/只读模式，不伪装在线 |
| 配额耗尽 | 今日额度已用完 | 禁用执行，不禁用查看历史 |
| 服务暂停 | 公开执行暂时暂停 | 取消/清理状态继续可看 |
| 断流 | 连接中断，正在恢复 | Last-Event-ID 续传，不重发 prompt |
| 事件过期 | 已恢复会话快照 | 合并最终数据，不重复消息 |
| 子任务失败 | 部分完成及失败原因 | 保留成功结果与可下载 patch |
| 删除会话 | 正在清理工作区 | 不允许新 Run，等待清理确认 |
| 跨用户资源 | 资源不存在或不可访问 | 不泄露对象详情 |

## 7. 原型范围

本包原型实现导航、输入、两种模式、共享规则函数、模拟 SSE 式事件、模拟并行子任务、取消、代码查看/导出、后台模型/游客/策略表单。原型仅使用本地 Mock，不连接网络、不执行 Shell、不持有 API Key。数据可重置，所有统计标注“演示”。

真实前端建议封装 ApiClient 和 EventReducer，先用 Mock adapter，后切真实 HTTP adapter；不得把接口授权搬到浏览器。现有 HTML 用于交互对照，不要求照抄其 DOM 架构到 React。


---

<!-- SOURCE: docs/11-admin.md -->

# 11 · 管理后台规格

## 1. 目标

管理员能清楚回答：谁在使用、使用什么模型、为什么加载某工具、执行了什么、消耗多少、是否越界，以及怎样停止。后台不是任意远程脚本控制台。

## 2. 模型管理

字段：displayName、providerType、modelId、approvedEndpointId、enabled、publicSelectable、defaultForGuests、input/output pricing、currency、contextWindow、maxOutputTokens、timeout、reasoning 配置白名单、版本。

API Key 使用服务器主密钥加密或受控 Secret Store；主密钥不进入数据库备份、不进入工作区或前端。GET 仅返回 keyConfigured 与掩码指纹；编辑空值表示保持不变，独立 clear 操作表示删除，避免把空字符串误当清空。

“连接测试”是受限管理调用：指定小输出预算、禁止任意工具、固定短输入、计入管理费用并留审计。测试失败的模型不能设为游客默认。禁用当前默认模型时要求指定替代或明确关闭公开执行。仅兼容锁定 SDK 实际支持的 provider adapter，不承诺任意 OpenAI-compatible 接口完全兼容。

模型配置新版本对新 Run 生效；禁用/撤销密钥对下一实际调用立即检查。正在进行的提供商调用尽力取消，不能保证撤回已发生费用。不要在同一个 SDK Session 流式过程中无锁切模型。

## 3. 游客管理

查看匿名编号、创建/最近访问时间、请求/Token/费用、并发 Run、风险标记和封禁状态。默认不展示完整 IP；查看必要安全细节须额外权限与审计。

封禁操作包括 reason、expiresAt、cancelActive=true；服务器拒绝新运行，撤销活动 lease，推送 policy.revoked。解除封禁不自动增加余额、不恢复已取消进程。手动调整额度以 adjustment ledger 记录，不能直接覆盖已消费事实。

删除访客数据异步清理工作区/历史/产物；管理员也不能通过文件路径读取不在其授权范围的系统文件。

## 4. 策略管理

策略是带版本的结构化配置，不允许管理员上传任意执行代码。设置项：公开执行开关、每用户/每 IP/全站限额、root tree 调用上限、并发、运行时长、进程 TTL、磁盘/pids/内存、五组是否允许、允许模板/模型、日志保留。

普通修改下一个 Run 生效；收紧安全限制和紧急停止在每次执行点检查。放宽限制不能在旧 Run 中静默扩大权限，需要新请求。UI 显示 effectiveVersion 与 pendingVersion。

## 5. 规则管理

P0：内置版本化规则 + 试验台；P1：编辑有限词表/模板配置，支持草稿、校验、黄金集回归、发布、回滚。禁止执行任意管理员 JS 正则代码；如允许正则需限制语法、长度、执行时间和 ReDoS 风险。

试验台显示 mode/source/命中组/拒绝原因/原始片段，允许测试否定、条件、引用和普通输入。发布必须附自动回归报告。回滚只改变未来 Run 的判定，不伪造旧运行历史。

## 6. 运行、任务和审计

运行详情包含输入摘要、模型版本、规则版本、Grant、实际工具面、工具执行记录、子任务树、预算、错误与取消状态。日志经过密钥和路径脱敏；管理员查看内容正文另记 audit。

审计字段 actorId、action、resourceType/id、reason、before/after 摘要、requestId、occurredAt、结果；密钥不出现在 before/after。审计不可由普通管理 API 删除或改写；底层备份/保留策略由运维受控执行。

## 7. 管理 API 范围

`POST /admin/login`；`POST /admin/logout`；`GET /admin/overview`；`GET/POST /admin/models`；`PATCH /admin/models/{id}`；`POST /admin/models/{id}/test`；`GET /admin/visitors`；`PATCH /admin/visitors/{id}`；`GET/PUT /admin/policy`；`POST /admin/rules/test`；`GET /admin/executions`；`POST /admin/emergency-stop`；`GET /admin/audit`。

P1 增加 rules draft/publish/rollback。所有批量停止/提高预算/密钥变更都要求说明，并在 UI 显示影响范围。原型后台只是流程体验，不包含有效认证。


---

<!-- SOURCE: docs/12-cli-and-sdk.md -->

# 12 · 独立 CLI、SDK 适配与开发入口

## 1. CLI 命令（拟定合同，尚未安装实现）

```bash
mypi                           # 当前目录交互，默认 explicit
mypi --mode native             # 固定四个基础工具
mypi --cwd ./demo --mode explicit
mypi run "使用搜索工具查找入口" --json
mypi sessions list
mypi resume <session-id>
mypi doctor                    # SDK/工具链/沙箱/配置兼容诊断
mypi admin bootstrap           # 服务器本地初始化管理员，安全交互输入
```

CLI 交互命令 `/mode native|explicit`、`/tasks`、`/processes`、`/cancel`、`/new`、`/quit` 是 TUI 控制命令，不是常驻 LLM 工具。查看/取消已有资源通过权限控制的应用服务，不要求激活模型工具。Web 对应按钮复用控制面语义。

## 2. 配置

本地配置与公开服务配置分开。CLI 私有路径 `~/.mypi/`；项目 `.mypi/` 只存非敏感配置且需显式 trust，不能自动执行配置代码。优先级：CLI 显式参数 > 已信任项目配置 > 用户配置 > 默认；安全约束只可收窄，不允许参数把 public profile 变为 trusted-local。

`trusted-local` 明示会用启动用户权限操作本机项目；建议默认先确认工作区。`public-demo` 必须提供 SandboxPort，无本地降级。CLI 不要求用户登录网页，无 Gateway 也可运行。

## 3. Agent 核心接口（MyPI 设计，不是 Pi 官方 API）

```ts
interface MyPiAgentService {
  open(input: OpenConversation): Promise<AgentHandle>;
  submit(handle: AgentHandle, input: HumanInput): Promise<AcceptedRun>;
  events(handle: AgentHandle, after?: number): AsyncIterable<AgentEvent>;
  cancel(runId: string): Promise<void>;
  close(handle: AgentHandle): Promise<void>;
}
```

Port 划分：PiRuntimePort、SessionRepository、TaskRepository、EventStore、QuotaPort、PolicyPort、SandboxPort、Clock、IdFactory、Logger。单元测试可用 fake runtime 与内存仓储，无模型费用。

## 4. PiAdapter 限定职责

只有该包直接导入 `@earendil-works/pi-coding-agent`。负责创建/释放 AgentSession、资源加载器隔离、工具注册和激活、订阅流事件、最终完成判断、取消、历史恢复与模型配置适配。对外转换为 MyPI 稳定 DTO。

核验依据：官方 SDK 存在 createAgentSession、SessionManager、subscribe/prompt/abort/dispose 及 custom tools 入口；具体签名会变。官方扩展支持 before_agent_start 与 setActiveTools；并区分 agent_end/settled（参考 00 的 S2/S3）。不要复制过时博客中的包名、tool 对象形状或模型认证实现。

每次替换 SDK Session，重新绑定所有订阅并释放旧实例；事件回调携带 session generation，避免旧异步结果写入新会话。对 raw provider response 的 Token/费用适配应覆盖已允许模型，不伪造不存在的字段。

## 5. 输出与退出

TUI 展示文本、工具卡、当前活跃数量、并行任务概要、队列与退出提示；非交互 `--json` 以稳定 JSONL 输出事件，stderr 放诊断。SIGINT 首次取消当前主 Run，再次请求退出并清理；退出必须处理子任务/后台进程，不留孤儿。

退出码：0 成功；2 输入/配置错误；3 策略或额度拒绝；4 模型/工具执行失败；130 用户取消。任务部分失败在 JSON 中有明细，不以 0 掩盖失败。

## 6. CLI 验收

不启动 Gateway 的情况下：普通请求仅基础四工具；显式搜索可运行；第二条普通输入恢复 0 扩展；子任务并行且不共享消息；Ctrl+C 可清理；重启恢复历史但不恢复旧 grants；模式/模型切换在安全边界生效。Windows 的 Shell、进程树、路径与 Unix 差异需单独验证，首个公网服务器目标为 Linux；不把 Linux 测试结论扩大到 Windows。


---

<!-- SOURCE: docs/13-evaluation.md -->

# 13 · 评测、观测与可用于求职的证据

## 1. 评测目标

证明 MyPI 确实控制了工具面、减少误触发、让独立任务并行且可靠回传；同时不损害任务完成度或突破预算。所有优化需有 baseline、可复现样本、环境和原始记录，不用原型数字冒充结果。

## 2. 加载识别评测

建立至少 200 条人工标注样本：明确请求、否定、条件、引用/代码、能力讨论、多个能力、跨句否定、双重否定、英文混写、零宽字符、长文本和非 human 来源。按意图模板分组划分开发集与保留测试集，避免仅更换文件名的同模板泄漏。

多标签评价每组 Precision/Recall/F1、exact-set accuracy、负例误触发率、拒绝率，另列 source spoofing 和复杂否定。不能只报准确率，因为多数正常输入为无工具。安全关键负例必须全部通过发布门禁；开放自然语言不能承诺 0 误判。

原型提供小规模回归集，只证明样例函数在给定输入上的行为。生产识别器还需原始偏移映射、复杂引号解析、规则版本审计与来源认证。

## 3. 工具上下文成本

三种评测配置：A 原生四工具；B 所有 MyPI 工具常驻（仅离线 baseline，不作为产品第三模式）；C MyPI explicit。对需要高级能力的任务，A 可能无法完成，不能只比较价格不报告成功率；对普通任务比较 B/C 更能衡量 schema 成本。

记录：实际发送工具数量、schema UTF-8 字节、有效输入/输出 Token、cache read/write Token（提供商可得时）、首 Token、总耗时、模型调用数、工具错误、总费用。成本 = 按当次模型价格版本对 provider usage 逐项结算；统计每根 Run 包含全部子调用、重试和自动摘要。

同模型、同任务、同仓库版本、相同输出限制、固定安全 profile；冷缓存和热缓存分开，多次重复并交错执行顺序。报告中位数/P95、样本量、离散程度和失败项，不只挑最好一次。工具 schema 变少不必然让最终费用下降。

## 4. 并行评测

选可拆分只读任务（接口/测试/配置审查），比较单 Session 顺序完成与两独立子 Session 并行；相同总工作量、模型和评价标准。指标：wall time、总 Token/费用、任务成功率、证据准确率、汇总遗漏率、主会话空闲可响应比例。

加速比 = T_serial / T_parallel；并行效率 = 加速比 / 并行度。若提高并发反而因 API 限速/文件争用变慢，完整记录。写任务单独测 snapshot/patch 合并成本和冲突率，不混入只读速度宣传。

## 5. 事件可靠性与故障注入

测 1000 组不调用模型的任务完成事件：重复、乱序、断连、Worker 在事务前后崩溃、事件已持久化但通知失败、Inbox 已 claim 未 ack。检查唯一结果、无终态回退、可恢复投递与无重复副作用。

SSE 恢复：snapshot cursor 到订阅窗口不漏事件；Last-Event-ID 重连不重复 UI；过期 cursor 正确 reset；断流不重复提交 Run。模型主动 status 调用数在异步示例中应为 0，控制面恢复扫描不计为模型轮询。

## 6. 安全与资源评测

完全在自建隔离环境中测试路径越界、角色注入、跨用户访问、恶意扩展、元数据访问、进程树残留、无限输出、磁盘写满、fork/CPU/内存压力、取消和禁用模型竞态。记录被拒绝的位置及残留资源，不在第三方目标上做测试。

验证 public profile 无法切回 host execution。对于 rootless 环境检查实际生效的 cgroup 限额，不只截图配置文件。配额竞争测试同时启动多子调用，证明预留后余额不超发。

## 7. 观测字段

traceId、requestId、principalHash、conversationId、rootRunId、taskId、modelCallId、toolCallId、ruleVersion、policyVersion、generation。日志默认不记原始密钥和全部代码；工具输出摘要有上限。管理员诊断需支持按 rootRun 查询整棵任务树。

指标：activeToolCount、loadingPrecision、negativeFalsePositive、inflightRuns、inboxLag、eventDeliveryLag、queueWait、modelCallsPerRoot、tokenUsageKnown/Unknown、budgetRejects、sandboxLeaks、cancelLatency、workspaceConflictCount。模型私有推理不作为必须采集指标。

## 8. 结果模板

每份结果包含日期、Git SHA、SDK/模型标识、硬件、安全 profile、数据集、配置、运行命令、原始记录位置、结果表、失败样例、限制。未运行字段写“未测”，不能填 0。面试展示优先拿一条 trace 解释行为，而不是堆指标名。


---

<!-- SOURCE: docs/14-deployment.md -->

# 14 · 部署、容量预算与运维

## 1. 部署档位

Local：CLI 或只绑定 loopback 的开发 Web，可选择明确标注的 trusted-local。Public-demo：HTTPS、游客身份、生产构建前端、私有 Gateway/Worker/Broker、隔离沙箱、配额和审计全部启用。无安全配置不允许启动 public profile。

为便于个人演示，默认单机、单 Gateway 实例、单 Worker。参考配置不需要 Redis、Kafka、Kubernetes。SQLite 适合本设计的轻量起步，但并发上限必须用本机测试决定，不宣称可支持任意访客量。

## 2. 4 核 / 8 GiB 轻量参考预算

这是容量规划示例，不是对用户本项目服务器的确认，也不是压测结果。使用外部模型 API，不在该机器部署大模型。

| 项目 | 参考内存预算 |
|---|---|
| OS、容器运行时、文件缓存 | 1.5 GiB |
| Nginx + 静态前端 | 0.2 GiB |
| Gateway + SQLite + 事件 | 0.6 GiB |
| Agent Worker 与 SDK 会话 | 1.2 GiB |
| 全部公开沙箱合计 | 2.0 GiB |
| 余量 | 2.5 GiB |

全局最多 3 个 in-flight 模型请求、2 个执行沙箱；公开沙箱 CPU 合计最多 2 核。Node 构建较重时单个沙箱可用更大份额，但减少并发，不通过无限 swap 假装容量足够。后台进程包含在其沙箱资源总额里，不能另开无限预算。真实性能受项目规模、工具链和 gVisor 兼容影响。

## 3. 上线顺序

构建前端与 Worker/Gateway → 准备加固离线工具镜像并固定 digest → 初始化数据库迁移和管理员 → 配置可信模型与小预算测试 → 设置 TLS/代理 → 验证沙箱无法访问控制面 → 运行安全验收 → 打开 PUBLIC_EXECUTION_ENABLED。

仓库锁文件固定依赖；运行时不执行 npm install、不自动拉取未知扩展。数据库、会话、工作区分别使用私有目录权限。容器不以 latest 镜像漂移启动。

## 4. 配置与启动校验

配置样例见 deployment/config.example.yaml 与 .env.example。Secret 不写进版本库；主密钥来自运行环境或 Secret Store。启动必须验证：无默认管理员密码、密钥主密钥存在、受限 broker 可达、sandbox enforcement 生效、public profile 下禁止 host executor、外网关闭、目录权限、数据库迁移完成、模型配置可用。

仅 Nginx 对公网发布 443/必要的 80 跳转；Gateway、Worker、Broker 与数据库无公网端口。正确配置 SSE 禁用代理缓冲；反向代理允许的 forwarded headers 来源固定。

## 5. 健康检查与熔断

`/health/live` 判断进程活着；`/health/ready` 判断数据库、worker command path、broker 策略和必要模型配置就绪。提供商临时失败不暴露内部凭据；连续失败可以暂停新调用并展示明确状态。

关键警报：日预算达到 80%/100%、持续 usage_unknown、sandbox 清理失败、磁盘低于 20%、事件队列增长、异常请求量、管理员登录失败激增。提供商账单侧另设硬预算；应用额度不是外部账单的唯一保障。

## 6. 关停与升级

先停止接收新 Run → 推送维护状态 → 等待有界期限 → 取消剩余模型/工具 → Broker 清理整个树 → 刷新事件与审计 → 关闭 SQLite。超过宽限期保留 interrupted 状态，不把中断当成功。

升级先备份数据库和产物索引，执行向前迁移；不支持的降级必须拒绝启动。锁定 Pi 版本变化时跑 SDK Spike + CLI + 负例 + SSE + 沙箱测试。单 Worker 升级有维护窗口；不假装无状态滚动升级。

## 7. 数据回收与备份

沙箱 idle 30 分钟释放、后台硬 TTL 10 分钟、游客数据 24 小时、运行日志 7 天、安全/计费审计 30 天均为可调默认。清理任务是幂等的，需记录清理失败与重试。限制压缩包大小与产物总量；生成压缩包也在受限执行环境进行。

每日一致性备份，定期恢复到隔离测试目录并核对 quota/inbox/artifact 引用。不可把 API Key 明文混入备份；备份加密密钥与数据分开。公网执行遭遇异常时先 emergency stop 再保留必要审计，不继续尝试完成用户任务。


---

<!-- SOURCE: docs/15-delivery-plan.md -->

# 15 · 实施计划与阶段验收

## 1. 交付原则

先完成 SDK 高风险验证，再把后端功能做成真实闭环，最后实现前端和联调。保留本交互原型作交互合同，不能用它冒充真实功能。每阶段更新 STATE.md 与证据文件；用户选择阶段验收时停在阶段末尾交付证据，选择端到端执行时按门禁继续，安全失败必须阻断公网发布。

## 2. 阶段

| 阶段 | 产出 | 退出条件 |
|---|---|---|
| S0 规格与兼容 Spike | 锁定 SDK、生命周期实验、基工具重定向 PoC | 两 Session、激活/卸载、settled、取消、Loader 隔离证明 |
| S1 独立 CLI 核心 | agent-core、PiAdapter、native/explicit、search | 无 Gateway 可交互；正常回合 0 MyPI；负例测试 |
| S2 五组能力 | delegate/workflow/background/session、结果队列 | 不轮询并行、权限快照、取消与清理、写冲突处理 |
| S3 Gateway 与数据 | 匿名身份、API、SSE、SQL、幂等、配额 | 真实 SDK 事件可恢复；跨用户拒绝；预算并发测试 |
| S4 公网安全与后台 | Broker/沙箱、模型管理、用户封禁、审计 | 07 的安全门禁全部有证据 |
| S5 真实前端 | React 页面、真实 API adapter、移动端、错误态 | 替换 Mock 后同用例可运行；无秘密进入客户端 |
| S6 联调评测与发布 | E2E、故障注入、成本对比、部署与演示 | 需求追踪完整，已知风险明示，发布开关可安全打开 |

## 3. 每阶段任务示例

S0 不做 UI，重点验证 SDK API 漂移。S1 先跑单组 search，确保工具注册/模型可见/执行授权三个层次分离。S2 先只读两子任务，再做独立写副本；Workflow 只做有界 DAG，不先写复杂 DSL。S3 测 SSE 补发及重复 POST；S4 安全配置与策略必须 server enforced；S5 页面按 design.md；S6 固定样本与模型出可复现评测，不为漂亮数据筛掉失败。

## 4. Definition of Done

有需求 ID；有输入输出契约；正常与失败路径测试；权限与额度校验；取消/超时/清理；结构化日志；文档与实现一致；静态类型/代码质量检查通过；真实功能不能由 Mock 兜底掩盖错误。后端任务须有运行证据，不以“代码已写完”判验收。

## 5. CI 基础流水线

lint → typecheck → unit → schema validation → integration(fake provider) → dependency-boundary test → security policy tests → build → Playwright E2E。真实模型测试手动/受预算运行，密钥只在安全 CI secret 中。代码执行安全测试仅在专用环境进行，不影响日常开发宿主机。

## 6. 状态恢复

新会话接手时读取 README、STATE、AGENTS、当前阶段证据和相关文档，再检查真实仓库。不能只凭聊天摘要声称阶段已完成。未通过的门禁保留 failing case，优先修复最小失败而不是跳过。

输出目录建议 docs/evidence/保留原始命令及结果；完成阶段后在 STATE.md 写入 commit SHA、测试结果、未完成项、下一步。没有真实跑过就写“未运行”。


---

<!-- SOURCE: docs/16-acceptance.md -->

# 16 · 验收用例与需求追踪

## 1. 核心 Given / When / Then

**AC-01 / FR-001** 给定新浏览器，访问根域名；自动取得游客 Cookie，直接进入聊天；不出现注册要求，不与其他游客共享 Conversation。

**AC-02 / FR-004,006** native 模式发送“使用搜索工具”；provider tools 仍为四基础工具；界面提示模式原因，不能通过 prompt 获得扩展。

**AC-03 / FR-005,006** explicit 模式发送普通问题；实际序列化 provider payload 内 MyPI 工具数为 0；不是仅 UI 显示 0。

**AC-04 / FR-005,007** 发送“使用搜索工具查找登录入口”；出现 search 五工具及触发证据；模型可调用其一；第二条普通输入恢复 0 扩展。

**AC-05 / FR-005** 否定、条件、引用、讨论、伪造 source、代码块中的命令均不加载；混合多句符合 04 的作用域规则。

**AC-06 / FR-006** 一个请求有多次 tool loop、重试、压缩；授权保持到 final settled，不在低层 agent_end 误卸载；结束后已释放。

**AC-07 / FR-008,009** 用户显式启动两个只读子任务；spawn 快速返回；主 Agent 继续其他分析，无 status 循环；子任务完成可靠显示。

**AC-08 / FR-008,018** 子任务只拥有父授权交集；子 prompt 中请求新的能力不能激活；消息历史与写目录隔离。

**AC-09 / FR-009** 重复结果、乱序、断线、重连、Outbox 重发；每个结果只投影一次，终态不回退，自动最终摘要不重复触发。

**AC-10 / FR-009** 主 Agent 正在新问题时旧子任务完成；不把旧结果错附到新 Run；空闲后按原任务汇总，tools=[]，不重新开放扩展。

**AC-11 / FR-010** 合法 DAG 顺序/并行执行；环、重复节点、超限、未知工具被拒绝；失败节点下游正确 skipped；写节点不盲目重放。

**AC-12 / FR-011** 后台运行有 TTL、日志限制、完整进程树停止；普通 Bash 的 `&` 无法产生无租约孤儿。

**AC-13 / FR-012** 工作项/目标更新校验 version；无证据不能显示自动验证通过；新普通请求不自动加载 session 工具。

**AC-14 / FR-013** 两写任务输出 patch；主工作区 baseRevision 变更时报告冲突，不覆盖用户修改。文件/下载跨主体拒绝。

**AC-15 / FR-014** 关闭 Gateway，仅启动 CLI，重复普通/搜索/子任务/取消案例成功；无 Web 账号依赖。

**AC-16 / FR-015** 保存与测试模型密钥，GET/日志/前端/沙箱均无明文；提供商端点不能指向私网或元数据。

**AC-17 / FR-016** 两子模型并发争用剩余额度，原子预留不超发；封禁/全局停止阻止下一调用，整树清理。

**AC-18 / FR-017** 一条 Run 可追踪真实输入来源、规则/策略/模型版本、工具面、工具执行、子任务和费用状态。

**AC-19 / FR-018** 宿主路径、私有配置、其他工作区、控制面 socket、元数据、外网不可达；沙箱不可用拒绝执行，不回退。

**AC-20 / FR-003** SSE snapshot→订阅竞态不漏；Last-Event-ID 补发；过期 cursor reset；刷新不重复创建 Run。

**AC-21 / FR-001,016** 重复发游客引导不会给现有主体重复发额度；清 Cookie 后仍受全局/IP 约束；不承诺完全识别同一个人。

**AC-22 / FR-003,013** 恶意 Markdown/HTML/ANSI 不在主站执行；生成代码仅下载/隔离预览；错误消息不泄露宿主路径。

## 2. 需求覆盖

| 需求 | 用例 |
|---|---|
| FR-001/002 | AC-01/14/21 + 会话归档删除测试 |
| FR-003 | AC-09/20/22 |
| FR-004/005/006 | AC-02~06 |
| FR-007 | AC-04/07/11/12/13 |
| FR-008/009 | AC-07~10 |
| FR-010/011/012 | AC-11~13 |
| FR-013 | AC-14/22 |
| FR-014 | AC-15 |
| FR-015 | AC-16 |
| FR-016/017/018 | AC-17~19/21 |
| FR-019 P1 | 规则草稿黄金集、原子发布/回滚与审计 |
| FR-020 P1 | Zip Slip/炸弹/链接/扩展导入隔离测试 |

## 3. 本次交付与最终验收的区别

本次只对离线原型、规则样例、结构文件做可用性/语法/浏览器检查。上面 AC-01~22 是真实系统实施验收用例，并未因原型按钮可点击而通过。实际执行记录见 evidence/verification.md；后端未实现的用例状态必须保持 NOT_RUN。


---

<!-- SOURCE: docs/17-decisions-and-risks.md -->

# 17 · 架构决策记录 ADR 与风险

## ADR-001：两模式、请求级授权

决定：native/explicit，不做 Adaptive；普通请求 0 MyPI schema。参考 OpenPI 但不沿用会话单调加载。代价：跨请求反复显式调用，工具面变化可能影响缓存。用明确 UI/命令和实测缓存对比接受这一代价。

## ADR-002：一个 Pi Loop，共享核心

决定：Agent Core 独立于 HTTP；CLI 与 Worker 注入适配器。避免在 Gateway 再实现一套 Agent Loop。代价：要维护 SDK 适配层和生命周期测试；优先于使用过时 API 快速拼接。

## ADR-003：低依赖部署，但保留安全进程边界

决定：SQLite WAL、单 Worker、SSE；没有 Redis 也可事件通知；Worker/Broker 分离。代价：首版不做水平扩展和无损故障恢复。公网多进程安全边界比表面“单服务最简单”更重要。

## ADR-004：子结果至少一次投递

决定：持久 ResultInbox + Outbox + 幂等投影，聚合按 originRunId；自动汇总无工具。代价：可能短暂显示等待汇总或结果已到摘要未到；不承诺 exactly-once 模型调用。

## ADR-005：公开默认离线模板

决定：不让游客上传任意远程仓库/安装依赖/调用网络。仍可在沙箱生成修改代码、离线测试并导出。代价：体验边界需要清晰说明。完成 P1 网络/导入安全再扩大场景。

## ADR-006：只读并行先行，写入用副本 + Patch

决定：上下文、文件、OS 三层隔离独立设计。代价：快照与合并增加复杂度、空间及冲突处理；不让模型通过承诺避免冲突。

## ADR-007：预算在每次真实调用前预留

决定：所有子调用共享 root budget，重试/压缩/摘要计入。代价：需要 provider usage/成本适配和 unknown 处理；客户端 Token 估计不作为唯一硬闸。

## 风险清单

| 风险 | 影响 | 应对与剩余限制 |
|---|---|---|
| Pi API 漂移 | 生命周期/工具重定向失效 | 固定版本、独立适配、Spike；升级必须回归 |
| 正则语义误判 | 错误开放能力 | 保守拒绝、黄金集、规范按钮；不能覆盖任意语言 |
| 基础 Bash 等价绕过 | 隐藏工具不等于禁止操作 | 无控制面凭据、网络隔离、租约清理；不宣称语义完全可判定 |
| 公开代码隔离缺陷 | 宿主/跨用户风险 | 强化沙箱、最小权限、独立执行机可选、fail closed |
| 缓存命中下降 | 费用不降反增 | 冷/热缓存分开评估；不先给降低比例 |
| 并发结果/取消竞态 | 重复汇总/孤儿进程 | generation、事务、唯一键、cgroup 清理 |
| 配额刷取 | 超预算 | 多维限流、全站硬阈值、挑战；不能绝对识别匿名真人 |
| 未知 usage | 成本不准确 | 保守占用并标 unknown，提供商账单硬闸 |
| 单 Worker 故障 | 运行中断 | 诚实 interrupted、持久队列、保守恢复 |
| gVisor 兼容性 | 构建/工具失败 | 针对模板验收；不能为兼容自动降级宿主 |
| 4 核 8G 容量 | OOM/排队 | 总预算和模板范围受限，以实测校准 |

## 实施前由环境决定的事项

可安装 Pi 版本/SHA、可用模型提供商、TLS 域名、运行时隔离支持、成本币种/单价、管理员认证实现库与备份位置均须在 S0/S4 核验。它们不是要求用户现在补充才能开始的阻塞问题；开发时采用本文默认并将环境变量显式化。


---

<!-- SOURCE: docs/18-demo-and-resume.md -->

# 18 · 求职演示脚本与真实成果表达

## 1. 5 分钟演示顺序

第一步打开域名，说明无需注册但有隔离身份和预算。普通请求展示四基础工具、0 扩展。第二步输入“如果需要，使用子代理”展示条件句不授权，再输入明确搜索请求展示触发证据与工具面变化；发送普通问题证明卸载。

第三步显式用两个子代理分别检查实现/测试，展示独立 Session、主会话继续响应、结果事件回传和按原 Run 汇总。第四步展示代码差异与验证输出，解释并行写入为什么用副本+Patch。第五步管理员暂停访客执行，说明四个原生工具同样经过沙箱，展示真实审计与资源清理证据。

原型可体验上述流程，但演示真实项目时必须展示真实 SDK/沙箱日志；不要用 Mock 的“测试通过”替代测试命令输出。

## 2. 项目描述模板

> 基于 Pi SDK 开发支持 CLI 与 Web 的 Coding Agent MyPI，设计显式按需工具加载、独立会话子任务并行和事件驱动结果汇总；通过 Gateway 提供游客免注册体验，结合隔离工作区、调用额度、模型配置和审计后台控制公开执行边界。

只有相关功能真实实现并验收后才使用“开发/实现”完成时态；当前仅有规格与原型时应写“设计并制作原型”。

## 3. 可写技术点（完成后使用）

工具面：针对扩展 schema 常驻与误触发，利用会话输入钩子、规则判定和 Run 授权快照按需激活五组工具，排除否定/条件/引用，并在完整用户请求结束后卸载。

子任务：以独立 Pi SDK Session 执行并行任务，通过持久结果队列、事件通知和消费去重回传；主 Session 单 writer，避免阻塞等待和并发写历史。

安全：通过 Gateway 统一匿名身份、幂等请求与树级预算，将原生与扩展工具全部路由到隔离执行器，避免向匿名访客暴露宿主权限。

以上是实现方向，不代表已存在生产成果。优化比例只能填 docs/13 的可复现实测结果，并注明测试环境与样本。

## 4. 面试追问准备

为何不开 Adaptive？为何卸载不在 turn_end？工具隐藏能否阻止 Bash？独立 Session 与沙箱区别？子任务完成时主会话正忙如何处理？如何防止重复结果生成两次摘要？不同写任务改同一文件如何合并？配额预留如何避免两个并发请求都通过？所有子调用如何计费？SDK 升级如何验证？沙箱故障能否降级？

回答应结合真实代码文件、状态机和一条 trace，不虚构日活、QPS、线上降低比例或生产稳定性。


---

<!-- SOURCE: design.md -->

# MyPI · 界面设计规范

版本 v1.0 / 2026-09-22。目标：现代、明亮、简洁的开发者工作台；强调内容、执行证据和安全状态。后续页面实现必须读取本文件，以实际文件为准。

## 1. 颜色

主色 #137D64；主色 hover #0E6752；主色浅底 #E9F5EF；辅助信息 #5267AA；页面背景 #F6F8FA；主表面 #FFFFFF；侧栏 #F0F3F5；正文 #1D2939；次级文字 #687587；弱文字 #7C8795；边框 #E2E7EC；成功 #137D64；警告文字 #9A641C、底色 #FFF6E7；错误文字 #B54747、底色 #FFF0EF。状态同时提供文字和图标，不只依赖色彩。

代码区允许浅灰背景 #F7F9FB，深色终端仅用于局部日志。整体不做深色大面积背景、彩虹渐变或过多悬浮装饰。

## 2. 字体

无网络字体依赖：Inter（安装时可用）、系统 UI、PingFang SC、Microsoft YaHei、sans-serif。代码 ui-monospace/SFMono-Regular/Consolas/monospace。界面正文 14px/1.6，长回复 14~15px/1.8；辅助 12px/1.5；导航 13px/1.5；表头 12px/600；页面标题 24px/650/1.3；首屏主标题 32px/650/1.3。移动端主标题 26px。禁止把关键描述压成 10px。

## 3. 间距与布局

基础间距 4/8/12/16/20/24/32/40px。卡片内边距 16~24，页面 24~32，模块间距 20~24。左栏 220px，右检查栏 320px，桌面头部 64px；中间正文 max-width 780px。页面 100dvh，避免双层无意义整体滚动；聊天内容可滚，composer 固定。

断点：≥1280 三栏；960~1279 右栏可收起；<960 左栏窄化并隐藏检查栏；≤640 单聊天列，导航和检查用抽屉，按钮触点≥44px。

## 4. 组件基础

按钮高 36px、圆角 8px，主操作实心绿色；次操作白底细边；危险操作红色文字/底并二次确认。disabled 不仅降透明度，还禁用交互并解释原因。焦点环 2px 主色并留 2px offset。

卡片圆角 12px、1px 边框；一般无阴影，浮层用 0 12px 32px rgba(16,24,40,.12)。输入框圆角 10~12px，composer 圆角 16px。图标 16/18/20px，同线宽，不混大量 Emoji 作为主要导航。

## 5. 组件细则

表格行高≥48px，表头浅底，内容长时截断并可展开；空表有解释和下一动作。模型/用户表允许横向滚动，不缩小字号塞满。

弹窗宽 440~560px，移动端边距16；标题/正文/底部动作区明确，Esc 关闭，焦点限制在弹窗，关闭回到触发按钮；危险批量操作显示影响数量与原因字段。

下拉菜单包含 label、选中状态、禁用原因；模式与模型不混在一个菜单。分页默认 cursor，“加载更多”优先于虚构总页数。表单错误紧贴字段，提交失败保留输入；密钥字段不回显且提示仅写入。

消息提示在底部/右下显示，普通状态 3 秒消失，错误可保留；关键失败同时在页面显示，不能仅依赖 Toast。空状态用短标题与说明；加载用 skeleton，不显示假统计数字。

步骤条只用于真实工作流/任务状态，已完成需要证据；进度未知用不确定指示器，禁止假的 96% 卡住。徽章包含文本：等待/运行/成功/失败/取消/演示。工具组标签显示“本轮启用”，不写“永久解锁”。

代码块可复制、可横向滚动、有文件名和语言；diff 新增/删除同时显示 +/−，空白/二进制文件给专门提示。日志以纯文本渲染，不执行 ANSI 终端控制或 HTML。

## 6. 安全与可信文案

页头原型标“交互原型 · Mock”。真实页面无法确认沙箱在线时显示“尚未就绪”，不得写“绝对安全”。显示工具已注册/本轮可见/调用被拒绝三种不同状态。令牌/费用数字有来源、时间与 unknown 状态；空数据不是零。

## 7. 可访问性

语义化 button/input/label/heading/table；发送区 aria-label；流式内容避免每字符 aria-live 轰炸，最终结果或状态摘要才播报；支持 reduced-motion；焦点可见；IME 输入安全；对比度与键盘导航需实际测试。原型已做基础交互，不宣称完成正式 WCAG 审计。


---

<!-- SOURCE: AGENTS.md -->

# MyPI 实现约束

开始工作必须读取 README.md、STATE.md、docs/01、docs/03、docs/04、docs/07、docs/15 和相关契约；修改前端前实际读取 design.md。

只提供 native/explicit。不要偷偷新增 Adaptive，不添加常驻 loader，不把 OpenPI 的会话永久加载照搬进来。0 扩展按真实 provider tools 验证，不按 UI 验证。

Pi SDK 具体 API 只出现在 pi-adapter；先锁版本和做 Spike。不要发明官方不存在的函数，不将伪代码当作已编译代码。Agent Core 不反向依赖 Gateway/Web。

所有公开工具执行包含基础 read/write/edit/bash，必须走 SandboxPort。用户工作区代码不能接触 API Key、SDK 私有目录或控制面 socket。沙箱不可用时拒绝，不在宿主机执行。公开上线以安全验收为门禁。

一个主 Session 单 writer；子任务独立 Session；工具授权按用户 Run，完整 settled 后释放，子任务用独立快照。ResultInbox 可靠回传、去重、按 originRun 聚合；不要增加模型 status 轮询。

预算包含子任务/重试/压缩/自动摘要。费用和优化数据必须来自真实实验。原型 Mock 不可用作集成失败时的默认回退。

每阶段记录真实命令、结果、证据、未完成项并更新 STATE.md。交付代码、测试、说明和限制，不只说完成。


---

<!-- SOURCE: STATE.md -->

# 项目状态

当前：SPECIFIED_WITH_INTERACTIVE_PROTOTYPE。

已提供：产品/设计/架构/安全/契约/评测/交付文档；离线可交互 HTML 原型；小规模确定性匹配样例与测试；结构检查和浏览器检查记录（见 evidence）。

尚未实现：真实 Pi SDK backend、Agent CLI、Gateway、Cookie 身份、模型管理安全存储、持久队列、沙箱 Broker、真实工具执行、真实费用结算及生产部署。

下一阶段：S0，核验可安装 Pi 版本并锁定，做生命周期/动态工具/基础工具重定向的高风险 Spike。通过后按 docs/15 后端先行。

本次未取得可验证的上游 commit SHA，不编造。协议与 SQL 为设计草案，后端实现必须做契约测试及迁移。


---

<!-- SOURCE: IMPLEMENTATION_PROMPT.md -->

# 交给 Coding Agent 的实现提示词

你正在实现 MyPI。请先实际读取本目录的 README.md、AGENTS.md、STATE.md、design.md，以及 docs/01-product-requirements.md、docs/03-architecture.md、docs/04-tool-loading.md、docs/07-security.md、docs/15-delivery-plan.md 和 contracts/。

目标是基于 earendil-works/pi 的 SDK 实现独立 CLI 和可被 Gateway 调用的 Agent Core。参考 OpenPI 的五组能力和独立会话子任务机制，参考 DeerFlow 的 Harness/App 边界，但不要照搬整套框架。产品只有 native 与 explicit；扩展授权按用户 Run，不是会话永久激活；正常用户 Run 只有四基础工具。

按照后端先行路线推进：先 S0 SDK 验证并锁定版本，再 S1 CLI/search，再 S2 五组与可靠结果队列，再 S3 API/SSE/身份/配额，再 S4 沙箱和后台，再 S5 真实 React 前端，最后 S6 集成验收。

当前交付的 prototype/index.html 是可交互 Mock。请以它为视觉与交互参考，不把它当作真实后端，也不要把原型的计费/测试/模型结果搬成生产数据。

默认按阶段完成，并在每个阶段末给出真实代码变更、运行命令、测试证据、未通过项和下一步；需要阶段验收时询问是否继续。当用户明确要求端到端完成时按阶段门禁持续实现，不在可自行解决的普通设计细节上停下，但缺少真实凭据可用 fake provider 做测试并明确标注，不能伪造真实模型结果。

公开匿名执行安全是硬约束：所有基础和扩展工具走隔离执行器；不存在宿主降级；用户代码无模型密钥、SDK 私有目录、Docker socket 或控制面访问；预算与权限由服务器执行。安全门禁未过时保留 public execution 关闭。

所有实现状态更新 STATE.md；所有 SDK 引用以实际安装版本与官方源码为准。最终输出可运行代码、启动说明、测试报告、已知限制和需求验收映射，不写未经验证的成果比例。


---

<!-- SOURCE: prototype/README.md -->

# MyPI 前端交互原型

`index.html` 是完整离线单文件，内嵌 CSS 与 JavaScript，无 CDN、字体下载、依赖安装或 API Key。用支持现代 JavaScript 的桌面/移动浏览器打开；浏览器或组织策略禁止本地文件时，在解压目录启动仅绑定本机的静态服务：

```bash
python -m http.server 8765 --bind 127.0.0.1
# http://127.0.0.1:8765/prototype/index.html
```

## 体验路线

打开即进入聊天工作台。选择“先读懂这个项目”会把明确请求插入输入框，发送后观察搜索能力加载，主请求结束后扩展数恢复为零。选择“两个子代理并行协作”，在主回复出现后继续发普通消息，观察子任务仍运行且按来源 Run 回传。

能力快捷按钮只是插入文本，不直接给模型授权。可试 `不要使用搜索工具`、`如果需要，使用搜索工具`、`如何使用搜索工具`，它们不会触发扩展。切到原生模式，任何扩展请求都不触发 MyPI 工具。

右侧执行面板可切换工具轨迹、子任务/后台进程、会话工作项和示例文件。任务可取消；工作项可勾选；文件可查看、复制或导出，导出的是本包静态样例。

左下“后台演示”打开明确的 Mock 提示，再进入概览、模型管理、游客管理、额度与工具策略、运行记录、审计。添加/编辑模型只保存显示字段，不接收密钥；测试连接是模拟结果。封禁当前游客或暂停公开体验后，返回聊天页可以看到请求被拒绝。

## 真实与模拟边界

所有回复、计时、工具执行、费用/在线人数与文件变更都是 Mock。消息不持久化，刷新页面恢复初始状态；会话列表只包含本页会话。不存在服务端身份、有效管理员认证、模型调用、SDK Session、SSE、数据库、OS 进程、容器或执行沙箱。

原型演示主请求完成与后台任务继续时，用简化的 `completed` 标记“主 Loop 已结束”；真实契约必须采用 `waiting_children` 等完整 Run 状态。后台进程寿命与模型执行树寿命分别定义。原型只在主请求空闲时接受新请求，忙时发送按钮是“停止”，没有实现生产 SessionActor 排队。

管理员配额中请求次数、能力开关、封禁与暂停可联动；Token、模型并发和调用预算只展示配置，不模拟真实结算或调度。Workflow 是两个 Mock 节点及事件汇总演示，不是通用 DAG 引擎。文件都是预置样例，不能当作 Agent 已生成或测试通过的代码。

## 编辑与重建

修改 `styles.css`、`rules.js`、`app.js` 后，在交付包根目录执行：

```bash
python tests/build_prototype.py
node tests/rules.test.cjs
```

生产前端应根据 `design.md` 和 `docs/10-frontend.md` 重建为 React + TypeScript；业务 API 接入 `contracts/openapi.yaml`，不得复用本页状态作为安全控制。


---

<!-- SOURCE: evidence/verification.md -->

# 本次交付的实际验证范围

整理日期：2026-09-22。交付状态：设计文档 + 契约草案 + 离线前端交互原型。

## 已实际执行

| 检查 | 实际结果 | 证据 |
|---|---|---|
| 意图规则与工具数量断言 | 90 项通过，0 失败 | rules-result.json；tests/rules.test.cjs |
| Chromium 交互冒烟 | 27 项通过，0 失败 | browser-smoke.json；tests/browser_smoke.py |
| OpenAPI/JSON Schema/SQLite 结构与约束检查 | 13 类检查通过 | contracts-check.json；tests/validate_contracts.py |
| TypeScript 事件契约静态检查 | strict / noEmit 通过 | typescript-check.txt |
| JavaScript 语法检查 | node --check 通过 | prototype/app.js |
| 桌面与移动布局 | 1440×1000、390×844 无页面横向溢出，输入框完整可见 | prototype-chat.png；prototype-mobile.png |

接口草案：26 条路径、31 个方法操作、43 个组件 schema；310 次内部 $ref 引用解析成功。SQLite 草案：24 张表，建表/完整性与外键检查通过；负例覆盖跨主体工作区、预算根、父子任务和后台进程绑定。检查只证明这些结构/样例约束，不证明业务代码实现了鉴权。

测试环境：Node.js 22.16.0、Python 3.13.5、Chromium 144.0.7559.96、SQLite 3.46.1。没有安装 Pi SDK；本环境 Node 版本不满足所读取 Pi main 的 >=22.19.0 要求，不能将本次原型检查解释为 SDK 兼容性通过。

## 浏览器检查方式与限制

执行环境策略拒绝 Chromium 对 file:// 和 localhost 的导航，因此测试使用 Playwright `page.set_content()` 加载实际组装的 index.html 字节，在真实 Chromium 中操作 DOM。未声称静态服务器部署、域名访问、HTTP 鉴权或 SSE 流测试通过。原型没有外部依赖；本次场景未出现未捕获页面异常或网络请求。截图隐藏了短暂 Toast，避免遮挡页面，不改变交互或测试结果。

规则测试是小规模确定性样例，涵盖明确执行、否定、条件、引用、模式、来源、Unicode 和工具数量；不是自然语言全覆盖或对抗安全证明。后端仍必须保留来源校验、规则版本、黄金集回归和安全执行门禁。

JSON Schema 使用 jsonschema 的 Draft202012Validator 检查；未运行完整 OpenAPI 规范专用验证器。SQL 在内存数据库中执行，并未测试真实磁盘 WAL、高并发、迁移升级或崩溃恢复。UI 的模型测试按钮不发真实提供商请求。

## 尚未执行 / 不包含

真实 Pi 会话与动态工具集、模型调用/Token/缓存计费、完整 CLI、Gateway/数据库集成、Cookie/CSRF/管理员认证、SSE 回放/幂等、持久 Inbox/Outbox、Broker/rootless/gVisor、宿主隔离与网络防外传、并行文件合并、资源限制、真实请求树预算、压测、生产部署。状态统一为 NOT_RUN，不填写“通过”。

未取得三个上游仓库可核验的 commit SHA，也未确认 main 文档中的包版本已在 npm 发布。本包的 SDK 相关代码接口若标为 MyPI Port 或伪代码，不是 Pi 官方导出示例。编码阶段首先填写 pi-compatibility.md。

## 复现

```bash
node tests/rules.test.cjs
python tests/validate_contracts.py  # 需要 PyYAML 与 jsonschema
python tests/browser_smoke.py      # 需要 Playwright 与 Chromium
# 可通过 CHROMIUM_PATH 指定浏览器；--no-sandbox 仅用于本地 UI 测试进程。
# 这与真实系统不可信代码执行沙箱的配置完全无关。
tsc --noEmit --strict --target ES2022 --module ESNext contracts/events.ts
```

完整上线验收以 docs/16-acceptance.md 为准；任何安全阻断项未通过时，publicExecutionEnabled 必须保持 false。
