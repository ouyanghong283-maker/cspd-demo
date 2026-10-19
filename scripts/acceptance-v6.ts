import '@angular/compiler';
import { Injector, runInInjectionContext } from '@angular/core';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { DemoStore } from '../src/app/core/store';
import { UiService } from '../src/app/core/ui.service';
import { FilesService } from '../src/app/core/files.service';
import { blankSales, blankPlan, newId } from '../src/app/core/seed';
import { BASE_DATE, ROLES, HANDOVER_TYPES } from '../src/app/core/models';
import { threeMonthForecast } from '../src/app/core/rules';
import { MainlineGuide } from '../src/app/features/mainline-guide';
import { Router } from '@angular/router';
import { BusinessForms } from '../src/app/core/forms';

const persisted = new Map<string, string>();
let failWrites = false;
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: {
    getItem: (key: string) => persisted.get(key) ?? null,
    setItem: (key: string, value: string) => {
      if (failWrites) throw new Error('模拟保存失败');
      persisted.set(key, value);
    },
    removeItem: (key: string) => persisted.delete(key),
    clear: () => persisted.clear(),
  },
});
const results: {
  id: string;
  tickets: number[];
  name: string;
  result: string;
  error?: string;
  actual?: unknown;
}[] = [];
const objects: Record<string, string> = {};
let message = '';
function context(clear = true) {
  if (clear) persisted.clear();
  const injector = Injector.create({
    providers: [
      {
        provide: UiService,
        useValue: {
          notify(text: string) {
            message = text;
          },
          fail(text: string) {
            message = text;
            return false;
          },
        },
      },
      { provide: FilesService, useValue: { clearAll: async () => {} } },
    ],
  });
  return runInInjectionContext(injector, () => new DemoStore());
}
function act<T>(value: T): NonNullable<T> {
  if (value === false || value === null || value === undefined)
    throw new Error(message || '操作失败');
  return value as NonNullable<T>;
}
function check(id: string, tickets: number[], name: string, run: () => unknown) {
  try {
    const actual = run();
    results.push({
      id,
      tickets,
      name,
      result: '通过',
      ...(actual === undefined ? {} : { actual }),
    });
    console.log('PASS', id, name);
  } catch (error) {
    results.push({
      id,
      tickets,
      name,
      result: '失败',
      error: error instanceof Error ? error.message : String(error),
    });
    console.log('FAIL', id, name, error instanceof Error ? error.message : error);
  }
}
const store = context();
let chainActive = true;
function step(id: string, tickets: number[], name: string, run: () => unknown) {
  if (!chainActive) {
    results.push({ id, tickets, name, result: '上游阻塞' });
    return;
  }
  check(id, tickets, name, () => {
    try {
      return run();
    } catch (e) {
      chainActive = false;
      throw e;
    }
  });
}
step(
  'CHAIN-01',
  [1, 12],
  '动态新建客户、联系人和线索，仅转客户后复用同一主体转商机，重复操作幂等',
  () => {
    store.setRole('sales');
    const customerId = newId('AUDIT-C');
    const contactId = newId('AUDIT-CT');
    act(
      store.saveCustomer({
        id: customerId,
        name: '全链条验收客户',
        shortName: '验收客户',
        country: '中国',
        industry: '演示',
        address: '模拟地址',
        contacts: [
          {
            id: contactId,
            name: '验收联系人',
            title: '采购',
            department: '采购',
            position: '经理',
            phone: '10000000000',
            email: 'audit@example.invalid',
            purchasingRole: '人工确认采购参与',
          },
        ],
      }),
    );
    const lead = {
      ...blankSales(newId('AUDIT-L'), customerId, 'lead'),
      contactId,
      projectName: '全链条隔离验收项目',
      crmSource: '自有开发' as const,
      source: '自有开发',
      description: '模拟储能需求',
      capacity: 10,
      amount: 120000,
      expectedDate: '2026-11-15',
    };
    act(store.saveSales(lead));
    act(store.simulateDocument(lead.id, '需求导入表', '验收需求.xlsx'));
    act(store.convertToCustomer(lead.id));
    assert.equal(store.convertToCustomer(lead.id), customerId);
    const opportunityId = act(store.convert(lead.id));
    assert.equal(store.convert(lead.id), opportunityId);
    assert.equal(store.sale(opportunityId)!.contactId, contactId);
    assert.ok(!store.sale(opportunityId)!.submittedAt);
    Object.assign(objects, { customerId, contactId, leadId: lead.id, opportunityId });
    act(
      store.saveSales({
        ...store.sale(opportunityId)!,
        grade: 'A',
        tender: '否',
        tradeTerm: 'FOB',
        currency: 'CNY',
      }),
    );
    return objects;
  },
);
step('CHAIN-02', [2], '缺初判阻断；补需求与证据后有效提交，重复提交不重复产生PMO待办', () => {
  const id = objects.opportunityId;
  act(
    store.saveProductNeed(id, {
      id: newId('AUDIT-NEED'),
      model: 'PCS-100',
      quantity: 2,
      unit: '台',
    }),
  );
  assert.equal(store.submitOpportunity(id), false);
  store.setRole('solution');
  for (const kind of ['核心技术方案', 'BOM清单', '单线图（SLD）', '衰减曲线'])
    act(store.simulateDocument(id, kind, `验收-${kind}.pdf`));
  act(
    store.saveTechnicalAssessment(id, {
      result: '满足',
      owner: '周方案',
      opinion: '模拟验收：当前需求可行',
      evidenceAttachmentIds: store
        .quoteSourceCandidates(id)
        .filter((x) => ['核心技术方案', 'BOM清单', '单线图（SLD）', '衰减曲线'].includes(x.kind))
        .map((x) => x.id),
    }),
  );
  act(store.submitOpportunity(id));
  act(store.submitOpportunity(id));
  assert.equal(store.state().notices.filter((x) => x.key === `valid-submission-${id}`).length, 1);
  assert.equal(store.sale(id)!.grade, 'A');
});
step('CHAIN-03', [3], 'PMO指派、参与确认和任务完成独立，补齐适用任务后进入方案阶段', () => {
  const id = objects.opportunityId;
  act(store.assignOpportunityPM(id, 'pm', '王项目', '模拟人员窗口'));
  act(
    store.assignTeam(id, [
      {
        id: newId('AUDIT-TM'),
        role: 'solution',
        person: '周方案',
        department: '解决方案',
        window: '模拟窗口',
        confirmed: false,
        confirmedBy: '',
      },
    ]),
  );
  act(store.confirmTeam(id, store.sale(id)!.team[0].id));
  assert.equal(store.sale(id)!.departmentTasks![0].status, '待开始');
  assert.equal(store.advance(id), false);
  act(store.completeDepartmentTask(id, store.sale(id)!.departmentTasks![0].id));
  act(store.advance(id));
  assert.equal(store.sale(id)!.stage, '方案报价');
});
step('CHAIN-04', [4], '四类方案版本确认、逐产品行核价和五可会签', () => {
  const id = objects.opportunityId;
  for (const kind of ['技术方案', 'TIC', '设计BOM', 'SLD'] as const)
    act(store.addSolutionDocument(id, kind, `验收${kind}.pdf`, '周方案'));
  act(store.confirmSolutionDocuments(id, '周方案'));
  const need = store.sale(id)!.productNeeds![0];
  assert.equal(
    store.recordSolutionCosting(id, { [need.id]: null }, 'CNY', '不含税报价', '模拟成本表'),
    false,
  );
  act(store.recordSolutionCosting(id, { [need.id]: 10000 }, 'CNY', '不含税报价', '模拟成本表'));
  const items = Object.fromEntries(
    ['可承诺', '可交付', '可运维', '可验收', '可续约'].map((key) => [
      key,
      { result: '满足', owner: '验收责任人', opinion: '模拟依据' },
    ]),
  );
  act(store.recordFiveCan(id, '模拟会签资料', items as never, []));
  act(store.uploadSolution(id, '验收核心方案.pdf', '周方案'));
  return store.solutionDocuments(id)!.costings.at(-1);
});
step(
  'CHAIN-05',
  [5, 6],
  '动态低价报价、特批退回重提及一次成功、普通审核、发出、接受和唯一成交锁定',
  () => {
    const id = objects.opportunityId;
    store.setRole('sales');
    act(
      store.saveServiceTerms({
        ...store.terms(id),
        years: 2,
        scope: '设备质量',
        sla: '模拟响应约定',
      }),
    );
    act(store.confirmServiceTerms(id, store.terms(id).revision));
    act(
      store.saveAgreement({
        ...store.agreement(id),
        applicability: '不购买',
        reason: '本例不购买运维协议',
      }),
    );
    act(store.confirmAgreement(id, store.agreement(id).revision));
    const quoteId = act(store.createQuote(id));
    const quote = structuredClone(store.quoteVersion(quoteId)!);
    assert.equal(quote.items[0].productNeedId, store.sale(id)!.productNeeds![0].id);
    quote.items[0].unitPrice = 13000;
    quote.items[0].discountPercent = 10;
    Object.assign(quote, {
      sellerEntity: '验收模拟主体',
      validUntil: '2026-12-31',
      scope: '模拟储能设备供货',
      delivery: '模拟交期',
      payment: '30%预付，70%验收后',
      warranty: '2年（模拟）',
      solutionSummary: '模拟方案',
      boundaries: '演示设备范围',
      taxNote: '模拟财务核对',
    });
    act(store.saveQuote(quote));
    store.setRole('finance');
    act(store.confirmQuoteTax(quoteId, '样例已确认', '模拟税费核对'));
    assert.equal(store.quoteTotals(store.quoteVersion(quoteId)!).net, 23400);
    assert.equal(
      store.guideComparison(store.quoteVersion(quoteId)!.items[0], store.quoteVersion(quoteId)!),
      '低于指导价',
    );
    act(store.requestLowPriceApproval(quoteId, '模拟低价申请', '2026-12-31'));
    act(store.decideLowPriceApproval(quoteId, '退回', '请补充依据'));
    act(store.requestLowPriceApproval(quoteId, '补充模拟客户依据', '2026-12-31'));
    act(store.decideLowPriceApproval(quoteId, '通过', '模拟特批通过'));
    assert.equal(store.quoteVersion(quoteId)!.discountApprovalCount, 1);
    assert.equal(store.requestLowPriceApproval(quoteId, '重复申请', '2026-12-31'), false);
    store.setRole('sales');
    act(store.submitQuote(quoteId));
    store.setRole('manager');
    act(store.reviewQuote(quoteId, '模拟审核通过', '模拟通过'));
    store.setRole('sales');
    act(store.recordQuoteSent(quoteId, BASE_DATE, '手工登记', '验收联系人', '模拟客户送达凭据'));
    act(
      store.addQuoteFeedback(quoteId, {
        date: BASE_DATE,
        kind: '客户确认接受',
        summary: '模拟接受',
        person: '验收联系人',
        evidence: '模拟回函',
      }),
    );
    act(store.requestQuoteLock(quoteId));
    store.setRole('manager');
    act(store.lockQuote(quoteId));
    objects.quoteId = quoteId;
    store.setRole('sales');
    act(store.advance(id));
    act(
      store.addActivity(id, {
        date: BASE_DATE,
        type: '会议',
        summary: '模拟洽谈结论',
        people: '验收联系人',
        next: '合同谈判',
      }),
    );
    act(store.advance(id));
    act(
      store.addActivity(id, {
        date: BASE_DATE,
        type: '会议',
        summary: '模拟合同条款确认',
        people: '验收联系人',
        next: '登记签约',
      }),
    );
    return {
      quoteId,
      status: store.quoteVersion(quoteId)!.status,
      opportunityStage: store.sale(id)!.stage,
    };
  },
);
step('CHAIN-06', [7, 14], '从成交报价建合同草稿和商机粗计划', () => {
  act(
    store.saveOpportunityRoughPlan(objects.opportunityId, {
      id: newId('AUDIT-RP'),
      wbsCode: '1.1',
      name: '模拟资料准备',
      owner: '王项目',
      start: BASE_DATE,
      end: '2026-10-20',
      durationDays: 10,
      predecessor: '',
      relationNote: '无前置',
      note: '模拟窗口',
      weekWindow: '模拟第42周',
      sourceReference: '计划模板：标准储能项目粗计划',
      sourceType: '参考模板',
      sourceTemplateId: 'DEMO-RPT-STANDARD',
    }),
  );
  objects.contractId = act(store.createContractDraft(objects.opportunityId));
  act(store.updateContractDraft(objects.contractId, { sellerEntity: '验收模拟主体' }));
  assert.equal(store.sale(objects.opportunityId)!.stage, '合同谈判');
});
// Record the requested sequence failure without masking it with an alternate sequence.
if (chainActive)
  check('REQ-07-REGISTER', [7, 11], '登记合同应同次形成赢单及首项目；登记前不需单独赢单', () => {
    store.setRole('manager');
    act(store.registerContract(objects.contractId, BASE_DATE, '模拟签约凭据'));
    assert.equal(store.sale(objects.opportunityId)!.stage, '赢单');
    assert.equal(
      store.state().projects.filter((p) => p.contractId === objects.contractId).length,
      1,
    );
  });
