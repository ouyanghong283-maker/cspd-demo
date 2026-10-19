import type { SolutionWorkspace, SolutionLegacyAlias, OpportunityG1Check, ProgressGroupMapping, ProgressNodeApplicability, BudgetDemoExpense, BudgetComparisonSource, QuoteSolutionBasis, V9CommandReceipt } from './v9-contracts';
export type Role =
  | 'sales'
  | 'assistant'
  | 'manager'
  | 'pmo'
  | 'solution'
  | 'pm'
  | 'opm'
  | 'quality'
  | 'finance'
  | 'receiver'
  | 'member'
  | 'outsider'
  | 'spare';
export const ROLES: { id: Role; name: string; person: string; description: string }[] = [
  { id: 'sales', name: '销售', person: '张销售', description: '登记需求、推进商机和客户跟进' },
  {
    id: 'assistant',
    name: '销售助理',
    person: '林助理',
    description: '代填资料，业务负责人保持不变',
  },
  {
    id: 'manager',
    name: '销售主管',
    person: '赵主管',
    description: '查看管道、预测和定向跟进提醒',
  },
  {
    id: 'pmo',
    name: '部门负责人 / PMO',
    person: '李负责人',
    description: '指定团队、查看模拟交底结果',
  },
  { id: 'solution', name: '解决方案', person: '周方案', description: '确认参与并补充方案资料' },
  { id: 'pm', name: '项目经理', person: '王项目', description: '启动项目、维护计划、验收和移交' },
  { id: 'opm', name: 'OPM / 物控', person: '陈物控', description: '维护要货批次和交期' },
  {
    id: 'quality',
    name: 'FAT / 质量',
    person: '夏质量',
    description: '维护测试计划、报告和执行结果',
  },
  {
    id: 'finance',
    name: '财务 / SaO',
    person: '黄财务',
    description: '查看开票计划和模拟实际回款',
  },
  {
    id: 'receiver',
    name: '运维 / 移交接收方',
    person: '吴运维',
    description: '参与投标协作、接收项目资料',
  },
  { id: 'spare', name: '备件订单专员', person: '郑备件', description: '接收备件清单与需求日期' },
  { id: 'member', name: '计划责任人', person: '刘工程师', description: '更新分配给自己的项目任务' },
  { id: 'outsider', name: '非项目成员', person: '访客', description: '只查看公开项目概况' },
];
export const STAGES = ['意向沟通', '方案报价', '洽谈', '合同谈判', '赢单', '丢单'] as const;
export type Stage = (typeof STAGES)[number];
export type CrmLeadStatus = '未分配' | '已分配' | '已转客户' | '已转商机' | '无效线索' | '退回公海';
export type CrmLeadSource = '市场活动' | '官网咨询' | '客户推荐' | '中间人' | '自有开发';
/** CRM 双轨口径（根 AGENTS.md 与 docs/adr/0002）：标准CRM=Dynamics（集团级、只读参照、竞品主数据 alp_competitor）；非标CRM=飞书多维表格（本项目主源）。 */
export type CrmSystemKind = 'standard' | 'nonStandard';
export const CRM_SYSTEM_KIND_LABELS: Record<CrmSystemKind, string> = {
  standard: '标准CRM系统（Dynamics·只读参照）',
  nonStandard: '非标CRM系统（飞书多维表格·JP站点）',
};
export type LeadFollowUpStatus = '跟进中' | '暂缓跟进' | '已归档';
export const BASE_DATE = '2026-10-10';
export const PLAN_TYPES = [
  '内部WBS',
  '客户主节点',
  '产研来源',
  '要货发货',
  '调试备件',
  'FAT测试',
  '开票回款',
] as const;
export type PlanType = (typeof PLAN_TYPES)[number];
export interface Contact {
  id: string;
  name: string;
  title: string;
  department: string;
  position: string;
  phone: string;
  email: string;
  /** Sales-entered purchasing role; never inferred from title or position. */
  purchasingRole?: string;
}
export interface Customer {
  id: string;
  name: string;
  shortName: string;
  country: string;
  email?: string;
  region?: string;
  status?: string;
  owner?: string;
  employeeSize?: string;
  basicInfo?: string;
  createdAt?: string;
  createdBy?: string;
  industry: string;
  address: string;
  contacts: Contact[];
}
export interface TeamMember {
  id: string;
  /** Stable demo identity; independent of this membership's display name and department. */
  personId?: string;
  role: Role;
  person: string;
  department: string;
  window: string;
  confirmed: boolean;
  confirmedBy: string;
}
export interface CustomerRole {
  id: string;
  contact: string;
  role: string;
  attitude: string;
  impact: string;
}
export interface SalesRecord {
  id: string;
  type: 'lead' | 'opportunity';
  customerId: string;
  contactId: string;
  projectName: string;
  owner: string;
  ownerPersonId?: string;
  operator: string;
  operatorPersonId?: string;
  lastEditor?: string;
  lastEditorPersonId?: string;
  sourceOwner?: { source: 'CRM模拟样例'; id: string; name: string };
  sourceCreator?: { source: 'CRM模拟样例'; id: string; name: string };
  crmSnapshot?: {
    source: '非标CRM（飞书多维表格·JP站点）';
    snapshotDate: string;
    dateExamples?: { field: string; sourceValue: string; displayValue: string; note: string }[];
  };
  /** Read-only simulated CRM follow-up fields; these do not update CRM records. */
  crmFollowUpSnapshot?: CrmFollowUpSnapshot;
  crmQualityNotes?: string[];
  source: string;
  crmSource?: CrmLeadSource;
  legacySource?: string;
  sourceReviewRequired?: boolean;
  crmStatus?: CrmLeadStatus;
  legacyCrmStatus?: string;
  followUpStatus?: LeadFollowUpStatus;
  description: string;
  capacity: number;
  unit: string;
  /** 功率 (MW)，对应 CRM 商机管理表数字字段（2 位小数）。 */
  power?: number;
  /** 电芯需求，选项见 CELL_DEMAND_OPTIONS（CRM 商机管理表枚举）。 */
  cellDemand?: string;
  /** 所在区域，选项见 PROJECT_REGION_OPTIONS（CRM 商机管理表“项目地区”枚举）。 */
  projectRegion?: string;
  amount: number;
  currency: string;
  expectedDate: string;
  createdDate: string;
  convertedDate: string;
  stage: Stage;
  status: string;
  grade: string;
  tender: string;
  tradeTerm: string;
  /** 竞品主数据以标准CRM系统（Dynamics alp_competitor）为准；本版 Demo 不纳入竞品字段（CSPD 必填表序号22「不做」），此字段仅为兼容存量数据保留，不再在表单中展示。 */
  competitor: string;
  reason: string;
  closedDate: string;
  incomeDate: string;
  convertedTo: string;
  leadId: string;
  team: TeamMember[];
  customerRoles: CustomerRole[];
  g1: string;
  deliveryOpinion: string;
  resourceWindow: string;
  taxCase: string;
  taxNote: string;
  taxConfirmed: boolean;
  needsReview: boolean;
  quoteFlowMode?: 'legacy' | 'v2';
  /** Stable product demand rows; IDs survive reorder and display-name edits. */
  productNeeds?: ProductNeed[];
  productNeedRevision?: number;
  /** Optional for compatibility with persisted records created before revision history existed. */
  productNeedHistory?: ProductNeedRevisionSnapshot[];
  technicalAssessments?: TechnicalAssessment[];
  submittedAt?: string;
  submissionHistory?: string[];
  /** Optional simulated PMO assignment, created only after valid submission. */
  pmoAssignment?: PmoAssignment;
  /** Optional department work items; completion is tracked separately from participation. */
  departmentTasks?: DepartmentTask[];
  /** Whether the applicable collaboration departments were explicitly reviewed. */
  departmentScopeConfirmed?: boolean;
  /** Participant acknowledgements do not imply that a department task is complete. */
  departmentTaskConfirmations?: DepartmentTaskConfirmation[];
  conversionKind?: 'customer' | 'opportunity';
  customerCountryAtConversion?: string;
  customerCountrySnapshot?: string;
  customerProfileAtConversion?: {
    customerId: string;
    name: string;
    country: string;
    region?: string;
    email?: string;
    address?: string;
    basicInfo?: string;
    owner?: string;
    industry?: string;
    employeeSize?: string;
    status?: string;
  };
  customerCountryConfirmed?: string;
  opportunityRoughPlans?: OpportunityRoughPlan[];
}
export interface OpportunityRoughPlanTemplate {
  id: string;
  name: string;
  description: string;
  sourceFile: string;
  status: '启用' | '停用';
  tasks: OpportunityRoughPlanTemplateTask[];
}
export interface OpportunityRoughPlanTemplateTask {
  id: string;
  wbsCode: string;
  name: string;
  referenceOwner?: string;
  durationDays?: number;
  predecessor: string;
  relationNote: string;
  note: string;
}
export interface OpportunityRoughPlan {
  id: string;
  wbsCode?: string;
  name: string;
  owner: string;
  start: string;
  end: string;
  durationDays?: number;
  predecessor: string;
  relationNote: string;
  note: string;
  weekWindow: string;
  sourceReference: string;
  sourceType?: '自行制定' | '参考模板' | '客户要求';
  sourceTemplateId?: string;
  sourceTemplateTaskId?: string;
  sourceDetail?: string;
}
export interface ProductNeed {
  id: string;
  model: string;
  /** Product name carried from the catalog; optional because older persisted rows lack it. */
  name?: string;
  quantity: number;
  unit: string;
}
/** CRM 商机管理表“电芯需求”选项（doc/字段资料/10_CRM字段字典快照.md）。 */
export const CELL_DEMAND_OPTIONS = [
  'MB31',
  'EVE',
  '314B',
  'CALB',
  '314PRO',
  'REPT',
  'DS314',
  'DS',
  '无特殊需求',
  '长续航',
] as const;
/** CRM 商机管理表“项目地区”选项（doc/字段资料/10_CRM字段字典快照.md）。 */
export const PROJECT_REGION_OPTIONS = [
  'DACH',
  'CEE',
  'Baltics',
  'Iberia',
  'Nordics',
  'Ukraine',
  'Balkans',
  'Western Europe',
] as const;
/** CRM 产品管理表“产品类型”选项（2026-10-15 实读 CRM Base 产品管理表）。 */
export const PRODUCT_TYPES = [
  '传感器',
  '核心处理部件',
  '发射接收部件',
  '辅助设备',
  '其他',
] as const;
export type ProductType = (typeof PRODUCT_TYPES)[number];
/**
 * Product catalog entry aligned with the CRM 产品管理表 field set (read 2026-10-15);
 * records are simulated because the CRM table currently has no rows.
 */
