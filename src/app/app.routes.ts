import { inject } from '@angular/core';
import { ActivatedRouteSnapshot, Router, Routes } from '@angular/router';
import { deliveryPage } from './core/delivery-navigation';
import { confirmInlineEditExit } from './core/confirm-inline-edit-exit';
export const routes: Routes = [
  { path: '', loadComponent: () => import('./features/work').then((m) => m.Work) },
  { path: 'sales', loadComponent: () => import('./features/insights').then((m) => m.Insights) },
  {
    path: 'sales/departments',
    loadComponent: () => import('./features/department-records').then((m) => m.DepartmentRecords),
  },
  {
    path: 'sales/leads',
    loadComponent: () => import('./features/sales-list').then((m) => m.SalesList),
    data: { kind: 'lead' },
  },
  {
    path: 'sales/opportunities',
    loadComponent: () => import('./features/sales-list').then((m) => m.SalesList),
    data: { kind: 'opportunity' },
  },
  {
    path: 'sales/solutions',
    loadComponent: () => import('./features/business-workspaces').then((m) => m.BusinessWorkspaces),
    data: { page: 'solutions' },
  },
  {
    path: 'sales/solutions/:id',
    loadComponent: () => import('./features/solution-workspace').then((m) => m.SolutionWorkspace),
  },
  {
    path: 'sales/quotes',
    loadComponent: () => import('./features/business-workspaces').then((m) => m.BusinessWorkspaces),
    data: { page: 'quotes' },
  },
  {
    path: 'sales/quotes/:id',
    loadComponent: () => import('./features/quote-workspace').then((m) => m.QuoteWorkspace),
  },
  {
    path: 'sales/customers/:id',
    loadComponent: () => import('./features/customer-detail').then((m) => m.CustomerDetail),
  },
  {
    path: 'sales/customers',
    loadComponent: () => import('./features/customers').then((m) => m.Customers),
  },
  {
    path: 'sales/contacts',
    loadComponent: () => import('./features/contacts').then((m) => m.Contacts),
  },
  {
    path: 'sales/detail/:id',
    loadComponent: () => import('./features/sales-detail').then((m) => m.SalesDetail),
  },
  {
    path: 'projects',
    loadChildren: () => import('./core/management-v10-platform/routes'),
  },
  {
    path: 'contracts/new',
    canDeactivate: [confirmInlineEditExit],
    runGuardsAndResolvers: 'paramsChange',
    loadComponent: () => import('./features/business-workspaces').then((m) => m.BusinessWorkspaces),
    data: { page: 'contracts' },
  },
  {
    path: 'contracts',
    canDeactivate: [confirmInlineEditExit],
    runGuardsAndResolvers: 'paramsChange',
    pathMatch: 'full',
    loadComponent: () => import('./features/business-workspaces').then((m) => m.BusinessWorkspaces),
    data: { page: 'contracts' },
  },
  {
    path: 'contracts/:id',
    canDeactivate: [confirmInlineEditExit],
    runGuardsAndResolvers: 'paramsChange',
    loadComponent: () => import('./features/business-workspaces').then((m) => m.BusinessWorkspaces),
    data: { page: 'contracts' },
  },
  {
    path: 'contracts/:contractId/orders',
    loadComponent: () => import('./features/contract-orders').then((m) => m.ContractOrders),
  },
  {
    path: 'contracts/:contractId/invoices',
    loadComponent: () => import('./features/contract-invoices').then((m) => m.ContractInvoices),
  },
  {
    path: 'contracts/:contractId/receipts',
    loadComponent: () => import('./features/contract-receipts').then((m) => m.ContractReceipts),
  },
  {
    path: 'plans',
    pathMatch: 'full',
    redirectTo: ({ queryParams, fragment }) =>
      inject(Router).createUrlTree(['/delivery-service'], {
        queryParams: { ...queryParams, tab: 'overview' },
        fragment: fragment ?? undefined,
      }),
  },
  {
    path: 'plans/tracking',
    loadComponent: () => import('./features/business-workspaces').then((m) => m.BusinessWorkspaces),
    data: { page: 'tracking' },
  },
  {
    path: 'delivery-service',
    loadComponent: () => import('./features/delivery-service').then((m) => m.DeliveryService),
    children: [
      {
        path: '',
        loadComponent: () =>
          import('./features/business-workspaces').then((m) => m.BusinessWorkspaces),
        resolve: {
          page: (route: ActivatedRouteSnapshot) =>
            deliveryPage(route.queryParamMap.get('tab')),
        },
        runGuardsAndResolvers: 'paramsOrQueryParamsChange',
      },
    ],
  },
  {
    path: 'plans/logistics',
    loadComponent: () => import('./features/business-workspaces').then((m) => m.BusinessWorkspaces),
    data: { page: 'logistics' },
  },
  {
    path: 'plans/service',
    loadComponent: () => import('./features/business-workspaces').then((m) => m.BusinessWorkspaces),
    data: { page: 'service' },
  },
  {
    path: 'control',
    loadComponent: () => import('./features/control-entry').then((m) => m.ControlEntry),
  },
  {
    path: '**',
    loadComponent: () =>
      import('./features/navigation-not-found').then((m) => m.NavigationNotFound),
  },
];
