import { test } from 'node:test';
import assert from 'node:assert/strict';
import { harness } from './v4-harness';
import { uploadSolutionOutput } from '../src/app/core/solution-workflow/upload';
import { selectSolutionVersions } from '../src/app/core/solution-workflow/versions';
test('四类格式独立计数，重复点击拒绝，100MiB超限与只读均不写文件', async () => {
  const { store, role } = harness();
  role('solution');
  store.state().roundId = 'R';
  Object.assign(store, { activeWorkspaceId: 'W' });
  const rows = new Map();
  let release: () => void = () => {};
  const gate = new Promise<void>((r) => (release = r));
  const files = {
    async get(id: string) {
      return rows.get(id) ?? null;
    },
    async put(id: string, row: any) {
      await gate;
      rows.set(id, row);
    },
  };
  const context = { workspaceId: 'W', roundId: 'R', operationId: 'A' };
  const input = {
    opportunityId: 'DEMO-O008',
    kind: 'proposal' as const,
    file: new File(['x'], 'p.pptx'),
    note: '',
  };
  const first = uploadSolutionOutput(store, input, context, files);
  assert.equal((await uploadSolutionOutput(store, input, context, files)).status, 'rejected');
  release();
  assert.equal((await first).status, 'committed');
  for (const [kind, name] of [
    ['bom', 'b.csv'],
    ['sld', 's.pdf'],
    ['degradation', 'd.zip'],
  ] as const) {
    assert.equal(
      (
        await uploadSolutionOutput(
          store,
          { ...input, kind, file: new File(['x'], name) },
          { ...context, operationId: kind },
          files,
        )
      ).status,
      'committed',
    );
    assert.equal(
      selectSolutionVersions(store.state(), input.opportunityId, kind).current?.number,
      1,
    );
  }
  const tooLarge = new File(['x'], 'p.pptx');
  Object.defineProperty(tooLarge, 'size', { value: 104857601 });
  assert.equal(
    (
      await uploadSolutionOutput(
        store,
        { ...input, file: tooLarge },
        { ...context, operationId: 'huge' },
        files,
      )
    ).status,
    'rejected',
  );
  role('outsider');
  Object.assign(store, { editingLease: { owns: () => false } });
  assert.equal((await uploadSolutionOutput(store, input, context, files)).status, 'rejected');
  assert.equal(rows.size, 4);
});
