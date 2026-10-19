import type { DemoState, SalesRecord } from '../models';
import type { ManagementBoardView, V9Dates, FileAvailability } from '../v9-contracts';
import { isValidISODate } from '../rules';
import { selectSolutionWorkspace } from '../v9-queries';

const gradeOrder = ['S', 'A', 'B1', 'B2'];
const capacityUnits: Record<string, { unit: string; scale: number }> = {
  MW: { unit: 'MW', scale: 1 },
  kW: { unit: 'MW', scale: 0.001 },
  MWh: { unit: 'MWh', scale: 1 },
  kWh: { unit: 'MWh', scale: 0.001 },
};
export function comparableCapacity(sale: SalesRecord) {
  const unit = capacityUnits[sale.unit];
  return unit && Number.isFinite(sale.capacity) && sale.capacity > 0
    ? { value: sale.capacity * unit.scale, unit: unit.unit }
    : null;
}
export function comparePriority(a: SalesRecord, b: SalesRecord): number {
  const rank = (s: SalesRecord) => {
    const i = gradeOrder.indexOf(s.grade);
    return i < 0 ? 4 : i;
  };
  const grade = rank(a) - rank(b);
  if (grade) return grade;
  const ac = comparableCapacity(a),
    bc = comparableCapacity(b);
  if (!ac || !bc) return Number(!ac) - Number(!bc) || a.id.localeCompare(b.id);
  // 不同物理量按单位分组（功率、能量），从不比较其数值；组内降序。
  if (ac.unit !== bc.unit) return ac.unit === 'MW' ? -1 : 1;
  return bc.value - ac.value || a.id.localeCompare(b.id);
}
const date = (value: string | undefined) => (value && isValidISODate(value) ? value : null);
const days = (end: string, today: string) =>
  Math.floor((Date.parse(today) - Date.parse(end)) / 86400000);
