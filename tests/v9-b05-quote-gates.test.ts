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

async function adopted() {
  const f = await ready();
  await finalizeSolution(f.store, f.input, f.context, f.files);
  const q = f.store.state().quoteSeries!.find((s) => s.opportunityId === f.input.opportunityId)!
    .versions[0];
  q.status = '草稿';
  q.crmSchemaVersion = 1;
  const source = selectFinalizationSource(f.store.state(), f.input.opportunityId, {});
  await adoptQuoteSolutionBasis(
    f.store,
    {
      quoteVersionId: q.id,
      quoteRevision: q.contentRevision ?? 0,
      finalizationId: source.current!.id,
    },
    { ...f.context, operationId: 'ADOPT' },
    f.files,
  );
  const messages: string[] = [];
  Object.assign(f.store, { ui: { fail: (m: string) => (messages.push(m), false), notify() {} } });
  return { ...f, id: q.id, messages };
}
test('报价未采用有效定稿时，提交明确拒绝且不改价格配置和历史', async () => {
  const f = await adopted();
  delete f.store.quoteVersion(f.id)!.solutionBasis;
  const before = structuredClone(f.store.state());
  assert.equal(f.store.submitQuote(f.id), false);
  assert.match(f.messages.at(-1)!, /采用|定稿/);
  assert.deepEqual(f.store.state(), before);
});

test('真实需求修订使采用过期，审核批准被拒绝而原退回路径可继续', async () => {
  const f = await adopted();
  const q = f.store.quoteVersion(f.id)!;
  q.status = '待模拟审核';
  q.submittedRevision = q.contentRevision ?? 0;
  f.store.sale(f.input.opportunityId)!.productNeedRevision!++;
  const before = structuredClone(f.store.state());
  assert.equal(f.store.reviewQuote(f.id, '模拟审核通过', '同意'), false);
  assert.match(f.messages.at(-1)!, /定稿|依据|过期/);
  assert.deepEqual(f.store.state(), before);
  assert.equal(f.store.reviewQuote(f.id, '退回补充', '方案已变化，请重新采用'), true);
  assert.equal(f.store.quoteVersion(f.id)!.status, '退回补充');
});

test('待主管锁定报价来源过期被拒绝，已发金额及采用摘要保持', async () => {
  const f = await adopted();
  const q = f.store.quoteVersion(f.id)!;
  q.status = '已记录发出';
  q.acceptedBy = '客户';
  q.acceptedEvidence = '邮件';
  f.store.sale(f.input.opportunityId)!.productNeedRevision!++;
  const before = structuredClone(f.store.state());
  assert.equal(f.store.lockQuote(f.id), false);
  assert.match(f.messages.at(-1)!, /定稿|依据|过期/);
  assert.deepEqual(f.store.state(), before);
  const v = selectQuoteSolutionBasis(f.store.state(), f.id, {});
  assert.ok(v.differences.some((i) => i.code === 'finalization-stale'));
});

test('从已发历史创建新版保留旧快照和价格，新版必须重新显式采用', async () => {
  const f = await adopted();
  f.store.quoteVersion(f.id)!.status = '已记录发出';
  const old = structuredClone(f.store.quoteVersion(f.id)!);
  const id = f.store.createQuoteVersion(f.id, '需求更新')!;
  assert.ok(id);
  assert.deepEqual(f.store.quoteVersion(f.id), old);
  assert.deepEqual(f.store.quoteVersion(id)!.items, old.items);
  assert.equal(f.store.quoteVersion(id)!.solutionBasis, undefined);
  assert.equal(f.store.submitQuote(id), false);
  assert.match(f.messages.at(-1)!, /采用/);
});

