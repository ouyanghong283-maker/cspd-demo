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
import { ROUGH_PLAN_TEMPLATES } from '../core/rough-plan-templates';
import { personField } from '../core/personnel';
import { BusinessForms } from '../core/forms';
import {
  CustomerRole,
  OpportunityRoughPlan,
  ProductNeed,
  ROLES,
  SalesRecord,
  STAGES,
} from '../core/models';
import { newId } from '../core/seed';
import { productCatalogItem, selectableProducts } from '../core/product-catalog';
import { needsTenderTeam } from '../core/rules';
import { Icon } from '../shared/icon';
import { Badge } from '../shared/badge';
import { Documents } from '../shared/documents';
import { SolutionService } from './solution-service';
import { QuoteWorkspace } from './quote-workspace';
@Component({
  imports: [RouterLink, Icon, Badge, Documents, QuoteWorkspace, SolutionService],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './sales-detail.html',
  styles: `
    .detail-layout {
      display: grid;
      grid-template-columns: minmax(0, 1.8fr) minmax(250px, 1fr);
      gap: 22px;
    }
    .stage-steps {
      display: flex;
      padding: 22px 24px;
      gap: 10px;
      overflow-x: auto;
    }
    .stage-step {
      display: flex;
      gap: 8px;
      align-items: center;
      flex: 1;
      font-size: 10px;
      color: #a1acbe;
      white-space: nowrap;
    }
    .stage-number {
      width: 23px;
      height: 23px;
      border: 1px solid #e0e6ef;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 10px;
    }
    .stage-step.active {
      color: var(--primary);
    }
    .stage-step.active .stage-number {
      color: white;
      background: var(--primary);
      border-color: var(--primary);
    }
    .stage-step.done .stage-number {
      background: #eaf4ef;
      color: #52947a;
      border-color: #dbece3;
    }
    .aside-info {
      padding: 22px;
    }
    .aside-info h3 {
      margin-bottom: 17px;
    }
    .aside-info > div:not(.row-actions) {
      font-size: 12px;
      margin-bottom: 16px;
    }
    .aside-info .label {
      font-size: 10px;
      color: #95a2b6;
      display: block;
      margin-bottom: 5px;
    }
    .team-member {
      padding: 20px 23px;
      display: flex;
      align-items: center;
      gap: 13px;
      border-bottom: 1px solid var(--line);
    }
    .team-member h3 {
      font-size: 12px;
      margin: 0 0 5px;
    }
    .team-member p {
      font-size: 10px;
      margin: 0;
    }
    .stage-note {
      padding: 20px 24px;
      background: #fafbfd;
      border-top: 1px solid var(--line);
    }
    .stage-note h3 {
      font-size: 12px;
      margin: 0 0 8px;
    }
    .stage-note p {
      font-size: 11px;
      line-height: 1.8;
      margin: 0;
    }
    .source-summary {
      padding: 22px;
    }
    .source-summary h3 {
      font-size: 12px;
      margin: 0 0 9px;
    }
    .source-summary p {
      font-size: 11px;
      line-height: 1.8;
      margin-bottom: 12px;
    }
    .gate-missing {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 7px;
      margin: 0 0 16px;
      padding: 12px 14px;
      border: 1px solid #f1a19a;
      border-left: 4px solid #d92d20;
      border-radius: 7px;
      background: #fff8f7;
      color: #9d2018;
      font-size: 12px;
    }
    .gate-missing span {
      display: inline-flex;
      border: 1px solid #d92d20;
      border-radius: 5px;
      background: #fff1f0;
      padding: 4px 7px;
      font-weight: 600;
    }
    @media (max-width: 1000px) {
      .detail-layout {
        grid-template-columns: 1fr;
      }
    }
  `,
})
export class SalesDetail {
  store = inject(DemoStore);
  forms = inject(BusinessForms);
  route = inject(ActivatedRoute);
  router = inject(Router);
  id = toSignal(this.route.paramMap.pipe(map((p) => p.get('id') || '')), { initialValue: '' });
  returnTo = toSignal(
    this.route.queryParamMap.pipe(
      map((params) => {
        const value = params.get('returnTo') || '';
        return /^(?:\/sales\/(?:departments|opportunities)|\/projects\/board)(\?|$)/.test(value) ? value : '';
      }),
    ),
    { initialValue: '' },
  );
  returnLabel = toSignal(this.route.queryParamMap.pipe(map(params => params.get('returnLabel') || '返回部门记录')), {initialValue:'返回部门记录'});
  record = computed(() => this.store.sale(this.id()));
  tab = signal('概览');
  guideMode = signal(false);
  tabs = computed(() =>
    this.record()?.type === 'lead'
      ? ['概览', '沟通', '资料', '历史']
      : [
          '概览',
          '沟通',
          '资料',
          ...(this.store.sale(this.id())?.quoteFlowMode === 'v2' ||
          (this.store.sale(this.id())?.stage && this.store.sale(this.id())?.stage !== '意向沟通')
            ? ['报价']
            : []),
          '方案',
          '服务条件',
          '团队',
          '客户角色',
          '商务补充',
          '历史',
        ],
  );
  stages = STAGES;
  roles = ROLES;
  operationValue(value: unknown): string {
    return typeof value === 'string' ? value : JSON.stringify(value);
  }
  constructor() {
    this.route.queryParamMap.pipe(takeUntilDestroyed()).subscribe((p) => {
      if (p.get('tab')) this.tab.set(p.get('tab')!);
      else if (this.route.snapshot.data['defaultTab'])
        this.tab.set(this.route.snapshot.data['defaultTab']);
      this.guideMode.set(p.get('guide') === 'mainline');
    });
    effect(() => {
      this.id();
      this.tab.set(
        this.route.snapshot.queryParamMap.get('tab') ||
          this.route.snapshot.data['defaultTab'] ||
          '概览',
      );
    });
  }
  needsTeam = () => (this.record() ? needsTenderTeam(this.record()!) : false);
  isSolutionEntry = () => this.route.snapshot.data['defaultTab'] === '方案';
  stageIndex = () => (this.record() ? STAGES.indexOf(this.record()!.stage) : 0);
  editRoughPlan(existing?: OpportunityRoughPlan): void {
    if (!this.store.installRoughPlanTemplates(ROUGH_PLAN_TEMPLATES)) return;
    const item: OpportunityRoughPlan = existing || {
      id: newId('OPP-PLAN'),
      wbsCode: '',
      name: '',
      owner: '王项目',
      start: '2026-10-12',
      end: '2026-10-20',
      predecessor: '',
      relationNote: '',
      note: '',
      weekWindow: '',
      sourceReference: '',
      sourceType: undefined,
      sourceTemplateId: '',
      sourceTemplateTaskId: '',
      sourceDetail: '',
    };
    const planTemplates = this.store.state().roughPlanTemplates || [];
    this.store.ui.open({
      title: existing ? '编辑商机粗计划' : '新增商机粗计划',
      description: '仅记录离线计划模板字段。复制到项目后按独立项目计划维护，不回写商机。',
      fields: [
        { key: 'wbsCode', label: 'WBS编号', value: item.wbsCode || '' },
        { key: 'name', label: '任务名称', required: true, value: item.name },
        personField('owner', '负责人', item.owner, true),
        { key: 'start', label: '计划开始日期', type: 'date', required: true, value: item.start },
        { key: 'end', label: '计划结束日期', type: 'date', required: true, value: item.end },
        {
          key: 'durationDays',
          label: '计划天数',
          type: 'number',
          min: 0,
          value: item.durationDays ?? '',
        },
        { key: 'predecessor', label: '前置任务', value: item.predecessor },
        { key: 'relationNote', label: '关系说明', type: 'textarea', value: item.relationNote },
        { key: 'note', label: '备注', type: 'textarea', value: item.note },
        { key: 'weekWindow', label: '周窗口', value: item.weekWindow },
        {
          key: 'sourceType',
          label: '任务来源',
          type: 'select',
          required: true,
          options: ['自行制定', '参考模板', '客户要求'],
          value: item.sourceType || '',
        },
        {
          key: 'sourceTemplateId',
          label: '关联计划模板（选择“参考模板”时必填）',
          type: 'select',
          requiredWhen: { field: 'sourceType', equals: '参考模板' },
          optionsOnly: true,
          dependsOn: 'sourceType',
          optionsByValue: {
            参考模板: [
              ...planTemplates
                .filter((template) => template.status === '启用')
                .map((template) => ({ value: template.id, label: template.name })),
            ],
          },
          hint: '选择模板后，再选具体任务；任务字段会带入表单，日期和负责人请按当前项目确认。',
          value: item.sourceTemplateId || '',
        },
        {
          key: 'sourceTemplateTaskId',
          label: '模板任务（选择“参考模板”时必填）',
          type: 'select',
          requiredWhen: { field: 'sourceType', equals: '参考模板' },
          optionsOnly: true,
          dependsOn: 'sourceTemplateId',
          optionsByValue: Object.fromEntries(planTemplates.map((template) => [
            template.id,
            template.tasks.map((task) => ({
              value: task.id,
              label: `${task.wbsCode} · ${task.name}${task.referenceOwner ? `（原表负责人：${task.referenceOwner}）` : ''}`,
            })),
          ])),
          populateConfirm: true,
          populateFieldsByValue: Object.fromEntries(planTemplates.flatMap((template) =>
            template.tasks.map((task) => [task.id, {
              wbsCode: task.wbsCode,
              name: task.name,
              durationDays: task.durationDays === undefined ? '' : String(task.durationDays),
              predecessor: task.predecessor,
              relationNote: task.relationNote,
              note: task.note,
            }]),
          )),
          hint: '原表负责人只作参考；WBS、任务、天数、前置和说明可继续修改。',
          value: item.sourceTemplateTaskId || '',
        },
        {
          key: 'sourceDetail',
          label: '来源说明（客户要求时必填）',
          type: 'textarea',
          requiredWhen: { field: 'sourceType', equals: '客户要求' },
          value: item.sourceDetail || (item.sourceType ? '' : item.sourceReference || ''),
        },
      ],
      sample: {
        wbsCode: '1.1',
        name: 'OA订单启动（创建成品料号） Order Launch (Create Part No.)',
        owner: '王项目',
        start: '2026-10-12',
        end: '2026-10-20',
        durationDays: 3,
        relationNote: '需求评审',
        sourceType: '参考模板',
        sourceTemplateId: 'DEMO-RPT-STANDARD',
        sourceTemplateTaskId: 'DEMO-RPT-STANDARD-1-1',
      },
      onSave: (data) =>
        this.store.saveOpportunityRoughPlan(this.id(), {
          ...item,
          wbsCode: data['wbsCode'],
          name: data['name'],
          owner: data['owner'],
          start: data['start'],
          end: data['end'],
          durationDays: data['durationDays']?.trim() ? Number(data['durationDays']) : undefined,
          predecessor: data['predecessor'],
          relationNote: data['relationNote'],
          note: data['note'],
          weekWindow: data['weekWindow'],
          sourceType: data['sourceType'] as OpportunityRoughPlan['sourceType'],
          sourceTemplateId: data['sourceTemplateId'],
          sourceTemplateTaskId: data['sourceTemplateTaskId'],
          sourceDetail: data['sourceDetail'],
          sourceReference: data['sourceType'] === '参考模板'
            ? `计划模板：${planTemplates.find((template) => template.id === data['sourceTemplateId'])?.name || ''} · ${planTemplates.find((template) => template.id === data['sourceTemplateId'])?.tasks.find((task) => task.id === data['sourceTemplateTaskId'])?.wbsCode || ''} ${planTemplates.find((template) => template.id === data['sourceTemplateId'])?.tasks.find((task) => task.id === data['sourceTemplateTaskId'])?.name || ''}`
            : data['sourceType'] === '客户要求'
              ? `客户要求：${data['sourceDetail']}`
              : `自行制定${data['sourceDetail'] ? `：${data['sourceDetail']}` : ''}`,
        }),
    });
  }
  confirmCount = () => this.record()?.team.filter((t) => t.confirmed).length || 0;
  nextAction(): string {
    const s = this.record();
    if (!s) return '';
    if (s.type === 'lead')
      return this.store.has(s.id, '需求导入表') ? '完善联系人后转商机' : '上传需求导入表，转商机';
    if (s.stage === '赢单') return '加载演示合同，交接项目给PM';
    if (s.stage === '丢单') return '商机已关闭，可在看板查看原因';
    if (s.quoteFlowMode === 'v2' && s.stage === '方案报价') {
      if (!this.store.solution(s.id)?.latestVersionId) return '由解决方案交付核心技术方案首版';
      const next = this.store.solutionNextStep(s.id);
      if (next.missing.length) return next.label;
      const series = this.store.quoteSeries(s.id);
      return series
        ? `报价下一步：${series.versions.at(-1)?.status || '查看报价'}`
        : '进入报价工作区，创建报价V1草稿';
    }
    if (s.quoteFlowMode === 'v2' && s.stage === '洽谈')
      return this.store.quoteSeries(s.id)?.activeFinalVersionId
        ? '记录当前客户沟通并准备合同谈判'
        : '完成报价客户确认并锁定最终版本';
    if (this.needsTeam() && s.team.some((t) => !t.confirmed))
      return '由负责人指定团队，成员确认参与';
    return s.stage === '意向沟通'
      ? '补齐商机信息，再进入方案报价'
      : '保存本轮客户沟通，再完成当前阶段';
  }
  leadMissing(): string[] {
    const s = this.record();
    if (!s || s.type !== 'lead') return [];
    const c = this.store.contact(s);
    return [
      !this.store.has(s.id, '需求导入表') ? '需求导入表' : '',
      !c?.name ? '主要联系人' : '',
      !(c?.email || c?.phone) ? '联系人联系方式' : '',
    ].filter(Boolean);
  }
  possibleLeadMatches(): SalesRecord[] {
    const lead = this.record();
    if (!lead || lead.type !== 'lead' || lead.convertedTo) return [];
    const project = this.normalizedMatchText(lead.projectName);
    return this.store.leads().filter((candidate) => {
      if (candidate.id === lead.id || candidate.convertedTo) return false;
      const sameCustomer = candidate.customerId === lead.customerId;
      const candidateProject = this.normalizedMatchText(candidate.projectName);
      const sameProject =
        !!project &&
        (!candidateProject ||
          project === candidateProject ||
          (Math.min(project.length, candidateProject.length) >= 4 &&
            (project.includes(candidateProject) || candidateProject.includes(project))));
      return sameCustomer || sameProject;
    });
  }
  leadMatchBasis(candidate: SalesRecord): string {
    const current = this.record();
    const sameCustomer = current?.customerId === candidate.customerId;
    const sameProject =
      current?.projectName &&
      this.normalizedMatchText(current.projectName) ===
        this.normalizedMatchText(candidate.projectName);
    if (sameCustomer && sameProject) return '客户ID相同、项目名称相同';
    if (sameCustomer) return '客户ID相同、项目名称待核对';
    return '项目名称相近、客户ID不同，请核对客户及归属';
  }
  private normalizedMatchText(value: string): string {
    return value
      .trim()
      .toLocaleLowerCase()
      .replace(/[\s\p{P}\p{S}]/gu, '');
  }
  assignPM(sale: SalesRecord): void {
    const candidates = ROLES.filter((role) => role.id === 'pm');
    this.store.ui.open({
      title: 'PMO手动指定PM',
      description: '模拟人员和排期窗口由PMO手动选择；不自动匹配、不锁定或承诺真实资源。',
      fields: [
        {
          key: 'pmId',
          label: '模拟PM名单',
          type: 'select',
          required: true,
          options: candidates.map((candidate) => ({
            value: candidate.id,
            label: candidate.person,
          })),
          value: sale.pmoAssignment?.pmId || candidates[0]?.id || '',
        },
        {
          key: 'window',
          label: '模拟排期窗口',
          required: true,
          value: sale.pmoAssignment?.window || '2026-10-20 至 2026-11-15（模拟）',
        },
      ],
      onSave: (data) => {
        const selected = candidates.find((candidate) => candidate.id === data['pmId']);
        return selected
          ? this.store.assignOpportunityPM(sale.id, selected.id, selected.person, data['window'])
          : this.store.ui.fail('请选择模拟PM名单中的人员');
      },
    });
  }
  completeDepartmentTask(sale: SalesRecord, taskId: string): void {
    this.store.completeDepartmentTask(sale.id, taskId);
  }
  locateLeadItem(item: string): void {
    if (item === '需求导入表') this.tab.set('资料');
    else this.forms.editSales(this.record()!);
  }
  returnToDepartmentRecords(): void {
    const target = this.returnTo();
    if (target) void this.router.navigateByUrl(target);
    else void this.router.navigate(['/sales/departments']);
  }
  convert(): void {
    const id = this.store.convert(this.id());
    if (id) {
      this.tab.set('概览');
      this.router.navigate(['/sales/detail', id], {
        queryParams: this.guideMode() ? { tab: '概览', guide: 'mainline' } : undefined,
      });
    }
  }
  convertCustomer(): void {
    const id = this.store.convertToCustomer(this.id());
    if (id)
      this.router.navigate(['/sales/customers'], {
        queryParams: { customer: id, fromLead: this.id() },
      });
  }
  editProductNeed(existing?: ProductNeed): void {
    const sale = this.record();
    if (!sale || sale.type !== 'opportunity') return;
    const catalogOptions = selectableProducts().map((item) => ({
      value: item.code,
      label: `${item.code} · ${item.name}（${item.type}）`,
    }));
    const existingItem = existing ? productCatalogItem(existing.model) : undefined;
    if (existing && (!existingItem || existingItem.status !== '上架'))
      catalogOptions.push({
        value: existing.model,
        label: `${existing.model}（${existingItem ? '已下架' : '目录外历史编码'}）`,
      });
    this.store.ui.open({
      title: existing ? '编辑产品需求' : '新增产品需求',
      description:
        '产品编码从产品目录（模拟数据，结构按非标CRM产品管理表口径）选择，仅列出上架产品，自动带出产品名称；行ID用于稳定关联，编码、数量或单位变化都会使旧技术初判过期。',
      fields: [
        {
          key: 'model',
          label: '产品编码',
          type: 'select',
          required: true,
          options: catalogOptions,
          value: existing?.model || '',
          hint: '选择后自动带出产品名称；下架产品不可选',
        },
        {
          key: 'quantity',
          label: '数量',
          type: 'number',
          required: true,
          min: 1,
          value: existing?.quantity || 1,
        },
        {
          key: 'unit',
          label: '单位',
          required: true,
          value: existing?.unit || '台',
          hint: '非标CRM产品主数据不含单位，按行手工填写',
        },
      ],
      onSave: (data) => {
        const item = productCatalogItem(data['model'].trim());
        return this.store.saveProductNeed(sale.id, {
          id: existing?.id || newId('NEED'),
          model: data['model'].trim(),
          name: item?.name || (existing?.model === data['model'].trim() ? existing?.name : ''),
          quantity: Number(data['quantity']),
          unit: data['unit'].trim(),
        });
      },
    });
  }
  assessTechnical(): void {
    const sale = this.record();
    if (!sale || sale.type !== 'opportunity') return;
    if (!this.store.ensureTechnicalDemoFiles(sale.id)) return;
    const evidence = this.store.quoteSourceCandidates(sale.id);
    const evidenceKinds = ['需求导入表', '核心技术方案', 'BOM清单', '单线图（SLD）', '衰减曲线'];
    this.store.ui.open({
      title: '记录技术初判',
      description:
        '结论绑定当前需求修订和适用证据。满足结论需引用Technical Proposal、BOM、SLD和衰减资料；资料待补时选择“待补资料”。',
      fields: [
        personField(
          'owner',
          '初判负责人',
          this.store.person() === '周方案' || this.store.person() === '王项目'
            ? this.store.person()
            : '周方案',
          true,
          ['周方案', '王项目'],
        ),
        {
          key: 'result',
          label: '初判结论',
          type: 'select',
          required: true,
          options: ['满足', '不满足', '待补资料'],
          value: '待补资料',
        },
        ...evidenceKinds.map((kind) => ({
          key: `evidence-${kind}`,
          label: `${kind}证据引用`,
          type: 'select' as const,
          required: ['BOM清单', '单线图（SLD）', '衰减曲线'].includes(kind),
          group: ['BOM清单', '单线图（SLD）', '衰减曲线'].includes(kind) ? 'proposal' : undefined,
          options: [
            { value: '', label: '待补充 / 不引用' },
            ...evidence
              .filter((item) => item.kind === kind)
              .map((item) => ({ value: item.id, label: `${item.kind} · ${item.name}` })),
          ],
          value: '',
        })),
        { key: 'opinion', label: '结论说明', type: 'textarea', required: true, value: '' },
      ],
      onSave: (data) =>
        this.store.saveTechnicalAssessment(sale.id, {
          owner: data['owner'],
          result: data['result'] as '满足' | '不满足' | '待补资料',
          evidenceAttachmentIds: evidenceKinds
            .map((kind) => data[`evidence-${kind}`])
            .filter((id) => !!id),
          opinion: data['opinion'],
        }),
    });
  }
  confirmCustomerCountryChange(): void {
    this.store.confirmCustomerCountryChange(this.id());
  }
  createOpportunityAfterAssessment(): void {
    const id = this.store.createOpportunityAfterAssessment(this.id());
    if (id) this.router.navigate(['/sales/detail', id]);
  }
  bridge(): void {
    const id = this.store.bridge(this.id());
    if (id)
      this.router.navigate(['/projects', id], {
        queryParams: this.guideMode() ? { tab: '概览', guide: 'mainline' } : undefined,
      });
  }
  associateDraft(): void {
    const opportunity = this.record();
    if (!opportunity) return;
    const drafts = this.store.state().projects.filter((p) => !p.opportunityId && !p.contractId);
    if (!drafts.length) {
      this.store.ui.fail('当前没有待关联的项目草稿，请先到项目工作创建项目号');
      return;
    }
    this.store.ui.open({
      title: '关联已有项目草稿',
      description: '项目号保持不变；赢单后再加载合同/G3模拟来源。',
      submitLabel: '确认关联',
      fields: [
        {
          key: 'project',
          label: '项目草稿',
          type: 'select',
          options: drafts.map((p) => `${p.id} · ${p.name}`),
          required: true,
        },
      ],
      onSave: (d) => {
        const id = String(d['project']).split(' · ')[0];
        const ok = this.store.associateProject(id, opportunity.id);
        if (ok) this.router.navigate(['/projects', id]);
        return ok;
      },
    });
  }
  archive(status: string): void {
    this.store.ui.open({
      title: status === '待跟进' ? '恢复跟进' : '调整线索状态',
      fields: [
        {
          key: 'status',
          label: '处理方式',
          type: 'select',
          options: ['已归档', '暂缓跟进', '待跟进'],
          value: status,
          required: true,
        },
        {
          key: 'reason',
          label: '原因',
          type: 'textarea',
          hint: '原因选项尚未按CRM/CSPD标准核实；请先用文字记录，不使用未核验枚举。',
          required: status !== '待跟进',
          value: '',
        },
      ],
      onSave: (d) => this.store.archive(this.id(), d['status'], d['reason']),
    });
  }
  editRole(item?: CustomerRole): void {
    const c = this.store.customer(this.record()!.customerId)!;
    this.store.ui.open({
      title: item ? '编辑客户角色' : '补充客户角色',
      description: '在后续阶段逐步补充，不要求所有角色齐全。',
      fields: [
        {
          key: 'contact',
          label: '联系人',
          type: 'select',
          options: c.contacts.map((x) => x.name),
          value: item?.contact || c.contacts[0]?.name,
          required: true,
        },
        {
          key: 'role',
          label: '客户角色',
          type: 'select',
          options: ['决策人', '影响人', '使用人', '把关人'],
          value: item?.role || '把关人',
          required: true,
        },
        {
          key: 'attitude',
          label: '态度',
          type: 'select',
          options: ['支持', '中立', '待了解', '有疑虑'],
          value: item?.attitude || '待了解',
        },
        { key: 'impact', label: '影响说明', type: 'textarea', value: item?.impact || '' },
      ],
      sample: {
        role: '把关人',
        attitude: '支持',
        impact: '负责采购资料审核，客户内部流程仍待了解',
      },
      onSave: (d) =>
        this.store.saveCustomerRole(this.id(), {
          id: item?.id || newId('CR'),
          contact: d['contact'],
          role: d['role'],
          attitude: d['attitude'],
          impact: d['impact'],
        }),
    });
  }
  removeRole(item: CustomerRole): void {
    if (window.confirm('确定删除该客户角色记录吗？'))
      this.store.saveCustomerRole(this.id(), item, true);
  }
  opinion(): void {
    const s = this.record()!;
    this.store.ui.open({
      title: '售前交付初判',
      description: '可记录待确认事项，不自动计算资源负载。',
      fields: [
        {
          key: 'opinion',
          label: '交付可行性 / 差旅 / 当地分包 / 风险',
          type: 'textarea',
          required: true,
          value: s.deliveryOpinion,
        },
        { key: 'window', label: '工期与资源窗口', value: s.resourceWindow },
      ],
      sample: {
        opinion: '具备初步交付条件，当地分包与现场进场条件待确认。',
        window: '生产45工作日，预计11月中旬进场（演示）',
      },
      onSave: (d) => {
        const record = {
          ...structuredClone(s),
          deliveryOpinion: d['opinion'],
          resourceWindow: d['window'],
        };
        return this.store.saveDeliveryOpinion(record);
      },
    });
  }
  tax(): void {
    const s = this.record()!;
    this.store.ui.open({
      title: '商务补充与财务待确认事项',
      description: '固定案例仅展示业务位置，不提供真实税率、税额或自动合规结论。',
      fields: [
        {
          key: 'taxCase',
          label: '演示交易案例',
          type: 'select',
          options: ['本地交易案例', '跨境交易案例', '其他待确认'],
          value: s.taxCase || '本地交易案例',
        },
        {
          key: 'tradeTerm',
          label: '贸易条款',
          type: 'select',
          options: ['FOB', 'CIF', '其他'],
          value: s.tradeTerm || 'FOB',
        },
        { key: 'taxNote', label: '需要财务确认的问题', type: 'textarea', value: s.taxNote },
      ],
      sample: {
        taxCase: '跨境交易案例',
        tradeTerm: 'CIF',
        taxNote: '请财务确认交易主体、运费及开票口径；清关方案变化需重新确认。',
      },
      onSave: (d) =>
        this.store.saveSales({
          ...structuredClone(s),
          taxCase: d['taxCase'],
          tradeTerm: d['tradeTerm'],
          taxNote: d['taxNote'],
          taxConfirmed: false,
        }, undefined, '商务补充'),
    });
  }
}
