# 12 · 独立 CLI、SDK 适配与开发入口

## 1. CLI 命令（拟定合同，尚未安装实现）

```bash
mypi                           # 当前目录交互，默认 explicit
mypi --mode native             # 固定四个基础工具
mypi --cwd ./demo --mode explicit
mypi run "使用搜索工具查找入口" --json
mypi sessions list
mypi resume <session-id>
mypi doctor                    # SDK/工具链/沙箱/配置兼容诊断
mypi admin bootstrap           # 服务器本地初始化管理员，安全交互输入
```

CLI 交互命令 `/mode native|explicit`、`/tasks`、`/processes`、`/cancel`、`/new`、`/quit` 是 TUI 控制命令，不是常驻 LLM 工具。查看/取消已有资源通过权限控制的应用服务，不要求激活模型工具。Web 对应按钮复用控制面语义。

## 2. 配置

本地配置与公开服务配置分开。CLI 私有路径 `~/.mypi/`；项目 `.mypi/` 只存非敏感配置且需显式 trust，不能自动执行配置代码。优先级：CLI 显式参数 > 已信任项目配置 > 用户配置 > 默认；安全约束只可收窄，不允许参数把 public profile 变为 trusted-local。

`trusted-local` 明示会用启动用户权限操作本机项目；建议默认先确认工作区。`public-demo` 必须提供 SandboxPort，无本地降级。CLI 不要求用户登录网页，无 Gateway 也可运行。

## 3. Agent 核心接口（MyPI 设计，不是 Pi 官方 API）

```ts
interface MyPiAgentService {
  open(input: OpenConversation): Promise<AgentHandle>;
  submit(handle: AgentHandle, input: HumanInput): Promise<AcceptedRun>;
  events(handle: AgentHandle, after?: number): AsyncIterable<AgentEvent>;
  cancel(runId: string): Promise<void>;
  close(handle: AgentHandle): Promise<void>;
}
```

Port 划分：PiRuntimePort、SessionRepository、TaskRepository、EventStore、QuotaPort、PolicyPort、SandboxPort、Clock、IdFactory、Logger。单元测试可用 fake runtime 与内存仓储，无模型费用。

## 4. PiAdapter 限定职责

只有该包直接导入 `@earendil-works/pi-coding-agent`。负责创建/释放 AgentSession、资源加载器隔离、工具注册和激活、订阅流事件、最终完成判断、取消、历史恢复与模型配置适配。对外转换为 MyPI 稳定 DTO。

核验依据：官方 SDK 存在 createAgentSession、SessionManager、subscribe/prompt/abort/dispose 及 custom tools 入口；具体签名会变。官方扩展支持 before_agent_start 与 setActiveTools；并区分 agent_end/settled（参考 00 的 S2/S3）。不要复制过时博客中的包名、tool 对象形状或模型认证实现。

每次替换 SDK Session，重新绑定所有订阅并释放旧实例；事件回调携带 session generation，避免旧异步结果写入新会话。对 raw provider response 的 Token/费用适配应覆盖已允许模型，不伪造不存在的字段。

## 5. 输出与退出

TUI 展示文本、工具卡、当前活跃数量、并行任务概要、队列与退出提示；非交互 `--json` 以稳定 JSONL 输出事件，stderr 放诊断。SIGINT 首次取消当前主 Run，再次请求退出并清理；退出必须处理子任务/后台进程，不留孤儿。

退出码：0 成功；2 输入/配置错误；3 策略或额度拒绝；4 模型/工具执行失败；130 用户取消。任务部分失败在 JSON 中有明细，不以 0 掩盖失败。

## 6. CLI 验收

不启动 Gateway 的情况下：普通请求仅基础四工具；显式搜索可运行；第二条普通输入恢复 0 扩展；子任务并行且不共享消息；Ctrl+C 可清理；重启恢复历史但不恢复旧 grants；模式/模型切换在安全边界生效。Windows 的 Shell、进程树、路径与 Unix 差异需单独验证，首个公网服务器目标为 Linux；不把 Linux 测试结论扩大到 Windows。
