import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { DemoStore } from '../core/store';
import { BASE_DATE, STAGES } from '../core/models';
import { threeMonthForecast } from '../core/rules';
import { Icon } from '../shared/icon';
import { Badge } from '../shared/badge';
import {
  SalesForecastVisual,
  SalesActivityVisual,
  SalesPipelineVisual,
} from './sales-dashboard-charts';
@Component({
  imports: [
    FormsModule,
    RouterLink,
    Icon,
    Badge,
    SalesForecastVisual,
    SalesActivityVisual,
    SalesPipelineVisual,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './insights.html',
  styleUrl: './insights.scss',
})
export class Insights {
  store = inject(DemoStore);
  query = signal('');
  owner = signal(this.store.role() === 'sales' ? '张销售' : '');
  country = signal('');
  grade = signal('');
  stage = signal('');
  currency = signal('CNY');
  stages = STAGES;
  readonly baseDate = BASE_DATE;
  readonly stageColors = ['#315dde', '#6686e9', '#8ba5f0', '#b2c3f6', '#16836b', '#a3adbd'];
  forecastPeriod = signal(-1);
  showForecast = signal(false);
  sort = signal('amount');
  listParams(extra: Record<string, string | boolean> = {}) {
    return {
      owner: this.owner(),
      country: this.country(),
      grade: this.grade(),
      stage: this.stage(),
      currency: this.currency(),
      q: this.query(),
      ...extra,
    };
  }
  resetFilters() {
    this.query.set('');
    this.owner.set('');
    this.country.set('');
    this.grade.set('');
    this.stage.set('');
  }
  filtered = computed(
    () => !!(this.query() || this.owner() || this.country() || this.grade() || this.stage()),
  );
  priorityRows = computed(() =>
    [...this.rows()]
      .sort((a, b) =>
        this.sort() === 'followup' ? this.store.days(b) - this.store.days(a) : b.amount - a.amount,
      )
      .slice(0, 8),
  );
  forecastTotal = computed(() => this.forecastRows().reduce((sum, sale) => sum + sale.amount, 0));
  forecastPeriods = computed(() =>
    Array.from({ length: 3 }, (_, index) => {
      const start = new Date(`${BASE_DATE}T00:00:00Z`);
      start.setUTCMonth(start.getUTCMonth() + index);
      const end = new Date(`${BASE_DATE}T00:00:00Z`);
      end.setUTCMonth(end.getUTCMonth() + index + 1);
      const from = start.toISOString().slice(0, 10);
      const to = end.toISOString().slice(0, 10);
      const sales = this.forecastRows().filter(
        (sale) => sale.forecastDate >= from && sale.forecastDate < to,
      );
      const expected = sales
        .filter((sale) => sale.stage !== '赢单')
        .reduce((sum, sale) => sum + sale.amount, 0);
      const income = sales
        .filter((sale) => sale.stage === '赢单')
        .reduce((sum, sale) => sum + sale.amount, 0);
      end.setUTCDate(end.getUTCDate() - 1);
      return {
        from,
        to,
        label: `${start.getUTCMonth() + 1}.${start.getUTCDate()}–${end.getUTCMonth() + 1}.${end.getUTCDate()}`,
        expected,
        income,
        total: expected + income,
        count: sales.length,
      };
    }),
  );
  forecastScale = computed(() => Math.max(...this.forecastPeriods().map((p) => p.total), 1));
  selectedForecastRows = computed(() => {
    const period = this.forecastPeriods()[this.forecastPeriod()];
    return period
      ? this.forecastRows().filter(
          (s) => s.forecastDate >= period.from && s.forecastDate < period.to,
        )
      : this.forecastRows();
  });
  selectForecast(index: number) {
    this.forecastPeriod.set(index);
    this.showForecast.set(true);
  }
  activityWeeks = computed(() => {
    const related = new Set(this.rows().flatMap((s) => [s.id, s.leadId].filter(Boolean)));
    return Array.from({ length: 6 }, (_, index) => {
      const start = new Date(`${BASE_DATE}T00:00:00Z`);
      start.setUTCDate(start.getUTCDate() - 41 + index * 7);
      const end = new Date(start);
      end.setUTCDate(end.getUTCDate() + 6);
      const from = start.toISOString().slice(0, 10),
        to = end.toISOString().slice(0, 10);
      return {
        from,
        to,
        label: `${start.getUTCMonth() + 1}.${start.getUTCDate()}`,
        count: this.store
          .state()
          .activities.filter(
            (a) =>
              related.has(a.entityId) && a.type !== '内部备注' && a.date >= from && a.date <= to,
          ).length,
      };
    });
  });
  activityScale = computed(() => Math.max(...this.activityWeeks().map((w) => w.count), 1));
  activityTotal = computed(() => this.activityWeeks().reduce((sum, w) => sum + w.count, 0));
  activityChange = computed(() => this.activityWeeks()[5].count - this.activityWeeks()[4].count);
  winRateValue = computed(() =>
    this.won() + this.lost() ? (this.won() / (this.won() + this.lost())) * 100 : 0,
  );

  showMetrics = signal(false);
  activityOwner = signal('');
  countries = computed(() => [...new Set(this.store.state().customers.map((c) => c.country))]);
  rows = computed(() =>
    this.store
      .opportunities()
      .filter(
        (s) =>
          (!this.owner() || s.owner === this.owner()) &&
          (!this.country() || this.store.customer(s.customerId)?.country === this.country()) &&
          (!this.grade() || s.grade === this.grade()) &&
          (!this.stage() || s.stage === this.stage()) &&
          s.currency === this.currency() &&
          `${s.projectName}${this.store.customer(s.customerId)?.name}`
            .toLowerCase()
            .includes(this.query().toLowerCase()),
      ),
  );
  live = computed(() => this.rows().filter((s) => !['赢单', '丢单'].includes(s.stage)));
  rawTotal = computed(() => this.live().reduce((n, s) => n + s.amount, 0));
  won = computed(() => this.rows().filter((s) => s.stage === '赢单').length);
  lost = computed(() => this.rows().filter((s) => s.stage === '丢单').length);
  winRate = computed(() =>
    this.won() + this.lost()
      ? Math.round((this.won() / (this.won() + this.lost())) * 100) + '%'
      : '暂无关闭商机',
  );
  counts = computed(() =>
    STAGES.map((stage) => {
      const rows = this.rows().filter((sale) => sale.stage === stage);
      return {
        stage,
        count: rows.length,
        amount: rows.reduce((total, sale) => total + sale.amount, 0),
        capacities:
          [...new Set(rows.map((sale) => sale.unit))]
            .map(
              (unit) =>
                `${rows.filter((sale) => sale.unit === unit).reduce((total, sale) => total + sale.capacity, 0)} ${unit}`,
            )
            .join(' / ') || '暂无容量',
      };
    }),
  );
  maxCount = computed(() => Math.max(...this.counts().map((x) => x.count), 1));
  forecastRows = computed(() =>
    threeMonthForecast(this.rows()).map(({ sale, date }) => ({ ...sale, forecastDate: date })),
  );
  salesActivity = computed(() =>
    ['张销售', '赵销售', '孙销售'].map((owner) => {
      const rows = this.store.opportunities().filter((x) => x.owner === owner);
      const related = this.store.state().sales.filter((x) => x.owner === owner);
      const ids = related
        .flatMap((x) => [x.id, x.type === 'opportunity' ? x.leadId : ''])
        .filter(Boolean);
      const activities = this.store
        .state()
        .activities.filter((a) => ids.includes(a.entityId) && a.type !== '内部备注');
      return {
        owner,
        count: rows.filter((s) => !['赢单', '丢单'].includes(s.stage)).length,
        activities: activities.length,
        last:
          activities
            .map((x) => x.date)
            .sort()
            .at(-1) || '待跟进',
        id: rows[0]?.id,
        rows: activities.sort((a, b) => b.date.localeCompare(a.date)),
      };
    }),
  );
  selectedActivities = computed(
    () => this.salesActivity().find((x) => x.owner === this.activityOwner())?.rows || [],
  );
  closedAnalysis = computed(() => {
    const closed = this.rows().filter((x) => ['赢单', '丢单'].includes(x.stage));
    return [...new Set(closed.map((x) => x.reason || '未填写原因'))].map((reason) => ({
      reason,
      won: closed.filter((x) => (x.reason || '未填写原因') === reason && x.stage === '赢单').length,
      lost: closed.filter((x) => (x.reason || '未填写原因') === reason && x.stage === '丢单')
        .length,
      amounts: [
        ...new Set(
          closed.filter((x) => (x.reason || '未填写原因') === reason).map((x) => x.currency),
        ),
      ].map((currency) => ({
        currency,
        amount: closed
          .filter((x) => (x.reason || '未填写原因') === reason && x.currency === currency)
          .reduce((n, x) => n + x.amount, 0),
      })),
    }));
  });
  cold = computed(() => {
    const ids = new Set(this.rows().map((s) => s.id));
    return this.store
      .cooling()
      .filter((s) => ids.has(s.id))
      .sort((a, b) => this.store.days(b) - this.store.days(a));
  });
  capacity = computed(
    () =>
      [...new Set(this.live().map((x) => x.unit))]
        .map(
          (unit) =>
            `${this.live()
              .filter((x) => x.unit === unit)
              .reduce((n, x) => n + x.capacity, 0)} ${unit}`,
        )
        .join(' / ') || '暂无容量',
  );
}
