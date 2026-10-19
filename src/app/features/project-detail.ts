import { V10Return } from '../shared/v10-return';
import { NodeApplicabilityPanel } from './node-applicability-panel';
import { ProgressMappingPanel } from './progress-mapping-panel';
import { BudgetExpensePanel } from './budget-expense-panel';
import { LifecycleProgressPanel } from '../core/lifecycle-progress/progress-panel';
import { selectLifecycleProgress } from '../core/lifecycle-progress';
import { selectBudgetComparison, selectBudgetIntegrity } from '../core/budget-comparison';
import { planWarningDate } from '../core/plan-warning-backfill';
import { ProjectDeliveryPanel } from './project-delivery-panel';
import { ContractMilestones } from './contract-milestones';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { toSignal, takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { map } from 'rxjs';
import { DemoStore } from '../core/store';
import { personField, PROJECT_MANAGERS } from '../core/personnel';
import { BusinessForms } from '../core/forms';
import {
  AcceptanceItem,
  BASE_DATE,
  Field,
  Issue,
  PLAN_TYPES,
  Plan,
  PlanType,
  Project,
  CustomerCommunicationType,
  ReviewCondition,
} from '../core/models';
import { blankPlan, makePlans, newId } from '../core/seed';
import { planRisk, PlanRiskResult, riskClass } from '../core/rules';
import { wbsHierarchy } from '../core/wbs-hierarchy';
import { PlanGantt } from './plan-gantt';
import { planWarningIdentityGaps } from '../core/plan-warning';
import {
  budgetCellText,
  BUDGET_CURRENCY_OPTIONS,
  BUDGET_PENDING_TEXT,
  BudgetTotal,
  formatBudgetAmount,
  readPlanBudget,
} from '../core/budget';
import { projectReturnEntry } from '../core/project-return-entry';
import { Icon } from '../shared/icon';
import { Badge } from '../shared/badge';
import { Documents } from '../shared/documents';
import { ProjectFinance } from './project-finance';
import { SolutionService } from './solution-service';
import { ProjectStartupPanel } from './project-startup-panel';
@Component({
  imports: [
    V10Return,
    BudgetExpensePanel,
    NodeApplicabilityPanel,
    ProgressMappingPanel,
    LifecycleProgressPanel,
    RouterLink,
    Icon,
    Badge,
    Documents,
    ProjectFinance,
    SolutionService,
    ProjectStartupPanel,
    ContractMilestones,
    ProjectDeliveryPanel,
    PlanGantt,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './project-detail.html',
  styleUrl: './project-plan-visual.scss',
  styles: `
    .project-context {
      display: flex;
      align-items: center;
      gap: 16px;
      font-size: 11px;
      color: #8997ad;
      margin-top: 10px;
    }
    .project-context app-icon {
      width: 14px;
      height: 14px;
    }
    .context-item {
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .briefing-grid {
      display: grid;
      grid-template-columns: minmax(0, 1.5fr) minmax(280px, 1fr);
      gap: 22px;
    }
    .briefing-result {
      padding: 22px;
    }
    .briefing-result h3 {
      margin: 0 0 14px;
      font-size: 13px;
    }
    .briefing-result p {
      font-size: 12px;
      line-height: 1.8;
    }
    .condition-row {
      padding: 18px 23px;
      border-bottom: 1px solid var(--line);
    }
    .condition-row > div:first-child {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
    }
    .condition-row h3 {
      font-size: 12px;
      margin: 0;
    }
    .condition-row p {
      font-size: 11px;
      margin: 7px 0 10px;
      line-height: 1.8;
    }
    .type-tabs {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
      margin-bottom: 20px;
    }
    .type-tabs button {
      background: white;
      border: 1px solid var(--line);
      border-radius: 6px;
      font-size: 11px;
      color: #8493aa;
      padding: 8px 14px;
    }
    .type-tabs button.active {
      background: #edf2ff;
      border-color: #c7d6ff;
      color: var(--primary);
    }
    .handover-card {
      padding: 18px 20px;
      display: flex;
      gap: 13px;
      align-items: flex-start;
    }
    .handover-card h3 {
      font-size: 12px;
      margin: 0 0 6px;
    }
    .handover-card p {
      font-size: 10px;
      line-height: 1.8;
      margin: 8px 0 0;
    }
    .handover-symbol {
      padding: 9px;
      background: #f0f4fc;
      border-radius: 7px;
      color: #7b91bb;
    }
    .acceptance-layout {
      display: grid;
      grid-template-columns: minmax(0, 1.3fr) minmax(260px, 1fr);
      gap: 22px;
    }
    .team-row {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 18px 24px;
      border-bottom: 1px solid var(--line);
    }
    .team-row h3 {
      font-size: 12px;
      margin: 0 0 5px;
    }
    .team-row p {
      font-size: 10px;
      margin: 0;
    }
    .subprojects {
      padding: 5px 22px 15px;
    }
    .subprojects a {
      display: flex;
      justify-content: space-between;
      font-size: 12px;
      padding: 12px 0;
      border-bottom: 1px solid var(--line);
    }
    .subprojects a:last-child {
      border: 0;
    }
    .subprojects a:hover {
      color: var(--primary);
    }
    .status-banner {
      padding: 18px 22px;
      border-bottom: 1px solid var(--line);
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 15px;
    }
    .status-banner p {
      font-size: 11px;
      margin: 6px 0 0;
    }
    .result-big {
      font-size: 20px;
      font-weight: 550;
      margin-bottom: 12px;
    }
    .readonly-line {
      padding: 18px 22px;
      font-size: 12px;
      background: #fafbfd;
      border-top: 1px solid var(--line);
      color: #8495af;
    }
    .plan-focused {
      box-shadow: inset 3px 0 0 #d9822b;
      background: #fffaf3;
    }
    .template-preview {
      background: #f8fafd;
      padding: 18px 22px;
      border-top: 1px solid var(--line);
    }
    .template-preview li {
      font-size: 11px;
      color: #7488a6;
      margin-bottom: 6px;
    }
    .sat-details {
      display: flex;
      justify-content: space-between;
      gap: 14px;
      padding: 15px 0;
      border-bottom: 1px solid var(--line);
      font-size: 12px;
    }
    .sat-details span {
      color: #8a9aaf;
    }
    @media (max-width: 1000px) {
      .briefing-grid,
      .acceptance-layout {
        grid-template-columns: 1fr;
      }
    }
  `,
})
export class ProjectDetail {
  readonly warningDate = planWarningDate;
  store = inject(DemoStore);
  forms = inject(BusinessForms);
  route = inject(ActivatedRoute);
  router = inject(Router);
  id = toSignal(this.route.paramMap.pipe(map((p) => p.get('id') || '')), { initialValue: '' });
  project = computed(() => this.store.project(this.id()));
  queryParams = toSignal(this.route.queryParamMap, {
    initialValue: this.route.snapshot.queryParamMap,
  });
  returnEntry = computed(() => {
    const entry = projectReturnEntry(
      this.queryParams().get('returnTo'),
      this.queryParams().get('returnLabel'),
    );
    return entry ? { target: this.router.parseUrl(entry.path), label: entry.label } : null;
  });
  tab = signal('概览');
  guideMode = signal(false);
  lifecycleProgress = computed(() =>
    selectLifecycleProgress(this.store.state(), this.project()?.opportunityId || '', this.id()),
  );
  budgetComparison = computed(() => selectBudgetComparison(this.store.state(), this.id()));
  budgetIntegrity = computed(() => selectBudgetIntegrity(this.id(), this.project()?.plans || []));
  tabs = [
    {
      key: 'overview',
      label: '概况',
      sections: ['概览', '业务进度', '预算费用', '团队', '财务信息', '资料历史'],
    },
    { key: 'startup', label: '启动', sections: ['启动交底'] },
    { key: 'plans', label: '计划', sections: ['计划执行'] },
    { key: 'delivery', label: '交付', sections: ['交付入口', '执行记录'] },
    { key: 'acceptance', label: '验收', sections: ['验收', '移交'] },
  ];
  activeRegion = computed(
    () => this.tabs.find((region) => region.sections.includes(this.tab())) || this.tabs[0],
  );
  selectTab(section: string): void {
    const region = this.tabs.find((item) => item.sections.includes(section));
    this.router.navigate([], {
      relativeTo: this.route,
      queryParams: {
        tab: region?.key || 'overview',
        section: section === region?.sections[0] ? null : section,
      },
      queryParamsHandling: 'merge',
      preserveFragment: true,
    });
  }
  planTypes = PLAN_TYPES;
  planType = signal<PlanType>('内部WBS');
  selectPlanType(type: PlanType): void {
    this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { plan: type, focus: null, planId: null },
      queryParamsHandling: 'merge',
      preserveFragment: true,
    });
    this.preview.set('');
  }
  planView = signal('table');
  togglePlanView(): void {
    this.router.navigate([], {
      relativeTo: this.route,
      queryParams: {
        view: this.planView() === 'table' ? 'gantt' : 'table',
        focus: null,
        planId: null,
      },
      queryParamsHandling: 'merge',
    });
  }
  warningIdentityGaps = computed(() => {
    const project = this.project();
    return !project || !this.ganttCapable()
      ? []
      : this.plans().flatMap((plan) => {
          const missing = planWarningIdentityGaps(project, plan);
          return missing.length ? [`${plan.name}：${missing.join('、')}身份待补`] : [];
        });
  });
  preview = signal('');
  /** 08-03：从预警/追踪看板带过来的 Plan ID，用于准确定位到具体计划。 */
  focusedPlanId = computed(
    () => this.queryParams().get('planId') || this.queryParams().get('focus') || '',
  );
  plans = computed(() => {
    const focused = this.focusedPlanId();
    const list = this.project()?.plans.filter((p) => p.type === this.planType()) || [];
    return focused
      ? list.sort((a, b) => Number(b.id === focused) - Number(a.id === focused))
      : list;
  });
  planRows = computed(() =>
    this.planType() === '内部WBS'
      ? wbsHierarchy(this.plans())
      : this.plans().map((plan) => ({ plan, depth: 0, childCount: 0 })),
  );
  focusedPlan(): Plan | undefined {
    const id = this.focusedPlanId();
    return id ? this.project()?.plans.find((plan) => plan.id === id) : undefined;
  }
  isFocusedPlan(plan: Plan): boolean {
    return !!this.focusedPlanId() && plan.id === this.focusedPlanId();
  }
  budgetCurrencyOptions = BUDGET_CURRENCY_OPTIONS.map((option) => ({
    value: option.value,
    label: option.label,
  }));
  budgetPendingText = BUDGET_PENDING_TEXT;
  /** BUD02/BUD03：表格、计划面板与概况摘要读取同一份分币种汇总。 */
  budgetSummary = computed(() => this.store.planBudgetSummary(this.id()));
  budgetCell(plan: Plan): string {
    return budgetCellText(plan);
  }
  /** 供 UI 与真实浏览器验收定位“已填/待补/待核”，缺值不显示为 0。 */
  budgetState(plan: Plan): 'filled' | 'review' | 'pending' | 'none' {
    const read = readPlanBudget(plan);
    if (!read.applies) return 'none';
    if (read.usable) return 'filled';
    return read.amountCents === null ? 'pending' : 'review';
  }
  budgetTotalText(total: BudgetTotal): string {
    return formatBudgetAmount(total.cents, total.currency);
  }
  planById(id: string): Plan | undefined {
    return this.project()?.plans.find((plan) => plan.id === id);
  }
  addRiskRecord(): void {
    this.store.ui.open({
      title: '新增风险 / 问题记录',
      description:
        '类别、等级、可能性和状态须引用业务来源。未核验的选项可按来源填写，并保留待核说明。',
      fields: [
        { key: 'category', label: '来源类别', required: true },
        { key: 'level', label: '来源等级', required: true },
        { key: 'likelihood', label: '来源可能性', required: true },
        { key: 'status', label: '来源状态', required: true },
        { key: 'description', label: '风险 / 问题说明', type: 'textarea', required: true },
        { key: 'sourceReference', label: '来源引用 / 待核说明', required: true },
      ],
      sample: {
        category: '待核类别',
        level: '待核等级',
        likelihood: '待核可能性',
        status: '待核状态',
        description: '请先核对来源资料后再记录正式值。',
        sourceReference: '来源待核：请补资料名称或字段映射',
      },
      onSave: (data) =>
        this.store.addProjectRisk(this.id(), {
          category: data['category'],
          level: data['level'],
          likelihood: data['likelihood'],
          status: data['status'],
          description: data['description'],
          sourceReference: data['sourceReference'],
        }),
    });
  }
  addCommunicationRecord(): void {
    this.store.ui.open({
      title: '新增客户沟通记录',
      description: '按来源手工登记沟通内容；不会导入或生成邮件、即时消息时间线。',
      fields: [
        {
          key: 'type',
          label: '沟通类型',
          type: 'select',
          required: true,
          options: ['需求澄清', '执行情况', '需求变更', '回款信息', '问题风险'],
        },
        { key: 'date', label: '沟通发生日期（手工填写）', type: 'date', required: true },
        { key: 'summary', label: '沟通摘要', type: 'textarea', required: true },
        { key: 'sourceReference', label: '来源引用 / 待核说明', required: true },
      ],
      sample: {
        type: '执行情况',
        date: '',
        summary: '按已核实的客户沟通内容手工填写。',
        sourceReference: '来源待核：请补会议纪要或业务记录引用',
      },
      onSave: (data) =>
        this.store.addProjectCommunication(this.id(), {
          type: data['type'] as CustomerCommunicationType,
          date: data['date'],
          summary: data['summary'],
          sourceReference: data['sourceReference'],
        }),
    });
  }
  addEquipmentSerial(): void {
    this.store.ui.open({
      title: '新增设备SN记录',
      description: '通过项目ID与合同ID回溯关联；实际日期须来自明确证据，未核实的来源保持待核。',
      fields: [
        { key: 'serialNumber', label: '设备SN', required: true },
        { key: 'model', label: '已核实型号', required: true },
        { key: 'quantity', label: '数量', type: 'number', min: 1, value: 1, required: true },
        { key: 'status', label: '来源设备状态', required: true },
        { key: 'siteLocation', label: '现场位置', required: true },
        { key: 'actualDate', label: '节点实际日期（可留空）', type: 'date' },
        { key: 'sourceReference', label: '来源引用 / 实际日期证据', required: true },
      ],
      sample: {
        serialNumber: 'SN待核',
        model: '型号待核',
        quantity: 1,
        status: '待核',
        siteLocation: '待核',
        sourceReference: '来源待核：请补设备台账或现场记录引用',
      },
      onSave: (data) =>
        this.store.addEquipmentSerial(this.id(), {
          serialNumber: data['serialNumber'],
          model: data['model'],
          quantity: Number(data['quantity']),
          status: data['status'],
          siteLocation: data['siteLocation'],
          actualDate: data['actualDate'],
          sourceReference: data['sourceReference'],
        }),
    });
  }
  contract = computed(() =>
    this.store.state().contracts.find((c) => c.id === this.project()?.contractId),
  );
  dealSolutionReference = computed(() => {
    const project = this.project();
    const contract = this.contract();
    if (!project || !contract?.quoteVersionId) return undefined;
    const quote = this.store.quoteVersion(contract.quoteVersionId);
    if (!quote || quote.seriesId !== contract.quoteSeriesId) return { missing: true as const };
    const quoteSeries = this.store
      .state()
      .quoteSeries?.find((series) => series.id === quote.seriesId);
    if (!quoteSeries || quoteSeries.opportunityId !== project.opportunityId)
      return { missing: true as const };
    const solution = this.store.solution(project.opportunityId);
    const dealVersion = solution?.versions.find(
      (version) => version.id === quote.solutionVersionId,
    );
    const latest = solution?.versions.find((version) => version.id === solution.latestVersionId);
    const final = solution?.versions.find((version) => version.id === solution.finalVersionId);
    const name = (id: string) =>
      this.store.state().attachments.find((attachment) => attachment.id === id)?.name ||
      '模拟文件记录待补';
    return {
      missing: false as const,
      quoteNumber: quote.number,
      dealVersion,
      dealName: dealVersion ? name(dealVersion.documentId) : undefined,
      latest,
      latestName: latest ? name(latest.documentId) : undefined,
      final,
      finalName: final ? name(final.documentId) : undefined,
    };
  });
  siblings = computed(() =>
    this.store.state().projects.filter((p) => p.contractId === this.project()?.contractId),
  );
  contactName(p: Project): string {
    return (
      this.store.customer(p.customerId)?.contacts.find((c) => c.id === p.contactId)?.name ||
      '待确认'
    );
  }
  associateOpportunity(project: Project): void {
    const opportunities = this.store.opportunities().filter((o) => o.stage !== '丢单');
    this.store.ui.open({
      title: '关联来源商机',
      description: '确认后保留当前项目号，带入客户、联系人和来源团队。',
      submitLabel: '确认关联',
      fields: [
        {
          key: 'opportunity',
          label: '商机',
          type: 'select',
          options: opportunities.map((o) => `${o.id} · ${o.projectName} · ${o.stage}`),
          required: true,
        },
      ],
      onSave: (d) =>
        this.store.associateProject(project.id, String(d['opportunity']).split(' · ')[0]),
    });
  }
  locateBriefingItem(item: string, project: Project): void {
    if (item === '启动纪要' || item === '启动文件') this.selectTab('启动交底');
    else this.forms.project(project);
  }
  fatDate(p: Project): string {
    const fat = p.plans.find((plan) => plan.type === 'FAT测试');
    return fat?.expected || fat?.end || '待补充';
  }
  linkedMilestone(plan: Plan, project: Project): Plan | undefined {
    if (plan.customerMilestoneId)
      return project.plans.find(
        (candidate) => candidate.type === '客户主节点' && candidate.id === plan.customerMilestoneId,
      );
    const matches = project.plans.filter(
      (candidate) => candidate.type === '客户主节点' && candidate.name === plan.linked,
    );
    return matches.length === 1 ? matches[0] : undefined;
  }
  milestoneDifference(plan: Plan, project: Project): string {
    const linked = this.linkedMilestone(plan, project);
    if (!linked?.end || !plan.expected) return '日期待补';
    const days = Math.round((Date.parse(plan.expected) - Date.parse(linked.end)) / 86400000);
    return `${days > 0 ? '+' : ''}${days}天`;
  }
  constructor() {
    this.route.queryParamMap.pipe(takeUntilDestroyed()).subscribe((p) => {
      const requested = p.get('tab') || 'overview';
      const region = this.tabs.find((item) => item.key === requested);
      const section = p.get('section');
      this.tab.set(
        region
          ? section && region.sections.includes(section)
            ? section
            : region.sections[0]
          : this.tabs.flatMap((item) => item.sections).includes(requested)
            ? requested
            : '概览',
      );
      this.guideMode.set(p.get('guide') === 'mainline');
      this.planType.set(
        PLAN_TYPES.includes(p.get('plan') as PlanType) ? (p.get('plan') as PlanType) : '内部WBS',
      );
      // 带 Plan ID 进入时按计划自身的类型展开，保证定位到可见的那一行。
      const focusId = p.get('planId') || p.get('focus');
      this.planView.set(p.get('view') === 'gantt' && !focusId ? 'gantt' : 'table');
      const focusedPlan = focusId
        ? this.store.project(this.id())?.plans.find((plan) => plan.id === focusId)
        : undefined;
      if (focusedPlan) this.planType.set(focusedPlan.type);
    });
  }
  researchSourceSummary():string {
    const rows=this.plans();
    if(!rows.length)return '尚无来源计划，来源与更新时间待补';
    const missing=rows.filter(p=>!p.sourceReference || !p.sourceUpdatedAt).length;
    return missing ? `${missing} 条来源或更新时间待补；逐行查看原始引用` : '来源及更新时间已留存，逐行查看；不代表实时同步';
  }
  openConditions = () => this.project()?.conditions.filter((c) => !c.closed).length || 0;
  guide(): string {
    const p = this.project();
    if (!p) return '';
    if (!p.accepted) return 'PM接收项目，先看来源商机和客户资料';
    if (this.tab() === '验收') return 'SAT与客户验收分别完成，逐项保留签认凭据';
    if (this.tab() === '移交')
      return p.sat.complete ? '检查八类资料，提交后由接收方确认' : '先完成SAT，再发起内部移交';
    if (this.tab() === '计划执行') return '维护本地计划，外部生产与财务结果保持只读';
    return this.openConditions()
      ? '补齐交底未完成事项，责任人提供凭据，PMO确认'
      : '按角色处理任务，历史资料统一引用';
  }
  addChild(): void {
    const p = this.project()!;
    this.store.ui.open({
      title: '新增合同关联子项目',
      description: '共享合同商务来源，子项目计划与资料独立维护，不分摊金额或物料。',
      fields: [
        { key: 'name', label: '子项目名称', required: true },
        { key: 'site', label: '现场 / 批次 / 范围', required: true },
        personField('pm', '拟任PM', '王项目', true, PROJECT_MANAGERS),
      ],
      sample: { name: p.name + '扩建批次', site: '第二现场，10MWh扩建批次', pm: '王项目' },
      onSave: (d) => {
        const id = this.store.addSubproject(p.id, d['name'], d['site'], d['pm']);
        if (!id) return false;
        this.router.navigate(['/projects', id]);
        return true;
      },
    });
  }
  review(): void {
    this.store.ui.open({
      title: '查看OA模拟交底结果',
      description: '应用预置审批结果，不触发真实OA；意见和条件在业务页面留存。',
      fields: [
        {
          key: 'result',
          label: '模拟结果',
          type: 'select',
          options: ['通过', '附条件通过', '退回'],
          required: true,
          value: '通过',
        },
        { key: 'opinion', label: '审核意见 / 条件 / 退回原因', type: 'textarea', required: true },
      ],
      sample: {
        result: '附条件通过',
        opinion: '请补齐客户现场接线图，责任人提供凭据后由PMO关闭。',
      },
      onSave: (d) => this.store.review(this.id(), d['result'], d['opinion']),
    });
  }
  evidence(c: ReviewCondition): void {
    this.store.ui.open({
      title: '补充条件关闭凭据',
      fields: [
        {
          key: 'evidence',
          label: '凭据内容 / 文件引用',
          type: 'textarea',
          required: true,
          value: c.evidence,
        },
      ],
      sample: { evidence: '已补齐客户确认的接线图，引用项目技术资料，等待PMO确认。' },
      onSave: (d) => this.store.conditionEvidence(this.id(), c.id, d['evidence']),
    });
  }
  editPlan(existing?: Plan): void {
    const p = existing ? structuredClone(existing) : blankPlan(this.planType());
    if (!this.store.canEditPlan(p)) {
      this.store.ui.fail('来源数据始终只读，不能修改该计划');
      return;
    }
    const operationId = newId('OP');
    const fields: Field[] = [
      ...(p.type === '内部WBS'
        ? [
            { key: 'wbsCode', label: 'WBS编号', value: p.wbsCode || '' },
            {
              key: 'durationDays',
              label: '计划天数',
              type: 'number' as const,
              min: 0,
              value: p.durationDays ?? '',
              required: true,
            },
            { key: 'predecessor', label: '前置任务（WBS编号）', value: p.predecessor || '' },
            {
              key: 'relationNote',
              label: '任务关系说明',
              type: 'textarea' as const,
              value: p.relationNote || '',
            },
            { key: 'weekWindow', label: '周窗口', value: p.weekWindow || '' },
          ]
        : []),
      { key: 'name', label: '节点 / 任务名称', required: true, value: p.name },
      personField('owner', '责任人', p.owner, true),
      { key: 'start', label: '计划开始日期', type: 'date', required: true, value: p.start },
      {
        key: 'end',
        label: p.type === '调试备件' || p.type === '要货发货' ? '需求日期' : '计划结束日期',
        type: 'date',
        required: true,
        value: p.end,
      },
      {
        key: 'expected',
        label: p.type === '要货发货' ? '预计发货日期' : '预计完成日期',
        type: 'date',
        required: p.type === '内部WBS',
        value: p.expected,
        hint:
          p.type === '内部WBS'
            ? '用于进度展示与客户节点偏差对比；预警由“计划结束日期 − 预警天数”触发，不使用本日期'
            : undefined,
      },
      {
        key: 'actual',
        label: p.type === '要货发货' ? '实际发运 / 到货日期' : '实际完成日期',
        type: 'date',
        value: p.actual,
      },
      {
        key: 'actualSourceReference',
        label: '实际日期证据 / 来源引用',
        value: p.actualSourceReference || '',
      },
      {
        key: 'status',
        label: '执行状态',
        type: 'select',
        options: ['未开始', '进行中', '已完成', '需复核', '已取消'],
        value: p.status,
      },
      {
        key: 'warningLeadDays',
        label: p.type === '内部WBS' ? '预警日期（提前天数）' : '预警天数（N）',
        type: 'number' as const,
        min: 0,
        required: p.type === '内部WBS' && !existing,
        value: p.warningLeadDays ?? '',
        hint: '填写非负整数，例如7表示提前7天预警；预警日期 = 计划结束日 − 提前天数，0表示到期当天预警',
      },
      { key: 'note', label: '变更说明 / 业务备注', type: 'textarea', value: p.note },
      {
        key: 'sourceReference',
        label: '来源引用（模板/离线文件）',
        value: p.sourceReference || '',
      },
      {
        key: 'sourceUpdatedAt',
        label: '来源更新时间',
        type: 'date',
        value: p.sourceUpdatedAt || '',
      },
      {
        key: 'sourceStatus',
        label: '来源状态',
        type: 'select',
        options: ['已引用', '模拟', '待核'],
        value: p.sourceStatus || '待核',
      },
    ];
    if (p.type === '内部WBS')
      fields.push(
        {
          key: 'budgetAmount',
          label: '预计预算金额',
          type: 'number' as const,
          min: 0,
          required: true,
          group: '预算信息',
          value: p.budgetAmount ?? '',
          hint: '任务预计支出，不是报价或回款金额；允许 0，最多两位小数，留空不能保存',
        },
        {
          key: 'budgetCurrency',
          label: '预计预算币种',
          type: 'select' as const,
          required: true,
          group: '预算信息',
          options: this.budgetCurrencyOptions,
          value: p.budgetCurrency || '',
          hint: '必须明确选择 CNY / EUR / USD；默认不预选，也不自动换算',
        },
      );
    if (['内部WBS', '要货发货', 'FAT测试'].includes(p.type))
      fields.push(
        { key: 'product', label: '产品', value: p.product },
        { key: 'quantity', label: '数量', type: 'number', min: 1, value: p.quantity },
        { key: 'batch', label: '批次', value: p.batch },
        {
          key: 'customerMilestoneId',
          label: '关联客户主节点',
          type: 'select',
          options: [
            { value: '__none__', label: '取消关联（仅本地计划）' },
            ...this.project()!
              .plans.filter((p) => p.type === '客户主节点')
              .map((milestone) => ({
                value: milestone.id,
                label: `${milestone.name}（${milestone.id}）`,
              })),
          ],
          value: p.customerMilestoneId,
          hint:
            p.linked &&
            !this.project()!.plans.some(
              (milestone) =>
                milestone.type === '客户主节点' && milestone.id === p.customerMilestoneId,
            )
              ? '旧名称无法唯一匹配或节点已变化，请明确选择客户节点后再生成稳定关联。'
              : '按客户节点固定编号关联；节点名称可修改而不丢失关联。',
        },
      );
    if (p.type === 'FAT测试')
      fields.push({
        key: 'result',
        label: '实际测试结论',
        type: 'select',
        options: ['待执行', '合格', '不合格'],
        value: p.result,
      });
    if (p.type === '调试备件')
      fields.push(personField('receiver', '接收备件专员', p.receiver, false, ['郑备件']));
    if (p.type === '开票回款')
      fields.push(
        { key: 'amount', label: '计划开票金额', type: 'number', min: 0, value: p.amount },
        {
          key: 'currency',
          label: '币种',
          type: 'select',
          options: ['CNY', 'EUR', 'USD'],
          value: p.currency,
        },
      );
    this.store.ui.open({
      title: existing ? '编辑' + p.type : '新增' + p.type + '计划',
      description:
        '计划日期、预计日期和实际日期分别保存；关联客户节点使用固定编号，关键节点仍按原规则检查凭据。',
      fields,
      sample: {
        name: p.name || '新增项目任务',
        start: '2026-10-12',
        end: '2026-10-20',
        expected: '2026-10-20',
        status: '进行中',
        note: '已与责任部门确认本轮计划安排',
        receiver: '郑备件',
      },
      onSave: (d) => {
        const rawMilestoneId = d['customerMilestoneId'] ?? '';
        const customerMilestoneId =
          rawMilestoneId === '__none__' ? '' : rawMilestoneId || p.customerMilestoneId || '';
        const customerMilestone = this.project()!.plans.find(
          (candidate) => candidate.type === '客户主节点' && candidate.id === customerMilestoneId,
        );
        const rawBudgetAmount = d['budgetAmount'];
        const budgetAmount =
          rawBudgetAmount === '' || rawBudgetAmount === undefined
            ? undefined
            : Number(rawBudgetAmount);
        const budgetCurrency = (d['budgetCurrency'] ?? '').trim();
        return this.store.savePlan(
          this.id(),
          {
            ...p,
            name: d['name'],
            owner: d['owner'],
            start: d['start'],
            end: d['end'],
            expected: d['expected'],
            actual: d['actual'],
            actualSourceReference: d['actualSourceReference'],
            status: d['status'],
            note: d['note'],
            warningLeadDays:
              d['warningLeadDays'] === '' || d['warningLeadDays'] === undefined
                ? undefined
                : Number(d['warningLeadDays']),
            wbsCode: d['wbsCode'] ?? p.wbsCode,
            durationDays:
              d['durationDays'] !== undefined ? Number(d['durationDays']) : p.durationDays,
            predecessor: d['predecessor'] ?? p.predecessor,
            relationNote: d['relationNote'] ?? p.relationNote,
            weekWindow: d['weekWindow'] ?? p.weekWindow,
            sourceReference: d['sourceReference'],
            sourceUpdatedAt: d['sourceUpdatedAt'],
            sourceStatus: d['sourceStatus'] as Plan['sourceStatus'],
            product: d['product'] ?? p.product,
            quantity: d['quantity'] ? Number(d['quantity']) : p.quantity,
            batch: d['batch'] ?? p.batch,
            linked: customerMilestone?.name || (rawMilestoneId === '__none__' ? '' : p.linked),
            customerMilestoneId: customerMilestone?.id,
            result: d['result'] ?? p.result,
            receiver: d['receiver'] ?? p.receiver,
            amount: d['amount'] ? Number(d['amount']) : p.amount,
            currency: d['currency'] ?? p.currency,
            ...(p.type === '内部WBS'
              ? {
                  budgetAmount,
                  budgetCurrency,
                  budgetSource: p.budgetSource,
                }
              : {}),
          },
          operationId,
        );
      },
    });
  }
  deletePlan(plan: Plan): void {
    if (window.confirm('确定删除这条未完成计划吗？')) this.store.deletePlan(this.id(), plan.id);
  }
  applyTemplate(): void {
    if (
      this.project()!.plans.some((p) => p.type === '内部WBS') &&
      !window.confirm('将替换本项目的内部WBS计划，其他计划保持不变，确定应用吗？')
    )
      return;
    this.store.applyTemplate(this.id(), this.preview() === '区域');
    this.preview.set('');
  }
  applicable(): void {
    const p = this.project()!;
    this.store.ui.open({
      title: '记录产研计划适用性',
      fields: [
        {
          key: 'applicable',
          label: '是否适用',
          type: 'select',
          options: ['适用', '不适用'],
          value: p.productionApplicable ? '适用' : '不适用',
        },
        { key: 'reason', label: '不适用原因', type: 'textarea', value: p.productionReason },
      ],
      sample: {
        applicable: '不适用',
        reason: '本订单为标准订单产品，演示场景不涉及独立产研计划。',
      },
      onSave: (d) => this.store.applicability(this.id(), d['applicable'] === '适用', d['reason']),
    });
  }
  editSat(): void {
    const sat = this.project()!.sat;
    this.store.ui.open({
      title: '记录SAT现场验收测试',
      description: '先保存测试结果和报告，再由PM确认完成。客户最终验收单独签认。',
      fields: [
        { key: 'date', label: '测试日期', type: 'date', value: sat.date },
        {
          key: 'result',
          label: '测试结论',
          type: 'select',
          options: ['待执行', '合格', '不合格'],
          value: sat.result,
        },
      ],
      sample: { date: BASE_DATE, result: '合格' },
      onSave: (d) => this.store.saveSat(this.id(), d['date'], d['result'], false),
    });
  }
  completeSat(): void {
    const sat = this.project()!.sat;
    this.store.saveSat(this.id(), sat.date, sat.result, true);
  }
  check(item: AcceptanceItem): void {
    this.store.ui.open({
      title: '客户验收逐项签认',
      description: '这里记录客户线下签字，不是电子签章。',
      fields: [
        {
          key: 'result',
          label: item.name + '检查结果',
          type: 'select',
          options: ['待检查', '通过', '不通过'],
          value: item.result,
        },
        personField(
          'signer',
          '签认人',
          item.signer,
          false,
          this.store
            .customer(this.project()!.customerId)
            ?.contacts.map((contact) => contact.name) || [],
        ),
        { key: 'date', label: '签认日期', type: 'date', value: item.date },
        { key: 'note', label: '说明 / 遗留问题', type: 'textarea', value: item.note },
      ],
      sample: {
        result: '通过',
        signer: this.store.customer(this.project()!.customerId)?.contacts[0]?.name || '',
        date: BASE_DATE,
        note: '已按样例清单确认',
      },
      onSave: (d) =>
        this.store.saveAcceptance(
          this.id(),
          item.id,
          d['result'],
          d['signer'],
          d['date'],
          d['note'],
        ),
    });
  }
  category(name: string): void {
    const p = structuredClone(this.project()!);
    const c = p.handover.categories.find((c) => c.name === name)!;
    this.store.ui.open({
      title: '整理' + name + '移交资料',
      fields: [
        {
          key: 'status',
          label: '资料状态',
          type: 'select',
          options: ['已有资料', '待补', '不适用'],
          value: c.status,
        },
        { key: 'note', label: '资料引用 / 不适用原因', type: 'textarea', value: c.note },
      ],
      sample: {
        status: '已有资料',
        note: '引用本项目已保存的' + name + '记录；仅业务演示，正式清单待确认。',
      },
      onSave: (d) => {
        c.status = d['status'];
        c.note = d['note'];
        return this.store.saveHandover(this.id(), p);
      },
    });
  }
  reference(): void {
    const p = structuredClone(this.project()!);
    p.handover.categories = p.handover.categories.map((c) => ({
      name: c.name,
      status: c.name === '培训信息' ? '不适用' : '已有资料',
      note: (
        {
          项目信息: '引用项目基本信息、现场与团队',
          商务信息: '引用合同样例付款条件及罚则',
          项目成果: `引用SAT结果：${p.sat.result}，客户最终验收独立记录`,
          技术信息: '引用项目需求与技术资料区',
          风险信息: `引用交底条件与历史，未完成${p.conditions.filter((c) => !c.closed).length}项`,
          服务信息: '接收方吴运维，服务范围后续确认',
          培训信息: '本演示样例未开展真实培训，正式不适用规则待确认',
          待办: '引用下方遗留事项与责任人',
        } as Record<string, string>
      )[c.name],
    }));
    this.store.saveHandover(this.id(), p);
  }
  receiver(): void {
    const p = structuredClone(this.project()!);
    this.store.ui.open({
      title: '选择内部移交接收方',
      fields: [personField('receiver', '接收人', p.handover.receiver, true, ['吴运维'])],
      onSave: (d) => {
        p.handover.receiver = d['receiver'];
        return this.store.saveHandover(this.id(), p);
      },
    });
  }
  issue(item?: Issue): void {
    const p = structuredClone(this.project()!);
    this.store.ui.open({
      title: item ? '编辑遗留事项' : '新增遗留事项',
      fields: [
        {
          key: 'text',
          label: '事项内容',
          type: 'textarea',
          required: true,
          value: item?.text || '',
        },
        personField('owner', '责任人', item?.owner || '王项目', true),
        {
          key: 'due',
          label: '关闭期限',
          type: 'date',
          required: true,
          value: item?.due || '2026-10-20',
        },
      ],
      sample: { text: '客户资料归档位置待补充', owner: '王项目', due: '2026-10-20' },
      onSave: (d) => {
        p.handover.issues = p.handover.issues.filter((i) => i.id !== item?.id);
        p.handover.issues.push({
          id: item?.id || newId('ISS'),
          text: d['text'],
          owner: d['owner'],
          due: d['due'],
        });
        return this.store.saveHandover(this.id(), p);
      },
    });
  }
  removeIssue(item: Issue): void {
    if (!window.confirm('确定移除该遗留事项吗？')) return;
    const p = structuredClone(this.project()!);
    p.handover.issues = p.handover.issues.filter((i) => i.id !== item.id);
    this.store.saveHandover(this.id(), p);
  }
  receive(result: string): void {
    this.store.ui.open({
      title: result === '已接收' ? '确认收到移交资料' : '退回PM补充资料',
      description: '申请提交和接收确认分别留痕，不自动等于项目正式关闭。',
      fields: [
        {
          key: 'opinion',
          label: result === '已接收' ? '接收说明' : '具体退回原因',
          type: 'textarea',
          required: result !== '已接收',
        },
      ],
      sample: {
        opinion:
          result === '已接收'
            ? '已查看八类资料和遗留事项，确认收到。'
            : '请补充技术资料的归档路径与遗留问题责任人。',
      },
      submitLabel: result === '已接收' ? '确认收到' : '退回补充',
      onSave: (d) => this.store.receive(this.id(), result, d['opinion']),
    });
  }
  planRisk(plan: Plan): PlanRiskResult {
    return planRisk(plan, this.store.observationDate());
  }
  riskClass(level: PlanRiskResult['level']): string {
    return riskClass(level);
  }
  ganttCapable = computed(() => this.planType() === '内部WBS' || this.planType() === '客户主节点');
}
