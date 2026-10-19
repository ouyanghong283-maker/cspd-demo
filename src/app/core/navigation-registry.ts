/**
 * Shared navigation contract for the six confirmed V8 left-rail groups.
 * This registry is deliberately framework independent so features can use it
 * without depending on AppComponent or Angular Router internals.
 */
import {
  navigationModuleRegistry,
  type NavigationModuleRegistry,
} from './navigation-module-registry';
import './navigation-modules/home';
import './navigation-modules/sales';
import './navigation-modules/projects';
import './navigation-modules/contracts';
import './navigation-modules/plans';
import './navigation-modules/control';
export type { NavigationModuleRegistration } from './navigation-module-registry';

export type NavigationGroupId =
  'my-work' | 'customers' | 'sales-presales' | 'signing-delivery' | 'board-tools' | 'demo-support';
export type NavigationTargetState = 'implemented' | 'planned';
export type NavigationMatchSource = 'route' | 'legacy-alias';

export interface NavigationBadgeSource {
  kind: 'open-task-count' | 'record-count';
  sourceId: string;
}

export interface NavigationItem {
  id: string;
  groupId: NavigationGroupId;
  label: string;
  /** Route path pattern, using Angular-style :parameter segments. */
  targetPath: string;
  targetState: NavigationTargetState;
  /** Required path parameters for context-specific destinations such as a project. */
  requiredParams?: readonly string[];
  /** Optional source contract; it never implies an unread-notice count. */
  badgeSource?: NavigationBadgeSource;
  description?: string;
  queryParams?: Readonly<Record<string, string>>;
}

export interface NavigationGroup {
  id: NavigationGroupId;
  label: string;
  items: readonly NavigationItem[];
}

export interface NavigationRoute {
  id: string;
  pathPattern: string;
  targetState: NavigationTargetState;
}

export interface NavigationAlias {
  id: string;
  pathPattern: string;
  /** All listed query entries must match before this legacy alias applies. */
  whenQuery: Readonly<Record<string, string>>;
  targetPath: string;
  /** Consumed query keys are removed; unrelated context is carried to the target. */
  consumeQueryKeys: readonly string[];
  targetQueryParams?: Readonly<Record<string, string>>;
}

export interface ResolvedNavigationTarget {
  status: 'implemented' | 'planned';
  source: NavigationMatchSource;
  routeId: string;
  pathPattern: string;
  canonicalPath: string;
  params: Readonly<Record<string, string>>;
  queryParams: Readonly<Record<string, string>>;
  fragment: string;
  aliasId?: string;
}

export interface ContextRequiredNavigationTarget {
  status: 'context-required';
  itemId: string;
  requiredParams: readonly string[];
}

export interface NotFoundNavigationTarget {
  status: 'not-found';
  requestedPath: string;
  reason: 'unknown-route' | 'invalid-url' | 'missing-route-parameter';
}

export type NavigationResolution =
  ResolvedNavigationTarget | ContextRequiredNavigationTarget | NotFoundNavigationTarget;

/** V8 menu ownership; legacy URLs remain registered separately. */
export const NAVIGATION_GROUPS: readonly NavigationGroup[] = [
  {
    id: 'my-work',
    label: '我的工作',
    items: [
      {
        id: 'my-tasks',
        groupId: 'my-work',
        label: '我的待办',
        targetPath: '/',
        targetState: 'implemented',
        badgeSource: {
          kind: 'open-task-count',
          sourceId: 'my-work',
        },
      },
      {
        id: 'shared-project-board',
        groupId: 'my-work',
        label: '共享项目看板',
        targetPath: '/projects/board',
        targetState: 'implemented',
        badgeSource: {
          kind: 'open-task-count',
          sourceId: 'shared-project-board',
        },
      },
    ],
  },
  {
    id: 'customers',
    label: '客户',
    items: [
      {
        id: 'customers',
        groupId: 'customers',
        label: '客户管理',
        targetPath: '/sales/customers',
        targetState: 'implemented',
      },
      {
        id: 'contacts',
        groupId: 'customers',
        label: '联系人管理',
        targetPath: '/sales/contacts',
        targetState: 'implemented',
      },
    ],
  },
  {
    id: 'sales-presales',
    label: '销售与售前',
    items: [
      {
        id: 'leads',
        groupId: 'sales-presales',
        label: '线索管理',
        targetPath: '/sales/leads',
        targetState: 'implemented',
      },
      {
        id: 'opportunities',
        groupId: 'sales-presales',
        label: '商机管理',
        targetPath: '/sales/opportunities',
        targetState: 'implemented',
      },
      {
        id: 'solutions',
        groupId: 'sales-presales',
        label: '方案设计',
        targetPath: '/sales/solutions',
        targetState: 'implemented',
      },
      {
        id: 'quotes',
        groupId: 'sales-presales',
        label: '报价议价',
        targetPath: '/sales/quotes',
        targetState: 'implemented',
      },
    ],
  },
  {
    id: 'signing-delivery',
    label: '签约与交付',
    items: [
      {
        id: 'contracts',
        groupId: 'signing-delivery',
        label: '合同管理',
        targetPath: '/contracts',
        targetState: 'implemented',
      },
      {
        id: 'project-workspace',
        groupId: 'signing-delivery',
        label: '项目区',
        targetPath: '/projects',
        targetState: 'implemented',
      },
      {
        id: 'delivery-service',
        groupId: 'signing-delivery',
        label: '交付与售后',
        targetPath: '/delivery-service',
        targetState: 'implemented',
      },
    ],
  },
  {
    id: 'board-tools',
    label: '看板工具',
    items: [
      {
        id: 'opportunity-board',
        groupId: 'board-tools',
        label: '商机看板',
        targetPath: '/sales',
        targetState: 'implemented',
      },
      {
        id: 'plan-tracking',
        groupId: 'board-tools',
        label: '追踪看板',
        targetPath: '/plans/tracking',
        targetState: 'implemented',
      },
    ],
  },
  {
    id: 'demo-support',
    label: '演示辅助',
    items: [
      {
        id: 'demo-guide',
        groupId: 'demo-support',
        label: '演示控制与指南',
        targetPath: '/control',
        targetState: 'implemented',
      },
      {
        id: 'demo-continue',
        groupId: 'demo-support',
        label: '继续本轮',
        targetPath: '/control',
        targetState: 'implemented',
        queryParams: {
          action: 'continue',
        },
      },
      {
        id: 'demo-restart',
        groupId: 'demo-support',
        label: '重新开始演示',
        targetPath: '/control',
        targetState: 'implemented',
        queryParams: {
          action: 'restart',
        },
      },
    ],
  },
];

