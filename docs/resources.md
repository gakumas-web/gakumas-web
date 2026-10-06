# 当前图片资源配置

当前图片交付与资源锁均为格式 1。默认 mode: none，不请求游戏图片，不回退第三方源。启用图片使用 managed；旧 bundle、cdn、单包 manifest 和用途包索引均已退役。

```json
{"format":"gakumas-web-assets-lock","schema_version":1,"mode":"managed","version":"example","index":"incoming/resource-index.json","sha256":"图片索引SHA256","download_origins":[]}
```

可用固定 HTTPS index_url 替代本地 index；相对路径以锁文件目录为基准。索引必须包含 files、baseline、cdn_objects 和 cdn_base_url，内容清单必须锁定相同字节。重新编号不意味着旧结构可以继续导入。

推荐从完整内容发布物运行 prepare_locks.py 生成配套锁，再显式构建或安装。图片下载、分段恢复、缓存与源站配置见 [图片交付](image-delivery.md)。
