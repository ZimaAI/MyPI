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
