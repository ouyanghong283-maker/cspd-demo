import {
  navigationModuleRegistry,
  type NavigationModuleRegistration,
} from '../navigation-module-registry';

export const PLANS_NAVIGATION: NavigationModuleRegistration = {
  moduleId: 'plans',
  routes: [
    { id: 'delivery-service', pathPattern: '/delivery-service', targetState: 'implemented' },
    { id: 'plans', pathPattern: '/plans', targetState: 'implemented' },
    { id: 'plans-tracking', pathPattern: '/plans/tracking', targetState: 'implemented' },
    { id: 'plans-logistics', pathPattern: '/plans/logistics', targetState: 'implemented' },
    { id: 'plans-service', pathPattern: '/plans/service', targetState: 'implemented' },
  ],
  aliases: ['logistics', 'service', 'overview'].map((tab) => ({
    id: `legacy-plans-${tab}`,
    pathPattern: tab === 'overview' ? '/plans' : `/plans/${tab}`,
    whenQuery: {},
    targetPath: '/delivery-service',
    consumeQueryKeys: ['tab'],
    targetQueryParams: { tab },
  })),
};

navigationModuleRegistry.register(PLANS_NAVIGATION);