export interface ProductCatalogItem {
  /** 产品编码，主键。 */
  code: string;
  /** 产品名称。 */
  name: string;
  /** 产品类型，仅限 CRM 五个选项。 */
  type: ProductType;
  /** 产品状态：上架 / 下架。 */
  status: '上架' | '下架';
  /** 销售价格。 */
  salePrice: number;
  /** 成本价格。 */
  costPrice: number;
}
/** A serializable snapshot of product demand at one revision; need IDs remain stable across edits. */
export interface ProductNeedRevisionSnapshot {
  revision: number;
  changedAt: string;
  changeDescription: string;
  operator: string;
  productNeeds: ProductNeed[];
}
/** Read-only values copied into the demo from a simulated CRM snapshot. */
export interface CrmFollowUpSnapshot {
  readonly source: 'CRM模拟样例';
  readonly snapshotDate: string;
  readonly followUpDate: string;
  readonly followUpCount: number;
  readonly daysSinceLastFollowUp: number;
}
/** Simulated PMO assignment data for a validly submitted opportunity. */
export interface PmoAssignment {
  pmId: string;
  pmName: string;
  window: string;
  assignedAt: string;
}
export interface DepartmentTask {
  id: string;
  department: string;
  name: string;
  status: '待开始' | '进行中' | '已完成';
  completedBy?: string;
  completedAt?: string;
}
/** Confirmation records are distinct from DepartmentTask.status === '已完成'. */
export interface DepartmentTaskConfirmation {
  department: string;
  personId: string;
  personName: string;
  confirmedAt: string;
}
export interface TechnicalAssessment {
  id: string;
  result: '满足' | '不满足' | '待补资料';
  requirementRevision: number;
  requirementSnapshot: ProductNeed[];
  evidenceAttachmentIds: string[];
  owner: string;
  opinion: string;
  date: string;
}
export interface Activity {
  id: string;
  entityId: string;
  customerId: string;
  contactId?: string;
  date: string;
  type: string;
  summary: string;
  people: string;
  next: string;
  operator: string;
  operatorPersonId?: string;
  stage: string;
}
export interface Attachment {
  id: string;
  entityId: string;
  kind: string;
  name: string;
  size: number;
  date: string;
  operator: string;
  sample: boolean;
  url: string;
  fileId?: string;
  mode?: 'simulated';
  note?: string;
  operationId?: string;
}
export interface Plan {
  id: string;
  type: PlanType;
  name: string;
  owner: string;
  ownerPersonId?: string;
  start: string;
  end: string;
  expected: string;
  actual: string;
  status: string;
  product: string;
  quantity: number;
  batch: string;
  linked: string;
  amount: number;
  currency: string;
  result: string;
  receiver: string;
  note: string;
  /** Offline template columns; optional for older saved projects. */
  wbsCode?: string;
  durationDays?: number;
  predecessor?: string;
  relationNote?: string;
  weekWindow?: string;
  /** Provenance stays explicit; sample data is never presented as a live external feed. */
  sourceReference?: string;
  sourceUpdatedAt?: string;
  sourceStatus?: '已引用' | '模拟' | '待核';
  sourceOpportunityPlanId?: string;
  sourceTemplateId?: string;
  sourceTemplateTaskId?: string;
  sourceType?: '自行制定' | '参考模板' | '客户要求';
  sourceDetail?: string;
  actualSourceReference?: string;
  /** Stable target ID for linked customer milestones; linked remains the legacy display name. */
  customerMilestoneId?: string;
  /** Stable business completion source, retained when the task is renamed. */
  completionKind?: ProjectReviewReason;
  /** V8: absent legacy values remain unknown; budget belongs only to internal WBS. */
  warningLeadDays?: number;
  /** 仅自动补齐的历史计划记录来源；后续人工设置应清除此标记。 */
  warningLeadDaysSource?: '历史项目统一补齐';
  /**
   * V8 内部WBS预计预算（任务预计支出）。与开票回款语义的 amount/currency 隔离：
   * 缺失即未知，不默认 0，也不从回款金额迁移。
   */
  budgetAmount?: number;
  budgetCurrency?: string;
  /** 预算来源：样例模拟值标“模拟”，不冒充业务原值。 */
  budgetSource?: '模拟' | '业务填报' | '待核';
}
export interface ReviewCondition {
  id: string;
  text: string;
  owner: string;
  due: string;
  evidence: string;
  closed: boolean;
}
export interface AcceptanceItem {
  id: string;
  name: string;
  result: string;
  signer: string;
  date: string;
  note: string;
}
export const HANDOVER_TYPES = [
  '项目信息',
  '商务信息',
  '项目成果',
  '技术信息',
  '风险信息',
  '服务信息',
  '培训信息',
  '待办',
];
export interface HandoverCategory {
  name: string;
  status: string;
  note: string;
}
export interface Issue {
  id: string;
  text: string;
  owner: string;
  due: string;
}
export interface ProjectRiskRecord {
  id: string;
  category: string;
  level: string;
  likelihood: string;
  status: string;
  description: string;
  sourceReference: string;
  sourceStatus: '待核';
  createdAt: string;
  operator: string;
}
export type CustomerCommunicationType =
  '需求澄清' | '执行情况' | '需求变更' | '回款信息' | '问题风险';
