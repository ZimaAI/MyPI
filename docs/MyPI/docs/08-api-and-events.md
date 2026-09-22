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
