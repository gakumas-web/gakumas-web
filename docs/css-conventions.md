# CSS 可复用规范

本文说明当前静态 Web 应用中可以跨页面复用的 CSS 约定。事实来源是 [index.html](../index.html) 的 DOM 合同和 [style.css](../style.css) 的实际选择器；视觉取舍见 [DESIGN.md](../DESIGN.md)。规范服务于当前单一入口，不引入预处理器、CSS 构建步骤或新的运行时样式 API。

这是一份公共层边界说明，不表示历史业务 CSS 已全部清理。角色印象色、稀有度色、属性数据色和卡面滑动开关继续由各自业务区域负责；它们只有在符合本文件明确边界时才可被复用。

## 文件结构与层级

`index.html` 只通过 `style.css` 引入样式。维护 `style.css` 时按以下五个区域理解和排列规则：

1. `01 令牌`：`:root` 中的颜色、字体、控件尺寸和公共交互值。
2. `02 基础元素`：盒模型、正文、标题、原生表单、链接和基础焦点。
3. `03 公共组件`：`.actions`、`.dialog-head`、`.panel-section`、筛选页脚、分段控件、消息等在多个业务视图中出现的结构。
4. `04 业务视图`：回忆、图鉴、选拔回忆、成就、账号、赛季模拟和优化器的专用结构。
5. `05 公共交互状态`：普通复选框、选择标记、`[hidden]` 和跨业务视图共用的交互状态覆盖。

业务视图的原有规则和媒体条件保持自己的级联顺序。公共规则需要集中时，只移动具有稳定 DOM 合同的规则；不要为了让文件看起来整齐而跨业务区重排媒体覆盖、状态覆盖或弹窗覆盖。`05 公共交互状态` 只放确实跨业务复用的状态规则，不把业务修补或无归属的全局覆盖塞到文件末尾。媒体条件放在所属组件或业务区附近。

公共样式优先使用现有 class，业务脚本的 `id` 只承担唯一节点定位和状态连接。新增结构如果只出现于一个视图，放入该视图的业务区；同一结构在多个视图中出现并且子节点合同一致时，才归入公共组件区。

## 公共令牌

下面是 `style.css` 当前 `:root` 中可以跨组件使用的完整公共令牌列表。业务局部变量不属于这份列表，不能因为名称相近就跨区域读取。令牌的数值只在 `style.css` 维护；设计文档中的 frontmatter 只提供工具摘要。

