import '@angular/compiler';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { routes as angularRoutes } from '../src/app/app.routes';
import {
  NavigationModuleRegistry,
  navigationModuleRegistry,
} from '../src/app/core/navigation-module-registry';
import {
  NAVIGATION_ALIASES,
  NAVIGATION_GROUPS,
  NAVIGATION_ROUTES,
  resolveNavigationItem,
  resolveNavigationPath,
} from '../src/app/core/navigation-registry';

test('静态和动态路由稳定匹配并返回解码后的路径参数', () => {
  // 旧启动页路径只剩重定向，canonical 与统一容器契约一致，仍按 :id 解码路径参数。
  const startup = resolveNavigationPath('/projects/PROJECT%2F42/startup?tab=计划#handover');
  assert.equal(startup.status, 'implemented');
  if (startup.status !== 'implemented') return;
  assert.equal(startup.source, 'legacy-alias');
  assert.equal(startup.aliasId, 'legacy-startup-path');
  assert.equal(startup.routeId, 'project-detail');
  assert.equal(startup.params['id'], 'PROJECT/42');
  assert.equal(startup.canonicalPath, '/projects/PROJECT%2F42?tab=startup#handover');

  const contract = resolveNavigationPath('/contracts/new');
  assert.equal(contract.status, 'implemented');
  if (contract.status === 'implemented') assert.equal(contract.routeId, 'contracts-new');
});

test('旧详情页的方案、报价和交底页签明确解析到注册的新目标并保留其他上下文', () => {
  const solution = resolveNavigationPath(
    '/sales/detail/OP-42?tab=%E6%96%B9%E6%A1%88&guide=mainline',
  );
  assert.equal(solution.status, 'implemented');
  if (solution.status !== 'implemented') return;
  assert.equal(solution.source, 'legacy-alias');
  assert.equal(solution.aliasId, 'legacy-opportunity-solution-tab');
  assert.equal(solution.routeId, 'solution-workspace');
  assert.equal(solution.canonicalPath, '/sales/solutions/OP-42?guide=mainline');

  const quote = resolveNavigationPath('/sales/detail/OP-42?tab=%E6%8A%A5%E4%BB%B7');
  assert.equal(quote.status, 'implemented');
  if (quote.status === 'implemented') assert.equal(quote.canonicalPath, '/sales/quotes/OP-42');

  const startup = resolveNavigationPath(
    '/projects/P-42?tab=%E5%90%AF%E5%8A%A8%E4%BA%A4%E5%BA%95&returnTo=%2Fprojects',
  );
  assert.equal(startup.status, 'implemented');
  if (startup.status === 'implemented') {
    assert.equal(startup.source, 'legacy-alias');
    assert.equal(startup.aliasId, 'legacy-project-briefing-tab');
    // 统一项目详情的启动交底为页签形态，不再指向重定向空路由。
    assert.equal(startup.routeId, 'project-detail');
    assert.equal(startup.canonicalPath, '/projects/P-42?returnTo=%2Fprojects&tab=startup');
  }
});

test('项目启动旧入口一律落到统一容器的启动交底页签', () => {
  for (const path of [
    '/projects/P-42/startup',
    '/projects/P-42/startup?dept=PMO&action=handover#target',
    '/startup/P-42',
    '/projects/P-42?tab=%E5%90%AF%E5%8A%A8%E4%BA%A4%E5%BA%95',
  ]) {
    const target = resolveNavigationPath(path);
    assert.equal(target.status, 'implemented', path);
    if (target.status !== 'implemented') continue;
    assert.equal(target.routeId, 'project-detail', path);
    const url = new URL(target.canonicalPath, 'http://demo');
    assert.equal(url.pathname, '/projects/P-42', path);
    assert.equal(url.searchParams.get('tab'), 'startup', path);
  }
});

test('未匹配的旧方案路径继续命中有效商机详情，不猜测别名', () => {
  const legacyDetail = resolveNavigationPath('/sales/detail/OP-42?tab=%E6%A6%82%E8%A7%88');
  assert.equal(legacyDetail.status, 'implemented');
  if (legacyDetail.status === 'implemented') {
    assert.equal(legacyDetail.source, 'route');
    assert.equal(legacyDetail.routeId, 'sales-detail');
    assert.equal(legacyDetail.canonicalPath, '/sales/detail/OP-42?tab=%E6%A6%82%E8%A7%88');
  }
});

test('未知路径、外部地址和未知菜单目标显式 not-found，不重定向首页', () => {
  assert.deepEqual(resolveNavigationPath('/unregistered/path'), {
    status: 'not-found',
    requestedPath: '/unregistered/path',
    reason: 'unknown-route',
  });
  assert.deepEqual(resolveNavigationPath('https://example.invalid/sales'), {
    status: 'not-found',
    requestedPath: 'https://example.invalid/sales',
    reason: 'invalid-url',
  });
  assert.deepEqual(resolveNavigationItem('missing-item'), {
    status: 'not-found',
    requestedPath: 'missing-item',
    reason: 'unknown-route',
  });
});

