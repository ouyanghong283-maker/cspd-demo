import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { DemoStore } from './core/store';
import { ROLES, Role } from './core/models';
import { UiService } from './core/ui.service';
import { Icon } from './shared/icon';
import { Dialog } from './shared/dialog';
@Component({
  selector: 'app-root',
  imports: [FormsModule, RouterOutlet, RouterLink, RouterLinkActive, Icon, Dialog],
  templateUrl: './app.html',
  styleUrl: './app.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class App {
  store = inject(DemoStore);
  ui = inject(UiService);
  router = inject(Router);
  roles = ROLES;
  mobileMenu = signal(false);
  notifications = signal(false);
  unread(): boolean {
    return this.store.pendingNotices().some((n) => !n.read);
  }
  changeRole(event: Event): void {
    this.store.setRole((event.target as HTMLSelectElement).value as Role);
  }
  title(): string {
    const url = this.router.url;
    return url.startsWith('/sales')
      ? '销售工作'
      : url.startsWith('/projects')
        ? '项目工作'
        : url.startsWith('/control')
          ? '演示控制'
          : '我的工作';
  }
  goNotice(id: string, noticeId: string): void {
    this.store.markNotice(noticeId);
    this.notifications.set(false);
    this.router.navigate([this.store.project(id) ? '/projects' : '/sales/detail', id]);
  }
}
