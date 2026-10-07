# 本机 Docker 执行验收

日期：2026-10-06。Windows Docker Desktop Linux containers，cgroup v2 / cgroupfs / seccomp / runc。用户明确授权仅本机运行例外；没有宣称通过公网 rootless/runsc 或 SEC 专用主机验收。

## 部署与资源

- `mypi-app-1`：1 CPU / 1 GiB，Gateway + Worker。
- `mypi-broker-1`：0.5 CPU / 512 MiB，独立可信 Broker，唯一挂载 Docker socket 的 MyPI 服务。
- `mypi-web-1`：0.25 CPU / 128 MiB。
- 临时任务：1 CPU / 1 GiB / 128 PID / 禁 swap，单并发；UID 10001，根目录只读、全部 capability 移除、no-new-privileges、seccomp、禁网、无宿主挂载。
- 常驻容器实测空闲内存约 281 MiB；含一个任务的配置内存上限合计 2.625 GiB。不是负载峰值压测。
- 仅 app 发布 `127.0.0.1:3000 -> 8080`；Broker、Worker 没有外部端口。Docker Desktop 全局资源及其他项目容器未改动。
- 保留 `.env.docker` 和 `mypi_state`。切换前 SQLite 一致性备份：`/data/backups/before-local-execution-20261006`，31 页，SHA-256 `db611ba6cd9798b7cef6b3ba19fd2edbbf9493b92d730cf9e96f0bddec178506`。
- `PUBLIC_EXECUTION_ENABLED=false`；本机 opt-in 开启。应用层历史字段 `publicExecution` 开启，并写入策略版本/审计，模型全局和单用户并发均为 1。
- `/health/ready` 实测 200：`ready:true, sandboxEnforced:false, publicExecutionEnabled:true`。`sandboxEnforced:false` 明确表示未通过公网隔离要求，本机 Broker 以 `isolated-local` 提供独立状态。

## 验证结果

| 验证 | 结果 |
|---|---|
| `pnpm format` / `pnpm verify` | 退出 0；边界、格式、类型、88/88 自动测试及构建通过，见 [原始记录](local-docker-verification.txt)。 |
| 最终脚本类型与格式检查 | `pnpm typecheck`、`pnpm format:check` 退出 0。 |
| 聊天与管理后台 Playwright | 4/4 通过，无失败/跳过，见 [报告](local-docker-browser.json)。使用安装的 Chromium headless shell。 |
| 真实 Broker / Docker 容器 | UID、只读根、无宿主数据/密钥/控制 socket、cgroup CPU/内存/PID 限制、seccomp/capabilities、外网和元数据阻断、文件快照持久化、单并发与取消清理通过，见 [输出](local-docker-smoke.txt)。另检查真实容器 HostConfig 与 Mounts。 |
| 真实模型网页任务 | DeepSeek V4.1 Flash 使用工具写入并读取 `local-deployment-check.txt`，任务 succeeded，文件 API 核实内容，刷新恢复成功；见 [结果](local-docker-live.json) 与 [实际截图](screenshots/local-docker-live.png)。已查看截图。 |
| 清理 | 验收工作区/会话已删除；最后查询无任何 `mypi.sandbox=true` 残留容器。 |

首次 Broker 并发测试使用同一个工作区，先命中工作区锁返回 `CONFLICT`；修正为两个独立工作区后验证全局单名额返回 `LIMIT_EXCEEDED`，没有放宽断言。保留 [首次输出](local-docker-smoke-initial.txt)。

首次真实模型任务在发起网络请求前被预算拦截，见 [首次输出](local-docker-live-initial.txt)：原模型最大输出 100,000，大于现有每日 50,000 额度。按照单人轻量部署需求将最大输出调为 8,192，保留服务商、密钥、协议、上下文和每日额度。先通过实际 Worker 连接测试，再以乐观版本更新保存新的测试版本并写审计。该连接测试记录输入 110 / 输出 11 Token；最终网页任务页面显示 3,413 Token。未配置价格，不能推算实际费用。

## 范围限制

这是用户授权的本机单人 runc 部署；Broker 拥有 Docker daemon 控制权，属于可信服务。没有把 Docker Desktop 声称为公网专用 rootless/runsc 环境，也没有消除 Docker/runc 自身漏洞风险。没有修改公网的发布要求；新增回归验证公网 Core 拒绝本机 Broker，混用公网和本机开关、非回环 host/origin、可变镜像均被拒绝。这里只验证了一个轻量真实模型任务，不代表重型构建、多人负载或所有扩展工作流的生产验收。

日常操作见 [部署说明](../../deployment/local-docker.md)。