export interface ProjectCommunicationRecord {
  id: string;
  type: CustomerCommunicationType;
  date: string;
  summary: string;
  sourceReference: string;
  sourceStatus: '待核';
  createdAt: string;
  operator: string;
}
export interface EquipmentSerialRecord {
  id: string;
  projectId: string;
  contractId: string;
  serialNumber: string;
  model: string;
  quantity: number;
  status: string;
  siteLocation: string;
  actualDate: string;
  sourceReference: string;
  sourceStatus: '待核';
  createdAt: string;
  operator: string;
}
export type ProjectReviewReason = 'briefing' | 'sat' | 'acceptance' | 'handover';
export interface ProjectBriefingSubmission {
  version: number;
  submittedBy: string;
  submittedAt: string;
  opinion: string;
  snapshot: {
    contractId: string;
    quoteVersionId: string;
    /** 当时采用的合同真实原件版本；旧快照可缺失，不反推历史。 */
    contractFileVersionId?: string;
    contract: {
      title: string;
      amount: number;
      currency: string;
      payment: string;
      penalty: string;
      product: string;
      scope: string;
    };
    projectName: string;
    start: string;
    acceptance: string;
    /** 交底关键内容自 03-02 起进入来源版本快照；更早的记录可能尚未收纳，由迁移补齐。 */
    production?: string;
    shipping?: string;
    commissioning?: string;
    attachmentIds: string[];
  };
}
export interface ProjectBriefingConfirmation {
  version: number;
  confirmedBy: string;
  confirmedAt: string;
  opinion: string;
}
export interface ProjectG4Review {
  result: '待审核' | '通过' | '附条件通过' | '退回';
  reviewer: string;
  reviewedAt: string;
  opinion: string;
}
export interface ProjectStartupHandover {
  status: '待移交' | '已移交';
  sender: string;
  receiver: string;
  transferredAt: string;
  opinion: string;
  briefingVersion: number;
}
export interface Project {
  id: string;
  name: string;
  customerId: string;
  contactId?: string;
  opportunityId: string;
  contractId: string;
  pm: string;
  pmPersonId?: string;
  site: string;
  siteConditions: string;
  capacity: number;
  unit: string;
  start: string;
  status: string;
  accepted: boolean;
  team: TeamMember[];
  plans: Plan[];
  briefing: {
    acceptance: string;
    production: string;
    shipping: string;
    commissioning: string;
    review: string;
    opinion: string;
    returns: number;
    submission?: ProjectBriefingSubmission;
    confirmation?: ProjectBriefingConfirmation;
    g4?: ProjectG4Review;
    startupHandover?: ProjectStartupHandover;
  };
  conditions: ReviewCondition[];
  productionApplicable: boolean;
  productionReason: string;
  sat: { date: string; result: string; complete: boolean };
  acceptance: AcceptanceItem[];
  acceptanceComplete: boolean;
  handover: {
    receiver: string;
    status: string;
    opinion: string;
    categories: HandoverCategory[];
    issues: Issue[];
  };
  needsReview: boolean;
  reviewReasons?: ProjectReviewReason[];
  riskRecords?: ProjectRiskRecord[];
  communicationRecords?: ProjectCommunicationRecord[];
  equipmentSerialRecords?: EquipmentSerialRecord[];
}
export type DemoDateMode = 'normal' | 'comparison';
export interface DemoDateContext {
  mode: DemoDateMode;
}
export interface ContractMilestone {
  id: string;
  contractId: string;
  name: string;
  dueDate: string;
  warningLeadDays: number;
  ownerPersonId?: string;
  ownerName: string;
  createdAt: string;
}
export interface ContractFileVersion {
  id: string;
  contractId: string;
  workspaceId: string;
  roundId: string;
  blobId: string;
  version: number;
  fileName: string;
  mimeType: string;
  size: number;
  uploadedByPersonId?: string;
  uploadedBy: string;
  uploadedAt: string;
  previousVersionId?: string;
  isRealOriginal: boolean;
  /** 上传请求幂等键；同一请求重试不得重复登记新版本。 */
  operationId?: string;
}
export interface ContractQuoteReferenceSnapshot {
  /** 稳定ID之外的显示号：旧引用无法确认时仍可读出用户当时选择的报价号。 */
  seriesNumber: string;
  versionNumber: number;
  versionLabel: string;
  savedAt: string;
  savedBy: string;
}
/** 签约时冻结的来源事实和实际采用合同条款；旧合同缺失时保留待核。 */
export interface ContractAdoptedQuoteSnapshot {
  quoteSeriesId: string;
  quoteVersionId: string;
  seriesNumber: string;
  versionNumber: number;
  customerId: string;
  opportunityId: string;
  lockedAt: string;
  lockedBy: string;
  adoptedAt: string;
  adoptedBy: string;
  commercial: Pick<
    QuoteVersion,
    | 'currency'
    | 'payment'
    | 'tradeTerm'
    | 'tradeNote'
    | 'delivery'
    | 'validUntil'
    | 'freightAmount'
    | 'freightTreatment'
    | 'dutyAmount'
    | 'dutyTreatment'
    | 'otherFee'
    | 'otherFeeTreatment'
    | 'discount'
  > & { total: number };
  products: QuoteItem[];
  service: Pick<QuoteVersion, 'scope' | 'warranty' | 'service' | 'solutionSummary' | 'boundaries'>;
  adoptedTerms: Pick<
    Contract,
    | 'amount'
    | 'currency'
    | 'payment'
    | 'product'
    | 'scope'
    | 'delivery'
    | 'warranty'
    | 'service'
    | 'penalty'
  >;
}
export interface Contract {
  /** V8 source-backed business values; legacy snapshots may omit these. */
  crmFields?: Record<string, import('./contract-main-fields').ContractMainValue>;
  createdAt?: string;
  mainFieldsRevision?: number;
  customerAdoptedName?: string;
  id: string;
  opportunityId: string;
  customerId: string;
  amount: number;
  currency: string;
  payment: string;
  penalty: string;
  product: string;
  g3: string;
  quoteVersionId?: string;
  quoteSeriesId?: string;
  /** 合同草稿显式选择报价版本时保存的显示号与锁定事实。 */
  quoteReferenceSnapshot?: ContractQuoteReferenceSnapshot;
  adoptedQuoteSnapshot?: ContractAdoptedQuoteSnapshot;
  title?: string;
  contactId?: string;
  sellerEntity?: string;
  scope?: string;
  delivery?: string;
  warranty?: string;
  service?: string;
  plannedSignDate?: string;
  signedDate?: string;
  evidence?: string;
  status?: '草稿' | '已登记';
  createdBy?: string;
  registeredBy?: string;
  registeredAt?: string;
  note?: string;
  serviceSnapshot?: {
    quoteVersionId?: string;
    warranty: string;
    sla: string;
    scope: string;
  };
  paymentTermId?: string;
  paymentMethodIds?: string[];
  paymentSnapshot?: ContractPaymentSnapshot;
  /** Independent of the contract business version; absent for legacy simulated files. */
  currentContractFileVersionId?: string;
}
export interface PaymentTermRecord {
  ownerName?: string;
  createdAt?: string;
  id: string;
  code: string;
  descriptionZh: string;
  descriptionEn: string;
  descriptionDe: string;
  status: string;
  revision: number;
  crmFields: Record<string, unknown>;
  updatedBy: string;
  updatedAt: string;
}
export interface PaymentMethodRecord {
  ownerName?: string;
  createdAt?: string;
  deliveryInFullPaymentNeedsReview?: boolean;
  id: string;
  name: string;
  paymentTermId: string;
  condition: string;
  method: string;
  proportion: number | null;
  days: number | null;
  fixedAmount: number | null;
  followFixedAmount: boolean;
  deliveryInFullPayment: string | null;
  remarks: string;
  contractId?: string;
  orderId?: string;
  active: boolean;
  revision: number;
  crmFields: Record<string, unknown>;
  updatedBy: string;
  updatedAt: string;
}
export interface ContractPaymentSnapshot {
  term: PaymentTermRecord;
  methods: PaymentMethodRecord[];
  adoptedText: string;
  adoptedBy: string;
  adoptedAt: string;
}
export type QuoteStatus =
  | '草稿'
  | '待模拟审核'
  | '退回补充'
  | '附条件通过'
  | '模拟审核通过'
  | '已记录发出'
  | '最终锁定'
  | '作废';
