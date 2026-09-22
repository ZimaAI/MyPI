# 14 · 部署、容量预算与运维

## 1. 部署档位

Local：CLI 或只绑定 loopback 的开发 Web，可选择明确标注的 trusted-local。Public-demo：HTTPS、游客身份、生产构建前端、私有 Gateway/Worker/Broker、隔离沙箱、配额和审计全部启用。无安全配置不允许启动 public profile。

为便于个人演示，默认单机、单 Gateway 实例、单 Worker。参考配置不需要 Redis、Kafka、Kubernetes。SQLite 适合本设计的轻量起步，但并发上限必须用本机测试决定，不宣称可支持任意访客量。

## 2. 4 核 / 8 GiB 轻量参考预算

这是容量规划示例，不是对用户本项目服务器的确认，也不是压测结果。使用外部模型 API，不在该机器部署大模型。

| 项目 | 参考内存预算 |
|---|---|
| OS、容器运行时、文件缓存 | 1.5 GiB |
| Nginx + 静态前端 | 0.2 GiB |
| Gateway + SQLite + 事件 | 0.6 GiB |
| Agent Worker 与 SDK 会话 | 1.2 GiB |
| 全部公开沙箱合计 | 2.0 GiB |
| 余量 | 2.5 GiB |

全局最多 3 个 in-flight 模型请求、2 个执行沙箱；公开沙箱 CPU 合计最多 2 核。Node 构建较重时单个沙箱可用更大份额，但减少并发，不通过无限 swap 假装容量足够。后台进程包含在其沙箱资源总额里，不能另开无限预算。真实性能受项目规模、工具链和 gVisor 兼容影响。

## 3. 上线顺序

构建前端与 Worker/Gateway → 准备加固离线工具镜像并固定 digest → 初始化数据库迁移和管理员 → 配置可信模型与小预算测试 → 设置 TLS/代理 → 验证沙箱无法访问控制面 → 运行安全验收 → 打开 PUBLIC_EXECUTION_ENABLED。

仓库锁文件固定依赖；运行时不执行 npm install、不自动拉取未知扩展。数据库、会话、工作区分别使用私有目录权限。容器不以 latest 镜像漂移启动。

## 4. 配置与启动校验

配置样例见 deployment/config.example.yaml 与 .env.example。Secret 不写进版本库；主密钥来自运行环境或 Secret Store。启动必须验证：无默认管理员密码、密钥主密钥存在、受限 broker 可达、sandbox enforcement 生效、public profile 下禁止 host executor、外网关闭、目录权限、数据库迁移完成、模型配置可用。

仅 Nginx 对公网发布 443/必要的 80 跳转；Gateway、Worker、Broker 与数据库无公网端口。正确配置 SSE 禁用代理缓冲；反向代理允许的 forwarded headers 来源固定。

## 5. 健康检查与熔断

`/health/live` 判断进程活着；`/health/ready` 判断数据库、worker command path、broker 策略和必要模型配置就绪。提供商临时失败不暴露内部凭据；连续失败可以暂停新调用并展示明确状态。

关键警报：日预算达到 80%/100%、持续 usage_unknown、sandbox 清理失败、磁盘低于 20%、事件队列增长、异常请求量、管理员登录失败激增。提供商账单侧另设硬预算；应用额度不是外部账单的唯一保障。

## 6. 关停与升级

先停止接收新 Run → 推送维护状态 → 等待有界期限 → 取消剩余模型/工具 → Broker 清理整个树 → 刷新事件与审计 → 关闭 SQLite。超过宽限期保留 interrupted 状态，不把中断当成功。

升级先备份数据库和产物索引，执行向前迁移；不支持的降级必须拒绝启动。锁定 Pi 版本变化时跑 SDK Spike + CLI + 负例 + SSE + 沙箱测试。单 Worker 升级有维护窗口；不假装无状态滚动升级。

## 7. 数据回收与备份

沙箱 idle 30 分钟释放、后台硬 TTL 10 分钟、游客数据 24 小时、运行日志 7 天、安全/计费审计 30 天均为可调默认。清理任务是幂等的，需记录清理失败与重试。限制压缩包大小与产物总量；生成压缩包也在受限执行环境进行。

每日一致性备份，定期恢复到隔离测试目录并核对 quota/inbox/artifact 引用。不可把 API Key 明文混入备份；备份加密密钥与数据分开。公网执行遭遇异常时先 emergency stop 再保留必要审计，不继续尝试完成用户任务。
