# 需求验收追踪

日期：2026-09-23。依据：`docs/MyPI/docs/16-acceptance.md`。平台：Windows、Node.js 24.16.0。这里逐项记录实际实现和测试边界，不把原型点击、模拟模型回答或配置文件当作公网运行证明。

状态说明：**本地通过**表示所列功能在本地真实组件或明确标注的测试替身下已验证；**部分验证**表示已有实现和通过的测试，但该 AC 还有未运行的场景；**环境未验收**表示公网隔离环境尚未具备。真实 SDK 测试使用回环 HTTP 提供商，实际发出请求并执行文件工具，没有调用付费模型。

| 用例 | 状态 | 实际证据 | 仍未证明的范围 |
|---|---|---|---|
| AC-01 游客直达、身份隔离 | 本地通过 | `apps/gateway/test/gateway.test.ts` 验证 Cookie 身份复用、跨游客对象/SSE 404；`tests/chat.e2e.spec.ts` 新浏览器直接进入聊天并创建工作区。 | 生产 HTTPS 反向代理尚未部署验收。 |
| AC-02 native 固定基础工具 | 本地通过 | `tests/pi-adapter.test.ts` 检查实际 SDK provider 工具面；`tests/chat.e2e.spec.ts` 验证 native 输入高级能力时的模式原因。 | 不以回环提供商判断真实模型的任务成功率。 |
| AC-03 普通 explicit 为 0 扩展 | 本地通过 | `tests/integration.test.ts` 实际 SDK 请求为 4 个基础工具；`tests/cli.test.ts` 恢复后的普通输入同样只有 4 个。 | — |
| AC-04 搜索启用并在下一请求复位 | 本地通过 | 集成测试实际 payload 数量 `[4,9,9,4]`，执行结构化搜索、持久化工具结果；浏览器显示证据和最终工具面。 | — |
| AC-05 来源、否定、条件和引用 | 本地通过（回归集） | `tests/intent-evaluation.test.ts` 的 316 个独立文本/source/mode 组合，187 个负例均未触发；含全部原型负例、NFKC 原文偏移和不同引号。HTTP 拒绝伪造 source 字段。 | 样本为原型加开发过程编写，未完成独立人工标注、模板隔离保留集；不能声称开放自然语言 0 误判。 |
| AC-06 授权持续至 settled | 本地通过 | SDK 测试实际运行多轮工具、503 重试、自动压缩、取消中的工具清理，并验证最终工具清空及每次调用预算。 | 未实测所有支持的提供商协议。 |
| AC-07 两个独立只读子任务 | 本地通过 | `tests/core.test.ts` 验证 spawn 返回、独立任务、一次摘要；`tests/acceptance.test.ts` 使用屏障证明两个工作节点同时在运行；浏览器两个任务卡及原任务摘要通过。 | 不报告真实模型并行加速比。 |
| AC-08 子任务授权与历史隔离 | 本地通过 | Core 子会话 history 为空，能力为父授权交集，子 prompt 的扩权词不起作用；Sandbox 独立副本和只读 Bash 拒绝。 | 公网容器之间隔离仍见 AC-19。 |
| AC-09 重复、乱序和可靠回传 | 部分验证 | `tests/event-reliability.test.ts` 各 1000 组 reducer 和真实 SQLite result/inbox/outbox 测试，覆盖乱序、重复、快照重连、通知异常、事务回滚和重开；Core 验证一次原任务摘要。 | 故障注入是异常与数据库重开，没有实测 OS 强杀/断电；不把它描述成 1000 次真实进程崩溃。 |
| AC-10 旧任务完成与新问题竞争 | 本地通过 | `tests/acceptance.test.ts` 明确让旧 child 在新 Run 持续运行时结束，摘要延后到空闲、归属旧 Run 且 tools=[]；只交付一次。 | — |
| AC-11 有界 DAG | 本地通过 | Core 拒绝环、重复 ID、无效边、深度和 schema 越界；验收测试执行真实调度，确认并行层、依赖顺序、失败后继 skipped、恢复不自动再建任务。 | 未进行真实模型质量评测。 |
| AC-12 后台 TTL、日志和进程清理 | 部分验证 | `tests/sandbox.test.ts` 实际后台 Node 进程、事件等待、取消、普通命令取消；Windows Job Object 负责进程树租约；TTL/输出上限实现于执行器。Core 持久化进程状态并用事件等待接收终态。 | 真实 TTL 到期、无限输出、恶意 detached 进程压力及 Linux cgroup 全树回收未完成专项验收。 |
| AC-13 工作项、目标与版本 | 本地通过 | `tests/core.test.ts` 无证据完成被拒绝、expectedVersion 冲突、带证据完成；下一普通输入恢复基础工具。目标使用同一版本/证据约束；UI 不显示自动验证通过。 | 目标独有状态的所有组合尚无逐项 UI 自动化。 |
| AC-14 隔离写和 patch 冲突 | 本地通过 | Sandbox 两副本测试、baseRevision 改动后拒绝合并且保留父修改、匹配版本时应用；跨主体文件访问与路径越界拒绝；产物下载鉴权。 | 公网卷和容器隔离仍见 AC-19。 |
| AC-15 独立 CLI | 部分验证 | `tests/cli.test.ts` 真实独立子进程执行 Pi 搜索、列会话、管道输入恢复及普通请求，无 Gateway/Web 账户；`apps/cli/bin/mypi.mjs --help` 从其他 cwd 运行成功。子任务/取消复用已测 Core。 | 尚未在 CLI 子进程层逐项执行“子任务 + Ctrl+C”组合验收；不能用 Core 替身测试代替该端到端记录。 |
| AC-16 密钥和端点 | 部分验证 | 存储测试 AES-GCM/认证失败、密码 scrypt；Gateway API 和浏览器写入密钥后不回显；端点仅接受固定官方枚举，拒绝自定义 URL；SDK 资源隔离不读取项目密钥文件。 | 未进行真实提供商小预算连通验证和生产网络层 DNS/重定向测试。 |
| AC-17 预算竞争和撤销 | 本地通过 | `tests/acceptance.test.ts` 两 sibling 竞争 SQLite 预算：已用 30、预留 200、上限 350，另一个在 dispatch 前拒绝；封禁后下一调用拒绝、等待并发槽的请求重新鉴权、revoke 等整树清理；storage 原子多桶回滚；管理员紧急停止入口已接同一撤销路径。 | 公网容器停止效果仍需 AC-19 环境。 |
| AC-18 全链路归因 | 本地通过 | Run 保存 policy/rule/model 版本与策略快照；modelCall 保存根 Run、执行 session、human/task/task_result 来源；Core 生命周期测试核对主调用、两个子调用和摘要合计用量；验收测试验证版本不随后续变更漂移及 delta 批量完整落库。 | 未提供付费提供商真实费用对账；unknown 保留未知，估算价格有 estimated 标识。 |
| AC-19 公网沙箱 | 环境未验收 | 路径、符号/硬链接、属主、Broker 密钥、受控 Docker 参数、禁止宿主回退已有通过测试；本机 Docker 门禁实际返回 rootless/runsc 不满足。 | Linux rootless + runsc 实际镜像、宿主秘密/元数据/外网探测、cgroup CPU/内存/PID/tmpfs 限额、残留资源均 **NOT_RUN**；默认公开执行关闭，未就绪拒绝执行。 |
| AC-20 SSE 快照/补发/reset | 本地通过 | `tests/rules.test.ts` 用两个 SQLite 连接在读取实体与游标间尝试提交，快照事务阻止 cursor 超前，提交后可按旧 cursor 回放；Gateway 真实 SSE Last-Event-ID 和越界 cursor reset；浏览器刷新保留消息、无重复 Run。 | 已测试事务隔离及回放边界，未做长时间生产代理断网压测。 |
| AC-21 游客额度与清 Cookie | 本地通过 | `apps/gateway/test/quota-policy.test.ts` 使用同 Cookie 重引导不增加或清零预算；同 IP 清 Cookie 创建 20 个身份后 429；全局 500/小时门禁已实现。 | 全局 500 个不同 IP 的压力场景未单独运行；不承诺识别同一个自然人。 |
| AC-22 不可信内容显示 | 部分验证 | React Markdown 默认不执行原始 HTML，浏览器恶意 HTML 用例通过；工具文本清理 ANSI，产物采用 attachment/octet-stream、CSP sandbox；内部异常返回通用错误。 | 未完成全部 Markdown/ANSI 编码变体的模糊测试和生产隔离预览验证。 |

