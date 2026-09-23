# 执行器验证记录

日期：2026-09-23。环境：Windows、Node.js 24.16.0、Docker Desktop 29.7.2。以下是实际运行结果，不代表生产主机安全验收已通过。

## 已运行

```text
node_modules/.bin/tsx --test --test-concurrency=1 tests/sandbox.test.ts
tests 12; pass 12; fail 0; skipped 0
duration_ms 9079.7149

node_modules/.bin/tsc --noEmit
exit 0

node_modules/.bin/tsc -p deployment/tsconfig.sandbox.json
exit 0
```

测试覆盖：真实文件读写/edit、expectedVersion 冲突、literal 搜索、纯 Node 生成模板 Git 基线后真实 git log/show/diff、拒绝参数 flag 注入、路径穿越/NTFS 编码形式、硬链接、跨主体拒绝、只读任务拒绝 Bash、独立副本与 baseRevision 冲突、正常应用 patch、真实后台 `node --test`、事件等待、显式取消、私有 HTTP Broker 认证与方法限制、关闭公开执行时无宿主回退、24 小时保留清理的时间边界、删除 CLI 会话不删除原项目。

取消测试用一个原定 20 秒结束的 Node 子进程；实际取消在约 2 秒内结束。最初只用 Windows taskkill 时观察到子进程创建竞态；实现已改为 PowerShell 进入 kill-on-close Windows Job Object，再执行用户命令，退出和取消都会关闭整个租约。Linux CLI 以独立进程组清理；公网隔离使用独立容器 cgroup，不能把 CLI 进程组当作公网隔离证据。

## Docker 门禁实际检查

`docker info` 返回：

```text
OSType=linux
CgroupVersion=2
CgroupDriver=cgroupfs
SecurityOptions=["name=seccomp,profile=builtin","name=cgroupns"]
Runtimes=io.containerd.runc.v2,nvidia,runc
```

此环境没有 `rootless` 安全选项，也没有默认要求的 `runsc`。只读运行 DockerSandbox.health（传入格式正确但不代表实际镜像的测试 digest，以验证运行时门禁）得到：

```json
{"ready":false,"profile":"isolated","publicExecutionEnabled":true,"reason":"需要 Linux rootless、seccomp 和有效 cgroup v2 限额"}
```

未更改 Docker Desktop 配置，未停止用户既有容器。未启动公开执行。配置文件 `PUBLIC_EXECUTION_ENABLED=false` 保持默认关闭。

## 尚未通过的发布条件

实际 rootless + runsc 沙箱镜像构建/启动、沙箱内宿主秘密探测、元数据/出口阻断、CPU/内存/PID/tmpfs 硬限额、恶意 detached 进程全树回收等专用部署环境测试均为 **NOT_RUN**。生产镜像 digest 需要部署者构建并固定，不能把测试 digest 作为可用镜像。完整 SEC-01–SEC-12 还需要 Gateway/Worker 身份、预算和产物安全证据。未满足之前公开执行始终拒绝，无 trusted-local 降级。

每个身份的托管工作区/副本/后台快照内容总量限定 256 MiB，持久化提交按身份串行；单快照 64 MiB、单文件 2 MiB、10,000 文件。工作区状态位于 Broker 私有目录，不挂载进容器。原生工具进入执行隔离；UI 文件查看走单独鉴权的快照只读接口，因此关闭公开执行时仍可查看离线模板。
