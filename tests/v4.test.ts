import { test } from 'node:test';
import assert from 'node:assert/strict';
import { harness, prepare } from './v4-harness';
import { invoiceFacts, migrateV4, V4_SCHEMA_VERSION } from '../src/app/core/v4';
import { createSeed } from '../src/app/core/seed';
const id = 'DEMO-O014';
test('方案版本只换核心引用、不改价格；最终标记独立；重复操作幂等；过期草稿被拒绝', () => {
  const { store, role } = harness();
  const v = store.quoteSeries(id)!.versions[0];
  v.status = '草稿';
  prepare(store, role, id);
  const before = structuredClone(store.quoteVersion(v.id)!);
  const first = store.solution(id)!.latestVersionId;
  role('solution');
  store.markFinalSolution(id, first);
  store.uploadSolution(id, 'V2.pdf', '周方案', '修正', 'same-operation');
  store.uploadSolution(id, 'V2.pdf', '周方案', '修正', 'same-operation');
  assert.equal(store.solution(id)!.versions.length, 2);
  assert.equal(store.solution(id)!.finalVersionId, first);
  const updated = store.quoteVersion(v.id)!;
  assert.deepEqual(updated.items, before.items);
  assert.equal(
    updated.sourceAttachmentIds.filter(
      (x) => store.state().attachments.find((a) => a.id === x)?.kind === '核心技术方案',
    ).length,
    1,
  );
  role('sales');
  assert.throws(() => store.saveQuote(before), /已更新/);
});
test('待审及已审新版失效，旧审核待办关闭，过期审核不能通过', () => {
  const { store, role } = harness();
  store.quoteSeries(id)!.versions[0].status = '草稿';
  prepare(store, role, id);
  const v = store.quoteSeries(id)!.versions[0];
  store.submitQuote(v.id);
  const rev = store.quoteVersion(v.id)!.contentRevision;
  role('solution');
  store.uploadSolution(id, 'V2.pdf', '周方案');
  assert.equal(store.quoteVersion(v.id)!.status, '退回补充');
  assert.ok(
    store
      .state()
      .notices.filter((n) => n.key === `quote-review-${v.id}`)
      .every((n) => n.resolved),
  );
  role('sales');
  store.submitQuote(v.id);
  role('manager');
  assert.throws(() => store.reviewQuote(v.id, '模拟审核通过', '通过', '', rev), /已更新/);
  store.reviewQuote(v.id, '模拟审核通过', '通过', '', store.quoteVersion(v.id)!.contentRevision);
  role('solution');
  store.uploadSolution(id, 'V3.pdf', '周方案');
  assert.equal(store.quoteVersion(v.id)!.status, '退回补充');
  assert.ok(store.quoteVersion(v.id)!.audit.some((a) => a.action === '当前审核失效'));
});
test('已发与锁定引用不变，新报价引用最新方案', () => {
  const { store, role } = harness();
  const series = store.state().quoteSeries!.find((x) => x.versions.some((v) => v.sentDate))!;
  const v = series.versions.find((v) => v.sentDate)!;
  const before = structuredClone(v);
  role('solution');
  store.uploadSolution(series.opportunityId, '新版.pdf', '周方案');
  assert.deepEqual(store.quoteVersion(v.id), before);
  assert.ok(store.state().notices.some((n) => n.key.startsWith(`v4-sent-check-${v.id}`)));
  if (v.status === '已记录发出') {
    role('sales');
    for (const other of store
      .quoteSeries(series.opportunityId)!
      .versions.filter((x) => x.id !== v.id && !x.sentDate))
      other.status = '作废';
    const next = store.createQuoteVersion(v.id, '客户调整')!;
    assert.equal(
      store.quoteVersion(next)!.solutionVersionId,
      store.solution(series.opportunityId)!.latestVersionId,
    );
  }
});
test('特殊服务退回重提、旧修订拒绝、普通备注不失效、协议修改即拦截', () => {
  const { store, role } = harness();
  prepare(store, role, id);
  let t = store.terms(id);
  store.saveServiceTerms({ ...t, kind: '特殊', special: '现场服务' });
  t = store.terms(id);
  store.confirmServiceTerms(id, t.revision);
  role('receiver');
  store.reviewServiceTerms(id, t.revision, '需调整', '请调整响应');
  assert.ok(store.quoteGate(id).some((x) => x.code === 'special'));
  role('sales');
  store.saveServiceTerms({ ...store.terms(id), special: '调整后现场服务' });
  const next = store.terms(id);
  store.confirmServiceTerms(id, next.revision);
  role('receiver');
  assert.throws(() => store.reviewServiceTerms(id, t.revision, '可接受', '旧意见'), /已复核|过期/);
  store.reviewServiceTerms(id, next.revision, '可接受', '接受');
  role('sales');
  store.saveServiceTerms({ ...store.terms(id), note: '普通备注' });
  assert.equal(store.terms(id).revision, next.revision);
  assert.equal(
    store.quoteGate(id).some((x) => x.code === 'special'),
    false,
  );
  store.saveAgreement({ ...store.agreement(id), applicability: '适用', summary: '付费维护' });
  assert.ok(store.quoteGate(id).some((x) => x.code === 'agreement'));
});
test('历史模拟回款已退役：不改变余额与待办，只读币种及日期边界仍可追溯', () => {
  const { store, role } = harness();
  role('finance');
  const p = store.state().projects[2].id;
  store.loadFinance(p);
  const invoice = store.finance(p)!.invoices[0];
  const before = structuredClone(store.state());
  assert.throws(() => store.simulateReceipt(p, invoice.id, false), /已停用/);
  assert.throws(() => store.simulateReceipt(p, invoice.id, false), /已停用/);
  assert.throws(() => store.simulateReceipt(p, invoice.id, true), /已停用/);
  assert.deepEqual(store.state(), before);
  assert.equal(store.finance(p)!.invoices[0].received, 0);
  assert.equal(store.finance(p)!.events.length, 0);
  assert.ok(
    store.state().notices.some((n) => n.key === `v4-receivable-${invoice.id}` && !n.resolved),
  );
  store.loadFinance(p);
  assert.equal(store.finance(p)!.invoices[0].received, 0);
  assert.equal(store.finance(p)!.invoices[0].amount, invoice.amount);
  assert.equal(invoiceFacts({ ...invoice, due: '2026-10-10' }).overdue, 0);
  assert.equal(invoiceFacts({ ...invoice, due: '' }).status, '无法判断到期');
  assert.equal(invoiceFacts({ ...invoice, received: 100001 }).status, '数据异常：负余额');
});
test('D02 CRM账期绑定指定客户节点，约定优先，预测不判逾期，实际完成后推算应收日', () => {
  const { store, role } = harness();
  const projectId = 'DEMO-P001';
  role('finance');
  store.loadFinance(projectId);
  const project = store.project(projectId)!;
  const milestone = project.plans.find(
    (plan) => plan.type === '客户主节点' && plan.name === '客户要求首批到货',
  )!;
  const policy = store.creditPolicy(projectId)!;
  assert.equal(policy.startCustomerMilestoneId, milestone.id);
  assert.equal(store.creditDateFacts(projectId).expectedDue, '2026-11-19');
  const invoices = store.finance(projectId)!.invoices;
  assert.equal(invoices[2].dueMilestoneExpectedDate, milestone.expected);
  assert.equal(invoices[2].paymentTermDays, policy.days);
  assert.equal(store.invoiceDue(projectId, invoices[0]).date, invoices[0].due);
  assert.equal(store.invoiceDue(projectId, invoices[2]).date, '');
  assert.equal(store.invoiceDue(projectId, invoices[2]).forecastDate, '2026-11-19');
  assert.equal(store.invoiceFacts(projectId, invoices[2]).status, '无法判断到期');
  role('pm');
  store.savePlan(
    projectId,
    { ...milestone, status: '已完成', actual: '2026-09-01' },
    'credit-complete',
  );
  assert.equal(store.creditDateFacts(projectId).actualDue, '2026-10-01');
  assert.equal(store.invoiceDue(projectId, invoices[2]).date, '2026-10-01');
  assert.equal(store.invoiceFacts(projectId, invoices[2]).overdue, 9);
  assert.ok(
    store
      .state()
      .notices.some(
        (notice) => notice.key === `v4-receivable-${invoices[2].id}` && !notice.resolved,
      ),
  );
});
test('D04延期节点和逾期应收共用稳定事项并按实际事实解除', () => {
  const { store, role } = harness();
  const projectId = 'DEMO-P001';
  role('finance');
  store.loadFinance(projectId);
  role('pm');
  const project = store.project(projectId)!;
  const plan = project.plans.find((item) => item.type === '客户主节点')!;
  store.savePlan(projectId, { ...plan, expected: '2026-10-08' }, 'late-node');
  let warning = store.milestoneWarnings(projectId).find((item) => item.sourcePlanId === plan.id)!;
  assert.equal(warning.offsetDays, 2);
  let notice = store
    .state()
    .notices.find((item) => item.key === `v4-milestone-${projectId}-${plan.id}`)!;
  store.markNotice(notice.id);
  notice = store.state().notices.find((item) => item.id === notice.id)!;
  assert.equal(notice.read, true);
  assert.equal(notice.resolved, false);
  store.savePlan(
    projectId,
    {
      ...store.project(projectId)!.plans.find((item) => item.id === plan.id)!,
      expected: '2026-10-10',
    },
    'on-time-node',
  );
  assert.equal(
    store.milestoneWarnings(projectId).some((item) => item.sourcePlanId === plan.id),
    false,
  );
  assert.equal(store.state().notices.find((item) => item.id === notice.id)!.resolved, true);
  assert.ok(store.milestoneWarnings(projectId).some((item) => item.kind === '回款逾期'));
});
test('成本直接生效、修订留历史、失败保留当前、BOM权限及隔离', () => {
  const { store, role } = harness();
  const p = store.state().projects[2].id;
  role('finance');
  store.simulateDocument(p, '最终成本资料', '成本.xlsx');
  const a = store.attachments(p, '最终成本资料')[0];
  const input = {
    projectId: p,
    amount: 80000,
    currency: 'EUR',
    scope: '项目整体',
    cutoff: '2026-10-09',
    confirmedDate: '2026-10-10',
    provider: '黄财务',
    documentId: a.id,
    reason: '',
    zeroReason: '',
    operationId: 'cost1',
  };
  store.saveFinalCost(input, 0);
  store.saveFinalCost(input, 0);
  assert.equal(store.costs(p).length, 1);
  assert.throws(
    () => store.saveFinalCost({ ...input, amount: -1, operationId: 'bad' }, 1),
    /有效金额/,
  );
  assert.throws(
    () => store.saveFinalCost({ ...input, amount: 81000, operationId: 'bad' }, 1),
    /修订原因/,
  );
  store.saveFinalCost({ ...input, amount: 81000, reason: '补充结算', operationId: 'cost2' }, 1);
  assert.equal(store.costs(p).length, 2);
  assert.equal(store.simulateDocument(p, 'BOM', 'BOM.xlsx', '', 'bom1'), true);
  role('pm');
  const before = structuredClone(store.project(p)!.plans);
  store.simulateDocument(p, 'BOM', 'BOM.xlsx', '', 'bom1');
  store.simulateDocument(p, 'BOM', 'BOM.xlsx', '', 'bom1');
  store.simulateDocument(p, 'BOM', 'BOM2.xlsx', '', 'bom2');
  assert.equal(store.attachments(p, 'BOM').length, 2);
  assert.deepEqual(store.project(p)!.plans, before);
  assert.equal(store.attachments(store.state().projects[0].id, 'BOM').length, 0);
});
test('V2迁移不编造确认，重复迁移稳定；存储失败状态不发布', () => {
  const legacy = createSeed();
  delete legacy.solutionSeries;
  delete legacy.serviceTerms;
  delete legacy.serviceAgreements;
  delete legacy.financeSnapshots;
  delete legacy.finalActualCosts;
  delete legacy.v4SchemaVersion;
  const refs = structuredClone(legacy.quoteSeries);
  migrateV4(legacy);
  migrateV4(legacy);
  assert.deepEqual(legacy.quoteSeries, refs);
  assert.equal(legacy.solutionSeries!.length, 0);
  assert.equal(legacy.serviceTerms!.length, 0);
  const { store, role } = harness();
  role('solution');
  const before = structuredClone(store.state());
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      setItem() {
        throw new Error('容量不足');
      },
    },
  });
  assert.throws(() => store.uploadSolution(id, '方案.pdf', '周方案'), /容量不足/);
  assert.deepEqual(store.state(), before);
});
test('客户节点旧名称只在唯一时转固定ID，重名不猜测，完成后改名仍保留绑定', () => {
  const state = createSeed();
  const project = state.projects.find((item) => item.id === 'DEMO-P001')!;
  const milestone = project.plans.find((plan) => plan.type === '客户主节点')!;
  const source = project.plans.find((plan) => plan.type === '内部WBS')!;
  source.linked = milestone.name;
  delete source.customerMilestoneId;
  migrateV4(state);
  assert.equal(source.customerMilestoneId, milestone.id);
  assert.ok(
    state.projectMilestoneBindings!.some(
      (binding) =>
        binding.sourcePlanId === source.id && binding.customerMilestoneId === milestone.id,
    ),
  );
  const duplicate = structuredClone(source);
  duplicate.id = 'duplicate-source';
  duplicate.customerMilestoneId = undefined;
  project.plans.push(duplicate, { ...structuredClone(milestone), id: 'duplicate-customer' });
  migrateV4(state);
  assert.equal(duplicate.customerMilestoneId, undefined);
  duplicate.linked = 'missing node';
  migrateV4(state);
  assert.equal(duplicate.customerMilestoneId, undefined);
  milestone.name = '已重命名的客户节点';
  migrateV4(state);
  assert.equal(source.customerMilestoneId, milestone.id);
  assert.equal(source.linked, milestone.name);
});
test('存储损坏保留原始备份，合法旧存储加载两次不改变引用', () => {
  const { store } = harness();
  const values = new Map<string, string>();
  values.set('cspd-demo-v2', '{broken');
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (k: string) => values.get(k) || null,
      setItem: (k: string, v: string) => values.set(k, v),
    },
  });
  const load = Reflect.get(store, 'load').bind(store);
  const seed = load();
  assert.equal(seed.v4SchemaVersion, V4_SCHEMA_VERSION);
  assert.ok([...values].some(([key, v]) => key.includes('corrupt-backup') && v === '{broken'));
  assert.equal(values.get('cspd-demo-v2'), '{broken');
  const old = createSeed();
  delete old.v4SchemaVersion;
  delete old.solutionSeries;
  delete old.serviceTerms;
  delete old.serviceAgreements;
  delete old.financeSnapshots;
  delete old.finalActualCosts;
  values.set('cspd-demo-v2', JSON.stringify(old));
  const first = load();
  const second = load();
  assert.deepEqual(first, second);
  assert.deepEqual(first.quoteSeries, old.quoteSeries);
  assert.equal(first.solutionSeries.length, 0);
});
test('方案与报价演示操作不限制角色，普通服务没有运维待办，适用协议必须真实存在模拟元数据', () => {
  const { store, role } = harness();
  prepare(store, role, id);
  assert.equal(
    store.state().notices.some((x) => x.entityId === id && x.key.startsWith('v4-service-review-')),
    false,
  );
  role('outsider');
  assert.equal(store.uploadSolution(id, '方案.pdf', '周方案'), true);
  assert.equal(store.markFinalSolution(id, store.solution(id)!.latestVersionId), true);
  assert.equal(store.saveServiceTerms(store.terms(id)), true);
  assert.equal(store.loadFinance(store.state().projects[0].id), true);
  role('sales');
  store.saveAgreement({
    ...store.agreement(id),
    applicability: '适用',
    reason: '',
    summary: '三年服务',
    documentId: 'fake',
  });
  assert.throws(
    () => store.confirmAgreement(id, store.agreement(id).revision),
    /协议摘要及模拟文件/,
  );
  store.simulateDocument(id, '服务协议', '协议.pdf');
  const document = store.attachments(id, '服务协议').find((x) => x.mode === 'simulated')!;
  store.saveAgreement({ ...store.agreement(id), documentId: document.id });
  store.confirmAgreement(id, store.agreement(id).revision);
  assert.equal(store.quoteGate(id).length, 0);
});
test('旧方案摘要、成本参考与新增行表单在新版到达后拒绝保存', () => {
  const { store, role } = harness();
  store.quoteSeries(id)!.versions[0].status = '草稿';
  prepare(store, role, id);
  const v = structuredClone(store.quoteSeries(id)!.versions[0]);
  role('solution');
  store.uploadSolution(id, '新版.pdf', '周方案');
  assert.throws(
    () => store.saveQuoteSolution(v.id, '旧摘要', '旧边界', v.contentRevision),
    /已更新/,
  );
  assert.throws(() => store.saveQuoteCosts(v.id, v.costs, v.contentRevision), /已更新/);
  role('sales');
  assert.throws(
    () =>
      store.addQuoteItem(
        v.id,
        {
          category: '货物',
          name: '旧配置',
          spec: '',
          unit: '套',
          quantity: 1,
          unitPrice: 10,
          source: '',
        },
        v.contentRevision,
      ),
    /已更新/,
  );
});
