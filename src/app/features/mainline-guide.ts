import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { Router } from '@angular/router';
import { DemoStore } from '../core/store';
import { Icon } from '../shared/icon';

@Component({
  selector: 'app-mainline-guide',
  imports: [Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (flow(); as f) {
      <section class="mainline" aria-label="从头演示进度">
        <div class="rail">
          @for (step of f.steps; track step.id; let i = $index) {
            <div class="rail-step" [class.done]="step.done" [class.current]="i === f.index">
              <span>{{ step.done ? '✓' : i + 1 }}</span><small>{{ step.title }}</small>
            </div>
          }
        </div>
        <div class="current-step">
          <div class="copy">
            <p class="step-count">{{ f.index === f.steps.length ? '主线已完成' : '第 ' + (f.index + 1) + ' 步 / ' + f.steps.length + ' 步' }}</p>
            <h2>{{ f.action }}</h2>
            @if (f.missing.length) { <p class="missing"><strong>还需处理：</strong>{{ f.missing.join('、') }}</p> }
            <p class="owner"><app-icon name="users"/> 下一位接手：{{ f.owner }}</p>
          </div>
          @if (f.url) { <button class="btn primary" (click)="open(f.url, f.role, f.tab)">{{ f.button }}<app-icon name="arrow"/></button> }
        </div>
      </section>
    }
  `,
  styles: `
    .mainline{border:1px solid #dbe4f3;border-left:4px solid #315dde;border-radius:8px;background:#fff;margin:0 0 20px;padding:18px 22px}
    .rail{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:8px;margin-bottom:16px}
    .rail-step{display:flex;align-items:center;gap:7px;color:#8592a7;font-size:11px;border-bottom:2px solid #e7ebf2;padding-bottom:8px}
    .rail-step span{display:grid;place-items:center;flex:0 0 21px;height:21px;border-radius:50%;background:#edf1f7;font-size:10px}
    .rail-step.done{color:#34785c;border-color:#72ae91}.rail-step.done span{background:#e2f2e9;color:#34785c}
    .rail-step.current{color:#234aa8;border-color:#315dde;font-weight:600}.rail-step.current span{background:#315dde;color:white}
    .current-step{display:flex;align-items:center;justify-content:space-between;gap:18px}.copy h2{font-size:15px;margin:0 0 5px}.copy p{font-size:12px;margin:4px 0;color:#66758d}.copy .step-count{font-size:10px;color:#315dde;font-weight:650}.copy .missing strong{color:#8a5a12}.owner{display:flex;align-items:center;gap:6px}.owner app-icon{width:13px;height:13px}
    @media(max-width:700px){.mainline{padding:14px}.rail{grid-template-columns:1fr;gap:0}.rail-step{border-bottom:0;padding:3px 0}.rail-step:not(.current):not(.done){display:none}.current-step{align-items:flex-start;flex-direction:column}.current-step button{width:100%;justify-content:center}}
  `,
})
export class MainlineGuide {
  private store = inject(DemoStore);
  private router = inject(Router);
  readonly flow = computed(() => {
    const lead = this.store.sale('DEMO-L001');
    const opportunity = lead?.convertedTo ? this.store.sale(lead.convertedTo) : undefined;
    const project = opportunity ? this.store.state().projects.find((item) => item.opportunityId === opportunity.id) : undefined;
    const leadReady = !!opportunity;
    const opportunityReady = !!opportunity && opportunity.stage === '赢单';
    const projectReady = !!project;
    const accepted = !!project?.accepted;
    const briefingDone = !!project && ['通过', '附条件通过'].includes(project.briefing.review);
    const steps = [
      { id: 'lead', title: '需求转商机', done: leadReady },
      { id: 'opportunity', title: '推进商机', done: opportunityReady },
      { id: 'project', title: '创建交付项目', done: projectReady },
      { id: 'accept', title: 'PM接收', done: accepted },
      { id: 'briefing', title: '交底审核', done: briefingDone },
    ];
    const index = steps.findIndex((step) => !step.done);
    const leadMissing = !lead ? ['找不到起始线索DEMO-L001'] : [
      ...(!this.store.contact(lead)?.name ? ['主要联系人'] : []),
      ...(!this.store.has(lead.id, '需求导入表') ? ['需求导入表'] : []),
      ...(!lead.owner ? ['销售负责人'] : []),
      ...(!['待跟进'].includes(lead.status) && !lead.convertedTo ? ['恢复线索跟进状态'] : []),
    ];
    if (index === 0) return { steps, index, action: '补齐线索资料并转为商机', missing: leadMissing, owner: '销售', role: 'sales' as const, url: `/sales/detail/${lead?.id || 'DEMO-L001'}`, tab: lead && !this.store.has(lead.id, '需求导入表') ? '资料' : '概览', button: leadMissing.length ? '继续补线索' : '打开线索' };
    if (index === 1 && opportunity) {
      const tab = opportunity.quoteFlowMode === 'v2' && opportunity.stage === '方案报价' ? '报价' : opportunity.stage === '洽谈' ? '沟通' : '概览';
      return { steps, index, action: opportunity.stage === '丢单' ? '当前商机已丢单，主线无法继续' : `继续推进商机：${opportunity.stage}`, missing: opportunity.stage === '丢单' ? ['可从控制台选择其他案例'] : [], owner: '销售', role: 'sales' as const, url: opportunity.stage === '丢单' ? '/control' : `/sales/detail/${opportunity.id}`, tab, button: opportunity.stage === '丢单' ? '选择其他案例' : '打开商机' };
    }
    if (index === 2 && opportunity) return { steps, index, action: '商机赢单后，创建交付项目并带入合同来源', missing: [], owner: '销售 / PM', role: 'sales' as const, url: `/sales/detail/${opportunity.id}`, tab: '概览', button: '打开赢单商机' };
    if (index === 3 && project) return { steps, index, action: 'PM核对商务来源后接收项目', missing: !project.contractId ? ['合同 / G3模拟来源'] : [], owner: 'PM', role: 'pm' as const, url: `/projects/${project.id}`, tab: '概览', button: '打开项目接收' };
    if (index === 4 && project) return { steps, index, action: project.briefing.review === '模拟审核中' ? '请PMO查看并记录交底模拟结果' : 'PM补齐启动交底，提交给PMO审核', missing: project.briefing.review === '模拟审核中' ? [] : this.store.briefingMissing(project.id), owner: project.briefing.review === '模拟审核中' ? 'PMO' : 'PM', role: project.briefing.review === '模拟审核中' ? 'pmo' as const : 'pm' as const, url: `/projects/${project.id}`, tab: '启动交底', button: project.briefing.review === '模拟审核中' ? '切换PMO处理' : '打开启动交底' };
    return { steps, index: steps.length, action: '销售到交付的演示主线已完成，可以查看记录或练习其他角色。', missing: [], owner: '所有参与角色', role: 'sales' as const, url: '', tab: '', button: '' };
  });
  open(url: string, role: 'sales'|'pm'|'pmo', tab: string): void {
    this.store.setRole(role);
    this.router.navigate([url], { queryParams: { ...(tab ? { tab } : {}), guide: 'mainline' } });
  }
}
