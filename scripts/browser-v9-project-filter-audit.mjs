import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { connect, toolText, root } from './mcp-client.mjs';

const base = process.env.CSPD_BASE_URL || 'http://127.0.0.1:4329';
const evidencePath = path.join(
  root,
  '../docs/verification/v9-final-audit/project-filter-browser.json',
);
const connection = await connect({ isolated: true });
let pageId;
const evaluate = async (body) => {
  const raw = toolText(
    await connection.call('evaluate_script', {
      pageId,
      function: `async()=>{${body}}`,
    }),
  );
  const match = raw.match(/```json\s*([\s\S]*?)\s*```/);
  assert(match, `浏览器未返回JSON: ${raw}`);
  return JSON.parse(match[1]);
};

try {
  const page = toolText(await connection.call('new_page', { url: `${base}/projects/board` }));
  pageId = Number(page.match(/(\d+):.*\[selected\]/)?.[1]);
  assert.ok(Number.isInteger(pageId), `无法读取浏览器页面ID: ${page}`);
  await connection.call('wait_for', { pageId, text: ['高层项目总览'], timeout: 30000 });
  await new Promise((resolve) => setTimeout(resolve, 500));
  await evaluate(`
    const b=ng.getComponent(document.querySelector('app-project-board'));
    const workspaceId=b.store.v9CommandTarget().workspaceId;
    window.v9FilterAudit={state:structuredClone(b.store.state()),filters:structuredClone(b.filters()),raw:JSON.stringify(b.store.workspaceStorage.readWorkspace(workspaceId))};
    const state=structuredClone(window.v9FilterAudit.state);
    const sale=state.sales.find(s=>s.id==='DEMO-O005');
    if(!sale)throw Error('missing target opportunity');
    state.sales=[sale];
    state.projects=state.projects.filter(p=>p.opportunityId===sale.id);
    b.store.state.set(state);
    return {businessId:sale.id};
  `);
  await new Promise((resolve) => setTimeout(resolve, 500));
  const observation = await evaluate(`
    const b=ng.getComponent(document.querySelector('app-project-board'));
    const workspaceId=b.store.v9CommandTarget().workspaceId;
    b.filters.set({projectIds:['DEMO-P001'],businessIds:['DEMO-O005'],grades:[],departments:[],firstResults:[],query:'',partition:'all',regions:[],stages:[],owners:[],budgetCurrency:'CNY'});
    await new Promise(resolve=>setTimeout(resolve,100));
    const chart=ng.getComponent(document.querySelector('app-management-board-charts'));
    return {
      appliedFilters:b.filters(),
      businessProjectIds:b.management().businesses[0]?.projectIds,
      projectIds:b.management().projects.map(p=>p.projectId),
      budgetProjectIds:b.management().budgets.map(p=>p.projectId),
      exceptionProjectIds:b.management().exceptions.map(e=>e.projectId).filter(Boolean),
      boardDepartmentProjectIds:b.management().departmentItems.map(i=>i.projectId).filter(Boolean),
      chartDepartmentProjectIds:chart.summary().items.map(i=>i.projectId).filter(Boolean),
      chartDepartmentTotals:chart.summary().departments.map(d=>({department:d.department,total:d.total})),
      renderedBudgetRows:[...document.querySelectorAll('app-management-board-charts table')][1]?.innerText??'',
      renderedDepartmentRows:[...document.querySelectorAll('app-management-board-charts table')][0]?.innerText??'',
      storedSnapshot:JSON.stringify(b.store.workspaceStorage.readWorkspace(workspaceId))
    };
  `);
  console.log(
    JSON.stringify({
      appliedFilters: observation.appliedFilters,
      businessProjectIds: observation.businessProjectIds,
    }),
  );
  assert.deepEqual(observation.businessProjectIds, ['DEMO-P001']);
  assert.deepEqual(observation.projectIds, ['DEMO-P001']);
  assert.deepEqual(observation.budgetProjectIds, ['DEMO-P001']);
  assert.ok(!observation.exceptionProjectIds.includes('DEMO-P002'));
  assert.ok(!observation.boardDepartmentProjectIds.includes('DEMO-P002'));
  assert.ok(!observation.chartDepartmentProjectIds.includes('DEMO-P002'));
  assert.doesNotMatch(observation.renderedBudgetRows, /DEMO-P002/);
  assert.doesNotMatch(observation.renderedDepartmentRows, /DEMO-P002/);
  const restored = await evaluate(`
    const b=ng.getComponent(document.querySelector('app-project-board'));
    b.store.state.set(window.v9FilterAudit.state);
    b.filters.set(window.v9FilterAudit.filters);
    await new Promise(resolve=>setTimeout(resolve,100));
    return {restored:JSON.stringify(b.store.state())===JSON.stringify(window.v9FilterAudit.state),filtersRestored:JSON.stringify(b.filters())===JSON.stringify(window.v9FilterAudit.filters),storedSnapshot:JSON.stringify(b.store.workspaceStorage.readWorkspace(b.store.v9CommandTarget().workspaceId))};
  `);
  assert.equal(restored.restored, true);
  assert.equal(restored.filtersRestored, true);
  assert.equal(restored.storedSnapshot, observation.storedSnapshot);
  assert.equal(restored.storedSnapshot, await evaluate('return window.v9FilterAudit.raw;'));
  await fs.writeFile(
    evidencePath,
    JSON.stringify(
      {
        actor: 'CODEX',
        scope: '浏览器看板项目筛选：预算、异常、部门图及图内事项与P001范围一致',
        at: new Date().toISOString(),
        url: `${base}/projects/board`,
        selectedProject: 'DEMO-P001',
        excludedProject: 'DEMO-P002',
        result: 'passed',
        observed: {
          businessProjectIds: observation.businessProjectIds,
          projectIds: observation.projectIds,
          budgetProjectIds: observation.budgetProjectIds,
          exceptionProjectIds: observation.exceptionProjectIds,
          boardDepartmentProjectIds: observation.boardDepartmentProjectIds,
          chartDepartmentProjectIds: observation.chartDepartmentProjectIds,
          chartDepartmentTotals: observation.chartDepartmentTotals,
          renderedBudgetRows: observation.renderedBudgetRows,
          renderedDepartmentRows: observation.renderedDepartmentRows,
          businessStateRestored: restored.restored,
          filtersRestored: restored.filtersRestored,
          persistedSnapshotUnchanged: true,
        },
      },
      null,
      2,
    ) + '\n',
  );
  console.log(
    '通过：多项目商机筛选后看板部门图、清单、预算和异常均收窄至P001，浏览器状态已恢复且本地存储未变。',
  );
} finally {
  if (pageId) {
    await evaluate(`
      const b=ng.getComponent(document.querySelector('app-project-board'));
      b.store.state.set(window.v9FilterAudit.state);
      b.filters.set(window.v9FilterAudit.filters);
      return true;
    `).catch(() => {});
  }
  await connection.client.close();
  await connection.transport.close();
}
