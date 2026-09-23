# 受控项目导入验收

日期：2026-09-23。范围为 FR-020 P1；默认部署开关 `MYPI_ENABLE_IMPORTS=false`。以下为本机代码与本地 fixture 实测，不是公共部署隔离环境已通过的声明。

实现入口为 `packages/project-import/src/index.ts` 的 `ProjectImporter.fromZip/fromGitHub`，落盘入口为 `SandboxPort.importWorkspace`。只向托管会话主工作区写入受限文件快照；下载、解包与导入不调用 Git、shell、仓库脚本、包管理器或模型。GitHub 仅允许固定 HTTPS API/归档端点，DNS 必须全部为公网地址，实际 TLS 连接固定使用已验证地址，每次重定向重新验证，最大 3 次。依赖固定为 `yauzl@3.4.0`。

## 已运行检查

- `node --import tsx --test tests/project-import.test.ts`：6/6。覆盖默认关闭、合法文本/二进制 ZIP、执行配置/ Git 元数据过滤、绝对/穿越/编码/NTFS 路径、大小写/Unicode/文件目录冲突、软链接/硬链接扩展/特殊文件、CRC、条目数、压缩/展开/单文件/解压比例、取消；GitHub 公共 metadata 与 redirect fixture、混合/私网 DNS、非白名单重定向、私有仓库、下载上限；Broker 属主、修改 revision 冲突、二进制预览、大于 3 MiB 的合法导入与普通 RPC 上限。
- `node --import tsx --test tests/project-import-integration.test.ts`：2/2。真实 Fastify Gateway → 私有 HTTP Worker RPC → 托管工作区 → SQLite，覆盖两端独立关闭开关、无需模型即可创建/导入、CSRF、跨 owner、幂等重放、旧 revision 409、穿越归档拒绝、文本/二进制预览、二进制导出 415、会话删除清除导入/产物记录及文件。
- TypeScript 全项目 `tsc --noEmit` 通过；具体全套与前端 E2E 结果由主验收记录统一保存。

ZIP fixture 在 `tests/helpers/zip.ts` 本地生成。GitHub 下载使用注入 fetcher/DNS fixture，未发起真实外网仓库请求、未使用 GitHub 凭据。模拟运行时若导入意外创建模型 Session 会直接抛错。

归档限制：10 MiB 压缩、32 MiB 展开、2,000 项、每文件 2 MiB、100:1 展开比、30 秒总 deadline。Broker 再次验证快照路径、编码、大小、属主与修改版本；只在当前模板未改或给出匹配 revision 时允许替换。导入省略 `.git/.pi/.mypi/.agents/.codex/.claude/node_modules/dist/.next` 和 MCP/Git 子模块配置，并返回遗漏列表。受限根目录依然服从每主体 256 MiB 总内容配额。

## 未运行与上线门禁

真实 GitHub HTTPS/DNS/证书/下载服务环境的联网 smoke test：**NOT_RUN**。Nginx/systemd 实际部署：**NOT_RUN**。本机缺少规定的 rootless/runsc 环境，SEC-03/04/05/10 仍由 sandbox-verification.md 记录为待专用环境验证。不能凭 fixture 结果开启公共执行或公共导入；部署示例保持两者关闭。
