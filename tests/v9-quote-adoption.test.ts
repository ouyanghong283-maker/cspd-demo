import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ready } from './v9-finalization-fixture';
import {
  finalizeSolution,
  selectFinalizationSource,
} from '../src/app/core/solution-workflow/finalization';
import {
  adoptQuoteSolutionBasis,
  selectQuoteSolutionBasis,
} from '../src/app/core/solution-workflow/quote-basis';
test('草稿显式采用当前定稿后价格配置不变，查询不采用，错来源及保存失败拒绝', async () => {
  const { store, context, files, input } = await ready();
  await finalizeSolution(store, input, context, files);
  const series = store.state().quoteSeries!.find((q) => q.opportunityId === input.opportunityId)!;
  const quote = series.versions[0];
  quote.status = '草稿';
  const before = JSON.stringify(quote);
  const availability = Object.fromEntries(
    Object.values(input.fourVersionIds).map((id) => [id, 'present'] as const),
  );
  assert.equal(
    selectQuoteSolutionBasis(store.state(), quote.id, availability).status,
    'not-adopted',
  );
  assert.equal(JSON.stringify(quote), before);
  const adoption = {
    quoteVersionId: quote.id,
    quoteRevision: quote.contentRevision ?? 0,
    finalizationId: selectFinalizationSource(store.state(), input.opportunityId, availability)
      .current!.id,
  };
  assert.equal(
    (await adoptQuoteSolutionBasis(store, adoption, { ...context, operationId: 'ADOPT' }, files))
      .status,
    'committed',
  );
  const adopted = store.quoteVersion(quote.id)!;
  const { solutionBasis, contentRevision, ...rest } = adopted;
  const { contentRevision: oldRevision, ...oldFields } = JSON.parse(before);
  assert.deepEqual(rest, oldFields);
  assert.equal(contentRevision, (oldRevision ?? 0) + 1);
  assert.ok(solutionBasis);
  assert.equal(
    (await adoptQuoteSolutionBasis(store, adoption, { ...context, operationId: 'ADOPT' }, files))
      .status,
    'unchanged',
  );
  assert.equal(selectQuoteSolutionBasis(store.state(), quote.id, availability).status, 'current');
});

test('采用拒绝错误商机定稿、报价修订、只读和保存失败，已有价格及依据不部分发布', async () => {
  const { store, context, files, input } = await ready();
  await finalizeSolution(store, input, context, files);
  const series = store.state().quoteSeries!.find((q) => q.opportunityId === input.opportunityId)!;
  const q = series.versions[0];
  q.status = '草稿';
  const adoption = {
    quoteVersionId: q.id,
    quoteRevision: q.contentRevision ?? 0,
    finalizationId: 'OTHER',
  };
  assert.equal(
    (await adoptQuoteSolutionBasis(store, adoption, { ...context, operationId: 'A' }, files))
      .status,
    'rejected',
  );
  adoption.finalizationId = selectFinalizationSource(
    store.state(),
    input.opportunityId,
    {},
  ).current!.id;
  assert.equal(
    (
      await adoptQuoteSolutionBasis(
        store,
        { ...adoption, quoteRevision: 999 },
        { ...context, operationId: 'B' },
        files,
      )
    ).status,
    'rejected',
  );
  const before = JSON.stringify(store.state());
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: () => null,
      setItem() {
        throw Error('quota');
      },
    },
  });
  assert.equal(
    (await adoptQuoteSolutionBasis(store, adoption, { ...context, operationId: 'A' }, files))
      .status,
    'failed',
  );
  assert.equal(JSON.stringify(store.state()), before);
  Object.assign(store, { editingLease: { owns: () => false } });
  assert.equal(
    (await adoptQuoteSolutionBasis(store, adoption, { ...context, operationId: 'A' }, files))
      .status,
    'rejected',
  );
});

test('文件核验期间报价进入审核或商机关闭，采用拒绝且不部分写依据', async () => {
  for (const mode of ['review', 'closed'] as const) {
    const { store, context, files, input } = await ready();
    await finalizeSolution(store, input, context, files);
    const series = store.state().quoteSeries!.find((q) => q.opportunityId === input.opportunityId)!;
    const quote = series.versions[0];
    quote.status = '草稿';
    const adoption = {
      quoteVersionId: quote.id,
      quoteRevision: quote.contentRevision ?? 0,
      finalizationId: selectFinalizationSource(store.state(), input.opportunityId, {}).current!.id,
    };
    const result = await adoptQuoteSolutionBasis(
      store,
      adoption,
      { ...context, operationId: 'A' },
      {
        ...files,
        async get(id) {
          if (mode === 'review') store.quoteVersion(quote.id)!.status = '待模拟审核';
          else store.sale(input.opportunityId)!.stage = '赢单';
          return files.get(id);
        },
      },
    );
    assert.equal(result.status, 'rejected');
    assert.equal(store.quoteVersion(quote.id)!.solutionBasis, undefined);
    assert.equal(store.quoteVersion(quote.id)!.contentRevision ?? 0, adoption.quoteRevision);
  }
});

test('异工作区复制来的文件引用和定稿不得作为本工作区的新采用依据', async () => {
  const { store, context, files, input } = await ready();
  await finalizeSolution(store, input, context, files);
  const series = store.state().quoteSeries!.find((q) => q.opportunityId === input.opportunityId)!;
  const quote = series.versions[0];
  quote.status = '草稿';
  const adoption = {
    quoteVersionId: quote.id,
    quoteRevision: quote.contentRevision ?? 0,
    finalizationId: selectFinalizationSource(store.state(), input.opportunityId, {}).current!.id,
  };
  store.state().roundId = 'OTHER-R';
  Object.assign(store, { activeWorkspaceId: 'OTHER' });
  const before = JSON.stringify(store.state());
  const result = await adoptQuoteSolutionBasis(
    store,
    adoption,
    { workspaceId: 'OTHER', roundId: 'OTHER-R', operationId: 'A' },
    files,
  );
  assert.equal(result.status, 'rejected');
  assert.equal(JSON.stringify(store.state()), before);
});
