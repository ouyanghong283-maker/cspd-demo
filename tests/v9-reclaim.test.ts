import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ready } from './v9-finalization-fixture';
import { uploadSolutionOutput } from '../src/app/core/solution-workflow/upload';
import { reclaimSolutionFiles } from '../src/app/core/solution-workflow/reclaim';
test('仅提交移除后的同归属Blob可回收，共享当前引用及未知归属保留', async () => {
  const { store, files, rows, context, input } = await ready();
  const old = store.state().solutionWorkspaces![0].versions.find((v) => v.kind === 'proposal')!;
  const candidate = { ...old.file! };
  const removable = {
    ...files,
    async removeOwned(id: string, expected: unknown) {
      rows.delete(id);
    },
  };
  assert.equal(
    (await reclaimSolutionFiles(store, [candidate], context, removable)).removed.length,
    0,
  );
  await uploadSolutionOutput(
    store,
    {
      opportunityId: input.opportunityId,
      kind: 'proposal',
      file: new File(['next'], 'next.pptx'),
      note: '',
    },
    { ...context, operationId: 'U2' },
    files,
  );
  assert.equal(
    (
      await reclaimSolutionFiles(
        store,
        [candidate],
        { ...context, workspaceId: 'OTHER' },
        removable,
      )
    ).removed.length,
    0,
  );
  assert.equal(
    (await reclaimSolutionFiles(store, [candidate], context, removable)).removed.length,
    1,
  );
  assert.equal(rows.size, 4);
});

test('释放失败仍是上传成功，公开恢复重试不增版、不改业务历史', async () => {
  const { store, files, rows, context, input } = await ready();
  const failing = {
    ...files,
    async removeOwned() {
      throw Error('temporary delete failure');
    },
  };
  const result = await uploadSolutionOutput(
    store,
    {
      opportunityId: input.opportunityId,
      kind: 'proposal',
      file: new File(['next'], 'next.pptx'),
      note: '',
    },
    { ...context, operationId: 'U2' },
    failing,
  );
  assert.equal(result.status, 'committed');
  assert.match(result.message, /释放失败/);
  const before = JSON.stringify(store.state());
  const { recoverReplacedSolutionFiles } =
    await import('../src/app/core/solution-workflow/reclaim');
  const recovery = await recoverReplacedSolutionFiles(store, context, {
    ...files,
    async removeOwned(id) {
      rows.delete(id);
    },
  });
  assert.equal(recovery.removed.length, 1);
  assert.equal(JSON.stringify(store.state()), before);
  assert.equal(
    (
      await recoverReplacedSolutionFiles(store, context, {
        ...files,
        async removeOwned(id) {
          rows.delete(id);
        },
      })
    ).removed.length,
    0,
  );
});