/** Current aggregate snapshots; Angular's actual routes remain in app.routes.ts. */
export const NAVIGATION_ROUTES: readonly NavigationRoute[] = navigationModuleRegistry.routes();
export const NAVIGATION_ALIASES: readonly NavigationAlias[] = navigationModuleRegistry.aliases();

const URL_BASE = 'https://navigation.local';

function normalizePath(pathname: string): string {
  if (!pathname || pathname === '/') return '/';
  const withLeadingSlash = pathname.startsWith('/') ? pathname : `/${pathname}`;
  return withLeadingSlash.replace(/\/{2,}/g, '/').replace(/\/$/, '') || '/';
}

function decodeSegments(path: string): string[] | undefined {
  try {
    return normalizePath(path)
      .split('/')
      .filter(Boolean)
      .map((segment) => decodeURIComponent(segment));
  } catch {
    return undefined;
  }
}

function matchPathPattern(
  pattern: string,
  path: string,
): Readonly<Record<string, string>> | undefined {
  const expected = decodeSegments(pattern);
  const actual = decodeSegments(path);
  if (!expected || !actual || expected.length !== actual.length) return undefined;
  const params: Record<string, string> = {};
  for (let index = 0; index < expected.length; index += 1) {
    const segment = expected[index];
    const value = actual[index];
    if (segment.startsWith(':')) {
      const name = segment.slice(1);
      if (!name || !value) return undefined;
      params[name] = value;
    } else if (segment !== value) {
      return undefined;
    }
  }
  return params;
}

function substitutePath(
  pattern: string,
  params: Readonly<Record<string, string>>,
): string | undefined {
  const segments = decodeSegments(pattern);
  if (!segments) return undefined;
  const replaced: string[] = [];
  for (const segment of segments) {
    if (!segment.startsWith(':')) {
      replaced.push(encodeURIComponent(segment));
      continue;
    }
    const value = params[segment.slice(1)];
    if (!value) return undefined;
    replaced.push(encodeURIComponent(value));
  }
  return replaced.length ? `/${replaced.join('/')}` : '/';
}

function sortedQueryParams(
  params: URLSearchParams,
  excluded: readonly string[] = [],
): Record<string, string> {
  const excludedKeys = new Set(excluded);
  return Object.fromEntries(
    [...params.entries()]
      .filter(([key]) => !excludedKeys.has(key))
      .sort(([left], [right]) => left.localeCompare(right)),
  );
}

function formatCanonicalPath(
  pathname: string,
  query: Readonly<Record<string, string>>,
  fragment: string,
): string {
  const search = new URLSearchParams(query).toString();
  return `${normalizePath(pathname)}${search ? `?${search}` : ''}${fragment ? `#${fragment}` : ''}`;
}

function parseInput(input: string): URL | undefined {
  try {
    const url = new URL(input, URL_BASE);
    if (url.origin !== URL_BASE) return undefined;
    return url;
  } catch {
    return undefined;
  }
}

function routeFor(
  path: string,
  registry: NavigationModuleRegistry,
): { route: NavigationRoute; params: Readonly<Record<string, string>> } | undefined {
  const matches = registry.routes().flatMap((route) => {
    const params = matchPathPattern(route.pathPattern, path);
    return params ? [{ route, params }] : [];
  });
  matches.sort((left, right) => {
    const literalSegments = (pattern: string) =>
      decodeSegments(pattern)?.filter((segment) => !segment.startsWith(':')).length || 0;
    return literalSegments(right.route.pathPattern) - literalSegments(left.route.pathPattern);
  });
  return matches[0];
}

