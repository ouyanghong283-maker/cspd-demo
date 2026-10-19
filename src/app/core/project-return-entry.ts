/**
 * 项目详情的来源返回契约：只接受已登记的入口地址，并给出对应返回文案。
 * 统一容器由项目工作、共享项目看板、部门记录和来源商机进入，返回入口不能只认一种形态。
 */
const LOCAL_BASE = 'http://project.local.invalid';

export interface ProjectReturnEntry {
  /** 校验通过的来源地址，由调用方交给 Router.parseUrl，避免直接跳外部地址。 */
  path: string;
  label: string;
}

/** 已登记的来源入口及文案；未知页面不渲染返回入口，避免出现指向空目标的链接。 */
function returnSourceLabel(url: URL): string | null {
  if (url.pathname === '/' && !url.search) return '返回我的待办';
  if (url.pathname === '/delivery-service') return '返回交付与售后';
  if (url.pathname === '/projects') return '返回项目工作';
  if (url.pathname === '/projects/board') return '返回共享项目看板';
  if (url.pathname === '/sales/departments') return '返回部门记录';
  if (url.pathname === '/sales/opportunities')
    return url.searchParams.get('tab') === 'departments' ? '返回部门记录' : '返回商机列表';
  return null;
}

/** 来源地址无效或未登记时返回空，页面不渲染返回入口。 */
export function projectReturnEntry(
  returnTo: string | null | undefined,
  returnLabel?: string | null,
): ProjectReturnEntry | null {
  const path = (returnTo || '').trim();
  if (!path) return null;
  let url: URL;
  try {
    url = new URL(path, LOCAL_BASE);
  } catch {
    return null;
  }
  if (url.origin !== LOCAL_BASE) return null;
  const label = returnSourceLabel(url);
  if (!label) return null;
  return { path, label: (returnLabel || '').trim() || label };
}
