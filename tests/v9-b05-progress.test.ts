import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ready } from './v9-finalization-fixture';
import { finalizeSolution } from '../src/app/core/solution-workflow/finalization';
import { adoptQuoteSolutionBasis } from '../src/app/core/solution-workflow/quote-basis';
import { selectLifecycleProgress } from '../src/app/core/lifecycle-progress';

test('锁定报价按真实需求修订失效，首次定稿及四上传历史不丢，查询不生成操作', async () => {
  const f = await ready();
  await finalizeSolution(f.store, f.input, f.context, f.files);
  const q = f.store.quoteSeries(f.input.opportunityId)!.versions[0];
  q.status = '草稿';
  await adoptQuoteSolutionBasis(
    f.store,
    {
      quoteVersionId: q.id,
      quoteRevision: q.contentRevision ?? 0,
      finalizationId: f.store
        .state()
        .solutionWorkspaces!.find((w) => w.opportunityId === f.input.opportunityId)!
        .finalizations[0].id,
    },
    { ...f.context, operationId: 'ADOPT' },
    f.files,
  );
  const quote = f.store.quoteVersion(q.id)!;
  quote.status = '最终锁定';
  f.store.quoteSeries(f.input.opportunityId)!.activeFinalVersionId = q.id;
  assert.equal(
    selectLifecycleProgress(f.store.state(), f.input.opportunityId, null).nodes.find(
      (n) => n.nodeId === 'quote.locked',
    )!.status,
    'verified',
  );
  f.store.sale(f.input.opportunityId)!.productNeedRevision!++;
  const before = JSON.stringify(f.store.state());
  const view = selectLifecycleProgress(JSON.parse(before), f.input.opportunityId, null);
  assert.equal(view.nodes.find((n) => n.nodeId === 'quote.locked')!.status, 'invalidated');
  assert.equal(
    view.nodes
      .filter((n) => n.nodeId.startsWith('solution.'))
      .every((n) => n.status === 'verified'),
    true,
  );
  assert.equal(JSON.stringify(f.store.state()), before);
});

test('统一定稿直接供核价五可使用，保存不重建旧输出，来源变化后分数下降', async () => {
  const f = await ready();
  f.store.state().storageSchemaVersion = 3;
  await finalizeSolution(f.store, f.input, f.context, f.files);
  const old = structuredClone(f.store.state().solutionDocuments);
  assert.equal(
    f.store.recordSolutionCosting(
      f.input.opportunityId,
      { NEED: 100 },
      'EUR',
      '不含税',
      '独立演示来源',
    ),
    true,
  );
  const items = {
    可承诺: { result: '满足' as const, owner: '周方案', opinion: '已核对' },
    可交付: { result: '满足' as const, owner: '周方案', opinion: '已核对' },
    可运维: { result: '满足' as const, owner: '周方案', opinion: '已核对' },
    可验收: { result: '满足' as const, owner: '周方案', opinion: '已核对' },
    可续约: { result: '满足' as const, owner: '周方案', opinion: '已核对' },
  };
  assert.equal(f.store.recordFiveCan(f.input.opportunityId, '统一定稿', items, []), true);
  assert.deepEqual(f.store.state().solutionDocuments, old);
  const fresh = JSON.parse(JSON.stringify(f.store.state()));
  const progress = selectLifecycleProgress(fresh, f.input.opportunityId, null);
  assert.equal(progress.nodes.find((n) => n.nodeId === 'quote.costing')!.status, 'verified');
  assert.equal(progress.nodes.find((n) => n.nodeId === 'quote.fiveCan')!.status, 'verified');
  f.store.sale(f.input.opportunityId)!.productNeedRevision!++;
  const changed = selectLifecycleProgress(f.store.state(), f.input.opportunityId, null);
  assert.equal(changed.nodes.find((n) => n.nodeId === 'quote.costing')!.status, 'invalidated');
  assert.equal(changed.nodes.find((n) => n.nodeId === 'quote.fiveCan')!.status, 'invalidated');
});
