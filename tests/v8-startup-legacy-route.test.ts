import '@angular/compiler';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Injector, runInInjectionContext } from '@angular/core';
import { ActivatedRouteSnapshot, Router, RouterStateSnapshot, UrlTree } from '@angular/router';
import { routes } from '../src/app/app.routes';
import {
  confirmLegacyStartupRedirect,
  legacyStartupTarget,
} from '../src/app/core/legacy-startup-route';
import { confirmProjectEntry, confirmProjectExit } from '../src/app/core/project-navigation-exit';
import { startupLocation } from '../src/app/core/project-startup';

async function routeOf(path: string) {
  const loaded = await routes.find((route) => route.path === 'projects')!.loadChildren!();
  assert.ok(loaded && typeof loaded === 'object' && 'default' in loaded);
  assert.ok(Array.isArray(loaded.default));
  const found = loaded.default.find((item) => 'projects/' + item.path === path);
  assert(found, `路由未登记：/${path}`);
  return found!;
}

function snapshot(
  params: Record<string, string>,
  queryParams: Record<string, string>,
  fragment: string | null = null,
): ActivatedRouteSnapshot {
  return { params, queryParams, fragment } as unknown as ActivatedRouteSnapshot;
}

test('旧启动链接保留项目、部门、目标动作与返回上下文，并落到启动交底页签', () => {
  assert.deepEqual(
    legacyStartupTarget(
      { id: 'P-42' },
      { dept: 'PMO / PM', action: 'handover', returnTo: '/sales/opportunities?tab=departments' },
      '#target',
    ),
    {
      projectId: 'P-42',
      queryParams: {
        dept: 'PMO / PM',
        action: 'handover',
        returnTo: '/sales/opportunities?tab=departments',
        tab: 'startup',
      },
      fragment: '#target',
    },
  );
  // 旧链接自带的 tab 不得盖掉启动交底页签本身。
  assert.deepEqual(legacyStartupTarget({ id: 'P-42' }, { tab: '概览', dept: '销售' }, ''), {
    projectId: 'P-42',
    queryParams: { dept: '销售', tab: 'startup' },
    fragment: '',
  });
  assert.deepEqual(legacyStartupTarget({}, {}, null), {
    projectId: '',
    queryParams: { tab: 'startup' },
    fragment: '',
  });
});

test('旧启动链接落地后仍按部门与动作定位到启动交底内的锚点', () => {
  const target = legacyStartupTarget(
    { id: 'P-42' },
    { dept: 'PMO / PM', action: 'handover' },
    null,
  );
  const location = startupLocation(target.queryParams['dept'], target.queryParams['action']);
  assert.equal(location.department, 'pm');
  assert.equal(location.action, 'handover');
  assert.equal(location.anchor, 'startup-action-handover');
  assert.equal(target.queryParams['tab'], 'startup');
});

test('旧启动路径不再挂第二套启动页，统一项目详情承接未保存离开契约', async () => {
  const legacy = await routeOf('projects/:id/startup');
  assert.deepEqual(legacy.canActivate, [confirmProjectEntry, confirmLegacyStartupRedirect]);
  assert.equal(legacy.component, undefined);
  assert.equal(legacy.loadComponent, undefined);

  const container = await routeOf('projects/:id');
  assert.deepEqual(container.canActivate, [confirmProjectEntry]);
  assert.deepEqual(container.canDeactivate, [confirmProjectExit]);
});

test('旧启动守卫返回统一项目详情的跳转目标并带回上下文', () => {
  const calls: { commands: unknown[]; extras: unknown }[] = [];
  const tree = { redirected: true } as unknown as UrlTree;
  const router = {
    createUrlTree(commands: unknown[], extras: unknown) {
      calls.push({ commands, extras });
      return tree;
    },
  } as unknown as Router;
  const result = runInInjectionContext(
    Injector.create({ providers: [{ provide: Router, useValue: router }] }),
    () =>
      confirmLegacyStartupRedirect(
        snapshot(
          { id: 'P-42' },
          { dept: 'PMO / PM', action: 'handover', returnTo: '/projects/board' },
          '#target',
        ),
        {} as unknown as RouterStateSnapshot,
      ),
  );
  assert.equal(result, tree);
  assert.deepEqual(calls, [
    {
      commands: ['/projects', 'P-42'],
      extras: {
        queryParams: {
          dept: 'PMO / PM',
          action: 'handover',
          returnTo: '/projects/board',
          tab: 'startup',
        },
        fragment: '#target',
      },
    },
  ]);
  // 没有 fragment 时不应把空字符串写进 URL。
  calls.length = 0;
  runInInjectionContext(
    Injector.create({ providers: [{ provide: Router, useValue: router }] }),
    () =>
      confirmLegacyStartupRedirect(
        snapshot({ id: 'P-42' }, {}),
        {} as unknown as RouterStateSnapshot,
      ),
  );
  assert.deepEqual(calls, [
    {
      commands: ['/projects', 'P-42'],
      extras: { queryParams: { tab: 'startup' }, fragment: undefined },
    },
  ]);
});