test('真实报价重新定稿仍需显式采用后才能提交，存储失败无部分审批', async () => {
  const f = await adopted();
  const { completeCrmDraft } = await import('./crm-quote-fixture');
  assert.equal(f.store.saveCrmQuote(completeCrmDraft(f.store, f.id)), true);
  f.store.sale(f.input.opportunityId)!.productNeedRevision!++;
  assert.equal(f.store.submitQuote(f.id), false);
  const newSource = selectFinalizationSource(f.store.state(), f.input.opportunityId, {});
  assert.equal(
    (
      await finalizeSolution(
        f.store,
        { ...f.input, productNeedRevision: newSource.productNeedRevision! },
        { ...f.context, operationId: 'RE-FINAL' },
        f.files,
      )
    ).status,
    'committed',
  );
  assert.equal(f.store.submitQuote(f.id), false);
  const quote = f.store.quoteVersion(f.id)!;
  const newFinal = selectFinalizationSource(f.store.state(), f.input.opportunityId, {}).current!;
  const beforePrices = structuredClone(quote.items);
  assert.equal(
    (
      await adoptQuoteSolutionBasis(
        f.store,
        {
          quoteVersionId: f.id,
          quoteRevision: quote.contentRevision ?? 0,
          finalizationId: newFinal.id,
        },
        { ...f.context, operationId: 'RE-ADOPT' },
        f.files,
      )
    ).status,
    'committed',
  );
  assert.deepEqual(f.store.quoteVersion(f.id)!.items, beforePrices);
  const before = structuredClone(f.store.state());
  globalThis.localStorage.setItem = () => {
    throw Error('quota');
  };
  assert.equal(f.store.submitQuote(f.id), false);
  assert.deepEqual(f.store.state(), before);
  globalThis.localStorage.setItem = () => {};
  assert.equal(f.store.submitQuote(f.id), true);
  assert.equal(f.store.reviewQuote(f.id, '模拟审核通过', '通过'), true);
  assert.equal(f.store.reviewQuote(f.id, '模拟审核通过', '重复'), false);
});

test('复制到异工作区的采用依据不能推进为本工作区的新审核', async () => {
  const f = await adopted();
  Object.assign(f.store, { activeWorkspaceId: 'COPIED' });
  const before = structuredClone(f.store.state());
  assert.equal(f.store.submitQuote(f.id), false);
  assert.match(f.messages.at(-1)!, /工作区|轮次/);
  assert.deepEqual(f.store.state(), before);
});

test('来源过期时关闭末条旧审核条件不能旁路批准，失败不写条件或历史', async () => {
  const f = await adopted();
  const quote = f.store.quoteVersion(f.id)!;
  quote.crmSchemaVersion = undefined;
  quote.status = '附条件通过';
  quote.conditions = [
    {
      id: 'LAST',
      text: '历史条件',
      owner: '张销售',
      due: '2026-10-20',
      closed: false,
      closedBy: '',
    },
  ];
  f.store.sale(f.input.opportunityId)!.productNeedRevision!++;
  const before = structuredClone(f.store.state());
  assert.equal(f.store.closeQuoteCondition(f.id, 'LAST', '补充凭据'), false);
  assert.deepEqual(f.store.state(), before);
});

test('V9工作区中未采用的旧报价同样不得提交，不能从旧命令绕开', async () => {
  const f = await adopted();
  f.store.state().storageSchemaVersion = 3;
  const q = f.store.quoteVersion(f.id)!;
  q.crmSchemaVersion = undefined;
  delete q.solutionBasis;
  assert.equal(f.store.submitQuote(f.id), false);
  assert.match(f.messages.at(-1)!, /采用/);
});

test('当前字节缺失单独提示，既有采用的业务有效性在页面查询和提交命令保持一致', async () => {
  const f = await adopted();
  const { completeCrmDraft } = await import('./crm-quote-fixture');
  assert.equal(f.store.saveCrmQuote(completeCrmDraft(f.store, f.id)), true);
  f.rows.clear();
  const availability = Object.fromEntries(
    Object.values(f.input.fourVersionIds).map((id) => [id, 'missing' as const]),
  );
  const view = selectQuoteSolutionBasis(f.store.state(), f.id, availability, f.context);
  assert.equal(view.canSubmit, true);
  assert.ok(view.fileIssues?.some((i) => i.code === 'file-missing'));
  assert.deepEqual(view.submitIssues, []);
  assert.equal(f.store.submitQuote(f.id), true);
});
