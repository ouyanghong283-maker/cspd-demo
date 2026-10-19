import { ChangeDetectionStrategy, Component, inject, input, output } from '@angular/core';
import { DemoStore } from '../core/store';
import { RouterLink } from '@angular/router';
import { Icon } from '../shared/icon';
export interface ForecastPeriod {
  from: string;
  to: string;
  label: string;
  expected: number;
  income: number;
  total: number;
  count: number;
}
export interface ActivityWeek {
  from: string;
  to: string;
  label: string;
  count: number;
}
@Component({
  selector: 'app-sales-forecast-visual',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './sales-forecast-visual.html',
  styleUrl: './sales-forecast-visual.scss',
})
export class SalesForecastVisual {
  readonly store = inject(DemoStore);
  readonly periods = input.required<ForecastPeriod[]>();
  readonly total = input.required<number>();
  readonly count = input.required<number>();
  readonly currency = input.required<string>();
  readonly scale = input.required<number>();
  readonly selected = input(-1);
  readonly selectPeriod = output<number>();
}
@Component({
  selector: 'app-sales-activity-visual',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './sales-activity-visual.html',
  styleUrl: './sales-activity-visual.scss',
})
export class SalesActivityVisual {
  readonly weeks = input.required<ActivityWeek[]>();
  readonly total = input.required<number>();
  readonly change = input.required<number>();
  readonly scale = input.required<number>();
}

@Component({
  selector: 'app-sales-pipeline-visual',
  imports: [RouterLink, Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './sales-pipeline-visual.html',
  styleUrl: './sales-pipeline-visual.scss',
})
export class SalesPipelineVisual {
  readonly store = inject(DemoStore);
  readonly counts =
    input.required<{ stage: string; count: number; amount: number; capacities: string }[]>();
  readonly total = input.required<number>();
  readonly scale = input.required<number>();
  readonly colors = input.required<string[]>();
  readonly currency = input.required<string>();
  readonly params = input.required<Record<string, string | boolean>>();
  stageParams(stage: string) {
    return { ...this.params(), stage };
  }
  percent(count: number) {
    return Math.round((count / Math.max(this.total(), 1)) * 100);
  }
}
