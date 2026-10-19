/**
 * 「路径?查询」形式的链接文本（工作项/预警/看板共用的 href 契约）不能直接交给
 * Angular 的 routerLink：字符串命令会被整体当作路径段，`?` 与 `&` 会被编码进 URL。
 * 这里把它拆成 routerLink 真正需要的 path 与 queryParams 两段。
 */
export interface RouteHref {
  path: string;
  query: Record<string, string>;
}

export function parseRouteHref(href: string | undefined): RouteHref {
  const [path = '', search = ''] = (href || '').split('?');
  const query: Record<string, string> = {};
  for (const [key, value] of new URLSearchParams(search)) {
    if (key) query[key] = value;
  }
  return { path: path || '/', query };
}
