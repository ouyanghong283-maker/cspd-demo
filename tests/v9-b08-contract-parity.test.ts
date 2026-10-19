import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createSeed } from '../src/app/core/seed';
import { ready } from './v9-finalization-fixture';
import { selectSolutionWorkspace, createV9Dates } from '../src/app/core/v9-queries';
import { finalizeSolution } from '../src/app/core/solution-workflow/finalization';
import { changeSolutionDeadline } from '../src/app/core/solution-workflow/schedule';
import { checkSolutionFile } from '../src/app/core/solution-workflow/files';
import { selectBudgetComparison } from '../src/app/core/budget-comparison';
import type { FileAvailability, V9PublicScenario } from '../src/app/core/v9-contracts';

const scenarios: V9PublicScenario[] = JSON.parse(
  readFileSync(new URL('./fixtures/v9-public-scenarios.json', import.meta.url), 'utf8'),
);
const expected: Record<
  string,
  { firstResult: string; currentStatus: string; availability: FileAvailability[] }
> = {
  'first-finalized': {
    firstResult: 'on-time',
    currentStatus: 'current',
    availability: ['present', 'present', 'present', 'present'],
  },
  'revised-pending': {
    firstResult: 'on-time',
    currentStatus: 'stale',
    availability: ['present', 'present', 'present', 'present'],
  },
  'file-missing': {
    firstResult: 'on-time',
    currentStatus: 'current',
    availability: ['present', 'missing', 'present', 'present'],
  },
  'file-unavailable': {
    firstResult: 'on-time',
    currentStatus: 'current',
    availability: ['present', 'unavailable', 'present', 'present'],
  },
  'file-checking': {
    firstResult: 'on-time',
    currentStatus: 'current',
    availability: ['present', 'checking', 'present', 'present'],
  },
};
for (const scenario of scenarios)
  test('PAR01 同场景样例与公开实现逐项对照 ' + scenario.id, async (t) => {
    const expectedView = expected[scenario.id] ?? {
      firstResult: scenario.id === 'historical-unscored' ? 'historical-unscored' : 'not-finalized',
      currentStatus: 'not-finalized',
      availability: ['missing', 'missing', 'missing', 'missing'],
    };
    const sample = createSeed();
    sample.solutionWorkspaces = scenario.workspace ? [structuredClone(scenario.workspace)] : [];
    const sampleView = selectSolutionWorkspace(
      sample,
      scenario.opportunityId,
      scenario.availability,
    );
    const normalize = (v: ReturnType<typeof selectSolutionWorkspace>) => ({
      firstResult: v.firstResult,
      currentStatus: v.currentStatus,
      availability: v.files.map((f) => f.availability),
    });
    const actual = createSeed();
    actual.solutionWorkspaces = [];
    actual.solutionSeries = [];
    actual.solutionDocuments = [];
    let actualView = selectSolutionWorkspace(actual, scenario.opportunityId, {});
    if (scenario.id === 'historical-unscored') {
      const legacy = createSeed();
      const old = legacy.solutionSeries![0];
      old.opportunityId = scenario.opportunityId;
      actualView = selectSolutionWorkspace(legacy, scenario.opportunityId, {});
    }
    if (expected[scenario.id]) {
      const { store, files, context, input } = await ready();
      // Use a real natural-day deadline three days ahead so this public-command test
      // remains on-time on future dates; the sample's semantic expectation stays literal.
      const day = createV9Dates(new Date().toISOString(), '2026-10-15').solutionBusinessDate;
      const deadline = new Date(Date.parse(day + 'T00:00:00Z') + 3 * 86400000)
        .toISOString()
        .slice(0, 10);
      assert.equal(
        changeSolutionDeadline(
          store,
          {
            opportunityId: input.opportunityId,
            scheduleRevision: input.scheduleRevision,
            deadlineDate: deadline,
            reason: 'PAR01受控相对期限',
          },
          { ...context, operationId: 'parity-schedule' },
        ).status,
        'committed',
      );
      input.scheduleRevision++;
      assert.equal((await finalizeSolution(store, input, context, files)).status, 'committed');
      const w = store
        .state()
        .solutionWorkspaces!.find((w) => w.opportunityId === input.opportunityId)!;
      const availability: Record<string, FileAvailability> = {};
      for (const v of w.versions) availability[v.id] = await checkSolutionFile(files, v);
      const bom = w.currentOutputs.bom!;
      if (scenario.id === 'file-missing') {
        const version = w.versions.find((v) => v.id === bom)!;
        await files.get(version.file!.blobId);
        const missing = await checkSolutionFile({ put: files.put, get: async () => null }, version);
        availability[bom] = missing;
      }
      if (scenario.id === 'file-unavailable')
        availability[bom] = await checkSolutionFile(
          {
            put: files.put,
            get: async () => {
              throw Error('controlled unavailable');
            },
          },
          w.versions.find((v) => v.id === bom)!,
        );
      if (scenario.id === 'file-checking') delete availability[bom];
      if (scenario.id === 'revised-pending') {
        const need = store.sale(input.opportunityId)!.productNeeds![0];
        assert.equal(
          store.saveProductNeed(input.opportunityId, { ...need, quantity: need.quantity + 1 }),
          true,
        );
      }
      actualView = selectSolutionWorkspace(store.state(), input.opportunityId, availability);
    }
    assert.deepEqual(normalize(sampleView), expectedView);
    assert.deepEqual(normalize(actualView), expectedView);
    // Budget scenarios compare the same known inputs against the actual public
    // budget query; absent/incomparable are semantically compared, never forced to zero.
    const budgetCases: Record<
      string,
      {
        amount: number | null;
        currencies: ('CNY' | 'EUR' | 'USD')[];
        comparable: boolean;
        scope: string;
      }
    > = {
      'budget-zero': { amount: 0, currencies: ['CNY'], comparable: true, scope: '全项目' },
      'budget-missing': { amount: null, currencies: ['CNY'], comparable: false, scope: '全项目' },
      'budget-multi-currency': {
        amount: 100,
        currencies: ['CNY', 'EUR', 'USD'],
        comparable: true,
        scope: '全项目',
      },
      'budget-incomparable': { amount: 100, currencies: ['CNY'], comparable: false, scope: '' },
      'budget-overspent': { amount: 100, currencies: ['CNY'], comparable: true, scope: '全项目' },
    };
    let budgetActual: unknown = null;
    const b = budgetCases[scenario.id];
    if (b) {
      const state = createSeed(),
        p = state.projects[0],
        base = p.plans.find((p) => p.type === '内部WBS')!;
      p.plans = b.currencies.map((currency, i) => ({
        ...base,
        id: 'PAR-' + currency,
        budgetAmount: b.amount === null ? undefined : b.amount * (i + 1),
        budgetCurrency: currency,
      }));
      state.budgetDemoExpenses =
        scenario.id === 'budget-overspent'
          ? [
              {
                expenseId: 'PAR-OVER',
                projectId: p.id,
                planId: 'PAR-CNY',
                scope: '全项目',
                amountMinor: 12000,
                currency: 'CNY',
                date: '2026-10-10',
                summary: '受控超支',
                sourceRecordId: 'PAR-OVER',
                batchId: 'PAR',
                cutoff: '2026-10-17',
                origin: 'simulated',
              },
            ]
          : [];
      state.budgetComparisonSources = b.currencies.map((currency) => ({
        projectId: p.id,
        currency,
        expenseIds: scenario.id === 'budget-overspent' ? ['PAR-OVER'] : [],
        scope: b.scope,
        cutoff: '2026-10-17',
        complete: true,
      }));
      if (scenario.id === 'budget-overspent') {
        assert.equal(selectBudgetComparison(state, p.id)[0].executionPercent, 120);
        assert.equal(selectBudgetComparison(state, p.id)[0].overspendMinor, 2000);
      }
      budgetActual = selectBudgetComparison(state, p.id).map((v) => ({
        amountMinor: v.budgetMinor,
        currency: v.currency,
        comparable: v.comparable,
      }));
      assert.deepEqual(
        budgetActual,
        scenario.budget.map((v) => ({
          amountMinor: v.amountMinor,
          currency: v.currency,
          comparable: v.comparable,
        })),
      );
    }
    t.diagnostic(
      JSON.stringify({
        scenario: scenario.id,
        independentExpected: expectedView,
        sample: normalize(sampleView),
        actual: normalize(actualView),
        budgetActual,
      }),
    );
  });
