import {
  navigationModuleRegistry,
  type NavigationModuleRegistration,
} from '../navigation-module-registry';

export const PROJECTS_NAVIGATION: NavigationModuleRegistration = {
  moduleId: 'projects-startup',
  routes: [
    { id: 'projects', pathPattern: '/projects', targetState: 'implemented' },
    { id: 'shared-project-board', pathPattern: '/projects/board', targetState: 'implemented' },
    { id: 'v10-board-finance', pathPattern: '/projects/board/finance', targetState: 'implemented' },
    {
      id: 'v10-board-exceptions',
      pathPattern: '/projects/board/exceptions',
      targetState: 'implemented',
    },
    // 旧启动页路径仍登记为路由，但只剩重定向；canonical 由下面的旧入口别名给出。
    { id: 'project-startup', pathPattern: '/projects/:id/startup', targetState: 'implemented' },
    { id: 'project-detail', pathPattern: '/projects/:id', targetState: 'implemented' },
  ],
  aliases: [
    {
      id: 'legacy-project-briefing-tab',
      pathPattern: '/projects/:id',
      whenQuery: { tab: '启动交底' },
      targetPath: '/projects/:id',
      consumeQueryKeys: ['tab'],
      targetQueryParams: { tab: 'startup' },
    },
    {
      id: 'legacy-startup-path',
      pathPattern: '/projects/:id/startup',
      whenQuery: {},
      targetPath: '/projects/:id',
      consumeQueryKeys: ['tab'],
      targetQueryParams: { tab: 'startup' },
    },
    {
      id: 'legacy-startup-short-route',
      pathPattern: '/startup/:id',
      whenQuery: {},
      targetPath: '/projects/:id',
      consumeQueryKeys: ['tab'],
      targetQueryParams: { tab: 'startup' },
    },
  ],
};

navigationModuleRegistry.register(PROJECTS_NAVIGATION);
