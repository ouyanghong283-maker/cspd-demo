import {
  ChangeDetectionStrategy,
  Component,
  HostListener,
  computed,
  inject,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { NavigationEnd, Router, RouterLink, RouterOutlet } from '@angular/router';
import { DemoStore } from './core/store';
import { ROLES, Role } from './core/models';
import { UiService } from './core/ui.service';
import { Icon } from './shared/icon';
import { Dialog } from './shared/dialog';
import {
  NAVIGATION_GROUPS,
  NavigationItem,
  resolveNavigationPath,
  activeNavigationItem,
} from './core/navigation-registry';
import { collectDemoProjectWorkItems, collectDemoWorkItems } from './core/work-item-sources';
@Component({
  selector: 'app-root',
  imports: [FormsModule, RouterOutlet, RouterLink, Icon, Dialog],
  templateUrl: './app.html',
  styleUrl: './app.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class App {
  store = inject(DemoStore);
  ui = inject(UiService);
  router = inject(Router);
  roles = ROLES;
  navGroups = NAVIGATION_GROUPS;
  navGroupExpanded = signal<Record<string, boolean>>({
    'my-work': true,
    customers: true,
    'board-tools': true,
    'sales-presales': true,
    'signing-delivery': true,
    'demo-support': true,
  });
  navBadgeCounts = computed(() => {
    const state = this.store.state();
    return {
      'my-tasks': collectDemoWorkItems(state, this.store.person()).counts.open,
      'shared-project-board': collectDemoProjectWorkItems(state).counts.open,
    };
  });
  mobileMenu = signal(false);
  notifications = signal(false);
  constructor() {
    this.router.events.subscribe((event) => {
      if (!(event instanceof NavigationEnd)) return;
      const target = resolveNavigationPath(event.urlAfterRedirects);
      if (target.status === 'implemented' && target.source === 'legacy-alias') {
        void this.router.navigateByUrl(target.canonicalPath, { replaceUrl: true });
      }
      const activeGroup = this.navigationGroupFor(
        target.status === 'implemented' ? target.canonicalPath : event.urlAfterRedirects,
      );
      if (activeGroup) {
        this.navGroupExpanded.update((current) => ({ ...current, [activeGroup]: true }));
      }
    });
  }
  toggleNavGroup(groupId: string): void {
    this.navGroupExpanded.update((current) => ({ ...current, [groupId]: !current[groupId] }));
  }
  navIcon(groupId: string): string {
    return groupId === 'sales-presales'
      ? 'trend'
      : groupId === 'signing-delivery'
        ? 'project'
        : groupId === 'demo-support'
          ? 'control'
          : 'dashboard';
  }
  navTarget(path: string): string {
    return path.includes(':id') ? '/projects' : path;
  }
  navBadge(item: NavigationItem): number | undefined {
    if (!item.badgeSource) return undefined;
    return this.navBadgeCounts()[item.id as keyof ReturnType<typeof this.navBadgeCounts>] ?? 0;
  }
  isNavActive(item: NavigationItem): boolean {
    return activeNavigationItem(this.router.url)?.id === item.id;
  }
  private navigationGroupFor(path: string): string | undefined {
    return activeNavigationItem(path)?.groupId;
  }
  closeMobileMenu(): void {
    this.mobileMenu.set(false);
  }
  unread(): boolean {
    return this.store.pendingNotices().some((n) => !n.read);
  }
  @HostListener('window:beforeunload', ['$event'])
  warnAboutUnsavedDialog(event: BeforeUnloadEvent): void {
    if (!this.ui.dialog() && !this.store.pendingInlineEdit()) return;
    event.preventDefault();
    event.returnValue = '';
  }
  @HostListener('document:keydown.escape')
  closeMobileMenuOnEscape(): void {
    if (this.mobileMenu()) this.closeMobileMenu();
  }
  changeRole(event: Event): void {
    this.store.setRole((event.target as HTMLSelectElement).value as Role);
  }
  title(): string {
    const url = this.router.url;
    if (url.startsWith('/sales/solutions')) return '方案设计';
    if (url.startsWith('/sales/quotes')) return '报价议价';
    if (url.startsWith('/sales/departments')) return '部门记录';
    if (url.includes('tab=方案')) return '方案设计';
    if (url.includes('tab=报价')) return '报价议价';
    if (url.startsWith('/sales/detail')) return 'L2 商机管理';
    if (url.startsWith('/sales/leads')) return 'L1 线索管理';
    if (url.startsWith('/sales/opportunities')) return 'L2 商机管理';
    if (url.startsWith('/sales/customers')) return '客户管理';
    if (url.startsWith('/sales/contacts')) return '联系人管理';
    if (url.startsWith('/sales')) return '商机看板';
    if (url.startsWith('/contracts')) return '合同管理';
    if (url.startsWith('/plans/tracking')) return '追踪看板';
    if (url.startsWith('/delivery-service')) return '交付与售后';
    if (url.startsWith('/plans')) return '交付与售后';
    if (url.startsWith('/projects'))
      return url.startsWith('/projects/board') ? '共享项目看板' : '项目区';
    if (url.startsWith('/control')) return '演示控制';
    return '我的工作';
  }
  goNotice(id: string, noticeId: string): void {
    const planNotice = this.store
      .pendingNotices()
      .find((notice) => notice.id === noticeId && notice.planId);
    if (planNotice?.planId && planNotice.href) {
      this.store.markPlanWarningRead(planNotice.entityId, planNotice.planId);
      this.notifications.set(false);
      this.router.navigateByUrl(planNotice.href);
      return;
    }
    this.store.markNotice(noticeId);
    this.notifications.set(false);
    const notice = this.store.state().notices.find((x) => x.id === noticeId);
    const tab = notice?.key.startsWith('v4-service-')
      ? '服务条件'
      : notice?.key.startsWith('v4-receivable-')
        ? '财务信息'
        : notice?.key.startsWith('v4-') || notice?.key.startsWith('quote-')
          ? '报价'
          : undefined;
    this.router.navigate(
      [this.store.project(id) ? '/projects' : '/sales/detail', id],
      tab ? { queryParams: { tab } } : undefined,
    );
  }
}