| 令牌 | 用途 | 边界 |
| --- | --- | --- |
| `--canvas` | 页面和大块背景 | 不用于按钮状态或业务色块。 |
| `--paper` | 白色内容面、卡片和对话框背景 | 与图片内部的白色内容保持独立。 |
| `--surface-soft` | 分段轨道和局部浅灰内容面 | 不替代页面画布或选中面。 |
| `--ink` | 正文、标题和主要数值 | 不用作次要说明文字。 |
| `--muted` | 辅助说明、元信息和未选中控件文字 | 不能单独承担错误或成功语义。 |
| `--line` | 常规边框、分隔线和表格线 | 组件需要强调边界时再使用状态色。 |
| `--line-hover` | 普通控件悬停边框 | 只用于交互悬停，不替代选中边框。 |
| `--accent` | 主要操作、当前导航、选中边框和普通焦点 | 不能替代角色或稀有度色。 |
| `--accent-deep` | 主色上的深层文字、主要操作悬停和强化焦点 | 与 `--accent` 成对使用。 |
| `--selected` | 选中面和轻量悬停面 | 不作为业务类别颜色。 |
| `--warn` | 警告和提示文字 | 与 `--warn-bg` 配对，不表示已确认的错误。 |
| `--warn-bg` | 警告和提示背景 | 不用于输入框正常状态或资源失败。 |
| `--danger` | 错误、资源失败和危险操作文字 | 与 `--danger-bg`、`--danger-line`、`--danger-deep` 配对。 |
| `--danger-bg` | 错误消息和危险轻按钮背景 | 与 `--danger` 配对，不用于普通警告。 |
| `--danger-line` | 错误状态容器和危险轻按钮边框 | 表达错误边界，不替代选中边框。 |
| `--danger-deep` | 危险按钮悬停和强化危险文字 | 只在危险操作状态中使用。 |
| `--success` | 已持有、已领取和预览获得等正向状态文字 | 不把所有业务绿色都改为此令牌。 |
| `--success-bg` | 正向状态的浅色背景 | 与 `--success` 配对。 |
| `--success-line` | 正向状态边框和强调线 | 与 `--success-bg` 配对。 |
| `--unknown` | 未知、未收录或资料不足文字 | 与 `--unknown-bg` 配对，不冒充警告或错误。 |
| `--unknown-bg` | 未知或未收录状态背景 | 表达信息缺失，不表达操作失败。 |
| `--vo` | Vocal 数据值或属性标记 | 只在属性语义明确时使用。 |
| `--da` | Dance 数据值或属性标记 | 只在属性语义明确时使用。 |
| `--vi` | Visual 数据值或属性标记 | 只在属性语义明确时使用。 |
| `--body` | 全站中文无衬线字体栈 | 等宽内容使用自身已有的字体声明。 |
| `--text-xs` | 10px 图标旁短标签和角标文字 | 只用于可容纳短内容的位置。 |
| `--text-sm` | 11px 元信息和辅助标签 | 不能替代正文。 |
| `--text-label` | 12px 控件标签、表格标签和辅助说明 | 与 `.small`、`small` 的现有语义一致。 |
| `--text-detail` | 13px 卡片标题和面板说明 | 保持信息密度，不用于页面主标题。 |
| `--text-body` | 14px 正文和常规三级标题 | 页面默认正文基准。 |
| `--text-value` | 16px 关键数值和紧凑标题 | 属性值仍受业务颜色约束。 |
| `--text-title` | 18px 二级标题和品牌文字 | 弹窗或业务视图可按现有规则调整。 |
| `--text-page` | 23px 页面主标题 | 移动端可由所属视图缩小。 |
| `--space-1`、`--space-2`、`--space-3`、`--space-4`、`--space-5`、`--space-6` | 4px、8px、12px、16px、20px、24px 的常用间距 | 图片尺寸、定位补偿和数据比例不套用。 |
| `--panel-inset` | 14px 面板内边距和标题间距 | 组件有明确紧凑变体时保留其局部值。 |
| `--radius-control` | 7px 控件圆角 | 普通 button、input、select 和 textarea。 |
| `--radius-panel` | 8px 面板圆角 | 筛选面板、比较容器等内容面。 |
| `--radius-card` | 10px 卡片圆角 | 普通卡片和检查面板。 |
| `--radius-dialog` | 12px 对话框和浮动操作面圆角 | 移动端是否收窄由所属组件决定。 |
| `--radius-manager` | 18px 账号管理弹窗桌面圆角 | 账号管理弹窗移动端改用 `--radius-dialog`。 |
| `--dialog-inset` | 24px 基础和流程对话框桌面内边距 | `599px` 以内由对话框局部改为 `--space-4`，即 16px。 |
| `--control-height` | 36px 常规控件最小高度 | 普通按钮、输入框和筛选页脚按钮。 |
| `--control-height-compact` | 32px 紧凑控件最小高度 | 比较控件等已有紧凑场景。 |
| `--control-padding` | `7px 12px` 常规按钮内边距 | 不用于图片按钮或导航按钮。 |
| `--input-padding` | `7px 10px` 输入控件内边距 | 保持输入文字与边界的可读距离。 |
| `--choice-check-size` | 页面与弹窗普通复选框及卡片选择标记的边长 | 当前公共尺寸为 `18px`；`role="switch"` 的滑动轨道除外。 |
| `--disabled-opacity` | 禁用控件透明度 | 配合 `:disabled`，不作为业务未持有色。 |
| `--selection-ring` | 选中状态和链接定位的 2px 主色轮廓 | 与键盘焦点的 `--focus-ring` 分开使用；当前数值相同也不混用语义。 |
| `--focus-ring` | `2px solid var(--accent)` 普通焦点轮廓 | 只在 `:focus-visible` 或已有焦点规则中使用。 |
| `--focus-ring-strong` | `3px solid var(--accent-deep)` 强化焦点轮廓 | 选择图块或高对比场景，不能隐藏焦点。 |
| `--shadow-segment` | 分段当前项的轻微阴影 | 只表达当前项抬升。 |
| `--shadow-popover` | 奖励或说明浮层阴影 | 不给普通内容卡片使用。 |
| `--shadow-inspector` | 中等宽度详情检查面板阴影 | 只在 `.inspector` 浮层边界内使用。 |
| `--shadow-selection` | 底部多选操作条阴影 | 只在 `.selection-bar` 使用。 |
| `--shadow-feedback` | 页面反馈、启动状态和资料状态阴影 | 只用于反馈浮层，不给普通卡片添加投影。 |

