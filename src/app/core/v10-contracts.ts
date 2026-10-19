import type { FileAvailability, V9Dates } from './v9-contracts';

/** 增量身份契约；完整B基线在G0前尚未冻结。 */
export const V10_IDENTITY_CONTRACT_VERSION = 'v10-identity-1';
export type V10SourceStatus = 'ready' | 'empty' | 'loading' | 'unavailable';
export type V10IdentityDomain = 'projects' | 'customers' | 'opportunities';
export interface V10QueryContext {
  workspaceId: string;
  roundId: string;
  dataVersion: number | null;
  contextRevision: string;
  dates: V9Dates & { lastSuccessfulReadAt: string | null };
  fileAvailability: Readonly<Record<string, FileAvailability>>;
  sources: Readonly<
    Record<V10IdentityDomain, V10SourceStatus> & {
      finance?: V10SourceStatus;
      solutions?: V10SourceStatus;
      workItems?: V10SourceStatus;
    }
  >;
}
export interface V10SourceIssue {
  id: string;
  category: 'missing' | 'ambiguous' | 'conflicting' | 'unavailable' | 'invalid';
  objectType: 'project' | 'customer' | 'opportunity' | 'context';
  objectId: string | null;
  /** 可定位的问题字段或来源域，不依赖展示文案判定失败范围。 */
  field: string;
  reason: string;
  sourceHref: string | null;
}
export interface V10ProjectIdentity {
  projectId: string | null;
  name: string;
  customerId: string | null;
  opportunityId: string | null;
  sourceHref: string | null;
  issues: V10SourceIssue[];
}
export interface V10CustomerProjectGroup {
  customerId: string;
  name: string;
  sourceHref: string;
  projects: V10ProjectIdentity[];
  projectCount: number;
  opportunities: { opportunityId: string; projectIds: string[]; sourceHref: string }[];
}
export interface V10ProjectIdentityResult {
  contractVersion: string;
  workspaceId: string;
  roundId: string;
  dataVersion: number | null;
  contextRevision: string;
  dates: V10QueryContext['dates'];
  sources: V10QueryContext['sources'];
  status: V10SourceStatus;
  scope: 'saved-projects';
  filters: Record<string, never>;
  units: { projects: 'project'; customers: 'customer'; opportunities: 'opportunity' };
  counts: {
    projectCount: number;
    customerCount: number | null;
    groupedProjectCount: number;
    pendingProjectCount: number;
    unidentifiedRecordCount: number;
  } | null;
  customers: V10CustomerProjectGroup[] | null;
  pending: V10ProjectIdentity[] | null;
  issues: V10SourceIssue[];
}
export { selectV10ProjectIdentity } from './management-v10/identity';

/** 01-02增量契约；后续Board组合复用同一分区与生命周期结果。 */
export const V10_PORTFOLIO_CONTRACT_VERSION = 'v10-portfolio-1';
export type V10ExecutionScope = 'active' | 'completed' | 'cancelled';
export type V10PresalesScope = 'pipeline' | 'won' | 'lost' | 'converted' | 'all';
export type V10PipelineStage = '意向沟通' | '洽谈' | '方案报价' | '合同谈判';
export interface V10PortfolioFilters {
  presalesScope?: V10PresalesScope;
  executionScope?: V10ExecutionScope | 'all';
}
export interface V10OpportunitySummary {
  opportunityId: string | null;
  customerId: string | null;
  name: string;
  stage: string | null;
  salesResult: 'open' | 'won' | 'lost' | 'pending';
  convertedToProject: boolean | null;
  projects: { projectId: string; name: string; sourceHref: string }[];
  progress: import('./v9-contracts').LifecycleProgressView | null;
  incomplete: boolean;
  sourceHref: string | null;
  issues: V10SourceIssue[];
}
export interface V10ExecutionProject extends V10ProjectIdentity {
  executionScope: V10ExecutionScope;
  progressVersion: 'v9.1';
  progress: import('./v9-contracts').LifecycleProgressView | null;
  incomplete: boolean;
}
export interface V10PortfolioResult extends Pick<
  V10ProjectIdentityResult,
  'workspaceId' | 'roundId' | 'dataVersion' | 'contextRevision' | 'dates' | 'sources' | 'units'
