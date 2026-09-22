# MyPI · 产品规格与交互原型交付包

**版本：v1.0-design · 整理日期：2026-09-22 · 状态：设计基线，尚非后端成品。**

MyPI 是基于 Pi SDK 的独立 Coding Agent：本地可用 CLI，Web 通过 Gateway 调用同一核心；公开演示支持游客免注册，同时提供模型、身份、额度、工具规则和审计后台。

## 先打开什么

`MyPI_Documents.html` 是带目录的完整文档阅读版；`MyPI_Documents.md` 是合并文本版。两者由下列源文件生成，修改应以独立文档为准。

- `prototype/index.html`：可双击打开的离线交互原型。对话、模式切换、规则识别、并行任务、代码变更和后台均可演示。所有回复、运行记录、成本数据均为 Mock；不会连接模型或执行系统命令。
- `docs/01-product-requirements.md`：范围、需求编号、验收标准。
- `docs/03-architecture.md`：模块划分、控制面与执行面、CLI/Web 解耦。
- `docs/04-tool-loading.md`：最核心的显式加载语义与生命周期。
- `docs/07-security.md`：开放域名前必须完成的安全门槛。
- `IMPLEMENTATION_PROMPT.md`：交给 Codex 等编码工具的实现入口。

## 已确定的产品决策

1. 仅提供 `native` 和 `explicit` 两种工具模式，默认 `explicit`；不加入 Adaptive 或常驻工具加载器。
2. 原生工具固定为 `read / write / edit / bash`。普通用户请求不激活 MyPI 扩展工具；显式请求才按能力组开放。
3. MyPI 授权按 **用户请求 Run** 生效，不按整个会话单调累积；同一个请求内的多次模型调用保持稳定，结束后释放。
4. 工具可见性不是安全授权。四个原生工具在公开 Web 环境也必须走隔离执行器。
5. 子任务使用独立 Pi SDK Session，事件驱动回传；子上下文隔离、文件写入隔离与 OS 隔离分别实现。
6. CLI 不依赖 Web、Gateway、管理员账号或远程数据库。Gateway 是应用适配层，不是 Agent 内核的一部分。
7. 公网默认是有资源上限、无任意外网访问的模板工作区演示，不是匿名共享宿主机 Shell。

## 目录说明

| 目录 / 文件 | 用途 |
|---|---|
| `docs/00-reference-audit.md` | 上游核验、版本风险、借鉴与差异 |
| `docs/01-product-requirements.md` | 产品需求与非目标 |
| `docs/02-domain-and-state.md` | 领域模型、状态机、行为不变量 |
| `docs/03-architecture.md` | 架构与依赖方向 |
| `docs/04-tool-loading.md` | 显式识别、激活、卸载与权限 |
| `docs/05-capability-spec.md` | 五个能力组及 25 个扩展工具规格 |
| `docs/06-parallel-and-workflow.md` | 子任务、结果队列、DAG、并发写入 |
| `docs/07-security.md` | 游客访问、安全执行与防滥用 |
| `docs/08-api-and-events.md` | HTTP / SSE / 内部接口 |
| `docs/09-data-and-storage.md` | 数据模型、事务、一致性、保留期限 |
| `docs/10-frontend.md` | 页面、交互、状态与无障碍 |
| `docs/11-admin.md` | 模型、用户、策略、审计后台 |
| `docs/12-cli-and-sdk.md` | CLI 命令与 SDK 适配边界 |
| `docs/13-evaluation.md` | 加载准确性、成本、并行、可靠性评测 |
| `docs/14-deployment.md` | 轻量部署、环境变量、运维 |
| `docs/15-delivery-plan.md` | 后端先行的分阶段实施与验收 |
| `docs/16-acceptance.md` | 可执行验收场景与需求追踪 |
| `docs/17-decisions-and-risks.md` | ADR、取舍与未消除风险 |
| `docs/18-demo-and-resume.md` | 演示脚本及真实简历表述原则 |
| `design.md` | 统一视觉与组件设计规范 |
| `contracts/` | OpenAPI、事件类型、SQL 数据模型 |
| `prototype/` | 原型与纯函数规则样例 |
| `tests/` | 原型规则测试与浏览器冒烟测试 |
| `evidence/` | 本次实际检查结果，不代表后端验收 |
| `deployment/` | 配置样例与上线清单，不含假装可运行的后端镜像 |

## 使用方法

解压后直接打开 `prototype/index.html`，无需账号、依赖或 API Key。也可在交付包根目录执行：

```bash
python -m http.server 8765 --bind 127.0.0.1
# 浏览器打开 http://127.0.0.1:8765/prototype/index.html
node tests/rules.test.cjs
```

实现真实系统时必须从源码核验 Pi 版本并锁定依赖，不能把本文档中的拟定接口当作 Pi 官方导出。公开上线之前，`docs/07-security.md` 与 `docs/16-acceptance.md` 中的安全阻断项全部通过，否则保持本地访问或关闭公开执行。

## 证据边界

本包提供完整设计、契约草案和交互原型；不包含真实模型调用、Pi SDK 集成后端、有效管理员认证、部署完成的容器沙箱或生产优化数据。原型上的配额、在线状态、测试记录、费用与模型名称均为示例。具体实测范围见 `evidence/verification.md`。
