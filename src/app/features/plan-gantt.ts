import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { planWarningDate } from '../core/plan-warning-backfill';
import type { Plan } from '../core/models';
import { planRisk, PlanRiskResult } from '../core/rules';
import { wbsHierarchy } from '../core/wbs-hierarchy';
import { buildPlanTimeline } from '../core/plan-timeline';

@Component({
  selector: 'app-plan-gantt',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './plan-gantt.html',
  styleUrl: './plan-gantt.scss',
})
export class PlanGantt {
  readonly warningDate = planWarningDate;
  plans = input.required<readonly Plan[]>();
  observationDate = input.required<string>();
  editPlan = output<Plan>();
  rows = computed(() => wbsHierarchy(this.plans()));
  timeline = computed(() => buildPlanTimeline(this.plans(), this.observationDate()));
  planRisk(plan: Plan): PlanRiskResult {
    return planRisk(plan, this.observationDate());
  }
  ganttBarColor(plan: Plan): string {
    const colors: Record<PlanRiskResult['level'], string> = {
      green: '#88bca4',
      blue: '#7597e7',
      yellow: '#d9a441',
      red: '#d06a6a',
      gray: '#c3ccda',
    };
    return colors[this.planRisk(plan).level];
  }
}
