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
