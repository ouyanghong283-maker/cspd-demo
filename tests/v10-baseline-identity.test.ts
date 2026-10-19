import { test } from 'node:test';
import assert from 'node:assert/strict';
import { harness } from './v4-harness';
import { selectV10ProjectIdentity, type V10QueryContext } from '../src/app/core/v10-contracts';

const context: V10QueryContext = {
  workspaceId: 'WS-IDENTITY',
  roundId: 'ROUND-IDENTITY',
  dataVersion: 1,
  contextRevision: 'READ-1',
  dates: {
    planObservationDate: '2026-10-15',
    solutionBusinessDate: '2026-10-18',
    realNowUtc: '2026-10-18T01:00:00.000Z',
    timezone: 'Asia/Shanghai',
    lastSuccessfulReadAt: '2026-10-18T01:00:00.000Z',
  },
  fileAvailability: {},
  sources: { projects: 'ready', customers: 'ready', opportunities: 'ready' },
};

function committedProject() {
  const { store, role } = harness();
  store.state().roundId = context.roundId;
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
  role('pm');
  const project = structuredClone(store.state().projects[0]);
  project.site = 'V10真实保存核对现场';
  assert.equal(store.saveProject(project), true);
  assert.ok(saved, '必须经过原保存入口成功提交');
  const state = JSON.parse(saved);
  return { state, project, context: { ...context, dataVersion: state.dataVersion } };
}

test('真实保存的项目经公开查询返回稳定关联、计数与上下文且零写入', () => {
  const { state, project, context } = committedProject();
  const before = structuredClone(state);
  const result = selectV10ProjectIdentity(state, context);
  const group = result.customers!.find((c) => c.customerId === project.customerId)!;
  assert.ok(group);
  assert.ok(
    group.projects.some(
      (p) => p.projectId === project.id && p.opportunityId === project.opportunityId,
    ),
  );
  assert.ok(
    group.opportunities.some(
      (o) => o.opportunityId === project.opportunityId && o.projectIds.includes(project.id),
    ),
  );
  assert.equal(result.counts!.projectCount, 8);
  assert.equal(result.workspaceId, 'WS-IDENTITY');
  assert.equal(result.contextRevision, 'READ-1');
  assert.equal(result.dataVersion, state.dataVersion);
  assert.equal(result.units.projects, 'project');
  assert.deepEqual(state, before);
});

test('同名不同客户ID分别归组，一商机两项目分别保留身份', () => {
  const { state, context } = committedProject();
  const first = state.projects[0];
  const customer = state.customers.find((c: any) => c.id === first.customerId);
  state.customers = [customer, { ...customer, id: 'CUSTOMER-SAME-NAME' }];
  const opportunity = state.sales.find((o: any) => o.id === first.opportunityId);
  state.sales = [
    opportunity,
    { ...opportunity, id: 'OPP-OTHER', customerId: 'CUSTOMER-SAME-NAME' },
  ];
  state.projects = [
    first,
    { ...first, id: 'PROJECT-SECOND' },
    {
      ...first,
      id: 'PROJECT-OTHER',
      customerId: 'CUSTOMER-SAME-NAME',
      opportunityId: 'OPP-OTHER',
      contractId: '',
    },
  ];
  const result = selectV10ProjectIdentity(state, context);
  assert.equal(result.counts!.customerCount, 2);
  assert.equal(result.counts!.projectCount, 3);
  assert.equal(result.customers![0].projectCount, 2);
  assert.deepEqual(result.customers![0].opportunities[0].projectIds, [first.id, 'PROJECT-SECOND']);
  assert.equal(result.customers![0].sourceHref, `/sales/customers/${first.customerId}`);
  assert.equal(
    result.customers![0].opportunities[0].sourceHref,
    `/sales/detail/${first.opportunityId}`,
  );
});

