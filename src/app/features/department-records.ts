import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { SalesListPosition } from './sales-list-position';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink, UrlTree } from '@angular/router';
import type { WorkItem } from '../core/work-item-registry';
import type { OperationEvent, SalesRecord } from '../core/models';
import { DemoStore } from '../core/store';
import { collectDemoWorkItems } from '../core/work-item-sources';

export type OpportunityDepartment = '销售' | '解决方案' | 'PMO / PM';

/** Navigation context emitted by this list; consumers can use it to restore the originating view. */
export interface DepartmentRecordLocation {
  objectType: 'opportunity';
  objectId: string;
  module: '商机';
  department: OpportunityDepartment;
  section: '概览' | '方案' | '团队';
  action: '查看商机记录';
  mainlineId: string;
  roundId: string;
  projectId?: string;
  productNeedRevision?: number;
  operationId?: string;
  returnContext: {
    department: OpportunityDepartment;
    query: string;
    status: string;
    owner: string;
    mainlineId: string;
    objectId: string;
  };
}

interface DepartmentRecordRow {
  sale: SalesRecord;
  customerName: string;
  customerShortName: string;
  status: string;
  salesOwner: string;
  solutionOwner: string;
  pmoResponsibility: string;
  pmOwner: string;
  responsibilities: string[];
  projectId?: string;
  latestEvent?: OperationEvent;
}

const DEPARTMENTS: OpportunityDepartment[] = ['销售', '解决方案', 'PMO / PM'];
const SECTION: Record<OpportunityDepartment, DepartmentRecordLocation['section']> = {
  销售: '概览',
  解决方案: '方案',
  'PMO / PM': '团队',
};

