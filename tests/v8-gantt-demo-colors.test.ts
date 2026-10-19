import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSeed } from '../src/app/core/seed';
import { DEMO_NORMAL_DATE, DEMO_COMPARISON_DATE, planRisk } from '../src/app/core/rules';
import { harness } from './v4-harness';

test('正常档保持未完成节点全蓝，对比档同一张 WBS 甘特包含蓝黄红', () => {
  const project = createSeed().projects.find((project) => project.id === 'DEMO-P001')!;
  const plans = project.plans.filter((plan) => plan.type === '内部WBS' && plan.status !== '已完成');
  assert.ok(plans.every((plan) => planRisk(plan, DEMO_NORMAL_DATE).level === 'blue'));
  const levels = new Set(plans.map((plan) => planRisk(plan, DEMO_COMPARISON_DATE).level));
  assert.ok(levels.has('blue'), '缺少正常蓝色样例');
  assert.ok(levels.has('yellow'), '缺少临期黄色样例');
  assert.ok(levels.has('red'), '缺少超期红色样例');
  const advanced = project.plans.find((plan) => plan.id === 'DEMO-P001-W4')!;
  assert.equal(planRisk(advanced, DEMO_NORMAL_DATE).level, 'blue');
  assert.equal(planRisk(advanced, DEMO_COMPARISON_DATE).level, 'yellow');
});

for (const type of ['内部WBS', '客户主节点'] as const) {
  test(`${type}：旧轮缺预警数据时补充独立样例，保留原计划，重复点击不增加节点`, () => {
    const { store, role } = harness();
    role('pm');
    const projectId = 'DEMO-P001';
    for (const plan of store.project(projectId)!.plans) delete plan.warningLeadDays;
    const original = structuredClone(store.project(projectId)!.plans);
    assert.ok(store.preparePlanRiskDemo(projectId, type));
    assert.equal(store.dateMode(), 'comparison');
    const saved = store.project(projectId)!.plans;
    assert.deepEqual(saved.slice(0, original.length), original);
    const samples = saved.slice(original.length);
    assert.equal(samples.length, 3);
    assert.ok(samples.every((plan) => plan.type === type && plan.sourceStatus === '模拟'));
    assert.deepEqual(
      new Set(samples.map((plan) => planRisk(plan, DEMO_COMPARISON_DATE).level)),
      new Set(['blue', 'yellow', 'red']),
    );
    assert.ok(samples.every((plan) => planRisk(plan, DEMO_NORMAL_DATE).level === 'blue'));
    assert.ok(store.setDateMode('normal'));
    const historyCount = store.state().operationEvents!.length;
    assert.ok(store.preparePlanRiskDemo(projectId, type));
    assert.deepEqual(store.project(projectId)!.plans, saved);
    assert.equal(store.state().operationEvents!.length, historyCount);
  });
}

test('新轮 WBS 已有三色，只切换日期，不追加计划或业务记录', () => {
  const { store } = harness();
  const before = structuredClone(store.project('DEMO-P001')!.plans);
  const events = structuredClone(store.state().operationEvents || []);
  assert.ok(store.preparePlanRiskDemo('DEMO-P001', '内部WBS'));
  assert.equal(store.dateMode(), 'comparison');
  assert.deepEqual(store.project('DEMO-P001')!.plans, before);
  assert.deepEqual(store.state().operationEvents, events);
});

test('三色演示保存失败时，不发布样例或切换日期', () => {
  const { store, role } = harness();
  role('pm');
  const before = structuredClone(store.state());
  localStorage.setItem = () => {
    throw new Error('quota');
  };
  assert.throws(() => store.preparePlanRiskDemo('DEMO-P001', '客户主节点'), /quota/);
  assert.deepEqual(store.state(), before);
});
