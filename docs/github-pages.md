# GitHub Pages 发布

[文档索引](README.md) · [图片交付路径](image-delivery.md) · [Windows 便携版](portable-release.md)

使用可手动触发、也可由[公共资料同步工作流](../.github/workflows/content.yml)调用的 [Pages 工作流](../.github/workflows/pages.yml)。仓库 Pages 来源设为 GitHub Actions，发布目录仅为 `dist/`；账号库存、开发工具、本机基准与图片构建缓存不进入站点。

## 固定输入与发布开关

[resources/content-publication.json](../resources/content-publication.json) 指定数据项目的公开 `content-channel` 引用分支。数据项目在图片交付完成后发布不可覆盖的 CNB Release，回读核验附件，再以普通 Git 推送更新该分支中的 `pages-source.json`。引用绑定内容包大小、SHA-256、清单、数据提交和图片提交；Web 只消费这份显式合同，不执行数据或资源项目源码。

同步工作流每小时第 17、47 分钟检查一次，也可手动触发。引用与线上频道一致时不构建；存在新版本时，将本次读取的引用保存为制品，交给 Pages 工作流。缓存键和构建使用同一份引用，发布前再次核对，拒绝已经被新引用取代的自动候选。GitHub 定时任务可能延迟，不承诺恰好半小时内发布。

