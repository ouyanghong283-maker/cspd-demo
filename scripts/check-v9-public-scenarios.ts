import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createSeed } from '../src/app/core/seed';
import { selectSolutionWorkspace } from '../src/app/core/v9-queries';
import type { FileAvailability, V9PublicScenario } from '../src/app/core/v9-contracts';

// CODEX按01-02和规格09固定的独立预期，不从样例自身expected反算。
const expected: Record<string, { firstResult: string; availability: FileAvailability[] }> = {
  unfinalized: {
    firstResult: 'not-finalized',
    availability: ['missing', 'missing', 'missing', 'missing'],
  },
  'first-finalized': {
    firstResult: 'on-time',
    availability: ['present', 'present', 'present', 'present'],
  },
  'revised-pending': {
    firstResult: 'on-time',
    availability: ['present', 'present', 'present', 'present'],
  },
  'file-missing': {
    firstResult: 'on-time',
    availability: ['present', 'missing', 'present', 'present'],
  },
  'file-unavailable': {
    firstResult: 'on-time',
    availability: ['present', 'unavailable', 'present', 'present'],
  },
  'file-checking': {
    firstResult: 'on-time',
    availability: ['present', 'checking', 'present', 'present'],
  },
  'historical-unscored': {
    firstResult: 'historical-unscored',
    availability: ['missing', 'missing', 'missing', 'missing'],
  },
};
for (const id of [
  'progress-incomplete',
  'budget-zero',
  'budget-missing',
  'budget-multi-currency',
  'budget-incomparable',
  'budget-overspent',
])
  expected[id] = expected['unfinalized'];

const scenarios: V9PublicScenario[] = JSON.parse(
  readFileSync(new URL('../tests/fixtures/v9-public-scenarios.json', import.meta.url), 'utf8'),
);
assert.deepEqual(
  scenarios.map((s) => s.id).sort(),
  Object.keys(expected).sort(),
  '完整13例，无重复或遗漏',
);
for (const scenario of scenarios) {
  assert.equal(scenario.origin, 'simulated');
  assert.equal(scenario.opportunityId, 'DEMO-O001');
  assert.equal(scenario.projectId, 'DEMO-P001');
  assert.deepEqual(scenario.target, {
    workspaceId: 'WS-V9-CONTRACT',
    roundId: 'ROUND-V9-CONTRACT',
  });
  const state = createSeed();
  state.solutionWorkspaces = scenario.workspace ? [structuredClone(scenario.workspace)] : [];
  const before = structuredClone(state);
  const view = selectSolutionWorkspace(state, scenario.opportunityId, scenario.availability);
  const result = {
    firstResult: view.firstResult,
    availability: view.files.map((file) => file.availability),
  };
  assert.deepEqual(result, expected[scenario.id], scenario.id);
  assert.equal(
    view.currentStatus,
    scenario.id === 'revised-pending'
      ? 'stale'
      : ['first-finalized', 'file-missing', 'file-unavailable', 'file-checking'].includes(
            scenario.id,
          )
        ? 'current'
        : 'not-finalized',
    '组合有效性与文件状态独立',
  );
  assert.deepEqual(scenario.expected, expected[scenario.id], '样例预期须与CODEX独立预期一致');
  assert.deepEqual(state, before, '查询不修改业务快照');
  if (view.workspace) {
    view.workspace.currentOutputs = {};
    assert.deepEqual(state, before, '查询返回值不能回写源状态');
  }
  for (const version of scenario.workspace?.versions ?? []) {
    assert.equal(version.origin, 'simulated');
    assert.equal(version.uploadEvidence, null, '样例不伪造真实上传');
  }
  console.log(`PASS ${scenario.id}`);
}
assert.deepEqual(
  scenarios.find((s) => s.id === 'revised-pending')!.workspace!.finalizations,
  scenarios.find((s) => s.id === 'first-finalized')!.workspace!.finalizations,
  '改版保留旧定稿组合和元数据',
);
assert.equal(scenarios.find((s) => s.id === 'budget-zero')!.budget[0].amountMinor, 0);
assert.equal(scenarios.find((s) => s.id === 'budget-missing')!.budget[0].amountMinor, null);
assert.deepEqual(
  scenarios
    .find((s) => s.id === 'budget-multi-currency')!
    .budget.map((b) => b.currency)
    .sort(),
  ['CNY', 'EUR', 'USD'],
);
assert.equal(scenarios.find((s) => s.id === 'budget-incomparable')!.budget[0].comparable, false);
console.log(
  '13个契约样例通过；预算事实仅验证输入语义，真实Blob、计分、预算算法、迁移与看板待对应批次验收。',
);