export function selectBoardExceptions(
  state: Readonly<DemoState>,
  businesses: ManagementBoardView['businesses'],
  budgets: ManagementBoardView['budgets'],
  dates: V9Dates,
  availability: Readonly<Record<string, FileAvailability>>,
): ManagementBoardView['exceptions'] {
  const result: ManagementBoardView['exceptions'] = [];
  for (const b of businesses) {
    const sale = state.sales.find((s) => s.id === b.businessId)!;
    const workspace = selectSolutionWorkspace(state, sale.id, availability);
    const schedule = workspace.workspace?.schedule;
    const owner =
      schedule?.owner ??
      (sale.owner ? { personId: sale.ownerPersonId ?? '', name: sale.owner } : null);
    const solutionHref = `/sales/solutions/${encodeURIComponent(sale.id)}`;
    const add = (
      suffix: string,
      reason: string,
      category: NonNullable<ManagementBoardView['exceptions'][number]['category']>,
      href: string,
      projectId: string | null,
      due: string | null,
      responsibility = owner,
    ) =>
      result.push({
        id: `${b.businessId}:${suffix}`,
        businessId: b.businessId,
        projectId,
        reason,
        category,
        owner: responsibility,
        sourceHref: href,
        date: due,
        daysOverdue:
          due && (category === 'delivery' || category === 'solution-overdue')
            ? Math.max(
                0,
                days(
                  due,
                  category === 'delivery' ? dates.planObservationDate : dates.solutionBusinessDate,
                ),
              )
            : null,
        sourceLabel: suffix.startsWith('plan:')
          ? `项目计划 ${suffix.slice(5)}`
          : suffix.startsWith('budget:')
            ? '预算比较'
            : suffix.startsWith('owner:')
              ? '项目责任'
              : suffix === 'progress'
                ? '全流程进度'
                : '方案工作区',
      });
    if (
      schedule &&
      !workspace.workspace?.firstFinalization &&
      date(schedule.deadlineDate) &&
      schedule.deadlineDate < dates.solutionBusinessDate
    )
      add(
        'solution-overdue',
        '方案逾期未首次定稿',
        'solution-overdue',
        solutionHref,
        null,
        schedule.deadlineDate,
      );
    if (workspace.currentStatus === 'stale')
      add(
        'solution-stale',
        '资料或需求已变化，待重新定稿',
        'missing',
        solutionHref,
        null,
        schedule?.deadlineDate ?? null,
      );
    const absent = workspace.files.filter((f) => f.availability !== 'present');
    if (absent.length)
      add(
        'solution-files',
        `四类方案资料待核：${absent.map((f) => `${{ proposal: '方案书', bom: 'BOM', sld: '单线图', degradation: '衰减曲线' }[f.kind]}（${f.availability === 'missing' ? '缺件' : f.availability === 'unavailable' ? '暂不可读' : '待核验'}）`).join('、')}`,
        'missing',
        solutionHref,
        null,
        null,
      );
    if (!schedule || !schedule.owner?.personId || !date(schedule.deadlineDate))
      add('solution-schedule', '方案责任或期限待补', 'missing', solutionHref, null, null);
    if (b.incomplete) add('progress', '计分依据待补或已失效', 'missing', b.sourceHref, null, null);
    for (const project of state.projects.filter((p) => b.projectIds.includes(p.id))) {
      if (!project.pm)
        add(
          `owner:${project.id}`,
          '项目负责人待补',
          'missing',
          `/projects/${encodeURIComponent(project.id)}`,
          project.id,
          null,
          null,
        );
      for (const plan of new Map(project.plans.map((p) => [p.id, p])).values()) {
        if (!['内部WBS', '客户主节点', 'FAT测试'].includes(plan.type) || plan.status === '已取消')
          continue;
        if (plan.status === '已完成' && date(plan.actual)) continue;
        const due = date(plan.end);
        if (due && due < dates.planObservationDate)
          add(
            `plan:${project.id}:${plan.id}`,
            `关键计划延期：${plan.name}`,
            'delivery',
            `/projects/${encodeURIComponent(project.id)}?tab=plans&plan=${encodeURIComponent(plan.type)}&planId=${encodeURIComponent(plan.id)}`,
            project.id,
            due,
            plan.owner ? { personId: plan.ownerPersonId ?? '', name: plan.owner } : null,
          );
      }
      const comparisons = budgets.filter((x) => x.projectId === project.id);
      if (!comparisons.length)
        add(
          `budget:${project.id}`,
          '预算比较来源待接入或所选币种无可比记录',
          'missing',
          `/projects/${encodeURIComponent(project.id)}?tab=overview&section=${encodeURIComponent('预算费用')}`,
          project.id,
          null,
        );
      for (const budget of comparisons) {
        const href = `/projects/${encodeURIComponent(project.id)}?tab=overview&section=${encodeURIComponent('预算费用')}`;
        if (!budget.comparable)
          add(
            `budget:${project.id}:${budget.currency}`,
            `${budget.currency} 预算不可比：${budget.reason ?? '范围待核'}`,
            'missing',
            href,
            project.id,
            budget.cutoff,
          );
        else if (budget.varianceMinor !== null && budget.varianceMinor > 0)
          add(
            `budget:${project.id}:${budget.currency}`,
            `${budget.currency} 已超预算${budget.executionPercent === null ? '（零预算有支出）' : `，执行率 ${budget.executionPercent}%`}`,
            'over-budget',
            href,
            project.id,
            budget.cutoff,
          );
      }
    }
  }
  const order = { delivery: 0, 'solution-overdue': 1, 'over-budget': 2, missing: 3 };
  const budgetRatio = (e: ManagementBoardView['exceptions'][number]) => {
    const budget = budgets.find(
      (b) => b.projectId === e.projectId && e.id.endsWith(`:${b.currency}`),
    );
    return (
      budget?.executionPercent ??
      (budget?.budgetMinor === 0 && (budget.expenseMinor ?? 0) > 0 ? Infinity : 0)
    );
  };
  return result.sort(
    (a, b) =>
      order[a.category!] - order[b.category!] ||
      (a.category === 'over-budget'
        ? budgetRatio(b) - budgetRatio(a)
        : (b.daysOverdue ?? 0) - (a.daysOverdue ?? 0)) ||
      gradeOrder.indexOf(state.sales.find((s) => s.id === a.businessId)!.grade) -
        gradeOrder.indexOf(state.sales.find((s) => s.id === b.businessId)!.grade) ||
      a.businessId.localeCompare(b.businessId) ||
      a.id.localeCompare(b.id),
  );
}
