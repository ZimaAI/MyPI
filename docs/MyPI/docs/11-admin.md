# 11 · 管理后台规格

## 1. 目标

管理员能清楚回答：谁在使用、使用什么模型、为什么加载某工具、执行了什么、消耗多少、是否越界，以及怎样停止。后台不是任意远程脚本控制台。

## 2. 模型管理

字段：displayName、providerType、modelId、approvedEndpointId、enabled、publicSelectable、defaultForGuests、input/output pricing、currency、contextWindow、maxOutputTokens、timeout、reasoning 配置白名单、版本。

API Key 使用服务器主密钥加密或受控 Secret Store；主密钥不进入数据库备份、不进入工作区或前端。GET 仅返回 keyConfigured 与掩码指纹；编辑空值表示保持不变，独立 clear 操作表示删除，避免把空字符串误当清空。

“连接测试”是受限管理调用：指定小输出预算、禁止任意工具、固定短输入、计入管理费用并留审计。测试失败的模型不能设为游客默认。禁用当前默认模型时要求指定替代或明确关闭公开执行。仅兼容锁定 SDK 实际支持的 provider adapter，不承诺任意 OpenAI-compatible 接口完全兼容。

模型配置新版本对新 Run 生效；禁用/撤销密钥对下一实际调用立即检查。正在进行的提供商调用尽力取消，不能保证撤回已发生费用。不要在同一个 SDK Session 流式过程中无锁切模型。

## 3. 游客管理

查看匿名编号、创建/最近访问时间、请求/Token/费用、并发 Run、风险标记和封禁状态。默认不展示完整 IP；查看必要安全细节须额外权限与审计。

封禁操作包括 reason、expiresAt、cancelActive=true；服务器拒绝新运行，撤销活动 lease，推送 policy.revoked。解除封禁不自动增加余额、不恢复已取消进程。手动调整额度以 adjustment ledger 记录，不能直接覆盖已消费事实。

删除访客数据异步清理工作区/历史/产物；管理员也不能通过文件路径读取不在其授权范围的系统文件。

## 4. 策略管理

策略是带版本的结构化配置，不允许管理员上传任意执行代码。设置项：公开执行开关、每用户/每 IP/全站限额、root tree 调用上限、并发、运行时长、进程 TTL、磁盘/pids/内存、五组是否允许、允许模板/模型、日志保留。

普通修改下一个 Run 生效；收紧安全限制和紧急停止在每次执行点检查。放宽限制不能在旧 Run 中静默扩大权限，需要新请求。UI 显示 effectiveVersion 与 pendingVersion。

## 5. 规则管理

P0：内置版本化规则 + 试验台；P1：编辑有限词表/模板配置，支持草稿、校验、黄金集回归、发布、回滚。禁止执行任意管理员 JS 正则代码；如允许正则需限制语法、长度、执行时间和 ReDoS 风险。

试验台显示 mode/source/命中组/拒绝原因/原始片段，允许测试否定、条件、引用和普通输入。发布必须附自动回归报告。回滚只改变未来 Run 的判定，不伪造旧运行历史。

## 6. 运行、任务和审计

运行详情包含输入摘要、模型版本、规则版本、Grant、实际工具面、工具执行记录、子任务树、预算、错误与取消状态。日志经过密钥和路径脱敏；管理员查看内容正文另记 audit。

审计字段 actorId、action、resourceType/id、reason、before/after 摘要、requestId、occurredAt、结果；密钥不出现在 before/after。审计不可由普通管理 API 删除或改写；底层备份/保留策略由运维受控执行。

## 7. 管理 API 范围

`POST /admin/login`；`POST /admin/logout`；`GET /admin/overview`；`GET/POST /admin/models`；`PATCH /admin/models/{id}`；`POST /admin/models/{id}/test`；`GET /admin/visitors`；`PATCH /admin/visitors/{id}`；`GET/PUT /admin/policy`；`POST /admin/rules/test`；`GET /admin/executions`；`POST /admin/emergency-stop`；`GET /admin/audit`。

P1 增加 rules draft/publish/rollback。所有批量停止/提高预算/密钥变更都要求说明，并在 UI 显示影响范围。原型后台只是流程体验，不包含有效认证。
