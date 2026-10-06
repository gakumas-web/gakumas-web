# 第三方来源与权利边界

本项目代码按 AGPL-3.0 发布。以下游戏名称、文本、图像及数据的权利归各自权利人，不由本项目代码许可证重新授权。

- 公开主数据参考 [vertesan/gakumasu-diff](https://github.com/vertesan/gakumasu-diff)，由独立 gakumas-data 维护来源锁并发布内容。其 source 投影与 SOURCES.json 记录来源及哈希；Web 中 `tests/fixtures/public-data/` 保留固定历史回归样本，不作为运行时目录。
- 图片命名与公开资料参考 [初星图书馆](https://gkms.idolism.org/) 及 [hatsuboshi-library](https://github.com/vertesan/hatsuboshi-library/tree/686ae0e07e2564ff0a7beec17db13acbeb0d779d)。界面与数据关联由本项目实现，不包含其 React 组件。
- 游戏图片由可选的独立资源包或 CDN 提供；来源记录在资源项目清单中。Web 默认不加载游戏位图，也不自动访问第三方图片源。来源记录不等于再分发授权，是否打包或托管图片由部署者核对相应条件。
- 角色台词引用来源保存在 `ui/character-quotes.mjs`，相关角色与作品权利不属于本项目。
- 本项目没有官方关联，不包含或提供游戏登录凭据、CA、协议材料、安装包或真实用户库存。
