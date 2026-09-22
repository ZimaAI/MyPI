# Pi SDK 兼容性验证记录（待真实实现）

状态：**NOT_RUN**。不能把本模板作为已执行证据。

待填写：实际安装包版本、对应 commit SHA、lockfile 哈希、Node 版本、OS、命令、使用的测试模型/fake provider 与提供商适配器。

| 场景 | 当前状态 |
|---|---|
| 创建独立主 / 子 AgentSession，验证历史不共享 | NOT_RUN |
| 默认四基础工具与精确 tool schema 数量 | NOT_RUN |
| 注册但未激活的工具不出现在 provider payload | NOT_RUN |
| 原始 human 输入捕获早于模板 / Skill 展开 | NOT_RUN |
| before_agent_start 中工具激活及时进入实际 provider payload | NOT_RUN |
| 自动重试 / 压缩 / follow-up 不提前清空同一 Run 授权 | NOT_RUN |
| 最终 settled 完成后卸载，下一个普通 Run 无 MyPI schema | NOT_RUN |
| 独立子任务快照、取消与无工具自动摘要 | NOT_RUN |
| 四基础工具全部重定向到受限执行 Port | NOT_RUN |
| 私有 ResourceLoader 禁止工作区动态扩展发现 | NOT_RUN |
| SDK 新建 / 切换 / 恢复后事件订阅重新绑定 | NOT_RUN |
| ModelCall 钩子覆盖子任务、重试、压缩与摘要 | NOT_RUN |

每项填写命令、脱敏日志/输出哈希、预期/实际、通过/失败原因；失败先修 PiAdapter，不允许公开 profile 降级为宿主执行。
