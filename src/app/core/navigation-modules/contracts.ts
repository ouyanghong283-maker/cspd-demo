import {
  navigationModuleRegistry,
  type NavigationModuleRegistration,
} from '../navigation-module-registry';

export const CONTRACTS_NAVIGATION: NavigationModuleRegistration = {
  moduleId: 'contracts',
  routes: [
    { id: 'contracts-new', pathPattern: '/contracts/new', targetState: 'implemented' },
    { id: 'contracts', pathPattern: '/contracts', targetState: 'implemented' },
    { id: 'contract-detail', pathPattern: '/contracts/:id', targetState: 'implemented' },
    { id: 'contract-orders', pathPattern: '/contracts/:contractId/orders', targetState: 'implemented' },
    { id: 'contract-invoices', pathPattern: '/contracts/:contractId/invoices', targetState: 'implemented' },
    { id: 'contract-receipts', pathPattern: '/contracts/:contractId/receipts', targetState: 'implemented' },
  ],
};

navigationModuleRegistry.register(CONTRACTS_NAVIGATION);
