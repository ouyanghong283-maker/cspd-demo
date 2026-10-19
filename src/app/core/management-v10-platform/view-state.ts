import { buildV10Target } from './navigation';
import { isValidISODate } from '../rules';

export interface V10ViewScope {
  workspaceId: string;
  roundId: string;
}
export interface V10ViewFilters {
  tab: string;
  scope: string;
  status: string;
  query: string;
  currency: string;
  periodStart: string;
  periodEnd: string;
}
export interface V10ViewState {
  filters: V10ViewFilters;
  tabFilters?: Record<string, Pick<V10ViewFilters, 'query' | 'scope' | 'status'>>;
  expanded: string[];
  scrollY: number;
  focusKey: string;
}
interface ViewRecord {
  view: V10ViewState;
  parent: string | null;
}
type ViewStorage = Pick<Storage, 'getItem' | 'setItem'>;
const base = 'http://v10.local.invalid';
export const defaultV10ViewFilters = (route: string): V10ViewFilters => ({
  tab: route.endsWith('/finance') ? 'margin' : route.endsWith('/exceptions') ? 'delivery' : 'board',
  scope: 'active',
  status: '',
  query: '',
  currency: '',
  periodStart: '',
  periodEnd: '',
});
const key = (scope: V10ViewScope, route: string, id: string) =>
  `cspd:v10:view:${JSON.stringify([scope.workspaceId, scope.roundId, route, id])}`;
