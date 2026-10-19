import '@angular/compiler';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Injector, runInInjectionContext } from '@angular/core';
import { Router } from '@angular/router';
import { MainlineGuide } from '../src/app/features/mainline-guide';
import { DemoStore } from '../src/app/core/store';
import { harness } from './v4-harness';
import { SolutionService } from '../src/app/features/solution-service';
import { DialogRequest } from '../src/app/core/models';

function completeOpportunityGate(store: DemoStore, id: string): void {
  store.saveProductNeed(id, { id: 'mainline-need', model: 'PCS-100', quantity: 1, unit: '台' });
  const template = store.state().attachments.find((item) => item.kind === '需求导入表')!;
  const kinds = ['核心技术方案', 'BOM清单', '单线图（SLD）', '衰减曲线'];
  for (const kind of kinds)
    store.state().attachments.push({
      ...template,
      id: `mainline-${kind}`,
      entityId: id,
      kind,
      name: `${kind}.pdf`,
    });
  store.saveTechnicalAssessment(id, {
    result: '满足',
    owner: '周方案',
    opinion: '模拟资料已齐备',
    evidenceAttachmentIds: store
      .quoteSourceCandidates(id)
      .filter((item) => kinds.includes(item.kind))
      .map((item) => item.id),
  });
  store.submitOpportunity(id);
  store.assignOpportunityPM(id, 'pm', '王项目', '2026-10-20 至 2026-11-15（模拟）');
  store.assignTeam(id, [
    {
      id: 'mainline-member',
      role: 'pm',
      person: '王项目',
      department: '交付部',
      window: '2026-10-20 至 2026-11-15（模拟）',
      confirmed: true,
      confirmedBy: '王项目',
    },
  ]);
  for (const task of store.sale(id)!.departmentTasks || [])
    store.completeDepartmentTask(id, task.id);
}

test('意向沟通补全保存后，指引提供下一阶段动作并继续交接方案角色', () => {
  const { store } = harness();
  if (!store.has('DEMO-L001', '需求导入表'))
    store.simulateDocument('DEMO-L001', '需求导入表', '需求.xlsx');
  const id = store.convert('DEMO-L001')!;
  const destinations: unknown[] = [];
  const injector = Injector.create({
    providers: [
      { provide: DemoStore, useValue: store },
      {
        provide: Router,
        useValue: {
          navigate(...args: unknown[]) {
            destinations.push(args);
          },
        },
      },
    ],
  });
  const guide = runInInjectionContext(injector, () => new MainlineGuide());
  store.saveSales({
    ...store.sale(id)!,
    description: '储能需求已确认',
    capacity: 10,
    amount: 120000,
    expectedDate: '2026-11-15',
    grade: 'A',
    tender: '否',
  });
  completeOpportunityGate(store, id);
  store.addActivity(id, {
    date: '2026-10-10',
    type: '电话',
    summary: '客户沟通已补全',
    people: '陈客户',
    next: '准备方案',
  });
  assert.equal(guide.flow().button, '进入方案报价');
  assert.notEqual(guide.flow().action, '继续推进商机：意向沟通');
  guide.continue();
  assert.equal(store.sale(id)!.stage, '方案报价');
  assert.equal(guide.flow().role, 'solution');
  assert.match(guide.flow().action, /核心技术方案/);
  assert.equal(destinations.length, 1);
});

