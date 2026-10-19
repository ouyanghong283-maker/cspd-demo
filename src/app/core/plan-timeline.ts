import type { Plan } from './models';
import { DEMO_NORMAL_DATE, addDaysISO } from './rules';
import { ganttBar, ganttObservationMarker, ganttRange, ganttTicks } from './gantt';

/** Presentation adapter over the shared, tested gantt geometry. */
export function buildPlanTimeline(plans: readonly Plan[], observationDate: string) {
  const options = { paddingDays: 2, minChartPx: 720, maxChartPx: 3000 };
  const candidate = ganttRange(plans, observationDate, options);
  const range = candidate.valid ? candidate : ganttRange([], DEMO_NORMAL_DATE, options);
  return {
    width: range.chartWidthPx,
    ticks: ganttTicks(range, 5).map((tick) => ({
      left: tick.left,
      label: addDaysISO(range.start, tick.index),
    })),
    today: ganttObservationMarker(range, observationDate)?.left,
    bar(plan: Plan) {
      const bar = ganttBar(plan, range, observationDate, { minBarPx: 10 });
      return bar.renderable ? { left: bar.left, width: bar.width } : undefined;
    },
  };
}
