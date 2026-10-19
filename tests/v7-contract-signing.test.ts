import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BASE_DATE } from '../src/app/core/models';
import { harness, prepareSigningQuote } from './v4-harness';

function readyContract() {
  const { store, role } = harness();
  const opportunity = store.sale('DEMO-O003')!;
  store.state.update((state) => {
    const sale = state.sales.find((item) => item.id === opportunity.id)!;
    sale.stage = '合同谈判';
    sale.status = '进行中';
    sale.quoteFlowMode = 'legacy';
    state.activities.push({
      id: 'ACT-ATOMIC-SIGN',
      entityId: sale.id,
      customerId: sale.customerId,
      date: BASE_DATE,
      type: '会议',
      summary: '签约沟通',
      people: '客户采购',
      next: '签约',
      operator: '张销售',
      stage: '合同谈判',
    });
    return state;
  });
  const contractId = store.createContractDraft(opportunity.id)!;
  assert.equal(
    store.updateContractDraft(contractId, {
      title: '首项目合同',
      sellerEntity: '演示签约主体',
      scope: '储能设备供货',
      payment: '签约30%，验收70%',
    }),
    true,
  );
  prepareSigningQuote(store, contractId);
  role('manager');
  return { store, role, opportunityId: opportunity.id, contractId };
}

test('合同签约、有效赢单和首个待启动项目同次提交且幂等', () => {
  const { store, opportunityId, contractId } = readyContract();
  const beforeEvents = store.state().operationEvents?.length || 0;
  const result = store.registerContractAndStartProject(contractId, BASE_DATE, '演示签约凭据');
  assert.ok(result);
  const opportunity = store.sale(opportunityId)!;
  const contract = store.state().contracts.find((item) => item.id === contractId)!;
  const project = store.project(result.projectId)!;
  assert.equal(opportunity.stage, '赢单');
  assert.equal(opportunity.status, '已关闭');
  assert.equal(contract.status, '已登记');
  assert.equal(project.contractId, contractId);
  assert.equal(project.opportunityId, opportunityId);
  assert.equal(project.status, '待启动');
  assert.equal(contract.g3, '待显式加载模拟结果');
  assert.equal(
    project.pm,
    opportunity.pmoAssignment?.pmName ||
      opportunity.team.find((member) => member.role === 'pm')?.person ||
      '',
  );
  assert.deepEqual(project.team, opportunity.team);
  assert.equal(store.state().operationEvents?.length, beforeEvents + 1);
  const event = store.state().operationEvents!.at(-1)!;
  assert.equal(event.taskSource?.kind, 'contract-signing');
  assert.equal(event.objectId, contractId);
  assert.equal(event.mainlineId, opportunityId);
  assert.equal(event.location.section, '签约');

  assert.deepEqual(
    store.registerContractAndStartProject(contractId, BASE_DATE, '再次请求'),
    result,
  );
  assert.equal(store.state().projects.filter((item) => item.contractId === contractId).length, 1);
  assert.equal(store.state().operationEvents?.length, beforeEvents + 1);
});

