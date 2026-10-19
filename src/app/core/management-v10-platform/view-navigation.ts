import { computed, DestroyRef, effect, inject, signal, untracked } from '@angular/core';
import { ActivatedRoute, NavigationStart, Router } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { DemoStore } from '../store';
import { createV10ViewSession, type V10ViewFilters, type V10ViewState } from './view-state';

/** 只持久化视图。业务查询由调用方使用最新读取上下文重新执行。 */
export function useV10ViewNavigation(onlyWithContext = false) {
  const store = inject(DemoStore),
    router = inject(Router),
    route = inject(ActivatedRoute);
  const params = toSignal(route.queryParamMap, { initialValue: route.snapshot.queryParamMap });
  const path = toSignal(route.paramMap, { initialValue: route.snapshot.paramMap });
  const identity = computed(() => JSON.stringify(store.v9CommandTarget()));
  const session = signal<ReturnType<typeof createV10ViewSession> | null>(null);
  const view = signal<V10ViewState | null>(null);
  const error = signal<string | null>(null);
  let frame = 0;
  const restorationNotice = signal<string | null>(null);
  const storage = {
    getItem: (key: string) => window.sessionStorage.getItem(key),
    setItem: (key: string, value: string) => window.sessionStorage.setItem(key, value),
  };
  const capture = () => {
    const current = session(),
      value = view();
    if (!current || !value) return;
    // 切换来源后不把新页面的值写入旧工作区记录。
    const focused = document.activeElement?.getAttribute('data-v10-focus') ?? value.focusKey;
    const next = { ...value, scrollY: window.scrollY, focusKey: focused };
    const failure = current.save(next);
    view.set(next);
    if (failure) error.set(failure);
  };
  effect(() => {
    const scope = JSON.parse(identity());
    params();
    path();
    if (
      !scope ||
      (onlyWithContext && !params().has('contextId') && !params().has('returnContextId'))
    ) {
      untracked(() => {
        cancelAnimationFrame(frame);
        session.set(null);
        view.set(null);
        error.set(null);
        restorationNotice.set(null);
      });
      return;
    }
    untracked(() => {
      cancelAnimationFrame(frame);
      const next = createV10ViewSession(storage, scope, location.pathname + location.search);
      session.set(next);
      view.set(next.view);
      error.set(null);
      restorationNotice.set(null);
      const failure = next.save(next.view);
      if (failure) error.set(failure);
      const url = new URL(location.href);
      url.searchParams.set(
        'contextId',
        new URL(next.href, location.origin).searchParams.get('contextId')!,
      );
      history.replaceState(history.state, '', url.pathname + url.search);
      const target = next.view;
      frame = requestAnimationFrame(() => {
        frame = requestAnimationFrame(() => {
          const element = [...document.querySelectorAll<HTMLElement>('[data-v10-focus]')].find(
            (e) => e.getAttribute('data-v10-focus') === target.focusKey,
          );
          if (element) element.focus({ preventScroll: true });
          if (element && document.activeElement === element) {
            element.scrollIntoView({ block: 'nearest', behavior: 'instant' });
          } else {
            if (target.focusKey)
              restorationNotice.set('原记录或触发入口已不在当前范围，已恢复原浏览位置。');
            // 先让失效说明完成排版，避免浏览器的滚动锚定再次推移恢复位置。
            frame = requestAnimationFrame(() => {
              frame = requestAnimationFrame(() =>
                window.scrollTo({ top: target.scrollY, behavior: 'instant' }),
              );
            });
          }
        });
      });
    });
  });
  const subscription = router.events.subscribe((event) => {
    if (event instanceof NavigationStart) {
      cancelAnimationFrame(frame);
      capture();
    }
  });
  window.addEventListener('pagehide', capture);
  inject(DestroyRef).onDestroy(() => {
    cancelAnimationFrame(frame);
    subscription.unsubscribe();
    window.removeEventListener('pagehide', capture);
  });
  return {
    view: view.asReadonly(),
    error: error.asReadonly(),
    notices: computed(() => [
      ...(session()?.notices ?? []),
      ...(restorationNotice() ? [restorationNotice()!] : []),
    ]),
    returnHref: computed(() => session()?.returnHref ?? null),
    returnTarget: computed(() => {
      const href = session()?.returnHref;
      return href ? router.parseUrl(href) : null;
    }),
    childTarget: (href: string) => router.parseUrl(session()?.childHref(href) ?? href),
    childHref: (href: string) => session()?.childHref(href) ?? href,
    capture,
    update(filters: Partial<V10ViewFilters>) {
      const current = session();
      if (!current) return;
      capture();
      const url = new URL(current.href, location.origin);
      const previous = view()?.filters;
      const carried =
        filters.tab && filters.tab !== previous?.tab
          ? {
              currency: previous?.currency ?? '',
              periodStart: previous?.periodStart ?? '',
              periodEnd: previous?.periodEnd ?? '',
            }
          : previous;
      for (const [name, value] of Object.entries({ ...carried, ...filters }))
        url.searchParams.set(name, value);
      if ('status' in filters && !('query' in filters)) url.searchParams.set('query', '');
      void router.navigateByUrl(url.pathname + url.search, { replaceUrl: true });
    },
    toggle(key: string) {
      const current = view();
      if (!current) return;
      const expanded = current.expanded.includes(key)
        ? current.expanded.filter((k) => k !== key)
        : [...current.expanded, key];
      view.set({ ...current, expanded });
      capture();
    },
  };
}
