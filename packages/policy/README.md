# 意图规则与受限配置

`matchIntent` 只从当前真实 human 输入建立授权。native 模式固定四个基础工具；explicit 模式先处理引用/代码、否定、条件和讨论，再匹配启用组的内置规则与自定义字面短语。NFKC 后的触发证据映射回原始 UTF-16 偏移。扩展授权只属于当前 Run。

FR-019 配置的唯一结构为 `groups`，必须包含 `search`、`delegate`、`workflow`、`background`、`session`。每组只有 `enabled: boolean` 和 `phrases: string[]`。每组最多 12 条，单条 4–80 字符，要求动作词开头，只允许文字、数字、空格、下划线和连字符；不接受 JS、正则或其他字段。关闭组会关闭内置匹配与该组自定义匹配；不能删除安全门禁。自定义英文短语只做 ASCII 大小写折叠，保持证据偏移长度不变。

例如：

```json
{
  "groups": {
    "search": { "enabled": true, "phrases": ["使用代码索引"] },
    "delegate": { "enabled": true, "phrases": [] },
    "workflow": { "enabled": true, "phrases": [] },
    "background": { "enabled": true, "phrases": [] },
    "session": { "enabled": true, "phrases": [] }
  }
}
```

管理员在管理页或 `/api/v1/admin/rules` 接口创建草稿，按 `expectedVersion` 编辑，再调用 `drafts/:id/validate`。校验使用固定的 316 条回归样本：保留启用组的 canonical 预期，禁用组从 expectedConfig 移除；每条自定义短语额外验证正确触发、native、非 human、否定、条件及引用等场景。校验结果包含配置和样本摘要、失败样例及最新草稿版本。样本不是独立人工标注的保留测试集。

`drafts/:id/publish` 必须提交最新草稿版本且此前校验通过；编辑草稿会清除校验。发布时再运行校验，并将不可变规则版本、当前版本指针和审计记录置于同一个 SQLite 事务。`/rules/rollback` 只可选已发布版本，并重新经过当前安全回归集；历史版本受数据库触发器保护，不能修改或删除。

Core 在接受新 Run 时读取活动版本并保存 `ruleVersion` 和触发证据。发布和回滚不重算已接受的 Run、不改变正在运行请求的授权；策略撤销仍由每次工具/模型边界单独检查。CLI 没有管理员数据库中的规则配置时使用内置版本 `explicit-v1`。

测试：`node --import tsx --test tests/rules.test.ts tests/intent-evaluation.test.ts`。管理接口认证、CSRF、乐观版本、未校验拒绝、发布事务回滚、不可变历史、未来 Run 切换以及原始偏移均有回归测试。UI 联调和 CI 实际运行结果参见 `docs/evidence/acceptance.md` 与 `docs/evidence/implementation.md`。
