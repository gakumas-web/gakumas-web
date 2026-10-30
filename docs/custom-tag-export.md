# 自定义标签导出

[文档索引](README.md)

## 使用方式

在“账号 → 自定义标签”中点击“导出自定义标签”，下载当前账号的 JSON 文件。文件只包含当前快照中带有至少一个自定义标签的普通回忆和选拔回忆，每条记录仅包含完整稳定标识 `key` 和全部自定义标签 `customTags`，不重复携带回忆属性或卡组数据。

导出不受当前页签、搜索、筛选或分页影响。没有已标记记录时按钮禁用；仅有普通回忆或仅有选拔回忆的账号同样可以导出。已不存在于当前快照的旧标签关联不生成虚构记录，也不补入历史库存。

这是通用数据导出，不选择某个特定标签，不包含退役、删除或其它操作指令。读取方可以自行按标签定义业务规则，无需 Web 为某一种后续操作提供专用入口。导出不修改账号数据，不向外部程序发送请求。

## 文件结构

| 字段 | 含义 |
| --- | --- |
| `format` | 固定为 `gakumas-custom-tag-export`。 |
| `schema_version` | 当前为 `1`。 |
| `publicUserId` | 当前账号 ID。 |
| `exported_at` | 带时区的文件生成时间。 |
| `sources.memories` | 普通库存来源的 `captured_at` 和 `identity_type`；未导入该类快照时为 `null`。 |
| `sources.selectionMemories` | 选拔库存来源的 `captured_at` 和 `identity_type`；未导入该类快照时为 `null`。 |
| `memories` | 已标记普通回忆；每条仅含 `key` 和 `customTags`。 |
| `selectionMemories` | 已标记选拔回忆；每条仅含 `key` 和 `customTags`。 |

两类数组按 `key` 排序，`customTags` 去重并稳定排序。导出前仍使用 `parseSnapshot` 和 `parseSelectionSnapshot` 验证完整来源快照，验证后只提取稳定标识。卡片、强化、附魔、道具、属性、保护状态与使用状态均不写入标签文件；需要执行操作的读取方应重新核对当前状态。

顶层格式、schema 1、账号和来源元数据保持不变，现有采集器可直接读取精简记录；旧文件中的额外采集字段仍不参与退役资格判断。

文件不包含未标记回忆、未使用的标签目录、收藏、界面偏好、选拔详情补采、派生排序字段或内部配置缓存。账号、来源及标签库必须一致，不能把两个账号混入同一文件。

## 稳定标识

Web 工作副本不保留原始持有记录 ID，导出沿用现有完整标识，不更改库存存储合同：

- 普通回忆：`identity_type: "userMemoryId-sha256"`，`key = SHA256(UTF8(userMemoryId))`。
- 选拔回忆：`identity_type: "selection-prefixed-userSelectionMemoryId-sha256"`，`key = SHA256(UTF8("selection:" + userSelectionMemoryId))`。

两者均为 64 位小写十六进制字符串，不能使用界面短码代替。读取方如需要关联原始采集记录，按对应算法计算后匹配即可。文件不含真实游戏操作所需的认证材料，也不代表任何操作已经执行。

导出含账号与用户标签关联，应作为个人文件保存，不纳入公共资料或源码。
