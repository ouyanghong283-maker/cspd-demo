import { test } from 'node:test';
import assert from 'node:assert/strict';
import { harness } from './v4-harness';
import { uploadSolutionOutput } from '../src/app/core/solution-workflow/upload';
import { selectSolutionVersions } from '../src/app/core/solution-workflow/versions';
function setup() {
  const { store, role } = harness();
  role('solution');
  store.state().roundId = 'R';
  Object.assign(store, { activeWorkspaceId: 'W' });
  const rows = new Map<string, any>();
  const files = {
    async put(id: string, value: any) {
      rows.set(id, value);
    },
    async get(id: string) {
      return rows.get(id) ?? null;
    },
  };
  return {
    store,
    files,
    rows,
    context: { workspaceId: 'W', roundId: 'R', operationId: 'U1' },
    input: {
      opportunityId: 'DEMO-O008',
      kind: 'proposal' as const,
      file: new File(['real bytes'], '方案.pptx'),
      note: '示例',
    },
  };
}
test('真实上传保存后可查询，重试不增版，连续替换保留历史并返回回收候选', async () => {
  const { store, files, rows, context, input } = setup();
  assert.equal((await uploadSolutionOutput(store, input, context, files)).status, 'committed');
  assert.equal((await uploadSolutionOutput(store, input, context, files)).status, 'unchanged');
  for (const n of [2, 3])
    assert.equal(
      (
        await uploadSolutionOutput(
          store,
          { ...input, file: new File(['v' + n], '方案.pptx') },
          { ...context, operationId: 'U' + n },
          files,
        )
      ).status,
      'committed',
    );
  const view = selectSolutionVersions(store.state(), input.opportunityId, 'proposal');
  assert.equal(view.current?.number, 3);
  assert.equal(view.history.length, 2);
  assert.ok(view.history.every((v) => v.file === null && v.contentState === 'metadataOnly'));
  assert.equal(rows.size, 3);
  assert.ok(view.current?.file);
  assert.equal((await files.get(view.current!.file!.blobId)).blob.size, 2);
});
test('格式、文件库与快照失败不占版本；同操作换字节拒绝', async () => {
  const { store, files, context, input } = setup();
  assert.equal(
    (await uploadSolutionOutput(store, { ...input, file: new File([], '空.ppt') }, context, files))
      .status,
    'rejected',
  );
  assert.equal(
    (
      await uploadSolutionOutput(
        store,
        { ...input, file: new File(['x'], '错误.pdf') },
        context,
        files,
      )
    ).status,
    'rejected',
  );
  assert.equal(
    (
      await uploadSolutionOutput(store, input, context, {
        ...files,
        async put() {
          throw new DOMException('quota', 'QuotaExceededError');
        },
      })
    ).status,
    'failed',
  );
  assert.equal(
    selectSolutionVersions(store.state(), input.opportunityId, 'proposal').current,
    null,
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
  assert.equal((await uploadSolutionOutput(store, input, context, files)).status, 'failed');
  assert.equal(
    selectSolutionVersions(store.state(), input.opportunityId, 'proposal').current,
    null,
  );
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: { getItem: () => null, setItem() {} },
  });
  assert.equal((await uploadSolutionOutput(store, input, context, files)).status, 'committed');
  assert.equal(
    (
      await uploadSolutionOutput(
        store,
        { ...input, file: new File(['other data'], '方案.pptx') },
        context,
        files,
      )
    ).status,
    'rejected',
  );
});
test('暂存中切换工作区不得写入另一工作区', async () => {
  const { store, files, context, input } = setup();
  const result = await uploadSolutionOutput(store, input, context, {
    ...files,
    async put(id: string, row: any) {
      await files.put(id, row);
      Object.assign(store, { activeWorkspaceId: 'OTHER' });
    },
  });
  assert.equal(result.status, 'rejected');
  assert.equal(
    selectSolutionVersions(store.state(), input.opportunityId, 'proposal').current,
    null,
  );
});
