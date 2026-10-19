import '@angular/compiler';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FiveCanKey, OperationEvent, SolutionDocumentKind } from '../src/app/core/models';
import { harness } from './v4-harness';

const opportunityId = 'DEMO-O014';
const documentKinds: SolutionDocumentKind[] = ['技术方案', 'TIC', '设计BOM', 'SLD'];
const fiveCanKeys: FiveCanKey[] = ['可承诺', '可交付', '可运维', '可验收', '可续约'];

test('方案资料、确认、核价、五可及条件关闭与业务快照原子追加事件', () => {
  const { store, role } = harness();
  const opportunity = store.sale(opportunityId)!;
  const owner = opportunity.owner;
  const solutionOwner = '周方案';
  opportunity.productNeeds = [
    { id: 'v7-solution-need', model: 'PCS-100', quantity: 1, unit: '台' },
  ];
  opportunity.productNeedRevision = 1;

  const initialIds = new Set((store.state().operationEvents || []).map((event) => event.id));
  const events = () =>
    (store.state().operationEvents || []).filter(
      (event) => event.objectId === opportunityId && !initialIds.has(event.id),
    );
  const assertEvent = (
    action: string,
    taskKind: string,
    taskId: string,
    section: string,
    eventOwner: string,
    expectedCount = 1,
  ): OperationEvent => {
    const matches = events().filter((event) => event.action === action);
    assert.equal(matches.length, expectedCount, `${action} 事件数应与成功提交次数一致`);
    const event = matches.at(-1)!;
    assert.equal(event.objectType, 'opportunity');
    assert.equal(event.objectId, opportunityId);
    assert.equal(event.roundId, store.state().roundId);
    assert.equal(event.mainlineId, opportunityId);
    assert.equal(event.module, 'solution-workspace');
    assert.equal(event.department, '方案');
    assert.equal(event.location.objectType, 'opportunity');
    assert.equal(event.location.objectId, opportunityId);
    assert.equal(event.location.module, 'solution-workspace');
    assert.equal(event.location.department, '方案');
    assert.equal(event.location.section, section);
    assert.equal(event.location.action, action);
    assert.equal(event.taskSource?.kind, taskKind);
    assert.equal(event.taskSource?.id, taskId);
    assert.equal(event.owner, eventOwner);
    assert.equal(event.operator, store.person());
    assert.ok(event.occurredAt);
    assert.equal(event.dataVersion, event.sourceVersion + 1);
    assert.equal(event.dataVersion, store.state().dataVersion);
    assert.equal(store.sale(opportunityId)?.owner, owner);
    return event;
  };

  role('solution');

  // The test starts with the same product configuration shape as the V6 solution quote tests.
  const beforeIncompleteConfirmation = events().length;
  assert.throws(
    () => store.confirmSolutionDocuments(opportunityId, solutionOwner),
    /方案资料未齐全/,
  );
  assert.equal(events().length, beforeIncompleteConfirmation);
  assert.throws(
    () => store.addSolutionDocument(opportunityId, '技术方案', '', solutionOwner),
    /模拟文件名/,
  );
  assert.equal(events().length, beforeIncompleteConfirmation);

  for (const [index, kind] of documentKinds.entries()) {
    const previousCount = events().length;
    assert.equal(
      store.addSolutionDocument(opportunityId, kind, `${kind}-V1.pdf`, solutionOwner),
      true,
    );
    assert.equal(events().length, previousCount + 1);
    assertEvent(
      '保存方案资料',
      'solution-document-version',
      kind,
      '资料版本',
      solutionOwner,
      index + 1,
    );
    const data = store.solutionDocuments(opportunityId)!;
    assert.equal(data.confirmations.length, 0, '保存资料不应自动新增资料确认');
    assert.equal(data.fiveCanReviews.length, 0, '保存资料不应自动新增五可评估');
  }

  const beforeInvalidCosting = events().length;
  assert.throws(
    () =>
      store.recordSolutionCosting(
        opportunityId,
        { 'v7-solution-need': 10000 },
        'EUR',
        '不含税报价',
        '离线模拟成本表',
      ),
    /先确认当前四类方案资料/,
  );
  assert.equal(events().length, beforeInvalidCosting);
  assert.throws(
    () => store.recordFiveCan(opportunityId, '资料', {} as never, []),
    /先确认当前四类方案资料/,
  );
  assert.equal(events().length, beforeInvalidCosting);

  assert.equal(store.confirmSolutionDocuments(opportunityId, solutionOwner), true);
  const confirmation = store.solutionDocuments(opportunityId)!.confirmations.at(-1)!;
  assertEvent(
    '确认方案资料',
    'solution-document-confirmation',
    opportunityId,
    '资料确认',
    solutionOwner,
  );
  assert.equal(confirmation.owner, solutionOwner);
  assert.equal(confirmation.productNeedRevision, 1);

  const beforeInvalidCostingDetails = events().length;
  assert.throws(
    () =>
      store.recordSolutionCosting(
        opportunityId,
        { 'v7-solution-need': null },
        'EUR',
        '不含税报价',
        '离线模拟成本表',
      ),
    /非负成本/,
  );
  assert.equal(events().length, beforeInvalidCostingDetails);
  assert.equal(
    store.recordSolutionCosting(
      opportunityId,
      { 'v7-solution-need': 10000 },
      'EUR',
      '不含税报价',
      '离线模拟成本表',
    ),
    true,
  );
  const costing = store.solutionDocuments(opportunityId)!.costings.at(-1)!;
  assert.equal(costing.simulated, true);
  assertEvent('保存模拟核价', 'solution-costing', costing.id, '模拟核价', owner);

  const items = Object.fromEntries(
    fiveCanKeys.map((key) => [
      key,
      {
        result: (key === '可验收' ? '附条件' : '满足') as '附条件' | '满足',
        owner: `${key}责任人`,
        opinion: '离线演示评估依据',
      },
    ]),
  ) as Record<FiveCanKey, { result: '附条件' | '满足'; owner: string; opinion: string }>;
  const conditions = [
    { key: '可验收' as const, text: '补充验收记录', owner: '验收责任人', due: '2026-10-20' },
  ];
  const beforeInvalidFiveCan = events().length;
  assert.throws(
    () => store.recordFiveCan(opportunityId, '', items, conditions),
    /五项结果、依据、责任人和意见均需填写/,
  );
  assert.equal(events().length, beforeInvalidFiveCan);
  assert.equal(store.recordFiveCan(opportunityId, '当前四类方案资料', items, conditions), true);
  const review = store.solutionDocuments(opportunityId)!.fiveCanReviews.at(-1)!;
  assert.equal(review.simulated, true);
  assertEvent('记录五可模拟会签', 'five-can-review', opportunityId, '五可评估', owner);

  const condition = review.conditions[0];
  const beforeInvalidClosure = events().length;
  assert.throws(
    () => store.closeFiveCanCondition(opportunityId, review.id, condition.id, ''),
    /关闭依据/,
  );
  assert.equal(events().length, beforeInvalidClosure);
  assert.equal(
    store.closeFiveCanCondition(opportunityId, review.id, condition.id, '责任人已复核补充资料'),
    true,
  );
  assertEvent('关闭五可条件', 'five-can-condition', condition.id, '五可评估', owner);
  assert.equal(
    store.solutionDocuments(opportunityId)!.fiveCanReviews.at(-1)!.conditions[0].closed,
    true,
  );
});
