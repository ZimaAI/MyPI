# 13 · 评测、观测与可用于求职的证据

## 1. 评测目标

证明 MyPI 确实控制了工具面、减少误触发、让独立任务并行且可靠回传；同时不损害任务完成度或突破预算。所有优化需有 baseline、可复现样本、环境和原始记录，不用原型数字冒充结果。

## 2. 加载识别评测

建立至少 200 条人工标注样本：明确请求、否定、条件、引用/代码、能力讨论、多个能力、跨句否定、双重否定、英文混写、零宽字符、长文本和非 human 来源。按意图模板分组划分开发集与保留测试集，避免仅更换文件名的同模板泄漏。

多标签评价每组 Precision/Recall/F1、exact-set accuracy、负例误触发率、拒绝率，另列 source spoofing 和复杂否定。不能只报准确率，因为多数正常输入为无工具。安全关键负例必须全部通过发布门禁；开放自然语言不能承诺 0 误判。

原型提供小规模回归集，只证明样例函数在给定输入上的行为。生产识别器还需原始偏移映射、复杂引号解析、规则版本审计与来源认证。

## 3. 工具上下文成本

三种评测配置：A 原生四工具；B 所有 MyPI 工具常驻（仅离线 baseline，不作为产品第三模式）；C MyPI explicit。对需要高级能力的任务，A 可能无法完成，不能只比较价格不报告成功率；对普通任务比较 B/C 更能衡量 schema 成本。

记录：实际发送工具数量、schema UTF-8 字节、有效输入/输出 Token、cache read/write Token（提供商可得时）、首 Token、总耗时、模型调用数、工具错误、总费用。成本 = 按当次模型价格版本对 provider usage 逐项结算；统计每根 Run 包含全部子调用、重试和自动摘要。

同模型、同任务、同仓库版本、相同输出限制、固定安全 profile；冷缓存和热缓存分开，多次重复并交错执行顺序。报告中位数/P95、样本量、离散程度和失败项，不只挑最好一次。工具 schema 变少不必然让最终费用下降。

## 4. 并行评测

选可拆分只读任务（接口/测试/配置审查），比较单 Session 顺序完成与两独立子 Session 并行；相同总工作量、模型和评价标准。指标：wall time、总 Token/费用、任务成功率、证据准确率、汇总遗漏率、主会话空闲可响应比例。

加速比 = T_serial / T_parallel；并行效率 = 加速比 / 并行度。若提高并发反而因 API 限速/文件争用变慢，完整记录。写任务单独测 snapshot/patch 合并成本和冲突率，不混入只读速度宣传。

## 5. 事件可靠性与故障注入

测 1000 组不调用模型的任务完成事件：重复、乱序、断连、Worker 在事务前后崩溃、事件已持久化但通知失败、Inbox 已 claim 未 ack。检查唯一结果、无终态回退、可恢复投递与无重复副作用。

SSE 恢复：snapshot cursor 到订阅窗口不漏事件；Last-Event-ID 重连不重复 UI；过期 cursor 正确 reset；断流不重复提交 Run。模型主动 status 调用数在异步示例中应为 0，控制面恢复扫描不计为模型轮询。

## 6. 安全与资源评测

完全在自建隔离环境中测试路径越界、角色注入、跨用户访问、恶意扩展、元数据访问、进程树残留、无限输出、磁盘写满、fork/CPU/内存压力、取消和禁用模型竞态。记录被拒绝的位置及残留资源，不在第三方目标上做测试。

验证 public profile 无法切回 host execution。对于 rootless 环境检查实际生效的 cgroup 限额，不只截图配置文件。配额竞争测试同时启动多子调用，证明预留后余额不超发。

## 7. 观测字段

traceId、requestId、principalHash、conversationId、rootRunId、taskId、modelCallId、toolCallId、ruleVersion、policyVersion、generation。日志默认不记原始密钥和全部代码；工具输出摘要有上限。管理员诊断需支持按 rootRun 查询整棵任务树。

指标：activeToolCount、loadingPrecision、negativeFalsePositive、inflightRuns、inboxLag、eventDeliveryLag、queueWait、modelCallsPerRoot、tokenUsageKnown/Unknown、budgetRejects、sandboxLeaks、cancelLatency、workspaceConflictCount。模型私有推理不作为必须采集指标。

## 8. 结果模板

每份结果包含日期、Git SHA、SDK/模型标识、硬件、安全 profile、数据集、配置、运行命令、原始记录位置、结果表、失败样例、限制。未运行字段写“未测”，不能填 0。面试展示优先拿一条 trace 解释行为，而不是堆指标名。