test('核心方案上传后继续完成四类确认、核价和五可，再交接销售补服务条件', () => {
  const { store, role } = harness();
  store.simulateDocument('DEMO-L001', '需求导入表', '需求.xlsx');
  const id = store.convert('DEMO-L001')!;
  store.saveSales({
    ...store.sale(id)!,
    description: '储能需求',
    capacity: 10,
    amount: 120000,
    expectedDate: '2026-11-15',
    grade: 'A',
    tender: '否',
  });
  completeOpportunityGate(store, id);
  store.advance(id);
  role('solution');
  const destinations: unknown[] = [];
  let dialog!: DialogRequest;
  Object.assign(store.ui, {
    open: (request: DialogRequest) => {
      dialog = request;
    },
  });
  // Keep the harness role and persisted role in sync when the real guide hands work over.
  store.setRole = (next) => {
    role(next);
  };
  const injector = Injector.create({
    providers: [
      { provide: DemoStore, useValue: store },
      {
        provide: Router,
        useValue: {
          navigate(...args: unknown[]) {
            destinations.push(args);
          },
        },
      },
    ],
  });
  const guide = runInInjectionContext(injector, () => new MainlineGuide());
  const workspace = runInInjectionContext(injector, () => new SolutionService());
  Object.assign(workspace, { opportunityId: () => id });
  workspace.upload();
  assert.equal(dialog.onSave({ name: '方案首版.pdf', owner: '周方案', note: '首版交付' }), true);
  assert.ok(store.solution(id)?.latestVersionId);
  assert.equal(guide.flow().tab, '方案', '核心方案上传不能替代四类确认、核价和会签');
  assert.equal(guide.flow().role, 'solution');
  assert.equal(guide.flow().owner, '解决方案', '接手人显示必须与实际交接角色一致');
  assert.ok(guide.flow().missing.some((item) => item.includes('四类方案资料')));
  guide.continue();
  assert.equal(store.role(), 'solution');
  assert.deepEqual(destinations.at(-1), [
    [`/sales/detail/${id}`],
    { queryParams: { tab: '方案', guide: 'mainline' } },
  ]);
  for (const kind of workspace.documentKinds) {
    workspace.uploadSolutionDocument(kind);
    assert.equal(dialog.onSave({ name: `${kind}.pdf`, owner: '周方案', note: '主线资料' }), true);
  }
  assert.equal(guide.flow().tab, '方案');
  assert.ok(guide.flow().missing.some((item) => item.includes('负责人尚未确认')));
  workspace.confirmCurrentSolution();
  assert.equal(dialog.onSave({ owner: '周方案' }), true);
  assert.ok(guide.flow().missing.some((item) => item.includes('模拟核价')));
  workspace.startCosting();
  assert.equal(
    dialog.onSave({
      'cost-mainline-need': '10000',
      currency: store.sale(id)!.currency,
      taxBasis: '不含税报价',
      source: '主线模拟成本表',
    }),
    true,
  );
  assert.equal(guide.flow().tab, '方案');
  assert.ok(guide.flow().missing.some((item) => item.includes('五可')));
  workspace.startFiveCan();
  assert.equal(
    dialog.onSave(
      Object.fromEntries(
        Object.entries(dialog.sample!).map(([key, value]) => [key, String(value)]),
      ),
    ),
    true,
  );
  assert.equal(guide.flow().tab, '服务条件', '上传成功后应明确带销售补齐正式报价前置');
  assert.match(guide.flow().button, /服务条件/);
  guide.continue();
  assert.equal(store.role(), 'sales');
  assert.deepEqual(destinations.at(-1), [
    [`/sales/detail/${id}`],
    { queryParams: { tab: '服务条件', guide: 'mainline' } },
  ]);
  assert.equal(store.sale(id)!.stage, '方案报价', '交付方案不代表正式报价已发出');
  store.saveServiceTerms({ ...store.terms(id), years: 2, scope: '设备质量', sla: '24小时响应' });
  store.confirmServiceTerms(id, store.terms(id).revision);
  store.saveAgreement({ ...store.agreement(id), applicability: '不购买', reason: '只购买设备' });
  store.confirmAgreement(id, store.agreement(id).revision);
  assert.equal(guide.flow().tab, '报价');
  workspace.continueAfterSolution();
  assert.deepEqual(destinations.at(-1), [['/sales/quotes', id]]);
  assert.ok(store.createQuote(id));
  assert.throws(() => store.advance(id), /至少记录一版已发出/);
});

test('特殊服务下一步交给运维复核，完成后再交接销售报价', () => {
  const { store, role } = harness();
  const id = 'DEMO-O014';
  store.saveServiceTerms({
    ...store.terms(id),
    kind: '特殊',
    years: 2,
    scope: '设备质量',
    sla: '24小时响应',
    special: '现场保障',
  });
  store.confirmServiceTerms(id, store.terms(id).revision);
  store.saveAgreement({ ...store.agreement(id), applicability: '不购买', reason: '只购买设备' });
  store.confirmAgreement(id, store.agreement(id).revision);
  assert.equal(store.solutionNextStep(id).role, 'receiver');
  role('receiver');
  store.reviewServiceTerms(id, store.terms(id).revision, '可接受', '服务能力可满足');
  assert.equal(store.solutionNextStep(id).role, 'sales');
  assert.equal(store.solutionNextStep(id).tab, '报价');
});

test('运维退回的特殊服务交回销售修改；提前交付方案不跳过意向阶段', () => {
  const { store, role } = harness();
  const id = 'DEMO-O014';
  store.saveServiceTerms({
    ...store.terms(id),
    kind: '特殊',
    years: 2,
    scope: '设备质量',
    sla: '24小时响应',
    special: '现场保障',
  });
  store.confirmServiceTerms(id, store.terms(id).revision);
  role('receiver');
  store.reviewServiceTerms(id, store.terms(id).revision, '需调整', '需要调整服务范围');
  assert.equal(store.solutionNextStep(id).role, 'sales');
  assert.match(store.solutionNextStep(id).label, /修改特殊服务/);
  assert.equal(store.solutionNextStep('DEMO-O001').tab, '概览');
  assert.match(store.solutionNextStep('DEMO-O001').label, /进入方案报价/);
});
