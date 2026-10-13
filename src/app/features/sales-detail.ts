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
import { CustomerRole, ROLES, SalesRecord, STAGES } from '../core/models';
import { newId } from '../core/seed';
import { needsTenderTeam } from '../core/rules';
import { Icon } from '../shared/icon';
import { Badge } from '../shared/badge';
import { Documents } from '../shared/documents';
import { QuoteWorkspace } from './quote-workspace';
import { MainlineGuide } from './mainline-guide';
@Component({
  imports: [RouterLink, Icon, Badge, Documents, QuoteWorkspace, MainlineGuide],
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
  record = computed(() => this.store.sale(this.id()));
  tab = signal('概览');
  guideMode = signal(false);
  tabs = computed(() =>
    this.record()?.type === 'lead'
      ? ['概览', '沟通', '资料', '历史']
      : ['概览', '沟通', '资料', ...(this.store.sale(this.id())?.quoteFlowMode === 'v2' || (this.store.sale(this.id())?.stage && this.store.sale(this.id())?.stage !== '意向沟通') ? ['报价'] : []), '团队', '客户角色', '商务补充', '历史'],
  );
  stages = STAGES;
  roles = ROLES;
  constructor() {
    this.route.queryParamMap.pipe(takeUntilDestroyed()).subscribe((p) => {
      if (p.get('tab')) this.tab.set(p.get('tab')!);
      this.guideMode.set(p.get('guide') === 'mainline');
    });
    effect(() => {
      this.id();
      this.tab.set(this.route.snapshot.queryParamMap.get('tab') || '概览');
    });
  }
  needsTeam = () => (this.record() ? needsTenderTeam(this.record()!) : false);
  stageIndex = () => (this.record() ? STAGES.indexOf(this.record()!.stage) : 0);
  confirmCount = () => this.record()?.team.filter((t) => t.confirmed).length || 0;
  nextAction(): string {
    const s = this.record();
    if (!s) return '';
    if (s.type === 'lead')
      return this.store.has(s.id, '需求导入表') ? '完善联系人后转商机' : '上传需求导入表，转商机';
    if (s.stage === '赢单') return '加载演示合同，交接项目给PM';
    if (s.stage === '丢单') return '商机已关闭，可在看板查看原因';
    if (s.quoteFlowMode === 'v2' && s.stage === '方案报价') {
      const series = this.store.quoteSeries(s.id);
      return series ? `报价下一步：${series.versions.at(-1)?.status || '查看报价'}` : '进入报价工作区，创建报价V1草稿';
    }
    if (s.quoteFlowMode === 'v2' && s.stage === '洽谈') return this.store.quoteSeries(s.id)?.activeFinalVersionId ? '记录当前客户沟通并准备合同谈判' : '完成报价客户确认并锁定最终版本';
    if (this.needsTeam() && s.team.some((t) => !t.confirmed))
      return '由负责人指定团队，成员确认参与';
    return s.stage === '意向沟通'
      ? '补齐商机信息，再进入方案报价'
      : '保存本轮客户沟通，再完成当前阶段';
  }
  leadMissing(): string[] {
    const s = this.record(); if (!s || s.type !== 'lead') return [];
    const c = this.store.contact(s);
    return [!this.store.has(s.id, '需求导入表') ? '需求导入表' : '', !c?.name ? '主要联系人' : '', !(c?.email || c?.phone) ? '联系人联系方式' : '', !s.owner ? '销售负责人' : ''].filter(Boolean);
  }
  locateLeadItem(item: string): void {
    if (item === '需求导入表') this.tab.set('资料'); else this.forms.editSales(this.record()!);
  }
  convert(): void {
    const id = this.store.convert(this.id());
    if (id) {
      this.tab.set('概览');
      this.router.navigate(['/sales/detail', id], { queryParams: this.guideMode() ? { tab: '概览', guide: 'mainline' } : undefined });
    }
  }
  bridge(): void {
    const id = this.store.bridge(this.id());
    if (id) this.router.navigate(['/projects', id], { queryParams: this.guideMode() ? { tab: '概览', guide: 'mainline' } : undefined });
  }
  associateDraft(): void {
    const opportunity = this.record(); if (!opportunity) return;
    const drafts = this.store.state().projects.filter((p) => !p.opportunityId && !p.contractId);
    if (!drafts.length) { this.store.ui.fail('当前没有待关联的项目草稿，请先到项目工作创建项目号'); return; }
    this.store.ui.open({ title: '关联已有项目草稿', description: '项目号保持不变；赢单后再加载合同/G3模拟来源。', submitLabel: '确认关联', fields: [{ key: 'project', label: '项目草稿', type: 'select', options: drafts.map((p) => `${p.id} · ${p.name}`), required: true }], onSave: (d) => { const id = String(d['project']).split(' · ')[0]; const ok = this.store.associateProject(id, opportunity.id); if (ok) this.router.navigate(['/projects', id]); return ok; } });
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
          type: 'select',
          options: ['重复', '虚假', '无预算', '客户暂缓', '重新跟进'],
          required: status !== '待跟进',
          value: status === '待跟进' ? '重新跟进' : '',
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
  g1(): void {
    this.store.ui.open({
      title: '查看G1模拟结果',
      description: '模拟展示审批意见，不触发正式审批或资源批准。',
      fields: [
        {
          key: 'result',
          label: '模拟结果',
          type: 'select',
          options: ['通过', '挂起', '降级'],
          value: '通过',
          required: true,
        },
        {
          key: 'opinion',
          label: '处理意见',
          type: 'textarea',
          value: '演示资料已齐备，继续推进。',
        },
      ],
      onSave: (d) => this.store.g1(this.id(), d['result'], d['opinion']),
    });
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
        if (this.store.role() !== 'pm') return this.store.ui.fail('请切换项目经理记录初判');
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
        }),
    });
  }
}
