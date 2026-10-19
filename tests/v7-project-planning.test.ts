import '@angular/compiler';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BASE_DATE, Plan, ROLES } from '../src/app/core/models';
import { harness } from './v4-harness';

function plan(overrides: Partial<Plan> = {}): Plan {
  return {
    id: 'stable-plan-01',
    type: '内部WBS',
    name: '启动交底',
    owner: '',
    start: '2026-10-08',
    end: '2026-10-09',
    expected: '2026-10-09',
    actual: '',
    status: '未开始',
    product: '',
    quantity: 1,
    batch: '',
    linked: '',
    amount: 0,
    currency: 'CNY',
    result: '',
    receiver: '',
    note: '',
    sourceStatus: '待核',
    // BUD01：内部WBS保存时预算金额与币种必须齐全。
    budgetAmount: 12000,
    budgetCurrency: 'CNY',
    warningLeadDays: 7,
    ...overrides,
  };
}

test('所有演示角色可维护本地计划且保留原负责人，产研来源仍只读', () => {
  const { store, role } = harness();
  const projectId = 'DEMO-P003';
  for (const identity of ROLES) {
    role(identity.id);
    const input = plan({ id: `cross-role-${identity.id}`, name: '实施任务', owner: '王项目' });
    assert.equal(store.canEditPlan(input), true);
    assert.equal(store.savePlan(projectId, input), true);
    assert.equal(
      store.project(projectId)!.plans.find((item) => item.id === input.id)?.owner,
      '王项目',
    );
    assert.equal(store.state().operationEvents!.at(-1)?.operator, store.person());
  }
  const before = structuredClone(store.state());
  const source = plan({ type: '产研来源' });
  assert.equal(store.canEditPlan(source), false);
  assert.throws(() => store.savePlan(projectId, source), /只读/);
  assert.deepEqual(store.state(), before);
});

test('项目计划用稳定Plan ID保存，事件定位到该任务，延期提醒按固定基准日去重且已读不关闭', () => {
  const { store, role } = harness();
  const projectId = 'DEMO-P003';
  const originalOpportunity = store.sale(store.project(projectId)!.opportunityId)!;
  const originalRoughPlans = structuredClone(originalOpportunity.opportunityRoughPlans || []);
  role('pm');
  const beforeEvents = store.state().operationEvents?.length || 0;
  assert.equal(store.savePlan(projectId, plan()), true);
  assert.ok(store.project(projectId)!.plans.some((item) => item.id === 'stable-plan-01'));
  assert.deepEqual(
    store.sale(originalOpportunity.id)!.opportunityRoughPlans || [],
    originalRoughPlans,
  );
  const event = store.state().operationEvents!.at(-1)!;
  assert.equal(event.action, '保存项目计划');
  assert.equal(event.module, '项目计划');
  assert.equal(event.objectId, projectId);
  assert.equal(event.location.objectId, projectId);
  assert.equal(event.location.section, '计划:内部WBS');
  assert.equal(event.taskSource?.kind, 'project-plan');
  assert.equal(event.taskSource?.id, 'stable-plan-01');
  assert.equal(event.dataVersion, store.state().dataVersion);
  assert.equal(store.state().operationEvents!.length, beforeEvents + 1);

  const readiness = store
    .planReadiness(projectId)
    .find((item) => item.planId === 'stable-plan-01')!;
  assert.deepEqual(readiness.missing, ['负责人', '来源规则/说明']);
  const notice = store
    .state()
    .notices.find((item) => item.key === `v4-milestone-${projectId}-stable-plan-01`)!;
  assert.equal(notice.text.includes('已延期1天'), true);
  const noticeId = notice.id;
  store.markNotice(noticeId);
  assert.equal(store.state().notices.find((item) => item.id === noticeId)?.read, true);
  assert.equal(store.state().notices.find((item) => item.id === noticeId)?.resolved, false);

  assert.equal(store.savePlan(projectId, plan()), true);
  const activeMatches = store
    .state()
    .notices.filter(
      (item) => item.key === `v4-milestone-${projectId}-stable-plan-01` && !item.resolved,
    );
  assert.equal(activeMatches.length, 1);
  assert.equal(activeMatches[0].id, noticeId);
});

test('缺计划日期只标为待补，不按空日期计算延期提醒', () => {
  const { store } = harness();
  const projectId = 'DEMO-P003';
  store.state.update((state) => {
    state.projects.find((item) => item.id === projectId)!.plans = [
      plan({ id: 'missing-date', start: '', end: '', expected: '' }),
    ];
    return state;
  });
  assert.ok(
    store
      .planReadiness(projectId)
      .find((item) => item.planId === 'missing-date')
      ?.missing.includes('有效计划起止日期'),
  );
  assert.equal(
    store.milestoneWarnings(projectId).some((item) => item.sourcePlanId === 'missing-date'),
    false,
  );
  assert.equal(BASE_DATE, '2026-10-10');
});
