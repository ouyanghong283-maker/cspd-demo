import '@angular/compiler';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BASE_DATE, OperationEvent } from '../src/app/core/models';
import { STARTUP_CONTENT_FIELDS } from '../src/app/core/project-startup';
import { harness } from './v4-harness';

function preparedProject() {
  const { store, role } = harness();
  const project = store.project('DEMO-P003')!;
  store.state.update((state) => {
    const current = state.projects.find((item) => item.id === project.id)!;
    current.accepted = true;
    current.start = BASE_DATE;
    state.contracts.find((item) => item.id === current.contractId)!.status = '已登记';
    return state;
  });
  return { store, role, projectId: project.id };
}

function lastEvent(store: ReturnType<typeof harness>['store'], projectId: string): OperationEvent {
  const event = store.state().operationEvents!.at(-1)!;
  assert.equal(event.objectType, 'project');
  assert.equal(event.objectId, projectId);
  assert.equal(event.module, '项目启动');
  assert.equal(event.location.objectId, projectId);
  assert.equal(event.location.section, '启动资料');
  return event;
}

test('部门内容字段有唯一维护部门，其他部门不能代填', () => {
  assert.deepEqual(
    STARTUP_CONTENT_FIELDS.map((field) => [field.key, field.department]),
    [
      ['start', 'pm'],
      ['site', 'pm'],
      ['siteConditions', 'pm'],
      ['acceptance', 'solution'],
      ['production', 'delivery'],
      ['shipping', 'delivery'],
      ['commissioning', 'delivery'],
    ],
  );
});

test('启动交底各部门内容按归属保存，其他部门内容不被覆盖', () => {
  const { store, role, projectId } = preparedProject();
  role('opm');
  const before = structuredClone(store.project(projectId)!);
  assert.equal(
    store.saveStartupContent(projectId, 'delivery', {
      production: '45个工作日（订单交付维护）',
      shipping: '15个工作日（订单交付维护）',
      commissioning: '2026-11-20',
    }),
    true,
  );
  const event = lastEvent(store, projectId);
  assert.equal(event.action, '保存启动资料');
  assert.equal(event.department, '订单交付');
  assert.equal(event.taskSource?.kind, 'project-startup');
  assert.equal(event.operator, store.person());
  const afterDelivery = store.project(projectId)!;
  assert.deepEqual(
    [
      afterDelivery.briefing.production,
      afterDelivery.briefing.shipping,
      afterDelivery.briefing.commissioning,
    ],
    ['45个工作日（订单交付维护）', '15个工作日（订单交付维护）', '2026-11-20'],
  );
  assert.equal(afterDelivery.briefing.acceptance, before.briefing.acceptance);
  assert.equal(afterDelivery.start, before.start);
  assert.equal(afterDelivery.site, before.site);

  role('solution');
  assert.equal(
    store.saveStartupContent(projectId, 'solution', { acceptance: '逐项配置核对后签认' }),
    true,
  );
  const solutionEvent = lastEvent(store, projectId);
  assert.equal(solutionEvent.department, '解决方案');
  const afterSolution = store.project(projectId)!;
  assert.equal(afterSolution.briefing.acceptance, '逐项配置核对后签认');
  assert.equal(afterSolution.briefing.production, '45个工作日（订单交付维护）');

  role('pm');
  assert.equal(
    store.saveStartupContent(projectId, 'pm', {
      start: '2026-10-12',
      siteConditions: '具备卸货及进场条件',
    }),
    true,
  );
  const pmEvent = lastEvent(store, projectId);
  assert.equal(pmEvent.department, 'PM');
  const afterPm = store.project(projectId)!;
  assert.equal(afterPm.start, '2026-10-12');
  assert.equal(afterPm.siteConditions, '具备卸货及进场条件');
  assert.equal(afterPm.briefing.acceptance, '逐项配置核对后签认');
});

test('保存本部门内容不代替PM/PMO门禁，也不重复派人', () => {
  const { store, role, projectId } = preparedProject();
  const teamBefore = structuredClone(store.project(projectId)!.team);
  const opportunityTeam = structuredClone(
    store.sale(store.project(projectId)!.opportunityId)!.team,
  );
  const eventsBefore = store.state().operationEvents?.length || 0;
  role('opm');
  store.saveStartupContent(projectId, 'delivery', { shipping: '15个工作日' });
  const after = store.project(projectId)!;
  assert.deepEqual(after.team, teamBefore);
  assert.deepEqual(store.sale(after.opportunityId)!.team, opportunityTeam);
  assert.equal(after.briefing.submission, undefined);
  assert.equal(after.briefing.confirmation, undefined);
  assert.equal(after.briefing.g4, undefined);
  assert.equal(after.briefing.startupHandover, undefined);
  const newEvents = (store.state().operationEvents || []).slice(eventsBefore);
  assert.equal(newEvents.length, 1);
  assert.equal(
    newEvents.some((event) => /指定部门团队|确认参与|G4|移交/.test(event.action)),
    false,
  );
  assert.deepEqual(store.startupGate(projectId).actions.submit, {
    allowed: true,
    reason: '',
  });
  assert.equal(store.startupGate(projectId).actions.g4.allowed, false);
});

