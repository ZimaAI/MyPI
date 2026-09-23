# 生命周期与备份验证

日期：2026-09-23，Node.js 24.16.0。

实际执行：

```text
node_modules/.bin/tsx --test --test-concurrency=1 tests/maintenance.test.ts
tests 4; pass 4; fail 0; skipped 0
duration_ms 5143.1771

node_modules/.bin/tsx --test --test-concurrency=1 tests/maintenance.test.ts tests/integration.test.ts
tests 6; pass 6; fail 0; skipped 0
duration_ms 12593.3577

node_modules/.bin/tsc --noEmit
exit 0
```

- 过期guest在清理前即拒绝授权；清理后正文、消息、run、task、workflow、inbox、patch、artifact、workItem、goal、process、SSE、Outbox、幂等引用和选中的SDK历史均被移除，其他主体与其他SDK历史保留。
- 保留费用Token/版本字段和最小审计，不在计费记录保留prompt/debug正文；重复清理幂等。
- Broker清理失败保留deleting与删除引用，下次维护自动重试；不会先删引用而失去物理清理依据。
- 归档停止资源但保留文件；显式删除通过Worker同时移除工作区与数据库正文；截断文件不会导出成半个文件。
- 数据库仍处于WAL连接中时执行一致备份；备份包含已提交的产物内容和额度表，恢复 `integrity_check=ok`，manifest哈希/长度匹配，已有备份拒绝覆盖。

这些测试验证应用逻辑与本地文件/SQLite操作。全量部署恢复仍需将停写后的Broker目录、SDK私有目录与数据库一同恢复，并提供单独保存的主加密密钥。
