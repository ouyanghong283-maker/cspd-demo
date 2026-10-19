import type { ManagementBoardFilters, V9Target } from '../v9-contracts';
export interface BoardViewState {
  filters: ManagementBoardFilters;
  section: string;
  scrollY: number;
  advancedOpen?: boolean;
  collaborationOpen?: boolean;
  reducedMotion?: boolean;
  focusHref?: string;
  focusKey?: string;
}
export interface BoardViewScope extends V9Target {
  route: string;
}
const key = (s: BoardViewScope) =>
  `cspd:v9:board-view:${JSON.stringify([s.workspaceId, s.roundId, s.route])}`;
export function saveBoardView(
  storage: Pick<Storage, 'setItem'>,
  scope: BoardViewScope,
  view: BoardViewState,
): string | null {
  try {
    storage.setItem(key(scope), JSON.stringify(view));
    return null;
  } catch {
    return '无法保存浏览位置；可以继续查看，返回后请重新筛选。';
  }
}
export function readBoardView(
  storage: Pick<Storage, 'getItem'>,
  scope: BoardViewScope,
): { view: BoardViewState | null; error: string | null } {
  try {
    const raw = storage.getItem(key(scope));
    if (!raw) return { view: null, error: null };
    const v = JSON.parse(raw);
    const f = v?.filters;
    if (f?.partition !== undefined && !['all', 'presales', 'execution'].includes(f.partition))
      throw Error('invalid');
    if (f?.budgetCurrency !== undefined && !['CNY', 'EUR', 'USD'].includes(f.budgetCurrency))
      throw Error('invalid');
    if (f?.exceptionOnly !== undefined && typeof f.exceptionOnly !== 'boolean')
      throw Error('invalid');
    if (
      ['advancedOpen', 'collaborationOpen', 'reducedMotion'].some(
        (k) => v?.[k] !== undefined && typeof v[k] !== 'boolean',
      )
    )
      throw Error('invalid');
    if (
      v?.focusHref !== undefined &&
      (typeof v.focusHref !== 'string' || v.focusHref.length > 4096)
    )
      throw Error('invalid');
    if (v?.focusKey !== undefined && (typeof v.focusKey !== 'string' || v.focusKey.length > 1024))
      throw Error('invalid');
    if (!['all', 'presales', 'execution'].includes(v?.section)) throw Error('invalid');
    if (
      !f ||
      !['projectIds', 'businessIds', 'grades', 'departments', 'firstResults'].every(
        (k) => Array.isArray(f[k]) && f[k].every((x: unknown) => typeof x === 'string'),
      ) ||
      typeof f.query !== 'string' ||
      typeof v.section !== 'string' ||
      !Number.isFinite(v.scrollY) ||
      v.scrollY < 0 ||
      ['regions', 'stages', 'owners'].some(
        (k) =>
          f[k] !== undefined &&
          (!Array.isArray(f[k]) || !f[k].every((x: unknown) => typeof x === 'string')),
      )
    )
      throw Error('invalid');
    return { view: v, error: null };
  } catch {
    return { view: null, error: '无法恢复浏览位置，已显示默认范围；业务记录不受影响。' };
  }
}
