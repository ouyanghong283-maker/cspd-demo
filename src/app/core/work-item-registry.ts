/**
 * Stable, source-owned contract for a unified work list.
 * Business modules provide adapters; aggregation never invents tasks or owners.
 */

export type WorkItemStatus = 'open' | 'completed';

/**
 * V8 08-03：同一事项的预警呈现。挂在既有事项上，不新增第二条任务，
 * 因此普通待办与预警永远不会重复计数。
 */
export interface WorkItemWarning {
  read?: boolean;
  warningId: string;
  level: 'yellow' | 'red';
  label: string;
  /** 接收人的稳定身份键；只用于按人投影，不改派负责人。 */
  recipientKeys: readonly string[];
  /** 接收人展示名，同一人兼任已去重。 */
  recipients: readonly string[];
  /** 需要补录的字段，含未知负责人/PM。 */
  missing: readonly string[];
}

export interface WorkItemInput {
  /** Stable ID in the source domain (for example, a plan ID or contract ID). */
  sourceRecordId: string;
  title: string;
  department: string;
  /** Original business owner. Completing an item must not rewrite this value. */
  owner: string;
  ownerPersonId?: string;
  status: WorkItemStatus;
  dueDate?: string;
  href?: string;
  projectId?: string;
  handoffTo?: string;
  planId?: string;
  /** 当前临期/逾期时的预警投影；解除后自动消失。 */
  warning?: WorkItemWarning;
}

export interface WorkItem extends WorkItemInput {
  /** Registry-generated deterministic ID, stable for a source and source record. */
  id: string;
  sourceId: string;
  completedBy?: string;
  completedAt?: string;
}

export interface WorkItemSourceAdapter {
  /** Unique, stable key for the business module that owns these records. */
  sourceId: string;
  listWorkItems: () => readonly WorkItemInput[];
}

export interface WorkItemCounts {
  total: number;
  open: number;
  completed: number;
  byDepartment: Readonly<Record<string, number>>;
}

export interface WorkItemView {
  /** The single collection from which both the list and all counts are derived. */
  items: WorkItem[];
  counts: WorkItemCounts;
}

/** Length-prefixing makes IDs deterministic without separator-collision risk. */
export function workItemId(sourceId: string, sourceRecordId: string): string {
  if (!sourceId.trim()) throw new Error('工作项来源ID不能为空');
  if (!sourceRecordId.trim()) throw new Error('工作项来源记录ID不能为空');
  return `work:${sourceId.length}:${sourceId}:${sourceRecordId.length}:${sourceRecordId}`;
}

export class WorkItemRegistry {
  private readonly sources = new Map<string, WorkItemSourceAdapter>();

  register(adapter: WorkItemSourceAdapter): void {
    const sourceId = adapter.sourceId.trim();
    if (!sourceId) throw new Error('工作项来源ID不能为空');
    if (this.sources.has(sourceId)) throw new Error(`工作项来源重复注册：${sourceId}`);
    this.sources.set(sourceId, { ...adapter, sourceId });
  }

  registeredSourceIds(): string[] {
    return [...this.sources.keys()];
  }

  collect(): WorkItem[] {
    const items: WorkItem[] = [];
    const ids = new Set<string>();
    for (const [sourceId, adapter] of this.sources) {
      for (const input of adapter.listWorkItems()) {
        const id = workItemId(sourceId, input.sourceRecordId);
        if (ids.has(id)) throw new Error(`同一工作项来源返回重复记录：${id}`);
        ids.add(id);
        items.push({ ...input, id, sourceId });
      }
    }
    return items;
  }

  /** Return one snapshot for views, departments, and counts to share. */
  view(): WorkItemView {
    return workItemView(this.collect());
  }
}

/** Build counts from the exact item collection a consumer is displaying. */
export function workItemView(items: WorkItem[]): WorkItemView {
  const byDepartment: Record<string, number> = {};
  let open = 0;
  let completed = 0;
  for (const item of items) {
    if (item.status === 'open') open += 1;
    else completed += 1;
    byDepartment[item.department] = (byDepartment[item.department] || 0) + 1;
  }
  return { items, counts: { total: items.length, open, completed, byDepartment } };
}

/** Work completion is independent of notification reading and keeps ownership. */
export function completeWorkItem(
  item: WorkItem,
  completedBy: string,
  completedAt: string,
): WorkItem {
  return { ...item, status: 'completed', completedBy, completedAt };
}

export interface WorkNotice {
  id: string;
  workItemId: string;
  read: boolean;
}

/** Marking a notice read only updates notification state; it cannot complete work. */
export function markWorkNoticeRead(notice: WorkNotice): WorkNotice {
  return { ...notice, read: true };
}

export interface FinanceBalance {
  currency: string;
  amount: number;
}

export type FinanceSummaryResult =
  | { status: 'available'; sourceId: string; balances: FinanceBalance[]; asOf?: string }
  | { status: 'missing'; sourceId: string; reason: string }
  | { status: 'unavailable'; sourceId: string; reason: string };

export interface FinanceSummarySource {
  sourceId: string;
  getSummary: () => FinanceSummaryResult;
}

/**
 * Keep source statuses visible and do not turn missing data into zero balances.
 * This layer intentionally does not combine currencies or source totals.
 */
export function collectFinanceSummaries(
  sources: readonly FinanceSummarySource[],
): FinanceSummaryResult[] {
  const sourceIds = new Set<string>();
  return sources.map((source) => {
    if (!source.sourceId.trim()) throw new Error('财务摘要来源ID不能为空');
    if (sourceIds.has(source.sourceId)) throw new Error(`财务摘要来源重复注册：${source.sourceId}`);
    sourceIds.add(source.sourceId);
    const summary = source.getSummary();
    if (summary.sourceId !== source.sourceId) {
      throw new Error(`财务摘要来源ID不匹配：${source.sourceId}`);
    }
    if (summary.status === 'available') {
      return { ...summary, balances: summary.balances.map((balance) => ({ ...balance })) };
    }
    return { ...summary };
  });
}
