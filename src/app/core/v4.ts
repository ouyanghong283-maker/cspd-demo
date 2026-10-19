import { BASE_DATE, DemoState, FinanceInvoice, FinanceSnapshot } from './models';
import { migrateContractInvoices } from './invoices';
import { migrateSalesOrders } from './orders';
import { DEMO_IDENTITY_BINDINGS, identityForLegacyPlatformName } from './identity';
import {
  completionKind,
  initializeProjectReview,
  setProjectReview,
  syncProjectCompletion,
} from './project-review';
import { startupContentLabel } from './project-startup';

export const V4_SCHEMA_VERSION = 6;

/** Migration never infers confirmations or solution versions from legacy attachments. */
export function migrateV4(state: DemoState): DemoState {
  for (const key of [
    'quoteSeries',
    'solutionSeries',
    'solutionDocuments',
    'serviceTerms',
    'serviceAgreements',
    'financeSnapshots',
    'creditPolicies',
    'projectMilestoneBindings',
    'milestoneSyncRecords',
    'milestoneWarnings',
    'finalActualCosts',
  ] as const)
    if (state[key] !== undefined && !Array.isArray(state[key]))
      throw new Error(`存储集合${key}损坏`);
  if (state.invoiceReceiptClaims !== undefined && !Array.isArray(state.invoiceReceiptClaims))
    throw new Error('存储集合invoiceReceiptClaims损坏');
  state.v4SchemaVersion = V4_SCHEMA_VERSION;
  if (state.roughPlanTemplates !== undefined && !Array.isArray(state.roughPlanTemplates))
    throw new Error('存储集合roughPlanTemplates损坏');
  state.roughPlanTemplates ||= [
    { id: 'DEMO-RPT-STANDARD', name: '项目交期计算模板（CIF）', description: 'CIF 交付场景任务清单。', sourceFile: '项目交期计算模板.xlsx', status: '启用', tasks: [] },
    { id: 'DEMO-RPT-TENDER', name: '项目交期计算模板（DDP）', description: 'DDP 交付场景任务清单。', sourceFile: '项目交期计算模板.xlsx', status: '启用', tasks: [] },
  ];
  state.quoteSeries ||= [];
  if ((state.storageSchemaVersion ?? 0) < 3) {
    state.solutionSeries ||= [];
    state.solutionDocuments ||= [];
  }
  state.serviceTerms ||= [];
  state.serviceAgreements ||= [];
  state.financeSnapshots ||= [];
  state.creditPolicies ||= [];
  state.projectMilestoneBindings ||= [];
  state.milestoneSyncRecords ||= [];
  state.milestoneWarnings ||= [];
  state.finalActualCosts ||= [];
  migrateContractInvoices(state);
  migrateSalesOrders(state);
  state.invoiceSchemaVersion = 1;
  state.orderSchemaVersion = 1;
  for (const contract of state.contracts) {
    // V8草稿人工条款及显式选择/签约采用依据受保护；旧兼容修复只处理旧登记。
    if (
      contract.status === '草稿' ||
      contract.quoteReferenceSnapshot ||
      contract.adoptedQuoteSnapshot
    ) continue;
    const series = state.quoteSeries.find((item) => item.opportunityId === contract.opportunityId);
    const quote = series?.versions.find((version) => version.id === contract.quoteVersionId);
    if (
      quote?.status === '最终锁定' &&
      quote.customerId === contract.customerId &&
      quote.payment &&
      (!contract.quoteSeriesId || contract.quoteSeriesId === series!.id) &&
      contract.payment !== quote.payment
    ) {
      recordCompatibilityRepair(
        state,
        `compatibility-payment-${contract.id}-${quote.id}`,
        contract.id,
        `兼容修正合同付款条件：原条款${contract.payment}；按锁定报价${quote.id}引用${quote.payment}`,
      );
      contract.payment = quote.payment;
    }
  }
  for (const project of state.projects || []) {
    initializeProjectReview(project);
    for (const reason of ['sat', 'acceptance'] as const) {
      const complete = reason === 'sat' ? project.sat.complete : project.acceptanceComplete;
      if (
        !complete &&
        project.plans.some((plan) => completionKind(plan) === reason && plan.status === '已完成')
      )
        setProjectReview(project, reason, true);
    }
    if (
      project.reviewReasons!.some((reason) => reason !== 'handover') &&
      ['待接收', '已接收'].includes(project.handover.status)
    ) {
      recordCompatibilityRepair(
        state,
        `compatibility-review-${project.id}-v6`,
        project.id,
        `兼容复核前移交记录：${JSON.stringify(project.handover)}；相关关键结果已变化，需重新确认`,
      );
      project.handover.status = '待复核';
      project.handover.opinion = '旧记录的关键结果已变化，请重新复核并提交；原接收意见保留在历史';
      project.status = '移交待复核';
      setProjectReview(project, 'handover', true);
      for (const notice of state.notices.filter((n) => n.key === `handover-${project.id}`))
        notice.resolved = true;
    }
    syncProjectCompletion(project);
    for (const plan of project.plans || []) {
      if (!['内部WBS', '要货发货', 'FAT测试'].includes(plan.type)) continue;
      if (!plan.customerMilestoneId && plan.linked) {
        const matches = project.plans.filter(
          (candidate) => candidate.type === '客户主节点' && candidate.name === plan.linked,
        );
        if (matches.length === 1) plan.customerMilestoneId = matches[0].id;
      }
      if (!plan.customerMilestoneId) continue;
      const customerMilestone = project.plans.find(
        (candidate) => candidate.type === '客户主节点' && candidate.id === plan.customerMilestoneId,
      );
      if (!customerMilestone) continue;
      plan.linked = customerMilestone.name;
      if (
        !state.projectMilestoneBindings.some(
          (binding) =>
            binding.projectId === project.id &&
            binding.sourcePlanId === plan.id &&
            binding.customerMilestoneId === customerMilestone.id,
        )
      )
        state.projectMilestoneBindings.push({
          projectId: project.id,
          sourcePlanId: plan.id,
          customerMilestoneId: customerMilestone.id,
        });
    }
  }
  for (const series of state.quoteSeries)
    for (const version of series.versions) version.contentRevision ??= 0;
  for (const sale of state.sales || []) {
    // Migrate only platform-owned legacy identity fields through the explicit
    // demo roster. Unknown names stay readable but do not become authorization.
    const owner = identityForLegacyPlatformName(sale.owner);
    const operator = identityForLegacyPlatformName(sale.operator);
    const editor = identityForLegacyPlatformName(sale.lastEditor || '');
    if (!sale.ownerPersonId && owner) sale.ownerPersonId = owner.personId;
    if (!sale.operatorPersonId && operator) sale.operatorPersonId = operator.personId;
    if (!sale.lastEditorPersonId && editor) sale.lastEditorPersonId = editor.personId;
    if (sale.type !== 'lead') continue;
    if (!sale.followUpStatus) {
      if (['待跟进', '跟进中', '草稿'].includes(sale.status)) sale.followUpStatus = '跟进中';
      else if (sale.status === '暂缓跟进' || sale.status === '已归档')
        sale.followUpStatus = sale.status;
    }
    if (!sale.crmStatus) {
      const convertedOpportunity = state.sales.find(
        (candidate) => candidate.type === 'opportunity' && candidate.leadId === sale.id,
      );
      if (sale.convertedTo && convertedOpportunity?.id === sale.convertedTo)
        sale.crmStatus = '已转商机';
      else if (
        sale.convertedTo ||
        sale.status === '已转商机' ||
        !['待跟进', '跟进中', '草稿', '暂缓跟进', '已归档'].includes(sale.status)
      ) {
        sale.legacyCrmStatus = sale.status;
        sale.crmStatus = undefined;
      } else
        sale.crmStatus = DEMO_IDENTITY_BINDINGS.some(
          (binding) => binding.role === 'sales' && binding.personId === sale.ownerPersonId,
        )
          ? '已分配'
          : '未分配';
    }
    if (!sale.crmSource) {
      const oldSource = sale.source;
      if (oldSource === '展会交流') sale.crmSource = '市场活动';
      else if (['市场活动', '官网咨询', '客户推荐', '中间人', '自有开发'].includes(oldSource))
        sale.crmSource = oldSource as NonNullable<typeof sale.crmSource>;
      else {
        sale.legacySource = sale.legacySource || oldSource;
        sale.sourceReviewRequired = true;
      }
    }
  }
  for (const activity of state.activities || []) {
    if (!activity.contactId && activity.customerId) {
      const sale = state.sales.find(
        (candidate) =>
          candidate.id === activity.entityId && candidate.customerId === activity.customerId,
      );
      if (sale?.contactId && sale.customerId === activity.customerId)
        activity.contactId = sale.contactId;
    }
    if (!activity.operatorPersonId) {
      const operator = identityForLegacyPlatformName(activity.operator);
      if (operator) activity.operatorPersonId = operator.personId;
    }
  }
  migrateStartupSourceSnapshots(state);
  syncClosedQuoteNotices(state);
  return state;
}