补充需求：会话归档保留文件、删除及 24 小时保留清理、失败清理重试、SDK 私有历史清除、已过期身份拒绝读取、SQLite WAL 备份恢复已在 `tests/maintenance.test.ts` 实测。备份不覆盖已有目标，保留审计与最小计量记录。

| P1 需求 | 实现与测试状态 |
|---|---|
| FR-019 受限规则草稿、校验、发布、回滚 | 模块、管理 API 与管理页已完成；`tests/rules.test.ts` 5 项通过：只接受五组开关和动作字面短语，不接受 JS/regex；316 基线按启用组计算 expectedConfig，每条自定义短语另加来源/否定/条件/引用负例；未验证或旧验证草稿不能发布；发布与审计同事务；SQL 触发器使历史版本不可变；回滚只影响未来 Run，已有 Run 保存旧证据。最终 Playwright 已通过草稿、326例校验、发布、实时试验和回滚流程。 |
| FR-020 Zip/Git 导入 | 导入模块、Broker/Worker/Gateway 接口与 Web 表单已完成，`tests/project-import.test.ts` 6 项通过：默认关闭、Zip Slip/绝对路径/编码别名/大小写重复、链接与特殊条目、损坏校验/压缩炸弹/容量上限、GitHub URL/来源/DNS/重定向限制、自动执行元数据剥离，以及真实 Broker 的属主/版本冲突/二进制预览。GitHub 下载使用受控 fetch 测试数据，未称为公网 GitHub 实测；2 项真实 Gateway→Worker RPC 集成与最终浏览器 ZIP 导入/刷新恢复/二进制预览 E2E 已通过。 |

