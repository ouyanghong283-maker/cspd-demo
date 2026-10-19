import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { buildTrackingCharts, TrackingChartRow } from '../core/tracking-charts';

@Component({
  selector: 'app-tracking-charts',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './tracking-charts.html',
  styleUrl: './tracking-charts.scss',
})
export class TrackingCharts {
  readonly rows = input.required<readonly TrackingChartRow[]>();
  readonly observationDate = input.required<string>();
  readonly selectKind = output<string>();
  readonly selectProject = output<string>();
  readonly charts = computed(() => buildTrackingCharts(this.rows(), this.observationDate()));
}
