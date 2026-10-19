import { test } from 'node:test';
import assert from 'node:assert/strict';
import { harness, prepare } from './v4-harness';
import { completeCrmDraft, prepareQuoteSolutionBasis } from './crm-quote-fixture';
import { createSeed } from '../src/app/core/seed';
import { migrateV4 } from '../src/app/core/v4';
import { Project, DemoState, SolutionDocumentKind, FiveCanKey } from '../src/app/core/models';

function preparedQuote() {
  const context = harness();
  const { store, role } = context;
  const opportunityId = 'DEMO-O014';
  const quoteId = store.quoteSeries(opportunityId)!.versions[0].id;
  // The existing seed is an already reviewed quotation; start a draft fixture.
  store.quoteVersion(quoteId)!.status = '草稿';
  prepare(store, role, opportunityId);
  const draft = structuredClone(store.quoteVersion(quoteId)!);
  draft.payment = '100%预付';
  store.saveQuote(draft);
  role('finance');
  store.confirmQuoteTax(quoteId, '样例已确认', '确认演示口径');
  role('sales');
  store.submitQuote(quoteId);
  return { ...context, opportunityId, quoteId };
}

function sentQuote() {
  const context = preparedQuote();
  const { store, role, quoteId } = context;
  role('manager');
  store.reviewQuote(quoteId, '模拟审核通过', '通过');
  role('sales');
  store.recordQuoteSent(quoteId, '2026-10-10', '邮件', '陈客户', '演示发出记录');
  store.addQuoteFeedback(quoteId, {
    date: '2026-10-10',
    kind: '客户确认接受',
    summary: '接受报价',
    person: '陈客户',
    evidence: '客户回函',
  });
  store.requestQuoteLock(quoteId);
  return context;
}

function wonOpportunity() {
  const context = sentQuote();
  const { store, role, opportunityId, quoteId } = context;
  role('manager');
  store.lockQuote(quoteId);
  role('sales');
  while (store.sale(opportunityId)!.stage !== '合同谈判') {
    store.addActivity(opportunityId, {
      date: '2026-10-10',
      type: '会议',
      summary: '确认本阶段业务结果',
      people: '陈客户',
      next: '继续推进',
    });
    store.advance(opportunityId);
  }
  store.addActivity(opportunityId, {
    date: '2026-10-10',
    type: '会议',
    summary: '确认合同条款',
    people: '陈客户',
    next: '交付',
  });
  store.closeSale(opportunityId, '赢单', '客户确认', '2026-10-10', '');
  return context;
}

function completeCustomerAcceptance(store: ReturnType<typeof harness>['store'], id: string) {
  if (!store.has(id, '客户签字清单')) store.simulateDocument(id, '客户签字清单', '客户签字.pdf');
  for (const item of store.project(id)!.acceptance)
    store.saveAcceptance(id, item.id, '通过', '陈客户', '2026-10-10', '确认');
  store.completeAcceptance(id);
}

function task(project: Project, name: string) {
  return project.plans.find((plan) => plan.type === '内部WBS' && plan.name === name)!;
}

test('销售桥接与PM草稿合同入口都引用锁定报价的付款条件', () => {
  for (const path of ['bridge', 'draft']) {
    const { store, role, opportunityId, quoteId } = wonOpportunity();
    let projectId: string;
    if (path === 'bridge') projectId = store.bridge(opportunityId)!;
    else {
      role('pm');
      projectId = store.createProjectDraft('审阅修复项目', '王项目', '演示现场', opportunityId)!;
      store.loadProjectContract(projectId);
    }
    const contract = store
      .state()
      .contracts.find((c) => c.id === store.project(projectId)!.contractId)!;
    assert.equal(contract.payment, '100%预付', path);
    assert.equal(contract.quoteVersionId, quoteId);
    assert.equal(contract.amount, store.quoteTotals(store.quoteVersion(quoteId)!).total);
  }
});

