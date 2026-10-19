import type { OperationCommitRequest } from './models';

/** B01公共契约；真实文件、迁移及各业务算法由后续票接入。 */
export const SOLUTION_OUTPUT_KINDS = ['proposal', 'bom', 'sld', 'degradation'] as const;
export type SolutionOutputKind = (typeof SOLUTION_OUTPUT_KINDS)[number];
export type SolutionInputKind = 'tic';
export type FileAvailability = 'checking' | 'present' | 'missing' | 'unavailable';
export type FactOrigin = 'operation' | 'simulated' | 'legacy';
export type JsonValue =
  null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type V9ErrorCode =
  | 'field-required'
  | 'field-invalid'
  | 'source-ambiguous'
  | 'finalization-stale'
  | 'file-checking'
  | 'file-missing'
  | 'file-unavailable'
  | 'no-edit-right'
  | 'workspace-changed'
  | 'business-readonly'
  | 'revision-mismatch'
  | 'operation-input-mismatch'
  | 'quota-exceeded'
  | 'storage-failed';
export interface V9Issue {
  code: V9ErrorCode;
  message: string;
  sourceId?: string;
  field?: string;
}
export interface V9Target {
  workspaceId: string;
  roundId: string;
}
export interface V9CommandRequest extends V9Target {
  command: string;
  objectId: string;
  operationId: string;
  /** 完整可JSON序列化业务输入；不能省略参与幂等判断的字段。 */
  input: JsonValue;
}
export type V9CommandResult =
  | {
      status: 'committed' | 'unchanged';
      objectId: string;
      revision: number;
      value: JsonValue;
      message: string;
    }
  | { status: 'rejected' | 'failed'; objectId: string; issue: V9Issue; message: string };
export interface V9CommandReceipt extends V9Target {
  command: string;
  objectId: string;
  operationId: string;
  fingerprint: string;
  result: Extract<V9CommandResult, { status: 'committed' | 'unchanged' }>;
}
/** 仅模块层构造；页面不得直接传入修改函数绕过业务校验。 */
export interface V9CommandPlan extends OperationCommitRequest {
  value: JsonValue;
}