> {
  contractVersion: string;
  scope: 'business-portfolio';
  filters: Required<V10PortfolioFilters>;
  issues: V10SourceIssue[];
  presales: {
    status: V10SourceStatus;
    counts: {
      opportunityCount: number;
      pipelineCount: number;
      stages: Record<V10PipelineStage, number>;
      wonCount: number;
      lostCount: number;
      unknownStageCount: number;
      convertedCount: number | null;
      matchedCount: number;
    } | null;
    opportunities: V10OpportunitySummary[] | null;
  };
  execution: {
    status: V10SourceStatus;
    counts: {
      projectCount: number;
      activeCount: number;
      completedCount: number;
      cancelledCount: number;
      matchedCount: number;
    } | null;
    projects: V10ExecutionProject[] | null;
    unidentified: V10ProjectIdentity[] | null;
  };
}
export { selectV10Portfolio } from './management-v10/portfolio';

/** 01-03增量只读契约；留存适配在01-04交付，完整B尚未冻结。 */
export const V10_DELIVERY_CONTRACT_VERSION = 'v10-delivery-2';
export type V10DeliveryStatus = 'delayed' | 'warning' | 'pending' | 'normal';
export interface V10DeliveryNode {
  mappingId: string;
  projectId: string;
  planId: string;
  customerMilestoneId: string;
  category: 'shipment' | 'customerAcceptance';
  source: string;
  mappingRevision: number;
  sourceState: 'current' | 'cancelled' | 'deleted' | 'changed' | 'unverified';
  promiseOrigin: 'live' | 'retained' | 'unverified';
  retainedDataVersion: number | null;
  name: string;
  owner: string;
  promisedDate: string | null;
  warningLeadDays: number | null;
  warningStart: string | null;
  actualDate: string | null;
  completionValid: boolean;
  evidence: { kind: string; id: string; sourceHref: string | null }[];
  status: V10DeliveryStatus | 'completed';
  overdueCompleted: boolean;
  completedLateDays: number | null;
  delayedDays: number | null;
  daysUntilDue: number | null;
  daysInWarning: number | null;
  dueToday: boolean;
  incomplete: boolean;
  issues: string[];
  reason: string;
  sourceHref: string | null;
  milestoneHref: string | null;
}
export interface V10ProjectDeliveryResult extends Pick<
  V10ProjectIdentityResult,
  'workspaceId' | 'roundId' | 'dataVersion' | 'contextRevision' | 'dates' | 'sources'
> {
  contractVersion: string;
  scope: 'project-delivery';
  projectId: string;
  status: V10SourceStatus;
  executionScope: V10ExecutionScope | null;
  issues: V10SourceIssue[];
  delivery: {
    status: V10DeliveryStatus;
    incomplete: boolean;
    issues: string[];
    reason: string;
    nodes: V10DeliveryNode[];
    nextNode: V10DeliveryNode | null;
    historicalLateCompletions: V10DeliveryNode[];
  } | null;
}
export { selectV10ProjectDelivery } from './management-v10/delivery';

/** 01-05整月确认指标增量契约；预算／合同财务由01-06扩展。 */
export const V10_FINANCE_CONTRACT_VERSION = 'v10-finance-2';
export type V10FinanceCurrency = 'CNY' | 'EUR' | 'USD';
export interface V10FinanceFact {
  factId: string;
  projectId: string;
  currency: V10FinanceCurrency;
  month: string;
  revenueMinor: number | null;
  grossProfitMinor: number | null;
}
export interface V10FinanceBatch {
  batchId: string;
  source: string;
  primaryCurrency: V10FinanceCurrency;
  periodStart: string;
  periodEnd: string;
  latestClosedMonth: string;
  projects: {
    projectId: string;
    currency: V10FinanceCurrency | null;
    months: string[];
    completeness: 'complete' | 'partial' | 'missing';
  }[];
  facts: V10FinanceFact[];
}
export interface V10FinanceFilters {
  batchId?: string;
  currency?: V10FinanceCurrency;
  periodStart?: string;
  periodEnd?: string;
  asOf?: string;
  customerId?: string;
  projectId?: string;
  keyword?: string;
}
export interface V10FinanceMetrics {
  revenueMinor: number | null;
  grossProfitMinor: number | null;
  grossMargin: number | null;
  marginReason: string | null;
  complete: boolean;
  projectIds: string[];
  coverage: { complete: number; total: number };
  issues: string[];
}
export interface V10ContractFinance {
  status: V10SourceStatus;
  issues: string[];
  invoices: {
    invoiceId: string;
    contractId: string;
    projectIds: string[];
    currency: string;
    invoiceMinor: number | null;
    receivedMinor: number | null;
    balanceMinor: number | null;
    collectionRatio: number | null;
    allocation: '合同口径，未提供项目分摊依据';
    issued: string;
    due: string;
    sourceHref: string;
    issues: string[];
  }[];
  totals: {
    currency: string;
    invoiceMinor: number | null;
    receivedMinor: number | null;
    balanceMinor: number | null;
    collectionRatio: number | null;
    complete: boolean;
  }[];
}
export interface V10FinanceDetails {
  budget: import('./v9-contracts').BudgetComparisonView[];
  issues: string[];
  sourceHref: string | null;
  snapshot: {
    scope: string;
    refreshedAt: string;
    expenses: (import('./models').FinanceExpense & {
      amountMinor: number | null;
      issues: string[];
    })[];
    cumulativeCost:
      | (import('./models').ActualCostSnapshot & { amountMinor: number | null; issues: string[] })
      | null;
    sales:
      | (import('./models').FinanceIndicatorSnapshot & {
          salesMinor: number | null;
          label: '销售额（不是已确认收入）';
          issues: string[];
        })
      | null;
    legacyInvoices: import('./models').FinanceInvoice[];
  } | null;
  finalCosts: (import('./models').FinalActualCost & {
    amountMinor: number | null;
    current: boolean;
    issues: string[];
  })[];
}
export interface V10FinanceProject extends V10FinanceMetrics {
  details: V10FinanceDetails;
  projectId: string;
  name: string | null;
  customerId: string | null;
  currency: V10FinanceCurrency | null;
  sourceHref: string | null;
  months: {
    month: string;
    factIds: string[];
    revenueMinor: number | null;
    grossProfitMinor: number | null;
    complete: boolean;
    issues: string[];
  }[];
}
export interface V10FinanceResult extends Pick<
  V10ProjectIdentityResult,
  'workspaceId' | 'roundId' | 'dataVersion' | 'contextRevision' | 'dates' | 'sources'
