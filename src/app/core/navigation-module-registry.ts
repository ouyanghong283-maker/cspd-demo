import type { NavigationAlias, NavigationRoute } from './navigation-registry';

/** A feature module owns the routes and legacy aliases it can resolve. */
export interface NavigationModuleRegistration {
  moduleId: string;
  routes: readonly NavigationRoute[];
  aliases?: readonly NavigationAlias[];
}

/**
 * Collects feature-owned route contracts without coupling them to Angular
 * Router. Features register here; the shared resolver reads the aggregate.
 */
export class NavigationModuleRegistry {
  private readonly registrations = new Map<string, NavigationModuleRegistration>();

  register(registration: NavigationModuleRegistration): void {
    const moduleId = registration.moduleId.trim();
    if (!moduleId) throw new Error('导航模块ID不能为空');
    if (this.registrations.has(moduleId)) throw new Error(`导航模块重复注册：${moduleId}`);

    const routeIds = new Set(this.routes().map((route) => route.id));
    const routePaths = new Set(this.routes().map((route) => route.pathPattern));
    for (const route of registration.routes) {
      if (!route.id.trim()) throw new Error(`导航路由ID不能为空：${moduleId}`);
      if (!route.pathPattern.startsWith('/')) {
        throw new Error(`导航路由必须使用根路径：${moduleId} · ${route.pathPattern}`);
      }
      if (routeIds.has(route.id)) throw new Error(`导航路由ID重复：${route.id}`);
      if (routePaths.has(route.pathPattern))
        throw new Error(`导航路由路径重复：${route.pathPattern}`);
      routeIds.add(route.id);
      routePaths.add(route.pathPattern);
    }

    const aliasIds = new Set(this.aliases().map((alias) => alias.id));
    for (const alias of registration.aliases || []) {
      if (!alias.id.trim()) throw new Error(`导航别名ID不能为空：${moduleId}`);
      if (aliasIds.has(alias.id)) throw new Error(`导航别名ID重复：${alias.id}`);
      if (!alias.pathPattern.startsWith('/') || !alias.targetPath.startsWith('/')) {
        throw new Error(`导航别名必须使用根路径：${moduleId} · ${alias.id}`);
      }
      aliasIds.add(alias.id);
    }

    this.registrations.set(moduleId, {
      moduleId,
      routes: registration.routes.map((route) => ({ ...route })),
      aliases: (registration.aliases || []).map((alias) => ({
        ...alias,
        whenQuery: { ...alias.whenQuery },
        consumeQueryKeys: [...alias.consumeQueryKeys],
      })),
    });
  }

  moduleIds(): string[] {
    return [...this.registrations.keys()];
  }

  routes(): NavigationRoute[] {
    return [...this.registrations.values()].flatMap((module) => module.routes);
  }

  aliases(): NavigationAlias[] {
    return [...this.registrations.values()].flatMap((module) => module.aliases || []);
  }

  moduleRegistrations(): NavigationModuleRegistration[] {
    return [...this.registrations.values()];
  }
}

/** Shared registry used by feature-owned navigation registration files. */
export const navigationModuleRegistry = new NavigationModuleRegistry();