function hasAliasQuery(alias: NavigationAlias, query: URLSearchParams): boolean {
  return Object.entries(alias.whenQuery).every(([key, value]) => query.get(key) === value);
}

function buildResolvedTarget(
  route: NavigationRoute,
  pathPattern: string,
  path: string,
  params: Readonly<Record<string, string>>,
  queryParams: Readonly<Record<string, string>>,
  fragment: string,
  source: NavigationMatchSource,
  aliasId?: string,
): ResolvedNavigationTarget {
  return {
    status: route.targetState,
    source,
    routeId: route.id,
    pathPattern,
    canonicalPath: formatCanonicalPath(path, queryParams, fragment),
    params,
    queryParams,
    fragment,
    ...(aliasId ? { aliasId } : {}),
  };
}

/** Resolves an app-relative route or a registered legacy alias; never falls back to '/'. */
export function resolveNavigationPath(
  input: string,
  registry: NavigationModuleRegistry = navigationModuleRegistry,
): NavigationResolution {
  const url = parseInput(input);
  if (!url) {
    return { status: 'not-found', requestedPath: input, reason: 'invalid-url' };
  }
  const pathname = normalizePath(url.pathname);
  const directRoute = routeFor(pathname, registry);
  const alias = registry
    .aliases()
    .find(
      (candidate) =>
        matchPathPattern(candidate.pathPattern, pathname) &&
        hasAliasQuery(candidate, url.searchParams),
    );

  if (alias) {
    const aliasParams = matchPathPattern(alias.pathPattern, pathname)!;
    const targetPath = substitutePath(alias.targetPath, aliasParams);
    if (!targetPath) {
      return { status: 'not-found', requestedPath: input, reason: 'missing-route-parameter' };
    }
    const targetRoute = routeFor(targetPath, registry);
    if (!targetRoute) {
      return { status: 'not-found', requestedPath: input, reason: 'unknown-route' };
    }
    const queryParams = sortedQueryParams(
      new URLSearchParams({
        ...sortedQueryParams(url.searchParams, alias.consumeQueryKeys),
        ...alias.targetQueryParams,
      }),
    );
    return buildResolvedTarget(
      targetRoute.route,
      targetRoute.route.pathPattern,
      targetPath,
      targetRoute.params,
      queryParams,
      url.hash.slice(1),
      'legacy-alias',
      alias.id,
    );
  }

  if (!directRoute) {
    return { status: 'not-found', requestedPath: input, reason: 'unknown-route' };
  }
  return buildResolvedTarget(
    directRoute.route,
    directRoute.route.pathPattern,
    pathname,
    directRoute.params,
    sortedQueryParams(url.searchParams),
    url.hash.slice(1),
    'route',
  );
}

/** Resolves a registered menu item and makes missing object context explicit. */
export function resolveNavigationItem(
  itemId: string,
  params: Readonly<Record<string, string>> = {},
  registry: NavigationModuleRegistry = navigationModuleRegistry,
): NavigationResolution {
  const item = NAVIGATION_GROUPS.flatMap((group) => group.items).find(
    (candidate) => candidate.id === itemId,
  );
  if (!item) {
    return { status: 'not-found', requestedPath: itemId, reason: 'unknown-route' };
  }
  const requiredParams = item.requiredParams || [];
  const missingParams = requiredParams.filter((name) => !params[name]?.trim());
  if (missingParams.length) {
    return { status: 'context-required', itemId, requiredParams: missingParams };
  }
  const path = substitutePath(item.targetPath, params);
  if (!path) {
    return {
      status: 'not-found',
      requestedPath: item.targetPath,
      reason: 'missing-route-parameter',
    };
  }
  if (item.targetState === 'planned') {
    const route = registry.routes().find((candidate) => candidate.pathPattern === item.targetPath);
    return {
      status: 'planned',
      source: 'route',
      routeId: route?.id || item.id,
      pathPattern: item.targetPath,
      canonicalPath: path,
      params,
      queryParams: {},
      fragment: '',
    };
  }
  return resolveNavigationPath(formatCanonicalPath(path, item.queryParams || {}, ''), registry);
}

/** Resolve details and legacy entries to their owning menu, without changing record identity. */
export function activeNavigationItem(input: string): NavigationItem | undefined {
  const target = resolveNavigationPath(input);
  if (target.status !== 'implemented' && target.status !== 'planned') return undefined;
  const url = parseInput(target.canonicalPath)!;
  let path = normalizePath(url.pathname);
  if (path.startsWith('/sales/detail/') || path === '/sales/departments')
    path = '/sales/opportunities';
  const matches = NAVIGATION_GROUPS.flatMap((group) => group.items).filter((item) => {
    if (item.targetPath === '/' && path !== '/') return false;
    return (
      (path === item.targetPath || path.startsWith(`${item.targetPath}/`)) &&
      Object.entries(item.queryParams || {}).every(
        ([key, value]) => url.searchParams.get(key) === value,
      )
    );
  });
  matches.sort(
    (a, b) =>
      b.targetPath.length - a.targetPath.length ||
      Object.keys(b.queryParams || {}).length - Object.keys(a.queryParams || {}).length,
  );
  return matches[0];
}
