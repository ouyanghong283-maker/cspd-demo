import { test } from 'node:test';
import assert from 'node:assert/strict';
import { harness } from './v4-harness';

function setup() {
  const { store } = harness();
  store.state().roundId = 'ROUND-CONTRACT';
  Object.assign(store, { activeWorkspaceId: 'WS-CONTRACT' });
  let raw = '';
  let fail = false;
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: () => raw || null,
      setItem: (_key: string, value: string) => {
        if (fail) throw Error('QuotaExceededError');
        raw = value;
      },
    },
  });
  const request = {
    command: 'contractProbe',
    objectId: 'DEMO-O001',
    operationId: 'OP-CONTRACT',
    workspaceId: 'WS-CONTRACT',
    roundId: 'ROUND-CONTRACT',
    input: { note: '契约接入检查' },
  };
  const plan = {
    object: { type: 'opportunity', id: 'DEMO-O001' },
    mainlineId: 'DEMO-O001',
    module: '方案',
    department: '解决方案',
    section: '契约检查',
    action: '检查契约',
    owner: { name: '周方案', personId: 'PERSON-SOLUTION' },
    taskSource: { kind: 'v9-contract-probe', id: 'DEMO-O001' },
    changes: [
      {
        field: 'description',
        valueType: 'string' as const,
        before: store.sale('DEMO-O001')!.description,
        after: '契约接入检查',
      },
    ],
    change: (state: ReturnType<typeof store.state>) => {
      state.sales.find((s) => s.id === 'DEMO-O001')!.description = '契约接入检查';
    },
    value: { opportunityId: 'DEMO-O001', versionId: 'VERSION-CONTRACT' },
  };
  return {
    store,
    request,
    plan,
    fail: (value: boolean) => {
      fail = value;
    },
  };
}

test('公开V9命令在统一保存成功后发布业务与责任/操作者记录', () => {
  const { store, request, plan } = setup();
  const result = store.commitV9Command(request, plan);
  assert.equal(result.status, 'committed');
  assert.equal(store.sale('DEMO-O001')!.description, '契约接入检查');
  assert.equal(store.operationEvents('DEMO-O001')[0].operator, '张销售');
  assert.equal(store.operationEvents('DEMO-O001')[0].owner, '周方案');
});

test('快照失败不发布业务、历史或幂等记录，修复后原请求可重试', () => {
  const { store, request, plan, fail } = setup();
  const before = structuredClone(store.state());
  fail(true);
  const result = store.commitV9Command(request, plan);
  assert.equal(result.status, 'failed');
  assert.deepEqual(store.state(), before);
  fail(false);
  assert.equal(store.commitV9Command(request, plan).status, 'committed');
});

test('同请求重试复用已提交修订，同操作号改变输入拒绝且不增加历史', () => {
  const { store, request, plan } = setup();
  const first = store.commitV9Command(request, plan);
  const before = structuredClone(store.state());
  const retry = store.commitV9Command(request, plan);
  assert.equal(retry.status, 'unchanged');
  if ('revision' in retry && 'revision' in first) assert.equal(retry.revision, first.revision);
  assert.equal(
    store.commitV9Command({ ...request, input: { note: '其他输入' } }, plan).status,
    'rejected',
  );
  assert.deepEqual(store.state(), before);
});

test('错误工作区、轮次和无修改权请求不改变已提交状态', () => {
  const { store, request, plan } = setup();
  const before = structuredClone(store.state());
  for (const target of [{ workspaceId: 'OTHER' }, { roundId: 'OTHER' }]) {
    const result = store.commitV9Command({ ...request, ...target }, plan);
    assert.equal(result.status, 'rejected');
    if ('issue' in result) assert.equal(result.issue.code, 'workspace-changed');
  }
  Object.assign(store, { canEdit: () => false });
  const result = store.commitV9Command(request, plan);
  assert.equal(result.status, 'rejected');
  if ('issue' in result) assert.equal(result.issue.code, 'no-edit-right');
  assert.deepEqual(store.state(), before);
});

