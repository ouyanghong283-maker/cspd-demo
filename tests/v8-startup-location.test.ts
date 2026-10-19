import '@angular/compiler';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BASE_DATE } from '../src/app/core/models';
import { createSeed } from '../src/app/core/seed';
import { collectDemoProjectWorkItems } from '../src/app/core/work-item-sources';
import { workItemId } from '../src/app/core/work-item-registry';
import {
  STARTUP_DEPARTMENTS,
  startupDepartmentForRole,
  startupDepartmentFromParam,
  startupDepartmentParam,
  startupEntryQuery,
  startupLocation,
  startupLocationHint,
} from '../src/app/core/project-startup';
import { harness } from './v4-harness';

test('旧启动链接与部门待办按部门、动作定位到启动交底内的锚点', () => {
  assert.deepEqual(startupLocation('销售', 'submit'), {
    department: 'sales',
    action: 'submit',
    review: false,
    anchor: 'startup-action-submit',
    departmentParam: '销售',
    actionParam: 'submit',
  });
  assert.deepEqual(startupLocation('PMO / PM', 'handover'), {
    department: 'pm',
    action: 'handover',
    review: false,
    anchor: 'startup-action-handover',
    departmentParam: 'PMO / PM',
    actionParam: 'handover',
  });
  assert.deepEqual(startupLocation('订单交付', 'g4').anchor, 'startup-action-g4');
  assert.deepEqual(startupLocation('solution', 'confirm').department, 'solution');
  assert.deepEqual(startupLocation(null, 'confirm'), {
    department: null,
    action: 'confirm',
    review: false,
    anchor: 'startup-action-confirm',
    departmentParam: '',
    actionParam: 'confirm',
  });
  assert.deepEqual(startupLocation('项目管理', null), {
    department: 'pm',
    action: null,
    review: false,
    anchor: 'startup-content-pm',
    departmentParam: '项目管理',
    actionParam: '',
  });
});

test('待复核目标定位到来源变化提示，不冒充显式动作', () => {
  const review = startupLocation('解决方案', 'review');
  assert.equal(review.department, 'solution');
  assert.equal(review.action, null);
  assert.equal(review.review, true);
  assert.equal(review.anchor, 'startup-source-review');
});

test('无法识别的部门或动作不误定位，原始参数仍保留', () => {
  const unknown = startupLocation('火星部门', '飞升');
  assert.deepEqual(unknown, {
    department: null,
    action: null,
    review: false,
    anchor: null,
    departmentParam: '火星部门',
    actionParam: '飞升',
  });
  assert.equal(startupLocation('', '').anchor, null);
  assert.equal(startupLocation(undefined, undefined).departmentParam, '');
});

test('部门分组默认按当前工作视角选择，未知角色回到PM/PMO', () => {
  assert.equal(startupDepartmentForRole('sales'), 'sales');
  assert.equal(startupDepartmentForRole('solution'), 'solution');
  assert.equal(startupDepartmentForRole('pm'), 'pm');
  assert.equal(startupDepartmentForRole('pmo'), 'pm');
  assert.equal(startupDepartmentForRole('opm'), 'delivery');
  assert.equal(startupDepartmentForRole('outsider'), 'pm');
});

test('页面写回 URL 的部门参数与部门待办使用同一写法并可回读', () => {
  assert.deepEqual(
    STARTUP_DEPARTMENTS.map((department) => [
      startupDepartmentParam(department.key),
      startupDepartmentFromParam(startupDepartmentParam(department.key)),
    ]),
    [
      ['销售', 'sales'],
      ['解决方案', 'solution'],
      ['PMO / PM', 'pm'],
      ['订单交付', 'delivery'],
    ],
  );
});

test('启动移交部门待办定位到同一项目的启动交底与接收动作', () => {
  const state = createSeed();
  const project = state.projects[0];
  state.projects = [project];
  project.briefing.startupHandover = {
    status: '待移交',
    sender: '张销售',
    receiver: '王项目',
    opinion: '等待项目团队接收',
    transferredAt: BASE_DATE,
    briefingVersion: 1,
  };
  const item = collectDemoProjectWorkItems(state).items.find(
    (candidate) => candidate.id === workItemId('project-startup-handover', project.id),
  );
  assert(item, '启动移交待接收未出现在项目待办中');
  const target = new URL(item.href, 'http://local.invalid');
  assert.equal(target.pathname, `/projects/${project.id}`);
  assert.equal(target.searchParams.get('tab'), 'startup');
  assert.equal(target.searchParams.get('dept'), 'PMO / PM');
  assert.equal(target.searchParams.get('action'), 'handover');
});

test('定位提示说明目标部门与动作，不用票号或内部键', () => {
  assert.equal(
    startupLocationHint(startupLocation('PM', 'g4')),
    '已定位到 PM / PMO · 启动/G4模拟审核',
  );
  assert.equal(
    startupLocationHint(startupLocation('PM', 'review')),
    '已定位到 PM / PMO · 待复核提示',
  );
  assert.equal(startupLocationHint(startupLocation('销售', null)), '已定位到 销售 部门内容');
  assert.equal(startupLocationHint(startupLocation(null, 'handover')), '已定位到 启动移交接收');
  assert.equal(startupLocationHint(startupLocation('火星', '飞升')), '');
});

test('轮次进度的项目启动入口按统一容器定位到当前待办动作', () => {
  const { store, role } = harness();
  const projectId = 'DEMO-P003';
  store.state.update((state) => {
    const project = state.projects.find((item) => item.id === projectId)!;
    project.accepted = true;
    project.start = BASE_DATE;
    project.briefing.acceptance = '客户验收标准已核对';
    state.contracts.find((item) => item.id === project.contractId)!.status = '已登记';
    return state;
  });
  const queryOf = () => startupEntryQuery(store.startupGate(projectId));
  assert.deepEqual(queryOf(), { tab: 'startup', dept: '销售', action: 'submit' });
  assert.deepEqual(
    startupLocation(queryOf()['dept'], queryOf()['action']).anchor,
    'startup-action-submit',
  );

  role('sales');
  store.submitContractBriefing(projectId, '请PM确认');
  assert.deepEqual(queryOf(), { tab: 'startup', dept: 'PMO / PM', action: 'confirm' });
  role('pm');
  store.confirmContractBriefing(projectId, '确认V1');
  assert.deepEqual(queryOf().action, 'g4');
  // 来源变化后回到销售重新提交，而不是落到前置不满足的动作上
  role('solution');
  assert.equal(
    store.saveStartupContent(projectId, 'solution', { acceptance: '来源修订后的验收标准' }),
    true,
  );
  assert.deepEqual(queryOf(), { tab: 'startup', dept: '销售', action: 'submit' });
  role('sales');
  store.submitContractBriefing(projectId, '按修订来源重新交底');
  assert.deepEqual(queryOf(), { tab: 'startup', dept: 'PMO / PM', action: 'confirm' });
  role('pm');
  store.confirmContractBriefing(projectId, '确认V2');
  role('pmo');
  store.recordProjectG4(projectId, '通过', 'G4通过');
  assert.deepEqual(queryOf().action, 'handover');
  role('pm');
  store.completeStartupHandover(projectId, '王项目', '移交完成');
  // 全部动作完成后落在最后一个动作上，展示已完成状态而不是无目标链接
  assert.deepEqual(queryOf(), { tab: 'startup', dept: 'PMO / PM', action: 'handover' });
});
