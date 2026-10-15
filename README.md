# 回忆整理室 · gakumas-web

《学园偶像大师》的浏览器本地库存与编组工具，支持回忆、选拔回忆、偶像卡、支援卡、主题装扮、成就及赛季模拟。服务器提供静态程序和公开资料；账号文件在浏览器读取并保存在当前来源的 IndexedDB，不上传库存。

使用采集器导出的账号目录或本工具的账号数据包即可，无需游戏令牌、CA 私钥或采集器网络接口。界面维护简体中文与日文，游戏名称及完整效果正文保留原文。

[文档索引](docs/README.md) · [产品定位](PRODUCT.md) · [设计规范](DESIGN.md) · [安全说明](SECURITY.md)

## 使用与备份

1. 通过「导入账号目录」选择包含 `inventory/`、`selection/`、`selection-details/` 的单个账号目录，或导入已有账号数据包。
2. 按文件中的账号标识和采集时间合并数据；目录名称不作为身份依据，也不会持续监控采集目录。新采集后重新选择目录更新。
3. 使用「导出账号数据包」备份或迁移，可选密码加密。密码只在浏览器内使用，不保存或发送。

换电脑、浏览器、域名或清理站点数据前先导出备份。网站没有账号登录或云同步。单个快照最多 20 MiB，单次目录导入最多 200 MiB；当前仅接受 `gakumas-capture` 完整 schema 1，具体见[文件合同](docs/snapshot-contract.md)。

已启用内置预览的部署可从「账号 → 启用预览」体验；它使用独立档案，详见[预览账号](docs/preview-account.md)。编组规则和支持边界见[赛季模拟](docs/contest-simulation.md)。

## 本地运行

需要 Python 3.11+。浏览器使用原生 JavaScript 模块，无需安装前端依赖；Node.js 22+ 用于开发测试和模拟候选池审计。

```sh
python3 -B tools/build.py
python3 -B -m http.server 18765 --bind 127.0.0.1 --directory dist
```

打开 `http://127.0.0.1:18765/`，也可用 `npm run preview` 启动同一个 `dist/`。不要通过 `file://` 打开；正式发布只提供构建后的 `dist/`。

干净构建只有程序，默认没有公开游戏目录和图片。在「资料与图片 → 导入内容包」安装 gakumas-data 的内容包，或由部署者配置初始内容。安装与更新见[公共内容](docs/content.md)，图片开关见[资源配置](docs/resources.md)。

## 部署与便携版

| 方式 | 入口与说明 |
| --- | --- |
| Docker | `docker compose up --build -d`，默认访问 `http://127.0.0.1:18765/`；运行阶段是非 root Nginx，使用只读文件系统和临时 `/tmp`。 |
| GitHub Pages | 手动运行 [Pages 工作流](.github/workflows/pages.yml)，从固定内容包构建站点；基础图片转为同源用途包，CDN 增量按声明来源读取。详见 [Pages 发布](docs/github-pages.md)。 |
| Windows 便携版 | 解压后运行 `gakumas-web.exe`，无需额外运行环境。工作流生成便携制品；只有显式开启 `publish_portable` 才公开 Release。详见[便携版说明](docs/portable-release.md)。 |

公网部署使用 HTTPS，备份加密依赖 Web Crypto；本地回环 HTTP 可用。不要将库存或凭据目录挂入容器或静态服务器。预览开关、内容来源与图片模式都在构建时确定，不能仅靠修改运行中容器的环境变量切换。

## 开发与维护

Web 维护程序和浏览器交互，gakumas-data 交付公开内容，gakumas-assets 交付图片。项目之间通过明确的文件、版本和哈希交接；数据合并、图片上传、内容发布和站点部署是不同阶段。

[开发与发布维护](docs/maintenance.md)说明模块分层、账号生命周期、模拟任务职责和交付顺序；[加载验证](docs/loading-validation.md)说明浏览器与性能证据的范围。算法研究工具位于 [tools/algorithm-evaluation/](tools/algorithm-evaluation/README.md)，不参与站点构建。

程序版本以 [package.json](package.json) 为准，实际部署以站点 `release.json` 的版本、提交和运行号为准。内容、图片和库存合同分别维护，不用程序版本代替它们的身份。

代码采用 AGPL-3.0；游戏素材、名称及公开数据的权利归属见 [THIRD_PARTY.md](THIRD_PARTY.md)。
