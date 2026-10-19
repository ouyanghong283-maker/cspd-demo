import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  achievementLabel,
  finalizeSolution,
  selectFinalizationSource,
  selectFirstAchievement,
} from '../src/app/core/solution-workflow/finalization';
import { changeSolutionDeadline, SOLUTION_PEOPLE } from '../src/app/core/solution-workflow/schedule';
import type { SolutionFiles } from '../src/app/core/solution-workflow/files';
import { ready } from './v9-finalization-fixture';
/** K29固定用例：按冻结预期表扩写，只记录结果，不推断06-04核心通过。 */
test('冻结预期：完成10-21为逾期1天且成绩文本格式化', () => {
  const v = selectFirstAchievement('2026-10-20', '2026-10-21T00:00:00Z');
  assert.equal(v.daysEarly, -1);
  assert.equal(v.result, 'late');
  assert.equal(achievementLabel(v), '逾期1天');
  assert.equal(achievementLabel(selectFirstAchievement('2026-10-20', '2026-10-20T15:59:59Z')), '按时');
});
test('冻结预期：同操作号更换业务输入拒绝且不留下额外历史', async () => {
  const { store, files, context, input } = await ready();
  assert.equal((await finalizeSolution(store, input, context, files)).status, 'committed');
  const r = await finalizeSolution(store, { ...input, actingOnBehalf: true }, context, files);
  assert.equal(r.status, 'rejected');
  assert.equal(r.issue.code, 'operation-input-mismatch');
  const v = selectFinalizationSource(store.state(), input.opportunityId, {});
  assert.equal(v.events.length, 1);
  assert.equal(v.first?.eventId, v.events[0].id);
});
test('冻结预期：核验期间版本、期限或责任变化拒绝旧摘要不部分冻结', async () => {
  for (const mode of ['version', 'deadline', 'owner'] as const) {
    const { store, files, context, input } = await ready();
    const opportunityId = input.opportunityId;
    const scheduleRevision = selectFinalizationSource(store.state(), opportunityId, {}).schedule!
      .revision;
    const racing: SolutionFiles = {
      ...files,
      async get(id) {
        const w = store.state().solutionWorkspaces!.find((x) => x.opportunityId === opportunityId)!;
        if (mode === 'version') w.currentOutputs.proposal = 'V-OTHER';
        if (mode === 'owner')
          w.schedule!.owner = SOLUTION_PEOPLE.find((p) => p.name !== '周方案')!;
        if (mode === 'deadline')
          changeSolutionDeadline(
            store,
            { opportunityId, deadlineDate: '2026-10-25', scheduleRevision, reason: '核验期变化' },
            { ...context, operationId: 'S-RACE' },
          );
        return files.get(id);
      },
    };
    const r = await finalizeSolution(store, input, context, racing);
    assert.equal(r.status, 'rejected');
    assert.equal(r.issue.code, 'revision-mismatch');
    const v = selectFinalizationSource(store.state(), opportunityId, {});
    assert.equal(v.events.length, 0);
    assert.equal(v.first, null);
  }
});
test('冻结预期：已证实缺失与读取异常分别返回file-missing与file-unavailable', async () => {
  for (const [mode, code] of [
    ['missing', 'file-missing'],
    ['unavailable', 'file-unavailable'],
  ] as const) {
    const { store, files, context, input } = await ready();
    const r = await finalizeSolution(store, input, context, {
      ...files,
      get: mode === 'missing' ? async () => null : async () => Promise.reject(Error('unavailable')),
    });
    assert.equal(r.status, 'rejected');
    assert.equal(r.issue.code, code);
    assert.equal(selectFinalizationSource(store.state(), input.opportunityId, {}).first, null);
  }
});
