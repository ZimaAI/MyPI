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
