import '@angular/compiler';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { harness } from './v4-harness';
import { FiveCanKey, SolutionDocumentKind } from '../src/app/core/models';

const id = 'DEMO-O014';
const kinds: SolutionDocumentKind[] = ['技术方案', 'TIC', '设计BOM', 'SLD'];

function prepareSolution(store: ReturnType<typeof harness>['store']): void {
  const sale = store.sale(id)!;
  sale.productNeeds = [{ id: 'need-stable-1', model: 'PCS-100', quantity: 1, unit: '台' }];
  sale.productNeedRevision = 1;
  for (const kind of kinds) store.addSolutionDocument(id, kind, `${kind}-V1.pdf`, '周方案');
  assert.equal(store.confirmSolutionDocuments(id, '周方案'), true);
}

test('四类方案独立留版本；确认绑定产品修订；核价缺成本不写零价，资料变更使确认过期', () => {
  const { store } = harness();
  prepareSolution(store);
  assert.ok(store.quoteGate(id).some((item) => item.code === 'five-can-review'));
  const costing = store.recordSolutionCosting(
    id,
    { 'need-stable-1': 10000 },
    'EUR',
    '不含税报价',
    '模拟成本表',
  );
  assert.equal(costing, true);
  const row = store.solutionDocuments(id)!.costings[0].rows[0];
  assert.equal(row.coefficient, 1.2);
  assert.equal(row.guidePrice, 12000);
  assert.throws(
    () => store.recordSolutionCosting(id, { 'need-stable-1': null }, 'EUR', '不含税报价', '缺值'),
    /每个产品行/,
  );
  store.addSolutionDocument(id, 'TIC', 'TIC-V2.pdf', '周方案');
  assert.equal(
    store.solutionDocuments(id)!.versions.filter((item) => item.kind === 'TIC').length,
    2,
  );
  assert.equal(
    store.solutionDocuments(id)!.versions.filter((item) => item.kind === 'SLD').length,
    1,
  );
  assert.equal(store.solutionConfirmation(id), undefined);
});

test('五可重提保留旧未关闭条件，关闭必须有依据并解除业务检查阻断', () => {
  const { store } = harness();
  prepareSolution(store);
  const items = Object.fromEntries(
    (['可承诺', '可交付', '可运维', '可验收', '可续约'] as FiveCanKey[]).map((key) => [
      key,
      {
        result: (key === '可验收' ? '附条件' : '满足') as '附条件' | '满足',
        owner: '责任人',
        opinion: '已评估并记录依据',
      },
    ]),
  );
  store.recordFiveCan(id, '四类方案资料', items, [
    { key: '可验收', text: '补充验收记录', owner: '项目经理', due: '2026-10-20' },
  ]);
  assert.equal(store.solutionDocuments(id)!.fiveCanReviews[0].conditions[0].key, '可验收');
  const resolvedItems = Object.fromEntries(
    (['可承诺', '可交付', '可运维', '可验收', '可续约'] as FiveCanKey[]).map((key) => [
      key,
      { result: '满足' as const, owner: '责任人', opinion: '已完成复核' },
    ]),
  );
  store.recordFiveCan(id, '重新提交资料', resolvedItems, []);
  const reviews = store.solutionDocuments(id)!.fiveCanReviews;
  assert.equal(reviews[0].conditions[0].closed, false);
  assert.ok(store.quoteGate(id).some((item) => item.code === 'five-can-conditions'));
  assert.throws(
    () => store.closeFiveCanCondition(id, reviews[0].id, reviews[0].conditions[0].id, ''),
    /关闭依据/,
  );
  store.closeFiveCanCondition(id, reviews[0].id, reviews[0].conditions[0].id, '会议纪要确认已补齐');
  assert.equal(store.solutionDocuments(id)!.fiveCanReviews[0].conditions[0].closed, true);
  assert.ok(!store.quoteGate(id).some((item) => item.code === 'five-can-conditions'));
});

test('行折扣按降价比例计算；低价特批退回可重提但同版成功次数不可重置', () => {
  const { store } = harness();
  prepareSolution(store);
  store.recordSolutionCosting(id, { 'need-stable-1': 10000 }, 'EUR', '不含税报价', '模拟成本表');
  const version = store.quoteSeries(id)!.versions[0];
  version.status = '草稿';
  version.currency = 'EUR';
  version.taxMode = '不含税报价';
  version.costingId = store.solutionDocuments(id)!.costings[0].id;
  version.items = [
    {
      id: 'quote-row-1',
      productNeedId: 'need-stable-1',
      category: '货物',
      name: 'PCS-100',
      spec: '',
      unit: '台',
      quantity: 1,
      unitPrice: 13000,
      discountPercent: 10,
      guidePrice: 12000,
      guideCurrency: 'EUR',
      guideUnit: '台',
      guideQuantity: 1,
      guideTaxBasis: '不含税报价',
      guideCostingId: version.costingId,
      source: '商机产品行 need-stable-1',
    },
  ];
  assert.equal(store.quoteTotals(version).net, 11700);
  assert.equal(store.guideComparison(version.items[0], version), '低于指导价');
  assert.equal(store.requestLowPriceApproval(version.id, '演示申请', '2026-12-31'), true);
  store.decideLowPriceApproval(version.id, '退回', '请说明客户依据');
  store.requestLowPriceApproval(version.id, '补充申请', '2026-12-31');
  store.decideLowPriceApproval(version.id, '通过', '模拟通过');
  assert.equal(store.quoteVersion(version.id)!.discountApprovalCount, 1);
  assert.throws(
    () => store.requestLowPriceApproval(version.id, '再次申请', '2026-12-31'),
    /已成功特批/,
  );
  assert.throws(
    () => store.saveQuoteCosts(version.id, store.quoteVersion(version.id)!.costs),
    /已成功/,
  );
  store.addSolutionDocument(id, 'TIC', 'TIC-V2.pdf', '周方案');
  assert.equal(store.quoteVersion(version.id)!.discountApprovalCount, 1);
  const nextId = store.createQuoteVersion(version.id, '核价依据已变化');
  assert.ok(nextId);
  assert.equal(store.quoteVersion(nextId!)!.discountApprovalCount, 0);
  assert.deepEqual(store.quoteVersion(nextId!)!.discountApprovals, []);
});
