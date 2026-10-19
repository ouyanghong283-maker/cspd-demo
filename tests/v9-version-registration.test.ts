import { test } from 'node:test';
import assert from 'node:assert/strict';
import { harness } from './v4-harness';
import {
  registerSolutionVersion,
  selectSolutionVersions,
} from '../src/app/core/solution-workflow/versions';
function setup() {
  const { store, role } = harness();
  role('solution');
  store.state().roundId = 'R';
  Object.assign(store, { activeWorkspaceId: 'W' });
  return {
    store,
    input: {
      opportunityId: 'DEMO-O008',
      kind: 'proposal' as const,
      fileName: '方案.pdf',
      size: 12,
      mime: 'application/pdf',
      blobId: 'B1',
      owner: { personId: 'P1', name: '周方案' },
      note: '初版',
    },
    context: { workspaceId: 'W', roundId: 'R', operationId: 'OP1' },
  };
}
const env = { availability: 'present' as const, now: '2026-10-17T01:00:00Z' };
test('公开登记V1/V2只保留一个当前且历史责任不改，重试不增版', () => {
  const { store, input, context } = setup();
  assert.equal(registerSolutionVersion(store, input, context, env).status, 'committed');
  assert.equal(
    registerSolutionVersion(store, input, context, { ...env, now: '2026-10-18T01:00:00Z' }).status,
    'unchanged',
  );
  assert.equal(
    registerSolutionVersion(
      store,
      { ...input, blobId: 'B2', owner: { personId: 'P2', name: '新负责人' } },
      { ...context, operationId: 'OP2' },
      env,
    ).status,
    'committed',
  );
  const view = selectSolutionVersions(store.state(), input.opportunityId, 'proposal');
  assert.equal(view.current?.number, 2);
  assert.equal(view.history.length, 1);
  assert.equal(view.history[0].owner?.name, '周方案');
  assert.equal(view.history[0].contentState, 'metadataOnly');
});
test('文件不可用与快照失败不占版本，原请求可重试', () => {
  const { store, input, context } = setup();
  assert.equal(
    registerSolutionVersion(store, input, context, { ...env, availability: 'unavailable' }).status,
    'rejected',
  );
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: () => null,
      setItem() {
        throw Error('QuotaExceededError');
      },
    },
  });
  assert.equal(registerSolutionVersion(store, input, context, env).status, 'failed');
  assert.equal(
    selectSolutionVersions(store.state(), input.opportunityId, 'proposal').current,
    null,
  );
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: { getItem: () => null, setItem() {} },
  });
  assert.equal(registerSolutionVersion(store, input, context, env).status, 'committed');
  assert.equal(
    selectSolutionVersions(store.state(), input.opportunityId, 'proposal').current?.number,
    1,
  );
});
