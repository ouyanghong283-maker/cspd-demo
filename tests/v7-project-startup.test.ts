import '@angular/compiler';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BASE_DATE, OperationEvent } from '../src/app/core/models';
import { harness } from './v4-harness';

function preparedProject() {
  const { store, role } = harness();
  const project = store.project('DEMO-P003')!;
  store.state.update((state) => {
    const current = state.projects.find((item) => item.id === project.id)!;
    current.accepted = true;
    current.start = BASE_DATE;
    current.briefing.acceptance = '客户验收标准已核对';
    const contract = state.contracts.find((item) => item.id === current.contractId)!;
    contract.status = '已登记';
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
  return { store, role, projectId: project.id };
}

test('跨部门可完成启动但移交后交底和G4锁定，重复移交不新增事件', () => {
  const { store, role, projectId } = preparedProject();
  role('sales');
  const owner = store.project(projectId)!.pm;
  assert.equal(store.submitContractBriefing(projectId, '销售提交'), true);
  assert.equal(store.confirmContractBriefing(projectId, '跨部门确认'), true);
  assert.equal(store.recordProjectG4(projectId, '通过', '跨部门审核'), true);
  assert.equal(store.completeStartupHandover(projectId, owner, '显式移交'), true);
  const before = structuredClone(store.state());
  for (const result of ['退回', '附条件通过', '通过'] as const)
    assert.throws(() => store.recordProjectG4(projectId, result, '重写结果'), /已锁定/);
  assert.throws(() => store.submitContractBriefing(projectId, '重新交底'), /已锁定/);
  assert.throws(() => store.confirmContractBriefing(projectId, '重新确认'), /已锁定/);
  assert.equal(store.completeStartupHandover(projectId, owner, '重复移交'), true);
  assert.deepEqual(store.state(), before);
  assert.equal(store.project(projectId)!.pm, owner);
  assert.equal(store.project(projectId)!.briefing.g4?.result, '通过');
  store.state.update((state) => {
    state.projects.find((item) => item.id === projectId)!.start = '2026-10-09';
    return state;
  });
  assert.equal(store.canSubmitContractBriefing(projectId), true);
  assert.equal(store.submitContractBriefing(projectId, '来源变化后提交新版本'), true);
  const renewed = store.project(projectId)!;
  assert.equal(renewed.briefing.submission?.version, 2);
  assert.equal(renewed.briefing.startupHandover?.status, '待移交');
  assert.equal(renewed.briefing.g4?.result, '待审核');
  assert.ok(renewed.reviewReasons?.includes('briefing'));
  assert.equal(renewed.plans.find((item) => item.completionKind === 'briefing')?.status, '需复核');
  assert.equal(store.confirmContractBriefing(projectId, '确认新版'), true);
  assert.equal(store.recordProjectG4(projectId, '通过', '审核新版'), true);
  assert.equal(store.completeStartupHandover(projectId, owner, '移交新版'), true);
  assert.equal(store.project(projectId)!.reviewReasons?.includes('briefing'), false);
});

test('项目启动交底版本、PM确认、G4与正式移交分开记录且使用稳定定位事件', () => {
  const { store, role, projectId } = preparedProject();
  const startEvents = store.state().operationEvents?.length || 0;
  const assertLastEvent = (
    action: string,
    department: string,
    section: string,
    taskKind: string,
  ): OperationEvent => {
    const event = store.state().operationEvents!.at(-1)!;
    assert.equal(event.action, action);
    assert.equal(event.objectType, 'project');
    assert.equal(event.objectId, projectId);
    assert.equal(event.mainlineId, store.project(projectId)!.opportunityId);
    assert.equal(event.module, '项目启动');
    assert.equal(event.department, department);
    assert.equal(event.location.objectId, projectId);
    assert.equal(event.location.section, section);
    assert.equal(event.location.action, action);
    assert.equal(event.taskSource?.kind, taskKind);
    assert.equal(event.taskSource?.id, projectId);
    assert.equal(event.operator, store.person());
    assert.equal(event.dataVersion, store.state().dataVersion);
    return event;
  };

  role('sales');
  assert.equal(store.submitContractBriefing(projectId, '请复核差异与遗留项'), true);
  const firstSubmission = store.project(projectId)!.briefing.submission!;
  assert.equal(firstSubmission.version, 1);
  assert.equal(firstSubmission.submittedBy, '张销售');
  assert.ok(firstSubmission.submittedAt);
  assert.equal(
    assertLastEvent('提交合同交底', '销售', '合同交底', 'project-briefing').changes[0].after &&
      true,
    true,
  );
  assert.equal(store.project(projectId)!.briefing.confirmation, undefined);

  role('pm');
  assert.equal(store.confirmContractBriefing(projectId, '已核对当前合同交底'), true);
  assert.equal(store.project(projectId)!.briefing.confirmation?.version, 1);
  assertLastEvent('确认合同交底', 'PM', '合同交底', 'project-briefing');
  const contractId = store.project(projectId)!.contractId;
  const oldPayment = store.state().contracts.find((item) => item.id === contractId)!.payment;
  store.state.update((state) => {
    state.contracts.find((item) => item.id === contractId)!.payment = '来源变更待重新交底';
    return state;
  });
  const beforeStaleG4 = store.state().operationEvents!.length;
  role('pmo');
  assert.throws(() => store.recordProjectG4(projectId, '通过', '不能使用旧版本'), /来源已变化/);
  assert.equal(store.state().operationEvents!.length, beforeStaleG4);
  store.state.update((state) => {
    state.contracts.find((item) => item.id === contractId)!.payment = oldPayment;
    return state;
  });

  role('pm');
  const beforeStaleConfirmation = store.state().operationEvents!.length;
  store.state.update((state) => {
    state.projects.find((item) => item.id === projectId)!.name += '来源已变化';
    return state;
  });
  assert.throws(() => store.confirmContractBriefing(projectId, '旧版本'), /来源已变化/);
  assert.equal(store.state().operationEvents!.length, beforeStaleConfirmation);
  store.state.update((state) => {
    state.projects.find((item) => item.id === projectId)!.name =
      firstSubmission.snapshot.projectName;
    return state;
  });

  role('pmo');
  assert.equal(store.recordProjectG4(projectId, '附条件通过', '补齐客户现场接线图'), true);
  assert.notEqual(store.project(projectId)!.status, '项目执行中');
  assertLastEvent('记录G4附条件通过', 'PMO', 'G4审核', 'project-g4');
  role('pm');
  assert.throws(() => store.completeStartupHandover(projectId, '王项目', '完成移交'), /G4明确通过/);
  assert.equal(store.project(projectId)!.briefing.startupHandover?.status, '待移交');

  role('sales');
  assert.equal(store.submitContractBriefing(projectId, '已补充现场问题，请再次确认'), true);
  assert.equal(store.project(projectId)!.briefing.submission?.version, 2);
  assert.equal(store.project(projectId)!.briefing.g4?.result, '待审核');
  role('pm');
  assert.equal(store.confirmContractBriefing(projectId, '确认V2'), true);
  role('pmo');
  assert.equal(store.recordProjectG4(projectId, '通过', '当前条件满足启动要求'), true);
  assert.notEqual(store.project(projectId)!.status, '项目执行中', 'G4通过本身不等于移交完成');
  assertLastEvent('记录G4通过', 'PMO', 'G4审核', 'project-g4');
  role('pm');
  assert.equal(store.completeStartupHandover(projectId, '王项目', '移交项目团队执行'), true);
  assert.equal(store.project(projectId)!.status, '项目执行中');
  assert.equal(store.project(projectId)!.briefing.startupHandover?.briefingVersion, 2);
  assert.equal(store.state().operationEvents!.length, startEvents + 7);
  assertLastEvent('完成项目启动移交', 'PM', '正式移交', 'project-startup-handover');
});

test('交底与G4前置失败不发布事件，未确认的旧项目快照保持兼容', () => {
  const { store, role, projectId } = preparedProject();
  const before = store.state().operationEvents?.length || 0;
  role('pmo');
  assert.throws(() => store.recordProjectG4(projectId, '通过', '核对完成'), /确认最新合同交底/);
  assert.equal(store.state().operationEvents?.length || 0, before);

  role('sales');
  store.state.update((state) => {
    state.projects.find((item) => item.id === projectId)!.accepted = false;
    return state;
  });
  assert.throws(() => store.submitContractBriefing(projectId, '交底意见'), /PM接收/);
  assert.equal(store.state().operationEvents?.length || 0, before);

  const oldProject = structuredClone(store.project(projectId)!);
  delete oldProject.briefing.submission;
  delete oldProject.briefing.confirmation;
  delete oldProject.briefing.g4;
  delete oldProject.briefing.startupHandover;
  store.state.update((state) => {
    state.projects[state.projects.findIndex((item) => item.id === projectId)] = oldProject;
    return state;
  });
  assert.equal(store.project(projectId)!.briefing.submission, undefined);
  assert.equal((store.project(projectId)!.plans || []).length, (oldProject.plans || []).length);
});

test('普通旧版交底通过不等于G4或执行状态，写入失败不发布交底版本或事件', () => {
  const { store, role, projectId } = preparedProject();
  role('pm');
  const project = structuredClone(store.project(projectId)!);
  store.saveProject({ ...project, briefing: { ...project.briefing, acceptance: '逐项验收标准' } });
  store.submitBriefing(projectId);
  role('pmo');
  store.review(projectId, '通过', '旧版交底结果');
  assert.notEqual(store.project(projectId)!.status, '项目执行中');
  assert.equal(store.project(projectId)!.briefing.g4, undefined);
  assert.equal(store.project(projectId)!.briefing.startupHandover, undefined);

  role('sales');
  const before = structuredClone(store.project(projectId)!);
  const eventCount = store.state().operationEvents?.length || 0;
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
      () => store.submitContractBriefing(projectId, '本次提交不应发布'),
      /存储写入失败/,
    );
  } finally {
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage });
  }
  assert.deepEqual(store.project(projectId)!.briefing.submission, before.briefing.submission);
  assert.equal(store.state().operationEvents?.length || 0, eventCount);
});
