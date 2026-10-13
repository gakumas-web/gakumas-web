---
name: 回忆整理室
description: 清爽的卡片工作台，信息密集但便于扫读。
colors:
  canvas: '#f4f6fa'
  paper: '#fff'
  ink: '#24324a'
  muted: '#64728a'
  line: '#e1e7f0'
  accent: '#3163c0'
  accent-deep: '#214c9b'
  selected: '#edf3ff'
  warn: '#91621a'
  warn-bg: '#fff6e4'
  vo: '#ad4167'
  da: '#336fc0'
  vi: '#8c6a17'
typography:
  headline:
    fontFamily: '"Noto Sans CJK SC","Microsoft YaHei",system-ui,sans-serif'
    fontSize: 23px
    fontWeight: 700
    lineHeight: 1.5
    letterSpacing: -.04em
  title:
    fontFamily: '"Noto Sans CJK SC","Microsoft YaHei",system-ui,sans-serif'
    fontSize: 18px
    fontWeight: 700
    lineHeight: 1.5
  body:
    fontFamily: '"Noto Sans CJK SC","Microsoft YaHei",system-ui,sans-serif'
    fontSize: 14px
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: '"Noto Sans CJK SC","Microsoft YaHei",system-ui,sans-serif'
    fontSize: 12px
    lineHeight: 1.5
rounded:
  control: 7px
  panel: 8px
  memory-card: 10px
  transfer-card: 12px
  account-dialog: 18px
spacing:
  action-gap: 8px
  card-gap: 12px
  panel-inset: 14px
  section-gap: 16px
  desktop-gutter: 28px
components:
  button-primary:
    backgroundColor: '{colors.accent}'
    textColor: '{colors.paper}'
    rounded: '{rounded.control}'
    padding: 7px 12px
  button-primary-hover:
    backgroundColor: '{colors.accent-deep}'
    textColor: '{colors.paper}'
  button-secondary:
    backgroundColor: '{colors.paper}'
    textColor: '{colors.ink}'
    rounded: '{rounded.control}'
    padding: 7px 12px
  input:
    backgroundColor: '{colors.paper}'
    textColor: '{colors.ink}'
    rounded: '{rounded.control}'
    padding: 7px 10px
  navigation-active:
    textColor: '{colors.accent}'
    height: 49px
    padding: 0 3px
  filter-chip:
    backgroundColor: '{colors.paper}'
    rounded: '{rounded.control}'
    padding: 3px 7px
  transfer-card:
    backgroundColor: '{colors.paper}'
    rounded: '{rounded.transfer-card}'
    padding: 16px
  segment-active:
    backgroundColor: '{colors.paper}'
    textColor: '{colors.accent-deep}'
    rounded: 6px
    padding: 8px 4px
---

# 回忆整理室设计规范

## Overview

**设计核心：“清爽的卡片工作台”**

以“清爽的卡片工作台”为核心：清爽克制，信息密集但便于扫读。冷灰白画布承托白色内容面板，沉静蓝标明主要操作、当前导航和选中状态。

组件轻巧明确，边界清楚、操作直接。卡片内部通过图片、标题、数值、效果和辅助信息建立阅读顺序；库存浏览、选卡与模拟沿用同一套视觉语言。

**主要特征：**

- 白色内容面与冷灰白画布形成轻量分层。
- 紧凑排版保留明确的分组、对齐与留白。
- 游戏图片承载识别信息，属性色与角色色各有业务含义。
- 平面为主，阴影用于说明层级和状态。

本规范记录当前实现。数值以文首令牌为准；语境化样式仍以 [style.css](style.css) 为来源。产品定位见 [PRODUCT.md](PRODUCT.md)。英文二级标题与文首字段属于工具解析格式。

## Colors

主色为沉静蓝，背景为冷灰白；中性色支撑长时间浏览，彩色仅承担明确的操作或业务含义。

- 主色：`accent` 用于主要按钮、焦点和当前导航；`accent-deep` 用于较深的强调文字；`selected` 承托浅色选中面。
- 中性色：`canvas` 是页面画布，`paper` 是内容面，`ink` 是正文，`muted` 是辅助说明，`line` 是分隔与控件边界。
- 语义色：`warn` 与 `warn-bg` 配对表达提示；`vo`、`da`、`vi` 分别表达三类属性，需搭配属性名称或符号。
- 角色印象色来自内容数据，用于卡片顶边和局部浅色底。未选中回忆卡片的角色底色混合比例为 4%；不把具体角色色复制进全局令牌。

