import {
  navigationModuleRegistry,
  type NavigationModuleRegistration,
} from '../navigation-module-registry';

export const SALES_NAVIGATION: NavigationModuleRegistration = {
  moduleId: 'sales-presales',
  routes: [
    { id: 'sales-board', pathPattern: '/sales', targetState: 'implemented' },
    { id: 'sales-departments', pathPattern: '/sales/departments', targetState: 'implemented' },
    { id: 'leads', pathPattern: '/sales/leads', targetState: 'implemented' },
    { id: 'opportunities', pathPattern: '/sales/opportunities', targetState: 'implemented' },
    { id: 'solutions', pathPattern: '/sales/solutions', targetState: 'implemented' },
    { id: 'solution-workspace', pathPattern: '/sales/solutions/:id', targetState: 'implemented' },
    { id: 'quotes', pathPattern: '/sales/quotes', targetState: 'implemented' },
    { id: 'quote-workspace', pathPattern: '/sales/quotes/:id', targetState: 'implemented' },
    { id: 'customers', pathPattern: '/sales/customers', targetState: 'implemented' },
    { id: 'customer-detail', pathPattern: '/sales/customers/:id', targetState: 'implemented' },
    { id: 'contacts', pathPattern: '/sales/contacts', targetState: 'implemented' },
    { id: 'sales-detail', pathPattern: '/sales/detail/:id', targetState: 'implemented' },
  ],
  aliases: [
    {
      id: 'legacy-sales-departments',
      pathPattern: '/sales/departments',
      targetPath: '/sales/opportunities',
      targetQueryParams: { tab: 'departments' },
      whenQuery: {},
      consumeQueryKeys: [],
    },
    {
      id: 'legacy-opportunity-solution-tab',
      pathPattern: '/sales/detail/:id',
      whenQuery: { tab: '方案' },
      targetPath: '/sales/solutions/:id',
      consumeQueryKeys: ['tab'],
    },
    {
      id: 'legacy-opportunity-quote-tab',
      pathPattern: '/sales/detail/:id',
      whenQuery: { tab: '报价' },
      targetPath: '/sales/quotes/:id',
      consumeQueryKeys: ['tab'],
    },
  ],
};

navigationModuleRegistry.register(SALES_NAVIGATION);
