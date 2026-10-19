import '@angular/compiler';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Injector, runInInjectionContext } from '@angular/core';
import { ActivatedRoute, DefaultUrlSerializer, Router, convertToParamMap } from '@angular/router';
import { of } from 'rxjs';
import { SolutionWorkspace } from '../src/app/features/solution-workspace';
import { DemoStore } from '../src/app/core/store';
import { FiveCanKey, SolutionDocumentKind } from '../src/app/core/models';
import { harness } from './v4-harness';

const opportunityId = 'DEMO-O014';
const documentKinds: SolutionDocumentKind[] = ['技术方案', 'TIC', '设计BOM', 'SLD'];
const fiveCanKeys: FiveCanKey[] = ['可承诺', '可交付', '可运维', '可验收', '可续约'];

function createWorkspace(store: DemoStore, id = opportunityId): SolutionWorkspace {
  const route = {
    paramMap: of(convertToParamMap({ id })),
    queryParamMap: of(convertToParamMap({})),
  } as ActivatedRoute;
  const injector = Injector.create({
    providers: [
      { provide: DemoStore, useValue: store },
      { provide: Router, useValue: { parseUrl: (url: string) => new DefaultUrlSerializer().parse(url) } },
      { provide: ActivatedRoute, useValue: route },
    ],
  });
  return runInInjectionContext(injector, () => new SolutionWorkspace());
}

test('方案工作区从稳定商机ID组织来源、负责人、产品修订与资料版本摘要', () => {
  const { store } = harness();
  const opportunity = store.sale(opportunityId)!;
  opportunity.projectName = '北区储能项目';
  opportunity.productNeeds = [{ id: 'need-1', model: 'PCS-100', quantity: 2, unit: '台' }];
  opportunity.productNeedRevision = 4;
  for (const kind of documentKinds)
    assert.equal(store.addSolutionDocument(opportunityId, kind, `${kind}-V1.pdf`, '周方案'), true);

  const workspace = createWorkspace(store);
  const summary = workspace.overview()!;
  assert.equal(summary.sale.id, opportunityId);
  assert.equal(summary.sale.projectName, '北区储能项目');
  assert.equal(summary.needCount, 1);
  assert.equal(summary.requirementRevision, 4);
  assert.equal(summary.documents.length, 4);
  assert.ok(summary.documents.every((item) => item.versionLabel.startsWith('当前 V1')));
  assert.ok(summary.documents.every((item) => item.owner === '周方案'));
});

test('方案工作区展示有效确认、模拟核价和每项五可责任人状态', () => {
  const { store } = harness();
  store.sale(opportunityId)!.productNeeds = [
    { id: 'need-1', model: 'PCS-100', quantity: 1, unit: '台' },
  ];
  store.sale(opportunityId)!.productNeedRevision = 1;
  for (const kind of documentKinds)
    store.addSolutionDocument(opportunityId, kind, `${kind}-V1.pdf`, '周方案');
  assert.equal(store.confirmSolutionDocuments(opportunityId, '周方案'), true);
  assert.equal(
    store.recordSolutionCosting(
      opportunityId,
      { 'need-1': 12500 },
      'EUR',
      '不含税报价',
      '离线模拟成本表',
    ),
    true,
  );
  const items = Object.fromEntries(
    fiveCanKeys.map((key) => [
      key,
      { result: '满足' as const, owner: `${key}负责人`, opinion: '演示评估依据' },
    ]),
  ) as Record<FiveCanKey, { result: '满足'; owner: string; opinion: string }>;
  assert.equal(store.recordFiveCan(opportunityId, '当前资料', items, []), true);

  const summary = createWorkspace(store).overview()!;
  assert.equal(summary.confirmationLabel, '当前版本已确认');
  assert.match(summary.costingLabel, /模拟核价 · 当前/);
  assert.match(summary.costingDetail, /非正式定价政策/);
  assert.equal(summary.fiveCan.length, fiveCanKeys.length);
  assert.deepEqual(
    summary.fiveCan.map((item) => item.owner),
    fiveCanKeys.map((key) => `${key}负责人`),
  );

  store.addSolutionDocument(opportunityId, 'TIC', 'TIC-V2.pdf', '周方案');
  assert.match(createWorkspace(store).overview()!.costingLabel, /依据待复核/);
});

test('无效或线索来源不会呈现成有效方案工作区', () => {
  const { store } = harness();
  assert.equal(createWorkspace(store, 'missing-opportunity').overview(), undefined);
  assert.equal(createWorkspace(store, 'DEMO-L001').overview(), undefined);
});