`--character-color`、`--rarity-bg`、`--rarity-ink`、`--rarity-line`、`--selection-stat-color`、`--stat-color`、`--stat-accent`、`--reward-border-color` 以及比较、赛季、图片预览使用的尺寸变量都是业务局部变量。它们由所属 DOM 或数据状态设置，不能作为新的全局配色或通用尺寸来源。属性色 `--vo`、`--da`、`--vi` 虽位于公共令牌中，也只表达属性数据，不能用于普通按钮和导航。任何新业务变量先确认是否属于公共令牌；不把单个视图的值加入 `:root` 作为快捷修复。

## 命名与选择器

现有 class 按“结构 + 业务名 + 状态”使用。新规则先寻找现有结构 class，再追加已有状态选择器；不要为同一视觉含义另造一套同义 class。

| 用途 | 现有 class 或选择器 | 使用方式 |
| --- | --- | --- |
| 横向操作组 | `.actions` | 放按钮、表单控件或短说明；组件自己决定对齐方式。 |
| 主操作按钮 | `.primary` | 与原生 `button` 一起使用；普通次要按钮直接使用原生 `button`。 |
| 危险操作按钮 | `.danger-button`、`.danger-confirm` | 只用于删除或清除账号等不可逆确认。 |
| 辅助文字 | `.small`、`.muted` | 只表达字号或文字层级，不当作状态容器。 |
| 普通消息 | `.message` | 配合 `role="status"` 和 `aria-live="polite"`。 |
| 错误消息 | `.message.error` | 配合 `role="alert"`；输入字段的错误文字另用 `--danger`。 |
| 对话框标题行 | `.dialog-head` | 标题和关闭、导航操作放在同一行；弹窗本身使用原生 `<dialog>`。 |
| 面板分段 | `.panel-section` | 账号、资料、帮助等弹窗中的内容区。 |
| 说明折叠 | `.info-disclosure` | 账号文件夹、总属性填写、舞台基础规则和综合评分说明共用；算法与评级纯文字折叠保留各自业务 class。 |
| 筛选页脚 | `.filter-footer`、`.memory-filter-footer` | 统一放置“清空筛选”等页级操作，不为每个标签页另造页脚类。 |
| 分段控件 | `.simulation-segments`、`.simulation-mode-tabs` | 前者承载分段按钮；后者只在分段同时承担 tab 语义时作为修饰 class。 |

ID 选择器仍用于 `#navigation`、`#advanced-filters`、`#selection-picker-list` 等已有布局或脚本合同。新公共样式不要依赖某个页面 ID；如果已有 ID 是语义或无障碍连接的一部分，保留它并用 class 承担可复用外观。

## 公共组件与状态

### 交互组件复用

