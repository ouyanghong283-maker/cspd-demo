import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink, UrlTree } from '@angular/router';
import { DemoState, SalesRecord } from '../core/models';
import {
  calculateMainlineProgress,
  MainlineObjectOwnership,
  MainlineProgressModuleRegistration,
} from '../core/mainline-progress';
import { startupEntryQuery } from '../core/project-startup';
import { DemoStore } from '../core/store';

const PROGRESS_MODULES: readonly MainlineProgressModuleRegistration[] = [
  { id: 'sales', label: '商机', eventModules: ['商机', 'opportunity-collaboration'] },
  { id: 'solution', label: '方案', eventModules: ['solution-workspace', 'solution-service', '方案资料'] },
  { id: 'quote', label: '报价', eventModules: ['quote-workspace'] },
  {
    id: 'contract',
    label: '合同',
    eventModules: ['contracts', 'contract-workspace', '合同发票', '合同订单', '合同水单'],
  },
  { id: 'startup', label: '项目启动', eventModules: ['项目启动'] },
];

interface MainlineOption {
  id: string;
  label: string;
  record: SalesRecord;
  opportunityId: string;
}

@Component({
  selector: 'app-round-progress',
  imports: [FormsModule, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="round-progress" aria-label="本轮演示进度">
      <div class="heading">
        <div>
          <p class="eyebrow">本轮真实操作</p>
          <h2>选择主线，查看五个板块的进度</h2>
        </div>
        <span class="round-id">轮次 {{ store.state().roundId || '待初始化' }}</span>
      </div>
      <div class="context-selectors">
        <label>当前主线
          <select name="selectedMainline" [ngModel]="store.state().selectedMainlineId || ''" (ngModelChange)="selectMainline($event)">
            <option value="">请选择线索或商机</option>
            @for (option of mainlineOptions(); track option.id) {
              <option [value]="option.id">{{ option.label }}</option>
            }
          </select>
        </label>
        <label>当前项目
          <select name="selectedProject" [ngModel]="effectiveProjectId()" (ngModelChange)="selectProject($event)" [disabled]="!selectedOpportunityId() || projects().length < 2">
            <option value="">{{ projects().length > 1 ? '请选择项目' : projects().length === 1 ? '唯一关联项目' : '暂无项目' }}</option>
            @for (project of projects(); track project.id) {
              <option [value]="project.id">{{ project.name }} · {{ project.id }}</option>
            }
          </select>
        </label>
        <span class="identity">{{ store.roleInfo().name }} · {{ store.person() }}</span>
      </div>

      @if (!selectedOption()) {
        <p class="context-note">请选择当前演示主线。已有样例和旧历史不会自动勾选本轮进度。</p>
      } @else if (projects().length > 1 && !effectiveProjectId()) {
        <p class="context-note warning">该主线关联多个项目；请选择一个项目后再查看项目启动进度，避免借用其他项目的操作记录。</p>
      } @else if (!selectedOpportunityId()) {
        <p class="context-note">当前从已有线索开始；商机、方案、报价、合同和项目步骤会在实际保存后按事件更新。</p>
      }

      <ol class="module-list">
        @for (module of progress().modules; track module.id) {
          <li [class.done]="module.done">
            <span class="marker" aria-hidden="true">{{ module.done ? '✓' : '·' }}</span>
            <div class="module-copy">
              <strong>{{ module.label }}</strong>
              <span>{{ module.done ? '本轮已操作' : moduleAvailability(module.id) }}</span>
              @if (module.events.length) {
                <details>
                  <summary>{{ module.events.length }} 次有效操作记录</summary>
                  @for (event of module.events; track event.id) {
                    <small>{{ event.occurredAt }} · {{ event.department }} · {{ event.action }} · {{ event.objectType }} {{ event.objectId }}</small>
                  }
                </details>
              }
            </div>
            @if (moduleHref(module.id); as href) {
              <a class="open-link" [routerLink]="href">打开板块</a>
            }
          </li>
        }
      </ol>
      @if (progress().pendingVerification.length) {
        <div class="warning" role="status">
          有 {{ progress().pendingVerification.length }} 条当前轮次事件的模块或对象来源待核；这些记录不会计入板块进度。
        </div>
      }
      <p class="footnote">完成度只表示本轮保存过有效操作，不代表通过方案会签、报价审核、合同签约或项目G4。切换演示身份会保留当前轮次、主线和项目。</p>
    </section>
  `,
  styles: `
    .round-progress { border: 1px solid #dbe4f3; border-left: 4px solid #315dde; border-radius: 8px; background: #fff; margin: 0 0 20px; padding: 18px 22px; }
    .heading { display:flex; justify-content:space-between; align-items:flex-start; gap:16px; }
    .heading h2 { margin:0; font-size:16px; }
    .eyebrow { margin:0 0 5px; color:#315dde; font-size:10px; font-weight:700; letter-spacing:.04em; }
    .round-id,.identity { color:#68758b; font-size:11px; }
    .context-selectors { display:flex; align-items:end; flex-wrap:wrap; gap:12px; margin:16px 0 10px; }
    .context-selectors label { display:grid; gap:5px; font-size:11px; color:#56647a; min-width:210px; }
    select { min-width:0; padding:8px; border:1px solid #cfd7e4; border-radius:5px; background:white; }
    .identity { padding:8px 0; }
    .context-note,.footnote { color:#68758b; font-size:11px; line-height:1.7; }
    .module-list { list-style:none; margin:14px 0; padding:0; display:grid; grid-template-columns:repeat(5,minmax(0,1fr)); gap:8px; }
    .module-list li { min-width:0; border:1px solid #e2e7ef; border-radius:6px; padding:10px; display:flex; align-items:flex-start; gap:7px; }
    .module-list li.done { border-color:#a8d0b8; background:#f5fbf7; }
    .marker { display:grid; place-items:center; flex:0 0 20px; height:20px; border-radius:50%; background:#edf1f7; color:#7b879b; font-size:12px; }
    .done .marker { background:#dff2e6; color:#28774b; }
    .module-copy { display:grid; gap:4px; min-width:0; flex:1; }
    .module-copy strong { font-size:12px; }
    .module-copy > span, details { color:#68758b; font-size:10px; }
    details small { display:block; line-height:1.6; margin-top:5px; overflow-wrap:anywhere; }
    summary { cursor:pointer; }
    .open-link { font-size:10px; white-space:nowrap; color:#315dde; }
    .warning { margin:10px 0; padding:10px; border:1px solid #efca84; background:#fff8e8; border-radius:5px; color:#754b0d; font-size:11px; }
    @media (max-width:900px) { .module-list { grid-template-columns:repeat(2,minmax(0,1fr)); } }
    @media (max-width:560px) { .round-progress { padding:14px; } .heading { flex-direction:column; } .module-list { grid-template-columns:1fr; } .context-selectors label { width:100%; } }
  `,
})
export class RoundProgress {
  readonly store = inject(DemoStore);
  private readonly router = inject(Router);
  readonly mainlineOptions = computed<MainlineOption[]>(() => {
    const state = this.store.state();
    return state.sales
      .filter((sale) => sale.type === 'opportunity' || (sale.type === 'lead' && !sale.convertedTo))
      .map((record) => ({
        id: record.id,
        label: `${record.type === 'lead' ? '线索' : '商机'} · ${record.projectName || record.id} · ${record.id}`,
        record,
        opportunityId: record.type === 'opportunity' ? record.id : record.convertedTo || '',
      }));
  });
  readonly selectedOption = computed(() =>
    this.mainlineOptions().find((option) => option.id === this.store.state().selectedMainlineId),
  );
  readonly selectedOpportunityId = computed(() => {
    const option = this.selectedOption();
    return option?.opportunityId || '';
  });
  readonly projects = computed(() =>
    this.selectedOpportunityId()
      ? this.store.state().projects.filter((project) => project.opportunityId === this.selectedOpportunityId())
      : [],
  );
  readonly effectiveProjectId = computed(() => {
    const selected = this.store.state().selectedProjectId;
    if (selected && this.projects().some((project) => project.id === selected)) return selected;
    return this.projects().length === 1 ? this.projects()[0].id : '';
  });
  readonly progress = computed(() => {
    const state = this.store.state();
    const option = this.selectedOption();
    const opportunityId = this.selectedOpportunityId();
    const canonicalMainlineId = opportunityId || option?.id || '';
    const aliases = new Set<string>([canonicalMainlineId]);
    if (option?.record.type === 'lead') aliases.add(option.record.id);
    const lead = state.sales.find((sale) => sale.type === 'lead' && sale.convertedTo === opportunityId);
    if (lead) aliases.add(lead.id);
    for (const contract of state.contracts.filter((item) => item.opportunityId === canonicalMainlineId)) {
      if (contract.paymentTermId) aliases.add(contract.paymentTermId);
    }
    const ownership = this.ownership(state, canonicalMainlineId, this.effectiveProjectId());
    return calculateMainlineProgress({
      roundId: state.roundId || '',
      mainlineId: canonicalMainlineId,
      mainlineAliases: [...aliases].filter(Boolean),
      events: state.operationEvents || [],
      registeredModules: PROGRESS_MODULES,
      ownership,
    });
  });

  selectMainline(mainlineId: string): void {
    if (mainlineId) this.store.setRoundContext(mainlineId);
  }

  selectProject(projectId: string): void {
    const mainlineId = this.store.state().selectedMainlineId;
    if (mainlineId) this.store.setRoundContext(mainlineId, projectId);
  }

  moduleAvailability(moduleId: string): string {
    if (!this.selectedOption()) return '请选择主线';
    if (moduleId === 'startup') {
      if (!this.projects().length) return '尚无关联项目';
      if (this.projects().length > 1 && !this.effectiveProjectId()) return '请选择当前项目';
    }
    return '待本轮有效操作';
  }

  moduleHref(moduleId: string): UrlTree | string[] | null {
    const option = this.selectedOption();
    if (!option) return null;
    const opportunityId = this.selectedOpportunityId();
    const projectId = this.effectiveProjectId();
    switch (moduleId) {
      case 'sales':
        return ['/sales/detail', opportunityId || option.id];
      case 'solution':
        return opportunityId ? ['/sales/detail', opportunityId] : null;
      case 'quote':
        return opportunityId ? ['/sales/quotes', opportunityId] : null;
      case 'contract': {
        const contract = this.store.state().contracts.find((item) => item.opportunityId === opportunityId);
        return opportunityId && contract ? ['/contracts', contract.id] : null;
      }
      case 'startup': {
        // 统一容器的启动交底页签形态：带部门与目标动作，落到当前待办理的显式动作，不靠重定向兜底。
        if (!projectId) return null;
        return this.router.createUrlTree(['/projects', projectId], {
          queryParams: startupEntryQuery(this.store.startupGate(projectId)),
        });
      }
      default:
        return null;
    }
  }

  private ownership(state: DemoState, mainlineId: string, selectedProjectId: string): MainlineObjectOwnership[] {
    if (!mainlineId) return [];
    const rows: MainlineObjectOwnership[] = [];
    const add = (objectType: string, objectId: string | undefined, owner = mainlineId) => {
      if (objectId) rows.push({ objectType, objectId, mainlineId: owner });
    };
    const opportunity = state.sales.find((sale) => sale.type === 'opportunity' && sale.id === mainlineId);
    if (!opportunity) add('lead', mainlineId);
    else {
      add('opportunity', opportunity.id);
      if (opportunity.leadId) add('lead', opportunity.leadId);
    }
    for (const lead of state.sales.filter((sale) => sale.type === 'lead' && sale.convertedTo === mainlineId))
      add('lead', lead.id);
    for (const quote of state.quoteSeries || []) {
      if (quote.opportunityId !== mainlineId) continue;
      add('quote-series', quote.id);
      for (const version of quote.versions) add('quote-version', version.id);
    }
    const contracts = state.contracts.filter((contract) => contract.opportunityId === mainlineId);
    for (const contract of contracts) {
      add('contract', contract.id);
    }
    for (const term of state.paymentTerms || []) {
      const relatedContract = contracts.some((contract) => contract.paymentTermId === term.id);
      if (!relatedContract) continue;
      add('payment-term', term.id);
      for (const method of state.paymentMethods || [])
        if (method.paymentTermId === term.id) add('payment-method', method.id);
    }
    for (const invoice of state.contractInvoices || []) {
      if (!contracts.some((contract) => contract.id === invoice.contractId)) continue;
      add('contract-invoice', invoice.id);
    }
    for (const order of state.orders || []) {
      if (!contracts.some((contract) => contract.id === order.contractId)) continue;
      add('sales-order', order.id);
    }
    for (const receipt of state.bankReceiptClaims || []) {
      if (contracts.some((contract) => contract.id === receipt.contractId)) add('bank-receipt-claim', receipt.id);
    }
    const relatedProjects = state.projects.filter((project) => project.opportunityId === mainlineId);
    if (relatedProjects.length === 1 || selectedProjectId)
      for (const project of relatedProjects)
        if (!selectedProjectId || project.id === selectedProjectId) add('project', project.id);
    return rows;
  }
}