> {
  contractVersion: string;
  scope: 'finance';
  status: V10SourceStatus;
  source: string | null;
  batchId: string | null;
  currency: V10FinanceCurrency | null;
  units: { amount: 'minor'; rate: 'ratio' };
  filters: V10FinanceFilters;
  period: { periodStart: string; periodEnd: string; asOf: string } | null;
  resetReasons: string[];
  issues: string[];
  contractFinance: V10ContractFinance | null;
  summary: V10FinanceMetrics | null;
  projects: V10FinanceProject[] | null;
  months:
    | (V10FinanceMetrics & {
        month: string;
        comparison: {
          comparable: boolean;
          grossProfitChangeMinor: number | null;
          reason: string | null;
        };
      })[]
    | null;
}
export interface V10ProjectFinanceResult extends Omit<V10FinanceResult, 'scope'> {
  scope: 'project-finance';
  projectId: string;
  project: V10FinanceProject | null;
}
export { selectV10Finance, selectV10ProjectFinance } from './management-v10/finance';

/** 01-07组合查询增量；部门与协作由01-08补齐，G0尚未冻结。 */
export const V10_BOARD_CONTRACT_VERSION = 'v10-board-2';
export interface V10BoardFilters {
  bottom?: { department?: V10Department; firstResult?: V10FirstResult };
  presales?: { scope?: V10PresalesScope; stage?: V10PipelineStage; keyword?: string };
  execution?: { scope?: V10ExecutionScope | 'all'; status?: V10DeliveryStatus; keyword?: string };
}
export interface V10BoardProject extends V10ExecutionProject {
  grade: 'S' | 'A' | 'B1' | 'B2' | null;
  gradeIssue: string | null;
  gradeSource: { opportunityId: string; sourceHref: string } | null;
  delivery: V10ProjectDeliveryResult['delivery'];
  selectionReason: 'grade' | 'delivery-risk' | null;
}
export interface V10BoardCustomerGroup<T> {
  customerId: string;
  name: string;
  sourceHref: string;
  items: T[];
  count: number;
  distribution: Record<string, number>;
  abnormalCount: number;
  pendingCount: number;
}
export interface V10BoardList<T> {
  status: V10SourceStatus;
  matchedCount: number | null;
  customers: V10BoardCustomerGroup<T>[] | null;
  pending: T[] | null;
}
export interface V10BoardResult extends Pick<
  V10ProjectIdentityResult,
  'workspaceId' | 'roundId' | 'dataVersion' | 'contextRevision' | 'dates' | 'sources' | 'units'
