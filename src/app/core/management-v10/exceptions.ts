import type { DemoState } from '../models';
import type {
  V10ExceptionsFilters,
  V10ExceptionsResult,
  V10ManagementIssue,
  V10QueryContext,
} from '../v10-contracts';
import { V10_EXCEPTIONS_CONTRACT_VERSION } from '../v10-contracts';
import { isValidISODate, planRisk } from '../rules';
import { selectSolutionWorkspace } from '../v9-queries';
import { managementDepartment } from '../management-statistics';
import { selectV10Board } from './board';
import { selectV10Portfolio } from './portfolio';
import { selectV10ProjectDelivery } from './delivery';
import { selectFinanceDetails } from './finance-details';
import { readManagementSources } from './management-sources';
import { indexById } from './identity-index';

const overdueDays = (due: string, today: string) =>
  Math.max(0, Math.round((Date.parse(today) - Date.parse(due)) / 86400000));
const gradeRank = (grade: string | null) => {
  const i = ['S', 'A', 'B1', 'B2'].indexOf(grade ?? '');
  return i < 0 ? 4 : i;
};

/** 客户交付按项目；其他异常按稳定来源＋问题类别，不复制共享方案或客户交付延期。 */
export function selectV10Exceptions(
  state: Readonly<DemoState>,
  context: V10QueryContext,
  filters: V10ExceptionsFilters = {},
): V10ExceptionsResult {
  const normalized: V10ExceptionsResult['filters'] = {
    ...filters,
    tab: filters.tab ?? 'delivery',
    scope: filters.tab === 'management' ? 'all' : (filters.scope ?? 'active'),
    keyword: filters.keyword?.trim() ?? '',
  };
  const source = readManagementSources(state, context);
  const metadata = {
    contractVersion: V10_EXCEPTIONS_CONTRACT_VERSION,
    scope: 'management-exceptions' as const,
    workspaceId: context.workspaceId,
    roundId: context.roundId,
    dataVersion: context.dataVersion,
    contextRevision: context.contextRevision,
    dates: { ...context.dates },
    sources: { ...context.sources },
    filters: normalized,
    units: { delivery: 'project' as const, management: 'item' as const },
    issues: source.issues,
  };
  const sales = indexById(source.state.sales.filter((s) => s.type === 'opportunity'));
  const customers = indexById(state.customers);
  const keywordMatches = (parts: (string | null | undefined)[]) =>
    parts.some((p) => p?.toLowerCase().includes(normalized.keyword.toLowerCase()));
  if (normalized.tab === 'delivery') {
    const board = selectV10Board(state, context, {
      execution: { scope: normalized.scope, status: normalized.status },
    });
    if (!board.execution.customers)
      return { ...metadata, status: board.execution.status, delivery: null, management: null };
    const projects = [
      ...board.execution.customers.flatMap((g) => g.items),
      ...board.execution.pending!,
    ]
      .filter((p) => {
        const raw = source.state.projects.find((row) => row.id === p.projectId);
        const customer = p.customerId ? customers.get(p.customerId) : null;
        return (
          (!normalized.customerId || p.customerId === normalized.customerId) &&
          (!normalized.projectId || p.projectId === normalized.projectId) &&
          (!normalized.opportunityId || p.opportunityId === normalized.opportunityId) &&
          (!normalized.grade || p.grade === normalized.grade) &&
          (!normalized.owner ||
            raw?.pm === normalized.owner ||
            p.delivery?.nodes.some((n) => n.owner === normalized.owner)) &&
          keywordMatches([
            p.projectId,
            p.name,
            p.opportunityId,
            p.customerId,
            ...(customer?.length === 1 ? [customer[0].name] : []),
          ])
        );
      })
      .sort((a, b) => {
        const ranks = { delayed: 0, warning: 1, pending: 2, normal: 3 };
        return (
          ranks[a.delivery?.status ?? 'pending'] - ranks[b.delivery?.status ?? 'pending'] ||
          (a.delivery?.nextNode?.promisedDate ?? '9999').localeCompare(
            b.delivery?.nextNode?.promisedDate ?? '9999',
          ) ||
          a.projectId!.localeCompare(b.projectId!)
        );
      });
    const distribution = { delayed: 0, warning: 0, pending: 0, normal: 0 };
    for (const p of projects) distribution[p.delivery?.status ?? 'pending']++;
    return {
      ...metadata,
      status: projects.length ? 'ready' : 'empty',
      delivery: { projectCount: projects.length, distribution, projects },
      management: null,
    };
  }
  const statuses = [
    source.projectStatus,
    source.opportunityStatus,
    source.solutionStatus,
    source.workStatus,
    context.sources.finance ?? 'ready',
  ];
  if (statuses.some((s) => !source.readable(s)))
    return {
      ...metadata,
      status: statuses.includes('loading') ? 'loading' : 'unavailable',
      delivery: null,
      management: null,
    };
  const portfolio = selectV10Portfolio(state, context, {
    presalesScope: 'all',
    executionScope: 'all',
  });
  // 商机尚未建立项目时，其客户关联问题也必须进入待核事项。
  const knownIssues = new Set(source.issues.map((i) => i.id));
  for (const issue of portfolio.issues)
    if (!knownIssues.has(issue.id)) {
      source.issues.push(issue);
      knownIssues.add(issue.id);
    }
  const items: V10ManagementIssue[] = [];
  const add = (item: Omit<V10ManagementIssue, 'id' | 'grade' | 'customerIds'>) => {
    const linkedSales = item.opportunityIds.flatMap((id) => sales.get(id) ?? []);
    const grades = new Set(
      linkedSales.map((s) => s.grade).filter((g) => ['S', 'A', 'B1', 'B2'].includes(g)),
    );
    items.push({
      ...item,
      id: JSON.stringify([item.sourceType, item.sourceRecordId, item.category]),
      grade: grades.size === 1 ? [...grades][0] : null,
      customerIds: [...new Set(linkedSales.map((s) => s.customerId))].sort(),
    });
  };
  for (const sale of source.state.sales.filter((s) => s.type === 'opportunity')) {
    const view = selectSolutionWorkspace(source.state, sale.id, context.fileAvailability);
    const schedule = view.workspace?.schedule;
    const due = schedule && isValidISODate(schedule.deadlineDate) ? schedule.deadlineDate : null;
    const reasons: string[] = [];
    const late =
      !!due && due < context.dates.solutionBusinessDate && !view.workspace?.firstFinalization;
    if (late) reasons.push('方案逾期未首次定稿');
    if (view.currentStatus === 'stale') reasons.push('当前资料或需求已变化，待重新定稿');
    const files = view.files.filter((f) => f.availability !== 'present');
    if (files.length)
      reasons.push(
        ...files.map(
          (f) =>
            `${f.kind}资料${f.availability === 'missing' ? '缺失' : f.availability === 'unavailable' ? '暂不可读' : '待核验'}`,
        ),
      );
    if (!schedule?.owner?.personId || !due) reasons.push('方案责任或期限待补');
    if (reasons.length)
      add({
        category: late ? 'solution-overdue' : 'solution-data',
        sourceType: 'solution',
        sourceRecordId: sale.id,
        opportunityIds: [sale.id],
        projectIds: [...(source.projectIdsByOpportunity.get(sale.id) ?? [])],
        owner: schedule?.owner ?? null,
        department: 'solution',
        date: due,
        daysOverdue: late ? overdueDays(due!, context.dates.solutionBusinessDate) : null,
        budget: null,
        reasons,
        sourceHref: `/sales/detail/${encodeURIComponent(sale.id)}?tab=方案`,
      });
  }
  for (const project of source.state.projects) {
    const linked = portfolio.execution.projects?.find((p) => p.projectId === project.id);
    const opportunityIds =
      linked?.opportunityId && !linked.issues.some((i) => !['execution-scope'].includes(i.field))
        ? [linked.opportunityId]
        : [];
    const delivery = selectV10ProjectDelivery(state, context, project.id).delivery;
    const monitored = new Set(
      delivery?.nodes
        .filter((n) => n.promiseOrigin !== 'unverified')
        .flatMap((n) => [n.planId, n.customerMilestoneId]),
    );
    const href = `/projects/${encodeURIComponent(project.id)}`;
    if (!project.pm || linked?.incomplete)
      add({
        category: 'data-review',
        sourceType: 'project',
        sourceRecordId: project.id,
        opportunityIds,
        projectIds: [project.id],
        owner: project.pm ? { personId: project.pmPersonId ?? '', name: project.pm } : null,
        department: 'pm-pmo',
        date: null,
        daysOverdue: null,
        budget: null,
        reasons: [
          ...(!project.pm ? ['项目负责人待补'] : []),
          ...(linked?.incomplete ? ['计分依据待补或关联待核'] : []),
        ],
        sourceHref: href,
      });
    for (const plan of project.plans) {
      if (plan.status === '已取消' || monitored.has(plan.id)) continue;
      const due = ['内部WBS', '客户主节点'].includes(plan.type) ? plan.end : plan.expected;
      const member = project.team.filter((m) =>
        plan.ownerPersonId
          ? [m.id, m.personId].includes(plan.ownerPersonId)
          : m.person === plan.owner,
      );
      const department =
        member.length === 1 ? managementDepartment(member[0].department) : 'unknown';
      const problems = [
        ...(!isValidISODate(due) ? ['计划期限待核'] : []),
        ...(!plan.owner?.trim() ? ['计划责任人待核'] : []),
        ...(plan.status === '已完成' && !isValidISODate(plan.actual) ? ['实际完成日期待核'] : []),
      ];
      const planHref = `${href}?tab=plans&plan=${encodeURIComponent(plan.type)}&planId=${encodeURIComponent(plan.id)}`;
      if (problems.length)
        add({
          category: 'data-review',
          sourceType: 'plan',
          sourceRecordId: JSON.stringify([project.id, plan.id]),
          opportunityIds,
          projectIds: [project.id],
          owner: plan.owner ? { personId: plan.ownerPersonId ?? '', name: plan.owner } : null,
          department,
          date: isValidISODate(due) ? due : null,
          daysOverdue: null,
          budget: null,
          reasons: problems,
          sourceHref: planHref,
        });
      if (!isValidISODate(due) || due >= context.dates.planObservationDate) continue;
      if (planRisk({ ...plan, end: due }, context.dates.planObservationDate).level !== 'red')
        continue;
      add({
        category: 'internal-delay',
        sourceType: 'plan',
        sourceRecordId: JSON.stringify([project.id, plan.id]),
        opportunityIds,
        projectIds: [project.id],
        owner: plan.owner ? { personId: plan.ownerPersonId ?? '', name: plan.owner } : null,
        department,
        date: due,
        daysOverdue: overdueDays(due, context.dates.planObservationDate),
        budget: null,
        reasons: [`内部计划延期：${plan.name}`],
        sourceHref: planHref,
      });
    }
    const details = selectFinanceDetails(state, project.id);
    const budgets = details.budget;
    if (!budgets.length)
      add({
        category: 'budget-incomparable',
        sourceType: 'budget',
        sourceRecordId: JSON.stringify([project.id, null]),
        opportunityIds,
        projectIds: [project.id],
        owner: null,
        department: 'pm-pmo',
        date: null,
        daysOverdue: null,
        budget: null,
        reasons: ['预算或支出来源待补，无可比币种'],
        sourceHref: `${href}?tab=overview&section=${encodeURIComponent('预算费用')}`,
      });
    for (const budget of budgets)
      if (!budget.comparable || (budget.varianceMinor !== null && budget.varianceMinor > 0))
        add({
          category: budget.comparable ? 'over-budget' : 'budget-incomparable',
          sourceType: 'budget',
          sourceRecordId: JSON.stringify([project.id, budget.currency]),
          opportunityIds,
          projectIds: [project.id],
          owner: null,
          department: 'pm-pmo',
          date: budget.cutoff,
          daysOverdue: null,
          budget,
          reasons: [
            budget.comparable
              ? `${budget.currency}已超预算`
              : `${budget.currency}预算不可比：${budget.reason}`,
          ],
          sourceHref: `${href}?tab=overview&section=${encodeURIComponent('预算费用')}`,
        });
  }
  for (const issue of source.issues)
    add({
      category: 'data-review',
      sourceType: 'association',
      sourceRecordId: issue.id,
      opportunityIds: issue.objectType === 'opportunity' && issue.objectId ? [issue.objectId] : [],
      projectIds: issue.objectType === 'project' && issue.objectId ? [issue.objectId] : [],
      owner: null,
      department: 'unknown',
      date: null,
      daysOverdue: null,
      budget: null,
      reasons: [issue.reason],
      sourceHref: issue.sourceHref,
    });
  const order = {
    'internal-delay': 0,
    'solution-overdue': 1,
    'over-budget': 2,
    'budget-incomparable': 3,
    'solution-data': 3,
    'data-review': 3,
  };
  const unique = [...new Map(items.map((i) => [i.id, i])).values()]
    .filter((i) => {
      const projectNames = source.state.projects
        .filter((p) => i.projectIds.includes(p.id))
        .map((p) => p.name);
      const names = i.opportunityIds.flatMap((id) => sales.get(id) ?? []).map((s) => s.projectName);
      const customerNames = i.customerIds.flatMap((id) => {
        const rows = customers.get(id);
        return rows?.length === 1 ? [rows[0].name] : [];
      });
      return (
        (!normalized.category || i.category === normalized.category) &&
        (!normalized.department || i.department === normalized.department) &&
        (!normalized.customerId || i.customerIds.includes(normalized.customerId)) &&
        (!normalized.projectId || i.projectIds.includes(normalized.projectId)) &&
        (!normalized.opportunityId || i.opportunityIds.includes(normalized.opportunityId)) &&
        (!normalized.grade || i.grade === normalized.grade) &&
        (!normalized.owner ||
          i.owner?.name === normalized.owner ||
          i.owner?.personId === normalized.owner) &&
        keywordMatches([
          i.sourceRecordId,
          ...i.opportunityIds,
          ...i.projectIds,
          ...i.customerIds,
          ...i.reasons,
          ...projectNames,
          ...names,
          ...customerNames,
        ])
      );
    })
    .sort(
      (a, b) =>
        order[a.category] - order[b.category] ||
        (a.category === 'over-budget' && b.category === 'over-budget'
          ? (a.budget?.currency ?? '').localeCompare(b.budget?.currency ?? '') ||
            (b.budget?.budgetMinor === 0 && (b.budget.expenseMinor ?? 0) > 0
              ? Infinity
              : (b.budget?.executionPercent ?? 0)) -
              (a.budget?.budgetMinor === 0 && (a.budget.expenseMinor ?? 0) > 0
                ? Infinity
                : (a.budget?.executionPercent ?? 0))
          : (b.daysOverdue ?? 0) - (a.daysOverdue ?? 0)) ||
        gradeRank(a.grade) - gradeRank(b.grade) ||
        a.id.localeCompare(b.id),
    );
  return {
    ...metadata,
    status: unique.length ? 'ready' : 'empty',
    delivery: null,
    management: {
      itemCount: unique.length,
      projectCount: new Set(unique.flatMap((i) => i.projectIds)).size,
      opportunityCount: new Set(unique.flatMap((i) => i.opportunityIds)).size,
      items: unique,
    },
  };
}