- `ui/memory-skill-badges.mjs` 的 `updateSkillCustomizationBadge` 从技能引用合计附魔次数，仅更新目标直属的次数角标；零次移除角标，并统一中文／日文标签和提示。该入口同时同步父控件的 `aria-description`，归零时移除次数描述，保留原有控件名称；现有记录型卡片仍由调用方将标签合入名称。已有 `appendMemorySkillBadges` 复用同一角标实现，继续组合开局继承标识。缩略图、候选选择与说明浮层由各调用方维护。
- `ui/contest-criteria.mjs` 的 `appendContestCriteria` 共用舞台摘要和赛季选项中的 Vo／Da／Vi 权重条及百分比标签，保留输入权重与一位小数展示规则。资料缺失提示由调用方处理，模拟得分占比仍使用自己的计算与交互。
- `ui/choice-navigation.mjs` 的 `createChoiceNavigation` 共用候选按钮的方向键、Home／End 和循环导航，跳过隐藏与原生禁用项。回忆筛选、推荐角色及舞台标签页也复用该入口；标签页继续同步自己的 `aria-selected`。模拟模式标签页指定 `axis: 'horizontal'`，只处理左右键及 Home／End；回忆编组搜索的角色选择保留搜索期间的原生禁用状态。`onMove` 决定单选随焦点选择或多选仅更新活动项；带 `aria-disabled` 的限额提示项继续允许聚焦查看。
- `choiceFilterIcons()` 的 `sync({isVisible})` 从已有筛选值同步显隐、`aria-checked` 和唯一 Tab 入口。可见性由业务提供；当前筛选值不在可见项中时，只将 Tab 入口移到首个可用项，筛选值的恢复仍由业务决定。 回忆选择器通过适配将数字计划值映射为图标键，保留固定舞台计划和流派失效时回退到全部的规则。
- `ui/contest-customization-stepper.mjs` 的 `createContestCustomizationStepper` 共用附魔名称、颜色、增减按钮、次数、无障碍标签与选中外观。自选编组和推荐编组选择器通过 `update({count,canDecrease,canIncrease})` 同步状态；总次数上限、评级限制、引擎支持过滤和草稿更新继续由调用方决定。
- `ui/listbox-popover.mjs` 的 `createListboxPopover` 共用列表弹出层定位、展开收起、键盘导航、滚动／窗口变化关闭和监听清理。赛季与快捷舞台选择器提供各自内容和尺寸；快捷跳转通过 `returnFocus` 获取重建后的入口。移除组件时调用 `dispose()`，同时解除入口、弹出层和全局事件监听。
- `ui/number-stepper.mjs` 的 `createNumberStepper` 接收已有数字框、前后两组按钮定义和动作回调，共用按钮构建、输入框排列、无障碍标签与禁用状态同步。编组属性保留空值和即时输入事件，培养预览保留自身范围、清空恢复和失焦确认规则；倍率计算、缓存、参考填入与撤销仍在业务层。
- `ui/info-disclosure.mjs` 的 `createInfoDisclosure` 共用舞台规则和综合评分说明的原生 `<details>`、标题及信息图标，调用方追加正文。总属性填写说明继续采用独立按钮与正文，保持入口位置稳定；静态账号说明沿用 HTML 结构和公共样式。

### 筛选标题与字段

页签筛选标题统一使用 `.filter-title`，不按 `label`、`legend` 分别维护字号、字重和标题高度。静态分组将该 class 放在 `fieldset` 的直接子节点 `legend` 上；单项字段使用 `label.filter-field` 包含 `span.filter-title` 和输入控件。标题到选项的间距由分组或字段容器承担。

动态界面复用 [filter-field.mjs](../ui/filter-field.mjs)：`filterField(标题, 控件)` 创建保留隐式关联的单项标签；`filterTitle(标题)` 创建普通标题，整组图例使用 `filterTitle(标题, 'legend')` 并将其放在 `fieldset` 的首个子节点。标题参数传入已本地化的文字。工具栏标题若通过 `aria-labelledby` 为按钮命名，继续保留该关联。

`label` 负责单个控件的可访问名称与点击行为，`legend` 负责整组控件的名称；复用组件时保留这两种语义。新增页签筛选字段应使用上述结构，不再直接把裸标题文字塞入 `label`，避免漏掉共享标题样式。

### 操作组和筛选页脚

`.actions` 只提供横向排列、间距和换行。按钮等级由原生 `button`、`.primary` 或 `.danger-button` 表示；不要把按钮颜色写进父级业务选择器。筛选页脚已经统一最小高度、文字尺寸和分隔线，使用既有 `.filter-footer` 或 `.memory-filter-footer`：

