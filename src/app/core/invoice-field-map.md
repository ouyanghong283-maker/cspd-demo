# 发票字段来源映射

`invoice-field-map.json` 逐字段记录标准CRM系统（Dynamics）发票定义：实体和逻辑名、原始分类、来源对象/路径/CSPD处理/映射规则原文、当前拟定 ContractInvoice 对象与路径、维护归属、编辑规则、必填原文、枚举/关联线索、来源文件和源行号；主表单定位同时保留定位 CSV 的行号。它是来源证据清单，不表示字段已经进入业务页面或 Store。

## 来源口径

- 全量字段及拟定去向：`doc/PRD/DEMO PRD/V7PRD/附件/01_标准CRM全量字段去向.csv`
- 主表单字段定位：`doc/PRD/DEMO PRD/V7PRD/附件/02_当前主表单字段定位.csv`
- 实体计数说明：`doc/PRD/DEMO PRD/V7PRD/附件/README.md`
- #31 验收：GitHub issue `ouyanghong283-maker/DEMO-CSPD#31` 及本地 `.scratch/cspd-v7-spec/issues/12-合同发票与统一余额到期展示.md`

全量字段 CSV 中实体 `invoice`（发票）共 144 行、144 个唯一逻辑字段，与 README 的字段定义数一致。按来源原分类归并后为 `business` 66 条（业务字段 63、业务状态 3）、`readOnly` 59 条（只读业务字段 7、派生/伴随字段 52）、`technical` 19 条（系统字段 18、本地主键/来源标识 1）。原始分类仍逐字段保留。

README 标注发票主表单 27 个字段；定位 CSV 对 `invoice` 实际记录 23 行、23 个唯一逻辑字段。本清单照录 02 CSV 的 23 个定位行及来源行号，不补造缺失的 4 个字段，也不将 README 统计改写成已对齐。

来源对象/路径、CSPD必填处理和映射规则原文分别保存在 `sourceTargetObject`、`sourceTargetPath`、`sourceCspdRequiredHandling`、`sourceMappingRule`。当前目标路径使用 `ContractInvoice` 而非来源CSV中的旧 `Invoice（迁移FinanceInvoice）`；对原文中“CRM原值”的标准Dynamics轨别澄清，也保留未改写原文。拟定处理值与源原文分开保存。`reviewFlags` 只指出原文明确写出的待核或证据缺失；原文仍保留在对应属性中。没有未决标记不代表已实现或已核实。逐项测试以 01/02 两份 CSV 核对覆盖数、路径、类别、原文、来源行及表单定位行。

拟定目标已从旧项目快照 `FinanceInvoice` 调整为合同所有的 `ContractInvoice`；旧项目页面仅保留引用。到期优先级、预计/实际节点区别、跨项目按发票ID去重、分币种汇总、分币比较及负余额状态由 `core/invoices.ts` 提供纯函数契约。认领与历史模拟累计来源通过 `cumulativeSource` 明确区分，具体认领实体由后续水单模块提供。本映射仍是标准CRM系统字段证据与拟定路径，不代表144项均已在页面逐项编辑或验证；CSPD必填、当前运行时必填和来源未决项继续按逐行 `reviewFlags` 待核。