test('上海真实业务日独立于计划观察日，查询缺失历史不补种不评分', async () => {
  const { createV9Dates, selectSolutionWorkspace } = await import('../src/app/core/v9-queries');
  const { store } = setup();
  const before = structuredClone(store.state());
  assert.deepEqual(createV9Dates('2026-10-19T16:00:00.000Z', '2026-10-22'), {
    realNowUtc: '2026-10-19T16:00:00.000Z',
    solutionBusinessDate: '2026-10-20',
    timezone: 'Asia/Shanghai',
    planObservationDate: '2026-10-22',
  });
  const view = selectSolutionWorkspace(store.state(), 'DEMO-O001', {});
  assert.equal(view.workspace, null);
  assert.equal(view.firstResult, 'not-finalized');
  assert.deepEqual(store.state(), before);
});

test('空保存返回未变化，不伪造已提交修订或幂等收据', () => {
  const { store, request, plan } = setup();
  const before = structuredClone(store.state());
  const result = store.commitV9Command(request, { ...plan, changes: [] });
  assert.equal(result.status, 'unchanged');
  assert.deepEqual(store.state(), before);
});

test('同一业务输入的字段顺序不影响幂等，返回对象不能改写收据', () => {
  const { store, request, plan } = setup();
  const first = store.commitV9Command({ ...request, input: { a: 1, b: 2 } }, plan);
  if (
    'value' in first &&
    first.value &&
    typeof first.value === 'object' &&
    !Array.isArray(first.value)
  )
    first.value['versionId'] = 'TAMPERED';
  const retry = store.commitV9Command({ ...request, input: { b: 2, a: 1 } }, plan);
  assert.equal(retry.status, 'unchanged');
  if ('value' in retry)
    assert.deepEqual(retry.value, { opportunityId: 'DEMO-O001', versionId: 'VERSION-CONTRACT' });
});

test('字段缺失、业务对象错配和非法数值明确拒绝', () => {
  const { store, request, plan } = setup();
  const before = structuredClone(store.state());
  for (const change of [
    { operationId: '' },
    { command: '' },
    { objectId: 'OTHER' },
    { input: { amountMinor: NaN } },
  ])
    assert.equal(store.commitV9Command({ ...request, ...change }, plan).status, 'rejected');
  assert.deepEqual(store.state(), before);
});

test('存储配额与保存前修订变化返回不同的可解释错误', () => {
  const { store, request, plan, fail } = setup();
  fail(true);
  let result = store.commitV9Command(request, plan);
  assert.equal(result.status, 'failed');
  if ('issue' in result) assert.equal(result.issue.code, 'quota-exceeded');
  fail(false);
  const current = structuredClone(store.state());
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: () => JSON.stringify({ ...current, dataVersion: (current.dataVersion || 1) + 1 }),
      setItem() {
        throw Error('不应写入');
      },
    },
  });
  result = store.commitV9Command(request, plan);
  assert.equal(result.status, 'rejected');
  if ('issue' in result) assert.equal(result.issue.code, 'revision-mismatch');
  assert.deepEqual(store.state(), current);
});

test('成功后的提示异常不能把已提交业务报告成失败', () => {
  const { store, request, plan } = setup();
  store.ui.notify = () => {
    throw Error('提示组件异常');
  };
  const result = store.commitV9Command(request, plan);
  assert.equal(result.status, 'committed');
  assert.equal(store.sale('DEMO-O001')!.description, '契约接入检查');
  assert.equal(store.commitV9Command(request, plan).status, 'unchanged');
});

