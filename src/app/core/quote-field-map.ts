/**
 * Source-backed inventory for the quote and quotedetail CRM field definitions.
 * This catalogue records planned local destinations; it does not assert that
 * each destination is already implemented in the demo.
 */
export type QuoteFieldClassification = 'business' | 'readOnly' | 'technical';

export type QuoteFieldSourceCategory =
  | '业务字段'
  | '业务状态'
  | '只读业务字段'
  | '派生/伴随字段'
  | '系统字段'
  | '本地主键/来源标识';

export type QuoteFieldReviewFlag =
  | '映射及保存规则含未决说明'
  | '当前表单必填运行时证据未取到'
  | '字典或选项证据含未决说明'
  | 'CSPD必填口径含未决说明';

export interface QuoteFieldSourceValues {
  sourceCategory: string;
  mappingRule: string;
  formRequired: string;
  dictionaryRaw: string;
  cspdRequiredHandling: string;
}

export interface QuoteFieldMapping {
  mappingId: string;
  entity: 'quote' | 'quotedetail';
  entityLabel: string;
  logicalName: string;
  label: string;
  crmType: string;
  sourceCategory: QuoteFieldSourceCategory;
  classification: QuoteFieldClassification;
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
  reviewFlags: QuoteFieldReviewFlag[];
}

const SOURCE_CATEGORY_CLASS: Readonly<Record<QuoteFieldSourceCategory, QuoteFieldClassification>> = {
  业务字段: 'business',
  业务状态: 'business',
  只读业务字段: 'readOnly',
  '派生/伴随字段': 'readOnly',
  系统字段: 'technical',
  '本地主键/来源标识': 'technical',
};

export function classifyQuoteField(sourceCategory: string): QuoteFieldClassification {
  const classification = SOURCE_CATEGORY_CLASS[sourceCategory as QuoteFieldSourceCategory];
  if (!classification) throw new Error(`报价字段来源分类未配置：${sourceCategory}`);
  return classification;
}

/**
 * Flags only explicit unresolved source wording. A flag describes the evidence,
 * not a guessed resolution or an assertion that the local form is incomplete.
 */
export function quoteFieldReviewFlags(source: QuoteFieldSourceValues): QuoteFieldReviewFlag[] {
  const flags: QuoteFieldReviewFlag[] = [];
  if (
    ['待核验', '待核对', '待确认', '待明确', '未知', '未提供'].some((term) =>
      source.mappingRule.includes(term),
    )
  ) {
    flags.push('映射及保存规则含未决说明');
  }
  if (source.formRequired === '未取到当前运行时值') {
    flags.push('当前表单必填运行时证据未取到');
  }
  if (['未知', '待核', '缺少', '未提供'].some((term) => source.dictionaryRaw.includes(term))) {
    flags.push('字典或选项证据含未决说明');
  }
  if (['待核', '未核', '待确认', '未明确'].some((term) => source.cspdRequiredHandling.includes(term))) {
    flags.push('CSPD必填口径含未决说明');
  }
  return flags;
}
