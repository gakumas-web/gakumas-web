# 浏览器图片缓存与增量更新

Web 0.5.0 使用当前图片交付格式 1。首次下载内容指定的基础 Release 包并保存图片，之后只补充缺少的增量对象。用户无需选择资源包或 CDN；资料更新仍独立于账号库存。

## 部署配置

使用 data 交接的内容发布目录生成配套锁。新图片索引自动选择统一缓存方式：

```sh
python3 -B tools/prepare_locks.py --release local/incoming/content --output local/locks/update
python3 -B tools/build.py --asset-lock local/locks/update/asset-lock.json --content-lock local/locks/update/content-lock.json
```

构建只验证索引和生成访问策略，不下载图片包。图片由浏览器首次使用时准备。以后在同一组图片源站下更新内容无需重建程序：

```sh
python3 -B tools/prepare_locks.py --release local/incoming/new-content --site dist --output local/locks/next
python3 -B tools/install_content.py --lock local/locks/next/content-lock.json --asset-lock local/locks/next/asset-lock.json --output dist
```

Release、CDN 必须提供浏览器可读取的 CORS 响应，且不要求用户登录。索引指定固定地址，不能使用 latest。附件重定向到额外源站时，在首次生成锁时使用 `--download-origin https://下载源站` 显式声明；访问源站集合进入 CSP，改变源站需要重建程序。不要把带临时签名查询串的链接固定到索引中。

源码默认仍不启用任何图片源；部署者显式采用新内容生成锁后，浏览器才开始下载。`--mode none` 可保留无图部署。旧预览版的 bundle／cdn 锁与图片索引已退役；只接受当前结构，不自动转换旧锁。

## 浏览器行为

- 图片存入独立的 `gakumas-public-images` IndexedDB，按图片 SHA-256 与扩展名复用，不与账号数据、备份、公开内容缓存共用事务。
- 下载不携带 cookie、认证头或账号字段。完整压缩段和其中每张图片均校验 SHA-256；CDN 对象也校验大小及 SHA-256，通过后才能缓存。
- 首次基础包失败不会退回 CDN 全量请求。已完成分段保留，重试只下载尚未完成的分段；分段内不做 HTTP Range 续传。
- 后续增量失败保留已缓存图片。基础图片局部缓存丢失时从相关 Release 分段恢复，初始基础图片无需重复上传 CDN。
- 图片使用本地 blob URL 展示，刷新页面重新从已验证缓存建立地址，不重新下载完整基础包。浏览器清理站点数据后需要重新准备。
- 准备进度显示在页面及资料管理区。空间不足、下载或校验失败时显示“重试图片准备”，资料及账号库存不因图片失败而删除。

基础包每段原始图片最多 32 MiB，避免单次解压整个资源全集。图片会占用浏览器存储；当前不自动清理旧图片对象，也不申请覆盖用户浏览器的存储策略。

## 验证

`tests/browser_image_delivery.py` 使用隔离站点、独立跨域图片源和真实 IndexedDB，验证首次基础包、刷新复用、CDN 增量、基础包合并后的新旧用户行为、分段失败重试及实际图片解码。已接入检查及 Pages 发布前工作流，不依赖生产图片或账号。
