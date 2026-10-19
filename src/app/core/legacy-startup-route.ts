import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';

export interface LegacyStartupTarget {
  projectId: string;
  queryParams: Readonly<Record<string, string>>;
  fragment: string;
}

/**
 * 旧启动链接映射到统一项目详情的“启动交底”页签：
 * projectId、部门、目标动作和锚点原样带到容器，容器内再按 dept/action 定位。
 */
export function legacyStartupTarget(
  params: Readonly<Record<string, string | undefined>>,
  queryParams: Readonly<Record<string, unknown>>,
  fragment: string | null | undefined,
): LegacyStartupTarget {
  const kept: Record<string, string> = {};
  for (const [key, value] of Object.entries(queryParams))
    if (typeof value === 'string' && key !== 'tab') kept[key] = value;
  return {
    projectId: params['id'] || '',
    queryParams: { ...kept, tab: 'startup' },
    fragment: fragment || '',
  };
}

/** 旧 `/projects/:id/startup` 落到既有“启动交底”页签，不保留第二套启动页实现。 */
export const confirmLegacyStartupRedirect: CanActivateFn = (route) => {
  const target = legacyStartupTarget(route.params, route.queryParams, route.fragment);
  return inject(Router).createUrlTree(['/projects', target.projectId], {
    queryParams: target.queryParams,
    fragment: target.fragment || undefined,
  });
};
