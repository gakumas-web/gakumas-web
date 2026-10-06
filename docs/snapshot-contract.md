# 采集文件合同

两项目仅交换用户选择的 JSON 文件，不互相导入源码、不共享运行时服务或材料。当前合同统一为 `format: "gakumas-capture"`、`schema_version: 1`；两项和有效的 `publicUserId` 都必填。格式标识用于区分早期开发版本，不能只把旧文件版本号改成 1 后导入。

| `source` | schema | 内容 |
| --- | --- | --- |
| `user_get` | 1 | 完整主库存：memories、idolCards、items、idolCardSkins、supportCards、achievements、characters |
| `selection_memory_list` | 1 | 选拔回忆列表及过期 ID |
| `selection_memory_get` | 1 | 带入回忆、支援卡及培养时详情，含必需的继承阶段字段 |

只接受上述来源名称和当前完整结构，不兼容旧版 schema、`User.Get` 别名、匿名档案或旧选拔详情。定义的容器即使为空也必须存在；必需字段缺失时拒绝导入，不补造默认数据。Web 仍按白名单丢弃不用于界面的附加字段，不持久化照片路径或原始持有记录 ID。

输出在 `snapshot_dir/accounts/<publicUserId>/` 下按类型分类，每个时间目录内的文件名仍为 `snapshot.json`：

```text
accounts/<publicUserId>/
├── inventory/<时间>/snapshot.json
├── selection/<时间>/snapshot.json
└── selection-details/<时间>/snapshot.json
```

时间目录使用 UTC，名称为 `YYYYMMDDTHHMMSS[.纳秒]Z`，不再添加类型前缀。主库存去重及 `snapshot_keep` 仅作用于 `inventory/`；选拔列表独立去重，详情索引只扫描 `selection-details/`，不自动复制旧平铺目录。Web 仍选择整个账号目录，按正文来源识别文件，递归读取三类子目录。

账号 ID 只允许 1–64 个 ASCII 字母、数字、下划线和连字符；无法确认身份时采集器不导出无归属快照。

`captured_at` 包含时区，可能有纳秒精度；消费者不能只按目录名或截断至毫秒排序。历史比较仍支持多份当前格式快照，旧采集时间不等于旧文件格式。

快照不包含认证头、cookie、会话令牌或完整账号响应。字段白名单以采集器 `network/rpc/*_export.go` 为准；公开测试只使用合成账号与记录。

## 浏览器与备份

Web 使用独立的 `gakumas-web` IndexedDB（版本 1）及 `gakumas-web:` 偏好键，不读取或迁移早期浏览器档案，也不写入旧笔记。账号为空时保持未选择状态。

当前账号数据包使用 `gakumas-web-account-package`、版本 1，内部为 `gakumas-web-account-backup`、版本 1。全部采用 gzip，可选择 AES-GCM 加密，保存库存历史、选拔详情、标签、收藏和偏好。旧数据包、旧工作台备份和旧独立选拔备份均不恢复。

升级本次开发格式后须重新导入当前格式账号目录。不会自动清除浏览器中其他命名空间的数据。

采集器按 achieve-／achievement_ 前缀输出成就进度，不依赖逐项目录名单。Web 保留合法但暂未识别的成就记录，更新公开目录后可解释其进度；旧快照中从未采集的进度仍需重新采集，不能由公开资料补造。