test('所有旧入口别名均登记且其目标存在于已知路由契约', () => {
  assert.ok(NAVIGATION_ALIASES.length >= 4);
  for (const alias of NAVIGATION_ALIASES) {
    const probeParams = Object.fromEntries(
      (alias.pathPattern.match(/:[A-Za-z0-9_]+/g) || []).map((token) => [
        token.slice(1),
        'TEST-ID',
      ]),
    );
    const sourcePath = alias.pathPattern.replace(
      /:([A-Za-z0-9_]+)/g,
      (_, name: string) => probeParams[name],
    );
    const query = new URLSearchParams(alias.whenQuery).toString();
    const result = resolveNavigationPath(`${sourcePath}${query ? `?${query}` : ''}`);
    assert.notEqual(result.status, 'not-found', `${alias.id} has an unresolved target`);
    if (result.status === 'implemented' || result.status === 'planned') {
      assert.ok(
        NAVIGATION_ROUTES.some((route) => route.id === result.routeId),
        `${alias.id} resolves outside route registry`,
      );
    }
  }
});

test('模块按业务登记路由和别名，聚合清单与Angular实际路由一一对应', async () => {
  const modules = navigationModuleRegistry.moduleRegistrations();
  assert.deepEqual(
    modules.map((module) => module.moduleId),
    ['home', 'sales-presales', 'projects-startup', 'contracts', 'plans', 'demo-control'],
  );
  const routeOwner = (path: string) =>
    modules.find((module) => module.routes.some((route) => route.pathPattern === path))?.moduleId;
  assert.equal(routeOwner('/sales/detail/:id'), 'sales-presales');
  assert.equal(routeOwner('/projects/:id/startup'), 'projects-startup');
  assert.equal(routeOwner('/plans/tracking'), 'plans');
  assert.equal(routeOwner('/control'), 'demo-control');
  assert.ok(
    modules
      .find((module) => module.moduleId === 'sales-presales')
      ?.aliases?.some((alias) => alias.id === 'legacy-opportunity-quote-tab'),
  );
  assert.ok(
    modules
      .find((module) => module.moduleId === 'projects-startup')
      ?.aliases?.some((alias) => alias.id === 'legacy-project-briefing-tab'),
  );

  const loaded = await angularRoutes.find((route) => route.path === 'projects')!.loadChildren!();
  assert.ok(loaded && typeof loaded === 'object' && 'default' in loaded);
  assert.ok(Array.isArray(loaded.default));
  const projectPaths = loaded.default.map(
    (route) => '/projects' + (route.path ? '/' + route.path : ''),
  );
  const actualPaths = angularRoutes
    .filter((route) => route.path !== '**')
    .map((route) => (route.path === '' ? '/' : route.path ? `/${route.path}` : undefined))
    .filter((path): path is string => !!path);
  assert.deepEqual(
    [...NAVIGATION_ROUTES.map((route) => route.pathPattern)].sort(),
    [...new Set([...actualPaths, ...projectPaths])].sort(),
  );
});

test('后续模块可单独注册路由和别名，统一解析器无需增加模块分支', () => {
  const extension = new NavigationModuleRegistry();
  extension.register({
    moduleId: 'future-feature',
    routes: [{ id: 'future-record', pathPattern: '/future/:id', targetState: 'implemented' }],
    aliases: [
      {
        id: 'future-legacy-record',
        pathPattern: '/old-record/:id',
        whenQuery: { view: 'current' },
        targetPath: '/future/:id',
        consumeQueryKeys: ['view'],
      },
    ],
  });

  const result = resolveNavigationPath('/old-record/R-42?view=current&source=guide', extension);
  assert.equal(result.status, 'implemented');
  if (result.status === 'implemented') {
    assert.equal(result.routeId, 'future-record');
    assert.equal(result.source, 'legacy-alias');
    assert.equal(result.canonicalPath, '/future/R-42?source=guide');
  }
});

test('模块注册拒绝重复ID，避免路由和别名被静默覆盖', () => {
  const extension = new NavigationModuleRegistry();
  const registration = {
    moduleId: 'same-module',
    routes: [{ id: 'same-route', pathPattern: '/same', targetState: 'implemented' as const }],
  };
  extension.register(registration);
  assert.throws(() => extension.register(registration), /导航模块重复注册：same-module/);
  assert.throws(
    () =>
      extension.register({
        moduleId: 'other-module',
        routes: [{ id: 'same-route', pathPattern: '/other', targetState: 'implemented' }],
      }),
    /导航路由ID重复：same-route/,
  );
});

