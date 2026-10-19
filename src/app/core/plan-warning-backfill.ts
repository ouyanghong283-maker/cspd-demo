import { DemoState, Plan } from './models';
import { addDaysISO, isValidISODate, isValidWarningLeadDays } from './rules';

/** 日期随计划结束日和N实时派生，避免修改计划后出现过期的预警日期。 */
export function planWarningDate(plan: Pick<Plan, 'end' | 'warningLeadDays'>): string | undefined {
  if (!isValidISODate(plan.end) || !isValidWarningLeadDays(plan.warningLeadDays)) return undefined;
  return addDaysISO(plan.end, -plan.warningLeadDays);
}

/** 本轮用户明确选择：历史缺值统一提前7天；已设置的值（含0）保持原样。 */
export function backfillProjectWarnings(state: DemoState): number {
  if (state.projectWarningBackfillVersion === 1) return 0;
  let count = 0;
  for (const project of state.projects) {
    for (const plan of project.plans) {
      if (plan.warningLeadDays !== undefined && plan.warningLeadDays !== null) continue;
      plan.warningLeadDays = 7;
      plan.warningLeadDaysSource = '历史项目统一补齐';
      count++;
    }
  }
  state.projectWarningBackfillVersion = 1;
  return count;
}
