import { inject } from '@angular/core';
import { CanDeactivateFn } from '@angular/router';
import { DemoStore } from './store';

/** Contract route changes must not silently discard an in-progress inline edit. */
export const confirmInlineEditExit: CanDeactivateFn<unknown> = () =>
  !inject(DemoStore).pendingInlineEdit() ||
  window.confirm('当前合同有尚未保存的修改，是否放弃修改并离开？');