test('物流与售后旧链接定位同一交付容器并保留项目和来源上下文', () => {
  const target = resolveNavigationPath('/plans/logistics?project=P-42&dept=PM&tab=old#shipment');
  assert.equal(target.status, 'implemented');
  if (target.status !== 'implemented') return;
  assert.equal(
    target.canonicalPath,
    '/delivery-service?dept=PM&project=P-42&tab=logistics#shipment',
  );
  assert.equal(resolveNavigationPath(target.canonicalPath).status, 'implemented');
  const service = resolveNavigationPath('/plans/service?projectId=P-17&source=notice');
  if (service.status !== 'implemented') return assert.fail('售后旧入口失效');
  assert.equal(service.canonicalPath, '/delivery-service?projectId=P-17&source=notice&tab=service');
});

test('旧计划总览进入交付总览页签，保留筛选上下文和定位且覆盖遗留tab', () => {
  for (const path of ['/plans', '/plans?tab=计划执行&projectId=P-17&source=notice#target']) {
    const target = resolveNavigationPath(path);
    assert.equal(target.status, 'implemented');
    if (target.status !== 'implemented') return assert.fail('旧计划入口失效');
    assert.equal(target.source, 'legacy-alias');
    assert.equal(target.routeId, 'delivery-service');
    const url = new URL(target.canonicalPath, 'http://demo');
    assert.equal(url.pathname, '/delivery-service');
    assert.equal(url.searchParams.get('tab'), 'overview');
    if (path.includes('projectId')) {
      assert.equal(url.searchParams.get('projectId'), 'P-17');
      assert.equal(url.searchParams.get('source'), 'notice');
      assert.equal(url.hash, '#target');
    }
    const again = resolveNavigationPath(target.canonicalPath);
    assert.equal(again.status, 'implemented');
    if (again.status === 'implemented') assert.equal(again.source, 'route');
  }
});

test('计划总览只归属交付菜单，跨项目追踪继续归属追踪看板', async () => {
  const { activeNavigationItem } = await import('../src/app/core/navigation-registry');
  assert.equal(activeNavigationItem('/plans')?.id, 'delivery-service');
  assert.equal(activeNavigationItem('/delivery-service?tab=overview')?.id, 'delivery-service');
  assert.equal(activeNavigationItem('/plans/tracking')?.id, 'plan-tracking');
  assert.equal(
    NAVIGATION_GROUPS.flatMap((group) => group.items).some((item) => item.targetPath === '/plans'),
    false,
  );
});

test('交付页签映射至原业务内容，无参数和未知参数继续显示物流', async () => {
  const { deliveryTab, deliveryPage } = await import('../src/app/core/delivery-navigation');
  for (const [value, tab, page] of [
    [null, 'logistics', 'logistics'],
    ['unknown', 'logistics', 'logistics'],
    ['logistics', 'logistics', 'logistics'],
    ['service', 'service', 'service'],
    ['overview', 'overview', 'plans'],
  ]) {
    assert.equal(deliveryTab(value), tab);
    assert.equal(deliveryPage(value), page);
  }
});

test('详情和兼容入口高亮其唯一业务归属，并区分演示动作', async () => {
  const { activeNavigationItem } = await import('../src/app/core/navigation-registry');
  assert.equal(activeNavigationItem('/sales/customers/C-42')?.id, 'customers');
  assert.equal(activeNavigationItem('/sales/detail/OP-42?returnTo=%2Fsales')?.id, 'opportunities');
  assert.equal(activeNavigationItem('/sales/departments?dept=PM')?.id, 'opportunities');
  assert.equal(activeNavigationItem('/projects/P-42/startup')?.id, 'project-workspace');
  assert.equal(activeNavigationItem('/projects/board')?.id, 'shared-project-board');
  assert.equal(activeNavigationItem('/plans/service?project=P-42')?.id, 'delivery-service');
  assert.equal(activeNavigationItem('/control?action=restart')?.id, 'demo-restart');
  assert.equal(activeNavigationItem('/control')?.id, 'demo-guide');
});

test('旧部门入口规范化到商机部门页签并保留筛选和定位', () => {
  const result = resolveNavigationPath(
    '/sales/departments?dept=PM&q=DEMO-O014&owner=张销售#record',
  );
  assert.equal(result.status, 'implemented');
  if (result.status !== 'implemented') return;
  const url = new URL(result.canonicalPath, 'http://demo');
  assert.equal(url.pathname, '/sales/opportunities');
  assert.equal(url.searchParams.get('tab'), 'departments');
  assert.equal(url.searchParams.get('dept'), 'PM');
  assert.equal(url.searchParams.get('q'), 'DEMO-O014');
  assert.equal(url.hash, '#record');
});
