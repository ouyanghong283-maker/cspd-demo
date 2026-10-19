import { DestroyRef, Injectable, inject, signal, computed } from '@angular/core';
import { createV9Dates } from '../v9-queries';
import { DemoStore } from '../store';
/** 全部方案页面共用真实上海日期；定时器和恢复前台只刷新内存投影。 */
@Injectable({ providedIn: 'root' })
export class SolutionClock {
  private readonly store = inject(DemoStore);
  readonly now = signal(new Date().toISOString());
  readonly dates = computed(() => createV9Dates(this.now(), this.store.observationDate()));
  constructor() {
    let timer: ReturnType<typeof setTimeout>;
    const refresh = () => {
      this.now.set(new Date().toISOString());
      clearTimeout(timer);
      const now = new Date();
      const offset =
        Date.parse(this.dates().solutionBusinessDate + 'T00:00:00+08:00') +
        86400000 -
        now.getTime();
      timer = setTimeout(refresh, Math.max(1, offset));
    };
    refresh();
    const visible = () => {
      if (document.visibilityState === 'visible') refresh();
    };
    document.addEventListener('visibilitychange', visible);
    window.addEventListener('focus', refresh);
    inject(DestroyRef).onDestroy(() => {
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', visible);
      window.removeEventListener('focus', refresh);
    });
  }
}
