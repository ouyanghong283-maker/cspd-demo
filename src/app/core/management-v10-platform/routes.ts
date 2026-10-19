import type { Routes } from '@angular/router';
import { confirmProjectEntry, confirmProjectExit } from '../project-navigation-exit';
import { confirmLegacyStartupRedirect } from '../legacy-startup-route';
/** 项目入口同组懒加载；静态看板在动态项目之前，原守卫及重跑规则保留。 */
const routes: Routes = [
  {
    path: 'board/finance',
    loadComponent: () =>
      import('../../features/management-v10-finance/page').then((m) => m.V10FinancePage),
  },
  {
    path: 'board/exceptions',
    loadComponent: () =>
      import('../../features/management-v10-exceptions/page').then((m) => m.V10ExceptionsPage),
  },
  {
    path: 'board',
    loadComponent: () => import('../../features/project-board').then((m) => m.ProjectBoard),
  },
  {
    path: '',
    pathMatch: 'full',
    loadComponent: () => import('../../features/project-list').then((m) => m.ProjectList),
  },
  {
    path: ':id/startup',
    canActivate: [confirmProjectEntry, confirmLegacyStartupRedirect],
    runGuardsAndResolvers: 'paramsOrQueryParamsChange',
    children: [],
  },
  {
    path: ':id',
    canActivate: [confirmProjectEntry],
    canDeactivate: [confirmProjectExit],
    runGuardsAndResolvers: 'paramsOrQueryParamsChange',
    loadComponent: () => import('../../features/project-detail').then((m) => m.ProjectDetail),
  },
];
export default routes;
