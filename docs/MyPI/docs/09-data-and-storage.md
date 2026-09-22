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
