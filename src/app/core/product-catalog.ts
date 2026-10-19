import { ProductCatalogItem } from './models';
// 模拟产品目录。字段结构按非标CRM（飞书多维表格·JP站点）产品管理表（tbl4XwraJn82PQqK，2026-10-15 实读）口径：
// 产品编码、产品名称、产品类型、产品状态、销售价格、成本价格。
// 记录内容为模拟数据——非标CRM 产品管理表当前 0 条记录，待正式主数据确认后替换。
// 产品类型选项（传感器/核心处理部件/发射接收部件/辅助设备/其他）已写入 CSPD 必填内容确认表
// 序号 189（记录 reczz28NWf8llm1L，2026-10-15），确认✓未勾，待关键用户确认是否适用于储能产品线。
// 产品类型为模拟映射（电池舱/一体柜/PCS/EMS/BMS → 核心处理部件，变压器 → 辅助设备），待非标CRM 正式记录确认。
// 未采用的非标CRM 字段及原因：产品图片、推广文案与销售话术（demo 演示不需要）；库存数量（demo 不做库存）；
// 上架/下架/查看详情按钮与创建时间/创建人（非标CRM 操作与审计字段，demo 不模拟）。
export const PRODUCT_CATALOG: ProductCatalogItem[] = [
  {
    code: 'ALPHA-BC-3440',
    name: '液冷磷酸铁锂电池舱 3.44MWh',
    type: '核心处理部件',
    status: '上架',
    salePrice: 2680000,
    costPrice: 2150000,
  },
  {
    code: 'ALPHA-BC-5015',
    name: '液冷磷酸铁锂电池舱 5.015MWh',
    type: '核心处理部件',
    status: '上架',
    salePrice: 3850000,
    costPrice: 3090000,
  },
  {
    code: 'ALPHA-CB-215',
    name: '工商业液冷储能一体柜 215kWh',
    type: '核心处理部件',
    status: '上架',
    salePrice: 298000,
    costPrice: 236000,
  },
  {
    code: 'ALPHA-PCS-1250',
    name: '储能变流器 1250kW',
    type: '核心处理部件',
    status: '上架',
    salePrice: 385000,
    costPrice: 302000,
  },
  {
    code: 'ALPHA-PCS-2500',
    name: '储能变流升压一体机 2500kW',
    type: '核心处理部件',
    status: '上架',
    salePrice: 728000,
    costPrice: 575000,
  },
  {
    code: 'ALPHA-EMS-1000',
    name: '能量管理系统 EMS',
    type: '核心处理部件',
    status: '上架',
    salePrice: 460000,
    costPrice: 318000,
  },
  {
    code: 'ALPHA-BMS-200',
    name: '电池管理系统 BMS（簇级）',
    type: '核心处理部件',
    status: '上架',
    salePrice: 68000,
    costPrice: 47500,
  },
  {
    code: 'ALPHA-TR-3150',
    name: '干式变压器 3150kVA',
    type: '辅助设备',
    status: '上架',
    salePrice: 356000,
    costPrice: 289000,
  },
  {
    code: 'ALPHA-PCS-800',
    name: '储能变流器 800kW（旧款）',
    type: '核心处理部件',
    status: '下架',
    salePrice: 256000,
    costPrice: 201000,
  },
];
export function productCatalogItem(code: string): ProductCatalogItem | undefined {
  return PRODUCT_CATALOG.find((item) => item.code === code);
}
/** 录入下拉只提供上架产品。 */
export function selectableProducts(): ProductCatalogItem[] {
  return PRODUCT_CATALOG.filter((item) => item.status === '上架');
}
