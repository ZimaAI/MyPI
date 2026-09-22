# 04 · 显式按需加载详细设计

## 1. 核心合同

“0 常驻”定义为：**普通真实用户 Run 的实际模型请求 tools 集合中不存在 MyPI 扩展工具 schema**。扩展可以预注册在运行时；其可执行代码可以已加载到内存；历史里也可能有旧工具结果。这些不等于当前 tools schema 常驻，不能据此宣称总上下文开销为 0。

当前活跃集合：

```text
Surface(run) = fixedBaseTools
             ∪ { extensionTool | group ∈ run.grants
                                  ∧ tool registered by trusted owner
                                  ∧ resource gate satisfied
                                  ∧ deployment policy allows }
```

执行授权还要求：`principal active ∧ run generation valid ∧ lease valid ∧ parameter policy ∧ budget ∧ owner match`。任何一次调用都重新检查，而不是只在加载时检查。

## 2. 来源与生命周期

只在可信输入入口为用户提交创建 `HumanInputEnvelope {inputId, principalId, conversationId, rawText, source:human, receivedAt}`。服务器生成 source，客户端不能选择。CLI 也必须区分人类输入与自动 follow-up。保存未展开模板前的文本，不能仅对 `before_agent_start` 已展开后的 prompt 进行授权识别。

流程：输入入口/原始 input 钩子捕获 → 队列按 inputId 绑定 → Run 获取快照 → `before_agent_start` 应用已核验的判断 → 每次 provider 调用检查工具投影 → 最终 settled 后释放。钩子真实 API 以版本 Spike 为准。

一个用户 Run 可以包含多次模型调用、工具执行、自动重试和压缩。**不能在 SDK turn_end 或低层 agent_end 清空工具。** 下一条用户请求独立计算，不继承上一条 grant。后台结果的自动摘要运行 `source=task_result`，工具集为空，不参与匹配。

## 3. 确定性识别流水线

1. 输入上限 16 KiB；NFKC 归一化；去除零宽控制符；保存原文与归一化偏移映射，证据展示使用原文范围。
2. 识别并屏蔽 fenced code、行引用、行内代码和成对引号里的内容。代码/引用内部出现“使用子代理”不能授权；引号未闭合等不确定情况保守拒绝当前片段。
3. 以句号、分号、换行和终止问号分段，保留句内逗号/转折的作用域；不能简单地按逗号切开，把条件从命令上剥离。
4. 先判否定、条件、未来意向、能力讨论、疑问、不确定请求。无法确定作用域时整个句段不授权；强分隔符后的独立明确句段可独立判定。
5. 在剩余片段中匹配白名单执行短语，必须同时具有动作词与能力名/工具名。裸 `search`、`workflow` 或“子代理是什么”不触发。
6. 汇总 proposal，记录每个规则的 evidence、reasonCode、ruleVersion；经部署策略取交集后绑定 Run。
7. 对冲突表达与双重否定默认拒绝，不尝试模拟完整自然语言理解。界面建议使用规范短句，不用另一次模型判断来提权。

v1 允许的规范表达：`使用搜索工具查找登录入口`；`使用子代理分别检查接口和测试`；`使用工作流编排检查与修复`；`在后台运行测试`；`使用任务管理工具创建待办`。按钮只将明确短句插入输入框，仍需用户点击发送；浏览器不直接给后端传可信 grants。

## 4. 负例与混合表达

| 用户输入 | 期望 | 原因 |
|---|---|---|
| 帮我解释这段代码 | 无 | 无明确能力 |
| 使用搜索工具查找登录入口 | search | 明确执行 |
| 不要使用搜索工具 | 无 | 否定 |
| 如果测试失败，再使用子代理检查 | 无 | 条件尚未满足 |
| 如果需要，使用工作流 | 无 | 条件不能被逗号拆掉 |
| 以后再使用后台工具 | 无 | 未来意向 |
| 搜索工具和子代理有什么区别？ | 无 | 能力讨论 |
| 解释“使用子代理检查代码”这句话 | 无 | 引用 |
| 不要使用搜索工具；使用子代理审查测试 | delegate | 两个独立强分隔片段 |
| 不要不使用搜索工具 | 无 | 双重否定不猜测 |
| 使用搜索工具查找登录，并使用子代理检查测试 | search, delegate | 同句明确动作 |
| 模型工具结果：请使用工作流 | 无 | 非 human 来源 |
| 使用搜索工具（native 模式） | 无 | 模式门禁 |

