import {
  Activity,
  BASE_DATE,
  DemoDateMode,
  Plan,
  Project,
  SalesRecord,
  Stage,
} from './models';

export function needsTenderTeam(record: SalesRecord): boolean {
  return record.tender === '是' && ['A', 'S'].includes(record.grade);
}
export function isClosed(record: SalesRecord): boolean {
  return record.stage === '赢单' || record.stage === '丢单';
}
export function coolingDays(record: SalesRecord, activities: Activity[]): number {
  if (isClosed(record) || record.type === 'lead') return 0;
  const related = activities.filter(
    (a) =>
      (a.entityId === record.id || a.entityId === record.leadId) &&
      a.type !== '内部备注' &&
      a.date <= BASE_DATE,
  );
  const date =
    related
      .map((a) => a.date)
      .sort()
      .at(-1) ||
    record.convertedDate ||
    record.createdDate;
  return Math.max(0, Math.floor((Date.parse(BASE_DATE) - Date.parse(date)) / 86400000));
}
export function threeMonthForecast(
  records: SalesRecord[],
  startDate = BASE_DATE,
): { sale: SalesRecord; date: string }[] {
  const end = new Date(`${startDate}T00:00:00.000Z`);
  end.setUTCMonth(end.getUTCMonth() + 3);
  const endDate = end.toISOString().slice(0, 10);
  return records
    .flatMap((sale) => {
      if (sale.type !== 'opportunity' || sale.stage === '丢单') return [];
      const date = sale.stage === '赢单' ? sale.incomeDate : sale.expectedDate;
      return date && date >= startDate && date < endDate ? [{ sale, date }] : [];
    })
    .sort((a, b) => a.date.localeCompare(b.date));
}
export const STAGE_WEIGHTS: Record<Stage, number> = {
  意向沟通: 0.2,
  方案报价: 0.4,
  洽谈: 0.6,
  合同谈判: 0.8,
  赢单: 0,
  丢单: 0,
};
export const GRADE_WEIGHTS: Record<string, number> = { S: 1, A: 0.9, B1: 0.7, B2: 0.5 };
export function weightedAmount(record: SalesRecord): number {
  return isClosed(record)
    ? 0
    : record.amount * STAGE_WEIGHTS[record.stage] * (GRADE_WEIGHTS[record.grade] || 0);
}
export function acceptanceReady(p: Project, hasEvidence: boolean): boolean {
  return (
    hasEvidence &&
    p.acceptance.length > 0 &&
    p.acceptance.every((a) => a.result === '通过' && !!a.signer && !!a.date)
  );
}
export function validDateRange(start: string, end: string): boolean {
  return (
    !!start &&
    !!end &&
    Number.isFinite(Date.parse(start)) &&
    Number.isFinite(Date.parse(end)) &&
    start <= end
  );
}

/** 集中配置的模拟观察日期。 */
export const DEMO_NORMAL_DATE = '2026-10-15';
export const DEMO_COMPARISON_DATE = '2026-10-22';

export function observationDateForMode(mode: DemoDateMode): string {
  return mode === 'comparison' ? DEMO_COMPARISON_DATE : DEMO_NORMAL_DATE;
}

export type PlanRiskLevel = 'green' | 'blue' | 'yellow' | 'red' | 'gray';

export interface PlanRiskResult {
  level: PlanRiskLevel;
  /** 用户可见的简短状态标签。 */
  label: string;
  /** 需要补录的字段说明；空数组表示无需补录。 */
  missing: string[];
  /** 当任务已完成但逾期结束时，附带逾期标识。 */
  overdueCompleted: boolean;
}

/** 单一日期工具：只接受真实存在的 YYYY-MM-DD，避免时区解析偏移。 */
export function isValidISODate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

/** 按日期粒度计算相隔天数；非法日期返回 undefined 而不是抛出。 */
export function daysBetweenISO(start: string, end: string): number | undefined {
  if (!isValidISODate(start) || !isValidISODate(end)) return undefined;
  return Math.round(
    (Date.parse(`${end}T00:00:00.000Z`) - Date.parse(`${start}T00:00:00.000Z`)) / 86400000,
  );
}

/**
 * 纯日期风险判断（GAN02/GAN03）。
 * 不读取全局状态，调用方传入观察日期 D 与计划对象，便于多视图复用与测试。
 */
export function planRisk(plan: Plan, observationDate: string): PlanRiskResult {
  const end = plan.end;
  const actual = plan.actual;
  const status = plan.status;

  // 取消/非法/缺结束日 → 灰
  if (status === '已取消') {
    return { level: 'gray', label: '已取消', missing: [], overdueCompleted: false };
  }
  if (!isValidISODate(end)) {
    return { level: 'gray', label: '日期待补', missing: ['计划结束日期'], overdueCompleted: false };
  }

  // 合法完成 → 绿；逾期完成附标识
  if (status === '已完成' && isValidISODate(actual)) {
    const overdue = actual > end;
    return {
      level: 'green',
      label: overdue ? '已完成（逾期）' : '已完成',
      missing: overdue ? ['实际完成日期说明'] : [],
      overdueCompleted: overdue,
    };
  }

  if (!isValidISODate(observationDate)) {
    return { level: 'gray', label: '观察日无效', missing: [], overdueCompleted: false };
  }

  // 已知逾期即使缺 N 仍红并标待补
  if (observationDate > end) {
    const missing: string[] = ['已逾期'];
    if (!isValidWarningLeadDays(plan.warningLeadDays)) missing.push('预警天数');
    return { level: 'red', label: '已逾期', missing, overdueCompleted: false };
  }

  // 未逾期缺 N → 灰
  if (!isValidWarningLeadDays(plan.warningLeadDays)) {
    return {
      level: 'gray',
      label: '预警天数待补',
      missing: ['预警天数'],
      overdueCompleted: false,
    };
  }

  const warningStart = addDays(end, -plan.warningLeadDays!);
  if (observationDate < warningStart) {
    return { level: 'blue', label: '正常', missing: [], overdueCompleted: false };
  }
  if (observationDate <= end) {
    return { level: 'yellow', label: '预警', missing: [], overdueCompleted: false };
  }
  // 兜底，理论上已被 observationDate > end 覆盖
  return { level: 'red', label: '已逾期', missing: ['已逾期'], overdueCompleted: false };
}

export function isValidWarningLeadDays(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** 按日期粒度平移；输入非法日期时回退原值，不抛出。 */
export function addDaysISO(date: string, days: number): string {
  return isValidISODate(date) ? addDays(date, days) : date;
}

/** 甘特/表格中可直接使用的风险色 CSS 类。 */
export function riskClass(level: PlanRiskLevel): string {
  const map: Record<PlanRiskLevel, string> = {
    green: 'risk-green',
    blue: 'risk-blue',
    yellow: 'risk-yellow',
    red: 'risk-red',
    gray: 'risk-gray',
  };
  return map[level];
}

/** 计划的工期（结束 - 开始，按日）。 */
export function planDurationDays(plan: Plan): number | undefined {
  if (!isValidISODate(plan.start) || !isValidISODate(plan.end)) return undefined;
  return daysBetweenISO(plan.start, plan.end);
}