step(
  'CHAIN-07-DIAGNOSTIC',
  [7],
  '诊断续跑：按现有旧顺序显式赢单、登记、创建项目（不计票据07通过）',
  () => {
    store.setRole('sales');
    act(store.closeSale(objects.opportunityId, '赢单', '模拟成交', BASE_DATE, ''));
    store.setRole('manager');
    act(store.registerContract(objects.contractId, BASE_DATE, '模拟签约凭据'));
    store.setRole('pm');
    objects.projectId = act(
      store.createProjectForContract(objects.contractId, '隔离验收项目', '王项目', '模拟现场'),
    );
    assert.equal(
      store.project(objects.projectId)!.plans[0].sourceOpportunityPlanId,
      store.sale(objects.opportunityId)!.opportunityRoughPlans![0].id,
    );
  },
);
step('CHAIN-08', [8, 14], '缺启动资料阻断，补启动资料和交底后进入项目执行；计划独立编辑', () => {
  const id = objects.projectId;
  act(store.acceptProject(id));
  assert.equal(store.submitBriefing(id), false);
  act(
    store.saveProject({
      ...store.project(id)!,
      start: BASE_DATE,
      briefing: { ...store.project(id)!.briefing, acceptance: '模拟验收标准' },
    }),
  );
  act(store.simulateDocument(id, '启动纪要', '模拟启动纪要.pdf'));
  act(store.simulateDocument(id, '启动文件', '模拟启动文件.pdf'));
  act(store.submitBriefing(id));
  store.setRole('pmo');
  act(store.review(id, '通过', '模拟交底核对'));
  store.setRole('pm');
  const plan = store.project(id)!.plans[0];
  act(store.savePlan(id, { ...plan, name: '项目侧独立变更', expected: '2026-10-21' }));
  assert.equal(store.sale(objects.opportunityId)!.opportunityRoughPlans![0].name, '模拟资料准备');
  act(store.applicability(id, false, '演示标准产品，无独立产研计划'));
  store.setRole('finance');
  act(store.loadFinance(id));
  store.setRole('pm');
});
step('CHAIN-09', [15], '项目风险、客户沟通、SN记录有来源和历史；未填写实际日期不自动补日期', () => {
  const id = objects.projectId;
  act(
    store.addProjectRisk(id, {
      category: '待核类别',
      level: '待核等级',
      likelihood: '待核可能性',
      status: '待核状态',
      description: '模拟项目风险',
      sourceReference: '台账待核',
    }),
  );
  act(
    store.addProjectCommunication(id, {
      type: '执行情况',
      date: '2026-10-08',
      summary: '模拟执行沟通',
      sourceReference: '会议纪要待核',
    }),
  );
  act(
    store.addEquipmentSerial(id, {
      serialNumber: '模拟SN-001',
      model: 'PCS-100',
      quantity: 2,
      status: '待核',
      siteLocation: '模拟现场',
      actualDate: '',
      sourceReference: '设备台账待核',
    }),
  );
  const sn = store.project(id)!.equipmentSerialRecords![0];
  assert.equal(sn.actualDate, '');
  assert.equal(sn.projectId, id);
  assert.equal(sn.contractId, objects.contractId);
  assert.ok(store.history(id).some((h) => h.action.includes('SN记录')));
});
step('CHAIN-10', [9], 'SAT失败历史保留；SAT和客户逐项验收分别完成', () => {
  const id = objects.projectId;
  act(store.applyTemplate(id, false));
  act(store.saveSat(id, '2026-10-08', '不合格', false));
  assert.equal(store.submitHandover(id), false);
  act(store.simulateDocument(id, 'SAT报告', '模拟SAT报告.pdf'));
  act(store.saveSat(id, '2026-10-08', '合格', true));
  assert.equal(store.project(id)!.acceptanceComplete, false);
  for (const item of store.project(id)!.acceptance)
    act(
      store.saveAcceptance(id, item.id, '通过', '模拟客户', '2026-10-08', '引用模拟逐项验收清单'),
    );
  act(store.simulateDocument(id, '客户签字清单', '模拟客户签字清单.pdf'));
  act(store.completeAcceptance(id));
  assert.ok(store.history(id).some((h) => h.action.includes('不合格')));
});
step('CHAIN-11', [9, 10], '八类移交资料、明确无待办、申请待接收和接收独立事实', () => {
  const id = objects.projectId;
  const project = structuredClone(store.project(id)!);
  project.handover.categories = HANDOVER_TYPES.map((name) => ({
    name,
    status: '已有资料',
    note: name === '待办' ? '无' : '引用本项目模拟资料',
  }));
  act(store.saveHandover(id, project));
  act(store.submitHandover(id));
  assert.equal(store.project(id)!.handover.status, '待接收');
  store.setRole('receiver');
  act(store.receive(id, '已接收', '模拟接收确认'));
  assert.equal(store.project(id)!.handover.status, '已接收');
});
step('CHAIN-12', [11], '刷新重载保留动态客户、商机、合同、项目及执行来源关联', () => {
  const reloaded = context(false);
  assert.equal(reloaded.project(objects.projectId)!.contractId, objects.contractId);
  assert.equal(reloaded.project(objects.projectId)!.opportunityId, objects.opportunityId);
  assert.equal(reloaded.sale(objects.opportunityId)!.leadId, objects.leadId);
  assert.equal(
    reloaded.project(objects.projectId)!.equipmentSerialRecords![0].sourceStatus,
    '待核',
  );
});
if (chainActive)
  check('REQ-10-SUMMARY', [10, 11], '已接收项目提供181–185来源汇总、同源同步和失败保留接口', () => {
    const methods = Object.getOwnPropertyNames(DemoStore.prototype).filter((name) =>
      /service.*(sync|summary)|sync.*service/i.test(name),
    );
    assert.ok(methods.length, '缺少181–185服务汇总/同步模型和操作接口；当前页面仅展示成交服务摘要');
  });
