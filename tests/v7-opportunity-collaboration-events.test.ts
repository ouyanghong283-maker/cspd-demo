import '@angular/compiler';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readyOpportunity } from './opportunity-collaboration-fixture';
import { OperationEvent } from '../src/app/core/models';

test('商机协作各真实提交写统一事件，失败不写事件且跨部门操作保留原负责人', () => {
  const { store, role } = readyOpportunity();
  const opportunity = store.sale(store.sale('DEMO-L001')!.convertedTo)!;
  const opportunityId = opportunity.id;
  const owner = opportunity.owner;
  const mainlineId = opportunity.leadId || opportunityId;
  const initialEventIds = new Set((store.state().operationEvents || []).map((event) => event.id));
  const events = (): OperationEvent[] =>
    (store.state().operationEvents || []).filter(
      (event) => event.objectId === opportunityId && !initialEventIds.has(event.id),
    );
  const assertEvent = (
    action: string,
    taskKind: string,
    taskId: string,
    department: string,
    section: string,
    expectedOperator: string,
  ): OperationEvent => {
    const matching = events().filter((event) => event.action === action);
    assert.equal(matching.length, 1, `${action} 应恰有一个新操作事件`);
    const event = matching[0];
    assert.equal(event.objectType, 'opportunity');
    assert.equal(event.objectId, opportunityId);
    assert.equal(event.roundId, store.state().roundId);
    assert.equal(event.mainlineId, mainlineId);
    assert.equal(event.module, 'opportunity-collaboration');
    assert.equal(event.department, department);
    assert.equal(event.location.objectType, 'opportunity');
    assert.equal(event.location.objectId, opportunityId);
    assert.equal(event.location.module, event.module);
    assert.equal(event.location.department, event.department);
    assert.equal(event.location.section, section);
    assert.equal(event.location.action, action);
    assert.equal(event.taskSource?.kind, taskKind);
    assert.equal(event.taskSource?.id, taskId);
    assert.equal(event.owner, owner);
    assert.equal(event.operator, expectedOperator);
    assert.ok(event.operator);
    assert.ok(event.occurredAt);
    assert.equal(event.dataVersion, event.sourceVersion + 1);
    assert.equal(store.sale(opportunityId)?.owner, owner);
    return event;
  };

  // Invalid product input must not create an event.
  role('sales');
  const afterFixtureEventIds = new Set(events().map((event) => event.id));
  assert.throws(
    () =>
      store.saveProductNeed(opportunityId, {
        id: 'collaboration-need',
        model: 'ALPHA-PCS-1250',
        quantity: 0,
        unit: '台',
      }),
    /正数数量/,
  );
  assert.equal(events().length, afterFixtureEventIds.size);

  const need = {
    id: 'collaboration-need',
    model: 'ALPHA-PCS-1250',
    quantity: 2,
    unit: '台',
  };
  assert.equal(store.saveProductNeed(opportunityId, need), true);
  assertEvent('保存产品需求', 'product-need', need.id, '销售', '需求', store.person());

  // Invalid assessment input must not create an event; the source record is then used to save a valid one.
  role('solution');
  const beforeInvalidAssessment = events().length;
  assert.throws(
    () =>
      store.saveTechnicalAssessment(opportunityId, {
        result: '满足',
        owner: '周方案',
        opinion: '缺少来源证据',
        evidenceAttachmentIds: [],
      }),
    /必须引用适用证据/,
  );
  assert.equal(events().length, beforeInvalidAssessment);
  const evidenceKinds = ['核心技术方案', 'BOM清单', '单线图（SLD）', '衰减曲线'];
  const evidence = store
    .quoteSourceCandidates(opportunityId)
    .filter((item) => evidenceKinds.includes(item.kind))
    .map((item) => item.id);
  assert.equal(evidence.length, evidenceKinds.length);
  assert.equal(
    store.saveTechnicalAssessment(opportunityId, {
      result: '满足',
      owner: '周方案',
      opinion: '当前产品配置满足演示需求',
      evidenceAttachmentIds: evidence,
    }),
    true,
  );
  const assessment = store.sale(opportunityId)!.technicalAssessments!.at(-1)!;
  assertEvent(
    '保存技术初判',
    'technical-assessment',
    assessment.id,
    '方案',
    '技术初判',
    store.person(),
  );

  role('sales');
  const beforeInvalidSubmission = events().length;
  store.sale(opportunityId)!.technicalAssessments!.at(-1)!.requirementRevision -= 1;
  assert.throws(() => store.submitOpportunity(opportunityId), /当前需求修订/);
  assert.equal(events().length, beforeInvalidSubmission);
  store.sale(opportunityId)!.technicalAssessments!.at(-1)!.requirementRevision =
    store.sale(opportunityId)!.productNeedRevision!;
  assert.equal(store.submitOpportunity(opportunityId), true);
  assertEvent(
    '有效提交商机',
    'valid-submission',
    opportunityId,
    '销售',
    '有效提交',
    store.person(),
  );

  role('pmo');
  const beforeInvalidAssignment = events().length;
  assert.throws(
    () => store.assignOpportunityPM(opportunityId, 'pm', '', '模拟窗口'),
    /演示名册中的PM/,
  );
  assert.equal(events().length, beforeInvalidAssignment);
  assert.equal(
    store.assignOpportunityPM(opportunityId, 'pm', '王项目', '2026-10-20 至 2026-11-15（模拟）'),
    true,
  );
  assertEvent('手动指派PM', 'pmo-assignment', opportunityId, 'PMO', '团队', store.person());
  assert.equal(store.sale(opportunityId)!.owner, owner);
});
