# 2026-10-07：mypi.zimagent.top 本机部署进度

- 检查 `.github/workflows/ci.yml`：已有 push、PR、手动触发的 Ubuntu/Windows 校验，以及 Linux Playwright 流程；无需新增工作流。
- 现有系统 Nginx 服务占用 80/443，并启用了 `algo-motion`、`zhigenews`、`zima-astro-blog` 等站点。新服务使用空闲的 `127.0.0.1:13080`、`127.0.0.1:14101`、`127.0.0.1:14102`，未修改现有 Nginx 配置。
- `mypi-public.service` 已作为用户级 systemd 服务启用并运行，`loginctl show-user zima -p Linger` 为 `yes`。私密环境文件权限 0600，配置和数据目录 0700。没有把凭据和运行数据加入 Git。
- 回环实测：`/health/live` 返回 200，`/health/ready` 返回预期的 503；HTTPS Origin 的游客会话返回 201，Cookie 带 `__Host-` 前缀、`HttpOnly`、`Secure`、`SameSite=Lax`。
- `pnpm format`、`pnpm verify` 通过，后者为 88/88 自动测试及生产构建。定向聊天浏览器测试使用本机已有的 Chromium headless shell，4/4 通过。首次未指定浏览器路径导致 4 项无法启动；重跑后通过。Nginx 配置以非特权端口替换监听地址后进行解析测试，语法通过。
- 原记录时本账号没有免密码 sudo；管理员随后安装了 MyPI 独立 Nginx 站点和证书。2026-10-07 再测 `https://mypi.zimagent.top/health/live` 返回 200，证书校验通过；`/health/ready` 仍返回 503，执行没有启用。域名解析为 `36.151.151.229`。

发布边界：本机 `isolated-local` Docker 执行方案不接入该公网域名。公网执行验收未完成，`PUBLIC_EXECUTION_ENABLED=false` 和导入关闭保持不变。

## 2026-10-07：少量访客执行准备

- 用户澄清公网访客均可访问，无需个人 Basic Auth。曾生成但未安装的个人访问密码文件和 Nginx 候选文件已删除；现有站点没有 `auth_basic`。
- 管理员安装了 `uidmap`，新增无 `docker` 组身份的 `mypi-broker` 用户（UID 1004；独立 subuid/subgid 65,536 个），并启动其独立 rootless Docker。已校验并安装 gVisor `runsc release-20260928.0`，SHA-512 归档值写入 `deployment/install-runsc-rootless.sh`。该脚本仅更改 Broker 用户的 Docker 配置，不改动系统 Docker daemon。
- 新增显式低资源沙箱配置：一个执行槽，每个容器 0.5 CPU、512 MiB、64 PID、128 MiB 工作区 tmpfs；Broker 0.5 CPU/512 MiB，Gateway/Worker 用户服务 1 CPU/1.5 GiB。Worker 在新配置下把全站额度收紧到每日 20 Run / 60,000 Token。
- 策略修改前创建一致性 SQLite 备份 `/home/zima/.local/share/mypi-public/backups/before-low-resource-20261007`：31 页，SHA-256 `d6ea3f669549fc19f95e5d3a8da06751361d4261a06beee8b903ec26f561db15`。应用策略已审计更新为版本 2：每访客每日 3 Run / 30,000 Token，模型全局及单访客并发均 1，最多 4 次模型调用、1 个子任务、120 秒后台 TTL；`publicExecution=false` 保持关闭。一个管理员和一个已测试的游客默认模型存在；凭据未输出。
- `mypi-broker` 已在自己的 rootless Docker 中构建固定沙箱镜像 `sha256:e4dabcb10aff5ccc1d784211e3ae7d6feb32723a6a8abdca25ed30961105ab5b`；已准备仅含 Broker token、镜像 ID 与 runsc 的私密环境文件。Broker 改用 `127.0.0.1:14103`，避免与当前关闭态 Broker 的 `14102` 冲突。
- `pnpm format`、`pnpm verify` 再次通过，后者为 91/91 自动测试及生产构建。新增测试验证跨访客并发创建不能突破 1 GiB 应用级托管文件总额；这不代替宿主磁盘文件系统配额。
- 首次 Compose 启动两次因 Buildx 错误地读取了不可访问的 `/home/zima/Develop/Projects/MyPI` 构建上下文而失败，未改动该目录权限，也未动系统 Docker。已改为从可读的 `/tmp` 目录直接构建 Broker 镜像，再让 Compose `--no-build` 启动；等待实机结果。
- 独立 Broker 镜像启动、真实 rootless/runsc 沙箱、SEC-01–SEC-12 和公网端到端 Run 尚未实测，**不得宣称公网执行已完成**。