test('支付主记录采用与签约快照可审计且隔离后续修订', () => {
  const { store, role, contractId } = readyContract();
  assert.deepEqual(store.paymentTerms(), [], '旧快照未包含可选支付数组时仍可读取');
  role('finance');
  const originalStorage = globalThis.localStorage;
  let persistedSnapshot = '';
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: () => null,
      setItem: (_key: string, raw: string) => (persistedSnapshot = raw),
    },
  });
  try {
    assert.equal(
      store.savePaymentTerm({
        code: 'PT-30-70',
        descriptionZh: '签约30%，验收70%',
        descriptionEn: '',
        descriptionDe: '',
        status: 'active',
        crmFields: { alp_name: 'PT-30-70' },
      }),
      true,
    );
  } finally {
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: originalStorage,
    });
  }
  const term = store.paymentTerms()[0];
  assert.ok(term.id);
  const savedState = JSON.parse(persistedSnapshot);
  assert.equal(savedState.paymentTerms[0].id, term.id);
  assert.equal(savedState.operationEvents.at(-1).taskSource.kind, 'payment-term');
  assert.equal(
    store.savePaymentMethod({
      name: '签约首付款',
      paymentTermId: term.id,
      condition: '签约后',
      method: '按比例',
      proportion: 30,
      days: null,
      fixedAmount: null,
      followFixedAmount: false,
      deliveryInFullPayment: '',
      remarks: '',
      active: true,
      crmFields: { alp_proportion: 30, alp_condition: '签约后' },
    }),
    true,
  );
  const method = store.paymentMethods(term.id)[0];
  role('sales');
  assert.equal(store.setContractPaymentSelection(contractId, term.id, [method.id]), true);
  assert.equal(
    store.state().operationEvents!.at(-1)?.taskSource?.kind,
    'contract-payment-selection',
  );
  role('manager');
  const result = store.registerContractAndStartProject(contractId, BASE_DATE, '演示签约凭据')!;
  const contract = store.state().contracts.find((item) => item.id === contractId)!;
  assert.equal(contract.paymentSnapshot?.term.id, term.id);
  assert.deepEqual(
    contract.paymentSnapshot?.methods.map((item) => item.id),
    [method.id],
  );
  assert.equal(contract.paymentSnapshot?.adoptedText, contract.payment);
  assert.equal(contract.paymentSnapshot?.adoptedBy, '张销售');
  assert.ok(
    store
      .state()
      .operationEvents!.at(-1)
      ?.changes.some((change) => change.field === 'contract.paymentSnapshot'),
  );

  role('finance');
  assert.equal(
    store.savePaymentTerm({
      id: term.id,
      code: term.code,
      descriptionZh: '修订后的条款',
      descriptionEn: '',
      descriptionDe: '',
      status: 'active',
      crmFields: term.crmFields,
    }),
    true,
  );
  const revisedTerm = store.paymentTerms()[0];
  assert.equal(revisedTerm.id, term.id);
  assert.equal(revisedTerm.revision, term.revision + 1);
  assert.equal(
    store.savePaymentMethod({
      ...method,
      id: method.id,
      name: '修订的首付款',
      crmFields: method.crmFields,
    }),
    true,
  );
  assert.equal(store.paymentMethods(term.id)[0].revision, method.revision + 1);
  assert.equal(
    store.state().contracts.find((item) => item.id === contractId)?.paymentSnapshot?.methods[0]
      .name,
    '签约首付款',
  );
  assert.equal(
    store.state().contracts.find((item) => item.id === contractId)?.paymentSnapshot?.term
      .descriptionZh,
    '签约30%，验收70%',
  );
  assert.ok(store.project(result.projectId));
});

test('签约校验失败时商机、合同、项目和事件都保持原样', () => {
  const { store, opportunityId, contractId } = readyContract();
  const before = structuredClone(store.state());
  assert.throws(
    () => store.registerContractAndStartProject(contractId, '2026-02-30', '演示签约凭据'),
    /有效日期/,
  );
  assert.equal(store.sale(opportunityId)?.stage, '合同谈判');
  assert.equal(store.state().contracts.find((item) => item.id === contractId)?.status, '草稿');
  assert.equal(store.state().projects.length, before.projects.length);
  assert.equal(store.state().operationEvents?.length, before.operationEvents?.length);
});

test('合同签约快照写入失败时不发布赢单、合同登记、项目或操作事件', () => {
  const { store, opportunityId, contractId } = readyContract();
  const before = structuredClone(store.state());
  const storage = globalThis.localStorage;
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: () => null,
      setItem: () => {
        throw new Error('存储配额不足');
      },
    },
  });
  try {
    assert.throws(
      () => store.registerContractAndStartProject(contractId, BASE_DATE, '演示签约凭据'),
      /存储配额不足/,
    );
  } finally {
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage });
  }
  assert.equal(store.sale(opportunityId)?.stage, '合同谈判');
  assert.equal(store.state().contracts.find((item) => item.id === contractId)?.status, '草稿');
  assert.equal(store.state().projects.length, before.projects.length);
  assert.equal(store.state().operationEvents?.length, before.operationEvents?.length);
});

test('旧建档旁路复用已有未关联项目和合同，不重复造记录或自动通过G3', () => {
  const { store, role } = harness();
  const opportunity = store.sale('DEMO-O003')!;
  store.state.update((state) => {
    const sale = state.sales.find((item) => item.id === opportunity.id)!;
    sale.stage = '赢单';
    sale.status = '已关闭';
    sale.quoteFlowMode = 'legacy';
    state.contracts = state.contracts.filter((item) => item.opportunityId !== sale.id);
    state.projects = state.projects.filter((item) => item.opportunityId !== sale.id);
    return state;
  });
  role('pm');
  const projectId = store.createProjectDraft('旧建档项目', '王项目', '', opportunity.id)!;
  const projectCount = store.state().projects.length;
  role('sales');
  assert.equal(store.bridge(opportunity.id), projectId);
  const project = store.project(projectId)!;
  const contract = store.state().contracts.find((item) => item.opportunityId === opportunity.id)!;
  assert.equal(project.contractId, contract.id);
  assert.equal(project.status, '待启动');
  assert.equal(contract.g3, '待显式加载模拟结果');
  assert.equal(store.state().projects.length, projectCount);
  assert.equal(store.bridge(opportunity.id), projectId);
  assert.equal(
    store.state().contracts.filter((item) => item.opportunityId === opportunity.id).length,
    1,
  );
});
