import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSeed } from '../src/app/core/seed';
import { convertLegacySolutions, resolveLegacySolution } from '../src/app/core/solution-migration';
test('旧方案纯转换保留原事实，TIC不当输出且不伪造首次/文件，重复转换等价', () => {
  const state = createSeed();
  const before = structuredClone(state);
  const r = convertLegacySolutions(state);
  assert.equal(r.canContinue, true);
  assert.deepEqual(state, before);
  assert.ok(r.state.solutionWorkspaces!.length);
  for (const w of r.state.solutionWorkspaces!) {
    assert.equal(w.firstFinalization, null);
    assert.equal(w.schedule, null);
    assert.equal(w.finalizations.length, 0);
    for (const v of w.versions) {
      assert.equal(v.origin, 'legacy');
      assert.equal(v.file, null);
      assert.equal(v.uploadEvidence, null);
    }
  }
  assert.deepEqual(convertLegacySolutions(r.state).state, r.state);
  const series = state.solutionSeries![0];
  const resolved = resolveLegacySolution(
    r.state,
    'solutionSeries',
    series.id,
    series.opportunityId,
  );
  assert.equal(resolved.status, 'resolved');
  assert.deepEqual(resolved.original, series);
  assert.deepEqual(r.state.quoteSeries, state.quoteSeries);
});
test('同名不同身份保留双方，跨商机引用待核，不按最新方案重连', () => {
  const s = createSeed();
  const a = s.solutionSeries![0];
  const old = a.versions[0];
  a.versions[0].documentId = 'MISSING-DOCUMENT';
  const result = convertLegacySolutions(s);
  assert.ok(result.issues.some((i) => i.status === 'missing'));
  assert.equal(
    resolveLegacySolution(result.state, 'solutionVersion', old.id, 'WRONG-OPPORTUNITY').status,
    'missing',
  );
});

test('同documentId合并且同名不同ID不猜测，原旧ID可读取，旧报价错误归属待核', () => {
  const s = createSeed();
  const series = s.solutionSeries![0];
  const first = series.versions[0];
  const source = s.attachments.find((a) => a.id === first.documentId)!;
  s.solutionDocuments = [
    {
      opportunityId: series.opportunityId,
      current: { 技术方案: 'DOC-SAME' },
      versions: [
        { ...first, id: 'DOC-SAME', kind: '技术方案' },
        { ...first, id: 'DOC-DIFFERENT', kind: '技术方案', documentId: 'ANOTHER-DOCUMENT' },
      ],
      confirmations: [],
      costings: [],
      fiveCanReviews: [],
      owner: first.owner,
      ownerHistory: [],
    },
  ];
  s.attachments.push({ ...source, id: 'ANOTHER-DOCUMENT' });
  const quote = s.quoteSeries!.find((q) => q.opportunityId === series.opportunityId);
  if (quote) quote.versions[0].solutionVersionId = 'NONEXISTENT';
  const r = convertLegacySolutions(s);
  const w = r.state.solutionWorkspaces!.find((w) => w.opportunityId === series.opportunityId)!;
  assert.equal(w.versions.filter((v) => v.documentId === first.documentId).length, 1);
  assert.ok(w.versions.some((v) => v.documentId === 'ANOTHER-DOCUMENT'));
  assert.equal(
    resolveLegacySolution(r.state, 'solutionVersion', first.id, series.opportunityId).unifiedId,
    resolveLegacySolution(r.state, 'solutionDocumentVersion', 'DOC-SAME', series.opportunityId)
      .unifiedId,
  );
  assert.ok(r.issues.some((i) => i.status === 'ambiguous'));
  if (quote) {
    const link = resolveLegacySolution(
      r.state,
      'quoteReference:solutionVersionId',
      quote.versions[0].id,
      series.opportunityId,
    );
    assert.equal(link.status, 'missing');
    assert.deepEqual(link.original, { originalId: 'NONEXISTENT', targetType: 'solutionVersion' });
  }
});

test('混合快照未吸收旧事实时明确拒绝继续且保留原状态', () => {
  const s = createSeed();
  const converted = convertLegacySolutions(s);
  s.solutionWorkspaces = [converted.state.solutionWorkspaces![0]];
  const result = convertLegacySolutions(s);
  assert.equal(result.canContinue, false);
  assert.deepEqual(result.state, s);
  assert.ok(result.issues.some((i) => i.status === 'fatal'));
});