test('交底关键修改使旧审核失效，并保留原审核意见和修改前内容', () => {
  const { store, role } = harness();
  role('pm');
  const before = structuredClone(store.project('DEMO-P003')!);
  store.saveProject({ ...before, briefing: { ...before.briefing, acceptance: '新的验收标准' } });
  const after = store.project(before.id)!;
  assert.equal(after.briefing.review, '待提交');
  assert.equal(after.needsReview, true);
  assert.ok(after.reviewReasons?.includes('briefing'));
  assert.equal(task(after, '项目启动交底').status, '需复核');
  assert.ok(store.history(before.id).some((h) => h.action.includes(before.briefing.acceptance)));
  const startup = {
    ...task(after, '项目启动交底'),
    name: '修改后的启动名称',
    status: '已完成',
    actual: '2026-10-10',
  };
  assert.throws(() => store.savePlan(before.id, startup), /交底|启动/);
});

test('现场非关键修改和旧表单保存不会覆盖最新审核或SAT结果', () => {
  const { store, role } = harness();
  role('pm');
  const oldForm = structuredClone(store.project('DEMO-P007')!);
  store.saveSat(oldForm.id, '2026-10-09', '合格', true);
  const reviews = structuredClone(store.project(oldForm.id)!.reviewReasons);
  store.saveProject({ ...oldForm, site: '更新现场' });
  const after = store.project(oldForm.id)!;
  assert.equal(after.site, '更新现场');
  assert.equal(after.sat.date, '2026-10-09');
  assert.equal(after.briefing.review, '通过');
  assert.deepEqual(after.reviewReasons, reviews);
});

test('SAT与交底复核分别解除，提交审核也不能清除其他复核原因', () => {
  const { store, role } = harness();
  role('pm');
  const id = 'DEMO-P003';
  const before = structuredClone(store.project(id)!);
  store.saveProject({ ...before, briefing: { ...before.briefing, production: '60个工作日' } });
  store.saveSat(id, '2026-10-10', '不合格', false);
  store.submitBriefing(id);
  assert.equal(store.project(id)!.needsReview, true);
  assert.ok(store.project(id)!.reviewReasons?.includes('sat'));
  role('pmo');
  store.review(id, '通过', '重新核对交底');
  assert.equal(store.project(id)!.needsReview, true);
  assert.deepEqual(store.project(id)!.reviewReasons, ['sat']);
  role('pm');
  store.simulateDocument(id, 'SAT报告', 'SAT.pdf');
  store.saveSat(id, '2026-10-10', '合格', true);
  assert.equal(store.project(id)!.needsReview, false);
});

test('已接收后SAT失效同步任务与移交，复核后可重提接收且保留旧历史', () => {
  const { store, role } = harness();
  const id = 'DEMO-P007';
  role('receiver');
  store.receive(id, '已接收', '首次确认');
  role('pm');
  store.saveSat(id, '2026-10-10', '不合格', false);
  const changed = store.project(id)!;
  assert.equal(changed.handover.status, '待复核');
  assert.equal(task(changed, '调试测试').status, '需复核');
  assert.equal(task(changed, '内部移交').status, '需复核');
  assert.equal(task(changed, '内部移交').actual, '');
  assert.throws(() => store.submitHandover(id), /SAT/);
  store.saveSat(id, '2026-10-10', '合格', true);
  assert.equal(store.project(id)!.needsReview, true);
  store.submitHandover(id);
  role('receiver');
  store.receive(id, '已接收', '复核后重新接收');
  assert.equal(store.project(id)!.needsReview, false);
  assert.equal(task(store.project(id)!, '内部移交').status, '已完成');
  assert.ok(store.history(id).some((h) => h.action.includes('首次确认')));
});

