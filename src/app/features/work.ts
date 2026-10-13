import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { DemoStore } from '../core/store';
import { BusinessForms } from '../core/forms';
import { Icon } from '../shared/icon';
import { Badge } from '../shared/badge';
import { MainlineGuide } from './mainline-guide';
@Component({
  imports: [RouterLink, Icon, Badge, MainlineGuide],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './work.html',
  styles: `
    .greeting-date {
      font-size: 11px;
      color: #9aa5b6;
      margin-bottom: 9px;
    }
    .welcome-strip {
      background: white;
      border: 1px solid var(--line);
      border-radius: 10px;
      padding: 24px 27px;
      margin-bottom: 24px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 22px;
    }
    .start-actions{display:flex;gap:9px;flex-wrap:wrap;justify-content:flex-end}
    .welcome-strip h2 {
      font-size: 19px;
      margin: 0 0 8px;
    }
    .welcome-strip p {
      font-size: 12px;
      margin: 0;
      line-height: 1.9;
    }
    .welcome-art {
      display: flex;
      gap: 6px;
      align-items: end;
      height: 54px;
      width: 100px;
      padding-right: 18px;
    }
    .welcome-art span {
      width: 16px;
      border-radius: 3px 3px 0 0;
      background: #e1e9fc;
    }
    .welcome-art span:nth-child(2) {
      background: #b7cbf7;
    }
    .welcome-art span:nth-child(3) {
      background: #799ce9;
    }
    .welcome-art span:nth-child(4) {
      background: #315dde;
    }
    .workspace-grid {
      display: grid;
      grid-template-columns: minmax(0, 1.65fr) minmax(280px, 1fr);
      gap: 22px;
    }
    .task-row {
      display: flex;
      gap: 12px;
      align-items: center;
      padding: 17px 24px;
      border-bottom: 1px solid #eef1f5;
    }
    .task-row:last-child {
      border: 0;
    }
    .task-symbol {
      padding: 9px;
      border-radius: 7px;
      background: #f0f4fd;
      color: #6c86bb;
    }
    .task-symbol.warning {
      background: #fff6e9;
      color: #c39650;
    }
    .task-row h3 {
      font-size: 12px;
      margin: 0 0 5px;
    }
    .task-row p {
      font-size: 11px;
      margin: 0;
    }
    .task-row .time {
      font-size: 10px;
      color: #9ea8ba;
      margin-top: 6px;
    }
    .quick-actions {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 0;
    }
    .quick-action {
      padding: 20px 22px;
      display: flex;
      align-items: center;
      gap: 12px;
      border-bottom: 1px solid var(--line);
    }
    .quick-action:nth-child(odd) {
      border-right: 1px solid var(--line);
    }
    .quick-action:nth-last-child(-n + 2) {
      border-bottom: 0;
    }
    .quick-action > span {
      background: #f3f6fc;
      padding: 9px;
      border-radius: 7px;
      color: #7c93bc;
    }
    .quick-action strong {
      display: block;
      font-size: 12px;
      font-weight: 550;
    }
    .quick-action small {
      font-size: 10px;
      color: #9aa4b4;
    }
    .project-mini {
      padding: 17px 23px;
      display: block;
      border-bottom: 1px solid var(--line);
    }
    .project-mini:last-child {
      border: 0;
    }
    .project-mini > div {
      display: flex;
      justify-content: space-between;
      gap: 8px;
      align-items: center;
    }
    .project-mini h3 {
      font-size: 12px;
      margin: 0;
    }
    .project-mini p {
      font-size: 10px;
      margin: 8px 0 10px;
    }
    .project-mini .progress-track {
      height: 4px;
    }
    .guide-list {
      padding: 6px 22px 18px;
    }
    .guide-list a {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 11px 0;
      color: #6b7e9e;
      font-size: 11px;
    }
    .guide-list a app-icon {
      width: 14px;
      height: 14px;
    }
    .guide-list a span {
      flex: 1;
    }
    @media (max-width: 1050px) {
      .workspace-grid {
        grid-template-columns: 1fr;
      }
      .welcome-art {
        display: none;
      }
      .start-actions{justify-content:flex-start}
    }
    @media (max-width: 760px) {
      .welcome-strip {
        padding: 20px;
        align-items: flex-start;
        flex-direction: column;
      }
      .task-row {
        padding: 15px;
      }
      .quick-action {
        padding: 16px 14px;
      }
    }
  `,
})
export class Work {
  store = inject(DemoStore);
  forms = inject(BusinessForms);
  router = inject(Router);
  ongoing = computed(() =>
    this.store.opportunities().filter((o) => !['赢单', '丢单'].includes(o.stage)),
  );
  projectList = computed(() => this.store.state().projects.slice(0, 3));
  tasks = computed(() => {
    const role = this.store.role();
    const notices = this.store
      .pendingNotices()
      .map((n) => ({
        id: n.id,
        entityId: n.entityId,
        title: n.title,
        text: n.text,
        state: n.read ? '待处理' : '未读提醒',
        icon: 'bell',
      }));
    if (role === 'sales' || role === 'manager')
      for (const x of this.store
        .cooling()
        .filter((x) => role === 'manager' || x.owner === this.store.person())
        .slice(0, 3))
        notices.push({
          id: `cooling-${x.id}`,
          entityId: x.id,
          title: `${x.projectName}：${this.store.days(x) >= 60 && role === 'manager' ? '60天主管升级' : '需要客户跟进'}`,
          text: `${this.store.days(x)}天未更新 · ${x.owner} · ${this.store.customer(x.customerId)?.name}`,
          state: '冷却提醒',
          icon: 'clock',
        });
    if (role === 'pm')
      for (const p of this.store
        .state()
        .projects.filter((p) => !p.accepted || p.briefing.review === '待提交')
        .slice(0, 3))
        notices.push({
          id: p.id,
          entityId: p.id,
          title: p.accepted ? '补齐启动交底资料' : '请接收交付项目',
          text: `${p.name} · ${p.id}`,
          state: '待处理',
          icon: 'project',
        });
    return notices;
  });
  progress(id: string): number {
    const p = this.store.project(id)!;
    return Math.round(
      (p.plans.filter((x) => x.status === '已完成').length / Math.max(p.plans.length, 1)) * 100,
    );
  }
  startMainline(): void {
    this.store.setRole('sales');
    this.router.navigate(['/sales/detail', 'DEMO-L001'], { queryParams: { tab: '概览', guide: 'mainline' } });
  }
  open(id: string): void {
    const sale = this.store.sale(id);
    this.router.navigate([this.store.project(id) ? '/projects' : '/sales/detail', id], sale?.quoteFlowMode === 'v2' ? { queryParams: { tab: '报价' } } : undefined);
  }
  practice(): void {
    const role = this.store.role();
    if (['sales', 'assistant'].includes(role)) this.router.navigate(['/sales/detail', 'DEMO-L001']);
    else if (role === 'manager') this.router.navigate(['/sales']);
    else if (role === 'solution') this.router.navigate(['/sales/detail', 'DEMO-O002'], { queryParams: { tab: '团队' } });
    else if (role === 'pmo') this.router.navigate(['/sales/detail', 'DEMO-O002'], { queryParams: { tab: '团队' } });
    else if (role === 'receiver') {
      const project = this.store.state().projects.find((p) => p.handover.status === '待接收') || this.store.state().projects[0];
      this.router.navigate(['/projects', project.id], { queryParams: { tab: '移交' } });
    }
    else
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