/**
 * 交底来源版本快照自 V8 起收纳交底关键内容（生产周期/发货周期/调试交期）。
 * 更早保存的快照缺少这些项，按当前内容补齐并视为未变化，避免历史交底被误判为待复核。
 */
function migrateStartupSourceSnapshots(state: DemoState): void {
  for (const project of state.projects || []) {
    const snapshot = project.briefing?.submission?.snapshot;
    if (!snapshot) continue;
    const missing = (['production', 'shipping', 'commissioning'] as const).filter(
      (key) => !(key in (snapshot as Record<string, unknown>)),
    );
    if (!missing.length) continue;
    const current = {
      production: project.briefing.production || '',
      shipping: project.briefing.shipping || '',
      commissioning: project.briefing.commissioning || '',
    };
    for (const key of missing) (snapshot as unknown as Record<string, string>)[key] = current[key];
    recordCompatibilityRepair(
      state,
      `compatibility-startup-source-${project.id}`,
      project.id,
      `旧交底来源快照缺少${missing.map((key) => startupContentLabel(key)).join('、')}，按当前内容补齐并视为未变化`,
    );
  }
}

function recordCompatibilityRepair(
  state: DemoState,
  id: string,
  entityId: string,
  action: string,
): void {
  if (state.history.some((entry) => entry.id === id)) return;
  state.history.push({
    id,
    entityId,
    action,
    operator: '系统兼容转换',
    date: new Date().toISOString(),
  });
}