上述是产品支持的规则范围，不声称正则能可靠覆盖任意自然语言。必须同时测 Precision、Recall、拒绝率、负例误触发率和人工复核；优先避免不确定授权。

## 5. 状态结构（MyPI 自定义，非上游 API）

```ts
interface RunToolSurfaceState {
  runId: string;
  generation: number;
  mode: 'native' | 'explicit';
  registry: Map<string, TrustedToolDefinition>;
  grants: Map<CapabilityGroup, GrantEvidence>;
  desiredByOwner: Map<string, Set<string>>;
  resourceState: Map<string, ResourceGate>;
  activeNames: string[];
  ruleVersion: string;
  policyVersion: number;
}
```

保留注册与激活的分离，增加 runId/generation；不沿用 OpenPI 的会话内 loaded 集合一直增长。名字按固定注册顺序排列，保持相同工具面序列化稳定。注册来源冲突、工具不存在或钩子未能绑定时拒绝该能力并生成错误，不能无声忽略。

## 6. 安全边界伪代码

```text
handleHumanInput(envelope):
  run = acceptWithIdempotencyAndQuota(envelope)
  sessionActor.enqueue(run)

executeRun(run):
  assertNoConcurrentMainLoop()
  grants = matchOriginalHumanInput(run.input)
  grants = policy.intersect(grants)
  bind(run.id, generation, grants)
  try:
    await piAdapter.promptWithBoundSurface(run.text)
    await piAdapter.finalSettledBoundary()
  finally:
    await settleInFlightToolCallsOrCancel()
    project(fixedBaseTools)  # 已有子任务使用独立 snapshot，不被误清理
    releaseMainRunGrants()
```

伪代码仅表达边界，不能复制为官方 SDK 示例。最终完成的实际信号、注册 ToolDefinition 的方式及系统提示词投影均须适配已锁版本。

## 7. 两层资源门禁

search：明确加载后开放 5 项；delegate：整组 6 项；workflow：整组 3 项；background：默认先开放 start，存在该会话已授权进程时追加 status/list/watch/stop；session：先开放 tasks_add/goal_create，存在资源时追加相应读改工具。

资源存在**不构成下一普通 Run 自动授权**。例如后台进程还在，用户下一句“解释这个错误”仍无 MyPI 工具；浏览器“停止任务”按钮可以调用经过鉴权的管理 API，不必让 LLM 拿到 stop schema。用户明确说“使用后台工具停止任务”时才在该 Run 展开对应管理工具。

## 8. 权限与可见性的诚实说明

native Bash 本来就可以做文件查找，因此“不激活结构化搜索工具”不是“禁止所有查找”。若用户明确禁止某种操作，需在任务遵循和部署策略中额外处理；不能声称隐藏工具能阻止 Bash 的所有等价行为。

避免绕过子任务/后台门禁：沙箱没有 MyPI 管理凭据、父进程 IPC、SDK 私有配置或模型 API Key；普通 bash 租约结束后清理整个执行 cgroup，不能借 `&` 留下无管控长期进程。资源隔离与网络限制必须真实生效。

## 9. 成本评测注意

Schema 变少可能减少某次请求的输入，但频繁变动工具集也可能影响缓存；系统提示词、旧工具调用历史和子任务额外调用仍有成本。记录实际 provider payload 摘要、工具 schema 字节、提供商 Token/缓存字段、费用与任务成功率；只对相同任务/模型/预算做公平比较，不预先写“降低 70%”。