test('重复身份、缺失关联与矛盾主体单列待核，稳定项目计数不丢失', () => {
  const { state, context } = committedProject();
  const project = state.projects[0];
  const customer = state.customers.find((c: any) => c.id === project.customerId);
  const opportunity = state.sales.find((o: any) => o.id === project.opportunityId);
  state.customers = [customer, { ...customer, id: 'OTHER' }];
  state.sales = [opportunity];
  state.projects = [
    project,
    { ...project, id: 'MISSING', customerId: '' },
    { ...project, id: 'CONFLICT', customerId: 'OTHER' },
    { ...project, id: 'DUP' },
    { ...project, id: 'DUP', name: '同ID矛盾项目' },
    { ...project, id: '' },
    { ...project, id: 'NO-OPP', opportunityId: 'NOT-FOUND' },
  ];
  const before = structuredClone(state);
  const result = selectV10ProjectIdentity(state, context);
  assert.deepEqual(result.counts, {
    projectCount: 5,
    customerCount: 1,
    groupedProjectCount: 1,
    pendingProjectCount: 4,
    unidentifiedRecordCount: 1,
  });
  assert.equal(result.pending!.filter((p) => p.projectId === 'DUP').length, 1);
  assert.equal(result.pending!.find((p) => p.projectId === 'DUP')!.sourceHref, null);
  assert.ok(result.issues.some((i) => i.category === 'ambiguous' && i.objectId === 'DUP'));
  assert.ok(result.issues.some((i) => i.category === 'conflicting' && i.objectId === 'CONFLICT'));
  assert.ok(result.issues.some((i) => i.category === 'missing' && i.objectId === 'MISSING'));
  assert.deepEqual(state, before);
});

test('来源失败和加载中不伪装零，已验证空集合才返回零', () => {
  const { state, context } = committedProject();
  for (const status of ['unavailable', 'loading'] as const) {
    const result = selectV10ProjectIdentity(state, {
      ...context,
      sources: { ...context.sources, projects: status },
    });
    assert.equal(result.status, status);
    assert.equal(result.counts, null);
    assert.equal(result.customers, null);
    assert.ok(result.issues.some((i) => i.category === 'unavailable'));
  }
  const partial = selectV10ProjectIdentity(state, {
    ...context,
    sources: { ...context.sources, customers: 'unavailable' },
  });
  assert.equal(partial.counts!.projectCount, 8);
  assert.equal(partial.counts!.customerCount, null);
  assert.equal(partial.pending!.length, 8);
  state.projects = [];
  const empty = selectV10ProjectIdentity(state, context);
  assert.equal(empty.status, 'empty');
  assert.equal(empty.counts!.projectCount, 0);
  assert.equal(empty.counts!.customerCount, 0);
});

test('重复客户或商机ID不任取第一条，查询结果不携带可写业务引用', () => {
  for (const collection of ['customers', 'sales']) {
    const { state, context } = committedProject();
    const p = state.projects[0];
    state.projects = [p];
    const id = collection === 'customers' ? p.customerId : p.opportunityId;
    const source = state[collection].find((r: any) => r.id === id);
    state[collection].push({ ...source });
    const result = selectV10ProjectIdentity(state, context);
    assert.equal(result.counts!.projectCount, 1);
    assert.equal(result.counts!.customerCount, 0);
    assert.equal(result.pending![0].issues[0].category, 'ambiguous');
    const before = structuredClone(state);
    result.pending![0].name = '不得回写';
    assert.deepEqual(state, before);
  }
});

test('轮次和数据修订错配拒绝混批，旧快照没有修订时明确返回未知', () => {
  const { state, context } = committedProject();
  for (const change of [
    { roundId: 'OTHER' },
    { dataVersion: context.dataVersion + 1 },
    { workspaceId: '' },
    { contextRevision: '' },
  ]) {
    const result = selectV10ProjectIdentity(state, { ...context, ...change });
    assert.equal(result.status, 'unavailable');
    assert.equal(result.counts, null);
    assert.ok(result.issues.some((i) => i.objectType === 'context'));
  }
  delete state.dataVersion;
  assert.equal(
    selectV10ProjectIdentity(state, { ...context, dataVersion: null }).dataVersion,
    null,
  );
});