test('客户验收修改使WBS失效，SAT确认不能误清验收复核', () => {
  const { store, role } = harness();
  role('pm');
  const id = 'DEMO-P007';
  completeCustomerAcceptance(store, id);
  store.submitHandover(id);
  role('receiver');
  store.receive(id, '已接收', '已核对客户验收');
  role('pm');
  const item = store.project(id)!.acceptance[0];
  store.saveAcceptance(id, item.id, '不通过', item.signer, item.date, '复核失败');
  assert.equal(store.project(id)!.acceptanceComplete, false);
  assert.equal(task(store.project(id)!, '客户验收').status, '需复核');
  assert.equal(store.project(id)!.handover.status, '待复核');
  store.saveSat(id, '2026-10-10', '合格', true);
  assert.ok(store.project(id)!.reviewReasons?.includes('acceptance'));
  assert.throws(() => store.submitHandover(id), /复核|验收/);
  completeCustomerAcceptance(store, id);
  store.submitHandover(id);
  role('receiver');
  store.receive(id, '已接收', '验收复核后接收');
  assert.equal(store.project(id)!.needsReview, false);
});

test('已接收移交资料变化需要重新提交，八类分类必须完整且不重复', () => {
  const { store, role } = harness();
  const id = 'DEMO-P007';
  role('receiver');
  store.receive(id, '已接收', '原接收意见');
  role('pm');
  const changed = structuredClone(store.project(id)!);
  changed.handover.categories[0].note = '更新资料引用';
  store.saveHandover(id, changed);
  assert.equal(store.project(id)!.handover.status, '待复核');
  assert.equal(store.project(id)!.needsReview, true);
  const malformed = structuredClone(store.project(id)!);
  malformed.handover.categories = Array.from({ length: 8 }, () => ({
    ...malformed.handover.categories[0],
  }));
  store.saveHandover(id, malformed);
  assert.throws(() => store.submitHandover(id), /八类/);
  assert.ok(store.history(id).some((h) => h.action.includes('原接收意见')));
});

test('关键WBS改名后仍随真实SAT结果同步，重套模板不抹掉已确认结果', () => {
  const { store, role } = harness();
  role('pm');
  const id = 'DEMO-P007';
  const satTask = task(store.project(id)!, '调试测试');
  store.savePlan(id, { ...satTask, name: '现场联调', status: '进行中', actual: '' });
  store.saveSat(id, '2026-10-10', '合格', true);
  assert.equal(store.project(id)!.plans.find((p) => p.id === satTask.id)!.status, '已完成');
  store.applyTemplate(id, false);
  assert.equal(task(store.project(id)!, '调试测试').status, '已完成');
});

test('旧有效负责人迁移为已分配，未知人员和明确未分配状态不被授权', () => {
  for (const status of ['待跟进', '暂缓跟进', '已归档']) {
    const state = createSeed();
    const lead = state.sales.find((s) => s.id === 'DEMO-L001')!;
    delete lead.crmStatus;
    delete lead.ownerPersonId;
    lead.status = status;
    migrateV4(state);
    assert.equal(lead.crmStatus, '已分配', status);
    assert.equal(lead.ownerPersonId, 'demo-person-sales-zhang');
    const once = JSON.stringify(state);
    migrateV4(state);
    assert.equal(JSON.stringify(state), once);
  }
  const state = createSeed();
  const lead = state.sales.find((s) => s.id === 'DEMO-L001')!;
  delete lead.crmStatus;
  lead.owner = '未知销售';
  lead.ownerPersonId = 'unknown-person';
  migrateV4(state);
  assert.equal(lead.crmStatus, '未分配');
  const explicitlyUnassigned = state.sales.find((s) => s.id === 'DEMO-L002')!;
  explicitlyUnassigned.crmStatus = '未分配';
  explicitlyUnassigned.ownerPersonId = 'demo-person-sales-zhang';
  migrateV4(state);
  assert.equal(explicitlyUnassigned.crmStatus, '未分配');
});

test('丢单解除报价审核待办并拒绝旧审核，同时保留报价历史', () => {
  const { store, role, opportunityId, quoteId } = preparedQuote();
  const before = structuredClone(store.quoteVersion(quoteId)!);
  store.closeSale(opportunityId, '丢单', '客户取消', '', '');
  assert.ok(
    store
      .state()
      .notices.filter((n) => n.key === `quote-review-${quoteId}`)
      .every((n) => n.resolved),
  );
  assert.deepEqual(store.quoteVersion(quoteId), before);
  role('manager');
  assert.throws(() => store.reviewQuote(quoteId, '模拟审核通过', '旧审核'), /关闭|丢单/);
});

