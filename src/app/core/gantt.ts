import { Plan } from './models';
import {
  addDaysISO,
  daysBetweenISO,
  isValidISODate,
  PlanRiskLevel,
  PlanRiskResult,
  planRisk,
  riskClass,
} from './rules';

/**
 * 甘特时间轴与条带几何的纯函数模块（GAN04）。
 * 只依赖已保存的计划对象与全局模拟日期，不读取组件状态，便于单测与多视图复用。
 * 颜色与状态文字一律来自 08-01 的 planRisk/riskClass，本模块不另写一套颜色算法。
 */

/** 单个日格的最小像素宽度：保证单日/极短任务可见。 */
export const GANTT_MIN_DAY_CELL_PX = 26;
/** 图表最小宽度，避免单日范围过窄。 */
export const GANTT_MIN_CHART_PX = 320;
/** 图表最大宽度：超长跨度交给横向滚动，不无限撑开 DOM。 */
export const GANTT_MAX_CHART_PX = 24000;
/** 跨度过大时收紧网格线的步长上限（天）。 */
export const GANTT_MAX_GRID_DAYS = 62;

export interface GanttRange {
  /** 轴起点（含）。非法范围为 ''。 */
  start: string;
  /** 轴终点（含）。非法范围为 ''。 */
  end: string;
  /** 覆盖的天数（含首尾），非法范围为 0。 */
  days: number;
  /** 单个日格占整轴的百分比。 */
  dayPercent: number;
  /** 网格线步长（百分比）。 */
  gridPercent: number;
  /** 单个日格的实际像素宽度。 */
  dayCellPx: number;
  /** 图表渲染宽度（配合横向滚动）。 */
  chartWidthPx: number;
  valid: boolean;
  /** 范围不可用时的中文说明。 */
  reason?: string;
}

export interface GanttBar {
  planId: string;
  /** 条带是否可渲染；非法起止日期时为 false，但风险文字与颜色仍然给出。 */
  renderable: boolean;
  /** 不可渲染时的中文说明。 */
  reason?: string;
  left: number;
  width: number;
  /** 起止同一天：按里程碑菱形展示。 */
  milestone: boolean;
  startIndex: number;
  spanDays: number;
  risk: PlanRiskResult;
  level: PlanRiskLevel;
  label: string;
  /** 直接可用的风险色 CSS 类（来自 riskClass）。 */
  cssClass: string;
}

export interface GanttTick {
  left: number;
  label: string;
  index: number;
}

export interface GanttMarker {
  left: number;
  label: string;
  index: number;
}

/** 图例文案：颜色之外也能读到状态（GAN04）。 */
export const GANTT_LEGEND: { level: PlanRiskLevel; text: string }[] = [
  { level: 'blue', text: '正常：未进入预警窗口' },
  { level: 'yellow', text: '预警：已进入提前天数窗口' },
  { level: 'red', text: '已逾期：超过计划结束日' },
  { level: 'green', text: '已完成' },
  { level: 'gray', text: '已取消 / 日期或预警天数待补' },
];

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function roundPercent(value: number): number {
  return Math.round(clamp(value, 0, 100) * 1000) / 1000;
}

function monthDayLabel(date: string): string {
  const [, month, day] = date.split('-');
  return `${Number(month)}月${Number(day)}日`;
}

/**
 * 按「全部展示任务的起止 + 当前模拟日期」动态展开时间轴（GAN04）。
 * 非法日期只是跳过，不抛出。
 */
export function ganttRange(
  plans: readonly Plan[] | undefined,
  observationDate: string,
  options: {
    minDayCellPx?: number;
    maxChartPx?: number;
    minChartPx?: number;
    paddingDays?: number;
  } = {},
): GanttRange {
  const minDayCellPx = options.minDayCellPx ?? GANTT_MIN_DAY_CELL_PX;
  const maxChartPx = options.maxChartPx ?? GANTT_MAX_CHART_PX;
  const dates: string[] = [];
  for (const plan of plans || []) {
    if (isValidISODate(plan?.start)) dates.push(plan.start);
    if (isValidISODate(plan?.end)) dates.push(plan.end);
  }
  if (isValidISODate(observationDate)) dates.push(observationDate);
  if (!dates.length) {
    return {
      start: '',
      end: '',
      days: 0,
      dayPercent: 0,
      gridPercent: 0,
      dayCellPx: minDayCellPx,
      chartWidthPx: GANTT_MIN_CHART_PX,
      valid: false,
      reason: '暂无可用于时间轴的合法日期',
    };
  }
  dates.sort();
  const padding = options.paddingDays ?? 0;
  const start = addDaysISO(dates[0], -padding);
  const end = addDaysISO(dates[dates.length - 1], padding);
  const days = Math.max(1, (daysBetweenISO(start, end) ?? 0) + 1);
  const chartWidthPx = clamp(
    days * minDayCellPx,
    options.minChartPx ?? GANTT_MIN_CHART_PX,
    maxChartPx,
  );
  const dayPercent = 100 / days;
  const gridDays = days <= GANTT_MAX_GRID_DAYS ? 1 : Math.ceil(days / GANTT_MAX_GRID_DAYS);
  return {
    start,
    end,
    days,
    dayPercent,
    gridPercent: dayPercent * gridDays,
    dayCellPx: chartWidthPx / days,
    chartWidthPx,
    valid: true,
  };
}

