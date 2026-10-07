# 本机单人 Docker Desktop 执行

本方案是用户明确授权的本机例外，使用独立 Broker 和 Docker Desktop 的 runc。仅发布 `127.0.0.1:3000`；不是公网 rootless/runsc 验收通过的部署。公网 profile 拒绝 `isolated-local` 就绪状态。不要通过端口转发、隧道或反向代理向其他用户开放此配置。

## 资源与边界

| 服务 | CPU 上限 | 内存上限 |
|---|---:|---:|
| Gateway / Worker | 1 核 | 1 GiB |
| Broker | 0.5 核 | 512 MiB |
| Nginx | 0.25 核 | 128 MiB |
| 临时执行沙箱（最多 1 个） | 1 核 | 1 GiB |

内存上限合计 2.625 GiB；CPU 是各容器上限，并非预留。镜像构建不受这些运行时上限约束。Docker Desktop 的全局资源不修改，其他项目容器不受影响。安装脚本不创建用户、覆盖密钥或启用应用策略。

只有 Broker 挂载 Docker socket；Broker 因此是有权管理 Docker Desktop 容器的可信服务。Gateway/Worker 没有控制 socket，执行沙箱没有任何宿主挂载、端口、模型密钥或 Docker socket。沙箱禁网、根文件系统只读、UID 10001、全部 capability 移除、no-new-privileges、128 PID、禁 swap。镜像通过本地不可变 `sha256:` image ID 固定。保留 seccomp 和 cgroup v2 检查。没有宿主 shell 执行回退。

## 安装与启动

在仓库根目录执行；先备份现有 SQLite 和私有数据。保留 `.env.docker` 及 `mypi_state` 卷。

```sh
pnpm install --frozen-lockfile
node scripts/setup-local-execution.mjs
node scripts/local-docker.mjs start
node scripts/local-docker.mjs check
```

`check` 会使用真正的 Broker/临时容器验证 UID、只读根目录、无宿主状态和秘密、禁网/元数据阻断、cgroup CPU/内存/PID 限制、文件持久化、单并发和取消后清理。验证临时工作区会删除，不调用模型。

管理员先保存模型、连接测试通过并设为游客默认。然后执行：

单人轻量配置建议最大输出设为 **8,192 Token**，并保留每日 50,000 Token 额度。系统按输入上界加最大输出预留预算；例如最大输出 100,000 会在调用前被 50,000 的日额度拦截。修改模型参数后必须重新测试连接，再设为游客默认。

```sh
node scripts/local-docker.mjs enable
```

该操作检查本机 Broker 和默认模型当前测试版本，将应用层任务开关开启，模型全局/单用户并发设为 1，保存策略版本与审计；不修改额度、模型配置或 `PUBLIC_EXECUTION_ENABLED=false`。历史 API/界面中的“公开执行”字段在此仍表示应用允许任务，网络可达范围由仅本机部署约束。

访问 http://localhost:3000。`/health/ready` 返回 `ready:true`；`sandboxEnforced:false` 表示没有通过公网隔离条件，不是本机执行失败。

```sh
node scripts/local-docker.mjs status
node scripts/local-docker.mjs stop
node scripts/local-docker.mjs start
```

更新代码后重新运行 setup，再 start；不要仅用基础 `docker compose up` 启动，否则缺少本机 overlay。停止不删除卷。回退到只读演示部署前，先在后台关闭任务执行，再用上述 stop 停止本机方案，随后使用基础 compose 启动并移除已停止的 Broker 服务容器（保留数据卷）。

## 配置文件

- `compose.local-execution.yaml`：显式本机 overlay，与 `compose.yaml` 一起使用。
- `.env.local-execution`：构建脚本生成的镜像 ID，不进版本控制。
- `.env.docker`：原有凭据，继续保留；不要复制进镜像。
- `AGENTS.md`：记录用户授权的本机例外；公网发布门禁保持不变。

不支持同时运行多个管理同一 Docker daemon 的 MyPI Broker；重启时的孤儿清理以 `mypi.sandbox=true` 标签识别任务容器。