test('部门保存只接受本部门字段，越权或空保存被拒且不留痕', () => {
  const { store, role, projectId } = preparedProject();
  const before = structuredClone(store.project(projectId)!);
  const events = store.state().operationEvents?.length || 0;
  const history = store.history(projectId).length;
  role('opm');
  assert.throws(
    () => store.saveStartupContent(projectId, 'delivery', { acceptance: '越权填写验收标准' }),
    /验收标准.*解决方案/,
  );
  assert.throws(
    () => store.saveStartupContent(projectId, 'sales', { production: '越权' }),
    /订单生产周期.*订单 \/ 交付协同/,
  );
  assert.throws(() => store.saveStartupContent(projectId, 'delivery', {}), /请填写/);
  assert.throws(
    () => store.saveStartupContent(projectId, 'delivery', { shipping: '   ' }),
    /请填写/,
  );
  assert.deepEqual(store.project(projectId), before);
  assert.equal(store.state().operationEvents?.length || 0, events);
  assert.equal(store.history(projectId).length, history);
});

test('关键来源变化保留原确认依据并按待复核显示，旧确认不指向新版本', () => {
  const { store, role, projectId } = preparedProject();
  store.state.update((state) => {
    const current = state.projects.find((item) => item.id === projectId)!;
    current.briefing.acceptance = '原验收标准';
    state.attachments.push(
      ...['启动纪要', '启动文件'].map((kind, index) => ({
        id: `startup-doc-${index}`,
        entityId: current.id,
        kind,
        name: `${kind}.pdf`,
        size: 0,
        date: BASE_DATE,
        operator: '张销售',
        sample: true,
        url: '',
        mode: 'simulated' as const,
      })),
    );
    return state;
  });
  role('sales');
  store.submitContractBriefing(projectId, '按原验收标准交底');
  role('pm');
  store.confirmContractBriefing(projectId, '按原验收标准确认');
  const confirmed = structuredClone(store.project(projectId)!.briefing.confirmation);
  const recorded = structuredClone(store.project(projectId)!.briefing.submission!.snapshot);

  role('solution');
  assert.equal(
    store.saveStartupContent(projectId, 'solution', { acceptance: '来源修订后的验收标准' }),
    true,
  );

  const after = store.project(projectId)!;
  assert.equal(after.briefing.review, '待提交');
  assert.ok(after.reviewReasons?.includes('briefing'));
  assert.deepEqual(after.briefing.confirmation, confirmed);
  assert.deepEqual(after.briefing.submission!.snapshot, recorded);
  assert.equal(after.briefing.submission!.version, confirmed!.version);
  assert.ok(store.history(projectId).some((item) => item.action.includes('原验收标准')));
  const gate = store.startupGate(projectId);
  assert.equal(gate.confirmationNeedsReview, true);
  assert.deepEqual(gate.changedSources, ['验收标准']);
  assert.deepEqual(gate.actions.g4, {
    allowed: false,
    reason: '合同或启动资料来源已变化，请重新提交并确认交底版本',
  });
  role('sales');
  assert.equal(store.submitContractBriefing(projectId, '按修订后验收标准重新交底'), true);
  assert.equal(store.project(projectId)!.briefing.submission!.version, 2);
  assert.equal(store.project(projectId)!.briefing.confirmation, undefined);
  // 新版本记录的是重新提交时的来源快照，所以与当前来源一致；旧确认仍停在原依据上
  assert.equal(
    store.project(projectId)!.briefing.submission!.snapshot.acceptance,
    '来源修订后的验收标准',
  );
  assert.deepEqual(store.startupGate(projectId).changedSources, []);
});

test('保存失败不写成功历史与进度，内容与门禁保持不变', () => {
  const { store, role, projectId } = preparedProject();
  role('pm');
  const before = structuredClone(store.project(projectId)!);
  const events = store.state().operationEvents?.length || 0;
  const history = store.history(projectId).length;
  const storage = globalThis.localStorage;
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: () => null,
      setItem: () => {
        throw new Error('存储写入失败');
      },
    },
  });
  try {
    assert.throws(
      () => store.saveStartupContent(projectId, 'pm', { start: '2026-10-12' }),
      /存储写入失败/,
    );
  } finally {
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage });
  }
  assert.deepEqual(store.project(projectId), before);
  assert.equal(store.state().operationEvents?.length || 0, events);
  assert.equal(store.history(projectId).length, history);
});