export interface V9Person {
  personId: string;
  name: string;
}
export interface V9Dates {
  realNowUtc: string;
  solutionBusinessDate: string;
  timezone: 'Asia/Shanghai';
  planObservationDate: string;
}
export interface SolutionFileReference extends V9Target {
  blobId: string;
  versionId: string;
}
export interface SolutionOutputVersion {
  supersedesVersionId?: string | null;
  id: string;
  opportunityId: string;
  kind: SolutionOutputKind | SolutionInputKind;
  number: number;
  documentId: string | null;
  fileName: string;
  size: number | null;
  mime: string | null;
  uploadedAt: string | null;
  owner: V9Person | null;
  operator: V9Person | null;
  note: string;
  origin: FactOrigin;
  uploadEvidence: string | null;
  contentState: 'current' | 'metadataOnly';
  file: SolutionFileReference | null;
}
export interface SolutionSchedule {
  opportunityId: string;
  pm: V9Person;
  owner: V9Person;
  deadlineDate: string;
  timezone: 'Asia/Shanghai';
  revision: number;
  frozenByEventId: string | null;
}
export interface ScheduleChange {
  id: string;
  from: SolutionSchedule | null;
  to: SolutionSchedule;
  reason: string;
  operator: V9Person;
  changedAt: string;
}
export type SolutionOutputIds = Record<SolutionOutputKind, string>;
export interface FinalizationEvent {
  pm?: V9Person;
  timezone?: 'Asia/Shanghai';
  id: string;
  opportunityId: string;
  sequence: number;
  firstEventId: string;
  fourVersionIds: SolutionOutputIds;
  versionMetadataSnapshot: SolutionOutputVersion[];
  productNeedRevision: string;
  owner: V9Person;
  operator: V9Person;
  confirmedAt: string;
  deadlineSnapshot: string;
  scheduleRevision: number;
  origin: 'operation' | 'simulated';
}
export interface FirstFinalization {
  eventId: string;
  deadlineDate: string;
  timezone: 'Asia/Shanghai';
  businessDate: string;
  daysEarly: number;
  result: 'early' | 'on-time' | 'late';
}
export interface SolutionWorkspace {
  /** 核价、五可及TIC的正常写入归属；旧顶层集合只作历史兼容。 */
  businessRecords?: import('./solution-workflow/business-records').SolutionBusinessRecords;
  id: string;
  opportunityId: string;
  revision: number;
  productNeedRevision: string | null;
  versions: SolutionOutputVersion[];
  currentOutputs: Partial<SolutionOutputIds>;
  schedule: SolutionSchedule | null;
  scheduleChanges: ScheduleChange[];
  finalizations: FinalizationEvent[];
  firstFinalization: FirstFinalization | null;
  /** 原始历史事实不转成V9首次事件；迁移模块保留原记录。 */
  legacyFacts: { id: string; type: string; origin: 'legacy'; original: JsonValue }[];
}
export interface SolutionLegacyAlias {
  legacyType: string;
  legacyId: string;
  opportunityId: string | null;
  unifiedId: string | null;
  status: 'resolved' | 'ambiguous' | 'missing';
  originalReference: JsonValue;
}
export interface OpportunityG1Check {
  id: string;
  opportunityId: string;
  checkVersion: string;
  sourceRevision: string;
  evidenceIds: string[];
  operator: V9Person;
  occurredAt: string;
  origin: FactOrigin;
}
export type ProgressGroupId = 'design' | 'production' | 'shipping' | 'arrival-installation';
export interface ProgressGroupMapping {
  id: string;
  projectId: string;
  groupId: ProgressGroupId;
  planIds: string[];
  sourceTemplateId: string | null;
  revision: number;
  history: {
    id: string;
    fromPlanIds: string[];
    toPlanIds: string[];
    reason: string;
    operator: V9Person;
    changedAt: string;
  }[];
}
export interface ProgressNodeApplicability {
  projectId: string;
  nodeId: string;
  applicability: 'applicable' | 'not-required';
  reason: string;
  pm: V9Person;
  operator: V9Person;
  confirmedAt: string;
  revision: number;
  history: {
    id: string;
    applicability: 'applicable' | 'not-required';
    reason: string;
    pm?: V9Person;
    operator: V9Person;
    confirmedAt: string;
  }[];
}
export type BudgetCurrency = 'CNY' | 'EUR' | 'USD';
export interface BudgetDemoExpense {
  expenseId: string;
  projectId: string;
  planId: string | null;
  scope: string;
  amountMinor: number;
  currency: BudgetCurrency;
  date: string;
  summary: string;
  sourceRecordId: string;
  batchId: string;
  cutoff: string;
  origin: 'simulated';
}
export interface BudgetComparisonSource {
  projectId: string;
  currency: BudgetCurrency;
  expenseIds: string[];
  scope: string | null;
  cutoff: string | null;
  complete: boolean;
}
export interface QuoteSolutionBasis {
  finalizationId: string;
  opportunityId: string;
  fourVersionIds: SolutionOutputIds;
  productNeedRevision: string;
  adoptedAt: string;
  operator: V9Person;
  versionMetadataSnapshot: SolutionOutputVersion[];
}
export interface SolutionWorkspaceView {
  currentStatus: 'not-finalized' | 'current' | 'stale';
  workspace: SolutionWorkspace | null;
  firstResult: FirstFinalization['result'] | 'not-finalized' | 'historical-unscored';
  files: { kind: SolutionOutputKind; versionId: string | null; availability: FileAvailability }[];
}
/** 模块接口接缝，不含具体页面/Store依赖或第二套持久化投影。 */
export interface V9SolutionCommandInputs {
  setSolutionSchedule: {
    opportunityId: string;
    pmPersonId: string;
    ownerPersonId: string;
    deadlineDate: string;
    note: string;
  };
  changeSolutionDeadline: {
    opportunityId: string;
    deadlineDate: string;
    reason: string;
    scheduleRevision: number;
  };
  uploadSolutionOutput: {
    opportunityId: string;
    kind: SolutionOutputKind;
    file: File;
    note: string;
  };
  finalizeSolution: {
    scheduleRevision: number;
    opportunityId: string;
    fourVersionIds: SolutionOutputIds;
    productNeedRevision: string;
    ownerPersonId: string;
    actingOnBehalf: boolean;
  };
  adoptQuoteSolutionBasis: {
    quoteVersionId: string;
    finalizationId: string;
    quoteRevision: number;
  };
  recordOpportunityG1Check: { opportunityId: string; sourceRevision: string };
  confirmProgressMapping: {
    projectId: string;
    groupId: ProgressGroupId;
    planIds: string[];
    expectedMappingRevision: number;
    reason: string;
  };
  setNodeApplicability: {
    projectId: string;
    nodeId: string;
    applicability: 'applicable' | 'not-required';
    reason: string;
    pmPersonId: string;
  };
}

/** 共用事实样例；expected由CODEX按规格冻结。 */
export interface V9PublicScenario {
  id: string;
  origin: 'simulated';
  description: string;
  target: V9Target;
  opportunityId: string;
  projectId: string;
  workspace: SolutionWorkspace | null;
  availability: Record<string, FileAvailability>;
  budget: {
    amountMinor: number | null;
    currency: BudgetCurrency;
    comparable: boolean;
    reason: string | null;
  }[];
  expected: { firstResult: SolutionWorkspaceView['firstResult']; availability: FileAvailability[] };
}

