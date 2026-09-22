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