```html
<div class="filter-footer" data-filter-tab="supportCards" hidden>
  <button id="reset-support-filters" type="button">清空筛选</button>
</div>
```

页脚的 `data-filter-tab` 用于现有视图切换，不能用来替代无障碍名称。页脚边界与上一个筛选区之间保留分隔线；不要在业务区再次设置一套不同的清空按钮尺寸。

### 说明折叠

账号文件夹说明 `.account-directory-help`、舞台基础规则 `.season-stage-guide` 和综合评分说明 `.simulation-score-help` 在 `<details>` 上使用 `.info-disclosure`。总属性填写说明 `.optimization-input-help` 将正文与 `.info-disclosure-toggle` 按钮分开，由 `aria-expanded`、`aria-controls` 和 `hidden` 同步展开状态；反馈与按钮固定在页脚首行，正文独占下行，展开时不移动入口。公共样式负责 12px 标题、550 字重、1.5 行高、深蓝标题、16px 信息图标、展开箭头、浅蓝悬停和统一焦点；正文沿用 1.7 行高。调用方只保留宽度、内容边距和业务布局，不重复实现箭头或焦点。

```html
<details class="season-stage-guide info-disclosure">
  <summary>
    <svg aria-hidden="true" focusable="false" viewBox="0 0 24 24"><path d="M12 11v6M12 7h.01M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0Z"></path></svg>
    <span>基础规则和属性评分曲线</span>
  </summary>
  <p>基础规则说明。</p>
</details>
```

推荐算法和评级、容量说明是另一种纯文字折叠，继续使用 `.recommendation-algorithm`、`.contest-capacity-ranges` 等现有业务 class，保持透明背景和正文布局，不套用 `.info-disclosure` 的信息面板外观。

### 复选框与选择标记

稀有度筛选图片保持原始宽高比，筛选区使用统一的 24px 高度，已应用标签使用 18px 高度；容器为较宽的 SSR 留足空间，不能用相同的固定图片宽度将它压矮。

收藏和分享图标共用 18px 的 SVG 视口与线条粗细，不继承卡片文字字号。同一操作组内的按钮保持相同点击区域；手机和触摸场景至少为 36px 方形。收藏的空心、实心状态共用同一轮廓。

原生多选统一使用 `input[type="checkbox"]`，公共样式给普通复选框 `18px` 方形标记、选中勾号、禁用透明度和键盘焦点。文字和控件应放在同一个可点击的 `label` 中；页面筛选区和账号弹窗沿用 `.check-label` 或 `.filter-match-toggle`：

```html
<label class="check-label">
  <input id="differences-only" type="checkbox">
  <span>只看差异</span>
</label>
```

支援效果选择器中的 `.support-effect-picker #selection-picker-list input` 仍是已有的密集业务例外；公共基准仍由 `--choice-check-size` 提供，不要把这个局部尺寸扩散到其他筛选区。

`input[type="checkbox"][role="switch"]` 不使用普通复选框外观。卡面中已有的 `.idol-card-art-options input[role="switch"]` 是有意保留的滑动开关，桌面和窄屏尺寸也有专用规则；不要把它改成普通方框，也不要把这个专用轨道推广给其他筛选项。

单槽位选择使用 `role="radiogroup"`、子项 `role="radio"`、`aria-checked="true|false"` 和循环移动的 `tabindex`。现有自选编组卡图使用 `.contest-loadout-groups`、`.contest-loadout-choice` 和 `.contest-loadout-art`；图鉴或比赛筛选中的单选图标使用 `.character-choice`、`.contest-plan-choice`、`.contest-flow-choice` 等已有 class。单选卡图没有重复的隐藏 checkbox：

```html
<div class="contest-loadout-groups" role="radiogroup" aria-label="技能卡选项">
  <section class="selection-source-column">
    <h3>支援卡</h3>
    <div class="selection-source-options">
      <div class="selection-filter-choice contest-loadout-choice">
        <button class="contest-loadout-art" type="button" role="radio"
                aria-checked="true" tabindex="0" aria-label="技能卡名称">
          <span class="support-reward-art"></span>
        </button>
      </div>
      <div class="selection-filter-choice contest-loadout-choice">
        <button class="contest-loadout-art" type="button" role="radio"
                aria-checked="false" tabindex="-1" aria-label="另一张技能卡">
          <span class="support-reward-art"></span>
        </button>
      </div>
    </div>
  </section>
</div>
```