> {
  contractVersion: string;
  scope: 'management-board';
  filters: {
    bottom: NonNullable<V10BoardFilters['bottom']>;
    presales: Required<Pick<NonNullable<V10BoardFilters['presales']>, 'scope' | 'keyword'>> &
      Pick<NonNullable<V10BoardFilters['presales']>, 'stage'>;
    execution: Required<Pick<NonNullable<V10BoardFilters['execution']>, 'scope' | 'keyword'>> &
      Pick<NonNullable<V10BoardFilters['execution']>, 'status'>;
  };
  issues: V10SourceIssue[];
  overview: {
    presales: V10PortfolioResult['presales'];
    execution: Pick<V10PortfolioResult['execution'], 'status' | 'counts'> & {
      distribution: Record<V10DeliveryStatus, number> | null;
    };
    finance: V10FinanceResult;
  };
  presales: V10BoardList<V10OpportunitySummary>;
  execution: V10BoardList<V10BoardProject> & { unidentified: V10ProjectIdentity[] | null };
  bottom: V10BoardBottom;
  highlights: {
    status: V10SourceStatus;
    highGrade: V10BoardProject[] | null;
    abnormal: V10BoardProject[] | null;
  };
}
export { selectV10Board } from './management-v10/board';

export type V10Department = import('./v9-contracts').CompleteWorkItemView['department'];
export type V10FirstResult =
  'early' | 'on-time' | 'late' | 'historical-unscored' | 'not-finalized' | 'pending';
export type V10WorkItem = Omit<import('./v9-contracts').CompleteWorkItemView, 'status'> & {
  status: 'open' | 'completed' | 'pending';
  projectIds: string[];
};
export interface V10DepartmentResult {
  status: V10SourceStatus;
  summary:
    | {
        department: V10Department;
        total: number;
        completed: number;
        open: number;
        overdueOpen: number;
        pending: number;
      }[]
    | null;
  items: V10WorkItem[] | null;
  collaboration:
    { projectId: string; name: string; sourceHref: string; items: V10WorkItem[] }[] | null;
}
export interface V10FirstResultItem {
  id: string;
  eventId: string | null;
  opportunityIds: string[];
  projectIds: string[];
  result: V10FirstResult;
  deadlineDate: string | null;
  businessDate: string | null;
  owner: import('./v9-contracts').V9Person | null;
  sourceHref: string | null;
  issues: string[];
}
export interface V10BoardBottom {
  scope: 'workspace-business-sources';
  issues: V10SourceIssue[];
  departments: V10DepartmentResult;
  firstFinalizations: {
    status: V10SourceStatus;
    denominator: number | null;
    counts: Record<V10FirstResult, number> | null;
    items: V10FirstResultItem[] | null;
  };
}

export const V10_EXCEPTIONS_CONTRACT_VERSION = 'v10-exceptions-1';
export type V10ManagementCategory =
  | 'internal-delay'
  | 'solution-overdue'
  | 'over-budget'
  | 'budget-incomparable'
  | 'solution-data'
  | 'data-review';
export interface V10ExceptionsFilters {
  tab?: 'delivery' | 'management';
  scope?: V10ExecutionScope | 'all';
  status?: V10DeliveryStatus;
  category?: V10ManagementCategory;
  department?: V10Department;
  customerId?: string;
  projectId?: string;
  opportunityId?: string;
  grade?: string;
  owner?: string;
  keyword?: string;
}
export interface V10ManagementIssue {
  id: string;
  category: V10ManagementCategory;
  sourceType: 'solution' | 'plan' | 'budget' | 'project' | 'association';
  sourceRecordId: string;
  opportunityIds: string[];
  projectIds: string[];
  customerIds: string[];
  grade: string | null;
  owner: import('./v9-contracts').V9Person | null;
  department: V10Department;
  date: string | null;
  daysOverdue: number | null;
  budget: import('./v9-contracts').BudgetComparisonView | null;
  reasons: string[];
  sourceHref: string | null;
}
export interface V10ExceptionsResult extends Pick<
  V10ProjectIdentityResult,
  'workspaceId' | 'roundId' | 'dataVersion' | 'contextRevision' | 'dates' | 'sources'
> {
  contractVersion: string;
  scope: 'management-exceptions';
  status: V10SourceStatus;
  filters: V10ExceptionsFilters & {
    tab: 'delivery' | 'management';
    scope: V10ExecutionScope | 'all';
    keyword: string;
  };
  units: { delivery: 'project'; management: 'item' };
  issues: V10SourceIssue[];
  delivery: {
    projectCount: number;
    distribution: Record<V10DeliveryStatus, number>;
    projects: V10BoardProject[];
  } | null;
  management: {
    itemCount: number;
    projectCount: number;
    opportunityCount: number;
    items: V10ManagementIssue[];
  } | null;
}
export { selectV10Exceptions } from './management-v10/exceptions';

/** 02-01公共读取平台；G0前增量发布。 */
export { createV10ReadSession } from './management-v10-platform/read-session';
export type { V10ReadInput, V10ReadSnapshot } from './management-v10-platform/read-session';
export { buildV10Target, openV10Target } from './management-v10-platform/navigation';
export type { V10Target, V10BuiltTarget } from './management-v10-platform/navigation';
