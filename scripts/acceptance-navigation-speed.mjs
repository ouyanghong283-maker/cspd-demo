import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { connect, toolText } from './mcp-client.mjs';
import { base, root } from './browser-config.mjs';

// An isolated browser profile keeps performance checks away from the user's saved work.
const connection = await connect({ isolated: true });
let pageId;
const evaluate = async (body) => {
  const response = toolText(
    await connection.call('evaluate_script', {
      pageId,
      function: `async () => {${body}}`,
    }),
  );
  return JSON.parse(response.match(/```json\s*([\s\S]*?)\s*```/)[1]);
};
try {
  const created = toolText(
    await connection.call('new_page', {
      url: base + '/sales',
      timeout: 60000,
    }),
  );
  pageId = Number(created.match(/(\d+):.*\[selected\]/)[1]);
  const readiness = await evaluate(`
    for(let n=0;n<200;n++) {
      const app=ng.getComponent(document.querySelector('app-root'));
      const ready=routes=>routes.every(r=>(!r.loadComponent || !!r._loadedComponent) && (!r.children || ready(r.children)));
      if(document.querySelector('.dashboard') && ready(app.router.config))
        return {preloaded:true,waitMs:n*50,path:location.pathname};
      await new Promise(r=>setTimeout(r,50));
    }
    return {preloaded:false,path:location.pathname};
  `);
  assert(readiness.preloaded, '常用页面未在点击前完成后台预加载');
  assert.equal(readiness.path, '/sales', '预加载不能激活其他路由');
  const results = await evaluate(`
    const app=ng.getComponent(document.querySelector('app-root'));
    const stateBefore=JSON.stringify(app.store.state());
    const documentStart=performance.timeOrigin;
    const out=[];
    for(const [url,heading] of [['/sales/opportunities','商机管理'],['/sales/detail/DEMO-O001','青山储能一期'],['/sales','商机看板']]) {
      const start=performance.now();
      const before=performance.getEntriesByType('resource').length;
      const navigated=await app.router.navigateByUrl(url);
      await new Promise(requestAnimationFrame);
      out.push({url,navigated,ms:Math.round(performance.now()-start),
        newScripts:performance.getEntriesByType('resource').slice(before).filter(r=>/\\.js(?:\\?|$)/.test(r.name)).map(r=>new URL(r.name).pathname),
        correctHeading:document.querySelector('main h1')?.innerText.includes(heading),
        sameDocument:performance.timeOrigin===documentStart});
    }
    return {readiness:${JSON.stringify(readiness)},routes:out,stateUnchanged:stateBefore===JSON.stringify(app.store.state())};
  `);
  assert(
    results.routes.every((r) => r.navigated && r.correctHeading && r.sameDocument),
    '页面未正确切换或发生整页重载',
  );
  assert(
    results.routes.every((r) => r.newScripts.length === 0),
    '首次跳转仍需在点击后下载页面脚本',
  );
  assert(results.stateUnchanged, '只读页面切换不应修改业务数据');
  const errors = toolText(
    await connection.call('list_console_messages', { pageId, types: ['error'] }),
  );
  assert(errors.includes('no console messages found'), errors);
  const directory = path.join(root, 'artifacts', 'navigation-speed');
  await fs.mkdir(directory, { recursive: true });
  await fs.writeFile(path.join(directory, 'acceptance.json'), JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results, null, 2));
  console.log('PASS 首次跳转无新增脚本请求、保留单页导航且业务数据不变');
} finally {
  await connection.client.close();
  await connection.transport.close();
}