脚本必须同步 `aria-checked` 和 `tabindex`，并为同一 `radiogroup` 提供方向键循环移动。选中描边、角标和焦点描边分别表达状态，不能只依靠颜色。

### 分段和标签页

统计范围等简单分段沿用 `.simulation-segments`，按钮用 `aria-pressed`：

```html
<div class="simulation-segments" role="group" aria-label="统计范围">
  <button type="button" aria-pressed="true">全部</button>
  <button type="button" aria-pressed="false">回合</button>
</div>
```

模拟结果模式还承担面板切换，因此使用已有 `.simulation-mode-tabs` 修饰 class、`role="tablist"`、子项 `role="tab"`、`aria-selected` 和关联的 `role="tabpanel"`。这两种状态属性含义不同：`aria-pressed` 表达按钮开关或范围是否开启，`aria-selected` 表达当前 tab；不要混用。

舞台选择沿用 `.season-stage-tabs` 与 `.season-stage-tab`，同样使用 `role="tablist"`、`role="tab"`、`aria-selected`、`aria-controls` 和循环移动的 `tabindex`。阶段标签在窄屏改为纵向排列，业务脚本同时更新 `aria-orientation`。

### 消息、校验和焦点

状态消息要有可被辅助技术识别的角色；成功或进行中消息使用 `role="status"`，需要立即打断阅读的错误使用 `role="alert"`。输入校验同时设置 `aria-invalid="true"`，错误文字与字段建立 `aria-describedby` 或由相邻可读文字说明。`.message.error`、`.content-readiness.is-error`、`#content-status.is-error` 和 `#resources-dialog #image-notice.is-error` 统一使用 `--danger`、`--danger-bg` 和 `--danger-line`；资源入口的 `#resources-open[data-status="error"]` 也使用危险状态。字段和模拟校验文字使用 `--danger`。

警告和提醒使用 `--warn`／`--warn-bg`，未知、未收录或资料不足使用 `--unknown`／`--unknown-bg`；已持有、已领取和预览获得等正向状态使用 `--success`、`--success-bg`、`--success-line`。体力、卡组标记等已有业务绿色保持自己的语义，不因颜色相近而全部替换。

删除按钮保留 `.danger-button` 的浅色危险外观；需要强确认的 `.danger-confirm` 使用实心危险底色。两者共享 danger 色系，但按钮层级和操作语义不同，不能用普通 `.primary` 代替。

基础控件的键盘焦点由 `:focus-visible` 提供，默认使用 `--focus-ring` 的 2px 轮廓并带偏移。选中状态和链接定位使用独立的 `--selection-ring`；两者当前数值相同也不能互相替代。深色选择卡图、角色或舞台图块可以使用已有的强化焦点规则，但必须保留可见轮廓；不得用 `outline: none` 隐藏键盘焦点。装饰层使用 `pointer-events: none`，不能遮住控件的焦点或点击区域。

## 响应式边界

公共布局从桌面尺寸开始，再在所属组件的媒体条件中收窄。常用边界如下：

| 边界 | 当前职责 |
| --- | --- |
| `1199px` | 工作台详情从并列区域转为右侧固定检查面板，列表列数减少。 |
| `850px` | 页面头部、主内容和导航收紧内边距，列表进一步减少列数。 |
| `760px` | 赛季和优化器等双栏业务区收为单栏；部分详情控件允许换行。 |
| `699px` / `700px` | 赛季舞台 tab、历史结果和图表的窄布局边界，按组件实际条件保留。 |
| `599px` | 通用移动端边界：导航变矮、筛选字段重排、卡片单列、对话框贴近视口。 |
| `480px`、`399px`、`359px` | 仅用于特定控件的最窄宽度，不能当作全站断点。 |

