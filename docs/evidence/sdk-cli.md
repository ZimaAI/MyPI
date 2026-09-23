# SDK、独立 CLI 与识别回归证据

日期：2026-09-23。环境：Windows x64、Node.js v24.16.0。以下测试实际运行；没有使用付费模型，也没有把 loopback 测试提供商的固定回答当作真实模型能力评测。

## SDK 锁定和上游核验

- 官方当前包 `@earendil-works/pi-coding-agent@0.87.1`，同族 `@earendil-works/pi-ai@0.87.1`，要求 Node >=22.19.0。旧 `@mariozechner/pi-coding-agent` 可安装版本为 0.73.1，本项目未采用旧包。
- 官方 npm registry 返回的 `gitHead` 为 `f07218c4d4bbc12bef056a7058c3dd49dfe41abe`，许可证 MIT。此值是发布元数据，未另行克隆仓库证明源码构建可复现。
- npm tarball integrity：`sha512-m8ArJUtVcQMSe1lLE/Ei7vX/JV7O39sWmWBsXV2NOU70F0qCp8GubA24pT3LnwTmM6LL2xV80/h6sQg85n69ew==`。
- 最终 `pnpm-lock.yaml` SHA256 为 `6ae4a5c06ffa8f785ae5cba945ec37c03287d3caabd5a5334e8941961b5c82ff`；它是依赖锁文件摘要，不是 Git 提交 SHA。
- 参考：[官方 SDK 文档](https://github.com/earendil-works/pi/blob/f07218c4d4bbc12bef056a7058c3dd49dfe41abe/packages/coding-agent/docs/sdk.md)。同时解包读取已发布版本的 `sdk.d.ts`、`agent-session.d.ts`、`model-runtime.d.ts`、`resource-loader.d.ts` 和运行实现。

核验命令：

```powershell
node --version
npm view @mariozechner/pi-coding-agent version engines repository gitHead --json
npm view @earendil-works/pi-coding-agent@0.87.1 version engines repository gitHead --json
npm view @earendil-works/pi-coding-agent@0.87.1 version dist.integrity gitHead license --registry https://registry.npmjs.org --json
npm pack @earendil-works/pi-coding-agent@0.87.1 --pack-destination $env:TEMP --silent
Get-FileHash pnpm-lock.yaml -Algorithm SHA256
```

实际使用的 SDK API 为 `createAgentSession`、`SessionManager`、`ModelRuntime`、`SettingsManager.inMemory`、`createExtensionRuntime`、`subscribe`、`prompt`、`waitForIdle`、`abort`、`dispose` 和 `setActiveToolsByName`。官方 `tools` 参数是名称数组，不是文档旧伪代码里的执行对象。MyPI 工具通过 `customTools` 注入，同名覆盖基础四工具，所有执行由 Core 的 Port 决定。

本实现由 Core 在原始 human 输入入口生成授权快照，Adapter 在 `prompt` 前应用工具名，不使用未经验证的模板展开后文本匹配钩子。资源 Loader 完全不扫描目录，关闭 SDK 提示模板、Skills 和工作区上下文发现。私有 SDK history 与可执行工作区分开；恢复时只应用当前 Run 提供的工具快照。

## 实际测试

```powershell
node --import tsx --test tests/pi-adapter.test.ts
node --import tsx --test --test-concurrency=1 tests/cli.test.ts tests/core.test.ts
node --import tsx --test tests/core-lifecycle.test.ts
node --import tsx --test tests/intent-evaluation.test.ts
node --import tsx --test tests/event-reliability.test.ts
node node_modules/typescript/bin/tsc --noEmit --pretty false
```

| 测试文件 | 实测结果 | 证明范围 |
|---|---:|---|
| `tests/pi-adapter.test.ts` | 7/7 通过 | 真实 Pi SDK 经 OpenAI-compatible HTTP transport 请求 loopback 提供商 |
| `tests/cli.test.ts` | 3/3 通过 | 参数/配置、真实 CLI 子进程搜索执行、SQLite 会话列表、EOF 管道恢复 |
| `tests/core.test.ts` | 9/9 通过 | Run 授权释放、并行 Session、任务/目标、幂等、预算、公开环境拒绝本地执行 |
| `tests/core-lifecycle.test.ts` | 5/5 通过 | 取消清理顺序、队列取消、根请求总用量、摘要取消、已知 Token 结算 |
| `tests/intent-evaluation.test.ts` | 316 个 case 全通过 | 有标签的确定性开发回归集，包含负例与原文偏移 |
| `tests/event-reliability.test.ts` | 2/2 通过，各 1000 组 | 乱序/重复 UI 投影、持久结果和 Inbox/Outbox 恢复 |
| TypeScript 全项目检查 | 退出码 0 | 以上验证时刻的源码，无生产运行声明 |

SDK 请求断言直接检查 loopback HTTP 服务接收的 `tools`，覆盖普通 Run 四个基础工具、显式工具激活、第二次普通 Run 释放、两 Session 不共享消息。执行测试强制四个基础名称全部走注入函数；恶意 `.pi/extensions` 和工作区 `AGENTS.md` 不会被发现。取消测试让工具挂起直到 AbortSignal 到达，检查 prompt 拒绝前已清理。503 测试证明每次重试单独预留和结算，失败且无 usage 时保留 unknown。长历史触发 SDK 自身自动压缩，证明压缩的无工具请求同样被预算边界覆盖并在 prompt 完成前结算。

Adapter 不在低层 `agent_end` 或单 turn 结束时卸载。它等待 `prompt`、`waitForIdle`、所有 provider ledger settlement 完成后释放扩展面。已禁用提供商内部隐式重试和缓存预热，SDK 的有界重试经过同一个请求计量包装。

CLI 通过 Core、SDK、SQLite 和 `TrustedLocalSandbox` 独立运行，不启动 Gateway，不要求管理员账户。`run --json` 的 stdout 仅 JSONL 事件，诊断写 stderr；交互支持模式切换、任务/进程查看、取消、新会话和退出。恢复记录原工作目录，旧 grants 不继承。管理员初始化用终端隐藏输入，无默认密码。CLI 明确显示 trusted-local 和工作目录，这不属于公网沙箱隔离证明。

## 识别回归结果及修复记录

`fixtures/golden-intents.json` 有 316 个按 text/source/mode 去重的例子、24 个类别，包含提供的原型全部测试输入，以及搜索/委派/工作流/后台/会话、普通请求、否定、条件、讨论、代码/多种引号、强分句边界、Unicode、长度、native 和非 human 来源。

初次运行有 11 个负例误授权：避免、拒绝、停止使用、取消使用、没有必要、没有说要、不再、暂停，以及单弯引号和法文引号。已扩充保守拒绝规则及引号屏蔽。不会把“使用后台工具停止进程”误视为停止使用该能力。

| 分组 | TP | FP | FN | Precision | Recall | F1 |
|---|---:|---:|---:|---:|---:|---:|
| search | 42 | 0 | 0 | 1 | 1 | 1 |
| delegate | 33 | 0 | 0 | 1 | 1 | 1 |
| workflow | 20 | 0 | 0 | 1 | 1 | 1 |
| background | 24 | 0 | 0 | 1 | 1 | 1 |
| session | 22 | 0 | 0 | 1 | 1 | 1 |

回归集 exact-set accuracy = 1；187 个负例，误触发 0；拒绝率 = 187 / 316 = 59.18%。测试输出完整 JSON 指标、case ID 和失败样例，命令可重放。

**标签由实现代理编写并沿用原型，不是独立人工标注的保留集。** 修复使用了本集反馈，因此这些数字只说明回归通过，不能泛化为开放自然语言识别精度。文档要求的独立人工复核与按意图模板划分保留集仍需实际执行。

## 1000 组事件与持久队列故障注入

`tests/event-reliability.test.ts` 不调用模型。每个序号种子生成一组真实事件 DTO，测试确定性的乱序、重复、snapshot cursor 后重连、延迟的非终态通知；共 1000 组，检查消息没有重复、文本完整、task/result 归属正确、terminal 不回退。Reducer 只推进连续 sequence，对 gap 缓冲，snapshot 从自己的 cursor 开始重新投影。

持久化测试使用真实 SQLite 文件，逐组验证事务提交前抛错回滚、提交后订阅者通知抛错、两次重复完成通知、关闭后重新打开数据库、1000 个唯一 result/inbox 和 outbox 项、500 个 claim 未 ack 的条目重启可见、幂等 ack 不重复副作用。测试发现并修复提交后的 EventEmitter 异常被误当成事务失败的问题：通知失败不会撤销或破坏已提交状态，Outbox 保留重放依据。

这里的“故障注入”是确定性异常和数据库重开；没有宣称模拟了操作系统断电、磁盘损坏、网络任意丢包或真实 Worker 被 SIGKILL 的所有窗口。测试中的 Inbox claim/ack 事务验证存储能力，运行时自动摘要仍由 Core 的 originRun 聚合测试单独覆盖。

## 尚未测量的部分

- 没有生产提供商 API Key，未执行真实模型质量、费用、冷/热缓存收益、并行加速比或 Token 优化实验。固定 loopback 的 usage 字段仅用于验证计量管道。
- SDK 自动重试、自动压缩、取消和私有存储恢复已测试；未声称所有上游 provider 都经过同等集成验证，当前 HTTP 实测适配为 OpenAI-compatible。
- 本证据不覆盖 Linux rootless/gVisor 网络、CPU、内存、PID、磁盘硬限额；公网执行仍依赖执行器门禁及单独部署验收。
- 未以本测试中的耗时宣称 P95 服务指标，也未把本地普通文件复制等同于 OS 权限隔离。
