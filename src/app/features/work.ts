import { ChangeDetectionStrategy, Component, computed, inject, linkedSignal } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { Router, RouterLink } from '@angular/router';
import { DemoStore } from '../core/store';
import { BusinessForms } from '../core/forms';
import { Icon } from '../shared/icon';
import { Badge } from '../shared/badge';
import { RoundProgress } from './round-progress';
import {
  collectDemoFinanceSummaries,
  collectDemoProjectWorkItems,
  collectDemoWorkItems,
} from '../core/work-item-sources';
import {
  collectPersonPlanWarningViews,
  planWarningPersonKey,
  planWarningStats,
  PlanWarningView,
} from '../core/plan-warnings';
import { riskClass } from '../core/rules';
import { parseRouteHref } from '../core/route-href';
@Component({
  imports: [RouterLink, DecimalPipe, Icon, Badge, RoundProgress],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './work.html',
  styleUrl: './work.scss',
})
export class Work {
  store = inject(DemoStore);
  forms = inject(BusinessForms);
  router = inject(Router);
  ongoing = computed(() =>
    this.store.opportunities().filter((o) => !['赢单', '丢单'].includes(o.stage)),
  );
  projectList = computed(() => this.store.state().projects.slice(0, 3));
  taskView = computed(() =>
    collectDemoWorkItems(this.store.state(), this.store.person(), this.store.observationDate()),
  );
  openTasks = computed(() => this.taskView().items.filter((item) => item.status === 'open'));
  search = linkedSignal({ source: () => this.store.person(), computation: () => '' });
  department = linkedSignal({ source: () => this.store.person(), computation: () => '' });
  projectFilter = linkedSignal({ source: () => this.store.person(), computation: () => '' });
  ownerFilter = linkedSignal({ source: () => this.store.person(), computation: () => '' });
  statusFilter = linkedSignal({ source: () => this.store.person(), computation: () => 'open' });
  levelFilter = linkedSignal({ source: () => this.store.person(), computation: () => '' });
  departments = computed(() => [...new Set(this.openTasks().map((task) => task.department))]);
  taskProjects = computed(() => {
    const projects = new Map<string, string>();
    for (const task of this.taskView().items)
      if (task.projectId)
        projects.set(
          task.projectId,
          this.store.project(task.projectId)?.name || task.projectId,
        );
    return [...projects].map(([id, name]) => ({ id, name }));
  });
  /**
   * 负责人下拉的候选项：普通待办责任人 + 预警接收人。
   * 预警的接收人含项目PM，PM 可能只作为接收人出现，必须可选，否则筛选不到自己的预警。
   */
  taskOwners = computed(() => {
    const owners = new Set<string>();
    for (const task of this.taskView().items)
      for (const owner of task.owner.split('、')) if (owner.trim()) owners.add(owner.trim());
    for (const warning of this.warningViews())
      for (const recipient of warning.recipients)
        if (recipient.person.trim()) owners.add(recipient.person.trim());
    return [...owners];
  });
  filteredTasks = computed(() => {
    const query = this.search().trim().toLocaleLowerCase();
    return this.taskView()
      .items.filter(
        (task) =>
          (!this.statusFilter() || task.status === this.statusFilter()) &&
          (!this.projectFilter() || task.projectId === this.projectFilter()) &&
          (!this.ownerFilter() ||
            task.owner.split('、').some((owner) => owner.trim() === this.ownerFilter())) &&
          (!this.department() || task.department === this.department()) &&
          (!query ||
            [task.title, task.owner, task.department, task.id]
              .join(' ')
              .toLocaleLowerCase()
              .includes(query)),
      );
  });
  hasFilters = computed(
    () =>
      !!this.search() ||
      !!this.department() ||
      !!this.projectFilter() ||
      !!this.ownerFilter() ||
      this.statusFilter() !== 'open' ||
      !!this.levelFilter(),
  );
  /** 与普通待办同源：预警事项本身就是上面同一批事项，不重复计数。 */
  viewerKey = computed(() => planWarningPersonKey(this.store.person()));
  warningViews = computed(() =>
    collectPersonPlanWarningViews(
      this.store.state(),
      this.viewerKey(),
      this.store.observationDate(),
    ),
  );
  filteredWarnings = computed(() =>
    this.warningViews().filter(
      (warning) =>
        (!this.levelFilter() || warning.level === this.levelFilter()) &&
        (!this.projectFilter() || warning.projectId === this.projectFilter()) &&
        (!this.ownerFilter() ||
          warning.recipients.some((recipient) => recipient.person === this.ownerFilter())),
    ),
  );
  warningStat = computed(() => planWarningStats(this.warningViews()));
  warningRiskClass = (warning: PlanWarningView): string => riskClass(warning.level);
  /** 工作项 href 是「路径?查询」文本，交给 routerLink 前先拆成 path 与 queryParams。 */
  routeLink(href?: string) {
    return parseRouteHref(href);
  }
  markWarningRead(warning: PlanWarningView): void {
    if (warning.read) return;
    this.store.markPlanWarningRead(warning.id);
  }
  resetFilters(): void {
    this.search.set('');
    this.department.set('');
    this.projectFilter.set('');
    this.ownerFilter.set('');
    this.statusFilter.set('open');
    this.levelFilter.set('');
  }
  projectBoardView = computed(() =>
    collectDemoProjectWorkItems(this.store.state(), this.store.observationDate()),
  );
  projectBoardItems = computed(() =>
    this.projectBoardView()
      .items.filter((item) => item.status === 'open')
      .slice(0, 6),
  );
  financeSummaries = computed(() => collectDemoFinanceSummaries(this.store.state()));
  financeSummaryLabel = computed(() =>
    this.financeSummaries().some((summary) => summary.status === 'available')
      ? '本地演示快照'
      : '待提供',
  );
  nextProjectStep(projectId: string): string {
    return (
      this.projectBoardView().items.find((item) => item.projectId === projectId)?.title ||
      '暂无未完成计划节点'
    );
  }
  progress(id: string): number {
    const p = this.store.project(id)!;
    return Math.round(
      (p.plans.filter((x) => x.status === '已完成').length / Math.max(p.plans.length, 1)) * 100,
    );
  }
  startMainline(): void {
    this.store.setRole('sales');
    this.router.navigate(['/sales/detail', 'DEMO-L001'], {
      queryParams: { tab: '概览', guide: 'mainline' },
    });
  }
  open(id: string, key = ''): void {
    const sale = this.store.sale(id);
    this.router.navigate(
      [this.store.project(id) ? '/projects' : '/sales/detail', id],
      key.startsWith('v4-service-')
        ? { queryParams: { tab: '服务条件' } }
        : key.startsWith('valid-submission-') || key.startsWith('opportunity-gate-')
          ? { queryParams: { tab: '团队' } }
          : key.startsWith('v4-receivable-')
            ? { queryParams: { tab: '财务信息' } }
            : key.startsWith('v4-milestone-')
              ? { queryParams: { tab: '计划执行' } }
              : sale?.quoteFlowMode === 'v2'
                ? { queryParams: { tab: '报价' } }
                : undefined,
    );
  }
  practice(): void {
    const role = this.store.role();
    if (['sales', 'assistant'].includes(role)) this.router.navigate(['/sales/detail', 'DEMO-L001']);
    else if (role === 'manager') this.router.navigate(['/sales']);
    else if (role === 'solution')
      this.router.navigate(['/sales/detail', 'DEMO-O002'], { queryParams: { tab: '团队' } });
    else if (role === 'pmo')
      this.router.navigate(['/sales/detail', 'DEMO-O002'], { queryParams: { tab: '团队' } });
    else if (role === 'receiver') {
      const project =
        this.store.state().projects.find((p) => p.handover.status === '待接收') ||
        this.store.state().projects[0];
      this.router.navigate(['/projects', project.id], { queryParams: { tab: '移交' } });
    } else
      this.router.navigate(['/projects', role === 'quality' ? 'DEMO-P003' : 'DEMO-P001'], {
        queryParams: {
          tab: role === 'pm' ? '启动交底' : '计划执行',
          plan:
            (
              {
                opm: '要货发货',
                quality: 'FAT测试',
                finance: '开票回款',
                spare: '调试备件',
                member: '内部WBS',
              } as Record<string, string>
            )[role] || '内部WBS',
        },
      });
  }
}