同步检查也包括配套引擎更新；内容未变而引擎运行输入发生变化时仍会构建。已有卡牌修正、附魔数据补全和引擎计算代码更新统一进入候选。Pages 在初次构建后核对候选，经过隔离回归与当前内容的完整审计后应用并重建站点，最后再次核对实际制品。范围与停止条件见[引擎自动更新](contest-engine-audit.md#配套引擎自动更新)。

构建器核对内容合同、最低 Web 版本、全部分包及图片索引，不使用可变的 `latest` 包地址。[resources/pages-source.json](../resources/pages-source.json) 仅保留为首次尚无发布引用时的启动包，以及显式重现旧构建的输入。引用存在但格式、网络或哈希检查失败时停止，不静默退回启动包。

| 工作流参数 | 行为 |
| --- | --- |
| `publish` | 开启时部署 Pages；关闭时执行检查与构建，仅保存可复用制品。 |
| `preview_account` | 决定是否附带内置预览；工作流表单默认开启，通用构建默认关闭。 |
| `reuse_run_id` | 复用同一仓库、同一提交、同一预览开关的有效制品；留空重新构建。 |
| `publish_portable` | 与 `publish` 同时开启时，在 Pages 成功后公开 Windows 便携版 Release；默认关闭。 |

工作流先检查并构建站点、核对交付身份、审计完整模拟候选池，再保存站点制品。Windows 作业使用同一站点封装并实际启动便携 exe；通过后才部署 Pages。制品名称、保留期限和复用条件集中见[便携版说明](portable-release.md)。

公开引用通过匿名 Git 只读获取，内容包通过固定公开 Release 地址下载，不配置 CNB 私人令牌。工作流使用 GitHub 平台临时令牌；仅便携版 Release 作业具备内容写权限，不向云端复制本机个人凭据。

### CNB 来源的核验与故障定位

CNB 只负责上游公开引用和内容附件，本项目的工作流事件、权限及部署结果仍由 GitHub 管理。CNB 内容 Release 已发布不能证明 Pages 已同步；应依次核对 `content-channel` 中的引用、引用绑定的固定附件、同步工作流和实际站点身份。

[同步入口](../tools/sync_content.py)在临时仓库中读取配置指定的公开 ref，禁用交互输入及本次命令的 credential helper；这只用于匿名读取，不修改本机已有凭据配置。公开读取失败时先核对配置、引用是否存在、下载地址与大小／哈希，不加入私人令牌或放宽来源白名单来绕过失败。不要将 `content-channel` 引用分支当成内容 Release 标签，也不要改为下载可变 `latest` 附件。

需要查询上游发布状态时，按 CNB [Git 地址说明](https://docs.cnb.cool/zh/guide/git-access.html)及[实时 OpenAPI schema](https://api.cnb.cool/swagger.json)核对其接口；实际修复和发布仍在所属数据／资源项目执行，Web 只消费明确交付的公共文件。

## 基础图片与 CDN 增量

构建端下载并校验固定基础分段，将基础对象编成同源用途小包，卡图缩略图长边不超过 384px。缩略图有独立哈希，来源索引与原图身份保持不变。CDN 增量继续由浏览器从声明来源按需获取，因此站点不能被概括成“所有资源只访问同源”。

用途分组区分基础界面、回忆、目录、成就和完整卡图；偶像卡与支援卡分别提供缩略图与原图包，装扮资源按主题归组，共用对象不重复打包。一般功能包的图片字节预算约 4 MiB，基础界面约 2 MiB。实际体积以 `build-report.json` 为准；构建器在站点超过 1,000,000,000 字节时拒绝发布。

浏览器只准备当前页面需要的包。列表优先缩略图，完整展示或主动「准备完整图片」时读取原图；最多两包在途，解包与保存串行，等待处理的包仍占槽。公共资料不等待图片全部完成。行为与性能验证见[加载验证](loading-validation.md)。

基础附件由构建端下载，不要求浏览器 CORS；浏览器直接访问的 CDN 增量仍须允许站点来源。运行时来源白名单由发布清单与 CSP 限定，不能为处理下载问题任意放宽。

## 更新与旧页面

数据项目先完成图片对象、资源索引和内容包交付，再推进公开引用；GitHub 自动检测后复用既有发布工作流，无需逐次修改源码中的版本号。手动工作流也会在构建前解析一次当前引用。变更基础图片或用途分组时重建对应规划；只有 CDN 增量改变时可以复用已验证的基础图片缓存。

不要在旧用途包站点上直接替换为不匹配的内容索引。程序、内容及图片一同经过构建检查后才切换线上站点；独立资料源的配置另见[公共内容](content.md#独立预压缩资料源)。

部署保留当前来源版本的原始基础分段，供旧页面使用；不承诺永久保留历代用途包。旧页面请求已移除的用途包时提供刷新恢复入口，账号导入过程中禁止刷新。刷新后从同源 IndexedDB 恢复账号，不能把原始兼容分段仍可下载当作旧用途包兼容已经验收。

## 图片构建缓存

缓存身份绑定基础图片集合、基础对象的用途分组、生成／校验脚本、依赖锁和工具链。程序提交号不参与图片身份，因此纯 HTML、JS、CSS 改动可以复用图片；缓存命中仍重新核对文件集合、大小和哈希，程序始终从本次提交构建。

缓存缺失时重新生成；损坏时保留无效缓存并重建，不能把平台恢复成功当作内容已通过校验。有效命中不重复保存，新生成缓存使用运行号区分。缓存可能被回收，只用于加速，不是永久交付源。

`build-report.json` 记录缓存状态、键与构建耗时；状态包括 `hit`、`miss`、`invalid`、`write-failed`、`disabled`。历史冷暖对照单独保留在[旧加载记录](history/loading-validation-20261006.md#同期云端构建缓存记录)，不作为当前性能承诺。

## 本地复现与线上核对

在已有构建环境中运行：

```sh
python3 -B tools/build_pages.py --image-cache local/pages-image-cache --output local/checks/pages-build/dist
python3 -B -m http.server 18765 --bind 127.0.0.1 --directory local/checks/pages-build
```

打开 `http://127.0.0.1:18765/dist/` 验证子目录访问；预览账号需额外传入 `--preview-account`。本地构建不等于线上发布。

`release.json` 的 `source_commit`、`build_run_id` 来自显式构建环境；没有有效值时保持未知，不从本地 Git HEAD 推断，也不单凭相同程序版本认定为同次部署。线上核对时将 `DEPLOY_COMMIT` 设置为实际发布的完整提交：

```sh
python3 -B tools/verify_site.py --url https://gakumas-web.github.io/gakumas-web/ \
  --expected-commit "$DEPLOY_COMMIT" --output local/checks/site-verification.json
```

该入口验证程序身份、基础图片缓存复用、缩略图／原图分级、角色占位和移动布局，并要求网络请求为无正文的 GET／HEAD，仅访问同源或发布清单允许的下载来源。报告如实记录是否全同源；允许的 CDN 下载不等于账号上传。

## 启用与恢复

先将数据项目的发布工具和 CNB 工作流、Web 的同步与可复用 Pages 工作流分别交付到主分支，再运行一次数据项目的 `web_trigger_publish_content`。它会先等待图片任务完成，再建立内容 Release 和引用分支。随后可手动运行“自动同步公共资料”，或等待定时检查。代码准备完成不代表这些远程流程已经运行成功。

新增模拟不支持项仍阻止 Pages 发布，不自动修改兼容性基准。失败时保留线上频道，修复对应实现或经人工核对支持范围后重跑；已发布内容附件不覆盖。用户浏览器仍在完整校验新资料后显示应用入口，应用时刷新页面。

本地可使用明确交接的引用和内容包验证同一构建路径：

```sh
python3 -B tools/build_pages.py --source local/content-source/pages-source.json --bundle local/content-source/content.json.gz --output local/preview/dist --image-cache local/pages-image-cache
```

`--bundle` 只改变字节读取位置，仍检查引用中的大小、版本、全部内容与图片哈希。不要将未发布候选的下载 URL 当作已在线可用的地址。
