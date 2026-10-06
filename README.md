# 回忆整理室 · gakumas-web

## 独立内容分包（0.5.0）

支持内容格式 1：分包业务版本独立，未变化文件重新校验后直接复用；整套内容齐备后再应用。预览期旧结构已退役，公共内容与账号库存继续分开。当前格式最低需要部署 Web 0.5.0，详情见 [内容维护](docs/content.md)。源码升级不自动改写现有本机部署。

## 统一图片缓存（0.4.0）

新图片交付索引让浏览器首次下载固定 Release 基础包，后续复用本地缓存并只补充 CDN 增量，不要求用户选择两种来源。部署、进度和失败恢复见[图片缓存说明](docs/image-delivery.md)。源码默认仍无图片源，只接受当前图片交付格式 1。


学园偶像大师的浏览器本地库存管理器，预览版本。支持回忆、选拔回忆、偶像卡、支援卡、主题装扮与成就。服务器只提供静态网页和公开目录；库存文件在浏览器读取，保存到本机 IndexedDB，不上传到服务器。

本项目与采集器、公开内容及图片维护项目独立。使用采集器导出的账号目录或本工具的账号数据包即可，不需要游戏令牌、CA 私钥、协议材料或采集器网络接口。公开卡片资料由 gakumas-data 单独发布，不必随卡池变化重新构建 Web 程序。

## 本地运行

需要 Python 3.11+ 构建静态文件；浏览器使用原生 JavaScript 模块，无需安装前端依赖。Node.js 22+ 仅用于单元测试。

```sh
python3 -B tools/build.py
python3 -B -m http.server 8080 --bind 127.0.0.1 --directory dist
```

打开 `http://127.0.0.1:8080/`。不要使用 `file://`，也不要把源码根目录直接作为公网文件目录；正式发布目录为 `dist/`。

干净构建只包含程序，不附带游戏目录或图片。在「账号数据管理 → 卡片资料」导入 gakumas-data 的内容包，即可离线使用目录；也可由部署者独立安装内容目录或配置 HTTPS 内容频道，见 [内容更新](docs/content.md)。

## Docker

```sh
docker compose up --build -d
```

默认访问 `http://127.0.0.1:8080/`。镜像使用构建阶段生成的静态产物，运行阶段仅有非 root Nginx；无需 Python 服务、数据库、账号配置或库存卷挂载。容器采用只读文件系统和临时 `/tmp`。

如需远程访问，使用自己的 HTTPS 反向代理连接该端口。普通远程 HTTP 不属于完整支持环境：加密数据包依赖 Web Crypto。不要把库存目录或密钥目录挂入容器。

## GitHub Pages

仓库内提供手动触发的 [Pages 工作流](.github/workflows/pages.yml)。在 GitHub 仓库设置中将 Pages 来源选为 GitHub Actions，然后运行该工作流；它只上传 `dist/`。

资源路径从模块位置计算，支持域名根目录与 `/repository/` 子目录；Docker 和 Pages 使用相同静态构建。Pages 不运行后端代码，也不保存用户库存。请根据当前平台限制与图片来源条件决定是否公开托管。

## 导入、保存和迁移

1. 点击「导入账号目录」，选择采集器输出的单个账号文件夹。该目录包含 `inventory/`、`selection/` 和 `selection-details/`，浏览器递归读取其中的 `snapshot.json`，忽略其他文件。
2. 主库存、选拔列表和详情按文件内的账号标识与采集时间合并；目录名不作为身份依据。库存不会上传。
3. 数据保存在当前浏览器当前来源的 IndexedDB，标签与偏好保存在本地。网站没有账号登录或云同步。
4. 使用「导出账号数据包」保存备份，可选密码加密；密码只在浏览器内使用，不保存或发送。换电脑、换浏览器、换域名或清理站点数据后，需要重新导入。

单个快照最多 20 MiB，单次目录导入总计最多 200 MiB。不会持续监控采集目录；新采集后重新选择目录更新。当前仅接受带 `gakumas-capture` 格式标识的完整 schema 1，不恢复开发阶段旧快照或旧备份。首次切换后重新导入账号目录；浏览器数据使用独立命名空间，不迁移旧笔记。字段边界见 [文件合同](docs/snapshot-contract.md)。

## 图片与公开主数据

默认 `resources/asset-lock.json` 为 `none`：不包含或请求游戏图片，使用本站占位图。游戏资源由独立的 `gakumas-assets` 项目维护，Web 不回退到 Cloudinary 等第三方源。

需要图片时，显式提供资源锁：

```sh
python3 -B tools/build.py --asset-lock local/asset-lock.json
```

资源锁使用当前格式 1，启用 managed 模式后，浏览器从锁定索引的基础包与增量源取得图片并存入本机独立缓存。默认 none 不获取游戏图片。字段见 [资源配置](docs/resources.md)；本地锁和包体不入 Git，Docker 构建不读取开发者本机 local。

五份公开目录由独立内容包提供，程序源码不再保存主数据来源锁、投影和更新工具。内容格式、资源包版本和库存 schema 各自独立。维护顺序见 [维护说明](docs/maintenance.md)，版权边界见 [THIRD_PARTY.md](THIRD_PARTY.md)。

本机已有内容锁时，`npm run build:local` 构建程序并安装初始内容；此后只更新内容可运行 `npm run content:local`，不改写 app.mjs、HTML、CSS 或程序发布清单。

## 开发与发布验证

```sh
node --test tests/*.test.mjs
python3 -B tools/check_public.py
python3 -B tools/build.py
```

可选浏览器验收：准备 `requirements-test.txt` 中的 Playwright 和 Chromium，启动已安装内容的静态服务后执行 `python3 -B tests/browser_static.py --url http://127.0.0.1:8080/`。无初始内容的部署可通过 `--content-bundle <文件>` 显式导入测试内容。`tests/browser_content_updates.py` 单独验证内容更新、失败保留、离线缓存、本地导入和子目录访问。所有账号样本均为合成数据。

发布前可用 `python3 -B tools/check_public.py --export ../web-source-export` 导出干净源码。`.gitignore` 与 Docker 上下文均采用白名单；`local/`、`dist/`、测试输出、库存与凭据不进入源码仓库。详情见 [SECURITY.md](SECURITY.md)。

代码按 AGPL-3.0 发布；游戏素材、名称与公开数据不因此改变其原有权利归属。
