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
