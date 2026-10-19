# V9 共享视觉契约

统一来源：`src/app/shared/v9-design-tokens.scss`。使用原生本机字体，不下载外网字体。颜色以大储项目的深海蓝与青色为基准，数据区域采用稳定实色，避免渐变影响阅读。

## 消费边界

- 页面根区域：`@include v9.reading-surface(light|dark|auto)`。仅为明确标记的 `.v9-reading` 使用，不能覆盖全局 `body`、旧页面或未改造组件。
- 已有主题容器内的子组件：`@include v9.reading-content`。继承颜色、字号和间距，不重新声明主题；统计面板遵循此方式。
- `data-v9-theme="light|dark"` 可覆盖根区域主题；auto模式才跟随系统配色。高层总览明确dark，预算/进度业务面板明确light，外围旧看板保持其原有样式。
- CSS仅呈现传入状态，不计算预算、分数、逾期、权限或保存结果。不得用颜色推断业务状态。

## 变量与固定骨架

| 类别 | 契约                                                                                                                                        |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| 颜色 | ink正文、muted辅助、surface面板、ground底色、line边框、accent链接/焦点、selected选中、success/warning/danger/unknown状态                    |
| 字体 | 正文14px；辅助12px；分组16px；板块18/20px；页标题24–30px；核心数字28–36px；表格等宽数字                                                     |
| 间距 | space-1/2/3/4/6/8 = 4/8/12/16/24/32px；面板桌面24px、窄屏16px                                                                               |
| 形状 | radius-panel 12px；radius-control 8px；状态提示采用侧边线，避免与内容面板等重                                                               |
| 容器 | v9-panel内容面板、v9-toolbar工具栏、v9-summary摘要、v9-notice只读/说明、v9-empty空态                                                        |
| 表格 | v9-table-wrap局部滚动；v9-table表格；v9-number金额/数量右对齐、不省略；v9-date日期不折断                                                    |
| 控件 | v9-button统一尺寸、悬停、选中、展开、禁用；aria-pressed/expanded提供可见状态；focus-visible始终可见                                         |
| 状态 | v9-status + data-v9-status；verified/completed/not-required完成，incomplete/warning警示，invalidated/overdue/error错误，missing/unknown待补 |

共享表格规则只匹配 `.v9-table`，不会通过裸 `table/th/td` 污染旧表格。使用者必须提供可见状态文字，不能只加颜色。`v9-table-wrap`需提供`role="region"`、具体`aria-label`和`tabindex="0"`，以支持键盘局部滚动。空态说明数据缺口，不填假数；加载和保存结果仍由业务模块提供。禁用控件需同时提供原生disabled及可理解原因，不靠透明度降低文字可读性。

范围：本次统一总览、统计、预算费用和21节点进度面板；其余方案、报价、计划页面后续按原排期复用。不增加主题设置、费用编辑或业务操作。浏览器验证与截图见根目录`docs/verification/v9-visual-contract/`。

第三批密集计划页（仅产研/FAT）复用`theme(light)`与共享字号、间距、焦点和状态变量；原计划表格、按钮继续消费已有样式，不重复生成未使用的整套阅读表格/面板骨架。新样式仍限于`.v9-plan-reading`，保持生产组件8KB上限。图表宿主已改为接收父页已计算的统计与单币种预算展示输入。
