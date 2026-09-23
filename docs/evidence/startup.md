# 真实服务启动与退出验证

日期：2026-09-23。环境：Windows、Node.js 24.16.0。运行入口为仓库实际 `scripts/dev.mjs`，没有使用测试版 Gateway、Worker、Broker 或内存服务替身。

可重放命令：

```sh
node scripts/smoke-startup.mjs
```

检查脚本先申请三个空闲回环端口，再使用系统临时目录保存独立数据库和 Broker 工作区。所有认证密钥现场随机生成；不读取仓库 `.env`，不创建管理员、不配置模型、不传入提供商密钥。`PUBLIC_EXECUTION_ENABLED=false`、`MYPI_ENABLE_IMPORTS=false` 始终保持关闭。子进程使用 `windowsHide: true` 和 IPC，不打开独立窗口。

实际输出：

```json
{"checks":"production launcher / real RPC / isolated broker metadata","ports":[52364,52365,52366],"live":200,"readiness":503,"guest":201,"conversation":201,"workspace":200,"file":200,"templateFiles":4,"run":{"status":503,"code":"SERVICE_PAUSED"},"publicExecutionEnabled":false}
{"shutdown":{"code":0,"signal":null},"workerLockRemoved":true,"allPortsClosed":true}
```

验证路径：

1. Launcher 启动 Gateway、Worker 与 Broker，三端口均开始监听，`GET /health/live` 返回 200。
2. 因公开执行关闭，`GET /health/ready` 返回 503，没有把存活状态当作可执行状态。
3. 经真实 Gateway HTTP 创建游客 Cookie/CSRF，再通过真正的 WorkerClient RPC 创建 JavaScript 模板会话；Worker 委托 Broker 创建托管工作区，返回 4 个模板文件。
4. 使用该游客身份读取工作区和其中的 JavaScript 文件，均返回 200 和非空文件内容。
5. 同一身份提交 Run，返回 503、`SERVICE_PAUSED`。没有发出模型请求或执行用户命令。
6. 向 Launcher 发送 `mypi:shutdown`，其通过 IPC 关闭三个服务。实际退出码为 0；Worker 状态锁不存在；三个分配端口均无法连接。随后删除检查脚本创建的临时目录。

此验证证明默认关闭执行时，实际入口的启动、跨服务模板读取、暂停门禁及 Windows 正常退出链路可用。它没有启动 runsc 容器，不代表公开执行隔离、真实模型调用或生产 HTTPS 部署已经通过验收。隔离环境范围见 [执行器验证](sandbox-verification.md)。
