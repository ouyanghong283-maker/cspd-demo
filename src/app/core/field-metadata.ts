export type QuoteExtensionValue = string | number | boolean | null;
export type QuoteExtensionKind = 'text' | 'number' | 'date' | 'enum' | 'lookup' | 'readonly';

export interface QuoteExtensionOption {
  rawValue: string | number;
  label: string;
  id?: string;
  source?: 'local' | 'simulated';
}

export interface QuoteExtensionFieldDefinition {
  entity: 'quote';
  logicalName: string;
  label: string;
  valuePath: string;
  group: string;
  department: string;
  kind: QuoteExtensionKind;
  dataClass: 'business' | 'system' | 'derived';
  crmType: string;
  crmRequiredLevel: 'none' | 'ApplicationRequired' | 'SystemRequired';
  cspdRequired: {
    status: 'required' | 'optional' | 'unverified';
    sourceRecordIds: string[];
    rationale: string;
  };
  sourceEvidence: string;
  options?: QuoteExtensionOption[];
  lookupTarget?: string;
  readOnlyReason?: string;
  semanticsNote?: string;
}

const CRM_FIELD_SOURCE = 'doc/PRD/DEMO PRD/V7PRD/附件/01_标准CRM全量字段去向.csv';
const QUOTE_CSPD_SOURCE = 'doc/PRD/DEMO PRD/V7PRD/附件/04_CSPD参考表逐项来源.csv';
const NO_FIELD_LEVEL_REQUIREMENT = {
  status: 'unverified' as const,
  sourceRecordIds: ['recvw2iP8evpWW', 'recvw2iP8eQSGC'],
  rationale: 'CSPD 参考确认报价聚合与版本控制，不据此推断此细字段必填。',
};

