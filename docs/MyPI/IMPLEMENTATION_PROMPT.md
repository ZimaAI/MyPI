# 交给 Coding Agent 的实现提示词

你正在实现 MyPI。请先实际读取本目录的 README.md、AGENTS.md、STATE.md、design.md，以及 docs/01-product-requirements.md、docs/03-architecture.md、docs/04-tool-loading.md、docs/07-security.md、docs/15-delivery-plan.md 和 contracts/。

目标是基于 earendil-works/pi 的 SDK 实现独立 CLI 和可被 Gateway 调用的 Agent Core。参考 OpenPI 的五组能力和独立会话子任务机制，参考 DeerFlow 的 Harness/App 边界，但不要照搬整套框架。产品只有 native 与 explicit；扩展授权按用户 Run，不是会话永久激活；正常用户 Run 只有四基础工具。

按照后端先行路线推进：先 S0 SDK 验证并锁定版本，再 S1 CLI/search，再 S2 五组与可靠结果队列，再 S3 API/SSE/身份/配额，再 S4 沙箱和后台，再 S5 真实 React 前端，最后 S6 集成验收。

当前交付的 prototype/index.html 是可交互 Mock。请以它为视觉与交互参考，不把它当作真实后端，也不要把原型的计费/测试/模型结果搬成生产数据。

默认按阶段完成，并在每个阶段末给出真实代码变更、运行命令、测试证据、未通过项和下一步；需要阶段验收时询问是否继续。当用户明确要求端到端完成时按阶段门禁持续实现，不在可自行解决的普通设计细节上停下，但缺少真实凭据可用 fake provider 做测试并明确标注，不能伪造真实模型结果。

公开匿名执行安全是硬约束：所有基础和扩展工具走隔离执行器；不存在宿主降级；用户代码无模型密钥、SDK 私有目录、Docker socket 或控制面访问；预算与权限由服务器执行。安全门禁未过时保留 public execution 关闭。

所有实现状态更新 STATE.md；所有 SDK 引用以实际安装版本与官方源码为准。最终输出可运行代码、启动说明、测试报告、已知限制和需求验收映射，不写未经验证的成果比例。
