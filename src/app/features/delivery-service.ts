import { effect, ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink, RouterOutlet } from '@angular/router';
import { DemoStore } from '../core/store';
import { deliveryRows, filterDeliveryRows, type DeliveryFilters } from '../core/delivery-overview';
import { ProjectDeliveryPanel } from './project-delivery-panel';

@Component({
  imports: [RouterLink, RouterOutlet, ProjectDeliveryPanel],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <nav class="tabs" aria-label="交付与售后入口">
      <button type="button" [class.active]="tab() !== 'overview'" (click)="openOverview()">
        交付与售后总览
      </button>
      <button type="button" [class.active]="tab() === 'overview'" (click)="selectPlans()">
        项目计划总览
      </button>
    </nav>
    @if (tab() === 'overview') {
      <router-outlet />
    } @else if (projectId()) {
      <button class="btn" type="button" (click)="openOverview()">返回交付总览（保留筛选）</button>
      @if (project(); as p) {
        <header class="page-heading detail-heading">
          <div>
            <p class="detail-kicker">{{ tab() === 'service' ? '运维与售后' : '物流与现场' }}</p>
            <h1>{{ p.name }}<span class="detail-id">{{ p.id }}</span></h1>
          </div>
          <a
            class="btn"
            [routerLink]="['/projects', p.id]"
            [queryParams]="{
              tab: 'delivery',
              returnTo: router.url,
              returnLabel: '返回交付与售后',
              deliveryTab: tab(),
            }"
            queryParamsHandling="merge"
            [preserveFragment]="true"
            >在项目区打开同一交付记录</a
          >
        </header>
        <app-project-delivery-panel [projectId]="p.id" />
      } @else {
        <section class="empty panel">
          <h3>找不到项目 {{ projectId() }}</h3>
          <p>该项目不存在或已移除</p>
          <a class="btn" routerLink="/projects">返回项目列表</a>
        </section>
      }
    } @else {
      <header class="page-heading">
        <div>
          <h1>交付与售后项目总览</h1>
          <p>一项目一行，按未完成异常优先、下一节点计划日期排序；未知信息标记待提供。</p>
        </div>
        <span class="observe-chip">观察日<strong>{{ store.observationDate() }}</strong></span>
      </header>
      <div class="filter-bar delivery-filters">
        <div class="search-box">
          <input
            aria-label="交付项目或客户搜索"
            placeholder="项目编号、名称或客户"
            [value]="filters().search"
            (input)="setFilter('search', $any($event.target).value)"
          />
        </div>
        <select
          aria-label="交付项目经理筛选"
          [value]="filters().pm"
          (change)="setFilter('pm', $any($event.target).value)"
        >
          <option value="">全部PM</option>
          @for (pm of managers(); track pm) {
            <option [value]="pm">{{ pm }}</option>
          }
        </select>
        <select
          aria-label="交付阶段筛选"
          [value]="filters().stage"
          (change)="setFilter('stage', $any($event.target).value)"
        >
          <option value="">全部阶段</option>
          @for (stage of stages(); track stage) {
            <option [value]="stage">{{ stage }}</option>
          }
        </select>
        <select
          aria-label="交付异常筛选"
          [value]="filters().exception"
          (change)="setFilter('exception', $any($event.target).value)"
        >
          <option value="">全部异常状态</option>
          <option>异常</option>
          <option>无未完成异常</option>
          <option>待提供</option>
        </select>
        <span class="count-label result-count">共 {{ rows().length }} 个项目</span>
      </div>
      <section class="panel table-wrap">
        <table>
          <thead>
            <tr>
              <th>项目 / 客户</th>
              <th>PM / 交付阶段</th>
              <th>下一节点 / 计划日期</th>
              <th>未完成异常</th>
              <th>售后移交</th>
              <th>详情</th>
            </tr>
          </thead>
          <tbody>
            @for (row of rows(); track row.project.id) {
              <tr
                [attr.data-project-id]="row.project.id"
                [class.attention]="row.exceptionState === '异常'"
              >
                <td class="cell-project">
                  <span class="cell-primary">{{ row.project.name || '待提供' }}</span>
                  <span class="cell-secondary">{{ row.project.id }} · {{ row.customer }}</span>
                  <span class="cell-tertiary">合同 {{ row.project.contractId || '待提供' }}</span>
                </td>
                <td>
                  <span class="cell-primary">{{ row.pm }}</span>
                  <span class="cell-secondary">
                    <span class="badge blue">{{ row.stage }}</span>
                  </span>
                </td>
                <td>
                  <span class="cell-primary">{{ row.nextNode }}</span>
                  <span class="cell-secondary num">计划 {{ row.nextDate || '待提供' }}</span>
                </td>
                <td class="cell-exception">
                  <span class="badge {{ exceptionClass(row.exceptionState) }}">{{
                    row.exceptionState
                  }}</span>
                  @for (issue of row.exceptions; track $index) {
                    <span class="cell-tertiary exception-item">{{ issue }}</span>
                  }
                </td>
                <td>
                  <span class="badge {{ handoverClass(row.handover) }}">{{ row.handover }}</span>
                </td>
                <td class="cell-actions">
                  <button
                    class="text-link"
                    type="button"
                    (click)="openProject(row.project.id, 'logistics')"
                  >
                    物流与现场</button
                  ><button
                    class="text-link"
                    type="button"
                    (click)="openProject(row.project.id, 'service')"
                  >
                    运维与售后
                  </button>
                </td>
              </tr>
            } @empty {
              <tr>
                <td colspan="6" class="empty-cell">当前筛选下没有项目</td>
              </tr>
            }
          </tbody>
        </table>
      </section>
    }
  `,
  styles: `
    .observe-chip {
      display: inline-flex;
      align-items: baseline;
      gap: 8px;
      padding: 7px 13px;
      border: 1px solid var(--line);
      border-radius: 7px;
      background: white;
      color: var(--muted);
      font-size: 12px;
      white-space: nowrap;
    }
    .observe-chip strong {
      color: var(--ink);
      font-weight: 600;
      font-variant-numeric: tabular-nums;
    }
    .delivery-filters .result-count {
      margin-left: auto;
      align-self: center;
    }
    table {
      min-width: 850px;
      width: 100%;
    }
    td,
    th {
      padding: 14px 16px;
      text-align: left;
      vertical-align: top;
    }
    tr.attention {
      background: #fffafa;
    }
    tr.attention td:first-child {
      box-shadow: inset 3px 0 0 var(--red);
    }
    .cell-project {
      min-width: 200px;
    }
    .cell-primary,
    .cell-secondary,
    .cell-tertiary {
      display: block;
    }
    .cell-primary {
      font-size: 13px;
      font-weight: 600;
      color: #26364f;
      line-height: 1.45;
    }
    .cell-secondary {
      margin-top: 5px;
      font-size: 11.5px;
      color: var(--muted);
      line-height: 1.5;
    }
    .cell-tertiary {
      margin-top: 3px;
      font-size: 10.5px;
      color: #9aa4b5;
      line-height: 1.5;
      overflow-wrap: anywhere;
    }
    .num {
      font-variant-numeric: tabular-nums;
    }
    .exception-item {
      max-width: 260px;
    }
    .cell-actions {
      white-space: nowrap;
    }
    .cell-actions .text-link {
      display: block;
      margin: 2px 0 8px;
      font-size: 12.5px;
    }
    .empty-cell {
      padding: 42px 24px;
      text-align: center;
      color: var(--muted);
    }
    .detail-heading {
      margin-top: 18px;
    }
    .detail-kicker {
      margin-bottom: 6px;
      font-size: 11.5px;
      color: var(--muted);
    }
    .detail-heading h1 {
      margin: 0;
    }
    .detail-id {
      margin-left: 10px;
      font-size: 14px;
      font-weight: 500;
      color: var(--muted);
      font-variant-numeric: tabular-nums;
      letter-spacing: 0;
    }
    @media (max-width: 760px) {
      .delivery-filters .search-box {
        width: 100%;
      }
      .delivery-filters .result-count {
        margin-left: 0;
        width: 100%;
      }
    }
  `,
})
export class DeliveryService {
  readonly route = inject(ActivatedRoute);
  readonly router = inject(Router);
  readonly store = inject(DemoStore);
  readonly params = toSignal(this.route.queryParamMap, {
    initialValue: this.route.snapshot.queryParamMap,
  });
  readonly tab = computed(() => this.params().get('tab') || 'logistics');
  readonly projectId = computed(
    () => this.params().get('projectId') || this.params().get('project') || '',
  );
  readonly project = computed(() => this.store.project(this.projectId()));
  readonly filters = computed<DeliveryFilters>(() => ({
    search: this.params().get('deliverySearch') || '',
    pm: this.params().get('deliveryPm') || '',
    stage: this.params().get('deliveryStage') || '',
    exception: this.params().get('deliveryException') || '',
  }));
  readonly allRows = computed(() =>
    deliveryRows(
      this.store.state().projects,
      this.store.state().customers,
      this.store.observationDate(),
    ),
  );
  readonly rows = computed(() => filterDeliveryRows(this.allRows(), this.filters()));
  readonly managers = computed(() => [...new Set(this.allRows().map((r) => r.pm))].sort());
  readonly stages = computed(() => [...new Set(this.allRows().map((r) => r.stage))].sort());
  constructor() {
    effect(() => {
      this.params();
      if (!this.projectId()) this.restoreScroll();
    });
  }
  exceptionClass(state: string): string {
    return state === '异常' ? 'red' : state === '待提供' ? '' : 'green';
  }
  handoverClass(status: string): string {
    return status === '已接收' ? 'green' : status === '待提供' ? '' : 'amber';
  }
  setFilter(key: keyof DeliveryFilters, value: string): void {
    const names = {
      search: 'deliverySearch',
      pm: 'deliveryPm',
      stage: 'deliveryStage',
      exception: 'deliveryException',
    };
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { [names[key]]: value || null, deliveryScroll: null },
      queryParamsHandling: 'merge',
      replaceUrl: true,
      preserveFragment: true,
    });
  }
  openProject(projectId: string, tab: string): void {
    const scroll = document.querySelector('main')?.scrollTop || window.scrollY;
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { projectId, project: null, tab, deliveryScroll: scroll },
      queryParamsHandling: 'merge',
      preserveFragment: true,
    });
  }
  openOverview(): void {
    void this.router
      .navigate([], {
        relativeTo: this.route,
        queryParams: { projectId: null, project: null, tab: 'logistics' },
        queryParamsHandling: 'merge',
        preserveFragment: true,
      })
      .then(() => this.restoreScroll());
  }
  selectPlans(): void {
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { tab: 'overview' },
      queryParamsHandling: 'merge',
      preserveFragment: true,
    });
  }
  private restoreScroll(): void {
    const scroll = Number(this.params().get('deliveryScroll') || 0);
    if (!Number.isFinite(scroll) || scroll < 0) return;
    requestAnimationFrame(() => {
      const main = document.querySelector('main');
      if (main) main.scrollTop = scroll;
      window.scrollTo(0, scroll);
    });
  }
}
