/** 原保存入口 -> 已提交快照 -> 独立公开消费；无页面/外围写入。 */
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { harness } from '../tests/v4-harness';
import { selectV10Board, type V10QueryContext } from '../src/app/core/v10-contracts';

const out = resolve('artifacts/v10-01-07', new Date().toISOString().replaceAll(':', '-'));
mkdirSync(out, { recursive: true });
const { store, role } = harness();
role('pm');
let saved = '';
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: {
    getItem: () => saved || null,
    setItem: (_key: string, value: string) => {
      saved = value;
    },
  },
});
assert.equal(store.saveProject({ ...store.state().projects[0], site: '01-07独立消费验收' }), true);
assert.ok(saved);
const snapshot = JSON.parse(saved);
const state = snapshot.snapshot ?? snapshot;
const context: V10QueryContext = {
  workspaceId: snapshot.workspaceId ?? 'WS-BOARD-ACCEPTANCE',
  roundId: state.roundId,
  dataVersion: state.dataVersion ?? null,
  contextRevision: 'BOARD-ACCEPTANCE-1',
  dates: {
    planObservationDate: '2026-10-15',
    solutionBusinessDate: '2026-10-18',
    realNowUtc: '2026-10-18T01:00:00.000Z',
    timezone: 'Asia/Shanghai',
    lastSuccessfulReadAt: '2026-10-18T01:00:00.000Z',
  },
  sources: { projects: 'ready', customers: 'ready', opportunities: 'ready', finance: 'ready' },
  fileAvailability: {},
};
const input = resolve(out, 'workspace.json'),
  ctx = resolve(out, 'context.json');
writeFileSync(input, saved);
writeFileSync(ctx, JSON.stringify(context, null, 2));
function freeze(value: unknown): void {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) return;
  Object.freeze(value);
  Object.values(value).forEach(freeze);
}
freeze(state);
freeze(context);
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  get: () => {
    throw Error('查询不能访问存储');
  },
});
const start = performance.now();
const result = selectV10Board(state, context);
const durationMs = performance.now() - start;
const run = spawnSync(
  process.execPath,
  ['--import', 'tsx', 'scripts/consume-v10-identity.ts', input, ctx, '--board'],
  { encoding: 'utf8' },
);
writeFileSync(resolve(out, 'cli.json'), run.stdout);
assert.equal(run.status, 0, run.stdout + run.stderr);
assert.deepEqual(JSON.parse(run.stdout), JSON.parse(JSON.stringify(result)));
assert.equal(readFileSync(input, 'utf8'), saved);
assert.equal(result.overview.finance.summary!.revenueMinor, 10500000);
assert.equal(result.overview.finance.summary!.grossProfitMinor, 1260000);
assert.equal(result.overview.finance.summary!.grossMargin, 0.12);
assert.deepEqual(result.overview.finance.summary!.coverage, { complete: 7, total: 8 });
const report = {
  out,
  workspaceId: context.workspaceId,
  roundId: context.roundId,
  dataVersion: context.dataVersion,
  durationMs,
  period: result.overview.finance.period,
  summary: result.overview.finance.summary,
  delivery: result.overview.execution.distribution,
  highGrade: result.highlights.highGrade?.map((p) => p.projectId),
  abnormal: result.highlights.abnormal?.map((p) => p.projectId),
  savedAndConsumed: true,
  sourceUnchanged: true,
  frozenInputs: true,
  storageAccessForbidden: true,
};
writeFileSync(resolve(out, 'report.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
