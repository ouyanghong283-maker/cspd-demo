import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { toSignal, takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { map } from 'rxjs';
import { DemoStore } from '../core/store';
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
  ReviewCondition,
} from '../core/models';
import { blankPlan, makePlans, newId } from '../core/seed';
import { Icon } from '../shared/icon';
import { Badge } from '../shared/badge';
import { Documents } from '../shared/documents';
import { MainlineGuide } from './mainline-guide';
@Component({
  imports: [RouterLink, Icon, Badge, Documents, MainlineGuide],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './project-detail.html',
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
    .gantt {
      overflow-x: auto;
      padding: 22px 24px;
    }
    .gantt-row {
      display: flex;
      align-items: center;
      gap: 16px;
      margin-bottom: 12px;
      font-size: 11px;
      min-width: 600px;
    }
    .gantt-label {
      width: 135px;
      flex-shrink: 0;
      color: #667996;
    }
    .gantt-range {
      height: 20px;
      background: repeating-linear-gradient(
        to right,
        #f4f7fc 0,
        #f4f7fc calc(16.66% - 1px),
        #e5eaf3 calc(16.66% - 1px),
        #e5eaf3 16.66%
      );
      flex: 1;
      position: relative;
      border-radius: 3px;
    }
    .gantt-range span {
      position: absolute;
      height: 16px;
      top: 2px;
      background: #7597e7;
      border-radius: 3px;
      min-width: 8px;
    }
    .gantt-end {
      font-size: 10px;
      color: #9ba7ba;
      width: 66px;
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
  store = inject(DemoStore);
  forms = inject(BusinessForms);
  route = inject(ActivatedRoute);
  router = inject(Router);
  id = toSignal(this.route.paramMap.pipe(map((p) => p.get('id') || '')), { initialValue: '' });
  project = computed(() => this.store.project(this.id()));
  tab = signal('概览');
  guideMode = signal(false);
  tabs = ['概览', '团队', '启动交底', '计划执行', '验收', '移交', '资料历史'];
  planTypes = PLAN_TYPES;
  planType = signal<PlanType>('内部WBS');
  planView = signal('table');
  preview = signal('');
  plans = computed(() => this.project()?.plans.filter((p) => p.type === this.planType()) || []);
  contract = computed(() =>
    this.store.state().contracts.find((c) => c.id === this.project()?.contractId),
  );
  siblings = computed(() =>
    this.store.state().projects.filter((p) => p.contractId === this.project()?.contractId),
  );
  contactName(p: Project): string {
    return this.store.customer(p.customerId)?.contacts.find((c) => c.id === p.contactId)?.name || '待确认';
  }
  associateOpportunity(project: Project): void {
    const opportunities = this.store.opportunities().filter((o) => o.stage !== '丢单');
    this.store.ui.open({
      title: '关联来源商机', description: '确认后保留当前项目号，带入客户、联系人和来源团队。', submitLabel: '确认关联',
      fields: [{ key: 'opportunity', label: '商机', type: 'select', options: opportunities.map((o) => `${o.id} · ${o.projectName} · ${o.stage}`), required: true }],
      onSave: (d) => this.store.associateProject(project.id, String(d['opportunity']).split(' · ')[0]),
    });
  }
  locateBriefingItem(item: string, project: Project): void {
    if (item === '启动纪要' || item === '启动文件') this.tab.set('启动交底');
    else this.forms.project(project);
  }
  fatDate(p: Project): string {
    const fat = p.plans.find((plan) => plan.type === 'FAT测试');
    return fat?.expected || fat?.end || '待补充';
  }
  linkedMilestone(plan: Plan, project: Project): Plan | undefined {
    return project.plans.find((candidate) => candidate.type === '客户主节点' && candidate.name === plan.linked);
  }
  milestoneDifference(plan: Plan, project: Project): string {
    const linked = this.linkedMilestone(plan, project);
    if (!linked?.end || !plan.expected) return '日期待补';
    const days = Math.round((Date.parse(plan.expected) - Date.parse(linked.end)) / 86400000);
    return `${days > 0 ? '+' : ''}${days}天`;
  }
  constructor() {
    this.route.queryParamMap.pipe(takeUntilDestroyed()).subscribe((p) => {
      if (p.get('tab')) this.tab.set(p.get('tab')!);
      this.guideMode.set(p.get('guide') === 'mainline');
      if (PLAN_TYPES.includes(p.get('plan') as PlanType))
        this.planType.set(p.get('plan') as PlanType);
    });
    effect(() => {
      this.id();
      this.tab.set(this.route.snapshot.queryParamMap.get('tab') || '概览');
    });
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
        {
          key: 'pm',
          label: '拟任PM',
          type: 'select',
          options: ['王项目'],
          value: '王项目',
          required: true,
        },
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
      this.store.ui.fail('当前角色不可修改该计划；来源数据始终只读');
      return;
    }
    const member = this.store.role() === 'member';
    const fields: Field[] = [
      { key: 'name', label: '节点 / 任务名称', required: true, value: p.name },
      {
        key: 'owner',
        label: '责任人',
        type: 'select',
        options: member ? [p.owner] : ['王项目', '刘工程师', '张销售', '陈物控', '夏质量'],
        value: p.owner,
        required: true,
      },
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
        value: p.expected,
      },
      {
        key: 'actual',
        label: p.type === '要货发货' ? '实际发运 / 到货日期' : '实际完成日期',
        type: 'date',
        value: p.actual,
      },
      {
        key: 'status',
        label: '执行状态',
        type: 'select',
        options: ['未开始', '进行中', '已完成', '需复核'],
        value: p.status,
      },
      { key: 'note', label: '变更说明 / 业务备注', type: 'textarea', value: p.note },
    ];
    if (['内部WBS', '要货发货', 'FAT测试'].includes(p.type))
      fields.push(
        { key: 'product', label: '产品', value: p.product },
        { key: 'quantity', label: '数量', type: 'number', min: 1, value: p.quantity },
        { key: 'batch', label: '批次', value: p.batch },
        {
          key: 'linked',
          label: '关联客户主节点',
          type: 'select',
          options: this.project()!
            .plans.filter((p) => p.type === '客户主节点')
            .map((p) => p.name),
          value: p.linked,
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
      fields.push({
        key: 'receiver',
        label: '接收备件专员',
        type: 'select',
        options: ['郑备件'],
        value: p.receiver,
      });
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
      description: '计划日期、预计日期和实际日期分别保存；关键节点另检查凭据。',
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
      onSave: (d) =>
        this.store.savePlan(this.id(), {
          ...p,
          name: d['name'],
          owner: d['owner'],
          start: d['start'],
          end: d['end'],
          expected: d['expected'],
          actual: d['actual'],
          status: d['status'],
          note: d['note'],
          product: d['product'] ?? p.product,
          quantity: d['quantity'] ? Number(d['quantity']) : p.quantity,
          batch: d['batch'] ?? p.batch,
          linked: d['linked'] ?? p.linked,
          result: d['result'] ?? p.result,
          receiver: d['receiver'] ?? p.receiver,
          amount: d['amount'] ? Number(d['amount']) : p.amount,
          currency: d['currency'] ?? p.currency,
        }),
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
        { key: 'signer', label: '签认人', value: item.signer },
        { key: 'date', label: '签认日期', type: 'date', value: item.date },
        { key: 'note', label: '说明 / 遗留问题', type: 'textarea', value: item.note },
      ],
      sample: { result: '通过', signer: '陈客户', date: BASE_DATE, note: '已按样例清单确认' },
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
      fields: [
        {
          key: 'receiver',
          label: '接收人',
          type: 'select',
          options: ['吴运维'],
          value: p.handover.receiver,
          required: true,
        },
      ],
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
        {
          key: 'owner',
          label: '责任人',
          type: 'select',
          options: ['王项目', '周方案', '吴运维'],
          required: true,
          value: item?.owner || '王项目',
        },
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
  ganttLeft(p: Plan): number {
    return Math.max(
      0,
      Math.min(90, ((Date.parse(p.start) - Date.parse('2026-10-01')) / 86400000 / 61) * 100),
    );
  }
  ganttWidth(p: Plan): number {
    return Math.max(
      2,
      Math.min(
        100 - this.ganttLeft(p),
        ((Date.parse(p.end) - Date.parse(p.start)) / 86400000 / 61) * 100,
      ),
    );
  }
}
