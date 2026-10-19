# 水单认领字段来源映射

`remittance-field-map.json` 逐字段保留标准 Dynamics CRM 水单认领与水单认领明细的 113 条定义（60 + 53），包括字段类型、原始分类、拟定本地对象及路径、维护位置、编辑规则、必填原文、字典/Lookup 目标、来源行和表单定位行。它是来源清单，不代表字段都已进入页面或持久化。

## 证据与关联边界

- 全量定义与拟定去向：`doc/PRD/DEMO PRD/V7PRD/附件/01_标准CRM全量字段去向.csv`
- 主表单字段定位：`doc/PRD/DEMO PRD/V7PRD/附件/02_当前主表单字段定位.csv`
- 运行时只读取证：`doc/字段资料/V7_CRM只读取证/alp_claim_water_bill-runtime.json`、`alp_water_bill_claim_details-runtime.json`
- Lookup 类型与目标：`doc/字段资料/V7_CRM只读取证/enums-lookups.json`
- 业务和金额口径：V7 `06_CRM字段映射与保存PRD.md`、`07_合同管理与项目启动PRD.md`

运行时表单与 Lookup 证据表明 `alp_water_bill_claim_details.alp_invoice_code` 是指向水单头 `alp_claim_water_bill` 的 Lookup；`alp_order_id` 指向销售订单 `salesorder`。因此 CRM 的 `alp_invoice_code` 不能解释为发票关联。纯函数允许本地明细另带一个显式稳定 `invoiceId`，只有订单与发票都存在、属于同一合同且币种一致时，才投影为发票回款认领。未提供该 ID 时，明细仍可独立关联订单，不会猜发票。

本地水单头增加 `contractId` 作为合同财务入口的明确归属，并以 `number` 展示演示水单编号；该编号不是实际银行流水号。订单行需属于水单头合同，避免把跨合同订单认领到同一张水单。

`reviewFlags` 只标出来源文字明确的待核项；没有标记不表示已实现或验收通过。分类和所有源文本都由逐项单测与两份 CSV 对照。
