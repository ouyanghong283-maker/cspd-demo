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
}
export interface Customer {
  id: string;
  name: string;
  shortName: string;
  country: string;
  industry: string;
  address: string;
  contacts: Contact[];
}
export interface TeamMember {
  id: string;
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
  operator: string;
  lastEditor?: string;
  source: string;
  description: string;
  capacity: number;
  unit: string;
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
}
export interface Activity {
  id: string;
  entityId: string;
  customerId: string;
  date: string;
  type: string;
  summary: string;
  people: string;
  next: string;
  operator: string;
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
}
export interface Plan {
  id: string;
  type: PlanType;
  name: string;
  owner: string;
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
export interface Project {
  id: string;
  name: string;
  customerId: string;
  contactId?: string;
  opportunityId: string;
  contractId: string;
  pm: string;
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
}
export interface Contract {
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
}
export type QuoteStatus = '草稿' | '待模拟审核' | '退回补充' | '附条件通过' | '模拟审核通过' | '已记录发出' | '最终锁定' | '作废';
export interface QuoteItem {
  id: string;
  category: string;
  name: string;
  spec: string;
  unit: string;
  quantity: number;
  unitPrice: number;
  source: string;
}
export interface QuoteCondition { id: string; text: string; owner: string; due: string; closed: boolean; closedBy: string; }
export interface QuoteFeedback { id: string; date: string; kind: string; summary: string; person: string; evidence: string; }
export interface QuoteAudit { id: string; action: string; person: string; date: string; note: string; }
export interface QuoteVersion {
  id: string; seriesId: string; number: number; sourceVersionId: string; status: QuoteStatus;
  title: string; sellerEntity: string; customerId: string; contactId: string; owner: string; country: string; currency: string; tradeTerm: string; tradeNote: string;
  plannedSendDate: string; validUntil: string; scope: string; delivery: string; payment: string; warranty: string; service: string; solutionSummary: string; boundaries: string; notes: string;
  items: QuoteItem[]; freightAmount: number; freightTreatment: string; dutyAmount: number; dutyTreatment: string; otherFee: number; otherFeeTreatment: string; discount: number;
  sourceAttachmentIds: string[];
  taxMode: string; vatAmount: number; taxNote: string; taxReview: string; taxReviewBy: string; taxReviewDate: string;
  costs: { goods: number | null; logistics: number | null; delivery: number | null; service: number | null; source: string };
  reviewBy: string; reviewDate: string; reviewNote: string; conditions: QuoteCondition[];
  lockRequestedBy: string; lockRequestedDate: string;
  sentDate: string; sentMethod: string; sentTo: string; sentEvidence: string; acceptedBy: string; acceptedDate: string; acceptedEvidence: string;
  lockedBy: string; lockedDate: string; invalidationReason: string; feedback: QuoteFeedback[]; audit: QuoteAudit[];
}
export interface QuoteSeries { id: string; number: string; opportunityId: string; versions: QuoteVersion[]; activeFinalVersionId: string; createdBy: string; createdDate: string; }
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
}
export interface History {
  id: string;
  entityId: string;
  operator: string;
  action: string;
  date: string;
}
export interface DemoState {
  version: number;
  quoteSchemaVersion?: number;
  role: Role;
  customers: Customer[];
  sales: SalesRecord[];
  projects: Project[];
  contracts: Contract[];
  quoteSeries?: QuoteSeries[];
  activities: Activity[];
  attachments: Attachment[];
  notices: Notice[];
  history: History[];
}
export interface Field {
  key: string;
  label: string;
  type?: 'text' | 'textarea' | 'number' | 'date' | 'select' | 'email';
  required?: boolean;
  options?: string[];
  hint?: string;
  value?: string | number;
  min?: number;
}
export interface DialogRequest {
  title: string;
  description?: string;
  fields: Field[];
  submitLabel?: string;
  sample?: Record<string, string | number>;
  onSave: (data: Record<string, string>) => boolean | void | Promise<boolean | void>;
}
