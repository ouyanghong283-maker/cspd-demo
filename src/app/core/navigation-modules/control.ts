import {
  navigationModuleRegistry,
  type NavigationModuleRegistration,
} from '../navigation-module-registry';

export const CONTROL_NAVIGATION: NavigationModuleRegistration = {
  moduleId: 'demo-control',
  routes: [{ id: 'control', pathPattern: '/control', targetState: 'implemented' }],
};

navigationModuleRegistry.register(CONTROL_NAVIGATION);
