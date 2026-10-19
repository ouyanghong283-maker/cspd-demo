/**
 * Source-backed inventory for the contract (alp_contract) field definitions.
 * Planned paths are transcribed evidence and do not assert current UI support.
 */
export type ContractFieldClassification = 'business' | 'readOnly' | 'technical';

export type ContractFieldSourceCategory =
  | '业务字段'
  | '业务状态'
  | '只读业务字段'
  | '派生/伴随字段'
  | '系统字段'
  | '本地主键/来源标识';

export type ContractFieldReviewFlag =
  | '映射及保存规则含未决说明'
  | '当前表单必填运行时证据未取到'
  | '字典或选项证据含未决说明'
  | 'CSPD必填口径含未决说明';

export interface ContractFieldSourceValues {
  mappingRule: string;
  formRequired: string;
  dictionaryRaw: string;
  cspdRequiredHandling: string;
}

export interface ContractFieldMapping {
  mappingId: string;
  entity: 'alp_contract';
  entityLabel: string;
  logicalName: string;
  label: string;
  crmType: string;
  sourceCategory: ContractFieldSourceCategory;
  classification: ContractFieldClassification;
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
  reviewFlags: ContractFieldReviewFlag[];
}

const SOURCE_CATEGORY_CLASS: Readonly<Record<ContractFieldSourceCategory, ContractFieldClassification>> = {
  业务字段: 'business',
  业务状态: 'business',
  只读业务字段: 'readOnly',
  '派生/伴随字段': 'readOnly',
  系统字段: 'technical',
  '本地主键/来源标识': 'technical',
};

export function classifyContractField(sourceCategory: string): ContractFieldClassification {
  const classification = SOURCE_CATEGORY_CLASS[sourceCategory as ContractFieldSourceCategory];
  if (!classification) throw new Error(`合同字段来源分类未配置：${sourceCategory}`);
  return classification;
}

/** Flags source rows with explicit unresolved wording, without resolving it by inference. */
export function contractFieldReviewFlags(
  source: ContractFieldSourceValues,
): ContractFieldReviewFlag[] {
  const flags: ContractFieldReviewFlag[] = [];
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
