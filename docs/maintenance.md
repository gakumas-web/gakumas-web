# 开发与发布维护

[文档索引](README.md)

## 项目与目录职责

Web 维护库存管理、领域计算和浏览器交互；gakumas-data 维护公开来源、投影及内容包；gakumas-assets 维护图片清单和交付。项目间只交换明确的文件、版本与哈希，不导入其他项目源码。

| 位置 | 职责 |
| --- | --- |
| `app.mjs` | 应用装配、页面导航、统一账号会话安装和页面级资源监听。 |
| `application/` | 账号用例与存储、内容／图片加载、任务控制器和 Worker 调度。 |
| `resources.mjs` | 应用根路径、资源地址、图片缓存映射和资源请求，不操作 DOM。 |
| `domain/` | 领域规则和计算，不依赖 UI。 |
| `ui/`、`style.css`、`locales/` | 交互、样式及简体中文／日文界面。 |
| `resources/` | 内容与资源配置、经批准的内置预览文件；不存放整套游戏图片。 |
| `tools/` | 构建、安装、审计与评测工具，不进入静态站点。 |
| `tests/` | 合成账号、合同与固定领域样本，不作为运行时内容。 |
| `local/` | 被忽略的锁文件、缓存、环境和验证产物；浏览器检查集中写入 `local/checks/`。 |
| `dist/` | 可发布静态产物；不直接公开源码根目录。 |

## 应用架构与状态边界

### 依赖方向

[`tests/architecture.test.mjs`](../tests/architecture.test.mjs) 检查模块依赖闭合、无循环与传递依赖。应用模块只能依赖应用、领域、语言目录及明确允许的共享入口：`resources.mjs`、`image-config.mjs`、`content-config.mjs`、`i18n.mjs`；不能导入 UI 或 `app.mjs`。领域模块的传递依赖限于领域模块、共享 `i18n.mjs` 及其语言目录，资源运行时不能绕过这一边界。

检查图同时包含字面量模块导入、转导出及 `new URL(..., import.meta.url)` 中的相对 `.mjs` 地址，覆盖 Worker 入口。资源服务和构建配置另有 DOM 依赖检查，避免模块导入时重新注册页面观察器。

### 主数据与资源

主数据查询继续从 [`domain/catalog.mjs`](../domain/catalog.mjs) 导出。内部模块按下表分工，彼此直接依赖所属查询模块，不经公共导出入口形成循环。

| 模块 | 职责 |
| --- | --- |
| [`catalog-state.mjs`](../domain/catalog-state.mjs) | 安装当前目录、建立索引并更新目录代次。 |
| [`catalog-collections.mjs`](../domain/catalog-collections.mjs) | 角色、偶像、装扮、持有状态、集合排序与成长查询。 |
| [`catalog-skills.mjs`](../domain/catalog-skills.mjs) | 技能、道具、能力、语义说明和效果展示数据。 |
| [`catalog-supports.mjs`](../domain/catalog-supports.mjs) | 支援卡说明、事件与奖励查询。 |
| [`catalog-contests.mjs`](../domain/catalog-contests.mjs) | 比赛目录、候选、转换规则、综合值与模拟输入引用。 |
| [`catalog-achievements.mjs`](../domain/catalog-achievements.mjs) | 成就条目、角色范围与筛选计数。 |

查询模块只读当前目录。技能与支援说明缓存归各自模块管理，目录代次变化时失效；语言相关缓存继续按语言隔离。加载器将效果图标、卡片引用和说明标签安装到 [`domain/effect-catalog.mjs`](../domain/effect-catalog.mjs)，供 UI 查询。领域投影返回资源名，渲染时由资源服务解析地址。

[`resources.mjs`](../resources.mjs) 管理资源地址、缓存映射和请求；[`ui/resource-images.mjs`](../ui/resource-images.mjs) 由应用入口显式安装，负责占位图片与 SVG 图片替换、错误通知和背景图更新。适配器释放时断开观察器、取消订阅并移除待触发的图片监听。资源服务本身不观察或修改 DOM。

### 账号会话与清理

[`application/account-session.mjs`](../application/account-session.mjs) 准备完整会话：恢复工作副本、校验账号、合并目录、读取目标账号偏好与标签收藏。`app.mjs` 的统一安装入口停止旧任务、清理选择与详情，再替换会话并刷新页面。准备失败时保留当前会话。

账号清理按以下顺序执行：

1. 停止并销毁当前账号的模拟工作区，暂存草稿和已完成结果，以便删除失败后恢复。
2. 在存储事务中删除该账号的数据；失败时不发送清理通知。
3. 删除成功后立即广播清理通知，再安装空会话并恢复剩余账号。后续页面恢复或偏好保存失败，不阻断其它页签获知删除结果。

模拟历史和已保存编组的写入在包含 `profiles` 的同一事务中核对账号存在性与 `lifecycleId`。标识从账号会话传入工作区，保存时使用该工作区持有的值；不能在保存前重新读取当前标识来替代旧任务的标识。`saveSimulationRun(profile, entry, lifecycleId)` 和 `saveSimulationLoadout(profile, entry, lifecycleId)` 均执行这一校验：账号不存在时以 `account_unavailable` 错误拒绝写入，标识缺失或过期时以 `account_session_expired` 错误拒绝写入。

