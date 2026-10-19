export type V10Target =
  | { page: 'board' }
  | { page: 'finance'; tab?: string }
  | { page: 'exceptions'; tab?: string; scope?: string; status?: string }
  | { page: 'project-finance'; projectId: string };
export interface V10BuiltTarget {
  href: string;
  notices: string[];
}

/** 只生成已登记的本地目标；项目不存在由原详情页明确提示。 */
export function buildV10Target(target: V10Target): V10BuiltTarget {
  const notices: string[] = [];
  const params = new URLSearchParams();
  if (target.page === 'board') return { href: '/projects/board', notices };
  if (target.page === 'project-finance') {
    if (!target.projectId.trim()) throw new Error('项目ID不能为空');
    params.set('tab', 'overview');
    params.set('section', '财务信息');
    return { href: `/projects/${encodeURIComponent(target.projectId)}?${params}`, notices };
  }
  const tabs =
    target.page === 'finance' ? ['margin', 'budget', 'finance'] : ['delivery', 'management'];
  const tab = target.tab && tabs.includes(target.tab) ? target.tab : tabs[0];
  if (target.tab && !tabs.includes(target.tab)) notices.push('页签条件无效，已恢复默认页签');
  params.set('tab', tab);
  if (target.page === 'exceptions' && tab === 'delivery') {
    if (target.scope) {
      const validScope = ['active', 'completed', 'cancelled', 'all'].includes(target.scope);
      params.set('scope', validScope ? target.scope : 'active');
      if (!validScope) notices.push('执行范围无效，已恢复当前执行范围');
    }
    if (target.status) {
      if (['delayed', 'warning', 'pending', 'normal'].includes(target.status))
        params.set('status', target.status);
      else notices.push('交付状态无效，已恢复全部状态');
    }
  }
  return { href: `/projects/board/${target.page}?${params}`, notices };
}
export function openV10Target(
  router: { navigateByUrl(url: string): Promise<boolean> },
  target: V10Target,
): Promise<boolean> {
  return router.navigateByUrl(buildV10Target(target).href);
}
