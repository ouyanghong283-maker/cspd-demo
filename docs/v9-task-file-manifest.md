# V9文件归属与接入

开工先读本清单、公共契约 `src/app/core/v9-contracts.ts` 和本票规格。共享基线为 `abcb717`；接口检查点在第一批证据索引中记录。路径相对 `my demo/`。

| 唯一负责人                      | 文件或目录                                                                                                                                    | 接入条件                                                                     |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| C0 集成                         | `src/app/core/models.ts`、`store.ts`、`seed.ts`、`v4.ts`、`v9-contracts.ts`、`v9-command-input.ts`、`v9-queries.ts`、全局迁移与事项注册       | 所有公共接线交C0；模块提交接口变更说明与消费者清单                           |
| C0 集成                         | `tests/v9-public-contracts.test.ts`、`scripts/check-v9-public-scenarios.ts`、`docs/v9-task-file-manifest.md`                                  | 公共预期由CODEX定义和核对                                                    |
| K10 数据                        | `tests/fixtures/v9-public-scenarios.json`、`docs/v9-kimi-handoff.md`                                                                          | 只录入已冻结事实；复核后写权交C0，修改前再登记交接                           |
| C1 / P1                         | `src/app/core/solution-files/`                                                                                                                | 文件暂存与存在性，不分配业务版本；等待04-01/04-02再真实接入                  |
| C1 / P2                         | `src/app/core/solution-workflow/`、`src/app/features/solution-workspace.*`、`solution-service.*`                                              | 期限/定稿/版本分文件；父页面唯一由P2接线                                     |
| C0 / P3                         | `src/app/core/solution-migration/`                                                                                                            | 纯转换；全局升级仍由C0接入                                                   |
| C1 / P4                         | `src/app/core/lifecycle-progress/`、`progress-mapping/`                                                                                       | 以下指定数据文件除外；项目父页交P8                                           |
| C1 / P5                         | `src/app/core/budget-comparison.ts`、`src/app/features/budget-expense-panel.ts`                                                               | 只读预算与唯一费用来源，项目父页交P8                                         |
| C2 / P6                         | `src/app/core/management-board/`、`src/app/features/project-board.*`、`management-board-charts.*`                                             | 部门事项适配由C0独立文件提供；所有看板验证归CODEX                            |
| C1 / P7                         | `src/app/core/quote-solution-source.ts`、`crm-quote-reference.ts`、`src/app/features/quote-workspace.ts`、`src/app/shared/crm-quote-field.ts` | 目录资料交K05，提交/审核/锁定接线交C0                                        |
| C2 / P8                         | `src/app/shared/v9-design-tokens.scss`、`src/app/features/project-detail.*`、`project-plan-visual.scss`                                       | 项目父页唯一接入进度/预算子面板；全部视觉验证归CODEX                         |
| K02/K05                         | `src/app/core/budget-demo-expenses.ts`、`crm-quote-demo-catalog.ts`                                                                           | 固定ID数据，规则由C1给出                                                     |
| K13/K27                         | `tests/fixtures/v9-solution-migration-*.json`及原引用清单                                                                                     | 只录原事实，映射判断归C0                                                     |
| K30/K31                         | `src/app/core/lifecycle-progress/node-copy.ts`、`src/app/core/progress-mapping/demo-mappings.ts`                                              | 固定节点说明/映射样例，覆盖目录默认归属                                      |
| K12/K14/K15/K16/K17/K20         | 规格12第8节指定的独立上传、期限、定稿、进度、关联、费用子控件                                                                                 | CODEX发布静态骨架后仅绑定数据/回调，SCSS和布局归CODEX；不得直接保存快照/Blob |
| K11/K23/K24/K26/K28/K29/K32/K08 | 规格12第8节指定的固定脚本、资料清单及证据                                                                                                     | 独立预期、输入和路径由负责CODEX在对应票开工前发布；验收结论由CODEX给出       |

目录默认负责人和表中精确文件负责人组成唯一归属。领取尚未细分的目录时，由C0先登记本票的精确文件再开工，不能多人同时写同一目录文件。表外现有文件默认C0；跨包改动提交接线请求。所有权转移记录旧负责人、新负责人、文件、接入提交与验证，不以直接复制覆盖代替交接。

页面→模块命令/查询→公共模型。模块以 `DemoStore.commitV9Command` 提交经过业务校验的 `V9CommandPlan`；页面只调用模块命令。统一入口与原 `commitOperation/write` 共用同次快照；只读查询显式接收已提交状态，不写迁移、历史或待办。B01仅交付接缝，后续业务校验仍须各票实现。真实File由文件设施处理，幂等输入用稳定内容身份，不把File/Blob直接JSON序列化。

