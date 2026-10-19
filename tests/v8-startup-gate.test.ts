import '@angular/compiler';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BASE_DATE } from '../src/app/core/models';
import { migrateV4 } from '../src/app/core/v4';
import {
  STARTUP_BRIEFING_DOCUMENT_KINDS,
  startupGateActions,
} from '../src/app/core/project-startup';
import { harness } from './v4-harness';

function preparedProject() {
  const { store, role } = harness();
  const project = store.project('DEMO-P003')!;
  store.state.update((state) => {
    const current = state.projects.find((item) => item.id === project.id)!;
    current.accepted = true;
    current.start = BASE_DATE;
    current.briefing.acceptance = '客户验收标准已核对';
    state.contracts.find((item) => item.id === current.contractId)!.status = '已登记';
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

test('门禁前置按显式动作分别给出原因，满足后放行', () => {
  const empty = startupGateActions({
    accepted: false,
    contractRegistered: false,
    submissionVersion: null,
    submissionMatchesSource: false,
    confirmationVersion: null,
    g4Result: '',
    handoverStatus: '',
    missing: [],
  });
  assert.deepEqual(empty.submit, {
    allowed: false,
    reason: '请先关联已登记合同并由PM接收项目',
  });
  assert.deepEqual(empty.confirm, { allowed: false, reason: '销售尚未提交合同交底' });
  assert.deepEqual(empty.g4, { allowed: false, reason: '请先由PM确认最新合同交底版本' });
  assert.deepEqual(empty.handover, { allowed: false, reason: '请先确认当前合同交底版本' });

  const submitted = startupGateActions({
    accepted: true,
    contractRegistered: true,
    submissionVersion: 1,
    submissionMatchesSource: true,
    confirmationVersion: 1,
    g4Result: '待审核',
    handoverStatus: '待移交',
    missing: ['启动纪要'],
  });
  assert.deepEqual(submitted.submit, { allowed: true, reason: '' });
  assert.deepEqual(submitted.confirm, { allowed: true, reason: '' });
  assert.deepEqual(submitted.g4, { allowed: false, reason: '交底资料仍缺：启动纪要' });
  assert.deepEqual(submitted.handover, {
    allowed: false,
    reason: '只有G4明确通过后才能完成项目启动移交',
  });

  const confirmed = startupGateActions({
    accepted: true,
    contractRegistered: true,
    submissionVersion: 1,
    submissionMatchesSource: true,
    confirmationVersion: 1,
    g4Result: '通过',
    handoverStatus: '待移交',
    missing: [],
  });
  assert.deepEqual(confirmed.g4, { allowed: true, reason: '' });
  assert.deepEqual(confirmed.handover, { allowed: true, reason: '' });
});

test('移交完成后交底与G4锁定，重复移交不新增记录', () => {
  const locked = startupGateActions({
    accepted: true,
    contractRegistered: true,
    submissionVersion: 1,
    submissionMatchesSource: true,
    confirmationVersion: 1,
    g4Result: '通过',
    handoverStatus: '已移交',
    missing: [],
  });
  assert.deepEqual(locked.submit, {
    allowed: false,
    reason: '启动移交已完成，当前交底版本已锁定',
  });
  assert.deepEqual(locked.confirm, {
    allowed: false,
    reason: '启动移交已完成，当前交底确认已锁定',
  });
  assert.deepEqual(locked.g4, { allowed: false, reason: '启动移交已完成，当前G4审核已锁定' });
  assert.equal(locked.handover.reason, '启动移交已完成，重复确认不新增记录');
});

test('来源版本变化后门禁继续按原交底版本判定，旧的确认不能指向新版本', () => {
  const changed = startupGateActions({
    accepted: true,
    contractRegistered: true,
    submissionVersion: 1,
    submissionMatchesSource: false,
    confirmationVersion: 1,
    g4Result: '待审核',
    handoverStatus: '待移交',
    missing: [],
  });
  assert.deepEqual(changed.confirm, {
    allowed: false,
    reason: '交底来源已变化，请销售重新提交当前版本',
  });
  assert.deepEqual(changed.g4, {
    allowed: false,
    reason: '合同或启动资料来源已变化，请重新提交并确认交底版本',
  });
  assert.deepEqual(changed.handover, {
    allowed: false,
    reason: '合同或启动资料来源已变化，请重新提交并确认交底版本',
  });
});

test('普通保存与资料上传不推进G4或移交，失败路径不写成功历史与进度', () => {
  const { store, role, projectId } = preparedProject();
  role('pm');
  const project = structuredClone(store.project(projectId)!);
  const events = store.state().operationEvents?.length || 0;
  assert.equal(
    store.saveProject({
      ...project,
      briefing: { ...project.briefing, production: '45个工作日（订单交付维护）' },
    }),
    true,
  );
  role('sales');
  store.simulateDocument(projectId, '启动纪要', '启动纪要.pdf');
  store.simulateDocument(projectId, '启动文件', '启动文件.pdf');
  const after = store.project(projectId)!;
  assert.equal(after.briefing.g4, undefined);
  assert.equal(after.briefing.startupHandover, undefined);
  assert.notEqual(after.status, '项目执行中');
  assert.equal(after.briefing.submission, undefined);
  const progress = store.state().operationEvents!.slice(events);
  assert.equal(
    progress.some((event) => /G4|移交/.test(event.action)),
    false,
  );
});

test('交底资料区类目与来源版本快照口径一致，补交合同交底不推进门禁', () => {
  const { store, role, projectId } = preparedProject();
  assert.deepEqual([...STARTUP_BRIEFING_DOCUMENT_KINDS], ['合同交底', '启动纪要', '启动文件']);
  role('sales');
  assert.equal(store.has(projectId, '合同交底'), false);
  const gateBeforeUpload = store.startupGate(projectId);
  // 进入交底来源快照的每个类目都必须能在页签资料区补交，否则该类资料无法进入交底版本
  for (const kind of STARTUP_BRIEFING_DOCUMENT_KINDS)
    assert.equal(store.simulateDocument(projectId, kind, `${kind}.pdf`, '交底包补交'), true, kind);
  const filed = store.attachments(projectId, '合同交底').at(-1)!;
  // 上传只是资料留档：不生成交底版本，也不推进G4与移交，门禁读模型不变
  const afterUpload = store.project(projectId)!;
  assert.equal(afterUpload.briefing.submission, undefined);
  assert.equal(afterUpload.briefing.g4, undefined);
  assert.equal(afterUpload.briefing.startupHandover, undefined);
  assert.deepEqual(store.startupGate(projectId), gateBeforeUpload);

  assert.equal(store.submitContractBriefing(projectId, '交底资料已齐备'), true);
  const snapshot = store.project(projectId)!.briefing.submission!.snapshot;
  assert.ok(snapshot.attachmentIds.includes(filed.id), '合同交底未进入来源版本快照');
  assert.deepEqual(
    [
      ...new Set(
        store
          .attachments(projectId)
          .filter((item) => snapshot.attachmentIds.includes(item.id))
          .map((item) => item.kind),
      ),
    ].sort(),
    [...STARTUP_BRIEFING_DOCUMENT_KINDS].sort(),
  );
});

test('交底关键内容与门禁同源：改交期后状态待复核且显式动作被拒，重新提交后恢复', () => {
  const { store, role, projectId } = preparedProject();
  role('sales');
  assert.equal(store.submitContractBriefing(projectId, '按当前交期交底'), true);
  role('pm');
  assert.equal(store.confirmContractBriefing(projectId, '确认V1'), true);
  const confirmed = store.project(projectId)!;
  const recorded = structuredClone(confirmed.briefing.submission!.snapshot);
  assert.deepEqual(store.startupGate(projectId).actions.g4, { allowed: true, reason: '' });

  role('opm');
  assert.equal(
    store.saveStartupContent(projectId, 'delivery', { shipping: '25个工作日（交期修订）' }),
    true,
  );
  const after = store.project(projectId)!;
  // 状态提示与门禁读的是同一份来源版本：不再出现"提示待复核但按钮仍可用"
  assert.equal(after.status, '交底待复核');
  assert.ok(after.reviewReasons?.includes('briefing'));
  const gate = store.startupGate(projectId);
  assert.equal(gate.submissionMatchesSource, false);
  assert.deepEqual(gate.changedSources, ['发货周期']);
  assert.equal(gate.confirmationNeedsReview, true);
  assert.deepEqual(gate.actions.confirm, {
    allowed: false,
    reason: '交底来源已变化，请销售重新提交当前版本',
  });
  assert.deepEqual(gate.actions.g4, {
    allowed: false,
    reason: '合同或启动资料来源已变化，请重新提交并确认交底版本',
  });
  assert.deepEqual(gate.actions.handover, {
    allowed: false,
    reason: '合同或启动资料来源已变化，请重新提交并确认交底版本',
  });
  assert.equal(gate.actions.submit.allowed, true);
  // 原确认依据与已提交快照原样保留，未改指新版本
  assert.deepEqual(after.briefing.confirmation, confirmed.briefing.confirmation);
  assert.deepEqual(after.briefing.submission!.snapshot, recorded);

  role('sales');
  assert.equal(store.submitContractBriefing(projectId, '按修订交期重新交底'), true);
  assert.equal(
    store.project(projectId)!.briefing.submission!.snapshot.shipping,
    '25个工作日（交期修订）',
  );
  assert.deepEqual(store.startupGate(projectId).changedSources, []);
  assert.equal(store.startupGate(projectId).actions.confirm.allowed, true);
});

test('旧交底快照缺少交底关键内容时按当前内容补齐，保持幂等且不误报待复核', () => {
  const { store, role, projectId } = preparedProject();
  role('sales');
  assert.equal(store.submitContractBriefing(projectId, '旧口径交底'), true);
  const state = store.state();
  const snapshot = store.project(projectId)!.briefing.submission!.snapshot as unknown as Record<
    string,
    unknown
  >;
  for (const key of ['production', 'shipping', 'commissioning']) delete snapshot[key];
  assert.equal(store.startupGate(projectId).submissionMatchesSource, false);

  migrateV4(state);
  assert.equal(store.startupGate(projectId).submissionMatchesSource, true);
  assert.deepEqual(store.startupGate(projectId).changedSources, []);
  const project = store.project(projectId)!;
  assert.equal(project.briefing.submission!.snapshot.production, project.briefing.production || '');
  assert.ok(
    state.history.some(
      (entry) => entry.entityId === projectId && entry.action.includes('旧交底来源快照缺少'),
    ),
  );
  const once = JSON.stringify(state);
  migrateV4(state);
  assert.equal(JSON.stringify(state), once);
});

test('空值与缺省值按同一口径比较，未改动内容不翻转待复核状态', () => {
  const { store, role, projectId } = preparedProject();
  role('pm');
  store.state.update((state) => {
    const project = state.projects.find((item) => item.id === projectId)!;
    project.start = undefined as unknown as string;
    return state;
  });
  const before = structuredClone(store.project(projectId)!);
  const events = store.state().operationEvents?.length || 0;
  // 旧数据缺省与空串同义：保存空值与放弃修改都不算来源变化
  assert.equal(store.saveStartupContent(projectId, 'pm', { start: '' }), true);
  assert.deepEqual(store.project(projectId), before);
  assert.equal(store.state().operationEvents?.length || 0, events);
  assert.equal(store.project(projectId)!.status, before.status);
  assert.equal(store.project(projectId)!.reviewReasons?.includes('briefing') || false, false);
});

test('部门保存拒绝把已维护内容保存为空值，越权字段一并拒绝', () => {
  const { store, role, projectId } = preparedProject();
  const before = structuredClone(store.project(projectId)!);
  const events = store.state().operationEvents?.length || 0;
  role('opm');
  assert.throws(
    () => store.saveStartupContent(projectId, 'delivery', { acceptance: '越权验收标准' }),
    /【验收标准】由解决方案维护/,
  );
  assert.throws(
    () => store.saveStartupContent(projectId, 'delivery', { production: '', shipping: '' }),
    /【订单生产周期】不能保存为空，请填写有效值；【发货周期】不能保存为空，请填写有效值/,
  );
  assert.throws(() => store.saveStartupContent(projectId, 'delivery', {}), /请填写/);
  assert.deepEqual(store.project(projectId), before);
  assert.equal(store.state().operationEvents?.length || 0, events);
});

test('门禁读模型给出适用前置和待复核来源，来源变化不改写原确认依据', () => {
  const { store, role, projectId } = preparedProject();
  role('sales');
  assert.deepEqual(store.startupGate(projectId).actions.confirm, {
    allowed: false,
    reason: '销售尚未提交合同交底',
  });
  assert.deepEqual(store.startupGate(projectId).changedSources, []);
  assert.equal(store.submitContractBriefing(projectId, '提交V1并保留依据'), true);
  role('pm');
  assert.equal(store.confirmContractBriefing(projectId, '确认V1'), true);
  const confirmed = structuredClone(store.project(projectId)!.briefing.confirmation);
  const recordedBasis = structuredClone(store.project(projectId)!.briefing.submission!.snapshot);
  assert.equal(store.startupGate(projectId).confirmationNeedsReview, false);

  const contractId = store.project(projectId)!.contractId;
  store.state.update((state) => {
    state.contracts.find((item) => item.id === contractId)!.payment = '来源变更：30%预付';
    return state;
  });

  const gate = store.startupGate(projectId);
  assert.equal(gate.confirmationNeedsReview, true);
  assert.deepEqual(gate.changedSources, ['合同付款条款']);
  assert.deepEqual(gate.actions.confirm, {
    allowed: false,
    reason: '交底来源已变化，请销售重新提交当前版本',
  });
  assert.deepEqual(gate.actions.g4, {
    allowed: false,
    reason: '合同或启动资料来源已变化，请重新提交并确认交底版本',
  });
  assert.equal(gate.actions.submit.allowed, true);
  const after = store.project(projectId)!;
  assert.deepEqual(after.briefing.confirmation, confirmed);
  assert.deepEqual(after.briefing.submission!.snapshot, recordedBasis);
  assert.equal(after.briefing.submission!.version, confirmed!.version);

  const events = store.state().operationEvents!.length;
  role('pmo');
  assert.throws(() => store.recordProjectG4(projectId, '通过', '不应用旧确认依据'), /来源已变化/);
  assert.equal(store.state().operationEvents!.length, events);
});

test('Store显式动作的拒绝理由与门禁读模型一致，且不写事件', () => {
  const { store, role, projectId } = preparedProject();
  const cases = [
    ['g4', () => store.recordProjectG4(projectId, '通过', '缺少PM确认')],
    ['handover', () => store.completeStartupHandover(projectId, '王项目', '缺少交底确认')],
  ] as const;
  for (const [key, run] of cases) {
    const before = structuredClone(store.project(projectId)!);
    const events = store.state().operationEvents?.length || 0;
    role('pmo');
    const decision = store.startupGate(projectId).actions[key];
    assert.equal(decision.allowed, false);
    assert.throws(run, new RegExp(decision.reason.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.deepEqual(store.project(projectId), before);
    assert.equal(store.state().operationEvents?.length || 0, events);
  }
});