export interface QuoteItem {
  id: string;
  /** Standard Dynamics quotedetail logical fields, kept separately from legacy aliases. */
  crmFields?: Record<string, string | number | boolean | null>;
  crmPriceInput?: 'alp_priceperunit' | 'alp_beforedispriceintax';
  productNeedId?: string;
  category: string;
  name: string;
  spec: string;
  unit: string;
  quantity: number;
  unitPrice: number;
  discountPercent?: number;
  guidePrice?: number | null;
  guideCurrency?: string;
  guideUnit?: string;
  guideQuantity?: number;
  guideTaxBasis?: string;
  guideCostingId?: string;
  source: string;
}
export type SolutionDocumentKind = '技术方案' | 'TIC' | '设计BOM' | 'SLD';
export interface SolutionDocumentVersion {
  id: string;
  kind: SolutionDocumentKind;
  number: number;
  documentId: string;
  owner: string;
  operator: string;
  createdAt: string;
  note: string;
}
export interface SolutionCosting {
  solutionOutputIds?: Partial<import('./v9-contracts').SolutionOutputIds>;
  id: string;
  confirmationId: string;
  createdAt: string;
  operator: string;
  simulated: true;
  coefficientSource: string;
  rows: {
    productNeedId: string;
    model: string;
    /** Product name snapshot from the need; older costing rows may lack it. */
    name?: string;
    quantity: number;
    unit: string;
    cost: number | null;
    currency: string;
    taxBasis: string;
    coefficient: number;
    guidePrice: number | null;
    source: string;
  }[];
}
export type FiveCanKey = '可承诺' | '可交付' | '可运维' | '可验收' | '可续约';
export interface FiveCanReview {
  /** 显式会签采用当时确认与真实输出；旧缺值保留待核。 */
  confirmationId?: string;
  solutionOutputIds?: Partial<import('./v9-contracts').SolutionOutputIds>;
  id: string;
  createdAt: string;
  operator: string;
  simulated: true;
  source: string;
  items: Record<
    FiveCanKey,
    { result: '满足' | '附条件' | '不满足' | '待评估'; owner: string; opinion: string }
  >;
  conditions: {
    id: string;
    key: FiveCanKey;
    text: string;
    owner: string;
    due: string;
    closed: boolean;
    closedBy: string;
    closedAt?: string;
    evidence?: string;
  }[];
}
export interface SolutionConfirmation {
  id: string;
  createdAt: string;
  owner: string;
  operator: string;
  productNeedRevision: number;
  documentVersions: Partial<Record<SolutionDocumentKind, string>>;
}
export interface QuoteCondition {
  id: string;
  text: string;
  owner: string;
  due: string;
  closed: boolean;
  closedBy: string;
}
export interface QuoteFeedback {
  id: string;
  date: string;
  kind: string;
  summary: string;
  person: string;
  evidence: string;
}
export interface QuoteAudit {
  id: string;
  action: string;
  person: string;
  date: string;
  note: string;
}
export interface QuoteVersion {
  solutionBasis?: QuoteSolutionBasis;
  id: string;
  /** Set only on new or explicitly saved CRM-form drafts; historical finals retain their rules. */
  crmSchemaVersion?: 1;
  /** User-approved demo fallback, never proof of CRM historical persistence. */
  crmCalculationPolicy?: 'demo-fixed-v1';
  crmCreatedOn?: string;
  /** Adopted references are frozen with the quote, separate from the live local catalog. */
  crmReferenceSnapshot?: import('./crm-quote').CrmCatalog;
  customerDecision?: '接受' | '不接受';
  seriesId: string;
  number: number;
  sourceVersionId: string;
  status: QuoteStatus;
  title: string;
  sellerEntity: string;
  customerId: string;
  contactId: string;
  owner: string;
  country: string;
  /** Explicit confirmation to adopt a customer's changed country into this quote draft. */
  countryChangeConfirmed?: boolean;
  currency: string;
  tradeTerm: string;
  tradeNote: string;
  plannedSendDate: string;
  validUntil: string;
  scope: string;
  delivery: string;
  payment: string;
  warranty: string;
  service: string;
  solutionSummary: string;
  boundaries: string;
  notes: string;
  items: QuoteItem[];
  freightAmount: number;
  freightTreatment: string;
  dutyAmount: number;
  dutyTreatment: string;
  otherFee: number;
  otherFeeTreatment: string;
  discount: number;
  sourceAttachmentIds: string[];
  solutionVersionId?: string;
  costingId?: string;
  sourceSolutionConfirmationId?: string;
  sourceDocumentVersions?: Partial<Record<SolutionDocumentKind, string>>;
  sourceProductNeedRevision?: number;
  sourceDiff?: string[];
  sourceAdoptedAt?: string;
  discountApprovalCount?: number;
  discountApprovals?: {
    id: string;
    type: '低价模拟特批';
    status: '待审批' | '退回' | '通过';
    reason: string;
    opinion: string;
    operator: string;
    submitter?: string;
    reviewer?: string;
    reviewedAt?: string;
    expiry?: string;
    createdAt: string;
    basis: string;
    successful: boolean;
  }[];
  sentSnapshot?: {
    customerId: string;
    customerName: string;
    contactId: string;
    contactName: string;
    country: string;
    currency: string;
    title: string;
    items: QuoteItem[];
    total: number | null;
    solutionVersionId?: string;
    sourceSolutionConfirmationId?: string;
    sourceDocumentVersions?: Partial<Record<SolutionDocumentKind, string>>;
    costingId?: string;
  };
  contentRevision?: number;
  /** Typed values for configured offline source fields; keys are source logical names. */
  crmFields?: Record<string, string | number | boolean | null>;
  submittedRevision?: number;
  taxMode: string;
  vatAmount: number;
  taxNote: string;
  taxReview: string;
  taxReviewBy: string;
  taxReviewDate: string;
  costs: {
    goods: number | null;
    logistics: number | null;
    delivery: number | null;
    service: number | null;
    source: string;
  };
  reviewBy: string;
  reviewDate: string;
  reviewNote: string;
  conditions: QuoteCondition[];
  lockRequestedBy: string;
  lockRequestedDate: string;
  sentDate: string;
  sentMethod: string;
  sentTo: string;
  sentEvidence: string;
  acceptedBy: string;
  acceptedDate: string;
  acceptedEvidence: string;
  lockedBy: string;
  lockedDate: string;
  invalidationReason: string;
  feedback: QuoteFeedback[];
  audit: QuoteAudit[];
}
export interface QuoteSeries {
  id: string;
  number: string;
  opportunityId: string;
  versions: QuoteVersion[];
  activeFinalVersionId: string;
  createdBy: string;
  createdDate: string;
}
export interface Notice {
  id: string;
  key: string;
  entityId: string;
  role: Role;
  title: string;
  text: string;
  read: boolean;
  resolved: boolean;
  date: string;
  planId?: string;
  href?: string;
}
/**
 * 08-03：预警事项的已读记录。按稳定人员身份键隔离，同一事项对不同人互不影响；
 * 已读不解除风险，也不等于完成。
 */
