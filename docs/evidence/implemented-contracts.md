# 实现契约与设计草案的映射

2026-09-23。`docs/MyPI/contracts/` 是交付时的设计草案，保留原文用于需求追踪；不能直接拿其中 SQL 当作本实现的迁移脚本。实际类型在 `packages/contracts/src/index.ts`，HTTP 输入 schema 在 `apps/gateway/src/index.ts`，受限执行端口在 `packages/sandbox-client/src/types.ts`。本记录列出已核对的字段与存储差异。

| 范围 | 设计草案 | 当前实现 |
|---|---|---|
| 业务表 | principal / conversation / run / task 等独立关系表 | SQLite `entity(kind,id,owner_id,conversation_id,version,data_json,created_at,updated_at)` 存放业务记录，拥有者查询与服务层再次鉴权；计费、事件、Outbox、审计使用专表。业务引用没有全部转成 SQL 外键，不能宣称与草案 DDL 相同。 |
| 数据库版本 | 草案无实际迁移 | `schema_migration` v1；未知版本拒绝启动。本文档不是以后升级 schema 的迁移实现。 |
| Run 快照 | source/inputId/modeSnapshot、独立 capability_decision | Run 使用服务器产生的 human 入口，`mode`、`decision.ruleVersion`、`model.configVersion`、`generation`、`deadline`、`budgetRootRunId`；规则证据位于 decision，输入/工具面保留在持久事件。并非每个草案字段都有独立列。 |
| 汇总 | 独立 task_result source / execution_run_id | 原 Run 下的 `runId:summary` 独立 SDK Session，无工具，仍按根预算归因；Result/Inbox 使用 originRunId。 |
| 幂等 | Run 唯一复合键 | Run 请求保存 `entity(kind='idempotency')` 的请求哈希/Run 引用；会话创建使用 `conversation-request`；通用数据库幂等表另存管理类请求。 |
| 模型费用 | input/output/cache/price/microCost 等列 | `Usage` 使用 `inputTokens/outputTokens/cachedInputTokens/costMicros/currency/priceVersion/status`；未知字段为 null，未知 usage 保守占用预留。 |
| 工作区/产物 | workspace/artifact 表与外部 artifact store | Broker 私有文件目录+受限元数据清单保存工作区；产物导出文本在 SQLite entity 中，下载仅 attachment；超过16KiB预览/导出上限时拒绝生成截断产物。 |
| 文件只读浏览 | 与执行端口未区分 | `workspaceFiles/workspaceRead` 对Broker私有快照鉴权后只读，公开执行关闭时仍可查看模板。Agent native `read` 仍通过 `execute` 隔离，不能借浏览接口转为宿主工具执行。 |
| 项目导入（P1） | ZIP/公共 Git 仓库受控导入 | `POST /api/v1/conversations/:id/import` 接收 ZIP base64 或 GitHub 仓库 URL、可选 ref，必须携带当前 `expectedRevision`、CSRF 与幂等键。Gateway/Worker 的 `MYPI_ENABLE_IMPORTS` 默认关闭。GitHub 仅只读下载公共仓库内容 ZIP，不运行 Git、不保存历史或执行配置；通过 `SandboxPort.importWorkspace` 替换托管主工作区。限制和遗漏目录见 deployment/README.md，结果包含 revision/fileCount/totalBytes/source/omittedPaths。文件预览新增 `binary` 布尔标记，二进制与截断文件拒绝文本导出。 |
| 执行租约 | SandboxExecRequest 含 leaseId/generation/deadline | RPC绑定 principal/conversation/workspace/run，核心绑定Run授权与串行Session，SDK适配器拒绝非活跃工具调用；Broker为每次操作生成私有容器名并限制时间与资源。镜像、挂载、网络、Docker参数不能由调用者指定。 |
| 工作区数量 | 每个游客一个可写工作区 | 每个会话独立工作区；同一主体合计256MiB内容预算、最多50个会话根目录。这样会话文件互相隔离，数量策略与草案规划值不同。 |
| 后台终态 | `exited/cancelling/cancelled` | `running/completed/failed/cancelled/expired/conflict`；`process.updated`携带进程快照，包含stdout/stderr来源、有限日志和TTL；stop等待进程实际退出。 |
| 事件 | 强类型 EventPayloads 联合 | 外层schemaVersion/eventId/sequence/conversationId/runId保持；实际事件包括额外 `provider.tools`、更详细task/workflow/process快照，payload目前为通用记录；前端按真实事件投影，不能把草案联合类型当成完整运行时校验。 |
| 删除与保留 | deleting→文件/SDK→tombstone | Worker维护服务先停止Run树、删除Broker/SDK文件，再事务删除正文与队列，保留最小tombstone/计费metadata与删除审计；失败保留deleting重试。后台Broker单独执行24h文件清理。 |
| 备份 | 一致备份+同批次产物索引 | `scripts/backup.ts` 使用 `node:sqlite.backup`，校验可恢复数据库，并从该备份生成产物manifest。在线命令包含DB内嵌产物，不把Broker/SDK文件目录伪称为同一时点备份。 |

公共执行门禁还依赖真实部署验收。此机只有 Docker Desktop/runc，没有要求的rootless/runsc，默认环境开关与应用策略均保持关闭。代码级鉴权、无宿主降级、路径限制与恢复测试通过，不替代SEC-03/04/05/10的专用隔离环境实测。
