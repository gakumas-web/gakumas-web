# 独立公共内容

Web 0.5.0 接收当前 `gakumas-content` 格式 1，预览期旧结构已退役。内容由 gakumas-data 发布，包含五份公开主数据分包及图片资源索引，不包含玩家库存或图片位图。

## 本地内容包

在「账号数据管理 → 卡片资料」选择「导入内容包」，接受 `gakumas-content-<版本>.json.gz` 或未压缩 JSON。校验通过后保存到独立 IndexedDB，应用并刷新即可。账号库存与笔记保持原存储；换来源或清理浏览器站点数据仍需要自己的账号备份。

本地导入固定为本地内容来源，下次启动不会自动用远程版本覆盖。需要回到频道时点击「检查资料更新」。公共内容缓存不随「清除账号数据」删除，也不包含在账号导出包里。

## 部署内容目录

内容锁示例：

```json
{"format":"gakumas-content-lock","schema_version":1,"version":"20261004.1","manifest":"content-release/manifest.json","sha256":"清单SHA256"}
```

可使用固定 HTTPS `manifest_url` 替代本地 `manifest`。相对路径从锁文件所在目录解析；所有分包与清单放在同一目录。

```sh
python3 -B tools/build.py --content-lock local/content-lock.json --asset-lock local/asset-lock.json
python3 -B tools/install_content.py --lock local/content-lock.json --asset-lock local/asset-lock.json --output dist
```

第一条用于首次构建，第二条只更新内容，不重建程序。也可通过 `--bundle <文件>` 替代 `--lock` 安装离线内容包。

图片启用时使用当前资源锁格式 1 的 managed 模式，锁定与内容包相同的图片索引。基础包和增量图片由浏览器独立缓存，安装工具不再解压旧资源包。

安装器先核验全部文件，准备不可变 `content/releases/<版本>/`，最后原子替换 `content/channel.json`。同版本目录禁止覆盖；发布失败不会切换频道。程序清单不纳入可独立变化的 content/ 文件。

## 在线内容源

默认 `resources/content-source.json` 的 `channel_url` 为 `./content/channel.json`，支持根目录和 Pages 子目录。部署者可改为自己的固定 HTTPS 频道地址；内容服务需允许站点来源的 CORS。CSP 只放行构建时指定的内容源与图片源，运行时内容文件不能引入任意新主机。

浏览器仅发起不带凭据的 GET 请求，URL 不包含账号、持有数据或笔记。新版本完整校验并持久化后才提供应用按钮，应用会刷新页面；最低 Web 版本不满足或内容源离线时继续使用已有资料。首次没有缓存时可使用本地包。

图片模式仅支持 none 和 managed；在线内容更新不会自动启用图片源。

## 独立分包更新（0.5.0）

当前内容格式 1 将发布版本与五个分包的业务 revision 分开。新清单必须为每个业务分包声明独立 revision，正文与之匹配；不同分包不必拥有相同 revision。缺少独立分包 revision 的旧内容会被拒绝。频道、锁与离线容器仍为版本 1。

浏览器更新时，只下载当前激活版本中缺少或内容已变化的分包；未变化文件重新校验后复用，图片索引也采用相同规则。仅发布版本或来源提交改变时，通常只需读取频道和清单。当前会话保持整套旧数据，所有新文件校验并写入缓存后才允许应用；页面加载器以发布清单身份拒绝混装。

当前内容最低要求 Web 0.5.0。已有 0.3／0.4 部署需要先重建并部署程序，之后的同合同内容更新再独立安装。升级源码不自动改写已有 dist、内容锁或频道。

## 库存附魔描述补齐

使用条件变化读取 `playProduceDescriptions`，效果条件变化读取 `playEffectProduceDescriptions`，两者不互相替代。旧内容缺少前者时显式保持不完整，不能借用另一字段或泛化说明冒充完整原文。这里只展示附魔变化说明，仍不合成附魔后的完整技能卡效果。需要在后续内容发布时携带新增字段；源码更新不会自动改写已安装内容。

当前 Web 程序发布清单 format 也重新编号为 1。安装和预检会拒绝旧程序清单；程序重建会拒绝旧内容频道。程序版本号仍为 0.5.0-preview，不能仅凭版本号相同就沿用重置前构建。