基础 `<dialog>` 和 `.account-flow-dialog` 使用 12px 的 `--radius-dialog` 与 24px 的 `--dialog-inset`；`599px` 以内内边距收为 16px。`.account-manager` 是管理弹窗，桌面使用 18px 的 `--radius-manager`，移动端收为 `--radius-dialog` 的 12px；其标题区和正文区与对应内边距保持一致。`.dialog-head` 负责同类弹窗的标题、分隔线和关闭操作，不在业务调用方重复建立标题区间距。

普通一级卡片（如 `.memory-card`、`.idol-card`、`.support-card`、`.skin-card`、`.selection-memory-card` 和 `.achievement-card`）统一使用 10px 的 `--radius-card`。弹窗、流程卡片和图片内部控件仍按各自的 `--radius-dialog` 或业务局部圆角处理，不把 10px 推广到所有容器。

新增或调整公共结构时遵守以下限制：

- 可收缩的网格子项设置 `min-width: 0`，长名称使用 `overflow-wrap: anywhere` 或已有的截断方式。
- 操作组使用 `.actions` 换行；不要用固定宽度把按钮推到视口外。
- 比较表、长表格和少数横向信息在已有滚动容器内滚动；不要给 `body` 添加横向滚动。
- 移动端底部固定的 `.selection-bar` 必须为主内容预留底部空间，不能盖住最后一项操作。
- 媒体条件只覆盖所属公共或业务规则，保持原有级联顺序；不要在文件末尾用高优先级选择器反向修正桌面规则。

## 层级、定位与专用色

普通内容沿文档流排列。需要叠加的局部元素由所属业务容器建立 `position: relative` 边界，并沿用该组件已有的定位和层级规则。本节只描述现有层级的使用边界，不统一或承诺所有局部徽章的 `z-index` 数值。表头、检查面板和弹窗标题的 sticky 层级只服务于自己的滚动容器。

已有全局浮层边界如下：`.selection-bar` 用于多选操作，`.inspector` 在中等宽度下作为详情浮层，`.resource-feedback`、`.startup-status` 和 `.content-readiness` 用于加载或反馈状态，原生 `<dialog>` 使用 `::backdrop` 分隔前后景。三类页面反馈共用 `--shadow-feedback`，普通卡片不因此增加投影。新组件不得为了盖住邻居而随意增加高 `z-index`；先调整所属层叠上下文，再采用所属类型已有层级。

角色、稀有度和属性数据色的含义不相同：角色色来自数据并通过 `--character-color` 局部注入，稀有度使用 `--rarity-*` 局部变量，`--vo`、`--da`、`--vi` 只标记属性数据。它们不用于普通按钮、导航、焦点或错误。卡面的 `role="switch"` 滑动开关同样是业务专用结构，不能作为公共选择控件模板。

## 新增组件的最短步骤

1. 先从现有 class 中选择外壳：操作区用 `.actions`，弹窗用原生 `<dialog>` 与 `.dialog-head`，内容分区用 `.panel-section`，说明折叠用 `.info-disclosure`，筛选清空操作用 `.filter-footer` 或 `.memory-filter-footer`。
2. 先确定真实语义：多选使用原生 checkbox，单选使用 `radiogroup`／`radio`，开关使用 `switch`；同步对应的 `aria-*` 状态、焦点和键盘行为。
3. 在 `01 令牌` 中只读取公共令牌；角色、稀有度、属性值、图片叠加和业务尺寸留在所属业务变量中。
4. 复用已有状态选择器和 `:focus-visible`，再写桌面基础布局及所属媒体条件。需要跨两个以上业务视图且 DOM 合同一致时，才把规则放入公共组件区。
5. 用当前 HTML class 和脚本真实生成的 DOM 做一次桌面、`599px` 窄屏和键盘检查，同时核对 `aria-*` 状态、`[hidden]` 状态以及页面是否出现横向溢出。

## 相关文档

- [设计规范](../DESIGN.md)：视觉令牌、颜色含义和产品层面的布局取舍。
- [项目文档索引](README.md)：运行、内容、发布与验证文档入口。
- [style.css](../style.css)：当前选择器和级联顺序的唯一实现来源。