test('丢单解除锁定申请待办，旧申请不能继续锁定或发出新版', () => {
  const { store, role, opportunityId, quoteId } = sentQuote();
  store.closeSale(opportunityId, '丢单', '客户取消', '', '');
  assert.ok(
    store
      .state()
      .notices.filter((n) => n.key === `quote-lock-${quoteId}`)
      .every((n) => n.resolved),
  );
  role('manager');
  assert.throws(() => store.lockQuote(quoteId), /关闭|丢单/);
  role('sales');
  assert.throws(() => store.createQuoteVersion(quoteId, '继续报价'), /关闭|丢单/);
});

test('早期阶段不能赢单；合同谈判必须有沟通及有效最终报价', () => {
  const { store } = harness();
  const earlyId = 'DEMO-O001';
  const before = structuredClone(store.sale(earlyId));
  assert.throws(() => store.closeSale(earlyId, '赢单', '跳阶段', '2026-10-10', ''), /合同谈判/);
  assert.deepEqual(store.sale(earlyId), before);
  const { store: quoted, opportunityId } = preparedQuote();
  quoted.sale(opportunityId)!.stage = '合同谈判';
  quoted.addActivity(opportunityId, {
    date: '2026-10-10',
    type: '会议',
    summary: '谈判记录',
    people: '陈客户',
    next: '',
  });
  assert.throws(() => quoted.closeSale(opportunityId, '赢单', '未锁定', '2026-10-10', ''), /锁定/);
});

test('待接收与已接收种子样例的专用节点和WBS状态一致', () => {
  const state = createSeed();
  for (const project of state.projects.filter((p) => p.sat.complete)) {
    assert.equal(task(project, '调试测试').status, '已完成', project.id);
    assert.equal(task(project, '调试测试').actual, project.sat.date);
    if (project.handover.status === '已接收') {
      assert.equal(task(project, '内部移交').status, '已完成', project.id);
      assert.ok(task(project, '内部移交').actual);
    }
  }
});

test('复核状态持久化、迁移两次稳定，保存失败不会发布部分变更', () => {
  const { store, role } = harness();
  let saved = '';
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: () => saved || null,
      setItem: (_key: string, value: string) => {
        saved = value;
      },
    },
  });
  role('pm');
  const project = structuredClone(store.project('DEMO-P003')!);
  store.saveProject({ ...project, briefing: { ...project.briefing, shipping: '新的发货周期' } });
  const expected = JSON.parse(saved) as DemoState;
  const load = Reflect.get(store, 'load').bind(store) as () => DemoState;
  assert.deepEqual(load(), expected);
  assert.deepEqual(load(), expected);
  const current = structuredClone(store.state());
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      setItem() {
        throw new Error('存储容量不足');
      },
    },
  });
  assert.throws(() => store.saveSat(project.id, '2026-10-10', '不合格', false), /容量不足/);
  assert.deepEqual(store.state(), current);
});

test('通用商机编辑不能绕过阶段或停用已有报价门槛', () => {
  const { store } = harness();
  const early = structuredClone(store.sale('DEMO-O001')!);
  assert.throws(() => store.saveSales({ ...early, stage: '赢单' }), /阶段|专用/);
  const { store: quoted, opportunityId } = preparedQuote();
  assert.throws(
    () => quoted.saveSales({ ...quoted.sale(opportunityId)!, quoteFlowMode: 'legacy' }),
    /报价|专用/,
  );
});

test('通用编辑不能把锁定报价和合同改挂到另一个客户', () => {
  const { store, opportunityId } = wonOpportunity();
  const sale = structuredClone(store.sale(opportunityId)!);
  const other = store.state().customers.find((c) => c.id !== sale.customerId)!;
  assert.throws(
    () => store.saveSales({ ...sale, customerId: other.id, contactId: other.contacts[0].id }),
    /客户|报价/,
  );
});

