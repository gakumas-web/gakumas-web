# Web 程序与公共内容独立维护

## 统一图片交付更新

当前图片索引格式 1 由 `prepare_locks.py` 自动选择统一缓存配置，不再手动选包体或 CDN；最低 Web 为 0.5.0。具体首次构建与后续安装命令见[图片缓存说明](image-delivery.md)。旧预览格式和图片模式不再兼容。


本项目维护库存管理、领域展示和浏览器交互，不维护最新卡池目录。公开资料的来源锁、导入器、六表投影、资源需求导出已移至 gakumas-data。图片维护由 gakumas-assets 负责，采集器不因普通卡牌目录变化而重新发布。

## 更新内容

1. gakumas-data 从固定公开提交生成候选，检查结构与关联，导出资源需求。
2. gakumas-assets 补齐变化图片并生成分类包索引；未变化分类保持原版本。
3. gakumas-data 生成完整内容版本，锁定最低 Web 版本、各数据文件哈希和资源索引。
4. 部署者使用 `tools/install_content.py` 更新内容目录，或在独立 HTTPS 内容源发布新频道指针。程序无需重新构建。

Web 先恢复已验证缓存；新版本完整下载并保存后提示应用，当前会话继续使用旧整套资料。导入本地内容包后固定使用本地版本，避免启动检查将其覆盖；用户仍可手动检查在线更新。失败或不兼容的新内容不会替换现有缓存。

## 更新程序

功能、显示规则和缺陷修复仍通过 `tools/build.py` 构建。它只读取本项目的程序白名单及显式内容／资源锁，不导入数据项目源码。已有 dist/content 在程序重建时保留；发布到全新环境时需另行安装内容或配置内容源。

```sh
node --test tests/*.test.mjs
python3 -B -m unittest discover -s tests -p 'test_*.py'
python3 -B tools/check_public.py
python3 -B tools/build.py
```

`tests/fixtures/public-data/` 是固定的领域回归样本，不进入站点、不随卡池更新。浏览器验收必须检查内容请求不携带账号或库存字段。

Docker 与 Pages 默认只部署程序；远程内容源由 `resources/content-source.json` 显式指定。Docker 可把单独安装后的公开内容目录只读挂载到 `/usr/share/nginx/html/content`，不挂载库存或凭据。Pages 可以部署随站点携带的内容目录，也可以读取允许 CORS 的独立 HTTPS 内容源。

详情见 [内容更新](content.md) 与 [图片资源配置](resources.md)。

## 自动准备配套锁

使用已交接的本地发布物生成独立锁目录，避免手填版本和哈希：

```sh
python3 -B tools/prepare_locks.py --release local/incoming/content \
  --mode managed --assets-index local/incoming/assets/resource-index.json \
  --site dist --output local/locks/update
python3 -B tools/install_content.py --lock local/locks/update/content-lock.json \
  --asset-lock local/locks/update/asset-lock.json --output dist
```

`--mode` 默认 managed，若需要无图部署显式使用 --mode none。`--site` 检查已部署程序版本、图片模式和允许来源，切换模式或新增源站需要重建程序。首次构建省略 --site，生成两份锁后传给 build.py。生成器只核验本地内容与配置，不证明远程资源可达，不安装、不发布频道。

锁文件的相对路径以生成目录为基准，移动输入或锁目录后应重新生成。预检结果写入 `report.json`，保留图片默认关闭的选择。使用合成发布物的生成与实际安装回归测试在 `tests/test_prepare_locks.py`。

检查工作流及 Pages 发布前均运行 `tests/browser_content_updates.py`，覆盖子目录访问、内容更新、损坏版本保留、离线缓存、本地导入与账号不上传。它使用隔离的静态站点和合成账号，不读取本机库存或修改现有站点。跨项目合同样例由 Python 和 Node 测试共同验证。
