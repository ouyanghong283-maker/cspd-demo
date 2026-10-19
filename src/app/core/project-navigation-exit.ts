import { inject } from '@angular/core';
import { CanActivateFn, CanDeactivateFn } from '@angular/router';
import { DemoStore } from './store';

/** The same boundary covers changing project, tab, browser back and leaving the workspace. */
function confirmProjectNavigation(): boolean {
  const store = inject(DemoStore);
  if (!store.ui.dialog() && !store.pendingInlineEdit()) return true;
  if (!window.confirm('当前项目有尚未保存的输入，是否放弃修改并离开？')) return false;
  store.ui.dialog.set(null);
  store.pendingInlineEdit.set(false);
  return true;
}
export const confirmProjectEntry: CanActivateFn = confirmProjectNavigation;
export const confirmProjectExit: CanDeactivateFn<unknown> = confirmProjectNavigation;
