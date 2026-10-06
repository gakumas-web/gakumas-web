# GitHub Pages 同源图片部署

站点通过手动触发「发布 GitHub Pages」工作流发布。工作流从 `resources/pages-source.json` 固定的 Release 下载内容包，验证大小、SHA-256 和内容合同，再下载其中的基础图片分段与增量对象；每个下载同样核对大小与 SHA-256。只上传构建后的 `dist/`。

资源文件只进入部署产物，不进入 Git 历史。浏览器从与页面相同的来源下载资源，原图片索引、内容清单和哈希保持不变。构建生成的地址映射使用相对路径，兼容 Pages 仓库子目录；原有本机图片缓存和分段恢复继续生效。默认 `tools/build.py` 仍不启用图片。

首次部署前在仓库 Settings → Pages 中选择 GitHub Actions。工作流使用平台提供的临时令牌，不需要个人 PAT Secret。Pages 的发布目录含完整内容和图片副本，须保持在 1 GB 内；每月 100 GB 为平台软流量限制。

## 更新

先生成并发布通过当前合同校验的内容包，然后更新 `resources/pages-source.json` 中固定的版本、下载 URL、字节数和 SHA-256，再重新运行工作流。不得使用 `latest` 地址。上游图片分段也必须已发布且能由 Actions 下载。

同源部署的图片副本与程序一起构建，因此更新图片来源时须重新部署整套站点，不单独替换频道或安装未镜像的新内容。发布失败时不切换线上站点。上游 Release 更新不会自动触发本仓库部署。

本地复现：

```sh
python3 -B tools/build_pages.py --output local/pages-test/dist
python3 -B -m http.server 8080 --bind 127.0.0.1 --directory local/pages-test
```

打开 `http://127.0.0.1:8080/dist/`，可验证子目录下的内容与图片下载。库存仍由浏览器本地处理，不进入 Pages、Release 或部署流程。