fs.writeFileSync('artifacts/acceptance-chain-state.json', JSON.stringify(store.state(), null, 2));

check('REQ-11-GUIDE', [11], '主线指南采用本轮动态对象并覆盖至运维汇总', () => {
  const injector = Injector.create({
    providers: [
      { provide: DemoStore, useValue: store },
      { provide: Router, useValue: { navigate() {} } },
    ],
  });
  const guide = runInInjectionContext(injector, () => new MainlineGuide());
  const flow = guide.flow();
  assert.ok(
    flow.url.includes(objects.leadId) ||
      flow.url.includes(objects.opportunityId) ||
      flow.url.includes(objects.projectId),
    `本轮项目已接收，但指南仍指向${flow.url}，共${flow.steps.length}步`,
  );
});
check('REQ-01-AFTERCUSTOMER', [1], '只转客户后仍能补需求资料再转商机', () => {
  const s = context();
  s.setRole('sales');
  const customer = s.state().customers[0];
  const lead = {
    ...blankSales(newId('AUDIT-AFTER-CUSTOMER'), customer.id, 'lead'),
    contactId: customer.contacts[0].id,
    crmSource: '自有开发' as const,
  };
  act(s.saveSales(lead));
  act(s.convertToCustomer(lead.id));
  act(s.simulateDocument(lead.id, '需求导入表', '补充需求.xlsx'));
  act(s.convert(lead.id));
});