本轮验收新增测试已执行：

```text
node --import tsx --test --test-concurrency=1 tests/acceptance.test.ts
6 tests passed

node --import tsx --test --test-concurrency=1 tests/rules.test.ts tests/intent-evaluation.test.ts
6 tests passed（含 316 条识别样本）
```

浏览器最终记录 `docs/evidence/playwright-results.json`：`2026-09-23T03:15:43.512Z` 开始，5 passed、0 failed/skipped/flaky，已包含 P1 规则版本管理和项目导入页面。全量命令见 `docs/evidence/implementation.md`。

文档 13 的独立人工标注保留集、付费模型 A/B/C 成本比较、冷热缓存数据和真实并行收益尚未运行。当前数据用于可复现的功能回归，不替代这些评测，也不代表公网发布条件已经满足。

CI 配置位于 `.github/workflows/ci.yml`：Node 24 / pnpm 11.5.0，Ubuntu 与 Windows 执行锁文件安装、依赖边界、类型、单元/schema/安全策略/回环提供商集成测试及执行器编译；Ubuntu 继续构建和 Playwright，并保留失败证据。公网执行固定关闭，CI 不注入真实提供商密钥。配置已经建立，**GitHub 托管 runner 的实际运行尚未发生**；本地通过不能替代首次远程 CI 结果。规则配置与接口使用说明见 `packages/policy/README.md`，P1 页面最终集成验收已通过，最终数量以根实施记录为准。
