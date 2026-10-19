import '@angular/compiler';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { harness } from './v4-harness';
import { readyOpportunity } from './opportunity-collaboration-fixture';
import { PRODUCT_CATALOG, selectableProducts } from '../src/app/core/product-catalog';

test('线索可仅转客户且重复提交复用同一客户，不生成商机', () => {
  const { store } = harness();
  const lead = store.sale('DEMO-L001')!;
  const customerId = store.convertToCustomer(lead.id);
  assert.equal(customerId, lead.customerId);
  assert.equal(store.convertToCustomer(lead.id), customerId);
  assert.equal(store.sale(lead.id)!.conversionKind, 'customer');
  assert.equal(
    store.state().sales.filter((sale) => sale.type === 'opportunity' && sale.leadId === lead.id)
      .length,
    0,
  );
});

test('产品需求使用稳定行ID，变更需求后旧初判保留但不能用于有效提交', () => {
  const { store, id } = readyOpportunity();
  const evidence = store
    .quoteSourceCandidates(id)
    .filter((item) => ['核心技术方案', 'BOM清单', '单线图（SLD）', '衰减曲线'].includes(item.kind));
  assert.equal(evidence.length, 4);
  assert.equal(
    store.saveProductNeed(id, {
      id: 'need-stable-1',
      model: 'ALPHA-PCS-1250',
      quantity: 2,
      unit: '台',
    }),
    true,
  );
  assert.equal(store.sale(id)!.productNeeds?.[0].name, '储能变流器 1250kW');
  assert.equal(
    store.saveTechnicalAssessment(id, {
      result: '满足',
      owner: '周方案',
      opinion: '当前配置可行',
      evidenceAttachmentIds: evidence.map((item) => item.id),
    }),
    true,
  );
  const revision = store.sale(id)!.productNeedRevision;
  assert.equal(store.submitOpportunity(id), true);
  assert.ok(store.sale(id)!.submittedAt);
  assert.equal(
    store.saveProductNeed(id, {
      id: 'need-stable-1',
      model: 'ALPHA-PCS-2500',
      name: '储能变流升压一体机 2500kW',
      quantity: 3,
      unit: '台',
    }),
    true,
  );
  const changed = store.sale(id)!;
  assert.equal(changed.productNeeds?.[0].id, 'need-stable-1');
  assert.ok(changed.productNeedRevision! > revision!);
  assert.equal(changed.technicalAssessments?.[0].requirementSnapshot[0].model, 'ALPHA-PCS-1250');
  assert.equal(changed.technicalAssessments?.[0].requirementSnapshot[0].name, '储能变流器 1250kW');
  assert.throws(() => store.submitOpportunity(id), /当前需求修订/);
});

test('产品需求名称随模拟产品目录带出，显式名称优先', () => {
  const { store, id } = readyOpportunity();
  store.saveProductNeed(id, {
    id: 'need-catalog',
    model: 'ALPHA-EMS-1000',
    quantity: 1,
    unit: '套',
  });
  assert.equal(store.sale(id)!.productNeeds?.[0].name, '能量管理系统 EMS');
  store.saveProductNeed(id, {
    id: 'need-explicit',
    model: 'ALPHA-EMS-1000',
    name: '客户定制EMS（演示）',
    quantity: 1,
    unit: '套',
  });
  assert.equal(store.sale(id)!.productNeeds?.[1].name, '客户定制EMS（演示）');
});

test('缺少技术初判或需求资料不能有效提交，转换本身不会产生PMO待办', () => {
  const { store, id } = readyOpportunity();
  assert.equal(
    store.state().notices.some((notice) => notice.entityId === id && notice.role === 'pmo'),
    false,
  );
  store.saveProductNeed(id, { id: 'need-1', model: 'PCS-100', quantity: 1, unit: '台' });
  assert.throws(() => store.submitOpportunity(id), /当前需求修订/);
  assert.equal(
    store.state().notices.some((notice) => notice.entityId === id && notice.role === 'pmo'),
    false,
  );
});

test('技术初判不满足会关闭并保留原机会，需求变化时另建待评估机会', () => {
  const { store, id } = readyOpportunity();
  const evidence = store.quoteSourceCandidates(id)[0]!;
  store.saveProductNeed(id, { id: 'need-closed', model: 'PCS-100', quantity: 1, unit: '台' });
  store.saveTechnicalAssessment(id, {
    result: '不满足',
    owner: '周方案',
    opinion: '现有型号无法满足并网条件',
    evidenceAttachmentIds: [evidence.id],
  });
  assert.equal(store.sale(id)!.stage, '丢单');
  const nextId = store.createOpportunityAfterAssessment(id)!;
  assert.notEqual(nextId, id);
  assert.equal(store.sale(id)!.technicalAssessments?.length, 1);
  assert.equal(store.sale(nextId)!.technicalAssessments?.length, 0);
  assert.equal(store.sale(nextId)!.stage, '意向沟通');
  assert.equal(
    store.state().notices.some((notice) => notice.entityId === nextId && notice.role === 'pmo'),
    false,
  );
});

test('产品目录按CRM产品管理表口径组织，下架产品不在可选范围', () => {
  const selectable = selectableProducts();
  assert.ok(PRODUCT_CATALOG.some((item) => item.status === '下架'));
  assert.ok(selectable.every((item) => item.status === '上架'));
  assert.ok(!selectable.some((item) => item.code === 'ALPHA-PCS-800'));
  assert.ok(selectable.some((item) => item.code === 'ALPHA-PCS-1250'));
  assert.ok(
    selectable.every((item) =>
      (['传感器', '核心处理部件', '发射接收部件', '辅助设备', '其他'] as const).includes(item.type),
    ),
  );
});
