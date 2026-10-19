import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BASE_DATE } from '../src/app/core/models';
import { harness, prepareSigningQuote } from './v4-harness';

test('合同草稿不作为项目来源；签约、G3与项目创建分开，合同可关联多个项目', () => {
  const { store, role } = harness();
  const opportunity = store.sale('DEMO-O001')!;
  opportunity.stage = '赢单';
  opportunity.status = '已关闭';
  const startingProjects = store.state().projects.length;

  const contractId = store.createContractDraft(opportunity.id)!;
  assert.ok(contractId);
  assert.equal(store.state().contracts.find((item) => item.id === contractId)?.status, '草稿');
  assert.equal(store.state().contracts.find((item) => item.id === contractId)?.g3, '未加载');
  assert.equal(store.createContractDraft(opportunity.id), contractId, '重复创建应复用同一合同');
  assert.equal(store.state().projects.length, startingProjects, '创建草稿不能创建项目');
  assert.throws(() => store.bridge(opportunity.id), /合同草稿/);

  assert.equal(
    store.updateContractDraft(contractId, {
      sellerEntity: '演示签约主体',
      scope: '储能设备供货',
      payment: '签约30%，验收70%',
    }),
    true,
  );
  prepareSigningQuote(store, contractId);
  role('manager');
  assert.equal(store.registerContract(contractId, BASE_DATE, '演示签约凭据 CON-001'), true);
  assert.equal(store.state().contracts.find((item) => item.id === contractId)?.status, '已登记');
  assert.equal(
    store.state().contracts.find((item) => item.id === contractId)?.g3,
    '待显式加载模拟结果',
  );
  assert.equal(store.loadContractG3(contractId), true);
  assert.equal(
    store.state().contracts.find((item) => item.id === contractId)?.g3,
    '已通过（模拟）',
  );

  role('pm');
  const first = store.createProjectForContract(contractId, '合同项目一', '王项目')!;
  const second = store.createProjectForContract(contractId, '合同项目二', '王项目')!;
  assert.notEqual(first, second);
  assert.equal(store.project(first)?.contractId, contractId);
  assert.equal(store.project(second)?.contractId, contractId);

  const draft = store.createProjectDraft('已有项目草稿', '王项目', '', opportunity.id)!;
  assert.equal(store.associateProjectToContract(draft, contractId), true);
  assert.equal(store.project(draft)?.contractId, contractId);
  const unrelated = store.createProjectDraft('其他来源草稿', '王项目', '', 'DEMO-O002')!;
  assert.throws(
    () => store.associateProjectToContract(unrelated, contractId),
    /来源商机或客户主体不一致/,
  );
});

test('V2合同登记读取当前有效锁定报价并固定成交服务快照', () => {
  const { store, role } = harness();
  const opportunity = store.sale('DEMO-O005')!;
  const series = store.quoteSeries(opportunity.id)!;
  const quote = store.quoteVersion(series.activeFinalVersionId)!;
  assert.equal(quote.status, '最终锁定');

  store.state.update((state) => {
    state.contracts = state.contracts.filter((item) => item.opportunityId !== opportunity.id);
    return state;
  });
  const contractId = store.createContractDraft(opportunity.id)!;
  let contract = store.state().contracts.find((item) => item.id === contractId)!;
  assert.equal(contract.quoteVersionId, quote.id);
  assert.equal(contract.amount, store.quoteTotals(quote).total);

  assert.equal(store.updateContractDraft(contractId, { sellerEntity: '演示签约主体' }), true);
  role('manager');
  assert.equal(store.registerContract(contractId, BASE_DATE, '报价成交签约凭据'), true);
  contract = store.state().contracts.find((item) => item.id === contractId)!;
  assert.equal(contract.quoteVersionId, quote.id);
  assert.equal(contract.quoteSeriesId, series.id);
  assert.equal(contract.amount, store.quoteTotals(quote).total);
  assert.equal(contract.currency, quote.currency);
  assert.equal(contract.payment, quote.payment);
  assert.deepEqual(contract.serviceSnapshot, {
    quoteVersionId: quote.id,
    warranty: quote.warranty,
    sla: quote.service,
    scope: quote.scope,
  });
});
