# 图片资源配置

[文档索引](README.md) · [图片交付与缓存](image-delivery.md)

图片模式仅有 `none` 和 `managed`。默认 [resources/asset-lock.json](../resources/asset-lock.json) 为 `none`，不请求游戏图片。旧 `bundle`／`cdn` 模式和旧索引结构不兼容；构建生成的用途包规划不能作为来源资源锁。

## 资源锁

```json
{"format":"gakumas-web-assets-lock","schema_version":1,"mode":"managed","version":"example","index":"incoming/resource-index.json","sha256":"图片索引SHA256","download_origins":[]}
```

| 字段 | 含义 |
| --- | --- |
| `format`、`schema_version` | 必须是当前资源锁合同，不通过改旧文件编号迁移。 |
| `mode` | `none` 关闭游戏图片；`managed` 使用已声明索引。 |
| `version`、`sha256` | 绑定资源索引的版本和原始字节身份。 |
| `index`／`index_url` | 本地索引或固定 HTTPS 索引，二选一；本地相对路径以锁目录为基准。 |
| `download_origins` | 普通浏览器直连模式需要的额外下载源站，例如附件重定向目标；只声明源站，不填写临时签名地址。 |

索引必须包含 `files`、`baseline`、`cdn_objects`、`cdn_base_url`，并覆盖内容要求的图片。内容清单绑定相同索引字节；新锁不能使旧内容静默换成另一套图片。

## 推荐配置流程

从完整内容发布目录运行 `tools/prepare_locks.py` 生成配套锁，避免手填版本和哈希。首次构建与更新命令见[维护说明](maintenance.md#独立更新与配套锁)。构建端镜像与浏览器直连的来源要求不同，详见[图片交付](image-delivery.md#两种部署路径)。

本地锁、图片字节和缓存不进入公开源码。Docker 不读取开发者的 `local/`，运行中修改环境变量也不会改变已生成的图片配置。
