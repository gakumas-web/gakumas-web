# 加载与浏览器验证

[文档索引](README.md)

本文记录当前实现的验证入口与证据边界，不记录一组长期不变的性能分数。旧版本的加载改造、冷暖构建与完整缓存采样见[历史记录](history/loading-validation-20261006.md)。

## 当前加载路径

- 公共资料与图片独立准备。内容先完整校验、写入缓存，再允许应用；图片失败不覆盖已安装内容，也不阻止账号导入。
- 公共分包校验和解析由内容处理 Worker 执行，缓存解析结果可复用，回传按块处理；失败仍保留完整合同与原子激活边界。
- 图片包由独立 Worker 解包和校验，下载与保存保持有界队列。`none` 模式不获取游戏图片；Pages 的同源基础图片与 CDN 增量按[交付说明](image-delivery.md)处理。
- 目录按页签初始化。筛选候选按时间预算分批准备，完成后一次性安装；同步条件变化可使旧批次失效，不能出现部分候选混入当前状态。
- 大型选择弹窗先提供选项与输入控件，图片和效果预览按可视范围或焦点补齐；延迟展示不改变选中值及最终确认结果。
- 成功缓存可以复用，但仍核对字节身份；不以省略哈希、缩短候选集或改变游戏规则制造性能提升。