/** Offline field evidence only; this metadata does not connect to Dynamics CRM. */
export const QUOTE_EXTENSION_FIELDS: readonly QuoteExtensionFieldDefinition[] = [
  {
    entity: 'quote',
    logicalName: 'alp_approvedad',
    label: '审批意见',
    valuePath: 'QuoteVersion.crmFields.alp_approvedad',
    group: '报价基本信息',
    department: '销售',
    kind: 'text',
    dataClass: 'business',
    crmType: 'Memo',
    crmRequiredLevel: 'none',
    cspdRequired: NO_FIELD_LEVEL_REQUIREMENT,
    sourceEvidence: `${CRM_FIELD_SOURCE}:5; ${QUOTE_CSPD_SOURCE}:99-100`,
    semanticsNote: '本地草稿中的演示字段；不表示已发生真实审批。',
  },
  {
    entity: 'quote',
    logicalName: 'alp_purchasedamount',
    label: '产品数量',
    valuePath: 'QuoteVersion.crmFields.alp_purchasedamount',
    group: '报价基本信息',
    department: '销售',
    kind: 'number',
    dataClass: 'business',
    crmType: 'Decimal',
    crmRequiredLevel: 'none',
    cspdRequired: NO_FIELD_LEVEL_REQUIREMENT,
    sourceEvidence: `${CRM_FIELD_SOURCE}:36; ${QUOTE_CSPD_SOURCE}:99-100`,
    semanticsNote: '来源未提供精度、小数位或单位规则，不额外限制或换算。',
  },
  {
    entity: 'quote',
    logicalName: 'alp_deliverydate',
    label: '期望交期',
    valuePath: 'QuoteVersion.crmFields.alp_deliverydate',
    group: '报价基本信息',
    department: '销售',
    kind: 'date',
    dataClass: 'business',
    crmType: 'DateTime',
    crmRequiredLevel: 'none',
    cspdRequired: NO_FIELD_LEVEL_REQUIREMENT,
    sourceEvidence: `${CRM_FIELD_SOURCE}:16; ${QUOTE_CSPD_SOURCE}:99-100`,
    semanticsNote: '本地控件保留 YYYY-MM-DD；DateTime 时区及时间部分映射待核。',
  },
  {
    entity: 'quote',
    logicalName: 'alp_producttype',
    label: '产品类型',
    valuePath: 'QuoteVersion.crmFields.alp_producttype',
    group: '报价基本信息',
    department: '销售',
    kind: 'enum',
    dataClass: 'business',
    crmType: 'Picklist',
    crmRequiredLevel: 'none',
    cspdRequired: NO_FIELD_LEVEL_REQUIREMENT,
    sourceEvidence: `${CRM_FIELD_SOURCE}:34; doc/PRD/DEMO PRD/V7PRD/附件/03_枚举与关联字典.json:122`,
    options: [
      { rawValue: 10, label: '系统级产品' },
      { rawValue: 20, label: '电池' },
      { rawValue: 30, label: '逆变器' },
      { rawValue: 40, label: '其他' },
    ],
    semanticsNote: '保存CRM字典原值10/20/30/40，不只保存显示文案。',
  },
  {
    entity: 'quote',
    logicalName: 'alp_paymenttermsid',
    label: '支付条款',
    valuePath: 'QuoteVersion.crmFields.alp_paymenttermsid',
    group: '报价基本信息',
    department: '销售',
    kind: 'lookup',
    dataClass: 'business',
    crmType: 'Lookup',
    crmRequiredLevel: 'ApplicationRequired',
    cspdRequired: NO_FIELD_LEVEL_REQUIREMENT,
    sourceEvidence: `${CRM_FIELD_SOURCE}:29; doc/PRD/DEMO PRD/V7PRD/附件/03_枚举与关联字典.json:106`,
    lookupTarget: 'alp_paymentterms',
    options: [
      {
        rawValue: 'DEMO-PAYTERM-NET30',
        id: 'DEMO-PAYTERM-NET30',
        label: '净30天（演示引用）',
        source: 'simulated',
      },
      {
        rawValue: 'DEMO-PAYTERM-MILESTONE',
        id: 'DEMO-PAYTERM-MILESTONE',
        label: '里程碑付款（演示引用）',
        source: 'simulated',
      },
    ],
    semanticsNote: '当前无本地支付条款字典记录；选项为明确标注的模拟稳定ID。',
  },
  {
    entity: 'quote',
    logicalName: 'alp_quotetotalamount',
    label: '报价单总金额（含税含运费）',
    valuePath: 'QuoteVersion.crmReadOnly.quote.alp_quotetotalamount',
    group: '只读来源字段',
    department: '销售',
    kind: 'readonly',
    dataClass: 'derived',
    crmType: 'Decimal',
    crmRequiredLevel: 'none',
    cspdRequired: NO_FIELD_LEVEL_REQUIREMENT,
    sourceEvidence: `${CRM_FIELD_SOURCE}:42; ${QUOTE_CSPD_SOURCE}:99-100`,
    readOnlyReason: '来源未提供运行时值；不能拿本地演示总价冒充标准CRM字段值。',
  },
  {
    entity: 'quote',
    logicalName: 'versionnumber',
    label: '标准CRM版本号',
    valuePath: 'QuoteVersion.systemFields.versionnumber',
    group: '只读来源字段',
    department: '销售',
    kind: 'readonly',
    dataClass: 'system',
    crmType: 'BigInt',
    crmRequiredLevel: 'none',
    cspdRequired: NO_FIELD_LEVEL_REQUIREMENT,
    sourceEvidence: `${CRM_FIELD_SOURCE}:196`,
    readOnlyReason: '标准CRM源值未提供；本地数据版本不能代替远端版本号。',
  },
];

const writableFields = new Map(
  QUOTE_EXTENSION_FIELDS.filter((field) => field.kind !== 'readonly').map((field) => [
    field.logicalName,
    field,
  ]),
);

export function quoteExtensionFieldError(
  values: Record<string, QuoteExtensionValue> | undefined,
): string | undefined {
  for (const [logicalName, value] of Object.entries(values || {})) {
    const field = writableFields.get(logicalName);
    if (!field) {
      if (QUOTE_EXTENSION_FIELDS.some((candidate) => candidate.logicalName === logicalName))
        return `${logicalName} 是只读来源字段，不能保存为人工输入`;
      return `报价扩展字段未知：${logicalName}`;
    }
    if (value === null) continue;
    if (field.kind === 'text' && typeof value !== 'string')
      return `${field.label}必须是文本`;
    if (field.kind === 'number' && (typeof value !== 'number' || !Number.isFinite(value)))
      return `${field.label}必须是有限数值`;
    if (field.kind === 'date' && !isValidDate(value))
      return `${field.label}必须是有效日期（YYYY-MM-DD）`;
    if (field.kind === 'enum' && !field.options?.some((option) => Object.is(option.rawValue, value)))
      return `${field.label}必须保留有效枚举原值`;
    if (
      field.kind === 'lookup' &&
      !field.options?.some((option) => option.id === value && option.source === 'simulated')
    )
      return `${field.label}必须选择来源明确的稳定ID`;
  }
  return undefined;
}

function isValidDate(value: QuoteExtensionValue): boolean {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}
