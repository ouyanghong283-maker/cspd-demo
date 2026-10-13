import { Routes } from '@angular/router';
export const routes: Routes = [
  { path: '', loadComponent: () => import('./features/work').then((m) => m.Work) },
  { path: 'sales', loadComponent: () => import('./features/insights').then((m) => m.Insights) },
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
    path: 'sales/customers',
    loadComponent: () => import('./features/customers').then((m) => m.Customers),
  },
  {
    path: 'sales/detail/:id',
    loadComponent: () => import('./features/sales-detail').then((m) => m.SalesDetail),
  },
  {
    path: 'projects',
    loadComponent: () => import('./features/project-list').then((m) => m.ProjectList),
  },
  {
    path: 'projects/:id',
    loadComponent: () => import('./features/project-detail').then((m) => m.ProjectDetail),
  },
  { path: 'control', loadComponent: () => import('./features/control').then((m) => m.Control) },
  { path: '**', redirectTo: '' },
];
