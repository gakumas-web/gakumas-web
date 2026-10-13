# 第三方来源与权利边界

本项目代码按 AGPL-3.0 发布。以下游戏名称、文本、图像及数据的权利归各自权利人，不由本项目代码许可证重新授权。

- 公开主数据参考 [vertesan/gakumasu-diff](https://github.com/vertesan/gakumasu-diff)，由独立 gakumas-data 维护来源锁并发布内容。其 source 投影与 SOURCES.json 记录来源及哈希；Web 中 `tests/fixtures/public-data/` 保留固定历史回归样本，不作为运行时目录。
- 图片命名与公开资料参考 [初星图书馆](https://gkms.idolism.org/) 及 [hatsuboshi-library](https://github.com/vertesan/hatsuboshi-library/tree/686ae0e07e2564ff0a7beec17db13acbeb0d779d)。界面与数据关联由本项目实现，不包含其 React 组件。
- 游戏图片由可选的独立资源包或 CDN 提供；来源记录在资源项目清单中。Web 默认不加载游戏位图，也不自动访问第三方图片源。来源记录不等于再分发授权，是否打包或托管图片由部署者核对相应条件。
- 角色台词引用来源保存在 `ui/character-quotes.mjs`，相关角色与作品权利不属于本项目。
- 本项目没有官方关联，不包含或提供游戏登录凭据、CA、协议材料、安装包或真实用户库存。

## 构建缩略图

Pillow 用于 Pages 构建阶段的图片缩放与 WebP 编码，版本固定在 `requirements-build.txt`。Pillow 采用 MIT-CMU 许可证，见 [项目许可证](https://github.com/python-pillow/Pillow/blob/main/LICENSE)。该 Python 依赖不在浏览器中运行；生成缩略图不改变原游戏素材的权利归属。

## GakumasTools 舞台参考资料与模拟引擎

比赛属性比例、属性回合数、链接比赛及活动舞台信息参考 [gakumas-tools/gakumas-tools](https://github.com/gakumas-tools/gakumas-tools)。固定来源与哈希由数据项目的 `data/reference/contest-stages-source.json` 记录。舞台模拟另外使用其 `gakumas-engine` 和 `gakumas-data`，固定源码 commit 为 `58c7148cb1d097b78f66faa4a9ab6d5212f083b7`。浏览器产物为 `domain/upstream-contest-engine.mjs`，构建入口为 `tools/build_contest_engine.py`；所选游戏记录与引擎的映射保存在 `domain/contest-engine-map.mjs`。统计归属和容量计算还参考同一版本的 `gakumas-tools/utils/simulator.js`、`components/SimulatorStats/helpers.js`、`utils/contestPower.js` 及 `packages/gakumas-data/utils/contestPower.js`，对应本项目的 `domain/contest-simulation-stats.mjs` 和 `domain/contest-card-cost.mjs`。仅在本地 Worker 内计算，不接入其账号服务或上传编组。原许可证如下：

```text
BSD 3-Clause License

Copyright (c) 2024-2026, risりす

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are met:

1. Redistributions of source code must retain the above copyright notice, this
   list of conditions and the following disclaimer.

2. Redistributions in binary form must reproduce the above copyright notice,
   this list of conditions and the following disclaimer in the documentation
   and/or other materials provided with the distribution.

3. Neither the name of the copyright holder nor the names of its
   contributors may be used to endorse or promote products derived from
   this software without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE
FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY,
OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
```