export interface LifecycleProgressView {
  businessId: string;
  projectId: string | null;
  /** 精确分数序列化为十进制整数文本，BigInt只留内存；不能提前舍入。 */
  score: { numerator: string; denominator: string };
  displayPercent: string;
  complete: boolean;
  nodes: {
    nodeId: string;
    score?: { numerator: string; denominator: string };
    weight: number;
    status: 'verified' | 'partial' | 'incomplete' | 'missing' | 'invalidated' | 'not-required';
    sourceIds: string[];
    reason: string | null;
    sourceHref: string | null;
  }[];
}
export interface BudgetComparisonView {
  projectId: string;
  currency: BudgetCurrency;
  scope: string | null;
  cutoff: string | null;
  budgetMinor: number | null;
  expenseMinor: number | null;
  missingPlanIds: string[];
  comparable: boolean;
  reason: string | null;
  executionPercent: number | null;
  varianceMinor: number | null;
  overspendMinor?: number | null;
  budgetStatus?: string;
  expenses: BudgetDemoExpense[];
}
export interface CompleteWorkItemView {
  id: string;
  sourceId: string;
  sourceRecordId: string;
  businessId: string;
  projectId: string | null;
  owner: V9Person | null;
  department: 'sales' | 'solution' | 'pm-pmo' | 'service' | 'unknown';
  status: 'open' | 'completed';
  dueDate: string | null;
  sourceHref: string;
}

export interface QuoteSolutionBasisView {
  quoteVersionId: string;
  availableFinalization: FinalizationEvent | null;
  adoptedBasis: QuoteSolutionBasis | null;
  status: 'not-adopted' | 'current' | 'stale' | 'historical';
  differences: V9Issue[];
  canSubmit: boolean;
  submitIssues: V9Issue[];
  /** 当前字节异常与采用组合的业务阻断分列；新定稿/新采用仍核验原件。 */
  fileIssues?: V9Issue[];
}
export interface ManagementBoardFilters {
  projectIds: string[];
  businessIds: string[];
  grades: string[];
  departments: CompleteWorkItemView['department'][];
  firstResults: FirstFinalization['result'][];
  query: string;
  partition?: 'all' | 'presales' | 'execution';
  regions?: string[];
  stages?: string[];
  owners?: string[];
  exceptionOnly?: boolean;
  budgetCurrency?: BudgetCurrency;
}
export interface ManagementBusinessView {
  businessId: string;
  opportunityId: string;
  projectIds: string[];
  partition: 'presales' | 'execution';
  progress: LifecycleProgressView;
  slowestProjectId: string | null;
  incomplete: boolean;
  sourceHref: string;
}
export interface ManagementBoardView {
  filters: ManagementBoardFilters;
  businessCount: number;
  projectCount: number;
  pendingReviewCount: number;
  businesses: ManagementBusinessView[];
  projects: {
    projectId: string;
    businessId: string;
    progress: LifecycleProgressView;
    sourceHref: string;
  }[];
  topFive: {
    businessId: string;
    grade: string | null;
    capacity: number | null;
    capacityUnit: string | null;
    deadlineDate: string | null;
    startDate?: string | null;
    timelineLabel?: string;
    ownerName?: string | null;
    progressLabel?: string;
    sourceHref: string;
  }[];
  exceptions: {
    id: string;
    businessId: string;
    projectId: string | null;
    reason: string;
    owner: V9Person | null;
    sourceHref: string;
    category?: 'delivery' | 'solution-overdue' | 'over-budget' | 'missing';
    date?: string | null;
    daysOverdue?: number | null;
    sourceLabel?: string;
  }[];
  departmentItems: CompleteWorkItemView[];
  firstResults: { result: FirstFinalization['result']; businessIds: string[]; count: number }[];
  firstResultDenominator: number;
  budgets: BudgetComparisonView[];
}
export interface V9OperationContext extends V9Target {
  operationId: string;
}
/** 回调只接收操作意图；实际操作者由Store身份取得，不由页面冒填。 */
export type V9ModuleCommands = {
  [K in keyof V9SolutionCommandInputs]: (
    input: V9SolutionCommandInputs[K],
    context: V9OperationContext,
  ) => V9CommandResult | Promise<V9CommandResult>;
};
/** 查询实现随所属业务票交付；B01冻结调用边界，不提供虚构的业务算法。 */
export interface V9ModuleQueries {
  selectSolutionWorkspace(
    state: Readonly<import('./models').DemoState>,
    opportunityId: string,
    availability: Readonly<Record<string, FileAvailability>>,
  ): SolutionWorkspaceView;
  selectQuoteSolutionBasis(
    state: Readonly<import('./models').DemoState>,
    quoteVersionId: string,
    availability: Readonly<Record<string, FileAvailability>>,
  ): QuoteSolutionBasisView;
  selectLifecycleProgress(
    state: Readonly<import('./models').DemoState>,
    businessId: string,
    projectId: string | null,
    dates: V9Dates,
  ): LifecycleProgressView;
  selectBudgetComparison(
    state: Readonly<import('./models').DemoState>,
    projectId: string,
  ): BudgetComparisonView[];
  selectCompleteWorkItems(
    state: Readonly<import('./models').DemoState>,
    dates: V9Dates,
  ): CompleteWorkItemView[];
  selectManagementBoard(
    state: Readonly<import('./models').DemoState>,
    filters: ManagementBoardFilters,
    dates: V9Dates,
    availability: Readonly<Record<string, FileAvailability>>,
  ): ManagementBoardView;
}
