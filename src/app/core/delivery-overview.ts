import type { Customer, Project } from './models';
import { planRisk } from './rules';

export interface DeliveryFilters {
  search: string;
  pm: string;
  stage: string;
  exception: string;
}
export interface DeliveryRow {
  project: Project;
  customer: string;
  pm: string;
  stage: string;
  nextNode: string;
  nextDate: string;
  exceptions: string[];
  exceptionState: '异常' | '无未完成异常' | '待提供';
  handover: string;
}
export const provided = (value: string | null | undefined): string => value?.trim() || '待提供';
export function deliveryRows(
  projects: readonly Project[],
  customers: readonly Customer[],
  observationDate: string,
): DeliveryRow[] {
  const seen = new Set<string>();
  return projects
    .filter((p) => !seen.has(p.id) && !!seen.add(p.id))
    .map((project) => {
      const plans = project.plans || [];
      const active = plans.filter((p) => p.status !== '已取消' && planRisk(p, observationDate).level !== 'green');
      const next = [...active].sort(
        (a, b) => (a.end || '9999').localeCompare(b.end || '9999') || a.id.localeCompare(b.id),
      )[0];
      const exceptions = active
        .filter((p) => ['red', 'yellow'].includes(planRisk(p, observationDate).level))
        .map((p) => `${p.name}：${planRisk(p, observationDate).label}`);
      exceptions.push(
        ...(project.conditions || []).filter((c) => !c.closed).map((c) => `交底条件：${c.text}`),
      );
      exceptions.push(...(project.handover?.issues || []).map((i) => `移交遗留：${i.text}`));
      if (project.needsReview) exceptions.push('项目待重新评审');
      const known =
        plans.length > 0 &&
        active.every((p) => planRisk(p, observationDate).level !== 'gray') &&
        !!project.handover;
      return {
        project,
        customer: provided(customers.find((c) => c.id === project.customerId)?.shortName),
        pm: provided(project.pm),
        stage: provided(project.status),
        nextNode: next
          ? provided(next.name)
          : plans.length && !active.length
            ? '计划已结束'
            : '待提供',
        nextDate: next?.end || '',
        exceptions,
        exceptionState: exceptions.length
          ? ('异常' as const)
          : known
            ? ('无未完成异常' as const)
            : ('待提供' as const),
        handover: provided(project.handover?.status),
      };
    })
    .sort(
      (a, b) =>
        Number(b.exceptions.length > 0) - Number(a.exceptions.length > 0) ||
        (a.nextDate || '9999').localeCompare(b.nextDate || '9999') ||
        a.project.id.localeCompare(b.project.id),
    );
}
export function filterDeliveryRows(
  rows: readonly DeliveryRow[],
  filters: DeliveryFilters,
): DeliveryRow[] {
  const search = filters.search.trim().toLocaleLowerCase();
  return rows.filter(
    (r) =>
      (!search ||
        `${r.project.id} ${r.project.name} ${r.customer}`.toLocaleLowerCase().includes(search)) &&
      (!filters.pm || r.pm === filters.pm) &&
      (!filters.stage || r.stage === filters.stage) &&
      (!filters.exception || r.exceptionState === filters.exception),
  );
}
