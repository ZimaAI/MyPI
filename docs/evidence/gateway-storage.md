# Gateway 与 SQLite 实施证据

日期：2026-09-23。实现先于 React 前端开发完成。

## 实现

- SQLite WAL、busy timeout、v1 schema version、前向版本拒绝、版本化实体、属主索引、原子幂等、事件序号与 Outbox 同事务提交。
- 日根请求与多桶模型预算原子预留；unknown usage 保留预留；手动额度调整流水；数据库触发器保护审计记录不可变。
- HttpOnly 游客与独立管理员 Cookie；opaque token 仅存 SHA-256；精确 Origin + CSRF 校验；游客引导复用；IP/主体限流；scrypt 管理员密码。
- 模型 AES-256-GCM 凭据加密、白名单提供商 endpoint、只写密钥、空值保持、显式清除、受限连接测试与测试后默认模型门禁。
- 会话/运行/文件/产物/任务/后台进程/patch HTTP API；有界、鉴权 SSE 与 Last-Event-ID 回放和 stream.reset；管理概览/模型/访客/策略/规则试验台/运行详情/审计/用量/紧急停止。
- Gateway 经 Bearer 私有 RPC 调用 Worker，不加载 Pi SDK。事件库每 200ms 的跨进程增量转发用于持久事件投递，不调用模型或状态工具。

## 实际运行命令与结果

```text
node node_modules/typescript/bin/tsc --noEmit --pretty false
exit 0

node --import tsx --test packages/storage-sqlite/test/*.test.ts apps/gateway/test/*.test.ts
tests 8 / pass 8 / fail 0 / skipped 0
```

测试覆盖身份复用、CSRF、伪造角色拒绝、跨身份对象与 SSE 拒绝、路径穿越拒绝、版本冲突、密钥不回显、模型测试门禁、Run 幂等冲突、SSE 补发与 reset、数据库重开恢复、多桶预留回滚、unknown 用量、不可变审计和加密认证。

完整集成测试使用真实 HTTP Worker、真实 Core、双 SQLite 连接和明确授权的测试临时 TrustedLocalSandbox；实际执行结构化文件搜索，验证 9 个可见工具、持久最终消息、预算结算、RPC 认证和删除清理。模型 runtime 为仅测试使用的 fixture；没有使用真实付费模型，也不把该用例当作生产 OS 隔离证明。

## 数据模型实现说明

原 `docs/MyPI/contracts/schema.sql` 是设计草案。当前版本的可执行迁移在 `packages/storage-sqlite/src/index.ts`：可变领域对象放入带 kind、owner_id、conversation_id、version 的 entity 表；预算、预留、调整、事件、Outbox、幂等及审计使用专表。Gateway 的对象访问结合 kind/id/owner 查询。该选择与共享 Agent Core 的 EntityStore 接口一致。

## 证据边界

公开部署还需要实际容器宿主验证网络、资源限制与清理，以及真实提供商凭据的小预算验证。没有凭据或隔离执行器时返回明确错误，不用 fixture 或宿主执行做运行时回退。默认公开执行关闭。