`lifecycleId` 属于本地档案元数据。同账号更新保留标识，删除后重建生成新标识；现有未带标识的当前工作副本使用 `null`。它不进入采集快照、视图偏好、模拟记录或导出的账号备份，也不改变库存和备份格式。存储、导入与备份边界见[文件合同](snapshot-contract.md#浏览器与备份)。

### 模拟与搜索任务

| 控制器 | 职责 |
| --- | --- |
| [`contest-simulation-controller.mjs`](../application/contest-simulation-controller.mjs) | 正式自选模拟的启动、进度、取消、结果签名与历史写入。 |
| [`contest-multiplier-controller.mjs`](../application/contest-multiplier-controller.mjs) | 三维倍率预览的防抖、逐属性缓存、取消与过期响应过滤。 |
| [`contest-recommendation-controller.mjs`](../application/contest-recommendation-controller.mjs) | 回忆编组搜索的输入准备、上下文失效、任务状态与按偶像暂存的结果。 |
| [`contest-optimization-controller.mjs`](../application/contest-optimization-controller.mjs) | 推荐编组搜索的约束投影、准备阶段、任务状态与结果上下文。 |

UI 负责输入控件、结果图表、状态文案和历史面板；推荐表单还负责候选兼容性预检、参考属性填入及撤销。两类搜索客户端共用 [`contest-worker-client.mjs`](../application/contest-worker-client.mjs) 的串行消息、超时、取消和资源释放逻辑，候选筛选、随机种子、预算、会话分配与多核调度仍归各自客户端。

相同上下文下切换页面或舞台保留任务，搜索约束上下文变化时取消对应任务。重跑、停止或失败保留上次完成结果；正式模拟的历史保存失败也保留当前结果。工作区销毁后忽略迟到响应，写入还须通过账号生命周期校验。界面语言切换会重建工作区，恢复草稿和已完成结果，未完成任务停止。产品行为与算法范围见[赛季模拟](contest-simulation.md)。

## 本地预览

已有本机预览可运行 `npm run preview:local`，具体目录由 `package.json` 指定；新检出仓库不自带该目录。普通预览使用构建后的 `dist/`。长期复用一个预览位置，避免为每次验证保留整站副本。

## 按改动选择验证

| 改动 | 相关入口 |
| --- | --- |
| 文档或注释 | `git diff --check`、链接及命令／配置核对。 |
| JavaScript 领域或应用行为 | 相关 `tests/*.test.mjs`；发布前运行 `node --test tests/*.test.mjs`。 |
| Python 构建、安装或合同 | 相关 `test_*.py`；发布检查使用 `python3 -B -m unittest discover -s tests -p 'test_*.py'`。 |
| 浏览器交互、加载或存储 | 选择相关浏览器脚本，检查实际生产入口与无账号上传；见[加载验证](loading-validation.md)。 |
| 引擎、映射或公开候选变化 | 对实际候选站点运行[完整候选池审计](contest-engine-audit.md)，新增不支持项阻止发布。 |
| 部署 | 静态构建、Docker、子目录访问及实际线上身份核对；Pages 和便携版各按其发布流程验证。 |

Python 构建依赖与浏览器测试依赖分别由 `requirements-build.txt`、`requirements-test.txt` 管理；使用已有隔离环境。Node.js 要求见 `package.json`，便携启动器的 Go 版本见工作流。纯说明整理不需要安装环境或重跑业务测试。

公开交付前运行 `python3 -B tools/check_public.py`；需要源码包时使用其 `--export` 参数和仓库外的新目录。`.gitignore` 控制源码候选，`.dockerignore` 控制 Docker 上下文，静态构建另外使用程序白名单。源码包可包含维护工具，站点产物不包含 `tools/`、测试、本地基准、库存或凭据。

## 程序、内容与图片的交付顺序

1. 数据项目生成通过校验的固定内容候选及资源需求。
2. 资源项目交付缺少的图片对象，生成绑定基础包和 CDN 增量的资源索引。
3. 数据项目发布完整内容版本，绑定各分包、资源索引和最低 Web 版本。
4. Web 安装该内容，或将它作为 [Pages 构建](github-pages.md)的固定输入；程序改动通过构建后部署。
5. 核对实际站点的 `release.json`、内容频道及浏览器行为，分别记录已合并、已交付、已发布和已部署状态。

数据 PR 合并不等于正式内容已发布；图片上传不等于 Web 内容锁已切换。程序重建会保留输出目录中已有的不可变内容版本，但不会自动选取“最新”外部内容。

## 独立更新与配套锁

普通部署可从明确交接的内容目录生成配套锁：

```sh
python3 -B tools/prepare_locks.py --release local/incoming/content \
  --mode managed --assets-index local/incoming/assets/resource-index.json \
  --site dist --output local/locks/update
python3 -B tools/install_content.py --lock local/locks/update/content-lock.json \
  --asset-lock local/locks/update/asset-lock.json --output dist
```

首次构建省略 `--site`，再将两份锁交给 `tools/build.py`；无图部署显式使用 `--mode none`。锁中的相对路径以锁目录为基准，移动输入后应重新生成。预检只核对本地资料、已部署版本及来源策略，不证明远程可达，也不负责发布。

独立内容源在程序及来源合同兼容时可以单独更新，详见[公共内容](content.md)。Pages 的基础用途包与程序一起构建，变更固定内容／图片输入时重新运行 Pages 工作流；不能直接把新的来源索引塞入旧用途包站点。

## 算法工具与记录

[算法评测工具](../tools/algorithm-evaluation/README.md)单独维护源码；本机冻结基准受其 `.gitignore` 排除。固定回归只证明对应版本的重现，不代表新算法独立验收或自动授权替换生产参数。

公开说明保留稳定合同与操作入口。历史测量标明版本和条件；本地私有结论、检查输出与原始材料不加入公开源码。
