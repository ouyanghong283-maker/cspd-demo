import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { OperationEvent } from '../src/app/core/models';
import { calculateMainlineProgress } from '../src/app/core/mainline-progress';

function event(overrides: Partial<OperationEvent> = {}): OperationEvent {
  return {
    id: 'op-1',
    roundId: 'round-1',
    mainlineId: 'line-1',
    module: '商机',
    department: '销售',
    objectType: 'opportunity',
    objectId: 'opp-1',
    action: '保存商机资料',
    operator: '演示用户',
    owner: '销售负责人',
    occurredAt: '2026-10-15T00:00:00.000Z',
    sourceVersion: 1,
    dataVersion: 2,
    location: {
      objectType: 'opportunity',
      objectId: 'opp-1',
      module: '商机',
      department: '销售',
      section: '商机资料',
      action: '保存商机资料',
    },
    changes: [{ field: 'description', valueType: 'string', before: '', after: '已确认' }],
    ...overrides,
  };
}

const baseInput = {
  roundId: 'round-1',
  mainlineId: 'line-1',
  registeredModules: [
    { id: 'sales' as const, label: '商机', eventModules: ['商机'] },
    { id: 'solution' as const, label: '方案', eventModules: ['解决方案'] },
    {
      id: 'contract' as const,
      label: '合同',
      eventModules: ['合同支付', '合同发票', '合同订单'],
    },
  ],
  ownership: [{ objectType: 'opportunity', objectId: 'opp-1', mainlineId: 'line-1' }],
};

test('只统计当前轮次、当前主线、归属对象及已注册模块的有效事件', () => {
  const progress = calculateMainlineProgress({
    ...baseInput,
    events: [
      event(),
      event({ id: 'other-round', roundId: 'round-2' }),
      event({ id: 'other-line', mainlineId: 'line-2' }),
      event({ id: 'unregistered', module: '未注册模块' }),
      event({ id: 'other-object', objectId: 'opp-2' }),
    ],
  });

  assert.deepEqual(
    progress.modules.map(({ id, done, events }) => [id, done, events.length]),
    [
      ['sales', true, 1],
      ['solution', false, 0],
      ['contract', false, 0],
    ],
  );
  assert.deepEqual(
    progress.pendingVerification.map((item) => item.id),
    ['unregistered', 'other-object'],
  );
});

test('重复操作都保留留痕，但一个模块只计一次', () => {
  const progress = calculateMainlineProgress({
    ...baseInput,
    events: [event(), event({ id: 'op-2', action: '再次保存商机资料' })],
  });

  assert.equal(progress.modules[0].done, true);
  assert.equal(progress.modules[0].events.length, 2);
});

test('空保存、导航和样例事件不计完成', () => {
  const progress = calculateMainlineProgress({
    ...baseInput,
    events: [
      event({ id: 'empty', changes: [] }),
      event({ id: 'navigation', action: '导航至商机页面' }),
      event({ id: 'sample', taskSource: { kind: '样例数据' } }),
    ],
  });

  assert.equal(progress.modules[0].done, false);
  assert.deepEqual(progress.modules[0].events, []);
});

test('明确记录的用户确认即使没有字段差异也计入进度', () => {
  const progress = calculateMainlineProgress({
    ...baseInput,
    events: [event({ changes: [], taskSource: { kind: 'explicit-action' } })],
  });

  assert.equal(progress.modules[0].done, true);
  assert.equal(progress.modules[0].events.length, 1);
});

test('来源归属缺失或事件明确标记来源字段丢失时进入待核', () => {
  const progress = calculateMainlineProgress({
    ...baseInput,
    events: [
      event({ id: 'ownership-missing', objectId: 'unknown-1' }),
      event({ id: 'source-missing', legacyMissingFields: ['mainlineId'] }),
      event({ id: 'lost-mainline', mainlineId: '', legacyMissingFields: ['mainlineId'] }),
      event({ id: 'legacy-source', legacy: true }),
    ],
  });

  assert.equal(progress.modules[0].done, false);
  assert.deepEqual(
    progress.pendingVerification.map((item) => item.id),
    ['ownership-missing', 'source-missing', 'lost-mainline', 'legacy-source'],
  );
});

test('对象明确属于其他主线时忽略且不显示为待核', () => {
  const progress = calculateMainlineProgress({
    ...baseInput,
    ownership: [{ objectType: 'opportunity', objectId: 'opp-1', mainlineId: 'line-2' }],
    events: [event()],
  });

  assert.equal(progress.modules[0].done, false);
  assert.deepEqual(progress.pendingVerification, []);
});

test('显式主线别名可承接同一主线的上游对象事件', () => {
  const progress = calculateMainlineProgress({
    ...baseInput,
    mainlineAliases: ['lead-1'],
    ownership: [{ objectType: 'lead', objectId: 'lead-1', mainlineId: 'lead-1' }],
    events: [event({ mainlineId: 'lead-1', objectType: 'lead', objectId: 'lead-1' })],
  });

  assert.equal(progress.modules[0].done, true);
  assert.equal(progress.modules[0].events[0].objectId, 'lead-1');
});
