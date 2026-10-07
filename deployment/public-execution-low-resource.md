# 少量访客公网执行：同机独立 rootless Broker

此方案保留现有系统 Nginx 和其他服务的 rootful Docker。`mypi-broker` 是单独的系统用户，仅它自己的 rootless Docker socket 控制任务容器。Gateway/Worker 继续由 `zima` 用户运行，不挂载或读取 Docker socket。Broker 容器仅发布 `127.0.0.1:14103`，与当前关闭态 Broker 的 `14102` 端口分开；已有 MyPI Gateway 仅发布 `127.0.0.1:13080`。公网用户通过现有 HTTPS Nginx 入口访问，不要求额外的个人访问密码。

启用公网 Run 仍受根 `AGENTS.md` 的专用环境 SEC-01–SEC-12 实机验收门禁约束。下列步骤可先建立独立环境和运行隔离探针；探针成功本身不等于全部发布验收通过。**保持应用策略 `publicExecutionEnabled=false`，直到完整证据被记录。**

## 已选资源

显式 `MYPI_PUBLIC_LOW_RESOURCE=true` 时，Broker 同时只允许一个任务容器；每个任务容器为 0.5 CPU、512 MiB 内存且禁 swap、64 PID、128 MiB 工作区 tmpfs。Broker 容器另限 0.5 CPU、512 MiB、128 PID，并为所有访客共享的托管文件设置 1 GiB 应用级总额；宿主磁盘仍需独立的容量监控或文件系统配额。`deployment/mypi-public.resources.conf` 将 Gateway/Worker 服务合计限制为 1 CPU、1.5 GiB、256 任务。Worker 的全站日上限为 20 次根 Run、60,000 Token；更低的现有上限不会被提高。管理员策略仍应设为全站模型并发 1、每访客并发 1、每日根 Run 3、每日 Token 30,000，并在模型服务商后台设置独立的账单硬限额。所有访客共享唯一的执行槽，忙时收到明确限额失败。

## 独立运行时

管理员安装 `uidmap`，创建没有 `docker` 组成员身份的 `mypi-broker` 用户并为其启用 linger。该用户运行 `dockerd-rootless-setuptool.sh install --force`；此处 `--force` 只允许与已存在的 rootful Docker 并存，不停止或改写它。`deployment/install-runsc-rootless.sh` 校验固定的 gVisor 发布包，只在 `/opt/mypi-runsc` 安装二进制并修改 `/home/mypi-broker/.config/docker/daemon.json`，随后仅重启该用户的 rootless Docker。必须验证 `docker info` 的 rootless、seccomp、cgroup v2/systemd 和 `runsc`；实际 CPU/内存/PID 限制仍以任务容器内探针为准。

## 构建与 Broker 启动

提交并校验源码后，运行 `bash scripts/stage-public-broker.sh`。脚本只将已提交代码和编译后的沙箱程序复制到 `/tmp/mypi-public-build-<commit>`，不复制 `.env`、数据库、依赖或 Git 目录。以下的 `STAGE` 替换为脚本输出；命令需要有 sudo 权限的人在仓库根目录执行。

```sh
STAGE=/tmp/mypi-public-build-<commit>
sudo -H -u mypi-broker env XDG_RUNTIME_DIR=/run/user/1004 DOCKER_HOST=unix:///run/user/1004/docker.sock \
  docker build -f "$STAGE/deployment/Dockerfile.sandbox" -t mypi-sandbox:public "$STAGE"
sudo -H -u mypi-broker env DOCKER_HOST=unix:///run/user/1004/docker.sock \
  docker image inspect mypi-sandbox:public --format '{{.Id}}'
```

将上一步输出的 `sha256:...` 传给 `node scripts/prepare-public-broker-env.mjs sha256:...`。脚本仅从现有私密环境读取 Broker token，并写出一个 Broker 专用环境文件；不要把主密钥、Cookie 密钥、模型密钥复制给 Broker。

```sh
sudo install -d -o mypi-broker -g mypi-broker -m 700 /home/mypi-broker/.config/mypi
sudo install -o mypi-broker -g mypi-broker -m 600 \
  "$HOME/.config/mypi-public/broker.env" /home/mypi-broker/.config/mypi/broker.env
sudo -H -u mypi-broker env XDG_RUNTIME_DIR=/run/user/1004 DOCKER_HOST=unix:///run/user/1004/docker.sock \
  docker build -f "$STAGE/deployment/Dockerfile.broker-public" -t mypi-broker-public:1.0.0 "$STAGE"
sudo -H -u mypi-broker env XDG_RUNTIME_DIR=/run/user/1004 DOCKER_HOST=unix:///run/user/1004/docker.sock \
  docker compose -f "$STAGE/compose.public-broker.yaml" up -d --no-build --wait
sudo -H -u mypi-broker env XDG_RUNTIME_DIR=/run/user/1004 DOCKER_HOST=unix:///run/user/1004/docker.sock \
  docker compose -f "$STAGE/compose.public-broker.yaml" exec -T broker \
  node --import tsx scripts/smoke-public-execution.ts
```

Broker 启动时使用 `PUBLIC_EXECUTION_ENABLED=true`，但在 Gateway/Worker 仍指向旧的关闭态 Broker、应用策略仍关闭时，不会开放公众 Run。探针确认 rootless/runsc、无任务网络、无宿主挂载和秘密、真实 cgroup 限额、所有权、唯一执行槽及取消清理；失败则保持应用关闭态并调查。

探针通过后，把 `MYPI_EXTERNAL_BROKER=true`、`MYPI_BROKER_URL=http://127.0.0.1:14103` 和 `MYPI_PUBLIC_LOW_RESOURCE=true` 加到 `~/.config/mypi-public/env`，重启 `mypi-public.service`。确认 `/health/ready` 响应同时具有 `ready:true`、`sandboxEnforced:true`、`publicExecutionEnabled:false`。完成 SEC-01–SEC-12 实机验收、测试默认模型及管理员额度设置后，才在后台把 `publicExecutionEnabled` 打开。任何隔离、模型或额度失败都应保持可见失败。

## runsc 与 rootless systemd 故障诊断

在本机，直接任务容器返回 `systemd error: Interactive authentication required`。第一次仅配置 `--systemd-cgroup=false` 的试验仍返回相同错误，说明该配置未改变实际行为。`deployment/probe-runsc-fs-rootless.sh` 仅在 `mypi-broker` 的 Docker 配置中临时增加 `runsc-fs-probe` 和临时包装脚本，过滤最终传给 runsc 的 systemd cgroup 参数，尝试在该用户已委派的 cgroup v2 中运行。它仍要求 Docker CPU、内存及 PID 硬限制，不使用 `--ignore-cgroups`、不切换到 runc，也不修改系统 Docker。脚本结束时恢复原配置、重启该用户的 Docker 并删除临时包装脚本。**即使最小容器能启动，仍必须验证真实 cgroup 限额和完整隔离探针；不得据此直接开放公网执行。**

```sh
sudo bash deployment/probe-runsc-fs-rootless.sh
```

## 回退

先在后台关闭 `publicExecutionEnabled`；然后停止 Broker Compose，并让应用重新指向关闭态 Broker。保留私密环境、SQLite 和 Broker 卷用于调查与备份，不删除其他服务的容器或数据。