test('丢单后更新方案不能修改或重新激活旧报价历史', () => {
  const { store, role, opportunityId, quoteId } = preparedQuote();
  store.closeSale(opportunityId, '丢单', '客户取消', '', '');
  const before = structuredClone(store.quoteVersion(quoteId));
  role('solution');
  store.uploadSolution(opportunityId, '后续参考资料.pdf', '周方案');
  assert.deepEqual(store.quoteVersion(quoteId), before);
  assert.ok(
    store
      .state()
      .notices.filter((n) => n.entityId === opportunityId && n.key.startsWith('v4-recheck-'))
      .every((n) => n.resolved),
  );
});

test('已接收项目重复确认相同SAT或验收不会倒退主阶段', () => {
  const { store, role } = harness();
  const id = 'DEMO-P007';
  role('receiver');
  store.receive(id, '已接收', '确认接收');
  role('pm');
  const sat = store.project(id)!.sat;
  store.saveSat(id, sat.date, sat.result, true);
  assert.equal(store.project(id)!.status, '已移交');
  assert.equal(store.project(id)!.needsReview, false);
});

test('未知旧线索状态及失联商机关联保留原文，不猜测授权或假装转换成功', () => {
  const state = createSeed();
  const unknown = state.sales.find((s) => s.id === 'DEMO-L001')!;
  delete unknown.crmStatus;
  unknown.status = '旧系统未知状态';
  delete unknown.followUpStatus;
  migrateV4(state);
  assert.equal(unknown.crmStatus, undefined);
  assert.equal(unknown.legacyCrmStatus, '旧系统未知状态');
  const { store, role } = harness();
  store.state.set(state);
  role('manager');
  assert.equal(store.canOperateSale(unknown), false);
  unknown.convertedTo = 'missing-opportunity';
  assert.throws(() => store.convert(unknown.id), /关联|核对/);
  assert.equal(store.state().sales.filter((s) => s.type === 'opportunity').length, 24);
});