export function syncClosedQuoteNotices(state: DemoState): void {
  const closedIds = new Set(
    state.sales
      .filter((sale) => sale.type === 'opportunity' && ['赢单', '丢单'].includes(sale.stage))
      .map((sale) => sale.id),
  );
  for (const notice of state.notices) {
    if (
      closedIds.has(notice.entityId) &&
      ['quote-review-', 'quote-lock-', 'v4-recheck-', 'v4-sent-check-'].some((prefix) =>
        notice.key.startsWith(prefix),
      )
    )
      notice.resolved = true;
  }
}
export function financeTemplate(projectId: string): FinanceSnapshot {
  return {
    projectId,
    sc: `DEMO-SC-${projectId}`,
    scope: '当前项目独立演示口径，不含父项目分摊',
    refreshedAt: new Date().toISOString(),
    indicators: {
      source: 'SAP',
      snapshotDate: BASE_DATE,
      currency: 'EUR',
      salesAmount: 120000,
      grossProfitAmount: 25000,
      prepaymentRatio: 30,
    },
    cumulativeActualCost: {
      projectId,
      source: 'SAP',
      amount: 60000,
      currency: 'EUR',
      scope: '项目累计实际成本演示范围；可能与费用范围重叠',
      cutoff: BASE_DATE,
    },
    expenses: [
      {
        id: `${projectId}-E1`,
        category: '差旅',
        subtype: '机票',
        date: '2026-09-15',
        amount: 1200,
        currency: 'EUR',
        person: '王项目',
        sourceNumber: 'DEMO-E001',
        source: 'SAP',
      },
      {
        id: `${projectId}-E2`,
        category: '差旅',
        subtype: '酒店',
        date: '2026-09-16',
        amount: 800,
        currency: 'EUR',
        person: '王项目',
        sourceNumber: 'DEMO-E002',
        source: 'SAP',
      },
      {
        id: `${projectId}-E3`,
        category: '服务',
        subtype: '现场支持',
        date: '2026-09-20',
        amount: 5000,
        currency: 'CNY',
        person: '吴运维',
        sourceNumber: 'DEMO-E003',
        source: 'CRM',
      },
    ],
    invoices: [
      {
        id: `${projectId}-I1`,
        number: 'DEMO-INV001',
        amount: 100000,
        currency: 'EUR',
        issued: '2026-08-01',
        due: '2026-09-01',
        received: 0,
      },
      {
        id: `${projectId}-I2`,
        number: 'DEMO-INV002',
        amount: 20000,
        currency: 'CNY',
        issued: '2026-10-01',
        due: BASE_DATE,
        received: 0,
      },
      {
        id: `${projectId}-I3`,
        number: 'DEMO-INV003',
        amount: 30000,
        currency: 'EUR',
        issued: '2026-09-15',
        due: '',
        received: 0,
      },
    ],
    events: [],
  };
}
export function invoiceFacts(invoice: FinanceInvoice, effectiveDue = invoice.due) {
  const days = (date: string) => Math.floor((Date.parse(BASE_DATE) - Date.parse(date)) / 86400000);
  const balance = invoice.amount - invoice.received;
  const overdue =
    balance > 0 && !!effectiveDue && Number.isFinite(days(effectiveDue))
      ? Math.max(0, days(effectiveDue))
      : 0;
  const age =
    invoice.issued && Number.isFinite(days(invoice.issued))
      ? Math.max(0, days(invoice.issued))
      : null;
  return {
    balance,
    overdue,
    age,
    band:
      age === null
        ? '无法判断'
        : age <= 30
          ? '0–30'
          : age <= 60
            ? '31–60'
            : age <= 90
              ? '61–90'
              : '90以上',
    status:
      balance < 0
        ? '数据异常：负余额'
        : balance === 0
          ? '已收齐'
          : !effectiveDue || !Number.isFinite(days(effectiveDue))
            ? '无法判断到期'
            : overdue > 0
              ? '逾期'
              : '未逾期',
  };
}