export interface PlanWarningRead {
  personKey: string;
  warningId: string;
  readAt: string;
}
export interface History {
  id: string;
  entityId: string;
  operator: string;
  action: string;
  date: string;
}/** JSON-safe field delta committed with a business snapshot. */
export interface OperationFieldChange {
  field: string;
  valueType: 'null' | 'string' | 'number' | 'boolean' | 'object' | 'array';
  before: unknown;
  after: unknown;
}
/** Stable navigation/trace target for a module operation. */
export interface OperationLocation {
  objectType: string;
  objectId: string;
  module: string;
  department: string;
  section: string;
  action: string;
}
/** Shared contract for successful, user-initiated module commits. */
export interface OperationEvent {
  id: string;
  roundId: string;
  mainlineId: string;
  module: string;
  department: string;
  objectType: string;
  objectId: string;
  action: string;
  operator: string;
  operatorPersonId?: string;
  owner: string;
  ownerPersonId?: string;
  occurredAt: string;
  sourceVersion: number;
  dataVersion: number;
  location: OperationLocation;
  taskSource?: { kind: string; id?: string };
  changes: OperationFieldChange[];
  /** Imported from a legacy History row; incomplete fields must stay explicit. */
  legacy?: true;
  legacyMissingFields?: string[];
  legacyHistoryId?: string;
}
/** Explicit submission envelope for a module to atomically commit its data and event. */
export interface OperationCommitRequest {
  object: { type: string; id: string };
  mainlineId: string;
  module: string;
  department: string;
  section: string;
  action: string;
  owner: { name: string; personId?: string };
  taskSource?: { kind: string; id?: string };
  changes: OperationFieldChange[];
  /** Record an intentional user confirmation that has no data-field delta. */
  recordUnchangedAction?: boolean;
  change: (state: DemoState) => void;
  message?: string;
}
export interface DemoState {
  /** V9可选集合：正式升级前不补种、不标记新schema。 */
  solutionWorkspaces?: SolutionWorkspace[];
  solutionLegacyAliases?: SolutionLegacyAlias[];
  opportunityG1Checks?: OpportunityG1Check[];
  progressGroupMappings?: ProgressGroupMapping[];
  progressNodeApplicability?: ProgressNodeApplicability[];
  budgetDemoExpenses?: BudgetDemoExpense[];
  budgetComparisonSources?: BudgetComparisonSource[];
  /** B01幂等收据，与模块变更同次快照提交；不改变schema版本。 */
  v9CommandReceipts?: V9CommandReceipt[];
  /** 用户授权的历史计划预警补齐仅执行一次，之后主动清空的值不再自动填回。 */
  projectWarningBackfillVersion?: 1;
  /** Additive V8 contracts: old snapshots may omit these until the owning migration runs. */
  dateMode?: DemoDateMode;
  /** 08-03：预警事项的个人已读状态；只代表本人读过，不代表任务完成。 */
  planWarningReads?: PlanWarningRead[];
  contractMilestones?: ContractMilestone[];
  contractFileVersions?: ContractFileVersion[];
  /** Persisted storage shape version; independent from business dataVersion and V4 migrations. */
  storageSchemaVersion?: number;
  migrationReviewItems?: {
    id: string;
    entityType: string;
    entityId: string;
    relation: string;
    reason: string;
  }[];
  version: number;
  /** Monotonic local snapshot version, incremented only after a successful commit. */
  dataVersion?: number;
  /** Stable ID for the current local demo round. */
  roundId?: string;
  v4SchemaVersion?: number;
  solutionSeries?: SolutionSeries[];
  solutionDocuments?: {
    opportunityId: string;
    current: Partial<Record<SolutionDocumentKind, string>>;
    versions: SolutionDocumentVersion[];
    confirmations: SolutionConfirmation[];
    costings: SolutionCosting[];
    fiveCanReviews: FiveCanReview[];
    owner: string;
    ownerHistory: { from: string; to: string; operator: string; createdAt: string }[];
  }[];
  serviceTerms?: ServiceTerms[];
  serviceAgreements?: ServiceAgreement[];
  financeSnapshots?: FinanceSnapshot[];
  /** V10新增整月演示事实；与历史快照独立，不倒推或覆盖旧财务。 */
  financeBatches?: import("./v10-contracts").V10FinanceBatch[];
  /** Canonical contract invoice records. Legacy project snapshots remain readable during migration. */
  contractInvoices?: import('./invoices').ContractInvoice[];
  /** Claim records are owned by the future receipt workflow; invoices only consume this summary. */
  invoiceReceiptClaims?: import('./invoices').InvoiceReceiptClaim[];
  /** Canonical local remittance records; legacy invoice claims remain readable during migration. */
  bankReceiptClaims?: import('./remittances').BankReceiptClaim[];
  bankReceiptClaimLines?: import('./remittances').BankReceiptClaimLine[];
  remittanceSchemaVersion?: number;
  /** User-selected context for this round; sample records never imply progress. */
  selectedMainlineId?: string;
  selectedProjectId?: string;
  /** Canonical sales orders and lines; IDs stay stable across module views. */
  orders?: import('./orders').SalesOrder[];
  orderLines?: import('./orders').SalesOrderLine[];
  invoiceSchemaVersion?: number;
  orderSchemaVersion?: number;
  creditPolicies?: CreditPolicySnapshot[];
  projectMilestoneBindings?: ProjectMilestoneBinding[];
  customerDeliveryMappings?: CustomerDeliveryMapping[];
  customerDeliveryRetentionVersion?: 1;
  milestoneSyncRecords?: MilestoneSyncRecord[];
  milestoneWarnings?: MilestoneWarning[];
  finalActualCosts?: FinalActualCost[];
  quoteSchemaVersion?: number;
  roughPlanTemplates?: OpportunityRoughPlanTemplate[];
  role: Role;
  customers: Customer[];
  sales: SalesRecord[];
  projects: Project[];
  contracts: Contract[];
  paymentTerms?: PaymentTermRecord[];
  paymentMethods?: PaymentMethodRecord[];
  quoteSeries?: QuoteSeries[];
  activities: Activity[];
  attachments: Attachment[];
  notices: Notice[];
  history: History[];
  /** Additive event stream; legacy History remains available to existing screens. */
  operationEvents?: OperationEvent[];
}
export interface Field {
  group?: string;
  key: string;
  label: string;
  type?: 'text' | 'textarea' | 'number' | 'date' | 'select' | 'email';
  required?: boolean;
  requiredWhen?: { field: string; equals: string };
  /** Control stays disabled until the referenced field equals this value. */
  enabledWhen?: { field: string; equals: string };
  /** Value forced onto the control while disabled by enabledWhen. */
  disabledValue?: string;
  populateFieldsByValue?: Record<string, Record<string, string>>;
  populateConfirm?: boolean;
  options?: (string | FieldOption)[];
  /** Reject values outside the displayed options, including stale persisted names. */
  optionsOnly?: boolean;
  /** Select several existing names; persist the displayed names joined by 、. */
  multiple?: boolean;
  optionsByValue?: Record<string, (string | FieldOption)[]>;
  dependsOn?: string;
  hint?: string;
  value?: string | number;
  min?: number;
}
export interface FieldOption {
  value: string;
  label: string;
}
export interface DialogRequest {
  title: string;
  description?: string;
  fields: Field[];
  submitLabel?: string;
  sample?: Record<string, string | number>;
  onSave: (data: Record<string, string>) => boolean | void | Promise<boolean | void>;
}
export interface SolutionVersion {
  id: string;
  number: number;
  documentId: string;
  owner: string;
  operator: string;
  createdAt: string;
  note: string;
  operationId: string;
}
export interface SolutionSeries {
  id: string;
  opportunityId: string;
  latestVersionId: string;
  finalVersionId: string;
  versions: SolutionVersion[];
  marks: { from: string; to: string; operator: string; createdAt: string }[];
}
export interface ServiceTerms {
  opportunityId: string;
  revision: number;
  kind: '常规' | '特殊';
  years: number;
  scope: string;
  sla: string;
  special: string;
  note: string;
  salesConfirmation?: { revision: number; person: string; owner: string; createdAt: string };
  submittedRevision?: number;
  reviews: {
    revision: number;
    result: '可接受' | '需调整';
    opinion: string;
    person: string;
    createdAt: string;
  }[];
}
export interface ServiceAgreement {
  opportunityId: string;
  revision: number;
  applicability: '待确认' | '适用' | '不购买';
  reason: string;
  summary: string;
  documentId: string;
  confirmation?: { revision: number; person: string; owner: string; createdAt: string };
}
export interface FinanceExpense {
  id: string;
  category: string;
  subtype: string;
  date: string;
  amount: number;
  currency: string;
  person: string;
  sourceNumber: string;
  source: 'SAP' | 'CRM';
}
export interface FinanceInvoice {
  id: string;
  number: string;
  amount: number;
  currency: string;
  issued: string;
  due: string;
  received: number;
}
export interface FinanceIndicatorSnapshot {
  source: 'SAP' | 'CRM';
  snapshotDate: string;
  currency: string;
  salesAmount: number;
  grossProfitAmount: number;
  prepaymentRatio: number;
}
export interface ActualCostSnapshot {
  projectId: string;
  source: 'SAP' | 'CRM';
  amount: number;
  currency: string;
  scope: string;
  cutoff: string;
}
export interface CreditPolicySnapshot {
  projectId: string;
  customerId: string;
  policyId: string;
  revision: number;
  terms: string;
  days: number;
  startCustomerMilestoneId: string;
  source: 'CRM';
  snapshotDate: string;
}
export interface ProjectMilestoneBinding {
  projectId: string;
  sourcePlanId: string;
  customerMilestoneId: string;
}
/** 固定客户承诺来源；技术映射不开放业务分类配置。 */
export interface CustomerDeliveryMapping {
  id: string;
  projectId: string;
  planId: string;
  customerMilestoneId: string;
  category: 'shipment' | 'customerAcceptance';
  source: string;
  revision: number;
  /** 仅在成功保存的同轮快照内留存可靠来源；不是手填风险结论。 */
  retained?: {
    roundId: string;
    dataVersion: number;
    mappingRevision: number;
    mappingId: string;
    projectId: string;
    category: 'shipment' | 'customerAcceptance';
    plan: Pick<Plan, 'id' | 'type' | 'name' | 'owner' | 'status' | 'actual' | 'customerMilestoneId' | 'completionKind'>;
    milestone: Pick<Plan, 'id' | 'type' | 'name' | 'owner' | 'status' | 'end' | 'warningLeadDays'>;
  };
}
export interface MilestoneSyncRecord {
  id: string;
  projectId: string;
  sourcePlanId: string;
  sourcePlanName: string;
  customerMilestoneId: string;
  customerMilestoneName: string;
  oldCustomerAgreedDate: string;
  customerAgreedDate: string;
  revision: number;
  operationId: string;
  oldExpectedDate: string;
  newExpectedDate: string;
  oldActualDate: string;
  newActualDate: string;
  oldStatus: string;
  newStatus: string;
  operator: string;
  createdAt: string;
  status: 'simulated';
}
export interface MilestoneWarning {
  id: string;
  projectId: string;
  sourcePlanId?: string;
  customerMilestoneId?: string;
  invoiceId?: string;
  kind: '节点延期' | '回款逾期';
  dueDate: string;
  offsetDays: number;
  owner: Role;
}
export interface FinanceSnapshot {
  projectId: string;
  sc: string;
  scope: string;
  refreshedAt: string;
  expenses: FinanceExpense[];
  invoices: FinanceInvoice[];
  events: { invoiceId: string; received: number; operator: string; createdAt: string }[];
  /** Absent on legacy snapshots until an explicit simulated refresh loads the sample. */
  indicators?: FinanceIndicatorSnapshot;
  cumulativeActualCost?: ActualCostSnapshot;
}
export interface FinalActualCost {
  id: string;
  projectId: string;
  revision: number;
  amount: number;
  currency: string;
  scope: string;
  cutoff: string;
  confirmedDate: string;
  provider: string;
  documentId: string;
  reason: string;
  zeroReason: string;
  operator: string;
  createdAt: string;
  operationId: string;
}
export interface QuoteGateMissing {
  code: string;
  label: string;
  entityId: string;
  tab: string;
  role: Role;
}
