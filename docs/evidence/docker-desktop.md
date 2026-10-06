# Docker Desktop 本机部署

2026-10-06，Windows、Docker Desktop 4.89.0、Linux Engine 29.7.2、Compose 5.5.0。

- `node scripts/setup-docker.mjs` 生成独立随机密钥，保存在 Git 忽略的 `.env.docker`，未进入镜像或提交。
- `docker compose up -d --build --wait` 成功构建并启动 `mypi-app-1` 与 `mypi-web-1`。应用容器以 UID/GID 1000 运行，只有 `127.0.0.1:3000` 发布到宿主机。
- Gateway、Worker、Broker 使用原有启动器和隔离 Broker 实现；没有宿主执行回退，没有挂载 Docker socket。`mypi_state` 持久化数据库和工作区。
- 使用 Playwright 与本机 Chromium headless shell 验证真实 Docker 部署：欢迎页、创建会话、README 模板预览、刷新恢复，无页面脚本错误。
- `/health/live` 返回 200；`/health/ready` 返回 503；发送按钮禁用，直接提交 Run 返回 503 / `SERVICE_PAUSED`，与执行关闭的配置一致。
- `docker compose stop` 后再次 `docker compose up -d --wait` 成功，使用同一浏览器身份恢复原会话并读取原模板文件，验证持久化与正常退出后的 Worker 锁清理。
- `pnpm format` 已执行。首次 `pnpm verify` 中 CLI resume 用例超时（74/75 通过）；该文件单独复测 3/3 通过，第二次 `pnpm verify` 退出 0，格式、依赖边界、类型检查、75/75 测试与生产构建全部通过，无失败或跳过。

未配置付费模型、未初始化管理员账号；交互式初始化命令见 [部署说明](../../deployment/README.md#local-docker-desktop)。未运行专用主机隔离验收，公开执行与可选导入保持关闭。此记录不声称模型调用或代码执行已经可用。
