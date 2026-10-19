import {
  navigationModuleRegistry,
  type NavigationModuleRegistration,
} from '../navigation-module-registry';

export const HOME_NAVIGATION: NavigationModuleRegistration = {
  moduleId: 'home',
  routes: [{ id: 'my-work', pathPattern: '/', targetState: 'implemented' }],
};

navigationModuleRegistry.register(HOME_NAVIGATION);
