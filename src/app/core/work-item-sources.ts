import { knownProjectPersonId } from './plan-person';
import { planTarget } from './plan-warning';
import { isPlanWarningRead } from './plan-warnings';
import { DemoState, Project, SalesRecord } from './models';
import { BASE_DATE } from './models';
import { summarizeInvoicesByCurrency } from './invoices';
import { collectPlanWarnings, PlanWarning, planWarningPersonKey } from './plan-warnings';
import { observationDateForMode } from './rules';
import { startupDepartmentParam } from './project-startup';
import {
  collectFinanceSummaries,
  FinanceSummaryResult,
  WorkItemInput,
  WorkItemRegistry,
  WorkItemView,
  WorkItemWarning,
  workItemView,
} from './work-item-registry';

/**
 * Public V7 aggregation contract. Homepage, department views, and navigation
 * badges call this with the same persisted snapshot so IDs and counts agree.
 * Notifications are intentionally excluded: reading a notice is not completing work.
 *
 * 08-03：临期/逾期计划在同一事项上附带预警投影（负责人与PM按稳定身份接收），
 * 不新增第二条任务，总数与普通待办一致。
 */
export function collectDemoWorkItems(
  state: DemoState,
  person?: string,
  observationDate = defaultObservationDate(state),
  includeCompletedPlans = false,
): WorkItemView {
  const registry = new WorkItemRegistry();
  registerProjectWorkSources(registry, state, observationDate, person, includeCompletedPlans);
  registry.register({
    sourceId: 'department-task',
    listWorkItems: () =>
      state.sales.flatMap((sale) =>
        (sale.departmentTasks || []).map((task) => departmentTaskItem(state, sale, task)),
      ),
  });
  const view = registry.view();
  if (!person?.trim()) return view;
  const viewer = person.trim();
  const personKey = planWarningPersonKey(viewer);
  const responsibleItems = view.items.filter(
    (item) =>
      item.owner.split('、').some((owner) => owner.trim() === viewer) ||
      !!item.warning?.recipientKeys.includes(personKey) ||
      (!!item.projectId &&
        item.ownerPersonId ===
          knownProjectPersonId(
            state.projects.find((project) => project.id === item.projectId)!,
            viewer,
          )),
  );
  return workItemView(responsibleItems);
}

/** 未显式传入观察日时按当前档位推导，保证各视图引用同一日期。 */
export function defaultObservationDate(state: DemoState): string {
  return observationDateForMode(state.dateMode || 'normal');
}

/** Shared project board subset; IDs match items in the global work view. */
export function collectDemoProjectWorkItems(
  state: DemoState,
  observationDateOrReader = defaultObservationDate(state),
): WorkItemView {
  const isDate = /^\d{4}-\d{2}-\d{2}$/.test(observationDateOrReader);
  const reader = isDate ? undefined : observationDateOrReader;
  const date = isDate ? observationDateOrReader : defaultObservationDate(state);
  const view = collectDemoWorkItems(state, undefined, date);
  for (const item of view.items) {
    if (!reader || !item.warning || !item.projectId) continue;
    const project = state.projects.find((candidate) => candidate.id === item.projectId)!;
    const personKey = knownProjectPersonId(project, reader);
    if (!personKey || !item.warning.recipientKeys.includes(personKey)) item.warning = undefined;
    else item.warning.read = isPlanWarningRead(state, personKey, item.warning.warningId);
  }
  return workItemView(view.items.filter((item) => !!item.projectId));
}

/** Summarize only persisted local invoice snapshots, keeping currencies separate. */
export function collectDemoFinanceSummaries(state: DemoState): FinanceSummaryResult[] {
  const unresolvedInvoices = (state.migrationReviewItems || []).filter(
    (item) => item.entityType === 'invoice',
  );
  const usesContractInvoices =
    unresolvedInvoices.length > 0 || (state.contractInvoices || []).length > 0;
  const sourceId = usesContractInvoices ? 'contract-invoices' : 'project-finance-snapshots';
  return collectFinanceSummaries([
    {
      sourceId,
      getSummary: () => {
        if (unresolvedInvoices.length)
          return {
            status: 'unavailable',
            sourceId,
            reason: `有${unresolvedInvoices.length}项历史发票关联待核，暂不能提供可信的统一余额汇总。`,
          };
        const canonical = state.contractInvoices || [];
        if (canonical.length) {
          if (canonical.some((invoice) => !invoice.id.trim()))
            return {
              status: 'unavailable',
              sourceId,
              reason: '存在缺少稳定发票ID的记录，无法安全去重汇总。',
            };
          const totals = summarizeInvoicesByCurrency(
            canonical,
            state.invoiceReceiptClaims || [],
            BASE_DATE,
          );
          return {
            status: 'available',
            sourceId,
            balances: totals.map(({ currency, balance }) => ({ currency, amount: balance })),
            asOf: canonical
              .map((invoice) => invoice.updatedAt)
              .filter(Boolean)
              .sort()
              .at(-1),
          };
        }
        const snapshots = [...(state.financeSnapshots || [])].sort((left, right) =>
          left.refreshedAt.localeCompare(right.refreshedAt),
        );
        const invoicesById = new Map<string, (typeof snapshots)[number]['invoices'][number]>();
        for (const snapshot of snapshots) {
          for (const invoice of snapshot.invoices || []) {
            if (!invoice.id.trim()) {
              return {
                status: 'unavailable',
                sourceId,
                reason: '存在缺少稳定发票ID的记录，无法安全去重汇总。',
              };
            }
            invoicesById.set(invoice.id, invoice);
          }
        }
        const invoices = [...invoicesById.values()];
        if (!invoices.length) {
          return {
            status: 'missing',
            sourceId,
            reason: '当前没有可汇总的项目发票记录；财务摘要待提供。',
          };
        }
        const balances = new Map<string, number>();
        for (const invoice of invoices) {
          balances.set(
            invoice.currency,
            (balances.get(invoice.currency) || 0) + invoice.amount - invoice.received,
          );
        }
        return {
          status: 'available',
          sourceId,
          balances: [...balances].map(([currency, amount]) => ({ currency, amount })),
          asOf: (state.financeSnapshots || [])
            .map((snapshot) => snapshot.refreshedAt)
            .sort()
            .at(-1),
        };
      },
    },
  ]);
}