@Component({
  selector: 'app-department-records',
  imports: [FormsModule, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <main class="department-page">
      <header class="page-heading">
        <div>
          <p class="eyebrow">商机协作 · 只读入口</p>
          <h1>部门记录</h1>
          <p class="intro">按部门职责浏览同一批商机。打开记录只会导航，不会更新业务状态。</p>
        </div>
        <div class="identity-chip">
          <span class="identity-dot"></span>
          当前身份：{{ store.person() }}
        </div>
      </header>

      <nav class="department-tabs" aria-label="商机部门页签">
        @for (item of departments; track item) {
          <button
            type="button"
            class="department-tab"
            [class.active]="department() === item"
            [attr.aria-current]="department() === item ? 'page' : null"
            (click)="selectDepartment(item)"
          >
            <span>{{ item }}</span>
            <span class="tab-count">{{ countFor(item) }}</span>
          </button>
        }
      </nav>

      <section class="overview-strip" aria-label="当前部门视图">
        <div>
          <span class="section-kicker">当前视角</span>
          <strong>{{ department() }}</strong>
          <p>{{ departmentDescription() }}</p>
        </div>
        <div class="overview-stat">
          <strong>{{ rows().length }}</strong>
          <span>条相关商机</span>
        </div>
      </section>

      <section class="department-work-items" aria-label="当前部门工作项">
        <div class="work-items-heading">
          <div>
            <h2>本部门工作项</h2>
            <p>任务ID与首页待办及导航计数来自同一注册表。</p>
          </div>
          <strong
            >{{ departmentWorkItems().length }}项 · {{ openDepartmentWorkItems() }}项待处理</strong
          >
        </div>
        @for (item of departmentWorkItems(); track item.id) {
          <a
            class="department-work-item"
            [attr.data-work-item-id]="item.id"
            [routerLink]="workItemTarget(item)"
            (click)="position.remember()"
          >
            <span
              ><b>{{ item.title }}</b
              ><small>{{ item.id }} · {{ workItemBusiness(item) }}</small></span
            >
            <span class="work-item-meta"
              >{{ item.department }} / {{ item.owner }} · 计划日期 {{ item.dueDate || '未记录' }} ·
              {{ item.status === 'completed' ? '已完成' : '待处理' }}</span
            >
          </a>
        } @empty {
          <p class="department-work-empty">当前部门没有已登记工作项。</p>
        }
      </section>

      <section class="filter-panel" aria-label="筛选商机记录">
        <label class="search-field">
          <span class="field-label">客户或编号</span>
          <input
            type="search"
            aria-label="搜索客户名称、商机编号或项目名称"
            placeholder="输入客户名、商机编号或项目名"
            [ngModel]="query()"
            (ngModelChange)="query.set($event)"
          />
        </label>
        <label class="select-field">
          <span class="field-label">业务状态</span>
          <select
            aria-label="按业务状态筛选"
            [ngModel]="status()"
            (ngModelChange)="status.set($event)"
          >
            <option value="">全部状态</option>
            @for (item of statusOptions(); track item) {
              <option [value]="item">{{ item }}</option>
            }
          </select>
        </label>
        <label class="select-field">
          <span class="field-label">责任人</span>
          <select aria-label="按责任人筛选" [ngModel]="owner()" (ngModelChange)="owner.set($event)">
            <option value="">全部责任人</option>
            @for (item of ownerOptions(); track item) {
              <option [value]="item">{{ item }}</option>
            }
          </select>
        </label>
        <button class="reset-button" type="button" (click)="clearFilters()">清除筛选</button>
      </section>

      @if (department() === 'PMO / PM') {
        <p class="responsibility-note">
          PMO事项与PM责任人分别展示；没有明确记录时显示“未记录”，不会按当前登录身份推定负责人。
        </p>
      }

      @if (rows().length) {
        <section class="record-list" aria-label="商机记录清单">
          @for (row of rows(); track row.sale.id) {
            <article class="record-card">
              <div class="record-main">
                <div class="record-title-row">
                  <div>
                    <span class="record-id">{{ row.sale.id }}</span>
                    <h2>{{ row.sale.projectName || '项目名称待补' }}</h2>
                  </div>
                  <span class="status-pill" [class.status-done]="row.status === '已完成'">{{
                    row.status
                  }}</span>
                </div>
                <p class="customer-line">
                  <span class="customer-mark">{{
                    (row.customerShortName || row.customerName || '客').slice(0, 1)
                  }}</span>
                  <strong>{{ row.customerShortName || row.customerName || '客户资料待补' }}</strong>
                  <span>{{ row.customerName }}</span>
                </p>
                <div class="record-meta">
                  <span
                    >商机负责人 <b>{{ row.salesOwner || '未记录' }}</b></span
                  >
                  @if (department() === '解决方案') {
                    <span
                      >方案责任人 <b>{{ row.solutionOwner || '未记录' }}</b></span
                    >
                  }
                  @if (department() === 'PMO / PM') {
                    <span
                      >PMO事项 <b>{{ row.pmoResponsibility }}</b></span
                    >
                    <span
                      >PM责任人 <b>{{ row.pmOwner }}</b></span
                    >
                  }
                  @if (row.projectId) {
                    <span
                      >关联项目 <b>{{ row.projectId }}</b></span
                    >
                  }
                </div>
                @if (row.latestEvent; as event) {
                  <p class="last-operation">
                    最近留痕：{{ event.location.action }} · {{ event.occurredAt }}
                  </p>
                }
              </div>
              <div class="record-actions">
                <button type="button" class="open-button" (click)="openRecord(row)">
                  查看详情 <span aria-hidden="true">→</span>
                </button>
              </div>
            </article>
          }
        </section>
      } @else {
        <section class="empty-state" aria-live="polite">
          <div class="empty-icon" aria-hidden="true">⌕</div>
          <h2>{{ hasApplicableRecords() ? '没有匹配的商机' : '当前没有本部门记录' }}</h2>
          <p>
            @if (hasApplicableRecords()) {
              可清除筛选条件，或调整客户、编号、状态和责任人后重试。
            } @else if (department() === '解决方案') {
              尚无方案初判、方案任务或方案人员记录。请从销售商机的方案区查看后续工作。
            } @else if (department() === 'PMO / PM') {
              尚无PM分配或PMO/PM部门任务记录。有效提交后，由PMO按既有分配流程处理。
            } @else {
              当前没有可查看的商机；线索需先完成有效业务转换。
            }
          </p>
          @if (hasApplicableRecords()) {
            <button type="button" class="empty-action" (click)="clearFilters()">
              显示全部本部门记录
            </button>
          }
        </section>
      }
      <footer class="page-footnote">
        <span class="read-only-mark">只读浏览</span>
        <span>部门页签表示工作视角，不改变人员任命、业务状态或本轮进度。</span>
      </footer>
    </main>
  `,
  styles: `
    :host {
      display: block;
      color: var(--ink, #182230);
    }
    .department-page {
      max-width: 1180px;
      margin: 0 auto;
      padding: 22px 26px 44px;
    }
    .page-heading {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      gap: 20px;
      margin-bottom: 24px;
    }
    .eyebrow,
    .section-kicker {
      display: block;
      margin: 0 0 7px;
      color: #748198;
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 0.06em;
      text-transform: uppercase;
    }
    h1 {
      margin: 0;
      font-size: 25px;
      letter-spacing: -0.02em;
    }
    .intro {
      margin: 8px 0 0;
      color: #737f91;
      font-size: 13px;
    }
    .identity-chip {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 9px 12px;
      color: #57657a;
      background: #fff;
      border: 1px solid #e8ecf2;
      border-radius: 9px;
      font-size: 12px;
      white-space: nowrap;
    }
    .identity-dot {
      width: 8px;
      height: 8px;
      background: #7193e6;
      border-radius: 50%;
    }
    .department-tabs {
      display: flex;
      gap: 7px;
      padding: 6px;
      margin-bottom: 15px;
      overflow-x: auto;
      background: #f0f3f8;
      border-radius: 11px;
    }
    .department-tab {
      display: flex;
      align-items: center;
      gap: 10px;
      min-width: max-content;
      padding: 10px 14px;
      border: 0;
      border-radius: 8px;
      color: #647187;
      background: transparent;
      font: inherit;
      font-size: 13px;
      cursor: pointer;
    }
    .department-tab.active {
      color: #2149a5;
      background: #fff;
      box-shadow: 0 1px 4px #1c2f5014;
      font-weight: 700;
    }
    .tab-count {
      min-width: 21px;
      padding: 2px 6px;
      border-radius: 10px;
      color: #7c8798;
      background: #e9edf3;
      text-align: center;
      font-size: 10px;
    }
    .active .tab-count {
      color: #315cbd;
      background: #e9efff;
    }
    .overview-strip {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 17px 20px;
      margin-bottom: 14px;
      background: #fff;
      border: 1px solid #e8ecf2;
      border-radius: 11px;
    }
    .overview-strip strong {
      display: block;
      font-size: 15px;
    }
    .overview-strip p {
      margin: 5px 0 0;
      color: #798497;
      font-size: 12px;
    }
    .overview-stat {
      min-width: 90px;
      text-align: right;
    }
    .overview-stat strong {
      font-size: 23px;
      color: #315cbd;
    }
    .overview-stat span {
      display: block;
      margin-top: 2px;
      color: #818b9c;
      font-size: 11px;
    }
    .department-work-items {
      padding: 16px 18px;
      margin: 0 0 14px;
      background: #fff;
      border: 1px solid #e8ecf2;
      border-radius: 11px;
    }
    .work-items-heading {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      margin-bottom: 8px;
    }
    .work-items-heading h2 {
      margin: 0;
      font-size: 14px;
    }
    .work-items-heading p,
    .department-work-empty {
      margin: 5px 0 0;
      color: #818b9c;
      font-size: 11px;
    }
    .work-items-heading > strong {
      color: #315cbd;
      font-size: 11px;
      white-space: nowrap;
    }
    .department-work-item {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      padding: 10px 0;
      border-top: 1px solid #eef1f5;
    }
    .department-work-item b,
    .department-work-item small {
      display: block;
    }
    .department-work-item b {
      color: #34425a;
      font-size: 12px;
    }
    .department-work-item small,
    .work-item-meta {
      margin-top: 4px;
      color: #8791a1;
      font-size: 10px;
    }
    .work-item-meta {
      white-space: nowrap;
    }
    .filter-panel {
      display: flex;
      align-items: end;
      gap: 12px;
      padding: 15px;
      margin-bottom: 12px;
      background: #fff;
      border: 1px solid #e8ecf2;
      border-radius: 11px;
    }
    .search-field,
    .select-field {
      display: grid;
      gap: 6px;
    }
    .search-field {
      flex: 1;
      min-width: 220px;
    }
    .select-field {
      min-width: 155px;
    }
    .field-label {
      color: #6e798c;
      font-size: 11px;
      font-weight: 600;
    }
    input,
    select {
      width: 100%;
      height: 38px;
      box-sizing: border-box;
      padding: 0 11px;
      border: 1px solid #dfe4ec;
      border-radius: 7px;
      color: #243044;
      background: #fff;
      font: inherit;
      font-size: 12px;
      outline: none;
    }
    input:focus,
    select:focus {
      border-color: #7291df;
      box-shadow: 0 0 0 3px #7291df20;
    }
    .reset-button,
    .empty-action {
      height: 38px;
      padding: 0 12px;
      border: 1px solid #e0e5ed;
      border-radius: 7px;
      color: #546278;
      background: #fff;
      font: inherit;
      font-size: 12px;
      cursor: pointer;
      white-space: nowrap;
    }
    .reset-button:hover,
    .empty-action:hover {
      border-color: #aab8d3;
      color: #315cbd;
    }
    .responsibility-note {
      margin: 4px 2px 12px;
      color: #778296;
      font-size: 11px;
    }
    .record-list {
      display: grid;
      gap: 10px;
    }
    .record-card {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 20px;
      padding: 17px 19px;
      background: #fff;
      border: 1px solid #e8ecf2;
      border-radius: 11px;
      transition:
        border-color 0.15s ease,
        box-shadow 0.15s ease;
    }
    .record-card:hover {
      border-color: #d6deee;
      box-shadow: 0 4px 16px #172b4d08;
    }
    .record-main {
      min-width: 0;
      flex: 1;
    }
    .record-title-row {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 16px;
    }
    .record-id {
      color: #8792a3;
      font-size: 10px;
      font-variant-numeric: tabular-nums;
    }
    .record-title-row h2 {
      margin: 3px 0 0;
      font-size: 15px;
      font-weight: 650;
    }
    .status-pill {
      flex: 0 0 auto;
      padding: 5px 9px;
      border-radius: 20px;
      color: #586987;
      background: #f0f3f8;
      font-size: 10px;
    }
    .status-done {
      color: #26745b;
      background: #eaf6f0;
    }
    .customer-line {
      display: flex;
      align-items: center;
      gap: 8px;
      margin: 11px 0;
      color: #8791a1;
      font-size: 11px;
    }
    .customer-line strong {
      color: #38465c;
      font-size: 12px;
    }
    .customer-mark {
      display: grid;
      place-items: center;
      width: 23px;
      height: 23px;
      border-radius: 7px;
      color: #506ca8;
      background: #eef2fc;
      font-size: 10px;
      font-weight: 700;
    }
    .record-meta {
      display: flex;
      flex-wrap: wrap;
      gap: 7px 18px;
      color: #7c8799;
      font-size: 10px;
    }
    .record-meta b {
      color: #48566b;
      font-weight: 600;
    }
    .last-operation {
      margin: 10px 0 0;
      color: #909aab;
      font-size: 10px;
    }
    .record-actions {
      flex: 0 0 auto;
    }
    .open-button {
      padding: 9px 12px;
      border: 1px solid #dce4f2;
      border-radius: 7px;
      color: #315cbd;
      background: #f8faff;
      font: inherit;
      font-size: 11px;
      font-weight: 650;
      cursor: pointer;
    }
    .open-button:hover {
      border-color: #b8c8ea;
      background: #f0f4ff;
    }
    .open-button span {
      padding-left: 5px;
    }
    .empty-state {
      display: grid;
      justify-items: center;
      padding: 48px 24px;
      text-align: center;
      background: #fff;
      border: 1px dashed #dce2eb;
      border-radius: 11px;
    }
    .empty-icon {
      display: grid;
      place-items: center;
      width: 43px;
      height: 43px;
      margin-bottom: 12px;
      border-radius: 13px;
      color: #7c8aa1;
      background: #f2f5f9;
      font-size: 28px;
    }
    .empty-state h2 {
      margin: 0 0 7px;
      font-size: 15px;
    }
    .empty-state p {
      max-width: 470px;
      margin: 0;
      color: #7b8799;
      font-size: 12px;
      line-height: 1.7;
    }
    .empty-action {
      margin-top: 15px;
    }
    .page-footnote {
      display: flex;
      align-items: center;
      gap: 9px;
      margin-top: 18px;
      color: #8791a1;
      font-size: 10px;
    }
    .read-only-mark {
      padding: 4px 7px;
      border-radius: 5px;
      color: #4c678f;
      background: #eef3fa;
      font-weight: 700;
    }
    @media (max-width: 760px) {
      .department-page {
        padding: 17px 14px 32px;
      }
      .page-heading {
        align-items: flex-start;
        flex-direction: column;
        margin-bottom: 17px;
      }
      .identity-chip {
        align-self: flex-start;
      }
      .filter-panel {
        align-items: stretch;
        flex-direction: column;
      }
      .search-field,
      .select-field {
        min-width: 0;
      }
      .reset-button {
        align-self: flex-start;
      }
      .record-card {
        align-items: flex-start;
        flex-direction: column;
        gap: 13px;
      }
      .record-actions {
        align-self: flex-end;
      }
      .overview-strip {
        padding: 15px;
      }
    }
  `,
})
export class DepartmentRecords {
  readonly store = inject(DemoStore);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  readonly departments = DEPARTMENTS;
  readonly position = inject(SalesListPosition);
  constructor() {
    this.position.restore();
    this.route.queryParamMap.pipe(takeUntilDestroyed()).subscribe((params) => {
      const requested = params.get('department') || params.get('dept');
      if (DEPARTMENTS.includes(requested as OpportunityDepartment))
        this.department.set(requested as OpportunityDepartment);
      else if (/^(PM|PMO)$/i.test(requested || '')) this.department.set('PMO / PM');
      else if (requested === 'solution') this.department.set('解决方案');
      this.query.set(params.get('q') || '');
      this.owner.set(params.get('owner') || '');
      this.status.set(params.get('status') || '');
    });

    if (this.router.url.split('?')[0] === '/sales/departments') {
      void this.router.navigate(['/sales/opportunities'], {
        queryParams: { ...this.route.snapshot.queryParams, tab: 'departments' },
        replaceUrl: true,
      });
    }
    effect(() => {
      const queryParams = {
        tab: 'departments',
        department: this.department(),
        q: this.query() || null,
        status: this.status() || null,
        owner: this.owner() || null,
      };
      if (this.router.url.split('?')[0] !== '/sales/departments')
        void this.router.navigate([], {
          relativeTo: this.route,
          queryParams,
          queryParamsHandling: 'merge',
          replaceUrl: true,
        });
    });
  }
  workItemBusiness(item: WorkItem): string {
    const sale = this.workItemSale(item);
    return sale
      ? `${sale.id} · ${this.store.customer(sale.customerId)?.name || '客户未记录'}`
      : '关联商机未记录';
  }
  private workItemSale(item: WorkItem) {
    const match = item.href?.match(/^\/sales\/(?:detail|solutions|quotes)\/([^?#]+)/);
    if (match) {
      let id: string;
      try {
        id = decodeURIComponent(match[1]);
      } catch {
        return undefined;
      }
      return this.store.state().sales.find((sale) => sale.id === id && sale.type === 'opportunity');
    }
    const project = this.store.state().projects.find((project) => project.id === item.projectId);
    return this.store
      .state()
      .sales.find((sale) => sale.id === project?.opportunityId && sale.type === 'opportunity');
  }
  workItemTarget(item: WorkItem): UrlTree | null {
    const valid = /^\/sales\/(detail|solutions|quotes)\//.test(item.href || '')
      ? !!this.workItemSale(item)
      : !!item.projectId &&
        this.store.state().projects.some((project) => project.id === item.projectId);
    if (!valid || !item.href?.startsWith('/') || item.href.startsWith('//')) return null;
    const target = this.router.parseUrl(item.href);
    target.queryParams = {
      ...target.queryParams,
      returnTo: this.returnUrl(),
      returnLabel: '返回部门记录',
    };
    return target;
  }
  private returnUrl(): string {
    return this.router.serializeUrl(
      this.router.createUrlTree(['/sales/opportunities'], {
        queryParams: {
          ...this.route.snapshot.queryParams,
          tab: 'departments',
          department: this.department(),
          q: this.query() || null,
          status: this.status() || null,
          owner: this.owner() || null,
        },
      }),
    );
  }
  readonly query = signal(this.route.snapshot.queryParamMap.get('q') || '');
  readonly status = signal(this.route.snapshot.queryParamMap.get('status') || '');
  readonly owner = signal(this.route.snapshot.queryParamMap.get('owner') || '');
  readonly department = signal<OpportunityDepartment>(this.initialDepartment());

  readonly workItemView = computed(() => collectDemoWorkItems(this.store.state()));
  readonly departmentWorkItems = computed(() =>
    this.workItemView().items.filter(
      (item) =>
        this.itemBelongsToDepartment(item.department) &&
        ((!this.query() && !this.status() && !this.owner()) ||
          this.rows().some((row) => row.sale.id === this.workItemSale(item)?.id)),
    ),
  );
  readonly openDepartmentWorkItems = computed(
    () => this.departmentWorkItems().filter((item) => item.status === 'open').length,
  );

  readonly allRows = computed(() =>
    this.store
      .state()
      .sales.filter((sale) => sale.type === 'opportunity')
      .map((sale) => this.toRow(sale)),
  );

  readonly applicableRows = computed(() =>
    this.allRows().filter((row) => this.appliesTo(row, this.department())),
  );

  readonly rows = computed(() => {
    const needle = this.query().trim().toLocaleLowerCase();
    return this.applicableRows().filter((row) => {
      const textMatch =
        !needle ||
        [row.sale.id, row.sale.projectName, row.customerName, row.customerShortName]
          .filter(Boolean)
          .some((value) => value!.toLocaleLowerCase().includes(needle));
      const statusMatch = !this.status() || row.status === this.status();
      const ownerMatch =
        !this.owner() || row.responsibilities.some((person) => person === this.owner());
      return textMatch && statusMatch && ownerMatch;
    });
  });

  readonly statusOptions = computed(() => {
    const values = new Set(
      this.applicableRows()
        .map((row) => row.status)
        .filter(Boolean),
    );
    return [...values].sort((a, b) => a.localeCompare(b, 'zh-CN'));
  });

  readonly ownerOptions = computed(() => {
    const values = new Set(
      this.applicableRows()
        .flatMap((row) => row.responsibilities)
        .filter(Boolean),
    );
    return [...values].sort((a, b) => a.localeCompare(b, 'zh-CN'));
  });

  countFor(department: OpportunityDepartment): number {
    return this.allRows().filter((row) => this.appliesTo(row, department)).length;
  }

  hasApplicableRecords(): boolean {
    return this.applicableRows().length > 0;
  }

  departmentDescription(): string {
    switch (this.department()) {
      case '销售':
        return '查看销售负责的商机及阶段，负责人保持业务记录中的原值。';
      case '解决方案':
        return '仅显示已有方案初判、方案任务或方案人员记录的商机。';
      case 'PMO / PM':
        return '共用工作入口；PMO事项和已任命PM分别展示，不推定未记录的责任人。';
    }
  }

  selectDepartment(department: OpportunityDepartment): void {
    this.department.set(department);
    this.status.set('');
    this.owner.set('');
  }

  clearFilters(): void {
    this.query.set('');
    this.status.set('');
    this.owner.set('');
  }

  locationFor(row: DepartmentRecordRow): DepartmentRecordLocation {
    const department = this.department();
    return {
      objectType: 'opportunity',
      objectId: row.sale.id,
      module: '商机',
      department,
      section: SECTION[department],
      action: '查看商机记录',
      mainlineId: row.sale.leadId || row.sale.id,
      roundId: this.store.state().roundId || '',
      projectId: row.projectId,
      productNeedRevision: row.sale.productNeedRevision,
      operationId: row.latestEvent?.id,
      returnContext: {
        department,
        query: this.query(),
        status: this.status(),
        owner: this.owner(),
        mainlineId: row.sale.leadId || row.sale.id,
        objectId: row.sale.id,
      },
    };
  }

  async openRecord(row: DepartmentRecordRow): Promise<void> {
    this.position.remember();
    const location = this.locationFor(row);
    const returnTo = this.router.serializeUrl(
      this.router.createUrlTree(['/sales/opportunities'], {
        queryParams: {
          tab: 'departments',
          department: location.returnContext.department,
          q: location.returnContext.query || null,
          status: location.returnContext.status || null,
          owner: location.returnContext.owner || null,
          mainlineId: location.returnContext.mainlineId,
          objectId: location.returnContext.objectId,
        },
      }),
    );
    await this.router.navigate(['/sales/detail', row.sale.id], {
      queryParams: {
        tab: location.section,
        department: location.department,
        objectType: location.objectType,
        objectId: location.objectId,
        module: location.module,
        section: location.section,
        action: location.action,
        mainlineId: location.mainlineId,
        roundId: location.roundId,
        projectId: location.projectId || null,
        productNeedRevision: location.productNeedRevision ?? null,
        operationId: location.operationId || null,
        returnTo,
        returnDepartment: location.returnContext.department,
        returnQuery: location.returnContext.query || null,
        returnStatus: location.returnContext.status || null,
        returnOwner: location.returnContext.owner || null,
        returnMainlineId: location.returnContext.mainlineId,
        returnObjectId: location.returnContext.objectId,
      },
    });
  }

  private initialDepartment(): OpportunityDepartment {
    const requested =
      this.route.snapshot.queryParamMap.get('department') ||
      this.route.snapshot.queryParamMap.get('dept');
    if (requested === 'PM' || requested === 'PMO' || requested === 'pm' || requested === 'pmo')
      return 'PMO / PM';
    if (requested === 'solution') return '解决方案';
    if (DEPARTMENTS.includes(requested as OpportunityDepartment))
      return requested as OpportunityDepartment;
    const role = this.store.role();
    if (role === 'solution') return '解决方案';
    if (role === 'pm' || role === 'pmo') return 'PMO / PM';
    return '销售';
  }

  private toRow(sale: SalesRecord): DepartmentRecordRow {
    const state = this.store.state();
    const customer = state.customers.find((item) => item.id === sale.customerId);
    const tasks = sale.departmentTasks || [];
    const solutionTask = tasks.filter((task) => this.isSolutionDepartment(task.department));
    const pmoTasks = tasks.filter((task) => this.isPmoDepartment(task.department));
    const pmTasks = tasks.filter((task) => this.isPmDepartment(task.department));
    const solutionTeam = sale.team.filter((member) => this.isSolutionDepartment(member.department));
    const pmoTeam = sale.team.filter((member) => this.isPmoDepartment(member.department));
    const pmTeam = sale.team.filter((member) => this.isPmDepartment(member.department));
    const latestAssessment = sale.technicalAssessments?.at(-1);
    const events = (state.operationEvents || [])
      .filter((event) => event.objectType === 'opportunity' && event.objectId === sale.id)
      .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));
    const projectId = state.projects.find((project) => project.opportunityId === sale.id)?.id;
    const status = this.statusFor(sale, latestAssessment?.result || '', [...pmoTasks, ...pmTasks]);
    const solutionOwner =
      latestAssessment?.owner || solutionTeam.map((member) => member.person).join('、');
    const pmoResponsibility = pmoTasks.length
      ? pmoTasks
          .map(
            (task) =>
              `${task.name}：${task.status}${task.completedBy ? `（${task.completedBy}）` : ''}`,
          )
          .join('；')
      : pmoTeam.length
        ? `人员已列入：${pmoTeam.map((member) => member.person).join('、')}`
        : '未记录';
    const pmOwner =
      sale.pmoAssignment?.pmName || pmTeam.map((member) => member.person).join('、') || '未记录';
    const responsibilities =
      this.department() === '解决方案'
        ? [latestAssessment?.owner, ...solutionTeam.map((member) => member.person)]
        : this.department() === 'PMO / PM'
          ? [
              sale.pmoAssignment?.pmName,
              ...pmoTasks.map((task) => task.completedBy),
              ...pmoTeam.map((member) => member.person),
              ...pmTeam.map((member) => member.person),
            ]
          : [sale.owner];
    return {
      sale,
      customerName: customer?.name || '',
      customerShortName: customer?.shortName || '',
      status,
      salesOwner: sale.owner,
      solutionOwner: solutionOwner || '未记录',
      pmoResponsibility,
      pmOwner,
      responsibilities: [...new Set(responsibilities.filter((name): name is string => !!name))],
      projectId,
      latestEvent: events.find((event) => this.eventMatchesDepartment(event, this.department())),
    };
  }

  private appliesTo(row: DepartmentRecordRow, department: OpportunityDepartment): boolean {
    if (department === '销售') return true;
    const sale = row.sale;
    const state = this.store.state();
    const events = (state.operationEvents || []).filter(
      (event) => event.objectType === 'opportunity' && event.objectId === sale.id,
    );
    if (department === '解决方案') {
      return !!(
        sale.technicalAssessments?.length ||
        sale.team.some((member) => this.isSolutionDepartment(member.department)) ||
        sale.departmentTasks?.some((task) => this.isSolutionDepartment(task.department)) ||
        events.some((event) => this.isSolutionDepartment(event.department))
      );
    }
    return !!(
      sale.pmoAssignment ||
      sale.team.some(
        (member) =>
          this.isPmoDepartment(member.department) || this.isPmDepartment(member.department),
      ) ||
      sale.departmentTasks?.some(
        (task) => this.isPmoDepartment(task.department) || this.isPmDepartment(task.department),
      ) ||
      events.some(
        (event) => this.isPmoDepartment(event.department) || this.isPmDepartment(event.department),
      )
    );
  }

  private statusFor(
    sale: SalesRecord,
    solutionStatus: string,
    tasks: SalesRecord['departmentTasks'],
  ): string {
    switch (this.department()) {
      case '销售':
        return sale.stage || '状态待核';
      case '解决方案':
        return solutionStatus || '待初判';
      case 'PMO / PM': {
        const statusSet = [...new Set((tasks || []).map((task) => task.status))];
        if (statusSet.length) return statusSet.join(' / ');
        return sale.pmoAssignment ? '已指定PM' : 'PM待分配';
      }
    }
  }

  private isSolutionDepartment(value: string): boolean {
    return /方案|solution/i.test(value);
  }

  private itemBelongsToDepartment(value: string): boolean {
    if (this.department() === '销售') return /销售|sales/i.test(value);
    if (this.department() === '解决方案') return this.isSolutionDepartment(value);
    return this.isPmoDepartment(value) || this.isPmDepartment(value);
  }

  private isPmoDepartment(value: string): boolean {
    return /PMO|部门负责人/i.test(value);
  }

  private isPmDepartment(value: string): boolean {
    return /项目经理|(^|\b)PM(\b|$)/i.test(value);
  }

  private eventMatchesDepartment(
    event: OperationEvent,
    department: OpportunityDepartment,
  ): boolean {
    if (department === '销售') return event.department === '销售';
    if (department === '解决方案') return this.isSolutionDepartment(event.department);
    return this.isPmoDepartment(event.department) || this.isPmDepartment(event.department);
  }
}