/** 计算条带的百分比几何与风险投影；非法日期不抛出，返回不可渲染结果。 */
export function ganttBar(
  plan: Plan,
  range: GanttRange,
  observationDate: string,
  options: { minBarPx?: number } = {},
): GanttBar {
  const risk = planRisk(plan, observationDate);
  const base = {
    planId: plan?.id || '',
    left: 0,
    width: 0,
    milestone: false,
    startIndex: 0,
    spanDays: 0,
    risk,
    level: risk.level,
    label: risk.label,
    cssClass: riskClass(risk.level),
  };
  if (!range.valid || range.days <= 0) {
    return { ...base, renderable: false, reason: '时间轴不可用' };
  }
  if (!isValidISODate(plan?.start) || !isValidISODate(plan?.end)) {
    return { ...base, renderable: false, reason: '起止日期待补' };
  }
  const startIndex = daysBetweenISO(range.start, plan.start);
  const endIndex = daysBetweenISO(range.start, plan.end);
  if (startIndex === undefined || endIndex === undefined) {
    return { ...base, renderable: false, reason: '日期待补' };
  }
  if (endIndex < startIndex) {
    return {
      ...base,
      left: roundPercent((clamp(startIndex, 0, range.days) / range.days) * 100),
      renderable: false,
      reason: '起止日期倒置',
    };
  }
  const clampedStart = clamp(startIndex, 0, Math.max(0, range.days - 1));
  // 含首尾的天数：起止同一天即 1 个日格，保证单日/极短任务不小于最小日格。
  const spanDays = Math.max(1, endIndex - startIndex + 1);
  const clampedSpan = Math.min(spanDays, range.days - clampedStart);
  const width = Math.min(
    100,
    Math.max(
      roundPercent((clampedSpan / range.days) * 100),
      ((options.minBarPx || 0) / range.chartWidthPx) * 100,
    ),
  );
  return {
    ...base,
    renderable: true,
    left: Math.min(roundPercent((clampedStart / range.days) * 100), 100 - width),
    width,
    milestone: spanDays === 1,
    startIndex: clampedStart,
    spanDays: clampedSpan,
  };
}

/** 「当前模拟日期」竖线的位置；观察日非法时返回 null。 */
export function ganttObservationMarker(
  range: GanttRange,
  observationDate: string,
): GanttMarker | null {
  if (!range.valid || !isValidISODate(observationDate)) return null;
  const index = daysBetweenISO(range.start, observationDate);
  if (index === undefined || index < 0 || index >= range.days) return null;
  return {
    left: roundPercent(((index + 0.5) / range.days) * 100),
    label: `当前模拟日期 ${observationDate}`,
    index,
  };
}

/** 轴刻度：按跨度自动取步长，保证短跨度也有可读标签。 */
export function ganttTicks(range: GanttRange, maxTicks = 7): GanttTick[] {
  if (!range.valid || range.days <= 0) return [];
  const safeMax = Math.max(2, maxTicks);
  const step = Math.max(1, Math.ceil(range.days / (safeMax - 1)));
  const ticks: GanttTick[] = [];
  for (let index = 0; index < range.days; index += step) {
    ticks.push({
      left: roundPercent((index / range.days) * 100),
      label: monthDayLabel(addDaysISO(range.start, index)),
      index,
    });
  }
  const lastIndex = range.days - 1;
  if (ticks[ticks.length - 1]?.index !== lastIndex) {
    ticks.push({
      left: roundPercent((lastIndex / range.days) * 100),
      label: monthDayLabel(range.end),
      index: lastIndex,
    });
  }
  return ticks;
}

/** 轴范围的中文摘要，用于页面提示与验收输出。 */
export function ganttRangeLabel(range: GanttRange): string {
  if (!range.valid) return range.reason || '时间轴不可用';
  return `${range.start} 至 ${range.end}（${range.days} 天）`;
}

/** 计划条带的可读日期摘要：日期缺失时如实标待补。 */
export function ganttPlanDateLabel(plan: Plan): string {
  const start = isValidISODate(plan?.start) ? plan.start : '开始待补';
  const end = isValidISODate(plan?.end) ? plan.end : '结束待补';
  return `${start} 至 ${end}`;
}