test('独立消费命令读取现有工作区提交格式，核对真实项目身份与只读性', async () => {
  const { mkdtemp, writeFile, readFile, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { spawnSync } = await import('node:child_process');
  const { WorkspaceStorage } = await import('../src/app/core/workspace-storage');
  const { state, project, context } = committedProject();
  const values = new Map<string, string>();
  const storage = new WorkspaceStorage(
    {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => {
        values.set(key, value);
      },
      removeItem: (key) => {
        values.delete(key);
      },
    },
    (value): value is typeof state => !!value && typeof value === 'object',
    () => context.workspaceId,
  );
  const saved = storage.createAndActivateRound(state);
  const directory = await mkdtemp(join(tmpdir(), 'v10-identity-'));
  try {
    const sourcePath = join(directory, 'workspace.json');
    const contextPath = join(directory, 'context.json');
    const raw = values.get(saved.workspaceKey)!;
    await writeFile(sourcePath, raw);
    await writeFile(contextPath, JSON.stringify(context));
    const run = spawnSync(
      process.execPath,
      ['--import', 'tsx', 'scripts/consume-v10-identity.ts', sourcePath, contextPath],
      { encoding: 'utf8' },
    );
    assert.equal(run.status, 0, run.stderr);
    const result = JSON.parse(run.stdout);
    assert.equal(result.counts.projectCount, 8);
    assert.ok(
      result.customers.some((g: any) => g.projects.some((p: any) => p.projectId === project.id)),
    );
    assert.equal(await readFile(sourcePath, 'utf8'), raw);
    await writeFile(sourcePath, '{broken');
    const bad = spawnSync(
      process.execPath,
      ['--import', 'tsx', 'scripts/consume-v10-identity.ts', sourcePath, contextPath],
      { encoding: 'utf8' },
    );
    assert.equal(bad.status, 1);
    assert.equal(JSON.parse(bad.stdout).counts, null);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('多个无ID旧项目分别待核，来源声明为空但带有记录时拒绝矛盾输入', () => {
  const { state, context } = committedProject();
  state.projects = [
    { ...state.projects[0], id: '' },
    { ...state.projects[0], id: '', name: '另一旧项目' },
  ];
  const result = selectV10ProjectIdentity(state, context);
  assert.equal(result.counts!.projectCount, 0);
  assert.equal(result.counts!.unidentifiedRecordCount, 2);
  assert.equal(new Set(result.issues.map((i) => i.id)).size, 2);
  const contradictory = selectV10ProjectIdentity(state, {
    ...context,
    sources: { ...context.sources, projects: 'empty' },
  });
  assert.equal(contradictory.status, 'unavailable');
  assert.equal(contradictory.counts, null);
});

test('非法业务日期与UTC时间不作为可用读取上下文输出', () => {
  const { state, context } = committedProject();
  for (const change of [
    { planObservationDate: '2026-02-30' },
    { solutionBusinessDate: '任意文本' },
    { realNowUtc: '2026-02-30T00:00:00.000Z' },
    { realNowUtc: '2026-10-18' },
    { lastSuccessfulReadAt: '无效时间' },
  ]) {
    const result = selectV10ProjectIdentity(state, {
      ...context,
      dates: { ...context.dates, ...change },
    });
    assert.equal(result.status, 'unavailable');
    assert.equal(result.counts, null);
    assert.ok(result.issues.some((i) => i.category === 'invalid'));
  }
});

test('客户或商机声明空但含记录时，保留项目数并将关联单列待核', () => {
  const { state, context } = committedProject();
  for (const domain of ['customers', 'opportunities'] as const) {
    const result = selectV10ProjectIdentity(state, {
      ...context,
      sources: { ...context.sources, [domain]: 'empty' },
    });
    assert.equal(result.counts!.projectCount, 8);
    assert.equal(result.counts!.customerCount, null);
    assert.equal(result.counts!.groupedProjectCount, 0);
    assert.equal(result.pending!.length, 8);
    assert.ok(result.issues.some((i) => i.category === 'conflicting'));
  }
});
