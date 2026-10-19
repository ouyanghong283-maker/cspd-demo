import { test } from 'node:test';
import assert from 'node:assert/strict';
import { harness } from './v4-harness';
import { uploadSolutionOutput } from '../src/app/core/solution-workflow/upload';
import {
  setSolutionSchedule,
  SOLUTION_PEOPLE,
  changeSolutionDeadline,
} from '../src/app/core/solution-workflow/schedule';
import {
  finalizeSolution,
  selectFinalizationSource,
  selectFirstAchievement,
} from '../src/app/core/solution-workflow/finalization';
import { SOLUTION_OUTPUT_KINDS } from '../src/app/core/v9-contracts';
import type { SolutionBlobRecord, SolutionFiles } from '../src/app/core/solution-workflow/files';
import { ready } from './v9-finalization-fixture';
test('真实四文件显式首次定稿冻结期限，查询只读且不同操作号重复组合不新增', async () => {
  const { store, files, context, input } = await ready();
  assert.equal((await finalizeSolution(store, input, context, files)).status, 'committed');
  const v = selectFinalizationSource(store.state(), input.opportunityId, {});
  assert.ok(v.first);
  assert.equal(v.status, 'current');
  assert.equal(v.events.length, 1);
  assert.equal(
    (await finalizeSolution(store, input, { ...context, operationId: 'F2' }, files)).status,
    'unchanged',
  );
  assert.equal(selectFinalizationSource(store.state(), input.opportunityId, {}).events.length, 1);
  assert.equal(
    changeSolutionDeadline(
      store,
      {
        opportunityId: input.opportunityId,
        deadlineDate: '2026-11-01',
        scheduleRevision: 1,
        reason: '变化',
      },
      { ...context, operationId: 'S2' },
    ).status,
    'rejected',
  );
});
test('首次自然日成绩独立阈值、跨年闰日与上海日界', () => {
  for (const [utc, days, result] of [
    ['2026-10-12T00:00:00Z', 8, 'early'],
    ['2026-10-13T00:00:00Z', 7, 'early'],
    ['2026-10-14T00:00:00Z', 6, 'on-time'],
    ['2026-10-20T15:59:59Z', 0, 'on-time'],
    ['2026-10-20T16:00:00Z', -1, 'late'],
  ] as const) {
    const v = selectFirstAchievement('2026-10-20', utc);
    assert.equal(v.daysEarly, days);
    assert.equal(v.result, result);
  }
  assert.equal(selectFirstAchievement('2028-03-01', '2028-02-28T16:00:00Z').daysEarly, 1);
  assert.equal(selectFirstAchievement('2027-01-01', '2026-12-30T16:00:00Z').daysEarly, 1);
});
test('资料与需求改版须重新定稿，保留首次和旧组合，来源查询不写状态', async () => {
  const { store, files, context, input } = await ready();
  await finalizeSolution(store, input, context, files);
  const first = selectFinalizationSource(store.state(), input.opportunityId, {}).first;
  await uploadSolutionOutput(
    store,
    {
      opportunityId: input.opportunityId,
      kind: 'proposal',
      file: new File(['new'], '新方案.pptx'),
      note: '',
    },
    { ...context, operationId: 'U2' },
    files,
  );
  store.sale(input.opportunityId)!.productNeedRevision = 2;
  const source = selectFinalizationSource(store.state(), input.opportunityId, {});
  assert.equal(source.status, 'stale');
  assert.equal(
    (await finalizeSolution(store, input, { ...context, operationId: 'F2' }, files)).status,
    'rejected',
  );
  const newer = { ...input, fourVersionIds: source.fourVersionIds!, productNeedRevision: '2' };
  assert.equal(
    (await finalizeSolution(store, newer, { ...context, operationId: 'F2' }, files)).status,
    'committed',
  );
  const v = selectFinalizationSource(store.state(), input.opportunityId, {});
  assert.deepEqual(v.first, first);
  assert.equal(v.events[1].firstEventId, v.events[0].id);
  assert.equal(v.events[0].fourVersionIds.proposal, input.fourVersionIds.proposal);
  const before = JSON.stringify(store.state());
  selectFinalizationSource(store.state(), input.opportunityId, {});
  assert.equal(JSON.stringify(store.state()), before);
});
test('缺件、不可读、摘要变化及快照失败不部分冻结，修复重试幂等', async () => {
  const { store, files, context, input } = await ready();
  for (const get of [
    async () => null,
    async () => {
      throw Error('unavailable');
    },
  ])
    assert.equal(
      (await finalizeSolution(store, input, context, { ...files, get })).status,
      'rejected',
    );
  assert.equal(selectFinalizationSource(store.state(), input.opportunityId, {}).first, null);
  let changed = false;
  const racing = {
    ...files,
    async get(id: string) {
      if (!changed) {
        changed = true;
        store.sale(input.opportunityId)!.productNeedRevision = 2;
      }
      return files.get(id);
    },
  };
  assert.equal((await finalizeSolution(store, input, context, racing)).status, 'rejected');
  store.sale(input.opportunityId)!.productNeedRevision = 1;
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: () => null,
      setItem() {
        throw Error('quota');
      },
    },
  });
  assert.equal((await finalizeSolution(store, input, context, files)).status, 'failed');
  assert.equal(selectFinalizationSource(store.state(), input.opportunityId, {}).events.length, 0);
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: { getItem: () => null, setItem() {} },
  });
  const [a, b] = await Promise.all([
    finalizeSolution(store, input, context, files),
    finalizeSolution(store, input, context, files),
  ]);
  assert.deepEqual([a.status, b.status].sort(), ['committed', 'unchanged']);
  assert.equal(
    (await finalizeSolution(store, { ...input, actingOnBehalf: true }, context, files)).status,
    'rejected',
  );
});

test('确认期间失去修改权或目标切换无部分事件，代办必须明确确认且保存真实操作者', async () => {
  for (const mode of ['right', 'target'] as const) {
    const { store, files, context, input } = await ready();
    const before = JSON.stringify(store.state());
    const result = await finalizeSolution(store, input, context, {
      ...files,
      async get(id) {
        if (mode === 'right') Object.assign(store, { editingLease: { owns: () => false } });
        else Object.assign(store, { activeWorkspaceId: 'OTHER' });
        return files.get(id);
      },
    });
    assert.equal(result.status, 'rejected');
    assert.equal(JSON.stringify(store.state()), before);
  }
  const { store, files, context, input } = await ready();
  Object.assign(store, { person: () => '张销售' });
  assert.equal((await finalizeSolution(store, input, context, files)).status, 'rejected');
  assert.equal(
    (await finalizeSolution(store, { ...input, actingOnBehalf: true }, context, files)).status,
    'committed',
  );
  const e = selectFinalizationSource(store.state(), input.opportunityId, {}).events[0];
  assert.equal(e.operator.name, '张销售');
  assert.equal(e.owner.name, '周方案');
  assert.equal(e.pm?.name, '王项目');
});