/** 导航白名单：只接受基线入口及单个项目，不接受外部、协议相对或转义分隔符。 */
export function isV10LocalTarget(href: string): boolean {
  if (!href.startsWith('/') || href.startsWith('//') || /[\\\u0000-\u0020]/.test(href))
    return false;
  const url = new URL(href, base);
  if (url.origin !== base || url.hash) return false;
  if (
    ['/projects/board', '/projects/board/finance', '/projects/board/exceptions'].includes(
      url.pathname,
    )
  )
    return true;
  return (
    /^\/projects\/[^/%?#]+$/.test(url.pathname) &&
    !['board', '.', '..'].includes(url.pathname.split('/')[2])
  );
}
function validView(value: unknown): value is V10ViewState {
  if (!value || typeof value !== 'object') return false;
  const v = value as V10ViewState;
  return (
    !!v.filters &&
    (v.tabFilters === undefined ||
      (!!v.tabFilters &&
        typeof v.tabFilters === 'object' &&
        Object.values(v.tabFilters).every(
          (f) =>
            !!f &&
            ['query', 'scope', 'status'].every((k) => typeof f[k as keyof typeof f] === 'string'),
        ))) &&
    Object.keys(defaultV10ViewFilters('')).every(
      (k) => typeof v.filters[k as keyof V10ViewFilters] === 'string',
    ) &&
    Array.isArray(v.expanded) &&
    v.expanded.every((x) => typeof x === 'string') &&
    Number.isFinite(v.scrollY) &&
    v.scrollY >= 0 &&
    typeof v.focusKey === 'string'
  );
}
function parseToken(token: string): { route: string; id: string } | null {
  const parts = token.split('|');
  const [route, id] = parts;
  return parts.length === 2 &&
    /^[a-zA-Z0-9-]{1,128}$/.test(id ?? '') &&
    isV10LocalTarget(route) &&
    !route.includes('?')
    ? { route, id }
    : null;
}
export function createV10ViewSession(storage: ViewStorage, scope: V10ViewScope, href: string) {
  if (!isV10LocalTarget(href)) throw new Error('返回目标未登记');
  const url = new URL(href, base);
  const route = url.pathname;
  const requestedId = url.searchParams.get('contextId');
  const id =
    requestedId && /^[a-zA-Z0-9-]{1,128}$/.test(requestedId) ? requestedId : crypto.randomUUID();
  const token = `${route}|${id}`;
  const notices: string[] = [];
  const read = (ref: string): ViewRecord | null => {
    const target = parseToken(ref);
    if (!target) throw Error('invalid target');
    const raw = storage.getItem(key(scope, target.route, target.id));
    if (!raw) return null;
    const record = JSON.parse(raw) as ViewRecord;
    if (!validView(record.view) || (record.parent !== null && typeof record.parent !== 'string'))
      throw Error('invalid view');
    return record;
  };
  let stored: ViewRecord | null = null;
  let parent: string | null = null;
  try {
    stored = read(token);
    parent = url.searchParams.get('returnContextId') ?? stored?.parent ?? null;
    const seen = new Set([token]);
    let ancestor = parent;
    for (let depth = 0; ancestor; depth++) {
      if (depth >= 32 || seen.has(ancestor)) throw Error('cyclic parent');
      seen.add(ancestor);
      const record = read(ancestor);
      if (!record) {
        parent = null;
        notices.push('返回上下文已失效，已显示当前范围。');
        break;
      }
      ancestor = record.parent;
    }
  } catch {
    parent = null;
    notices.push('无法恢复浏览位置或返回链无效，已显示当前范围；业务记录不受影响。');
  }
  const filters = { ...defaultV10ViewFilters(route), ...stored?.view.filters };
  const requestedTab = url.searchParams.get('tab');
  if (requestedTab && requestedTab !== stored?.view.filters.tab) {
    Object.assign(
      filters,
      { query: '', scope: 'active', status: '' },
      stored?.view.tabFilters?.[requestedTab],
    );
  }
  for (const name of Object.keys(filters) as (keyof V10ViewFilters)[]) {
    if (url.searchParams.has(name)) filters[name] = url.searchParams.get(name)!;
  }
  if (url.searchParams.has('status') && !url.searchParams.has('query')) filters.query = '';
  if (route === '/projects/board' && filters.tab !== 'board') {
    filters.tab = 'board';
    notices.push('页签条件无效，已恢复默认页签');
  }
  if (route === '/projects/board/exceptions' && filters.tab === 'management') {
    if (!['active', 'completed', 'cancelled', 'all'].includes(filters.scope)) {
      filters.scope = 'active';
      notices.push('执行范围无效，已恢复当前执行范围');
    }
    if (filters.status && !['delayed', 'warning', 'pending', 'normal'].includes(filters.status)) {
      filters.status = '';
      notices.push('交付状态无效，已恢复全部状态');
    }
  }
  if (route === '/projects/board/finance' || route === '/projects/board/exceptions') {
    const built = buildV10Target(
      route.endsWith('/finance')
        ? { page: 'finance', tab: filters.tab }
        : { page: 'exceptions', tab: filters.tab, scope: filters.scope, status: filters.status },
    );
    const params = new URL(built.href, base).searchParams;
    filters.tab = params.get('tab')!;
    // 保留管理页签自己的筛选，不把交付状态带入管理查询。
    if (route.endsWith('/exceptions') && filters.tab === 'delivery') {
      filters.scope = params.get('scope') ?? 'active';
      filters.status = params.get('status') ?? '';
    }
    notices.push(...built.notices);
  }
  if (filters.currency && !['CNY', 'EUR', 'USD'].includes(filters.currency)) {
    filters.currency = '';
    notices.push('币种条件无效，已恢复来源默认币种');
  }
  const start = filters.periodStart,
    end = filters.periodEnd;
  if (
    (start || end) &&
    (!isValidISODate(start) ||
      !isValidISODate(end) ||
      !start.endsWith('-01') ||
      end !==
        `${end.slice(0, 7)}-${new Date(Date.UTC(Number(end.slice(0, 4)), Number(end.slice(5, 7)), 0)).getUTCDate()}` ||
      start > end)
  ) {
    filters.periodStart = '';
    filters.periodEnd = '';
    notices.push('统计期间不是连续完整自然月，已恢复来源默认整月期间');
  }
  const view: V10ViewState = {
    tabFilters: stored?.view.tabFilters ?? {},
    filters,
    expanded: stored?.view.expanded ?? [],
    scrollY: stored?.view.scrollY ?? 0,
    focusKey: stored?.view.focusKey ?? '',
  };
  url.search = '';
  url.searchParams.set('contextId', id);
  return {
    view,
    notices,
    href: url.pathname + url.search,
    returnHref: parent
      ? (() => {
          const p = parseToken(parent)!;
          return `${p.route}?contextId=${p.id}`;
        })()
      : null,
    childHref(target: string): string {
      if (!isV10LocalTarget(target)) throw Error('返回目标未登记');
      const child = new URL(target, base);
      if (['returnTo', 'returnUrl', 'redirect'].some((k) => child.searchParams.has(k)))
        throw Error('返回目标未登记');
      child.searchParams.delete('contextId');
      child.searchParams.set('returnContextId', token);
      return child.pathname + child.search;
    },
    save(next: V10ViewState): string | null {
      try {
        const tabFilters = {
          ...view.tabFilters,
          ...next.tabFilters,
          [next.filters.tab]: {
            query: next.filters.query,
            scope: next.filters.scope,
            status: next.filters.status,
          },
        };
        storage.setItem(
          key(scope, route, id),
          JSON.stringify({ view: { ...next, tabFilters }, parent }),
        );
        return null;
      } catch {
        return '无法保存浏览位置；可以继续查看，返回后请重新筛选。';
      }
    },
  };
}
