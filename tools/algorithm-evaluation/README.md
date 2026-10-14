# 推荐算法评测工具

本工具从已结束的算法研究中提取，保留基准校验、候选生命周期诊断、同版本质量比较、真实浏览器 Worker 回归和已有压缩包完整性校验。不会修改生产算法、自动调参或发布站点。

## 文件与构建边界

- `evaluate.py`：命令入口；`versioning.py`：输入、算法与评分环境的身份检查。
- `test_evaluate.py`：证据完整性、失败门槛与版本混用检查。
- `baselines/r00-r08-20261013/`：本机保留的最小冻结基准，包括 62 个运行模块、8 个公开内容文件、3 个正式投影输入、9 个回归结果，以及 R01 比较所需的候选与独立评分。只保留工具依赖，没有历史截图、日志、一次性实验执行器或整站副本。
- `baselines/` 由本目录的 `.gitignore` 排除，不随公开源码包分发。新检出仓库需单独准备符合合同的基准，并通过 `--baseline` 指定；没有基准不能声称回归已通过。
- 静态站点构建采用程序白名单，不复制 `tools/`；Docker 上下文仅允许指定构建脚本，本工具不在其中。工具源码可以随项目维护，基准和运行结果不进入站点产物。
- 新运行结果统一写入 `local/checks/algorithm-evaluation-*`；输出目录必须不存在，避免覆盖证据。

以下命令从 Web 项目根目录运行。Python 使用 3.11 及以上版本；除 `regression` 外仅依赖标准库。真实回归使用已有 Playwright 与 Chromium，不自动安装环境，不读取用户账号、库存或浏览器用户档案。

## 使用入口

```sh
python -B tools/algorithm-evaluation/evaluate.py --help
python -B tools/algorithm-evaluation/evaluate.py audit
python -B tools/algorithm-evaluation/test_evaluate.py
```

`audit` 核对固定模块、内容、输入和期望结果的哈希；不运行模拟，也不要求现行生产源码与旧基准相同。

```sh
python -B tools/algorithm-evaluation/evaluate.py regression --profile smoke --output local/checks/algorithm-evaluation-smoke-001
python -B tools/algorithm-evaluation/evaluate.py regression --profile full --output local/checks/algorithm-evaluation-full-001
```

`smoke` 是 Sense 高级实例、种子 `44017` 的一次完整搜索，历史成本为 43,067 局；`full` 包含三个计划各三个种子，历史成本为 385,827 局。执行正式冻结控制器及真实 Worker，不依赖预览服务；临时 HTTP 服务只监听 `127.0.0.1`，只提供清单内文件，完成后关闭。

默认 `--check exact` 要求同评分环境，比较候选、逐局分数和总局数。可用 `--source /完整源码目录` 指定另一套完整模块；不会以冻结文件补齐缺失模块。评分环境变化时可以使用 `--check observe` 记录结果，其 `passed` 为 `null`，不表示质量通过。新内容、输入或接口需要新 `--baseline`，详见[版本边界](VERSIONING.md)。

```sh
python -B tools/algorithm-evaluation/evaluate.py diagnose tools/algorithm-evaluation/baselines/r00-r08-20261013/records/sense-advanced-44017.json
python -B tools/algorithm-evaluation/evaluate.py compare tools/algorithm-evaluation/baselines/r00-r08-20261013/example-r01.json
```

`diagnose` 默认追踪原冠军，也可以传入 `--key`；缺少事件记录会报错，不能解释为候选未生成。R01 比较示例应得到 `passed: false` 和退出码 `2`，保留历史未通过门槛的结论，不启动新模拟。

退出码：`0` 表示检查通过或观察完成；`2` 表示质量门槛或精确回归未通过；`1` 表示输入或执行错误。观察完成不等于算法通过验收。

`verify-archive 路径` 仍可校验外部已有的清单式压缩包。依赖完整旧研究树的 `audit-history`、`archive`、一次性回执补建脚本和历史实验执行器已退役，不能用于恢复已清理的原始研究。

## 解释边界

固定案例已经用于历史开发选择，不是未见验收集。比较器只核对协议、字节身份、原冠军及外评样本，不证明协议事先登记，也不提供第三方认证。不同引擎分数不可直接混比；候选键只在对应输入映射内有意义。

本机基准搬迁只更新路径和相关清单绑定，模块、输入与评分文件字节保持不变；没有重新选择冠军或修改参考分数。历史报告中 R00–R08 的结论不能由这套最小基准全部重新生成。
