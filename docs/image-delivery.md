# 图片交付与浏览器缓存

[文档索引](README.md) · [资源锁字段](resources.md)

图片交付索引使用当前格式 1，绑定基础 Release 分段和 CDN 增量对象。`managed` 模式由部署者显式启用；默认 `none` 不请求游戏图片，不自动回退到第三方来源。内容、图片和账号库存分别校验与存储。

## 两种部署路径

| 路径 | 基础图片 | CDN 增量 | 来源要求 |
| --- | --- | --- | --- |
| 普通 `tools/build.py` | 构建只核验索引，浏览器从固定 Release 分段准备图片。 | 浏览器按需取得缺少的对象。 | 浏览器访问的 Release、重定向源及 CDN 都须允许站点 CORS。 |
| `tools/build_pages.py` 或 `--mirror-images` | 构建端下载并校验基础分段，生成同源用途包及缩略图；浏览器按当前页面需要读取。 | 保持原索引与 CDN 地址，浏览器按需读取；不把增量强行重打进基础包。 | 基础 Release 只需构建端可下载；浏览器直连的 CDN 仍须满足 CORS。 |

两种路径都校验图片身份。基础索引不是用途包规划，不能互相替代；额外来源需要在构建配置中声明并进入 CSP。图片缓存不表示程序具备整站断网启动能力。

## 普通部署的配套锁

```sh
python3 -B tools/prepare_locks.py --release local/incoming/content --output local/locks/update
python3 -B tools/build.py --asset-lock local/locks/update/asset-lock.json --content-lock local/locks/update/content-lock.json
```

`prepare_locks.py` 默认生成 `managed` 锁；无图部署传入 `--mode none`。来源使用固定 HTTPS 地址，不使用 `latest`、登录态或临时签名查询串。浏览器直连的附件若重定向到额外源站，在生成锁时用 `--download-origin https://下载源站` 显式声明。

图片模式、来源集合和程序合同不变时，普通部署可独立安装新内容：

```sh
python3 -B tools/prepare_locks.py --release local/incoming/new-content --site dist --output local/locks/next
python3 -B tools/install_content.py --lock local/locks/next/content-lock.json --asset-lock local/locks/next/asset-lock.json --output dist
```

构建端镜像的站点按 [Pages 发布流程](github-pages.md)更新固定输入并重建，避免旧用途包与新内容不匹配。改变图片模式或新增允许来源也需要重建程序。

## 缓存与恢复

- 图片存入独立的 `gakumas-public-images` IndexedDB，按 SHA-256 与扩展名复用，不与账号或公开内容共用事务。
- 下载不携带账号字段或认证信息。压缩分段、段内对象和 CDN 对象均检查完整性，通过后才缓存。
- 基础包失败不转成 CDN 全量下载。成功分段保留，重试未完成部分；分段内不做 HTTP Range 续传。
- 缓存局部缺失时从相关分段或已声明增量恢复；不按缺失对象比例承诺下载量，初始基础图片无需重复上传 CDN。
- 图片用本地 blob URL 展示，刷新后从缓存恢复。清理浏览器站点数据会移除缓存；清除公共图片缓存不删除账号。
- 「资料与图片」提供完整准备、清理和失败恢复入口。日常浏览按需加载，图片失败不删除资料与库存，也不强制在欢迎页准备完整图库。

来源基础包的每段原始图片上限为 32 MiB；Pages 用途包另有更小的分组预算，见对应发布说明。当前不自动清理所有旧对象，也不改变浏览器的存储策略。

## 验证入口

`tests/browser_image_delivery.py` 覆盖浏览器直连、跨域、真实 IndexedDB、基础包与增量、缓存缺失和失败恢复；`tests/browser_hybrid_images.py` 覆盖同源基础图片与 CDN 增量组合。后台解包与主线程响应见[加载验证](loading-validation.md)。