function registerProjectWorkSources(
  registry: WorkItemRegistry,
  state: DemoState,
  observationDate: string,
  reader?: string,
  includeCompletedPlans = false,
): void {
  const warningByPlan = new Map<string, PlanWarning>(
    collectPlanWarnings(state, observationDate).map((warning) => [
      `${warning.projectId}:${warning.planId}`,
      warning,
    ]),
  );
  registry.register({
    sourceId: 'project-plan',
    listWorkItems: () =>
      state.projects.flatMap((project) =>
        project.plans
          .filter((plan) => plan.status !== '已取消' && (includeCompletedPlans || plan.status !== '已完成'))
          .map((plan) => ({
            sourceRecordId: `${project.id}:${plan.id}`,
            title: `${project.name}：${plan.name}`,
            department: 'PMO / PM',
            owner: plan.owner || '负责人待核',
            ownerPersonId: knownProjectPersonId(project, plan.owner, plan.ownerPersonId),
            planId: plan.id,
            status: (plan.status === '已完成' ? 'completed' : 'open') as 'completed' | 'open',
            dueDate: validDate(
              plan.type === '内部WBS' || plan.type === '客户主节点' ? plan.end : plan.expected,
            )
              ? plan.type === '内部WBS' || plan.type === '客户主节点'
                ? plan.end
                : plan.expected
              : undefined,
            href: planTarget(project.id, plan),
            projectId: project.id,
            warning: warningAnnotation(
              warningByPlan.get(`${project.id}:${plan.id}`),
              state,
              reader,
            ),
          })),
      ),
  });
  registry.register({
    sourceId: 'project-startup-handover',
    listWorkItems: () =>
      state.projects
        .filter((project) => project.briefing.startupHandover?.status === '待移交')
        .map((project) => ({
          sourceRecordId: project.id,
          title: `${project.name}：启动移交待接收`,
          department: 'PMO / PM',
          owner: project.briefing.startupHandover?.receiver || '接收人待核',
          status: 'open' as const,
          projectId: project.id,
          href:
            `/projects/${encodeURIComponent(project.id)}?tab=startup` +
            `&dept=${encodeURIComponent(startupDepartmentParam('pm'))}&action=handover`,
        })),
  });
}

function departmentTaskItem(
  state: DemoState,
  sale: SalesRecord,
  task: NonNullable<SalesRecord['departmentTasks']>[number],
): WorkItemInput {
  const assignedMember = sale.team.find((member) => task.id === `DEPT-${member.id}`);
  return {
    sourceRecordId: `${sale.id}:${task.id}`,
    title: `${sale.projectName || sale.id}：${task.name}`,
    department: task.department || '未分配部门',
    owner: assignedMember?.person || '负责人待核',
    status: task.status === '已完成' ? 'completed' : 'open',
    projectId: state.projects.find((project) => project.opportunityId === sale.id)?.id,
    href: `/sales/detail/${encodeURIComponent(sale.id)}?tab=团队`,
  };
}

function validDate(value: string | undefined): value is string {
  return (
    !!value && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`))
  );
}

/** 预警是同一事项的呈现；此处只附带展示与按人投影所需的字段。 */
function warningAnnotation(
  warning: PlanWarning | undefined,
  state: DemoState,
  reader?: string,
): WorkItemWarning | undefined {
  if (!warning || !warning.recipients.length) return undefined;
  if (
    reader &&
    !warning.recipients.some((person) => person.personKey === planWarningPersonKey(reader))
  )
    return undefined;
  return {
    read: !!reader && isPlanWarningRead(state, planWarningPersonKey(reader), warning.id),
    warningId: warning.id,
    level: warning.level,
    label: warning.label,
    recipientKeys: warning.recipients.map((recipient) => recipient.personKey),
    recipients: warning.recipients.map((recipient) => recipient.person),
    missing: warning.missing,
  };
}
