import { Component, computed, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { formatV10Money, formatV10Percent } from '../core/management-v10-platform/format';
import {
  useV10ReadContext,
  useV10ViewNavigation,
  defaultV10ViewFilters,
} from '../core/v10-platform';
import {
  buildV10Target,
  selectV10Board,
  selectV10Finance,
  selectV10Exceptions,
} from '../core/v10-contracts';
import type { V10DeliveryStatus, V10ExecutionScope } from '../core/v10-contracts';

@Component({
  selector: 'app-v10-baseline-panel',
  imports: [RouterLink],
  styleUrl: './v10-baseline-panel.scss',
  template: `
    <section aria-label="V10公共基线读取" class="v10-baseline">
      <h2>
        V10公共基线 ·
        {{ page() === 'finance' ? '毛利详情' : page() === 'exceptions' ? '异常判断' : '高层看板' }}
      </h2>
      <p>读取验证占位，正式页面尚未验收。</p>
      @if (navigation.returnTarget(); as href) {
        <a [routerLink]="href" data-v10-focus="return">返回上一层</a>
      }
      @for (notice of navigation.notices(); track notice) {
        <p role="status">{{ notice }}</p>
      }
      @if (navigation.error(); as error) {
        <p role="status">{{ error }}</p>
      }
      <nav aria-label="公共入口">
        <a [routerLink]="navigation.childTarget(boardHref)" data-v10-focus="board">高层看板</a> ·
        <a [routerLink]="navigation.childTarget(financeHref)" data-v10-focus="finance">毛利详情</a>
        ·
        <a [routerLink]="navigation.childTarget(exceptionsHref)" data-v10-focus="exceptions"
          >异常判断</a
        >
      </nav>
      @if (page() === 'finance') {
        <nav aria-label="财务页签">
          @for (tab of financeTabs; track tab.key) {
            <button
              type="button"
              (click)="navigation.update({ tab: tab.key })"
              [attr.data-v10-focus]="'tab-' + tab.key"
            >
              {{ tab.label }}
            </button>
          }
        </nav>
      }
      @if (page() === 'exceptions') {
        <nav aria-label="异常页签">
          <button
            type="button"
            (click)="navigation.update({ tab: 'delivery' })"
            data-v10-focus="tab-delivery"
          >
            客户交付
          </button>
          ·
          <button
            type="button"
            (click)="navigation.update({ tab: 'management' })"
            data-v10-focus="tab-management"
          >
            其他管理异常
          </button>
        </nav>
      }
      <div class="v10-controls">
        <label
          >搜索
          <input
            aria-label="验证搜索"
            data-v10-focus="query"
            [value]="filters().query"
            (change)="navigation.update({ query: $any($event.target).value })"
        /></label>
        @if (page() === 'finance') {
          <label
            >币种
            <select
              aria-label="币种"
              [value]="filters().currency"
              (change)="navigation.update({ currency: $any($event.target).value })"
            >
              <option value="">来源默认</option>
              <option>EUR</option>
              <option>USD</option>
              <option>CNY</option>
            </select></label
          >
          <label
            >期间起
            <input type="date" aria-label="期间起" [value]="filters().periodStart" #periodStart
          /></label>
          <label
            >期间止 <input type="date" aria-label="期间止" [value]="filters().periodEnd" #periodEnd
          /></label>
          <button
            type="button"
            (click)="
              navigation.update({ periodStart: periodStart.value, periodEnd: periodEnd.value })
            "
          >
            应用整月期间
          </button>
        }
        @if (page() === 'exceptions' && filters().tab === 'delivery') {
          <label
            >执行范围
            <select
              aria-label="执行范围"
              [value]="filters().scope"
              (change)="navigation.update({ scope: $any($event.target).value })"
            >
              <option value="active">当前执行</option>
              <option value="completed">已完成</option>
              <option value="cancelled">已取消</option>
              <option value="all">全部</option>
            </select></label
          >
          <button
            type="button"
            data-v10-focus="status-delayed"
            (click)="navigation.update({ status: 'delayed', query: '' })"
          >
            仅看延期
          </button>
          <button type="button" (click)="navigation.update({ status: 'warning', query: '' })">
            仅看预警
          </button>
          <button type="button" (click)="navigation.update({ status: '', query: '' })">
            全部状态
          </button>
        }
      </div>
      <p>当前页签：{{ target().tab }}</p>
      @if (read.context(); as context) {
        <p>
          工作区 {{ context.workspaceId }} · 轮次 {{ context.roundId }} · 数据修订
          {{ context.dataVersion }} · 读取修订 {{ context.contextRevision }}
        </p>
        <p>
          方案业务日 {{ context.dates.solutionBusinessDate }}（{{ context.dates.timezone }}） ·
          计划观察日 {{ context.dates.planObservationDate }}
        </p>
        <p>
          本次查看 {{ context.dates.realNowUtc }} · 最近成功读取
          {{ context.dates.lastSuccessfulReadAt ?? '未知' }} · 来源更新时间：未提供
        </p>
        <p>各指标沿用各自日期；财务期间不随计划观察档改动。</p>
        <button type="button" (click)="read.refresh()">刷新读取</button>
        <button type="button" (click)="read.refreshFiles()">重新核验文件</button>
        <p>文件核验 {{ fileSummary() }}</p>
      } @else {
        <p role="status">正在读取已提交来源</p>
      }
      @if (finance(); as result) {
        <p>
          财务来源：{{ result.status }} · 批次 {{ result.batchId ?? '待补' }} · 期间
          {{ result.period?.periodStart ?? '待补' }} 至 {{ result.period?.periodEnd ?? '待补' }}
        </p>
        <p>财务与费用、预算的日期按各自来源保留。</p>
        @for (issue of result.issues; track issue) {
          <p role="status">{{ issue }}</p>
        }
        <p>
          毛利 {{ money(result.summary?.grossProfitMinor, result.currency) }} · 毛利率
          {{ percent(result.summary?.grossMargin) }}
        </p>
      }
      @if (exceptions(); as result) {
        <p>
          异常来源：{{ result.status }} · 客户交付项目数
          {{ result.delivery?.projectCount ?? '不可用／当前非交付页签' }} · 管理事项数
          {{ result.management?.itemCount ?? '不可用／当前非管理页签' }}
        </p>
      }
      @if (board(); as result) {
        <p>
          执行项目来源：{{ result.overview.execution.status }} · 财务来源：{{
            result.overview.finance.status
          }}
        </p>
      }
      <button
        type="button"
        data-v10-focus="expand-projects"
        [attr.aria-expanded]="navigation.view()?.expanded?.includes('projects') ?? false"
        (click)="navigation.toggle('projects')"
      >
        项目入口明细
      </button>
      @if (navigation.view()?.expanded?.includes('projects')) {
        @for (project of projectLinks(); track project.id) {
          <p>
            <a
              [routerLink]="navigation.childTarget(project.href)"
              [attr.data-v10-focus]="project.id"
              >{{ project.name }} · 原项目财务</a
            >
          </p>
        } @empty {
          <p role="status">当前条件无匹配项目，请调整筛选。</p>
        }
      }
      <p class="v10-format">
        格式示例：{{ money(-123456, 'EUR') }} · {{ money(null, 'EUR') }} · {{ percent(-0.125) }} ·
        {{ percent(null) }}
      </p>
    </section>
  `,
})
export class V10BaselinePanel {
  readonly page = input<'board' | 'finance' | 'exceptions'>('board');
  readonly read = useV10ReadContext();
  readonly navigation = useV10ViewNavigation();
  readonly filters = computed(
    () => this.navigation.view()?.filters ?? defaultV10ViewFilters('/projects/board'),
  );
  readonly money = formatV10Money;
  readonly percent = formatV10Percent;
  readonly boardHref = buildV10Target({ page: 'board' }).href;
  readonly financeHref = buildV10Target({ page: 'finance' }).href;
  readonly exceptionsHref = buildV10Target({ page: 'exceptions' }).href;
  readonly financeTabs = [
    { key: 'margin', label: '毛利' },
    { key: 'budget', label: '预算' },
    { key: 'finance', label: '财务' },
  ];
  readonly target = computed(() => ({ ...this.filters(), notices: this.navigation.notices() }));
  readonly finance = computed(() => {
    const s = this.read.snapshot();
    return s && this.page() === 'finance'
      ? selectV10Finance(s.state, s.context, {
          keyword: this.filters().query,
          currency: (this.filters().currency || undefined) as 'CNY' | 'EUR' | 'USD' | undefined,
          periodStart: this.filters().periodStart || undefined,
          periodEnd: this.filters().periodEnd || undefined,
        })
      : null;
  });
  readonly exceptions = computed(() => {
    const s = this.read.snapshot(),
      t = this.target();
    return s && this.page() === 'exceptions'
      ? selectV10Exceptions(s.state, s.context, {
          tab: t.tab === 'management' ? 'management' : 'delivery',
          scope: (t.scope || 'active') as V10ExecutionScope | 'all',
          status: (t.status || undefined) as V10DeliveryStatus | undefined,
          keyword: t.query,
        })
      : null;
  });
  readonly board = computed(() => {
    const s = this.read.snapshot();
    return s && this.page() === 'board'
      ? selectV10Board(s.state, s.context, {
          execution: { keyword: this.filters().query },
          presales: { keyword: this.filters().query },
        })
      : null;
  });
  readonly fileSummary = computed(() =>
    JSON.stringify(this.read.context()?.fileAvailability ?? {}),
  );
  readonly projectLinks = computed(
    () =>
      this.read
        .snapshot()
        ?.state.projects.filter((p) => {
          const ids =
            this.page() === 'finance'
              ? this.finance()?.projects?.map((p) => p.projectId)
              : this.page() === 'exceptions' && this.target().tab === 'delivery'
                ? this.exceptions()?.delivery?.projects.map((p) => p.projectId)
                : undefined;
          return ids
            ? ids.includes(p.id)
            : `${p.id} ${p.name}`.toLowerCase().includes(this.filters().query.toLowerCase());
        })
        .map((p) => ({
          id: p.id,
          name: p.name,
          href: buildV10Target({ page: 'project-finance', projectId: p.id }).href,
        })) ?? [],
  );
}
