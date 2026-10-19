/** Source-backed field inventory for payment terms and payment methods. */
export type PaymentFieldClassification = 'business' | 'readOnly' | 'technical';

export type PaymentFieldSourceCategory =
  | "业务字段"
  | "业务状态"
  | "只读业务字段"
  | "派生/伴随字段"
  | "系统字段"
  | "本地主键/来源标识";

export interface PaymentFieldUnresolvedSource {
  sourceColumn: string;
  raw: string;
}

export interface PaymentFieldMapping {
  mappingId: string;
  entity: 'alp_paymentterms' | 'alp_framework_protocol';
  entityLabel: string;
  logicalName: string;
  label: string;
  crmType: string;
  sourceCategory: PaymentFieldSourceCategory;
  classification: PaymentFieldClassification;
  department: string;
  tab: string;
  fieldGroup: string;
  targetObject: string;
  targetPath: string;
  editability: string;
  onCurrentMainForm: string;
  formName: string;
  controlLabel: string;
  crmRequired: string;
  formRequired: string;
  cspdRequiredHandling: string;
  dictionaryRaw: string;
  lookupTarget: string;
  companionSourceField: string;
  mappingRule: string;
  evidenceFiles: string;
  sourceFile: string;
  sourceLine: number;
  formEvidenceFile: string;
  formEvidenceLines: number[];
  unresolvedRaw: PaymentFieldUnresolvedSource[];
}

const SOURCE_CATEGORY_CLASS: Readonly<Record<PaymentFieldSourceCategory, PaymentFieldClassification>> = {
  '业务字段': 'business',
  '业务状态': 'business',
  '只读业务字段': 'readOnly',
  '派生/伴随字段': 'readOnly',
  '系统字段': 'technical',
  '本地主键/来源标识': 'technical',
};

export function classifyPaymentField(sourceCategory: string): PaymentFieldClassification {
  const classification = SOURCE_CATEGORY_CLASS[sourceCategory as PaymentFieldSourceCategory];
  if (!classification) throw new Error(`支付字段来源分类未配置：${sourceCategory}`);
  return classification;
}

/** Terms are copied as source text; this helper never resolves their meaning. */
export function paymentFieldUnresolvedRaw(
  source: Readonly<Record<string, string>>,
): PaymentFieldUnresolvedSource[] {
  const terms = ['待核验', '待核对', '待确认', '待明确', '未知', '未提供', '待核', '缺少', '未取到', '未明确'];
  const columns = ['映射及保存规则', '当前表单必填', '字典值及原标签', 'CSPD必填处理'];
  return columns.flatMap((sourceColumn) => {
    const raw = source[sourceColumn] || '';
    return raw && terms.some((term) => raw.includes(term)) ? [{ sourceColumn, raw }] : [];
  });
}