test('同一条线索连续完成报价锁定、赢单、交底、SAT、客户验收和移交，WBS完整收口', async () => {
  const { store, role } = harness();
  const leadId = 'DEMO-L001';
  const sourceCustomerId = store.sale(leadId)!.customerId;
  const sourceContactId = store.contact(store.sale(leadId)!)!.id;
  store.simulateDocument(leadId, '需求导入表', '需求.xlsx');
  const opportunityId = store.convert(leadId)!;
  assert.equal(store.sale(opportunityId)!.customerId, sourceCustomerId);
  assert.equal(store.sale(opportunityId)!.contactId, sourceContactId);
  store.saveSales({
    ...store.sale(opportunityId)!,
    description: '储能需求已确认',
    capacity: 10,
    amount: 120000,
    expectedDate: '2026-11-15',
    grade: 'A',
    tender: '否',
    tradeTerm: 'FOB',
  });
  store.saveProductNeed(opportunityId, {
    id: 'global-review-need',
    model: 'PCS-100',
    quantity: 1,
    unit: '台',
  });
  const requirementAttachment = store
    .state()
    .attachments.find((item) => item.kind === '需求导入表')!;
  const evidenceKinds = ['核心技术方案', 'BOM清单', '单线图（SLD）', '衰减曲线'];
  for (const kind of evidenceKinds)
    store.state().attachments.push({
      ...requirementAttachment,
      id: `global-review-${kind}`,
      entityId: opportunityId,
      kind,
      name: `${kind}.pdf`,
    });
  store.saveTechnicalAssessment(opportunityId, {
    result: '满足',
    owner: '周方案',
    opinion: '资料齐备，需求可行',
    evidenceAttachmentIds: store
      .quoteSourceCandidates(opportunityId)
      .filter((item) => evidenceKinds.includes(item.kind))
      .map((item) => item.id),
  });
  store.submitOpportunity(opportunityId);
  store.assignOpportunityPM(opportunityId, 'pm', '王项目', '模拟排期窗口');
  store.assignTeam(opportunityId, [
    {
      id: 'global-review-member',
      role: 'pm',
      person: '王项目',
      department: '交付部',
      window: '模拟排期窗口',
      confirmed: true,
      confirmedBy: '王项目',
    },
  ]);
  for (const task of store.sale(opportunityId)!.departmentTasks || [])
    store.completeDepartmentTask(opportunityId, task.id);
  store.addActivity(opportunityId, {
    date: '2026-10-10',
    type: '会议',
    summary: '确认意向需求',
    people: '陈客户',
    next: '报价',
  });
  store.advance(opportunityId);
  const quoteId = store.createQuote(opportunityId)!;
  assert.equal(store.quoteVersion(quoteId)!.customerId, sourceCustomerId);
  assert.equal(store.quoteVersion(quoteId)!.contactId, sourceContactId);
  prepare(store, role, opportunityId);
  await prepareQuoteSolutionBasis(store, quoteId);
  assert.throws(() => store.submitQuote(quoteId), /关联价目表/);
  role('solution');
  for (const kind of ['技术方案', 'TIC', '设计BOM', 'SLD'] as SolutionDocumentKind[])
    store.addSolutionDocument(opportunityId, kind, `${kind}.pdf`, '周方案');
  store.confirmSolutionDocuments(opportunityId, '周方案');
  store.recordSolutionCosting(
    opportunityId,
    { 'global-review-need': 100000 },
    store.sale(opportunityId)!.currency,
    '不含税报价',
    '连续主线模拟成本表',
  );
  store.recordFiveCan(
    opportunityId,
    '当前已确认四类资料',
    Object.fromEntries(
      (['可承诺', '可交付', '可运维', '可验收', '可续约'] as FiveCanKey[]).map((key) => [
        key,
        {
          result: '满足' as const,
          owner: '周方案',
          opinion: '逐项确认可满足',
        },
      ]),
    ) as Record<FiveCanKey, { result: '满足'; owner: string; opinion: string }>,
    [],
  );
  role('sales');
  assert.equal(store.saveCrmQuote(completeCrmDraft(store, quoteId)), true);
  assert.deepEqual(store.quoteSourceDifferences(quoteId), [], '新表单不再依赖已删除的方案引用入口');
  store.submitQuote(quoteId);
  role('manager');
  store.reviewQuote(quoteId, '模拟审核通过', '确认');
  role('sales');
  store.recordQuoteSent(quoteId, '2026-10-10', '邮件', '陈客户', '演示邮件');
  store.recordCrmCustomerDecision(quoteId, '接受', '陈客户', '客户回函', '2026-10-10');
  role('manager');
  store.lockQuote(quoteId);
  role('sales');
  store.advance(opportunityId);
  store.addActivity(opportunityId, {
    date: '2026-10-10',
    type: '会议',
    summary: '确认洽谈结果',
    people: '陈客户',
    next: '签约',
  });
  store.advance(opportunityId);
  store.addActivity(opportunityId, {
    date: '2026-10-10',
    type: '会议',
    summary: '合同条款确认',
    people: '陈客户',
    next: '交付',
  });
  store.closeSale(opportunityId, '赢单', '客户确认', '2026-10-10', '');
  const projectId = store.bridge(opportunityId)!;
  assert.equal(store.project(projectId)!.customerId, sourceCustomerId);
  assert.equal(store.project(projectId)!.contactId, sourceContactId);
  const linkedContract = store
    .state()
    .contracts.find((contract) => contract.id === store.project(projectId)!.contractId)!;
  assert.equal(linkedContract.customerId, sourceCustomerId);
  assert.equal(linkedContract.contactId, sourceContactId);
  role('pm');
  store.acceptProject(projectId);
  const project = structuredClone(store.project(projectId)!);
  store.saveProject({
    ...project,
    start: '2026-10-10',
    briefing: { ...project.briefing, acceptance: '逐项验收签认' },
  });
  store.simulateDocument(projectId, '启动纪要', '纪要.pdf');
  store.simulateDocument(projectId, '启动文件', '启动.pdf');
  store.submitBriefing(projectId);
  role('pmo');
  store.review(projectId, '通过', '交底核对通过');
  role('pm');
  role('sales');
  store.submitContractBriefing(projectId, '基于当前合同与启动资料完成交底');
  role('pm');
  store.confirmContractBriefing(projectId, '已核对交底版本、合同和项目来源');
  role('pmo');
  store.recordProjectG4(projectId, '通过', 'G4模拟审核通过');
  role('pm');
  store.completeStartupHandover(projectId, '王项目', '启动资料已正式接收');
  store.applyTemplate(projectId, false);
  for (const plan of store
    .project(projectId)!
    .plans.filter((p) => !['sat', 'acceptance', 'handover'].includes(p.completionKind || '')))
    store.savePlan(projectId, { ...plan, status: '已完成', actual: '2026-10-10' });
  store.simulateDocument(projectId, 'SAT报告', 'SAT.pdf');
  store.saveSat(projectId, '2026-10-10', '合格', true);
  completeCustomerAcceptance(store, projectId);
  const handover = structuredClone(store.project(projectId)!);
  handover.handover.categories = handover.handover.categories.map((category) => ({
    ...category,
    status: '已有资料',
    note: '引用本项目资料',
  }));
  store.saveHandover(projectId, handover);
  store.submitHandover(projectId);
  role('receiver');
  store.receive(projectId, '已接收', '连续主线确认');
  const completed = store.project(projectId)!;
  assert.equal(completed.status, '已移交');
  assert.equal(completed.needsReview, false);
  assert.equal(completed.plans.filter((p) => p.status === '已完成').length, 10);
  assert.equal(store.sale(leadId)!.convertedTo, opportunityId);
  assert.equal(completed.opportunityId, opportunityId);
  assert.equal(
    store.state().contracts.find((c) => c.id === completed.contractId)!.payment,
    store.quoteVersion(quoteId)!.payment,
  );
  assert.ok(
    store
      .state()
      .notices.filter((n) => n.entityId === projectId && n.key.startsWith('handover-'))
      .every((n) => n.resolved),
  );
});