更改接口时先列出P1–P8实际消费者及K绑定/样例，C0统一修改类型和独立预期，提供新检查点，消费者更新后再集成。样例通过与真实来源通过分开记录。KIMI不领取看板、图表、主模板、布局或视觉验收。

B01实际交接：K10两个文件由C0接收（23742cd → b872984），CODEX在4573b4c修正并验证样例；这两个文件当前写权归C0。目录及发布检查点见根目录 `docs/verification/v9-b01/worktrees.json`。

## B02执行与文件交接（2026-10-17）

本批仍由CODEX集成人唯一接入公共文件。用户已确认公共命令/查询与独立面板/页面两个测试接缝。实际使用CODEX执行位，未调用或冒称KIMI。

- C0：`solution-workflow/versions.ts`、`solution-migration/index.ts`、`management-statistics.ts`、`features/management-board-charts.ts`及各对应测试；公共Store/G1/目录接线、事项注册、顶栏宽度修复。
- C1：`lifecycle-progress/index.ts`、`progress-panel.ts`、`budget-comparison.ts`、`features/budget-expense-panel.ts`；接入e1b6be8。`budget-demo-expenses.ts`从原K02归属明确移交C1/CODEX，接入2c251a2，不改变费用来源业务含义。
- C2：`management-board/index.ts`、`features/project-board.ts/scss`、`shared/v9-design-tokens.scss`及对应测试/浏览器脚本；接入89d1a44/073c84c。主页面集成后写权交C0。
- 报价目录整票02-01/02/03由C0移交独立CODEX：`crm-quote-demo-catalog.ts`、`crm-quote.ts`、`crm-quote-demo-policy.ts`、对应测试及资料盘点；接入75038c3后写权交C0。
- `project-detail.ts/html`与`solution-workspace.ts`的独立进度/预算面板接线在C1/C2交付后由C0执行；后续业务工作包继续遵守原唯一归属。
- `SolutionOutputVersion.supersedesVersionId`为可选向后兼容字段，04-01输出替代关系；P1/P2后续接入真实上传时消费。现有样例不必回填。

## B03 CODEX独占范围（2026-10-17）

本轮用户限定完全由CODEX承担的票。C0统一持有本轮写权：

- 09-02/03：`core/management-board/index.ts`、`priorities.ts`、`view-state.ts`、`features/project-board.ts/scss`、对应公开查询/视图测试及浏览器脚本。
- 10-03：`features/management-board-charts.ts/scss`。父页统一生成统计/预算展示输入；子组件仅发意图。公共`v9-contracts.ts`新增向后兼容可选筛选/异常上下文字段，由C0发布；旧消费者不必补填。
- 14-01/04：`features/project-detail.ts/html`、`project-plan-visual.scss`。不领取其他三类计划页的完整改造，不改Store完成门禁。
- 下钻接线：`features/quote-workspace.ts`、`sales-detail.ts`、`solution-workspace.ts`仅增加登记的看板返回路径；报价业务及方案资料规则保持原归属。
- 04-04等待03-01，未改动`solution-workflow/versions.ts`或方案Blob设施。CODEX＋KIMI合作票未领取、未代做；GitHub只读，不认领、评论或关票。

## B04 CODEX范围（2026-10-17）

本轮基点`4b4cb16`，继续当前`integration/v9-b01`。C0/CODEX唯一写入：`solution-workflow/finalization.ts`、`quote-basis.ts`、`reclaim.ts`、现有`files.ts/upload.ts`；`solution-migration/workspace.ts`；`lifecycle-progress/applicability.ts/index.ts`；本轮页面、测试和浏览器证据。公共Store、契约、查询由同一C0接入。未改KIMI数据目录、KIMI固定脚本或独立绑定交付文件。

- `finalizeSolution`新增必传`scheduleRevision`，防止旧期限摘要确认；实际消费者是新CODEX公开测试、`SolutionInputPanel.confirmFinalization`适配入口，后续K15确认控件须传查询返回的revision。原独立样例未调用此命令，不必回填。
- 真实需求修订从商机读取。模拟事件仍保留原模拟身份，未把seed当实际确认。
- CODEX提供`SolutionFinalizationSummary`阅读骨架、公开来源查询与`confirmFinalization`回调入口；K15首次/重新定稿确认表单、K12专属恢复文案绑定、K17指定原因/历史/错误子控件及K29固定用例扩写继续留待KIMI。本轮来源页由CODEX接入公开任务/免做命令，不冒称KIMI已交付。
- 迁移先消费04纯转换，再合并旧历史到真实工作区，遇身份冲突拒绝。为保留核价/五可及原报价消费者，原集合暂作兼容源保留；后续15-02继续处理续接/重开和兼容写入收敛，本票不删除事实或改变旧价格。

