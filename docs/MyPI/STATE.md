# 项目状态

2026-09-23：本设计包已进入实际实现，后端及前端代码位于仓库根目录的 `packages/` 和 `apps/`，后续以根目录 [STATE.md](../../STATE.md) 为准。

已实现独立 CLI、真实 Pi SDK 适配、五组能力、SQLite/Gateway/SSE、游客与管理员身份、模型密钥管理、配额与审计、隔离 Broker、React 工作台与管理后台、规则版本管理及受控项目导入。前端规范沉淀在根目录 [design.md](../../design.md)。

实际验证命令及结果见 [实施记录](../evidence/implementation.md)，逐项边界见 [验收追踪](../evidence/acceptance.md)。本目录保留原始需求、契约草案与交互原型；草案与实际实现差异见 [契约映射](../evidence/implemented-contracts.md)。

公网执行默认关闭。本机不具备要求的 rootless Docker/runsc 隔离环境，专用环境安全验收和付费模型效果/成本评测尚未运行；本地测试成功不代表已经公网发布。