test('旧合同错误付款条件按明确锁定引用兼容修正，原条款留历史且重复加载不重复修正', () => {
  const { store, opportunityId } = wonOpportunity();
  const projectId = store.bridge(opportunityId)!;
  const legacy = structuredClone(store.state());
  legacy.v4SchemaVersion = 5;
  const contract = legacy.contracts.find((c) => c.id === store.project(projectId)!.contractId)!;
  // Reproduce the exact row produced by the pre-fix bridge implementation.
  contract.payment = '签约30% / 发货60% / 验收10%（样例）';
  migrateV4(legacy);
  assert.equal(contract.payment, '100%预付');
  assert.ok(legacy.history.some((h) => h.entityId === contract.id && h.action.includes('签约30%')));
  const once = JSON.stringify(legacy);
  migrateV4(legacy);
  assert.equal(JSON.stringify(legacy), once);
});

test('旧存储中已接收但SAT或验收已失效的项目，刷新后标明复核并保留旧接收记录', () => {
  for (const reason of ['sat', 'acceptance']) {
    const { store, role } = harness();
    const id = 'DEMO-P007';
    role('pm');
    completeCustomerAcceptance(store, id);
    store.submitHandover(id);
    role('receiver');
    store.receive(id, '已接收', '旧接收意见');
    const legacy = structuredClone(store.state());
    const project = legacy.projects.find((p) => p.id === id)!;
    delete project.reviewReasons;
    if (reason === 'sat') {
      project.sat = { ...project.sat, complete: false, result: '不合格' };
      project.needsReview = true;
    } else {
      project.acceptance[0].result = '不通过';
      project.acceptanceComplete = false;
    }
    migrateV4(legacy);
    assert.equal(project.handover.status, '待复核', reason);
    assert.equal(task(project, '内部移交').status, '需复核');
    assert.ok(project.reviewReasons?.includes(reason as 'sat' | 'acceptance'));
    assert.ok(legacy.history.some((h) => h.action.includes('旧接收意见')));
    const once = JSON.stringify(legacy);
    migrateV4(legacy);
    assert.equal(JSON.stringify(legacy), once);
  }
});