图片 DOM 更新由应用入口显式安装 `ui/resource-images.mjs`；资源服务导入不会注册页面观察器。适配器处理冷缓存占位图、缓存就绪后才挂载的离屏节点与 SVG 图片，释放时取消订阅和观察器。完整职责见[应用架构](maintenance.md#应用架构与状态边界)。

主要实现位于 `application/content-processing*.mjs`、`application/content-transfer.mjs`、`application/image-unpacker*.mjs`、`ui/deferred-picker.mjs` 和 `ui/filters.mjs`。

## 检查入口

按改动选用相关脚本；文档整理不需要执行下表中的业务流程。

| 关注点 | 入口 |
| --- | --- |
| 依赖分层、循环与 Worker 入口闭合 | `tests/architecture.test.mjs` |
| 目录重装、语言相关缓存与按页加载 | `tests/catalog-cache.test.mjs`、`tests/master-loader.test.mjs` |
| 会话准备、账号切换、导入与备份恢复 | `tests/account-session.test.mjs`、`tests/browser_account_session.py` |
| 历史保留、删除竞态、生命周期标识与并发导入 | `tests/browser_contest_history_store.py` |
| 跨页签删除通知、同名账号重建与旧任务隔离 | `tests/browser_account_lifecycle.py` |
| 模拟与搜索的取消、过期响应和结果保留 | `tests/contest-task-controllers.test.mjs`、`tests/contest-search-controllers.test.mjs` |
| 真实任务运行中切换账号、更新快照及迟到结果隔离 | `tests/browser_contest_task_lifecycle.py` |
| 编组文件白名单、预览确认、跨账号导入与原子写入 | `tests/contest-loadout-package.test.mjs`、`tests/browser_contest_loadout_package.py` |
| 草稿配置白名单、刷新恢复、过期清理与账号隔离 | `tests/contest-drafts.test.mjs`、`tests/browser_contest_drafts.py`、`tests/browser_contest_draft_locale.py` |
| 多任务资源竞争、页面级排队与倍率预览响应 | `tests/browser_contest_compute_contention.py` |
| 共用 Worker 协议、超时、错误与释放 | `tests/contest-worker-client.test.mjs` |
| 真实自选模拟、编组保存、清理前终止任务及失败后草稿恢复 | `tests/browser_contest_quick_stage.py` |
| 两类搜索、保存载入与单核／多核一致性 | `tests/browser_contest_recommendations.py`、`tests/browser_contest_optimization.py`、`tests/browser_contest_optimizer_workers.py` |
| 倍率按属性刷新、参考填入、撤销、重试及窄屏触控尺寸 | `tests/browser_optimization_autofill.py` |
| 搜索预算预留、低额度后续阶段及失败后保留结果与重跑 | `tests/browser_optimization_custom_budget.py` |
| 内容更新、失败保留、本地导入、子目录与账号保留 | `tests/browser_content_updates.py` |
| 内容 Worker、完整校验、解析及分块回传 | `tests/browser_content_processing.py`、`tests/content-transfer.test.mjs` |
| 图片基础包、增量、重试、DOM 适配器释放和真实 IndexedDB | `tests/browser_image_delivery.py`、`tests/browser_hybrid_images.py` |
| 图片解包 Worker | `tests/browser_image_unpacker.py` |
| 按页签初始化、延迟选择器与候选分批准备 | `tests/browser_deferred_catalogs.py`、`tests/browser_deferred_picker.py`、`tests/browser_memory_filter_preparation.py` |
| 状态、偏好恢复、旧用途包刷新及交互回归 | `tests/browser_review_regressions.py` |
| 最终 Pages 身份、缓存、图片解码与移动布局 | `tools/verify_site.py`，命令见 [Pages 发布](github-pages.md#本地复现与线上核对) |

浏览器使用隔离上下文和合成账号，结果写入 `local/checks/`。报告保留实际入口、版本／提交、内容身份、浏览器及视口、缓存前提、网络限制和失败信息；测试中的数据替身不代表未执行的生产路径已经通过。

Pages 工作流在最终站点构建和引擎审计后执行属性、预算、任务隔离、编组迁移、草稿恢复与排队六项浏览器验收，再上传发布制品；复用站点制品时同样检查。普通源码 CI 的三份浏览器检查不代替这些验收。手动检查已有预览时，使用 `python -B tests/<对应脚本>.py --url http://127.0.0.1:18765/`；资源脚本默认验证当前队列（也可显式传 `--gated`），`--ungated` 只用于在未门控版本上重现原资源竞争对照。不需要重新下载图片或创建另一份完整站点。

账号清理与跨页签用例运行正式控制器和真实 IndexedDB；为了稳定复现迟到结果，部分场景仅控制外部 Worker 的完成时机。真实引擎运行与取消由对应模拟、搜索脚本另行验证。图片适配器释放检查只计入该适配器持有的观察器，模拟任务计数只统计模拟 Worker，避免将内容处理、图片解包或测试工具自身的后台任务误判为泄漏。

浏览器检查使用 [requirements-test.txt](../requirements-test.txt) 中的依赖；`browser_image_delivery.py` 还会构建隔离站点，需要同时具备 [requirements-build.txt](../requirements-build.txt) 中的构建依赖。优先复用已有隔离环境，具体依赖版本以这些文件为准。

## 性能测量口径

- 分开记录页面外壳、库存 DOM、公开资料及图片任务的就绪时间。LCP 不等于库存已全部可用，DOM 就绪也不等于所有图片完成。
- 冷启动、同上下文重载与完整图库准备分别比较。账号数据、浏览器、CPU／网络限制及缓存状态不同的两轮，不直接拼接绝对时间。
- 图片下载量注明是响应正文、完整传输还是构建体积。来源分段、同源用途包、缩略图与 CDN 增量分开统计。
- 并行 Worker 或缓存检查耗时不能相加当作墙钟时间；定时器间隔不是实际输入延迟或 P95。
- 启动任务、可见图片任务与主动完整准备有不同工作量。只检查当前需要的对象，不等于相同全库工作提速。
- 只在同一交付物和调用路径下复用已有证据。单次实验室对照不代表真实手机分布，也不证明所有界面或账号均已覆盖。

## 网络、存储与未验证边界

验证公开请求不携带账号、库存、密码或认证正文。发布清单允许的 CDN GET／HEAD 可以是合法请求；报告应同时保留实际来源和是否全同源，不能把所有站外请求都视为上传，也不能用允许一个 CDN 来放行任意主机。

图片缓存、公共内容与账号存储分别检查，失败不能误报完成。真实事务中止、注入配额错误和真实磁盘配额拒写是三种不同证据。历史 Chromium 配额覆盖未可靠触发拒写，不能由该探针推断真实 `QuotaExceededError` 场景已验收。

已有缓存与离线内容导入不等于整站离线启动；本项目没有为此作出 Service Worker 或断网启动承诺。线上发布状态以对应工作流与实际站点核对为准。
