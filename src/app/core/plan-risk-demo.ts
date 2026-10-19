import { addDaysISO, DEMO_COMPARISON_DATE } from './rules';

export const PLAN_RISK_DEMO_CASES = [
  { key: 'overdue', name: '超期演示节点', startOffset: -5, endOffset: -1 },
  { key: 'near', name: '临期演示节点', startOffset: -2, endOffset: 2 },
  { key: 'normal', name: '正常演示节点', startOffset: 6, endOffset: 10 },
] as const;

export function planRiskDemoDates(
  scenario: (typeof PLAN_RISK_DEMO_CASES)[number],
  observationDate = DEMO_COMPARISON_DATE,
) {
  return {
    start: addDaysISO(observationDate, scenario.startOffset),
    end: addDaysISO(observationDate, scenario.endOffset),
    warningLeadDays: 3,
  };
}