test('改版只改变当前有效性，不改首次冻结成绩；缺件与组合过期分开', async () => {
  const { selectSolutionWorkspace } = await import('../src/app/core/v9-queries');
  const { store } = setup();
  const ids = { proposal: 'P1', bom: 'B1', sld: 'S1', degradation: 'D1' };
  store.state().solutionWorkspaces = [
    {
      id: 'SOLUTION-O001',
      opportunityId: 'DEMO-O001',
      revision: 1,
      productNeedRevision: 'NEED-1',
      versions: [],
      currentOutputs: ids,
      schedule: null,
      scheduleChanges: [],
      legacyFacts: [],
      firstFinalization: {
        eventId: 'F1',
        deadlineDate: '2026-10-20',
        businessDate: '2026-10-14',
        timezone: 'Asia/Shanghai',
        daysEarly: 6,
        result: 'on-time',
      },
      finalizations: [
        {
          id: 'F1',
          opportunityId: 'DEMO-O001',
          sequence: 1,
          firstEventId: 'F1',
          fourVersionIds: { ...ids },
          versionMetadataSnapshot: [],
          productNeedRevision: 'NEED-1',
          owner: { personId: 'OWNER', name: '周方案' },
          operator: { personId: 'OPERATOR', name: '张销售' },
          confirmedAt: '2026-10-14T00:00:00Z',
          deadlineSnapshot: '2026-10-20',
          scheduleRevision: 1,
          origin: 'simulated',
        },
      ],
    },
  ];
  let view = selectSolutionWorkspace(store.state(), 'DEMO-O001', { B1: 'unavailable' });
  assert.equal(view.currentStatus, 'current');
  assert.equal(view.files[1].availability, 'unavailable');
  store.state().solutionWorkspaces![0].currentOutputs.proposal = 'P2';
  view = selectSolutionWorkspace(store.state(), 'DEMO-O001', {});
  assert.equal(view.currentStatus, 'stale');
  assert.equal(view.firstResult, 'on-time');
});

test('统一迁入的旧最终事实保持历史未评分，新业务不冒充旧历史', async () => {
  const { selectSolutionWorkspace } = await import('../src/app/core/v9-queries');
  const { store } = setup();
  store.state().solutionWorkspaces = [
    {
      id: 'SOLUTION-LEGACY',
      opportunityId: 'DEMO-O001',
      revision: 1,
      productNeedRevision: null,
      versions: [],
      currentOutputs: {},
      schedule: null,
      scheduleChanges: [],
      finalizations: [],
      firstFinalization: null,
      legacyFacts: [
        { id: 'OLD-FINAL', type: 'legacy-final', origin: 'legacy', original: { final: true } },
      ],
    },
  ];
  const before = structuredClone(store.state());
  assert.equal(
    selectSolutionWorkspace(store.state(), 'DEMO-O001', {}).firstResult,
    'historical-unscored',
  );
  assert.equal(
    selectSolutionWorkspace(store.state(), 'NEW-OPPORTUNITY', {}).firstResult,
    'not-finalized',
  );
  assert.deepEqual(store.state(), before);
});

test('模块可通过公开只读入口取得稳定工作区和轮次上下文', () => {
  const { store } = setup();
  const before = structuredClone(store.state());
  assert.deepEqual(store.v9CommandTarget(), {
    workspaceId: 'WS-CONTRACT',
    roundId: 'ROUND-CONTRACT',
  });
  assert.deepEqual(store.state(), before);
});

test('没有动作来源的无字段确认被拒绝，合法明确动作可记录一次', () => {
  const { store, request, plan } = setup();
  const before = structuredClone(store.state());
  const result = store.commitV9Command(request, {
    ...plan,
    changes: [],
    recordUnchangedAction: true,
    taskSource: undefined,
  });
  assert.equal(result.status, 'rejected');
  if ('issue' in result) assert.equal(result.issue.code, 'field-required');
  assert.deepEqual(store.state(), before);
  assert.equal(
    store.commitV9Command(request, { ...plan, changes: [], recordUnchangedAction: true }).status,
    'committed',
  );
  assert.equal(
    store.commitV9Command(request, { ...plan, changes: [], recordUnchangedAction: true }).status,
    'unchanged',
  );
});
