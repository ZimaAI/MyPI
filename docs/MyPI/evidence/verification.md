# 本次交付的实际验证范围

整理日期：2026-09-22。交付状态：设计文档 + 契约草案 + 离线前端交互原型。

## 已实际执行

| 检查 | 实际结果 | 证据 |
|---|---|---|
| 意图规则与工具数量断言 | 90 项通过，0 失败 | rules-result.json；tests/rules.test.cjs |
| Chromium 交互冒烟 | 27 项通过，0 失败 | browser-smoke.json；tests/browser_smoke.py |
| OpenAPI/JSON Schema/SQLite 结构与约束检查 | 13 类检查通过 | contracts-check.json；tests/validate_contracts.py |
| TypeScript 事件契约静态检查 | strict / noEmit 通过 | typescript-check.txt |
| JavaScript 语法检查 | node --check 通过 | prototype/app.js |
| 桌面与移动布局 | 1440×1000、390×844 无页面横向溢出，输入框完整可见 | prototype-chat.png；prototype-mobile.png |

接口草案：26 条路径、31 个方法操作、43 个组件 schema；310 次内部 $ref 引用解析成功。SQLite 草案：24 张表，建表/完整性与外键检查通过；负例覆盖跨主体工作区、预算根、父子任务和后台进程绑定。检查只证明这些结构/样例约束，不证明业务代码实现了鉴权。

测试环境：Node.js 22.16.0、Python 3.13.5、Chromium 144.0.7559.96、SQLite 3.46.1。没有安装 Pi SDK；本环境 Node 版本不满足所读取 Pi main 的 >=22.19.0 要求，不能将本次原型检查解释为 SDK 兼容性通过。

## 浏览器检查方式与限制

执行环境策略拒绝 Chromium 对 file:// 和 localhost 的导航，因此测试使用 Playwright `page.set_content()` 加载实际组装的 index.html 字节，在真实 Chromium 中操作 DOM。未声称静态服务器部署、域名访问、HTTP 鉴权或 SSE 流测试通过。原型没有外部依赖；本次场景未出现未捕获页面异常或网络请求。截图隐藏了短暂 Toast，避免遮挡页面，不改变交互或测试结果。

规则测试是小规模确定性样例，涵盖明确执行、否定、条件、引用、模式、来源、Unicode 和工具数量；不是自然语言全覆盖或对抗安全证明。后端仍必须保留来源校验、规则版本、黄金集回归和安全执行门禁。

JSON Schema 使用 jsonschema 的 Draft202012Validator 检查；未运行完整 OpenAPI 规范专用验证器。SQL 在内存数据库中执行，并未测试真实磁盘 WAL、高并发、迁移升级或崩溃恢复。UI 的模型测试按钮不发真实提供商请求。

## 尚未执行 / 不包含

真实 Pi 会话与动态工具集、模型调用/Token/缓存计费、完整 CLI、Gateway/数据库集成、Cookie/CSRF/管理员认证、SSE 回放/幂等、持久 Inbox/Outbox、Broker/rootless/gVisor、宿主隔离与网络防外传、并行文件合并、资源限制、真实请求树预算、压测、生产部署。状态统一为 NOT_RUN，不填写“通过”。

未取得三个上游仓库可核验的 commit SHA，也未确认 main 文档中的包版本已在 npm 发布。本包的 SDK 相关代码接口若标为 MyPI Port 或伪代码，不是 Pi 官方导出示例。编码阶段首先填写 pi-compatibility.md。

## 复现

```bash
node tests/rules.test.cjs
python tests/validate_contracts.py  # 需要 PyYAML 与 jsonschema
python tests/browser_smoke.py      # 需要 Playwright 与 Chromium
# 可通过 CHROMIUM_PATH 指定浏览器；--no-sandbox 仅用于本地 UI 测试进程。
# 这与真实系统不可信代码执行沙箱的配置完全无关。
tsc --noEmit --strict --target ES2022 --module ESNext contracts/events.ts
```

完整上线验收以 docs/16-acceptance.md 为准；任何安全阻断项未通过时，publicExecutionEnabled 必须保持 false。
