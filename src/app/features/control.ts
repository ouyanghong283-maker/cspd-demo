import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { DemoStore } from '../core/store';
import { ROLES, Role } from '../core/models';
import { Icon } from '../shared/icon';
import { Badge } from '../shared/badge';
import { ROUTES_GUIDE } from '../core/guide';
import { RoundProgress } from './round-progress';
@Component({
  imports: [FormsModule, Icon, Badge, RoundProgress],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './control.html',
  styles: `
    .roles-grid {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 12px;
      padding: 22px;
    }
    .role-card {
      border: 1px solid var(--line);
      border-radius: 7px;
      background: white;
      padding: 16px;
      text-align: left;
      display: flex;
      align-items: flex-start;
      gap: 11px;
    }
    .role-card.active {
      border-color: #b6cafb;
      background: #f7f9ff;
    }
    .role-card h3 {
      font-size: 12px;
      font-weight: 550;
      margin: 0 0 5px;
    }
    .role-card p {
      font-size: 10px;
      line-height: 1.8;
      margin: 0;
    }
    .role-card .avatar {
      width: 28px;
      height: 28px;
      font-size: 10px;
    }
    .scenario {
      padding: 22px;
    }
    .scenario h3 {
      font-size: 13px;
      margin: 15px 0 8px;
    }
    .scenario p {
      font-size: 11px;
      line-height: 1.9;
      margin: 0 0 16px;
    }
    .scenario .scenario-icon {
      display: inline-flex;
      padding: 10px;
      background: #f0f4fc;
      border-radius: 8px;
      color: #6b85bb;
    }
    .guide-row {
      display: flex;
      align-items: center;
      gap: 13px;
      padding: 17px 22px;
      border-bottom: 1px solid var(--line);
    }
    .guide-row:last-child {
      border: 0;
    }
    .guide-id {
      font-size: 10px;
      padding: 6px;
      background: #f2f5fc;
      color: #6e85b0;
      border-radius: 4px;
      min-width: 35px;
      text-align: center;
    }
    .guide-row h3 {
      font-size: 12px;
      margin: 0 0 4px;
    }
    .guide-row p {
      font-size: 10px;
      line-height: 1.8;
      margin: 0;
      max-width: 700px;
    }
    .guide-row .btn {
      flex-shrink: 0;
    }
    .control-actions {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 20px;
      padding: 22px;
    }
    .control-actions h3 {
      font-size: 13px;
      margin: 0 0 5px;
    }
    .control-actions p {
      font-size: 11px;
      margin: 0;
      line-height: 1.9;
    }
    .start-modes{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:22px}.start-mode{padding:22px 24px;border:1px solid var(--line);border-radius:8px;background:white;display:flex;align-items:center;justify-content:space-between;gap:18px}.start-mode h2{font-size:15px;margin:0 0 6px}.start-mode p{font-size:11px;line-height:1.8;margin:0;max-width:460px;color:var(--muted)}.start-mode.main{border-left:4px solid #315dde}.start-mode .btn{flex-shrink:0}
    @media (max-width: 900px) {
      .roles-grid {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }
    }
    @media (max-width: 600px) {
      .roles-grid {
        grid-template-columns: 1fr;
        padding: 15px;
      }
      .control-actions {
        flex-direction: column;
        align-items: flex-start;
      }
      .start-modes{grid-template-columns:1fr}.start-mode{align-items:flex-start;flex-direction:column}
      .guide-row {
        flex-wrap: wrap;
        padding: 16px;
      }
      .guide-row .grow {
        min-width: 200px;
      }
    }
  `,
})
export class Control {
  store = inject(DemoStore);
  router = inject(Router);
  roles = ROLES;
  group = signal('全部');
  guides = ROUTES_GUIDE;
  rows = computed(() =>
    this.guides.filter((g) => this.group() === '全部' || g.id.startsWith(this.group())),
  );
  startMainline(): void {
    this.store.setRole('sales');
    this.router.navigate(['/sales/detail', 'DEMO-L001'], { queryParams: { tab: '概览', guide: 'mainline' } });
  }
  practiceRole(): void {
    const role = this.store.role();
    if (['sales', 'assistant'].includes(role)) return this.start('/sales/detail/DEMO-L001', role, '概览');
    if (role === 'manager') return this.start('/sales', role, '');
    if (role === 'solution' || role === 'pmo') return this.start('/sales/detail/DEMO-O002', role, '团队');
    if (role === 'receiver') return this.start('/projects/DEMO-P007', role, '移交');
    if (role === 'pm') return this.start('/projects/DEMO-P001', role, '启动交底');
    if (role === 'quality') return this.start('/projects/DEMO-P003', role, '计划执行', 'P11');
    if (role === 'opm') return this.start('/projects/DEMO-P001', role, '计划执行', 'P10');
    if (role === 'finance') return this.start('/projects/DEMO-P001', role, '计划执行', 'P12');
    if (role === 'spare') return this.start('/projects/DEMO-P001', role, '计划执行');
    if (role === 'member') return this.start('/projects/DEMO-P001', role, '计划执行');
    return this.start('/projects/DEMO-P001', role, '概览');
  }
  scenarios = [
    {
      name: '普通销售主线',
      desc: '从线索登记、需求表、商机推进，体验数据如何一路带入项目。',
      icon: 'sales',
      url: '/sales/detail/DEMO-L001',
      role: 'sales' as Role,
      tab: '概览',
    },
    {
      name: '重点投标团队',
      desc: '投标且S级，负责人指定、成员确认，再由销售推进。',
      icon: 'users',
      url: '/sales/detail/DEMO-O002',
      role: 'pmo' as Role,
      tab: '团队',
    },
    {
      name: '交底与在线计划',
      desc: '查看附条件事项、补凭据，维护各部门自己的计划。',
      icon: 'project',
      url: '/projects/DEMO-P001',
      role: 'pm' as Role,
      tab: '启动交底',
    },
    {
      name: '验收与内部移交',
      desc: '先完成SAT，再逐项签认，整理八类资料并交给接收方。',
      icon: 'check',
      url: '/projects/DEMO-P006',
      role: 'pm' as Role,
      tab: '验收',
    },
    {
      name: '主管跟进与预测',
      desc: '筛选管道、查看三个月演示预测、催办冷却项目。',
      icon: 'trend',
      url: '/sales',
      role: 'manager' as Role,
      tab: '',
    },
    {
      name: '接收移交资料',
      desc: '从接收方待办开始，查看资料、退回或确认收到。',
      icon: 'file',
      url: '/projects/DEMO-P007',
      role: 'receiver' as Role,
      tab: '移交',
    },
  ];
  start(url: string, role: Role, tab: string, guideId = ''): void {
    if (guideId === 'U01') return this.startMainline();
    this.store.setRole(role);
    const plans: Record<string, string> = {
      P08: '客户主节点',
      P09: '产研来源',
      P10: '要货发货',
      P11: 'FAT测试',
      P12: '开票回款',
    };
    this.router.navigate([url], {
      queryParams: tab ? { tab, ...(plans[guideId] ? { plan: plans[guideId] } : {}) } : undefined,
    });
  }
  async reset(): Promise<void> {
    if (!window.confirm('将切换到新的独立演示轮。旧工作区备份会保留；归属不明的本地附件也会保留。确定继续吗？'))
      return;
    await this.store.reset();
  }
  resumeWorkspace(workspaceId: string, roundId: string): void {
    if (!window.confirm(`将续接旧工作区 ${roundId}。当前活动工作区会被保留，可随时切回。继续吗？`))
      return;
    this.store.resumeWorkspace(workspaceId);
  }
}