扩展文件中的八阶色带仅供设计面板预览，由现有颜色合成；不是新增应用配色。

## Typography

全站共用文首声明的中文无衬线字体栈，按本机可用字体回退。没有独立的展示字体或等宽代码字体；数值沿用 `tabular-nums`。

页面标题、区块标题、正文和辅助标签分别对应 `headline`、`title`、`body`、`label`。局部卡片标题与小节还使用 13–14px，元信息使用 10–12px。字级来自现有用途，不构造等比字号体系。较重字重用于标题、关键数值和当前状态。

## Layout

主内容居中，最大宽度为 1760px；桌面左右留白使用 `desktop-gutter`。移动端主内容左右留白为 12px，底部为持续操作区预留空间。布局依内容密度调整，不能用统一宽度覆盖所有弹窗。

回忆卡片在桌面采用三列，在窄屏收为单列；筛选和操作组允许换行。常用间距为文首收录的操作间距、卡片间距、面板内边距和区块间距，局部紧凑信息另有较小间距。

常用响应式边界为 599px 与 760px；其余断点服务于具体组件，不能据此假定全站只有两档布局。账号管理面板桌面宽度上限为 760px，移动端贴近视口并允许内部滚动。

## Elevation & Depth

平面为主，阴影用于说明层级和状态。常规卡片通过背景、细边框和间距分组；角色顶边提供识别。弹窗以遮罩区分前后景，不给所有白色容器添加阴影。

实际阴影包括：选中分段按钮的轻微抬升（`0 1px 3px #12243c26`）、奖励浮层（`0 8px 28px #1c2b4533`）、详情浮层（`0 10px 50px #24324a30`）和浮动选择栏（`0 8px 35px #24324a20`）。这些值同时收录在扩展文件中。

## Shapes

控件采用轻微圆角，面板与卡片使用更宽松的圆角，账号管理弹窗桌面圆角更大，移动端收为 12px。圆角依组件角色变化，不强行归并为单一数值。

常规边框为 1px；当前导航用 2px 下划线，回忆卡片用 4px 角色色顶边。图片容器负责裁切，头像可采用圆形；内容图片保持既有比例与识别完整性。

## Components

### 按钮

轻巧明确。主要按钮使用主色底与白字；次要按钮使用白底、正文色和细边框。基础按钮最小高度为 36px，禁用时透明度为 0.45。键盘焦点使用 2px 主色轮廓，偏移 3px。

主要按钮悬停时使用 `accent-deep` 背景与边框，保持白字；禁用按钮不触发悬停样式。次要按钮悬停时使用浅选中色背景和较深边框。

### 输入框

白底、细边框、轻圆角，基础最小高度为 36px。焦点沿用主色轮廓。搜索框另有背景与清除按钮布局；属性输入以属性色、名称和对齐共同表达含义。

### 导航与筛选标签

主导航以透明按钮、底部下划线和加重字重表达当前页，高度为 49px。窄屏保留横向导航与溢出访问方式。

已应用筛选标签采用白底小按钮，文本截断并保留移除符号；角色标签可带角色色底边。标签不是独立的大型行动按钮。

### 卡片与弹窗

回忆卡片按图片、身份、属性和效果组织信息，普通状态不加投影；选中态使用浅主色底。账号备份操作卡片采用图标与正文两列、操作置底的结构，沿用白底和细边框。弹窗内容超出视口时允许滚动，标题与关闭操作保持明确。

### 分段切换

浅灰轨道内放置紧凑按钮；当前项使用白底、深主色文字、加重字重和轻阴影。模拟模式与结果分段沿用这个状态语言，内边距依用途有所变化。

现有样式没有统一的时长或缓动令牌。不要为记录规范而添加动画；减少动态效果的偏好沿用现有滚动行为处理。

## Do's and Don'ts

### 应当

- 沿用现有颜色变量；用沉静蓝标记操作和状态。
- 保留图片与文字的阅读层次，数值使用等宽数字排版。
- 同时提供文字、边界或形状线索表达选中与属性含义。
- 在窄屏重新排列内容，并保留清晰的焦点和可见操作。

### 避免

- 不要把角色印象色或稀有度色提升为全局操作色。
- 不要给普通内容卡片统一添加悬浮阴影或装饰性渐变。
- 不要把某个表单的纯文字布局推广为全站禁用图片。
- 不要把预览生成的色阶当作已实现的运行时颜色变量。
