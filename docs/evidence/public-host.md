# 2026-10-07：mypi.zimagent.top 本机部署进度

- 检查 `.github/workflows/ci.yml`：已有 push、PR、手动触发的 Ubuntu/Windows 校验，以及 Linux Playwright 流程；无需新增工作流。
- 现有系统 Nginx 服务占用 80/443，并启用了 `algo-motion`、`zhigenews`、`zima-astro-blog` 等站点。新服务使用空闲的 `127.0.0.1:13080`、`127.0.0.1:14101`、`127.0.0.1:14102`，未修改现有 Nginx 配置。
- `mypi-public.service` 已作为用户级 systemd 服务启用并运行，`loginctl show-user zima -p Linger` 为 `yes`。私密环境文件权限 0600，配置和数据目录 0700。没有把凭据和运行数据加入 Git。
- 回环实测：`/health/live` 返回 200，`/health/ready` 返回预期的 503；HTTPS Origin 的游客会话返回 201，Cookie 带 `__Host-` 前缀、`HttpOnly`、`Secure`、`SameSite=Lax`。
- `pnpm format`、`pnpm verify` 通过，后者为 88/88 自动测试及生产构建。定向聊天浏览器测试使用本机已有的 Chromium headless shell，4/4 通过。首次未指定浏览器路径导致 4 项无法启动；重跑后通过。Nginx 配置以非特权端口替换监听地址后进行解析测试，语法通过。
- 本账号没有 Docker socket 访问权，也没有免密码 sudo。系统 Nginx 站点安装、证书签发、最终公网 HTTPS 访问尚未执行。域名当前解析到 `36.151.151.229`，访问时落在现有默认站点；公网入口是否最终指向本机仍需管理员确认。

发布边界：本机 `isolated-local` Docker 执行方案不接入该公网域名。公网执行验收未完成，`PUBLIC_EXECUTION_ENABLED=false` 和导入关闭保持不变。