check(
  'REQ-11-ROLES',
  [1, 2, 3, 7, 8, 9, 10, 11],
  '13个演示角色均可维护本地WBS（保留产研来源只读）',
  () => {
    const s = context();
    const plan = blankPlan('内部WBS');
    const matrix = ROLES.map((role) => {
      s.setRole(role.id);
      return { role: role.id, canEdit: s.canEditPlan(plan) };
    });
    fs.writeFileSync('artifacts/acceptance-role-matrix.json', JSON.stringify(matrix, null, 2));
    assert.ok(
      matrix.every((row) => row.canEdit),
      JSON.stringify(matrix),
    );
  },
);
check('REQ-07-DRAFT', [7], '没有唯一成交报价时不能创建有效来源合同草稿', () => {
  const s = context();
  s.setRole('sales');
  assert.equal(
    s.createContractDraft('DEMO-O001'),
    null,
    '无成交报价仍创建合同草稿，退回商机金额作为合同来源',
  );
});
function projectForHandover(completeAcceptance: boolean) {
  const s = context();
  s.setRole('pm');
  const id = act(s.createProjectDraft('移交阻断验收', '王项目', '模拟现场'));
  act(s.simulateDocument(id, 'SAT报告', '模拟SAT.pdf'));
  act(s.saveSat(id, '2026-10-08', '合格', true));
  if (completeAcceptance) {
    for (const item of s.project(id)!.acceptance)
      act(s.saveAcceptance(id, item.id, '通过', '模拟客户', '2026-10-08', '模拟凭据'));
    act(s.simulateDocument(id, '客户签字清单', '模拟清单.pdf'));
    act(s.completeAcceptance(id));
  }
  const p = structuredClone(s.project(id)!);
  p.handover.categories = HANDOVER_TYPES.map((name) => ({
    name,
    status: '已有资料',
    note: name === '待办' ? '无' : '模拟引用',
  }));
  act(s.saveHandover(id, p));
  return { s, id };
}
check('REQ-09-CUSTOMER', [9], '客户验收未完成时必须阻断移交申请', () => {
  const { s, id } = projectForHandover(false);
  assert.equal(s.project(id)!.acceptanceComplete, false);
  assert.equal(s.submitHandover(id), false, '仅SAT完成且八类状态填写即可提交；未检查客户验收完成');
});
check('REQ-09-EIGHTH', [9], '第八类待办空白不能等同无待办', () => {
  const { s, id } = projectForHandover(true);
  const p = structuredClone(s.project(id)!);
  p.handover.categories.find((x) => x.name === '待办')!.note = '';
  act(s.saveHandover(id, p));
  assert.equal(s.submitHandover(id), false, '第八类说明为空仍可移交');
});
check('REQ-15-ACTUAL', [8, 9, 15], '客户验收节点实际日期采用明确签认日期，不采用演示基准日', () => {
  const { s, id } = projectForHandover(true);
  act(s.applyTemplate(id, false));
  const node = s.project(id)!.plans.find((x) => x.completionKind === 'acceptance')!;
  assert.equal(node.actual, '2026-10-08');
  act(s.completeAcceptance(id));
  assert.equal(
    s.project(id)!.plans.find((x) => x.id === node.id)!.actual,
    '2026-10-08',
    '重复确认把实际日期改成基准日',
  );
});
check('REQ-11-SAVEFAIL', [1, 11, 15], '持久化失败不发布半条客户修改，原状态和引用保留', () => {
  const s = context();
  const before = structuredClone(s.state());
  failWrites = true;
  try {
    assert.equal(s.saveCustomer({ ...s.state().customers[0], name: '不得发布的修改' }), false);
    assert.deepEqual(s.state(), before);
  } finally {
    failWrites = false;
  }
});
check('REQ-04-FIVEITEMS', [4], '五可会签不能保存缺少五项结果的空会签', () => {
  const s = context();
  const id = 'DEMO-O001';
  act(
    s.saveProductNeed(id, {
      id: newId('AUDIT-FIVE-NEED'),
      model: 'PCS-100',
      quantity: 1,
      unit: '台',
    }),
  );
  for (const kind of ['技术方案', 'TIC', '设计BOM', 'SLD'] as const)
    act(s.addSolutionDocument(id, kind, '模拟' + kind + '.pdf', '周方案'));
  act(s.confirmSolutionDocuments(id, '周方案'));
  assert.equal(
    s.recordFiveCan(id, '模拟会签来源', {} as never, []),
    false,
    '空对象缺少全部五可项仍被保存',
  );
});
check('REQ-12-RELATION', [12], '联系人重命名后关系地图显示同一联系人当前名称', () => {
  const s = context();
  const id = 'DEMO-O001';
  const sale = s.sale(id)!;
  const customer = structuredClone(s.customer(sale.customerId)!);
  const contact = customer.contacts.find((c) => c.id === sale.contactId)!;
  const mapId = newId('AUDIT-MAP');
  act(
    s.saveCustomerRole(id, {
      id: mapId,
      contact: contact.name,
      role: '待核角色',
      attitude: '待核',
      impact: '来源待核',
    }),
  );
  contact.name = '重命名后的验收联系人';
  act(s.saveCustomer(customer));
  assert.equal(
    s.sale(id)!.customerRoles.find((row) => row.id === mapId)!.contact,
    contact.name,
    '关系地图以联系人显示名称保存，重命名后仍显示旧名称',
  );
});
check('REQ-01-PURCHASING', [1, 12], '改联系人职务不会自动改变销售人工填写的采购作用', () => {
  const s = context();
  const customer = structuredClone(s.state().customers[0]);
  const contact = customer.contacts[0];
  contact.purchasingRole = '人工确认：采购资料参与';
  act(s.saveCustomer(customer));
  const changed = structuredClone(s.customer(customer.id)!);
  changed.contacts[0].title = '总经理';
  changed.contacts[0].position = '新岗位';
  act(s.saveCustomer(changed));
  assert.equal(s.customer(customer.id)!.contacts[0].id, contact.id);
  assert.equal(s.customer(customer.id)!.contacts[0].purchasingRole, '人工确认：采购资料参与');
});
check('REQ-11-EXCLUDED', [11], '商机编辑表单不重新纳入已排除的22号竞争对手字段', () => {
  const s = context();
  let request: { fields: { key: string }[] } | undefined;
  const injector = Injector.create({
    providers: [
      { provide: DemoStore, useValue: s },
      { provide: Router, useValue: {} },
      {
        provide: UiService,
        useValue: {
          open(value: typeof request) {
            request = value;
          },
        },
      },
    ],
  });
  const form = runInInjectionContext(injector, () => new BusinessForms());
  form.editSales(s.sale('DEMO-O001')!);
  assert.ok(
    !request!.fields.some((field) => field.key === 'competitor'),
    '当前表单仍显示竞争对手（可选）',
  );
});
check('REQ-13-FORECAST', [13], '三个月预测保留原金额容量负责人，不按人工等级与阶段加权', () => {
  const record = {
    ...blankSales(newId('AUDIT-FORECAST'), 'customer', 'opportunity'),
    amount: 100000,
    capacity: 8,
    expectedDate: '2026-11-01',
    grade: 'S',
    owner: '人工销售',
  };
  const row = threeMonthForecast([record])[0];
  assert.equal(row.sale.amount, 100000);
  assert.equal(row.sale.capacity, 8);
  assert.equal(row.sale.owner, '人工销售');
});
const report = {
  runAt: new Date().toISOString(),
  method: '真实DemoStore运行时＋隔离内存localStorage；通过公开业务方法操作；非浏览器端到端',
  objects,
  requestedChain:
    results.find((x) => x.id === 'REQ-07-REGISTER')?.result === '通过' &&
    results.find((x) => x.id === 'REQ-10-SUMMARY')?.result === '通过'
      ? '通过'
      : '失败',
  diagnosticContinuation: chainActive ? '已到明确运维接收，服务汇总缺失' : '中断',
  results,
};
fs.writeFileSync('artifacts/acceptance-v6-results.json', JSON.stringify(report, null, 2));
console.log(
  JSON.stringify(
    {
      checks: results.length,
      passed: results.filter((x) => x.result === '通过').length,
      failed: results.filter((x) => x.result === '失败').length,
      objects,
      diagnosticContinuation: report.diagnosticContinuation,
    },
    null,
    2,
  ),
);
process.exitCode = results.some((result) => result.result === '失败') ? 1 : 0;