/** Fresh seed only: migration never fabricates confirmations for legacy data. */
export function seedV4(state: DemoState): DemoState {
  migrateV4(state);
  const sent = state.quoteSeries!.find((x) => x.versions.some((v) => v.sentDate));
  if (sent) {
    const id = sent.opportunityId,
      documentId = `V4-SEED-DOC-${id}`,
      versionId = `V4-SEED-SV-${id}`;
    state.attachments.push({
      id: documentId,
      entityId: id,
      kind: '核心技术方案',
      name: '演示_已发报价方案V1.pdf',
      size: 0,
      date: '2026-10-08T02:00:00.000Z',
      operator: '周方案',
      sample: true,
      mode: 'simulated',
      url: '',
    });
    state.solutionSeries!.push({
      id: `V4-SEED-SOL-${id}`,
      opportunityId: id,
      latestVersionId: versionId,
      finalVersionId: '',
      versions: [
        {
          id: versionId,
          number: 1,
          documentId,
          owner: '周方案',
          operator: '周方案',
          createdAt: '2026-10-08T02:00:00.000Z',
          note: '已发报价历史示例',
          operationId: `seed-${id}`,
        },
      ],
      marks: [],
    });
    for (const v of sent.versions.filter((v) => v.sentDate)) {
      v.sourceAttachmentIds.push(documentId);
      v.solutionVersionId = versionId;
    }
  }
  const special = state.sales.find(
    (x) => x.type === 'opportunity' && x.tender === '是' && ['A', 'S'].includes(x.grade),
  );
  if (special)
    state.serviceTerms!.push({
      opportunityId: special.id,
      revision: 1,
      kind: '特殊',
      years: 2,
      scope: '演示设备质保',
      sla: '需运维核对现场支持响应',
      special: '重点投标，客户要求现场支持',
      note: '',
      reviews: [],
    });
  const project =
    state.projects.find((x) =>
      state.sales.some((o) => o.id === x.opportunityId && o.stage === '赢单'),
    ) || state.projects[0];
  if (project) {
    const snapshot = financeTemplate(project.id);
    snapshot.refreshedAt = '2026-10-10T02:00:00.000Z';
    state.financeSnapshots!.push(snapshot);
    migrateContractInvoices(state, project.id);
    for (const i of snapshot.invoices.filter((i) => invoiceFacts(i).overdue > 0))
      state.notices.push({
        id: `V4-SEED-N-${i.id}`,
        key: `v4-receivable-${i.id}`,
        entityId: project.id,
        role: 'sales',
        title: '逾期应收，请跟进',
        text: `${i.number} · 余额${i.amount} ${i.currency}`,
        read: false,
        resolved: false,
        date: BASE_DATE,
      });
  }
  return state;
}
