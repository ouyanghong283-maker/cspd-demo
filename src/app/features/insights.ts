import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { DemoStore } from '../core/store';
import { STAGES } from '../core/models';
import { Icon } from '../shared/icon';
import { Badge } from '../shared/badge';
@Component({
  imports: [FormsModule, RouterLink, Icon, Badge],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './insights.html',
  styles: `
    .insights-top {
      display: grid;
      grid-template-columns: minmax(0, 1.3fr) minmax(0, 1fr);
      gap: 22px;
      margin-bottom: 24px;
    }
    .pipeline-chart {
      padding: 23px 25px;
    }
    .pipeline-row {
      display: flex;
      align-items: center;
      gap: 14px;
      margin-bottom: 20px;
      font-size: 11px;
    }
    .pipeline-row:last-child {
      margin-bottom: 0;
    }
    .pipeline-name {
      width: 60px;
      color: #7b8aa2;
    }
    .pipeline-bar-wrap {
      flex: 1;
      height: 27px;
      background: #f7f9fc;
      border-radius: 3px;
    }
    .pipeline-bar {
      height: 100%;
      min-width: 3px;
      border-radius: 3px;
      background: #7f9fe8;
      display: block;
    }
    .pipeline-value {
      width: 52px;
      color: #516581;
      text-align: right;
    }
    .forecast-chart {
      padding: 24px 24px 18px;
      display: flex;
      align-items: end;
      justify-content: space-around;
      gap: 24px;
      height: 185px;
      border-bottom: 1px solid var(--line);
      margin: 0 24px;
    }
    .forecast-month {
      height: 100%;
      flex: 1;
      display: flex;
      align-items: center;
      flex-direction: column;
      justify-content: flex-end;
    }
    .forecast-bars {
      flex: 1;
      display: flex;
      align-items: flex-end;
      gap: 9px;
      width: 65%;
      max-width: 70px;
    }
    .forecast-bars > span {
      display: block;
      flex: 1;
      border-radius: 3px 3px 0 0;
      background: #d7e2fb;
      min-height: 2px;
    }
    .forecast-bars > span.weighted {
      background: #6388df;
    }
    .forecast-month small {
      font-size: 11px;
      color: #8390a4;
      padding-top: 12px;
    }
    .legend {
      display: flex;
      justify-content: center;
      gap: 18px;
      padding: 16px;
      font-size: 10px;
      color: #8492aa;
    }
    .legend > span {
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .legend i {
      width: 7px;
      height: 7px;
      border-radius: 2px;
      background: #d7e2fb;
    }
    .legend i.dark {
      background: #6388df;
    }
    .table-summary {
      padding: 13px 24px;
      display: flex;
      justify-content: space-between;
      font-size: 11px;
      color: #8c9ab0;
    }
    .split-bottom {
      display: grid;
      grid-template-columns: minmax(0, 1.5fr) minmax(290px, 1fr);
      gap: 22px;
      margin-top: 24px;
    }
    .cold-row {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 15px 22px;
      border-bottom: 1px solid var(--line);
    }
    .cold-row h3 {
      font-size: 12px;
      margin: 0 0 4px;
    }
    .cold-row p {
      font-size: 10px;
      margin: 0;
    }
    .forecast-detail {
      margin-top: 22px;
    }
    .insight-caption {
      font-size: 10px;
      color: #8d9ab1;
      padding: 0 24px 17px;
      margin: 0;
      line-height: 1.8;
    }
    @media (max-width: 1050px) {
      .insights-top,
      .split-bottom {
        grid-template-columns: 1fr;
      }
    }
  `,
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
  showWeights = signal(false);
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
  weightedTotal = computed(() => this.live().reduce((n, s) => n + this.store.weighted(s), 0));
  won = computed(() => this.rows().filter((s) => s.stage === '赢单').length);
  lost = computed(() => this.rows().filter((s) => s.stage === '丢单').length);
  winRate = computed(() =>
    this.won() + this.lost()
      ? Math.round((this.won() / (this.won() + this.lost())) * 100) + '%'
      : '暂无关闭商机',
  );
  counts = computed(() =>
    STAGES.map((stage) => ({ stage, count: this.rows().filter((s) => s.stage === stage).length })),
  );
  maxCount = computed(() => Math.max(...this.counts().map((x) => x.count), 1));
  months = computed(() =>
    [10, 11, 12].map((month) => {
      const rows = this.live().filter((x) => x.expectedDate.startsWith(`2026-${month}`));
      return {
        month,
        raw: rows.reduce((n, x) => n + x.amount, 0),
        weighted: rows.reduce((n, x) => n + this.store.weighted(x), 0),
        count: rows.length,
      };
    }),
  );
  maxForecast = computed(() => Math.max(...this.months().map((x) => x.raw), 1));
  salesActivity = computed(() =>
    ['张销售', '赵销售', '孙销售'].map((owner) => {
      const rows = this.store.opportunities().filter((x) => x.owner === owner);
      const related = this.store.state().sales.filter((x) => x.owner === owner);
      const ids = related.flatMap((x) => [x.id, x.type === 'opportunity' ? x.leadId : '']).filter(Boolean);
      const activities = this.store.state().activities.filter((a) => ids.includes(a.entityId) && a.type !== '内部备注');
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
        rows: activities.sort((a,b) => b.date.localeCompare(a.date)),
      };
    }),
  );
  selectedActivities = computed(() => this.salesActivity().find((x) => x.owner === this.activityOwner())?.rows || []);
  closedAnalysis = computed(() => {
    const closed = this.rows().filter((x) => ['赢单', '丢单'].includes(x.stage));
    return [...new Set(closed.map((x) => x.reason || '未填写原因'))].map((reason) => ({
      reason,
      won: closed.filter((x) => x.reason === reason && x.stage === '赢单').length,
      lost: closed.filter((x) => x.reason === reason && x.stage === '丢单').length,
      amounts: [...new Set(closed.filter((x) => x.reason === reason).map((x) => x.currency))].map((currency) => ({ currency, amount: closed.filter((x) => x.reason === reason && x.currency === currency).reduce((n,x) => n+x.amount, 0) })),
    }));
  });
  cold = computed(() =>
    this.store
      .cooling()
      .filter((x) => x.currency === this.currency() && (!this.owner() || x.owner === this.owner())),
  );
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
  percent(count: number): number {
    return Math.round((count / Math.max(this.rows().length, 1)) * 100);
  }
}
