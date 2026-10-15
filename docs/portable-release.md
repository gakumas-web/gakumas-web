# Windows 便携包与制品复用

[文档索引](README.md)

便携包包含 `gakumas-web.exe`、`www/` 静态站点、使用说明及许可证。完整解压后双击 exe，默认打开 `http://127.0.0.1:18765/`；不需要安装 Python、Node.js、Docker 或 Go。只监听本机地址，不提供账号上传接口。关闭启动窗口或按 Ctrl+C 即可停止。

账号保存在浏览器中。升级时解压到新目录，关闭旧服务，再启动新版本；使用相同浏览器与地址可继续访问原有库存。更换端口、浏览器或电脑时应先从页面导出账号数据包。

## 每次部署的交付链

现有 Pages 工作流同时处理便携包：

1. 构建并校验静态站点，将 `dist/` 保存为 `portable-site` 制品。
2. Windows 作业读取同一制品，使用 Go 标准库编译独立启动器，封装并实际解压启动 exe。
3. 验证通过后保存 `windows-portable` 制品，包含 ZIP、`SHA256SUMS` 和 `portable-release.json`。
4. Pages 等待 Windows 验证通过后部署；仅勾选 `publish_portable` 时，在部署成功后从便携制品创建 Release，先上传至草稿，附件齐全后才公开。

Pages 与便携包共用站点构建及预览账号开关，不重新选择内容版本或图片源。便携包不含个人库存目录、采集器、凭据或开发环境。Go 运行库许可证随包提供，应用源码由 Release 对应 Git 标签提供。

## GitHub Actions Artifacts 复用

两个制品均保留 7 天。手动运行工作流时，可以在 `reuse_run_id` 填写已有运行编号；留空时重新构建。

- 来源必须属于同一仓库，并使用同一个源码提交和预览账号开关。
- 复用时核对程序文件哈希、站点清单哈希、启动器哈希及 ZIP 的 SHA-256；不允许混用不同站点或配置的附件。
- 站点与便携制品都须存在。编号错误、制品过期、配置不符或校验失败时停止，不静默换成另一份构建。
- 复用不会重新编译启动器或打包 ZIP，但仍在 Windows 上实际启动已下载的 exe，确认可运行。
- 只需补发 Release 时，可以重跑失败的发布作业，直接使用本次运行已经验证的制品。
- `publish` 关闭时只生成可下载的 Actions 制品，不部署 Pages 或公开 Release。
- `publish_portable` 默认关闭；开启且 `publish` 同时开启时，才公开 Windows 便携版 Release。

Release 标签包含程序版本与运行编号；同一次运行重试补齐同一发布，不创建无关的新版本。制品过期后可重新构建；已发布的 Release 附件不随 Actions 制品过期而删除。

## 本地维护

开发启动器需要 Go，打包脚本需要 Python；这些要求不适用于下载便携包的用户。

```sh
cd tools/portable-server
mkdir -p ../../local/portable-build
go test ./...
GOOS=windows GOARCH=amd64 CGO_ENABLED=0 go build -trimpath -buildvcs=false -ldflags='-s -w' -o ../../local/portable-build/gakumas-web.exe .
```

使用 `tools/package_portable.py` 封装已验证的站点，使用 `tools/verify_portable_artifacts.py` 核对制品身份。`tools/test_portable.py --package <ZIP>` 必须在 Windows 上执行，验证包内 exe 及相邻 `www/`；在其它系统上编译同一启动器源码只能覆盖共用服务逻辑，不能冒充 Windows 实机验收。

发布作业使用 GitHub 平台临时令牌；只有 Release 作业具有 `contents: write`，跨运行制品读取使用 `actions: read`。不需要复制个人令牌或本机凭据到包内。
