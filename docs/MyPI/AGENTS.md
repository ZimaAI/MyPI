# MyPI 实现约束

开始工作必须读取 README.md、STATE.md、docs/01、docs/03、docs/04、docs/07、docs/15 和相关契约；修改前端前实际读取 design.md。

只提供 native/explicit。不要偷偷新增 Adaptive，不添加常驻 loader，不把 OpenPI 的会话永久加载照搬进来。0 扩展按真实 provider tools 验证，不按 UI 验证。

Pi SDK 具体 API 只出现在 pi-adapter；先锁版本和做 Spike。不要发明官方不存在的函数，不将伪代码当作已编译代码。Agent Core 不反向依赖 Gateway/Web。

所有公开工具执行包含基础 read/write/edit/bash，必须走 SandboxPort。用户工作区代码不能接触 API Key、SDK 私有目录或控制面 socket。沙箱不可用时拒绝，不在宿主机执行。公开上线以安全验收为门禁。

一个主 Session 单 writer；子任务独立 Session；工具授权按用户 Run，完整 settled 后释放，子任务用独立快照。ResultInbox 可靠回传、去重、按 originRun 聚合；不要增加模型 status 轮询。

预算包含子任务/重试/压缩/自动摘要。费用和优化数据必须来自真实实验。原型 Mock 不可用作集成失败时的默认回退。

每阶段记录真实命令、结果、证据、未完成项并更新 STATE.md。交付代码、测试、说明和限制，不只说完成。