## B04 K12由C0接入（2026-10-17）

用户在K12检查后要求继续。基点`support/v9-b04-kimi@5d7baf0`，C0/CODEX在当前分支完成`features/solution-input-panel.ts/html`导入/注册/挂载，并接收`features/solution-output-upload.ts`本轮集成修正写权（K12交付 → C0，提交`57cb22d`）。只修K12状态/权限/上下文反馈，不改K15/K17或回收规则；浏览器20组、回收2项、类型/构建及双轴审查结果见根目录`docs/verification/v9-b04-k12-integration/`。K15/K17后续接收结论见本文件最终验收段。


## B04 最终验收与写权接收（2026-10-17）

- K12控件及父页由C0持有；K12实际浏览器20组重放通过。
- K15 `features/solution-finalization-summary.ts`由K15交付后交C0/CODEX接收，本轮`4aac1ce`补齐确认快照、上海时间显示、切源清理和异步结果隔离，实际浏览器验证通过。
- K17 `features/progress-mapping-panel.ts`、`features/node-applicability-panel.ts`限定绑定已交付并经C0复核；原因、格式化错误、历史、保存失败/重试、免做/撤销和切项目保护通过。上述两个文件后续唯一写权交C0，不再由K17与C0并写。业务规则保持CODEX归属。
- K29四组固定预期由CODEX结合公开测试和实际浏览器独立判定；没有将KIMI日志整理等同CODEX验收。
- B04十五票范围验收通过，遗留验收待办为0。证据见`docs/verification/v9-b04-acceptance/README.md`；保留3项既有全量失败，B05–B08和74项联合交付尚未执行。

## B05 CODEX范围与接口交接（2026-10-17）

基点`b76da15`，实现`e534577`，审查修复`1c221d5`。仅第五批CODEX职责；本轮未调用KIMI。

- C0/CODEX唯一写入：`core/store.ts`、`v4.ts`、`v9-contracts.ts`、`lifecycle-progress/facts.ts`、`solution-workflow/business-records.ts/presentation.ts/finalization.ts/quote-basis.ts`，对应方案与报价父页/阅读控件及本轮公开测试、浏览器脚本。
- `SolutionWorkspace.businessRecords`为可选兼容字段；新核价、五可、TIC写入统一工作区，旧集合保留只读。`selectSolutionBusinessRecords`及`selectBusinessConfirmation`是现有Store/进度事实消费者的共享查询；不生成事实。
- `selectFinalizationSource`与`selectQuoteSolutionBasis`增加可选目标上下文；后者`submitIssues`只表达版本/需求/归属业务阻断，新增可选`fileIssues`表达物理异常。现有调用兼容；实际页面已消费，公开命令与页面业务判断一致。新定稿/新采用仍核验Blob。
- K16按本批绑定委派由KIMI修改`src/app/core/lifecycle-progress/progress-panel.ts`：显示`selectLifecycleProgress`每节点精确分数（numerator/denominator），保留既有状态、原因和sourceHref定位链，不另算权重。该交付已由CODEX复核，合入后该文件唯一写权归C1/CODEX。K23固定脚本与K32格式化脚本分别为`scripts/acceptance-v9-workspace-reentry.mjs`、`scripts/report-v9-migration-comparison.mjs`，均已交付并由CODEX判定。
- K23可按公开`takeOverEditing/resumeWorkspace/reset`及已提交状态查询消费：同业务历史在刷新/接管/续接保持；重开新round且无旧上传/定稿/事件；失败不部分发布。K32只格式化CODEX已给出的恢复隔离结果。原分工、预算和依赖不变。
- 证据入口：根目录`docs/verification/v9-b05-codex/README.md`及`docs/verification/v9-b05-kimi/README.md`。第五批六票的票内职责已完成；B06–B08未领取。是否关闭GitHub issue由集成后的外部跟踪流程处理。

## B06 CODEX独占范围（2026-10-17）

基点`202129d`，继续`integration/v9-b01`。仅09-04/#173、10-04/#176、12-02/#177，KIMI零工时。C0/CODEX唯一持有`management-board/index.ts`、`budget-comparison.ts`（费用未知值修正）、`features/project-board.ts/scss`、`management-board-charts.ts/scss`、对应公开测试及本轮浏览器脚本和证据。真实查询默认接线消费已有P1/P2/P4/P5公开接口，不复制日期、计分或预算算法。未改KIMI数据或固定脚本。
