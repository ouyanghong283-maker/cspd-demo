import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { DemoStore } from '../core/store';
import { Project } from '../core/models';
import { Icon } from '../shared/icon';
import { Badge } from '../shared/badge';
@Component({
  imports: [FormsModule, RouterLink, Icon, Badge],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: ` <div class="page-heading">
      <div>
        <h1>项目工作</h1>
        <p>从启动到移交，计划、团队、资料和客户节点在同一项目里连续查看。</p>
      </div>
      <div class="header-actions"><button class="btn primary" (click)="createDraft()">新建项目草稿</button><a class="btn" routerLink="/control"><app-icon name="play" />练习项目交付</a></div>
    </div>
    <div class="stats-grid">
      <div class="stat">
        <div class="stat-top">全部交付项目<app-icon name="project" /></div>
        <div class="stat-number">{{ store.state().projects.length }}<small>个</small></div>
        <div class="stat-bottom">合同与商机关联可追溯</div>
      </div>
      <div class="stat">
        <div class="stat-top">启动 / 设计生产<app-icon name="calendar" /></div>
        <div class="stat-number">{{ activeCount() }}<small>个</small></div>
        <div class="stat-bottom">PM维护本地在线计划</div>
      </div>
      <div class="stat">
        <div class="stat-top">有未完成交底事项<app-icon name="info" /></div>
        <div class="stat-number">{{ conditionsCount() }}<small>个项目</small></div>
        <div class="stat-bottom">条件凭据与确认状态分开</div>
      </div>
      <div class="stat">
        <div class="stat-top">待接收移交<app-icon name="users" /></div>
        <div class="stat-number">{{ handoverCount() }}<small>个</small></div>
        <div class="stat-bottom">提交不等于接收完成</div>
      </div>
    </div>
    <div class="filter-bar">
      <label class="search-box"
        ><app-icon name="search" /><input
          aria-label="搜索项目"
          placeholder="搜索项目、客户或项目号"
          [(ngModel)]="query" /></label
      ><select aria-label="项目阶段筛选" [(ngModel)]="status">
        <option value="">全部阶段</option>
        <option>待启动</option>
        <option>启动交底</option>
        <option>设计生产</option>
        <option>物流交付</option>
        <option>现场调试</option>
        <option>客户验收</option>
        <option>内部移交</option>
        <option>已移交</option></select
      ><select aria-label="项目视图" [(ngModel)]="view">
        <option value="cards">卡片视图</option>
        <option value="table">列表视图</option></select
      ><span class="grow"></span><span class="count-label">{{ rows().length }}个项目</span>
    </div>
    @if (view() === 'cards') {
      <div class="grid-3">
        @for (p of rows(); track p.id) {
          <a class="panel project-card" [routerLink]="['/projects', p.id]"
            ><div class="project-top">
              <span class="project-symbol"><app-icon name="project" /></span
              ><app-badge [text]="p.status" />
            </div>
            <h2>{{ p.name }}</h2>
            <p>{{ store.customer(p.customerId)?.name }}</p>
            <div class="project-meta">
              <span>{{ p.capacity }} {{ p.unit }}</span
              ><span>{{ p.id }}</span>
            </div>
            <div class="progress-label">
              <span>计划完成</span><strong>{{ progress(p) }}%</strong>
            </div>
            <div class="progress-track"><span [style.width.%]="progress(p)"></span></div>
            <div class="project-footer">
              <div class="person-row">
                <span class="avatar">{{ p.pm.slice(0, 1) }}</span
                ><span>{{ p.pm }}</span>
              </div>
              <app-badge
                [text]="p.conditions.length ? openConditions(p) + '项未完成' : '无交底遗留'"
              /></div
          ></a>
        } @empty {
          <div class="empty">没有匹配项目</div>
        }
      </div>
    } @else {
      <section class="panel">
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>项目</th>
                <th>客户</th>
                <th>项目经理</th>
                <th>阶段</th>
                <th>交底结果</th>
                <th>未完成事项</th>
                <th>计划进展</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              @for (p of rows(); track p.id) {
                <tr>
                  <td>
                    <a class="main-link" [routerLink]="['/projects', p.id]">{{ p.name }}</a>
                    <p>{{ p.id }}</p>
                  </td>
                  <td>{{ store.customer(p.customerId)?.shortName }}</td>
                  <td>{{ p.pm }}</td>
                  <td><app-badge [text]="p.status" /></td>
                  <td><app-badge [text]="p.briefing.review" /></td>
                  <td>{{ openConditions(p) }}项</td>
                  <td>{{ progress(p) }}%</td>
                  <td><a class="text-link" [routerLink]="['/projects', p.id]">查看项目</a></td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      </section>
    }
    <div class="inline-alert space-top">
      <app-icon name="info" /><span
        >合同、生产及财务来源为预置样例，正式集成不在本演示内。PM路径按已有PRD继承，待业务走查确认。</span
      >
    </div>`,
  styles: `
    .project-card {
      padding: 24px;
      transition: border-color 0.15s;
    }
    .project-card:hover {
      border-color: #bacdf1;
    }
    .project-top {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 17px;
    }
    .project-symbol {
      background: #f0f4fc;
      padding: 10px;
      border-radius: 8px;
      color: #6c86bb;
    }
    .project-card h2 {
      font-size: 15px;
      margin: 0 0 6px;
    }
    .project-card > p {
      font-size: 11px;
      margin-bottom: 16px;
    }
    .project-meta {
      display: flex;
      justify-content: space-between;
      font-size: 10px;
      color: #929fb3;
      margin-bottom: 21px;
    }
    .progress-label {
      font-size: 10px;
      display: flex;
      justify-content: space-between;
      margin-bottom: 8px;
      color: #8795aa;
    }
    .progress-label strong {
      font-size: 11px;
      color: #5b73a3;
      font-weight: 550;
    }
    .project-footer {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-top: 22px;
      font-size: 11px;
    }
    .project-footer .avatar {
      width: 25px;
      height: 25px;
      font-size: 10px;
    }
  `,
})
export class ProjectList {
  store = inject(DemoStore);
  router = inject(Router);
  query = signal('');
  status = signal('');
  view = signal('cards');
  rows = computed(() =>
    this.store
      .state()
      .projects.filter(
        (p) =>
          (!this.status() || p.status === this.status()) &&
          `${p.name}${p.id}${this.store.customer(p.customerId)?.name}`
            .toLowerCase()
            .includes(this.query().toLowerCase()),
      ),
  );
  activeCount = computed(
    () =>
      this.store
        .state()
        .projects.filter((p) => ['待启动', '启动交底', '设计生产'].includes(p.status)).length,
  );
  conditionsCount = computed(
    () => this.store.state().projects.filter((p) => p.conditions.some((c) => !c.closed)).length,
  );
  handoverCount = computed(
    () => this.store.state().projects.filter((p) => p.handover.status === '待接收').length,
  );
  createDraft(): void {
    const opportunities = this.store.opportunities().filter((o) => o.stage !== '丢单');
    this.store.ui.open({
      title: '新建项目号', description: '项目号立即生成；来源商机可以稍后关联。未关联前不能进入交付流程。', submitLabel: '创建项目草稿',
      fields: [
        { key: 'name', label: '项目名称', required: true },
        { key: 'pm', label: '拟任PM', type: 'select', options: ['王项目', '刘项目'], value: '王项目', required: true },
        { key: 'site', label: '现场 / 批次' },
        { key: 'opportunity', label: '立即关联商机（可选）', type: 'select', options: ['', ...opportunities.map((o) => `${o.id} · ${o.projectName}`)], value: '' },
      ], sample: { name: '青山储能二期', site: '江苏省苏州市', opportunity: '' },
      onSave: (d) => { const selected = String(d['opportunity'] || '').split(' · ')[0]; const id = this.store.createProjectDraft(d['name'], d['pm'], d['site'], selected); if (!id) return false; this.router.navigate(['/projects', id]); return true; },
    });
  }
  progress(p: Project): number {
    return Math.round(
      (p.plans.filter((x) => x.status === '已完成').length / Math.max(p.plans.length, 1)) * 100,
    );
  }
  openConditions(p: Project): number {
    return p.conditions.filter((c) => !c.closed).length;
  }
}
